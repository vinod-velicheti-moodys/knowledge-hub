#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[tiq-knowledge] MCP server started (stdio transport)");
}

main().catch((err) => {
  console.error("[tiq-knowledge] Fatal error:", err);
  process.exit(1);
});
