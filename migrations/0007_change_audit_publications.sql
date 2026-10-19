-- Existing tasks remain private drafts until explicitly published by a manager.
CREATE TABLE IF NOT EXISTS change_audit_publications (
 task_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','WITHDRAWN','DELETED')),
 revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT (datetime('now','utc')));
INSERT OR IGNORE INTO change_audit_publications(task_id) SELECT id FROM change_audit_tasks;
