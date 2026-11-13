// Cloudflare Worker: KV-backed sync for the Discord clone.
// Uses the existing "shared-store" KV namespace (binding SHARED_KV).
// All keys are prefixed "discord-clone:" so they never collide with
// other apps sharing the namespace (e.g. Sakura Japanese "progress:" keys).
//
// Setup (one time):
//   cd Discord/workers && npx wrangler login
//   npx wrangler deploy
// Then in the app: Settings -> Cloud Sync -> paste the worker URL.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/kv\/([\w:.-]+)$/);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!m) return new Response("Use /kv/:key", { status: 404, headers: cors });
    const key = "discord-clone:" + m[1];

    if (req.method === "GET") {
      const v = await env.SHARED_KV.get(key);
      return new Response(v === null ? "null" : v, {
        headers: { "Content-Type": "application/json", ...cors }
      });
    }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 20 * 1024 * 1024) {
        return new Response("Value too large", { status: 413, headers: cors });
      }
      await env.SHARED_KV.put(key, body);
      return Response.json({ ok: true }, { headers: cors });
    }
    if (req.method === "DELETE") {
      await env.SHARED_KV.delete(key);
      return Response.json({ ok: true }, { headers: cors });
    }
    return new Response("Method not allowed", { status: 405, headers: cors });
  }
};
