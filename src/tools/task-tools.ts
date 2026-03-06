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
      taskId?: string;
      summary: string;
      ticket?: { id: string; summary: string; acceptanceCriteria: string[] };
    }): Promise<ToolResult> => {
      if (!args.summary || typeof args.summary !== "string" || args.summary.trim() === "") {
        throw new Error("summary is required and must be a non-empty string");
      }

      // Generate taskId intelligently if not provided
      let finalTaskId = args.taskId?.trim();
      
      if (!finalTaskId) {
        // Priority 1: Use ticket ID if available
        if (args.ticket?.id) {
          finalTaskId = args.ticket.id;
        } 
        // Priority 2: Generate from summary (first 3 words + timestamp)
        else {
          const words = args.summary.trim().split(/\s+/).slice(0, 3).join("-").toLowerCase();
          const timestamp = Date.now().toString().slice(-6);
          finalTaskId = `task-${words}-${timestamp}`;
        }
      }
      
      // Check for existing active session and auto-recover if same taskId
      const existingSession = await shortTerm.getActiveSession();
      if (existingSession) {
        if (existingSession.taskId === finalTaskId) {
          // Same task - auto-recover instead of failing
          const recovered = await shortTerm.recoverSession(finalTaskId);
          if (recovered) {
            return text(
              `Recovered existing session for task "${recovered.taskId}"\n` +
              `Session: ${recovered.sessionId}\n` +
              `Phase: ${recovered.currentPhase}\n` +
              `Decisions: ${recovered.decisions.length}, Attempts: ${recovered.attempts.length}`
            );
          }
        }
        // Different task - still throw error
        throw new Error(
          `Active session already exists for task "${existingSession.taskId}". ` +
          `Call task_end first, or task_recover to resume.`
        );
      }
      
      const session = await shortTerm.startSession(
        finalTaskId,
        args.summary.trim(),
        args.ticket
      );
      
      // Build response with optional prompt for missing ticket details
      let response = `Task started: ${session.taskId}\nSession: ${session.sessionId}\nPhase: ${session.currentPhase}`;
      
      // Check if taskId looks like a JIRA ticket (e.g., TIM-1234, ABC-567)
      const jiraTicketPattern = /^[A-Z]+-\d+$/;
      const isJiraTicket = jiraTicketPattern.test(finalTaskId);
      
      if (!args.ticket && isJiraTicket) {
        response += `\n\n📋 JIRA ticket detected: ${finalTaskId}\n` +
          `Please fetch ticket details using the Atlassian MCP:\n` +
          `1. Call getJiraIssue with cloudId="a0376734-67ec-48a1-8aae-e02d48c422ae" and issueIdOrKey="${finalTaskId}"\n` +
          `2. Extract summary and acceptance criteria from the description\n` +
          `3. Call task_update_ticket with the extracted details`;
      } else if (!args.ticket) {
        response += `\n\n⚠️ No ticket details provided. For better knowledge tracking:\n` +
          `- If this is a JIRA ticket, use Atlassian MCP's getJiraIssue to fetch details\n` +
          `- Then call task_update_ticket with the ticket info`;
      } else if (!args.ticket.acceptanceCriteria || args.ticket.acceptanceCriteria.length === 0) {
        response += `\n\n⚠️ No acceptance criteria provided. Consider fetching from JIRA or adding manually.`;
      }
      
      return text(response);
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
      if (!args.what || typeof args.what !== "string" || args.what.trim() === "") {
        throw new Error("'what' parameter is required and must be a non-empty string");
      }
      if (!args.why || typeof args.why !== "string" || args.why.trim() === "") {
        throw new Error("'why' parameter is required and must be a non-empty string");
      }
      await shortTerm.addDecision(args.what.trim(), args.why.trim());
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

    task_update_ticket: async (args: {
      ticketId?: string;
      summary?: string;
      acceptanceCriteria?: string[];
    }): Promise<ToolResult> => {
      const session = await shortTerm.getActiveSession();
      if (!session) {
        return text("No active task session. Call task_start first.");
      }
      
      // Update ticket details
      const updatedTicket = {
        id: args.ticketId || session.ticket?.id || session.taskId,
        summary: args.summary || session.ticket?.summary || session.summary,
        acceptanceCriteria: args.acceptanceCriteria || session.ticket?.acceptanceCriteria || [],
      };
      
      await shortTerm.updateTicket(updatedTicket);
      
      return text(
        `Ticket details updated for task "${session.taskId}":\n` +
        `- ID: ${updatedTicket.id}\n` +
        `- Summary: ${updatedTicket.summary}\n` +
        `- Acceptance Criteria: ${updatedTicket.acceptanceCriteria.length > 0 ? '\n  • ' + updatedTicket.acceptanceCriteria.join('\n  • ') : 'None'}`
      );
    },

    task_correction: async (args: {
      mistakes: string[];
      corrections: string[];
      context?: string;
    }): Promise<ToolResult> => {
      if (!args.mistakes || !Array.isArray(args.mistakes) || args.mistakes.length === 0) {
        throw new Error("'mistakes' parameter is required and must be a non-empty array");
      }
      if (!args.corrections || !Array.isArray(args.corrections) || args.corrections.length === 0) {
        throw new Error("'corrections' parameter is required and must be a non-empty array");
      }
      
      const session = await shortTerm.getActiveSession();
      
      // Record each mistake-correction pair as a failed attempt followed by success
      for (let i = 0; i < args.mistakes.length; i++) {
        const mistake = args.mistakes[i];
        const correction = args.corrections[i] || args.corrections[args.corrections.length - 1];
        
        // Record the mistake as a failed attempt
        if (session) {
          await shortTerm.addAttempt(
            mistake,
            "failed",
            `Self-correction: ${correction}`
          );
          // Record the correction as a successful attempt
          await shortTerm.addAttempt(
            correction,
            "success",
            args.context || "Agent self-corrected after recognizing mistake"
          );
        }
      }
      
      // Also record as a long-term pitfall directly if no active session
      if (!session) {
        for (let i = 0; i < args.mistakes.length; i++) {
          const mistake = args.mistakes[i];
          const correction = args.corrections[i] || args.corrections[args.corrections.length - 1];
          await longTerm.addPitfall({
            mistake: mistake,
            fix: correction,
            tags: args.context ? [args.context, "self-correction"] : ["self-correction"],
          });
        }
        return text(
          `Recorded ${args.mistakes.length} self-correction(s) as pitfalls (no active session):\n` +
          args.mistakes.map((m, i) => `- ❌ ${m}\n  ✅ ${args.corrections[i] || args.corrections[args.corrections.length - 1]}`).join('\n')
        );
      }
      
      return text(
        `Recorded ${args.mistakes.length} self-correction(s) for task "${session.taskId}":\n` +
        args.mistakes.map((m, i) => `- ❌ ${m}\n  ✅ ${args.corrections[i] || args.corrections[args.corrections.length - 1]}`).join('\n') +
        `\n\nThese will be promoted to shared pitfalls on task_end.`
      );
    },
  };
}

export const TASK_TOOL_DEFINITIONS = [
  {
    name: "task_start",
    description: `Start a new task session. Records the task context for the current developer.

IMPORTANT: When a JIRA ticket ID is provided (e.g., TIM-9253):
1. First fetch ticket details using Atlassian MCP's getJiraIssue tool with cloudId="a0376734-67ec-48a1-8aae-e02d48c422ae"
2. Extract summary and acceptance criteria from the response
3. Pass them to task_start in the ticket parameter

If taskId matches an existing active session, it will auto-recover instead of failing.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string", description: "JIRA ticket ID (e.g., TIM-9253) or task identifier. Auto-generated if not provided." },
        summary: { type: "string", description: "Brief description of the task (use JIRA summary if available)" },
        ticket: {
          type: "object",
          description: "JIRA ticket details - fetch from Atlassian MCP's getJiraIssue if taskId is a JIRA ticket",
          properties: {
            id: { type: "string", description: "JIRA ticket ID" },
            summary: { type: "string", description: "Ticket summary from JIRA" },
            acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Extracted from JIRA description bullet points" },
          },
        },
      },
      required: ["summary"],
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
  {
    name: "task_update_ticket",
    description: `Update ticket details for the current task session.

Use this after fetching JIRA ticket details via Atlassian MCP's getJiraIssue:
1. Call getJiraIssue with cloudId="a0376734-67ec-48a1-8aae-e02d48c422ae" and issueIdOrKey
2. Extract summary from fields.summary
3. Parse acceptance criteria from fields.description (bullet points starting with *)
4. Call this tool with the extracted data`,
    inputSchema: {
      type: "object" as const,
      properties: {
        ticketId: { type: "string", description: "JIRA ticket ID (e.g., TIM-9253)" },
        summary: { type: "string", description: "Ticket summary from JIRA fields.summary" },
        acceptanceCriteria: { 
          type: "array", 
          items: { type: "string" },
          description: "Acceptance criteria extracted from JIRA description bullet points" 
        },
      },
    },
  },
  {
    name: "task_correction",
    description: `Record self-corrections when the agent recognizes and fixes its own mistakes.

IMPORTANT: Call this tool proactively when you say things like:
- "I made a mistake..."
- "I apologize, I should have..."
- "Let me correct that..."
- "I was wrong about..."
- "I need to fix my previous..."

This captures valuable learning for the team - mistakes become shared pitfalls that prevent others from repeating them.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        mistakes: { 
          type: "array", 
          items: { type: "string" },
          description: "List of mistakes made (what went wrong)" 
        },
        corrections: { 
          type: "array", 
          items: { type: "string" },
          description: "List of corrections applied (what should have been done)" 
        },
        context: { 
          type: "string", 
          description: "Optional context about the area/feature where this occurred" 
        },
      },
      required: ["mistakes", "corrections"],
    },
  },
];
