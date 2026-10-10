-- Migration 0001: Phase 0 Schema & Foundation
-- Compatible with Cloudflare D1 (SQLite)

-- 1. Hall Isolation (H1, H2, H3)
CREATE TABLE IF NOT EXISTS halls (
  hall_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
);

-- Seed initial 3 halls
INSERT OR IGNORE INTO halls (hall_id, name, description) VALUES
  ('H1', '1号厅 (Hall 1)', '海外仓 H1 区域'),
  ('H2', '2号厅 (Hall 2)', '海外仓 H2 区域'),
  ('H3', '3号厅 (Hall 3)', '海外仓 H3 区域');

-- 2. Cloudflare Access Authenticated Users
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  employee_id TEXT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
);

-- 3. User Roles (ADMIN, OPERATOR, REVIEWER)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'REVIEWER')),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 4. D1 Read/Write Verification Table for Phase 0
CREATE TABLE IF NOT EXISTS phase0_diagnostics (
  id TEXT PRIMARY KEY,
  test_key TEXT NOT NULL,
  test_value TEXT NOT NULL,
  client_timestamp TEXT,
  server_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
  notes TEXT
);

-- 5. Audit Events (Traceability)
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  hall_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
);
