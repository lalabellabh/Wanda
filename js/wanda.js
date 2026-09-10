'use strict';

/* Wanda's local assistant shell. No external AI key is stored in the browser. */
const getEl = (id) => document.getElementById(id);
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let recognition = null;

function addMessage(role, text) {
  const box = getEl('wandaMessages');
  const item = document.createElement('div');
  item.className = `message ${role}`;
  item.textContent = text;
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
}

function speak(text) {
  if (!synth) return;
  if (typeof window.WandaVoice === 'function') {
    window.WandaVoice(text, { rate: 0.96, pitch: 1.08, volume: 0.9 });
    return;
  }
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.96;
  utterance.pitch = 1.08;
  synth.speak(utterance);
}

function reply(text, voice = true) {
  addMessage('wanda', text);
  if (voice) speak(text);
}

function handleCommand(raw) {
  const text = raw.trim();
  if (!text) return;
  addMessage('boss', text);
  const lower = text.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('wanda')) {
    reply('Hi Boss. Wanda is online and ready. I will ask for confirmation before any external action.');
    return;
  }
  if (lower.includes('status')) {
    reply('Security is active. WhatsApp, Orders, CCTV, and Chrome are waiting for their secure local connectors.');
    return;
  }
  if (lower.includes('lock')) {
    reply('Boss, I can lock Wanda from the security control.');
    return;
  }
  reply('I heard you, Boss. That command is not connected yet. I can prepare it first, then ask for confirmation before doing anything external.');
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    reply('Voice recognition is not available in this browser. The text command box is still ready.', false);
    return;
  }
  if (recognition) {
    recognition.stop();
    recognition = null;
    getEl('voiceButton').classList.remove('listening');
    getEl('voiceButton').textContent = '🎙 Voice';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    getEl('voiceButton').classList.add('listening');
    getEl('voiceButton').textContent = '🔴 Listening';
  };
  recognition.onresult = (event) => handleCommand(event.results[0][0].transcript);
  recognition.onerror = () => reply('I could not hear that clearly, Boss.', false);
  recognition.onend = () => {
    recognition = null;
    getEl('voiceButton').classList.remove('listening');
    getEl('voiceButton').textContent = '🎙 Voice';
  };
  recognition.start();
}

getEl('wandaCommandForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = getEl('wandaCommand');
  handleCommand(input.value);
  input.value = '';
  input.focus();
});
getEl('voiceButton').addEventListener('click', startVoice);

addMessage('wanda', 'Hi Boss. I am Wanda. Secure mode is active. What do you want me to check?');
