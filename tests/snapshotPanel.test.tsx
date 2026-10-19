import React,{act} from 'react';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const mocks=vi.hoisted(()=>({versions:vi.fn(),compare:vi.fn(),download:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../src/services/snapshotCompare',()=>({fetchSnapshotVersions:mocks.versions,compareSnapshots:mocks.compare}));
vi.mock('../src/services/snapshotExport',()=>({downloadSnapshotComparison:mocks.download}));
let root:any,container:HTMLDivElement,Panel:any,createRoot:any;
const versions=[{importId:'new',hallId:'H1',versionNumber:2,importedAt:'2026-10-16',originalFilename:'new.xlsx'},
 {importId:'old',hallId:'H1',versionNumber:1,importedAt:'2026-10-15',originalFilename:'old.xlsx'}];
const result={hallId:'H1',oldVersion:versions[1],newVersion:versions[0],summary:{changedLocations:2,changedSkuRows:2,addedSkuRows:1,removedSkuRows:1},
 locations:['A','B'].map(locationCode=>({locationCode,changeType:'CHANGED',oldTotalQty:1,newTotalQty:2,changes:[{sku:locationCode,oldQty:1,newQty:2,differenceQty:1,changeType:'QUANTITY_CHANGED'}]}))};
beforeAll(async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://audit.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 createRoot=(await import('react-dom/client')).createRoot;Panel=(await import('../src/components/SnapshotComparisonPanel')).SnapshotComparisonPanel;
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.clearAllMocks();});
async function mount(activeId='new'){
 mocks.versions.mockResolvedValue({versions,activeImportId:activeId});mocks.compare.mockResolvedValue(result);
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 const inspect=vi.fn();await act(async()=>root.render(<Panel hallId="H1" language="de" onInspectLocation={inspect}/>));return inspect;
}
async function expand(){await act(async()=>{const details=container.querySelector('details')!;details.open=true;details.dispatchEvent(new window.Event('toggle'));});}
async function click(text:string){await act(async()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===text)!.click());}
it('loads on expansion, previews folded locations, exports all changes despite preview filtering, and invalidates old results',async()=>{
 const inspect=await mount();expect(mocks.versions).not.toHaveBeenCalled();await expand();expect(mocks.versions).toHaveBeenCalledTimes(1);
 await click('查看变动库位');expect(mocks.compare).toHaveBeenCalledWith('H1','old','new',expect.any(AbortSignal));
 expect(container.querySelectorAll('details')).toHaveLength(3);expect(container.querySelectorAll('details')[1].open).toBe(false);
 await click('去核查（当前 WMS）');expect(inspect).toHaveBeenCalledWith('A');
 const input=container.querySelector('input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(input,'A');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
 await click('导出全部快照变动');expect(mocks.download).toHaveBeenCalledWith(result,'de');
 await act(async()=>{const select=container.querySelectorAll('select')[1];select.value='old';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 expect(container.querySelectorAll('details')).toHaveLength(1);expect(container.textContent).not.toContain('导出全部快照变动');
});
it('does not allow historical comparison to change the active WMS during review',async()=>{
 const inspect=await mount('different-active');await expand();await click('查看变动库位');await click('去核查（当前 WMS）');expect(inspect).not.toHaveBeenCalled();
});
it('defaults to the active version, reuses supplied metadata, and starts an independent task without quantity summary cards',async()=>{
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 const start=vi.fn();mocks.compare.mockResolvedValue(result);
 const metadata={versions:[{...versions[0],importId:'future',versionNumber:3},...versions],activeImportId:'new'};
 await act(async()=>root.render(<Panel hallId="H1" language="zh" initialVersions={metadata} onStart={start}/>));
 await expand();expect(mocks.versions).not.toHaveBeenCalled();
 expect((container.querySelectorAll('select')[0] as HTMLSelectElement).value).toBe('old');
 expect((container.querySelectorAll('select')[1] as HTMLSelectElement).value).toBe('new');
 await click('查看变动库位');expect(container.textContent).not.toContain('变动 SKU 明细');await click('建立独立核查任务');expect(start).toHaveBeenCalledWith(result);
 await act(async()=>{const select=container.querySelectorAll('select')[1];select.value='future';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
 mocks.compare.mockResolvedValue({...result,newVersion:metadata.versions[0]});await click('查看变动库位');
 const create=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='建立独立核查任务')!;expect(create.disabled).toBe(true);
});
