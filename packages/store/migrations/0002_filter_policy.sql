CREATE TABLE IF NOT EXISTS filter_keyword_sets (
  name TEXT PRIMARY KEY,
  description TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS filter_keywords (
  keyword_set TEXT NOT NULL REFERENCES filter_keyword_sets(name) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (keyword_set, phrase)
) STRICT;

CREATE INDEX IF NOT EXISTS filter_keywords_enabled_idx
ON filter_keywords (keyword_set, enabled, phrase);

CREATE TABLE IF NOT EXISTS filter_suppression_patterns (
  pattern TEXT PRIMARY KEY,
  reason TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)) DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX IF NOT EXISTS filter_suppression_patterns_enabled_idx
ON filter_suppression_patterns (enabled, pattern);

INSERT OR IGNORE INTO filter_keyword_sets (name, description)
VALUES ('default', 'Global AI feed keyword prefilter');

INSERT OR IGNORE INTO filter_keywords (keyword_set, phrase)
VALUES
  ('default', 'AI'),
  ('default', 'AGI'),
  ('default', 'LLM'),
  ('default', 'GPT'),
  ('default', 'ChatGPT'),
  ('default', 'Claude'),
  ('default', 'OpenAI'),
  ('default', 'Anthropic'),
  ('default', 'Gemini'),
  ('default', 'Copilot'),
  ('default', 'Llama'),
  ('default', 'Mistral'),
  ('default', 'machine learning'),
  ('default', 'deep learning'),
  ('default', 'neural network'),
  ('default', 'generative AI'),
  ('default', 'prompt engineering'),
  ('default', 'AI model'),
  ('default', 'language model');

INSERT OR IGNORE INTO filter_suppression_patterns (pattern, reason)
VALUES
  ('#[A-Z0-9]*(?:Crypto|DePIN|AIJobs|Hiring)[A-Z0-9]*', 'hashtag spam'),
  ('\bsmart money\s+(?:accumulated|dumped)\b', 'trading spam'),
  ('\b(?:price|trend):\s*[$+\-0-9.]', 'market ticker spam'),
  ('\btopgenaijobs\.com\b', 'job spam'),
  ('\b(?:AI|ML|GenAI)\s+(?:job|jobs|hiring)\b', 'job spam'),
  ('\brank in AI search results\b', 'seo spam'),
  ('\bcontent repurposing playbook\b', 'marketing spam'),
  ('\b(?:read more|learn more)\s*[👉→]', 'link bait'),
  ('\b(?:zurl\.co|lttr\.ai)\/', 'link farm'),
  ('\bcreated with\s+(?:AI|recraft\.ai)\b', 'image credit'),
  ('\bAI[- ]generated\)?\s*$', 'image credit'),
  ('\b(?:AI|generated)\s+(?:art|artist|artists|image|images|video|videos)\b', 'ai media noise'),
  ('\b(?:art|image|video)s?\s+(?:made|created|generated)\s+(?:with|by)\s+AI\b', 'ai media noise'),
  ('\bAI\s+slop\b', 'culture-war noise'),
  ('\b(?:nazi|nazis|hitler|fascist|fascism)\b', 'political bait');
