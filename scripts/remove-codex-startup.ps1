$ErrorActionPreference = "Stop"

$taskNames = @(
  "gmail-agent-codex-daemon",
  "gmail-agent-codex-314-daemon"
)

foreach ($taskName in $taskNames) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Removed scheduled task: $taskName"
  }
}
