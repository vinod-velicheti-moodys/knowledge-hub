# TIQ Knowledge MCP — Memory Architecture

> A detailed reference for every data structure, flow, and component in the system.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Deployment Model](#2-deployment-model)
3. [Configuration Layer](#3-configuration-layer)
4. [Memory Layers](#4-memory-layers)
   - [Semantic Memory (Layer 0)](#41-semantic-memory-layer-0)
   - [Short-Term Memory (Layer 1)](#42-short-term-memory-layer-1)
   - [Factual Memory (Layer 2)](#43-factual-memory-layer-2)
   - [Long-Term Memory (Layer 3)](#44-long-term-memory-layer-3)
5. [Embedding & Similarity Engine](#5-embedding--similarity-engine)
6. [Database Schema](#6-database-schema)
7. [The Promotion Pipeline](#7-the-promotion-pipeline)
8. [MCP Tool Surface](#8-mcp-tool-surface)
9. [Seeding Pipeline](#9-seeding-pipeline)
10. [Data Flow Diagrams](#10-data-flow-diagrams)
11. [Error Modes & Degraded Operation](#11-error-modes--degraded-operation)

---

## 1. System Overview

The TIQ Knowledge MCP is a **Model Context Protocol server** that gives Cursor (and any MCP-compatible AI client) a persistent, searchable memory about the TreatyIQ codebase, team decisions, JIRA history, and coding standards.

It is composed of **four memory layers**, each with a different lifetime, data type, and retrieval method:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Client (Cursor / AI)                     │
│              calls tools via stdio JSON-RPC 2.0                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                   TIQ Knowledge MCP Server                      │
│                  (Node.js, stdio transport)                     │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Semantic   │  │  Short-Term  │  │  Factual + Long-Term   │  │
│  │  Memory     │  │  Memory      │  │  Memory                │  │
│  │  (in-proc)  │  │  (postgres)  │  │  (postgres+pgvector)   │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Embedding Engine (@huggingface/transformers, local CPU)  │  │
│  │  Model: Xenova/all-MiniLM-L6-v2 → 384-dim float32 vectors │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│           PostgreSQL 16 + pgvector extension                    │
│           (shared, team-wide, Docker container)                 │
│                                                                 │
│   tables: events, sessions, patterns, pitfalls,                 │
│           preferences, evolution, _meta, _corrections,          │
│           _migrations                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Deployment Model

| Component | Where it runs | Lifetime |
|-----------|--------------|---------|
| MCP Server process | Local machine per developer (stdio) | Per Cursor session |
| PostgreSQL + pgvector | Shared Docker container (`tiq-knowledge-db`) | Persistent, shared |
| Embedding model | Local CPU, lazy-loaded on first use | Cached in-process |
| `.cursor/rules` files | Local filesystem of the target repo | Read on server startup |

Every developer runs their **own MCP server process** locally. All server instances **write to the same shared PostgreSQL database**, creating a shared team knowledge pool.

```
Developer A (Mac)               Developer B (Mac)
┌─────────────────┐             ┌─────────────────┐
│  Cursor         │             │  Cursor         │
│  MCP Server     │             │  MCP Server     │
│  (process A)    │             │  (process B)    │
└────────┬────────┘             └────────┬────────┘
         │ writes/reads                  │ writes/reads
         └───────────────┬───────────────┘
                  ┌──────▼──────┐
                  │  PostgreSQL │ ← shared team knowledge
                  └─────────────┘
```

---

## 3. Configuration Layer

**File:** `src/config.ts`

The server is configured entirely through environment variables, validated with `zod` at startup:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MCP_PROJECT_ROOT` | Yes | — | Absolute path to the target repo |
| `MCP_DB_URL` | Yes | — | PostgreSQL connection string |
| `MCP_DEVELOPER_NAME` | Yes | — | Identity for session scoping |
| `MCP_PROJECT_NAME` | No | directory name | Project identifier |
| `MCP_RULES_DIR` | No | `<root>/.cursor/rules` | Where `.mdc` rule files live |
| `MCP_AGENTS_DIR` | No | `<root>/.cursor/agents` | Where agent workflow `.md` files live |
| `MCP_SKILLS_DIRS` | No | `<root>/.cursor/skills` | Comma-separated skill directories |
| `MCP_FRAMEWORK` | No | `nuxt2` | Framework identifier |
| `MCP_PARSERS` | No | `vue2-component,vuex-store,axios-service,nuxt2-route` | Comma-separated parser IDs to activate |
| `MCP_EMBEDDING_MODEL` | No | `Xenova/all-MiniLM-L6-v2` | HuggingFace model ID |
| `MCP_SIMILARITY_THRESHOLD` | No | `0.85` | Cosine similarity cutoff for dedup/promotion |

All configuration is done through env vars — no project-level config file needed.

---

## 4. Memory Layers

### 4.1 Semantic Memory (Layer 0)

**File:** `src/memory/semantic.ts` + `src/parsers/`

**Type:** In-process, read-only, stateless  
**Persistence:** None — sourced from filesystem on startup  
**Purpose:** Coding standards, architecture rules, agent workflows, component API docs, live code structure

#### Data sources

| Source | Namespace | Parser | Data produced |
|--------|-----------|--------|--------------|
| `.cursor/rules/*.mdc` | `rule` | `rules-parser.ts` → `loadRules()` | `RuleEntry` objects: title, description, content, YAML frontmatter |
| `.cursor/agents/*.md` | `agent` | `rules-parser.ts` → `loadAgents()` | Agent workflow instructions (planner, architect, developer, etc.) |
| `.cursor/skills/<group>/SKILL.md` | `skill` | `rules-parser.ts` → `loadSkills()` | Skill summary per group |
| `.cursor/skills/<group>/reference.md` | `skill` | `rules-parser.ts` → `loadSkills()` with section-splitting | Per-component API docs (e.g. `skill:radius-vue2/radiusbutton`) |
| `frontend/**/*.vue` | — | `vue2-component-parser.ts` | Component props, emits, data, methods, imports |
| `frontend/store/**/*.ts` | — | `vuex-store-parser.ts` | Store state shape, mutations, actions, getters |
| `frontend/services/**/*.ts` | — | `axios-service-parser.ts` | API endpoint methods, base URLs, request/response shapes |
| `frontend/pages/` directory | — | `nuxt2-route-parser.ts` | File-based route tree |

#### `RuleEntry` data structure

```typescript
type KnowledgeNamespace = "rule" | "agent" | "skill";

interface RuleEntry {
  title: string;             // filename without extension, or section heading for split skills
  description: string;       // YAML frontmatter `description` field
  content: string;           // full markdown body
  sourcePath: string;        // absolute path to the source file
  namespace: KnowledgeNamespace; // which knowledge type this entry belongs to
  globs: string[];
  alwaysApply: boolean;
}
```

#### How it works

1. On server startup, `SemanticMemory` loads from three directory types:
   - `loadRules(rulesDir)` — scans `*.mdc` and `*.md` files, keys are plain filenames (e.g. `vue-standards`)
   - `loadAgents(agentsDir)` — scans `*.md` files, keys are prefixed `agent:<stem>` (e.g. `agent:developer`)
   - `loadSkills(skillsDirs)` — walks subdirectories. `SKILL.md` → `skill:<group>`. `reference.md` → section-split on `##` headings into `skill:<group>/<slug>` if >500 lines, otherwise stored whole as `skill:<group>/reference`.
2. All entries are merged into a single `Map<string, RuleEntry>`.
3. Each entry carries a `namespace` field (`"rule"`, `"agent"`, `"skill"`) to prevent cross-contamination during search.
4. On-demand parsing (components, stores, services) is dispatched through `ParserRegistry` which dynamically imports built-in plugins.

#### Section-splitting for large files

`reference.md` files (e.g. `radius-vue2/reference.md` at 7,307 lines) are split on `## ` headings at load time. Each section becomes a separate entry (typically 50–200 lines) with a slugified key. This keeps entries within context window limits.

#### Search algorithm (namespace-aware)

`searchStandards(query, namespace?)` uses word-tokenisation scoring:
```
score = count of query terms found in (title + description + content)
```
When a `namespace` filter is provided, entries from other namespaces are skipped. This prevents `get_standard("vuex")` from returning agent workflow files that merely mention vuex.

#### Dedicated tools per namespace

| Tool | Namespace | Purpose |
|------|-----------|---------|
| `get_standard(topic)` | `rule` | Coding standards and rules |
| `get_agent(name)` | `agent` | Agent phase workflows |
| `get_skill(name)` | `skill` | Component API docs and skill summaries |

Each tool returns a list of available entries when no match is found.

---

### 4.2 Short-Term Memory (Layer 1)

**File:** `src/memory/short-term.ts`  
**Table:** `sessions`  
**Type:** Write-through persistent, scoped per developer  
**Purpose:** Working memory for the current task — tracks what you're doing right now

#### Session data structure

```typescript
interface Session {
  sessionId: string;           // UUID, primary key
  taskId: string;              // human-readable task name e.g. "TIM-10647"
  summary: string;             // one-line description of the task
  ticket?: {                   // optional linked JIRA ticket
    id: string;
    summary: string;
    acceptanceCriteria: string[];
  };
  currentPhase: "planning" | "development" | "testing" | "review";
  activeFiles: string[];       // files currently being worked on
  modifiedFiles: string[];     // files that have been changed
  decisions: {                 // architectural/implementation decisions
    what: string;
    why: string;
    timestamp: string;
  }[];
  attempts: {                  // things tried (successes and failures)
    action: string;
    outcome: "success" | "failed";
    reason?: string;
    timestamp: string;
  }[];
  findings: {                  // arbitrary key-value facts discovered
    key: string;
    value: unknown;
  }[];
  reusabilityMatrix: {         // component reuse decisions
    needed: string;
    existingMatch: string | null;
    decision: string;
    justification: string;
  }[];
  developer: string;           // from MCP_DEVELOPER_NAME
  status: "active" | "completed";
  startedAt: string;
  lastActivity: string;
}
```

#### Write strategy: write-through

Every mutation (add decision, add attempt, change phase) immediately calls `flush()` which does an `INSERT ... ON CONFLICT DO UPDATE` upsert to PostgreSQL. This means:
- In-memory cache (`this.cache`) is always consistent with DB
- Crash recovery is possible via `task_recover` tool
- Other developers' sessions are visible in real-time (conflict detection)

#### Conflict detection

`getConflicts(files?)` queries **all other active sessions** from other developers and finds overlapping `active_files`. This allows the AI to warn: *"Developer X is also working on this file."*

---

### 4.3 Factual Memory (Layer 2)

**File:** `src/memory/factual.ts`  
**Table:** `events`  
**Type:** Append-only with soft-delete, vector-indexed  
**Purpose:** Historical record of everything that happened — git commits, JIRA tickets, completed tasks

#### Event data structure

```typescript
interface FactualEvent {
  id: string;           // "type:ticketId:timestamp" or UUID
  type: string;         // "feature" | "bug_fix" | "refactor" | "migration" | "decision"
  timestamp: string;    // ISO 8601
  summary: string;      // min 10 chars, used for embedding
  details?: string;     // extended description (up to 2000 chars)
  ticketId?: string;    // e.g. "TIM-10647"
  prNumber?: string;    // e.g. "3247"
  files?: string[];     // file paths touched
  components?: string[]; // component names
  tags?: string[];      // searchable tags (store, vue, testing, etc.)
  author?: string;      // committer or "jira-seed"
}
```

#### ID generation strategy

```
If ticketId present:  id = "{type}:{ticketId}:{Date.now()}"
                           e.g. "feature:TIM-10647:1772794661268"
Otherwise:            id = UUID v4
```

#### Write path with deduplication

```
recordEvent(event)
  │
  ├─ Validate: summary.length >= 10
  │
  ├─ Generate embedding: embed(summary + details)
  │   └─ Calls @huggingface/transformers pipeline
  │   └─ Returns float32[384]
  │
  ├─ Deduplication check (if embedding succeeded):
  │   └─ findSimilar(pool, embedding, "events", topK=1, {archived: false})
  │   └─ Uses pgvector HNSW index: embedding <=> $1::vector
  │   └─ IF score > 0.95 AND event age < 24h → SKIP, return existing id
  │
  └─ INSERT INTO events (... embedding::vector ...)
```

#### Retrieval methods

| Method | SQL strategy | Use case |
|--------|-------------|---------|
| `recallByTags(tags[])` | `tags @> $1::jsonb` (GIN index) | "show all vuex bug fixes" |
| `recallByTicket(ticketId)` | `ticket_id = $1` (B-tree index) | "what happened with TIM-10647" |
| `recallByComponent(name)` | `components::text ILIKE $1 OR files::text ILIKE $1` | "all events touching pricing" |
| `recallSimilar(query)` | Embedding → HNSW cosine search | "find events similar to this description" |
| `recallDecisions(topic)` | Embedding → HNSW cosine search, `type = 'decision'` | "past decisions about this topic" |

After every `recallSimilar` call, `last_accessed` is updated — this supports future LRU-based pruning.

#### Pruning

`prune(olderThanMonths=24)` soft-deletes old events by setting `archived = true`. They are excluded from all queries but not physically deleted, preserving the audit trail.

---

### 4.4 Long-Term Memory (Layer 3)

**File:** `src/memory/long-term.ts`  
**Tables:** `patterns`, `pitfalls`, `preferences`, `evolution`  
**Type:** Mutable, confidence-weighted, vector-indexed  
**Purpose:** Accumulated institutional wisdom — what works, what doesn't, team preferences

#### 4.4.1 Patterns

Learned best practices that emerge from repeated decisions.

```typescript
interface Pattern {
  id: string;           // UUID
  pattern: string;      // "Use ag-theme-radius for all AG Grid tables"
  category: string;     // "best-practice" | "architecture" | "testing" | ...
  confidence: number;   // 0.0–1.0, starts at 0.3, grows with reinforcement
  occurrences: number;  // times this pattern was observed
  firstSeen: string;    // ISO timestamp
  lastSeen: string;     // ISO timestamp
  sources: string[];    // session IDs that contributed
}
```

**Confidence lifecycle:**
- New pattern from session decision → `confidence = 0.3`
- Each reinforcement (same pattern seen again) → `confidence = MIN(confidence + 0.1, 1.0)`
- Inactive > 6 months → `confidence = confidence * 0.85` (decay)
- `confidence < 0.1` → `archived = true` (auto-retire)

#### 4.4.2 Pitfalls

Recorded mistakes and their fixes.

```typescript
interface Pitfall {
  id: string;           // UUID
  mistake: string;      // what went wrong
  fix: string;          // what solved it
  frequency: number;    // times this mistake was made
  lastOccurred: string; // ISO timestamp
  tags: string[];       // e.g. ["TIM-10647", "vuex"]
}
```

**Promoted from:** Failed `attempts` in sessions where a subsequent `success` attempt exists (the success becomes the `fix`).

#### 4.4.3 Preferences

Static team preferences observed over time.

```typescript
interface Preference {
  id: string;
  topic: string;        // "table_library" | "styling" | "state_management"
  preference: string;   // "ag-grid" | "tailwind" | "vuex"
  observedFrom: string[]; // sources (task IDs, manual seeds)
}
```

No vectors — retrieved by exact/ILIKE text match on `topic`.

#### 4.4.4 Evolution

Architecture history records.

```typescript
interface Evolution {
  id: string;
  area: string;           // "authentication" | "pricing" | "risk-sources"
  history: string;        // how it used to work
  currentState: string;   // how it works now
  plannedChanges?: string; // what's coming
}
```

---

## 5. Embedding & Similarity Engine

**Files:** `src/memory/embeddings.ts`, `src/memory/similarity.ts`

### Embedding model

| Property | Value |
|----------|-------|
| Model | `Xenova/all-MiniLM-L6-v2` |
| Library | `@huggingface/transformers` (falls back to `@xenova/transformers`) |
| Output dimensions | 384 float32 values |
| Pooling | Mean pooling over token embeddings |
| Normalisation | L2-normalised (unit vectors) |
| Quantization | 8-bit quantized for CPU speed |
| Loading | Lazy — first embed() call triggers download and cache |

**Why this model:** It is fast enough to run on CPU without a GPU, produces good semantic similarity for short texts (commit messages, ticket summaries, code decisions), and its 384-dim output is compact for storage.

### Model version guard

On every DB init, the model ID is stored in `_meta`:
```sql
INSERT INTO _meta (key, value) VALUES ('embedding_model', 'Xenova/all-MiniLM-L6-v2')
```
If a developer tries to run with a different model, startup throws:
```
Embedding model mismatch: DB was seeded with "X" but this instance uses "Y".
All team members must use the same model.
```
This prevents incompatible vectors being mixed in the same table.

### Similarity search

**SQL operator used:** `<=>` (cosine distance, pgvector)

```sql
SELECT *, 1 - (embedding <=> $1::vector) AS score
FROM events
WHERE embedding IS NOT NULL AND archived = false
ORDER BY embedding <=> $1::vector
LIMIT $2
```

`score = 1 - cosine_distance` → ranges from 0 (unrelated) to 1.0 (identical).

### HNSW vector indexes

Migration 002 creates Hierarchical Navigable Small World indexes on `events`, `patterns`, and `pitfalls`:

```sql
CREATE INDEX idx_events_embedding ON events
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

| Parameter | Value | Meaning |
|-----------|-------|---------|
| `m` | 16 | Connections per node (higher = better recall, more memory) |
| `ef_construction` | 64 | Build-time search width (higher = better quality, slower build) |

HNSW gives approximate nearest-neighbor search in `O(log n)` vs exact `O(n)` linear scan.

---

## 6. Database Schema

### `_migrations`
```sql
version     INTEGER PRIMARY KEY
applied_at  TIMESTAMPTZ
```
Tracks schema version. Migration runner uses `pg_advisory_lock(738291)` to prevent concurrent migrations across multiple server instances.

### `_meta`
```sql
key    TEXT PRIMARY KEY
value  TEXT NOT NULL
```
Currently stores: `embedding_model` = model identifier string.

### `events` (Factual Memory)
```sql
id            TEXT PRIMARY KEY         -- "type:ticketId:ms" or UUID
type          TEXT NOT NULL            -- feature | bug_fix | refactor | migration | decision
timestamp     TIMESTAMPTZ DEFAULT NOW()
summary       TEXT NOT NULL            -- min 10 chars, embedded
details       TEXT                     -- up to 2000 chars
ticket_id     TEXT                     -- "TIM-XXXXX"
pr_number     TEXT                     -- GitHub PR number
files         JSONB DEFAULT '[]'       -- string[]
components    JSONB DEFAULT '[]'       -- string[]
tags          JSONB DEFAULT '[]'       -- string[]
embedding     vector(384)              -- null if embedding failed
author        TEXT                     -- committer name or "jira-seed"
last_accessed TIMESTAMPTZ DEFAULT NOW()
archived      BOOLEAN DEFAULT false

-- Indexes
idx_events_type       B-tree on type
idx_events_ticket     B-tree on ticket_id
idx_events_tags       GIN on tags
idx_events_components GIN on components
idx_events_embedding  HNSW cosine on embedding
```

### `sessions` (Short-Term Memory)
```sql
session_id         TEXT PRIMARY KEY    -- UUID
task_id            TEXT NOT NULL       -- e.g. "TIM-10647"
summary            TEXT NOT NULL
ticket_id          TEXT                -- linked JIRA ticket
current_phase      TEXT DEFAULT 'planning'
active_files       JSONB DEFAULT '[]'  -- files open right now
modified_files     JSONB DEFAULT '[]'  -- files changed
decisions          JSONB DEFAULT '[]'  -- [{what, why, timestamp}]
attempts           JSONB DEFAULT '[]'  -- [{action, outcome, reason, timestamp}]
findings           JSONB DEFAULT '[]'  -- [{key, value}]
reusability_matrix JSONB DEFAULT '[]'
developer          TEXT NOT NULL       -- MCP_DEVELOPER_NAME
status             TEXT DEFAULT 'active'
started_at         TIMESTAMPTZ DEFAULT NOW()
last_activity      TIMESTAMPTZ DEFAULT NOW()

-- Indexes
idx_sessions_status    B-tree on status
idx_sessions_developer B-tree on developer
idx_sessions_files     GIN on active_files
```

### `patterns` (Long-Term Memory)
```sql
id            TEXT PRIMARY KEY    -- UUID
pattern       TEXT NOT NULL       -- the best-practice text
category      TEXT NOT NULL       -- "best-practice" | "architecture" | etc.
confidence    REAL DEFAULT 0.3    -- 0.0–1.0
occurrences   INTEGER DEFAULT 1
first_seen    TIMESTAMPTZ DEFAULT NOW()
last_seen     TIMESTAMPTZ DEFAULT NOW()
last_accessed TIMESTAMPTZ DEFAULT NOW()
sources       JSONB DEFAULT '[]'  -- session IDs that observed this
last_author   TEXT
embedding     vector(384)
archived      BOOLEAN DEFAULT false

-- Index: HNSW cosine on embedding
```

### `pitfalls` (Long-Term Memory)
```sql
id            TEXT PRIMARY KEY    -- UUID
mistake       TEXT NOT NULL       -- what went wrong
fix           TEXT NOT NULL       -- what solved it
frequency     INTEGER DEFAULT 1
last_occurred TIMESTAMPTZ DEFAULT NOW()
last_accessed TIMESTAMPTZ DEFAULT NOW()
tags          JSONB DEFAULT '[]'
last_author   TEXT
embedding     vector(384)         -- embed(mistake + fix)
archived      BOOLEAN DEFAULT false

-- Index: HNSW cosine on embedding
```

### `preferences` (Long-Term Memory)
```sql
id            TEXT PRIMARY KEY    -- UUID
topic         TEXT NOT NULL       -- "table_library"
preference    TEXT NOT NULL       -- "ag-grid"
observed_from JSONB DEFAULT '[]'  -- source references
-- No embedding (text-only retrieval)
```

### `evolution` (Long-Term Memory)
```sql
id               TEXT PRIMARY KEY  -- UUID
area             TEXT NOT NULL     -- "authentication"
history          TEXT NOT NULL     -- how it used to work
current_state    TEXT NOT NULL     -- how it works now
planned_changes  TEXT              -- what's coming
-- No embedding (text-only retrieval)
```

### `_corrections` (Admin audit trail)
```sql
id           TEXT PRIMARY KEY
target_table TEXT NOT NULL    -- "events" | "patterns" | "pitfalls"
target_id    TEXT NOT NULL    -- ID of corrected record
action       TEXT NOT NULL    -- "correct" | "delete"
field        TEXT             -- field that was changed
old_value    TEXT
new_value    TEXT
reason       TEXT NOT NULL    -- why the correction was made
author       TEXT NOT NULL    -- who made it
created_at   TIMESTAMPTZ DEFAULT NOW()
```

---

## 7. The Promotion Pipeline

**File:** `src/memory/promotion.ts`

This is the key mechanism that converts **short-term working memory into long-term institutional knowledge**. It runs automatically when `task_end` is called.

```
task_end (tool call)
  │
  ├─ 1. Mark session.status = "completed"
  ├─ 2. Flush to sessions table
  └─ 3. Call promoteFromSession(session, factual, longTerm)
         │
         ├─ A. Create session summary event in factual memory
         │      type: "feature"
         │      summary: "{taskId}: {summary}"
         │      details: developer, phase, decisions list
         │      files: session.modifiedFiles
         │      tags: [currentPhase, "task-completion"]
         │
         ├─ B. For each FAILED attempt:
         │      ├─ embed(attempt.action)
         │      ├─ findSimilarPitfall(text, threshold=0.85)
         │      │   ├─ IF similar pitfall exists → incrementPitfall (frequency++)
         │      │   └─ IF no similar pitfall:
         │      │       ├─ Find next SUCCESS attempt after this failure
         │      │       └─ IF found → addPitfall(mistake=attempt, fix=success)
         │      └─ (if no follow-up success: pitfall is skipped)
         │
         └─ C. For each DECISION:
                ├─ embed("{decision.what} {decision.why}")
                ├─ findSimilarPattern(text, threshold=0.85)
                │   ├─ IF similar pattern exists → reinforcePattern
                │   │     occurrences++, confidence += 0.1 (max 1.0)
                │   └─ IF no similar pattern → addPattern
                │         pattern: "{what} — {why}"
                │         category: "best-practice"
                │         confidence: 0.3 (new)
                └─ Done
```

### Confidence growth model for patterns

```
Initial seed (manual YAML):     confidence = custom or 0.3
First organic decision:         confidence = 0.3
Second time same pattern seen:  confidence = 0.4
...
10th reinforcement:             confidence = 1.0 (capped)

Inactive 6 months:              confidence *= 0.85 per cycle
Falls below 0.1:                archived = true (auto-retire)
```

---

## 8. MCP Tool Surface

The server exposes **28 tools** across 6 groups, all via `stdio` JSON-RPC 2.0:

### Semantic tools (7) — read from Layer 0

| Tool | Input | Returns |
|------|-------|---------|
| `get_standard` | `topic: string` | Matching `.mdc` rule content (rules namespace only) |
| `get_agent` | `name: string` | Agent workflow instructions (e.g. `developer`, `architect`, `planner`) |
| `get_skill` | `name: string` | Skill/component API docs (e.g. `radius-vue2`, `radius-vue2/radiusbutton`) |
| `get_architecture` | `query: string` | Architecture rule content |
| `get_component_graph` | `name: string` | Vue component props/emits/methods |
| `get_store_module` | `module: string` | Vuex state/mutations/actions |
| `get_service_api` | `service: string` | Axios service endpoints |

### Task tools (8) — read/write Layer 1

| Tool | What it does |
|------|-------------|
| `task_start` | Creates a new session, enforces one-at-a-time per developer |
| `task_context` | Returns current session state |
| `task_decide` | Appends a decision `{what, why}` to session, flushes to DB |
| `task_attempt` | Records an attempt `{action, outcome, reason}` |
| `task_find` | Searches related past sessions by task ID or files |
| `task_end` | Marks session completed, triggers promotion pipeline |
| `task_recover` | Recovers a crashed/abandoned session from DB |
| `task_conflicts` | Shows which files other developers are working on |

### Factual tools (5) — read/write Layer 2

| Tool | What it does |
|------|-------------|
| `record_event` | Manually record a factual event |
| `recall_events` | Search events by `query` (semantic), `tags`, or `ticketId` |
| `recall_decisions` | Semantic search over `type='decision'` events |
| `recall_for_component` | ILIKE search on `components` and `files` columns |
| `memory_prune` | Soft-archive events older than N months |

### Long-term tools (4) — read from Layer 3

| Tool | What it does |
|------|-------------|
| `get_wisdom` | Combined semantic search across patterns + pitfalls + preferences |
| `get_pitfalls` | Semantic search for known mistakes in an area |
| `get_team_preferences` | Text search for team preference records |
| `get_evolution` | Lookup architecture evolution for an area |

### Admin tools (2)

| Tool | What it does |
|------|-------------|
| `memory_correct` | Correct a field on any record (writes audit trail to `_corrections`) |
| `memory_delete` | Soft-delete (archive) a record (writes audit trail) |

### Meta tools (1)

| Tool | What it does |
|------|-------------|
| `memory_status` | Returns health: DB latency, event counts, active sessions, pattern stats |

---

## 9. Seeding Pipeline

**Files:** `src/seeders/`

The seeders **cold-start** the factual memory database before organic usage begins. They use the same `FactualMemory.recordEvent()` path (with deduplication) as the live server.

### Git History Seeder (`git-seeder.ts`)

```
simpleGit.log({ "--since": since, "--no-merges": null })
  │
  ├─ Group commits by ticket ID → PR number → individual hash
  │   (collapses multi-commit ticket work into single events)
  │
  ├─ For each group:
  │   ├─ Extract files changed (up to 5 commits per group)
  │   ├─ Classify type: feature | bug_fix | refactor | migration
  │   │   via regex on commit message
  │   ├─ Extract tags from file paths
  │   │   (store/, components/, pages/, .vue, .tsx → tag names)
  │   └─ recordEvent(type, summary, details, ticketId, prNumber, files, tags, author)
  │       └─ deduplication check (cosine > 0.95 within 24h → skip)
  │
  └─ Returns count of events created
```

**Commit classification regex:**

| Pattern | Type |
|---------|------|
| `fix`, `bugfix`, `hotfix`, `patch` | `bug_fix` |
| `refactor`, `restructure`, `reorganize` | `refactor` |
| `migrate`, `upgrade`, `update dep` | `migration` |
| `feat`, `add`, `implement`, `new` (or default) | `feature` |

### JIRA Seeder (`jira-seeder.ts`)

```
Connect to Atlassian MCP via StdioClientTransport
  (npx -y mcp-remote https://mcp.atlassian.com/v1/mcp)
  │
  ├─ Build JQL: project=TIM AND statusCategory=Done AND updated >= "{isoDate}"
  │
  ├─ Paginated fetch (50 issues/page via nextPageToken)
  │   For each issue:
  │   ├─ Extract summary, description (ADF → plain text), issuetype, labels, components
  │   ├─ Classify type: bug_fix | feature | refactor
  │   ├─ recordEvent(type, "TIM-XXXXX: summary", details, ticketId, tags, author="jira-seed")
  │   └─ 150ms delay between records (rate limiting)
  │
  └─ Returns count of events created
```

**ADF (Atlassian Document Format) extraction:**
```
extractAdfText(node)
  IF node.type === "text" → return node.text
  IF node.content is array → recursively join children with spaces
```

### Manual Knowledge Seeder (`manual-seeder.ts`)

Reads a YAML file with pre-defined team knowledge:

```yaml
pitfalls:
  - title: "..."
    description: "..."
    tags: [...]
patterns:
  - title: "..."
    description: "..."
preferences:
  - key: "..."
    value: "..."
```

Writes directly to `LongTermMemory` tables (not `events`).

---

## 10. Data Flow Diagrams

### Flow A: Developer starts a task

```
Cursor: task_start("TIM-10647", "Implement new custom data fields")
  │
  └─ ShortTermMemory.startSession()
       ├─ Check no active session exists for this developer
       ├─ Create Session object in memory (cache)
       └─ flush() → INSERT INTO sessions (session_id, task_id, ..., status='active')

       Returns: { sessionId, taskId, summary, currentPhase: "planning", ... }
```

### Flow B: Developer records a decision

```
Cursor: task_decide("Use Vuex metadata module", "Centralises state for metadata forms")
  │
  └─ ShortTermMemory.addDecision(what, why)
       ├─ Load session from cache
       ├─ Push { what, why, timestamp } to session.decisions[]
       ├─ Update session.lastActivity
       └─ flush() → UPDATE sessions SET decisions=$8, last_activity=$15 WHERE session_id=$1
```

### Flow C: Developer ends a task

```
Cursor: task_end()
  │
  ├─ ShortTermMemory.endSession()
  │    ├─ session.status = "completed"
  │    └─ flush() → UPDATE sessions SET status='completed'
  │
  └─ promoteFromSession(session, factual, longTerm)
       │
       ├─ factual.recordEvent(summary event)
       │    └─ embed("TIM-10647: Implement new custom data fields ...")
       │    └─ dedup check
       │    └─ INSERT INTO events (...)
       │
       ├─ For failed attempts → addPitfall / incrementPitfall
       │    └─ embed(attempt.action)
       │    └─ findSimilar on pitfalls table
       │    └─ INSERT INTO pitfalls or UPDATE frequency++
       │
       └─ For decisions → addPattern / reinforcePattern
            └─ embed("Use Vuex metadata module — Centralises state...")
            └─ findSimilar on patterns table
            └─ INSERT INTO patterns or UPDATE confidence += 0.1
```

### Flow D: AI queries past knowledge

```
Cursor: recall_events({ ticketId: "TIM-10647" })
  │
  └─ FactualMemory.recallByTicket("TIM-10647")
       └─ SELECT * FROM events WHERE ticket_id = 'TIM-10647' AND archived = false
          ORDER BY timestamp DESC
       └─ Returns: [{id, type, summary, files, tags, author, ...}]

Cursor: recall_events({ query: "vuex state mutations for metadata" })
  │
  └─ FactualMemory.recallSimilar(query)
       ├─ embed("vuex state mutations for metadata") → float32[384]
       ├─ findSimilar(pool, embedding, "events", 20)
       │    └─ SELECT *, 1-(embedding<=>$1::vector) AS score FROM events
       │       WHERE embedding IS NOT NULL AND archived=false
       │       ORDER BY embedding <=> $1::vector LIMIT 20
       ├─ UPDATE events SET last_accessed=NOW() WHERE id = ANY($1)
       └─ Returns: [{...event, score: 0.87}, ...]

Cursor: get_wisdom("AG Grid table implementation")
  │
  └─ LongTermMemory.getWisdom(topic)
       ├─ embed("AG Grid table implementation") → float32[384]
       ├─ Parallel:
       │    findSimilar(pool, embedding, "patterns", 20)
       │    findSimilar(pool, embedding, "pitfalls", 20)
       │    SELECT * FROM preferences WHERE topic ILIKE '%AG Grid%'
       └─ Returns: { patterns: [...], pitfalls: [...], preferences: [...] }
```

### Flow E: Seeder populates from git

```
pnpm seed -- --git --since="2 years ago"
  │
  ├─ initDb() → connect, migrate, verify embedding model
  │
  └─ seedFromGit(factual, projectRoot, { since, dryRun })
       ├─ simpleGit.log({ "--since": "2 years ago", "--no-merges": null })
       │   returns: [{ hash, message, author_name, date }]
       │
       ├─ Group by extractTicketId(message) → "TIM-XXXXX"
       │
       ├─ For each group:
       │   ├─ git.diffSummary([hash~1, hash]) → changed files
       │   ├─ classifyCommit(message) → type
       │   ├─ extractTags(files, message) → tags[]
       │   └─ factual.recordEvent(...)
       │        ├─ embed(summary + details) → float32[384]
       │        ├─ findSimilar → if score > 0.95 within 24h → SKIP
       │        └─ INSERT INTO events (id, type, ..., embedding::vector)
       │
       └─ Returns: 1393 events seeded
```

---

## 11. Error Modes & Degraded Operation

### Database unavailable

If PostgreSQL is unreachable at startup, the server enters **degraded mode**:

```
[db] Failed to connect or migrate: ECONNREFUSED
[db] Running in degraded mode -- semantic tools work, memory tools will retry
```

- Semantic tools (`get_standard`, `get_architecture`, parsers) → **fully operational** (no DB needed)
- Short-term tools (`task_start`, `task_decide`) → return graceful error to caller
- Factual/long-term tools → return empty results (no crash)

The `ensureDb()` helper is called at the start of every memory operation and retries the connection before failing gracefully.

### Embedding model unavailable

If `@huggingface/transformers` is not installed or model download fails:

- Events are still stored but **without the `embedding` column** (NULL)
- Semantic similarity search returns 0 results (not an error)
- Tag-based and ticket-based search continues to work normally
- Deduplication is skipped (near-duplicates may be stored)

### Migration lock contention

If two server instances start simultaneously, the advisory lock `pg_advisory_lock(738291)` ensures only one runs migrations. The second waits and then sees the migrations already applied.

### Embedding model mismatch

If `MCP_EMBEDDING_MODEL` is changed after data is already in the DB:

```
Error: Embedding model mismatch: DB was seeded with "Xenova/all-MiniLM-L6-v2"
but this instance uses "some-other-model"
```

Server refuses to start. Resolution: either revert to the original model or re-embed all data.

---

## Appendix: File Map

```
src/
├── config.ts                    ← env vars loader (zod-validated)
├── index.ts                     ← entry point, StdioServerTransport
├── server.ts                    ← wires all layers into MCP server
│
├── memory/
│   ├── db.ts                    ← pool, migrations, advisory lock, shutdown
│   ├── embeddings.ts            ← HuggingFace pipeline, embed(), vectorLiteral()
│   ├── similarity.ts            ← findSimilar(), findSimilarByText()
│   ├── semantic.ts              ← rules map, searchStandards()
│   ├── short-term.ts            ← Session interface, ShortTermMemory class
│   ├── factual.ts               ← FactualEvent interface, FactualMemory class
│   ├── long-term.ts             ← Pattern/Pitfall/Preference, LongTermMemory class
│   └── promotion.ts             ← promoteFromSession() pipeline
│
├── parsers/
│   ├── types.ts                 ← ParserPlugin interface, result types
│   ├── registry.ts              ← ParserRegistry, dynamic plugin loading
│   ├── rules-parser.ts          ← .mdc / .md file loader
│   └── builtin/
│       ├── vue2-component-parser.ts  ← @vue/compiler-sfc
│       ├── vuex-store-parser.ts      ← ts-morph
│       ├── axios-service-parser.ts   ← ts-morph
│       └── nuxt2-route-parser.ts     ← filesystem traversal
│
├── tools/
│   ├── semantic-tools.ts        ← get_standard, get_architecture, ...
│   ├── task-tools.ts            ← task_start, task_decide, task_end, ...
│   ├── factual-tools.ts         ← record_event, recall_events, ...
│   ├── longterm-tools.ts        ← get_wisdom, get_pitfalls, ...
│   ├── meta-tools.ts            ← memory_status
│   └── memory-admin-tools.ts   ← memory_correct, memory_delete
│
├── prompts/
│   └── prompt-templates.ts      ← review-component, plan-feature, generate-test
│
├── resources/
│   └── static-resources.ts      ← exposes .mdc files as MCP resources
│
└── seeders/
    ├── seed.ts                  ← CLI entry point (--git, --jira, --manual)
    ├── git-seeder.ts            ← simple-git → FactualMemory
    ├── jira-seeder.ts           ← Atlassian MCP → FactualMemory
    ├── manual-seeder.ts         ← YAML → LongTermMemory
    ├── mcp-client.ts            ← StdioClientTransport wrapper
    └── pr-enricher.ts           ← GitHub MCP → enrich events with PR data
```
