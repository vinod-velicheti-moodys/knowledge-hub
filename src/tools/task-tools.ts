import type { ShortTermMemory } from "../memory/short-term.js";
import type { FactualMemory } from "../memory/factual.js";
import type { LongTermMemory } from "../memory/long-term.js";
import { promoteFromSession } from "../memory/promotion.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function createTaskTools(
  shortTerm: ShortTermMemory,
  factual: FactualMemory,
  longTerm: LongTermMemory
) {
  return {
    task_start: async (args: {
      taskId: string;
      summary: string;
      ticket?: { id: string; summary: string; acceptanceCriteria: string[] };
    }): Promise<ToolResult> => {
      const session = await shortTerm.startSession(
        args.taskId,
        args.summary,
        args.ticket
      );
      return text(
        `Task started: ${session.taskId}\nSession: ${session.sessionId}\nPhase: ${session.currentPhase}`
      );
    },

    task_context: async (): Promise<ToolResult> => {
      const session = await shortTerm.getActiveSession();
      if (!session) return text("No active task session.");
      return text(JSON.stringify(session, null, 2));
    },

    task_decide: async (args: {
      what: string;
      why: string;
    }): Promise<ToolResult> => {
      await shortTerm.addDecision(args.what, args.why);
      return text(`Decision recorded: ${args.what}`);
    },

    task_attempt: async (args: {
      action: string;
      outcome: "success" | "failed";
      reason?: string;
    }): Promise<ToolResult> => {
      await shortTerm.addAttempt(args.action, args.outcome, args.reason);
      return text(
        `Attempt recorded: ${args.action} → ${args.outcome}${args.reason ? ` (${args.reason})` : ""}`
      );
    },

    task_find: async (args: {
      key: string;
      value: unknown;
    }): Promise<ToolResult> => {
      await shortTerm.addFinding(args.key, args.value);
      return text(`Finding stored: ${args.key}`);
    },

    task_end: async (): Promise<ToolResult> => {
      const session = await shortTerm.endSession();
      const result = await promoteFromSession(session, factual, longTerm);
      return text(
        `Task "${session.taskId}" completed.\n` +
          `Promoted to shared memory: ${result.eventsCreated} events, ${result.patternsPromoted} patterns, ${result.pitfallsPromoted} pitfalls`
      );
    },

    task_recover: async (args: {
      taskId?: string;
    }): Promise<ToolResult> => {
      const session = await shortTerm.recoverSession(args.taskId);
      if (!session) {
        return text("No recoverable session found for this developer.");
      }
      return text(
        `Recovered session for task "${session.taskId}" (started ${session.startedAt})\n` +
          `Phase: ${session.currentPhase}, Decisions: ${session.decisions.length}, Attempts: ${session.attempts.length}`
      );
    },

    task_conflicts: async (args: {
      files?: string[];
    }): Promise<ToolResult> => {
      const conflicts = await shortTerm.getConflicts(args.files);
      if (conflicts.length === 0) {
        return text("No conflicts detected with other active sessions.");
      }
      const lines = conflicts.map(
        (c) =>
          `- ${c.developer} (task ${c.taskId}): ${c.conflictingFiles.join(", ")}`
      );
      return text(`Conflicts found:\n${lines.join("\n")}`);
    },
  };
}

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "task_start",
    description: "Start a new task session. Records the task context for the current developer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "JIRA ticket ID or task identifier (e.g. TIM-10654)" },
        summary: { type: "string", description: "Brief description of the task" },
        ticket: {
          type: "object",
          description: "Optional JIRA ticket details",
          properties: {
            id: { type: "string" },
            summary: { type: "string" },
            acceptanceCriteria: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["taskId", "summary"],
    },
  },
  {
    name: "task_context",
    description: "Get the current active task session context (phase, decisions, attempts, findings).",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "task_decide",
    description: "Record an architectural or implementation decision with reasoning. Promoted to shared memory on task_end.",
    inputSchema: {
      type: "object" as const,
      properties: {
        what: { type: "string", description: "What was decided" },
        why: { type: "string", description: "Why this decision was made" },
      },
      required: ["what", "why"],
    },
  },
  {
    name: "task_attempt",
    description: "Record something attempted (success or failure). Failed attempts are promoted as pitfalls on task_end.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "What was attempted" },
        outcome: { type: "string", enum: ["success", "failed"], description: "success or failed" },
        reason: { type: "string", description: "Why it failed (if failed)" },
      },
      required: ["action", "outcome"],
    },
  },
  {
    name: "task_find",
    description: "Store an intermediate finding for later reference within this task session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        key: { type: "string", description: "Finding key (e.g. 'related_components', 'api_endpoints')" },
        value: { description: "Finding value (any JSON-serializable data)" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "task_end",
    description: "End the current task session. Promotes decisions to patterns and failed attempts to pitfalls in shared memory.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "task_recover",
    description: "Recover an orphaned session (e.g. after Cursor crash). Lists active sessions for the current developer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "Optional task ID to recover a specific session" },
      },
    },
  },
  {
    name: "task_conflicts",
    description: "Check if other developers have active sessions touching the same files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "File paths to check for conflicts. Defaults to current session's active files.",
        },
      },
    },
  },
];
