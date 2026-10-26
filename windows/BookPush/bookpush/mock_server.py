"""Tiny BookShelf receiver used to test BookPush without a phone."""

from __future__ import annotations

import argparse
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


def parse_file(body: bytes, content_type: str) -> tuple[str, bytes, dict[str, str]]:
    match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type, re.I)
    if not match:
        raise ValueError("不是 multipart")
    boundary = (match.group(1) or match.group(2)).strip().encode()
    marker = b"--" + boundary
    fields: dict[str, str] = {}
    filename = "book.bin"
    data = b""
    found = False
    cursor = 0
    while cursor < len(body):
        start = body.find(marker, cursor)
        if start < 0:
            break
        part_start = start + len(marker)
        if body[part_start : part_start + 2] == b"--":
            break
        if body[part_start : part_start + 2] == b"\r\n":
            part_start += 2
        nxt = body.find(marker, part_start)
        raw = body[part_start : nxt if nxt >= 0 else len(body)]
        header_end = raw.find(b"\r\n\r\n")
        if header_end < 0:
            cursor = nxt if nxt >= 0 else len(body)
            continue
        header = raw[:header_end].decode("utf-8", "replace")
        content = raw[header_end + 4 :]
        if content.endswith(b"\r\n"):
            content = content[:-2]
        disposition = ""
        for line in header.split("\r\n"):
            if line.lower().startswith("content-disposition"):
                disposition = line
        name = ""
        name_match = re.search(r'name="([^"]*)"', disposition)
        if name_match:
            name = name_match.group(1)
        star = re.search(r"filename\*=UTF-8''([^;\r\n]+)", disposition, re.I)
        plain = re.search(r'filename="([^"]*)"', disposition)
        part_name = unquote(star.group(1)) if star else (plain.group(1) if plain else "")
        if part_name and (name == "file" or not found):
            filename = part_name
            data = content
            found = True
        elif name:
            fields[name] = content.decode("utf-8", "replace")
        cursor = nxt if nxt >= 0 else len(body)
    if not found:
        raise ValueError("没有文件")
    return filename, data, fields


class Receiver(BaseHTTPRequestHandler):
    directory: Path
    pin: str
    name: str

    def log_message(self, fmt: str, *args) -> None:
        return

    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] in {"/health", "/v1/health"}:
            self._json(200, {"ok": True, "name": self.name, "version": 1, "pinRequired": True, "protocol": "bookshelf-1"})
            return
        self._json(404, {"ok": False, "error": "没有这个地址。"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/v1/books":
            self._json(404, {"ok": False, "error": "没有这个地址。"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(length)
        try:
            filename, data, fields = parse_file(body, self.headers.get("Content-Type") or "")
        except ValueError as error:
            self._json(400, {"ok": False, "error": str(error)})
            return
        pin = (self.headers.get("X-Bookshelf-Pin") or fields.get("pin") or "").strip()
        if pin != self.pin:
            self._json(401, {"ok": False, "error": "配对码不正确。"})
            return
        target = self.directory / Path(filename).name
        target.write_bytes(data)
        self._json(201, {"ok": True, "id": "mock", "title": target.stem, "bytes": len(data), "format": target.suffix.lstrip(".")})


def serve(host: str, port: int, directory: Path, pin: str, name: str = "模拟书房") -> ThreadingHTTPServer:
    directory.mkdir(parents=True, exist_ok=True)
    handler = type(
        "BoundReceiver",
        (Receiver,),
        {"directory": directory, "pin": pin, "name": name},
    )
    server = ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="模拟 iPhone 上的 BookShelf 收书服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=27780)
    parser.add_argument("--pin", default="2468")
    parser.add_argument("--dir", default="received")
    args = parser.parse_args()
    directory = Path(args.dir).resolve()
    server = serve(args.host, args.port, directory, args.pin)
    print(f"模拟收书服务 http://{args.host}:{args.port}  配对码 {args.pin}  保存到 {directory}")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
