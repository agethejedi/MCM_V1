// functions/api/snapshot.js
// Cloudflare Pages Function (Exports onRequestGet)
// Requires env.TWELVEDATA_API_KEY (or env.TWELVE_DATA_API_KEY)
// Requires a KV binding (recommended name: MCM_KV)

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders,
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

function parseSymbols(url) {
  const raw = url.searchParams.get("symbols") || "";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNYParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;

  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const dow = get("weekday");

  return {
    ymd: `${y}-${mo}-${da}`,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    dow,
    hour,
    minute,
  };
}

function isRTH(ny) {
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(ny.dow);
  if (!weekday) return false;
  const mins = ny.hour * 60 + ny.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins <= close;
}

function cadenceSeconds(ny) {
  return isRTH(ny) ? 5 * 60 : 60 * 60;
}

function sessionLabel(ny) {
  return isRTH(ny) ? "RTH" : "ETH";
}

async function fetchTwelveJSON(url) {
  const r = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
}

async function fetchQuote(sym, apiKey) {
  const u = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(
    apiKey
  )}`;

  const { ok, json } = await fetchTwelveJSON(u);
  if (!ok || !json || json.status === "error") return { error: json?.message || "quote_error" };

  const last = toNum(json.price) ?? toNum(json.close) ?? toNum(json.last) ?? null;

  const prevClose = toNum(json.previous_close) ?? toNum(json.prev_close) ?? null;

  return {
    last,
    prevClose,
    asof_market: json.datetime || json.timestamp || null,
    raw: json,
  };
}

async function fetchTimeSeries(sym, apiKey, interval = "5min", outputsize = 300) {
  const u =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${encodeURIComponent(String(outputsize))}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const { ok, json } = await fetchTwelveJSON(u);
  if (!ok || !json || json.status === "error") return { error: json?.message || "timeseries_error" };

  const values = Array.isArray(json.values) ? json.values : [];
  return { values, meta: json.meta || null };
}

function computeHigh(values) {
  let hi = null;
  let lastClose = null;

  for (const v of values) {
    const h = toNum(v?.high);
    if (h !== null) hi = hi === null ? h : Math.max(hi, h);
  }
  if (values[0]) lastClose = toNum(values[0]?.close);

  return { high: hi, lastClose };
}

function computePerfHigh(high, baseline) {
  if (!Number.isFinite(high) || !Number.isFinite(baseline) || baseline === 0) return null;
  return (high - baseline) / baseline;
}

function computeReversal(high, last, baseline) {
  const needHigh = baseline;
  const needLast = baseline;

  const okHigh = Number.isFinite(high) && Number.isFinite(needHigh) ? high >= needHigh : false;
  const okLast = Number.isFinite(last) && Number.isFinite(needLast) ? last > needLast : false;

  const confirmed = okHigh && okLast;

  return {
    confirmed,
    detail: `Need High ≥ ${Number.isFinite(needHigh) ? needHigh.toFixed(2) : "—"} AND Last > ${
      Number.isFinite(needLast) ? needLast.toFixed(2) : "—"
    }`,
  };
}

function stableKey(parts, symbols) {
  const cadence = cadenceSeconds(parts);
  const now = Date.now();
  const bucket = Math.floor(now / (cadence * 1000));
  const symKey = symbols.join(",");
  return `mcm:snapshot:${parts.ymd}:${sessionLabel(parts)}:${bucket}:${symKey}`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const apiKey = env.TWELVEDATA_API_KEY || env.TWELVE_DATA_API_KEY;
  if (!apiKey) return json({ error: "Missing env.TWELVEDATA_API_KEY" }, 500);

  const symbols = parseSymbols(url);
  if (!symbols.length) return json({ error: "Provide ?symbols=MSFT,AXP,CRM,NKE,MMM,JPM" }, 400);

  const kv = getKV(env);
  if (!kv) return json({ error: "Missing KV binding (expected env.MCM_KV)" }, 500);

  const ny = fmtNYParts(new Date());
  const key = stableKey(ny, symbols);

  // Serve cached snapshot if exists
  const cached = await kv.get(key, "json");
  if (cached) return json(cached);

  const out = {
    _meta: {
      asof_local: new Date().toLocaleString(),
      asof_market: `${ny.ymd} ${ny.hhmm} NY`,
      session: sessionLabel(ny),
      cadence_rth: "5m",
      cadence_eth: "1h",
      note: "Signals update from cached snapshots (credits-aware).",
      source: "twelvedata",
    },
  };

  const tasks = symbols.map(async (sym) => {
    const quoteP = fetchQuote(sym, apiKey);
    const seriesP = fetchTimeSeries(sym, apiKey, "5min", 300);
    const [quote, series] = await Promise.all([quoteP, seriesP]);

    if (quote?.error && series?.error) {
      out[sym] = { symbol: sym, error: `${quote.error}; ${series.error}` };
      return;
    }

    // -------------------------
    // BASELINE: KV -> fallback to previous_close -> store in KV
    // -------------------------
    let baseline = null;

    // 1) Try KV first
    try {
      const b = await kv.get(`mcm:baseline:${sym}`, "json");
      baseline = toNum(b?.baseline ?? b);
    } catch {}

    // 2) Bootstrap from previous close if KV missing
    if (!Number.isFinite(baseline)) {
      const pc = quote?.prevClose;
      if (Number.isFinite(pc)) {
        baseline = pc;
        // store baseline for future (tomorrow, refreshes, etc.)
        await kv.put(`mcm:baseline:${sym}`, JSON.stringify(pc));
      }
    }

    const rth = computeHigh(series?.values || []);
    const eth = computeHigh(series?.values || []);

    const last = quote?.last ?? rth.lastClose ?? null;

    const rthPerfHigh = computePerfHigh(rth.high, baseline);
    const ethPerfHigh = computePerfHigh(eth.high, baseline);

    out[sym] = {
      symbol: sym,
      name: sym,
      baseline,
      last,
      asof_market: quote?.asof_market || out._meta.asof_market,
      asof_local: out._meta.asof_local,
      meta: {
        previous_close: quote?.prevClose ?? null,
      },
      rth: {
        high: rth.high,
        perfHigh: rthPerfHigh,
        reversal: computeReversal(rth.high, last, baseline),
      },
      eth: {
        available: true,
        high: eth.high,
        perfHigh: ethPerfHigh,
        reversal: computeReversal(eth.high, last, baseline),
      },
    };
  });

  await Promise.all(tasks);

  const ttl = cadenceSeconds(ny) + 15;
  await kv.put(key, JSON.stringify(out), { expirationTtl: ttl });

  return json(out);
}