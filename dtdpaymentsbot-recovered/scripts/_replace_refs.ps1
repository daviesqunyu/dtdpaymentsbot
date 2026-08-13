$root = 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT'
$files = Get-ChildItem -Path $root -Recurse -Include *.js,*.mjs,*.html,*.py,*.jsonc,*.css | Where-Object { $_.FullName -notmatch 'node_modules' -and $_.FullName -notmatch '\\dist\\' }

# Safe replacements only (bot username + channel numeric IDs + channel username branding).
# Davetheedev is handled separately (commented out, not replaced).
$replacements = @(
  @('@Dtdpaymentbot', '@DTDSTOREBOT'),
  @('@Dtdpaymentbot', '@DTDSTOREBOT'),
  @('Dtdpaymentbot', 'DTDSTOREBOT'),
  @('@DTDMAINSTORE', '@DTDSHOPMAIN'),
  @('DTDMAINSTORE', 'DTDSHOPMAIN'),
  @('-1004433496789', '-1004311503458'),
  @('-1004333170947', ''),
  @('-1004374064080', '')
)

foreach ($f in $files) {
  $original = Get-Content -Path $f.FullName -Raw -Encoding UTF8
  $text = $original
  foreach ($r in $replacements) {
    $text = $text.Replace($r[0], $r[1])
  }
  if ($text -ne $original) {
    Set-Content -Path $f.FullName -Value $text -Encoding UTF8 -NoNewline
    Write-Output ("UPDATED: " + $f.FullName)
  }
}
Write-Output 'DONE'
