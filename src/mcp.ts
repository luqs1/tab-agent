// Remote MCP over Streamable HTTP — the only transport usable from a browser.
// The real-world blocker is CORS: the server must send the right headers, or you
// front it with a small proxy. stdio MCP servers can't run in a tab.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { log } from "./ui";

const client = new Client({ name: "tab-agent", version: "0.0.1" });

export type McpTool = { name: string; description?: string; inputSchema: unknown };

let tools: McpTool[] = [];

/** Connect to a remote MCP server. Returns its tools (empty on failure). */
export async function connectMcp(url: string): Promise<McpTool[]> {
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    tools = (await client.listTools()).tools as McpTool[];
    log(`✅ MCP connected · ${tools.length} tools`);
  } catch (e) {
    log("⚠️ MCP skipped: " + (e as Error).message);
  }
  return tools;
}

export async function callMcp(name: string, args: unknown): Promise<string> {
  const res = await client.callTool({ name, arguments: args as Record<string, unknown> });
  return JSON.stringify(res.content);
}

export const mcpTools = () => tools;
