"""Pin a worker to one CPU. Any failure is ignored so conversion still runs."""

from __future__ import annotations

import os


def pin_current_process(index: int) -> None:
    pin_pid(os.getpid(), index)


def pin_pid(pid: int, index: int) -> None:
    cpus = os.cpu_count() or 1
    cpu = index % min(cpus, 64)
    try:
        if os.name == "nt":
            _pin_windows(pid, cpu)
        elif hasattr(os, "sched_setaffinity"):
            os.sched_setaffinity(pid, {cpu})
    except (OSError, AttributeError, ValueError):
        return


def _pin_windows(pid: int, cpu: int) -> None:
    import ctypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    process_set_information = 0x0200
    handle = kernel.OpenProcess(process_set_information, False, int(pid))
    if not handle:
        return
    try:
        kernel.SetProcessAffinityMask(handle, ctypes.c_size_t(1 << cpu))
    finally:
        kernel.CloseHandle(handle)
