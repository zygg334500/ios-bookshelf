"""Browse `_bookshelf._tcp` on the local network.

Resolve service info after the browser callback returns. python-zeroconf can
deadlock or time out when `get_service_info` runs inside `add_service`, which
makes an otherwise visible iPhone look like zero devices.
"""

from __future__ import annotations

import socket
import time
from dataclasses import dataclass


SERVICE_TYPE = "_bookshelf._tcp.local."


@dataclass
class Device:
    name: str
    host: str
    port: int

    def label(self) -> str:
        return f"{self.name}   {self.host}:{self.port}"


def manual_hint(reason: str = "none") -> str:
    extra = ""
    if reason == "missing-zeroconf":
        extra = "还没有安装 zeroconf。请先运行 pip install -r requirements.txt。\n"
    elif reason == "socket":
        extra = "这台电脑没能打开 mDNS 套接字。请允许 Python 访问专用网络后重试。\n"
    return (
        f"{extra}"
        "没有搜到 BookShelf（结果为 0 台）。请让手机停在「Wi-Fi 传书」前台。\n"
        "本地网络：若之前拒绝了权限，打开 iPhone「设置 → 隐私与安全性 → 本地网络」，打开 BookShelf。\n"
        "同一网络：家里的 Wi-Fi，不要访客网络，两边都关掉 VPN。\n"
        "防火墙：允许 Python 在专用网络上收发 UDP 5353（mDNS），并允许它访问手机的 TCP 端口。\n"
        "仍搜不到就手工填写手机屏幕上的 IP、端口（默认 27780）和 4 位配对码。配对码不在 Bonjour 里。"
    )


def _ipv4_rank(host: str) -> int:
    if host.startswith("192.168.") or host.startswith("10."):
        return 0
    parts = host.split(".")
    if len(parts) == 4 and parts[0] == "172":
        try:
            second = int(parts[1])
        except ValueError:
            return 2
        if 16 <= second <= 31:
            return 0
    if host.startswith("127."):
        return 3
    return 1


def choose_host(addresses: list[str]) -> str | None:
    ipv4 = [
        item
        for item in addresses
        if item and ":" not in item and not item.startswith("169.254.")
    ]
    if ipv4:
        return sorted(ipv4, key=_ipv4_rank)[0]
    ipv6 = [
        item
        for item in addresses
        if ":" in item and not item.lower().startswith("fe80:")
    ]
    return ipv6[0] if ipv6 else None


def display_name(full_name: str, properties: object) -> str:
    raw = None
    if isinstance(properties, dict):
        raw = properties.get(b"name", properties.get("name"))
    text = ""
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", "replace").strip("\x00 ").strip()
    elif isinstance(raw, str):
        text = raw.strip()
    if text:
        return text
    return full_name.split(".")[0] or full_name


def _txt(properties: object, key: str) -> str:
    if not isinstance(properties, dict):
        return ""
    raw = properties.get(key.encode(), properties.get(key))
    if isinstance(raw, bytes):
        return raw.decode("utf-8", "replace").strip("\x00 ").strip()
    if isinstance(raw, str):
        return raw.strip()
    return ""


def is_bookshelf_service(full_name: str, properties: object) -> bool:
    """Ignore the short-lived probe iOS uses to ask for Local Network permission."""
    instance = full_name.split(".")[0]
    if instance.startswith("rnzeroconf-"):
        return False
    path = _txt(properties, "path")
    if path and path != "/v1/books":
        return False
    return True


def device_from_record(full_name: str, port: int, addresses: list[str], properties: object) -> Device | None:
    if not is_bookshelf_service(full_name, properties):
        return None
    host = choose_host(addresses)
    if not host or port <= 0:
        return None
    return Device(display_name(full_name, properties), host, int(port))


def _addresses_of(info: object) -> list[str]:
    addresses: list[str] = []
    parsed = getattr(info, "parsed_addresses", None)
    if callable(parsed):
        try:
            addresses.extend(str(item) for item in parsed())
        except Exception:
            addresses = []
    if addresses:
        return addresses
    for raw in getattr(info, "addresses", None) or []:
        try:
            addresses.append(socket.inet_ntoa(raw))
        except (OSError, TypeError):
            continue
    return addresses


def _resolve(zeroconf: object, names: dict[str, str]) -> list[Device]:
    found: list[Device] = []
    getter = getattr(zeroconf, "get_service_info")
    for name, service_type in names.items():
        try:
            info = getter(service_type, name, timeout=3000)
        except Exception:
            info = None
        if info is None:
            continue
        port = int(getattr(info, "port", 0) or 0)
        device = device_from_record(name, port, _addresses_of(info), getattr(info, "properties", None))
        if device:
            found.append(device)
    found.sort(key=lambda item: item.name)
    return found


def browse(timeout: float = 5.0) -> tuple[list[Device], str | None]:
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except ImportError:
        return [], manual_hint("missing-zeroconf")

    names: dict[str, str] = {}

    class Listener(ServiceListener):
        def add_service(self, _zeroconf: object, service_type: str, name: str) -> None:
            names[name] = service_type

        def update_service(self, _zeroconf: object, service_type: str, name: str) -> None:
            names[name] = service_type

        def remove_service(self, _zeroconf: object, _service_type: str, name: str) -> None:
            names.pop(name, None)

    try:
        zeroconf = Zeroconf()
    except OSError:
        return [], manual_hint("socket")

    browser = ServiceBrowser(zeroconf, SERVICE_TYPE, Listener())
    try:
        time.sleep(max(timeout, 0.2))
        devices = _resolve(zeroconf, dict(names))
        if not devices and names:
            time.sleep(1.0)
            devices = _resolve(zeroconf, dict(names))
    finally:
        browser.cancel()
        zeroconf.close()
    if not devices:
        return [], manual_hint()
    return devices, None
