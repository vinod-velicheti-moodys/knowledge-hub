import type { LongTermMemory } from "../memory/long-term.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function createLongtermTools(longTerm: LongTermMemory) {
  return {
    get_wisdom: async (args: {
      topic: string;
      limit?: number;
    }): Promise<ToolResult> => {
      const wisdom = await longTerm.getWisdom(
        args.topic,
        Math.min(args.limit ?? 20, 100)
      );
      return text(JSON.stringify(wisdom, null, 2));
    },

    get_pitfalls: async (args: {
      area: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> => {
      const result = await longTerm.getPitfalls(
        args.area,
        Math.min(args.limit ?? 20, 100),
        args.offset ?? 0
      );
      return text(JSON.stringify(result, null, 2));
    },

    get_team_preferences: async (args: {
      topic?: string;
      limit?: number;
      offset?: number;
    }): Promise<ToolResult> => {
      const result = await longTerm.getPreferences(
        args.topic,
        Math.min(args.limit ?? 20, 100),
        args.offset ?? 0
      );
      return text(JSON.stringify(result, null, 2));
    },

    get_evolution: async (args: { area: string }): Promise<ToolResult> => {
      const evo = await longTerm.getEvolution(args.area);
      if (!evo) return text(`No evolution history found for "${args.area}".`);
      return text(JSON.stringify(evo, null, 2));
    },
  };
}

export const LONGTERM_TOOL_DEFINITIONS = [
  {
    name: "get_wisdom",
    description:
      "Get accumulated wisdom for a topic: relevant patterns, known pitfalls, and team preferences combined.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Topic to get wisdom for (e.g. 'AG Grid', 'store patterns', 'modals')" },
        limit: { type: "number", description: "Max results per category (default 20)" },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_pitfalls",
    description: "Get common mistakes and their fixes for a specific area.",
    inputSchema: {
      type: "object" as const,
      properties: {
        area: { type: "string", description: "Area to search pitfalls for (e.g. 'RadiusDatePicker', 'store imports', 'AG Grid')" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: ["area"],
    },
  },
  {
    name: "get_team_preferences",
    description: "Get unwritten team conventions and preferences.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string", description: "Optional topic filter (e.g. 'naming', 'state management')" },
        limit: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: "Pagination offset" },
      },
    },
  },
  {
    name: "get_evolution",
    description: "Get the history, current state, and planned direction for a codebase area.",
    inputSchema: {
      type: "object" as const,
      properties: {
        area: { type: "string", description: "Codebase area (e.g. 'frontend framework', 'component library', 'store/pricing')" },
      },
      required: ["area"],
    },
  },
];
