import { simpleGit, type DefaultLogFields, type ListLogLine } from "simple-git";
import type { FactualMemory } from "../memory/factual.js";

interface GitSeederOptions {
  since?: string;
  branch?: string;
  excludeAuthors?: string[];
  excludePaths?: string[];
  dryRun?: boolean;
}

const TYPE_PATTERNS: [RegExp, string][] = [
  [/\b(?:fix|bugfix|hotfix|patch)\b/i, "bug_fix"],
  [/\b(?:refactor|restructure|reorganize)\b/i, "refactor"],
  [/\b(?:migrate|upgrade|update dep)\b/i, "migration"],
  [/\b(?:feat|add|implement|new)\b/i, "feature"],
];

function classifyCommit(message: string): string {
  for (const [pattern, type] of TYPE_PATTERNS) {
    if (pattern.test(message)) return type;
  }
  return "feature";
}

function extractTicketId(text: string): string | null {
  const match = text.match(/\b(TI[MQ]-\d+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function extractPrNumber(message: string): string | null {
  const match = message.match(/\(#(\d+)\)/);
  return match ? match[1] : null;
}

function extractTags(files: string[], message: string): string[] {
  const tags = new Set<string>();

  for (const file of files) {
    if (file.includes("store/")) tags.add("store");
    if (file.includes("components/")) tags.add("components");
    if (file.includes("pages/")) tags.add("pages");
    if (file.includes("services/") || file.includes("service")) tags.add("services");
    if (file.includes("test") || file.includes("spec")) tags.add("testing");
    if (file.endsWith(".vue")) tags.add("vue");
    if (file.endsWith(".tsx") || file.endsWith(".jsx")) tags.add("react");

    const parts = file.split("/");
    if (parts.length > 2) {
      tags.add(parts[parts.length - 2]);
    }
  }

  return [...tags].slice(0, 10);
}

export async function seedFromGit(
  factual: FactualMemory,
  projectRoot: string,
  options: GitSeederOptions = {}
): Promise<number> {
  const git = simpleGit({ baseDir: projectRoot });
  const since = options.since ?? "1 year ago";
  const excludeAuthors = options.excludeAuthors ?? [];

  const log = await git.log({
    "--since": since,
    "--no-merges": null as any,
    "--format": "%H|%an|%aI|%s",
  });

  let count = 0;
  type LogEntry = DefaultLogFields & ListLogLine;
  const grouped = new Map<
    string,
    { commits: LogEntry[]; key: string }
  >();

  for (const commit of log.all) {
    const message = commit.message;
    const ticketId = extractTicketId(message);
    const prNumber = extractPrNumber(message);

    if (excludeAuthors.includes(commit.author_name)) continue;

    const groupKey = ticketId ?? prNumber ?? commit.hash;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, { commits: [], key: groupKey });
    }
    grouped.get(groupKey)!.commits.push(commit);
  }

  for (const [, group] of grouped) {
    const firstCommit = group.commits[0];
    const allMessages = group.commits.map((c: LogEntry) => c.message).join("\n");
    const ticketId = extractTicketId(allMessages);
    const prNumber = extractPrNumber(allMessages);

    let allFiles: string[] = [];
    try {
      for (const commit of group.commits.slice(0, 5)) {
        const diff = await git.diffSummary([`${commit.hash}~1`, commit.hash]);
        allFiles.push(...diff.files.map((f: { file: string }) => f.file));
      }
    } catch {
      /* first commit or shallow clone */
    }

    allFiles = [...new Set(allFiles)].filter(
      (f) => !(options.excludePaths ?? []).some((p) => f.includes(p))
    );

    const eventType = classifyCommit(allMessages);
    const tags = extractTags(allFiles, allMessages);
    const summary = ticketId
      ? `${ticketId}: ${firstCommit.message.replace(/\(#\d+\)/, "").trim()}`
      : firstCommit.message;

    if (options.dryRun) {
      console.error(`  [dry-run] ${eventType}: ${summary} (${allFiles.length} files)`);
      count++;
      continue;
    }

    try {
      await factual.recordEvent({
        type: eventType,
        summary: summary.length >= 10 ? summary : `${summary} (commit group)`,
        details: allMessages,
        ticketId: ticketId ?? undefined,
        prNumber: prNumber ?? undefined,
        files: allFiles,
        tags,
        author: firstCommit.author_name,
      });
      count++;
    } catch (err) {
      console.error(`  [skip] ${summary}:`, (err as Error).message);
    }
  }

  return count;
}
