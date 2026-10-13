// Passwords arrive only through hidden terminal prompts; stdout is a secret JSON payload.
// Usage: node scripts/init-auth.mjs | npx wrangler secret put AUTH_CREDENTIALS
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { openSync, readSync, writeSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const tty = openSync('/dev/tty', 'r+');
function password(name) {
  writeSync(tty, `${name} password: `);
  execFileSync('stty', ['-echo'], { stdio: [tty, tty, tty] });
  try {
    let value = '';
    const b = Buffer.alloc(1);
    while (readSync(tty, b, 0, 1, null) && b[0] !== 10) value += b.toString();
    if (!value) throw new Error('Password cannot be empty');
    return value.replace(/\r$/, '');
  } finally { execFileSync('stty', ['echo'], { stdio: [tty, tty, tty] }); writeSync(tty, '\n'); }
}
try {
  const result = {};
  for (const name of ['Cory', 'sheng', 'account']) {
    const salt = randomBytes(32).toString('hex');
    const iterations = 100000; // Workers Web Crypto PBKDF2 supported ceiling.
    result[name] = { salt, iterations, hash: pbkdf2Sync(password(name), salt, iterations, 32, 'sha256').toString('hex') };
  }
  process.stdout.write(JSON.stringify(result));
} finally { closeSync(tty); }
