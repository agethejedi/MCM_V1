import { json, getNowInTZ, cadenceSeconds, roundDownToCadence, isRTH, formatLocal } from "../_util.js";

async function fetchTwelveDataQuote(symbol, apiKey) {
  const u = new URL("https://api.twelvedata.com/quote");
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("apikey", apiKey);
  const r = await fetch(u.toString());
  const j = await r.json();
  if (j.status === "error") throw new Error(j.message || "Twelve Data error");
  return j;
}

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

function mkReversal(baseline, sessionHigh, last, threshold) {
  const needHigh = baseline * (1 + threshold);
  const confirmed = (sessionHigh >= needHigh) && (last > baseline);
  return {
    threshold,
    needHigh,
    confirmed,
    detail: `Need High ≥ $${needHigh.toFixed(2)} and Last > $${baseline.toFixed(2)} (threshold ${(threshold*100).toFixed(2)}%).`
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  if (!symbols.length) return json({ error: "Missing symbols param" }, 400);
  if (!env.TWELVE_DATA_API_KEY) return json({ error: "Missing TWELVE_DATA_API_KEY" }, 500);
  if (!env.MCM_KV) return json({ error: "Missing KV binding MCM_KV" }, 500);

  const nowET = getNowInTZ("America/New_York");
  const cadence = cadenceSeconds(nowET);
  const bucket = roundDownToCadence(nowET, cadence);
  const bucketKey = `${bucket.year}-${String(bucket.month).padStart(2,"0")}-${String(bucket.day).padStart(2,"0")}:${String(bucket.hour).padStart(2,"0")}:${String(bucket.minute).padStart(2,"0")}`;

  const out = {};
  for (const sym of symbols) {
    const cacheKey = `snap:${sym}:${bucketKey}`;
    const cached = await env.MCM_KV.get(cacheKey, "json");
    let q = cached;

    if (!q) {
      try {
        q = await fetchTwelveDataQuote(sym, env.TWELVE_DATA_API_KEY);
        await env.MCM_KV.put(cacheKey, JSON.stringify(q), { expirationTtl: Math.max(cadence + 30, 330) });
      } catch (e) {
        out[sym] = { error: String(e) };
        continue;
      }
    }

    // baseline close (Day‑0)
    const baseKey = `baseline:${sym}`;
    let baseline = await env.MCM_KV.get(baseKey);
    if (baseline == null) {
      const close = await fetchLatestDailyClose(sym, env.TWELVE_DATA_API_KEY);
      if (Number.isFinite(close)) {
        baseline = String(close);
        await env.MCM_KV.put(baseKey, baseline);
      }
    }
    baseline = Number(baseline);

    const last = Number(q.price);

    // v0: use quote's high as a proxy for session high (upgrade later to candle-based RTH/ETH).
    const rthHigh = Number(q.high);
    const ethHigh = Number(q.high);
    const ethAvailable = true;

    const thresholds = { MSFT:0.005, CRM:0.010, JPM:0.008, IBM:0.007, NKE:0.010, AXP:0.012 };
    const thr = thresholds[sym] ?? 0.01;

    out[sym] = {
      symbol: sym,
      baseline,
      last,
      rth: {
        high: rthHigh,
        perfHigh: (rthHigh - baseline) / baseline,
        reversal: mkReversal(baseline, rthHigh, last, thr)
      },
      eth: {
        available: ethAvailable,
        high: ethHigh,
        perfHigh: (ethHigh - baseline) / baseline,
        reversal: mkReversal(baseline, ethHigh, last, thr)
      },
      asof_market: q.timestamp || null,
      asof_local: formatLocal("America/Chicago"),
    };
  }

  out._meta = {
    asof_market: `${nowET.year}-${String(nowET.month).padStart(2,"0")}-${String(nowET.day).padStart(2,"0")} ${String(nowET.hour).padStart(2,"0")}:${String(nowET.minute).padStart(2,"0")} ET`,
    asof_local: formatLocal("America/Chicago"),
    in_rth: isRTH(nowET),
    cadence_rth: "5m",
    cadence_eth: "1h",
    bucket: bucketKey,
    note: "Backend enforces credits‑aware cadence (RTH 5m, ETH 1h) via KV caching."
  };

  return json(out);
}
