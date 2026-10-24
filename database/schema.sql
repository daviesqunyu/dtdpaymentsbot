-- ============================================================================
-- DTD Store — Production PostgreSQL Schema (Supabase / PostgreSQL)
-- Run this in Supabase SQL Editor or your PostgreSQL instance.
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'moderator', 'user')),
  crypto_wallet TEXT,
  verified_deposit_status BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_count INTEGER NOT NULL DEFAULT 0,
  digital_asset_url TEXT,            -- encrypted delivery link / S3 presigned URL
  is_gated BOOLEAN NOT NULL DEFAULT FALSE,   -- DTDSHOP.CC gated catalog
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  email TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'usdt',   -- paystack, usdt_trc20, btc, telegram_stars
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, failed, refunded
  order_status TEXT NOT NULL DEFAULT 'new',      -- new, confirmed, delivered, cancelled
  tx_hash TEXT,
  amount_paid DECIMAL(12,2),
  tracking_id TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Order items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_usd DECIMAL(12,2) NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Crypto deposits (TRC20 / BTC verification records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crypto_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  order_id UUID REFERENCES orders(id),
  network TEXT NOT NULL CHECK (network IN ('trc20', 'btc')),
  tx_hash TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount_expected DECIMAL(12,2) NOT NULL,
  amount_received DECIMAL(12,2),
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crypto_deposits_tx_unique UNIQUE (tx_hash)
);

-- ---------------------------------------------------------------------------
-- Chat posts (DTD Store Chat feed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  media_urls JSONB NOT NULL DEFAULT '[]',
  mirrored_to_telegram BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Callback requests (phone/video call requests)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('phone', 'telegram', 'email')),
  topic TEXT,
  scheduled_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- SMTP / SMS job log (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smtp_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'otp')),
  recipients JSONB NOT NULL DEFAULT '[]',
  subject TEXT,
  provider TEXT,
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_products_gated_active ON products(is_gated, is_active);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_tx_hash ON orders(tx_hash);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_crypto_deposits_tx ON crypto_deposits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_user_status ON crypto_deposits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_crypto_deposits_order ON crypto_deposits(order_id);

CREATE INDEX IF NOT EXISTS idx_chat_posts_created ON chat_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_posts_user ON chat_posts(user_id);

CREATE INDEX IF NOT EXISTS idx_callback_requests_status ON callback_requests(status);

CREATE INDEX IF NOT EXISTS idx_smtp_jobs_created ON smtp_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smtp_jobs_admin ON smtp_jobs(admin_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS) policies
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE smtp_jobs ENABLE ROW LEVEL SECURITY;

-- Users: read own row, admins manage
CREATE POLICY users_own_select ON users FOR SELECT USING (auth.uid()::text = id::text);
CREATE POLICY users_admin_all ON users FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- Products: public read active, admins manage
CREATE POLICY products_public_read ON products FOR SELECT USING (is_active = TRUE);
CREATE POLICY products_admin_all ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- Orders: owners read own, admins manage
CREATE POLICY orders_owner_select ON orders FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY orders_admin_all ON orders FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- Crypto deposits: owners read own, admins read all
CREATE POLICY crypto_deposits_owner_select ON crypto_deposits FOR SELECT USING (auth.uid()::text = user_id::text);
CREATE POLICY crypto_deposits_admin_all ON crypto_deposits FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- Chat posts: public read, owners create, admins manage
CREATE POLICY chat_posts_public_read ON chat_posts FOR SELECT USING (TRUE);
CREATE POLICY chat_posts_owner_insert ON chat_posts FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
CREATE POLICY chat_posts_admin_all ON chat_posts FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- SMTP jobs: admins only
CREATE POLICY smtp_jobs_admin_all ON smtp_jobs FOR ALL USING (
  EXISTS (SELECT 1 FROM users u2 WHERE u2.id = auth.uid() AND u2.role = 'admin')
);

-- ---------------------------------------------------------------------------
-- Redis caching map (run in Redis / Upstash)
-- ---------------------------------------------------------------------------
-- Key pattern                        TTL      Purpose
-- catalog:products                   60s      Live product catalog (public)
-- catalog:gated:{user_id}            300s     Gated access check per user
-- trading:ticker:{symbol}            5s       Binance ticker cache
-- trading:orderbook:{symbol}         10s      Binance order book depth
-- rate_limit:{prefix}:{ident}        60s      Per-IP/user rate limit counter
-- idem:crypto:verify:{tx_hash}       86400s   Crypto verification idempotency
-- idem:webhook:{reference}           86400s   Paystack/Stars webhook idempotency
-- delivery:queue                     stream   Digital delivery job stream (XADD)
-- smtp:email:jobs                    stream   Email job audit stream
-- smtp:sms:jobs                      stream   SMS job audit stream
-- smtp:otp:queue                     stream   OTP listener job stream
-- otp:inbox:{phone}                  300s     Encrypted OTP inbox buffer
-- session:{jwt_sub}                  3600s    User session cache
