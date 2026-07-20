# Install mirror auto-start via Windows Startup folder (no admin required).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $Root "scripts\start-mirror.ps1"
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "DTD-Telethon-Mirror.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$StartScript`""
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = "Start DTD Telethon channel mirror"
$shortcut.Save()

Write-Host "Auto-start installed:"
Write-Host "  $ShortcutPath"
Write-Host "Mirror will start when you log into Windows."
Write-Host "Remove: Delete that shortcut from your Startup folder."
Write-Host "Start now: npm run mirror:start"
