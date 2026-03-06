import { z } from "zod";
import { join, basename } from "path";

const envSchema = z.object({
  MCP_PROJECT_ROOT: z.string().min(1),
  MCP_PROJECT_NAME: z.string().optional(),
  MCP_DB_URL: z.string().min(1),
  MCP_DEVELOPER_NAME: z.string().min(1),
  MCP_FRAMEWORK: z.string().default("nuxt2"),
  MCP_PARSERS: z.string().default("vue2-component,vuex-store,axios-service,nuxt2-route"),
  MCP_RULES_DIR: z.string().optional(),
  MCP_AGENTS_DIR: z.string().optional(),
  MCP_SKILLS_DIRS: z.string().optional(),
  MCP_EMBEDDING_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  MCP_SIMILARITY_THRESHOLD: z.coerce.number().default(0.85),
});

function resolveRelative(projectRoot: string, value: string): string {
  return value.startsWith("/") ? value : join(projectRoot, value);
}

function buildConfig() {
  const env = envSchema.parse(process.env);
  const projectRoot = env.MCP_PROJECT_ROOT;
  const cursorDir = join(projectRoot, ".cursor");

  const parsers = env.MCP_PARSERS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id }));

  const skillsDirs = env.MCP_SKILLS_DIRS
    ? env.MCP_SKILLS_DIRS.split(",").map((s) => resolveRelative(projectRoot, s.trim()))
    : [join(cursorDir, "skills")];

  return {
    projectRoot,
    projectName: env.MCP_PROJECT_NAME ?? basename(projectRoot),
    dbUrl: env.MCP_DB_URL,
    framework: env.MCP_FRAMEWORK,
    parsers,
    rulesDir: env.MCP_RULES_DIR
      ? resolveRelative(projectRoot, env.MCP_RULES_DIR)
      : join(cursorDir, "rules"),
    agentsDir: env.MCP_AGENTS_DIR
      ? resolveRelative(projectRoot, env.MCP_AGENTS_DIR)
      : join(cursorDir, "agents"),
    skillsDirs,
    developerName: env.MCP_DEVELOPER_NAME,
    embeddingModel: env.MCP_EMBEDDING_MODEL,
    similarityThreshold: env.MCP_SIMILARITY_THRESHOLD,
  };
}

export const config = buildConfig();
export type Config = ReturnType<typeof buildConfig>;
