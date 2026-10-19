import React, { act } from 'react';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);const {JSDOM}=require('jsdom');
const download=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../src/services/inspectionExport',()=>({downloadInspectionResults:download}));
let root:any,container:HTMLDivElement,Page:any,createRoot:any;
beforeAll(async()=>{
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://audit.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 createRoot=(await import('react-dom/client')).createRoot;Page=(await import('../src/pages/InspectionExportPage')).InspectionExportPage;
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.clearAllMocks();});
describe('Independent export language and version scope',()=>{
 it('passes language and scope for both export modes while keeping Chinese UI',async()=>{
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  await act(async()=>root.render(<Page currentHall="H2"/>));
  const selects=container.querySelectorAll('select');
  expect(selects).toHaveLength(2);expect(selects[0].value).toBe('zh');expect(selects[1].value).toBe('history');
  await act(async()=>{selects[0].value='de';selects[0].dispatchEvent(new window.Event('change',{bubbles:true}));
   selects[1].value='latest';selects[1].dispatchEvent(new window.Event('change',{bubbles:true}));});
  expect(container.textContent).toContain('核查结果导出');
  for(const [text,mode] of [['仅导出差异','differences'],['导出全部核查结果','all']]){
   const button=Array.from(container.querySelectorAll('button')).find(item=>item.textContent===text)!;
   await act(async()=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true})));
   expect(download).toHaveBeenLastCalledWith('H2',mode,'latest','de');
  }
 });
});
it('keeps original inspection exports here and moves snapshot comparison to its own menu',async()=>{
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 await act(async()=>root.render(<Page currentHall="H1"/>));
 expect(container.textContent).not.toContain('WMS 快照对比');expect(container.textContent).toContain('仅导出差异');expect(container.textContent).toContain('导出全部核查结果');
});
