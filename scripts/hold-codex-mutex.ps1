param(
  [Parameter(Mandatory = $true)]
  [string]$MutexName,

  [Parameter(Mandatory = $true)]
  [int]$ParentPid
)

$ErrorActionPreference = "Stop"

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$createdNew)

if (-not $createdNew) {
  try {
    $mutex.Dispose()
  } catch {
  }
  exit 2
}

Write-Output "ACQUIRED"

try {
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 5
  }
} finally {
  try {
    $mutex.ReleaseMutex()
  } catch {
  }

  try {
    $mutex.Dispose()
  } catch {
  }
}
