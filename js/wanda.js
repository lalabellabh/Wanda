'use strict';

/* Wanda's local assistant shell. No external AI key is stored in the browser. */
const getEl = (id) => document.getElementById(id);
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const WANDA_API_BASE = window.WANDA_API_BASE || 'http://127.0.0.1:8787';
let recognition = null;
let backendTimer = null;
let wandaFemaleVoice = null;

function loadWandaVoices() {
  if (!synth) return;

  const voices = synth.getVoices();
  if (!voices.length) return;

  const femaleHints = [
    'female', 'zira', 'samantha', 'victoria', 'karen',
    'susan', 'hazel', 'aria', 'jenny', 'libby', 'sara',
    'sarah', 'sophie', 'emma', 'ava', 'olivia'
  ];

  wandaFemaleVoice = voices.find((voice) => {
    const name = String(voice.name || '').toLowerCase();
    return femaleHints.some((hint) => name.includes(hint));
  }) || voices.find((voice) => /^en/i.test(voice.lang)) || voices[0];
}

function speak(text) {
  if (!synth || !text) return;

  if (typeof window.WandaVoice === 'function') {
    window.WandaVoice(text, {
      rate: 0.94,
      pitch: 1.10,
      volume: 0.95,
      voice: wandaFemaleVoice
    });
    return;
  }

  loadWandaVoices();
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.94;
  utterance.pitch = 1.10;
  utterance.volume = 0.95;

  if (wandaFemaleVoice) {
    utterance.voice = wandaFemaleVoice;
  }

  synth.speak(utterance);
}

/* Expose one controlled voice function for the Orders module. */
window.WandaSpeak = speak;

function addMessage(role, text) {
  const box = getEl('wandaMessages');
  if (!box) return;

  const welcome = box.querySelector('.welcome-state');
  if (welcome) welcome.remove();

  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.textContent = text;
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
}

function reply(text, voice = true) {
  addMessage('wanda', text);
  if (voice) speak(text);
}

function setActivity(title, detail) {
  const titleEl = getEl('activityTitle');
  const detailEl = getEl('activityDetail');

  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
}

/* Expose a small activity hook for live system modules. */
window.WandaActivity = setActivity;

function setBackendUI(online, detail) {
  const text = getEl('backendText');
  const dot = getEl('backendDot');
  const light = getEl('backendLight');
  const shell = getEl('shellStatus');
  const count = getEl('systemCount');

  if (text) text.textContent = detail;

  if (dot) {
    dot.style.background = online ? '#62e9a8' : '#687080';
    dot.style.boxShadow = online
      ? '0 0 9px rgba(98,233,168,.65)'
      : '0 0 7px rgba(104,112,128,.25)';
  }

  if (light) {
    light.style.background = online ? '#61e9aa' : '#ff6e99';
    light.style.boxShadow = online
      ? '0 0 14px rgba(97,233,170,.75)'
      : '0 0 13px rgba(255,110,153,.65)';
  }

  if (shell) {
    shell.textContent = online
      ? '● ONLINE SHELL'
      : '● BACKEND OFFLINE';
  }

  if (count) {
    count.textContent = online ? '1 / 5' : '0 / 5';
  }
}

async function checkBackendStatus() {
  try {
    const started = performance.now();
    const response = await fetch(`${WANDA_API_BASE}/health`, {
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(`HTTP ${response.status}`);
    }

    const latency = Math.max(
      1,
      Math.round(performance.now() - started)
    );

    setBackendUI(
      true,
      `Security backend online · ${latency} ms`
    );
  } catch (_) {
    setBackendUI(
      false,
      'Backend offline — Wanda remains locked'
    );
  }
}

function startBackendWatcher() {
  checkBackendStatus();
  clearInterval(backendTimer);
  backendTimer = setInterval(
    checkBackendStatus,
    30000
  );
}

function handleCommand(raw) {
  const text = raw.trim();
  if (!text) return;

  addMessage('boss', text);
  const lower = text.toLowerCase();

  if (
    lower.includes('hello') ||
    lower.includes('hi') ||
    lower.includes('wanda')
  ) {
    reply(
      'Hi Boss. Wanda is online and ready. I will ask for confirmation before any external action.'
    );
    return;
  }

  if (lower.includes('status')) {
    checkBackendStatus();
    reply(
      'I am checking the Wanda security backend now. The Live Systems panel will show the result.'
    );
    return;
  }

  if (lower.includes('lock')) {
    reply(
      'Boss, I can lock Wanda from the security control.'
    );
    return;
  }

  reply(
    'I heard you, Boss. That command is not connected yet. I can prepare it first, then ask for confirmation before doing anything external.'
  );
}

function startVoice() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    reply(
      'Voice recognition is not available in this browser. The text command box is still ready.',
      false
    );
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    getEl('voiceButton')?.classList.remove('listening');
    if (getEl('voiceButton')) {
      getEl('voiceButton').textContent = '🎙 Voice';
    }
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    getEl('voiceButton')?.classList.add('listening');
    if (getEl('voiceButton')) {
      getEl('voiceButton').textContent = '🔴 Listening';
    }
  };

  recognition.onresult = (event) => {
    handleCommand(
      event.results[0][0].transcript
    );
  };

  recognition.onerror = () => {
    reply(
      'I could not hear that clearly, Boss.',
      false
    );
  };

  recognition.onend = () => {
    recognition = null;
    getEl('voiceButton')?.classList.remove('listening');
    if (getEl('voiceButton')) {
      getEl('voiceButton').textContent = '🎙 Voice';
    }
  };

  recognition.start();
}

document.addEventListener('DOMContentLoaded', () => {
  loadWandaVoices();

  if (synth) {
    synth.addEventListener?.('voiceschanged', loadWandaVoices);
  }

  getEl('wandaCommandForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = getEl('wandaCommand');
    handleCommand(input.value);
    input.value = '';
    input.focus();
  });

  getEl('voiceButton')?.addEventListener('click', startVoice);

  addMessage(
    'wanda',
    'Hi Boss. I am Wanda. Secure mode is active. What do you want me to check?'
  );

  startBackendWatcher();
});
