import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const envSchema = z.object({
  MCP_PROJECT_ROOT: z.string().min(1),
  MCP_PROJECT_NAME: z.string().optional(),
  MCP_DB_URL: z.string().min(1),
  MCP_RULES_DIR: z.string().optional(),
  MCP_DEVELOPER_NAME: z.string().min(1),
  MCP_EMBEDDING_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  MCP_SIMILARITY_THRESHOLD: z.coerce.number().default(0.85),
});

const repoConfigSchema = z.object({
  name: z.string().optional(),
  framework: z.string().optional(),
  parsers: z
    .array(
      z.object({
        id: z.string(),
        options: z.record(z.unknown()).optional(),
      })
    )
    .optional(),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

function loadRepoConfig(projectRoot: string): RepoConfig | null {
  const configPath = join(projectRoot, ".knowledge-mcp.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return repoConfigSchema.parse(raw);
  } catch (err) {
    console.error(`[config] Failed to parse ${configPath}:`, err);
    return null;
  }
}

function buildConfig() {
  const env = envSchema.parse(process.env);
  const projectRoot = env.MCP_PROJECT_ROOT;
  const repoConfig = loadRepoConfig(projectRoot);

  return {
    projectRoot,
    projectName:
      env.MCP_PROJECT_NAME ??
      repoConfig?.name ??
      basename(projectRoot),
    dbUrl: env.MCP_DB_URL,
    rulesDir: env.MCP_RULES_DIR ?? join(projectRoot, ".cursor/rules"),
    developerName: env.MCP_DEVELOPER_NAME,
    embeddingModel: env.MCP_EMBEDDING_MODEL,
    similarityThreshold: env.MCP_SIMILARITY_THRESHOLD,
    repoConfig,
  };
}

export const config = buildConfig();
export type Config = ReturnType<typeof buildConfig>;
