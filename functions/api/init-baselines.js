import { json } from "../_util.js";

async function fetchLatestDailyClose(symbol, apiKey) {
  const u = new URL("https://api.twelvedata.com/time_series");
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("interval", "1day");
  u.searchParams.set("outputsize", "1");
  u.searchParams.set("apikey", apiKey);
  const r = await fetch(u.toString());
  const j = await r.json();
  if (j.status === "error") throw new Error(j.message || "Twelve Data error");
  const bar = j.values?.[0];
  return bar ? Number(bar.close) : NaN;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  if (!symbols.length) return json({ error: "Missing symbols param" }, 400);
  if (!env.TWELVE_DATA_API_KEY) return json({ error: "Missing TWELVE_DATA_API_KEY" }, 500);
  if (!env.MCM_KV) return json({ error: "Missing KV binding MCM_KV" }, 500);

  const results = {};
  for (const sym of symbols) {
    try {
      const close = await fetchLatestDailyClose(sym, env.TWELVE_DATA_API_KEY);
      if (!Number.isFinite(close)) throw new Error("No daily close");
      await env.MCM_KV.put(`baseline:${sym}`, String(close));
      results[sym] = { baseline: close, ok: true };
    } catch (e) {
      results[sym] = { ok: false, error: String(e) };
    }
  }
  return json({ ok: true, results });
}
