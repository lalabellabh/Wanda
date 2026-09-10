import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
try {
  const password = await rl.question('Enter Wanda manual password (not stored in this script): ');
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
} finally {
  rl.close();
}
