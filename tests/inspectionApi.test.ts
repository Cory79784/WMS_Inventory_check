import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';

let mf: Miniflare;
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2024-10-11', d1Databases: ['DB'], r2Buckets: ['PHOTO_BUCKET'],
    bindings: { ENVIRONMENT: 'test' } });
  await mf.dispatchFetch('http://localhost/api/health');
  const db = await mf.getD1Database('DB');
  await db.prepare(`INSERT INTO inventory_imports (import_id,hall_id,version_number,original_filename,file_sha256,uploaded_by,status)
    VALUES ('v1','H1',1,'one.xlsx','hash1','test','ARCHIVED'), ('v2','H1',2,'two.xlsx','hash2','test','PUBLISHED')`).run();
  await db.prepare("UPDATE active_hall_imports SET active_import_id = 'v2' WHERE hall_id = 'H1'").run();
  await db.prepare(`INSERT INTO location_inspections
    (inspection_id,hall_id,location_code,reference_import_id,status,is_empty_confirmed,completed_at,notes)
    VALUES ('normal','H1','109-027-1','v1','VERIFIED',0,'2026-10-11','正常'),
    ('diff','H1','109-028-1','v1','PENDING_REVIEW',0,'2026-10-11','少货'),
    ('empty','H1','109-029-1','v1','VERIFIED',1,'2026-10-11','空库位'),
    ('partial','H1','109-030-1','v1','IN_PROGRESS',0,NULL,'暂存'),
    ('other','H2','109-028-1','v1','VERIFIED',1,'2026-10-11','另一厅')`).run();
  await db.prepare(`INSERT INTO sku_inspections (id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type)
    VALUES ('n','normal','N',10,10,0,'NORMAL'),('d','diff','D',10,8,-2,'SHORTAGE'),
    ('p','partial','P',10,0,-10,'SHORTAGE')`).run();
  await db.prepare(`INSERT INTO inspection_photos (photo_id,inspection_id,object_key)
    VALUES ('photo1','diff','original1.jpg'),('photo2','diff','original2.png')`).run();
  // A WMS-only location must never appear in exported actual results.
  await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
    VALUES ('book','v2','H1','109-031-1','NOT_INSPECTED',100)`).run();
}, 20000);
afterAll(async () => { await mf?.dispose(); });

describe('Real local D1/R2 inspection API', () => {
  it('exports only completed actual results, including empty locations and locked reference versions', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all');
    expect(response.status).toBe(200);
    const { rows } = await response.json() as any;
    expect(rows.map((r: any) => r.sku)).toEqual(['N', 'D', '空库位']);
    expect(rows.every((r: any) => r.referenceImportId === 'v1' && r.versionNumber === 1)).toBe(true);
  });
  it('exports only inventory anomalies in differences mode', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/inventory/inspection/export?hallId=H1&mode=differences');
    const { rows } = await response.json() as any;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: 'D', systemQty: 10, actualQty: 8, differenceQty: -2 });
    expect(rows[0].photoKeys).toEqual(['original1.jpg', 'original2.png']);
  });
  it('writes unchanged original bytes through raw streaming and legacy multipart uploads', async () => {
    const original = Uint8Array.from([137,80,78,71,13,10,26,10,255,0,1,2,3]);
    for (const mode of ['raw', 'multipart', 'http-stream']) {
      const multipart = mode === 'multipart';
      const form = new FormData();
      form.append('photo', new Blob([original], { type: 'image/png' }), 'original.png');
      form.append('hallId', 'H1'); form.append('locationCode', '109-028-1');
      const path = '/api/inventory/inspection/photo?hallId=H1&locationCode=109-028-1&filename=original.png';
      const options = {
        method: 'POST', body: multipart ? form : original,
        ...(multipart ? {} : { headers: { 'Content-Type': 'image/png' } }),
      };
      const response = mode === 'http-stream'
        ? await fetch(new URL(path, await mf.ready), options)
        : await mf.dispatchFetch(`http://localhost${path}`, options);
      expect(response.status, await response.clone().text()).toBe(200);
      const photo = await response.json() as any;
      expect(photo.objectKey).toMatch(/\.png$/);
      const downloaded = await mf.dispatchFetch(`http://localhost${photo.previewUrl}`);
      expect(downloaded.headers.get('Content-Type')).toBe('image/png');
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
    }
  });
  it('marks incomplete saves as incomplete and keeps them out of export', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-032-1', status: 'IN_PROGRESS', skus: [] }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json() as any;
    const db = await mf.getD1Database('DB');
    expect((await db.prepare('SELECT completed_at FROM location_inspections WHERE inspection_id = ?')
      .bind(saved.inspectionId).first())?.completed_at).toBeNull();
    const exported = await (await mf.dispatchFetch('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all')).json() as any;
    expect(exported.rows).toHaveLength(3);
  });
  it('returns saved photo keys in the existing frontend shape after reloading', async () => {
    const response = await mf.dispatchFetch('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-033-1', status: 'VERIFIED',
        isEmptyConfirmed: true, skus: [], photos: [{ photoId: 'reload-photo', objectKey: 'original.png' }] }),
    });
    expect(response.status).toBe(200);
    const reloaded = await (await mf.dispatchFetch('http://localhost/api/inventory/location?hallId=H1&locationCode=109-033-1')).json() as any;
    expect(reloaded.data.inspection.photos).toEqual([{ photoId: 'reload-photo', objectKey: 'original.png' }]);
    expect(reloaded.data.navigation.prevLocationCode).toBe('109-032-1');
    expect(reloaded.data.navigation.nextLocationCode).toBe('109-034-1');
  });
});
