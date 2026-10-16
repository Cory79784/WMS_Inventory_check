-- Additive only: legacy photo associations and original bytes are preserved.
CREATE TABLE IF NOT EXISTS inspection_photo_lines (
  photo_id TEXT PRIMARY KEY,
  line_key TEXT NOT NULL,
  FOREIGN KEY (photo_id) REFERENCES inspection_photos(photo_id) ON DELETE CASCADE
);
