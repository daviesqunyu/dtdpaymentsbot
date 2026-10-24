/**
 * DTD Store — SMTP Vault console routes
 * - POST /api/smtp/unlock         : admin JWT unlock or order-scoped unlock
 * - POST /api/smtp/send-email     : bulk email via Postfix/Resend/etc (admin + rate limit)
 * - POST /api/smtp/send-sms       : carrier SMS via SMSGate/Twilio (admin + rate limit)
 * - POST /api/smtp/otp            : start OTP listener / pull OTP inbox (admin + rate limit)
 * - GET  /api/smtp/otp            : list decrypted OTPs (admin)
 * - GET  /api/smtp/jobs           : list email/SMS job history (admin)
 *
 * Security: HttpOnly JWT, RBAC (admin only for console ops), Redis rate limiting,
 * AES-256-GCM encryption for OTP data at rest.
 */

const jwt = require('jsonwebtoken');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const { getRedis } = require('../redis/client');
const { requireAuth, requireAdmin, rateLimit, signToken, verifyToken } = require('../middleware/auth');

const JWT_SECRET = process.env.SMTP_JWT_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me';
const ENCRYPTION_KEY_B64 = process.env.OTP_ENCRYPTION_KEY; // 32 bytes base64
const ENCRYPTION_KEY = ENCRYPTION_KEY_B64 ? Buffer.from(ENCRYPTION_KEY_B64, 'base64') : null;

if (!ENCRYPTION_KEY) {
  console.warn('[SMTP Vault] OTP_ENCRYPTION_KEY not set — OTPs will NOT be encrypted at rest. Set a 32-byte base64 key.');
}

/** Encrypt OTP message text with AES-256-GCM */
function encryptOtp(plaintext) {
  if (!ENCRYPTION_KEY) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/** Decrypt OTP message text */
function decryptOtp(token) {
  if (!ENCRYPTION_KEY || !token) return token || '';
  try {
    const [ivB64, encB64, tagB64] = String(token).split(':');
    const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '[decryption failed]';
  }
}

function generateAdminJwt(user) {
  return signToken({ sub: user.id, role: user.role, email: user.email }, '8h');
}

/**
 * Route handler factory. Pass Supabase admin client + a sendEmail/sendSms adapter.
 */
function createSmtpRoutes(supabaseAdmin, adapters = {}) {
  const {
    sendEmail = async () => ({ delivered: true, provider: 'stub', message: 'stub' }),
    sendSms = async () => ({ delivered: true, provider: 'stub', message: 'stub' })
  } = adapters;

  const router = {
    async unlock(req, res) {
      try {
        const { mode, orderId, email, adminJwt } = req.body || {};

        if (mode === 'admin') {
          if (!adminJwt) return res.status(401).json({ error: 'Admin JWT required.' });
          let payload;
          try { payload = verifyToken(adminJwt); } catch { return res.status(401).json({ error: 'Invalid admin JWT.' }); }
          if (payload.role !== 'admin') return res.status(403).json({ error: 'Admin role required.' });

          const token = generateAdminJwt({ id: payload.sub, role: payload.role, email: payload.email });
          res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
          return res.json({ ok: true, token, role: 'admin', message: 'Admin console unlocked.' });
        }

        if (mode === 'order') {
          if (!orderId || !email) return res.status(400).json({ error: 'Order ID and email required.' });
          if (!supabaseAdmin) return res.status(500).json({ error: 'Database unavailable.' });

          const { data: order, error } = await supabaseAdmin
            .from('orders')
            .select('id, user_id, customer_email, payment_status')
            .eq('id', orderId)
            .single();
          if (error || !order) return res.status(404).json({ error: 'Order not found.' });
          if (String(order.customer_email).toLowerCase() !== String(email).toLowerCase()) {
            return res.status(403).json({ error: 'Email does not match order owner.' });
          }
          if (order.payment_status !== 'paid') {
            return res.status(403).json({ error: 'Order must be paid to unlock SMTP console.' });
          }

          // Fetch user role for scoping
          const { data: user } = await supabaseAdmin
            .from('users')
            .select('id, role')
            .eq('id', order.user_id)
            .single();

          const token = signToken({
            sub: order.user_id,
            role: (user && user.role) || 'user',
            order_id: order.id
          }, '2h');

          res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7200`);
          return res.json({ ok: true, token, role: (user && user.role) || 'user', order_id: order.id, message: 'SMTP console unlocked for your order.' });
        }

        return res.status(400).json({ error: 'Invalid unlock mode. Use admin or order.' });
      } catch (err) {
        console.error('SMTP unlock error:', err);
        res.status(500).json({ error: 'Unlock failed.' });
      }
    },

    async sendEmail(req, res) {
      try {
        const { to, subject, text } = req.body || {};
        const recipients = Array.isArray(to)
          ? to
          : String(to || '').split(/[\n\r,;]+/).map(s => s.trim()).filter(Boolean);

        if (!recipients.length) return res.status(400).json({ error: 'At least one recipient required.' });
        if (!subject || !text) return res.status(400).json({ error: 'Subject and body required.' });

        const result = await sendEmail({ to: recipients, subject, text });

        // Enqueue job history in Redis
        try {
          const redis = getRedis();
          await redis.xadd('smtp:email:jobs', '*',
            'admin_id', String(req.user.sub),
            'to', JSON.stringify(recipients),
            'subject', subject,
            'provider', result.provider || 'unknown',
            'delivered', String(!!result.delivered),
            'created_at', new Date().toISOString());
        } catch { /* non-fatal */ }

        return res.json({
          ok: true,
          delivered: !!result.delivered,
          provider: result.provider,
          message: result.message || `Queued to ${recipients.length} recipient(s).`,
          jobId: result.jobId || null
        });
      } catch (err) {
        console.error('SMTP send-email error:', err);
        res.status(500).json({ error: err.message || 'Email send failed.' });
      }
    },

    async sendSms(req, res) {
      try {
        const { to, text, gwUser, gwPass, gwUrl } = req.body || {};
        const phones = Array.isArray(to)
          ? to
          : String(to || '').split(/[\n\r,;|]+/).map(s => s.trim()).filter(Boolean);

        if (!phones.length) return res.status(400).json({ error: 'At least one phone number required.' });
        if (!text) return res.status(400).json({ error: 'Message text required.' });
        if (!gwUser || !gwPass) return res.status(400).json({ error: 'SMSGate credentials required.' });

        const result = await sendSms({ to: phones, text, gwUser, gwPass, gwUrl });

        try {
          const redis = getRedis();
          await redis.xadd('smtp:sms:jobs', '*',
            'admin_id', String(req.user.sub),
            'to', JSON.stringify(phones),
            'provider', result.provider || 'unknown',
            'delivered', String(!!result.delivered),
            'created_at', new Date().toISOString());
        } catch { /* non-fatal */ }

        return res.json({
          ok: true,
          delivered: !!result.delivered,
          provider: result.provider,
          message: result.message || `Queued to ${phones.length} phone(s).`,
          jobId: result.jobId || null
        });
      } catch (err) {
        console.error('SMTP send-sms error:', err);
        res.status(500).json({ error: err.message || 'SMS send failed.' });
      }
    },

    async otp(req, res) {
      try {
        const { action, gwUser, gwPass, gwUrl, phones, label, pull } = req.body || {};

        if (!gwUser || !gwPass) {
          return res.status(400).json({ error: 'SMSGate username and password required.' });
        }

        // Enqueue OTP listener job. Credentials are NOT stored in plaintext in the response.
        try {
          const redis = getRedis();
          const jobId = await redis.xadd('smtp:otp:queue', '*',
            'action', action || 'listen',
            'gw_user', gwUser,
            'gw_url', gwUrl || '',
            'phones', JSON.stringify(phones || []),
            'label', label || '',
            'pull', String(!!pull),
            'admin_id', String(req.user.sub),
            'created_at', new Date().toISOString());

          return res.json({
            ok: true,
            jobId,
            message: 'OTP listener job enqueued. Incoming OTPs are encrypted at rest (AES-256-GCM).'
          });
        } catch (err) {
          throw err;
        }
      } catch (err) {
        console.error('SMTP OTP error:', err);
        res.status(500).json({ error: err.message || 'OTP action failed.' });
      }
    },

    async listOtps(req, res) {
      try {
        const { watch, limit = 40 } = req.query || {};
        const redis = getRedis();
        const key = watch ? `otp:inbox:${watch}` : 'otp:inbox:all';

        // OTPs are pushed into this list encrypted by the OTP worker
        const raw = await redis.get(key) || '[]';
        let items = [];
        try { items = JSON.parse(raw); } catch { items = []; }

        // Decrypt each OTP's message field
        const decrypted = items.map(it => ({
          ...it,
          otp: it.otp, // OTP code itself may be plaintext (short-lived)
          message: decryptOtp(it.message),
          sender: decryptOtp(it.sender),
          recipient: decryptOtp(it.recipient)
        })).slice(0, Number(limit));

        return res.json({ ok: true, items: decrypted, count: decrypted.length });
      } catch (err) {
        console.error('SMTP list-otps error:', err);
        res.status(500).json({ error: err.message || 'Failed to list OTPs.' });
      }
    },

    async listJobs(req, res) {
      try {
        const redis = getRedis();
        // Read last N jobs from both email and SMS streams
        const emailJobs = await redis.xread(['smtp:email:jobs'], 20, 1000);
        const smsJobs = await redis.xread(['smtp:sms:jobs'], 20, 1000);

        const format = (stream, entries) =>
          (entries || []).map(([id, fields]) => ({ id, stream, ...fields }));

        const jobs = [...format('email', emailJobs[0]?.[1] || []), ...format('sms', smsJobs[0]?.[1] || [])]
          .sort((a, b) => (b.created_at || '') > (a.created_at || '') ? 1 : -1);

        return res.json({ ok: true, jobs });
      } catch (err) {
        console.error('SMTP list-jobs error:', err);
        res.status(500).json({ error: err.message || 'Failed to list jobs.' });
      }
    }
  };

  return router;
}

/**
 * Mountable Express router factory.
 */
function smtpRouter(supabaseAdmin, adapters) {
  const express = require('express');
  const r = express.Router();
  const routes = createSmtpRoutes(supabaseAdmin, adapters);

  r.post('/unlock', rateLimit('smtp_unlock', 5, 300), routes.unlock.bind(routes));
  r.post('/send-email', requireAuth, requireAdmin, rateLimit('smtp_email', 10, 60), routes.sendEmail.bind(routes));
  r.post('/send-sms', requireAuth, requireAdmin, rateLimit('smtp_sms', 10, 60), routes.sendSms.bind(routes));
  r.post('/otp', requireAuth, requireAdmin, rateLimit('smtp_otp', 30, 60), routes.otp.bind(routes));
  r.get('/otp', requireAuth, requireAdmin, routes.listOtps.bind(routes));
  r.get('/jobs', requireAuth, requireAdmin, routes.listJobs.bind(routes));

  return r;
}

module.exports = { createSmtpRoutes, smtpRouter, encryptOtp, decryptOtp };
