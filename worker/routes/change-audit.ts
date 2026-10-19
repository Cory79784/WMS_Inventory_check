import { isAuditManager, managerSession } from '../changeAuditAccess';
import { exportChangeAudit } from './change-audit-export';
import type { Env } from '../types';
import { handleSnapshotComparison } from './snapshot-compare';
import { buildPlan, validateConfig, isAnomaly } from '../../src/changeAudit/model';
import type { AuditPlan, AuditResult, BookSku } from '../../src/changeAudit/model';
import type { SnapshotComparison } from '../../src/types';
interface TaskRow {
    id: string;
    hall_id: string;
    old_import_id: string;
    new_import_id: string;
    plan_json: string;
    created_at: string;
}
class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function need(valid: unknown, code = 'INVALID_INPUT'): asserts valid {
    if (!valid)
        throw new ApiError(400, code);
}
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
async function body(request: Request): Promise<any> {
    const raw = await request.text();
    if (raw.length > 200000)
        throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    try {
        const parsed = JSON.parse(raw);
        need(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
        return parsed;
    }
    catch {
        throw new ApiError(400, 'INVALID_INPUT');
    }
}
async function active(env: Env, hall: string): Promise<string | null> {
    return (await env.DB.prepare('SELECT active_import_id FROM active_hall_imports WHERE hall_id=?').bind(hall).first<{
        active_import_id: string | null;
    }>())?.active_import_id || null;
}
async function taskRow(env: Env, id: string, hall: string, metadataOnly=false): Promise<TaskRow> {
    const row = await env.DB.prepare(`SELECT ${metadataOnly ? 'id,hall_id,old_import_id,new_import_id,created_at' : '*'} FROM change_audit_tasks WHERE id=? AND hall_id=?`).bind(id, hall).first<TaskRow>();
    if (!row)
        throw new ApiError(404, 'TASK_NOT_FOUND');
    return row;
}
export async function handleChangeAudit(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), action = url.pathname.split('/').pop(), hall = url.searchParams.get('hallId');
    try {
        if(action === 'manager') return managerSession(request, env);
        const manager = await isAuditManager(request, env);
        const requireManager = () => { if(!manager) throw new ApiError(403, 'MANAGEMENT_REQUIRED'); };
        need(hall && ['H1', 'H2', 'H3'].includes(hall));
        if (action === 'tasks') {
            if (request.method === 'GET') {
                const tasks = await env.DB.prepare(`SELECT t.id,old_import_id AS oldId,new_import_id AS newId,created_at AS createdAt,p.status,p.revision AS publicationRevision
      FROM change_audit_tasks t JOIN change_audit_publications p ON p.task_id=t.id WHERE hall_id=? AND (p.status='PUBLISHED' OR (?=1 AND (p.status<>'DELETED' OR ?=1))) ORDER BY created_at DESC,t.id DESC LIMIT 100`).bind(hall, manager ? 1 : 0, url.searchParams.get('archived')==='1' ? 1 : 0).all();
                return reply({ tasks: tasks.results, activeImportId: await active(env, hall) });
            }
            if (request.method !== 'POST')
                return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
            requireManager();
            const input = await body(request);
            need(text(input.id, 80) && /^[\w-]{8,80}$/.test(input.id));
            need(text(input.oldId, 150) && text(input.newId, 150));
            let config;
            try {
                config = validateConfig(input.config);
            }
            catch (e) {
                throw new ApiError(400, (e as Error).message);
            }
            const existing = await env.DB.prepare('SELECT * FROM change_audit_tasks WHERE id=?').bind(input.id).first<TaskRow>();
            if (existing) {
                need(existing.hall_id === hall && existing.old_import_id === input.oldId && existing.new_import_id === input.newId && JSON.stringify(JSON.parse(existing.plan_json).config) === JSON.stringify(config));
                await env.DB.prepare('INSERT OR IGNORE INTO change_audit_publications(task_id) VALUES(?)').bind(existing.id).run();
                return reply({ id: existing.id });
            }
            if (await active(env, hall) !== input.newId)
                throw new ApiError(409, 'STALE_VERSION');
            const comparisonResponse = await handleSnapshotComparison(new Request(`https://internal/api/inventory/snapshot-compare?${new URLSearchParams({ hallId: hall, oldImportId: input.oldId, newImportId: input.newId })}`), env);
            if (!comparisonResponse.ok)
                throw new ApiError(400, 'INVALID_VERSIONS');
            const { data: comparison } = await comparisonResponse.json() as {
                data: SnapshotComparison;
            };
            const rows = await env.DB.prepare(`SELECT UPPER(TRIM(location_code)) AS location,TRIM(sku) AS sku,
    MAX(COALESCE(NULLIF(barcode,''),e_barcode,'')) AS barcode,CASE WHEN COUNT(DISTINCT NULLIF(customer_code,''))=1 THEN MAX(COALESCE(customer_code,'')) ELSE '' END AS customer,
    MAX(COALESCE(NULLIF(name_zh,''),name_en,'')) AS name,SUM(system_qty) AS qty,SUM(available_qty) AS availableQty,SUM(allocated_qty) AS allocatedQty,SUM(frozen_qty) AS frozenQty,MAX(COALESCE(e_barcode,'')) AS eBarcode
    FROM inventory_stock_rows WHERE hall_id=? AND import_id=? GROUP BY UPPER(TRIM(location_code)),TRIM(sku) HAVING SUM(system_qty)<>0`).bind(hall, input.newId).all<BookSku & {
                location: string;
            }>();
            let plan: AuditPlan;
            try {
                plan = buildPlan(comparison, rows.results, config);
            }
            catch (e) {
                throw new ApiError(400, (e as Error).message);
            }
            need(plan.targets.length > 0, 'NO_CHANGES');
            const createdAt = new Date().toISOString();
            const json = JSON.stringify(plan);
            if (new TextEncoder().encode(json).length > 1800000)
                throw new ApiError(413, 'TASK_TOO_LARGE');
            const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO change_audit_tasks(id,hall_id,old_import_id,new_import_id,plan_json,created_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM active_hall_imports WHERE hall_id=? AND active_import_id=?)`).bind(input.id, hall, input.oldId, input.newId, json, createdAt, hall, input.newId).run();
            if (!inserted.meta.changes) {
                if (await active(env, hall) !== input.newId)
                    throw new ApiError(409, 'STALE_VERSION');
                const raced = await taskRow(env, input.id, hall);
                need(raced.old_import_id === input.oldId && raced.new_import_id === input.newId && JSON.stringify(JSON.parse(raced.plan_json).config) === JSON.stringify(config));
            }
            await env.DB.prepare('INSERT OR IGNORE INTO change_audit_publications(task_id) VALUES(?)').bind(input.id).run();
            return reply({ id: input.id, task: inserted.meta.changes ? { id: input.id, hall, createdAt, plan, results: {}, photos: [], stale: false, lifecycle: 'DRAFT', publicationRevision: 0 } : undefined }, 201);
        }
        const id = url.searchParams.get('taskId');
        need(id && text(id, 80));
        const row = await taskRow(env, id, hall, ['status','lifecycle','progress'].includes(action || ''));
        if(['status','progress'].includes(action || '') && request.method!=='GET' || action==='lifecycle' && request.method!=='POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
        const publication = await env.DB.prepare('SELECT status,revision FROM change_audit_publications WHERE task_id=?').bind(id).first<{status:string;revision:number}>();
        const state = publication || {status:'DRAFT',revision:0};
        if(action==='lifecycle' && request.method==='POST') {
            requireManager();
            const input=await body(request);
            need(['PUBLISHED','WITHDRAWN','DELETED'].includes(input.status) && Number.isInteger(input.revision));
            if(state.status==='DELETED') throw new ApiError(410,'TASK_UNAVAILABLE');
            if(input.status==='PUBLISHED' && await active(env,hall)!==row.new_import_id) throw new ApiError(409,'STALE_VERSION');
            const changed=await env.DB.prepare(`UPDATE change_audit_publications SET status=?,revision=revision+1,updated_at=? WHERE task_id=? AND revision=? AND status<> 'DELETED' AND (?<>'PUBLISHED' OR EXISTS(SELECT 1 FROM active_hall_imports WHERE hall_id=? AND active_import_id=?))`).bind(input.status,new Date().toISOString(),id,input.revision,input.status,hall,row.new_import_id).run();
            if(!changed.meta.changes) throw new ApiError(409,'PUBLICATION_CONFLICT');
            return reply({lifecycle:input.status,publicationRevision:input.revision+1});
        }
        if(state.status==='DELETED' && !(manager && (['export','task','photo'].includes(action || '') && request.method==='GET'))) throw new ApiError(410,'TASK_UNAVAILABLE');
        if(!manager && state.status!=='PUBLISHED') throw new ApiError(410,'TASK_UNAVAILABLE');
        if (action === 'status' && request.method === 'GET') {
            const counts=await env.DB.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(revision),0) AS rev FROM change_audit_results WHERE task_id=?').bind(id).first<{n:number;rev:number}>();
            const photos=await env.DB.prepare('SELECT COUNT(*) AS n FROM change_audit_photos WHERE task_id=?').bind(id).first<{n:number}>();
            return reply({ stale: (await active(env, hall)) !== row.new_import_id, lifecycle:state.status,publicationRevision:state.revision,resultStamp:`${counts?.n}:${counts?.rev}:${photos?.n}` });
        }
        if(action==='progress' && request.method==='GET') {
            const results=await env.DB.prepare('SELECT location_code,result_json,revision,saved_at FROM change_audit_results WHERE task_id=?').bind(id).all<{location_code:string;result_json:string;revision:number;saved_at:string}>();
            const photos=await env.DB.prepare('SELECT id,location_code AS location,line_id AS lineId FROM change_audit_photos WHERE task_id=?').bind(id).all();
            return reply({results:Object.fromEntries(results.results.map(r=>[r.location_code,{...JSON.parse(r.result_json),revision:r.revision,savedAt:r.saved_at}])),photos:photos.results});
        }
        const plan = JSON.parse(row.plan_json) as AuditPlan;
        if (action === 'export' && request.method === 'GET') { requireManager(); return exportChangeAudit(request, env, row, plan); }
        if (action === 'task' && request.method === 'GET') {
            const results = await env.DB.prepare('SELECT location_code,result_json,revision,saved_at FROM change_audit_results WHERE task_id=?').bind(id).all<{
                location_code: string;
                result_json: string;
                revision: number;
                saved_at: string;
            }>();
            const photos = await env.DB.prepare('SELECT id,location_code AS location,line_id AS lineId FROM change_audit_photos WHERE task_id=?').bind(id).all();
            return reply({ id, hall, lifecycle:state.status,publicationRevision:state.revision, createdAt: row.created_at, plan, stale: (await active(env, hall)) !== row.new_import_id,
                results: Object.fromEntries(results.results.map(r => [r.location_code, { ...JSON.parse(r.result_json), revision: r.revision, savedAt: r.saved_at }])), photos: photos.results });
        }
        if (action === 'photo' && request.method === 'GET') {
            const photo = await env.DB.prepare('SELECT object_key FROM change_audit_photos WHERE id=? AND task_id=?').bind(url.searchParams.get('photoId'), id).first<{
                object_key: string;
            }>();
            if (!photo)
                throw new ApiError(404, 'PHOTO_NOT_FOUND');
            const file = await env.PHOTO_BUCKET.get(photo.object_key);
            if (!file)
                throw new ApiError(404, 'PHOTO_NOT_FOUND');
            return new Response(file.body, { headers: { 'Content-Type': file.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (request.method !== 'POST')
            return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
        if(state.status==='WITHDRAWN' || state.status==='DELETED') throw new ApiError(410,'TASK_UNAVAILABLE');
        const publicationRevision=Number(request.headers.get('X-Audit-Publication-Revision'));
        if(!request.headers.has('X-Audit-Publication-Revision') || publicationRevision!==state.revision) throw new ApiError(409,'PUBLICATION_CONFLICT');
        if (await active(env, hall) !== row.new_import_id)
            throw new ApiError(409, 'STALE_VERSION');
        const location = url.searchParams.get('location'), target = plan.targets.find(t => t.location === location);
        need(target, 'INVALID_LOCATION');
        if (action === 'save') {
            const input = await body(request);
            need(Number.isInteger(input.revision) && input.revision >= 0 && Array.isArray(input.lines) && input.lines.length <= 1000);
            need(text(input.notes) && typeof input.completed === 'boolean' && typeof input.emptyConfirmed === 'boolean');
            const ids = new Set<string>();
            for (const line of input.lines) {
                need(line && typeof line === 'object');
                need(text(line.id, 200) && !ids.has(line.id) && text(line.sku, 150) && text(line.barcode, 300) && text(line.notes, 1000));
                need(line.isReturn === undefined || typeof line.isReturn === 'boolean');
                need(line.returnCode === undefined || text(line.returnCode, 300));
                ids.add(line.id);
                need(line.actual === null || (Number.isSafeInteger(line.actual) && line.actual >= 0 && line.actual <= 1000000000));
                if (line.id.startsWith('book:')) {
                    const sku = target.skus.find(s => `book:${s.sku}` === line.id);
                    need(sku && sku.sku === line.sku && sku.barcode === line.barcode);
                }
                else
                    need(/^extra:[\w-]{8,80}$/.test(line.id), 'INVALID_LINE');
            }
            need(target.skus.every(s => ids.has(`book:${s.sku}`)), 'MISSING_BOOK_LINES');
            const result: Omit<AuditResult, 'revision'> = { lines: input.lines.map((l: any) => ({ id: l.id, sku: l.sku, barcode: l.barcode, actual: l.actual, notes: l.notes, ...(l.isReturn !== undefined ? { isReturn: l.isReturn } : {}), ...(l.returnCode !== undefined ? { returnCode: l.isReturn ? l.returnCode : '' } : {}) })), notes: input.notes, emptyConfirmed: input.emptyConfirmed, completed: input.completed };
            if (input.ignoredPhotoIds !== undefined) {
                need(Array.isArray(input.ignoredPhotoIds) && input.ignoredPhotoIds.length <= 1000 && input.ignoredPhotoIds.every((id: unknown) => text(id, 80)));
                const linked = input.ignoredPhotoIds.length ? await env.DB.prepare('SELECT id FROM change_audit_photos WHERE task_id=? AND location_code=?').bind(id, location).all<{
                    id: string;
                }>() : { results: [] };
                const own = new Set(linked.results.map(p => p.id));
                need(input.ignoredPhotoIds.every((photoId: string) => own.has(photoId)), 'INVALID_PHOTO');
                result.ignoredPhotoIds = [...new Set(input.ignoredPhotoIds)] as string[];
            }
            if (input.photoLines !== undefined) {
                need(input.photoLines && typeof input.photoLines === 'object' && !Array.isArray(input.photoLines) && Object.keys(input.photoLines).length <= 1000);
                const linked = await env.DB.prepare('SELECT id FROM change_audit_photos WHERE task_id=? AND location_code=?').bind(id, location).all<{
                    id: string;
                }>();
                const own = new Set(linked.results.map(p => p.id));
                need(Object.entries(input.photoLines).every(([photoId, lineId]) => own.has(photoId) && typeof lineId === 'string' && (lineId === '' || ids.has(lineId))), 'INVALID_PHOTO_LINE');
                result.photoLines = input.photoLines;
            }
            if (result.completed) {
                need(result.lines.every(l => l.actual !== null), 'INCOMPLETE_COUNTS');
                need(target.category !== 'EMPTIED_LOCATION' || result.lines.some(l => (l.actual || 0) > 0) || result.emptyConfirmed, 'CONFIRM_EMPTY');
                need(result.lines.every(l => l.id.startsWith('book:') || l.sku || l.barcode || l.notes), 'IDENTIFY_EXTRA');
                const unknown = result.lines.filter(l => l.id.startsWith('extra:') && !l.sku && !l.barcode && (l.actual || 0) > 0);
                if (unknown.length) {
                    const evidence = await env.DB.prepare('SELECT id,line_id FROM change_audit_photos WHERE task_id=? AND location_code=?').bind(id, location).all<{
                        id: string;
                        line_id: string;
                    }>();
                    need(unknown.every(l => evidence.results.some(p => (result.photoLines?.[p.id] ?? p.line_id) === l.id && !result.ignoredPhotoIds?.includes(p.id))), 'PHOTO_REQUIRED');
                }
            }
            result.anomaly = isAnomaly(target, { ...result, revision: input.revision });
            const json = JSON.stringify(result), savedAt = new Date().toISOString();
            const written = input.revision === 0
                ? await env.DB.prepare(`INSERT OR IGNORE INTO change_audit_results(task_id,location_code,result_json,revision,saved_at)
       SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM active_hall_imports WHERE hall_id=? AND active_import_id=?) AND EXISTS(SELECT 1 FROM change_audit_publications WHERE task_id=? AND revision=? AND status=?)`)
                    .bind(id, location, json, savedAt, hall, row.new_import_id, id, state.revision, state.status).run()
                : await env.DB.prepare(`UPDATE change_audit_results SET result_json=?,revision=revision+1,saved_at=?
       WHERE task_id=? AND location_code=? AND revision=? AND EXISTS(SELECT 1 FROM active_hall_imports WHERE hall_id=? AND active_import_id=?) AND EXISTS(SELECT 1 FROM change_audit_publications WHERE task_id=? AND revision=? AND status=?)`)
                    .bind(json, savedAt, id, location, input.revision, hall, row.new_import_id, id, state.revision, state.status).run();
            const changed = written.meta.changes;
            if (!changed) {
                const latest=await env.DB.prepare('SELECT status,revision FROM change_audit_publications WHERE task_id=?').bind(id).first<{status:string;revision:number}>();
                if(latest?.status!==state.status || latest?.revision!==state.revision) throw new ApiError(409,'PUBLICATION_CONFLICT');
                if (await active(env, hall) !== row.new_import_id)
                    throw new ApiError(409, 'STALE_VERSION');
                const current = await env.DB.prepare('SELECT result_json,revision,saved_at FROM change_audit_results WHERE task_id=? AND location_code=?').bind(id, location).first<{
                    result_json: string;
                    revision: number;
                    saved_at: string;
                }>();
                // Lost acknowledgement: retrying the same write succeeds without creating another revision.
                if (current && current.revision === input.revision + 1 && current.result_json === json)
                    return reply({ ...result, revision: current.revision, savedAt: current.saved_at });
                throw new ApiError(409, 'REVISION_CONFLICT');
            }
            return reply({ ...result, revision: input.revision + 1, savedAt });
        }
        if (action === 'photo') {
            const photoId = url.searchParams.get('photoId'), lineId = url.searchParams.get('lineId') || '';
            need(photoId && /^[\w-]{8,80}$/.test(photoId) && text(lineId, 200));
            if (lineId) {
                const saved = await env.DB.prepare('SELECT result_json FROM change_audit_results WHERE task_id=? AND location_code=?').bind(id, location).first<{
                    result_json: string;
                }>();
                const known = target.skus.some(s => `book:${s.sku}` === lineId) || saved && JSON.parse(saved.result_json).lines.some((l: any) => l.id === lineId);
                need(known, 'INVALID_LINE');
            }
            const existing = await env.DB.prepare('SELECT * FROM change_audit_photos WHERE id=?').bind(photoId).first<{
                task_id: string;
                location_code: string;
                line_id: string;
            }>();
            if (existing) {
                need(existing.task_id === id && existing.location_code === location && existing.line_id === lineId);
                return reply({ id: photoId, location, lineId });
            }
            const type = request.headers.get('Content-Type') || '';
            need(['image/jpeg', 'image/png', 'image/webp'].includes(type), 'PHOTO_FORMAT');
            if (Number(request.headers.get('Content-Length') || 0) > 10 * 1024 * 1024)
                throw new ApiError(413, 'PHOTO_SIZE');
            const bytes = await request.arrayBuffer();
            need(bytes.byteLength > 0 && bytes.byteLength <= 10 * 1024 * 1024, 'PHOTO_SIZE');
            const key = `change-audit/${hall}/${id}/${photoId}`;
            await env.PHOTO_BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
            const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO change_audit_photos(id,task_id,location_code,line_id,object_key)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM active_hall_imports WHERE hall_id=? AND active_import_id=?) AND EXISTS(SELECT 1 FROM change_audit_publications WHERE task_id=? AND revision=? AND status=?)`).bind(photoId, id, location, lineId, key, hall, row.new_import_id, id, state.revision, state.status).run();
            if (!inserted.meta.changes) {
                const latest=await env.DB.prepare('SELECT status,revision FROM change_audit_publications WHERE task_id=?').bind(id).first<{status:string;revision:number}>();
                if(latest?.status!==state.status || latest?.revision!==state.revision) { await env.PHOTO_BUCKET.delete(key); throw new ApiError(409,'PUBLICATION_CONFLICT'); }
                if (await active(env, hall) !== row.new_import_id) {
                    const retained = await env.DB.prepare('SELECT id FROM change_audit_photos WHERE id=? AND task_id=?').bind(photoId, id).first();
                    if (!retained)
                        await env.PHOTO_BUCKET.delete(key);
                    throw new ApiError(409, 'STALE_VERSION');
                }
            }
            return reply({ id: photoId, location, lineId }, 201);
        }
        throw new ApiError(404, 'NOT_FOUND');
    }
    catch (error) {
        return reply({ error: error instanceof Error ? error.message : 'SERVER_ERROR' }, error instanceof ApiError ? error.status : 500);
    }
}
