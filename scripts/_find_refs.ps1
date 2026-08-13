$files = Get-ChildItem -Path 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT' -Recurse -Include *.js,*.mjs,*.html,*.py,*.jsonc,*.css | Where-Object { $_.FullName -notmatch 'node_modules' -and $_.FullName -notmatch '\\dist\\' }
$patterns = @('Davetheedev','davetheedev','@DTDSTOREBOT','DTDSTOREBOT','DTDSHOPMAIN','-1004311503458','-1004433496789','-1004333170947','-1004374064080','Glock7money')
foreach ($f in $files) {
  $matches = Select-String -Path $f.FullName -Pattern $patterns -SimpleMatch
  foreach ($m in $matches) {
    Write-Output ($f.FullName + ':' + $m.LineNumber + ': ' + $m.Line.Trim())
  }
}
