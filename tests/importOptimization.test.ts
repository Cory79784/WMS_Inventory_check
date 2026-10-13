import { describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { testCredentials, login, authenticatedFetch } from './helpers/auth';
import { parseWmsRawRow } from './excelMapping.test';

// Synthetic, faithful 18-column single-hall Excel. No customer data is committed.
function fixture() {
  const header = ['SKU','Barcode','eBarcode','客户编码','中文品名','英文品名','厅','库位','库存','体积','可用库存','分配库存','冻结库存','尺寸','重量','类型','新品','带电'];
  const raw = Array.from({length:2524},(_,i) => [`SKU-${i%700}`,`BC-${i%700}`,`E-${i%700},ALT-${i%700}`,'TEST','测试商品','Test product','H1',`109-${String(Math.floor(i/4)+1).padStart(3,'0')}-1`,String(10+i%13),'1.2',String(8+i%13),'1','1','30*20*10','2','T50','N','N']);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...raw]),'库位库存数据');
  const bytes = XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  const parsed = XLSX.read(bytes,{type:'buffer'});
  const rows = (XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]],{header:1}) as string[][]).slice(1).map(parseWmsRawRow);
  return { rows, sha:createHash('sha256').update(bytes).digest('hex') };
}
async function run(includeImports: boolean) {
  const bundle = await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const mf = new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{AUTH_CREDENTIALS:testCredentials}});
  try {
    await mf.dispatchFetch('http://localhost/api/health');
    const authenticated = authenticatedFetch(mf,await login(mf));
    let requests = 0;
    const request = async (path: string, body?: any) => {
      requests++;
      const response = await authenticated(`http://localhost/api/inventory/${path}`,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
      const json = await response.json() as any;
      expect(response.status,JSON.stringify(json)).toBe(200);
      return json;
    };
    const start = performance.now();
    const {rows,sha} = fixture();
    await request('imports?hallId=H1');
    await request('imports/check',{hallId:'H1',sha256:sha});
    const stage = await request('imports/stage',{hallId:'H1',filename:'库位库存_fixture.xlsx',fileSha256:sha,expectedRowCount:rows.length});
    for(let i=0;i<rows.length;i+=60) await request('imports/chunk',{importId:stage.importId,hallId:'H1',rows:rows.slice(i,i+60)});
    const published = await request('imports/publish',{importId:stage.importId,hallId:'H1',includeImports});
    const history = includeImports ? published.imports : (await request('imports?hallId=H1')).data.imports;
    expect(history[0].import_id).toBe(stage.importId);
    expect(history[0].status).toBe('PUBLISHED');
    const elapsedMs = Math.round(performance.now()-start);
    const db = await mf.getD1Database('DB');
    const stored = await db.prepare('SELECT location_code,sku,barcode,e_barcode,system_qty,available_qty,allocated_qty,frozen_qty FROM inventory_stock_rows WHERE import_id=? ORDER BY location_code,sku').bind(stage.importId).all();
    expect(stored.results).toHaveLength(rows.length);
    expect((await db.prepare("SELECT active_import_id FROM active_hall_imports WHERE hall_id='H1'").first())?.active_import_id).toBe(stage.importId);
    return {requests,elapsedMs,summary:published.summary,stored:stored.results};
  } finally {await mf.dispose();}
}
describe('Single-hall import request optimization', () => {
  it('compares the old refresh workflow with inline refresh on real local D1 using a 2524-row Excel', async () => {
    const before = await run(false);
    const after = await run(true);
    expect(after.requests).toBe(before.requests-1);
    expect(after.stored).toEqual(before.stored);
    expect(after.summary).toEqual(before.summary);
    // Local wall time is reported, not used as a flaky correctness assertion.
    console.log('IMPORT_BENCHMARK', JSON.stringify({before:{requests:before.requests,elapsedMs:before.elapsedMs},after:{requests:after.requests,elapsedMs:after.elapsedMs},summary:after.summary}));
  },60000);
  it('keeps failed chunks atomic and recoverable without changing the active version', async () => {
    const bundle = await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
    const mf = new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{AUTH_CREDENTIALS:testCredentials}});
    try {
      await mf.dispatchFetch('http://localhost/api/health');
      const request = authenticatedFetch(mf,await login(mf));
      const post = async (path:string,body:any) => request(`http://localhost/api/inventory/imports/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const stage = await (await post('stage',{hallId:'H1',filename:'test.xlsx',fileSha256:'recovery'})).json() as any;
      const db = await mf.getD1Database('DB');
      await db.prepare("CREATE TRIGGER fail_chunk BEFORE INSERT ON inventory_stock_rows BEGIN SELECT RAISE(ABORT,'chunk failure'); END").run();
      const body = {hallId:'H1',importId:stage.importId,rows:fixture().rows.slice(0,60)};
      expect((await post('chunk',body)).status).toBe(500);
      expect((await db.prepare('SELECT COUNT(*) as count FROM inventory_stock_rows').first())?.count).toBe(0);
      expect((await db.prepare("SELECT active_import_id FROM active_hall_imports WHERE hall_id='H1'").first())?.active_import_id).toBeNull();
      await db.prepare('DROP TRIGGER fail_chunk').run();
      expect((await post('chunk',body)).status).toBe(200);
      const published = await (await post('publish',{hallId:'H1',importId:stage.importId,includeImports:true})).json() as any;
      expect(published.summary.total_rows).toBe(60);
      expect((await post('chunk',body)).status).toBe(400);
      expect((await post('publish',{hallId:'H1',importId:stage.importId,includeImports:true})).status).toBe(400);
    } finally {await mf.dispose();}
  },30000);
});
