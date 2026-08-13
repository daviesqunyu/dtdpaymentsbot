$p = 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\app.js'
$c = Get-Content -Path $p -Raw -Encoding UTF8
# Channel is private — replace channel URL fallbacks with the bot URL so links work.
$c = $c.Replace('const channelUrl = storeConfig.telegramChannelUrl || "https://t.me/DTDSHOPMAIN";', 'const channelUrl = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";')
$c = $c.Replace('const fallbackUrl = storeConfig.telegramChannelUrl || "https://t.me/DTDSHOPMAIN";', 'const fallbackUrl = storeConfig.telegramBotUrl || "https://t.me/DTDSTOREBOT";')
$c = $c.Replace('>Open @DTDSHOPMAIN<', '>Open @DTDSTOREBOT<')
Set-Content -Path $p -Value $c -Encoding UTF8
Write-Output 'app.js channel fallbacks -> bot'
