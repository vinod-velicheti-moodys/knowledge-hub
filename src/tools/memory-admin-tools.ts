import type pg from "pg";
import { v4 as uuid } from "uuid";
import { ensureDb } from "../memory/db.js";
import { config } from "../config.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

const ALLOWED_TABLES = ["events", "patterns", "pitfalls"];

const ALLOWED_FIELDS: Record<string, string[]> = {
  events: ["summary", "details", "tags", "files", "components"],
  patterns: ["pattern", "category"],
  pitfalls: ["mistake", "fix", "tags"],
};

export function createMemoryAdminTools(pool: pg.Pool) {
  return {
    memory_correct: async (args: {
      id: string;
      table: string;
      field: string;
      newValue: string;
      reason: string;
    }): Promise<ToolResult> => {
      if (!(await ensureDb())) return text("Database unavailable.");

      if (!ALLOWED_TABLES.includes(args.table)) {
        return text(`Invalid table. Allowed: ${ALLOWED_TABLES.join(", ")}`);
      }

      const fields = ALLOWED_FIELDS[args.table];
      if (!fields?.includes(args.field)) {
        return text(
          `Cannot correct field "${args.field}" on ${args.table}. Allowed fields: ${fields?.join(", ")}`
        );
      }

      if (!args.reason || args.reason.length < 10) {
        return text("Reason must be at least 10 characters.");
      }

      const { rows } = await pool.query(
        `SELECT ${args.field} FROM ${args.table} WHERE id = $1`,
        [args.id]
      );

      if (rows.length === 0) {
        return text(`Record not found: ${args.table}/${args.id}`);
      }

      const oldValue = String(rows[0][args.field]);

      await pool.query(`UPDATE ${args.table} SET ${args.field} = $1 WHERE id = $2`, [
        args.newValue,
        args.id,
      ]);

      await pool.query(
        `INSERT INTO _corrections (id, target_table, target_id, action, field, old_value, new_value, reason, author)
         VALUES ($1,$2,$3,'correct',$4,$5,$6,$7,$8)`,
        [
          uuid(),
          args.table,
          args.id,
          args.field,
          oldValue,
          args.newValue,
          args.reason,
          config.developerName,
        ]
      );

      return text(
        `Corrected ${args.table}/${args.id}.${args.field}: "${oldValue}" → "${args.newValue}"`
      );
    },

    memory_delete: async (args: {
      id: string;
      table: string;
      reason: string;
    }): Promise<ToolResult> => {
      if (!(await ensureDb())) return text("Database unavailable.");

      if (!ALLOWED_TABLES.includes(args.table)) {
        return text(`Invalid table. Allowed: ${ALLOWED_TABLES.join(", ")}`);
      }

      if (!args.reason || args.reason.length < 10) {
        return text("Reason must be at least 10 characters.");
      }

      const { rowCount } = await pool.query(
        `UPDATE ${args.table} SET archived = true WHERE id = $1 AND archived = false`,
        [args.id]
      );

      if (!rowCount) {
        return text(`Record not found or already archived: ${args.table}/${args.id}`);
      }

      await pool.query(
        `INSERT INTO _corrections (id, target_table, target_id, action, reason, author)
         VALUES ($1,$2,$3,'delete',$4,$5)`,
        [uuid(), args.table, args.id, args.reason, config.developerName]
      );

      return text(`Soft-deleted ${args.table}/${args.id}. Reason: ${args.reason}`);
    },
  };
}

export const MEMORY_ADMIN_TOOL_DEFINITIONS = [
  {
    name: "memory_correct",
    description:
      "Correct a specific field on a memory record (event, pattern, or pitfall). Requires a reason for audit trail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Record ID to correct" },
        table: { type: "string", enum: ["events", "patterns", "pitfalls"], description: "Table name" },
        field: { type: "string", description: "Field to update (e.g. 'summary', 'tags', 'pattern', 'mistake')" },
        newValue: { type: "string", description: "New value for the field" },
        reason: { type: "string", description: "Why this correction is needed (min 10 chars)" },
      },
      required: ["id", "table", "field", "newValue", "reason"],
    },
  },
  {
    name: "memory_delete",
    description:
      "Soft-delete a memory record (sets archived=true). Requires a reason for audit trail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Record ID to delete" },
        table: { type: "string", enum: ["events", "patterns", "pitfalls"], description: "Table name" },
        reason: { type: "string", description: "Why this record should be removed (min 10 chars)" },
      },
      required: ["id", "table", "reason"],
    },
  },
];
