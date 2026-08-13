$p = 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\index.html'
$c = Get-Content -Path $p -Raw -Encoding UTF8
$c = $c.Replace('https://t.me/DTDSHOPMAIN', 'https://t.me/DTDSTOREBOT')
$c = $c.Replace('@DTDSHOPMAIN', '@DTDSTOREBOT')
$c = $c.Replace('Join @DTDSTOREBOT', 'Open @DTDSTOREBOT')
Set-Content -Path $p -Value $c -Encoding UTF8
Write-Output 'index.html channel links fixed'
