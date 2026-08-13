$files = Get-ChildItem -Path 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT' -Recurse -Include *.js,*.mjs,*.html,*.py,*.jsonc,*.css | Where-Object { $_.FullName -notmatch 'node_modules' }
foreach ($f in $files) {
  $c = Get-Content -Path $f.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $c) { continue }
  $matches = [regex]::Matches($c, 'dtdpaymentsbot')
  if ($matches.Count -gt 0) {
    Write-Output "=== $($f.Name) ($($matches.Count) hits) ==="
    $lines = $c -split "`n"
    for ($i=0; $i -lt $lines.Length; $i++) {
      if ($lines[$i] -match 'dtdpaymentsbot') {
        Write-Output "  L$($i+1): $($lines[$i].Trim())"
      }
    }
  }
}
Write-Output '--- done ---'
