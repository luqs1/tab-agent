// Remote MCP over Streamable HTTP — the only transport usable from a browser.
// The real-world blocker is CORS: the server must send the right headers, or you
// front it with a small proxy. stdio MCP servers can't run in a tab.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { note, error } from "./ui";

let client: Client | null = null;

export type McpTool = { name: string; description?: string; inputSchema: unknown };

let tools: McpTool[] = [];

/** Connect to a remote MCP server (replacing any previous one). Returns its tools. */
export async function connectMcp(url: string): Promise<McpTool[]> {
  try {
    if (client) await client.close().catch(() => {});
    tools = [];
    client = new Client({ name: "tab.agent", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    tools = (await client.listTools()).tools as McpTool[];
    note(`Extra tools connected: ${tools.map((t) => t.name).join(", ") || "(none)"}`);
  } catch (e) {
    error(
      "I couldn't reach that tool server. It needs to speak MCP over Streamable HTTP " +
        "and allow browsers (CORS). Carrying on without it."
    );
  }
  return tools;
}

/** Drop the current MCP connection. */
export async function disconnectMcp() {
  if (client) await client.close().catch(() => {});
  client = null;
  tools = [];
}

export async function callMcp(name: string, args: unknown): Promise<string> {
  if (!client) return "No tool server is connected.";
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
  return JSON.stringify(res.content);
}

export const mcpTools = () => tools;
