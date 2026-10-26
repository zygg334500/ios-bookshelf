"""Send unprotected Kindle files, optionally via Calibre. Never removes DRM."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from bookpush.uploader import UploadError

KINDLE_SUFFIXES = {".azw3", ".azw", ".mobi", ".kf8", ".prc"}

DRM_MESSAGE = (
    "此文件受数字版权保护（DRM），BookShelf 无法打开。本应用只读取无 DRM 的 AZW3 / KF8，不会尝试解除保护。"
    "请改用你有权阅读的 EPUB、PDF，或出版社提供的无 DRM 文件，或使用 Amazon 自己的阅读器。"
)

KFX_MESSAGE = (
    "这是 KFX 容器，BookShelf 不能阅读，也不会尝试解除保护。"
    "请改用无 DRM 的 EPUB、PDF 或 AZW3，或使用 Amazon 自己的阅读器。"
)


@dataclass
class PreparedBook:
    path: Path
    note: str | None = None


def find_converter() -> Path | None:
    found = shutil.which("ebook-convert")
    if found:
        return Path(found)
    candidates = [
        Path(r"C:\Program Files\Calibre2\ebook-convert.exe"),
        Path(r"C:\Program Files\Calibre\ebook-convert.exe"),
        Path(r"C:\Program Files (x86)\Calibre2\ebook-convert.exe"),
        Path.home() / "AppData/Local/Programs/Calibre/ebook-convert.exe",
        Path.home() / "AppData/Local/calibre-ebook/ebook-convert.exe",
        Path("/usr/bin/ebook-convert"),
        Path("/Applications/calibre.app/Contents/MacOS/ebook-convert"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _record_offsets(data: bytes) -> list[int]:
    if len(data) < 78 or data[60:68] != b"BOOKMOBI":
        return []
    count = int.from_bytes(data[76:78], "big")
    offsets: list[int] = []
    for index in range(count):
        at = 78 + index * 8
        if at + 4 > len(data):
            break
        offsets.append(int.from_bytes(data[at : at + 4], "big"))
    return offsets


def palm_encryption(data: bytes) -> int | None:
    """Return the strongest PalmDOC encryption field, or None when this is not MOBI."""
    offsets = _record_offsets(data)
    if not offsets:
        return None
    seen = False
    worst = 0
    for offset in offsets:
        if offset < 0 or offset + 16 > len(data):
            continue
        head = data[offset : offset + 24]
        if head.startswith(b"BOUNDARY"):
            continue
        if offset != offsets[0] and b"MOBI" not in data[offset : offset + 32]:
            continue
        seen = True
        worst = max(worst, int.from_bytes(data[offset + 12 : offset + 14], "big"))
    return worst if seen else None


def is_kfx(data: bytes) -> bool:
    if data.startswith(b"CR!") or data.startswith(b"SQLite format 3") or data.startswith(b"CONT"):
        return True
    return False


def _refuse_protected(data: bytes) -> None:
    if b"DRMION" in data[:4096]:
        raise UploadError(DRM_MESSAGE)
    if is_kfx(data):
        raise UploadError(KFX_MESSAGE)
    encryption = palm_encryption(data)
    if encryption is None:
        return
    if encryption != 0:
        raise UploadError(DRM_MESSAGE)


def _run_convert(converter: Path, source: Path, dest: Path) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [str(converter), str(source), str(dest)],
        check=False,
        capture_output=True,
        timeout=180,
    )


def prepare_book(path: Path, work_dir: Path, converter: Path | None = None, *, search: bool = True) -> PreparedBook:
    suffix = path.suffix.lower()
    if suffix not in KINDLE_SUFFIXES:
        return PreparedBook(path)
    data = path.read_bytes()
    _refuse_protected(data)
    tool = converter if converter is not None else (find_converter() if search else None)
    if tool is None:
        return PreparedBook(
            path,
            "未找到 Calibre 的 ebook-convert，将直接发送原始文件。手机可以打开无 DRM 的 AZW3；有 DRM 的文件不会被转换或打开。",
        )
    dest = work_dir / f"{path.stem}.epub"
    try:
        completed = _run_convert(tool, path, dest)
    except (OSError, subprocess.TimeoutExpired):
        return PreparedBook(path, "Calibre 转换没有完成，将直接发送原始文件。BookShelf 仍只打开无 DRM 的内容。")
    output = (completed.stderr or b"") + (completed.stdout or b"")
    text = output.decode("utf-8", "replace")
    if completed.returncode != 0 and ("drm" in text.lower() or "数字版权" in text):
        raise UploadError(DRM_MESSAGE)
    if completed.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
        return PreparedBook(path, "Calibre 转换失败，将直接发送原始文件。BookShelf 仍只打开无 DRM 的内容。")
    return PreparedBook(dest, f"已用 Calibre 把《{path.name}》转成 EPUB 再发送。")
