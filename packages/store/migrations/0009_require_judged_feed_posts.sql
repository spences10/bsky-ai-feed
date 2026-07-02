INSERT OR IGNORE INTO filter_suppression_patterns (pattern, reason)
VALUES
  ('#[A-Z0-9]*(?:Crypto|DePIN|AIJobs|Hiring|Finance)[A-Z0-9]*', 'hashtag spam'),
  ('\b(?:stock|stocks|shares?)\s+(?:to buy|rally|surge|falls?|jumps?)\b', 'market spam'),
  ('\b(?:black market|sovereign wealth fund)\b', 'market/political news noise'),
  ('\b(?:not|isn''?t)\s+AI\b', 'AI accusation/meta noise');

DELETE FROM feed_posts
WHERE judge_confidence IS NULL
   OR COALESCE(score, 0) < 0.65;
