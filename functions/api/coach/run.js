// functions/api/coach/run.js
// Generates an AI coach summary from the latest snapshot and stores it in KV.
//
// Requires:
// - env.OPENAI_API_KEY (Cloudflare secret)
// - env.MCM_KV (KV binding)

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function getKV(env) {
  if (env.MCM_KV) return env.MCM_KV;
  if (env.KV) return env.KV;
  for (const k of Object.keys(env || {})) {
    const v = env[k];
    if (v && typeof v.get === "function" && typeof v.put === "function") return v;
  }
  return null;
}

async function callOpenAI({ apiKey, model, messages }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages,
    }),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok) {
    return { ok: false, status: r.status, error: j?.error?.message || "OpenAI request failed", raw: j };
  }
  const text = j?.choices?.[0]?.message?.content || "";
  return { ok: true, text };
}

function pickKeyPrefix(snapshotMeta) {
  // Helpful for display; not critical
  return snapshotMeta?.session ? String(snapshotMeta.session) : "UNK";
}

function buildCoachPrompt(snapshot) {
  // Keep it lightweight: we’re not doing deep quant, just narrative + “what to watch”.
  // Snapshot structure matches your /api/snapshot output.
  const meta = snapshot?._meta || {};
  const symbols = Object.keys(snapshot || {}).filter((k) => k !== "_meta");

  const rows = symbols.map((sym) => {
    const d = snapshot[sym] || {};
    const base = d.baseline ?? null;
    const last = d.last ?? null;
    const rthHigh = d?.rth?.high ?? null;
    const rthConf = !!d?.rth?.reversal?.confirmed;
    const ethHigh = d?.eth?.high ?? null;
    const ethConf = !!d?.eth?.reversal?.confirmed;
    const prevClose = d?.meta?.previous_close ?? null;

    return {
      sym,
      baseline: base,
      last,
      prevClose,
      rthHigh,
      rthConfirmed: rthConf,
      ethHigh,
      ethConfirmed: ethConf,
    };
  });

  return {
    meta,
    rows,
  };
}

export async function onRequestGet({ request, env }) {
  const kv = getKV(env);
  if (!kv) return json({ error: "Missing KV binding (expected env.MCM_KV)" }, 500);

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "Missing env.OPENAI_API_KEY (Cloudflare Secret)" }, 500);

  // Pull the most recent snapshot from KV if you stored it,
  // OR just call your snapshot endpoint on-demand.
  // Easiest/most reliable: call the snapshot endpoint on-demand.
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "MSFT,CRM,JPM,AXP,NKE,IBM").trim();
  const snapshotUrl = new URL(url.origin + "/api/snapshot");
  snapshotUrl.searchParams.set("symbols", symbols);

  const snapRes = await fetch(snapshotUrl.toString(), { cf: { cacheTtl: 0, cacheEverything: false } });
  const snapshot = await snapRes.json().catch(() => null);
  if (!snapRes.ok || !snapshot || snapshot.error) {
    return json({ error: "Failed to fetch snapshot for coach", details: snapshot || null }, 502);
  }

  const { meta, rows } = buildCoachPrompt(snapshot);

  const messages = [
    {
      role: "system",
      content:
        "You are MCM Coach: a concise, risk-aware market tape reader. Provide educational commentary only. No financial advice. Output must be short bullet points.",
    },
    {
      role: "user",
      content:
        `Context:\n` +
        `- Tool: experimental Dow-focused reversal tracker (panic mean reversion vs repricing).\n` +
        `- As-of: ${meta.asof_market || meta.asof_local || "unknown"}\n` +
        `- Session: ${meta.session || "unknown"}\n\n` +
        `Data (JSON):\n${JSON.stringify({ meta, rows }, null, 2)}\n\n` +
        `Task:\n` +
        `1) Give 4-6 bullets: what stands out, breadth, leaders vs laggards.\n` +
        `2) One bullet: what would invalidate the current read.\n` +
        `3) One bullet: what to watch next hour.\n` +
        `Keep it plain English.`,
    },
  ];

  const model = env.OPENAI_MODEL || "gpt-4o-mini"; // you can override via variable if you want
  const ai = await callOpenAI({ apiKey, model, messages });

  if (!ai.ok) return json({ error: ai.error, status: ai.status, raw: ai.raw }, 502);

  // Turn content into bullet list array for your UI
  const lines = ai.text
    .split("\n")
    .map((s) => s.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const out = {
    asof_local: meta.asof_local || new Date().toLocaleString(),
    asof_market: meta.asof_market || null,
    session: meta.session || pickKeyPrefix(meta),
    text: lines.length ? lines : [ai.text.trim()].filter(Boolean),
    model,
    symbols,
  };

  await kv.put("mcm:coach:latest", JSON.stringify(out), { expirationTtl: 60 * 60 }); // keep 1 hour
  return json({ ok: true, stored: true, coach: out });
}
