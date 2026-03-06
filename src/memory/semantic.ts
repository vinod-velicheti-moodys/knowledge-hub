import { loadRules, type RuleEntry } from "../parsers/rules-parser.js";
import type { ParserRegistry } from "../parsers/registry.js";

export class SemanticMemory {
  private rules: Map<string, RuleEntry>;
  private registry: ParserRegistry;

  constructor(rulesDir: string, registry: ParserRegistry) {
    this.rules = loadRules(rulesDir);
    this.registry = registry;
  }

  getStandard(topic: string): RuleEntry | null {
    const lower = topic.toLowerCase();

    const exact = this.rules.get(topic) ?? this.rules.get(lower);
    if (exact) return exact;

    for (const [key, rule] of this.rules) {
      if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
        return rule;
      }
    }

    for (const [, rule] of this.rules) {
      if (
        rule.description.toLowerCase().includes(lower) ||
        rule.content.toLowerCase().includes(lower)
      ) {
        return rule;
      }
    }

    return null;
  }

  getAllStandards(): RuleEntry[] {
    return [...this.rules.values()];
  }

  searchStandards(query: string): RuleEntry[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);

    const scored: { rule: RuleEntry; score: number }[] = [];
    for (const rule of this.rules.values()) {
      let score = 0;
      const searchable = `${rule.title} ${rule.description} ${rule.content}`.toLowerCase();

      for (const term of terms) {
        if (searchable.includes(term)) score++;
      }

      if (score > 0) scored.push({ rule, score });
    }

    return scored.sort((a, b) => b.score - a.score).map((s) => s.rule);
  }

  getRuleKeys(): string[] {
    return [...this.rules.keys()];
  }

  getParserRegistry(): ParserRegistry {
    return this.registry;
  }
}
