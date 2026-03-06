import type { FactualMemory } from "../memory/factual.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function createFactualTools(factual: FactualMemory) {
  return {
    record_event: async (args: {
      type: string;
      summary: string;
      details?: string;
      ticketId?: string;
      prNumber?: string;
      files?: string[];
      tags?: string[];
    }): Promise<ToolResult> => {
      const id = await factual.recordEvent(args);
      return text(`Event recorded: ${id}`);
    },

    recall_events: async (args: {
      query?: string;
      tags?: string[];
      ticketId?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> => {
      const limit = Math.min(args.limit ?? 20, 100);
      const offset = args.offset ?? 0;

      if (args.ticketId) {
        const result = await factual.recallByTicket(args.ticketId, limit, offset);
        return text(JSON.stringify(result, null, 2));
      }

      if (args.tags?.length) {
        const result = await factual.recallByTags(args.tags, limit, offset);
        return text(JSON.stringify(result, null, 2));
      }

      if (args.query) {
        const results = await factual.recallSimilar(args.query, limit);
        return text(
          JSON.stringify(
            { results, total: results.length, hasMore: false },
            null,
            2
          )
        );
      }

      return text("Provide at least one of: query, tags, or ticketId.");
    },

    recall_decisions: async (args: {
      topic: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> => {
      const result = await factual.recallDecisions(
        args.topic,
        Math.min(args.limit ?? 20, 100),
        args.offset ?? 0
      );
      return text(JSON.stringify(result, null, 2));
    },

    recall_for_component: async (args: {
      component: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> => {
      const result = await factual.recallByComponent(
        args.component,
        Math.min(args.limit ?? 20, 100),
        args.offset ?? 0
      );
      return text(JSON.stringify(result, null, 2));
    },

    memory_prune: async (args: {
      older_than_months?: number;
    }): Promise<ToolResult> => {
      const archived = await factual.prune(args.older_than_months ?? 24);
      return text(`Pruned: ${archived} events archived.`);
    },
  };
}

export const FACTUAL_TOOL_DEFINITIONS = [
  {
    name: "record_event",
    description:
      "Record a factual event (decision, bug fix, refactor, feature, migration, review feedback, or convention).",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["decision", "bug_fix", "refactor", "feature", "migration", "review_feedback", "convention_established"],
          description: "Event type",
        },
        summary: { type: "string", description: "Event summary (min 10 chars)" },
        details: { type: "string", description: "Detailed description" },
        ticketId: { type: "string", description: "JIRA ticket ID" },
        prNumber: { type: "string", description: "GitHub PR number" },
        files: { type: "array", items: { type: "string" }, description: "Affected files" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
      },
      required: ["type", "summary"],
    },
  },
  {
    name: "recall_events",
    description: "Recall past events by semantic query, tags, or ticket ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Natural language query to search events semantically" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
        ticketId: { type: "string", description: "Filter by JIRA ticket ID" },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: "recall_decisions",
    description: "Recall past decisions related to a topic using semantic search.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Topic to search decisions for" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: ["topic"],
    },
  },
  {
    name: "recall_for_component",
    description: "Get all factual events mentioning a specific component or file.",
    inputSchema: {
      type: "object" as const,
      properties: {
        component: { type: "string", description: "Component name or file path" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: ["component"],
    },
  },
  {
    name: "memory_prune",
    description: "Archive stale events older than a threshold. Helps keep the memory layer focused.",
    inputSchema: {
      type: "object" as const,
      properties: {
        older_than_months: { type: "number", description: "Archive events older than N months (default 24)" },
      },
    },
  },
];
