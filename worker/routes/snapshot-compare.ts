import type { Env } from '../types';
import type { SnapshotVersion, SnapshotComparison, SnapshotChange } from '../../src/types';
interface VersionRecord {
    import_id: string;
    hall_id: string;
    version_number: number;
    imported_at: string;
    source_exported_at: string | null;
    original_filename: string;
    status: string;
}
const versionColumns = 'import_id,hall_id,version_number,imported_at,source_exported_at,original_filename,status';
const version = (row: VersionRecord): SnapshotVersion => ({
    importId: row.import_id, hallId: row.hall_id, versionNumber: row.version_number,
    importedAt: row.imported_at, sourceExportedAt: row.source_exported_at, originalFilename: row.original_filename,
});
export async function handleSnapshotComparison(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET')
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    const hallId = url.searchParams.get('hallId');
    if (!hallId || !['H1', 'H2', 'H3'].includes(hallId))
        return Response.json({ error: 'Valid hallId required' }, { status: 400 });
    try {
        if (url.pathname === '/api/inventory/snapshot-versions') {
            const records = await env.DB.prepare(`SELECT ${versionColumns} FROM inventory_imports
        WHERE hall_id=? AND status IN ('PUBLISHED','ARCHIVED') ORDER BY version_number DESC,imported_at DESC`).bind(hallId).all<VersionRecord>();
            const active = await env.DB.prepare('SELECT active_import_id FROM active_hall_imports WHERE hall_id=?').bind(hallId).first<{
                active_import_id: string | null;
            }>();
            return Response.json({ success: true, versions: records.results.map(version), activeImportId: active?.active_import_id || null }, { headers: { 'Cache-Control': 'no-store' } });
        }
        const oldId = url.searchParams.get('oldImportId'), newId = url.searchParams.get('newImportId');
        if (!oldId || !newId || oldId === newId)
            return Response.json({ error: 'Choose two different snapshots' }, { status: 400 });
        const records = await env.DB.prepare(`SELECT ${versionColumns} FROM inventory_imports
      WHERE hall_id=? AND import_id IN (?,?) AND status IN ('PUBLISHED','ARCHIVED')`).bind(hallId, oldId, newId).all<VersionRecord>();
        const oldVersion = records.results.find(item => item.import_id === oldId), newVersion = records.results.find(item => item.import_id === newId);
        if (!oldVersion || !newVersion)
            return Response.json({ error: 'Both snapshots must be published versions of this hall' }, { status: 400 });
        if (oldVersion.version_number >= newVersion.version_number)
            return Response.json({ error: 'The comparison version must be newer than the baseline' }, { status: 400 });
        // One indexed read per snapshot. Aggregate repeated WMS lines before comparing.
        // A zero-only row is equivalent to absent stock in these sparse snapshots.
        const result = await env.DB.prepare(`WITH
      old_stock AS (SELECT UPPER(TRIM(location_code)) AS locationCode,TRIM(sku) AS sku,
        MAX(COALESCE(NULLIF(barcode,''),e_barcode,'')) AS barcode,MAX(COALESCE(name_zh,'')) AS nameZh,SUM(system_qty) AS qty
        FROM inventory_stock_rows WHERE hall_id=? AND import_id=? GROUP BY UPPER(TRIM(location_code)),TRIM(sku) HAVING SUM(system_qty)<>0),
      new_stock AS (SELECT UPPER(TRIM(location_code)) AS locationCode,TRIM(sku) AS sku,
        MAX(COALESCE(NULLIF(barcode,''),e_barcode,'')) AS barcode,MAX(COALESCE(name_zh,'')) AS nameZh,SUM(system_qty) AS qty
        FROM inventory_stock_rows WHERE hall_id=? AND import_id=? GROUP BY UPPER(TRIM(location_code)),TRIM(sku) HAVING SUM(system_qty)<>0),
      old_locations AS (SELECT locationCode,SUM(qty) AS totalQty,COUNT(*) AS lineCount FROM old_stock GROUP BY locationCode),
      new_locations AS (SELECT locationCode,SUM(qty) AS totalQty,COUNT(*) AS lineCount FROM new_stock GROUP BY locationCode),
      changes AS (
        SELECT o.locationCode,o.sku,COALESCE(n.barcode,o.barcode) AS barcode,COALESCE(n.nameZh,o.nameZh) AS nameZh,
          o.qty AS oldQty,COALESCE(n.qty,0) AS newQty,CASE WHEN n.sku IS NULL THEN 'REMOVED' ELSE 'QUANTITY_CHANGED' END AS changeType
          FROM old_stock o LEFT JOIN new_stock n ON n.locationCode=o.locationCode AND n.sku=o.sku WHERE o.qty<>COALESCE(n.qty,0)
        UNION ALL
        SELECT n.locationCode,n.sku,n.barcode,n.nameZh,0,n.qty,'ADDED'
          FROM new_stock n LEFT JOIN old_stock o ON n.locationCode=o.locationCode AND n.sku=o.sku WHERE o.sku IS NULL
      )
      SELECT c.*,c.newQty-c.oldQty AS differenceQty,COALESCE(o.totalQty,0) AS oldLocationQty,
        COALESCE(n.totalQty,0) AS newLocationQty,COALESCE(o.lineCount,0) AS oldLocationLines,COALESCE(n.lineCount,0) AS newLocationLines
        FROM changes c LEFT JOIN old_locations o ON o.locationCode=c.locationCode
        LEFT JOIN new_locations n ON n.locationCode=c.locationCode ORDER BY c.locationCode,c.sku
    `).bind(hallId, oldId, hallId, newId).all<SnapshotChange & {
            oldLocationQty: number;
            newLocationQty: number;
            oldLocationLines: number;
            newLocationLines: number;
        }>();
        const groups = new Map<string, SnapshotComparison['locations'][number]>();
        const summary = { changedLocations: 0, changedSkuRows: result.results.length, addedSkuRows: 0, removedSkuRows: 0, quantityChangedRows: 0, newStockedLocations: 0, emptiedLocations: 0 };
        for (const record of result.results) {
            const { oldLocationQty, newLocationQty, oldLocationLines, newLocationLines, ...change } = record;
            let location = groups.get(change.locationCode);
            if (!location) {
                const changeType = oldLocationLines === 0 ? 'NEW_LOCATION' : newLocationLines === 0 ? 'EMPTIED_LOCATION' : 'CHANGED';
                location = { locationCode: change.locationCode, changeType, oldTotalQty: oldLocationQty, newTotalQty: newLocationQty, changes: [] };
                groups.set(change.locationCode, location);
                if (changeType === 'NEW_LOCATION')
                    summary.newStockedLocations++;
                if (changeType === 'EMPTIED_LOCATION')
                    summary.emptiedLocations++;
            }
            location.changes.push(change);
            if (change.changeType === 'ADDED')
                summary.addedSkuRows++;
            else if (change.changeType === 'REMOVED')
                summary.removedSkuRows++;
            else
                summary.quantityChangedRows++;
        }
        summary.changedLocations = groups.size;
        const data: SnapshotComparison = { hallId, oldVersion: version(oldVersion), newVersion: version(newVersion), summary, locations: [...groups.values()] };
        return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
