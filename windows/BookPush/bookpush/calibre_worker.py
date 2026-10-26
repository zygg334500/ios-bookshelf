"""Long-lived AZW3→EPUB worker executed by the installed Calibre.

Launch (official Calibre only)::

    calibre-debug -e calibre_worker.py

This file is BookPush code. It does not copy Calibre, and it never passes a
DRM, DeDRM, or Kindle-key option. Calibre's own Python loads its built-in
conversion plugins. A private ``CALIBRE_CONFIG_DIRECTORY`` is set by the parent
so third-party plugins in the user's profile are not loaded.

Protocol: one JSON object per line on stdin, one JSON object per line on stdout.
The first stdout line is ``{"ready": true}``. Each job is ``{"src", "dest"}``.
"""

from __future__ import annotations

import json
import os
import sys


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _looks_like_drm(text: str) -> bool:
    lowered = text.lower()
    return "drm" in lowered or "数字版权" in text


def main() -> None:
    try:
        from calibre.ebooks.conversion.plumber import Plumber
        from calibre.utils.logging import Log
    except Exception as error:
        _emit({"ready": False, "error": str(error)})
        return
    _emit({"ready": True})
    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        try:
            job = json.loads(text)
        except json.JSONDecodeError as error:
            _emit({"ok": False, "error": str(error), "drm": False})
            continue
        if job.get("stop"):
            break
        src = str(job.get("src") or "")
        dest = str(job.get("dest") or "")
        held = sys.stdout
        try:
            # Plumber logs to stdout. Keep the job protocol on the real stdout.
            sys.stdout = sys.stderr
            plumber = Plumber(src, dest, Log())
            plumber.run()
            sys.stdout = held
            if not os.path.isfile(dest) or os.path.getsize(dest) <= 0:
                raise RuntimeError("Calibre 没有写出 EPUB")
        except Exception as error:
            sys.stdout = held
            message = str(error)
            _emit({"ok": False, "error": message, "drm": _looks_like_drm(message)})
            continue
        _emit({"ok": True})


if __name__ == "__main__":
    main()
