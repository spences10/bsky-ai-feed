CREATE TABLE IF NOT EXISTS feed_posts (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  indexed_at TEXT,
  score REAL,
  text TEXT,
  matched_keywords_json TEXT,
  judge_confidence REAL,
  judge_reason TEXT,
  judge_category TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS feed_posts_order_idx
ON feed_posts (accepted_at DESC, cid DESC);

CREATE INDEX IF NOT EXISTS feed_posts_score_idx
ON feed_posts (score DESC, accepted_at DESC);

CREATE TABLE IF NOT EXISTS candidate_decisions (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  text TEXT NOT NULL,
  indexed_at TEXT,
  judged_at TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  confidence REAL NOT NULL,
  score REAL,
  category TEXT,
  reason TEXT,
  matched_keywords_json TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS candidate_decisions_judged_at_idx
ON candidate_decisions (judged_at DESC);

CREATE INDEX IF NOT EXISTS candidate_decisions_accepted_idx
ON candidate_decisions (accepted, judged_at DESC);

CREATE INDEX IF NOT EXISTS candidate_decisions_category_idx
ON candidate_decisions (category, judged_at DESC);
