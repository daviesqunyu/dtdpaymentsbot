$patterns = @('DTDSHOPMAIN','dtdpaymentsbot','Dtdpaymentbot','DAVETHEEDEV','davetheedev')
$files = Get-ChildItem -Path 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT' -Recurse -Include *.js,*.mjs,*.html,*.py,*.jsonc,*.css | Where-Object { $_.FullName -notmatch 'node_modules' }
foreach ($f in $files) {
  $c = Get-Content -Path $f.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $c) { continue }
  foreach ($p in $patterns) {
    if ($c -match [regex]::Escape($p)) {
      Write-Output "FOUND: $($f.Name) contains '$p'"
    }
  }
}
Write-Output '--- verify done ---'
