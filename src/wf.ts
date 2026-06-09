// Workflows-in-a-URL: instructions (an install.md, a chore script…) ride in the
// URL FRAGMENT — `#wf=<base64url(deflate(JSON))>`. The fragment never leaves
// the browser (not sent in requests, not in logs), works on file:// copies,
// and compresses well: a typical install.md is well under 1k URL chars.
//
// Instructions may contain {{name}} placeholders; the consent card renders an
// input per placeholder before running. NOTHING auto-runs: the user always
// sees the instructions and clicks Run.

export type Workflow = { title?: string; instructions: string };

const b64uEncode = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64uDecode = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** Build a full shareable link for the current page. */
export async function encodeWorkflowLink(wf: Workflow): Promise<string> {
  const payload = await deflate(JSON.stringify({ v: 1, t: wf.title ?? "", i: wf.instructions }));
  return location.origin + location.pathname + "#wf=" + b64uEncode(payload);
}

/** Decode `#wf=…` from a hash. Returns null if absent or malformed. */
export async function decodeWorkflowHash(hash: string): Promise<Workflow | null> {
  const m = hash.match(/^#wf=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const json = JSON.parse(await inflate(b64uDecode(m[1])));
    if (typeof json.i !== "string" || !json.i.trim()) return null;
    return { title: typeof json.t === "string" && json.t ? json.t : undefined, instructions: json.i };
  } catch {
    return null;
  }
}

/** Unique {{placeholder}} names, in order of first appearance. */
export function workflowParams(instructions: string): string[] {
  const out: string[] = [];
  for (const m of instructions.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g))
    if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Substitute {{name}} placeholders with the given values. */
export function fillParams(instructions: string, values: Record<string, string>): string {
  return instructions.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name) =>
    name in values ? values[name] : whole
  );
}
