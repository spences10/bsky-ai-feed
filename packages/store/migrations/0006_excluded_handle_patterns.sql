CREATE TABLE IF NOT EXISTS excluded_handle_patterns (
  pattern TEXT PRIMARY KEY,
  reason TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS excluded_handle_patterns_enabled_idx
ON excluded_handle_patterns (enabled, pattern);

INSERT OR IGNORE INTO excluded_handle_patterns (pattern, reason)
VALUES
  ('bot\.bsky\.social$', 'bot account handle pattern'),
  ('^arxiv-', 'arXiv repost bot handle pattern');
