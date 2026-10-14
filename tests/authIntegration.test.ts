import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { login, testCredentials, testPasswords, authenticatedFetch } from './helpers/auth';
let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-10-11',
    d1Databases: ['DB'], r2Buckets: ['PHOTO_BUCKET'], bindings: { ENVIRONMENT: 'test' } });
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
describe('Public access with real D1', () => {
  it('opens read endpoints without credentials or cookies', async () => {
    for (const path of ['/api/auth/me', '/api/health', '/api/d1-test', '/api/r2-test', '/api/inventory/imports?hallId=H1', '/api/inventory/active-version?hallId=H1']) {
      expect((await mf.dispatchFetch(`http://localhost${path}`)).status).toBe(200);
    }
    const me = await (await mf.dispatchFetch('http://localhost/api/auth/me')).json() as any;
    expect(me).toMatchObject({ authenticated: true, mode: 'public', user: { name: 'public' } });
  });
  it('saves inspections without a session and records public attribution', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', referenceImportId: 'v1', locationCode: '109-070-1', status: 'IN_PROGRESS', skus: [] }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json() as any;
    const db = await mf.getD1Database('DB');
    const record = await db.prepare('SELECT operator_id FROM location_inspections WHERE inspection_id=?').bind(saved.inspectionId).first();
    expect(record).toMatchObject({ operator_id: 'public' });
    // A subsequent request (like a page refresh) still works without a cookie.
    expect((await mf.dispatchFetch('http://localhost/api/inventory/active-version?hallId=H1')).status).toBe(200);
  });
  it('removes login/logout and retains same-origin write checks', async () => {
    for (const path of ['/api/auth/login', '/api/auth/logout']) {
      expect((await mf.dispatchFetch(`http://localhost${path}`, { method: 'POST' })).status).toBe(404);
    }
    expect((await mf.dispatchFetch('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { Origin: 'https://other.invalid' },
    })).status).toBe(403);
  });
});
