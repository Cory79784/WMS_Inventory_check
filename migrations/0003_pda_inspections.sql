-- Migration 0003: PDA Inspections, Actual Quantities, Discrepancies, and Photos
-- Supports PDA on-site verification, physical empty location confirmation, multi-SKU aggregation, and surplus/shortage tracking

CREATE TABLE IF NOT EXISTS location_inspections (
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
);

CREATE INDEX IF NOT EXISTS idx_insp_hall_loc ON location_inspections(hall_id, location_code);

CREATE TABLE IF NOT EXISTS sku_inspections (
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
);

CREATE INDEX IF NOT EXISTS idx_sku_insp_id ON sku_inspections(inspection_id);

CREATE TABLE IF NOT EXISTS inspection_photos (
  photo_id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  sku_inspection_id TEXT,
  object_key TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  FOREIGN KEY (inspection_id) REFERENCES location_inspections(inspection_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photo_insp ON inspection_photos(inspection_id);
