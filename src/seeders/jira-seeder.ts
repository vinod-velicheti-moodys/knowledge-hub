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

  const defaultJql = `project = ${project} AND status in (Done, Closed) AND updated >= -${since.replace(/\s+/g, "")}`;
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
      const description = fields.description ?? "";
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
          details: description.slice(0, 2000),
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
