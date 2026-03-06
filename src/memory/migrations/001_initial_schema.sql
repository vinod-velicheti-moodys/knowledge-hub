CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  summary TEXT NOT NULL,
  details TEXT,
  ticket_id TEXT,
  pr_number TEXT,
  files JSONB DEFAULT '[]',
  components JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  embedding vector(384),
  author TEXT,
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  archived BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_events_components ON events USING gin(components);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  ticket_id TEXT,
  current_phase TEXT NOT NULL DEFAULT 'planning',
  active_files JSONB DEFAULT '[]',
  modified_files JSONB DEFAULT '[]',
  decisions JSONB DEFAULT '[]',
  attempts JSONB DEFAULT '[]',
  findings JSONB DEFAULT '[]',
  reusability_matrix JSONB DEFAULT '[]',
  developer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_developer ON sessions(developer);
CREATE INDEX IF NOT EXISTS idx_sessions_files ON sessions USING gin(active_files);

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  confidence REAL DEFAULT 0.3,
  occurrences INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  sources JSONB DEFAULT '[]',
  last_author TEXT,
  embedding vector(384),
  archived BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS pitfalls (
  id TEXT PRIMARY KEY,
  mistake TEXT NOT NULL,
  fix TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_occurred TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  tags JSONB DEFAULT '[]',
  last_author TEXT,
  embedding vector(384),
  archived BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  preference TEXT NOT NULL,
  observed_from JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS evolution (
  id TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  history TEXT NOT NULL,
  current_state TEXT NOT NULL,
  planned_changes TEXT
);

CREATE TABLE IF NOT EXISTS _corrections (
  id TEXT PRIMARY KEY,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
