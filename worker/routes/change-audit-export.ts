import type { Env } from '../types';
import type { AuditPlan, AuditResult } from '../../src/changeAudit/model';
import type { InspectionExportRow } from '../../src/types';
export async function exportChangeAudit(request: Request, env: Env, task: {
    id: string;
    hall_id: string;
    created_at: string;
}, plan: AuditPlan): Promise<Response> {
    const mode = new URL(request.url).searchParams.get('mode');
    if (mode !== 'all' && mode !== 'differences')
        return Response.json({ error: 'INVALID_MODE' }, { status: 400 });
    const saved = await env.DB.prepare('SELECT location_code,result_json,saved_at FROM change_audit_results WHERE task_id=?').bind(task.id).all<{
        location_code: string;
        result_json: string;
        saved_at: string;
    }>();
    const photos = await env.DB.prepare('SELECT id,location_code,line_id FROM change_audit_photos WHERE task_id=? ORDER BY id').bind(task.id).all<{
        id: string;
        location_code: string;
        line_id: string;
    }>();
    const results = new Map(saved.results.map(r => [r.location_code, { result: JSON.parse(r.result_json) as AuditResult, savedAt: r.saved_at }]));
    const rows: InspectionExportRow[] = [];
    let completedCount = 0;
    for (const target of plan.targets) {
        const record = results.get(target.location);
        if (!record?.result.completed)
            continue;
        const result = record.result;
        if (result.lines.some(line => line.actual === null))
            continue;
        completedCount++;
        const common = { inspectionId: `${task.id}:${target.location}`, hallId: task.hall_id, locationCode: target.location,
            completedAt: record.savedAt, versionNumber: plan.comparison.newVersion.versionNumber, referenceImportId: plan.comparison.newVersion.importId,
            importedAt: plan.comparison.newVersion.importedAt, status: 'VERIFIED', isEmptyConfirmed: result.emptyConfirmed };
        const known = new Set(result.lines.map(l => l.id)), linked = new Map<string, string[]>(), locationPhotos: string[] = [];
        for (const photo of photos.results.filter(p => p.location_code === target.location && !result.ignoredPhotoIds?.includes(p.id))) {
            const lineId = result.photoLines?.[photo.id] ?? photo.line_id;
            if (lineId && known.has(lineId)) {
                if (!linked.has(lineId))
                    linked.set(lineId, []);
                linked.get(lineId)!.push(photo.id);
            }
            else
                locationPhotos.push(photo.id);
        }
        for (const line of result.lines) {
            const book = target.skus.find(s => `book:${s.sku}` === line.id), extra = line.id.startsWith('extra:');
            const systemQty = book?.qty || 0, actualQty = line.actual!, differenceQty = actualQty - systemQty;
            const discrepancyType = extra && !line.sku && !line.barcode ? 'NO_SKU_SURPLUS' : differenceQty < 0 ? 'SHORTAGE' : differenceQty > 0 ? 'SURPLUS' : 'NORMAL';
            const notes = differenceQty === 0 && line.notes.trim() === '盘点正常相符' ? '' : line.notes;
            const photoKeys = linked.get(line.id) || [];
            if (mode === 'differences' && !extra && differenceQty === 0 && !notes.trim() && !line.isReturn && !line.returnCode?.trim() && !photoKeys.length)
                continue;
            rows.push({ ...common, rowType: 'sku', lineId: line.id, sku: line.sku || (line.barcode ? '' : '无sku'), barcode: line.barcode,
                nameZh: book?.name || '', systemQty, actualQty, differenceQty, discrepancyType, notes, photoKeys, isReturn: Boolean(line.isReturn), returnCode: line.isReturn ? line.returnCode || '' : '' });
        }
        if (result.notes.trim() || locationPhotos.length || mode === 'all' && result.emptyConfirmed)
            rows.push({ ...common, rowType: 'location', sku: '', barcode: '', nameZh: '', systemQty: 0, actualQty: 0, differenceQty: 0, notes: result.notes, photoKeys: locationPhotos });
    }
    return Response.json({ success: true, task: { id: task.id, hall: task.hall_id, createdAt: task.created_at, oldVersion: plan.comparison.oldVersion, newVersion: plan.comparison.newVersion }, mode, completedCount, unfinishedCount: plan.targets.length - completedCount, rows }, { headers: { 'Cache-Control': 'no-store' } });
}
