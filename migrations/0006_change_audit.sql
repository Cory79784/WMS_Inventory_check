-- Independent inventory-change audit. No existing tables or data are modified.
CREATE TABLE IF NOT EXISTS change_audit_tasks (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL,old_import_id TEXT NOT NULL,new_import_id TEXT NOT NULL,
 plan_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now','utc')),
 FOREIGN KEY(old_import_id) REFERENCES inventory_imports(import_id),FOREIGN KEY(new_import_id) REFERENCES inventory_imports(import_id));
CREATE INDEX IF NOT EXISTS idx_change_tasks_hall ON change_audit_tasks(hall_id,created_at);
CREATE TABLE IF NOT EXISTS change_audit_results (
 task_id TEXT NOT NULL,location_code TEXT NOT NULL,result_json TEXT NOT NULL,revision INTEGER NOT NULL,
 saved_at TEXT NOT NULL,PRIMARY KEY(task_id,location_code),FOREIGN KEY(task_id) REFERENCES change_audit_tasks(id));
CREATE TABLE IF NOT EXISTS change_audit_photos (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL,location_code TEXT NOT NULL,line_id TEXT NOT NULL,
 object_key TEXT NOT NULL,FOREIGN KEY(task_id) REFERENCES change_audit_tasks(id));
CREATE INDEX IF NOT EXISTS idx_change_photos_task ON change_audit_photos(task_id);
