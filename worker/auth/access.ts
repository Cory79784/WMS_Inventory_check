import { Env, AuthUser } from '../types';

const COOKIE = '__Host-wms-session';
const TTL = 7 * 24 * 60 * 60;
export const AUTH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_attempts (attempt_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL)`,
];
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const tokenFrom = (request: Request) => request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
const cookie = (token: string, age: number) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const names = ['Cory', 'sheng', 'account'];

export async function authenticateRequest(request: Request, env: Env): Promise<{ user?: AuthUser; error?: string }> {
  const token = tokenFrom(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return { error: 'Unauthorized' };
  const session = await env.DB.prepare('SELECT username FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await digest(token), Date.now()).first<{ username: string }>();
  if (!session || !names.includes(session.username)) return { error: 'Session expired' };
  return { user: { userId: session.username, name: session.username, email: session.username, roles: [] } };
}

export function validOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin
    && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/auth/me' && request.method === 'GET') {
    const auth = await authenticateRequest(request, env);
    return Response.json({ authenticated: !!auth.user, mode: 'session', user: auth.user }, { status: auth.user ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  if (!validOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  if (path === '/api/auth/logout') {
    const token = tokenFrom(request);
    if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return Response.json({ success: true }, { headers: { 'Set-Cookie': cookie('', 0) } });
  }
  if (path !== '/api/auth/login') return new Response(null, { status: 404 });
  if (!env.AUTH_CREDENTIALS) return Response.json({ error: 'Login is not configured' }, { status: 503 });
  if (Number(request.headers.get('Content-Length') || 0) > 4096) return new Response(null, { status: 413 });
  let input: { username?: string; password?: string };
  try { const raw = await request.text(); if (raw.length > 4096) return new Response(null, { status: 413 }); input = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!input || typeof input.username !== 'string' || typeof input.password !== 'string' || input.password.length > 256) return new Response(null, { status: 400 });
  const now = Date.now();
  // Atomic fixed-window budgets, shared by all isolates, for both account and source IP.
  for (const key of [`user:${names.includes(input.username) ? input.username : 'unknown'}`, `ip:${request.headers.get('CF-Connecting-IP') || 'local'}`]) {
    const attempt = await env.DB.prepare(`INSERT INTO auth_attempts (attempt_key, window_start, attempts) VALUES (?, ?, 1)
      ON CONFLICT(attempt_key) DO UPDATE SET attempts = CASE WHEN window_start < ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END RETURNING attempts`)
      .bind(await digest(key), now, now - 900000, now - 900000).first<{ attempts: number }>();
    if (!attempt || attempt.attempts > (key.startsWith('ip:') ? 60 : 10)) return Response.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }
  const credentials = JSON.parse(env.AUTH_CREDENTIALS) as Record<string, { salt: string; hash: string; iterations: number }>;
  const record = names.includes(input.username) ? credentials[input.username] : undefined;
  const template = record || credentials.Cory;
  if (!template) return new Response(null, { status: 503 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(input.password), 'PBKDF2', false, ['deriveBits']);
  const actual = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(template.salt), iterations: template.iterations }, key, 256));
  let difference = actual.length ^ template.hash.length;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ template.hash.charCodeAt(i);
  if (!record || difference !== 0) return Response.json({ error: 'Invalid username or password' }, { status: 401 });
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const old = tokenFrom(request);
  if (old) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await digest(old)).run();
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)').bind(await digest(token), input.username, now + TTL * 1000).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now).run();
  return Response.json({ authenticated: true, user: { name: input.username } }, { headers: { 'Set-Cookie': cookie(token, TTL), 'Cache-Control': 'no-store' } });
}
