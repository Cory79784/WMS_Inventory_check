import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({saveResult:vi.fn(),taskStatus:vi.fn(),uploadPhoto:vi.fn()}));
vi.mock('../src/changeAudit/api',async()=>({...await vi.importActual('../src/changeAudit/api'),...api}));
import {AuditSession} from '../src/changeAudit/session';
import {AuditError} from '../src/changeAudit/api';
import type {AuditTask} from '../src/changeAudit/model';
const task=():AuditTask=>({id:'task-session',hall:'H1',createdAt:'',stale:false,photos:[],results:{},plan:{comparison:{} as any,config:{} as any,route:['103-001-1'],special:[],targets:[{location:'103-001-1',category:'CHANGED',skus:[{sku:'SKU',barcode:'',customer:'',name:'',qty:3}],risks:[],changes:[]}]}});
const storage=new Map<string,string>();
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();storage.clear();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 api.saveResult.mockImplementation(async(_hall,_id,_location,value)=>({...value,revision:value.revision+1,savedAt:'2026-10-19T00:00:00Z'}));
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
it('does not save browsing, debounces edits, and saves counts without a button',async()=>{
 const s=new AuditSession(task());expect(s.result('103-001-1').lines[0].actual).toBeNull();await vi.advanceTimersByTimeAsync(1000);expect(api.saveResult).not.toHaveBeenCalled();
 const value=s.result('103-001-1');s.edit('103-001-1',{...value,notes:'first'});s.edit('103-001-1',{...value,notes:'second'});
 expect(s.dirty).toBe(true);await vi.advanceTimersByTimeAsync(700);expect(api.saveResult).toHaveBeenCalledTimes(1);expect(s.dirty).toBe(false);expect(s.task.results['103-001-1'].notes).toBe('second');
});
it('serializes quick edits and never acknowledges a newer draft as saved',async()=>{
 const s=new AuditSession(task());let acknowledge!:(value:any)=>void;
 api.saveResult.mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve;}));
 s.edit('103-001-1',{...s.result('103-001-1'),notes:'first'});await vi.advanceTimersByTimeAsync(700);
 s.edit('103-001-1',{...s.result('103-001-1'),notes:'newer'});expect(s.drafts.get('103-001-1')?.saving).toBe(true);
 acknowledge({...s.result('103-001-1'),notes:'first',revision:1,savedAt:'now'});await Promise.resolve();await Promise.resolve();
 expect(s.drafts.get('103-001-1')?.dirty).toBe(true);expect(s.result('103-001-1').notes).toBe('newer');
 await vi.advanceTimersByTimeAsync(700);expect(api.saveResult.mock.calls[1][3]).toMatchObject({revision:1,notes:'newer'});expect(s.dirty).toBe(false);
});
it('retains failed saves through refresh and retries using the same revision',async()=>{
 const first=new AuditSession(task());api.saveResult.mockRejectedValueOnce(new Error('offline'));
 first.edit('103-001-1',{...first.result('103-001-1'),notes:'retain me'});await vi.advanceTimersByTimeAsync(700);
 expect(first.drafts.get('103-001-1')?.error).toBe('offline');expect(first.dirty).toBe(true);
 const refreshed=new AuditSession(task());expect(refreshed.result('103-001-1').notes).toBe('retain me');await vi.advanceTimersByTimeAsync(700);
 expect(refreshed.dirty).toBe(false);expect(api.saveResult.mock.calls[1][3].revision).toBe(0);
});
it('keeps local drafts on revision conflicts and never overwrites the server',async()=>{
 const server=task();const s=new AuditSession(server);s.edit('103-001-1',{...s.result('103-001-1'),notes:'local'});
 server.results['103-001-1']={...s.result('103-001-1'),notes:'remote',revision:3};
 const restored=new AuditSession(server);expect(restored.result('103-001-1').notes).toBe('local');expect(restored.drafts.get('103-001-1')?.error).toBe('REVISION_CONFLICT');
 await restored.flush('103-001-1');expect(api.saveResult).not.toHaveBeenCalled();
});
it('locks stale tasks on server rejection, retains drafts and throttles focus checks',async()=>{
 const s=new AuditSession(task());api.saveResult.mockRejectedValueOnce(new AuditError('STALE_VERSION',409));
 s.edit('103-001-1',{...s.result('103-001-1'),notes:'pending'});await vi.advanceTimersByTimeAsync(700);
 expect(s.task.stale).toBe(true);expect(s.dirty).toBe(true);await s.flush('103-001-1');expect(api.saveResult).toHaveBeenCalledTimes(1);
 api.taskStatus.mockResolvedValue({stale:true});await s.checkVersion();await s.checkVersion();expect(api.taskStatus).toHaveBeenCalledTimes(1);
});
it('requires a matching acknowledgement, not just a successful HTTP response',async()=>{
 const s=new AuditSession(task());api.saveResult.mockResolvedValueOnce({lines:[],notes:'wrong',revision:1,savedAt:'now',completed:false,emptyConfirmed:false});
 s.edit('103-001-1',{...s.result('103-001-1'),notes:'keep this'});await vi.advanceTimersByTimeAsync(700);
 expect(s.dirty).toBe(true);expect(s.result('103-001-1').notes).toBe('keep this');expect(s.drafts.get('103-001-1')?.error).toBe('SAVE_NOT_CONFIRMED');
});
it('previews a photo before upload, retains failures, and retries using the same image identity',async()=>{
 const s=new AuditSession(task());const revoke=vi.fn();vi.stubGlobal('URL',{revokeObjectURL:revoke});
 let reject!:(error:Error)=>void;api.uploadPhoto.mockImplementationOnce(()=>new Promise((_resolve,rejecter)=>{reject=rejecter;}));
 const photo={id:'photo-session-id',location:'103-001-1',lineId:'book:SKU',url:'blob:preview',file:{} as File,status:'uploading' as const,error:''};
 const pending=s.addPhoto(photo);await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(s.uploads[0].url).toBe('blob:preview');expect(s.uploads[0].status).toBe('uploading');
 reject(new Error('offline'));await pending;expect(s.uploads[0].status).toBe('failed');expect(s.dirty).toBe(true);expect(revoke).not.toHaveBeenCalled();
 api.uploadPhoto.mockResolvedValueOnce({id:photo.id,location:photo.location,lineId:photo.lineId});await s.addPhoto(photo);
 expect(api.uploadPhoto.mock.calls[1][4]).toBe(photo.id);expect(s.task.photos).toHaveLength(1);expect(s.uploads[0].status).toBe('saved');expect(revoke).toHaveBeenCalledWith('blob:preview');
});
