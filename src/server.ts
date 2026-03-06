import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { SemanticMemory } from "./memory/semantic.js";
import { ParserRegistry } from "./parsers/registry.js";
import {
  buildResourceList,
  readResource,
} from "./resources/static-resources.js";
import {
  createSemanticTools,
  SEMANTIC_TOOL_DEFINITIONS,
} from "./tools/semantic-tools.js";
import {
  createTaskTools,
  TASK_TOOL_DEFINITIONS,
} from "./tools/task-tools.js";
import {
  createFactualTools,
  FACTUAL_TOOL_DEFINITIONS,
} from "./tools/factual-tools.js";
import {
  createLongtermTools,
  LONGTERM_TOOL_DEFINITIONS,
} from "./tools/longterm-tools.js";
import {
  createMetaTools,
  META_TOOL_DEFINITIONS,
} from "./tools/meta-tools.js";
import {
  createMemoryAdminTools,
  MEMORY_ADMIN_TOOL_DEFINITIONS,
} from "./tools/memory-admin-tools.js";
import {
  buildPromptList,
  getPrompt,
} from "./prompts/prompt-templates.js";
import { initDb, getPool, shutdown as shutdownDb } from "./memory/db.js";
import { ShortTermMemory } from "./memory/short-term.js";
import { FactualMemory } from "./memory/factual.js";
import { LongTermMemory } from "./memory/long-term.js";

export async function createServer(): Promise<Server> {
  const registry = new ParserRegistry();
  await registry.init(config.repoConfig, config.projectRoot);

  const semantic = new SemanticMemory(config.rulesDir, registry);

  await initDb();
  const pool = getPool();
  const shortTerm = new ShortTermMemory(pool, config.developerName);
  const factual = new FactualMemory(pool);
  const longTerm = new LongTermMemory(pool);

  const semanticTools = createSemanticTools(semantic, config.projectRoot);
  const taskTools = createTaskTools(shortTerm, factual, longTerm);
  const factualTools = createFactualTools(factual);
  const longtermTools = createLongtermTools(longTerm);
  const metaTools = createMetaTools(pool, shortTerm, factual, longTerm, config);
  const adminTools = createMemoryAdminTools(pool);

  const allToolDefs = [
    ...SEMANTIC_TOOL_DEFINITIONS,
    ...TASK_TOOL_DEFINITIONS,
    ...FACTUAL_TOOL_DEFINITIONS,
    ...LONGTERM_TOOL_DEFINITIONS,
    ...META_TOOL_DEFINITIONS,
    ...MEMORY_ADMIN_TOOL_DEFINITIONS,
  ];

  const toolHandlers: Record<string, (args: any) => Promise<any>> = {
    ...semanticTools,
    ...taskTools,
    ...factualTools,
    ...longtermTools,
    ...metaTools,
    ...adminTools,
  };

  const server = new Server(
    { name: "tiq-knowledge", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolDefs,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      return await handler(args ?? {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tool:${name}] Error:`, msg);
      return {
        content: [{ type: "text", text: `Error in ${name}: ${msg}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: buildResourceList(semantic, config),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const content = readResource(uri, semantic, config);
    if (content === null) {
      throw new Error(`Resource not found: ${uri}`);
    }
    return {
      contents: [{ uri, mimeType: "text/markdown", text: content }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: buildPromptList(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return getPrompt(name, args ?? {}, semantic, config);
  });

  const gracefulShutdown = async () => {
    console.error("[server] Shutting down...");
    await shutdownDb();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  return server;
}
