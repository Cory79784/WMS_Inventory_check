import {beforeAll,afterAll,it,expect,describe} from 'vitest';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import {blankResult,defaultRoute} from '../src/changeAudit/model';import type {AuditTask} from '../src/changeAudit/model';
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const id='task-fixture-001';
const request=(action:string,method='GET',data?:unknown,params:Record<string,string>={})=>mf.dispatchFetch(`http://localhost/api/inventory/change-audit/${action}?${new URLSearchParams({hallId:'H1',taskId:id,...params})}`,{method,headers:{Origin:'http://localhost','X-Audit-Management-Key':'test-management-capability-123456789','X-Audit-Publication-Revision':'0','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
const read=async()=>await(await request('task')).json() as AuditTask;
beforeAll(async()=>{
 const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{ENVIRONMENT:'test',CHANGE_AUDIT_MANAGEMENT_KEY:'test-management-capability-123456789'}});
 await mf.dispatchFetch('http://localhost/api/health');db=await mf.getD1Database('DB');
 for(const [version,hall,number,status] of [['old','H1',1,'PUBLISHED'],['new','H1',2,'PUBLISHED'],['future','H1',3,'PUBLISHED'],['other','H2',1,'PUBLISHED'],['staging','H1',4,'STAGING']]) await db.prepare('INSERT INTO inventory_imports(import_id,hall_id,version_number,original_filename,file_sha256,uploaded_by,status) VALUES(?,?,?,?,?,?,?)').bind(version,hall,number,'fixture.xlsx',version,'test',status).run();
 await db.prepare("UPDATE active_hall_imports SET active_import_id='new' WHERE hall_id='H1'").run();
 let row=0;
 for(const [version,location,sku,qty,customer] of [
  ['old','103-001-1','12345678',2,'client'],['new','103-001-1','12345678',3,'client'],
  ['old','103-001-1','KEEP',10,'client'],['new','103-001-1','KEEP',10,'client'],
  ['old','103-001-1','REMOVE',3,'client'], // SKU cleared, but location still occupied
  ['new','104-001-1','12345679',8,'client'],
  ['old','105-001-1','EMPTY',5,'client'],['new','106-001-1','NEW',9,'client'],['new','REI-14','SPECIAL',1,'client']
 ]) await db.prepare('INSERT INTO inventory_stock_rows(id,import_id,hall_id,location_code,sku,system_qty,customer_code,barcode,name_zh) VALUES(?,?,?,?,?,?,?,?,?)').bind(String(++row),version,'H1',location,sku,qty,customer,'00001','商品原文').run();
 await db.prepare("INSERT INTO location_inspections(inspection_id,hall_id,location_code,reference_import_id,status,notes) VALUES('original','H1','103-001-1','new','VERIFIED','untouched')").run();
},20000);
afterAll(async()=>mf?.dispose());
describe('Independent D1 tasks, results, and photos',()=>{
 it('creates an idempotent plan from full new inventory with separate classifications and special places',async()=>{
  const payload={id,oldId:'old',newId:'new',config:defaultRoute};
  expect((await request('tasks','POST',payload)).status).toBe(201);expect((await request('tasks','POST',payload)).status).toBe(200);
  const task=await read();expect(task.stale).toBe(false);expect(task.results).toEqual({});
  const target=task.plan.targets.find(t=>t.location==='103-001-1')!;
  expect(target.category).toBe('CHANGED');expect(target.skus.map(s=>s.sku)).toContain('KEEP');expect(target.skus.find(s=>s.sku==='REMOVE')?.qty).toBe(0);
  expect(target.risks.map(r=>r.kind)).toEqual(expect.arrayContaining(['multi','similarCustomer','nearby']));
  expect(task.plan.targets.find(t=>t.location==='104-001-1')?.category).toBe('NEW_LOCATION');
  expect(task.plan.targets.find(t=>t.location==='105-001-1')?.category).toBe('EMPTIED_LOCATION');expect(task.plan.special).toEqual(['REI-14']);
  const listing=await(await request('tasks')).json() as any;expect(listing.tasks).toHaveLength(1);
 });
 it('browsing does not count as a quantity check; validates counts and explicit empty confirmation',async()=>{
  const task=await read(),target=task.plan.targets.find(t=>t.location==='105-001-1')!;
  const draft=blankResult(target),params={location:target.location};
  expect((await request('save','POST',{...draft,completed:true},params)).status).toBe(400);
  const counted={...draft,lines:draft.lines.map(l=>({...l,actual:0})),completed:true};
  expect((await request('save','POST',counted,params)).status).toBe(400);
  expect((await request('save','POST',{...counted,emptyConfirmed:true},params)).status).toBe(200);
  expect((await read()).results[target.location]).toMatchObject({completed:true,revision:1,anomaly:false});
 });
 it('autosaves partials, preserves later revisions, retries lost acknowledgements, and rejects stale writes',async()=>{
  const task=await read(),target=task.plan.targets.find(t=>t.location==='103-001-1')!;
  const draft=blankResult(target);draft.lines[0].actual=2;draft.notes='independent';
  const params={location:target.location};
  const first=await(await request('save','POST',draft,params)).json() as any;expect(first).toMatchObject({revision:1,completed:false,anomaly:true});
  expect((await(await request('save','POST',draft,params)).json() as any).revision).toBe(1);
  const next={...draft,revision:1,notes:'second'};expect((await request('save','POST',next,params)).status).toBe(200);
  expect((await request('save','POST',{...draft,notes:'overwrite attempt'},params)).status).toBe(409);
  expect((await read()).results[target.location]).toMatchObject({notes:'second',revision:2});
 });
 it('uses independent image keys/links; retains raw bytes; rejects cross-task photo access',async()=>{
  const task=await read(),location='103-001-1',lineId=`book:${task.plan.targets.find(t=>t.location===location)!.skus[0].sku}`;
  const query=new URLSearchParams({hallId:'H1',taskId:id,location,lineId,photoId:'photo-fixture-001'});
  const bytes=new Uint8Array([255,216,255,1,2,3]);
  for(let repeat=0;repeat<2;repeat++) expect((await mf.dispatchFetch(`http://localhost/api/inventory/change-audit/photo?${query}`,{method:'POST',headers:{Origin:'http://localhost','X-Audit-Management-Key':'test-management-capability-123456789','X-Audit-Publication-Revision':'0','Content-Type':'image/jpeg'},body:bytes})).status).toBe(repeat?200:201);
  const photo=await request('photo','GET',undefined,{photoId:'photo-fixture-001'});expect(new Uint8Array(await photo.arrayBuffer())).toEqual(bytes);
  expect((await read()).photos).toMatchObject([{id:'photo-fixture-001',location,lineId}]);
  expect((await request('photo','GET',undefined,{photoId:'photo-fixture-001',hallId:'H2'})).status).toBe(404);
  const bucket=await mf.getR2Bucket('PHOTO_BUCKET');expect((await bucket.list()).objects[0].key).toMatch(/^change-audit\/H1\//);
 });
 it('rejects cross-hall, staging, reversed/history task creation and invalid pairs',async()=>{
  for(const [oldId,newId] of [['other','new'],['old','staging'],['new','old'],['old','old']]) expect((await request('tasks','POST',{id:`bad-${oldId}-${newId}`,oldId,newId,config:defaultRoute})).status).toBeGreaterThanOrEqual(400);
  expect((await request('task','GET',undefined,{hallId:'H2'})).status).toBe(404);
  expect((await request('tasks','POST',{id:'task-invalid-pairs',oldId:'old',newId:'new',config:{...defaultRoute,pairs:[[103,104],[104,105]]}})).status).toBe(400);
  expect((await request('save','POST',{}, {location:'999-001-1'})).status).toBe(400);
 });
 it('reads original references in one location query for the exact hall and new snapshot, without copying task results',async()=>{
  for(const [inspection,hall,version,location] of [['old-reference','H1','old','103-001-1'],['foreign-reference','H2','new','103-001-1'],['neighbor-reference','H1','new','104-001-1']]) await db.prepare("INSERT INTO location_inspections(inspection_id,hall_id,location_code,reference_import_id,status) VALUES(?,?,?,?,'VERIFIED')").bind(inspection,hall,location,version).run();
  for(const [line,inspection,sku,book,actual,diff,type] of [
   ['ref-short','original','12345678',3,1,-2,'SHORTAGE'],['ref-extra','original','12345678',0,2,2,'SURPLUS'],['ref-normal','original','KEEP',10,10,0,'NORMAL'],
   ['ref-old','old-reference','12345678',2,99,97,'SURPLUS'],['ref-foreign','foreign-reference','12345678',3,98,95,'SURPLUS'],['ref-neighbor','neighbor-reference','12345678',3,97,94,'SURPLUS']
  ]) await db.prepare('INSERT INTO sku_inspections(id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type,notes) VALUES(?,?,?,?,?,?,?,?)').bind(line,inspection,sku,book,actual,diff,type,'原核查备注').run();
  const before=await read();
  const response=await request('inspection-reference','GET',undefined,{location:'103-001-1'});expect(response.status).toBe(200);
  const reference=await response.json() as any;
  expect(reference.referenceImportId).toBe('new');expect(reference.versionNumber).toBe(2);
  expect(reference.rows).toHaveLength(3);expect(reference.rows).toEqual(expect.arrayContaining([expect.objectContaining({id:'ref-short',discrepancyType:'SHORTAGE',differenceQty:-2}),expect.objectContaining({id:'ref-extra',discrepancyType:'SURPLUS',differenceQty:2})]));
  expect((await request('inspection-reference','GET',undefined,{location:'999-001-1'})).status).toBe(400);
  expect((await request('inspection-reference','GET',undefined,{location:'103-001-1',hallId:'H2'})).status).toBe(404);
  expect((await read()).results).toEqual(before.results);
 });
 it('detects a newly published version, blocks writes/photos, and leaves original data untouched',async()=>{
  const before=(await db.prepare('SELECT * FROM location_inspections').all()).results;
  const beforeSkus=(await db.prepare('SELECT * FROM sku_inspections ORDER BY id').all()).results;
  const stock=(await db.prepare('SELECT * FROM inventory_stock_rows ORDER BY id').all()).results;
  await db.prepare("UPDATE active_hall_imports SET active_import_id='future' WHERE hall_id='H1'").run();
  const task=await read();expect(task.stale).toBe(true);
  expect(await(await request('status')).json()).toMatchObject({stale:true});
  expect((await request('save','POST',task.results['103-001-1'],{location:'103-001-1'})).status).toBe(409);
  expect((await mf.dispatchFetch(`http://localhost/api/inventory/change-audit/photo?${new URLSearchParams({hallId:'H1',taskId:id,location:'103-001-1',photoId:'photo-stale-fixture'})}`,{method:'POST',headers:{Origin:'http://localhost','X-Audit-Management-Key':'test-management-capability-123456789','X-Audit-Publication-Revision':'0','Content-Type':'image/jpeg'},body:new Uint8Array([1])})).status).toBe(409);
  expect((await db.prepare('SELECT * FROM location_inspections').all()).results).toEqual(before);
  expect((await db.prepare('SELECT * FROM inventory_stock_rows ORDER BY id').all()).results).toEqual(stock);
  expect((await db.prepare('SELECT * FROM sku_inspections ORDER BY id').all()).results).toEqual(beforeSkus);expect((await db.prepare('SELECT COUNT(*) n FROM inspection_photos').first())?.n).toBe(0);
 });
});
