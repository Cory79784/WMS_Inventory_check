-- Migration 0002: Cloudflare D1 WMS Version Management & Barcode Index
-- Supports non-destructive historical snapshots, staging, active version pointer, and inverted barcode index

-- 1. Active Hall Import Pointers
CREATE TABLE IF NOT EXISTS active_hall_imports (
  hall_id TEXT PRIMARY KEY,
  active_import_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (hall_id) REFERENCES halls(hall_id)
);

INSERT OR IGNORE INTO active_hall_imports (hall_id, active_import_id) VALUES
  ('H1', NULL),
  ('H2', NULL),
  ('H3', NULL);

-- 2. Inventory Imports (Snapshots)
CREATE TABLE IF NOT EXISTS inventory_imports (
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
);

CREATE INDEX IF NOT EXISTS idx_imports_hall_status ON inventory_imports(hall_id, status);
CREATE INDEX IF NOT EXISTS idx_imports_sha ON inventory_imports(hall_id, file_sha256);

-- 3. Stock Detail Rows (Sparse Inventory Lines)
CREATE TABLE IF NOT EXISTS inventory_stock_rows (
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
);

CREATE INDEX IF NOT EXISTS idx_stock_lookup ON inventory_stock_rows(hall_id, import_id, location_code);
CREATE INDEX IF NOT EXISTS idx_stock_sku ON inventory_stock_rows(hall_id, import_id, sku);

-- 4. Inverted Barcode Registry for Ultra-Fast & Multi-valued Search (Decision 3 Option A)
CREATE TABLE IF NOT EXISTS inventory_barcode_index (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  hall_id TEXT NOT NULL,
  barcode_value TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode_type TEXT NOT NULL CHECK (barcode_type IN ('SKU', 'BARCODE', 'EBARCODE')),
  FOREIGN KEY (import_id) REFERENCES inventory_imports(import_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_barcode_val ON inventory_barcode_index(hall_id, import_id, barcode_value);
