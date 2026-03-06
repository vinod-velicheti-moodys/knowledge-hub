import type { SemanticMemory } from "../memory/semantic.js";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { glob } from "glob";

interface ToolResult {
  content: { type: "text"; text: string }[];
}

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

export function createSemanticTools(semantic: SemanticMemory, projectRoot: string) {
  return {
    get_standard: async (args: { topic: string }): Promise<ToolResult> => {
      const rule = semantic.getStandard(args.topic);
      if (!rule) {
        const available = semantic.getRuleKeys().join(", ");
        return text(
          `No standard found for "${args.topic}". Available: ${available}`
        );
      }
      return text(
        `# ${rule.title}\n\n${rule.description ? `> ${rule.description}\n\n` : ""}${rule.content}`
      );
    },

    get_architecture: async (args: {
      subsystem?: string;
    }): Promise<ToolResult> => {
      const archRule = semantic.getStandard("nuxt2-architecture");
      if (!archRule) {
        const allRules = semantic.searchStandards("architecture");
        if (allRules.length === 0) {
          return text("No architecture documentation found in rules.");
        }
        return text(allRules[0].content);
      }

      if (!args.subsystem) {
        return text(`# Architecture Overview\n\n${archRule.content}`);
      }

      const lower = args.subsystem.toLowerCase();
      const sections = archRule.content.split(/\n## /);
      for (const section of sections) {
        if (section.toLowerCase().includes(lower)) {
          return text(`## ${section.trim()}`);
        }
      }

      return text(
        `Section "${args.subsystem}" not found in architecture docs. Available sections include: ${sections
          .slice(1)
          .map((s) => s.split("\n")[0])
          .join(", ")}`
      );
    },

    get_component_graph: async (args: {
      name: string;
    }): Promise<ToolResult> => {
      const registry = semantic.getParserRegistry();
      const parsed = await registry.parseComponent(args.name);

      if (typeof parsed === "string") {
        return text(parsed);
      }

      let usedByFiles: string[] = [];
      try {
        const allVueFiles = await glob("**/*.vue", {
          cwd: projectRoot,
          ignore: ["**/node_modules/**"],
        });

        const componentName = parsed.name;
        const kebabName = componentName
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .toLowerCase();

        for (const file of allVueFiles) {
          const fullPath = join(projectRoot, file);
          try {
            const content = readFileSync(fullPath, "utf-8");
            if (
              content.includes(componentName) ||
              content.includes(`<${kebabName}`) ||
              content.includes(`<${componentName}`)
            ) {
              if (fullPath !== parsed.path) {
                usedByFiles.push(file);
              }
            }
          } catch {
            /* skip unreadable files */
          }
        }
      } catch {
        /* glob not available or failed */
      }

      const result = {
        component: parsed.name,
        path: parsed.path,
        props: parsed.props,
        emits: parsed.emits,
        slots: parsed.slots,
        meta: parsed.meta,
        usedBy: usedByFiles.slice(0, 20),
      };

      return text(JSON.stringify(result, null, 2));
    },

    get_store_module: async (args: {
      module: string;
    }): Promise<ToolResult> => {
      const registry = semantic.getParserRegistry();
      const parsed = await registry.parseStore(args.module);

      if (typeof parsed === "string") {
        return text(parsed);
      }

      return text(JSON.stringify(parsed, null, 2));
    },

    get_service_api: async (args: {
      service: string;
    }): Promise<ToolResult> => {
      const registry = semantic.getParserRegistry();
      const parsed = await registry.parseService(args.service);

      if (typeof parsed === "string") {
        return text(parsed);
      }

      return text(JSON.stringify(parsed, null, 2));
    },
  };
}

export const SEMANTIC_TOOL_DEFINITIONS = [
  {
    name: "get_standard",
    description:
      "Get a coding standard or rule by topic. Returns the full rule content for topics like vue, react, ag-grid, radius, tailwind, architecture, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description:
            "Standard topic to look up (e.g. 'vue', 'react', 'ag-grid', 'radius', 'nuxt2-architecture', 'general-frontend', 'tiq-feat', 'tiq-task')",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "get_architecture",
    description:
      "Get the project architecture overview or a specific subsystem section.",
    inputSchema: {
      type: "object" as const,
      properties: {
        subsystem: {
          type: "string",
          description:
            "Optional subsystem to focus on (e.g. 'store', 'service', 'testing', 'ag grid'). Omit for full overview.",
        },
      },
    },
  },
  {
    name: "get_component_graph",
    description:
      "Get detailed metadata for a component (props, emits, slots) and find which files use it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description:
            "Component name or file path (e.g. 'ProgramDirectory' or 'frontend/components/home/ProgramDirectory.vue')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_store_module",
    description:
      "Get the structure of a Vuex store module: actions, mutations, getters, services used, and state shape.",
    inputSchema: {
      type: "object" as const,
      properties: {
        module: {
          type: "string",
          description:
            "Store module name (e.g. 'program', 'analysis', 'pricing')",
        },
      },
      required: ["module"],
    },
  },
  {
    name: "get_service_api",
    description:
      "Get all endpoints and methods for an API service class, including HTTP verbs and URL patterns.",
    inputSchema: {
      type: "object" as const,
      properties: {
        service: {
          type: "string",
          description:
            "Service name or keyword (e.g. 'UDSContractService', 'contract', 'analysis')",
        },
      },
      required: ["service"],
    },
  },
];
