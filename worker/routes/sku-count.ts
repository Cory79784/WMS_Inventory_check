import {validScope,orderedScopes} from '../../src/skuCount/areas';
import type {Env} from '../types';
import {isAuditManager,managerSession} from '../changeAuditAccess';
import {buildCountPlan,needsIdentityPhoto,type CountPlan} from '../../src/skuCount/model';
import {isAnomaly,type AuditResult,type Target} from '../../src/changeAudit/model';
class ErrorResponse extends Error {constructor(public status:number,message:string){super(message);}}
function need(valid:unknown,code='INVALID_INPUT'):asserts valid {if(!valid)throw new ErrorResponse(400,code);}
const str=(value:unknown,max=2000):value is string=>typeof value==='string'&&value.length<=max;
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
async function body(request:Request,max=200000){if(Number(request.headers.get('Content-Length')||0)>max)throw new ErrorResponse(413,'PAYLOAD_TOO_LARGE');const raw=await request.text();if(raw.length>max)throw new ErrorResponse(413,'PAYLOAD_TOO_LARGE');try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value));return value;}catch{throw new ErrorResponse(400,'INVALID_INPUT');}}
interface Row {id:string;hall_id:string;name:string;plan_json:string;request_hash:string;status:string;revision:number;claim_hash:string|null;claimed_by:string|null;created_at:string}
async function validatedResult(input:any,target:Target,photos:Array<{id:string;line_id:string}>):Promise<Omit<AuditResult,'revision'>> {
 need(Number.isInteger(input.revision)&&input.revision>=0&&Array.isArray(input.lines)&&input.lines.length<=1000);
 need(str(input.notes)&&typeof input.completed==='boolean'&&typeof input.emptyConfirmed==='boolean');
 const ids=new Set<string>();
 for(const line of input.lines){
  need(line&&str(line.id,200)&&!ids.has(line.id)&&str(line.sku,150)&&str(line.barcode,300)&&str(line.notes,1000));ids.add(line.id);
  need(line.actual===null || Number.isSafeInteger(line.actual)&&line.actual>=0&&line.actual<=1000000000);
  need(line.isReturn===undefined||typeof line.isReturn==='boolean');need(line.returnCode===undefined||str(line.returnCode,300));
  if(line.id.startsWith('book:')){const book=target.skus.find(s=>`book:${s.sku}`===line.id);need(book&&book.sku===line.sku&&book.barcode===line.barcode,'INVALID_LINE');}
  else need(/^extra:[\w-]{8,80}$/.test(line.id),'INVALID_LINE');
 }
 need(target.skus.every(s=>ids.has(`book:${s.sku}`)),'MISSING_BOOK_LINES');
 const result:Omit<AuditResult,'revision'>={lines:input.lines.map((l:any)=>({id:l.id,sku:l.sku,barcode:l.barcode,actual:l.actual,notes:l.notes,...(l.isReturn!==undefined?{isReturn:l.isReturn}:{}),...(l.returnCode!==undefined?{returnCode:l.isReturn?l.returnCode:''}:{})})),notes:input.notes,completed:input.completed,emptyConfirmed:input.emptyConfirmed};
 const own=new Set(photos.map(p=>p.id));
 if(input.ignoredPhotoIds!==undefined){need(Array.isArray(input.ignoredPhotoIds)&&input.ignoredPhotoIds.length<=1000&&input.ignoredPhotoIds.every((id:unknown)=>str(id,80)&&own.has(id)));result.ignoredPhotoIds=[...new Set(input.ignoredPhotoIds)] as string[];}
 if(input.photoLines!==undefined){need(input.photoLines&&typeof input.photoLines==='object'&&!Array.isArray(input.photoLines)&&Object.keys(input.photoLines).length<=1000);need(Object.entries(input.photoLines).every(([photo,line])=>own.has(photo)&&typeof line==='string'&&(line===''||ids.has(line))),'INVALID_PHOTO_LINE');result.photoLines=input.photoLines;}
 need(!result.emptyConfirmed || result.lines.every(line=>line.actual===0),'INVALID_EMPTY_CONFIRMATION');
 if(result.completed){need(result.lines.every(l=>l.actual!==null),'INCOMPLETE_COUNTS');need(result.lines.every(l=>l.id.startsWith('book:')||l.sku||l.barcode||l.notes),'IDENTIFY_EXTRA');}
 // Reassignment/ignoring evidence must not invalidate already saved completed wrong-SKU results.
 const noEvidence=result.lines.some(l=>needsIdentityPhoto(target,l)&&!photos.some(p=>!result.ignoredPhotoIds?.includes(p.id)&&(result.photoLines?.[p.id]??p.line_id)===l.id));
 if(noEvidence&&result.completed)throw new ErrorResponse(400,'PHOTO_REQUIRED');
 result.anomaly=isAnomaly(target,{...result,revision:input.revision});return result;
}
export async function handleSkuCount(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url),action=url.pathname.split('/').pop(),hall=url.searchParams.get('hallId');
 try{
  if(action==='manager')return managerSession(request,env,'/api/inventory/sku-count/');
  const manager=await isAuditManager(request,env);const manage=()=>{if(!manager)throw new ErrorResponse(403,'MANAGEMENT_REQUIRED');};
  if(action==='scopes'&&request.method==='GET'){
   const scopes=await env.DB.prepare("SELECT DISTINCT hall_id FROM sku_count_tasks WHERE status='PUBLISHED' OR ?=1").bind(manager?1:0).all<{hall_id:string}>();
   return json({scopes:orderedScopes(scopes.results.map(r=>r.hall_id))});
  }
  need(validScope(hall));
  let token=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('sku_count_device='))?.slice(17)||'';
  if(!/^[a-f0-9]{64}$/.test(token))token='';
  const deviceHeader:Record<string,string>={};
  if(!token&&action==='tasks'&&request.method==='GET'){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');deviceHeader['Set-Cookie']=`sku_count_device=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/inventory/sku-count/; Max-Age=31536000`;}
  const actor=token?await hash(token):'';
  if(action==='tasks'){
   if(request.method==='GET'){
    const tasks=await env.DB.prepare(`SELECT id,name,status AS lifecycle,revision AS publicationRevision,claimed_by AS claimedBy,
     CASE WHEN claim_hash=? AND claim_hash IS NOT NULL THEN 1 ELSE 0 END AS mine,created_at AS createdAt,
     json_extract(plan_json,'$.sourceFile') AS sourceFile,json_array_length(plan_json,'$.targets') AS total,
     (SELECT COUNT(*) FROM sku_count_results r WHERE r.task_id=t.id AND json_extract(r.result_json,'$.completed')=1) AS completed
     FROM sku_count_tasks t WHERE hall_id=? AND (status='PUBLISHED' OR (?=1 AND (status<>'DELETED' OR ?=1))) ORDER BY created_at DESC,id DESC LIMIT 100`).bind(actor,hall,manager?1:0,url.searchParams.get('archived')==='1'?1:0).all();
    return json({tasks:tasks.results},200,deviceHeader);
   }
   if(request.method!=='POST')throw new ErrorResponse(405,'METHOD_NOT_ALLOWED');manage();
   const input=await body(request,2200000);need(str(input.id,80)&&/^[\w-]{8,80}$/.test(input.id)&&str(input.name,100)&&input.name.trim());
   need(Array.isArray(input.rows)&&input.rows.every((r:any)=>r&&typeof r==='object')&&Array.isArray(input.skus)&&input.skus.every((s:unknown)=>str(s,150)&&s));
   let plan:CountPlan;try{plan=buildCountPlan(input.rows,hall,input.skus,input.sourceFile,input.sourceHash);}catch(e){throw new ErrorResponse(400,(e as Error).message);}
   const planJson=JSON.stringify(plan);if(new TextEncoder().encode(planJson).length>1800000)throw new ErrorResponse(413,'TASK_TOO_LARGE');
   const requestHash=await hash(JSON.stringify([hall,input.name.trim(),planJson]));
   const existing=await env.DB.prepare('SELECT request_hash FROM sku_count_tasks WHERE id=?').bind(input.id).first<{request_hash:string}>();
   if(existing){need(existing.request_hash===requestHash,'TASK_ID_CONFLICT');return json({id:input.id});}
   const written=await env.DB.prepare("INSERT OR IGNORE INTO sku_count_tasks(id,hall_id,name,plan_json,request_hash,created_at) VALUES(?,?,?,?,?,?)").bind(input.id,hall,input.name.trim(),planJson,requestHash,new Date().toISOString()).run();
   if(!written.meta.changes){const raced=await env.DB.prepare('SELECT request_hash FROM sku_count_tasks WHERE id=?').bind(input.id).first<{request_hash:string}>();need(raced?.request_hash===requestHash,'TASK_ID_CONFLICT');}
   return json({id:input.id},201);
  }
  const id=url.searchParams.get('taskId');need(id&&str(id,80));
  const metadataOnly=['status','claim','release','lifecycle','progress'].includes(action || '') || action==='photo'&&request.method==='GET';
  const row=await env.DB.prepare(`SELECT ${metadataOnly?'id,hall_id,name,status,revision,claim_hash,claimed_by,created_at':'*'} FROM sku_count_tasks WHERE id=? AND hall_id=?`).bind(id,hall).first<Row>();if(!row)throw new ErrorResponse(404,'TASK_NOT_FOUND');
  const mine=!!actor&&actor===row.claim_hash,canEdit=row.status==='PUBLISHED'&&mine;
  if(row.status==='DELETED'&&!manager||!manager&&row.status!=='PUBLISHED')throw new ErrorResponse(410,'TASK_UNAVAILABLE');
  if(action==='claim'&&request.method==='POST'){
   if(row.status!=='PUBLISHED')throw new ErrorResponse(410,'TASK_UNAVAILABLE');
   const input=await body(request);need(str(input.name,80)&&input.name.trim()&&input.revision===row.revision);
   if(row.claim_hash){if(mine)return json({ok:true});throw new ErrorResponse(409,'TASK_CLAIMED');}
   const device=token||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
   const claimed=await env.DB.prepare("UPDATE sku_count_tasks SET claim_hash=?,claimed_by=?,revision=revision+1 WHERE id=? AND hall_id=? AND revision=? AND status='PUBLISHED' AND claim_hash IS NULL").bind(await hash(device),input.name.trim(),id,hall,row.revision).run();
   if(!claimed.meta.changes)throw new ErrorResponse(409,'TASK_CLAIMED');
   return json({ok:true},200,{'Set-Cookie':`sku_count_device=${device}; HttpOnly; Secure; SameSite=Strict; Path=/api/inventory/sku-count/; Max-Age=31536000`});
  }
  if(action==='release'&&request.method==='POST'){
   if(!manager&&!mine)throw new ErrorResponse(403,'CLAIM_REQUIRED');const input=await body(request);need(input.revision===row.revision);
   const changed=await env.DB.prepare("UPDATE sku_count_tasks SET claim_hash=NULL,claimed_by=NULL,revision=revision+1 WHERE id=? AND revision=? AND status<>'DELETED'").bind(id,row.revision).run();if(!changed.meta.changes)throw new ErrorResponse(409,'PUBLICATION_CONFLICT');return json({ok:true});
  }
  if(action==='lifecycle'&&request.method==='POST'){
   manage();const input=await body(request);need(['PUBLISHED','WITHDRAWN','DELETED'].includes(input.status)&&input.revision===row.revision);
   if(row.status==='DELETED')throw new ErrorResponse(410,'TASK_UNAVAILABLE');
   const changed=await env.DB.prepare("UPDATE sku_count_tasks SET status=?,revision=revision+1,claim_hash=NULL,claimed_by=NULL WHERE id=? AND revision=? AND status<>'DELETED'").bind(input.status,id,row.revision).run();if(!changed.meta.changes)throw new ErrorResponse(409,'PUBLICATION_CONFLICT');return json({ok:true});
  }
  if(action==='status'&&request.method==='GET'){
   const stamp=await env.DB.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(revision),0) AS rev FROM sku_count_results WHERE task_id=?').bind(id).first<{n:number;rev:number}>();
   const photos=await env.DB.prepare('SELECT COUNT(*) AS n FROM sku_count_photos WHERE task_id=?').bind(id).first<{n:number}>();
   return json({stale:false,lifecycle:row.status,publicationRevision:row.revision,canEdit,mine,claimedBy:row.claimed_by,resultStamp:`${stamp?.n}:${stamp?.rev}:${photos?.n}`});
  }
  if(['task','progress'].includes(action||'')&&request.method==='GET'){
   const results=await env.DB.prepare('SELECT location_code,result_json,revision,saved_at FROM sku_count_results WHERE task_id=?').bind(id).all<{location_code:string;result_json:string;revision:number;saved_at:string}>();
   const photos=await env.DB.prepare('SELECT id,location_code AS location,line_id AS lineId FROM sku_count_photos WHERE task_id=?').bind(id).all();
   const progress={results:Object.fromEntries(results.results.map(r=>[r.location_code,{...JSON.parse(r.result_json),revision:r.revision,savedAt:r.saved_at}])),photos:photos.results};
   return json(action==='progress'?progress:{kind:'SKU',id,hall,name:row.name,createdAt:row.created_at,plan:JSON.parse(row.plan_json),lifecycle:row.status,publicationRevision:row.revision,claimedBy:row.claimed_by,mine,canEdit,stale:false,...progress});
  }
  if(action==='photo'&&request.method==='GET'){
   const photo=await env.DB.prepare('SELECT object_key FROM sku_count_photos WHERE task_id=? AND id=?').bind(id,url.searchParams.get('photoId')).first<{object_key:string}>();if(!photo)throw new ErrorResponse(404,'PHOTO_NOT_FOUND');
   const file=await env.PHOTO_BUCKET.get(photo.object_key);if(!file)throw new ErrorResponse(404,'PHOTO_NOT_FOUND');return new Response(file.body,{headers:{'Content-Type':file.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(request.method!=='POST')throw new ErrorResponse(405,'METHOD_NOT_ALLOWED');
  if(!canEdit)throw new ErrorResponse(403,'CLAIM_REQUIRED');
  if(request.headers.get('X-Audit-Publication-Revision')!==String(row.revision))throw new ErrorResponse(409,'PUBLICATION_CONFLICT');
  const plan=JSON.parse(row.plan_json) as CountPlan;
  const location=url.searchParams.get('location'),target=plan.targets.find(t=>t.location===location);need(target,'INVALID_LOCATION');
  const guard="EXISTS(SELECT 1 FROM sku_count_tasks WHERE id=? AND hall_id=? AND status='PUBLISHED' AND revision=? AND claim_hash=?)";
  const binding=[id,hall,row.revision,actor];
  if(action==='save'){
   const input=await body(request,1800000);const photos=await env.DB.prepare('SELECT id,line_id FROM sku_count_photos WHERE task_id=? AND location_code=?').bind(id,location).all<{id:string;line_id:string}>();
   const result=await validatedResult(input,target,photos.results),serialized=JSON.stringify(result),savedAt=new Date().toISOString();
   const written=input.revision===0?await env.DB.prepare(`INSERT OR IGNORE INTO sku_count_results(task_id,location_code,result_json,revision,saved_at) SELECT ?,?,?,1,? WHERE ${guard}`).bind(id,location,serialized,savedAt,...binding).run():await env.DB.prepare(`UPDATE sku_count_results SET result_json=?,revision=revision+1,saved_at=? WHERE task_id=? AND location_code=? AND revision=? AND ${guard}`).bind(serialized,savedAt,id,location,input.revision,...binding).run();
   if(!written.meta.changes){const permitted=await env.DB.prepare(`SELECT 1 WHERE ${guard}`).bind(...binding).first();if(!permitted)throw new ErrorResponse(409,'PUBLICATION_CONFLICT');const existing=await env.DB.prepare('SELECT result_json,revision,saved_at FROM sku_count_results WHERE task_id=? AND location_code=?').bind(id,location).first<{result_json:string;revision:number;saved_at:string}>();if(existing && existing.revision===input.revision+1&&existing.result_json===serialized)return json({...result,revision:existing.revision,savedAt:existing.saved_at});throw new ErrorResponse(409,'REVISION_CONFLICT');}
   return json({...result,revision:input.revision+1,savedAt});
  }
  if(action==='photo'){
   const photoId=url.searchParams.get('photoId'),lineId=url.searchParams.get('lineId')||'';need(photoId&&/^[\w-]{8,80}$/.test(photoId)&&str(lineId,200));
   if(lineId){const saved=await env.DB.prepare('SELECT result_json FROM sku_count_results WHERE task_id=? AND location_code=?').bind(id,location).first<{result_json:string}>();need(target.skus.some(s=>`book:${s.sku}`===lineId)||saved&&JSON.parse(saved.result_json).lines.some((l:any)=>l.id===lineId),'INVALID_LINE');}
   const existing=await env.DB.prepare('SELECT task_id,location_code,line_id FROM sku_count_photos WHERE id=?').bind(photoId).first<{task_id:string;location_code:string;line_id:string}>();if(existing){need(existing.task_id===id&&existing.location_code===location&&existing.line_id===lineId);return json({id:photoId,location,lineId});}
   const type=request.headers.get('Content-Type')||'';need(['image/jpeg','image/png','image/webp'].includes(type),'PHOTO_FORMAT');if(Number(request.headers.get('Content-Length')||0)>10*1024*1024)throw new ErrorResponse(413,'PHOTO_SIZE');const bytes=await request.arrayBuffer();need(bytes.byteLength>0&&bytes.byteLength<=10*1024*1024,'PHOTO_SIZE');
   const key=`sku-count/${encodeURIComponent(hall)}/${id}/${photoId}`;await env.PHOTO_BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
   const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO sku_count_photos(id,task_id,location_code,line_id,object_key) SELECT ?,?,?,?,? WHERE ${guard}`).bind(photoId,id,location,lineId,key,...binding).run();
   if(!inserted.meta.changes){const retained=await env.DB.prepare('SELECT id FROM sku_count_photos WHERE id=? AND task_id=?').bind(photoId,id).first();if(!retained){await env.PHOTO_BUCKET.delete(key);throw new ErrorResponse(409,'PUBLICATION_CONFLICT');}}
   return json({id:photoId,location,lineId},201);
  }
  throw new ErrorResponse(404,'NOT_FOUND');
 }catch(error){return json({error:error instanceof Error?error.message:'SERVER_ERROR'},error instanceof ErrorResponse?error.status:500);}
}
