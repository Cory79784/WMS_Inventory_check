import { randomBytes, pbkdf2Sync } from 'node:crypto';
import type { Miniflare } from 'miniflare';
export const testPasswords = Object.fromEntries(['Cory', 'sheng', 'account'].map(name => [name, randomBytes(24).toString('hex')]));
export const testCredentials = JSON.stringify(Object.fromEntries(Object.entries(testPasswords).map(([name, password]) => {
  const salt = randomBytes(32).toString('hex');
  return [name, { salt, iterations: 100000, hash: pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex') }];
})));
// Compatibility helper: public mode needs no login or Cookie.
export async function login(_mf: Miniflare, _username = 'public') { return ''; }
export function authenticatedFetch(mf: Miniflare, cookie: string) {
  return (url: string, init: RequestInit = {}) => mf.dispatchFetch(url, {
    ...init, headers: { Origin: new URL(url).origin, ...Object.fromEntries(new Headers(init.headers)) },
  } as any);
}
