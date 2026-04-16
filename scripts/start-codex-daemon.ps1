$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$daemonScript = Join-Path $repoRoot "src\codex-daemon.js"
$logDir = Join-Path $repoRoot ".daemon"
$outLog = Join-Path $logDir "codex.out.log"
$errLog = Join-Path $logDir "codex.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $repoRoot

& $nodePath $daemonScript 1>> $outLog 2>> $errLog
exit $LASTEXITCODE
