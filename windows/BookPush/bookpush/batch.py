"""Convert a queue of AZW3 files without blocking books that are already EPUB or PDF.

Unprotected files that this process can read become EPUB in a process pool
(one worker per CPU). Anything that parser cannot build goes to the official
Calibre pool. Encrypted files are skipped before either converter runs.
Identical bytes are converted once and reused from the content-hash cache.
"""

from __future__ import annotations

import hashlib
import multiprocessing
import os
import sys
import threading
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from bookpush.affinity import pin_current_process
from bookpush.calibre_pool import CalibreJob, CalibreWorkerError, convert_with_calibre
from bookpush.fastconvert import fast_convert_path
from bookpush.kindle import (
    CALIBRE_DRM_MESSAGE,
    CALIBRE_MISSING,
    DRM_MESSAGE,
    KFX_MESSAGE,
    KINDLE_SUFFIXES,
    find_converter,
    refuse_protected,
)
from bookpush.uploader import UploadError

CACHE_SALT = b"bookpush-azw3-epub-v1\0"


@dataclass
class BatchItem:
    source: Path
    ok: bool
    output: Path | None
    detail: str = ""
    note: str | None = None
    cached: bool = False


def default_workers(count: int) -> int:
    cpus = os.cpu_count() or 2
    return max(1, min(max(count, 1), cpus))


def content_digest(data: bytes) -> str:
    return hashlib.sha256(CACHE_SALT + data).hexdigest()


def cache_epub_path(cache_dir: Path, digest: str) -> Path:
    return cache_dir / digest[:2] / f"{digest}.epub"


def init_fast_worker(counter) -> None:
    root = str(Path(__file__).resolve().parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
    with counter.get_lock():
        index = int(counter.value)
        counter.value += 1
    pin_current_process(index)


def convert_batch(
    files: list[Path],
    *,
    cache_dir: Path,
    work_dir: Path,
    converter: Path | None = None,
    search: bool = True,
    workers: int | None = None,
    legacy_names: bool = False,
    missing_message: str | None = None,
    on_progress=None,
    on_ready=None,
) -> list[BatchItem]:
    """Return one item per input file, in the same order.

    ``on_ready`` may run from a worker thread as soon as that file can be pushed.
    ``on_progress(current, total, name)`` counts Kindle files only.
    """
    items: list[BatchItem | None] = [None] * len(files)
    kindle_total = sum(1 for path in files if path.suffix.lower() in KINDLE_SUFFIXES)
    done = 0
    done_lock = threading.Lock()
    ready_lock = threading.Lock()

    def mark(name: str) -> None:
        nonlocal done
        with done_lock:
            done += 1
            current = done
        if on_progress is not None and kindle_total:
            on_progress(current, kindle_total, name)

    def publish(index: int, item: BatchItem) -> None:
        items[index] = item
        if on_ready is None:
            return
        with ready_lock:
            on_ready(index, item)

    leaders: dict[str, int] = {}
    waiting: dict[str, list[int]] = {}
    pending: list[tuple[int, Path, str]] = []

    for index, path in enumerate(files):
        if path.suffix.lower() not in KINDLE_SUFFIXES:
            publish(index, BatchItem(path, True, path))
            continue
        try:
            data = path.read_bytes()
        except OSError as error:
            publish(index, BatchItem(path, False, None, detail=f"读不到文件：{error}"))
            mark(path.name)
            continue
        try:
            refuse_protected(data)
        except UploadError as error:
            publish(index, BatchItem(path, False, None, detail=str(error)))
            mark(path.name)
            continue
        digest = content_digest(data)
        cached = _cached(cache_dir, digest)
        if cached is not None:
            note = f"《{path.name}》与上次内容相同，直接使用缓存的 EPUB。"
            publish(index, _with_friendly(work_dir, path, BatchItem(path, True, cached, note=note, cached=True)))
            mark(path.name)
            continue
        if digest in leaders:
            waiting.setdefault(digest, []).append(index)
            continue
        leaders[digest] = index
        pending.append((index, path, digest))

    if pending:
        worker_count = workers or default_workers(len(pending))
        fast_results = _run_fast(pending, worker_count)
        fallbacks: list[tuple[int, Path, str]] = []
        for index, path, digest in pending:
            result = fast_results.get(index) or {
                "status": "fallback",
                "message": "本机转换没有返回结果。",
            }
            status = result.get("status")
            epub = result.get("epub") or b""
            if status == "ok" and epub:
                output = _store_epub(cache_dir, work_dir, path, digest, epub, legacy_names)
                note = f"已在本机把《{path.name}》转成 EPUB，未调用 Calibre。"
                _share(files, work_dir, index, path, digest, BatchItem(path, True, output, note=note), waiting, publish, mark)
            elif status == "drm":
                _share(
                    files,
                    work_dir,
                    index,
                    path,
                    digest,
                    BatchItem(path, False, None, detail=str(result.get("message") or DRM_MESSAGE)),
                    waiting,
                    publish,
                    mark,
                )
            elif status == "kfx":
                _share(
                    files,
                    work_dir,
                    index,
                    path,
                    digest,
                    BatchItem(path, False, None, detail=str(result.get("message") or KFX_MESSAGE)),
                    waiting,
                    publish,
                    mark,
                )
            else:
                fallbacks.append((index, path, digest))
        if fallbacks:
            _run_calibre(
                files,
                fallbacks,
                cache_dir=cache_dir,
                work_dir=work_dir,
                converter=converter,
                search=search,
                workers=workers or default_workers(len(fallbacks)),
                legacy_names=legacy_names,
                missing_message=missing_message,
                waiting=waiting,
                publish=publish,
                mark=mark,
            )

    return [
        item if item is not None else BatchItem(files[index], False, None, detail="没有转换结果。")
        for index, item in enumerate(items)
    ]


def _share(files, work_dir, index, path, digest, item, waiting, publish, mark) -> None:
    item = _with_friendly(work_dir, path, item)
    publish(index, item)
    mark(path.name)
    for other_index in waiting.get(digest, []):
        other = files[other_index]
        if item.ok and item.output is not None:
            note = f"《{other.name}》与《{path.name}》内容相同，直接使用刚转好的 EPUB。"
            sibling = _with_friendly(work_dir, other, BatchItem(other, True, item.output, note=note))
            publish(other_index, sibling)
        else:
            publish(other_index, BatchItem(other, False, None, detail=item.detail))
        mark(other.name)


def _with_friendly(work_dir: Path, source: Path, item: BatchItem) -> BatchItem:
    """Upload `{stem}.epub` instead of the content-hash cache name."""
    if not item.ok or item.output is None or source.suffix.lower() not in KINDLE_SUFFIXES:
        return item
    friendly = work_dir / f"{source.stem}.epub"
    try:
        if friendly.resolve() == item.output.resolve():
            return item
    except OSError:
        pass
    data = item.output.read_bytes()
    if friendly.exists():
        try:
            same = friendly.read_bytes() == data
        except OSError:
            same = False
        if not same:
            friendly = work_dir / f"{source.stem}-{item.output.stem[:8]}.epub"
    if friendly != item.output:
        friendly.parent.mkdir(parents=True, exist_ok=True)
        friendly.write_bytes(data)
    return BatchItem(source, True, friendly, item.detail, item.note, item.cached)


def _run_fast(pending: list[tuple[int, Path, str]], workers: int) -> dict[int, dict]:
    if len(pending) <= 1 or workers <= 1:
        return {index: fast_convert_path(str(path)) for index, path, _digest in pending}
    root = str(Path(__file__).resolve().parents[1])
    previous = os.environ.get("PYTHONPATH", "")
    os.environ["PYTHONPATH"] = root if not previous else root + os.pathsep + previous
    results: dict[int, dict] = {}
    ctx = multiprocessing.get_context("spawn")
    counter = ctx.Value("i", 0)
    try:
        with ProcessPoolExecutor(
            max_workers=min(workers, len(pending)),
            mp_context=ctx,
            initializer=init_fast_worker,
            initargs=(counter,),
        ) as pool:
            futures = {pool.submit(fast_convert_path, str(path)): index for index, path, _digest in pending}
            for future in as_completed(futures):
                index = futures[future]
                try:
                    results[index] = future.result()
                except Exception as error:
                    results[index] = {"status": "fallback", "message": f"本机转换没有完成：{error}", "epub": b""}
    except Exception:
        results = {}
    finally:
        if previous:
            os.environ["PYTHONPATH"] = previous
        else:
            os.environ.pop("PYTHONPATH", None)
    for index, path, _digest in pending:
        if index not in results:
            results[index] = fast_convert_path(str(path))
    return results


def _run_calibre(
    files,
    fallbacks: list[tuple[int, Path, str]],
    *,
    cache_dir: Path,
    work_dir: Path,
    converter: Path | None,
    search: bool,
    workers: int,
    legacy_names: bool,
    missing_message: str | None,
    waiting,
    publish,
    mark,
) -> None:
    tool = converter if converter is not None else (find_converter() if search else None)
    if tool is None or not tool.is_file():
        message = missing_message or CALIBRE_MISSING
        for index, path, digest in fallbacks:
            _share(files, work_dir, index, path, digest, BatchItem(path, False, None, detail=message), waiting, publish, mark)
        return
    jobs: list[CalibreJob] = []
    locations: dict[int, Path] = {}
    for slot, (index, path, digest) in enumerate(fallbacks):
        legacy = legacy_names and len(fallbacks) == 1
        dest = _stage_path(work_dir, path, digest, legacy)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            dest.unlink()
        jobs.append(CalibreJob(index=index, source=path, dest=dest, affinity=slot))
        locations[index] = dest
    try:
        results = convert_with_calibre(tool, jobs, cache_dir=cache_dir, workers=workers)
    except CalibreWorkerError as error:
        message = f"Calibre 转换没有完成，这一本已跳过。{error}"
        for index, path, digest in fallbacks:
            _share(files, work_dir, index, path, digest, BatchItem(path, False, None, detail=message), waiting, publish, mark)
        return
    by_index = {item.index: item for item in results}
    for index, path, digest in fallbacks:
        result = by_index.get(index)
        dest = locations[index]
        wrote = dest.is_file() and dest.stat().st_size > 0
        if result is not None and result.ok and wrote:
            payload = dest.read_bytes()
            stored = _store_epub(cache_dir, work_dir, path, digest, payload, legacy_names=False)
            output = dest if legacy_names and dest.parent == work_dir else stored
            note = f"已用 Calibre 把《{path.name}》转成 EPUB 再发送。"
            _share(files, work_dir, index, path, digest, BatchItem(path, True, output, note=note), waiting, publish, mark)
            continue
        if dest.exists():
            try:
                dest.unlink()
            except OSError:
                pass
        if result is not None and result.drm:
            detail = result.detail or CALIBRE_DRM_MESSAGE
        elif result is not None and result.detail:
            detail = result.detail
        else:
            detail = "Calibre 转换失败，这一本已跳过。"
        _share(files, work_dir, index, path, digest, BatchItem(path, False, None, detail=detail), waiting, publish, mark)


def _cached(cache_dir: Path, digest: str) -> Path | None:
    path = cache_epub_path(cache_dir, digest)
    try:
        if path.is_file() and path.stat().st_size > 0 and path.read_bytes()[:2] == b"PK":
            return path
    except OSError:
        return None
    return None


def _store_epub(
    cache_dir: Path,
    work_dir: Path,
    source: Path,
    digest: str,
    epub: bytes,
    legacy_names: bool,
) -> Path:
    final = cache_epub_path(cache_dir, digest)
    final.parent.mkdir(parents=True, exist_ok=True)
    temporary = final.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_bytes(epub)
    os.replace(temporary, final)
    if legacy_names:
        legacy = work_dir / f"{source.stem}.epub"
        legacy.write_bytes(epub)
        return legacy
    return final


def _stage_path(work_dir: Path, source: Path, digest: str, legacy: bool) -> Path:
    if legacy:
        return work_dir / f"{source.stem}.epub"
    staging = work_dir / "calibre-staging"
    staging.mkdir(parents=True, exist_ok=True)
    return staging / f"{digest}.epub"
