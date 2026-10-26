"""Chinese desktop window for pushing books to an iPhone on the LAN."""

from __future__ import annotations

import tempfile
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from bookpush.discovery import Device, browse
from bookpush.kindle import prepare_book
from bookpush.uploader import UploadError, upload_book


class BookPushApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("BookPush 传书")
        self.root.geometry("920x640")
        self.root.minsize(760, 560)
        self.root.configure(bg="#E6DDD0")
        self.devices: list[Device] = []
        self.files: list[Path] = []
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
            text="把 PDF、EPUB 或无 DRM 的 AZW3 送到同一 Wi-Fi 下的 iPhone。不经过互联网。",
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
        self.file_list = tk.Listbox(right, height=10, font=("Microsoft YaHei UI", 10))
        self.file_list.pack(fill="both", expand=True, pady=6)
        row = ttk.Frame(right, style="Card.TFrame")
        row.pack(fill="x")
        ttk.Button(row, text="选择文件", command=self.pick_files).pack(side="left")
        ttk.Button(row, text="移除", command=self.remove_selected).pack(side="left", padx=8)
        ttk.Button(row, text="开始传书", command=self.send).pack(side="right")
        self.progress = ttk.Progressbar(right, mode="determinate", maximum=100)
        self.progress.pack(fill="x", pady=(12, 6))
        self.status = ttk.Label(right, text="还没有开始。", style="Card.TLabel")
        self.status.pack(anchor="w")
        self.log = tk.Text(right, height=8, wrap="word", font=("Microsoft YaHei UI", 9), bg="#FBF7F0")
        self.log.pack(fill="both", expand=True, pady=(8, 0))
        self._write("传书时请让手机停在「Wi-Fi 传书」，并允许本地网络。搜不到就填手机上的 IP、端口和配对码。")
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

    def pick_files(self) -> None:
        names = filedialog.askopenfilenames(
            title="选择书籍",
            filetypes=[
                ("书籍", "*.pdf *.epub *.azw3 *.azw *.mobi *.kf8 *.prc"),
                ("全部文件", "*.*"),
            ],
        )
        for name in names:
            path = Path(name)
            if path not in self.files:
                self.files.append(path)
                self.file_list.insert("end", path.name)

    def remove_selected(self) -> None:
        selection = list(self.file_list.curselection())
        for index in reversed(selection):
            self.file_list.delete(index)
            del self.files[index]

    def send(self) -> None:
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
        if not self.files:
            self.status.configure(text="请先选择至少一本书。")
            return
        files = list(self.files)
        self.progress.configure(value=0)
        self.status.configure(text="正在发送…")

        def work() -> None:
            total = len(files)
            with tempfile.TemporaryDirectory() as temp:
                work_dir = Path(temp)
                for index, path in enumerate(files):
                    def on_progress(sent: int, size: int, index: int = index) -> None:
                        overall = ((index + sent / max(size, 1)) / total) * 100
                        self.root.after(0, lambda value=overall: self.progress.configure(value=value))

                    try:
                        prepared = prepare_book(path, work_dir)
                    except UploadError as error:
                        self.root.after(0, lambda message=str(error), name=path.name: self._fail(name, message))
                        return
                    if prepared.note:
                        self.root.after(0, lambda note=prepared.note: self._write(note))
                    try:
                        result = upload_book(host, port, prepared.path, pin, on_progress=on_progress)
                    except UploadError as error:
                        self.root.after(0, lambda message=str(error), name=path.name: self._fail(name, message))
                        return
                    title = result.get("title") or path.stem
                    self.root.after(0, lambda title=title: self._write(f"已送到手机：《{title}》"))
            self.root.after(0, lambda: self.status.configure(text="全部发送完成。"))
            self.root.after(0, lambda: self.progress.configure(value=100))

        threading.Thread(target=work, daemon=True).start()

    def _fail(self, name: str, message: str) -> None:
        self.status.configure(text="发送中断。")
        self._write(f"{name} 失败：{message}")


def main() -> None:
    root = tk.Tk()
    BookPushApp(root)
    root.mainloop()
