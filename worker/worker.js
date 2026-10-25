// India Itinerary 2027: Cloudflare Worker
// Holds the Gemini key and a GitHub key so anyone using the trip site can chat with the
// planner and save changes, without keys of their own.
//   GET  /plan  the latest plan, straight from GitHub (fresher than the GitHub Pages copy)
//   POST /ask   forwards a planner chat request to Gemini (optionally with Google Search)
//   POST /save  writes data/trip.json to the GitHub repo
//   GET  /ping  says whether the secrets are set (never returns them)
// Secrets (Cloudflare: Settings, Variables and Secrets): GEMINI_API_KEY, GITHUB_TOKEN
// Safeguards: only the trip site may call /ask and /save, each visitor is rate limited,
// and a save that would delete most of the plan is refused. GitHub keeps every version.

const REPO = "surya0901/india-itinerary-2027";
const FILE = "data/trip.json";
const BRANCH = "main";
const ALLOWED_ORIGINS = ["https://surya0901.github.io"];
const DEFAULT_MODEL = "gemini-3.8-flash";
const LIMITS = { ask: [40, 600], save: [30, 600] }; // [requests, seconds] per visitor

const hits = new Map(); // best effort, per Worker instance

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
    const url = new URL(req.url);
    const gh = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "india-itinerary-2027-worker",
    };
    const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/ping") return json({ ok: true, ai: !!env.GEMINI_API_KEY, save: !!env.GITHUB_TOKEN });

    if (url.pathname === "/plan" && req.method === "GET") {
      if (!env.GITHUB_TOKEN) return json({ error: "The GitHub key isn't set up yet" }, 503);
      const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
      if (!cur.ok) return json({ error: `GitHub said ${cur.status}` }, 502);
      const curJson = await cur.json();
      return new Response(fromB64(curJson.content), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }

    if (req.method !== "POST") return json({ error: "Use POST" }, 405);
    if (!okOrigin) return json({ error: "Requests are only accepted from the trip site" }, 403);

    const who = req.headers.get("CF-Connecting-IP") || "unknown";
    const kind = url.pathname === "/ask" ? "ask" : url.pathname === "/save" ? "save" : null;
    if (kind && limited(kind, who)) return json({ error: "Too many requests. Wait a few minutes and try again." }, 429, { "Retry-After": "120" });

    if (url.pathname === "/ask") {
      if (!env.GEMINI_API_KEY) return json({ error: "The Gemini key isn't set up yet" }, 503);
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: "Bad request" }, 400); }
      const model = /^[\w.-]{3,60}$/.test(body.model || "") ? body.model : DEFAULT_MODEL;
      // the only tool allowed is Google Search grounding, so the planner can look things up
      const tools = Array.isArray(body.tools) && body.tools.length === 1 && body.tools[0] && typeof body.tools[0].google_search === "object" ? [{ google_search: {} }] : undefined;
      const payload = JSON.stringify({ systemInstruction: body.systemInstruction, contents: body.contents, generationConfig: body.generationConfig, tools });
      if (payload.length > 600000) return json({ error: "That request is too large" }, 413);
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: payload,
      });
      return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/save") {
      if (!env.GITHUB_TOKEN) return json({ error: "The GitHub key isn't set up yet" }, 503);
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: "Bad request" }, 400); }
      const { plan, who: name, baseUpdated, force } = body || {};
      if (!plan || !Array.isArray(plan.days) || !Array.isArray(plan.tickets) || !Array.isArray(plan.todos) || !plan.meta || !Array.isArray(plan.trips)) {
        return json({ error: "That doesn't look like a trip plan" }, 400);
      }
      const text = JSON.stringify(plan, null, 1) + "\n";
      if (text.length > 900000) return json({ error: "The plan is too large to save" }, 413);
      const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
      if (!cur.ok) return json({ error: `GitHub said ${cur.status} when reading the plan` }, 502);
      const curJson = await cur.json();
      let remote = null;
      try { remote = JSON.parse(fromB64(curJson.content)); } catch (e) {}
      if (remote) {
        // refuse saves that would wipe most of the plan
        const shrink = (a, b) => (b || []).length >= 6 && (a || []).length < (b || []).length * 0.6;
        if (shrink(plan.days, remote.days) || shrink(plan.tickets, remote.tickets)) {
          return json({ error: "That change would delete most of the plan, so it wasn't saved." }, 422);
        }
        if (!force && remote.meta && baseUpdated && remote.meta.updated !== baseUpdated) {
          return json({ error: "conflict", updatedBy: remote.meta.updatedBy || "", latest: remote }, 409);
        }
      }
      const by = String(name || "Someone").slice(0, 40).replace(/[^\p{L}\p{N} .'-]/gu, "") || "Someone";
      const put = await fetch(api, {
        method: "PUT",
        headers: { ...gh, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Update trip plan (${by})`, content: toB64(text), sha: curJson.sha, branch: BRANCH }),
      });
      if (put.status === 409) return json({ error: "conflict", updatedBy: "", latest: remote }, 409);
      if (!put.ok) return json({ error: `GitHub said ${put.status} when saving` }, 502);
      return json({ ok: true, updated: plan.meta.updated });
    }

    return json({ error: "Not found" }, 404);
  },
};

function limited(kind, who) {
  const [max, secs] = LIMITS[kind];
  const now = Date.now(), key = kind + ":" + who;
  const list = (hits.get(key) || []).filter((t) => now - t < secs * 1000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}
