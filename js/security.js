'use strict';

const API_BASE = window.WANDA_API_BASE || 'http://127.0.0.1:8787';
const SESSION_KEY = 'wanda.session.v1';
const $ = (id) => document.getElementById(id);
let stream = null;
let scanning = false;

function setLocked(message = 'No active session.') {
  document.body.classList.remove('is-unlocked');
  $('securityBadge').textContent = 'LOCKED';
  $('securityBadge').className = 'badge';
  $('unlockPanel').classList.remove('hidden');
  $('unlockPanel').setAttribute('aria-hidden', 'false');
  $('opsPanel').classList.add('hidden');
  $('opsPanel').setAttribute('aria-hidden', 'true');
  $('securityMessage').textContent = message;
}

function setUnlocked(session) {
  document.body.classList.add('is-unlocked');
  $('securityBadge').textContent = 'UNLOCKED';
  $('securityBadge').className = 'badge ok';
  $('unlockPanel').classList.add('hidden');
  $('unlockPanel').setAttribute('aria-hidden', 'true');
  $('opsPanel').classList.remove('hidden');
  $('opsPanel').setAttribute('aria-hidden', 'false');
  $('securityMessage').textContent = `Secure session active until ${new Date(session.expiresAt).toLocaleTimeString()}.`;
}

function stopCamera() {
  scanning = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  const video = $('qrVideo');
  if (video) video.srcObject = null;
  $('qrScanner')?.classList.add('hidden');
}

async function verifyQr(payload) {
  const response = await fetch(`${API_BASE}/auth/qr/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'unlock_failed');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt: data.expiresAt }));
  stopCamera();
  setUnlocked(data);
}

async function verifyPassword(password) {
  const response = await fetch(`${API_BASE}/auth/password/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'invalid_credentials');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt: data.expiresAt }));
  setUnlocked(data);
}

async function scanQr() {
  if (!('BarcodeDetector' in window)) {
    $('securityMessage').textContent = 'This browser does not provide QR scanning. Use the manual password fallback or a browser with BarcodeDetector support.';
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = $('qrVideo');
    video.srcObject = stream;
    await video.play();
    $('qrScanner').classList.remove('hidden');
    $('securityMessage').textContent = 'Point the camera at the Wanda unlock QR.';
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scanning = true;

    while (scanning) {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        const value = codes?.[0]?.rawValue;
        if (value) {
          scanning = false;
          $('securityMessage').textContent = 'QR detected. Validating…';
          try { await verifyQr(value); }
          catch (error) {
            $('securityMessage').textContent = `Unlock denied: ${error.message}.`;
            scanning = true;
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  } catch (error) {
    stopCamera();
    $('securityMessage').textContent = `Camera/unlock error: ${error.message || 'permission denied'}.`;
  }
}

async function checkSession() {
  try {
    const response = await fetch(`${API_BASE}/auth/session`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return setLocked();
    const session = await response.json();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setUnlocked(session);
  } catch (_) {
    setLocked('Backend is not reachable. Wanda remains locked.');
  }
}

async function lockWanda() {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch (_) {}
  sessionStorage.removeItem(SESSION_KEY);
  $('wandaPassword').value = '';
  stopCamera();
  setLocked('Wanda locked.');
}

$('startUnlock').addEventListener('click', scanQr);
$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('wandaPassword');
  const password = input.value;
  if (password.length < 15) {
    $('securityMessage').textContent = 'Password must be at least 15 characters.';
    return;
  }
  $('securityMessage').textContent = 'Checking manual password…';
  try {
    await verifyPassword(password);
    input.value = '';
  } catch (error) {
    input.value = '';
    $('securityMessage').textContent = error.message === 'rate_limited'
      ? 'Too many attempts. Try again in about one minute.'
      : 'Manual unlock denied.';
  }
});
$('lockNow').addEventListener('click', lockWanda);

// Client state is only a display convenience. The backend remains authoritative.
checkSession();
