import type { LocationSkuItem } from '../types';
import type { AuditResult, Target } from './model';
export function taskSkuItems(target: Target, result: AuditResult): LocationSkuItem[] {
    return result.lines.map(line => {
        const book = target.skus.find(s => `book:${s.sku}` === line.id), qty = book?.qty || 0, diff = line.actual === null ? null : line.actual - qty;
        return { lineId: line.id, sku: line.sku || (line.barcode ? `条码:${line.barcode}` : '无SKU未知品'), barcode: line.barcode, eBarcode: book?.eBarcode || '', customerCode: book?.customer || '', nameZh: book?.name || '', nameEn: '',
            systemQty: qty, availableQty: book?.availableQty || 0, allocatedQty: book?.allocatedQty || 0, frozenQty: book?.frozenQty || 0,
            actualQty: line.actual, differenceQty: diff, discrepancyType: diff === null ? null : diff < 0 ? 'SHORTAGE' : diff > 0 ? (!line.sku && !line.barcode ? 'NO_SKU_SURPLUS' : 'SURPLUS') : 'NORMAL', notes: line.notes, isReturn: line.isReturn, returnCode: line.returnCode };
    });
}
export function canComplete(target: Target, result: AuditResult): boolean {
    return result.lines.every(l => l.actual !== null && (l.id.startsWith('book:') || !!(l.sku || l.barcode || l.notes)))
        && (target.category !== 'EMPTIED_LOCATION' || result.emptyConfirmed || result.lines.some(l => (l.actual || 0) > 0));
}
