import ExcelJS from 'exceljs';
import type { SnapshotComparison } from '../types';
import type { ExportLanguage } from './exportLanguage';
const labels = {
    zh: { title: 'WMS快照变动', headers: ['库厅', '旧版本', '新版本', '库位', 'SKU', '条码', '商品名称（原文）', '旧版账面数量', '新版账面数量', '数量变化（新减旧）', 'SKU变动类型', '库位变动类型'],
        ADDED: '新增库存', REMOVED: '移除库存', QUANTITY_CHANGED: '数量变化', NEW_LOCATION: '新增有货库位', EMPTIED_LOCATION: '库位清空', CHANGED: '库存变化' },
    en: { title: 'WMS snapshot changes', headers: ['Hall', 'Old version', 'New version', 'Location', 'SKU', 'Barcode', 'Product name (original)', 'Old WMS quantity', 'New WMS quantity', 'Quantity change (new minus old)', 'SKU change type', 'Location change type'],
        ADDED: 'Stock added', REMOVED: 'Stock removed', QUANTITY_CHANGED: 'Quantity changed', NEW_LOCATION: 'New stocked location', EMPTIED_LOCATION: 'Location emptied', CHANGED: 'Stock changed' },
    de: { title: 'WMS Bestandsänderungen', headers: ['Halle', 'Alte Version', 'Neue Version', 'Lagerplatz', 'SKU', 'Barcode', 'Artikelname (Original)', 'Alter WMS-Bestand', 'Neuer WMS-Bestand', 'Bestandsänderung (neu minus alt)', 'SKU-Änderungsart', 'Lagerplatz-Änderungsart'],
        ADDED: 'Bestand hinzugefügt', REMOVED: 'Bestand entfernt', QUANTITY_CHANGED: 'Menge geändert', NEW_LOCATION: 'Neu belegter Lagerplatz', EMPTIED_LOCATION: 'Lagerplatz geleert', CHANGED: 'Bestand geändert' },
};
export function buildSnapshotComparisonWorkbook(data: SnapshotComparison, language: ExportLanguage = 'zh'): ExcelJS.Workbook {
    const text = labels[language], workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(text.title, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(text.headers);
    sheet.columns = [12, 14, 14, 19, 25, 25, 40, 20, 20, 27, 25, 30].map(width => ({ width }));
    for (const location of data.locations)
        for (const change of location.changes) {
            sheet.addRow([data.hallId, `V${data.oldVersion.versionNumber}`, `V${data.newVersion.versionNumber}`, location.locationCode,
                change.sku, change.barcode, change.nameZh, change.oldQty, change.newQty, change.differenceQty, text[change.changeType], text[location.changeType]]);
        }
    sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
    sheet.getRow(1).height = 34;
    sheet.autoFilter = { from: 'A1', to: `L${sheet.rowCount}` };
    sheet.getColumn(10).numFmt = '+0.########;-0.########;0';
    // Metadata is separate from the tabular data; names and identifiers are never translated.
    const info = workbook.addWorksheet('Snapshot metadata');
    info.columns = [{ width: 26 }, { width: 75 }];
    info.addRows([['Comparison', 'WMS book stock only; not physical inspection discrepancies'], ['Hall', data.hallId],
        ['Old import ID', data.oldVersion.importId], ['New import ID', data.newVersion.importId],
        ['Old filename', data.oldVersion.originalFilename], ['New filename', data.newVersion.originalFilename],
        ['Old imported at', data.oldVersion.importedAt], ['New imported at', data.newVersion.importedAt],
        ['Old source exported at', data.oldVersion.sourceExportedAt || ''], ['New source exported at', data.newVersion.sourceExportedAt || '']]);
    return workbook;
}
export async function downloadSnapshotComparison(data: SnapshotComparison, language: ExportLanguage = 'zh'): Promise<void> {
    const workbook = buildSnapshotComparisonWorkbook(data, language);
    const buffer = await workbook.xlsx.writeBuffer({ zip: { compression: 'DEFLATE' } });
    const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.hallId}-WMS-V${data.oldVersion.versionNumber}-V${data.newVersion.versionNumber}-${language}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
