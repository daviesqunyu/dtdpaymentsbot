/**
 * DTD Store — Auth, RBAC & rate-limiting middleware
 * - JWT in HttpOnly Secure SameSite=Strict cookie (admin sessions)
 * - Role-Based Access Control (admin / moderator / user)
 * - Redis-based rate limiting per IP + per user
 * - Idempotency key enforcement
 */

const jwt = require('jsonwebtoken');
const { getRedis } = require('../redis/client');

const JWT_SECRET = process.env.SMTP_JWT_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me';
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW || 60);

/** Generate a signed JWT */
function signToken(payload, expiresIn = '8h') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/** Verify a JWT, returns payload or throws */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Extract JWT from HttpOnly cookie or Bearer header */
function extractToken(req) {
  const cookie = req.cookies?.admin_session || req.cookies?.session;
  if (cookie) return cookie;
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  return null;
}

/** Middleware: require authentication (any role) */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.clearCookie('admin_session', { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

/** Middleware: require specific role(s) */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient role.' });
    }
    next();
  };
}

/** Middleware: require admin role */
const requireAdmin = requireRole('admin');

/** Rate limiter: key = prefix:ip or prefix:user:id */
function rateLimit(prefix, max = RATE_LIMIT_MAX, windowSec = RATE_LIMIT_WINDOW) {
  return async (req, res, next) => {
    const redis = getRedis();
    const ident = req.user ? `user:${req.user.sub}` : `ip:${req.ip}`;
    const key = `rate_limit:${prefix}:${ident}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + windowSec));
      if (count > max) {
        return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
      }
      next();
    } catch {
      // Redis down: allow request but don't block
      next();
    }
  };
}

/** Idempotency: check+set a key. Returns true if this is the first call. */
async function idempotencyKey(key, ttlSec = 86400) {
  const redis = getRedis();
  const lockKey = `idem:${key}`;
  const set = await redis.set(lockKey, '1', 'NX', 'EX', String(ttlSec));
  return set === 'OK';
}

/** Check if idempotency key already processed, returns stored status or null */
async function getIdempotencyStatus(key) {
  const redis = getRedis();
  return redis.get(`idem:${key}`);
}

/** Store idempotency result */
async function setIdempotencyStatus(key, status, ttlSec = 86400) {
  const redis = getRedis();
  await redis.set(`idem:${key}`, status, 'EX', String(ttlSec));
}

module.exports = {
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
};
