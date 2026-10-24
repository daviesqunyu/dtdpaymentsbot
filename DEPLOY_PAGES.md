# DTD Store — Cloudflare Pages deployment

## Prerequisites
1. Install wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Link project: `wrangler pages project create dtdpaymentsbot` (or use existing)

## Build & Deploy
```bash
# Install root + frontend deps
npm install
cd frontend && npm install && cd ..

# Build the Next.js app (static export for Pages)
cd frontend
npm run build
cd ..

# Deploy to Cloudflare Pages
wrangler pages deploy frontend/out --project-name=dtdpaymentsbot
```

## Secrets (set via wrangler or Cloudflare dashboard)
```bash
wrangler pages secret put SUPABASE_URL
wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
wrangler pages secret put PAYSTACK_SECRET_KEY
wrangler pages secret paystack PUBLIC_KEY
wrangler pages secret TELEGRAM_BOT_TOKEN
wrangler pages secret TELEGRAM_ADMIN_CHAT_ID
wrangler pages secret JWT_SECRET
wrangler pages secret SMTP_JWT_SECRET
wrangler pages secret OTP_ENCRYPTION_KEY
wrangler pages secret REDIS_URL   # or UPSTASH_REDIS_REST_URL + TOKEN
```

## Backend (API) — Cloudflare Pages Functions
Your existing `_worker.js` handles `/api/*` routes. Add the new routes by merging `lib/payments/crypto-verify.js` and `lib/smtp/console.js` into `_worker.js`, or create `/functions/api/` directory for Pages Functions.

**Important:** The Redis-backed auth middleware requires a Redis instance (Upstash recommended for edge). Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as secrets.

## Delivery Worker
The `worker/delivery-worker.js` runs as a separate Node process (VPS or cron), NOT on Cloudflare Pages. It consumes the Redis `delivery:queue` stream.

```bash
# On your VPS or separate host
node worker/delivery-worker.js
```

## Environment (.env.local for frontend)
```bash
NEXT_PUBLIC_API_URL=https://dtdpaymentsbot.pages.dev
```

## Verify
Visit https://dtdpaymentsbot.pages.dev/ — should load the cyberpunk storefront.
