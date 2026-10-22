import React,{act} from 'react';
import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import type {CountTask} from '../src/skuCount/model';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const mocks=vi.hoisted(()=>({listCountScopes:vi.fn(),listCountTasks:vi.fn(),loadCountTask:vi.fn(),countManager:vi.fn(),countControl:vi.fn(),createCountTask:vi.fn(),readCountFile:vi.fn(),save:vi.fn(),upload:vi.fn(),status:vi.fn(),progress:vi.fn()}));
vi.mock('../src/skuCount/api',async()=>({...await vi.importActual('../src/skuCount/api'),...mocks,countTransport:{saveResult:mocks.save,uploadPhoto:mocks.upload,taskStatus:mocks.status,loadProgress:mocks.progress,photoUrl:(_h:string,id:string,p:string)=>`/api/inventory/sku-count/photo?taskId=${id}&photoId=${p}`}}));
vi.mock('../src/skuCount/import',async()=>({...await vi.importActual('../src/skuCount/import'),readCountFile:mocks.readCountFile}));
let Page:any,root:any,createRoot:any,container:HTMLDivElement,task:CountTask,sequence=0;
const fixture=():CountTask=>({kind:'SKU',id:`sku-ui-task-${++sequence}`,hall:'H1',name:'SKU count',createdAt:'2026-10-21',lifecycle:'PUBLISHED',publicationRevision:2,claimedBy:'Alice',mine:true,canEdit:true,stale:false,results:{},photos:[],plan:{sourceFile:'sample.xlsx',sourceHash:'a'.repeat(64),sourceRows:3,skus:['SKU1','SKU2'],route:['107-002-1','108-003-4'],special:[],targets:[{location:'107-002-1',category:'CHANGED',skus:[{sku:'SKU1',barcode:'00001',customer:'C',name:'商品甲',qty:5},{sku:'SKU2',barcode:'00002',customer:'C',name:'商品乙',qty:3}],risks:[],changes:[]},{location:'108-003-4',category:'CHANGED',skus:[{sku:'SKU1',barcode:'00001',customer:'C',name:'商品甲',qty:2}],risks:[],changes:[]}]}});
beforeAll(async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://audit.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 window.scrollTo=vi.fn();window.confirm=vi.fn(()=>true);globalThis.alert=vi.fn();URL.createObjectURL=vi.fn(()=>'blob:sku-photo');URL.revokeObjectURL=vi.fn();
 createRoot=(await import('react-dom/client')).createRoot;Page=(await import('../src/pages/SkuCountPage')).SkuCountPage;
});
beforeEach(async()=>{
 vi.clearAllMocks();mocks.listCountScopes.mockResolvedValue({scopes:['H1','H2','H3','SMALL_GOODS','AREA:WS']});localStorage.clear();task=fixture();localStorage.setItem('wms-sku-count-selected:H1',task.id);
 Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Android PDA Chrome'});
 mocks.countManager.mockResolvedValue({manager:false,configured:true});mocks.listCountTasks.mockImplementation(async()=>({tasks:[{id:task.id,name:task.name,lifecycle:task.lifecycle,claimedBy:task.claimedBy,completed:0,total:2}]}));mocks.loadCountTask.mockImplementation(async()=>structuredClone(task));
 mocks.save.mockImplementation(async(_h,_id,_loc,value)=>({...value,revision:value.revision+1,savedAt:'2026-10-21T00:00:00Z'}));mocks.upload.mockImplementation(async(_h,_id,location,lineId,id)=>({id,location,lineId}));mocks.status.mockResolvedValue({stale:false,publicationRevision:2,canEdit:true,lifecycle:'PUBLISHED'});
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const button=(text:string)=>Array.from(container.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===text||b.textContent?.trim()===text)!;
const input=(label:string)=>container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const click=async(text:string)=>act(async()=>button(text).click());
async function type(element:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));});}
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,720));});}
it('reuses the original SKU controls with task-source quantities, keeps PDA file import hidden and restores the selected position',async()=>{
 expect(container.querySelector('h2.font-mono')?.textContent).toBe('107-002-1');expect(container.textContent).toContain('任务账面数量');expect(container.textContent).toContain('商品甲');expect(container.querySelector('input[accept=".xlsx"]')).toBeNull();expect(container.textContent).not.toContain('原库位核查参考');
 const physical=container.querySelector('h2.font-mono')!,controls=container.querySelector('[data-sku-controls]')!;expect(physical.compareDocumentPosition(controls)&window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 const scanner=input('扫描/输入目标库位');expect(scanner.inputMode).toBe('none');await click('切换手动键盘');expect(scanner.inputMode).toBe('text');
 await click('下一个未完成目标');expect(container.querySelector('h2.font-mono')?.textContent).toBe('108-003-4');expect(scanner.inputMode).toBe('none');
 await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));expect(container.querySelector('h2.font-mono')?.textContent).toBe('108-003-4');expect(mocks.save).not.toHaveBeenCalled();
});
it('allows same-SKU surplus without a photo and autosaves an independent complete result',async()=>{
 await click('一键全相符 (正常)');await settle();await click('+ 现场多货');
 const sku=container.querySelector('input[placeholder="扫描或输入 SKU 编码"]') as HTMLInputElement || Array.from(container.querySelectorAll('input')).find(i=>i.className.includes('focus:ring'))!;
 await type(sku,'SKU1');expect(container.textContent).toContain('现场拍照 (可选)');await click('确认添加多货');await settle();
 expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.save.mock.calls.some(call=>call[1]===task.id&&call[3].completed&&call[3].lines.some((line:any)=>line.id.startsWith('extra:')&&line.sku==='SKU1'&&line.actual===1))).toBe(true);
});
it('blocks a different SKU until its own image is supplied and saved, then completes using the SKU transport',async()=>{
 await click('一键全相符 (正常)');await settle();await click('+ 现场多货');
 const sku=Array.from(container.querySelectorAll('input')).find(i=>i.className.includes('focus:ring'))!;await type(sku,'OTHER');await click('确认添加多货');expect(container.textContent).toContain('不同 SKU 或未知货物必须拍照');expect(mocks.upload).not.toHaveBeenCalled();
 const file=new window.File([new Uint8Array([255,216,255,1])],'wrong.jpg',{type:'image/jpeg'});
 const files=Array.from(container.querySelectorAll('input[type="file"]'));const picker=files[files.length-1];
 await act(async()=>{Object.defineProperty(picker,'files',{configurable:true,value:[file]});picker.dispatchEvent(new window.Event('change',{bubbles:true}));});await click('确认添加多货');await settle();
 expect(mocks.upload).toHaveBeenCalledWith('H1',task.id,'107-002-1',expect.stringMatching(/^extra:/),expect.any(String),file,2);
 expect(mocks.save.mock.calls.some(call=>call[3].completed&&call[3].lines.some((line:any)=>line.sku==='OTHER'))).toBe(true);
});
it('requires claim before editing and preserves already saved progress after claim and reload',async()=>{
 await act(async()=>root.unmount());task.claimedBy=null;task.mine=false;task.canEdit=false;task.publicationRevision=1;
 mocks.countControl.mockImplementation(async(_h,_id,action,payload)=>{expect(action).toBe('claim');task.claimedBy=payload.name;task.canEdit=true;task.mine=true;task.publicationRevision=2;return {ok:true};});
 root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));expect(container.querySelector('fieldset')?.disabled).toBe(true);
 await type(input('认领人姓名'),'Alice');await click('认领并开始');expect(container.querySelector('fieldset')?.disabled).toBe(false);expect(mocks.countControl).toHaveBeenCalledWith('H1',task.id,'claim',{revision:1,name:'Alice'});
 await click('一键全相符 (正常)');await settle();expect(mocks.save).toHaveBeenCalled();
});
it('previews an Excel file on PC before creating a hall-scoped draft, never automatically publishing or importing WMS',async()=>{
 await act(async()=>root.unmount());localStorage.removeItem('wms-sku-count-selected:H1');Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Desktop Chrome'});mocks.countManager.mockResolvedValue({manager:true,configured:true});
 const rows=[{hall:'H1',location:'107-002-1',sku:'SKU1',barcode:'00001',customer:'C',name:'商品甲',qty:5},{hall:'H2',location:'201-001-1',sku:'SKU1',barcode:'00001',customer:'C',name:'商品甲',qty:9}];
 mocks.readCountFile.mockResolvedValue({rows,file:'sample.xlsx',hash:'a'.repeat(64)});mocks.createCountTask.mockResolvedValue({id:task.id});
 root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));const file=new window.File(['test'],'sample.xlsx');
 await act(async()=>{const picker=input('导入 SKU 库位库存表');Object.defineProperty(picker,'files',{configurable:true,value:[file]});picker.dispatchEvent(new window.Event('change',{bubbles:true}));});expect(mocks.createCountTask).not.toHaveBeenCalled();
 await type(input('任务名称'),'H1 SKU1');await click('创建草稿任务');expect(mocks.createCountTask).toHaveBeenCalledWith('H1',expect.objectContaining({name:'H1 SKU1',rows:[rows[0]],skus:['SKU1'],sourceFile:'sample.xlsx'}));expect(mocks.countControl).not.toHaveBeenCalled();
});
it('orders area groups, previews excluded RT, creates a separate small-goods task and restores its scope on PDA',async()=>{
 await act(async()=>root.unmount());localStorage.removeItem('wms-sku-count-selected:H1');Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Desktop Chrome'});mocks.countManager.mockResolvedValue({manager:true,configured:true});
 const rt={hall:'RT',location:'RT-001-2',sku:'SKU1',barcode:'',customer:'C',name:'商品甲',qty:4};
 const stock=[{...rt,hall:'H1',location:'101-001-1'},{...rt,hall:'Halle2/2F',location:'M224-011-C',qty:3},{...rt,hall:'Halle3/2F',location:'M326-009-C',qty:2},{...rt,hall:'WS',location:'WS-1'},rt];
 mocks.readCountFile.mockResolvedValue({rows:stock,file:'mixed.xlsx',hash:'a'.repeat(64)});mocks.createCountTask.mockResolvedValue({id:task.id});
 root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));
 await act(async()=>{const picker=input('导入 SKU 库位库存表');Object.defineProperty(picker,'files',{configurable:true,value:[new window.File(['test'],'mixed.xlsx')]});picker.dispatchEvent(new window.Event('change',{bubbles:true}));});
 const select=container.querySelector('select[aria-label="盘点库区"]') as HTMLSelectElement;
 expect(Array.from(select.options).map(o=>o.value)).toEqual(['H1','H2','H3','SMALL_GOODS','AREA:WS']);expect(select.textContent).not.toContain('RT');
 expect(container.textContent).toContain('退货暂存区，未纳入盘点');expect(container.querySelector('table')?.textContent).toContain('RT-001-2');
 await act(async()=>{select.value='SMALL_GOODS';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 await type(input('任务名称'),'Small goods');task.hall='SMALL_GOODS';task.plan.excludedReturns=[rt];await click('创建草稿任务');
 expect(mocks.createCountTask).toHaveBeenCalledWith('SMALL_GOODS',expect.objectContaining({rows:[stock[1],stock[2],rt],skus:['SKU1']}));
 await act(async()=>root.unmount());Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Android PDA Chrome'});root=createRoot(container);await act(async()=>root.render(<Page currentHall="H1"/>));
 expect((container.querySelector('select[aria-label="盘点库区"]') as HTMLSelectElement).value).toBe('SMALL_GOODS');expect(mocks.loadCountTask).toHaveBeenLastCalledWith('SMALL_GOODS',task.id);expect(container.textContent).toContain('RT-001-2');expect(input('导入 SKU 库位库存表')).toBeNull();
});
