import ExcelJS from 'exceljs';
import type { ExportScope, HallId, InspectionExportRow } from '../types';
import { exportText, exportNote, type ExportLanguage } from './exportLanguage';

export interface ExportPhoto {
  base64: string;
  extension: 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
}

export async function buildInspectionWorkbook(
  rows: InspectionExportRow[], loadPhoto: (key: string) => Promise<ExportPhoto>, language: ExportLanguage = 'zh'
): Promise<ExcelJS.Workbook> {
  const text = exportText[language];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(text.sheet);
  const photoCount = Math.max(0, ...rows.map((row) => row.photoKeys.length));
  sheet.columns = [
    { header: text.headers[0], key: 'hallId', width: 8 },
    { header: text.headers[1], key: 'locationCode', width: 16 },
    { header: text.headers[2], key: 'sku', width: 24 },
    { header: text.headers[3], key: 'barcode', width: 24 },
    { header: text.headers[4], key: 'nameZh', width: 26 },
    { header: text.headers[5], key: 'systemQty', width: 12 },
    { header: text.headers[6], key: 'actualQty', width: 12 },
    { header: text.headers[7], key: 'differenceQty', width: 12 },
    { header: text.headers[8], key: 'discrepancyLabel', width: 16 },
    { header: text.headers[9], key: 'statusLabel', width: 12 },
    { header: text.headers[10], key: 'completedAt', width: 26 },
    { header: text.headers[11], key: 'version', width: 28 },
    { header: text.headers[12], key: 'importedAt', width: 26 },
    { header: text.headers[13], key: 'notes', width: 36 },
    { header: text.headers[14], key: 'photoLabel', width: 20 },
    { header: text.headers[15], key: 'returnLabel', width: 12 },
    { header: text.headers[16], key: 'returnCode', width: 28 },
    ...Array.from({ length: photoCount }, (_, index) => ({ header: `${text.photo} ${index + 1}`, width: 24 })),
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 17 + photoCount } };
  sheet.getRow(1).height = 32;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF196579' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF57B9D8' } } };
  });
  const images = new Map<string, Promise<{ id: number; width: number; height: number }>>();
  const discrepancyLabels: Record<string, string> = text.discrepancy;
  const statusLabels: Record<string, string> = text.status;
  for (const [resultIndex, result] of rows.entries()) {
    const row = sheet.addRow({ ...result,
      sku: result.sku === '无sku' ? text.noSku : result.sku,
      notes: exportNote(result.notes, language),
      ...(result.rowType === 'location' ? { systemQty: '', actualQty: '', differenceQty: '' } : {}),
      version: `V${result.versionNumber} (${result.referenceImportId})`,
      discrepancyLabel: result.rowType === 'location' ? (result.isEmptyConfirmed ? text.empty : text.location) : result.isEmptyConfirmed ? text.empty
        : discrepancyLabels[result.discrepancyType || ''] || (result.differenceQty < 0 ? text.discrepancy.SHORTAGE : result.differenceQty > 0 ? text.discrepancy.SURPLUS : text.discrepancy.NORMAL),
      statusLabel: statusLabels[result.status || 'VERIFIED'] || result.status,
      photoLabel: result.photoKeys.length ? (result.rowType === 'location' ? text.location
        : result.differenceQty === 0 && (!result.discrepancyType || result.discrepancyType === 'NORMAL') && !result.isReturn
          ? text.normalPhoto : text.attached) : '',
      returnLabel: result.isReturn ? text.yes : '',
      returnCode: result.isReturn ? result.returnCode || '' : '',
    });
    row.font = { name: 'Calibri', size: 11, color: { argb: 'FF173644' } };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = result.photoKeys.length ? 90 : 32;
    const next = rows[resultIndex + 1];
    const groupEnd = !next || next.inspectionId !== result.inspectionId;
    const abnormal = result.differenceQty !== 0 || (result.discrepancyType && result.discrepancyType !== 'NORMAL');
    for (let column = 1; column <= 17 + photoCount; column++) {
      const cell = row.getCell(column);
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF9FCBDC' } },
        left: { style: 'thin', color: { argb: 'FF9FCBDC' } },
        right: { style: 'thin', color: { argb: 'FF9FCBDC' } },
        bottom: { style: groupEnd ? 'medium' : 'thin', color: { argb: 'FF57B9D8' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb:
        result.isEmptyConfirmed ? 'FFEAF5F1' : row.number % 2 === 0 ? 'FFC3E7F2' : 'FFF3F8FA',
      } };
      if (abnormal && (column === 9 || column === 10)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0E5' } };
      }
      if (column === 15 && cell.value) {
        cell.font = { bold: true, color: { argb: 'FF196579' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F6F1' } };
      }
      if (column >= 6 && column <= 8) cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
    if (result.differenceQty !== 0) row.getCell('differenceQty').font = {
      bold: true, color: { argb: result.differenceQty < 0 ? 'FFDC2626' : 'FFC26B00' },
    };
    for (let index = 0; index < result.photoKeys.length; index++) {
      const key = result.photoKeys[index];
      if (!images.has(key)) {
        images.set(key, loadPhoto(key).then((photo) => ({
          id: workbook.addImage({ base64: photo.base64, extension: photo.extension }),
          width: photo.width, height: photo.height,
        })));
      }
      const image = await images.get(key)!;
      if (!(image.width > 0 && image.height > 0)) throw new Error('Invalid photo dimensions');
      const scale = Math.min(160 / image.width, 110 / image.height);
      // Both corners stay within the same final output row. Excel can move/resize
      // images with filtered cells; source indexes from before filtering are never used.
      const photoColumn = 17 + index;
      const photoRow = row.number - 1;
      const anchor = (x: number, y: number) => ({
        nativeCol: photoColumn, nativeRow: photoRow,
        nativeColOff: Math.round(x * 9525), nativeRowOff: Math.round(y * 9525),
      } as ExcelJS.Anchor);
      sheet.addImage(image.id, {
        tl: anchor(5, 5), br: anchor(5 + image.width * scale, 5 + image.height * scale), editAs: 'twoCell',
      });
    }
  }
  return workbook;
}

async function loadOriginalPhoto(key: string): Promise<ExportPhoto> {
  return loadExportPhoto(`/api/inventory/inspection/photo?key=${encodeURIComponent(key)}`);
}

export async function loadExportPhoto(url: string, allowWebp = false): Promise<ExportPhoto> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`照片下载失败 (${response.status})，未生成不完整的导出文件`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png'
    : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'gif' : null;
  const webp=bytes[0]===0x52&&bytes[1]===0x49&&bytes[8]===0x57&&bytes[9]===0x45;
  if (!extension && !(allowWebp&&webp)) throw new Error('Excel 图片嵌入仅支持 JPEG/PNG/GIF；原图未转换，请使用受支持的照片格式');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('照片读取失败'));
    reader.readAsDataURL(blob);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('照片格式无法读取'));
    img.src = base64;
  });
  if (!extension) {
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');if(!context) throw new Error('PHOTO_CONVERSION_FAILED');context.drawImage(image,0,0);
    return {base64:canvas.toDataURL('image/png'),extension:'png',width:image.naturalWidth,height:image.naturalHeight};
  }
  return { base64, extension, width: image.naturalWidth, height: image.naturalHeight };
}

export async function downloadInspectionResults(hallId: HallId, mode: 'all' | 'differences', scope: ExportScope = 'history', language: ExportLanguage = 'zh'): Promise<void> {
  const response = await fetch(`/api/inventory/inspection/export?hallId=${hallId}&mode=${mode}&scope=${scope}`);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '导出失败');
  const workbook = await buildInspectionWorkbook(result.rows, loadOriginalPhoto, language);
  // ZIP compression is lossless: image byte streams and Excel layout remain unchanged.
  const buffer = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE', compressionOptions: { level: 9 } } });
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const text = exportText[language];
  const link = document.createElement('a');
  link.href = url;
  link.download = `${hallId}-${mode === 'differences' ? text.differences : text.all}-${text.scope[scope]}-${language}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
