CREATE INDEX IF NOT EXISTS idx_events_embedding ON events
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_patterns_embedding ON patterns
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_pitfalls_embedding ON pitfalls
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
