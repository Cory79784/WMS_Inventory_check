import { Env, AuthUser } from '../types';
import { authenticateRequest } from '../auth/access';
import { adjacentLocation } from '../locationNavigation';
import { exportInspectionResults } from './inspection-export';

interface StockRowInput {
  sku: string;
  barcode?: string;
  eBarcode?: string;
  customerCode?: string;
  nameZh?: string;
  nameEn?: string;
  hallId: string;
  locationCode: string;
  systemQty: number;
  availableQty: number;
  allocatedQty: number;
  frozenQty: number;
  volumeM3?: number;
  dimensionsCm?: string;
  weightKg?: number;
  cargoType?: string;
  isNewProduct?: boolean;
  isElectric?: boolean;
}

export async function handleInventoryRoutes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Authenticate user
  const auth = await authenticateRequest(request, env);
  if (!auth.user) {
    return Response.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const user = auth.user;

  if (path === '/api/inventory/inspection/export' && request.method === 'GET') {
    return exportInspectionResults(request, env);
  }

  // 1. GET /api/inventory/imports?hallId=H1
  if (path === '/api/inventory/imports' && request.method === 'GET') {
    const hallId = url.searchParams.get('hallId') || 'H1';
    try {
      const activePointer = await env.DB.prepare(
        `SELECT active_import_id, updated_at FROM active_hall_imports WHERE hall_id = ?`
      ).bind(hallId).first<{ active_import_id: string | null; updated_at: string }>();

      const imports = await env.DB.prepare(
        `SELECT * FROM inventory_imports WHERE hall_id = ? ORDER BY version_number DESC`
      ).bind(hallId).all();

      return Response.json({
        success: true,
        data: {
          hallId,
          activeImportId: activePointer?.active_import_id || null,
          pointerUpdatedAt: activePointer?.updated_at || null,
          imports: imports.results,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 2. POST /api/inventory/imports/check (Check duplicate SHA-256)
  if (path === '/api/inventory/imports/check' && request.method === 'POST') {
    try {
      const body = await request.json() as { hallId: string; sha256: string };
      if (!body.hallId || !body.sha256) {
        return Response.json({ success: false, error: 'hallId and sha256 required' }, { status: 400 });
      }

      const existing = await env.DB.prepare(
        `SELECT * FROM inventory_imports WHERE hall_id = ? AND file_sha256 = ? AND status != 'FAILED' LIMIT 1`
      ).bind(body.hallId, body.sha256).first();

      return Response.json({
        success: true,
        isDuplicate: Boolean(existing),
        existingImport: existing || null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 3. POST /api/inventory/imports/stage (Initialize staging snapshot)
  if (path === '/api/inventory/imports/stage' && request.method === 'POST') {
    try {
      const body = await request.json() as {
        hallId: string;
        filename: string;
        fileSha256: string;
        sourceExportedAt?: string;
        expectedRowCount: number;
        notes?: string;
      };

      if (!body.hallId || !body.filename || !body.fileSha256) {
        return Response.json({ success: false, error: 'Missing required staging parameters' }, { status: 400 });
      }

      // Compute next version number for this hall
      const maxVer = await env.DB.prepare(
        `SELECT COALESCE(MAX(version_number), 0) as max_v FROM inventory_imports WHERE hall_id = ?`
      ).bind(body.hallId).first<{ max_v: number }>();

      const nextVersionNumber = (maxVer?.max_v ?? 0) + 1;
      const importId = `imp_${body.hallId}_v${nextVersionNumber}_${Date.now()}`;
      const nowUtc = new Date().toISOString();

      await env.DB.prepare(
        `INSERT INTO inventory_imports (
          import_id, hall_id, version_number, original_filename, file_sha256,
          imported_at, source_exported_at, uploaded_by, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STAGING', ?)`
      ).bind(
        importId,
        body.hallId,
        nextVersionNumber,
        body.filename,
        body.fileSha256,
        nowUtc,
        body.sourceExportedAt || null,
        user.email,
        body.notes || null
      ).run();

      return Response.json({
        success: true,
        importId,
        hallId: body.hallId,
        versionNumber: nextVersionNumber,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 4. POST /api/inventory/imports/chunk (Upload batch of rows)
  if (path === '/api/inventory/imports/chunk' && request.method === 'POST') {
    try {
      const body = await request.json() as {
        importId: string;
        hallId: string;
        rows: StockRowInput[];
      };

      if (!body.importId || !body.hallId || !Array.isArray(body.rows) || body.rows.length === 0) {
        return Response.json({ success: false, error: 'Invalid chunk payload' }, { status: 400 });
      }

      // Verify import exists and is in STAGING
      const imp = await env.DB.prepare(
        `SELECT status FROM inventory_imports WHERE import_id = ? AND hall_id = ?`
      ).bind(body.importId, body.hallId).first<{ status: string }>();

      if (!imp || imp.status !== 'STAGING') {
        return Response.json(
          { success: false, error: 'Import session is not in STAGING state or does not exist.' },
          { status: 400 }
        );
      }

      // Batch insert into D1 (D1 supports up to 100 statements in batch)
      const stmts: D1PreparedStatement[] = [];
      const barcodeStmts: D1PreparedStatement[] = [];

      for (const row of body.rows) {
        const rowId = `row_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        stmts.push(
          env.DB.prepare(
            `INSERT INTO inventory_stock_rows (
              id, import_id, hall_id, location_code, sku, barcode, e_barcode, customer_code,
              name_zh, name_en, system_qty, available_qty, allocated_qty, frozen_qty,
              volume_m3, dimensions_cm, weight_kg, cargo_type, is_new_product, is_electric
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            rowId,
            body.importId,
            body.hallId,
            row.locationCode,
            row.sku,
            row.barcode || null,
            row.eBarcode || null,
            row.customerCode || null,
            row.nameZh || null,
            row.nameEn || null,
            row.systemQty,
            row.availableQty,
            row.allocatedQty,
            row.frozenQty,
            row.volumeM3 || 0,
            row.dimensionsCm || null,
            row.weightKg || 0,
            row.cargoType || null,
            row.isNewProduct ? 1 : 0,
            row.isElectric ? 1 : 0
          )
        );

        // Populate Inverted Barcode Registry (Decision 3 Option A)
        // 1. SKU index
        barcodeStmts.push(
          env.DB.prepare(
            `INSERT INTO inventory_barcode_index (id, import_id, hall_id, barcode_value, sku, barcode_type)
             VALUES (?, ?, ?, ?, ?, 'SKU')`
          ).bind(`bc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, body.importId, body.hallId, row.sku, row.sku)
        );

        // 2. Barcode index
        if (row.barcode && row.barcode.trim()) {
          barcodeStmts.push(
            env.DB.prepare(
              `INSERT INTO inventory_barcode_index (id, import_id, hall_id, barcode_value, sku, barcode_type)
               VALUES (?, ?, ?, ?, ?, 'BARCODE')`
            ).bind(`bc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, body.importId, body.hallId, row.barcode.trim(), row.sku)
          );
        }

        // 3. Multi-valued eBarcode split index
        if (row.eBarcode && row.eBarcode.trim()) {
          const split = row.eBarcode.split(',').map((s) => s.trim()).filter(Boolean);
          for (const subCode of split) {
            barcodeStmts.push(
              env.DB.prepare(
                `INSERT INTO inventory_barcode_index (id, import_id, hall_id, barcode_value, sku, barcode_type)
                 VALUES (?, ?, ?, ?, ?, 'EBARCODE')`
              ).bind(`bc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, body.importId, body.hallId, subCode, row.sku)
            );
          }
        }
      }

      // Execute in transactional batches
      await env.DB.batch([...stmts, ...barcodeStmts]);

      return Response.json({
        success: true,
        insertedCount: body.rows.length,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 5. POST /api/inventory/imports/publish (Validate and activate version)
  if (path === '/api/inventory/imports/publish' && request.method === 'POST') {
    try {
      const body = await request.json() as { importId: string; hallId: string };
      if (!body.importId || !body.hallId) {
        return Response.json({ success: false, error: 'importId and hallId required' }, { status: 400 });
      }

      // Check staging status
      const imp = await env.DB.prepare(
        `SELECT * FROM inventory_imports WHERE import_id = ? AND hall_id = ?`
      ).bind(body.importId, body.hallId).first<{
        import_id: string;
        hall_id: string;
        status: string;
        version_number: number;
      }>();

      if (!imp || imp.status !== 'STAGING') {
        return Response.json({ success: false, error: 'Only STAGING imports can be published.' }, { status: 400 });
      }

      // Perform server-side integrity summary calculation
      const stats = await env.DB.prepare(`
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT location_code) as total_locations,
          COUNT(DISTINCT sku) as total_skus,
          COALESCE(SUM(system_qty), 0) as total_stock
        FROM inventory_stock_rows
        WHERE import_id = ? AND hall_id = ?
      `).bind(body.importId, body.hallId).first<{
        total_rows: number;
        total_locations: number;
        total_skus: number;
        total_stock: number;
      }>();

      if (!stats || stats.total_rows === 0) {
        return Response.json(
          { success: false, error: 'Cannot publish an empty import (0 rows found in staging).' },
          { status: 400 }
        );
      }

      const nowUtc = new Date().toISOString();

      // Atomic batch:
      // 1. Update inventory_imports to PUBLISHED with final counts
      // 2. Update active_hall_imports pointer for this hall
      // 3. Log audit event
      const batchStmts: D1PreparedStatement[] = [
        env.DB.prepare(`
          UPDATE inventory_imports
          SET
            status = 'PUBLISHED',
            published_at = ?,
            published_by = ?,
            inventory_row_count = ?,
            stocked_location_count = ?,
            distinct_sku_count = ?,
            total_stock_qty = ?
          WHERE import_id = ?
        `).bind(
          nowUtc,
          user.email,
          stats.total_rows,
          stats.total_locations,
          stats.total_skus,
          stats.total_stock,
          body.importId
        ),

        env.DB.prepare(`
          INSERT INTO active_hall_imports (hall_id, active_import_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(hall_id) DO UPDATE SET
            active_import_id = excluded.active_import_id,
            updated_at = excluded.updated_at
        `).bind(body.hallId, body.importId, nowUtc),

        env.DB.prepare(`
          INSERT INTO audit_events (event_id, event_type, user_id, hall_id, details_json, created_at)
          VALUES (?, 'WMS_SNAPSHOT_PUBLISHED', ?, ?, ?, ?)
        `).bind(
          `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          user.userId,
          body.hallId,
          JSON.stringify({
            importId: body.importId,
            versionNumber: imp.version_number,
            rows: stats.total_rows,
            locations: stats.total_locations,
            skus: stats.total_skus,
            totalStock: stats.total_stock,
          }),
          nowUtc
        ),
      ];

      await env.DB.batch(batchStmts);

      return Response.json({
        success: true,
        message: `Version ${imp.version_number} published successfully for ${body.hallId}`,
        activeImportId: body.importId,
        versionNumber: imp.version_number,
        summary: stats,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 6. POST /api/inventory/imports/cancel
  if (path === '/api/inventory/imports/cancel' && request.method === 'POST') {
    try {
      const body = await request.json() as { importId: string };
      if (!body.importId) {
        return Response.json({ success: false, error: 'importId required' }, { status: 400 });
      }

      await env.DB.batch([
        env.DB.prepare('DELETE FROM inventory_stock_rows WHERE import_id = ?').bind(body.importId),
        env.DB.prepare('DELETE FROM inventory_barcode_index WHERE import_id = ?').bind(body.importId),
        env.DB.prepare(`UPDATE inventory_imports SET status = 'FAILED', notes = 'Cancelled by user' WHERE import_id = ?`).bind(body.importId),
      ]);

      return Response.json({ success: true, message: 'Staging import cancelled.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 7. GET /api/inventory/search-barcode?hallId=H1&barcode=xxx
  // Search barcode using Inverted Barcode Registry (Decision 1 Option A + Decision 3 Option A)
  if (path === '/api/inventory/search-barcode' && request.method === 'GET') {
    const hallId = url.searchParams.get('hallId') || 'H1';
    const queryBarcode = url.searchParams.get('barcode')?.trim();

    if (!queryBarcode) {
      return Response.json({ success: false, error: 'barcode parameter required' }, { status: 400 });
    }

    try {
      // Find active import for this hall
      const active = await env.DB.prepare(
        `SELECT active_import_id FROM active_hall_imports WHERE hall_id = ?`
      ).bind(hallId).first<{ active_import_id: string | null }>();

      if (!active?.active_import_id) {
        return Response.json({
          success: false,
          error: `No active WMS snapshot published for hall ${hallId}. Please upload and publish an Excel file first.`,
        }, { status: 404 });
      }

      // Query index table
      const matchedSkus = await env.DB.prepare(`
        SELECT DISTINCT sku, barcode_type, barcode_value
        FROM inventory_barcode_index
        WHERE hall_id = ? AND import_id = ? AND barcode_value = ?
      `).bind(hallId, active.active_import_id, queryBarcode).all<{
        sku: string;
        barcode_type: string;
        barcode_value: string;
      }>();

      if (matchedSkus.results.length === 0) {
        return Response.json({
          success: true,
          found: false,
          candidates: [],
        });
      }

      // Fetch SKU details
      const skuList = matchedSkus.results.map((r) => r.sku);
      const placeholders = skuList.map(() => '?').join(',');

      const details = await env.DB.prepare(`
        SELECT sku, barcode, e_barcode, name_zh, name_en, location_code, system_qty
        FROM inventory_stock_rows
        WHERE hall_id = ? AND import_id = ? AND sku IN (${placeholders})
      `).bind(hallId, active.active_import_id, ...skuList).all();

      return Response.json({
        success: true,
        found: true,
        queryBarcode,
        matchCount: skuList.length,
        isAmbiguous: skuList.length > 1, // Decision 1 trigger for Candidate Modal
        candidates: details.results,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 8. GET /api/inventory/active-version?hallId=H1
  if (path === '/api/inventory/active-version' && request.method === 'GET') {
    const hallId = url.searchParams.get('hallId') || 'H1';
    try {
      const activePointer = await env.DB.prepare(
        `SELECT active_import_id, updated_at FROM active_hall_imports WHERE hall_id = ?`
      ).bind(hallId).first<{ active_import_id: string | null; updated_at: string }>();

      if (!activePointer?.active_import_id) {
        return Response.json({
          success: true,
          hasActiveVersion: false,
          activeVersion: null,
        });
      }

      const activeVer = await env.DB.prepare(
        `SELECT * FROM inventory_imports WHERE import_id = ? AND hall_id = ?`
      ).bind(activePointer.active_import_id, hallId).first();

      return Response.json({
        success: true,
        hasActiveVersion: Boolean(activeVer),
        activeVersion: activeVer || null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 9. GET /api/inventory/locations?hallId=H1&query=...
  if (path === '/api/inventory/locations' && request.method === 'GET') {
    const hallId = url.searchParams.get('hallId') || 'H1';
    const query = url.searchParams.get('query')?.trim() || '';

    try {
      const activePointer = await env.DB.prepare(
        `SELECT active_import_id FROM active_hall_imports WHERE hall_id = ?`
      ).bind(hallId).first<{ active_import_id: string | null }>();

      if (!activePointer?.active_import_id) {
        return Response.json({ success: true, locations: [] });
      }

      let sql = `
        SELECT DISTINCT location_code
        FROM inventory_stock_rows
        WHERE hall_id = ? AND import_id = ?
      `;
      const params: (string | number)[] = [hallId, activePointer.active_import_id];

      if (query) {
        sql += ` AND location_code LIKE ?`;
        params.push(`%${query}%`);
      }
      sql += ` ORDER BY location_code ASC LIMIT 100`;

      const result = await env.DB.prepare(sql).bind(...params).all<{ location_code: string }>();
      return Response.json({
        success: true,
        locations: result.results.map((r) => r.location_code),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 10. GET /api/inventory/location?hallId=H1&locationCode=xxx
  if (path === '/api/inventory/location' && request.method === 'GET') {
    const hallId = url.searchParams.get('hallId') || 'H1';
    const locationCode = url.searchParams.get('locationCode')?.trim();

    if (!locationCode) {
      return Response.json({ success: false, error: 'locationCode required' }, { status: 400 });
    }

    try {
      const activePointer = await env.DB.prepare(
        `SELECT active_import_id FROM active_hall_imports WHERE hall_id = ?`
      ).bind(hallId).first<{ active_import_id: string | null }>();

      if (!activePointer?.active_import_id) {
        return Response.json({
          success: false,
          error: `当前 ${hallId} 厅尚未发布任何 WMS 库存快照。请先在电脑端上传 Excel 并发布版本。`,
        }, { status: 404 });
      }

      const importId = activePointer.active_import_id;

      // Fetch active version metadata
      const impMeta = await env.DB.prepare(
        `SELECT version_number, source_exported_at, imported_at, original_filename FROM inventory_imports WHERE import_id = ?`
      ).bind(importId).first<{ version_number: number; source_exported_at: string | null; imported_at: string; original_filename: string }>();

      // Query stock rows for this location (supporting case-insensitive match)
      const stockRows = await env.DB.prepare(`
        SELECT
          sku,
          MAX(barcode) as barcode,
          MAX(e_barcode) as e_barcode,
          MAX(customer_code) as customer_code,
          MAX(name_zh) as name_zh,
          MAX(name_en) as name_en,
          SUM(system_qty) as system_qty,
          SUM(available_qty) as available_qty,
          SUM(allocated_qty) as allocated_qty,
          SUM(frozen_qty) as frozen_qty
        FROM inventory_stock_rows
        WHERE hall_id = ? AND import_id = ? AND (location_code = ? OR UPPER(location_code) = UPPER(?))
        GROUP BY sku
        ORDER BY sku ASC
      `).bind(hallId, importId, locationCode, locationCode).all<{
        sku: string;
        barcode: string | null;
        e_barcode: string | null;
        customer_code: string | null;
        name_zh: string | null;
        name_en: string | null;
        system_qty: number;
        available_qty: number;
        allocated_qty: number;
        frozen_qty: number;
      }>();

      // Query existing inspection record
      const inspection = await env.DB.prepare(`
        SELECT * FROM location_inspections
        WHERE hall_id = ? AND reference_import_id = ? AND (location_code = ? OR UPPER(location_code) = UPPER(?))
      `).bind(hallId, importId, locationCode, locationCode).first<{
        inspection_id: string;
        status: string;
        is_empty_confirmed: number;
        notes: string | null;
        completed_at: string | null;
      }>();

      let savedSkus: any[] = [];
      let savedPhotos: any[] = [];

      if (inspection?.inspection_id) {
        const skuRecords = await env.DB.prepare(`
          SELECT * FROM sku_inspections WHERE inspection_id = ? ORDER BY id ASC
        `).bind(inspection.inspection_id).all();
        savedSkus = skuRecords.results;

        const photoRecords = await env.DB.prepare(`
          SELECT * FROM inspection_photos WHERE inspection_id = ? ORDER BY captured_at ASC
        `).bind(inspection.inspection_id).all();
        savedPhotos = photoRecords.results;
      }

      // Merge stock rows with saved inspection data (or defaults)
      const skus = stockRows.results.map((r) => {
        const inspMatch = savedSkus.find((s) => s.sku === r.sku);
        return {
          sku: r.sku,
          barcode: r.barcode || '',
          eBarcode: r.e_barcode || '',
          customerCode: r.customer_code || '',
          nameZh: r.name_zh || '',
          nameEn: r.name_en || '',
          systemQty: r.system_qty,
          availableQty: r.available_qty,
          allocatedQty: r.allocated_qty,
          frozenQty: r.frozen_qty,
          actualQty: inspMatch ? inspMatch.actual_qty : null,
          differenceQty: inspMatch ? inspMatch.difference_qty : null,
          discrepancyType: inspMatch ? inspMatch.discrepancy_type : null,
          notes: inspMatch?.notes || '',
        };
      });

      // Also append surplus SKUs that were not part of book stock
      const surplusSkus = savedSkus.filter((s) => !stockRows.results.some((r) => r.sku === s.sku)).map((s) => ({
        sku: s.sku || '',
        barcode: s.barcode || '',
        eBarcode: s.e_barcode || '',
        customerCode: '',
        nameZh: s.notes || '现场多货',
        nameEn: '',
        systemQty: 0,
        availableQty: 0,
        allocatedQty: 0,
        frozenQty: 0,
        actualQty: s.actual_qty,
        differenceQty: s.difference_qty,
        discrepancyType: s.discrepancy_type,
        notes: s.notes || '',
      }));

      const allSkus = [...skus, ...surplusSkus];

      const lastInspection = await env.DB.prepare(`
        SELECT l.completed_at as completedAt, i.version_number as versionNumber
        FROM location_inspections l JOIN inventory_imports i ON i.import_id = l.reference_import_id
        WHERE l.hall_id = ? AND UPPER(l.location_code) = UPPER(?)
          AND l.completed_at IS NOT NULL AND l.status IN ('VERIFIED', 'PENDING_REVIEW', 'CLOSED')
        ORDER BY datetime(l.completed_at) DESC LIMIT 1
      `).bind(hallId, locationCode).first<{ completedAt: string; versionNumber: number }>();

      const prevLocationCode = adjacentLocation(locationCode, -1);
      const nextLocationCode = adjacentLocation(locationCode, 1);

      return Response.json({
        success: true,
        data: {
          hallId,
          locationCode,
          referenceImportId: importId,
          versionNumber: impMeta?.version_number ?? 1,
          sourceExportedAt: impMeta?.source_exported_at ?? null,
          importedAt: impMeta?.imported_at ?? null,
          hasBookStock: stockRows.results.length > 0,
          lastInspection,
          skus: allSkus,
          inspection: inspection ? {
            inspectionId: inspection.inspection_id,
            status: inspection.status,
            isEmptyConfirmed: Boolean(inspection.is_empty_confirmed),
            notes: inspection.notes || '',
            completedAt: inspection.completed_at,
            photos: savedPhotos.map((p) => ({ photoId: p.photo_id, objectKey: p.object_key })),
          } : null,
          navigation: {
            currentIndex: null,
            totalLocations: 0,
            prevLocationCode,
            nextLocationCode,
          },
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 11. POST /api/inventory/inspection/save
  if (path === '/api/inventory/inspection/save' && request.method === 'POST') {
    try {
      const body = await request.json() as {
        hallId: string;
        referenceImportId?: string;
        locationCode: string;
        isEmptyConfirmed?: boolean;
        status?: 'VERIFIED' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'CLOSED';
        notes?: string;
        skus: Array<{
          sku?: string;
          barcode?: string;
          eBarcode?: string;
          systemQty: number;
          actualQty: number;
          differenceQty: number;
          discrepancyType: string;
          notes?: string;
        }>;
        photos?: Array<{
          photoId: string;
          objectKey: string;
          sku?: string;
        }>;
      };

      if (!body.hallId || !body.locationCode) {
        return Response.json({ success: false, error: 'hallId and locationCode required' }, { status: 400 });
      }

      const activePointer = await env.DB.prepare(
        `SELECT active_import_id FROM active_hall_imports WHERE hall_id = ?`
      ).bind(body.hallId).first<{ active_import_id: string | null }>();

      if (!activePointer?.active_import_id) {
        return Response.json({ success: false, error: 'No active import for this hall' }, { status: 400 });
      }

      const importId = activePointer.active_import_id;
      const nowUtc = new Date().toISOString();

      if (body.referenceImportId && body.referenceImportId !== importId) {
        return Response.json({ success: false, error: 'WMS 版本已更新，请重新查询库位后核查，旧版本结果不会覆盖到新版本。' }, { status: 409 });
      }

      // Check existing inspection or generate ID
      const existing = await env.DB.prepare(
        `SELECT inspection_id FROM location_inspections WHERE hall_id = ? AND reference_import_id = ? AND location_code = ?`
      ).bind(body.hallId, importId, body.locationCode).first<{ inspection_id: string }>();

      const inspectionId = existing?.inspection_id || `insp_${body.hallId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const status = body.status || 'VERIFIED';

      const stmts: D1PreparedStatement[] = [
        // 1. Upsert location_inspections
        env.DB.prepare(`
          INSERT INTO location_inspections (
            inspection_id, hall_id, location_code, reference_import_id,
            status, operator_id, is_empty_confirmed, notes, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(inspection_id) DO UPDATE SET
            status = excluded.status,
            operator_id = excluded.operator_id,
            is_empty_confirmed = excluded.is_empty_confirmed,
            notes = excluded.notes,
            completed_at = excluded.completed_at
        `).bind(
          inspectionId,
          body.hallId,
          body.locationCode,
          importId,
          status,
          user.email,
          body.isEmptyConfirmed ? 1 : 0,
          body.notes || null,
          status === 'IN_PROGRESS' ? null : nowUtc
        ),

        // 2. Clear previous sku_inspections for clean replace
        env.DB.prepare(`DELETE FROM sku_inspections WHERE inspection_id = ?`).bind(inspectionId),
      ];

      // 3. Insert new sku_inspections
      for (const item of body.skus || []) {
        const skuInspId = `sinsp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        stmts.push(
          env.DB.prepare(`
            INSERT INTO sku_inspections (
              id, inspection_id, sku, barcode, e_barcode,
              system_qty, actual_qty, difference_qty, discrepancy_type, notes, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            skuInspId,
            inspectionId,
            item.sku || null,
            item.barcode || null,
            item.eBarcode || null,
            item.systemQty || 0,
            item.actualQty ?? 0,
            item.differenceQty ?? 0,
            item.discrepancyType || 'NORMAL',
            item.notes || null,
            nowUtc
          )
        );
      }

      // 4. Save photo links if provided
      for (const p of body.photos || []) {
        stmts.push(
          env.DB.prepare(`
            INSERT OR IGNORE INTO inspection_photos (photo_id, inspection_id, object_key, captured_at)
            VALUES (?, ?, ?, ?)
          `).bind(
            p.photoId || `photo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            inspectionId,
            p.objectKey,
            nowUtc
          )
        );
      }

      // 5. Audit event
      stmts.push(
        env.DB.prepare(`
          INSERT INTO audit_events (event_id, event_type, user_id, hall_id, details_json, created_at)
          VALUES (?, 'LOCATION_INSPECTED', ?, ?, ?, ?)
        `).bind(
          `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          user.userId,
          body.hallId,
          JSON.stringify({
            locationCode: body.locationCode,
            inspectionId,
            status,
            skuCount: body.skus?.length || 0,
            isEmptyConfirmed: Boolean(body.isEmptyConfirmed),
          }),
          nowUtc
        )
      );

      await env.DB.batch(stmts);

      return Response.json({
        success: true,
        inspectionId,
        status,
        savedAt: nowUtc,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 12. POST /api/inventory/inspection/photo (Upload inspection photo to R2)
  if (path === '/api/inventory/inspection/photo' && request.method === 'POST') {
    if (!env.PHOTO_BUCKET) {
      return Response.json({ success: false, error: 'PHOTO_BUCKET R2 binding not configured' }, { status: 500 });
    }

    try {
      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      let body: ArrayBuffer | ReadableStream;
      let hallId: string;
      let locationCode: string;
      let filename: string;
      let mimeType: string;
      if (contentType.includes('multipart/form-data')) {
        // Keep existing multipart callers compatible.
        const formData = await request.formData();
        const file = formData.get('photo');
        if (!file || typeof file === 'string') {
          return Response.json({ success: false, error: 'Valid image file required' }, { status: 400 });
        }
        const fileObj = file as unknown as File;
        body = await fileObj.arrayBuffer();
        hallId = String(formData.get('hallId') || 'H1');
        locationCode = String(formData.get('locationCode') || 'general');
        filename = fileObj.name;
        mimeType = fileObj.type || 'application/octet-stream';
      } else {
        if (!request.body || request.headers.get('Content-Length') === '0') {
          return Response.json({ success: false, error: 'Valid image file required' }, { status: 400 });
        }
        // R2 needs a known-length stream. Preserve compatibility with chunked callers.
        body = request.headers.has('Content-Length') ? request.body : await request.arrayBuffer();
        hallId = url.searchParams.get('hallId') || 'H1';
        locationCode = url.searchParams.get('locationCode') || 'general';
        filename = url.searchParams.get('filename') || '';
        mimeType = contentType;
      }
      const timestamp = Date.now();
      const rand = Math.random().toString(36).substring(2, 7);
      const sanitizedLoc = locationCode.replace(/[^a-zA-Z0-9_-]/g, '_');
      const photoId = `p_${timestamp}_${rand}`;
      const extension = /\.([a-zA-Z0-9]{1,8})$/.exec(filename)?.[1] || 'bin';
      const objectKey = `inspections/${hallId}/${sanitizedLoc}/${photoId}.${extension}`;

      await env.PHOTO_BUCKET.put(objectKey, body, {
        httpMetadata: { contentType: mimeType },
        customMetadata: {
          uploadedBy: user.email,
          hallId,
          locationCode,
          uploadedAt: new Date().toISOString(),
        },
      });

      return Response.json({
        success: true,
        photoId,
        objectKey,
        previewUrl: `/api/inventory/inspection/photo?key=${encodeURIComponent(objectKey)}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  // 13. GET /api/inventory/inspection/photo?key=... (Fetch private inspection photo)
  if (path === '/api/inventory/inspection/photo' && request.method === 'GET') {
    const key = url.searchParams.get('key');
    if (!key || !env.PHOTO_BUCKET) {
      return Response.json({ success: false, error: 'key required and bucket active' }, { status: 400 });
    }

    try {
      const object = await env.PHOTO_BUCKET.get(key);
      if (!object) {
        return Response.json({ success: false, error: 'Photo not found' }, { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'private, max-age=86400');
      return new Response(object.body, { headers });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
