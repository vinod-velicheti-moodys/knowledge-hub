import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callMcpTool } from "./mcp-client.js";
import type { FactualMemory } from "../memory/factual.js";

interface JiraSeederOptions {
  cloudId: string;
  project: string;
  jql?: string;
  since?: string;
  delayMs?: number;
  dryRun?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Recursively extract plain text from Atlassian Document Format (ADF) nodes */
function extractAdfText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

/** Convert English "N unit ago" phrases to an ISO date string for JQL (e.g. "2024-03-06") */
function toJiraIsoDate(since: string): string | null {
  const lower = since.toLowerCase().trim();

  const match = lower.match(/^(\d+)\s*(day|week|month|year)s?\s*(ago)?$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const d = new Date();
    if (unit === "day") d.setDate(d.getDate() - n);
    else if (unit === "week") d.setDate(d.getDate() - n * 7);
    else if (unit === "month") d.setMonth(d.getMonth() - n);
    else if (unit === "year") d.setFullYear(d.getFullYear() - n);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  // Already an ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;

  return null;
}

function classifyIssueType(issuetype: string): string {
  const lower = issuetype.toLowerCase();
  if (lower.includes("bug")) return "bug_fix";
  if (lower.includes("story") || lower.includes("feature")) return "feature";
  if (lower.includes("task")) return "feature";
  if (lower.includes("improvement")) return "refactor";
  return "feature";
}

export async function seedFromJira(
  atlassianClient: Client,
  factual: FactualMemory,
  options: JiraSeederOptions
): Promise<number> {
  const { cloudId, project, delayMs = 200 } = options;
  const since = options.since ?? "6 months ago";

  const isoDate = toJiraIsoDate(since);
  const updatedFilter = isoDate ? `AND updated >= "${isoDate}"` : "";
  const defaultJql = `project = ${project} AND statusCategory = Done ${updatedFilter} ORDER BY updated DESC`;
  const jql = options.jql ?? defaultJql;

  let count = 0;
  let nextPageToken: string | undefined;

  do {
    const searchArgs: Record<string, unknown> = {
      cloudId,
      jql,
      fields: [
        "summary",
        "description",
        "status",
        "issuetype",
        "labels",
        "components",
      ],
      maxResults: 50,
    };

    if (nextPageToken) {
      searchArgs.nextPageToken = nextPageToken;
    }

    let searchResult: any;
    try {
      searchResult = await callMcpTool(
        atlassianClient,
        "searchJiraIssuesUsingJql",
        searchArgs
      );
    } catch (err) {
      console.error("[jira-seeder] Search failed:", (err as Error).message);
      break;
    }

    const issues = Array.isArray(searchResult?.issues)
      ? searchResult.issues
      : Array.isArray(searchResult)
        ? searchResult
        : [];

    for (const issue of issues) {
      const key = issue.key;
      const fields = issue.fields ?? issue;
      const summary = fields.summary ?? "Unknown";
      const rawDesc = fields.description;
      // Atlassian Document Format (ADF) — extract plain text from content nodes
      const description = extractAdfText(rawDesc).slice(0, 2000);
      const issuetype = fields.issuetype?.name ?? "Task";
      const labels = fields.labels ?? [];
      const components = (fields.components ?? []).map(
        (c: any) => c.name ?? c
      );

      const eventType = classifyIssueType(issuetype);
      const tags = [...labels, ...components].filter(Boolean);

      if (options.dryRun) {
        console.error(`  [dry-run] ${key}: ${summary} (${eventType})`);
        count++;
        continue;
      }

      try {
        await factual.recordEvent({
          type: eventType,
          summary: `${key}: ${summary}`,
          details: description || summary,
          ticketId: key,
          tags: tags.slice(0, 10),
          author: "jira-seed",
        });
        count++;
      } catch {
        /* skip duplicates */
      }

      await sleep(delayMs);
    }

    nextPageToken = searchResult?.nextPageToken;
  } while (nextPageToken);

  return count;
}
