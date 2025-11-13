param(
  [string]$Time = '22:00',
  [switch]$Publish = $true,
  [switch]$UseAI = $true,
  [string]$TaskName = 'PonjiroDiaryDaily'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts\generate.ps1'
if (-not (Test-Path $script)) { throw "Not found: $script" }

$args = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
if ($Publish) { $args += ' -Publish' }
if ($UseAI) { $args += ' -UseAI' }

$h = $Time.Split(':')
if ($h.Count -lt 2) { throw 'Time must be HH:mm' }
$hour = [int]$h[0]
$minute = [int]$h[1]

$action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument $args -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($hour).AddMinutes($minute))
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege

try {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal | Out-Null
  Write-Host "Scheduled task registered: $TaskName at $Time daily" -ForegroundColor Green
  Write-Host "It will run: pwsh $args" -ForegroundColor DarkGray
} catch {
  Write-Warning "Failed to register task: $($_.Exception.Message)"
  Write-Host 'Fallback: use Task Scheduler GUI to create a Daily task at 22:00 with:'
  Write-Host "Program/script: pwsh.exe" -ForegroundColor Yellow
  Write-Host "Add arguments: $args" -ForegroundColor Yellow
  Write-Host "Start in: $root" -ForegroundColor Yellow
}

