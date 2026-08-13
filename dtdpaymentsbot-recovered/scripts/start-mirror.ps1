# Start Telethon mirror in a separate window that survives closing Cursor terminals.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "telethon_sessions"
$LogFile = Join-Path $LogDir "mirror.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Stop any existing mirror process
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*telethon_mirror*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 1

$cmd = @"
`$env:PYTHONIOENCODING='utf-8'
Set-Location '$Root'
Write-Host 'DTD Telethon mirror starting...'
python scripts/telethon_mirror.py *>> '$LogFile'
"@

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command", $cmd
)

Write-Host "Mirror started in a new PowerShell window."
Write-Host "Log file: $LogFile"
Write-Host "You can close Cursor; keep that mirror window open (or use Task Scheduler autostart)."
