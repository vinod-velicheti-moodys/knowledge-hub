import { readFileSync } from "fs";
import { join } from "path";
import type { SemanticMemory } from "../memory/semantic.js";
import type { Config } from "../config.js";

interface PromptDef {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

export function buildPromptList(): PromptDef[] {
  return [
    {
      name: "review-component",
      description:
        "Generate a structured review prompt for a Vue/React component against TreatyIQ standards.",
      arguments: [
        {
          name: "filePath",
          description: "Path to the component file relative to project root",
          required: true,
        },
      ],
    },
    {
      name: "plan-feature",
      description:
        "Generate a feature planning prompt using the TreatyIQ feature workflow and architecture context.",
      arguments: [
        {
          name: "ticketNumber",
          description: "JIRA ticket number (e.g. TIM-10654)",
          required: true,
        },
        {
          name: "description",
          description: "Brief description of the feature",
          required: true,
        },
      ],
    },
    {
      name: "generate-test",
      description:
        "Generate a test writing prompt for a component or module, including relevant testing patterns.",
      arguments: [
        {
          name: "filePath",
          description: "Path to the file to test",
          required: true,
        },
        {
          name: "testType",
          description: "Type of test: unit, integration, or e2e",
          required: true,
        },
      ],
    },
  ];
}

export function getPrompt(
  name: string,
  args: Record<string, string>,
  semantic: SemanticMemory,
  config: Config
): { description: string; messages: { role: string; content: { type: string; text: string } }[] } {
  switch (name) {
    case "review-component":
      return reviewComponentPrompt(args, semantic, config);
    case "plan-feature":
      return planFeaturePrompt(args, semantic);
    case "generate-test":
      return generateTestPrompt(args, semantic, config);
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

function reviewComponentPrompt(
  args: Record<string, string>,
  semantic: SemanticMemory,
  config: Config
) {
  const filePath = args.filePath;
  let fileContent: string;
  try {
    fileContent = readFileSync(join(config.projectRoot, filePath), "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const standards = [
    semantic.getStandard("vue-standards"),
    semantic.getStandard("general-frontend-standards"),
    semantic.getStandard("radius-components"),
  ]
    .filter(Boolean)
    .map((r) => r!.content)
    .join("\n\n---\n\n");

  return {
    description: `Review ${filePath} against TreatyIQ standards`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Review this component against the team's coding standards. Report any violations and suggest improvements.\n\n## File: ${filePath}\n\n\`\`\`\n${fileContent}\n\`\`\`\n\n## Applicable Standards\n\n${standards}`,
        },
      },
    ],
  };
}

function planFeaturePrompt(
  args: Record<string, string>,
  semantic: SemanticMemory
) {
  const workflow = semantic.getStandard("tiq-feat");
  const architecture = semantic.getStandard("nuxt2-architecture");

  return {
    description: `Plan feature ${args.ticketNumber}: ${args.description}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Plan the implementation of feature ${args.ticketNumber}: ${args.description}\n\nFollow this workflow:\n${workflow?.content ?? "No feature workflow found."}\n\nArchitecture context:\n${architecture?.content ?? "No architecture docs found."}`,
        },
      },
    ],
  };
}

function generateTestPrompt(
  args: Record<string, string>,
  semantic: SemanticMemory,
  config: Config
) {
  const filePath = args.filePath;
  let fileContent: string;
  try {
    fileContent = readFileSync(join(config.projectRoot, filePath), "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const vueStandards = semantic.getStandard("vue-standards");
  const testingSection = vueStandards?.content
    .split("## ")
    .find((s) => s.toLowerCase().includes("testing"));

  return {
    description: `Generate ${args.testType} tests for ${filePath}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Generate ${args.testType} tests for this file. Follow the team's testing standards.\n\n## File: ${filePath}\n\n\`\`\`\n${fileContent}\n\`\`\`\n\n## Testing Standards\n\n${testingSection ? `## ${testingSection}` : "Use @vue/test-utils + jest/vitest. Cover rendering, interaction, and edge cases."}`,
        },
      },
    ],
  };
}
