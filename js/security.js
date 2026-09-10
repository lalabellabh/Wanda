'use strict';

const API_BASE = window.WANDA_API_BASE || 'http://127.0.0.1:8787';
const SESSION_KEY = 'wanda.session.v1';
const OWNER_QR = 'WANDA-OWNER-ID:v1|name=Benjamin Gutierrez JR';
const $ = (id) => document.getElementById(id);
let stream = null;
let scanning = false;

function speakGreeting() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const utterance = new SpeechSynthesisUtterance(`${greeting}, dear. Welcome back. Wanda is ready.`);
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.volume = 0.9;
  window.speechSynthesis.speak(utterance);
}

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

function setUnlocked(session, announce = true) {
  document.body.classList.add('is-unlocked');
  $('securityBadge').textContent = 'UNLOCKED';
  $('securityBadge').className = 'badge ok';
  $('unlockPanel').classList.add('hidden');
  $('unlockPanel').setAttribute('aria-hidden', 'true');
  $('opsPanel').classList.remove('hidden');
  $('opsPanel').setAttribute('aria-hidden', 'false');
  $('securityMessage').textContent = `Secure session active until ${new Date(session.expiresAt).toLocaleTimeString()}.`;
  if (announce) speakGreeting();
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

function handleScannedValue(value) {
  if (!value) return false;
  if (value.startsWith('wanda://unlock?')) {
    scanning = false;
    $('securityMessage').textContent = 'One-time Wanda QR detected. Validating…';
    verifyQr(value).catch(error => {
      $('securityMessage').textContent = `QR unlock denied: ${error.message}.`;
      scanning = true;
    });
    return true;
  }

  if (value === OWNER_QR) {
    scanning = false;
    $('securityMessage').textContent = 'Owner QR recognized. Checking trusted device…';
    verifyQr(value).catch(error => {
      if (error.message === 'device_not_trusted') {
        stopCamera();
        $('securityMessage').textContent = 'This device needs one-time setup. Enter your Wanda password once to trust this device.';
        $('wandaPassword').focus();
      } else {
        stopCamera();
        $('securityMessage').textContent = `QR unlock denied: ${error.message}.`;
      }
    });
    return true;
  }

  $('securityMessage').textContent = 'QR detected, but it is not a valid Wanda unlock code.';
  return false;
}

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.className = 'qr-canvas';
  return canvas;
}

async function scanQrWithJsQR(video) {
  if (typeof window.jsQR !== 'function') throw new Error('QR decoder is unavailable.');
  const canvas = createCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  scanning = true;
  while (scanning) {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(1, 720 / video.videoWidth);
      canvas.width = Math.max(320, Math.floor(video.videoWidth * scale));
      canvas.height = Math.max(240, Math.floor(video.videoHeight * scale));
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) handleScannedValue(code.data);
    }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
}

async function scanQr() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('securityMessage').textContent = 'Camera access is unavailable in this browser. Use the manual password fallback.';
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = $('qrVideo');
    video.srcObject = stream;
    await video.play();
    $('qrScanner').classList.remove('hidden');
    $('securityMessage').textContent = 'Camera active. Point it at your Wanda QR.';

    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        scanning = true;
        while (scanning) {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);
            const value = codes?.[0]?.rawValue;
            if (value) handleScannedValue(value);
          }
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        return;
      } catch (_) {
        scanning = false;
      }
    }

    await scanQrWithJsQR(video);
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
    setUnlocked(session, false);
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

checkSession();
