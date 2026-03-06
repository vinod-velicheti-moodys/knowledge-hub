import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callMcpTool } from "./mcp-client.js";
import type { FactualMemory } from "../memory/factual.js";

interface PrEnricherOptions {
  owner: string;
  repo: string;
  delayMs?: number;
  dryRun?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enrichWithPrData(
  githubClient: Client,
  factual: FactualMemory,
  prNumbers: string[],
  options: PrEnricherOptions
): Promise<number> {
  const { owner, repo, delayMs = 200 } = options;
  let count = 0;

  for (const prNumber of prNumbers) {
    try {
      const prData = (await callMcpTool(githubClient, "pull_request_read", {
        method: "get",
        owner,
        repo,
        pullNumber: parseInt(prNumber, 10),
      })) as any;

      if (!prData) continue;

      let reviewComments: any[] = [];
      try {
        const commentsResult = await callMcpTool(
          githubClient,
          "pull_request_read",
          {
            method: "get_review_comments",
            owner,
            repo,
            pullNumber: parseInt(prNumber, 10),
          }
        );
        reviewComments = Array.isArray(commentsResult)
          ? commentsResult
          : [];
      } catch {
        /* review comments unavailable */
      }

      if (options.dryRun) {
        console.error(
          `  [dry-run] PR #${prNumber}: ${prData.title ?? "untitled"} (${reviewComments.length} review comments)`
        );
        count++;
        continue;
      }

      for (const comment of reviewComments) {
        const body =
          typeof comment === "object" ? comment.body ?? comment : String(comment);
        if (body.length < 20) continue;

        try {
          await factual.recordEvent({
            type: "review_feedback",
            summary: `PR #${prNumber}: Review comment on ${prData.title ?? "PR"}`,
            details: body,
            prNumber,
            tags: ["code-review", "pr-feedback"],
            author: comment.user?.login ?? "reviewer",
          });
          count++;
        } catch {
          /* skip duplicate or short events */
        }
      }

      await sleep(delayMs);
    } catch (err) {
      console.error(
        `  [pr-enricher] Failed for PR #${prNumber}:`,
        (err as Error).message
      );
    }
  }

  return count;
}
