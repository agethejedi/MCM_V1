import { SYMBOLS, DAYS_TO_TRACK, UI_REFRESH_MS } from "./config.js";
import { getSnapshot, getCoachLatest } from "./api.js";

const $ = (sel) => document.querySelector(sel);

const BASELINE_KEY = "mcm_baselines_v1";
const START_KEY = "mcm_start_v1";
const CONF_KEY = "mcm_confirm_first_v1";
const FIRST_RENDER_KEY = "mcm_first_render_v1";

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}
function saveJSON(key, obj) { localStorage.setItem(key, JSON.stringify(obj)); }
function nowISO() { return new Date().toISOString(); }

function setStartIfMissing() {
  if (!localStorage.getItem(START_KEY)) localStorage.setItem(START_KEY, new Date().toISOString());
}
function daysSinceStart() {
  const s = localStorage.getItem(START_KEY);
  if (!s) return 0;
  const start = new Date(s);
  const now = new Date();
  const diff = (now - start) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.floor(diff));
}

function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtPct(p) {
  if (!Number.isFinite(p)) return "—";
  return (p * 100).toFixed(2) + "%";
}

function tileHtml(s) {
  return `
  <div class="tile" id="tile-${s.symbol}">
    <div class="tile-top">
      <div>
        <div class="sym">${s.symbol}</div>
        <div class="name">${s.name}</div>
        <div class="name">${s.category}</div>
      </div>
      <div class="pill" id="pill-${s.symbol}">—</div>
    </div>

    <div class="price" id="price-${s.symbol}">—</div>

    <div class="meta">
      <div>Baseline (Day‑0 close): <span id="base-${s.symbol}">—</span></div>
      <div>Last: <span id="last-${s.symbol}">—</span></div>
      <div>As‑of: <span id="asof-${s.symbol}">—</span></div>
    </div>

    <div class="session">
      <div class="session-title">
        <div>RTH</div>
        <div id="rthpill-${s.symbol}" class="pill">—</div>
      </div>
      <div class="session-body">
        <div>RTH High: <span id="rthhigh-${s.symbol}">—</span></div>
        <div>Perf vs baseline (High): <span id="rthperf-${s.symbol}">—</span></div>
        <div>Reversal: <span class="rev-status" id="rthrev-${s.symbol}">—</span></div>
        <div class="name" id="rthdetail-${s.symbol}"></div>
      </div>
    </div>

    <div class="session">
      <div class="session-title">
        <div>ETH</div>
        <div id="ethpill-${s.symbol}" class="pill">—</div>
      </div>
      <div class="session-body">
        <div>ETH High: <span id="ethhigh-${s.symbol}">—</span></div>
        <div>Perf vs baseline (High): <span id="ethperf-${s.symbol}">—</span></div>
        <div>Reversal: <span class="rev-status" id="ethrev-${s.symbol}">—</span></div>
        <div class="name" id="ethdetail-${s.symbol}"></div>
      </div>
    </div>
  </div>`;
}

function mount() {
  setStartIfMissing();
  $("#symbolsLabel").textContent = SYMBOLS.map(s => s.symbol).join(", ");
  $("#grid").innerHTML = SYMBOLS.map(tileHtml).join("");

  $("#reset").addEventListener("click", () => {
    localStorage.removeItem(BASELINE_KEY);
    localStorage.removeItem(START_KEY);
    localStorage.removeItem(CONF_KEY);
    localStorage.removeItem(FIRST_RENDER_KEY);
    location.reload();
  });

  $("#resetConfirms").addEventListener("click", () => {
    localStorage.removeItem(CONF_KEY);
    localStorage.removeItem(FIRST_RENDER_KEY);
    updateFirstConfirmsUI(true);
  });
}

function recordFirstConfirms(symbol, rthConfirmed, ethConfirmed) {
  const conf = loadJSON(CONF_KEY, {});
  const kR = `${symbol}:RTH`;
  const kE = `${symbol}:ETH`;
  if (rthConfirmed && !conf[kR]) conf[kR] = nowISO();
  if (ethConfirmed && !conf[kE]) conf[kE] = nowISO();
  saveJSON(CONF_KEY, conf);
}

function getFirstConfirms({ session = "RTH", limit = 3 } = {}) {
  const conf = loadJSON(CONF_KEY, {});
  return Object.entries(conf)
    .filter(([k]) => k.endsWith(`:${session}`))
    .map(([k, t]) => ({ symbol: k.split(":")[0], iso: t, time: new Date(t).getTime() }))
    .filter(x => Number.isFinite(x.time))
    .sort((a,b) => a.time - b.time)
    .slice(0, limit);
}

function updateFirstConfirmsUI(forceNoPulse = false) {
  const el = $("#regimeFirst");
  if (!el) return;

  const firstR = getFirstConfirms({ session: "RTH", limit: 3 });
  const firstE = getFirstConfirms({ session: "ETH", limit: 3 });

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const sig = (items) => items.map(x => `${x.symbol}@${x.iso}`);
  const prev = loadJSON(FIRST_RENDER_KEY, {});
  const prevR = prev.RTH || [];
  const prevE = prev.ETH || [];
  const curR = sig(firstR);
  const curE = sig(firstE);

  const newR = forceNoPulse ? new Set() : new Set(curR.filter(x => !prevR.includes(x)));
  const newE = forceNoPulse ? new Set() : new Set(curE.filter(x => !prevE.includes(x)));

  function renderList(label, items, tone, newSet) {
    if (!items.length) return `<span class="tag ${tone}">${label}: —</span>`;
    const tags = items.map(x => {
      const key = `${x.symbol}@${x.iso}`;
      const pulse = newSet.has(key) ? "pulse" : "";
      return `<span class="tag ${tone} ${pulse}">${x.symbol} @ ${fmtTime(x.iso)}</span>`;
    }).join("");
    return `<span class="tag ${tone}">${label}:</span> ${tags}`;
  }

  el.innerHTML = `
    ${renderList("RTH first", firstR, "good", newR)}
    ${renderList("ETH first", firstE, "neutral", newE)}
  `;

  saveJSON(FIRST_RENDER_KEY, { RTH: curR, ETH: curE });
}

function evaluateRegime(statesBySymbol) {
  const syms = Object.keys(statesBySymbol);
  if (!syms.length) return { label: "—", tone: "neutral", reason: "No symbols." };

  const total = syms.length;
  const confirmedRth = syms.filter(s => statesBySymbol[s].rthConfirmed).length;
  const confirmedEth = syms.filter(s => statesBySymbol[s].ethConfirmed).length;
  const posHigh = syms.filter(s => (statesBySymbol[s].rthPerfHigh ?? 0) > 0).length;

  const leaders = syms.filter(s => statesBySymbol[s].cohort === "liquidity_leader");
  const reflex  = syms.filter(s => statesBySymbol[s].cohort === "reflex_bounce");
  const macro   = syms.filter(s => statesBySymbol[s].cohort === "macro_sensitive");

  const leadersR = leaders.filter(s => statesBySymbol[s].rthConfirmed).length;
  const reflexR  = reflex.filter(s => statesBySymbol[s].rthConfirmed).length;
  const macroR   = macro.filter(s => statesBySymbol[s].rthConfirmed).length;

  const leaderStrong = leaders.length ? (leadersR / leaders.length) >= 0.5 : false;
  const reflexStrong = reflex.length ? (reflexR / reflex.length) >= 0.5 : false;
  const breadthGood  = (posHigh / total) >= 0.5;

  const macroFailing = macro.length ? (macroR / macro.length) < 0.34 : false;
  const confirmLow   = (confirmedRth / total) < 0.34;
  const breadthWeak  = (posHigh / total) < 0.34;

  if ((leaderStrong && reflexStrong && breadthGood) || ((confirmedRth / total) >= 0.5 && leaderStrong)) {
    return { label: "PANIC EVENT (MEAN REVERSION)", tone: "good",
      reason: `Leaders + reflex names are confirming; breadth improving (${posHigh}/${total} RTH positive by high).` };
  }
  if (confirmLow && breadthWeak && macroFailing) {
    return { label: "ECONOMIC REPRICING (RISK‑OFF TREND)", tone: "bad",
      reason: `Low confirmations (${confirmedRth}/${total}) + weak breadth (${posHigh}/${total}) + macro‑sensitive lag.` };
  }
  return { label: "STABILIZATION (CHOP / RANGE)", tone: "neutral",
    reason: `Mixed signals: RTH confirms ${confirmedRth}/${total}, ETH confirms ${confirmedEth}/${total}, breadth ${posHigh}/${total}.` };
}

function updateRegimeBanner(regime, metaText) {
  const el = $("#regime");
  el.classList.remove("good","bad","neutral");
  el.classList.add(regime.tone);
  $("#regimeTitle").textContent = `MARKET REGIME: ${regime.label}`;
  $("#regimeSub").textContent = regime.reason;
  $("#regimeMeta").textContent = metaText || "—";
}

async function refresh() {
  const day = Math.min(daysSinceStart(), DAYS_TO_TRACK);
  $("#daycount").textContent = `${day} / ${DAYS_TO_TRACK} days`;

  const symbols = SYMBOLS.map(s => s.symbol);
  const snap = await getSnapshot(symbols);

  // Persist baselines from backend (source of truth)
  const baselines = loadJSON(BASELINE_KEY, {});
  for (const sym of symbols) {
    if (Number.isFinite(snap[sym]?.baseline)) baselines[sym] = snap[sym].baseline;
  }
  saveJSON(BASELINE_KEY, baselines);

  $("#asof").textContent = snap._meta?.asof_local || snap._meta?.asof_market || "—";

  const states = {};
  for (const s of SYMBOLS) {
    const d = snap[s.symbol];
    if (!d || d.error) continue;

    const base = Number(d.baseline);
    const last = Number(d.last);

    const rthHigh = Number(d.rth?.high);
    const rthPerf = Number(d.rth?.perfHigh);
    const rthConfirmed = !!d.rth?.reversal?.confirmed;

    const ethAvailable = d.eth?.available !== false;
    const ethHigh = Number(d.eth?.high);
    const ethPerf = Number(d.eth?.perfHigh);
    const ethConfirmed = ethAvailable && !!d.eth?.reversal?.confirmed;

    const tile = $(`#tile-${s.symbol}`);
    tile.classList.toggle("pos", rthPerf > 0);
    tile.classList.toggle("neg", rthPerf < 0);

    const pill = $(`#pill-${s.symbol}`);
    pill.textContent = (rthConfirmed ? "REV ✅" : "REV ⛔");
    pill.classList.toggle("pill-good", rthConfirmed);
    pill.classList.toggle("pill-bad", !rthConfirmed);

    $(`#price-${s.symbol}`).textContent = `$${fmt(last)}`;
    $(`#base-${s.symbol}`).textContent = `$${fmt(base)}`;
    $(`#last-${s.symbol}`).textContent = `$${fmt(last)}`;
    $(`#asof-${s.symbol}`).textContent = d.asof_local || d.asof_market || "—";

    // RTH panel
    $(`#rthhigh-${s.symbol}`).textContent = `$${fmt(rthHigh)}`;
    $(`#rthperf-${s.symbol}`).textContent = fmtPct(rthPerf);
    const rthRev = $(`#rthrev-${s.symbol}`);
    rthRev.textContent = rthConfirmed ? "CONFIRMED" : "NOT SATISFIED";
    rthRev.classList.toggle("good", rthConfirmed);
    rthRev.classList.toggle("bad", !rthConfirmed);
    $(`#rthdetail-${s.symbol}`).textContent = d.rth?.reversal?.detail || "";
    $(`#rthpill-${s.symbol}`).textContent = `RTH ${snap._meta?.cadence_rth || "5m"}`;

    // ETH panel
    $(`#ethhigh-${s.symbol}`).textContent = ethAvailable ? `$${fmt(ethHigh)}` : "LOCKED";
    $(`#ethperf-${s.symbol}`).textContent = ethAvailable ? fmtPct(ethPerf) : "—";
    const ethRev = $(`#ethrev-${s.symbol}`);
    ethRev.textContent = ethAvailable ? (ethConfirmed ? "CONFIRMED" : "NOT SATISFIED") : "LOCKED";
    ethRev.classList.toggle("good", ethAvailable && ethConfirmed);
    ethRev.classList.toggle("bad", !ethAvailable || !ethConfirmed);
    $(`#ethdetail-${s.symbol}`).textContent = ethAvailable ? (d.eth?.reversal?.detail || "") : "Extended-hours data may require a higher-tier feed.";
    $(`#ethpill-${s.symbol}`).textContent = `ETH ${snap._meta?.cadence_eth || "1h"}`;

    recordFirstConfirms(s.symbol, rthConfirmed, ethConfirmed);

    states[s.symbol] = {
      cohort: s.cohort,
      rthConfirmed,
      ethConfirmed,
      rthPerfHigh: rthPerf
    };
  }

  const regime = evaluateRegime(states);
  updateRegimeBanner(regime, snap._meta?.note || "Signals update from cached snapshots (credits‑aware).");
  updateFirstConfirmsUI();

  // Coach (v0 placeholder)
  const coach = await getCoachLatest();
  if (coach) {
    $("#coachAsOf").textContent = `As‑of: ${coach.asof_local || coach.asof_market || "—"} • Session: ${coach.session || "—"}`;
    const ul = $("#coachBullets");
    ul.innerHTML = "";
    (coach.text || []).slice(0, 6).forEach(line => {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });
  }
}

(async function boot() {
  mount();
  await refresh();
  setInterval(() => refresh().catch(() => {}), UI_REFRESH_MS);
})();
