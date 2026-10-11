import { Env } from '../types';
import type { InspectionExportRow } from '../../src/types';

export async function exportInspectionResults(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const hallId = url.searchParams.get('hallId');
  const mode = url.searchParams.get('mode');
  if (!hallId || !['H1', 'H2', 'H3'].includes(hallId) || !['all', 'differences'].includes(mode || '')) {
    return Response.json({ error: 'Valid hallId and export mode required' }, { status: 400 });
  }
  try {
    // Read saved actual counts and the saved reference version, never current WMS stock.
    const result = await env.DB.prepare(`
      SELECT l.inspection_id as inspectionId, l.hall_id as hallId,
        l.location_code as locationCode, COALESCE(s.sku, '空库位') as sku,
        COALESCE(s.system_qty, 0) as systemQty, COALESCE(s.actual_qty, 0) as actualQty,
        COALESCE(s.difference_qty, 0) as differenceQty, l.completed_at as completedAt,
        i.version_number as versionNumber, l.reference_import_id as referenceImportId,
        l.notes as locationNotes, s.notes as skuNotes
      FROM location_inspections l
      JOIN inventory_imports i ON i.import_id = l.reference_import_id
      LEFT JOIN sku_inspections s ON s.inspection_id = l.inspection_id
      WHERE l.hall_id = ? AND l.status IN ('VERIFIED', 'PENDING_REVIEW', 'CLOSED')
        AND l.completed_at IS NOT NULL AND (s.id IS NOT NULL OR l.is_empty_confirmed = 1)
        ${mode === 'differences' ? "AND (s.difference_qty != 0 OR s.discrepancy_type != 'NORMAL')" : ''}
      ORDER BY l.location_code, l.completed_at, s.id
    `).bind(hallId).all<Omit<InspectionExportRow, 'notes' | 'photoKeys'> & {
      locationNotes: string | null; skuNotes: string | null;
    }>();
    const photos = await env.DB.prepare(`
      SELECT p.inspection_id, p.object_key FROM inspection_photos p
      JOIN location_inspections l ON l.inspection_id = p.inspection_id
      WHERE l.hall_id = ? AND l.status IN ('VERIFIED', 'PENDING_REVIEW', 'CLOSED')
        AND l.completed_at IS NOT NULL ORDER BY p.captured_at, p.photo_id
    `).bind(hallId).all<{ inspection_id: string; object_key: string }>();
    const photoKeys = new Map<string, string[]>();
    for (const photo of photos.results) {
      const keys = photoKeys.get(photo.inspection_id) || [];
      keys.push(photo.object_key);
      photoKeys.set(photo.inspection_id, keys);
    }
    const rows: InspectionExportRow[] = result.results.map(({ locationNotes, skuNotes, ...row }) => ({
      ...row,
      notes: [locationNotes, skuNotes].filter(Boolean).join('；'),
      photoKeys: photoKeys.get(row.inspectionId) || [],
    }));
    return Response.json({ success: true, rows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
