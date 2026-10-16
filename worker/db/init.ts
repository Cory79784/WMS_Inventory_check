import { Env } from '../types';
import { AUTH_SCHEMA } from '../auth/access';

export const SCHEMA_STATEMENTS = [
  ...AUTH_SCHEMA,
  // Historical reset evidence retains previous annotations and R2 photo keys.
  `CREATE TABLE IF NOT EXISTS inspection_reset_history (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    previous_json TEXT NOT NULL
  );`,
  // 1. Halls table
  `CREATE TABLE IF NOT EXISTS halls (
    hall_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
  );`,

  `INSERT OR IGNORE INTO halls (hall_id, name, description) VALUES
    ('H1', '1号厅 (Hall 1)', '海外仓 H1 区域'),
    ('H2', '2号厅 (Hall 2)', '海外仓 H2 区域'),
    ('H3', '3号厅 (Hall 3)', '海外仓 H3 区域');`,

  // 2. Users & Roles
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    employee_id TEXT,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
  );`,

  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'REVIEWER')),
    assigned_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    PRIMARY KEY (user_id, role),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );`,

  // 3. Diagnostics & Audit
  `CREATE TABLE IF NOT EXISTS phase0_diagnostics (
    id TEXT PRIMARY KEY,
    test_key TEXT NOT NULL,
    test_value TEXT NOT NULL,
    client_timestamp TEXT,
    server_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    notes TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT,
    hall_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
  );`,

  // 4. WMS Active Import Pointer
  `CREATE TABLE IF NOT EXISTS active_hall_imports (
    hall_id TEXT PRIMARY KEY,
    active_import_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    FOREIGN KEY (hall_id) REFERENCES halls(hall_id)
  );`,

  `INSERT OR IGNORE INTO active_hall_imports (hall_id, active_import_id) VALUES
    ('H1', NULL),
    ('H2', NULL),
    ('H3', NULL);`,

  // 5. WMS Imports (Historical Snapshots)
  `CREATE TABLE IF NOT EXISTS inventory_imports (
    import_id TEXT PRIMARY KEY,
    hall_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    source_exported_at TEXT,
    published_at TEXT,
    uploaded_by TEXT NOT NULL,
    published_by TEXT,
    inventory_row_count INTEGER NOT NULL DEFAULT 0,
    stocked_location_count INTEGER NOT NULL DEFAULT 0,
    distinct_sku_count INTEGER NOT NULL DEFAULT 0,
    total_stock_qty INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('STAGING', 'PUBLISHED', 'ARCHIVED', 'FAILED')),
    schema_version TEXT DEFAULT '1.0',
    notes TEXT,
    FOREIGN KEY (hall_id) REFERENCES halls(hall_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_imports_hall_status ON inventory_imports(hall_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_imports_sha ON inventory_imports(hall_id, file_sha256);`,

  // 6. Stock detail rows (sparse inventory)
  `CREATE TABLE IF NOT EXISTS inventory_stock_rows (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL,
    hall_id TEXT NOT NULL,
    location_code TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode TEXT,
    e_barcode TEXT,
    customer_code TEXT,
    name_zh TEXT,
    name_en TEXT,
    system_qty INTEGER NOT NULL DEFAULT 0,
    available_qty INTEGER NOT NULL DEFAULT 0,
    allocated_qty INTEGER NOT NULL DEFAULT 0,
    frozen_qty INTEGER NOT NULL DEFAULT 0,
    volume_m3 REAL DEFAULT 0,
    dimensions_cm TEXT,
    weight_kg REAL DEFAULT 0,
    cargo_type TEXT,
    is_new_product INTEGER DEFAULT 0,
    is_electric INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    FOREIGN KEY (import_id) REFERENCES inventory_imports(import_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_stock_lookup ON inventory_stock_rows(hall_id, import_id, location_code);`,
  `CREATE INDEX IF NOT EXISTS idx_stock_sku ON inventory_stock_rows(hall_id, import_id, sku);`,

  // 7. Inverted Barcode Registry
  `CREATE TABLE IF NOT EXISTS inventory_barcode_index (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL,
    hall_id TEXT NOT NULL,
    barcode_value TEXT NOT NULL,
    sku TEXT NOT NULL,
    barcode_type TEXT NOT NULL CHECK (barcode_type IN ('SKU', 'BARCODE', 'EBARCODE')),
    FOREIGN KEY (import_id) REFERENCES inventory_imports(import_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_barcode_val ON inventory_barcode_index(hall_id, import_id, barcode_value);`,

  // 8. Location Inspections (PDA Operations)
  `CREATE TABLE IF NOT EXISTS location_inspections (
    inspection_id TEXT PRIMARY KEY,
    hall_id TEXT NOT NULL,
    location_code TEXT NOT NULL,
    reference_import_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'VERIFIED', 'PENDING_REVIEW', 'CLOSED')),
    operator_id TEXT,
    is_empty_confirmed INTEGER DEFAULT 0,
    notes TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    completed_at TEXT
  );`,

  `CREATE INDEX IF NOT EXISTS idx_insp_hall_loc ON location_inspections(hall_id, location_code);`,

  // 9. SKU Inspections (Actual Quantities & Discrepancies)
  `CREATE TABLE IF NOT EXISTS sku_inspections (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    e_barcode TEXT,
    system_qty INTEGER NOT NULL DEFAULT 0,
    actual_qty INTEGER NOT NULL DEFAULT 0,
    difference_qty INTEGER NOT NULL DEFAULT 0,
    discrepancy_type TEXT CHECK (discrepancy_type IN ('NORMAL', 'SURPLUS', 'SHORTAGE', 'UNEXPECTED_SKU', 'NO_SKU_SURPLUS')),
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    FOREIGN KEY (inspection_id) REFERENCES location_inspections(inspection_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_sku_insp_id ON sku_inspections(inspection_id);`,

  // 10. Inspection Photos
  `CREATE TABLE IF NOT EXISTS inspection_photos (
    photo_id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    sku_inspection_id TEXT,
    object_key TEXT NOT NULL,
    captured_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
    FOREIGN KEY (inspection_id) REFERENCES location_inspections(inspection_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_photo_insp ON inspection_photos(inspection_id);`,
  // New links also retain the intended line while that SKU is still unchecked.
  `CREATE TABLE IF NOT EXISTS inspection_photo_lines (
    photo_id TEXT PRIMARY KEY,
    line_key TEXT NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES inspection_photos(photo_id) ON DELETE CASCADE
  );`
];

/**
 * Ensures all schema tables and initial seed data exist in D1.
 * Completely idempotent: uses CREATE TABLE IF NOT EXISTS and INSERT OR IGNORE.
 * Never drops any table or erases any data.
 */
export async function ensureDatabaseSchema(env: Env): Promise<{ success: boolean; tables: string[]; error?: string }> {
  try {
    for (const sql of SCHEMA_STATEMENTS) {
      await env.DB.prepare(sql).run();
    }

    const tablesResult = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`
    ).all<{ name: string }>();

    return {
      success: true,
      tables: tablesResult.results.map((r) => r.name),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, tables: [], error: msg };
  }
}
