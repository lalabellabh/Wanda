'use strict';

const WA_WATCHER = 'http://127.0.0.1:8790';
let waEvents = null;

function waEsc(value) {
  const d = document.createElement('div');
  d.textContent = String(value ?? '');
  return d.innerHTML;
}

function waClass(category) {
  return category === 'urgent' ? 'urgent' : category === 'potential_order' ? 'potential' : category === 'inquiry' ? 'inquiry' : 'info';
}

function ensurePanel() {
  if (document.getElementById('waWatcherPanel')) return document.getElementById('waWatcherPanel');
  const side = document.querySelector('.side-column');
  if (!side) return null;
  const panel = document.createElement('section');
  panel.id = 'waWatcherPanel';
  panel.className = 'card tasks-card wa-watcher-panel';
  panel.innerHTML = `
    <div class="section-heading compact"><div><p class="eyebrow">WHATSAPP WATCHER</p><h3>Message Monitor</h3></div><span id="waStatusBadge" class="tiny muted">OFFLINE</span></div>
    <div class="wa-summary"><div><b id="waMessageCount">0</b><small>messages logged</small></div><div><b id="waOrderCount">0</b><small>potential orders</small></div></div>
    <div id="waQrBox" class="wa-qr hidden"><span>Waiting for WhatsApp QR…</span></div>
    <div id="waFeed" class="wa-feed"><div class="activity-empty"><strong>No WhatsApp messages yet</strong><small>Start the local watcher and scan WhatsApp Web.</small></div></div>`;
  side.insertBefore(panel, side.firstChild);
  return panel;
}

function setSystemConnection(status, error = '') {
  const rows = document.querySelectorAll('.system-list .system-row');
  let row = null;
  rows.forEach(candidate => {
    const name = candidate.querySelector('b');
    if (name && name.textContent.trim().toLowerCase() === 'whatsapp') row = candidate;
  });
  if (!row) return;

  const text = row.querySelector('span:not(.system-icon)');
  const dot = row.querySelector('.connection-dot');
  const connected = status === 'connected';
  const qrReady = status === 'qr_ready';
  const starting = status === 'starting' || status === 'authenticated';

  if (text) {
    if (connected) text.textContent = 'Connected · Local watcher';
    else if (qrReady) text.textContent = 'QR ready · Scan WhatsApp';
    else if (starting) text.textContent = 'Watcher starting…';
    else if (status === 'auth_failure') text.textContent = 'Authentication failed';
    else if (status === 'disconnected') text.textContent = 'WhatsApp disconnected';
    else if (status === 'error') text.textContent = 'Watcher error';
    else text.textContent = 'Watcher offline';
    if (error) text.title = error;
  }

  if (dot) {
    dot.classList.toggle('online', connected);
    dot.classList.toggle('warning', qrReady || starting);
    dot.classList.toggle('error', status === 'error' || status === 'auth_failure' || status === 'disconnected');
  }
}

function setWaStatus(status, error = '') {
  const badge = document.getElementById('waStatusBadge');
  if (badge) {
    const labels = { connected: '● CONNECTED', qr_ready: 'QR READY', authenticated: 'AUTHENTICATING', starting: 'STARTING', disconnected: 'DISCONNECTED', error: 'ERROR', auth_failure: 'AUTH FAILED' };
    badge.textContent = labels[status] || String(status || 'OFFLINE').toUpperCase();
    badge.title = error || '';
  }
  setSystemConnection(status, error);
}

function showQr(qr) {
  const box = document.getElementById('waQrBox');
  if (!box) return;
  if (!qr) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<img src="${qr}" alt="WhatsApp login QR" style="width:min(220px,100%);height:auto;display:block;margin:0 auto;"><small>Scan this with the Lalabella WhatsApp phone.</small>`;
}

function renderMessage(m, prepend = true) {
  const feed = document.getElementById('waFeed');
  if (!feed) return;
  if (feed.querySelector('.activity-empty')) feed.innerHTML = '';
  const row = document.createElement('article');
  row.className = `wa-message ${waClass(m.classification)}`;
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `<div class="wa-message-top"><b>${waEsc(m.chatName)}</b><span>${waEsc(time)}</span></div><div class="wa-message-meta"><span>${m.isGroup ? 'GROUP' : 'CUSTOMER'}</span><strong>${waEsc(m.classificationLabel)}</strong></div><p>${waEsc(m.body || '[media]')}</p>`;
  if (prepend) feed.prepend(row); else feed.appendChild(row);
  while (feed.children.length > 30) feed.lastElementChild.remove();
}

async function refreshWa() {
  try {
    const response = await fetch(`${WA_WATCHER}/status`, { cache: 'no-store' });
    const data = await response.json();
    setWaStatus(data.status, data.lastError);
    showQr(data.qr);
    const count = document.getElementById('waMessageCount');
    if (count) count.textContent = data.messageCount ?? 0;
    if (data.status === 'connected') {
      const r = await fetch(`${WA_WATCHER}/messages?limit=30`, { cache: 'no-store' });
      const payload = await r.json();
      const feed = document.getElementById('waFeed');
      if (feed) feed.innerHTML = '';
      let potential = 0;
      (payload.messages || []).slice().reverse().forEach(m => { if (m.classification === 'potential_order') potential++; renderMessage(m, false); });
      const orderCount = document.getElementById('waOrderCount');
      if (orderCount) orderCount.textContent = potential;
    }
  } catch (_) {
    setWaStatus('offline');
  }
}

function startWaEvents() {
  try {
    waEvents = new EventSource(`${WA_WATCHER}/events`);
    waEvents.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status') { setWaStatus(data.status, data.error); showQr(data.qr); }
        if (data.type === 'message') {
          renderMessage(data.message, true);
          const count = document.getElementById('waMessageCount');
          if (count) count.textContent = String(Number(count.textContent || 0) + 1);
          if (data.message.classification === 'potential_order') {
            const orderCount = document.getElementById('waOrderCount');
            if (orderCount) orderCount.textContent = String(Number(orderCount.textContent || 0) + 1);
          }
        }
      } catch (_) {}
    };
    waEvents.onerror = () => setWaStatus('offline');
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  ensurePanel();
  refreshWa();
  startWaEvents();
  setInterval(refreshWa, 15000);
});
