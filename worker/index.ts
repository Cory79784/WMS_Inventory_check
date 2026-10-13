import { Env } from './types';
import { handleHealthCheck } from './routes/health';
import { handleD1Test } from './routes/d1-test';
import { handleR2Test } from './routes/r2-test';
import { authenticateRequest, handleAuth, validOrigin } from './auth/access';
import { handleInventoryRoutes } from './routes/inventory';
import { ensureDatabaseSchema } from './db/init';

let dbInitialized = false;

async function autoInitDb(env: Env) {
  if (!dbInitialized && env.DB) {
    try {
      const res = await ensureDatabaseSchema(env);
      if (res.success) {
        dbInitialized = true;
      }
    } catch (e) {
      console.error('Database auto-initialization error:', e);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Auto-init DB schema once per isolate for zero-touch cloud setup
    await autoInitDb(env);

    // API Routes
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/api/auth/')) return handleAuth(request, env);
      const auth = await authenticateRequest(request, env);
      if (!auth.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (!['GET', 'HEAD'].includes(request.method) && !validOrigin(request)) {
        return Response.json({ error: 'Invalid origin' }, { status: 403 });
      }
      if (url.pathname === '/api/db/init') {
        const result = await ensureDatabaseSchema(env);
        return Response.json(result, { status: result.success ? 200 : 500 });
      }

      if (url.pathname === '/api/health') {
        const res = await handleHealthCheck(request, env);
        return res;
      }

      if (url.pathname === '/api/d1-test') {
        const res = await handleD1Test(request, env);
        return res;
      }

      if (url.pathname === '/api/r2-test') {
        const res = await handleR2Test(request, env);
        return res;
      }

      if (url.pathname.startsWith('/api/inventory/')) {
        const res = await handleInventoryRoutes(request, env);
        return res;
      }
      return Response.json({ error: 'Endpoint not found' }, { status: 404 });
    }

    // Static Assets fallback for Cloudflare Workers Static Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Cloudflare Worker active. Static assets binding not present.', { status: 200 });
  },
};
