import {
  loadRules,
  loadAgents,
  loadSkills,
  type RuleEntry,
  type KnowledgeNamespace,
} from "../parsers/rules-parser.js";
import type { ParserRegistry } from "../parsers/registry.js";

export interface SemanticMemoryConfig {
  rulesDir: string;
  agentsDir: string;
  skillsDirs: string[];
}

export class SemanticMemory {
  private entries: Map<string, RuleEntry>;
  private registry: ParserRegistry;

  constructor(dirs: SemanticMemoryConfig, registry: ParserRegistry) {
    this.entries = new Map<string, RuleEntry>();
    this.registry = registry;

    const rules = loadRules(dirs.rulesDir);
    for (const [key, entry] of rules) {
      this.entries.set(key, entry);
    }

    const agents = loadAgents(dirs.agentsDir);
    for (const [key, entry] of agents) {
      this.entries.set(key, entry);
    }

    const skills = loadSkills(dirs.skillsDirs);
    for (const [key, entry] of skills) {
      this.entries.set(key, entry);
    }

    console.error(
      `[semantic] Total entries: ${this.entries.size} (rules: ${rules.size}, agents: ${agents.size}, skills: ${skills.size})`
    );
  }

  getStandard(topic: string): RuleEntry | null {
    const lower = topic.toLowerCase();

    const exact = this.entries.get(topic) ?? this.entries.get(lower);
    if (exact) return exact;

    for (const [key, entry] of this.entries) {
      if (
        key.toLowerCase().includes(lower) ||
        lower.includes(key.toLowerCase())
      ) {
        return entry;
      }
    }

    for (const [, entry] of this.entries) {
      if (
        entry.description.toLowerCase().includes(lower) ||
        entry.content.toLowerCase().includes(lower)
      ) {
        return entry;
      }
    }

    return null;
  }

  getAllStandards(): RuleEntry[] {
    return [...this.entries.values()];
  }

  getByNamespace(namespace: KnowledgeNamespace): RuleEntry[] {
    return [...this.entries.values()].filter(
      (e) => e.namespace === namespace
    );
  }

  searchStandards(
    query: string,
    namespace?: KnowledgeNamespace
  ): RuleEntry[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);

    const scored: { rule: RuleEntry; score: number }[] = [];
    for (const entry of this.entries.values()) {
      if (namespace && entry.namespace !== namespace) continue;

      let score = 0;
      const searchable =
        `${entry.title} ${entry.description} ${entry.content}`.toLowerCase();

      for (const term of terms) {
        if (searchable.includes(term)) score++;
      }

      if (score > 0) scored.push({ rule: entry, score });
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.rule);
  }

  getKeysByNamespace(namespace: KnowledgeNamespace): string[] {
    return [...this.entries.entries()]
      .filter(([, e]) => e.namespace === namespace)
      .map(([key]) => key);
  }

  getRuleKeys(): string[] {
    return [...this.entries.keys()];
  }

  getParserRegistry(): ParserRegistry {
    return this.registry;
  }
}
