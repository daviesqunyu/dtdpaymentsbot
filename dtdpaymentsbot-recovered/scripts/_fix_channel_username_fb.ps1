$files = @(
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\api\chat\messages.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\bot-commands.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\bot-shop.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\mini-app.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\start-keyboard.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\store.js',
  'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\functions\lib\tg-premium.js'
)
foreach ($f in $files) {
  if (Test-Path $f) {
    $c = Get-Content -Path $f -Raw -Encoding UTF8
    $c = $c.Replace('|| "DTDSHOPMAIN"', '|| ""')
    Set-Content -Path $f -Value $c -Encoding UTF8
    Write-Output "updated $f"
  }
}
