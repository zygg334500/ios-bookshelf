"""Browse `_bookshelf._tcp` on the local network."""

from __future__ import annotations

import socket
from dataclasses import dataclass


@dataclass
class Device:
    name: str
    host: str
    port: int

    def label(self) -> str:
        return f"{self.name}   {self.host}:{self.port}"


def browse(timeout: float = 2.5) -> tuple[list[Device], str | None]:
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except ImportError:
        return [], "还没有安装 zeroconf。请先运行 pip install -r requirements.txt。"

    found: dict[str, Device] = {}

    class Listener(ServiceListener):
        def add_service(self, zeroconf: Zeroconf, service_type: str, name: str) -> None:
            self._remember(zeroconf, service_type, name)

        def update_service(self, zeroconf: Zeroconf, service_type: str, name: str) -> None:
            self._remember(zeroconf, service_type, name)

        def remove_service(self, zeroconf: Zeroconf, service_type: str, name: str) -> None:
            found.pop(name, None)

        def _remember(self, zeroconf: Zeroconf, service_type: str, name: str) -> None:
            info = zeroconf.get_service_info(service_type, name, timeout=1500)
            if info is None or not info.port:
                return
            addresses = []
            if hasattr(info, "parsed_addresses"):
                addresses = [item for item in info.parsed_addresses() if ":" not in item]
            if not addresses:
                for raw in info.addresses or []:
                    try:
                        addresses.append(socket.inet_ntoa(raw))
                    except OSError:
                        continue
            if not addresses:
                return
            service_name = name.split(".")[0]
            found[name] = Device(service_name, addresses[0], int(info.port))

    zeroconf = Zeroconf()
    browser = ServiceBrowser(zeroconf, "_bookshelf._tcp.local.", Listener())
    try:
        import time

        time.sleep(timeout)
    finally:
        browser.cancel()
        zeroconf.close()
    devices = sorted(found.values(), key=lambda item: item.name)
    if not devices:
        return [], "没有搜到 BookShelf。手机需要停在前台并允许本地网络。你仍可以手工填写 IP 和端口。"
    return devices, None
