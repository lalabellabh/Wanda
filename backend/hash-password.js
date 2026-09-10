import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

function readHiddenWindows(prompt) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$s = Read-Host '${prompt.replace(/'/g, "''")}' -AsSecureString`,
    "$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)",
    "try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }"
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: false,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
    maxBuffer: 16 * 1024
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || 'Password input failed.').trim());
  return (result.stdout || '').trimEnd();
}

async function readHidden(prompt) {
  if (process.platform === 'win32') return readHiddenWindows(prompt);

  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this password setup from an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0008' || char === '\u007f') {
          if (value.length) value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

try {
  const password = await readHidden('Enter Wanda manual password (hidden)');
  if (password.length < 15) throw new Error('Password must be at least 15 characters.');
  if (Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Password is too long.');

  const salt = crypto.randomBytes(16);
  const N = 131072;
  const r = 8;
  const p = 1;
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 }, (err, derived) => {
      if (err) reject(err); else resolve(derived);
    });
  });

  console.log(`scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`);
} catch (error) {
  console.error(`Password setup failed: ${error.message}`);
  process.exitCode = 1;
}
