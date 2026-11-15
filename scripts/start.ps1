$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $projectPython)) {
    throw 'Virtual environment missing. Run the setup commands in README.md first.'
}
Push-Location -LiteralPath $projectRoot
try {
    & $projectPython -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
