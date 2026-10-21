import {beforeAll,afterAll,it,expect} from 'vitest';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import {blankResult,type AuditResult} from '../src/changeAudit/model';
import type {CountTask,CountRow} from '../src/skuCount/model';
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>,current:AuditResult;
const id='sku-task-fixture-001',secret='sku-count-manager-secret-12345678',A='a'.repeat(64),B='b'.repeat(64);
const rows:CountRow[]=[{hall:'H1',location:'107-002-1',sku:'S1',barcode:'00001',eBarcode:'ALT-1',customer:'C',name:'商品甲',qty:5},{hall:'H1',location:'107-002-1',sku:'S2',barcode:'00002',customer:'C',name:'商品乙',qty:3},{hall:'H1',location:'108-010-4',sku:'S1',barcode:'00001',customer:'C',name:'商品甲',qty:2}];
const payload={id,name:'SKU cycle count',rows,skus:['S1','S2'],sourceFile:'source.xlsx',sourceHash:'f'.repeat(64)};
const call=(action:string,{manager=false,device='',method='GET',data=undefined as unknown,revision=0,taskId=id,hall='H1',extra={} as Record<string,string>}={})=>mf.dispatchFetch(`https://audit.test/api/inventory/sku-count/${action}?${new URLSearchParams({hallId:hall,taskId,location:'107-002-1',...extra})}`,{method,headers:{Origin:'https://audit.test','Content-Type':'application/json','X-Audit-Publication-Revision':String(revision),...(manager?{'X-Audit-Management-Key':secret}:{}),...(device?{Cookie:'sku_count_device='+device}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
const task=async(device=A)=>await(await call('task',{device})).json() as CountTask;
beforeAll(async()=>{
 const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-10-11',d1Databases:['DB'],r2Buckets:['PHOTO_BUCKET'],bindings:{ENVIRONMENT:'test',CHANGE_AUDIT_MANAGEMENT_KEY:secret}});
 await mf.dispatchFetch('https://audit.test/api/health');db=await mf.getD1Database('DB');
},20000);
afterAll(async()=>mf?.dispose());
it('requires PC management capability, creates frozen standalone drafts idempotently without WMS imports',async()=>{
 expect((await call('tasks',{method:'POST',data:payload})).status).toBe(403);
 expect((await call('tasks',{manager:true,method:'POST',data:payload})).status).toBe(201);expect((await call('tasks',{manager:true,method:'POST',data:payload})).status).toBe(200);
 expect((await call('tasks',{manager:true,method:'POST',data:{...payload,name:'different'}})).status).toBe(400);
 const listing=await call('tasks');expect(listing.headers.get('Set-Cookie')).toContain('HttpOnly');expect((await listing.json() as any).tasks).toHaveLength(0);
 expect((await call('task')).status).toBe(410);
 const draft=await(await call('task',{manager:true})).json() as CountTask;expect(draft.plan.route).toEqual(['107-002-1','108-010-4']);expect(draft.plan.targets[0].skus).toHaveLength(2);expect(draft.canEdit).toBe(false);
 expect((await db.prepare('SELECT COUNT(*) n FROM inventory_imports').first())?.n).toBe(0);
});
it('uses the same manager secret with a separate HttpOnly cookie path and rejects cross-origin writes',async()=>{
 const response=await call('manager',{method:'POST',data:{key:secret}});expect(response.status).toBe(200);expect(response.headers.get('Set-Cookie')).toContain('Path=/api/inventory/sku-count/');
 expect((await mf.dispatchFetch('https://audit.test/api/inventory/sku-count/manager',{method:'POST',headers:{Origin:'https://evil.test'},body:JSON.stringify({key:secret})})).status).toBe(403);
});
it('publishes per hall and atomically allows only one claimant; public read-only devices cannot write',async()=>{
 expect((await call('lifecycle',{manager:true,method:'POST',data:{status:'PUBLISHED',revision:0}})).status).toBe(200);
 const t=await task();expect(t.canEdit).toBe(false);expect(t.plan.targets[0].skus[0].qty).toBe(5);
 expect((await call('save',{device:B,method:'POST',data:blankResult(t.plan.targets[0]),revision:1})).status).toBe(403);
 const claims=await Promise.all([call('claim',{device:A,method:'POST',data:{name:'Alice',revision:1}}),call('claim',{device:B,method:'POST',data:{name:'Bob',revision:1}})]);
 expect(claims.filter(r=>r.status===200)).toHaveLength(1);
 // Normalize the test owner if the second request won the race.
 if(claims[1].status===200){expect((await call('release',{manager:true,method:'POST',data:{revision:2}})).status).toBe(200);expect((await call('claim',{device:A,method:'POST',data:{name:'Alice',revision:3}})).status).toBe(200);}
 const owned=await task();expect(owned.mine).toBe(true);expect(owned.claimedBy).toBe('Alice');expect(owned.canEdit).toBe(true);
 expect((await call('task',{device:A,hall:'H2'})).status).toBe(404);
 expect((await call('claim',{device:B,method:'POST',data:{name:'Bob',revision:owned.publicationRevision}})).status).toBe(409);
});
it('autosaves shortage and same-SKU surplus without images, rejects stale result revisions and acknowledges exact retries',async()=>{
 const t=await task(),target=t.plan.targets[0],result=blankResult(target);result.lines=result.lines.map(l=>({...l,actual:l.sku==='S1'?5:2}));result.lines.push({id:'extra:same-sku-001',sku:'S1',barcode:'',actual:2,notes:''});result.completed=true;
 const response=await call('save',{device:A,method:'POST',data:result,revision:t.publicationRevision});expect(response.status).toBe(200);current=await response.json() as AuditResult;expect(current).toMatchObject({completed:true,anomaly:true,revision:1});
 expect((await call('save',{device:A,method:'POST',data:result,revision:t.publicationRevision})).status).toBe(200);
 expect((await call('save',{device:A,method:'POST',data:{...result,notes:'conflict'},revision:t.publicationRevision})).status).toBe(409);
 expect((await task()).photos).toHaveLength(0);
});
it('requires corresponding images for different SKUs, protects image ownership and disallows losing evidence on completed results',async()=>{
 const t=await task();const different={...current,lines:[...current.lines,{id:'extra:wrong-sku-001',sku:'OTHER',barcode:'',actual:1,notes:''}]};
 expect((await call('save',{device:A,method:'POST',data:different,revision:t.publicationRevision})).status).toBe(400);
 const staged=await call('save',{device:A,method:'POST',data:{...different,completed:false},revision:t.publicationRevision});expect(staged.status).toBe(200);current=await staged.json() as AuditResult;
 const query=new URLSearchParams({hallId:'H1',taskId:id,location:'107-002-1',lineId:'extra:wrong-sku-001',photoId:'sku-photo-fixture-001'});
 const bytes=new Uint8Array([255,216,255,42]);
 const upload=await mf.dispatchFetch('https://audit.test/api/inventory/sku-count/photo?'+query,{method:'POST',headers:{Origin:'https://audit.test',Cookie:'sku_count_device='+A,'X-Audit-Publication-Revision':String(t.publicationRevision),'Content-Type':'image/jpeg'},body:bytes});expect(upload.status).toBe(201);
 const saved=await call('save',{device:A,method:'POST',data:{...current,completed:true},revision:t.publicationRevision});expect(saved.status).toBe(200);current=await saved.json() as AuditResult;
 expect((await call('save',{device:A,method:'POST',data:{...current,ignoredPhotoIds:['sku-photo-fixture-001']},revision:t.publicationRevision})).status).toBe(400);
 expect((await call('save',{device:A,method:'POST',data:{...current,photoLines:{'sku-photo-fixture-001':'book:S1'}},revision:t.publicationRevision})).status).toBe(400);
 const fetched=await call('photo',{device:A,extra:{photoId:'sku-photo-fixture-001'}});expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes);
 expect((await(await mf.getR2Bucket('PHOTO_BUCKET')).list()).objects[0].key).toBe(`sku-count/H1/${id}/sku-photo-fixture-001`);
});
it('releases and transfers a task without losing progress; old owners and versions cannot save or upload',async()=>{
 const t=await task();expect((await call('release',{device:B,method:'POST',data:{revision:t.publicationRevision}})).status).toBe(403);
 expect((await call('release',{manager:true,method:'POST',data:{revision:t.publicationRevision}})).status).toBe(200);
 expect((await call('save',{device:A,method:'POST',data:current,revision:t.publicationRevision})).status).toBe(403);
 expect((await call('claim',{device:B,method:'POST',data:{name:'Bob',revision:t.publicationRevision+1}})).status).toBe(200);
 const transferred=await task(B);expect(transferred.results['107-002-1']).toMatchObject({completed:true,revision:current.revision});expect(transferred.photos).toHaveLength(1);expect(transferred.claimedBy).toBe('Bob');
 expect((await call('save',{device:B,method:'POST',data:{...current,notes:'Bob'},revision:t.publicationRevision})).status).toBe(409);
 expect((await call('save',{device:B,method:'POST',data:{...current,notes:'Bob'},revision:transferred.publicationRevision})).status).toBe(200);
});
it('keeps same-location tasks isolated and soft deletion retains read-only history without original data writes',async()=>{
 const other='sku-task-fixture-002';expect((await call('tasks',{manager:true,method:'POST',data:{...payload,id:other}})).status).toBe(201);
 const fresh=await(await call('task',{manager:true,taskId:other})).json() as CountTask;expect(fresh.results).toEqual({});expect(fresh.photos).toEqual([]);
 expect((await call('photo',{manager:true,taskId:other,extra:{photoId:'sku-photo-fixture-001'}})).status).toBe(404);
 const t=await task(B);expect((await call('lifecycle',{manager:true,method:'POST',data:{status:'WITHDRAWN',revision:t.publicationRevision}})).status).toBe(200);
 expect((await call('task',{device:B})).status).toBe(410);
 expect((await call('lifecycle',{manager:true,method:'POST',data:{status:'DELETED',revision:t.publicationRevision+1}})).status).toBe(200);
 expect((await call('photo',{device:B,extra:{photoId:'sku-photo-fixture-001'}})).status).toBe(410);
 const history=await(await call('task',{manager:true})).json() as CountTask;expect(history.results['107-002-1'].completed).toBe(true);expect(history.canEdit).toBe(false);
 for(const table of ['inventory_imports','location_inspections','sku_inspections','change_audit_tasks','change_audit_results'])expect((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first())?.n).toBe(0);
});
