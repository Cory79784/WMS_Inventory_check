import type {HallId} from '../types';
import type {AuditLine,AuditResult,AuditPhoto,Target,BookSku} from '../changeAudit/model';
export interface CountRow extends BookSku {hall:HallId;location:string}
export interface CountPlan {targets:Target[];route:string[];special:string[];skus:string[];sourceFile:string;sourceHash:string;sourceRows:number}
export interface CountTask {
 kind:'SKU';id:string;hall:HallId;name:string;createdAt:string;plan:CountPlan;
 lifecycle:'DRAFT'|'PUBLISHED'|'WITHDRAWN'|'DELETED';publicationRevision:number;
 results:Record<string,AuditResult>;photos:AuditPhoto[];stale:boolean;
 claimedBy:string|null;mine:boolean;canEdit:boolean;
}
const split=(value:string)=>value.split(/[,;，；\s]+/).filter(Boolean);
export function expectedIdentity(target:Target,line:Pick<AuditLine,'sku'|'barcode'>):boolean {
 const candidates=line.sku?target.skus.filter(s=>s.sku===line.sku):target.skus;
 if(!candidates.length)return false;
 if(line.barcode)return candidates.some(s=>[...split(s.barcode),...split(s.eBarcode || '')].includes(line.barcode));
 return !!line.sku;
}
export function needsIdentityPhoto(target:Target,line:AuditLine) {
 return line.id.startsWith('extra:') && (line.actual || 0)>0 && !expectedIdentity(target,line);
}
export function buildCountPlan(rows:CountRow[],hall:HallId,skus:string[],sourceFile:string,sourceHash:string):CountPlan {
 if(!rows.length || rows.length>10000 || !skus.length || skus.length>1000 || typeof sourceFile!=='string' || !sourceFile || sourceFile.length>255 || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('INVALID_SOURCE');
 const selected=new Set(skus),locations=new Map<string,Map<string,BookSku>>();let sourceRows=0;
 for(const row of rows) {
  if(!['H1','H2','H3'].includes(row.hall) || typeof row.location!=='string' || !row.location.trim() || row.location.length>150 || typeof row.sku!=='string' || !row.sku.trim() || row.sku.length>150 || !Number.isSafeInteger(row.qty) || row.qty<0 || row.qty>1000000000) throw new Error('INVALID_SOURCE');
  if(row.hall!==hall || !selected.has(row.sku)) continue;
  for(const field of ['barcode','eBarcode','customer','name'] as const) if(row[field]!==undefined && typeof row[field]!=='string' || (row[field] || '').length>(field==='name'?1000:300)) throw new Error('INVALID_SOURCE');
  for(const field of ['availableQty','allocatedQty','frozenQty'] as const) if(row[field]!==undefined && (!Number.isSafeInteger(row[field]) || (row[field] ?? 0)<0)) throw new Error('INVALID_SOURCE');
  sourceRows++;const location=row.location.trim().toUpperCase();
  const group=locations.get(location) || new Map<string,BookSku>();locations.set(location,group);
  const old=group.get(row.sku);
  if(old) {
   if(old.customer && row.customer && old.customer!==row.customer) throw new Error('AMBIGUOUS_CUSTOMER');
   old.qty+=row.qty;if(!Number.isSafeInteger(old.qty)||old.qty>1000000000) throw new Error('INVALID_SOURCE');
   old.barcode=[...new Set([...split(old.barcode),...split(row.barcode)])].join(',');
   old.eBarcode=[...new Set([...split(old.eBarcode || ''),...split(row.eBarcode || '')])].join(',');
   if(old.barcode.length>300 || old.eBarcode.length>300)throw new Error('INVALID_SOURCE');
   old.customer ||= row.customer;old.name ||= row.name;
   for(const field of ['availableQty','allocatedQty','frozenQty'] as const) {old[field]=(old[field] || 0)+(row[field] || 0);if(!Number.isSafeInteger(old[field])||old[field]!>1000000000)throw new Error('INVALID_SOURCE');}
  } else group.set(row.sku,{sku:row.sku,barcode:row.barcode || '',eBarcode:row.eBarcode || '',customer:row.customer || '',name:row.name || '',qty:row.qty,availableQty:row.availableQty,allocatedQty:row.allocatedQty,frozenQty:row.frozenQty});
 }
 const available=new Set(rows.filter(r=>r.hall===hall).map(r=>r.sku));
 if(!locations.size || [...selected].some(sku=>!available.has(sku))) throw new Error('EMPTY_SCOPE');
 const route=[...locations.keys()].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
 return {targets:route.map(location=>({location,category:'CHANGED',skus:[...locations.get(location)!.values()].sort((a,b)=>a.sku.localeCompare(b.sku)),risks:[],changes:[]})),route,special:[],skus:[...selected],sourceFile,sourceHash,sourceRows};
}
