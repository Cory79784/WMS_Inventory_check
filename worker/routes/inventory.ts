import { Env, AuthUser } from '../types';
import { authenticateRequest } from '../auth/access';

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

  return Response.json({ error: 'Not found' }, { status: 404 });
}
