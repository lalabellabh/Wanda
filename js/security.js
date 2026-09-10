'use strict';

const API_BASE = window.WANDA_API_BASE || 'http://127.0.0.1:8787';
const SESSION_KEY = 'wanda.session.v1';
const DEVICE_KEY = 'wanda.trusted-device.v1';
const OWNER_QR = 'WANDA-OWNER-ID:v1|name=Benjamin Gutierrez JR';
const $ = (id) => document.getElementById(id);
let stream = null;
let scanning = false;
let healthTimer = null;

function pickFemaleVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const femaleHints = /female|samantha|zira|aria|jenny|ava|sara|susan|karen|moira|tessa|victoria|allison|hazel|libby|sonia|google us english/i;
  return voices.find(v => /^en(-|_)(US|GB|AU|CA|IE|IN)/i.test(v.lang) && femaleHints.test(v.name))
    || voices.find(v => femaleHints.test(v.name) && /^en/i.test(v.lang))
    || voices.find(v => /^en-US/i.test(v.lang) && !/male|david|mark|guy|daniel|alex/i.test(v.name))
    || voices.find(v => /^en/i.test(v.lang))
    || voices[0];
}

function wandaSpeak(text, options = {}) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang || 'en-US';
  utterance.rate = options.rate ?? 0.96;
  utterance.pitch = options.pitch ?? 1.08;
  utterance.volume = options.volume ?? 0.9;
  const voice = pickFemaleVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

window.WandaVoice = wandaSpeak;
if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', () => pickFemaleVoice(), { once: true });

function speakGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  wandaSpeak(`${greeting}, dear. Welcome back. Wanda is ready.`, { rate: 0.95, pitch: 1.08, volume: 0.9 });
}

function setBackendStatus(online, detail = '') {
  const text = $('backendText');
  const dot = $('backendDot');
  const light = $('backendLight');
  const shell = $('shellStatus');
  const count = $('systemCount');
  if (text) text.textContent = online ? (detail || 'Security backend online') : (detail || 'Backend offline');
  if (dot) {
    dot.style.background = online ? '#62e9a8' : '#687080';
    dot.style.boxShadow = online ? '0 0 9px rgba(98,233,168,.65)' : '0 0 7px rgba(104,112,128,.25)';
  }
  if (light) {
    light.style.background = online ? '#61e9aa' : '#ff6e99';
    light.style.boxShadow = online ? '0 0 14px rgba(97,233,170,.75)' : '0 0 13px rgba(255,110,153,.65)';
  }
  if (shell) shell.textContent = online ? '● ONLINE SHELL' : '● BACKEND OFFLINE';
  if (count) count.textContent = online ? '1 / 5' : '0 / 5';
}

async function checkBackendHealth() {
  const started = performance.now();
  try {
    const response = await fetch(`${API_BASE}/health`, { method: 'GET', cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new Error(`HTTP ${response.status}`);
    const latency = Math.max(1, Math.round(performance.now() - started));
    setBackendStatus(true, `Security backend online · ${latency} ms`);
    return true;
  } catch (error) {
    setBackendStatus(false, 'Backend offline — Wanda remains locked');
    return false;
  }
}

function startBackendWatcher() {
  clearInterval(healthTimer);
  checkBackendHealth();
  healthTimer = setInterval(checkBackendHealth, 30000);
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
  const state = $('sessionState');
  const detail = $('sessionDetail');
  if (state) state.textContent = 'Locked';
  if (detail) detail.textContent = 'Authentication required';
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
  const state = $('sessionState');
  const detail = $('sessionDetail');
  if (state) state.textContent = 'Secure';
  if (detail) detail.textContent = `Session active until ${new Date(session.expiresAt).toLocaleTimeString()}`;
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
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'unlock_failed');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt: data.expiresAt }));
  stopCamera();
  setUnlocked(data);
}

async function verifyOwnerQr() {
  const deviceToken = localStorage.getItem(DEVICE_KEY);
  const response = await fetch(`${API_BASE}/auth/qr/owner-verify`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerQr: OWNER_QR, deviceToken })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'unlock_failed');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ expiresAt: data.expiresAt }));
  stopCamera();
  setUnlocked(data);
}

async function verifyPassword(password, trustDevice = false) {
  const response = await fetch(`${API_BASE}/auth/password/verify`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, trustDevice })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || 'invalid_credentials');
  if (data.deviceToken) localStorage.setItem(DEVICE_KEY, data.deviceToken);
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
    verifyOwnerQr().catch(error => {
      if (error.message === 'device_not_trusted') {
        stopCamera();
        $('securityMessage').textContent = 'One-time setup: enter your Wanda password to trust this device.';
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
      } catch (_) { scanning = false; }
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
    if (response.status === 401) return setLocked('Wanda is locked. Unlock with your Owner QR or manual password.');
    if (!response.ok) return setLocked(`Wanda security service returned HTTP ${response.status}.`);
    const session = await response.json();
    if (!session?.ok) return setLocked('Wanda is locked. Unlock with your Owner QR or manual password.');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setUnlocked(session, false);
  } catch (_) {
    setLocked('Backend is not reachable. Wanda remains locked.');
  }
}

async function lockWanda() {
  try { await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch (_) {}
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
    const firstSetup = !localStorage.getItem(DEVICE_KEY);
    await verifyPassword(password, firstSetup);
    input.value = '';
  } catch (error) {
    input.value = '';
    $('securityMessage').textContent = error.message === 'rate_limited' ? 'Too many attempts. Try again in about one minute.' : 'Manual unlock denied.';
  }
});
$('lockNow').addEventListener('click', lockWanda);
startBackendWatcher();
checkSession();
