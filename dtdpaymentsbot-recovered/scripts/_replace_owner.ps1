$root = 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT'
$files = Get-ChildItem -Path $root -Recurse -Include *.js,*.mjs,*.html,*.py,*.jsonc,*.css | Where-Object { $_.FullName -notmatch 'node_modules' -and $_.FullName -notmatch '\\dist\\' }

# Replace banned owner Davetheedev with Glock7money (functional handoff).
$replacements = @(
  @('@Davetheedev', '@Glock7money'),
  @('Davetheedev', 'Glock7money'),
  @('davetheedev', 'Glock7money')
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
