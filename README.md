# TIQ Knowledge MCP Server

An MCP server with a four-layer memory system (short-term, semantic, factual, long-term) for institutional codebase knowledge. Designed for team use with a shared PostgreSQL + pgvector database.

## Architecture

```
MCP Clients (Cursor, Claude Desktop, OpenClaw)
         │ MCP Protocol (stdio)
         ▼
┌──────────────────────────────────┐
│     TIQ Knowledge MCP Server     │
│                                  │
│  Short-Term  │ Working memory    │
│  Semantic    │ Rules + parsers   │
│  Factual     │ Event log         │
│  Long-Term   │ Patterns/pitfalls │
└──────────┬───────────────────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
  Local        Shared
  Repo         PostgreSQL
  (parsers)    + pgvector
```

## Quick Start

### Prerequisites

- Node.js >= 22
- PostgreSQL 16+ with pgvector extension

### 1. Start PostgreSQL with pgvector

```bash
docker run -d \
  --name tiq-knowledge-db \
  -e POSTGRES_DB=tiq_knowledge \
  -e POSTGRES_USER=knowledge_mcp \
  -e POSTGRES_PASSWORD=your-password \
  -p 5432:5432 \
  -v tiq-knowledge-pgdata:/var/lib/postgresql/data \
  pgvector/pgvector:pg16
```

### 2. Add to Cursor MCP config

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "tiq-knowledge": {
      "command": "node",
      "args": ["/path/to/tiq-knowledge-mcp/dist/index.js"],
      "env": {
        "MCP_PROJECT_ROOT": "/path/to/your/repo",
        "MCP_PROJECT_NAME": "tiq",
        "MCP_DEVELOPER_NAME": "your-name",
        "MCP_DB_URL": "postgresql://knowledge_mcp:your-password@localhost:5432/tiq_knowledge"
      }
    }
  }
}
```

### 3. Copy the Cursor rule

```bash
cp src/templates/knowledge-mcp.mdc /path/to/your/repo/.cursor/rules/
```

### 4. Build and restart Cursor

```bash
pnpm install
pnpm build
```

Restart Cursor to pick up the MCP server.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_PROJECT_ROOT` | Yes | - | Path to the local repo clone |
| `MCP_PROJECT_NAME` | No | Directory basename | Human-readable project name |
| `MCP_DB_URL` | Yes | - | PostgreSQL connection string |
| `MCP_DEVELOPER_NAME` | Yes | - | Identifies you for session tracking |
| `MCP_RULES_DIR` | No | `$MCP_PROJECT_ROOT/.cursor/rules` | Rules directory |
| `MCP_EMBEDDING_MODEL` | No | `Xenova/all-MiniLM-L6-v2` | Embedding model (must match across team) |
| `MCP_SIMILARITY_THRESHOLD` | No | `0.85` | Cosine similarity threshold for dedup |

## Tools (26 total)

### Short-Term Memory (8)
| Tool | Description |
|------|-------------|
| `task_start` | Start a task session |
| `task_context` | Get current session state |
| `task_decide` | Record a decision |
| `task_attempt` | Record an attempt (success/fail) |
| `task_find` | Store an intermediate finding |
| `task_end` | End session, promote to shared memory |
| `task_recover` | Recover orphaned session |
| `task_conflicts` | Check file conflicts with other developers |

### Semantic Memory (5)
| Tool | Description |
|------|-------------|
| `get_standard` | Get a coding standard by topic |
| `get_architecture` | Get architecture overview |
| `get_component_graph` | Get component metadata + usages |
| `get_store_module` | Get Vuex store module structure |
| `get_service_api` | Get API service endpoints |

### Factual Memory (5)
| Tool | Description |
|------|-------------|
| `record_event` | Record a factual event |
| `recall_events` | Search events by query/tags/ticket |
| `recall_decisions` | Get past decisions for a topic |
| `recall_for_component` | Get events for a component |
| `memory_prune` | Archive stale events |

### Long-Term Memory (4)
| Tool | Description |
|------|-------------|
| `get_wisdom` | Combined patterns + pitfalls + preferences |
| `get_pitfalls` | Common mistakes and fixes |
| `get_team_preferences` | Team conventions |
| `get_evolution` | Codebase area history |

### Admin (2)
| Tool | Description |
|------|-------------|
| `memory_correct` | Fix a memory record |
| `memory_delete` | Soft-delete a memory record |

### Meta (1)
| Tool | Description |
|------|-------------|
| `memory_status` | Diagnostic overview of all layers |

## Seeding

Populate the database with historical knowledge:

```bash
# Seed from git history
pnpm seed -- --git --since="6 months ago"

# Seed from a knowledge file
pnpm seed -- --manual team-knowledge.yaml

# Dry run
pnpm seed -- --dry-run
```

## Parser Plugins

Create a `.knowledge-mcp.json` in your repo root to enable code parsers:

```json
{
  "name": "my-project",
  "framework": "nuxt2",
  "parsers": [
    { "id": "vue2-component", "options": { "srcDirs": ["frontend/components", "frontend/pages"] } },
    { "id": "vuex-store", "options": { "storeDir": "frontend/store" } },
    { "id": "axios-service", "options": { "servicesDir": "frontend/support/services", "baseClass": "ApiBase" } },
    { "id": "nuxt2-route", "options": { "pagesDir": "frontend/pages" } }
  ]
}
```

## Development

```bash
pnpm install
pnpm dev          # Run with tsx (auto-reloads)
pnpm build        # Compile TypeScript
pnpm test         # Run tests
```

## License

MIT
