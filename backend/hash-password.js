import crypto from 'node:crypto';

function readHidden(prompt) {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this password setup from an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    stdout.write(`${prompt}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    const cleanup = () => {
      try { stdin.setRawMode(false); } catch {}
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
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }

        if (char >= ' ' && char !== '\u007f') {
          value += char;
          stdout.write('*');
        }
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
