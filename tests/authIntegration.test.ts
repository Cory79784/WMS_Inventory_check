import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { login, testCredentials, testPasswords, authenticatedFetch } from './helpers/auth';
let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-10-11',
    d1Databases: ['DB'], r2Buckets: ['PHOTO_BUCKET'], bindings: { ENVIRONMENT: 'test', AUTH_CREDENTIALS: testCredentials } });
  await mf.dispatchFetch('http://localhost/api/health');
  const db = await mf.getD1Database('DB');
  await db.prepare(`INSERT INTO inventory_imports (import_id,hall_id,version_number,original_filename,file_sha256,uploaded_by,status)
    VALUES ('v1','H1',1,'fixture.xlsx','fixture','fixture','PUBLISHED')`).run();
  await db.prepare("UPDATE active_hall_imports SET active_import_id='v1' WHERE hall_id='H1'").run();
}, 20000);
afterAll(async () => mf?.dispose());
const endpoints = ['/api/db/init','/api/health','/api/d1-test','/api/r2-test','/api/inventory/imports',
  '/api/inventory/imports/check','/api/inventory/imports/stage','/api/inventory/imports/chunk','/api/inventory/imports/publish',
  '/api/inventory/imports/cancel','/api/inventory/active-version','/api/inventory/locations','/api/inventory/location',
  '/api/inventory/search-barcode','/api/inventory/inspection/save','/api/inventory/inspection/photo','/api/inventory/inspection/export'];
describe('Real D1 session authentication and attribution', () => {
  it('rejects every business endpoint and forged legacy identity without a session', async () => {
    for (const path of endpoints) for (const method of ['GET','POST']) {
      expect((await mf.dispatchFetch(`http://localhost${path}`, { method, headers: { Origin: 'http://localhost',
        'Cf-Access-Authenticated-User-Email': 'Cory', 'X-Dev-User-Email': 'Cory' } })).status).toBe(401);
    }
  });
  it('gives all three users identical business permissions, records server identity/time and retains audit history', async () => {
    const db = await mf.getD1Database('DB');
    for (const name of ['Cory','sheng','account']) {
      const request = authenticatedFetch(mf, await login(mf, name));
      const me = await (await request('http://localhost/api/auth/me')).json() as any;
      expect(me.user.name).toBe(name);
      expect((await request('http://localhost/api/inventory/imports?hallId=H1')).status).toBe(200);
      const response = await request('http://localhost/api/inventory/inspection/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          hallId: 'H1', referenceImportId: 'v1', locationCode: '109-070-1', status: 'IN_PROGRESS',
          operatorName: 'FORGED', operator_id: 'FORGED', savedAt: '1999-01-01', completedAt: '1999-01-01',
          notes: `saved by ${name}`, skus: [
            { sku: 'SHORT', systemQty: 10, actualQty: 8, differenceQty: -2, discrepancyType: 'SHORTAGE' },
            { sku: 'EXTRA', systemQty: 0, actualQty: 3, differenceQty: 3, discrepancyType: 'SURPLUS' },
          ],
        }),
      });
      expect(response.status).toBe(200);
      const saved = await response.json() as any;
      const record = await db.prepare('SELECT * FROM location_inspections WHERE inspection_id=?').bind(saved.inspectionId).first();
      expect(record).toMatchObject({ operator_id: name, status: 'IN_PROGRESS', completed_at: null });
      const skus = await db.prepare('SELECT sku,actual_qty FROM sku_inspections WHERE inspection_id=? ORDER BY sku').bind(saved.inspectionId).all();
      expect(skus.results).toEqual([{sku:'EXTRA',actual_qty:3},{sku:'SHORT',actual_qty:8}]);
      const reload = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-070-1')).json() as any;
      expect(reload.data.inspection.status).toBe('IN_PROGRESS');
      expect(reload.data.skus).toHaveLength(2);
      const audit = await db.prepare('SELECT * FROM audit_events WHERE user_id=?').bind(name).first() as any;
      expect(JSON.parse(audit.details_json).operatorName).toBe(name);
      expect(audit.created_at).toBe(saved.savedAt);
      expect(Date.parse(saved.savedAt)).toBeGreaterThan(Date.now() - 30000);
    }
    const audit = await db.prepare("SELECT user_id FROM audit_events WHERE event_type='LOCATION_INSPECTED' ORDER BY created_at").all();
    expect(audit.results.map(r => r.user_id)).toEqual(['Cory','sheng','account']);
  });
  it('sets secure cookie flags, rejects wrong passwords and cross-site mutations, revokes logout and expires sessions', async () => {
    const wrong = await mf.dispatchFetch('http://localhost/api/auth/login', { method: 'POST', headers: { Origin: 'http://localhost' }, body: JSON.stringify({ username:'Cory', password:'incorrect-test-value' }) });
    expect(wrong.status).toBe(401);
    const loginResponse = await mf.dispatchFetch('http://localhost/api/auth/login', { method: 'POST', headers: { Origin: 'http://localhost' }, body: JSON.stringify({ username:'Cory', password:testPasswords.Cory }) });
    const header = loginResponse.headers.get('set-cookie')!;
    for (const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=604800']) expect(header).toContain(flag);
    const cookie = header.split(';')[0];
    const request = authenticatedFetch(mf,cookie);
    expect((await request('http://localhost/api/inventory/inspection/save', { method:'POST', headers: { Origin:'https://evil.invalid' } })).status).toBe(403);
    expect((await request('http://localhost/api/auth/logout', {method:'POST'})).status).toBe(200);
    for (const path of endpoints) expect((await request(`http://localhost${path}`)).status).toBe(401);
    const expired = authenticatedFetch(mf,await login(mf));
    await (await mf.getD1Database('DB')).prepare('UPDATE auth_sessions SET expires_at=0').run();
    for (const path of endpoints) expect((await expired(`http://localhost${path}`)).status).toBe(401);
  });
  it('rate limits repeated incorrect passwords in shared D1 state', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare('DELETE FROM auth_attempts').run();
    for (let i=0;i<11;i++) {
      const response = await mf.dispatchFetch('http://localhost/api/auth/login', { method:'POST', headers:{Origin:'http://localhost'}, body:JSON.stringify({ username:'account',password:'wrong' }) });
      expect(response.status).toBe(i===10?429:401);
    }
  });
});
