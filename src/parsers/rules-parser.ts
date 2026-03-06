import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, relative } from "path";

export type KnowledgeNamespace = "rule" | "agent" | "skill";

export interface RuleEntry {
  title: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
  content: string;
  sourcePath: string;
  namespace: KnowledgeNamespace;
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
        namespace: "rule",
      });
    } catch (err) {
      console.error(`[rules] Failed to parse ${file}:`, err);
    }
  }

  console.error(`[rules] Loaded ${rules.size} rules from ${rulesDir}`);
  return rules;
}

/**
 * Load flat .md files from a directory as agents.
 * Each file becomes `agent:<stem>`.
 */
export function loadAgents(agentsDir: string): Map<string, RuleEntry> {
  const entries = new Map<string, RuleEntry>();
  if (!existsSync(agentsDir)) {
    console.error(`[agents] Directory not found: ${agentsDir}`);
    return entries;
  }

  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const filePath = join(agentsDir, file);
    try {
      const raw = readFileSync(filePath, "utf-8");
      const { meta, body } = parseFrontmatter(raw);
      const stem = basename(file, ".md");
      const key = `agent:${stem}`;

      entries.set(key, {
        title: stem,
        description: (meta.description as string) ?? `Agent workflow: ${stem}`,
        globs: [],
        alwaysApply: false,
        content: body.trim(),
        sourcePath: filePath,
        namespace: "agent",
      });
    } catch (err) {
      console.error(`[agents] Failed to parse ${file}:`, err);
    }
  }

  console.error(`[agents] Loaded ${entries.size} agents from ${agentsDir}`);
  return entries;
}

const SECTION_HEADING_RE = /^## (.+)$/m;
const SECTION_SPLIT_THRESHOLD = 500;

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Split a large markdown file into sections on `## ` headings.
 * Returns an array of { slug, heading, content } objects.
 */
function splitSections(
  content: string
): { slug: string; heading: string; content: string }[] {
  const lines = content.split("\n");
  const sections: { slug: string; heading: string; content: string }[] = [];
  let currentHeading = "";
  let currentSlug = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(SECTION_HEADING_RE);
    if (match) {
      if (currentLines.length > 0) {
        sections.push({
          slug: currentSlug,
          heading: currentHeading,
          content: currentLines.join("\n").trim(),
        });
      }
      currentHeading = match[1].trim();
      currentSlug = slugify(currentHeading);
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 && currentSlug) {
    sections.push({
      slug: currentSlug,
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections;
}

/**
 * Load skill directories. Each subdirectory under `skillsDir` is a skill group.
 *   - SKILL.md → `skill:<group-name>` (the summary)
 *   - reference.md → section-split into `skill:<group-name>/<section-slug>`
 *
 * Handles multiple skill root directories.
 */
export function loadSkills(skillsDirs: string[]): Map<string, RuleEntry> {
  const entries = new Map<string, RuleEntry>();

  for (const skillsDir of skillsDirs) {
    if (!existsSync(skillsDir)) {
      console.error(`[skills] Directory not found: ${skillsDir}`);
      continue;
    }

    const subdirs = readdirSync(skillsDir).filter((d) => {
      try {
        return statSync(join(skillsDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const groupName of subdirs) {
      const groupDir = join(skillsDir, groupName);
      const skillFile = join(groupDir, "SKILL.md");
      const refFile = join(groupDir, "reference.md");

      if (existsSync(skillFile)) {
        try {
          const raw = readFileSync(skillFile, "utf-8");
          const { meta, body } = parseFrontmatter(raw);
          const key = `skill:${groupName}`;

          entries.set(key, {
            title: groupName,
            description:
              (meta.description as string) ?? `Skill: ${groupName}`,
            globs: [],
            alwaysApply: false,
            content: body.trim(),
            sourcePath: skillFile,
            namespace: "skill",
          });
        } catch (err) {
          console.error(`[skills] Failed to parse ${skillFile}:`, err);
        }
      }

      if (existsSync(refFile)) {
        try {
          const raw = readFileSync(refFile, "utf-8");
          const { body } = parseFrontmatter(raw);
          const lineCount = body.split("\n").length;

          if (lineCount > SECTION_SPLIT_THRESHOLD) {
            const sections = splitSections(body);
            for (const section of sections) {
              if (!section.slug) continue;
              const key = `skill:${groupName}/${section.slug}`;
              entries.set(key, {
                title: `${groupName}/${section.heading}`,
                description: `${groupName} API: ${section.heading}`,
                globs: [],
                alwaysApply: false,
                content: section.content,
                sourcePath: refFile,
                namespace: "skill",
              });
            }
            console.error(
              `[skills] Section-split ${relative(skillsDir, refFile)} into ${sections.length} entries`
            );
          } else {
            const key = `skill:${groupName}/reference`;
            entries.set(key, {
              title: `${groupName}/reference`,
              description: `Full API reference for ${groupName}`,
              globs: [],
              alwaysApply: false,
              content: body.trim(),
              sourcePath: refFile,
              namespace: "skill",
            });
          }
        } catch (err) {
          console.error(`[skills] Failed to parse ${refFile}:`, err);
        }
      }
    }
  }

  console.error(`[skills] Loaded ${entries.size} skill entries`);
  return entries;
}
