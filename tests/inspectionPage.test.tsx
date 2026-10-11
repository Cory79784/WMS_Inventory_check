import React, { act } from 'react';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const browserErrors: Error[] = [];
const api = vi.hoisted(() => ({
  fetchLocationAudit: vi.fn(), saveLocationInspection: vi.fn(), uploadInspectionPhoto: vi.fn(),
  fetchActiveVersion: vi.fn(), fetchLocationsList: vi.fn(),
}));
vi.mock('../src/services/api', () => api);
let root: any, container: HTMLDivElement, Page: any, createRoot: any;
beforeAll(async () => {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: Error) => browserErrors.push(error));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', virtualConsole });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    FileReader: dom.window.FileReader,
    IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.alert = vi.fn(); globalThis.confirm = vi.fn(() => true);
  createRoot = (await import('react-dom/client')).createRoot;
  Page = (await import('../src/pages/LocationInspectionPage')).LocationInspectionPage;
});
beforeEach(async () => {
  browserErrors.length = 0;
  vi.clearAllMocks();
  api.fetchActiveVersion.mockResolvedValue({ hasActiveVersion: true, activeVersion: { version_number: 1 } });
  api.fetchLocationsList.mockResolvedValue([]);
  api.uploadInspectionPhoto.mockResolvedValue({ photoId: 'unknown-photo', objectKey: 'original.jpg' });
  api.fetchLocationAudit.mockImplementation(async (hallId, locationCode) => ({ hallId, locationCode,
    referenceImportId: 'v1', versionNumber: 1, sourceExportedAt: null, hasBookStock: true,
    skus: [{ sku: 'SKU', barcode: '', eBarcode: '', customerCode: '', nameZh: '', nameEn: '',
      systemQty: 10, availableQty: 10, allocatedQty: 0, frozenQty: 0, actualQty: null,
      differenceQty: null, discrepancyType: null, notes: '' }], inspection: null,
    navigation: { currentIndex: null, totalLocations: 0,
      prevLocationCode: locationCode.replace(/-(\d+)-/, (_, middle) => `-${String(Number(middle)-1).padStart(3,'0')}-`),
      nextLocationCode: locationCode.replace(/-(\d+)-/, (_, middle) => `-${String(Number(middle)+1).padStart(3,'0')}-`) },
  }));
  api.saveLocationInspection.mockResolvedValue({ inspectionId: 'saved', savedAt: '2026-10-11T00:00:00Z' });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Page currentHall="H1" onOpenImport={() => {}} onOpenTest={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); expect(browserErrors).toEqual([]); });
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!; }
function scanInput() { return container.querySelector('input[type="text"]') as HTMLInputElement; }
async function click(element: Element) { await act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))); }
async function query(code: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(scanInput(), code);
    scanInput().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => scanInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}
describe('PDA inspection UI interactions', () => {
  it('retains unsaved SKU results when switching and stays put after saving', async () => {
    await query('109-028-1'); await click(button('正常'));
    await click(container.querySelector('[aria-label="下一库位"]')!);
    expect(scanInput().value).toBe('109-029-1');
    await click(container.querySelector('[aria-label="上一库位"]')!);
    expect(scanInput().value).toBe('109-028-1');
    expect(container.textContent).toContain('相符');
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '109-028-1', status: 'VERIFIED', skus: [expect.objectContaining({ actualQty: 10 })],
    }));
    expect(scanInput().value).toBe('109-028-1');
    expect(container.textContent).not.toContain('保存并下一个库位');
  });
  it('keeps scanner inputMode none by default and returns to scanner mode after manual entry', async () => {
    expect(scanInput().getAttribute('inputmode')).toBe('none');
    await click(container.querySelector('[aria-label="手动输入库位"]')!);
    expect(scanInput().getAttribute('inputmode')).toBe('text');
    await query('110-028-1');
    expect(scanInput().getAttribute('inputmode')).toBe('none');
  });
  it('does not fetch or display location dropdown suggestions', async () => {
    api.fetchLocationsList.mockResolvedValue(['115-001-1']);
    await query('115-001-1');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    expect(api.fetchLocationsList).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('点击载入');
  });
  it('accepts Android IME scans repeatedly using the working hardware-test input mode', async () => {
    const originalAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Android PDA' });
    try {
      await act(async () => root.render(<Page currentHall="H1" onOpenImport={() => {}} onOpenTest={() => {}} />));
      expect(scanInput().hasAttribute('inputmode')).toBe(false);
      for (const code of ['115-002-1', '115-003-1']) {
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(scanInput(), code);
          scanInput().dispatchEvent(new window.Event('input', { bubbles: true }));
          scanInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true }));
          await new Promise(resolve => setTimeout(resolve, 180));
        });
        expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', code);
        expect(container.textContent).toContain(code);
        expect(scanInput().value).toBe('');
      }
      const save = button('保存本库位核查');
      save.focus();
      await click(save);
      expect(document.activeElement).toBe(scanInput());
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent });
    }
  });
  it('saves unfinished inspection as IN_PROGRESS without invented zero actual counts', async () => {
    await query('111-028-1'); await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({ status: 'IN_PROGRESS', skus: [] }));
  });
  it('displays actual progress, preserves failed original File for retry and blocks saving during upload', async () => {
    await query('112-028-1');
    const file = new window.File(['original-photo'], 'original.jpg', { type: 'image/jpeg' });
    let finish: any, fail: any, progress: any;
    api.uploadInspectionPhoto.mockImplementation((_file, _hall, _loc, onProgress) => {
      progress = onProgress;
      return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    });
    const input = container.querySelector('input[type="file"][multiple]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
    expect(button('保存本库位核查').disabled).toBe(true);
    await act(async () => progress(65));
    expect(container.textContent).toContain('上传中 65%');
    expect(container.querySelector('progress')?.value).toBe(65);
    await act(async () => fail(new Error('network')));
    expect(button('重试')).toBeTruthy();
    await click(button('重试'));
    expect(api.uploadInspectionPhoto.mock.calls[1][0]).toBe(file);
    await act(async () => finish({ photoId: 'p1', objectKey: 'original.jpg', previewUrl: '/photo' }));
    expect(container.textContent).toContain('已保存');
    expect(button('保存本库位核查').disabled).toBe(false);
  });
  it('uploads multiple original files with concurrency capped at two', async () => {
    await query('113-028-1');
    const files = [1,2,3].map((n) => new window.File([String(n)], `original${n}.jpg`, { type: 'image/jpeg' }));
    const finish: any[] = [];
    api.uploadInspectionPhoto.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const input = container.querySelector('input[type="file"][multiple]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
    expect(api.uploadInspectionPhoto).toHaveBeenCalledTimes(2);
    await act(async () => finish[0]({ photoId: 'parallel1', objectKey: '1.jpg' }));
    expect(api.uploadInspectionPhoto).toHaveBeenCalledTimes(2);
    await act(async () => finish[1]({ photoId: 'parallel2', objectKey: '2.jpg' }));
    expect(api.uploadInspectionPhoto).toHaveBeenCalledTimes(3);
    await act(async () => finish[2]({ photoId: 'parallel3', objectKey: '3.jpg' }));
    expect(container.textContent).toContain('现场照片存证 (3 张)');
  });

  it('scanner reads the latest DOM value when input and Enter arrive in the same burst', async () => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(scanInput(), '119-028-1');
      scanInput().dispatchEvent(new window.Event('input', { bubbles: true }));
      scanInput().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', '119-028-1');
  });
  it('scanner recovers focus after an action button takes focus', async () => {
    await query('120-028-1');
    const normal = button('正常'); normal.focus();
    expect(document.activeElement).toBe(normal);
    await act(async () => normal.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true })));
    expect(document.activeElement).toBe(scanInput());
    expect(scanInput().value).toBe('1');
  });
  it('scanner automatically queries a completed code without Enter/Tab', async () => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(scanInput(), '121-028-1');
      scanInput().dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', '121-028-1');
  });
  it('one-tap all normal saves the confirmed counts and shows a short-lived saved notification', async () => {
    await query('122-028-1');
    await click(button('一键全相符 (正常)'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      status: 'VERIFIED', skus: [expect.objectContaining({ actualQty: 10, differenceQty: 0 })],
    }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已保存');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('已核查');
  });
  it('shows all three aggregated SKU cards', async () => {
    const base=await api.fetchLocationAudit('H1','123-028-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, skus: ['A','B','C'].map(sku=>({...base.skus[0],sku})) });
    await query('123-028-1');
    expect(container.textContent).toContain('库位商品列表 (3 个 SKU)');
    for(const sku of ['A','B','C']) expect(Array.from(container.querySelectorAll('span.font-mono.font-bold')).some(el=>el.textContent===sku)).toBe(true);
  });
  it('keeps export controls out of the inspection page', () => {
    expect(container.textContent).not.toContain('仅导出差异');
    expect(container.textContent).not.toContain('导出全部核查结果');
  });

  it('exposes export only through the header alongside import and test', async () => {
    await act(async () => {
      const { App } = await import('../src/App');
      root.render(<App />);
    });
    expect(button('导出').closest('header')).not.toBeNull();
    expect(button('WMS 导入').closest('header')).not.toBeNull();
    expect(button('测试').closest('header')).not.toBeNull();
    expect(container.textContent).not.toContain('仅导出差异');
    await click(button('导出'));
    expect(container.textContent).toContain('H1 核查结果导出');
    expect(button('仅导出差异')).toBeTruthy();
    expect(button('导出全部核查结果')).toBeTruthy();
  });

  it('requires and uploads the original photo for unknown goods before saving its link', async () => {
    await query('124-028-1');
    await click(button('+ 现场多货'));
    await click(button('无 SKU 货物'));
    await click(button('确认添加多货'));
    expect(api.uploadInspectionPhoto).not.toHaveBeenCalled();
    const file = new window.File(['original'], 'original.jpg', { type: 'image/jpeg' });
    const input = container.querySelector('input[type="file"]:not([multiple])')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    await click(button('确认添加多货'));
    expect(api.uploadInspectionPhoto.mock.calls[0][0]).toBe(file);
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      photos: [{ photoId: 'unknown-photo', objectKey: 'original.jpg' }],
      skus: [expect.objectContaining({ discrepancyType: 'NO_SKU_SURPLUS' })],
    }));
  });
  it('does not show a saved notification when saving fails', async () => {
    await query('125-028-1');
    api.saveLocationInspection.mockRejectedValueOnce(new Error('D1 failed'));
    await click(button('一键全相符 (正常)'));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('保存失败: D1 failed');
  });
  it('manual keyboard entry does not auto-query before the user submits', async () => {
    await click(container.querySelector('[aria-label="手动输入库位"]')!);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(scanInput(), '126-028-1');
      scanInput().dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 180));
    });
    expect(api.fetchLocationAudit).not.toHaveBeenCalled();
    await click(button('查询'));
    expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', '126-028-1');
  });

  it('does not carry unsaved old-version counts into a newly imported WMS version', async () => {
    await query('127-028-1'); await click(button('正常'));
    const data = await api.fetchLocationAudit('H1', '127-028-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...data, referenceImportId: 'v2', versionNumber: 2,
      skus: data.skus.map((item: any) => ({ ...item, systemQty: 20 })),
    });
    await query('127-028-1');
    expect(container.textContent).toContain('待核对');
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      referenceImportId: 'v2', status: 'IN_PROGRESS', skus: [],
    }));
  });

  it('uses the latest scan when a previous location request is still pending', async () => {
    const oldData = await api.fetchLocationAudit('H1', '128-028-1');
    let finishOld: any;
    api.fetchLocationAudit.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await query('128-028-1');
    await query('128-029-1');
    expect(scanInput().value).toBe('128-029-1');
    await act(async () => finishOld(oldData));
    expect(scanInput().value).toBe('128-029-1');
  });

});
