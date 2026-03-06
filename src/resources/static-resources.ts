import type { SemanticMemory } from "../memory/semantic.js";
import type { Config } from "../config.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function buildResourceList(
  semantic: SemanticMemory,
  config: Config
): ResourceDefinition[] {
  const prefix = config.projectName;
  const resources: ResourceDefinition[] = [];

  for (const rule of semantic.getAllStandards()) {
    resources.push({
      uri: `${prefix}://rules/${rule.title}`,
      name: `${rule.title}`,
      description: rule.description || `Rule: ${rule.title}`,
      mimeType: "text/markdown",
    });
  }

  return resources;
}

export function readResource(
  uri: string,
  semantic: SemanticMemory,
  config: Config
): string | null {
  const prefix = `${config.projectName}://rules/`;
  if (!uri.startsWith(prefix)) return null;

  const ruleKey = uri.slice(prefix.length);
  const rule = semantic.getStandard(ruleKey);
  if (!rule) return null;

  return rule.content;
}
