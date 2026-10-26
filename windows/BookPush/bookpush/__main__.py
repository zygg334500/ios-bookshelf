from __future__ import annotations


def main() -> None:
    try:
        from bookpush.gui import main as gui_main
    except ImportError as error:
        raise SystemExit(
            "无法打开窗口。请安装带 Tcl/Tk 的 Python，然后双击 run.bat。\n"
            "没有 py 启动器时，run.bat 会使用 %LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe。\n"
            f"详细原因：{error}"
        ) from error
    gui_main()


if __name__ == "__main__":
    main()
