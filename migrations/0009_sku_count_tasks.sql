-- Independent SKU-count tasks, results, claims and image links.
CREATE TABLE IF NOT EXISTS sku_count_tasks (
 id TEXT PRIMARY KEY,hall_id TEXT NOT NULL,name TEXT NOT NULL,plan_json TEXT NOT NULL,request_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','WITHDRAWN','DELETED')),
 revision INTEGER NOT NULL DEFAULT 0,claim_hash TEXT,claimed_by TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sku_count_hall ON sku_count_tasks(hall_id,created_at);
CREATE TABLE IF NOT EXISTS sku_count_results (
 task_id TEXT NOT NULL,location_code TEXT NOT NULL,result_json TEXT NOT NULL,revision INTEGER NOT NULL,saved_at TEXT NOT NULL,
 PRIMARY KEY(task_id,location_code),FOREIGN KEY(task_id) REFERENCES sku_count_tasks(id));
CREATE TABLE IF NOT EXISTS sku_count_photos (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL,location_code TEXT NOT NULL,line_id TEXT NOT NULL,object_key TEXT NOT NULL,
 FOREIGN KEY(task_id) REFERENCES sku_count_tasks(id));
CREATE INDEX IF NOT EXISTS idx_sku_count_photos ON sku_count_photos(task_id);
