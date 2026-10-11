import ExcelJS from 'exceljs';
import type { HallId, InspectionExportRow } from '../types';

interface ExportPhoto {
  base64: string;
  extension: 'jpeg' | 'png' | 'gif';
  width: number;
  height: number;
}

export async function buildInspectionWorkbook(
  rows: InspectionExportRow[], loadPhoto: (key: string) => Promise<ExportPhoto>
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('库存核查记录');
  const photoCount = Math.max(0, ...rows.map((row) => row.photoKeys.length));
  sheet.columns = [
    { header: '库厅', key: 'hallId', width: 8 },
    { header: '库位', key: 'locationCode', width: 16 },
    { header: 'SKU', key: 'sku', width: 24 },
    { header: 'Barcode', key: 'barcode', width: 24 },
    { header: '账面数量', key: 'systemQty', width: 12 },
    { header: '实盘数量', key: 'actualQty', width: 12 },
    { header: '差异', key: 'differenceQty', width: 12 },
    { header: '核查时间', key: 'completedAt', width: 26 },
    { header: 'WMS 版本', key: 'version', width: 28 },
    { header: '备注', key: 'notes', width: 36 },
    ...Array.from({ length: photoCount }, (_, index) => ({ header: `照片 ${index + 1}`, width: 24 })),
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 + photoCount } };
  sheet.getRow(1).height = 24;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  const images = new Map<string, Promise<{ id: number; width: number; height: number }>>();
  for (const result of rows) {
    const row = sheet.addRow({ ...result, version: `V${result.versionNumber} (${result.referenceImportId})` });
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = result.photoKeys.length ? 90 : 30;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      if (row.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    if (result.differenceQty !== 0) row.getCell('differenceQty').font = { bold: true, color: { argb: 'FFDC2626' } };
    for (let index = 0; index < result.photoKeys.length; index++) {
      const key = result.photoKeys[index];
      if (!images.has(key)) {
        images.set(key, loadPhoto(key).then((photo) => ({
          id: workbook.addImage({ base64: photo.base64, extension: photo.extension }),
          width: photo.width, height: photo.height,
        })));
      }
      const image = await images.get(key)!;
      const scale = Math.min(160 / image.width, 110 / image.height);
      // Only the display dimensions change; the original image bytes are embedded unchanged.
      sheet.addImage(image.id, {
        tl: { col: 10 + index + 0.05, row: row.number - 1 + 0.05 },
        ext: { width: image.width * scale, height: image.height * scale },
        editAs: 'oneCell',
      });
    }
  }
  return workbook;
}

async function loadOriginalPhoto(key: string): Promise<ExportPhoto> {
  const response = await fetch(`/api/inventory/inspection/photo?key=${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error(`照片下载失败 (${response.status})，未生成不完整的导出文件`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png'
    : bytes[0] === 0x47 && bytes[1] === 0x49 ? 'gif' : null;
  if (!extension) throw new Error('Excel 图片嵌入仅支持 JPEG/PNG/GIF；原图未转换，请使用受支持的照片格式');
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
  return { base64, extension, width: image.naturalWidth, height: image.naturalHeight };
}

export async function downloadInspectionResults(hallId: HallId, mode: 'all' | 'differences'): Promise<void> {
  const response = await fetch(`/api/inventory/inspection/export?hallId=${hallId}&mode=${mode}`);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '导出失败');
  const workbook = await buildInspectionWorkbook(result.rows, loadOriginalPhoto);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${hallId}-${mode === 'differences' ? '仅差异' : '全部核查结果'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
