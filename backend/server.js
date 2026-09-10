import http from 'node:http';
import crypto from 'node:crypto';

const HOST = process.env.WANDA_HOST || '127.0.0.1';
const PORT = Number(process.env.WANDA_PORT || 8787);
const ORIGIN = process.env.WANDA_ORIGIN || 'https://lalabellabh.github.io';
const DEVICE_SECRET = process.env.WANDA_DEVICE_SECRET;
const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 10 * 60_000;
const MAX_QR_ATTEMPTS = 5;

if (!DEVICE_SECRET || Buffer.byteLength(DEVICE_SECRET) < 32) {
  console.error('WANDA_DEVICE_SECRET must be set and contain at least 32 bytes.');
  process.exit(1);
}

const challenges = new Map();
const sessions = new Map();
const attempts = new Map();

const now = () => Date.now();
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
const sign = (value) => crypto.createHmac('sha256', DEVICE_SECRET).update(value).digest('base64url');

function json(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    ...extraHeaders
  });
  res.end(data);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cleanExpired() {
  const t = now();
  for (const [id, c] of challenges) if (c.expiresAt <= t) challenges.delete(id);
  for (const [id, s] of sessions) if (s.expiresAt <= t) sessions.delete(id);
  for (const [ip, a] of attempts) if (a.resetAt <= t) attempts.delete(ip);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function issueChallenge() {
  const id = randomToken(16);
  const nonce = randomToken(32);
  const expiresAt = now() + CHALLENGE_TTL_MS;
  challenges.set(id, { nonce, expiresAt, used: false });
  // QR payload contains no permanent secret. It is useless after expiry/use.
  const payload = `wanda://unlock?v=1&id=${encodeURIComponent(id)}&nonce=${encodeURIComponent(nonce)}&exp=${expiresAt}&sig=${encodeURIComponent(sign(`${id}.${nonce}.${expiresAt}`))}`;
  return { id, payload, expiresAt };
}

function verifyChallenge(payload) {
  const u = new URL(payload);
  if (u.protocol !== 'wanda:' || u.hostname !== 'unlock') throw new Error('invalid_qr');
  const id = u.searchParams.get('id');
  const nonce = u.searchParams.get('nonce');
  const exp = Number(u.searchParams.get('exp'));
  const sig = u.searchParams.get('sig');
  const c = challenges.get(id);
  if (!c || c.used || c.expiresAt !== exp || exp <= now()) throw new Error('expired_or_used');
  if (!safeEqual(c.nonce, nonce || '')) throw new Error('challenge_mismatch');
  if (!safeEqual(sign(`${id}.${nonce}.${exp}`), sig || '')) throw new Error('bad_signature');
  c.used = true;
  return { id, exp };
}

function newSession() {
  const id = randomToken(32);
  sessions.set(id, { id, createdAt: now(), expiresAt: now() + SESSION_TTL_MS });
  return id;
}

function authenticated(req) {
  const sid = parseCookies(req).wanda_session;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s || s.expiresAt <= now()) {
    if (s) sessions.delete(sid);
    return null;
  }
  return s;
}

const server = http.createServer(async (req, res) => {
  cleanExpired();
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'wanda-backend' });
    }

    if (url.pathname === '/auth/challenge' && req.method === 'POST') {
      return json(res, 200, { ok: true, ...issueChallenge() });
    }

    if (url.pathname === '/auth/qr/verify' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const a = attempts.get(ip) || { count: 0, resetAt: now() + 60_000 };
      if (a.resetAt <= now()) { a.count = 0; a.resetAt = now() + 60_000; }
      if (a.count >= MAX_QR_ATTEMPTS) return json(res, 429, { ok: false, error: 'rate_limited' });
      a.count += 1;
      attempts.set(ip, a);

      const body = await readJson(req);
      if (typeof body.payload !== 'string' || body.payload.length > 4096) return json(res, 400, { ok: false, error: 'invalid_payload' });
      verifyChallenge(body.payload);
      const sid = newSession();
      attempts.delete(ip);
      return json(res, 200, { ok: true, expiresAt: sessions.get(sid).expiresAt }, {
        'Set-Cookie': `wanda_session=${encodeURIComponent(sid)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`
      });
    }

    if (url.pathname === '/auth/session' && req.method === 'GET') {
      const s = authenticated(req);
      if (!s) return json(res, 401, { ok: false, error: 'unauthorized' });
      return json(res, 200, { ok: true, expiresAt: s.expiresAt });
    }

    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      const sid = parseCookies(req).wanda_session;
      if (sid) sessions.delete(sid);
      return json(res, 200, { ok: true }, {
        'Set-Cookie': 'wanda_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
      });
    }

    if (url.pathname === '/ops/prepare' && req.method === 'POST') {
      const s = authenticated(req);
      if (!s) return json(res, 401, { ok: false, error: 'unauthorized' });
      return json(res, 501, { ok: false, error: 'prepare_not_implemented' });
    }

    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.warn('request_denied', error.message);
    return json(res, 400, { ok: false, error: 'request_denied' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wanda backend listening on http://${HOST}:${PORT}`);
});
