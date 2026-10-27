"""Send unprotected Kindle files. Never removes DRM.

The fast path is BookPush's own AZW3→EPUB converter. Official Calibre is only
the fallback, and only for files that are not encrypted. Calibre's conversion
code is GPL-3.0 and runs inside Calibre's own Python, so it is not vendored.
"""

from __future__ import annotations

import json
import os
import shutil
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

CALIBRE_MISSING = (
    "未找到官方 Calibre，这一本无法转成 EPUB，已跳过。"
    "请从官网安装 Calibre：https://calibre-ebook.com/ 。"
    "Windows 上的默认路径是 C:\\Program Files\\Calibre2\\ebook-convert.exe。"
    "BookPush 只使用官方的 ebook-convert，不会安装或调用 DeDRM、Kindle 密钥或其他解除保护的工具。"
)

CALIBRE_DRM_MESSAGE = (
    "Calibre 无法转换此文件，因为它受数字版权保护（DRM）。"
    "这一本已跳过，不会尝试解除保护，其余文件继续。"
    "请改用你有权阅读的 EPUB、PDF，或出版社提供的无 DRM 文件。"
)

WINDOWS_CALIBRE2 = Path(r"C:\Program Files\Calibre2\ebook-convert.exe")


@dataclass
class PreparedBook:
    path: Path
    note: str | None = None


def default_cache_dir() -> Path:
    """Cache lives under the user profile, which on Windows is normally the system SSD."""
    configured = os.environ.get("BOOKSHELF_CONVERT_CACHE", "").strip()
    if configured:
        return Path(configured)
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "").strip()
        if local:
            return Path(local) / "BookPush" / "epub-cache"
    return Path.home() / ".cache" / "bookpush" / "epub-cache"


def settings_path() -> Path:
    return default_cache_dir().parent / "settings.json"


def load_converter_pref() -> str:
    try:
        data = json.loads(settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    value = str(data.get("ebook_convert") or "").strip()
    if value and Path(value).is_file():
        return value
    return ""


def save_converter_pref(value: str) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ebook_convert": value.strip()}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def converter_search_order(system: str | None = None) -> list[Path]:
    """Windows looks at ``C:\\Program Files\\Calibre2\\ebook-convert.exe`` before PATH.

    ``BOOKSHELF_EBOOK_CONVERT`` still wins when it is set, so the path stays configurable.
    """
    system = system or os.name
    ordered: list[Path] = []
    env = os.environ.get("BOOKSHELF_EBOOK_CONVERT", "").strip()
    if env:
        ordered.append(Path(env))
    windows = [
        WINDOWS_CALIBRE2,
        Path(r"C:\Program Files\Calibre\ebook-convert.exe"),
        Path(r"C:\Program Files (x86)\Calibre2\ebook-convert.exe"),
        Path.home() / "AppData/Local/Programs/Calibre/ebook-convert.exe",
        Path.home() / "AppData/Local/calibre-ebook/ebook-convert.exe",
    ]
    posix = [
        Path("/usr/bin/ebook-convert"),
        Path("/usr/local/bin/ebook-convert"),
        Path("/Applications/calibre.app/Contents/MacOS/ebook-convert"),
    ]
    which = shutil.which("ebook-convert")
    which_path = Path(which) if which else None
    if system == "nt":
        ordered.extend(windows)
        if which_path is not None:
            ordered.append(which_path)
        ordered.extend(posix)
    else:
        if which_path is not None:
            ordered.append(which_path)
        ordered.extend(posix)
        ordered.extend(windows)
    seen: set[str] = set()
    unique: list[Path] = []
    for item in ordered:
        key = str(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def find_converter() -> Path | None:
    for candidate in converter_search_order():
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
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


# Windows cloud-file codes. A PalmDB whose name begins with CR! is still AZW3
# when BOOKMOBI sits at offset 60; those codes are only for online-only reads.
_CLOUD_WINERRORS = frozenset(range(358, 369)) | frozenset(range(377, 399))

CLOUD_PLACEHOLDER_MESSAGE = (
    "这个文件还在 OneDrive 云端，电脑上只有占位符，读不到正文。"
    "请在资源管理器里右键该文件，选择「始终保留在此设备上」，等下载完成后再传。"
    "原文件继续留在云端，BookPush 不会改它。"
)


def is_kfx(data: bytes) -> bool:
    """KFX containers start with CR!, CONT, or SQLite. Amazon AZW3 often uses a CR! PalmDB name and is not KFX."""
    if len(data) >= 68 and data[60:68] == b"BOOKMOBI":
        return False
    if data.startswith(b"CR!") or data.startswith(b"SQLite format 3") or data.startswith(b"CONT"):
        return True
    return False


def explain_read_error(error: OSError) -> str:
    """Chinese hint when Windows only has an online OneDrive placeholder."""
    winerror = getattr(error, "winerror", None)
    text = str(error).lower()
    if winerror in _CLOUD_WINERRORS or any(
        token in text for token in ("cloud file", "cloud operation", "onedrive", "placeholder")
    ):
        return CLOUD_PLACEHOLDER_MESSAGE
    return f"读不到文件：{error}"


def refuse_protected(data: bytes) -> None:
    if b"DRMION" in data[:4096]:
        raise UploadError(DRM_MESSAGE)
    if is_kfx(data):
        raise UploadError(KFX_MESSAGE)
    encryption = palm_encryption(data)
    if encryption is None:
        return
    if encryption != 0:
        raise UploadError(DRM_MESSAGE)


def prepare_book(
    path: Path,
    work_dir: Path,
    converter: Path | None = None,
    *,
    search: bool = True,
    cache_dir: Path | None = None,
) -> PreparedBook:
    from bookpush.batch import convert_batch

    items = convert_batch(
        [path],
        cache_dir=cache_dir or (work_dir / ".epub-cache"),
        work_dir=work_dir,
        converter=converter,
        search=search,
        workers=1,
        legacy_names=True,
    )
    item = items[0]
    if not item.ok or item.output is None:
        raise UploadError(item.detail or CALIBRE_MISSING)
    return PreparedBook(item.output, item.note)
