/**
 * DTD Store — Redis client factory
 * Supports ioredis (Express/VPS) and Upstash REST (Cloudflare Workers edge).
 * Falls back to an in-memory map when Redis is unavailable (dev only).
 */

let redis = null;
let memoryFallback = null;

function getRedis(env = process.env) {
  if (redis) return redis;

  const url = env.REDIS_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  // Prefer Upstash REST when URL/token provided (edge-friendly)
  if (url && token) {
    redis = new UpstashRedisClient(url, token);
    return redis;
  }

  // ioredis for TCP Redis (VPS / local)
  const redisUrl = env.REDIS_URL || 'redis://127.0.0.1:6379';
  try {
    const IORedis = require('ioredis');
    redis = new IORedis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000)
    });
    redis.connect().catch(() => {});
    return redis;
  } catch {
    /* fall through to memory fallback */
  }

  memoryFallback = new MemoryRedis();
  return memoryFallback;
}

class UpstashRedisClient {
  constructor(url, token) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  async _request(method, path, body) {
    const resp = await fetch(`${this.url}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return resp.json();
  }

  async get(key) {
    const data = await this._request('GET', `get/${key}`);
    return data.result;
  }

  async set(key, value, ...opts) {
    let ex = null;
    let nx = false;
    for (const o of opts) {
      if (o === 'NX') nx = true;
      if (o === 'EX') ex = opts[opts.indexOf(o) + 1];
    }
    const body = nx ? { key, value, ex, nx: true } : { key, value, ex };
    await this._request('POST', 'set', body);
    return 'OK';
  }

  async del(key) {
    await this._request('POST', 'del', { keys: [key] });
    return 1;
  }

  async incr(key) {
    const data = await this._request('POST', 'incr', { key });
    return data.result;
  }

  async expire(key, seconds) {
    await this._request('POST', 'expire', { key, seconds });
    return 1;
  }

  async xadd(stream, ...fieldsAndValues) {
    const body = { stream, id: '*' };
    for (let i = 0; i < fieldsAndValues.length; i += 2) {
      body[fieldsAndValues[i]] = fieldsAndValues[i + 1];
    }
    const data = await this._request('POST', 'xadd', body);
    return data.result;
  }

  async xread(streams, count = 10, block = 5000) {
    const body = { streams, count, block };
    const data = await this._request('POST', 'xread', body);
    return data.result || [];
  }

  async xack(stream, group, ...ids) {
    await this._request('POST', 'xack', { stream, group, ids });
  }

  async xgroupCreate(stream, group, id = '$', mkstream = true) {
    try {
      await this._request('POST', 'xgroup', { create: group, stream, id, mkstream });
    } catch { /* group may already exist */ }
  }

  async xreadgroup(group, consumer, streams, count = 10, block = 5000) {
    const body = { group, consumer, streams, count, block };
    const data = await this._request('POST', 'xreadgroup', body);
    return data.result || [];
  }
}

class MemoryRedis {
  constructor() {
    this.store = new Map();
    this.expiries = new Map();
  }

  _key(key) { return `mem:${key}`; }

  async get(key) {
    const exp = this.expiries.get(this._key(key));
    if (exp && Date.now() > exp) {
      this.store.delete(this._key(key));
      this.expiries.delete(this._key(key));
      return null;
    }
    return this.store.get(this._key(key)) ?? null;
  }

  async set(key, value, ...opts) {
    let ex = null;
    let nx = false;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i] === 'NX') nx = true;
      if (opts[i] === 'EX') ex = Number(opts[i + 1]) * 1000;
    }
    if (nx && this.store.has(this._key(key))) return null;
    this.store.set(this._key(key), value);
    if (ex) this.expiries.set(this._key(key), Date.now() + ex);
    return 'OK';
  }

  async del(key) {
    this.store.delete(this._key(key));
    this.expiries.delete(this._key(key));
    return 1;
  }

  async incr(key) {
    const cur = Number(await this.get(key) || 0);
    const next = cur + 1;
    await this.set(this._key(key).replace('mem:', ''), String(next));
    return next;
  }

  async expire(key, seconds) {
    this.expiries.set(this._key(key), Date.now() + seconds * 1000);
    return 1;
  }

  async xadd(stream, ...fieldsAndValues) {
    const id = `${Date.now()}-0`;
    const entry = { id, fields: {} };
    for (let i = 0; i < fieldsAndValues.length; i += 2) {
      entry.fields[fieldsAndValues[i]] = fieldsAndValues[i + 1];
    }
    const list = this.store.get(this._key(stream)) || [];
    list.push(entry);
    if (list.length > 10000) list.shift();
    this.store.set(this._key(stream), list);
    return id;
  }

  async xread(streams, count = 10, block = 5000) {
    const results = [];
    for (const stream of streams) {
      const list = this.store.get(this._key(stream)) || [];
      results.push([stream, list.slice(-count).map(e => [e.id, e.fields])]);
    }
    return results;
  }

  async xack(stream, group, ...ids) { return ids.length; }
  async xgroupCreate() { /* no-op */ }
  async xreadgroup() { return []; }
}

module.exports = { getRedis };
