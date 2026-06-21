CREATE INDEX IF NOT EXISTS feed_posts_recency_score_idx
ON feed_posts (accepted_at DESC, score DESC, cid DESC);

INSERT OR IGNORE INTO account_sources (did, handle, source_class, notes)
VALUES
  ('did:plc:vmkx7lvcmmcoiycsz4wqwioq', 'devopsbriefly.bsky.social', 'news', 'AI/devops news brief account'),
  ('did:plc:pcievrygrnjjg5ni7mjfgctb', 'hacker.at.thenote.app', 'news', 'news mirror account'),
  ('did:plc:nqs6ukshmhbkdbihf6kaeax6', 'hnfeed.bsky.social', 'news', 'Hacker News mirror'),
  ('did:plc:s4xmseub4a4pwwetg2xxmcyy', 'hn100.bsky.social', 'news', 'Hacker News mirror'),
  ('did:plc:kqj4vuyjvmtnptvvdt2xijtk', 'newsarea.bsky.social', 'news', 'news aggregator'),
  ('did:plc:ksubnc3tnvhynkmszhw5zsyh', 'infosecbriefly.bsky.social', 'news', 'infosec news brief account'),
  ('did:plc:s2kbtwkxjk7rrxebsoqzscwd', '1ban-news.bsky.social', 'news', 'AI/news aggregator'),
  ('did:plc:u6celkmubfsmbus5m3aqcrla', 'hendryadrian.bsky.social', 'news', 'AI/security news repost account');

INSERT OR IGNORE INTO excluded_accounts (did, handle, reason)
SELECT did, handle, 'excluded source class: ' || source_class
FROM account_sources
WHERE source_class IN ('company', 'bot', 'news', 'firehose');

DELETE FROM feed_posts
WHERE uri GLOB 'at://did:plc:vmkx7lvcmmcoiycsz4wqwioq/*'
  OR uri GLOB 'at://did:plc:pcievrygrnjjg5ni7mjfgctb/*'
  OR uri GLOB 'at://did:plc:nqs6ukshmhbkdbihf6kaeax6/*'
  OR uri GLOB 'at://did:plc:s4xmseub4a4pwwetg2xxmcyy/*'
  OR uri GLOB 'at://did:plc:kqj4vuyjvmtnptvvdt2xijtk/*'
  OR uri GLOB 'at://did:plc:ksubnc3tnvhynkmszhw5zsyh/*'
  OR uri GLOB 'at://did:plc:s2kbtwkxjk7rrxebsoqzscwd/*'
  OR uri GLOB 'at://did:plc:u6celkmubfsmbus5m3aqcrla/*';
