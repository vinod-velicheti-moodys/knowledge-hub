#!/usr/bin/env node

import { config } from "../config.js";
import { initDb, shutdown } from "../memory/db.js";
import { FactualMemory } from "../memory/factual.js";
import { LongTermMemory } from "../memory/long-term.js";
import { getPool } from "../memory/db.js";
import { seedFromGit } from "./git-seeder.js";
import { seedFromManual } from "./manual-seeder.js";
import { seedFromJira } from "./jira-seeder.js";
import { connectToMcp, disconnectMcp } from "./mcp-client.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const ATLASSIAN_CLOUD_ID = "a0376734-67ec-48a1-8aae-e02d48c422ae";
const ATLASSIAN_MCP_COMMAND = "npx";
const ATLASSIAN_MCP_ARGS = ["-y", "mcp-remote", "https://mcp.atlassian.com/v1/mcp"];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const runGit = args.includes("--git");
  const runManual = args.includes("--manual");
  const runJira = args.includes("--jira");
  // If no seeders specified, default to git only (don't auto-run JIRA)
  const hasExplicitSeeders = runGit || runManual || runJira;
  const manualFile = args.find((a) => a.endsWith(".yaml") || a.endsWith(".yml") || a.endsWith(".json"));

  console.error(`[seed] Project: ${config.projectName} (${config.projectRoot})`);
  console.error(`[seed] Dry run: ${dryRun}`);

  await initDb();
  const pool = getPool();
  const factual = new FactualMemory(pool);
  const longTerm = new LongTermMemory(pool);

  let totalEvents = 0;

  if (runGit || (!hasExplicitSeeders)) {
    console.error("\n[seed] === Git History Seeder ===");
    const since = args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "1 year ago";
    const count = await seedFromGit(factual, config.projectRoot, {
      since,
      dryRun,
    });
    totalEvents += count;
    console.error(`[seed] Git seeder: ${count} events`);
  }

  if (runManual && manualFile) {
    console.error("\n[seed] === Manual Knowledge Seeder ===");
    const count = await seedFromManual(longTerm, factual, manualFile, { dryRun });
    totalEvents += count;
    console.error(`[seed] Manual seeder: ${count} entries`);
  }

  if (runJira) {
    console.error("\n[seed] === JIRA Seeder ===");
    const since = args.find((a) => a.startsWith("--since="))?.split("=")[1] ?? "6 months ago";
    const project = args.find((a) => a.startsWith("--project="))?.split("=")[1] ?? "TIM";
    const jql = args.find((a) => a.startsWith("--jql="))?.split("=").slice(1).join("=");
    let atlassianClient: Client | null = null;
    try {
      console.error(`[seed] Connecting to Atlassian MCP (${ATLASSIAN_CLOUD_ID})...`);
      atlassianClient = await connectToMcp(ATLASSIAN_MCP_COMMAND, ATLASSIAN_MCP_ARGS);
      console.error(`[seed] Connected. Fetching ${project} issues...`);
      const count = await seedFromJira(atlassianClient, factual, {
        cloudId: ATLASSIAN_CLOUD_ID,
        project,
        since,
        jql,
        dryRun,
        delayMs: 150,
      });
      totalEvents += count;
      console.error(`[seed] JIRA seeder: ${count} events`);
    } catch (err) {
      console.error(`[seed] JIRA seeder failed:`, (err as Error).message);
    } finally {
      if (atlassianClient) await disconnectMcp(atlassianClient);
    }
  }

  console.error(`\n[seed] Total: ${totalEvents} entries seeded`);
  await shutdown();
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
