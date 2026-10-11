import { Env } from '../types';
import { ensureDatabaseSchema } from '../db/init';

export async function handleHealthCheck(_request: Request, env: Env): Promise<Response> {
  const d1Healthy = Boolean(env.DB);
  const r2Healthy = Boolean(env.PHOTO_BUCKET);

  let d1Details = 'untested';
  try {
    if (env.DB) {
      await ensureDatabaseSchema(env);
      const hallCount = await env.DB.prepare('SELECT count(*) as count FROM halls').first<{ count: number }>();
      d1Details = `Connected (Halls count: ${hallCount?.count ?? 0})`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    d1Details = `Error: ${msg}`;
  }

  return Response.json({
    status: 'ok',
    system: 'Warehouse PDA Inventory Audit API',
    phase: 'Phase 0 - Technical Feasibility & Diagnostics',
    timestamp: new Date().toISOString(),
    environment: env.ENVIRONMENT || 'development',
    bindings: {
      d1: {
        available: d1Healthy,
        details: d1Details,
      },
      r2: {
        available: r2Healthy,
        details: r2Healthy ? 'Connected to PHOTO_BUCKET' : 'PHOTO_BUCKET binding missing',
      },
    },
  });
}
