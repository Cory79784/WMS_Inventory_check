import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildInspectionWorkbook } from '../src/services/inspectionExport';
import type { InspectionExportRow } from '../src/types';

const originalPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const row: InspectionExportRow = {
  inspectionId: 'insp1', hallId: 'H1', locationCode: '109-028-1', sku: 'SKU-1',
  systemQty: 10, actualQty: 8, differenceQty: -2, completedAt: '2026-10-11T10:00:00Z',
  versionNumber: 1, referenceImportId: 'old-locked-version', notes: '少货', photoKeys: ['a', 'b'],
};

describe('Excel inspection results', () => {
  it('embeds unchanged original photos horizontally on each SKU row in one sheet', async () => {
    const loaded: string[] = [];
    const workbook = await buildInspectionWorkbook([
      row, { ...row, sku: 'SKU-2', actualQty: 10, differenceQty: 0 },
      { ...row, locationCode: '109-029-1', sku: '空库位', systemQty: 0, actualQty: 0,
        differenceQty: 0, photoKeys: [] },
    ], async (key) => {
      loaded.push(key);
      return { base64: originalPng, extension: 'png', width: 1, height: 1 };
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);
    expect(restored.worksheets).toHaveLength(1);
    const sheet = restored.getWorksheet('库存核查记录')!;
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(2).getCell(3).value).toBe('SKU-1');
    expect(sheet.getRow(2).getCell(4).value).toBe(10);
    expect(sheet.getRow(2).getCell(5).value).toBe(8);
    expect(sheet.getRow(2).getCell(6).value).toBe(-2);
    expect(sheet.getRow(2).getCell(8).value).toBe('V1 (old-locked-version)');
    expect(sheet.getRow(4).getCell(3).value).toBe('空库位');
    const images = sheet.getImages();
    expect(images).toHaveLength(4);
    expect(images[0].range.tl.nativeRow).toBe(1);
    expect(images[1].range.tl.nativeRow).toBe(1);
    expect(images[0].range.tl.nativeCol).toBe(9);
    expect(images[1].range.tl.nativeCol).toBe(10);
    expect(loaded).toEqual(['a', 'b']);
    const zip = await JSZip.loadAsync(buffer);
    const media = Object.keys(zip.files).filter((name) => name.startsWith('xl/media/') && !zip.files[name].dir);
    expect(media).toHaveLength(2);
    for (const name of media) {
      expect(await zip.file(name)!.async('base64')).toBe(originalPng);
    }
  });

  it('does not silently omit a failed image download', async () => {
    await expect(buildInspectionWorkbook([row], async () => {
      throw new Error('Photo missing');
    })).rejects.toThrow('Photo missing');
  });
});
