import React,{act} from 'react';
import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const mock=vi.hoisted(()=>({managerStatus:vi.fn().mockResolvedValue({manager:true,configured:true}),loadTask:vi.fn(),listTasks:vi.fn(),saveResult:vi.fn(),taskStatus:vi.fn(),uploadPhoto:vi.fn(),fetchVersions:vi.fn(),downloadTask:vi.fn().mockResolvedValue({})}));
vi.mock('../src/changeAudit/api',async()=>({...await vi.importActual('../src/changeAudit/api'),...mock}));
vi.mock('../src/changeAudit/taskExport',()=>({downloadTaskResults:mock.downloadTask}));
vi.mock('../src/services/snapshotCompare',()=>({fetchSnapshotVersions:mock.fetchVersions}));
import type {AuditTask} from '../src/changeAudit/model';
let root:any,container:HTMLDivElement,Page:any,createRoot:any,number=0;
const fixture=():AuditTask=>({id:`ui-task-${++number}`,hall:'H1',createdAt:'2026-10-19',stale:false,photos:[],results:{},plan:{comparison:{oldVersion:{versionNumber:1},newVersion:{versionNumber:2}} as any,config:{startRack:null,startEnd:'low',pairs:[]},route:['103-001-1','104-001-1'],special:['REI-14'],targets:[
 {location:'103-001-1',category:'CHANGED',skus:[{sku:'SKU1',barcode:'00001',customer:'C1',name:'原文商品',qty:5}],risks:[{kind:'multi',params:{count:2}}],changes:[]},
 {location:'104-001-1',category:'EMPTIED_LOCATION',skus:[{sku:'EMPTY',barcode:'',customer:'',name:'',qty:0}],risks:[],changes:[]},
 {location:'REI-14',category:'NEW_LOCATION',skus:[],risks:[],changes:[]}
]}});
let task:AuditTask;
beforeAll(async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://audit.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 createRoot=(await import('react-dom/client')).createRoot;Page=(await import('../src/pages/ChangeAuditPage')).ChangeAuditPage;
});
beforeEach(async()=>{
 vi.clearAllMocks();localStorage.clear();sessionStorage.clear();task=fixture();localStorage.setItem('wms-change-audit-selected:H1',task.id);
 mock.loadTask.mockResolvedValue(task);mock.listTasks.mockResolvedValue({tasks:[{id:task.id,createdAt:'2026-10-19',oldId:'old',newId:'new'}],activeImportId:'new'});
 mock.fetchVersions.mockResolvedValue({versions:[{importId:'new',versionNumber:2},{importId:'old',versionNumber:1}],activeImportId:'new'});
 mock.saveResult.mockImplementation(async(_h,_id,_location,data)=>({...data,revision:data.revision+1,savedAt:'2026-10-19T00:00:00Z'}));mock.taskStatus.mockResolvedValue({stale:false});
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 await act(async()=>root.render(<Page currentHall="H1"/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===text || b.textContent?.trim()===text)!;
async function click(text:string){await act(async()=>button(text).click());}
async function type(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});}
const input=(label:string)=>container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
it('uses the shared original card and shortage buttons, emphasizes new book stock and autosaves completion',async()=>{
 expect(container.textContent).toContain('库存变动核查');expect(container.textContent).toContain('原文商品');expect(container.textContent).toContain('已完成数量核查 0/3');
 expect(container.textContent).toContain('系统数量');expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1); // route configuration only
 expect(container.querySelector('input[aria-label="实盘数量 SKU1"]')).toBeNull();
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});expect(mock.saveResult).not.toHaveBeenCalled();
 await click('少货');expect(container.textContent).toContain('确认少货');expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
 await click('确认少货');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 expect(mock.saveResult).toHaveBeenLastCalledWith('H1',task.id,'103-001-1',expect.objectContaining({completed:true,lines:[expect.objectContaining({actual:4})]}),0);
 expect(container.textContent).toContain('已完成数量核查 1/3');
 await click('正常');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 expect(mock.saveResult).toHaveBeenLastCalledWith('H1',task.id,'103-001-1',expect.objectContaining({completed:true,lines:[expect.objectContaining({actual:5})]}),0);
});
it('walks in snake order, supports direct scans, and leaves non-target visual checks unfinished',async()=>{
 const previous=button('上一目标'),nextTarget=button('下一个未完成目标');
 expect(previous.disabled).toBe(true);expect(previous.textContent).toContain('无上一目标');
 expect(nextTarget.textContent).toContain('104-001-1');
 const physical=container.querySelector('h2.font-mono')!;
 expect(nextTarget.compareDocumentPosition(physical) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await click('下一个未完成目标');expect(container.querySelector('h2.font-mono')?.textContent).toBe('104-001-1');expect(container.textContent).toContain('变成空库位');expect(button('上一目标').textContent).toContain('103-001-1');
 const scanner=input('扫描/输入目标库位');expect(scanner.inputMode).toBe('none');
 const keyboard=container.querySelector('[aria-label="切换手动键盘"]') as HTMLButtonElement;await act(async()=>keyboard.click());expect(scanner.inputMode).toBe('text');
 await type(scanner,'103-001-1');await act(async()=>scanner.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 expect(container.querySelector('h2.font-mono')?.textContent).toBe('103-001-1');expect(scanner.inputMode).toBe('none');
 await type(scanner,'999-001-1');await act(async()=>scanner.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 expect(container.textContent).toContain('此库位不在当前任务中');expect(mock.saveResult).not.toHaveBeenCalled();expect(localStorage.getItem(`wms-change-audit-location:${task.id}`)).toBe('103-001-1');
});
it('disables actual-count writes for an expired reference version',async()=>{
 await act(async()=>root.unmount());root=createRoot(container);task.stale=true;
 await act(async()=>root.render(<Page currentHall="H1"/>));
 expect(container.textContent).toContain('任务参考版本已过期');expect(button('正常').closest('fieldset')?.disabled).toBe(true);expect(container.textContent).toContain('任务参考数量');
 expect(button('保存本库位核查').closest('fieldset')?.disabled).toBe(true);expect(mock.saveResult).not.toHaveBeenCalled();
});
it('rechecks the pointer when returning from another menu and locks a newly expired task',async()=>{
 await act(async()=>root.render(<Page currentHall="H1" active={false}/>));
 mock.taskStatus.mockResolvedValueOnce({stale:true});
 await act(async()=>root.render(<Page currentHall="H1" active={true}/>));
 expect(mock.taskStatus).toHaveBeenCalledWith('H1',task.id);expect(container.textContent).toContain('任务参考版本已过期');
 expect(button('正常').closest('fieldset')?.disabled).toBe(true);expect(container.textContent).toContain('任务参考数量');
});
it('adds an identified surplus through the original modal with quantity buttons and auto completion',async()=>{
 await click('+ 现场多货');expect(container.textContent).toContain('添加现场多货');
 const sku=container.querySelector('input[placeholder="扫描或输入外箱 SKU"]') as HTMLInputElement;await type(sku,'EXTRA-UI');
 expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
 await click('确认添加多货');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 expect(mock.saveResult).toHaveBeenCalledWith('H1',task.id,'103-001-1',expect.objectContaining({completed:false,lines:expect.arrayContaining([expect.objectContaining({sku:'EXTRA-UI',actual:1})])}),0);
 await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()==='正常')!.click());
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});expect(mock.saveResult.mock.calls.at(-1)[3].completed).toBe(true);
});
it('confirms an empty location through the original empty button without number inputs',async()=>{
 await click('下一个未完成目标');expect(container.textContent).toContain('旧版货物 / 残留检查');await click('确认为空库位');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 expect(mock.saveResult).toHaveBeenLastCalledWith('H1',task.id,'104-001-1',expect.objectContaining({completed:true,emptyConfirmed:true,lines:[expect.objectContaining({actual:0})]}),0);
});
it('exports the selected task by ID with its own language selector and still allows stale saved results',async()=>{
 const panel=Array.from(container.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='本任务核查结果导出')!;
 const select=panel.querySelector('select')!;
 await act(async()=>{select.value='de';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await act(async()=>Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='仅导出差异')!.click());
 expect(mock.downloadTask).toHaveBeenLastCalledWith('H1',task.id,'differences','de');expect(panel.textContent).toContain(task.id);
 expect(panel.textContent).toContain('未完成 3 个库位');
});
it('lets an expired task export server results while retaining local failed drafts',async()=>{
 const {sessionFor}=await import('../src/changeAudit/session');const s=sessionFor(task);
 await act(async()=>s.edit('103-001-1',{...s.result('103-001-1'),notes:'local not saved'}));
 const panel=Array.from(container.querySelectorAll('details')).find(d=>d.querySelector('summary')?.textContent==='本任务核查结果导出')!;
 expect((Array.from(panel.querySelectorAll('button'))[0] as HTMLButtonElement).disabled).toBe(true);
 task.stale=true;await act(async()=>root.render(<Page currentHall="H1"/>));
 expect(panel.textContent).toContain('不含本地草稿');
 await act(async()=>Array.from(panel.querySelectorAll('button')).find(b=>b.textContent==='导出全部核查结果')!.click());
 expect(mock.downloadTask).toHaveBeenLastCalledWith('H1',task.id,'all','zh');expect(s.dirty).toBe(true);
});
it('uses original no-SKU mandatory photo flow and keeps the photo bound to its extra line',async()=>{
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test-photo');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 try {
  mock.uploadPhoto.mockImplementation(async(_hall,_task,location,lineId,id)=>({id,location,lineId}));
  await click('+ 现场多货');await click('无 SKU 货物');await click('确认添加多货');expect(mock.uploadPhoto).not.toHaveBeenCalled();
  const modal=container.querySelector('.fixed')!;expect(modal.querySelector('input[type="number"]')).toBeNull();
  const file=modal.querySelector('input[type="file"]')!;
  await act(async()=>{Object.defineProperty(file,'files',{configurable:true,value:[new window.File(['photo'],'photo.png',{type:'image/png'})]});file.dispatchEvent(new window.Event('change',{bubbles:true}));});
  await click('确认添加多货');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
  expect(mock.uploadPhoto).toHaveBeenCalledTimes(1);const lineId=mock.uploadPhoto.mock.calls[0][3];expect(lineId).toMatch(/^extra:/);
  expect(task.photos[0].lineId).toBe(lineId);expect(mock.saveResult.mock.calls.at(-1)[3].lines).toEqual(expect.arrayContaining([expect.objectContaining({id:lineId,sku:'',actual:1})]));
 } finally {create.mockRestore();revoke.mockRestore();}
});
it('all-normal resets task extras and photo overrides without deleting original image metadata',async()=>{
 const {sessionFor}=await import('../src/changeAudit/session');const s=sessionFor(task);
 task.photos.push({id:'photo-reset-task',location:'103-001-1',lineId:'extra:reset-row-001'});
 const value=s.result('103-001-1');
 await act(async()=>s.edit('103-001-1',{...value,lines:[{...value.lines[0],actual:4},{id:'extra:reset-row-001',sku:'EXTRA',barcode:'',actual:1,notes:''}],notes:'clear me',photoLines:{'photo-reset-task':'extra:reset-row-001'}}));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 try {await click('一键全相符 (正常)');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});}
 finally {confirm.mockRestore();}
 expect(mock.saveResult.mock.calls.at(-1)[3]).toMatchObject({completed:true,notes:'',photoLines:{},ignoredPhotoIds:['photo-reset-task'],lines:[expect.objectContaining({sku:'SKU1',actual:5})]});
 expect(task.photos).toHaveLength(1);expect(container.querySelector('img[src*="photo-reset-task"]')).toBeNull();
});
it('shows only task execution on PDA and restores the selected task and location after a browser reopen',async()=>{
 await click('下一个未完成目标');expect(localStorage.getItem(`wms-change-audit-location:${task.id}`)).toBe('104-001-1');
 await act(async()=>root.unmount());sessionStorage.clear();vi.clearAllMocks();
 Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Android PDA Chrome'});
 mock.managerStatus.mockResolvedValue({manager:false,configured:true});
 root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));
 expect(container.querySelector('h2.font-mono')?.textContent).toBe('104-001-1');
 expect(container.textContent).not.toContain('任务管理（PC）');expect(container.textContent).not.toContain('本任务核查结果导出');
 expect(mock.fetchVersions).not.toHaveBeenCalled();expect(container.querySelectorAll('input[type="number"]')).toHaveLength(0);
 Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Desktop Chrome'});mock.managerStatus.mockResolvedValue({manager:true,configured:true});
});
it('returns to the task list on revocation while keeping an unsent draft quarantined',async()=>{
 const {sessionFor}=await import('../src/changeAudit/session');const {AuditError}=await import('../src/changeAudit/api');
 const s=sessionFor(task);await act(async()=>s.edit('103-001-1',{...s.result('103-001-1'),notes:'offline draft'}));
 mock.taskStatus.mockRejectedValueOnce(new AuditError('TASK_UNAVAILABLE',410));mock.listTasks.mockResolvedValue({tasks:[],activeImportId:'new'});
 await act(async()=>s.checkVersion(true));
 expect(container.querySelector('h2.font-mono')).toBeNull();expect(container.textContent).toContain('任务已撤回');
 expect(localStorage.getItem('wms-change-audit-selected:H1')).toBe('');expect(s.dirty).toBe(true);
 expect(localStorage.getItem(s.key)).toContain('offline draft');
});
