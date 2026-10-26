"""Official Calibre as a fallback pool. No DRM flags and no third-party plugins.

Calibre is GPL-3.0. Its conversion plugins import Calibre's private Python and
compiled extensions, so they cannot be vendored into BookPush or imported from
the system interpreter. When the in-process converter cannot build an EPUB,
BookPush calls the Calibre the user already installed:

1. A small pool of long-lived ``calibre-debug -e`` workers (startup once per
   worker, then many files). Each worker is pinned to one CPU.
2. If that worker cannot start, the same number of ``ebook-convert`` processes.

``CALIBRE_CONFIG_DIRECTORY`` points at an empty directory under the cache, so
plugins installed in the user's Calibre profile — including DeDRM — are not
loaded. Temp files stay in the cache directory (on Windows that is
``%LOCALAPPDATA%``, normally the system SSD).
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

from bookpush.affinity import pin_pid
from bookpush.kindle import CALIBRE_DRM_MESSAGE

WORKER_SCRIPT = Path(__file__).with_name("calibre_worker.py")


class CalibreWorkerError(Exception):
    pass


@dataclass
class CalibreJob:
    index: int
    source: Path
    dest: Path
    affinity: int


@dataclass
class CalibreResult:
    index: int
    ok: bool
    detail: str
    drm: bool = False


def find_calibre_debug(converter: Path) -> Path | None:
    name = "calibre-debug.exe" if converter.suffix.lower() == ".exe" or os.name == "nt" else "calibre-debug"
    candidate = converter.parent / name
    if candidate.is_file():
        return candidate
    if os.name == "nt":
        other = converter.parent / "calibre-debug.exe"
        if other.is_file():
            return other
    return None


def convert_with_calibre(
    converter: Path,
    jobs: list[CalibreJob],
    *,
    cache_dir: Path,
    workers: int,
    launcher: list[str] | None = None,
) -> list[CalibreResult]:
    """Convert jobs in parallel. ``launcher`` replaces ``calibre-debug -e`` in tests."""
    if not jobs:
        return []
    worker_count = max(1, min(workers, len(jobs)))
    command = launcher
    if command is None:
        debug = find_calibre_debug(converter)
        if debug is not None and WORKER_SCRIPT.is_file():
            command = [str(debug), "-e", str(WORKER_SCRIPT)]
    if command is not None:
        try:
            return _persistent_pool(command, jobs, cache_dir, worker_count)
        except CalibreWorkerError:
            if launcher is not None:
                raise
    return _ebook_convert_pool(converter, jobs, cache_dir, worker_count)


def _persistent_pool(
    command: list[str],
    jobs: list[CalibreJob],
    cache_dir: Path,
    workers: int,
) -> list[CalibreResult]:
    processes = []
    try:
        for index in range(workers):
            processes.append(_start_worker(command, cache_dir, index))
    except CalibreWorkerError:
        for proc in processes:
            _stop_process(proc)
        raise
    work: queue.Queue[CalibreJob | None] = queue.Queue()
    for job in jobs:
        work.put(job)
    for _ in processes:
        work.put(None)
    results: dict[int, CalibreResult] = {}
    crashed: list[CalibreJob] = []
    lock = threading.Lock()

    def loop(proc: subprocess.Popen[bytes]) -> None:
        while True:
            job = work.get()
            if job is None:
                return
            try:
                ok, detail, drm = _ask_worker(proc, job)
            except CalibreWorkerError as error:
                with lock:
                    crashed.append(job)
                    results[job.index] = CalibreResult(job.index, False, str(error), False)
                return
            with lock:
                results[job.index] = CalibreResult(
                    job.index,
                    ok,
                    detail if not ok else "",
                    drm,
                )

    threads = [threading.Thread(target=loop, args=(proc,), daemon=True) for proc in processes]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    for proc in processes:
        _stop_process(proc)
    if crashed:
        raise CalibreWorkerError("Calibre 常驻进程中途退出")
    return [results[job.index] for job in jobs if job.index in results]


def _start_worker(command: list[str], cache_dir: Path, index: int) -> subprocess.Popen[bytes]:
    proc = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_calibre_env(cache_dir),
        **_hidden_window(),
    )
    pin_pid(proc.pid, index)
    line = _readline(proc, 30)
    if proc.poll() is not None and not line:
        stderr = _drain_stderr(proc)
        raise CalibreWorkerError(stderr or "Calibre 常驻进程没有启动")
    try:
        ready = json.loads(line.decode("utf-8", "replace")) if line else {}
    except json.JSONDecodeError as error:
        _stop_process(proc)
        raise CalibreWorkerError("Calibre 常驻进程没有返回就绪") from error
    if not ready.get("ready"):
        _stop_process(proc)
        raise CalibreWorkerError(str(ready.get("error") or "Calibre 常驻进程拒绝启动"))
    return proc


def _ask_worker(proc: subprocess.Popen[bytes], job: CalibreJob) -> tuple[bool, str, bool]:
    if proc.stdin is None or proc.stdout is None or proc.poll() is not None:
        raise CalibreWorkerError("Calibre 常驻进程已退出")
    payload = json.dumps({"src": str(job.source), "dest": str(job.dest)}, ensure_ascii=False) + "\n"
    try:
        proc.stdin.write(payload.encode("utf-8"))
        proc.stdin.flush()
    except OSError as error:
        raise CalibreWorkerError(str(error)) from error
    line = _readline(proc, 180)
    if not line:
        raise CalibreWorkerError("Calibre 常驻进程没有返回结果")
    try:
        message = json.loads(line.decode("utf-8", "replace"))
    except json.JSONDecodeError as error:
        raise CalibreWorkerError("Calibre 返回的不是 JSON") from error
    if message.get("ok"):
        return True, "", False
    detail = str(message.get("error") or "Calibre 转换失败")
    drm = bool(message.get("drm")) or _text_mentions_drm(detail, job.source)
    return False, CALIBRE_DRM_MESSAGE if drm else _fail_text(detail), drm


def _readline(proc: subprocess.Popen[bytes], timeout: float) -> bytes:
    if proc.stdout is None:
        return b""
    holder: list[bytes] = []

    def read() -> None:
        holder.append(proc.stdout.readline() if proc.stdout is not None else b"")

    thread = threading.Thread(target=read, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        _stop_process(proc)
        raise CalibreWorkerError("Calibre 转换超时，这一本已跳过。")
    return holder[0] if holder else b""


def _ebook_convert_pool(
    converter: Path,
    jobs: list[CalibreJob],
    cache_dir: Path,
    workers: int,
) -> list[CalibreResult]:
    results: dict[int, CalibreResult] = {}

    def one(job: CalibreJob) -> None:
        results[job.index] = _run_ebook_convert(converter, job, cache_dir)

    threads = []
    pending = queue.Queue[CalibreJob]()
    for job in jobs:
        pending.put(job)

    def loop() -> None:
        while True:
            try:
                job = pending.get_nowait()
            except queue.Empty:
                return
            one(job)

    for _ in range(workers):
        thread = threading.Thread(target=loop, daemon=True)
        threads.append(thread)
        thread.start()
    for thread in threads:
        thread.join()
    return [results[job.index] for job in jobs]


def _run_ebook_convert(converter: Path, job: CalibreJob, cache_dir: Path) -> CalibreResult:
    # Input and output only. No extra flags, so nothing here can request DRM removal.
    proc = subprocess.Popen(
        [str(converter), str(job.source), str(job.dest)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_calibre_env(cache_dir),
        **_hidden_window(),
    )
    pin_pid(proc.pid, job.affinity)
    try:
        stdout, stderr = proc.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return CalibreResult(job.index, False, "Calibre 转换超时，这一本已跳过。")
    text = (stderr or b"").decode("utf-8", "replace") + (stdout or b"").decode("utf-8", "replace")
    if proc.returncode != 0 and _text_mentions_drm(text, job.source):
        return CalibreResult(job.index, False, CALIBRE_DRM_MESSAGE, True)
    dest_ok = job.dest.is_file() and job.dest.stat().st_size > 0
    if proc.returncode != 0 or not dest_ok:
        return CalibreResult(job.index, False, _fail_text(text))
    return CalibreResult(job.index, True, "")


def _calibre_env(cache_dir: Path) -> dict[str, str]:
    config = cache_dir / "calibre-clean-config"
    temp = cache_dir / "calibre-temp"
    config.mkdir(parents=True, exist_ok=True)
    temp.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["CALIBRE_CONFIG_DIRECTORY"] = str(config)
    env["CALIBRE_TEMP_DIR"] = str(temp)
    return env


def _hidden_window() -> dict:
    if os.name != "nt":
        return {}
    flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return {"creationflags": flag} if flag else {}


def _text_mentions_drm(text: str, source: Path | None = None) -> bool:
    """DRM is decided from Calibre's message, not from a filename that happens to contain those letters."""
    lowered = text.lower()
    if source is not None:
        lowered = lowered.replace(str(source).lower(), "").replace(source.name.lower(), "")
    return "drm" in lowered or "数字版权" in text


def _fail_text(text: str) -> str:
    snippet = " ".join(text.split())[:180]
    if snippet:
        return f"Calibre 转换失败，这一本已跳过。{snippet}"
    return "Calibre 转换失败，这一本已跳过。BookPush 不会尝试解除保护。"


def _stop_process(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is None:
        try:
            if proc.stdin:
                proc.stdin.write(b'{"stop": true}\n')
                proc.stdin.flush()
        except OSError:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
    for stream in (proc.stdin, proc.stdout, proc.stderr):
        if stream is None:
            continue
        try:
            stream.close()
        except OSError:
            pass


def _drain_stderr(proc: subprocess.Popen[bytes]) -> str:
    if proc.stderr is None:
        return ""
    try:
        return proc.stderr.read().decode("utf-8", "replace")[:300]
    except OSError:
        return ""
