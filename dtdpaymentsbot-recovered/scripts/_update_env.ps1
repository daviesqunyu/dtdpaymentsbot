$envFile = 'c:\Users\davie\OneDrive\Documents\DTDPAYMENTSBOT\.env'
$content = Get-Content -Path $envFile -Encoding UTF8

# Token / bot username
$content = $content | ForEach-Object {
  if ($_ -match '^TELEGRAM_BOT_TOKEN=') { 'TELEGRAM_BOT_TOKEN=8689676260:AAEduf_1GVJ3YrJwLdcDatp_gLIWaGVfTz0' }
  elseif ($_ -match '^TELEGRAM_BOT_USERNAME=') { 'TELEGRAM_BOT_USERNAME=DTDSTOREBOT' }
  elseif ($_ -match '^TELEGRAM_OWNER_USERNAME=') { 'TELEGRAM_OWNER_USERNAME=Glock7money' }
  elseif ($_ -match '^TELEGRAM_CHANNEL_USERNAME=') { '# TELEGRAM_CHANNEL_USERNAME=DTDMAINSTORE (private channel, no username)' }
  elseif ($_ -match '^TELEGRAM_CHANNEL_ID=') { 'TELEGRAM_CHANNEL_ID=-1004311503458' }
  elseif ($_ -match '^TELEGRAM_BACKUP_CHANNEL_ID=') { '# TELEGRAM_BACKUP_CHANNEL_ID=-1004333170947 (removed)' }
  elseif ($_ -match '^TELEGRAM_GROUP_ID=') { '# TELEGRAM_GROUP_ID=-1004374064080 (removed)' }
  elseif ($_ -match '^TELEGRAM_MIRROR_FROM_CHANNEL_ID=') { 'TELEGRAM_MIRROR_FROM_CHANNEL_ID=7115976102' }
  elseif ($_ -match '^TELEGRAM_MIRROR_TO_CHAT_ID=') { 'TELEGRAM_MIRROR_TO_CHAT_ID=-1004311503458' }
  elseif ($_ -match '^MIRROR_SOURCE_CHANNELS=') { 'MIRROR_SOURCE_CHANNELS=7115976102' }
  elseif ($_ -match '^MIRROR_DEST_CHANNEL=') { 'MIRROR_DEST_CHANNEL=-1004311503458' }
  elseif ($_ -match '^MIRROR_PROMO_CHATS=') { 'MIRROR_PROMO_CHATS=-1004311503458' }
  elseif ($_ -match '^MIRROR_KEEP_USERNAMES=') { 'MIRROR_KEEP_USERNAMES=Glock7money,DTDSTOREBOT' }
  else { $_ }
}

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Output 'ENV UPDATED'
