import { readFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";

export interface RuleEntry {
  title: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
  content: string;
  sourcePath: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const YAML_STRING_RE = /^(\w[\w-]*):\s*["']?(.+?)["']?\s*$/;
const YAML_BOOL_RE = /^(\w[\w-]*):\s*(true|false)\s*$/i;
const YAML_ARRAY_START_RE = /^(\w[\w-]*):\s*$/;
const YAML_ARRAY_ITEM_RE = /^\s*-\s*["']?(.+?)["']?\s*$/;

function parseFrontmatter(raw: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  let currentArrayKey: string | null = null;
  let currentArray: string[] = [];

  for (const line of lines) {
    const arrayItem = line.match(YAML_ARRAY_ITEM_RE);
    if (arrayItem && currentArrayKey) {
      currentArray.push(arrayItem[1]);
      continue;
    }

    if (currentArrayKey) {
      meta[currentArrayKey] = currentArray;
      currentArrayKey = null;
      currentArray = [];
    }

    const boolMatch = line.match(YAML_BOOL_RE);
    if (boolMatch) {
      meta[boolMatch[1]] = boolMatch[2].toLowerCase() === "true";
      continue;
    }

    const strMatch = line.match(YAML_STRING_RE);
    if (strMatch) {
      meta[strMatch[1]] = strMatch[2];
      continue;
    }

    const arrStart = line.match(YAML_ARRAY_START_RE);
    if (arrStart) {
      currentArrayKey = arrStart[1];
      currentArray = [];
    }
  }

  if (currentArrayKey) {
    meta[currentArrayKey] = currentArray;
  }

  const body = raw.slice(match[0].length);
  return { meta, body };
}

export function loadRules(rulesDir: string): Map<string, RuleEntry> {
  const rules = new Map<string, RuleEntry>();
  if (!existsSync(rulesDir)) {
    console.error(`[rules] Rules directory not found: ${rulesDir}`);
    return rules;
  }

  const files = readdirSync(rulesDir).filter(
    (f) => f.endsWith(".mdc") || f.endsWith(".md")
  );

  for (const file of files) {
    const filePath = join(rulesDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const stem = basename(file).replace(/\.(mdc|md)$/, "");

      rules.set(stem, {
        title: stem,
        description: (meta.description as string) ?? "",
        globs: Array.isArray(meta.globs) ? (meta.globs as string[]) : [],
        alwaysApply: (meta.alwaysApply as boolean) ?? false,
        content: body.trim(),
        sourcePath: filePath,
      });
    } catch (err) {
      console.error(`[rules] Failed to parse ${file}:`, err);
    }
  }

  console.error(`[rules] Loaded ${rules.size} rules from ${rulesDir}`);
  return rules;
}
