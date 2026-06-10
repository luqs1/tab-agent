// Remote MCP over Streamable HTTP — the only transport usable from a browser.
// The real-world blocker is CORS: the server must send the right headers, or you
// front it with a small proxy. stdio MCP servers can't run in a tab.
//
// Multiple servers can be connected at once (e.g. DeepWiki + a fetch server).
// Each gets a short namespace derived from its host; the tools it exposes are
// presented to the model as `<ns>__<tool>` so two servers can't collide, and a
// call is routed back to the right client by that namespace.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { note, error } from "./ui";

export type McpTool = { name: string; description?: string; inputSchema: unknown };

type Conn = { url: string; ns: string; client: Client; tools: McpTool[] };
let conns: Conn[] = [];

// A short, readable namespace from the host's first label ("deepwiki.com" ->
// "deepwiki"), made unique against the servers already connected.
function makeNs(url: string): string {
  let base = "srv";
  try {
    base = new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/gi, "") || "srv";
  } catch {}
  let ns = base;
  let n = 2;
  while (conns.some((c) => c.ns === ns)) ns = base + n++;
  return ns;
}

/** Connect a remote MCP server, ADDING it to any already connected. */
export async function connectMcp(url: string, token?: string): Promise<void> {
  if (conns.some((c) => c.url === url)) return; // already connected
  try {
    const client = new Client({ name: "tab.agent", version: "0.0.1" });
    // A per-server bearer token (when set) rides on every request to that server.
    const opts = token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : undefined;
    await client.connect(new StreamableHTTPClientTransport(new URL(url), opts));
    const tools = (await client.listTools()).tools as McpTool[];
    conns.push({ url, ns: makeNs(url), client, tools });
    note(`Extra tools connected: ${tools.map((t) => t.name).join(", ") || "(none)"}`);
  } catch (e) {
    error(
      "I couldn't reach that tool server. It needs to speak MCP over Streamable HTTP " +
        "and allow browsers (CORS). Carrying on without it."
    );
  }
}

/** Drop one server by url, or all of them if no url is given. */
export async function disconnectMcp(url?: string) {
  const keep: Conn[] = [];
  for (const c of conns) {
    if (url && c.url !== url) {
      keep.push(c);
      continue;
    }
    await c.client.close().catch(() => {});
  }
  conns = keep;
}

// Every connected server's tools, namespaced so names never collide.
export function mcpTools(): McpTool[] {
  return conns.flatMap((c) => c.tools.map((t) => ({ ...t, name: `${c.ns}__${t.name}` })));
}

export async function callMcp(name: string, args: unknown): Promise<string> {
  // Split off the namespace (no `__` in a ns) to find the server; the rest is
  // the server's real tool name, which may itself contain `__`.
  const i = name.indexOf("__");
  const ns = i >= 0 ? name.slice(0, i) : "";
  const tool = i >= 0 ? name.slice(i + 2) : name;
  const conn = conns.find((c) => c.ns === ns);
  if (!conn) return `No tool server is connected for "${name}".`;
  const res = await conn.client.callTool({ name: tool, arguments: args as Record<string, unknown> });
  return JSON.stringify(res.content);
}

/** The connected servers (url + namespace), for the settings UI. */
export const mcpServers = () => conns.map((c) => ({ url: c.url, ns: c.ns }));
