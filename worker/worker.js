// India Itinerary 2027: Cloudflare Worker
// Holds the Gemini key and a GitHub key so family members only need the family code.
//   POST /ask   forwards a planner request to Gemini
//   POST /save  writes data/trip.json to the GitHub repo
//   GET  /ping  says whether the secrets are set (never returns them)
// Secrets to set in Cloudflare (Settings → Variables and Secrets):
//   GEMINI_API_KEY, GITHUB_TOKEN (fine-grained, this repo only, Contents: read and write), FAMILY_CODE

const REPO = "surya0901/india-itinerary-2027";
const FILE = "data/trip.json";
const BRANCH = "main";
const ALLOWED_ORIGINS = ["https://surya0901.github.io"];
const DEFAULT_MODEL = "gemini-3.8-flash";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Family-Code",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/ping") return json({ ok: true, ai: !!env.GEMINI_API_KEY, save: !!env.GITHUB_TOKEN, code: !!env.FAMILY_CODE });
    if (req.method !== "POST") return json({ error: "Use POST" }, 405);
    if (!okOrigin) return json({ error: "Requests are only accepted from the trip site" }, 403);
    if (!env.FAMILY_CODE || !(await sameText(req.headers.get("X-Family-Code") || "", env.FAMILY_CODE))) return json({ error: "wrong_code" }, 401);

    if (url.pathname === "/ask") {
      if (!env.GEMINI_API_KEY) return json({ error: "The Gemini key isn't set up yet" }, 503);
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: "Bad request" }, 400); }
      const model = /^[\w.-]{3,60}$/.test(body.model || "") ? body.model : DEFAULT_MODEL;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({ systemInstruction: body.systemInstruction, contents: body.contents, generationConfig: body.generationConfig }),
      });
      return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (url.pathname === "/save") {
      if (!env.GITHUB_TOKEN) return json({ error: "The GitHub key isn't set up yet" }, 503);
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: "Bad request" }, 400); }
      const { plan, who, baseUpdated, force } = body || {};
      if (!plan || !Array.isArray(plan.days) || !Array.isArray(plan.tickets) || !plan.meta) return json({ error: "That doesn't look like a trip plan" }, 400);
      const text = JSON.stringify(plan, null, 1) + "\n";
      if (text.length > 900000) return json({ error: "The plan is too large to save" }, 413);
      const gh = {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "india-itinerary-2027-worker",
      };
      const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
      const cur = await fetch(`${api}?ref=${BRANCH}`, { headers: gh });
      if (!cur.ok) return json({ error: `GitHub said ${cur.status} when reading the plan` }, 502);
      const curJson = await cur.json();
      let remote = {};
      try { remote = JSON.parse(fromB64(curJson.content)); } catch (e) {}
      if (!force && remote.meta && baseUpdated && remote.meta.updated !== baseUpdated) {
        return json({ error: "conflict", updatedBy: remote.meta.updatedBy || "", updated: remote.meta.updated || "" }, 409);
      }
      const name = String(who || "Family").slice(0, 40).replace(/[^\p{L}\p{N} .'-]/gu, "");
      const put = await fetch(api, {
        method: "PUT",
        headers: { ...gh, "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Update trip plan (${name})`, content: toB64(text), sha: curJson.sha, branch: BRANCH }),
      });
      if (!put.ok) return json({ error: `GitHub said ${put.status} when saving` }, 502);
      return json({ ok: true, updated: plan.meta.updated });
    }

    return json({ error: "Not found" }, 404);
  },
};

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}
async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
