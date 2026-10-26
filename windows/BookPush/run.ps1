Set-Location $PSScriptRoot
$ErrorActionPreference = "Stop"

function Test-PythonAt([string]$Path) {
    return ($Path -and (Test-Path -LiteralPath $Path))
}

function Find-BookPushPython {
    if (Test-PythonAt $env:BOOKSHELF_PYTHON) { return $env:BOOKSHELF_PYTHON }
    foreach ($version in 313, 312, 311, 310) {
        $local = Join-Path $env:LOCALAPPDATA "Programs\Python\Python$version\python.exe"
        if (Test-PythonAt $local) { return $local }
        $program = Join-Path $env:ProgramFiles "Python$version\python.exe"
        if (Test-PythonAt $program) { return $program }
    }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        & py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { return "py" }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python -and $python.Source -notmatch "WindowsApps") {
        & $python.Source -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
        if ($LASTEXITCODE -eq 0) { return $python.Source }
    }
    return $null
}

$python = Find-BookPushPython
if (-not $python) {
    Write-Error "没有找到 Python 3.11 或更新版本。请安装 python.org 的 Python（勾选 tcl/tk）。不需要 py 启动器；默认路径是 $env:LOCALAPPDATA\Programs\Python\Python312\python.exe。也可以设置 BOOKSHELF_PYTHON。"
}

if ($python -eq "py") {
    & py -3 -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & py -3 -m bookpush
    exit $LASTEXITCODE
}

& $python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python -m bookpush
exit $LASTEXITCODE
