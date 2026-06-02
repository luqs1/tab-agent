// The one tiny server. Holds the OpenRouter key and adds CORS so the tab can
// call it. We default to FREE models (`:free`), so there's no per-token charge.
//
// Deploy once:  bun run deploy:worker   (needs `wrangler` + OPENROUTER_API_KEY)
// Dev locally:  bun run worker          (serves http://localhost:8787)
//
// Note: free models are rate-limited against *your* key (roughly 20 req/min, and
// 50/day under 10 credits / 1000/day at >=10 credits). Fine for personal use; if
// you expose this publicly, add an Origin allow-list below so randoms can't drain
// your limits.
interface Env {
  OPENROUTER_API_KEY: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        // Optional but recommended by OpenRouter (app attribution / rankings).
        "HTTP-Referer": "https://tab-agent.local",
        "X-Title": "tab-agent",
      },
      body: await req.text(),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS, "content-type": "application/json" },
    });
  },
};
