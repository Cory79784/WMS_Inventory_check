import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';import ExcelJS from 'exceljs';
import {blankResult,defaultRoute} from '../src/changeAudit/model';import type {AuditTask,AuditResult} from '../src/changeAudit/model';
import {buildTaskResultWorkbook,type TaskExportData} from '../src/changeAudit/taskExport';
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>,task:AuditTask;
const A='export-task-A',B='export-task-B';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=';
const call=(action:string,id=A,method='GET',data?:unknown,extra:Record<string,string>={})=>mf.dispatchFetch(`http://localhost/api/inventory/change-audit/${action}?${new URLSearchParams({hallId:'H1',taskId:id,...extra})}`,{method,headers:{Origin:'http://localhost','Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
const exported=async(id=A,mode='differences')=>await(await call('export',id,'GET',undefined,{mode})).json() as TaskExportData;
async function save(location:string,result:AuditResult,id=A){const response=await call('save',id,'POST',result,{location});expect(response.status).toBe(200);return await response.json() as AuditResult;}
async function photo(id:string,location:string,lineId:string,taskId=A){return mf.dispatchFetch(`http://localhost/api/inventory/change-audit/photo?${new URLSearchParams({hallId:'H1',taskId,location,lineId,photoId:id})}`,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'image/png'},body:Buffer.from(png,'base64')});}
beforeAll(async()=>{
 const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{ENVIRONMENT:'test'}});
 await mf.dispatchFetch('http://localhost/api/health');db=await mf.getD1Database('DB');
 for(const [id,v] of [['old',1],['new',2],['future',3]]) await db.prepare("INSERT INTO inventory_imports(import_id,hall_id,version_number,original_filename,file_sha256,uploaded_by,status) VALUES(?,'H1',?,'fixture.xlsx',?,'test','PUBLISHED')").bind(id,v,id).run();
 await db.prepare("UPDATE active_hall_imports SET active_import_id='new' WHERE hall_id='H1'").run();
 let row=0;
 for(const [loc,sku,qty] of [['103-001-1','NORMAL',5],['103-001-1','SHORT',7],['103-001-1','PHOTO',2],['103-001-1','REMARK',2],['103-001-1','RETURN',2],['103-001-1','PLAIN',3],['104-001-1','LOCATION_NORMAL',2],['105-001-1','UNFINISHED',2]]) for(const version of ['old','new']) await db.prepare("INSERT INTO inventory_stock_rows(id,import_id,hall_id,location_code,sku,barcode,name_zh,system_qty) VALUES(?,?,'H1',?,?,'0000001','原文商品',?)").bind(String(++row),version,loc,sku,Number(qty)-(version==='old'?1:0)).run();
 await db.prepare("INSERT INTO inventory_stock_rows(id,import_id,hall_id,location_code,sku,system_qty) VALUES('empty','old','H1','106-001-1','EMPTY',1)").run();
 for(const id of [A,B]) expect((await call('tasks',id,'POST',{id,oldId:'old',newId:'new',config:defaultRoute})).status).toBe(201);
 task=await(await call('task')).json() as AuditTask;
 const target=task.plan.targets.find(t=>t.location==='103-001-1')!,result=blankResult(target);
 result.lines=result.lines.map(l=>({...l,actual:target.skus.find(s=>s.sku===l.sku)!.qty,...(l.sku==='NORMAL'?{notes:'盘点正常相符'}:l.sku==='SHORT'?{actual:6}:l.sku==='REMARK'?{notes:'手工备注'}:l.sku==='RETURN'?{isReturn:true,returnCode:'RET-001'}:{})}));
 result.lines.push({id:'extra:known-0001',sku:'EXTRA',barcode:'',actual:2,notes:''},{id:'extra:unknown-0001',sku:'',barcode:'',actual:1,notes:'未知货物'});result.completed=false;
 const first=await save(target.location,result);
 expect((await call('save',A,'POST',{...first,completed:true},{location:target.location})).status).toBe(400);await save(target.location,{...result,completed:true,lines:result.lines.filter(l=>l.id!=='extra:unknown-0001'),notes:'TASK B ONLY'},B);
 expect((await photo('photo-line-A','103-001-1','book:PHOTO')).status).toBe(201);
 expect((await photo('photo-unknown-A','103-001-1','extra:unknown-0001')).status).toBe(201);
 await save(target.location,{...first,completed:true});
 const locationTarget=task.plan.targets.find(t=>t.location==='104-001-1')!,location=blankResult(locationTarget);location.lines[0].actual=2;location.notes='库位整体备注';location.completed=true;await save(locationTarget.location,location);
 expect((await photo('photo-location-A',locationTarget.location,'')).status).toBe(201);
 const pending=blankResult(task.plan.targets.find(t=>t.location==='105-001-1')!);pending.notes='UNFINISHED ONLY';await save('105-001-1',pending);
 const empty=blankResult(task.plan.targets.find(t=>t.location==='106-001-1')!);empty.lines[0].actual=0;empty.emptyConfirmed=true;empty.completed=true;await save('106-001-1',empty);
 await db.prepare("INSERT INTO location_inspections(inspection_id,hall_id,location_code,reference_import_id,status,completed_at,notes) VALUES('original','H1','103-001-1','new','VERIFIED','2026-10-19','ORIGINAL ONLY')").run();
 await db.prepare("INSERT INTO sku_inspections(id,inspection_id,sku,system_qty,actual_qty,difference_qty,discrepancy_type) VALUES('original-sku','original','NORMAL',5,4,-1,'SHORTAGE')").run();
},20000);
afterAll(async()=>mf?.dispose());
describe('Task-bound export independent of dates, snapshots and original inspections',()=>{
 it('exports only completed task A and separates line vs location evidence',async()=>{
  const data=await exported();expect(data.task.id).toBe(A);expect(data.completedCount).toBe(3);expect(data.unfinishedCount).toBe(1);
  expect(data.rows.filter(r=>r.rowType==='sku').map(r=>r.sku).sort()).toEqual(['EXTRA','PHOTO','REMARK','RETURN','SHORT','无sku'].sort());
  expect(data.rows.find(r=>r.sku==='PHOTO')?.photoKeys).toEqual(['photo-line-A']);expect(data.rows.find(r=>r.sku==='SHORT')?.photoKeys).toEqual([]);
  const location=data.rows.filter(r=>r.rowType==='location');expect(location).toHaveLength(1);expect(location[0]).toMatchObject({locationCode:'104-001-1',notes:'库位整体备注',photoKeys:['photo-location-A']});
  const json=JSON.stringify(data);expect(json).not.toContain('TASK B ONLY');expect(json).not.toContain('ORIGINAL ONLY');expect(json).not.toContain('UNFINISHED ONLY');
 });
 it('keeps same-day/version task B separate and preserves the original export scope',async()=>{
  const data=await exported(B,'all');expect(data.task.id).toBe(B);expect(data.completedCount).toBe(1);expect(data.rows.some(r=>r.notes==='TASK B ONLY')).toBe(true);
  expect(data.rows.every(r=>r.photoKeys.length===0)).toBe(true);
  const original=await(await mf.dispatchFetch('http://localhost/api/inventory/inspection/export?hallId=H1&mode=all&scope=history')).json() as any;
  expect(JSON.stringify(original)).toContain('ORIGINAL ONLY');expect(JSON.stringify(original)).not.toContain(A);expect(JSON.stringify(original)).not.toContain(B);expect(original.rows.every((r:any)=>r.inspectionId==='original')).toBe(true);
 });
 it('rejects missing task, cross-hall/task photo references and invalid mode',async()=>{
  expect((await call('export','missing','GET',undefined,{mode:'all'})).status).toBe(404);
  expect((await call('export',A,'GET',undefined,{mode:'all',hallId:'H2'})).status).toBe(404);
  expect((await call('export',A,'GET',undefined,{mode:'bad'})).status).toBe(400);
  expect((await call('photo',B,'GET',undefined,{photoId:'photo-line-A'})).status).toBe(404);
 });
 it.each(['zh','en','de'] as const)('reuses workbook layout, image rows and raw names while adding task metadata (%s)',async language=>{
  const data=await exported(),seen:string[]=[];
  const workbook=await buildTaskResultWorkbook(data,async id=>{seen.push(id);return {base64:`data:image/png;base64,${png}`,extension:'png',width:1,height:1};},language);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await workbook.xlsx.writeBuffer());const sheet=loaded.worksheets[0];
  expect(sheet.rowCount).toBe(data.rows.length+1);expect(sheet.getCell('A1').value).toBe(language==='zh'?'库厅':language==='en'?'Hall':'Halle');
  expect(sheet.getColumn(5).values).toContain('原文商品');expect(sheet.getColumn(4).values).toContain('0000001');
  expect(sheet.getImages()).toHaveLength(3);for(const image of sheet.getImages()){expect(image.range.tl.nativeCol).toBe(17);expect(image.range.tl.nativeRow).toBe(image.range.br.nativeRow);}
  expect(seen.sort()).toEqual(['photo-line-A','photo-location-A','photo-unknown-A'].sort());
  const metadata=JSON.stringify(loaded.worksheets[1].getSheetValues());expect(metadata).toContain(A);expect(metadata).not.toContain(B);
 });
 it('persists photo reassignment and all-normal exclusions inside the selected task only',async()=>{
  const C='export-task-C';expect((await call('tasks',C,'POST',{id:C,oldId:'old',newId:'new',config:defaultRoute})).status).toBe(201);
  const target=task.plan.targets.find(t=>t.location==='103-001-1')!,draft=blankResult(target);
  draft.lines=draft.lines.map(l=>({...l,actual:target.skus.find(s=>s.sku===l.sku)!.qty}));draft.completed=true;
  let saved=await save(target.location,draft,C);expect((await photo('photo-reassign-C',target.location,'book:PHOTO',C)).status).toBe(201);
  expect((await exported(C)).rows.find(r=>r.sku==='PHOTO')?.photoKeys).toEqual(['photo-reassign-C']);
  saved=await save(target.location,{...saved,photoLines:{'photo-reassign-C':'book:PLAIN'}},C);
  expect((await exported(C)).rows.find(r=>r.sku==='PLAIN')?.photoKeys).toEqual(['photo-reassign-C']);
  expect((await exported(C)).rows.some(r=>r.sku==='PHOTO')).toBe(false);
  expect((await call('save',C,'POST',{...saved,photoLines:{'photo-line-A':'book:PHOTO'}},{location:target.location})).status).toBe(400);
  await save(target.location,{...saved,ignoredPhotoIds:['photo-reassign-C']},C);
  expect((await exported(C)).rows).toEqual([]);expect((await exported()).rows.find(r=>r.sku==='PHOTO')?.photoKeys).toEqual(['photo-line-A']);
 });
 it('still exports saved historical results after the task reference becomes stale',async()=>{
  await db.prepare("UPDATE active_hall_imports SET active_import_id='future' WHERE hall_id='H1'").run();
  const data=await exported();expect(data.rows.length).toBeGreaterThan(0);expect(data.task.newVersion.importId).toBe('new');
 });
});
