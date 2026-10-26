from __future__ import annotations


def main() -> None:
    try:
        from bookpush.gui import main as gui_main
    except ImportError as error:
        raise SystemExit(
            "无法打开窗口。请安装带 Tcl/Tk 的 Python，然后在本目录执行：\n"
            "  py -3 -m pip install -r requirements.txt\n"
            "  py -3 -m bookpush\n"
            f"详细原因：{error}"
        ) from error
    gui_main()


if __name__ == "__main__":
    main()
