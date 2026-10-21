import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
vi.mock('../src/pages/LocationInspectionPage', () => ({
  hasUnsavedInspectionDrafts: () => false, flushInspectionDrafts:()=>{},
  LocationInspectionPage: ({ currentHall, allowFileTransfer }: any) => <div data-testid="inspection">{currentHall}:{String(allowFileTransfer)}</div>,
}));
vi.mock('../src/pages/WMSImportPage', () => ({ WMSImportPage: () => <div>import-page</div> }));
vi.mock('../src/pages/InspectionExportPage', () => ({ InspectionExportPage: () => <div>export-page</div> }));
vi.mock('../src/pages/SkuCountPage',()=>({SkuCountPage:({currentHall}:any)=><div>sku-count-page:{currentHall}</div>}));
vi.mock('../src/pages/ChangeAuditPage', () => ({ ChangeAuditPage: () => <div>change-audit-page</div> }));
vi.mock('../src/pages/DeviceTestPage', () => ({ DeviceTestPage: () => <div>device-test</div> }));
vi.mock('../src/pages/ArchitecturePage', () => ({ ArchitecturePage: () => <div>architecture</div> }));
let App: any, root: any, createRoot: any, container: HTMLDivElement;
beforeAll(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://audit.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  createRoot = (await import('react-dom/client')).createRoot;
  App = (await import('../src/App')).App;
});
beforeEach(async () => {
  window.sessionStorage.clear(); window.localStorage.clear();
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop Chrome Windows' });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<App />)); }
async function remount() {
  await act(async () => root.unmount()); root = createRoot(container); await render();
}
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === text); }
async function click(text: string) { await act(async () => button(text)!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))); }
describe('Tab hall selection and handheld presentation', () => {
  it('retains H2 after a refresh/remount, with a browser reopen keeping H3', async () => {
    await render(); expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H1:true');
    await click('H2');
    await remount(); expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H2:true');
    await click('H3');
    await remount(); expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H3:true');
    window.sessionStorage.clear(); // a newly opened tab has a fresh session
    await remount(); expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H3:true');
  });
  it.each([
    ['Android PDA Chrome', 0], ['iPhone Mobile', 0], ['iPad', 0], ['Macintosh Safari', 5],
  ])('hides file tools on %s while keeping inspection and diagnostics', async (userAgent, maxTouchPoints) => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
    await render();
    expect(button('WMS 导入')).toBeUndefined(); expect(button('导出')).toBeUndefined(); expect(button('库存变动核查')).toBeDefined();
    expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H1:false');
    await click('H2'); await remount();
    expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H2:false');
    await click('测试'); expect(container.textContent).toContain('device-test');
  });
  it('keeps desktop import/export available even in a narrow window', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    await render(); await click('WMS 导入'); expect(container.textContent).toContain('import-page');
    await click('导出'); expect(container.textContent).toContain('export-page');
    await click('库存变动核查'); expect(container.textContent).toContain('change-audit-page');
    await remount(); expect(container.textContent).toContain('change-audit-page');
  });
  it('keeps a separate remembered tab for each hall and restores it after browser reopen',async()=> {
    await render();await click('H2');await click('库存变动核查');
    await click('H1');expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H1:true');
    await click('H2');expect(container.textContent).toContain('change-audit-page');
    window.sessionStorage.clear();await remount();expect(container.textContent).toContain('change-audit-page');expect(window.localStorage.getItem('wms-active-hall')).toBe('H2');
    await click('库位核查');window.sessionStorage.clear();await remount();expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H2:true');
  });
  it('opens SKU counting on PDA and persists its tab separately per hall',async()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Android PDA Chrome'});
    await render();await click('H2');await click('SKU盘点');expect(container.textContent).toContain('sku-count-page:H2');
    window.sessionStorage.clear();await remount();expect(container.textContent).toContain('sku-count-page:H2');
    await click('H1');expect(container.querySelector('[data-testid="inspection"]')?.textContent).toBe('H1:false');
    await click('H2');expect(container.textContent).toContain('sku-count-page:H2');
    expect(button('WMS 导入')).toBeUndefined();expect(button('导出')).toBeUndefined();
  });
  it('validates stored hall IDs and clears the selection on explicit exit', async () => {
    const { readSessionHall, clearSessionHall } = await import('../src/utils/sessionHall');
    window.localStorage.setItem('wms-active-hall', 'invalid'); expect(readSessionHall()).toBe('H1');
    window.localStorage.setItem('wms-active-hall', 'H2'); clearSessionHall(); expect(readSessionHall()).toBe('H1');
    const get = vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try { expect(readSessionHall()).toBe('H1'); } finally { get.mockRestore(); }
  });
});
