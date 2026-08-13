$files = @(
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\scripts\push_channel_polish.py',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\scripts\telethon_mirror.py',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\scripts\telegram-setup.mjs',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\app.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\chat.js'
)
foreach ($f in $files) {
  if (Test-Path $f) {
    $c = Get-Content -Path $f -Raw -Encoding UTF8
    $c = $c.Replace('|| "DTDSHOPMAIN"', '|| ""')
    $c = $c.Replace('or "DTDSHOPMAIN"', 'or ""')
    $c = $c.Replace('"https://t.me/DTDSHOPMAIN"', '""')
    $c = $c.Replace('"DTDSHOPMAIN"', '""')
    Set-Content -Path $f -Value $c -Encoding UTF8
    Write-Output "updated $f"
  }
}
