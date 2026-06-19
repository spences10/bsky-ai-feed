CREATE TABLE IF NOT EXISTS excluded_accounts (
  did TEXT PRIMARY KEY,
  handle TEXT,
  reason TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS excluded_accounts_enabled_idx
ON excluded_accounts (enabled, handle);

INSERT OR IGNORE INTO excluded_accounts (did, handle, reason)
VALUES (
  'did:plc:3mbqqo3dxddhl7nwqmghsn6a',
  'cslg-bot.bsky.social',
  'arXiv repost bot dominating feed'
);
