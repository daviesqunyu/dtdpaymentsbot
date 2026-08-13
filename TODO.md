# DTD Store Bot Migration (DTDPAYMENTSBOT → DTDSTOREBOT)

Goal: Rebrand the Telegram bot from the old DTD Payments bot to the new **DTD STORE BOT**
(@DTDSTOREBOT), point it at the new private channel (**DTD SHOP** `-1004311503458`),
remove the old mirror/forward channels, and replace the banned owner handle **@Davetheedev**
with the new owner **@Glock7money**.

## Completed

- [x] `.env` — new bot token `8689676260:AAEduf_1GVJ3YrJwLdcDatp_gLIWaGVfTz0`, username `DTDSTOREBOT`.
- [x] `.env` — owner/vendor → `Glock7money` (replaces banned `Davetheedev`).
- [x] `.env` — main channel `TELEGRAM_CHANNEL_ID=-1004311503458` (DTD SHOP, private).
- [x] `.env` — removed old backup channel `-1004333170947` and group `-1004374064080` (commented out).
- [x] `.env` — mirror source now `7115976102` → dest `-1004311503458` (removed 20+ old forward channels).
- [x] `.env` — `TELEGRAM_CHANNEL_USERNAME` commented (private channel, no username).
- [x] Code fallbacks — bot username → `DTDSTOREBOT`, owner/vendor → `Glock7money`.
- [x] Code fallbacks — channel username → `""` (private channel, no public handle).
- [x] `index.html` — channel links now point to `@DTDSTOREBOT` (private channel cannot be @-linked).
- [x] `app.js` — channel URL fallbacks → bot URL (private channel).
- [x] `chat.js` — channel rail uses env channel url/username (empty for private channel).
- [x] `functions/api/telegram/feed.js` — graceful private-channel fallback (no public feed scrape).
- [x] `telegram-team.js` — default owner is `Glock7money` (no `Davetheedev`).
- [x] `telegram-setup.mjs` / `telethon_mirror.py` / `push_channel_polish.py` — updated defaults.

## Notes
- Web storefront remains at `https://dtdpaymentsbot.pages.dev` (Cloudflare Pages project name
  stays `dtdpaymentsbot` — renaming would break the live site + all links).
- `@davistechbot` (secondary bot) is untouched.
- Owner `@Davetheedev` is fully replaced by `@Glock7money` everywhere.

## Deploy / follow-up
- [ ] Make @DTDSTOREBOT an admin on **DTD SHOP** channel `-1004311503458`.
- [ ] Push secrets: `npm run pages:secrets` (updates Cloudflare env with new token/channel).
- [ ] Deploy: `npm run deploy`.
- [ ] Run setup: `npm run telegram:setup` (updates bot profile, commands, webhook).
- [ ] Restart mirror on VPS: `python scripts/telethon_mirror.py`.

---

# DTD SMTP + Payments Upgrade TODO

Goal: Make AWS SES the reliable primary mail sender (avoid Postfix errors), and convert the
standalone DTD Payments page into a real, live checkout/deposit section backed by the VPS.

## Part A — AWS SES / avoid Postfix errors

- [x] 1. `scripts/install_vps_mailer.sh` — point `dtd-vps-mailer.service` at `EnvironmentFile=/opt/dtd-mailer/poller.env` so it inherits SES creds (`SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `VPS_MAIL_MODE`, `MAIL_FROM`, `MAIL_DOMAIN`).
- [x] 2. `scripts/deploy_smtp_sms_vps.py` — after writing `poller.env`, rewrite the mailer unit to use `EnvironmentFile` and restart **both** `dtd-vps-mailer` and `dtd-smtp-poller`.
- [x] 3. `scripts/sync_env_vps.py` — restart both services (mailer + poller) after syncing `poller.env`.
- [x] 4. `scripts/vps_mailer.py` — make transport selection per-request (no global mutation across threads); keep AWS SES as primary with clean success; Postfix as true fallback only.

## Part B — Standalone DTD Payments page (live checkout/deposit via VPS)

- [x] 5. `dtd-payment.html` — rewrite as a real, simple standalone checkout: order summary + email + Deposit/Pay button (Paystack first, crypto as optional deposit alt).
- [x] 6. `dtd-payment.js` — wire Paystack init + verify + order save; read `dtd_custom_checkout` sessionStorage.
- [x] 7. `dtd-payment.css` — simplify the layout to be clean and to-the-point.

## Part C — Escrow (Binance-style P2P sessions)

- [x] 8. `supabase-escrow.sql` — clean schema: `escrow_sessions`, `escrow_transactions`, `escrow_messages` + RLS (admin writes, party read `using (true)`).
- [x] 9. `functions/lib/escrow.js` — shared helper lib (create, get by code, list, transition, deposit detection stub).
- [x] 10. `functions/api/escrow/index.js` — look up escrows by buyer/seller Telegram handle.
- [x] 11. `functions/api/escrow/session.js` — public read-only session viewer by code.
- [x] 12. `functions/api/escrow/admin.js` — admin create / list / release / cancel / dispute / confirm_deposit.
- [x] 13. `scripts/push-secrets.mjs` — added `ESCROW_DEPOSIT_ADDRESS` to the secret keys list.

## Deploy / follow-up

- [ ] Apply escrow schema in Supabase SQL editor (`supabase-escrow.sql`).
- [ ] Redeploy VPS: `python scripts/deploy_smtp_sms_vps.py`
- [ ] Sync env: `python scripts/sync_env_vps.py`
- [ ] Push Pages secrets: `node scripts/push-secrets.mjs`
- [ ] Redeploy Pages: `npm run deploy`
- [ ] Test send from SMTP console → AWS SES delivered
- [ ] Test standalone DTD Payments page → Paystack flow → order stored
- [ ] Test USDT deposit flow → order stored
- [ ] Test escrow admin create + release flow
