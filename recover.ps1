# DTD Payments Bot - Full Recovery Script
# Run this in PowerShell: .\recover.ps1

$base = "https://dtdpaymentsbot.pages.dev"
$outDir = "dtdpaymentsbot-recovered"

$files = @(
  ".assetsignore",
  ".cursor/debug-8491be.log",
  ".env",
  ".env.bak-deploy",
  ".env.example",
  ".gitignore",
  "DTDSTORE METHODS/APPLE PAY UPDATED METHOD.pdf",
  "DTDSTORE METHODS/PAYPAL UPDATED METHOD.pdf",
  "DTDSTORE METHODS/_last_APPLE.txt",
  "DTDSTORE METHODS/_last_PAYPA.txt",
  "README.md",
  "TODO.md",
  "UTF8",
  "admin.html",
  "admin.js",
  "app.js",
  "assets/admin-bg.png",
  "assets/apple-touch-icon.png",
  "assets/dtd-chat-logo.png",
  "assets/dtd-hero-3d.png",
  "assets/dtd-howto-banner.png",
  "assets/dtd-logo-192.png",
  "assets/dtd-logo.png",
  "assets/dtd-mark.svg",
  "assets/dtd-promo-banner.png",
  "assets/favicon-16.png",
  "assets/favicon-32.png",
  "assets/favicon.png",
  "assets/store-bg.png",
  "assets/store-feature-crypto.png",
  "assets/store-feature-shop.png",
  "assets/store-feature-telegram.png",
  "assets/store-feature-trade.png",
  "assets/store-hero-bg.png",
  "assets/store-section-products.png",
  "bot-widget.js",
  "chat.css",
  "chat.js",
  "dev-server.err.log",
  "dev-server.out.log",
  "dist/admin.html",
  "dist/admin.js",
  "dist/app.js",
  "dist/assets/admin-bg.png",
  "dist/assets/favicon.png",
  "dist/assets/store-bg.png",
  "dist/index.html",
  "dist/styles.css",
  "dist/supabase-config.js",
  "docs/smtp-sms-setup.md",
  "dtd-payment.css",
  "dtd-payment.html",
  "dtd-payment.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "payment.html",
  "requirements-telethon.txt",
  "scripts/__pycache__/deploy_smtp_sms_vps.cpython-312.pyc",
  "scripts/__pycache__/push_channel_polish.cpython-312.pyc",
  "scripts/__pycache__/smtp_job_poller.cpython-312.pyc",
  "scripts/__pycache__/sync_env_vps.cpython-312.pyc",
  "scripts/__pycache__/telethon_mirror.cpython-312.pyc",
  "scripts/__pycache__/vps_binance_proxy.cpython-312.pyc",
  "scripts/__pycache__/vps_mailer.cpython-312.pyc",
  "scripts/_diag_mail.py",
  "scripts/_find_refs.ps1",
  "scripts/_fix_appjs_channel.ps1",
  "scripts/_fix_channel_links.ps1",
  "scripts/_fix_channel_username_fb.ps1",
  "scripts/_fix_channel_username_fb2.ps1",
  "scripts/_fix_dkim_dns.py",
  "scripts/_replace_owner.ps1",
  "scripts/_replace_refs.ps1",
  "scripts/_show_dtdpaymentsbot.ps1",
  "scripts/_update_env.ps1",
  "scripts/_verify_refs.ps1",
  "scripts/apply-chat-schema.mjs",
  "scripts/apply-smtp-sql.mjs",
  "scripts/apply-supabase-fix.mjs",
  "scripts/apply-telegram-channel.mjs",
  "scripts/deploy_binance_proxy_vps.py",
  "scripts/deploy_cf_email.js",
  "scripts/deploy_mailer_verify.py",
  "scripts/deploy_mailer_vps.py",
  "scripts/deploy_mirror_vps.py",
  "scripts/deploy_multi_sms.py",
  "scripts/deploy_smtp_sms_vps.py",
  "scripts/fix_email_sending.py",
  "scripts/install-mirror-autostart.ps1",
  "scripts/install_vps_mailer.sh",
  "scripts/mail_log_digest.sh",
  "scripts/migrate_mirror_to_dvtech.py",
  "scripts/push-secrets.mjs",
  "scripts/push_channel_polish.py",
  "scripts/secretary-remind-pending.mjs",
  "scripts/smtp_job_poller.py",
  "scripts/start-mirror.ps1",
  "scripts/sync_env_vps.py",
  "scripts/telegram-setup.mjs",
  "scripts/telethon_list_chats.py",
  "scripts/telethon_mirror.py",
  "scripts/telethon_request_code.py",
  "scripts/telethon_sign_in.py",
  "scripts/verify_mail_setup.sh",
  "scripts/vps_binance_proxy.py",
  "scripts/vps_mailer.py",
  "scripts/vps_sms_send.py",
  "scripts/vps_telethon_setup.py",
  "scripts/vps_telethon_signin.py",
  "server.js",
  "shell.css",
  "smtp-console.js",
  "styles.css",
  "supabase-analytics.sql",
  "supabase-bot-sessions.sql",
  "supabase-chat.sql",
  "supabase-config.js",
  "supabase-escrow.sql",
  "supabase-fix-payment-method.sql",
  "supabase-full-fix.sql",
  "supabase-migration.sql",
  "supabase-schema.sql",
  "supabase-secretary-earn.sql",
  "supabase-smtp-console.sql",
  "supabase-smtp-telegram.sql",
  "telethon_sessions/dtd_mirror.session",
  "telethon_sessions/mirror.log",
  "tg-premium-ui.css",
  "theme.js",
  "trading-console.js",
  "trading.css",
  "trading/ai-guide.js",
  "trading/bots.js",
  "trading/charts.js",
  "trading/market.js",
  "trading/orders.js",
  "trading/wallet.js",
  "wrangler.jsonc"
)

$count = 0
$failed = @()

foreach ($file in $files) {
  $url = "$base/$file"
  $dest = Join-Path $outDir $file
  $dir = Split-Path $dest -Parent

  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop
    $count++
    Write-Host "OK  $file" -ForegroundColor Green
  } catch {
    $failed += $file
    Write-Host "FAIL $file" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "==========================================" 
Write-Host "Downloaded $count of $($files.Count) files"
Write-Host "Saved to: $outDir"
if ($failed.Count -gt 0) {
  Write-Host "Failed files ($($failed.Count)):" -ForegroundColor Yellow
  foreach ($f in $failed) { Write-Host "  $f" }
}
Write-Host "=========================================="
