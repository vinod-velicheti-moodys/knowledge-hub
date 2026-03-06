import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws if MCP_PROJECT_ROOT is missing", async () => {
    delete process.env.MCP_PROJECT_ROOT;
    delete process.env.MCP_DB_URL;
    delete process.env.MCP_DEVELOPER_NAME;

    await expect(
      import("../../src/config.js")
    ).rejects.toThrow();
  });

  it("parses valid config from env vars", async () => {
    process.env.MCP_PROJECT_ROOT = "/tmp/test-project";
    process.env.MCP_DB_URL = "postgresql://localhost/test";
    process.env.MCP_DEVELOPER_NAME = "test-dev";
    process.env.MCP_PROJECT_NAME = "test";

    const { config } = await import("../../src/config.js");

    expect(config.projectRoot).toBe("/tmp/test-project");
    expect(config.dbUrl).toBe("postgresql://localhost/test");
    expect(config.developerName).toBe("test-dev");
    expect(config.projectName).toBe("test");
    expect(config.embeddingModel).toBe("Xenova/all-MiniLM-L6-v2");
    expect(config.similarityThreshold).toBe(0.85);
  });
});
