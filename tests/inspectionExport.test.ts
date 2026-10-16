import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildInspectionWorkbook } from '../src/services/inspectionExport';
import type { InspectionExportRow } from '../src/types';

const originalPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';
const row: InspectionExportRow = {
  inspectionId: 'insp1', hallId: 'H1', locationCode: '109-028-1', sku: 'SKU-1', barcode: '',
  systemQty: 10, actualQty: 8, differenceQty: -2, completedAt: '2026-10-11T10:00:00Z',
  versionNumber: 1, referenceImportId: 'old-locked-version', notes: '少货', photoKeys: ['a', 'b'],
};

describe('Excel inspection results', () => {
  it('embeds unchanged original photos horizontally on each SKU row in one sheet', async () => {
    const loaded: string[] = [];
    const workbook = await buildInspectionWorkbook([
      row, { ...row, sku: 'SKU-2', actualQty: 10, differenceQty: 0 },
      { ...row, inspectionId: 'empty', isEmptyConfirmed: true, locationCode: '109-029-1', sku: '空库位', systemQty: 0, actualQty: 0,
        differenceQty: 0, photoKeys: [] },
    ], async (key) => {
      loaded.push(key);
      return { base64: originalPng, extension: 'png', width: 1, height: 1 };
    });
    // Exercise the same lossless ZIP settings used by the PDA export download.
    const buffer = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE', compressionOptions: { level: 9 } } });
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);
    expect(restored.worksheets).toHaveLength(1);
    const sheet = restored.getWorksheet('库存核查记录')!;
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(2).getCell(3).value).toBe('SKU-1');
    expect(sheet.getRow(1).getCell(4).value).toBe('Barcode');
    expect(sheet.getRow(2).getCell(4).value).toBe('');
    expect(sheet.getRow(1).getCell(1).fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FF196579' } });
    expect(sheet.getRow(2).getCell(6).value).toBe(10);
    expect(sheet.getRow(2).getCell(7).value).toBe(8);
    expect(sheet.getRow(2).getCell(8).value).toBe(-2);
    expect(sheet.getRow(2).getCell(12).value).toBe('V1 (old-locked-version)');
    expect(sheet.getRow(4).getCell(3).value).toBe('空库位');
    expect(sheet.getRow(2).getCell(1).border.right).toMatchObject({ style: 'thin' });
    expect(sheet.getRow(2).getCell(16).border.right).toMatchObject({ style: 'thin' });
    expect(sheet.getRow(3).getCell(1).border.bottom).toMatchObject({ style: 'medium' });
    expect(sheet.getRow(2).getCell(9).fill).toMatchObject({ fgColor: { argb: 'FFFFF0E5' } });
    expect(sheet.getRow(4).getCell(1).fill).toMatchObject({ fgColor: { argb: 'FFEAF5F1' } });
    const images = sheet.getImages();
    expect(images).toHaveLength(4);
    expect(images[0].range.tl.nativeRow).toBe(1);
    expect(images[1].range.tl.nativeRow).toBe(1);
    expect(images[0].range.tl.nativeCol).toBe(17);
    expect(images[1].range.tl.nativeCol).toBe(18);
    expect(loaded).toEqual(['a', 'b']);
    const zip = await JSZip.loadAsync(buffer);
    const media = Object.keys(zip.files).filter((name) => name.startsWith('xl/media/') && !zip.files[name].dir);
    expect(media).toHaveLength(2);
    for (const name of media) {
      expect(await zip.file(name)!.async('base64')).toBe(originalPng);
    }
  });

  it('marks photos per row rather than per location and exports return codes as text', async () => {
    const workbook = await buildInspectionWorkbook([
      { ...row, inspectionId: 'normal-photo', differenceQty: 0, actualQty: 10, discrepancyType: 'NORMAL' },
      { ...row, inspectionId: 'mixed', differenceQty: 0, actualQty: 10, discrepancyType: 'NORMAL' },
      { ...row, inspectionId: 'mixed', discrepancyType: 'SHORTAGE', isReturn: true, returnCode: '000RET001' },
      { ...row, inspectionId: 'surplus', actualQty: 12, differenceQty: 2, discrepancyType: 'SURPLUS', isReturn: true, returnCode: '0001234567' },
    ], async () => ({ base64: originalPng, extension: 'png', width: 1, height: 1 }));
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.worksheets[0];
    expect(sheet.getRow(1).getCell(15).value).toBe('照片标记');
    expect(sheet.getRow(1).getCell(17).value).toBe('退货码或跟踪号（如有）');
    expect(sheet.getRow(2).getCell(15).value).toBe('正常·有照片');
    expect(sheet.getRow(3).getCell(15).value).toBe('正常·有照片');
    expect(sheet.getRow(4).getCell(15).value).toBe('有照片');
    expect(sheet.getRow(4).getCell(16).value).toBe('是');
    expect(sheet.getRow(4).getCell(17).value).toBe('000RET001');
    expect(sheet.getRow(5).getCell(17).value).toBe('0001234567');
    expect(sheet.getImages()).toHaveLength(8);
  });

  it('exports optional notes for fully matched and shortage locations without changing inventory values', async () => {
    const workbook = await buildInspectionWorkbook([
      { ...row, inspectionId: 'normal-notes', sku: 'SKU-N', notes: '货物损坏、无 SKU 标签',
        actualQty: 10, systemQty: 10, differenceQty: 0, discrepancyType: 'NORMAL', photoKeys: [] },
      { ...row, inspectionId: 'shortage-notes', sku: 'SKU-S', notes: '实际未收货；货架损坏',
        actualQty: 8, systemQty: 10, differenceQty: -2, discrepancyType: 'SHORTAGE', photoKeys: [] },
    ], async () => { throw new Error('No photos should be fetched'); });
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await workbook.xlsx.writeBuffer());
    const sheet = restored.worksheets[0];
    expect(sheet.getRow(1).getCell(14).value).toBe('备注');
    expect(sheet.getRow(2).getCell(14).value).toBe('货物损坏、无 SKU 标签');
    expect(sheet.getRow(2).getCell(8).value).toBe(0);
    expect(sheet.getRow(3).getCell(14).value).toBe('实际未收货；货架损坏');
    expect(sheet.getRow(3).getCell(8).value).toBe(-2);
  });

  it('does not silently omit a failed image download', async () => {
    await expect(buildInspectionWorkbook([row], async () => {
      throw new Error('Photo missing');
    })).rejects.toThrow('Photo missing');
  });
});

describe('Filtered Excel image placement', () => {
  it('places mixed-aspect photos inside their final filtered row, with two-cell anchors and no duplicate media', async () => {
    // The excluded source rows never enter workbook generation.
    const filtered=[{...row,lineId:'extra1',photoKeys:['portrait','landscape']},
      {...row,lineId:'extra2',sku:'NO-PHOTO',photoKeys:[]},
      {...row,lineId:'extra3',sku:'THIRD',photoKeys:['portrait']}];
    const workbook=await buildInspectionWorkbook(filtered,async key=>({base64:originalPng,extension:'png',
      width:key==='portrait'?80:320,height:key==='portrait'?240:80}));
    const buffer=await workbook.xlsx.writeBuffer();const restored=new ExcelJS.Workbook();await restored.xlsx.load(buffer);
    const sheet=restored.worksheets[0];const images=sheet.getImages();
    expect(images.map(image=>image.range.tl.nativeRow)).toEqual([1,1,3]);
    expect(images.map(image=>image.range.tl.nativeCol)).toEqual([17,18,17]);
    for(const image of images){
      expect(image.range.br.nativeRow).toBe(image.range.tl.nativeRow);
      expect(image.range.br.nativeCol).toBe(image.range.tl.nativeCol);
      expect(image.range.br.nativeRowOff).toBeLessThan(90*12700);
      expect(image.range.br.nativeColOff).toBeLessThan((24*7+5)*9525);
      expect(image.range.br.nativeRowOff).toBeGreaterThan(image.range.tl.nativeRowOff);
    }
    expect(sheet.getRow(3).getCell(3).value).toBe('NO-PHOTO');
    const zip=await JSZip.loadAsync(buffer);const drawing=await zip.file('xl/drawings/drawing1.xml')!.async('string');
    expect((drawing.match(/editAs="twoCell"/g)||[])).toHaveLength(3);
    expect(Object.keys(zip.files).filter(name=>name.startsWith('xl/media/')&&!zip.files[name].dir)).toHaveLength(2);
    // Excel receives move-and-size-with-cells anchors; actual filtering remains a desktop Excel acceptance step.
  });
  it('keeps location evidence separate and leaves its quantity cells blank', async () => {
    const workbook=await buildInspectionWorkbook([{...row,rowType:'location',sku:'',notes:'货架问题',photoKeys:[]}],async()=>{throw new Error('unused');});
    expect(workbook.worksheets[0].getCell('I2').value).toBe('库位存证');
    for(const col of ['F','G','H']) expect(workbook.worksheets[0].getCell(`${col}2`).value).toBe('');
  });
});

describe('Static spreadsheet translations without changing source data', () => {
  it.each([
    ['zh','库存核查记录','库厅','少货','是','待复核'],
    ['en','Inventory Audit','Hall','Shortage','Yes','Pending review'],
    ['de','Bestandsprüfung','Halle','Fehlbestand','Ja','Nachprüfung ausstehend'],
  ] as const)('uses %s labels while preserving raw names, manual notes, codes and photo bytes', async(language,sheetName,header,discrepancy,yes,status)=>{
    const book=await buildInspectionWorkbook([{...row,sku:'000SKU',barcode:'0000123',nameZh:'原始中文商品名称',
      notes:'人工备注：包装破损',discrepancyType:'SHORTAGE',status:'PENDING_REVIEW',isReturn:true,returnCode:'000RET',photoKeys:['a']}],
      async()=>({base64:originalPng,extension:'png',width:1,height:1}),language);
    const data=await book.xlsx.writeBuffer(); const restored=new ExcelJS.Workbook();await restored.xlsx.load(data);
    const sheet=restored.getWorksheet(sheetName)!;
    expect(sheet.getCell('A1').value).toBe(header);expect(sheet.getCell('I2').value).toBe(discrepancy);
    expect(sheet.getCell('P2').value).toBe(yes);expect(sheet.getCell('J2').value).toBe(status);
    expect(sheet.getCell('C2').value).toBe('000SKU');expect(sheet.getCell('D2').value).toBe('0000123');expect(sheet.getCell('Q2').value).toBe('000RET');
    expect(sheet.getCell('E2').value).toBe('原始中文商品名称');expect(sheet.getCell('N2').value).toBe('人工备注：包装破损');
    expect(sheet.getCell('F2').value).toBe(10);expect(sheet.getCell('G2').value).toBe(8);expect(sheet.getCell('H2').value).toBe(-2);
    expect(sheet.getImages()[0].range.tl.nativeRow).toBe(1);
    const zip=await JSZip.loadAsync(data);expect(await zip.file('xl/media/image1.png')!.async('base64')).toBe(originalPng);
  });
  it('translates only exact generated note templates and leaves product names and arbitrary notes intact', async()=>{
    const {exportNote}=await import('../src/services/exportLanguage');
    expect(exportNote('现场少货 2 件','en')).toBe('On-site shortage 2 units');
    expect(exportNote('现场多货 3 件 (NO_SKU)','de')).toBe('Mehrbestand vor Ort 3 Stück (NO_SKU)');
    expect(exportNote('现场少货 2 件；请复核包装','de')).toBe('现场少货 2 件；请复核包装');
    expect(exportNote('商品有损坏','en')).toBe('商品有损坏');
  });
});
