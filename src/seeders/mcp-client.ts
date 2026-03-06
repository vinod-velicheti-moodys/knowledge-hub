import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectToMcp(
  command: string,
  args: string[],
  env?: Record<string, string>
): Promise<Client> {
  const transport = new StdioClientTransport({
    command,
    args,
    env: env ? { ...process.env, ...env } as Record<string, string> : undefined,
  });
  const client = new Client(
    { name: "tiq-knowledge-seeder", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return client;
}

export async function callMcpTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await client.callTool({ name: toolName, arguments: args });
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content.find(
      (c: any) => c.type === "text"
    ) as any;
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text);
      } catch {
        return textContent.text;
      }
    }
  }
  return result;
}

export async function disconnectMcp(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    /* ignore close errors */
  }
}
