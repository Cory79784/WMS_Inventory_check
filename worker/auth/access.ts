import { Env, AuthUser } from '../types';

// Public operation: no credentials, cookies or session database lookup.
// Kept as a shared attribution helper for existing inventory routes.
export const AUTH_SCHEMA: string[] = [];
export async function authenticateRequest(_request: Request, _env: Env): Promise<{ user: AuthUser }> {
  return { user: { userId: 'public', name: 'public', email: 'public', roles: [] } };
}

export function validOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin
    && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

// Compatibility endpoint used by the device diagnostics page only.
export async function handleAuth(request: Request, env: Env): Promise<Response> {
  if (new URL(request.url).pathname === '/api/auth/me' && request.method === 'GET') {
    const { user } = await authenticateRequest(request, env);
    return Response.json({ authenticated: true, mode: 'public', user }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ error: 'Endpoint not found' }, { status: 404 });
}
