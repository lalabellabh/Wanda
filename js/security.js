'use strict';

/*
 * Client security boundary.
 * IMPORTANT: this is NOT the authoritative authentication layer.
 * A browser can be modified by its owner/attacker. The backend/local agent
 * must independently validate every privileged request.
 */

const SESSION_KEY = 'wanda.session.v1';
const MAX_SESSION_MS = 10 * 60 * 1000;

const $ = (id) => document.getElementById(id);

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  setLocked();
}

function setLocked(message = 'No active session.') {
  $('securityBadge').textContent = 'LOCKED';
  $('securityBadge').className = 'badge';
  $('opsPanel').classList.add('hidden');
  $('opsPanel').setAttribute('aria-hidden', 'true');
  $('securityMessage').textContent = message;
}

function setUnlocked(session) {
  $('securityBadge').textContent = 'UNLOCKED';
  $('securityBadge').className = 'badge ok';
  $('opsPanel').classList.remove('hidden');
  $('opsPanel').setAttribute('aria-hidden', 'false');
  $('securityMessage').textContent = `Session active until ${new Date(session.expiresAt).toLocaleTimeString()}.`;
}

function loadLocalSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.expiresAt || Date.now() >= session.expiresAt) {
      clearSession();
      return null;
    }
    return session;
  } catch (_) {
    clearSession();
    return null;
  }
}

function createDevelopmentSession() {
  // DEVELOPMENT ONLY. Replace with server-issued, signed session after backend exists.
  const session = {
    id: crypto.randomUUID(),
    expiresAt: Date.now() + MAX_SESSION_MS,
    mode: 'development'
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

$('startUnlock').addEventListener('click', () => {
  // QR scanner will be connected here in the next phase.
  // Never put a permanent secret/credential inside a QR code.
  $('securityMessage').textContent = 'QR scanner is not connected yet. Backend authentication is required for production unlock.';
});

$('lockNow').addEventListener('click', clearSession);

const existing = loadLocalSession();
if (existing) setUnlocked(existing); else setLocked();

window.addEventListener('pagehide', () => {
  // Do not persist privileged state in localStorage/cookies from this client.
});
