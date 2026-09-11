import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;
const HOST = process.env.WANDA_WA_HOST || '127.0.0.1';
const PORT = Number(process.env.WANDA_WA_PORT || 8790);
const MAX_MESSAGES = 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'whatsapp-data');
const LOG_FILE = path.join(DATA_DIR, 'messages.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

let status = 'starting';
let qrDataUrl = null;
let lastError = null;
const messages = loadMessages();
const clients = new Set();

function loadMessages() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch { return []; }
}

function persist() {
  fs.writeFileSync(LOG_FILE, JSON.stringify(messages.slice(-MAX_MESSAGES), null, 2), 'utf8');
}

function classify(text) {
  const s = String(text || '').toLowerCase();
  const order = /(want to order|i want to order|place an order|make an order|to order|order flowers|order bouquet|i'd like to order|would like to order|can i order|how can i order)/i.test(s);
  const urgency = /(urgent|asap|emergency|right now|immediately|today.*delivery|delivery.*today)/i.test(s);
  const question = /[?]|\b(can you|do you|is there|how much|how can|where|when|what|which|available|availability|price|cost|delivery)\b/i.test(s);
  if (urgency) return { category: 'urgent', label: 'Urgent', score: 0.95 };
  if (order) return { category: 'potential_order', label: 'Potential Order', score: 0.92 };
  if (question) return { category: 'inquiry', label: 'Customer Inquiry', score: 0.82 };
  return { category: 'informational', label: 'Informational', score: 0.55 };
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}

function addMessage(msg) {
  messages.push(msg);
  while (messages.length > MAX_MESSAGES) messages.shift();
  try { persist(); } catch (error) { lastError = `log_write_failed: ${error.message}`; }
  broadcast({ type: 'message', message: msg });
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', async qr => {
  status = 'qr_ready';
  qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
  broadcast({ type: 'status', status, qr: qrDataUrl });
});

client.on('authenticated', () => {
  status = 'authenticated';
  qrDataUrl = null;
  broadcast({ type: 'status', status });
});

client.on('ready', () => {
  status = 'connected';
  qrDataUrl = null;
  lastError = null;
  broadcast({ type: 'status', status });
});

client.on('auth_failure', message => {
  status = 'auth_failure';
  lastError = String(message || 'WhatsApp authentication failed');
  broadcast({ type: 'status', status, error: lastError });
});

client.on('disconnected', reason => {
  status = 'disconnected';
  lastError = String(reason || 'WhatsApp disconnected');
  broadcast({ type: 'status', status, error: lastError });
});

client.on('message', async message => {
  try {
    const chat = await message.getChat();
    const contact = await message.getContact();
    const classification = classify(message.body);
    const record = {
      id: message.id?._serialized || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date((message.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
      chatId: chat.id?._serialized || '',
      chatName: chat.isGroup ? (chat.name || 'WhatsApp Group') : (contact.pushname || contact.name || message.from || 'Customer'),
      isGroup: Boolean(chat.isGroup),
      sender: contact.pushname || contact.name || message.author || message.from || 'Unknown',
      senderId: message.author || message.from || '',
      type: message.type || 'chat',
      body: message.body || '',
      classification: classification.category,
      classificationLabel: classification.label,
      score: classification.score,
      hasMedia: Boolean(message.hasMedia)
    };
    addMessage(record);
  } catch (error) {
    lastError = `message_capture_failed: ${error.message}`;
  }
});

client.initialize().catch(error => {
  status = 'error';
  lastError = error.message;
  broadcast({ type: 'status', status, error: lastError });
});

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/health') return json(res, 200, { ok: true, service: 'whatsapp-watcher', status, lastError });
  if (url.pathname === '/status') return json(res, 200, { ok: true, status, qr: qrDataUrl, lastError, messageCount: messages.length });
  if (url.pathname === '/messages') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), MAX_MESSAGES);
    return json(res, 200, { ok: true, messages: messages.slice(-limit).reverse() });
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(`data: ${JSON.stringify({ type: 'status', status, qr: qrDataUrl, error: lastError })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  return json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, HOST, () => console.log(`WhatsApp watcher listening on http://${HOST}:${PORT}`));
