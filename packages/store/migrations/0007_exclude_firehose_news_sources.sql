CREATE TABLE IF NOT EXISTS account_sources (
  did TEXT PRIMARY KEY,
  handle TEXT,
  source_class TEXT NOT NULL CHECK (source_class IN ('person', 'company', 'bot', 'news', 'firehose')),
  notes TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS account_sources_class_idx
ON account_sources (source_class, enabled, handle);

INSERT OR IGNORE INTO account_sources (did, handle, source_class, notes)
VALUES
  ('did:plc:nrfqk6t446qme4kb7aiemqig', 'ai-firehose.column.social', 'firehose', 'AI research firehose dominating feed'),
  ('did:plc:lowvryocas54fph3iy3mhthr', 'ai-linkstream.bsky.social', 'firehose', 'AI linkstream account'),
  ('did:plc:acy4bywuzyjw2lro2veqmnfi', 'ai-news.at.thenote.app', 'news', 'AI news aggregator'),
  ('did:plc:54ql2qdr5rrsxh6t3tsnmskr', 'ai-update.bsky.social', 'news', 'AI update account'),
  ('did:plc:2ow4s6cci5ylwwdedvx3qtkx', 'tech-trending.bsky.social', 'news', 'tech trending account'),
  ('did:plc:nw6p3d24ytsnonusaazomao7', 'aws-news.com', 'company', 'AWS news account'),
  ('did:plc:67solp4fz2zeedsxvaxoexjj', 'awsrecentnews.bsky.social', 'company', 'AWS news repost account'),
  ('did:plc:e4wr5lkpn63w5hy6iisnauqu', 'boardwire.bsky.social', 'news', 'company/news wire'),
  ('did:plc:a56dbiks5wmzacs5hsdsxw55', 'mm-hacker-news.bsky.social', 'news', 'Hacker News mirror'),
  ('did:plc:vnicx6somtlid4oz5w2ev7ig', 'claudeupdates.bsky.social', 'news', 'Claude update account'),
  ('did:plc:fld72aj5evgtosa26f2akvss', 'deeprun-news.bsky.social', 'news', 'news aggregator'),
  ('did:plc:3wil263a67244xdtjzg6jhhu', 'watchrrnews.bsky.social', 'news', 'news aggregator'),
  ('did:plc:m2yuqynl2cttvi4k5453yegh', 'feed.igeek.gamer-geek-news.com.ap.brid.gy', 'news', 'bridged news feed'),
  ('did:plc:g7bwmiaavgfbt5ic54gfkyd3', 'lightnews.app', 'news', 'news aggregator'),
  ('did:plc:ydqfebgkofkzvkl6k33m7bmy', 'genticnews.bsky.social', 'news', 'news aggregator'),
  ('did:plc:32r7scd5hucgv552zjfuaigc', 'astroarxiv.bsky.social', 'bot', 'arXiv repost account');

INSERT OR IGNORE INTO excluded_accounts (did, handle, reason)
SELECT did, handle, 'excluded source class: ' || source_class
FROM account_sources
WHERE source_class IN ('company', 'bot', 'news', 'firehose');
