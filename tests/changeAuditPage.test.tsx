import React,{act} from 'react';
import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const mock=vi.hoisted(()=>({loadTask:vi.fn(),listTasks:vi.fn(),saveResult:vi.fn(),taskStatus:vi.fn(),uploadPhoto:vi.fn(),fetchVersions:vi.fn()}));
vi.mock('../src/changeAudit/api',async()=>({...await vi.importActual('../src/changeAudit/api'),...mock}));
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
 vi.clearAllMocks();localStorage.clear();sessionStorage.clear();task=fixture();sessionStorage.setItem('wms-change-audit-selected:H1',task.id);
 mock.loadTask.mockResolvedValue(task);mock.listTasks.mockResolvedValue({tasks:[{id:task.id,createdAt:'2026-10-19',oldId:'old',newId:'new'}],activeImportId:'new'});
 mock.fetchVersions.mockResolvedValue({versions:[{importId:'new',versionNumber:2},{importId:'old',versionNumber:1}],activeImportId:'new'});
 mock.saveResult.mockImplementation(async(_h,_id,_location,data)=>({...data,revision:data.revision+1,savedAt:'2026-10-19T00:00:00Z'}));mock.taskStatus.mockResolvedValue({stale:false});
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 await act(async()=>root.render(<Page currentHall="H1"/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()===text)!;
async function click(text:string){await act(async()=>button(text).click());}
async function type(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});}
const input=(label:string)=>container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
it('restores task/route, separates classifications and only counts explicit quantity completion',async()=>{
 expect(container.textContent).toContain('库存变动核查');expect(container.textContent).toContain('原文商品');expect(container.textContent).toContain('已完成数量核查 0/3');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});expect(mock.saveResult).not.toHaveBeenCalled();
 await click('确认完成数量核查');expect(container.textContent).toContain('请填写每条实盘数量');expect(mock.saveResult).not.toHaveBeenCalled();
 await type(input('实盘数量 SKU1'),'4');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));});
 expect(mock.saveResult).toHaveBeenLastCalledWith('H1',task.id,'103-001-1',expect.objectContaining({completed:false,lines:[expect.objectContaining({actual:4})]}));
 await click('确认完成数量核查');expect(mock.saveResult).toHaveBeenLastCalledWith('H1',task.id,'103-001-1',expect.objectContaining({completed:true}));
 expect(container.textContent).toContain('已完成数量核查 1/3');
});
it('walks in snake order, supports direct scans, and leaves non-target visual checks unfinished',async()=>{
 await click('下一个未完成目标');expect(container.querySelector('h3')?.textContent).toBe('104-001-1');expect(container.textContent).toContain('变成空库位');
 const scanner=input('扫描/输入目标库位');expect(scanner.inputMode).toBe('none');
 const keyboard=container.querySelector('[aria-label="切换手动键盘"]') as HTMLButtonElement;await act(async()=>keyboard.click());expect(scanner.inputMode).toBe('text');
 await type(scanner,'103-001-1');await act(async()=>scanner.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 expect(container.querySelector('h3')?.textContent).toBe('103-001-1');expect(scanner.inputMode).toBe('none');
 await type(scanner,'999-001-1');await act(async()=>scanner.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 expect(container.textContent).toContain('此库位不在当前任务中');expect(mock.saveResult).not.toHaveBeenCalled();expect(sessionStorage.getItem(`wms-change-audit-location:${task.id}`)).toBe('103-001-1');
});
it('disables actual-count writes for an expired reference version',async()=>{
 await act(async()=>root.unmount());root=createRoot(container);task.stale=true;
 await act(async()=>root.render(<Page currentHall="H1"/>));
 expect(container.textContent).toContain('任务参考版本已过期');expect(input('实盘数量 SKU1').closest('fieldset')?.disabled).toBe(true);
 expect(button('确认完成数量核查').disabled).toBe(true);expect(mock.saveResult).not.toHaveBeenCalled();
});
it('rechecks the pointer when returning from another menu and locks a newly expired task',async()=>{
 await act(async()=>root.render(<Page currentHall="H1" active={false}/>));
 mock.taskStatus.mockResolvedValueOnce({stale:true});
 await act(async()=>root.render(<Page currentHall="H1" active={true}/>));
 expect(mock.taskStatus).toHaveBeenCalledWith('H1',task.id);expect(container.textContent).toContain('任务参考版本已过期');
 expect(input('实盘数量 SKU1').closest('fieldset')?.disabled).toBe(true);
});
