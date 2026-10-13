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
  it('automatically persists a normal confirmation to D1 without the Save button', async () => {
    await query('129-040-1');
    api.saveLocationInspection.mockClear();
    await click(button('正常'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 950)); });
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '129-040-1', status: 'VERIFIED',
      skus: [expect.objectContaining({actualQty: 10, differenceQty: 0, discrepancyType: 'NORMAL'})],
    }));
  });
  it('automatically persists shortage quantities to D1 without manual saving', async () => {
    await query('129-041-1');
    api.saveLocationInspection.mockClear();
    await click(button('少货'));
    await click(button('确认少货'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 950)); });
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '129-041-1', skus: [expect.objectContaining({actualQty: 9, differenceQty: -1, discrepancyType: 'SHORTAGE'})],
    }));
  });
  it('automatically persists manually added surplus to D1 without manual saving', async () => {
    await query('129-042-1');
    api.saveLocationInspection.mockClear();
    await click(button('+ 现场多货'));
    const sku = container.querySelector('input[placeholder="扫描或输入外箱 SKU"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(sku, 'SURPLUS-TEST');
      sku.dispatchEvent(new window.Event('input', {bubbles:true}));
    });
    await click(button('确认添加多货'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 950)); });
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '129-042-1', skus: expect.arrayContaining([
        expect.objectContaining({sku: 'SURPLUS-TEST', actualQty: 1, differenceQty: 1, discrepancyType: 'SURPLUS'})
      ]),
    }));
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
      button('保存本库位核查').focus();
      await click(button('保存本库位核查'));
      expect(document.activeElement).toBe(scanInput());
      const next = container.querySelector('[aria-label="下一库位"]') as HTMLButtonElement;
      next.focus();
      await click(next);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(document.activeElement).toBe(scanInput());
      expect(scanInput().readOnly).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent });
    }
  });
  it('uses native manual keyboard control when supported and only shows it on keyboard-button request', async () => {
    const originalAgent = navigator.userAgent;
    const keyboard = { hide: vi.fn(), show: vi.fn() };
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android PDA' });
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: keyboard });
    try {
      await query('115-004-1');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(scanInput().getAttribute('virtualkeyboardpolicy')).toBe('manual');
      expect(keyboard.hide).toHaveBeenCalled();
      expect(keyboard.show).not.toHaveBeenCalled();
      await act(async () => {
        container.querySelector('[aria-label="手动输入库位"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(keyboard.show).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(scanInput());
        expect(scanInput().inputMode).toBe('text');
        expect(scanInput().getAttribute('virtualkeyboardpolicy')).toBe('auto');
      });
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent });
      delete (navigator as any).virtualKeyboard;
    }
  });
  it('focuses an editable scanner on initial Android mount without any keyboard API', async () => {
    const originalAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android PDA' });
    try {
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => root.render(<Page currentHall="H1" onOpenImport={() => {}} onOpenTest={() => {}} />));
      expect(document.activeElement).toBe(scanInput());
      expect(scanInput().readOnly).toBe(false);
      expect(scanInput().getAttribute('virtualkeyboardpolicy')).toBe('auto');
      expect(scanInput().inputMode).not.toBe('none');
      await query('115-008-1');
      expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', '115-008-1');
      await click(container.querySelector('[aria-label="手动输入库位"]')!);
      expect(document.activeElement).toBe(scanInput());
      expect(scanInput().inputMode).toBe('text');
      expect(scanInput().readOnly).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent });
    }
  });
  it('keeps the ordinary keyboard path enabled if the experimental API throws', async () => {
    const originalAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android PDA' });
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: {
      hide: vi.fn(() => { throw new Error('unsupported'); }),
      show: vi.fn(() => { throw new Error('activation denied'); }),
    } });
    try {
      await query('115-009-1');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      await click(container.querySelector('[aria-label="手动输入库位"]')!);
      expect(document.activeElement).toBe(scanInput());
      expect(scanInput().getAttribute('virtualkeyboardpolicy')).toBe('auto');
      expect(scanInput().inputMode).toBe('text');
      expect(scanInput().readOnly).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent });
      delete (navigator as any).virtualKeyboard;
    }
  });
  it('confirms sparse empty locations and saves immediately with zero SKU rows', async () => {
    const base = await api.fetchLocationAudit('H1', '115-005-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, hasBookStock: false, skus: [] });
    await query('115-005-1');
    await click(button('确认为空库位'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '115-005-1', status: 'VERIFIED', isEmptyConfirmed: true, skus: [],
    }));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('已保存');
    expect(container.textContent).toContain('已确认空库位');
  });
  it('does not mark an empty location saved when its save fails', async () => {
    const base = await api.fetchLocationAudit('H1', '115-006-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, hasBookStock: false, skus: [] });
    api.saveLocationInspection.mockRejectedValueOnce(new Error('network'));
    await query('115-006-1');
    await click(button('确认为空库位'));
    expect(container.textContent).toContain('保存失败');
    expect(container.textContent).not.toContain('已确认空库位');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('shows the loaded location version upload date and time at the page footer', async () => {
    const base = await api.fetchLocationAudit('H1', '115-007-1');
    const importedAt = '2026-10-10T13:14:15Z';
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, versionNumber: 3, importedAt });
    await query('115-007-1');
    const footer = container.querySelector('[data-testid="wms-import-time"]')!;
    expect(footer.textContent).toContain('V3');
    expect(footer.textContent).toContain(new Date(importedAt).toLocaleString('zh-CN', { hour12: false }));
  });
  it('saves unfinished inspection as IN_PROGRESS without invented zero actual counts', async () => {
    await query('111-028-1'); await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({ status: 'IN_PROGRESS', skus: [] }));
  });
  it('scans a shortage return code into the modal without querying another location and saves it', async () => {
    await query('116-001-1');
    await click(button('少货'));
    await click(container.querySelector('input[type="checkbox"]')!);
    const code = container.querySelector('[aria-label="退货码或跟踪号"]') as HTMLInputElement;
    expect(document.activeElement).toBe(code);
    const previousQueries = api.fetchLocationAudit.mock.calls.length;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(code, 'RET-001');
      code.dispatchEvent(new window.Event('input', { bubbles: true }));
      code.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(api.fetchLocationAudit).toHaveBeenCalledTimes(previousQueries);
    await click(button('确认少货'));
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({ skus: [expect.objectContaining({
      discrepancyType: 'SHORTAGE', actualQty: 9, isReturn: true, returnCode: 'RET-001',
    })] }));
    expect(container.textContent).toContain('RET-001');
  });
  it('marks surplus as a return, preserves the tracking code, and clears it when changed to normal', async () => {
    await query('116-002-1');
    await click(button('正常'));
    await click(button('+ 现场多货'));
    const sku = container.querySelector('input[placeholder="扫描或输入多货 SKU..."]')
      || Array.from(container.querySelectorAll('input')).find(input => input.placeholder.includes('SKU'))!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(sku, 'RETURN-SKU');
      sku.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click(container.querySelector('input[type="checkbox"]')!);
    const code = container.querySelector('[aria-label="退货码或跟踪号"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(code, 'TRACK-02');
      code.dispatchEvent(new window.Event('input', { bubbles: true }));
      code.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    await click(button('确认添加多货'));
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({ skus: expect.arrayContaining([
      expect.objectContaining({ sku: 'RETURN-SKU', discrepancyType: 'SURPLUS', isReturn: true, returnCode: 'TRACK-02' }),
    ]) }));
    await click(button('一键全相符 (正常)'));
    expect(api.saveLocationInspection.mock.lastCall![0].skus.every((item: any) => !item.isReturn && !item.returnCode)).toBe(true);
  });
  it('updates only the chosen row when return surplus shares the book-stock SKU', async () => {
    const base = await api.fetchLocationAudit('H1', '116-003-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, skus: [base.skus[0], {
      ...base.skus[0], systemQty: 0, actualQty: 2, differenceQty: 2, discrepancyType: 'SURPLUS', isReturn: true, returnCode: 'KEEP-RET',
    }] });
    await query('116-003-1');
    await click(button('正常'));
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection.mock.lastCall![0].skus).toEqual([
      expect.objectContaining({ systemQty: 10, actualQty: 10, isReturn: false }),
      expect.objectContaining({ systemQty: 0, actualQty: 2, isReturn: true, returnCode: 'KEEP-RET' }),
    ]);
    await click(button('少货'));
    await click(button('确认少货'));
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection.mock.lastCall![0].skus[1]).toMatchObject({ actualQty: 2, isReturn: true, returnCode: 'KEEP-RET' });
  });
  it('enables modal keyboards synchronously and resumes scanner mode after closing', async () => {
    await query('116-004-1');
    await click(button('+ 现场多货'));
    const sku = container.querySelector('input[placeholder="扫描或输入外箱 SKU"]') as HTMLInputElement;
    expect(document.activeElement).toBe(sku);
    await act(async () => {
      container.querySelector('[aria-label="手动输入"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      expect(document.activeElement).toBe(sku);
      expect(sku.inputMode).toBe('text');
    });
    await click(button('扫/输 条码'));
    const barcode = container.querySelector('input[placeholder="扫描外箱 Barcode / eBarcode"]') as HTMLInputElement;
    expect(document.activeElement).toBe(barcode);
    await click(button('取消'));
    expect(document.activeElement).toBe(scanInput());
    expect(scanInput().inputMode).toBe('none');
    await query('116-005-1');
    expect(api.fetchLocationAudit).toHaveBeenCalledWith('H1', '116-005-1');
  });
  it.each([
    ['shortage', false, '117-001-1'], ['shortage', true, '117-002-1'],
    ['surplus', false, '117-003-1'], ['surplus', true, '117-004-1'],
  ] as const)('allows %s saving with optional return checkbox %s and no scanned code', async (kind, isReturn, location) => {
    await query(location);
    if (kind === 'shortage') await click(button('少货'));
    else {
      await click(button('正常'));
      await click(button('+ 现场多货'));
      const sku = container.querySelector('input[placeholder="扫描或输入外箱 SKU"]') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(sku, 'OPTIONAL-RETURN');
        sku.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    }
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.required).toBe(false);
    if (isReturn) {
      await click(checkbox);
      const code = container.querySelector('[aria-label="退货码或跟踪号"]') as HTMLInputElement;
      expect(code.value).toBe('');
      expect(code.required).toBe(false);
    } else expect(container.querySelector('[aria-label="退货码或跟踪号"]')).toBeNull();
    await click(button(kind === 'shortage' ? '确认少货' : '确认添加多货'));
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: location, skus: expect.arrayContaining([expect.objectContaining({
        discrepancyType: kind === 'shortage' ? 'SHORTAGE' : 'SURPLUS', isReturn, returnCode: '',
      })]),
    }));
    expect(globalThis.alert).not.toHaveBeenCalled();
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
    expect(container.textContent).toContain('照片等待保存');
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

  it('allows normal-location notes without changing quantity or triggering automatic save', async () => {
    await query('113-060-1');
    await click(button('正常'));
    const notes = container.querySelector('#location-inspection-notes') as HTMLTextAreaElement;
    expect(notes).toBeTruthy();
    expect(notes.placeholder).toContain('货物损坏');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(notes, '货架损坏、无 SKU 标签');
      notes.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(api.saveLocationInspection).not.toHaveBeenCalled();
    await click(button('保存本库位核查'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      locationCode: '113-060-1',
      notes: '货架损坏、无 SKU 标签',
      skus: [expect.objectContaining({ actualQty: 10, differenceQty: 0, discrepancyType: 'NORMAL' })],
    }));
  });
  it('allows notes on a sparse empty location and saves them with empty confirmation', async () => {
    const base = await api.fetchLocationAudit('H1', '113-061-1');
    api.fetchLocationAudit.mockResolvedValueOnce({ ...base, locationCode: '113-061-1', skus: [], hasBookStock: false });
    await query('113-061-1');
    const notes = container.querySelector('#location-inspection-notes') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(notes, '货架损坏');
      notes.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click(button('确认为空库位'));
    expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
      isEmptyConfirmed: true, notes: '货架损坏', skus: [],
    }));
  });
  it('shows a captured photo locally, keeps original file untouched and saves only on explicit submission', async () => {
    await query('113-062-1');
    const createObjectURL = vi.fn(() => 'blob:original-unmodified');
    const prior = (globalThis.URL as any).createObjectURL;
    (globalThis.URL as any).createObjectURL = createObjectURL;
    try {
      const file = new window.File(['ORIGINAL JPEG DATA'], 'capture.jpg', { type: 'image/jpeg' });
      const input = container.querySelector('input[type="file"][multiple]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      let finish!: (value: unknown) => void;
      api.uploadInspectionPhoto.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
      expect(createObjectURL).toHaveBeenCalledWith(file);
      expect(container.querySelector('img[src="blob:original-unmodified"]')).toBeTruthy();
      expect(api.saveLocationInspection).not.toHaveBeenCalled();
      await act(async () => finish({ photoId: 'capture-1', objectKey: 'inspections/H1/capture.jpg', previewUrl: '/private-r2' }));
      expect(container.querySelector('img[src="blob:original-unmodified"]')).toBeTruthy();
      expect(container.textContent).toContain('核查记录正在自动保存');
      expect(api.uploadInspectionPhoto.mock.calls[0][0]).toBe(file);
      await click(button('正常'));
      await click(button('保存本库位核查'));
      expect(api.saveLocationInspection).toHaveBeenCalledWith(expect.objectContaining({
        notes: '',
        photos: [{ photoId: 'capture-1', objectKey: 'inspections/H1/capture.jpg', sku: undefined }],
      }));
    } finally {
      (globalThis.URL as any).createObjectURL = prior;
    }
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
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 950)); });
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
      photos: [{ photoId: 'unknown-photo', objectKey: 'original.jpg', sku: '无SKU未知品' }],
      skus: [expect.objectContaining({ discrepancyType: 'NO_SKU_SURPLUS' })],
    }));
  });
  it('preserves long Barcode and inventory order with Arabic labels and LTR codes', async () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
    window.localStorage.setItem('wms_pda_language', 'ar');
    try {
      const data = await api.fetchLocationAudit('H1', '130-072-1');
      const barcode = '00123456789012345678901234567890123456789012345678901234567890';
      data.skus[0].barcode = barcode;
      api.fetchLocationAudit.mockResolvedValueOnce(data);
      await query('130-072-1');
      const label = Array.from(container.querySelectorAll('span')).find(e => e.textContent?.includes(barcode))!;
      expect(label.getAttribute('dir')).toBe('ltr');
      expect(label.classList.contains('text-sm')).toBe(true);
      expect(label.classList.contains('break-all')).toBe(true);
      const quantities = container.querySelector('.grid-cols-6')!;
      expect(quantities.getAttribute('dir')).toBe('ltr');
      expect(quantities.children[1].textContent).toContain('10');
      expect(quantities.children[1].querySelector('.font-bold.text-blue-700')).not.toBeNull();
    } finally {
      window.localStorage.removeItem('wms_pda_language');
      if (storage) Object.defineProperty(globalThis,'localStorage',storage);
      else delete (globalThis as any).localStorage;
    }
  });
  it('serializes two fast edits and never labels the newer unsaved snapshot as saved', async () => {
    await query('130-071-1');
    let finish: (value: any) => void = () => {};
    api.saveLocationInspection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click(button('正常'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
    expect(api.saveLocationInspection).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')).toBeNull();
    // Edit the notes while the first D1 response is still outstanding.
    const notes = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(notes, 'newer note');
      notes.dispatchEvent(new window.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 900));
    });
    expect(api.saveLocationInspection).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ success:true, inspectionId:'saved',savedAt:'2026-10-13T12:00:00Z' }); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(notes.value).toBe('newer note');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
    expect(api.saveLocationInspection).toHaveBeenCalledTimes(2);
    expect(api.saveLocationInspection.mock.calls[1][0].notes).toBe('newer note');
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
