# DTD Store + Payments Bot

Crypto-first product storefront with Paystack (KES) + BTC checkout, Supabase products/orders,
Cloudflare Pages API, and Telegram automation for `@Dtdpaymentbot`.

Live store: https://dtdpaymentsbot.pages.dev

## Goal vs status

| Goal | Status |
|------|--------|
| Website store + products DB | Done (Supabase + fallback catalog) |
| Paystack receive money | Done (KES hosted checkout + verify) |
| BTC checkout UI | Done (desktop layout fixed) |
| Telegram bot commands | Done (`/store` `/products` `/pay` `/mirror` …) |
| Order alerts to channel/group/admin | Done (bot must be **admin**) |
| Auto-approve join requests | Done (bot needs Invite Users) |
| Simple channel → group copy (Bot API) | Done (`TELEGRAM_CHANNEL_MIRROR`) |
| Multi-source listen + rewrite links/usernames + footer + delay → your channel | **Telethon script added** (needs API_ID/HASH + sources) |
| `SUPABASE_SERVICE_ROLE_KEY` | Still empty in `.env` (orders may fail RLS) |
| Bot admin on channels/group | **You still must add `@Dtdpaymentbot` as admin** |

## Run locally

```powershell
copy .env.example .env
npm install
npm run dev
```

Open http://localhost:5173

## Deploy (Cloudflare Pages — production branch is `main`)

```powershell
npm run deploy:full
npm run telegram:setup
```

## Telethon rewrite mirror (recommended for multi-channel → DTD MAIN STORE)

Bot API can only *copy* posts. For **edit text / replace links / footer / delay / many sources**, use Telethon:

1. Create API credentials at https://my.telegram.org  
2. Put `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` in `.env`  
3. Join source channels with the same Telegram account  
4. Set:

```env
MIRROR_SOURCE_CHANNELS=@SomeChannel,-1001234567890
MIRROR_DEST_CHANNEL=-1004433496789
STORE_URL=https://dtdpaymentsbot.pages.dev
TELEGRAM_OWNER_USERNAME=Davetheedev
```

5. Run:

```powershell
pip install -r requirements-telethon.txt
npm run mirror:telethon
```

First run asks for phone + login code and creates `telethon_sessions/dtd_mirror.session`.

Every new source post is rewritten (links → store, usernames → `@Davetheedev`, footer added), delayed 5–30s, then posted to your destination channel **without “forwarded from”**.

## Telegram bots

- Primary: `@Dtdpaymentbot` (store + webhook automation)
- Secondary (optional): `@davistechbot`
- Owner contact: `@Davetheedev`
