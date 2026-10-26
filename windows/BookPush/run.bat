@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Prefer a real python.org install. The py launcher is missing on some PCs.
set "PYEXE="
if defined BOOKSHELF_PYTHON if exist "%BOOKSHELF_PYTHON%" set "PYEXE=%BOOKSHELF_PYTHON%"

if not defined PYEXE (
  for %%V in (313 312 311 310) do (
    if not defined PYEXE if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" (
      set "PYEXE=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
    )
  )
)
if not defined PYEXE (
  for %%V in (313 312 311 310) do (
    if not defined PYEXE if exist "%ProgramFiles%\Python%%V\python.exe" (
      set "PYEXE=%ProgramFiles%\Python%%V\python.exe"
    )
  )
)
if not defined PYEXE (
  where py >nul 2>&1 && py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1 && set "PYEXE=PYLAUNCHER"
)
if not defined PYEXE (
  where python >nul 2>&1 && python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1 && set "PYEXE=PYTHON"
)

if not defined PYEXE (
  echo 没有找到 Python 3.11 或更新版本。
  echo 请安装 python.org 的 Python，勾选 tcl/tk。不需要 py 启动器。
  echo 默认会使用 %%LOCALAPPDATA%%\Programs\Python\Python312\python.exe
  echo 也可以先设置 BOOKSHELF_PYTHON 为 python.exe 的完整路径。
  exit /b 1
)

if "%PYEXE%"=="PYLAUNCHER" (
  py -3 -m pip install -r requirements.txt || exit /b 1
  py -3 -m bookpush
  exit /b %ERRORLEVEL%
)
if "%PYEXE%"=="PYTHON" (
  python -m pip install -r requirements.txt || exit /b 1
  python -m bookpush
  exit /b %ERRORLEVEL%
)

"%PYEXE%" -m pip install -r requirements.txt || exit /b 1
"%PYEXE%" -m bookpush
exit /b %ERRORLEVEL%
