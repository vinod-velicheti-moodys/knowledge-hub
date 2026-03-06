import type pg from "pg";
import type { ShortTermMemory } from "../memory/short-term.js";
import type { FactualMemory } from "../memory/factual.js";
import type { LongTermMemory } from "../memory/long-term.js";
import type { Config } from "../config.js";
import { isDbAvailable } from "../memory/db.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function createMetaTools(
  pool: pg.Pool,
  shortTerm: ShortTermMemory,
  factual: FactualMemory,
  longTerm: LongTermMemory,
  config: Config
) {
  return {
    memory_status: async (): Promise<ToolResult> => {
      const dbConnected = isDbAvailable();
      let dbLatency = -1;
      let poolStats = { total: 0, idle: 0, waiting: 0 };

      if (dbConnected) {
        const start = Date.now();
        try {
          await pool.query("SELECT 1");
          dbLatency = Date.now() - start;
        } catch {
          dbLatency = -1;
        }
        poolStats = {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        };
      }

      const [sessionCount, developers, eventCount, recentEvents, ltStats] =
        await Promise.all([
          shortTerm.getSessionCount(),
          shortTerm.getActiveDevelopers(),
          factual.getEventCount(),
          factual.getRecentEventCount(30),
          longTerm.getStats(),
        ]);

      const status = {
        db: {
          connected: dbConnected,
          latency_ms: dbLatency,
          pool: poolStats,
        },
        embedding_model: config.embeddingModel,
        project: config.projectName,
        developer: config.developerName,
        sessions: {
          active: sessionCount,
          developers,
        },
        events: {
          total: eventCount,
          last_30_days: recentEvents,
        },
        patterns: {
          total: ltStats.patterns,
          high_confidence: ltStats.highConfidence,
        },
        pitfalls: { total: ltStats.pitfalls },
        preferences: { total: ltStats.preferences },
        evolution: { total: ltStats.evolution },
      };

      return text(JSON.stringify(status, null, 2));
    },
  };
}

export const META_TOOL_DEFINITIONS = [
  {
    name: "memory_status",
    description:
      "Get a diagnostic overview of all memory layers: DB connection, pool stats, session count, event/pattern/pitfall totals, and embedding model version.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];
