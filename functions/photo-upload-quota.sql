CREATE TABLE IF NOT EXISTS photo_upload_quota (
  month TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (month, ip_hash)
);
