import { Env } from '../types';
import type { InspectionExportRow } from '../../src/types';
import { decodeInspectionNotes } from '../../src/utils/inspectionNotes';
import { inspectionLineId } from '../inspectionLineIds';

export async function exportInspectionResults(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const hallId = url.searchParams.get('hallId');
  const mode = url.searchParams.get('mode');
  const scope = url.searchParams.get('scope') || 'history'; // preserve existing historical export scope
  if (!hallId || !['H1', 'H2', 'H3'].includes(hallId) || !['all', 'differences'].includes(mode || '')
    || !['history', 'latest'].includes(scope)) {
    return Response.json({ error: 'Valid hallId, export mode and version scope required' }, { status: 400 });
  }
  try {
    const versionFilter = scope === 'latest'
      ? 'AND l.reference_import_id = (SELECT active_import_id FROM active_hall_imports WHERE hall_id=l.hall_id)' : '';
    const result = await env.DB.prepare(`
      SELECT l.inspection_id as inspectionId, l.hall_id as hallId, l.location_code as locationCode,
        s.id as skuRecordId, COALESCE(s.sku, '') as sku,
        COALESCE(NULLIF(s.barcode, ''), s.e_barcode, '') as barcode,
        COALESCE(s.system_qty, 0) as systemQty, COALESCE(s.actual_qty, 0) as actualQty,
        COALESCE(s.difference_qty, 0) as differenceQty, l.completed_at as completedAt,
        i.version_number as versionNumber, l.reference_import_id as referenceImportId,
        l.notes as locationNotes, s.notes as skuNotes,
        COALESCE((SELECT MAX(b.name_zh) FROM inventory_stock_rows b
          WHERE b.import_id = l.reference_import_id AND b.hall_id = l.hall_id
          AND UPPER(b.location_code)=UPPER(l.location_code) AND b.sku=s.sku), '') as nameZh,
        s.discrepancy_type as discrepancyType, l.status as status,
        l.is_empty_confirmed as isEmptyConfirmed, i.imported_at as importedAt
      FROM location_inspections l JOIN inventory_imports i ON i.import_id=l.reference_import_id
      LEFT JOIN sku_inspections s ON s.inspection_id=l.inspection_id
      WHERE l.hall_id=? AND l.status IN ('VERIFIED','PENDING_REVIEW','CLOSED')
        AND l.completed_at IS NOT NULL ${versionFilter}
      ORDER BY l.location_code, l.completed_at, s.id
    `).bind(hallId).all<InspectionExportRow & { skuRecordId: string | null; locationNotes: string | null; skuNotes: string | null }>();
    const photos = await env.DB.prepare(`
      SELECT p.inspection_id, p.object_key, pl.line_key, si.id as linked_record_id
      FROM inspection_photos p JOIN location_inspections l ON l.inspection_id=p.inspection_id
      LEFT JOIN inspection_photo_lines pl ON pl.photo_id=p.photo_id
      LEFT JOIN sku_inspections si ON si.id=p.sku_inspection_id AND si.inspection_id=p.inspection_id
      WHERE l.hall_id=? AND l.status IN ('VERIFIED','PENDING_REVIEW','CLOSED')
        AND l.completed_at IS NOT NULL ${versionFilter} ORDER BY p.captured_at, p.photo_id
    `).bind(hallId).all<{ inspection_id: string; object_key: string; line_key: string | null; linked_record_id: string | null }>();

    const groups = new Map<string, typeof result.results>();
    for (const row of result.results) groups.set(row.inspectionId, [...(groups.get(row.inspectionId) || []), row]);
    const photoGroups = new Map<string, typeof photos.results>();
    for (const photo of photos.results) photoGroups.set(photo.inspection_id, [...(photoGroups.get(photo.inspection_id) || []), photo]);
    const rows: InspectionExportRow[] = [];
    for (const [inspectionId, records] of groups) {
      const knownLines = new Set(records.filter(row => row.skuRecordId).map(row => inspectionLineId(inspectionId, row.skuRecordId!)));
      const linePhotos = new Map<string, string[]>();
      const locationPhotos: string[] = [];
      for (const photo of photoGroups.get(inspectionId) || []) {
        const line = photo.line_key || (photo.linked_record_id ? inspectionLineId(inspectionId, photo.linked_record_id) : null);
        // An unresolved historical/pending link is evidence, but never guessed onto another SKU.
        const keys = line && knownLines.has(line) ? linePhotos.get(line) || [] : locationPhotos;
        if (!keys.includes(photo.object_key)) keys.push(photo.object_key);
        if (line && knownLines.has(line)) linePhotos.set(line, keys);
      }
      for (const record of records) {
        if (!record.skuRecordId) continue;
        const { skuRecordId, locationNotes: _locationNotes, skuNotes, ...row } = record;
        const metadata = decodeInspectionNotes(skuNotes);
        const lineId = inspectionLineId(inspectionId, skuRecordId);
        const notes = row.differenceQty === 0 && row.discrepancyType === 'NORMAL' && metadata.notes.trim() === '盘点正常相符'
          ? '' : metadata.notes;
        const photoKeys = linePhotos.get(lineId) || [];
        const abnormal = Number(row.differenceQty) !== 0 || Number(row.actualQty) !== Number(row.systemQty)
          || Boolean(row.discrepancyType && row.discrepancyType !== 'NORMAL');
        if (mode === 'differences' && !abnormal && !notes.trim() && !metadata.isReturn && !metadata.returnCode.trim() && !photoKeys.length) continue;
        rows.push({ ...row, ...metadata, rowType: 'sku', lineId, notes, photoKeys,
          sku: row.sku === '空库位' || row.sku === '无SKU未知品' || row.sku.startsWith('条码:')
            ? (row.barcode ? '' : '无sku') : row.sku || (row.barcode ? '' : '无sku') });
      }
      const first = records[0];
      // Location-level evidence appears once, instead of making every normal SKU a difference.
      if (first.locationNotes?.trim() || locationPhotos.length || (mode === 'all' && !first.skuRecordId)) {
        rows.push({ inspectionId, hallId: first.hallId, locationCode: first.locationCode,
          rowType: 'location', sku: '', barcode: '', nameZh: '', systemQty: 0, actualQty: 0, differenceQty: 0,
          notes: first.locationNotes || '', photoKeys: locationPhotos,
          completedAt: first.completedAt, versionNumber: first.versionNumber, referenceImportId: first.referenceImportId,
          status: first.status, isEmptyConfirmed: first.isEmptyConfirmed, importedAt: first.importedAt });
      }
    }
    return Response.json({ success: true, scope, rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
