// functions/api/coach/refresh.js
// Generates coach output if stale (default 30m), otherwise returns cached.
// Requires env.MCM_KV binding.
// Requires env.OPENAI_API_KEY (or env.OPENAI_KEY).
// Reads snapshot from /api/snapshot (same origin).

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

function pickApiKey(env) {
  return env.OPENAI_API_KEY || env.OPENAI_KEY || null;
}

function parseSymbols(url) {
  const raw = url.searchParams.get("symbols") || "";
  const syms = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return syms.length ? syms.slice(0, 50) : null;
}

async function fetchJSON(u) {
  const r = await fetch(u, { cf: { cacheTtl: 0, cacheEverything: false } });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
}

function buildPromptFromSnapshot(snapshot, symbols) {
  const meta = snapshot?._meta || {};
  const rows = symbols
    .map((sym) => {
      const d = snapshot[sym];
      if (!d || d.error) return `${sym}: (no data)`;
      const base = d.baseline;
      const last = d.last;
      const rthHigh = d?.rth?.high;
      const rthPerf = d?.rth?.perfHigh;
      const rthConf = !!d?.rth?.reversal?.confirmed;
      const ethHigh = d?.eth?.high;
      const ethPerf = d?.eth?.perfHigh;
      const ethConf = !!d?.eth?.reversal?.confirmed;

      return [
        `${sym}:`,
        `baseline=${base ?? "—"}`,
        `last=${last ?? "—"}`,
        `RTH(high=${rthHigh ?? "—"}, perfHigh=${rthPerf ?? "—"}, confirmed=${rthConf})`,
        `ETH(high=${ethHigh ?? "—"}, perfHigh=${ethPerf ?? "—"}, confirmed=${ethConf})`,
      ].join(" ");
    })
    .join("\n");

  return `
You are the MCM (Making Cash Money) Coach. This is an experimental market behavior tracker.
Goal: teach retail users how panic selloffs and rebounds tend to unfold; classify whether we are in (1) Panic Mean Reversion, (2) Stabilization/Range, (3) Economic Repricing risk-off.

Write 5–8 concise bullet points:
- 2 bullets on what the data shows now (leaders vs laggards, breadth, confirmations)
- 1 bullet on what would confirm continuation
- 1 bullet on what would invalidate / signal repricing risk
- 1 bullet on what to watch next 30–60 minutes

Use plain language. Do not give financial advice. Do not tell users to buy/sell.

As-of: ${meta.asof_local || meta.asof_market || "—"}  Session: ${meta.session || "—"}

Data:
${rows}
`.trim();
}

async function callOpenAI(apiKey, prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "You are a concise market behavior coach." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j) {
    return { ok: false, error: j?.error?.message || `OpenAI error (${r.status})` };
  }

  const text = j.choices?.[0]?.message?.content || "";
  const lines = text
    .split("\n")
    .map((s) => s.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);

  return { ok: true, lines };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const kv = getKV(env);
  if (!kv) return json({ ok: false, error: "Missing KV binding (expected env.MCM_KV)" }, 500);

  const symbols = parseSymbols(url) || null;
  if (!symbols) {
    return json({ ok: false, error: "Missing symbols param (e.g. ?symbols=MSFT,CRM,JPM,AXP,NKE,IBM)" }, 400);
  }

  const apiKey = pickApiKey(env);
  if (!apiKey) return json({ ok: false, error: "Missing OpenAI API key (env.OPENAI_API_KEY)" }, 500);

  const intervalMins = Number(url.searchParams.get("mins") || 30);
  const minMs = Math.max(5, Math.min(180, intervalMins)) * 60 * 1000;

  const lastRun = await kv.get("mcm:coach:last_run_ms");
  const lastRunMs = lastRun ? Number(lastRun) : 0;

  // If fresh enough, return cached latest (if present)
  const cached = await kv.get("mcm:coach:latest", "json");
  if (cached && lastRunMs && Date.now() - lastRunMs < minMs) {
    return json({ ok: true, fresh: true, coach: cached });
  }

  // Pull latest snapshot first (same origin)
  const origin = url.origin;
  const snapUrl = new URL("/api/snapshot", origin);
  snapUrl.searchParams.set("symbols", symbols.join(","));
  snapUrl.searchParams.set("_", String(Date.now()));

  const snap = await fetchJSON(snapUrl.toString());
  if (!snap.ok || !snap.json) {
    return json({ ok: false, error: `snapshot fetch failed (${snap.status})`, detail: snap.json }, 500);
  }

  const prompt = buildPromptFromSnapshot(snap.json, symbols);
  const ai = await callOpenAI(apiKey, prompt);
  if (!ai.ok) return json({ ok: false, error: ai.error }, 500);

  const coach = {
    asof_local: new Date().toLocaleString(),
    asof_market: snap.json?._meta?.asof_market || null,
    session: snap.json?._meta?.session || null,
    symbols,
    model: "gpt-4.1-mini",
    text: ai.lines.slice(0, 10),
  };

  // Store WITHOUT short TTL so it doesn't disappear overnight
  await kv.put("mcm:coach:latest", JSON.stringify(coach));
  await kv.put("mcm:coach:last_run_ms", String(Date.now()));

  return json({ ok: true, fresh: false, stored: true, coach });
}