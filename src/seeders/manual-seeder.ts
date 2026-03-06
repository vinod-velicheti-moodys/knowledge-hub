import { readFileSync } from "fs";
import { z } from "zod";
import YAML from "yaml";
import type { FactualMemory } from "../memory/factual.js";
import type { LongTermMemory } from "../memory/long-term.js";

const knowledgeSchema = z.object({
  pitfalls: z
    .array(
      z.object({
        mistake: z.string(),
        fix: z.string(),
        tags: z.array(z.string()).optional(),
      })
    )
    .optional(),
  patterns: z
    .array(
      z.object({
        pattern: z.string(),
        category: z.string(),
        confidence: z.number().optional(),
      })
    )
    .optional(),
  preferences: z
    .array(
      z.object({
        topic: z.string(),
        preference: z.string(),
      })
    )
    .optional(),
  evolution: z
    .array(
      z.object({
        area: z.string(),
        history: z.string(),
        current_state: z.string(),
        planned_changes: z.string().optional(),
      })
    )
    .optional(),
});

export async function seedFromManual(
  longTerm: LongTermMemory,
  _factual: FactualMemory,
  filePath: string,
  options: { dryRun?: boolean } = {}
): Promise<number> {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = filePath.endsWith(".json")
    ? JSON.parse(raw)
    : YAML.parse(raw);

  const data = knowledgeSchema.parse(parsed);
  let count = 0;

  for (const pitfall of data.pitfalls ?? []) {
    if (options.dryRun) {
      console.error(`  [dry-run] pitfall: ${pitfall.mistake}`);
      count++;
      continue;
    }
    await longTerm.addPitfall({
      mistake: pitfall.mistake,
      fix: pitfall.fix,
      tags: pitfall.tags,
      author: "manual-seed",
    });
    count++;
  }

  for (const pattern of data.patterns ?? []) {
    if (options.dryRun) {
      console.error(`  [dry-run] pattern: ${pattern.pattern}`);
      count++;
      continue;
    }
    await longTerm.addPattern({
      pattern: pattern.pattern,
      category: pattern.category,
      confidence: pattern.confidence ?? 0.9,
      author: "manual-seed",
    });
    count++;
  }

  for (const pref of data.preferences ?? []) {
    if (options.dryRun) {
      console.error(`  [dry-run] preference: ${pref.topic}`);
      count++;
      continue;
    }
    await longTerm.addPreference({
      topic: pref.topic,
      preference: pref.preference,
      source: "manual-seed",
    });
    count++;
  }

  for (const evo of data.evolution ?? []) {
    if (options.dryRun) {
      console.error(`  [dry-run] evolution: ${evo.area}`);
      count++;
      continue;
    }
    await longTerm.addEvolution({
      area: evo.area,
      history: evo.history,
      currentState: evo.current_state,
      plannedChanges: evo.planned_changes,
    });
    count++;
  }

  return count;
}
