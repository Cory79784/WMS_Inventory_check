import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { login, testCredentials, authenticatedFetch } from './helpers/auth';

let mf: Miniflare;
let request: ReturnType<typeof authenticatedFetch>;
let sessionCookie: string;
beforeAll(async () => {
  const bundle = await build({ entryPoints: ['worker/index.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022' });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2024-10-11', d1Databases: ['DB'], r2Buckets: ['PHOTO_BUCKET'],
    bindings: { ENVIRONMENT: 'test', AUTH_CREDENTIALS: testCredentials } });
  await mf.dispatchFetch('http://localhost/api/health');
  sessionCookie = await login(mf);
  request = authenticatedFetch(mf, sessionCookie);
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
    const response = await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all');
    expect(response.status).toBe(200);
    const { rows } = await response.json() as any;
    expect(rows.filter((r: any) => r.rowType === 'sku').map((r: any) => r.sku)).toEqual(['N', 'D']);
    expect(rows.filter((r: any) => r.rowType === 'location')).toHaveLength(3);
    expect(rows.every((r: any) => r.importedAt && r.status)).toBe(true);
    expect(rows.find((r: any) => r.inspectionId === 'empty').isEmptyConfirmed).toBe(1);
    expect(rows.every((r: any) => r.referenceImportId === 'v1' && r.versionNumber === 1)).toBe(true);
  });
  it('exports anomalies and saved notes in differences mode', async () => {
    const response = await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=differences');
    const { rows } = await response.json() as any;
    expect(rows).toHaveLength(4);
    const shortage = rows.find((r: any) => r.sku === 'D');
    expect(shortage).toMatchObject({ sku: 'D', systemQty: 10, actualQty: 8, differenceQty: -2 });
    expect(shortage.photoKeys).toEqual([]);
    expect(rows.find((r: any) => r.inspectionId === 'diff' && r.rowType === 'location').photoKeys).toEqual(['original1.jpg', 'original2.png']);
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
        ? await fetch(new URL(path, await mf.ready), { ...options, headers: { ...options.headers, Cookie: sessionCookie, Origin: (await mf.ready).origin } })
        : await request(`http://localhost${path}`, options);
      expect(response.status, await response.clone().text()).toBe(200);
      const photo = await response.json() as any;
      expect(photo.objectKey).toMatch(/\.png$/);
      const downloaded = await request(`http://localhost${photo.previewUrl}`);
      expect(downloaded.headers.get('Content-Type')).toBe('image/png');
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(original);
    }
  });
  it('marks incomplete saves as incomplete and keeps them out of export', async () => {
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-032-1', status: 'IN_PROGRESS', skus: [] }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json() as any;
    const db = await mf.getD1Database('DB');
    expect((await db.prepare('SELECT completed_at FROM location_inspections WHERE inspection_id = ?')
      .bind(saved.inspectionId).first())?.completed_at).toBeNull();
    const exported = await (await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all')).json() as any;
    expect(exported.rows).toHaveLength(5);
  });
  it('returns saved photo keys in the existing frontend shape after reloading', async () => {
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-033-1', status: 'VERIFIED',
        isEmptyConfirmed: true, skus: [], photos: [{ photoId: 'reload-photo', objectKey: 'original.png', lineId: null }] }),
    });
    expect(response.status).toBe(200);
    const reloaded = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-033-1')).json() as any;
    expect(reloaded.data.importedAt).toBeTruthy();
    expect(reloaded.data.inspection.photos).toEqual([{ photoId: 'reload-photo', objectKey: 'original.png', lineId: null }]);
    expect(reloaded.data.navigation.prevLocationCode).toBe('109-032-1');
    expect(reloaded.data.navigation.nextLocationCode).toBe('109-034-1');
  });
  it('keeps all three SKUs and sums repeated WMS lines at one location', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('a1','v2','H1','109-040-1','A',2),('a2','v2','H1','109-040-1','A',3),
        ('b1','v2','H1','109-040-1','B',4),('c1','v2','H1','109-040-1','C',5)`).run();
    const result = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-040-1')).json() as any;
    expect(result.data.skus.map((sku: any) => [sku.sku, sku.systemQty])).toEqual([['A',5],['B',4],['C',5]]);
  });
  it('updates the same inspection on repeated saves instead of adding another result', async () => {
    const save = async (actualQty: number) => (await (await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        hallId: 'H1', locationCode: '109-040-1', referenceImportId: 'v2', status: 'VERIFIED',
        skus: [{ sku: 'A', systemQty: 5, actualQty, differenceQty: actualQty-5, discrepancyType: actualQty===5?'NORMAL':'SHORTAGE' }],
      }),
    })).json()) as any;
    const first = await save(5);
    const db = await mf.getD1Database('DB');
    await db.prepare("UPDATE location_inspections SET completed_at = '2020-01-01T00:00:00Z' WHERE inspection_id = ?").bind(first.inspectionId).run();
    const second = await save(4);
    expect(second.inspectionId).toBe(first.inspectionId);
    const result = await db.prepare(`SELECT l.completed_at, s.actual_qty FROM location_inspections l
      JOIN sku_inspections s ON l.inspection_id=s.inspection_id WHERE l.inspection_id=?`).bind(first.inspectionId).all();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].actual_qty).toBe(4);
    expect(result.results[0].completed_at).toBe(second.savedAt);
  });
  it('reports an old audit timestamp without applying its counts to a newer WMS version', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('new-n','v2','H1','109-027-1','N',20)`).run();
    const result = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-027-1')).json() as any;
    expect(result.data.referenceImportId).toBe('v2');
    expect(result.data.inspection).toBeNull();
    expect(result.data.skus[0]).toMatchObject({ systemQty: 20, actualQty: null });
    expect(result.data.lastInspection).toMatchObject({ versionNumber: 1, completedAt: '2026-10-11' });
    const staleSave = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-027-1', referenceImportId: 'v1', skus: [] }),
    });
    expect(staleSave.status).toBe(409);
  });
  it('exports SKU-only, barcode-only, and unknown goods into separate identifier columns with photo links', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO location_inspections (inspection_id,hall_id,location_code,reference_import_id,status,completed_at)
      VALUES ('identifiers','H1','109-050-1','v2','PENDING_REVIEW','2026-10-11T12:00:00Z')`).run();
    await db.prepare(`INSERT INTO sku_inspections (id,inspection_id,sku,barcode,system_qty,actual_qty,difference_qty,discrepancy_type)
      VALUES ('id1','identifiers','ONLY-SKU',NULL,0,1,1,'SURPLUS'),
      ('id2','identifiers','条码:123456','123456',0,1,1,'SURPLUS'),
      ('id3','identifiers','无SKU未知品',NULL,0,1,1,'NO_SKU_SURPLUS')`).run();
    await db.prepare("INSERT INTO inspection_photos (photo_id,inspection_id,object_key) VALUES ('unknown-photo','identifiers','original.png')").run();
    for (const mode of ['all', 'differences']) {
      const exported = await (await request(`http://localhost/api/inventory/inspection/export?hallId=H1&mode=${mode}`)).json() as any;
      const rows = exported.rows.filter((r: any) => r.inspectionId === 'identifiers');
      expect(rows.filter((r: any) => r.rowType === 'sku').map((r: any) => [r.sku,r.barcode])).toEqual([['ONLY-SKU',''],['','123456'],['无sku','']]);
      expect(rows.filter((r: any) => r.rowType === 'sku').every((r: any) => r.photoKeys.length === 0)).toBe(true);
      expect(rows.find((r: any) => r.rowType === 'location').photoKeys).toEqual(['original.png']);
    }
  });

  it('persists shortage and surplus return metadata through reload and both exports, then clears it on update', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('return-book','v2','H1','109-060-1','RETURN-BOOK',10)`).run();
    const payload = { hallId: 'H1', locationCode: '109-060-1', referenceImportId: 'v2', status: 'PENDING_REVIEW',
      notes: '库位备注', skus: [
        { sku: 'RETURN-BOOK', systemQty: 10, actualQty: 8, differenceQty: -2, discrepancyType: 'SHORTAGE',
          notes: '少货备注', isReturn: true, returnCode: '000SHORT' },
        { sku: 'RETURN-EXTRA', systemQty: 0, actualQty: 3, differenceQty: 3, discrepancyType: 'SURPLUS',
          notes: '退货多货备注', isReturn: true, returnCode: '0001234567' },
      ] };
    const save = async (body: any) => {
      const response = await request('http://localhost/api/inventory/inspection/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json() as any;
    };
    const saved = await save(payload);
    const reload = async () => (await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-060-1')).json() as any).data;
    expect((await reload()).skus).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: 'RETURN-BOOK', notes: '少货备注', isReturn: true, returnCode: '000SHORT' }),
      expect.objectContaining({ sku: 'RETURN-EXTRA', nameZh: '退货多货备注', isReturn: true, returnCode: '0001234567' }),
    ]));
    for (const mode of ['all', 'differences']) {
      const result = await (await request(`http://localhost/api/inventory/inspection/export?hallId=H1&mode=${mode}`)).json() as any;
      const rows = result.rows.filter((row: any) => row.inspectionId === saved.inspectionId);
      expect(rows).toHaveLength(3);
      const skuRows = rows.filter((row: any) => row.rowType === 'sku');
      expect(skuRows.map((row: any) => row.returnCode).sort()).toEqual(['0001234567', '000SHORT']);
      expect(skuRows.every((row: any) => row.isReturn && !row.notes.includes('库位备注') && !row.notes.includes('@wms-return'))).toBe(true);
      expect(rows.find((row: any) => row.rowType === 'location').notes).toBe('库位备注');
    }
    await save({ ...payload, skus: payload.skus.map(item => ({ ...item, isReturn: false })) });
    expect((await reload()).skus.every((item: any) => !item.isReturn && item.returnCode === '')).toBe(true);
  });

  it('keeps an additional return row sharing a WMS SKU when the location is reloaded', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('same-return-book','v2','H1','109-061-1','SHARED-SKU',10)`).run();
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-061-1', referenceImportId: 'v2', status: 'PENDING_REVIEW', skus: [
        { sku: 'SHARED-SKU', systemQty: 10, actualQty: 10, differenceQty: 0, discrepancyType: 'NORMAL' },
        { sku: 'SHARED-SKU', systemQty: 0, actualQty: 2, differenceQty: 2, discrepancyType: 'SURPLUS', isReturn: true, returnCode: 'SHARED-RET' },
      ] }),
    });
    expect(response.status).toBe(200);
    const result = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-061-1')).json() as any;
    expect(result.data.skus).toHaveLength(2);
    expect(result.data.skus[0]).toMatchObject({ sku: 'SHARED-SKU', systemQty: 10, actualQty: 10, discrepancyType: 'NORMAL' });
    expect(result.data.skus[1]).toMatchObject({ sku: 'SHARED-SKU', systemQty: 0, actualQty: 2, isReturn: true, returnCode: 'SHARED-RET' });
  });

  it('accepts unchecked returns and checked returns without codes for shortages and surplus', async () => {
    const skus = ['SHORTAGE', 'SURPLUS'].flatMap(discrepancyType => [false, true].map(isReturn => ({
      sku: `OPTIONAL-${discrepancyType}-${isReturn}`, systemQty: discrepancyType === 'SHORTAGE' ? 2 : 0,
      actualQty: 1, differenceQty: discrepancyType === 'SHORTAGE' ? -1 : 1, discrepancyType,
      ...(isReturn ? { isReturn: true } : {}),
    })));
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hallId: 'H1', locationCode: '109-062-1', referenceImportId: 'v2', status: 'PENDING_REVIEW', skus }),
    });
    expect(response.status).toBe(200);
    const saved = await response.json() as any;
    const reloaded = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-062-1')).json() as any;
    expect(reloaded.data.skus).toHaveLength(4);
    expect(reloaded.data.skus.filter((item: any) => item.isReturn)).toHaveLength(2);
    expect(reloaded.data.skus.every((item: any) => item.returnCode === '')).toBe(true);
    for (const mode of ['all', 'differences']) {
      const exported = await (await request(`http://localhost/api/inventory/inspection/export?hallId=H1&mode=${mode}`)).json() as any;
      const rows = exported.rows.filter((row: any) => row.inspectionId === saved.inspectionId);
      expect(rows).toHaveLength(4);
      expect(rows.filter((row: any) => row.isReturn)).toHaveLength(2);
      expect(rows.every((row: any) => row.returnCode === '')).toBe(true);
    }
  });

});

describe('P0 evidence filter on real D1', () => {
  it('keeps location notes/photos and SKU/return evidence in all four languages, excludes plain normal rows', async () => {
    const db = await mf.getD1Database('DB');
    for (const [id, notes, skuNotes, photo] of [
      ['p0-plain', '   ', ' ', false], ['p0-auto-normal', '', '盘点正常相符', false],
      ['p0-return-flag', '', '@wms-return-v1:{"notes":"","isReturn":true,"returnCode":""}', false], ['p0-note', '库位备注', '', false],
      ['p0-photo', '', '', true], ['p0-sku', '', 'SKU备注', false],
      ['p0-return', '', '@wms-return-v1:{"notes":"","isReturn":true,"returnCode":"R1"}', false],
    ] as const) {
      await db.prepare(`INSERT INTO location_inspections (inspection_id,hall_id,location_code,reference_import_id,status,completed_at,notes)
        VALUES (?,'H1',?,'v2','VERIFIED','2026-10-13',?)`).bind(id,id,notes).run();
      await db.prepare(`INSERT INTO sku_inspections (id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type,notes)
        VALUES (?,?,'NORMAL',10,10,0,'NORMAL',?)`).bind(id,id,skuNotes).run();
      if (photo) {
        await (await mf.getR2Bucket('PHOTO_BUCKET')).put('p0-original.png', new Uint8Array([1,2,3]));
        await db.prepare('INSERT INTO inspection_photos (photo_id,inspection_id,object_key) VALUES (?,?,?)').bind(id,id,'p0-original.png').run();
      }
    }
    // A mixed location's review status must not export its unrelated normal SKU.
    await db.prepare("UPDATE location_inspections SET status='PENDING_REVIEW' WHERE inspection_id='p0-plain'").run();
    await db.prepare(`INSERT INTO sku_inspections (id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type,notes)
      VALUES ('p0-shortage','p0-plain','SHORTAGE',10,8,-2,'SHORTAGE','')`).run();
    for (const language of ['zh','de','vi','ar']) {
      const result = await (await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=differences', {headers:{'Accept-Language':language}})).json() as any;
      expect(result.rows.filter((r:any) => r.inspectionId.startsWith('p0-')).map((r:any) => r.inspectionId).sort())
        .toEqual(['p0-note','p0-photo','p0-plain','p0-return','p0-return-flag','p0-sku']);
      expect(result.rows.filter((r:any) => r.inspectionId==='p0-plain').map((r:any)=>r.sku)).toEqual(['SHORTAGE']);
      expect(result.rows.find((r:any) => r.inspectionId==='p0-photo').photoKeys).toEqual(['p0-original.png']);
    }
    const all = await (await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all')).json() as any;
    expect(all.rows.filter((r:any)=>r.inspectionId==='p0-plain')).toHaveLength(2);
    expect(all.rows.some((r:any)=>r.inspectionId==='p0-auto-normal')).toBe(true);
    expect(all.rows.some((r:any)=>r.inspectionId==='p0-return-flag')).toBe(true);
  });
  it('returns failure and rolls back the save if actual D1 rejects a statement', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare("CREATE TRIGGER p0_fail BEFORE INSERT ON sku_inspections WHEN NEW.sku = 'D1-FAIL' BEGIN SELECT RAISE(ABORT, 'injected D1 failure'); END").run();
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        hallId:'H1',locationCode:'p0-failure',referenceImportId:'v2',status:'IN_PROGRESS',
        skus:[{sku:'D1-FAIL',systemQty:10,actualQty:8,differenceQty:-2,discrepancyType:'SHORTAGE'}],
      }),
    });
    expect(response.status).toBe(500);
    expect((await response.json() as any).success).toBe(false);
    expect(await db.prepare("SELECT * FROM location_inspections WHERE location_code='p0-failure'").first()).toBeNull();
    await db.prepare('DROP TRIGGER p0_fail').run();
  });
});

describe('Stable line photo associations and precise export', () => {
  const save = async (body: any) => {
    const response = await request('http://localhost/api/inventory/inspection/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json() as any;
  };
  const exported = async (mode = 'differences', scope = 'history') => (await (await request(
    `http://localhost/api/inventory/inspection/export?hallId=H1&mode=${mode}&scope=${scope}`)).json() as any).rows;
  it('keeps equal-SKU book/surplus and two unknown surplus lines separate across reorder, save and reload', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('stable-book','v2','H1','109-080-1','DUP',10)`).run();
    const skus = [
      { lineId:'book:DUP',sku:'DUP',systemQty:10,actualQty:10,differenceQty:0,discrepancyType:'NORMAL' },
      { lineId:'extra:dup',sku:'DUP',systemQty:0,actualQty:2,differenceQty:2,discrepancyType:'SURPLUS' },
      { lineId:'extra:unknown-1',sku:'无SKU未知品',systemQty:0,actualQty:1,differenceQty:1,discrepancyType:'NO_SKU_SURPLUS' },
      { lineId:'extra:unknown-2',sku:'无SKU未知品',systemQty:0,actualQty:3,differenceQty:3,discrepancyType:'NO_SKU_SURPLUS' },
      { lineId:'short:no-photo',sku:'SHORT',systemQty:5,actualQty:3,differenceQty:-2,discrepancyType:'SHORTAGE' },
    ];
    const photos = [
      { photoId:'stable-p1',objectKey:'dup.jpg',lineId:'extra:dup' },
      { photoId:'stable-p2',objectKey:'unknown1-a.jpg',lineId:'extra:unknown-1' },
      { photoId:'stable-p3',objectKey:'unknown1-b.jpg',lineId:'extra:unknown-1' },
      { photoId:'stable-p4',objectKey:'unknown2.jpg',lineId:'extra:unknown-2' },
    ];
    const payload = { hallId:'H1',locationCode:'109-080-1',referenceImportId:'v2',status:'PENDING_REVIEW',skus,photos };
    const saved = await save(payload);
    const idsBefore = await db.prepare('SELECT id FROM sku_inspections WHERE inspection_id=? ORDER BY id').bind(saved.inspectionId).all();
    await save({ ...payload, skus: [...skus].reverse() });
    expect((await db.prepare('SELECT id FROM sku_inspections WHERE inspection_id=? ORDER BY id').bind(saved.inspectionId).all()).results).toEqual(idsBefore.results);
    const reload = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-080-1')).json() as any;
    expect(reload.data.skus.map((s:any)=>s.lineId).sort()).toEqual(skus.map(s=>s.lineId).sort());
    expect(reload.data.inspection.photos.map((p:any)=>[p.objectKey,p.lineId]).sort()).toEqual(photos.map(p=>[p.objectKey,p.lineId]).sort());
    const rows = (await exported()).filter((r:any)=>r.inspectionId===saved.inspectionId);
    expect(rows).toHaveLength(4);
    expect(rows.find((r:any)=>r.lineId==='book:DUP')).toBeUndefined();
    expect(rows.find((r:any)=>r.lineId==='extra:dup').photoKeys).toEqual(['dup.jpg']);
    expect(rows.find((r:any)=>r.lineId==='extra:unknown-1').photoKeys).toEqual(['unknown1-a.jpg','unknown1-b.jpg']);
    expect(rows.find((r:any)=>r.lineId==='extra:unknown-2').photoKeys).toEqual(['unknown2.jpg']);
    expect(rows.find((r:any)=>r.lineId==='short:no-photo').photoKeys).toEqual([]);
    expect((await exported('all')).filter((r:any)=>r.inspectionId===saved.inspectionId)).toHaveLength(5);
  });
  it('retains a targeted photo before the line has an actual count and links it after checking', async () => {
    const db = await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO inventory_stock_rows (id,import_id,hall_id,location_code,sku,system_qty)
      VALUES ('pending-book','v2','H1','109-081-1','PENDING',6)`).run();
    const photo = { photoId:'pending-p',objectKey:'pending.jpg',lineId:'book:PENDING' };
    const payload = { hallId:'H1',locationCode:'109-081-1',referenceImportId:'v2',status:'IN_PROGRESS',skus:[],photos:[photo] };
    const first = await save(payload);
    const reload = await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-081-1')).json() as any;
    expect(reload.data.inspection.photos[0].lineId).toBe(reload.data.skus[0].lineId);
    expect(reload.data.inspection.photos[0].sku).toBe('PENDING');
    expect((await exported()).some((r:any)=>r.inspectionId===first.inspectionId)).toBe(false);
    await save({ ...payload,status:'VERIFIED',skus:[{lineId:'book:PENDING',sku:'PENDING',systemQty:6,actualQty:6,differenceQty:0,discrepancyType:'NORMAL'}] });
    const rows=(await exported()).filter((r:any)=>r.inspectionId===first.inspectionId);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({rowType:'sku',lineId:'book:PENDING',photoKeys:['pending.jpg']});
    await save({ ...payload,status:'VERIFIED',skus:[{lineId:'book:PENDING',sku:'PENDING',systemQty:6,actualQty:6,differenceQty:0,discrepancyType:'NORMAL'}],photos:[] });
    expect((await exported()).find((r:any)=>r.inspectionId===first.inspectionId).photoKeys).toEqual(['pending.jpg']);
  });
  it('never guesses ambiguous legacy SKU photos onto equal-SKU rows', async () => {
    const skus=[1,2].map(n=>({lineId:`legacy-extra:${n}`,sku:'SAME',systemQty:0,actualQty:n,differenceQty:n,discrepancyType:'SURPLUS'}));
    const saved=await save({hallId:'H1',locationCode:'109-082-1',status:'PENDING_REVIEW',skus,
      photos:[{photoId:'legacy-ambiguous',objectKey:'legacy.jpg',sku:'SAME'}]});
    const rows=(await exported()).filter((r:any)=>r.inspectionId===saved.inspectionId);
    expect(rows.filter((r:any)=>r.rowType==='sku').every((r:any)=>r.photoKeys.length===0)).toBe(true);
    expect(rows.find((r:any)=>r.rowType==='location').photoKeys).toEqual(['legacy.jpg']);
  });
  it('upgrades exact legacy links without deleting originals or guessing by SKU', async () => {
    const db=await mf.getD1Database('DB');
    await db.prepare(`INSERT INTO location_inspections (inspection_id,hall_id,location_code,reference_import_id,status,completed_at)
      VALUES ('legacy-exact','H1','109-083-1','v2','PENDING_REVIEW','2026-10-15')`).run();
    await db.prepare(`INSERT INTO sku_inspections (id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type)
      VALUES ('old-line','legacy-exact','OLD',0,2,2,'SURPLUS')`).run();
    await db.prepare(`INSERT INTO inspection_photos (photo_id,inspection_id,sku_inspection_id,object_key)
      VALUES ('old-photo','legacy-exact','old-line','old-original.jpg')`).run();
    const reload=await (await request('http://localhost/api/inventory/location?hallId=H1&locationCode=109-083-1')).json() as any;
    expect(reload.data.inspection.photos[0].lineId).toBe('old-line');
    await save({hallId:'H1',locationCode:'109-083-1',status:'PENDING_REVIEW',skus:reload.data.skus,photos:[]});
    const rows=(await exported()).filter((r:any)=>r.inspectionId==='legacy-exact');
    expect(rows).toHaveLength(1); expect(rows[0].photoKeys).toEqual(['old-original.jpg']);
  });
  it('keeps historical scope explicit and rejects invalid scope or duplicate line IDs', async () => {
    expect((await exported('all','latest')).every((r:any)=>r.referenceImportId==='v2')).toBe(true);
    expect((await exported('all')).some((r:any)=>r.referenceImportId==='v1')).toBe(true);
    expect((await request('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all&scope=invalid')).status).toBe(400);
    const response=await request('http://localhost/api/inventory/inspection/save', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({hallId:'H1',locationCode:'duplicate-lines',skus:[{lineId:'same'},{lineId:'same'}]})});
    expect(response.status).toBe(400);
    expect(await (await mf.getD1Database('DB')).prepare("SELECT * FROM location_inspections WHERE location_code='duplicate-lines'").first()).toBeNull();
  });
});
