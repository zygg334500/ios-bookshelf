"""The list of books waiting to be pushed. One failure does not drop the rest."""

from __future__ import annotations

import queue
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from bookpush.batch import convert_batch
from bookpush.kindle import default_cache_dir
from bookpush.uploader import UploadError, upload_book


class PushQueue:
    def __init__(self) -> None:
        self.files: list[Path] = []

    def add(self, paths: list[Path]) -> list[str]:
        added: list[str] = []
        seen = {item.resolve() for item in self.files}
        for path in paths:
            try:
                key = path.resolve()
            except OSError:
                continue
            if key in seen or not path.is_file():
                continue
            seen.add(key)
            self.files.append(path)
            added.append(path.name)
        return added

    def remove_at(self, indexes: list[int]) -> list[str]:
        removed: list[str] = []
        for index in sorted(set(indexes), reverse=True):
            if 0 <= index < len(self.files):
                removed.append(self.files.pop(index).name)
        removed.reverse()
        return removed

    def clear(self) -> int:
        count = len(self.files)
        self.files.clear()
        return count

    def labels(self) -> list[str]:
        return [path.name for path in self.files]

    def summary(self) -> str:
        count = len(self.files)
        if count == 0:
            return "队列是空的。先把要送的书加进来，再点开始传书。"
        return (
            f"队列里有 {count} 本。PDF 和 EPUB 原样发送；无 DRM 的 AZW3 / AZW 会先转成 EPUB。"
            "其中一本失败时，后面的书继续送。"
        )


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
        return f"已送出 {len(sent)} 本，{len(failed)} 本失败。失败的书没有挡住后面的书。"
    if failed:
        return f"{len(failed)} 本没有送到。请看下面每一本的说明。"
    return f"全部 {len(sent)} 本已送到手机。队列还在，可以再送一次，或把已经送出的书移出队列。"


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
) -> list[PushOutcome]:
    """Convert Kindle files concurrently, and start uploading each book as soon as it is ready."""
    outcomes: list[PushOutcome | None] = [None] * len(files)
    uploads: queue.Queue = queue.Queue()
    push_state = {"done": 0, "total": 0}
    state_lock = threading.Lock()

    def emit(phase: str, current: int, total: int, name: str, detail: str = "") -> None:
        if on_progress is not None:
            on_progress(TransferProgress(phase, current, total, name, detail))

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
                outcomes[index] = PushOutcome(files[index].name, False, detail=str(error))
            else:
                title = str(result.get("title") or path.stem)
                outcomes[index] = PushOutcome(files[index].name, True, title=title, detail=note or "")
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
            outcomes[index] = PushOutcome(files[index].name, False, detail=item.detail)
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
    return [
        item if item is not None else PushOutcome(files[index].name, False, detail="没有结果。")
        for index, item in enumerate(outcomes)
    ]
