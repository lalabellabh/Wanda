'use strict';

(() => {
  const password = document.getElementById('wandaPassword');
  const toggle = document.getElementById('passwordToggle');
  const remember = document.getElementById('rememberDevice');
  const form = document.getElementById('passwordForm');
  const DEVICE_KEY = 'wanda.trusted-device.v1';

  if (!password || !toggle || !form) return;

  toggle.addEventListener('click', () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? '◉' : '◌';
    toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    toggle.title = visible ? 'Show password' : 'Hide password';
    password.focus();
  });

  remember?.addEventListener('change', () => {
    if (!remember.checked) localStorage.removeItem(DEVICE_KEY);
  });

  form.addEventListener('submit', () => {
    // security.js performs the actual authentication. After it completes,
    // remove the optional trusted-device secret when Remember is off.
    setTimeout(() => {
      if (!remember?.checked) localStorage.removeItem(DEVICE_KEY);
    }, 900);
  });

  password.addEventListener('keydown', event => {
    if (event.key === 'Escape' && password.type === 'text') {
      password.type = 'password';
      toggle.textContent = '◉';
      toggle.setAttribute('aria-label', 'Show password');
      toggle.title = 'Show password';
    }
  });
})();
