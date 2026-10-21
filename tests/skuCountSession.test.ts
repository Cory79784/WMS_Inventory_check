import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {AuditSession,type InspectionTransport} from '../src/changeAudit/session';
import type {CountTask} from '../src/skuCount/model';
import type {AuditTask} from '../src/changeAudit/model';
const storage=new Map<string,string>();
const fixture=():CountTask=>({kind:'SKU',id:'shared-id',hall:'H1',name:'Task',createdAt:'',lifecycle:'PUBLISHED',publicationRevision:2,claimedBy:'Alice',mine:true,canEdit:true,stale:false,photos:[],results:{},plan:{sourceFile:'sample.xlsx',sourceHash:'f'.repeat(64),sourceRows:1,skus:['SKU'],route:['107-001-1'],special:[],targets:[{location:'107-001-1',category:'CHANGED',skus:[{sku:'SKU',barcode:'0001',customer:'C',name:'raw',qty:2}],risks:[],changes:[]}]}});
const transport=()=>({saveResult:vi.fn(async(_h,_id,_loc,result)=>({...result,revision:result.revision+1,savedAt:'now'})),uploadPhoto:vi.fn(),taskStatus:vi.fn(),loadProgress:vi.fn(),photoUrl:(_h:string,id:string,photo:string)=>`/sku/${id}/${photo}`} satisfies InspectionTransport);
beforeEach(()=>{vi.useFakeTimers();storage.clear();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
it('isolates drafts even when a SKU task and change-audit task use the same ID, restoring only the injected transport',async()=>{
 const sku=fixture(),change={...sku,kind:undefined,plan:{...sku.plan,comparison:{} as any,config:{} as any}} as AuditTask;
 const original=new AuditSession(change);original.edit('107-001-1',{...original.result('107-001-1'),notes:'change only'});vi.clearAllTimers();
 const api=transport(),session=new AuditSession(sku,api);session.edit('107-001-1',{...session.result('107-001-1'),notes:'SKU only'});vi.clearAllTimers();
 expect(session.key).toBe('wms-sku-count-drafts:shared-id');expect(session.photoNamespace).toBe('sku-count:shared-id');expect(session.photoUrl('p')).toBe('/sku/shared-id/p');
 const restored=new AuditSession(fixture(),api);expect(restored.result('107-001-1').notes).toBe('SKU only');await vi.advanceTimersByTimeAsync(700);expect(api.saveResult).toHaveBeenCalledTimes(1);expect(restored.dirty).toBe(false);
 expect(storage.get(original.key)).toContain('change only');
});
it('restores offline drafts but quarantines them after claim transfer and refuses unclaimed writes',async()=>{
 const api=transport(),session=new AuditSession(fixture(),api);session.edit('107-001-1',{...session.result('107-001-1'),notes:'offline'});vi.clearAllTimers();
 const transferred=new AuditSession({...fixture(),publicationRevision:4,claimedBy:'Bob',canEdit:false,mine:false},api);expect(transferred.unavailable).toBe(true);expect(transferred.result('107-001-1').notes).toBe('offline');await transferred.flush('107-001-1');expect(api.saveResult).not.toHaveBeenCalled();
 transferred.edit('107-001-1',{...transferred.result('107-001-1'),notes:'must not save'});expect(transferred.result('107-001-1').notes).toBe('offline');
});
