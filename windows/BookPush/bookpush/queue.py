"""The list of books waiting to be pushed. One failure does not drop the rest.

Books the phone has accepted leave the queue. Failures stay, marked so they
can be sent again. Each entry keeps its own status: a parallel convert or a
second batch cannot replace another book's result.
"""

from __future__ import annotations

import queue
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from bookpush.batch import convert_batch
from bookpush.kindle import default_cache_dir
from bookpush.uploader import UploadError, upload_book


def _key(path: Path) -> str:
    try:
        return str(path.resolve())
    except OSError:
        return str(path)


@dataclass
class QueueEntry:
    path: Path
    status: str = "pending"
    detail: str = ""

    @property
    def label(self) -> str:
        if self.status == "failed":
            return f"{self.path.name}（失败，可重试）"
        return self.path.name


class PushQueue:
    def __init__(self) -> None:
        self.entries: list[QueueEntry] = []
        self._lock = threading.RLock()

    @property
    def files(self) -> list[Path]:
        with self._lock:
            return [entry.path for entry in self.entries]

    def add(self, paths: list[Path]) -> list[str]:
        added: list[str] = []
        with self._lock:
            seen = {_key(entry.path) for entry in self.entries}
            for path in paths:
                key = _key(path)
                if key in seen or not path.is_file():
                    continue
                seen.add(key)
                self.entries.append(QueueEntry(path))
                added.append(path.name)
        return added

    def remove_at(self, indexes: list[int]) -> list[str]:
        removed: list[str] = []
        with self._lock:
            for index in sorted(set(indexes), reverse=True):
                if 0 <= index < len(self.entries):
                    removed.append(self.entries.pop(index).path.name)
        removed.reverse()
        return removed

    def clear(self) -> int:
        with self._lock:
            count = len(self.entries)
            self.entries.clear()
            return count

    def snapshot(self) -> list[QueueEntry]:
        with self._lock:
            return [QueueEntry(entry.path, entry.status, entry.detail) for entry in self.entries]

    def labels(self) -> list[str]:
        return [entry.label for entry in self.snapshot()]

    def summary(self) -> str:
        with self._lock:
            count = len(self.entries)
            failed = sum(1 for entry in self.entries if entry.status == "failed")
        if count == 0:
            return "队列是空的。先把要送的书加进来，再点开始传书。"
        text = (
            f"队列里有 {count} 本。点「开始传书」会一次送完，不必一本一本点。"
            "PDF 和 EPUB 原样发送；无 DRM 的 AZW3 / AZW 会先转成 EPUB，多本一起转，转好就送。"
            "送到手机的书会离开队列。其中一本失败时，后面的书继续送。"
        )
        if failed:
            return text + f"其中 {failed} 本失败，仍留在这里，再点开始传书即可重试。"
        return text + "失败的会留下并标为失败，方便重试。"

    def mark_pending(self, path: Path) -> None:
        key = _key(path)
        with self._lock:
            for entry in self.entries:
                if _key(entry.path) == key:
                    entry.status = "pending"
                    entry.detail = ""
                    return

    def settle_one(self, path: Path, outcome: PushOutcome) -> str:
        """Drop a book the phone accepted. Keep a failure on that same entry.

        Matching is by file path, not by list index or display name, so an
        earlier success cannot shift later results onto the wrong book.
        """
        key = _key(path)
        with self._lock:
            for index, entry in enumerate(self.entries):
                if _key(entry.path) != key:
                    continue
                if outcome.ok:
                    self.entries.pop(index)
                    return "removed"
                entry.status = "failed"
                entry.detail = outcome.detail
                return "failed"
            return "missing"

    def settle(self, paths: list[Path], outcomes: list[PushOutcome]) -> None:
        for path, outcome in zip(paths, outcomes):
            self.settle_one(path, outcome)


@dataclass
class PushOutcome:
    name: str
    ok: bool
    title: str = ""
    detail: str = ""


@dataclass
class TransferProgress:
    """``phase`` is ``convert`` or ``push``. ``detail`` is an upload percent, when known."""

    phase: str
    current: int
    total: int
    name: str = ""
    detail: str = ""


def describe_batch(outcomes: list[PushOutcome]) -> str:
    sent = [item for item in outcomes if item.ok]
    failed = [item for item in outcomes if not item.ok]
    if not outcomes:
        return "没有要送的书。"
    if sent and failed:
        return (
            f"已送出 {len(sent)} 本，{len(failed)} 本失败。"
            "送到手机的已经从队列移出；失败的仍留在队列里，可以再点开始传书重试。"
        )
    if failed:
        return f"{len(failed)} 本没有送到，仍留在队列里。请看下面每一本的说明，再点开始传书重试。"
    return f"全部 {len(sent)} 本已送到手机，并已从队列移出。"


def push_batch(
    files: list[Path],
    host: str,
    port: int,
    pin: str,
    *,
    on_progress=None,
    converter: Path | None = None,
    search: bool = True,
    cache_dir: Path | None = None,
    workers: int | None = None,
    missing_message: str | None = None,
    on_outcome=None,
) -> list[PushOutcome]:
    """Convert Kindle files concurrently, then upload each book as soon as it is ready.

    Conversion may run on several cores. Uploads follow in order so one slow
    book does not block the next from being prepared, and every file in this
    batch is attempted. Each index owns one result; a later book cannot
    overwrite an earlier success or failure.
    """
    outcomes: list[PushOutcome | None] = [None] * len(files)
    uploads: queue.Queue = queue.Queue()
    push_state = {"done": 0, "total": 0}
    state_lock = threading.Lock()

    def emit(phase: str, current: int, total: int, name: str, detail: str = "") -> None:
        if on_progress is not None:
            on_progress(TransferProgress(phase, current, total, name, detail))

    def record(index: int, outcome: PushOutcome) -> None:
        with state_lock:
            if outcomes[index] is not None:
                return
            outcomes[index] = outcome
        if on_outcome is not None:
            on_outcome(index, outcome)

    def uploader() -> None:
        while True:
            job = uploads.get()
            if job is None:
                return
            index, path, note, display = job

            def byte_progress(sent: int, total_bytes: int, label: str = display) -> None:
                if total_bytes <= 0:
                    return
                percent = min(100, int(sent * 100 / total_bytes))
                with state_lock:
                    current = push_state["done"]
                    total = push_state["total"]
                emit("push", current, max(total, 1), label, f"{percent}%")

            try:
                result = upload_book(host, port, path, pin, on_progress=byte_progress)
            except UploadError as error:
                record(index, PushOutcome(files[index].name, False, detail=str(error)))
            else:
                title = str(result.get("title") or path.stem)
                record(index, PushOutcome(files[index].name, True, title=title, detail=note or ""))
            with state_lock:
                push_state["done"] += 1
                current = push_state["done"]
                total = push_state["total"]
            emit("push", current, max(total, 1), display)

    thread = threading.Thread(target=uploader, daemon=True)
    thread.start()

    def on_convert(current: int, total: int, name: str) -> None:
        emit("convert", current, total, name)

    def on_ready(index: int, item) -> None:
        if not item.ok or item.output is None:
            record(index, PushOutcome(files[index].name, False, detail=item.detail))
            return
        with state_lock:
            push_state["total"] += 1
            current = push_state["done"]
            total = push_state["total"]
        emit("push", current, total, files[index].name)
        uploads.put((index, item.output, item.note or "", files[index].name))

    cache = cache_dir or default_cache_dir()
    with tempfile.TemporaryDirectory() as temp:
        try:
            convert_batch(
                files,
                cache_dir=cache,
                work_dir=Path(temp),
                converter=converter,
                search=search,
                workers=workers,
                missing_message=missing_message,
                on_progress=on_convert,
                on_ready=on_ready,
            )
        finally:
            uploads.put(None)
            thread.join()
    finished: list[PushOutcome] = []
    for index in range(len(files)):
        item = outcomes[index]
        if item is None:
            record(index, PushOutcome(files[index].name, False, detail="没有结果。"))
            item = outcomes[index]
        if item is None:
            item = PushOutcome(files[index].name, False, detail="没有结果。")
        finished.append(item)
    return finished


def push_queue(
    queue: PushQueue,
    host: str,
    port: int,
    pin: str,
    *,
    files: list[Path] | None = None,
    on_progress=None,
    on_outcome=None,
    converter: Path | None = None,
    search: bool = True,
    cache_dir: Path | None = None,
    workers: int | None = None,
    missing_message: str | None = None,
) -> list[PushOutcome]:
    """Send every book in ``files`` (or the whole queue) and settle each result.

    Successes are removed. Failures stay on their own entry. ``on_outcome``
    runs after that entry has been updated, including from the upload thread
    and from conversion workers.
    """
    chosen = list(queue.files if files is None else files)
    for path in chosen:
        queue.mark_pending(path)

    def wrapped(index: int, outcome: PushOutcome) -> None:
        queue.settle_one(chosen[index], outcome)
        if on_outcome is not None:
            on_outcome(index, outcome)

    outcomes = push_batch(
        chosen,
        host,
        port,
        pin,
        on_progress=on_progress,
        on_outcome=wrapped,
        converter=converter,
        search=search,
        cache_dir=cache_dir,
        workers=workers,
        missing_message=missing_message,
    )
    return outcomes
