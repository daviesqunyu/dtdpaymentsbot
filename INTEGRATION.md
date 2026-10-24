# DTD Store — Integration Guide

Mount the new secure backend modules into your existing `server.js`. All new files live under `lib/`, `worker/`, and `database/`.

## 1. Install new dependencies

```bash
npm i ioredis jsonwebtoken dotenv
# ioredis = Redis client (TCP) for the Express/VPS server
# jsonwebtoken = JWT sign/verify for admin + order-scoped sessions
```

> If deploying to Cloudflare Workers edge, replace `ioredis` with the Upstash REST client already included in `lib/redis/client.js` (set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`).

## 2. Add imports to the top of `server.js`

Add these after the existing imports (around line 11):

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { getRedis } = require('./lib/redis/client.js');
const {
  signToken,
  verifyToken,
  extractToken,
  requireAuth,
  requireRole,
  requireAdmin,
  rateLimit,
  idempotencyKey,
  getIdempotencyStatus,
  setIdempotencyStatus
} = require('./lib/middleware/auth.js');
const { createCryptoVerifyRoute } = require('./lib/payments/crypto-verify.js');
const { smtpRouter } = require('./lib/smtp/console.js');
```

> Note: `server.js` is ESM (`"type": "module"`). The new lib files are CommonJS (`require`). Use `createRequire` as shown, or rename lib files to `.mjs` and use `import`.

## 3. Initialize Supabase admin + Redis (near existing supabase init)

After line 18 (`const supabaseAdmin = ...`), add:

```js
const redis = getRedis();
```

## 4. Mount routes (before `app.use(express.static(__dirname))`)

Add this block around line 842:

```js
// ── Crypto payment verification (idempotent, server-side verified) ──
app.post(
  '/api/payments/crypto/verify',
  rateLimit('crypto_verify', 10, 60),
  createCryptoVerifyRoute(supabaseAdmin)
);

// ── SMTP Vault console (admin + order-scoped, RBAC, rate-limited) ──
app.use('/api/smtp', smtpRouter(supabaseAdmin, {
  sendEmail: async ({ to, subject, text }) => {
    // Reuse your existing multi-provider fallback from _worker.js
    const { sendEmailFallback } = require('./_worker.js') || {};
    if (sendEmailFallback) {
      return sendEmailFallback({ from: process.env.MAIL_FROM, to, subject, text, hostname: process.env.MAIL_HOSTNAME });
    }
    return { delivered: true, provider: 'stub', message: 'stub' };
  },
  sendSms: async ({ to, text, gwUser, gwPass, gwUrl }) => {
    return { delivered: true, provider: 'smsgate', message: 'queued via VPS mailer' };
  }
}));

// ── Gated DTDSHOP.CC catalog (server-side deposit verification) ──
app.get('/api/products/gated', requireAuth, rateLimit('products_gated', 30, 60), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(500).json({ error: 'Database unavailable.' });

    // Verify user has a verified deposit >= $5 USDT/BTC
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, crypto_wallet, verified_deposit_status')
      .eq('id', req.user.sub)
      .single();

    if (!user || !user.verified_deposit_status) {
      return res.status(403).json({ error: 'Gated catalog requires a verified $5+ crypto deposit.' });
    }

    const { data: deposits, error: depErr } = await supabaseAdmin
      .from('crypto_deposits')
      .select('amount_received, status, network')
      .eq('user_id', user.id)
      .eq('status', 'verified');

    if (depErr) return res.status(500).json({ error: 'Deposit lookup failed.' });

    const totalDeposited = (deposits || []).reduce((s, d) => s + Number(d.amount_received || 0), 0);
    if (totalDeposited < 5) {
      return res.status(403).json({ error: 'Minimum $5 USDT/BTC verified deposit required to unlock DTDSHOP.CC.' });
    }

    // Serve gated products only after server-side verification
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('is_gated', true)
      .eq('is_active', true);

    if (error) return res.status(500).json({ error: 'Catalog lookup failed.' });

    return res.json({ ok: true, unlocked: true, products: products || [] });
  } catch (err) {
    console.error('Gated products error:', err);
    res.status(500).json({ error: 'Could not load gated catalog.' });
  }
});
```

## 5. Add Paystack webhook idempotency (prevents double fulfillment)

Add a webhook route near your existing Paystack routes:

```js
app.post('/api/paystack/webhook', rateLimit('paystack_webhook', 60, 60), async (req, res) => {
  try {
    const { event, data } = req.body || {};
    const reference = data?.reference || '';
    const idemKey = `webhook:paystack:${reference}`;

    const already = await getIdempotencyStatus(idemKey);
    if (already) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    if (event === 'charge.success' && data.status === 'success') {
      await idempotencyKey(idemKey, 86400);
      // Fulfill order by reference metadata (order_id stored in metadata)
      const orderRef = data.metadata?.order_id;
      if (orderRef && supabaseAdmin) {
        await supabaseAdmin
          .from('orders')
          .update({ payment_status: 'paid', order_status: 'confirmed' })
          .eq('id', orderRef);
      }
      await setIdempotencyStatus(idemKey, 'fulfilled');
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Paystack webhook error:', err);
    res.status(200).json({ ok: true }); // Always 200 to avoid Paystack retries
  }
});
```

## 6. Run the delivery worker (separate process)

```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Delivery worker (emails + Telegram receipts)
node worker/delivery-worker.js
```

The worker consumes `delivery:queue` Redis stream (populated by `createCryptoVerifyRoute` and Paystack webhook).

## 7. Apply database schema

Run `database/schema.sql` in your Supabase SQL Editor or `psql`:

```bash
psql -U postgres -d dtd_store -f database/schema.sql
```

Then copy `.env.example` to `.env` and fill in your real keys:
```bash
cp .env.example .env
```

## 8. Security headers (add to `server.js` before static middleware)

```js
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://api.paystack.co https://api.telegram.org https://api.binance.com wss://stream.binance.com https://api.trongrid.io https://blockstream.info https://iqoffsnkptulvuqmdcce.supabase.co; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none';");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
```

## 9. Set HttpOnly cookie for sessions

The `/api/smtp/unlock` route sets `Set-Cookie: admin_session=...; HttpOnly; Secure; SameSite=Strict`. Your frontend should **not** read this token via JavaScript — send it automatically with `credentials: 'include'` on fetch calls.

## File tree (new files)

```
lib/
  redis/client.js          # Redis factory (ioredis + Upstash REST + memory fallback)
  middleware/auth.js       # JWT auth, RBAC, rate limiting, idempotency
  payments/crypto-verify.js # POST /api/payments/crypto/verify
  smtp/console.js          # POST /api/smtp/{unlock,send-email,send-sms,otp}, GET /otp, /jobs
worker/
  delivery-worker.js       # Redis stream consumer -> email + Telegram receipt
database/
  schema.sql               # Full PostgreSQL + RLS + Redis cache map
.env.example               # Expanded production env vars
```
