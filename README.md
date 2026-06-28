# DTD Store

A crypto-first product ordering site with Paystack checkout, Telegram notifications, and Supabase-backed products and orders.

## Run Locally

1. Copy `.env.example` to `.env` and fill in:
   - `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY`
   - `BTC_ADDRESS`
   - `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME`
   - `TELEGRAM_ADMIN_CHAT_ID` (private DM for chat widget + admin copies)
   - `TELEGRAM_CHANNEL_ID` (channel for public order posts; bot must be channel admin)
   - `SUPABASE_SERVICE_ROLE_KEY` (from Supabase → Settings → API)
2. Run `supabase-migration.sql` in the Supabase SQL editor (fixes order saves).
3. Start the app:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Admin dashboard:

```text
http://localhost:5173/admin.html
```

Health check:

```text
http://localhost:5173/api/health
```

## Telegram Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_BOT_USERNAME` (without `@`).
3. Send `/start` to your bot in a private chat and set `TELEGRAM_ADMIN_CHAT_ID` to your numeric user ID.
4. Add the bot to your orders channel as an **admin** (can post messages).
5. Set `TELEGRAM_CHANNEL_ID` to the channel chat ID (usually starts with `-100`).

Order notifications post to the channel. A copy goes to your admin DM when both IDs are set. The site chat widget sends only to your admin DM.

## Theme

The storefront and admin pages support light/dark mode. The default follows the visitor's system preference. Use the header toggle to override; the choice is saved in `localStorage`.

## Customize

- Edit products in the admin dashboard, or adjust `fallbackProducts` in `app.js` for local fallback items.
- Product prices are in USD.
- Set `BTC_ADDRESS` in `.env` for Bitcoin checkout.
- Checkout supports BTC review and a Paystack popup using the public key from `/api/config`.
- Never place the Paystack live secret key in frontend code. Put it only in `.env` or Cloudflare Pages secrets.
- Checkout saves a pending order with customer email, delivery details, product account, and optional payment reference.
- Use `admin.html` to add, edit, hide, delete, or reset products while testing.

## Supabase

Run `supabase-schema.sql` in the Supabase SQL editor when you are ready for the real backend. It creates:

- `products`
- `orders`
- `order_items`

## Deploy to Cloudflare Pages

Deploy uses the repository root (not `dist/`).

```powershell
npm run pages:secrets   # uploads .env secrets to Pages
npm run deploy          # wrangler pages deploy .
```

Verify live:

```text
https://your-project.pages.dev/api/health
```

Expected health fields: `telegramAdmin`, `telegramChannel`, `supabase`, `paystack`, `btc`.

## Files

- `index.html` - storefront
- `styles.css` - responsive design and themes
- `theme.js` - light/dark mode
- `app.js` - cart, checkout, Paystack, and orders API
- `bot-widget.js` - Telegram chat widget
- `admin.html` / `admin.js` - product and order dashboard
- `functions/api/*` - Cloudflare Pages Functions (config, orders, Telegram, Paystack verify)
- `server.js` - local dev API mirror
- `supabase-config.js` - public Supabase URL and anon key

## Supabase Connection

The app is connected to:

```text
https://iqoffsnkptulvuqmdcce.supabase.co
```

Only the public anon key belongs in `supabase-config.js`. Never add the `service_role` key to frontend code or public Pages variables.

Before deploying, run `supabase-schema.sql` in Supabase SQL Editor and confirm your admin user can sign in at `/admin.html`.

## Paystack

The storefront uses the Paystack public key for the browser popup. `/api/paystack/verify` runs server-side with the secret key to confirm payments after checkout.
