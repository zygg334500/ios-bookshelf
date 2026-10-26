"""Chinese desktop window for pushing books to an iPhone on the LAN."""

from __future__ import annotations

import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from bookpush.discovery import Device, browse
from bookpush.kindle import (
    CALIBRE_MISSING,
    find_converter,
    load_converter_pref,
    save_converter_pref,
)
from bookpush.queue import PushQueue, TransferProgress, describe_batch, push_batch


class BookPushApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("BookPush 传书")
        self.root.geometry("960x760")
        self.root.minsize(800, 640)
        self.root.configure(bg="#E6DDD0")
        self.devices: list[Device] = []
        self.queue = PushQueue()
        self._sending = False
        self._build()

    def _build(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background="#E6DDD0")
        style.configure("Card.TFrame", background="#F7F1E7")
        style.configure("TLabel", background="#E6DDD0", foreground="#1E1A16", font=("Microsoft YaHei UI", 10))
        style.configure("Card.TLabel", background="#F7F1E7", foreground="#1E1A16", font=("Microsoft YaHei UI", 10))
        style.configure("Title.TLabel", background="#E6DDD0", font=("Georgia", 26))
        style.configure("Hint.TLabel", background="#F7F1E7", foreground="#6F6256", font=("Microsoft YaHei UI", 9))
        style.configure("TButton", font=("Microsoft YaHei UI", 10))

        outer = ttk.Frame(self.root, padding=18)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="BookPush 传书", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            outer,
            text="把 PDF、EPUB 送到同一 Wi-Fi 下的 iPhone。无 DRM 的 AZW3 / AZW 会先转成 EPUB。不经过互联网，也不解除保护。",
        ).pack(anchor="w", pady=(0, 12))

        body = ttk.Frame(outer)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        left = ttk.Frame(body, style="Card.TFrame", padding=12)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        ttk.Label(left, text="手机", style="Card.TLabel").pack(anchor="w")
        self.device_list = tk.Listbox(left, height=8, activestyle="dotbox", font=("Microsoft YaHei UI", 10))
        self.device_list.pack(fill="both", expand=True, pady=6)
        self.device_list.bind("<<ListboxSelect>>", self._use_selected)
        ttk.Button(left, text="重新搜索", command=self.search).pack(anchor="w")
        self.search_note = ttk.Label(
            left,
            text="正在搜索 _bookshelf._tcp。结果为 0 时，用下面的手工填写。",
            style="Hint.TLabel",
            wraplength=340,
            justify="left",
        )
        self.search_note.pack(anchor="w", pady=(6, 8))

        ttk.Label(left, text="手工填写（搜索为 0 时）", style="Card.TLabel").pack(anchor="w")
        form = ttk.Frame(left, style="Card.TFrame")
        form.pack(fill="x")
        self.host = tk.StringVar()
        self.port = tk.StringVar(value="27780")
        self.pin = tk.StringVar()
        self._field(form, "IP 地址", self.host)
        self._field(form, "端口", self.port)
        self._field(form, "配对码", self.pin)

        right = ttk.Frame(body, style="Card.TFrame", padding=12)
        right.grid(row=0, column=1, sticky="nsew")
        ttk.Label(right, text="要送出的书", style="Card.TLabel").pack(anchor="w")
        self.queue_note = ttk.Label(right, text=self.queue.summary(), style="Hint.TLabel", wraplength=340, justify="left")
        self.queue_note.pack(anchor="w", pady=(4, 0))
        self.file_list = tk.Listbox(right, height=10, font=("Microsoft YaHei UI", 10))
        self.file_list.pack(fill="both", expand=True, pady=6)
        row = ttk.Frame(right, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Button(row, text="加入书籍", command=self.pick_files).pack(side="left")
        ttk.Button(row, text="移出", command=self.remove_selected).pack(side="left", padx=8)
        ttk.Button(row, text="清空", command=self.clear_queue).pack(side="left")
        ttk.Button(row, text="开始传书", command=self.send).pack(side="right")
        detected = load_converter_pref() or find_converter()
        self.converter = tk.StringVar(value=str(detected) if detected else "")
        ttk.Label(right, text="ebook-convert（Windows 默认先找 Calibre2）", style="Card.TLabel").pack(anchor="w", pady=(10, 0))
        ttk.Entry(right, textvariable=self.converter).pack(fill="x")
        self.convert_progress = ttk.Progressbar(right, mode="determinate", maximum=100)
        self.convert_progress.pack(fill="x", pady=(12, 4))
        self.convert_status = ttk.Label(right, text="转换：还没有开始。", style="Card.TLabel", wraplength=340, justify="left")
        self.convert_status.pack(anchor="w")
        self.progress = ttk.Progressbar(right, mode="determinate", maximum=100)
        self.progress.pack(fill="x", pady=(8, 4))
        self.status = ttk.Label(right, text="发送：还没有开始。", style="Card.TLabel", wraplength=340, justify="left")
        self.status.pack(anchor="w")
        self.log = tk.Text(right, height=8, wrap="word", font=("Microsoft YaHei UI", 9), bg="#FBF7F0")
        self.log.pack(fill="both", expand=True, pady=(8, 0))
        self._write("传书时请让手机停在「Wi-Fi 传书」，并允许本地网络。搜不到就填手机上的 IP、端口和配对码。")
        self._write(self._converter_hint())
        self._pending_progress: TransferProgress | None = None
        self._progress_job: str | None = None
        self.search()

    def _field(self, parent: ttk.Frame, label: str, variable: tk.StringVar) -> None:
        ttk.Label(parent, text=label, style="Card.TLabel").pack(anchor="w", pady=(6, 0))
        entry = ttk.Entry(parent, textvariable=variable)
        entry.pack(fill="x")

    def _write(self, text: str) -> None:
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def _use_selected(self, _event: object = None) -> None:
        selection = self.device_list.curselection()
        if not selection:
            return
        device = self.devices[selection[0]]
        self.host.set(device.host)
        self.port.set(str(device.port))

    def search(self) -> None:
        self.search_note.configure(text="正在搜索局域网…")

        def work() -> None:
            devices, note = browse()
            self.root.after(0, lambda: self._show_devices(devices, note))

        threading.Thread(target=work, daemon=True).start()

    def _show_devices(self, devices: list[Device], note: str | None) -> None:
        self.devices = devices
        self.device_list.delete(0, "end")
        for device in devices:
            self.device_list.insert("end", device.label())
        self.search_note.configure(text=note or f"找到 {len(devices)} 台设备。")
        if devices:
            self.device_list.selection_set(0)
            self._use_selected()

    def _refresh_queue(self) -> None:
        self.file_list.delete(0, "end")
        for label in self.queue.labels():
            self.file_list.insert("end", label)
        self.queue_note.configure(text=self.queue.summary())

    def pick_files(self) -> None:
        names = filedialog.askopenfilenames(
            title="加入书籍",
            filetypes=[
                ("书籍", "*.pdf *.epub *.azw3 *.azw *.mobi *.kf8 *.prc"),
                ("全部文件", "*.*"),
            ],
        )
        added = self.queue.add([Path(name) for name in names])
        self._refresh_queue()
        if added:
            self._write(f"加入 {len(added)} 本：" + "、".join(added))
        elif names:
            self._write("这些书已经在队列里。")

    def remove_selected(self) -> None:
        selection = [int(index) for index in self.file_list.curselection()]
        if not selection:
            self.status.configure(text="请先点中要移出的书。")
            return
        removed = self.queue.remove_at(selection)
        self._refresh_queue()
        self._write("移出队列：" + "、".join(removed))

    def clear_queue(self) -> None:
        count = self.queue.clear()
        self._refresh_queue()
        self._write(f"清空了 {count} 本。手机上已经收下的书不会被删掉。")

    def _converter_hint(self) -> str:
        path = self.converter.get().strip()
        if path:
            return (
                f"已检测到官方 Calibre：{path}。无 DRM 的 AZW3 先在本机转成 EPUB；"
                "本机转不了时再用这个 ebook-convert。不会使用 DeDRM。"
            )
        return (
            "还没有检测到 Calibre。能解析的无 DRM AZW3 仍会在本机直接转成 EPUB。"
            + CALIBRE_MISSING
        )

    def _show_progress(self, event: TransferProgress) -> None:
        self._pending_progress = event
        if self._progress_job is None:
            self._progress_job = self.root.after(40, self._flush_progress)

    def _flush_progress(self) -> None:
        self._progress_job = None
        event = self._pending_progress
        if event is None:
            return
        total = max(event.total, 1)
        value = 100 * event.current / total
        if event.phase == "convert":
            label = f"正在转换 {event.current}/{event.total}"
            if event.name:
                label += f"：{event.name}"
            self.convert_status.configure(text=label)
            self.convert_progress.configure(value=value)
            return
        label = f"正在发送 {event.current}/{event.total}"
        if event.name:
            label += f"：{event.name}"
        if event.detail:
            label += f"（{event.detail}）"
        self.status.configure(text=label)
        self.progress.configure(value=value)

    def send(self) -> None:
        if self._sending:
            self.status.configure(text="这一批还在发送，请稍等。")
            return
        host = self.host.get().strip()
        pin = self.pin.get().strip()
        try:
            port = int(self.port.get().strip())
        except ValueError:
            self.status.configure(text="端口必须是数字。")
            return
        if not host or not pin:
            self.status.configure(text="请填写 IP 和手机上的配对码。")
            return
        files = list(self.queue.files)
        if not files:
            self.status.configure(text="请先加入至少一本书。")
            return
        configured = self.converter.get().strip()
        save_converter_pref(configured)
        tool = Path(configured) if configured else None
        if tool is not None and not tool.is_file():
            self.status.configure(text="填写的 ebook-convert 不存在。需要 Calibre 的那一本会被跳过。")
            self._write(f"找不到填写的转换程序：{configured}")
            self._write(CALIBRE_MISSING)
            tool = None
            search = False
            missing = f"找不到填写的转换程序：{configured}。{CALIBRE_MISSING}"
        else:
            search = tool is None
            missing = None
        self._sending = True
        self.convert_progress.configure(value=0)
        self.progress.configure(value=0)
        self.convert_status.configure(text="正在准备转换…")
        self.status.configure(text="发送：等待可以上传的书。")

        def work() -> None:
            outcomes = push_batch(
                files,
                host,
                port,
                pin,
                on_progress=lambda event: self.root.after(0, lambda event=event: self._show_progress(event)),
                converter=tool,
                search=search,
                missing_message=missing,
            )

            def finish() -> None:
                self._sending = False
                for item in outcomes:
                    if item.detail and item.ok:
                        self._write(item.detail)
                    if item.ok:
                        self._write(f"已送到手机：《{item.title or item.name}》")
                    else:
                        self._write(f"{item.name} 失败：{item.detail}")
                summary = describe_batch(outcomes)
                self.status.configure(text=summary)
                self.convert_status.configure(text="转换这一批已经结束。")
                self._write(summary)
                sent = len([item for item in outcomes if item.ok])
                self.progress.configure(value=100 if outcomes and sent == len(outcomes) else (100 * sent / max(len(outcomes), 1)))
                if outcomes:
                    self.convert_progress.configure(value=100)

            self.root.after(0, finish)

        threading.Thread(target=work, daemon=True).start()


def main() -> None:
    root = tk.Tk()
    BookPushApp(root)
    root.mainloop()
