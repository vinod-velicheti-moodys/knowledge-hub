#!/usr/bin/env node

import { config } from "../config.js";
import { initDb, shutdown } from "../memory/db.js";
import { FactualMemory } from "../memory/factual.js";
import { LongTermMemory } from "../memory/long-term.js";
import { getPool } from "../memory/db.js";
import { seedFromGit } from "./git-seeder.js";
import { seedFromManual } from "./manual-seeder.js";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const runGit = args.includes("--git") || args.length === 0 || args.every((a) => a.startsWith("--"));
  const runManual = args.includes("--manual");
  const manualFile = args.find((a) => a.endsWith(".yaml") || a.endsWith(".yml") || a.endsWith(".json"));

  console.error(`[seed] Project: ${config.projectName} (${config.projectRoot})`);
  console.error(`[seed] Dry run: ${dryRun}`);

  await initDb();
  const pool = getPool();
  const factual = new FactualMemory(pool);
  const longTerm = new LongTermMemory(pool);

  let totalEvents = 0;

  if (runGit) {
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

  console.error(`\n[seed] Total: ${totalEvents} entries seeded`);
  await shutdown();
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
