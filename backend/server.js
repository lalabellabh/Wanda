import http from 'node:http';
import crypto from 'node:crypto';

const HOST = process.env.WANDA_HOST || '127.0.0.1';
const PORT = Number(process.env.WANDA_PORT || 8787);
const ORIGIN = process.env.WANDA_ORIGIN || 'https://lalabellabh.github.io';
const DEVICE_SECRET = process.env.WANDA_DEVICE_SECRET;
const PASSWORD_HASH = process.env.WANDA_PASSWORD_HASH;
const CHALLENGE_TTL_MS = 60_000;
const SESSION_TTL_MS = 10 * 60_000;
const TRUST_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_QR_ATTEMPTS = 5;
const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_ORDER_HISTORY = 50;

if (!DEVICE_SECRET || Buffer.byteLength(DEVICE_SECRET) < 32) {
  console.error('WANDA_DEVICE_SECRET must be set and contain at least 32 bytes.');
  process.exit(1);
}

const challenges = new Map();
const sessions = new Map();
const trustedDevices = new Map();
const qrAttempts = new Map();
const passwordAttempts = new Map();

const orderState = {
  agentOnline: false,
  currentOrder: null,
  history: [],
  updatedAt: null
};

const orderClients = new Set();

const now = () => Date.now();
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('base64url');
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
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
  for (const [id, d] of trustedDevices) if (d.expiresAt <= t) trustedDevices.delete(id);
  for (const [ip, a] of qrAttempts) if (a.resetAt <= t) qrAttempts.delete(ip);
  for (const [ip, a] of passwordAttempts) if (a.resetAt <= t) passwordAttempts.delete(ip);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function issueChallenge() {
  const id = randomToken(16);
  const nonce = randomToken(32);
  const expiresAt = now() + CHALLENGE_TTL_MS;
  challenges.set(id, { nonce, expiresAt, used: false });
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

async function verifyPassword(password) {
  if (!PASSWORD_HASH) throw new Error('password_auth_not_configured');
  const parts = PASSWORD_HASH.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') throw new Error('invalid_password_configuration');
  const params = Object.fromEntries(parts[1].split(',').map(part => part.split('=')));
  const N = Number(params.N);
  const r = Number(params.r);
  const p = Number(params.p);
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p) || !salt.length || !expected.length) throw new Error('invalid_password_configuration');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
  return safeEqual(derived, expected);
}

function passwordLimiter(ip) {
  const a = passwordAttempts.get(ip) || { count: 0, resetAt: now() + 60_000 };
  if (a.resetAt <= now()) {
    a.count = 0;
    a.resetAt = now() + 60_000;
  }
  a.count += 1;
  passwordAttempts.set(ip, a);
  return a.count <= MAX_PASSWORD_ATTEMPTS;
}

function trustedDevice(token) {
  if (!token || token.length < 32 || token.length > 256) return null;
  const record = trustedDevices.get(hashToken(token));
  if (!record || record.expiresAt <= now()) return null;
  return record;
}

function trustDevice() {
  const token = randomToken(32);
  trustedDevices.set(hashToken(token), {
    createdAt: now(),
    expiresAt: now() + TRUST_TTL_MS
  });
  return token;
}

function broadcastOrder(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of orderClients) {
    try {
      res.write(data);
    } catch {
      orderClients.delete(res);
    }
  }
}

function normalizeOrder(body) {
  const order = body?.order && typeof body.order === 'object'
    ? body.order
    : body;

  const orderId = String(order?.orderId || '').trim();
  if (!orderId || orderId.length > 100) return null;

  const address = String(order?.address || '').trim().slice(0, 2000);
  const decision = order?.decision && typeof order.decision === 'object'
    ? {
        branch: order.decision.branch ? String(order.decision.branch).slice(0, 100) : null,
        method: order.decision.method ? String(order.decision.method).slice(0, 50) : null,
        confidence: order.decision.confidence ? String(order.decision.confidence).slice(0, 50) : null,
        distanceKm: Number.isFinite(Number(order.decision.distanceKm)) ? Number(order.decision.distanceKm) : null
      }
    : null;

  return {
    orderId,
    address,
    decision,
    timestamp: new Date().toISOString()
  };
}

function acceptOrderEvent(body) {
  if (body?.agent === 'wanda-order-agent') {
    orderState.agentOnline = true;
  }

  const order = normalizeOrder(body);
  if (!order) return null;

  orderState.currentOrder = order;
  orderState.updatedAt = order.timestamp;
  orderState.history = [
    order,
    ...orderState.history.filter(item => item.orderId !== order.orderId)
  ].slice(0, MAX_ORDER_HISTORY);

  broadcastOrder({
    type: 'order',
    order
  });

  return order;
}

const server = http.createServer(async (req, res) => {
  cleanExpired();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true'
    });
    return res.end();
  }

  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        service: 'wanda-backend',
        ordersAgentOnline: orderState.agentOnline
      });
    }

    if (url.pathname === '/auth/challenge' && req.method === 'POST') {
      return json(res, 200, { ok: true, ...issueChallenge() });
    }

    if (url.pathname === '/auth/qr/verify' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const a = qrAttempts.get(ip) || { count: 0, resetAt: now() + 60_000 };
      if (a.resetAt <= now()) {
        a.count = 0;
        a.resetAt = now() + 60_000;
      }
      if (a.count >= MAX_QR_ATTEMPTS) return json(res, 429, { ok: false, error: 'rate_limited' });
      a.count += 1;
      qrAttempts.set(ip, a);
      const body = await readJson(req);
      if (typeof body.payload !== 'string' || body.payload.length > 4096) return json(res, 400, { ok: false, error: 'invalid_payload' });
      verifyChallenge(body.payload);
      const sid = newSession();
      qrAttempts.delete(ip);
      return json(res, 200, { ok: true, expiresAt: sessions.get(sid).expiresAt }, {
        'Set-Cookie': `wanda_session=${encodeURIComponent(sid)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`
      });
    }

    if (url.pathname === '/auth/qr/owner-verify' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.ownerQr !== 'WANDA-OWNER-ID:v1|name=Benjamin Gutierrez JR') return json(res, 401, { ok: false, error: 'invalid_owner_qr' });
      if (!trustedDevice(body.deviceToken)) return json(res, 401, { ok: false, error: 'device_not_trusted' });
      const sid = newSession();
      return json(res, 200, { ok: true, expiresAt: sessions.get(sid).expiresAt }, {
        'Set-Cookie': `wanda_session=${encodeURIComponent(sid)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`
      });
    }

    if (url.pathname === '/auth/password/verify' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!passwordLimiter(ip)) return json(res, 429, { ok: false, error: 'rate_limited' });
      const body = await readJson(req);
      if (typeof body.password !== 'string' || body.password.length < 15 || Buffer.byteLength(body.password, 'utf8') > 1024) return json(res, 401, { ok: false, error: 'invalid_credentials' });
      let valid = false;
      try {
        valid = await verifyPassword(body.password);
      } catch (error) {
        console.warn('password_auth_error', error.message);
        return json(res, 503, { ok: false, error: 'password_auth_unavailable' });
      }
      if (!valid) return json(res, 401, { ok: false, error: 'invalid_credentials' });
      passwordAttempts.delete(ip);
      const sid = newSession();
      const headers = {
        'Set-Cookie': `wanda_session=${encodeURIComponent(sid)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`
      };
      let deviceToken;
      if (body.trustDevice === true) deviceToken = trustDevice();
      return json(res, 200, { ok: true, expiresAt: sessions.get(sid).expiresAt, deviceToken }, headers);
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

    /* =======================================================
       ORDERS BRIDGE
       Local-only backend receives observations from the browser
       Order Agent and streams them to the Command Center.
    ======================================================= */

    if (url.pathname === '/orders/state' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        agentOnline: orderState.agentOnline,
        currentOrder: orderState.currentOrder,
        history: orderState.history,
        updatedAt: orderState.updatedAt
      });
    }

    if (url.pathname === '/orders/event' && req.method === 'POST') {
      const body = await readJson(req);
      const order = acceptOrderEvent(body);

      if (!order) {
        return json(res, 400, {
          ok: false,
          error: 'invalid_order'
        });
      }

      return json(res, 200, {
        ok: true,
        received: true,
        order
      });
    }

    if (url.pathname === '/orders/agent' && req.method === 'POST') {
      const body = await readJson(req);
      orderState.agentOnline = body?.online !== false;
      orderState.updatedAt = new Date().toISOString();

      broadcastOrder({
        type: 'agent_status',
        online: orderState.agentOnline,
        updatedAt: orderState.updatedAt
      });

      return json(res, 200, {
        ok: true,
        online: orderState.agentOnline
      });
    }

    if (url.pathname === '/orders/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': ORIGIN,
        'Access-Control-Allow-Credentials': 'true'
      });

      res.write(`data: ${JSON.stringify({
        type: 'agent_status',
        online: orderState.agentOnline,
        updatedAt: orderState.updatedAt
      })}\n\n`);

      if (orderState.currentOrder) {
        res.write(`data: ${JSON.stringify({
          type: 'order',
          order: orderState.currentOrder
        })}\n\n`);
      }

      orderClients.add(res);

      req.on('close', () => {
        orderClients.delete(res);
      });

      return;
    }

    if (url.pathname === '/orders/clear' && req.method === 'POST') {
      orderState.currentOrder = null;
      orderState.history = [];
      orderState.updatedAt = new Date().toISOString();

      broadcastOrder({
        type: 'orders_cleared',
        updatedAt: orderState.updatedAt
      });

      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/ops/prepare' && req.method === 'POST') {
      const s = authenticated(req);
      if (!s) return json(res, 401, { ok: false, error: 'unauthorized' });
      return json(res, 501, { ok: false, error: 'prepare_not_implemented' });
    }

    return json(res, 404, {
      ok: false,
      error: 'not_found'
    });
  } catch (error) {
    console.warn('request_denied', error.message);
    return json(res, 400, {
      ok: false,
      error: 'request_denied'
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `Wanda backend listening on http://${HOST}:${PORT}`
  );
});
