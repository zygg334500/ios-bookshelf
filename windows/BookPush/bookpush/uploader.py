"""HTTP client for the BookShelf receive protocol."""

from __future__ import annotations

import http.client
import json
from pathlib import Path
from typing import Callable
from urllib.parse import quote

Progress = Callable[[int, int], None]


class UploadError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def build_body(file_path: Path, pin: str, boundary: str = "----BookShelfBoundary7f3a9c") -> bytes:
    data = file_path.read_bytes()
    filename = file_path.name
    ascii_name = filename.encode("ascii", "ignore").decode() or "book.bin"
    starred = quote(filename)
    prefix = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="pin"\r\n\r\n'
        f"{pin}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{ascii_name}"; filename*=UTF-8\'\'{starred}\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
    return prefix + data + suffix


def fetch_health(host: str, port: int, timeout: float = 5) -> dict:
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request("GET", "/health")
        response = connection.getresponse()
        payload = response.read()
    except OSError as error:
        raise UploadError(explain_network(error)) from error
    finally:
        connection.close()
    if response.status != 200:
        raise UploadError(f"手机返回了 HTTP {response.status}", response.status)
    try:
        body = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise UploadError("手机返回的不是 BookShelf 的状态。") from error
    if not isinstance(body, dict) or not body.get("ok"):
        raise UploadError("这台地址没有在运行 BookShelf 收书服务。")
    return body


def upload_book(
    host: str,
    port: int,
    file_path: Path,
    pin: str,
    on_progress: Progress | None = None,
    timeout: float = 180,
) -> dict:
    boundary = "----BookShelfBoundary7f3a9c"
    body = build_body(file_path, pin, boundary)
    connection = http.client.HTTPConnection(host, int(port), timeout=timeout)
    try:
        connection.putrequest("POST", "/v1/books")
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(len(body)))
        connection.putheader("X-Bookshelf-Pin", pin.strip())
        connection.putheader("Connection", "close")
        connection.endheaders()
        sent = 0
        step = 64 * 1024
        while sent < len(body):
            chunk = body[sent : sent + step]
            connection.send(chunk)
            sent += len(chunk)
            if on_progress:
                on_progress(sent, len(body))
        response = connection.getresponse()
        payload = response.read()
    except OSError as error:
        raise UploadError(explain_network(error)) from error
    finally:
        connection.close()
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError:
        parsed = {"ok": False, "error": payload.decode("utf-8", "replace")[:240] or "空响应"}
    if response.status >= 400 or not parsed.get("ok"):
        message = str(parsed.get("error") or f"上传失败（HTTP {response.status}）")
        raise UploadError(message, response.status)
    return parsed


def explain_network(error: OSError) -> str:
    text = str(error)
    return (
        "连不上手机。请确认 iPhone 上的 BookShelf 停在前台、配对码一致，"
        "并且两台设备在同一个 Wi-Fi。若 Windows 防火墙弹出询问，请允许 Python 访问专用网络。"
        f"（{text}）"
    )
