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
    if (name && name.textContent.trim().toLowerCase() === 'orders') {
      row = candidate;
    }
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
  return Boolean(ops && !ops.classList.contains('hidden') && ops.getAttribute('aria-hidden') !== 'true');
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
  wandaOrderHistory = [order, ...wandaOrderHistory.filter(x => x.orderId !== order.orderId)].slice(0, 50);

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
    const response = await fetch(`${WANDA_ORDER_API}/orders/state`, {
      cache: 'no-store',
      credentials: 'include'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    setOrdersStatus(true, data.agentOnline ? 'Live order agent connected.' : 'Waiting for Lalabella Order Agent.');

    if (data.currentOrder) {
      wandaCurrentOrder = data.currentOrder;
      renderCurrentOrder(data.currentOrder);
    }

    wandaOrderHistory = Array.isArray(data.history) ? data.history : [];
    renderOrderHistory();
  } catch (_) {
    setOrdersStatus(false);
  }
}

function startOrderEvents() {
  try {
    wandaOrderEvents = new EventSource(`${WANDA_ORDER_API}/orders/events`);

    wandaOrderEvents.onopen = () => {
      setOrdersStatus(true, 'Live order events connected.');
    };

    wandaOrderEvents.onmessage = event => {
      try {
        handleOrderEvent(JSON.parse(event.data));
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
  orderPanel();
  refreshOrders();
  startOrderEvents();
  setInterval(refreshOrders, 10000);
});
