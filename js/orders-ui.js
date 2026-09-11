'use strict';

/*
 * Wanda Orders Monitor
 *
 * The Tampermonkey order agent publishes live order observations to the
 * local Wanda backend. This file renders those events in the Command Center.
 * It does not assign orders and it does not click the Lalabella website.
 */

const WANDA_ORDER_API = 'http://127.0.0.1:8787';
let wandaOrderEvents = null;
let wandaOrderHistory = [];
let wandaCurrentOrder = null;

function orderEl(id) {
  return document.getElementById(id);
}

function orderEsc(value) {
  const d = document.createElement('div');
  d.textContent = String(value ?? '');
  return d.innerHTML;
}

function injectOrderStyles() {
  if (document.getElementById('wanda-orders-style')) return;

  const style = document.createElement('style');
  style.id = 'wanda-orders-style';
  style.textContent = `
    .orders-monitor-panel { overflow: hidden; }
    .orders-monitor-state { display:flex; align-items:center; gap:9px; padding:9px 10px; border:1px solid rgba(150,94,133,.25); border-radius:12px; background:rgba(10,8,13,.55); margin-bottom:10px; }
    .orders-monitor-state b, .orders-monitor-state small { display:block; }
    .orders-monitor-state b { font-size:10px; }
    .orders-monitor-state small { font-size:8px; opacity:.48; margin-top:2px; }
    .orders-live-dot { width:7px; height:7px; flex:0 0 7px; border-radius:50%; background:#687080; box-shadow:0 0 7px rgba(104,112,128,.25); }
    .orders-live-dot.online { background:#62e9a8; box-shadow:0 0 10px rgba(98,233,168,.7); animation: ordersPulse 1.8s ease-in-out infinite; }
    .orders-current { border:1px solid rgba(177,103,151,.3); border-radius:14px; background:linear-gradient(145deg,rgba(32,17,32,.95),rgba(14,9,17,.95)); padding:11px; }
    .orders-empty { min-height:86px; display:grid; place-content:center; justify-items:center; gap:4px; text-align:center; opacity:.55; }
    .orders-empty span { font-size:22px; color:#f0a6c7; }
    .orders-empty strong { font-size:10px; }
    .orders-empty small { font-size:8px; opacity:.7; }
    .orders-current-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
    .orders-current-top strong { display:block; font-size:18px; margin-top:2px; }
    .orders-current-label { display:block; font-size:7px; letter-spacing:.12em; font-weight:900; color:#ff9fc8; opacity:.72; }
    .orders-time { font-size:8px; opacity:.45; }
    .orders-address { margin:9px 0; padding:8px; border-radius:9px; background:rgba(7,6,10,.65); border:1px solid rgba(164,104,146,.2); font-size:9px; line-height:1.45; word-break:break-word; }
    .orders-branch { display:flex; align-items:center; gap:8px; padding:9px; border-radius:10px; border:1px solid rgba(164,104,146,.25); background:rgba(35,19,40,.75); }
    .orders-branch small { display:block; font-size:7px; letter-spacing:.1em; opacity:.48; }
    .orders-branch b { display:block; font-size:14px; margin-top:2px; }
    .orders-branch.moda b { color:#ffb3d1; }
    .orders-branch.qalali b { color:#a9e8ff; }
    .orders-branch.hamala b { color:#b6f0c9; }
    .orders-branch.review b { color:#ffd38f; }
    .orders-meta { display:flex; justify-content:space-between; gap:8px; margin-top:8px; font-size:8px; opacity:.6; }
    .orders-meta b { opacity:1; color:#eee5f2; }
    .orders-history-head { display:flex; justify-content:space-between; align-items:center; margin:12px 2px 6px; font-size:7px; letter-spacing:.12em; font-weight:900; opacity:.48; }
    .orders-history-head b { font-size:9px; }
    .orders-history { max-height:170px; overflow:auto; border:1px solid rgba(150,94,133,.2); border-radius:11px; background:rgba(8,6,11,.5); }
    .orders-history-empty { padding:14px; text-align:center; font-size:8px; opacity:.4; }
    .orders-history-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-bottom:1px solid rgba(150,94,133,.16); }
    .orders-history-row:last-child { border-bottom:0; }
    .orders-history-row b { display:block; font-size:9px; }
    .orders-history-row small { display:block; font-size:7px; opacity:.48; margin-top:2px; }
    .orders-history-arrow { font-size:17px; opacity:.35; }
    @keyframes ordersPulse { 0%,100% { transform:scale(1); opacity:.7; } 50% { transform:scale(1.35); opacity:1; } }
  `;
  document.head.appendChild(style);
}

function orderPanel() {
  if (orderEl('ordersMonitorPanel')) return orderEl('ordersMonitorPanel');

  const side = document.querySelector('.side-column');
  if (!side) return null;

  const panel = document.createElement('section');
  panel.id = 'ordersMonitorPanel';
  panel.className = 'card tasks-card orders-monitor-panel';
  panel.innerHTML = `
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">ORDERS WATCHER</p>
        <h3>Live Order Monitor</h3>
      </div>
      <span id="ordersMonitorBadge" class="tiny muted">OFFLINE</span>
    </div>

    <div class="orders-monitor-state">
      <span id="ordersMonitorDot" class="orders-live-dot"></span>
      <div>
        <b id="ordersMonitorState">Waiting for Wanda Agent</b>
        <small id="ordersMonitorDetail">Start the Lalabella Order Watcher.</small>
      </div>
    </div>

    <div class="orders-current" id="ordersCurrentBox">
      <div class="orders-empty">
        <span>▣</span>
        <strong>No unassigned order detected</strong>
        <small>Wanda is watching for a new order.</small>
      </div>
    </div>

    <div class="orders-history-head">
      <span>RECENT ORDERS</span>
      <b id="ordersHistoryCount">0</b>
    </div>

    <div id="ordersHistory" class="orders-history">
      <div class="orders-history-empty">No order events yet.</div>
    </div>
  `;

  side.insertBefore(panel, side.firstChild);
  return panel;
}

function setOrdersSystem(online, detail = '') {
  const rows = document.querySelectorAll('.system-list .system-row');
  let row = null;

  rows.forEach(candidate => {
    const name = candidate.querySelector('b');
    if (name && name.textContent.trim().toLowerCase() === 'orders') row = candidate;
  });

  if (!row) return;

  const text = row.querySelector('span:not(.system-icon)');
  const dot = row.querySelector('.connection-dot');

  if (text) {
    text.textContent = online
      ? detail || 'Connected · Wanda Order Agent'
      : 'Watcher offline';
  }

  if (dot) {
    dot.classList.toggle('online', online);
    dot.classList.toggle('error', !online);
  }
}

function setOrdersStatus(online, detail = '') {
  const badge = orderEl('ordersMonitorBadge');
  const state = orderEl('ordersMonitorState');
  const detailEl = orderEl('ordersMonitorDetail');
  const dot = orderEl('ordersMonitorDot');

  if (badge) badge.textContent = online ? '● CONNECTED' : 'OFFLINE';
  if (state) state.textContent = online ? 'Wanda Order Agent connected' : 'Waiting for Wanda Agent';
  if (detailEl) detailEl.textContent = detail || (online ? 'Live order events are ready.' : 'Start the Lalabella Order Watcher.');
  if (dot) dot.classList.toggle('online', online);

  setOrdersSystem(online, detail);
}

function orderBranchClass(branch) {
  const n = String(branch || '').toLowerCase();
  if (n.includes('moda')) return 'moda';
  if (n.includes('qalali')) return 'qalali';
  if (n.includes('hamala')) return 'hamala';
  return 'review';
}

function renderCurrentOrder(order) {
  const box = orderEl('ordersCurrentBox');
  if (!box) return;

  if (!order) {
    box.innerHTML = `
      <div class="orders-empty">
        <span>▣</span>
        <strong>No unassigned order detected</strong>
        <small>Wanda is watching for a new order.</small>
      </div>
    `;
    return;
  }

  const branch = order.decision?.branch || '';
  const method = order.decision?.method || 'pending';
  const confidence = order.decision?.confidence || 'pending';
  const branchClass = orderBranchClass(branch);
  const time = order.timestamp
    ? new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  box.innerHTML = `
    <div class="orders-current-top">
      <div>
        <span class="orders-current-label">NEW / UNASSIGNED</span>
        <strong>${orderEsc(order.orderId || 'Unknown')}</strong>
      </div>
      <span class="orders-time">${orderEsc(time)}</span>
    </div>

    <div class="orders-address">
      ${orderEsc(order.address || 'Address not detected')}
    </div>

    <div class="orders-branch ${branchClass}">
      <span>📍</span>
      <div>
        <small>RECOMMENDED BRANCH</small>
        <b>${orderEsc(branch || 'NEEDS REVIEW')}</b>
      </div>
    </div>

    <div class="orders-meta">
      <span>Method <b>${orderEsc(method)}</b></span>
      <span>Confidence <b>${orderEsc(confidence)}</b></span>
    </div>
  `;
}

function renderOrderHistory() {
  const box = orderEl('ordersHistory');
  const count = orderEl('ordersHistoryCount');
  if (!box) return;

  if (count) count.textContent = String(wandaOrderHistory.length);

  if (!wandaOrderHistory.length) {
    box.innerHTML = '<div class="orders-history-empty">No order events yet.</div>';
    return;
  }

  box.innerHTML = wandaOrderHistory.slice(0, 15).map(order => {
    const branch = order.decision?.branch || 'Needs Review';
    const time = order.timestamp
      ? new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    return `
      <article class="orders-history-row">
        <div>
          <b>${orderEsc(order.orderId || 'Unknown')}</b>
          <small>${orderEsc(time)} · ${orderEsc(branch)}</small>
        </div>
        <span class="orders-history-arrow">›</span>
      </article>
    `;
  }).join('');
}

function isCommandCenterUnlocked() {
  const ops = orderEl('opsPanel');
  return Boolean(
    ops &&
    !ops.classList.contains('hidden') &&
    ops.getAttribute('aria-hidden') !== 'true'
  );
}

function wandaSpeakOrder(order) {
  if (!isCommandCenterUnlocked()) return;
  if (typeof window.WandaSpeak !== 'function') return;

  const cleanNumber = String(order.orderId || 'order').replace(/^#/, '');
  const branch = order.decision?.branch;

  if (branch) {
    window.WandaSpeak(
      `New order detected. Order number ${cleanNumber}. Recommended branch: ${branch}.`
    );
  } else {
    window.WandaSpeak(
      `Attention. Order number ${cleanNumber} needs review. I could not determine the correct branch.`
    );
  }
}

function handleOrderEvent(event) {
  if (!event || event.type !== 'order') return;

  const order = event.order;
  if (!order?.orderId) return;

  wandaCurrentOrder = order;
  wandaOrderHistory = [
    order,
    ...wandaOrderHistory.filter(x => x.orderId !== order.orderId)
  ].slice(0, 50);

  renderCurrentOrder(order);
  renderOrderHistory();

  const detail = order.decision?.branch
    ? `Order ${order.orderId} · ${order.decision.branch}`
    : `Order ${order.orderId} · Needs Review`;

  setOrdersStatus(true, detail);
  wandaSpeakOrder(order);

  if (typeof window.WandaActivity === 'function') {
    window.WandaActivity(
      `Order ${order.orderId} detected`,
      order.decision?.branch
        ? `Recommended ${order.decision.branch}`
        : 'Needs branch review'
    );
  }
}

async function refreshOrders() {
  try {
    const response = await fetch(
      `${WANDA_ORDER_API}/orders/state`,
      { cache: 'no-store', credentials: 'include' }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    setOrdersStatus(
      true,
      data.agentOnline
        ? 'Live order agent connected.'
        : 'Waiting for Lalabella Order Agent.'
    );

    if (data.currentOrder) {
      wandaCurrentOrder = data.currentOrder;
      renderCurrentOrder(data.currentOrder);
    }

    wandaOrderHistory = Array.isArray(data.history)
      ? data.history
      : [];

    renderOrderHistory();
  } catch (_) {
    setOrdersStatus(false);
  }
}

function startOrderEvents() {
  try {
    wandaOrderEvents = new EventSource(
      `${WANDA_ORDER_API}/orders/events`
    );

    wandaOrderEvents.onopen = () => {
      setOrdersStatus(
        true,
        'Live order events connected.'
      );
    };

    wandaOrderEvents.onmessage = event => {
      try {
        handleOrderEvent(
          JSON.parse(event.data)
        );
      } catch (_) {}
    };

    wandaOrderEvents.onerror = () => {
      setOrdersStatus(false);
    };
  } catch (_) {
    setOrdersStatus(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  injectOrderStyles();
  orderPanel();
  refreshOrders();
  startOrderEvents();
  setInterval(refreshOrders, 10000);
});
