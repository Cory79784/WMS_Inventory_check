import { randomBytes, pbkdf2Sync } from 'node:crypto';
import type { Miniflare } from 'miniflare';
export const testPasswords = Object.fromEntries(['Cory', 'sheng', 'account'].map(name => [name, randomBytes(24).toString('hex')]));
export const testCredentials = JSON.stringify(Object.fromEntries(Object.entries(testPasswords).map(([name, password]) => {
  const salt = randomBytes(32).toString('hex');
  return [name, { salt, iterations: 100000, hash: pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex') }];
})));
export async function login(mf: Miniflare, username = 'Cory') {
  const response = await mf.dispatchFetch('http://localhost/api/auth/login', {
    method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: testPasswords[username] }),
  });
  if (response.status !== 200) throw new Error(`Login failed: ${await response.text()}`);
  return response.headers.get('set-cookie')!.split(';')[0];
}
export function authenticatedFetch(mf: Miniflare, cookie: string) {
  return (url: string, init: RequestInit = {}) => mf.dispatchFetch(url, {
    ...init, headers: { Cookie: cookie, Origin: new URL(url).origin, ...Object.fromEntries(new Headers(init.headers)) },
  } as any);
}
