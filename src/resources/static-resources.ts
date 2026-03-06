import type { SemanticMemory } from "../memory/semantic.js";
import type { Config } from "../config.js";
import type { KnowledgeNamespace } from "../parsers/rules-parser.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const NAMESPACE_URI_SEGMENT: Record<KnowledgeNamespace, string> = {
  rule: "rules",
  agent: "agents",
  skill: "skills",
};

export function buildResourceList(
  semantic: SemanticMemory,
  config: Config
): ResourceDefinition[] {
  const prefix = config.projectName;
  const resources: ResourceDefinition[] = [];

  for (const entry of semantic.getAllStandards()) {
    const segment = NAMESPACE_URI_SEGMENT[entry.namespace];
    const titleSlug =
      entry.namespace === "rule" ? entry.title : entry.title;

    resources.push({
      uri: `${prefix}://${segment}/${titleSlug}`,
      name: entry.title,
      description: entry.description || `${entry.namespace}: ${entry.title}`,
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
  const prefix = config.projectName;

  for (const [ns, segment] of Object.entries(NAMESPACE_URI_SEGMENT)) {
    const uriPrefix = `${prefix}://${segment}/`;
    if (!uri.startsWith(uriPrefix)) continue;

    const key = uri.slice(uriPrefix.length);
    const namespacedKey =
      ns === "rule" ? key : `${ns}:${key}`;
    const entry = semantic.getStandard(namespacedKey);
    if (entry) return entry.content;
  }

  return null;
}
