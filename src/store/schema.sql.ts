export const SCHEMA_VERSION = 2;

export const USER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  type INTEGER NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  last_message_id TEXT,
  newest_synced_id TEXT,
  oldest_synced_id TEXT,
  backfill_done INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  tracked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  edited_ts INTEGER,
  has_link INTEGER NOT NULL DEFAULT 0,
  has_image INTEGER NOT NULL DEFAULT 0,
  has_file INTEGER NOT NULL DEFAULT 0,
  has_youtube INTEGER NOT NULL DEFAULT 0,
  attachments TEXT
);

CREATE INDEX IF NOT EXISTS idx_msg_channel_ts ON messages(channel_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_msg_author ON messages(channel_id, author_id, ts DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  search_text,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO messages_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
END;

CREATE TABLE IF NOT EXISTS embeddings (
  message_id TEXT PRIMARY KEY,
  vec BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS backfill_seen (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);
`;
