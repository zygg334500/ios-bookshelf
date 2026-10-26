"""The list of books waiting to be pushed. One failure does not drop the rest."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path

from bookpush.kindle import prepare_book
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
        return f"队列里有 {count} 本。会按列表顺序送出；其中一本失败时，后面的书继续送。"


@dataclass
class PushOutcome:
    name: str
    ok: bool
    title: str = ""
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


def push_batch(files: list[Path], host: str, port: int, pin: str) -> list[PushOutcome]:
    outcomes: list[PushOutcome] = []
    with tempfile.TemporaryDirectory() as temp:
        work_dir = Path(temp)
        for path in files:
            try:
                prepared = prepare_book(path, work_dir)
            except UploadError as error:
                outcomes.append(PushOutcome(path.name, False, detail=str(error)))
                continue
            try:
                result = upload_book(host, port, prepared.path, pin)
            except UploadError as error:
                outcomes.append(PushOutcome(path.name, False, detail=str(error)))
                continue
            title = str(result.get("title") or path.stem)
            outcomes.append(PushOutcome(path.name, True, title=title, detail=prepared.note or ""))
    return outcomes
