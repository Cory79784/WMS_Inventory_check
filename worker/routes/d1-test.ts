import { Env } from '../types';

export async function handleD1Test(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    try {
      const halls = await env.DB.prepare('SELECT * FROM halls ORDER BY hall_id ASC').all();
      const diagnostics = await env.DB.prepare(
        'SELECT * FROM phase0_diagnostics ORDER BY server_timestamp DESC LIMIT 20'
      ).all();

      return Response.json({
        success: true,
        data: {
          halls: halls.results,
          diagnostics: diagnostics.results,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json() as {
        testKey?: string;
        testValue?: string;
        clientTimestamp?: string;
        notes?: string;
      };

      if (!body.testKey || !body.testValue) {
        return Response.json(
          { success: false, error: 'testKey and testValue are required fields.' },
          { status: 400 }
        );
      }

      const id = `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const serverTimestamp = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO phase0_diagnostics (id, test_key, test_value, client_timestamp, server_timestamp, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        body.testKey,
        body.testValue,
        body.clientTimestamp || null,
        serverTimestamp,
        body.notes || 'Phase 0 Manual Write Test'
      ).run();

      // Read back immediately to verify database integrity
      const readBack = await env.DB.prepare(
        `SELECT * FROM phase0_diagnostics WHERE id = ?`
      ).bind(id).first();

      return Response.json({
        success: true,
        message: 'D1 write and read-back verification succeeded.',
        record: readBack,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
}
