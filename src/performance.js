// src/performance.js
import { SYMBOLS } from "./config.js";
import { getSnapshot } from "./api.js";

const $ = (sel) => document.querySelector(sel);

function fmt(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtPct(p) {
  if (!Number.isFinite(p)) return "—";
  return (p * 100).toFixed(2) + "%";
}
function sign(n) {
  if (!Number.isFinite(n)) return "";
  return n > 0 ? "+" : "";
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function classifyRow({ todayPct, cumPct }) {
  // used for row styling
  return {
    todayTone: todayPct > 0 ? "pos" : todayPct < 0 ? "neg" : "flat",
    cumTone: cumPct > 0 ? "pos" : cumPct < 0 ? "neg" : "flat",
  };
}

function rowHTML(r) {
  const tones = classifyRow(r);
  const rthOk = r.rthConfirmed ? "✅" : "⛔";

  return `
    <tr class="row-${tones.cumTone}">
      <td><b>${r.symbol}</b></td>
      <td>${r.cohortLabel}</td>
      <td>$${fmt(r.baseline)}</td>
      <td>${r.prevClose == null ? "—" : `$${fmt(r.prevClose)}`}</td>
      <td>$${fmt(r.last)}</td>
      <td class="cell-${tones.todayTone}">${r.todayUsd == null ? "—" : `${sign(r.todayUsd)}$${fmt(r.todayUsd)}`}</td>
      <td class="cell-${tones.todayTone}">${fmtPct(r.todayPct)}</td>
      <td class="cell-${tones.cumTone}">${`${sign(r.cumUsd)}$${fmt(r.cumUsd)}`}</td>
      <td class="cell-${tones.cumTone}">${fmtPct(r.cumPct)}</td>
      <td>${rthOk}</td>
    </tr>
  `;
}

function cardHTML(r) {
  const tones = classifyRow(r);
  return `
    <div class="card card-${tones.cumTone}">
      <div class="card-top">
        <div>
          <div class="card-sym">${r.symbol}</div>
          <div class="card-sub">${r.cohortLabel}</div>
        </div>
        <div class="card-pill">${r.rthConfirmed ? "REV ✅" : "REV ⛔"}</div>
      </div>

      <div class="card-price">$${fmt(r.last)}</div>

      <div class="card-grid">
        <div>
          <div class="mini-label">Baseline</div>
          <div class="mini-val">$${fmt(r.baseline)}</div>
        </div>
        <div>
          <div class="mini-label">Prev Close</div>
          <div class="mini-val">${r.prevClose == null ? "—" : `$${fmt(r.prevClose)}`}</div>
        </div>
        <div>
          <div class="mini-label">Today</div>
          <div class="mini-val mini-${tones.todayTone}">
            ${r.todayUsd == null ? "—" : `${sign(r.todayUsd)}$${fmt(r.todayUsd)}`} (${fmtPct(r.todayPct)})
          </div>
        </div>
        <div>
          <div class="mini-label">Cumulative</div>
          <div class="mini-val mini-${tones.cumTone}">
            ${`${sign(r.cumUsd)}$${fmt(r.cumUsd)}`} (${fmtPct(r.cumPct)})
          </div>
        </div>
      </div>
    </div>
  `;
}

function cohortLabel(cohort) {
  if (cohort === "liquidity_leader") return "Liquidity Leader";
  if (cohort === "reflex_bounce") return "Reflex Bounce";
  if (cohort === "macro_sensitive") return "Macro Sensitive";
  return cohort || "—";
}

async function refresh() {
  const symbols = SYMBOLS.map((s) => s.symbol);
  const snap = await getSnapshot(symbols);

  $("#asof").textContent = `As-of: ${snap._meta?.asof_local || snap._meta?.asof_market || "—"} • Session: ${
    snap._meta?.session || "—"
  }`;

  const rows = [];
  let posToday = 0;
  let posCum = 0;

  let basketTodaySum = 0;
  let basketTodayN = 0;

  let basketCumSum = 0;
  let basketCumN = 0;

  for (const s of SYMBOLS) {
    const d = snap[s.symbol];
    if (!d || d.error) continue;

    const baseline = safeNum(d.baseline);
    const last = safeNum(d.last);
    const prevClose = safeNum(d?.meta?.previous_close);

    // Daily performance vs prev close (if available)
    const todayUsd = prevClose != null && last != null ? last - prevClose : null;
    const todayPct = prevClose != null && last != null && prevClose !== 0 ? todayUsd / prevClose : null;

    // Cumulative vs baseline (Day-0 close)
    const cumUsd = baseline != null && last != null ? last - baseline : null;
    const cumPct = baseline != null && last != null && baseline !== 0 ? cumUsd / baseline : null;

    const rthConfirmed = !!d?.rth?.reversal?.confirmed;

    if (todayPct != null) {
      basketTodaySum += todayPct;
      basketTodayN += 1;
      if (todayPct > 0) posToday += 1;
    }

    if (cumPct != null) {
      basketCumSum += cumPct;
      basketCumN += 1;
      if (cumPct > 0) posCum += 1;
    }

    rows.push({
      symbol: s.symbol,
      cohortLabel: cohortLabel(s.cohort),
      baseline: baseline ?? NaN,
      prevClose,
      last: last ?? NaN,
      todayUsd,
      todayPct,
      cumUsd: cumUsd ?? 0,
      cumPct,
      rthConfirmed,
    });
  }

  // KPI renders
  const basketCum = basketCumN ? basketCumSum / basketCumN : null;
  const basketDay = basketTodayN ? basketTodaySum / basketTodayN : null;

  $("#basketCum").textContent = basketCum == null ? "—" : fmtPct(basketCum);
  $("#basketDay").textContent = basketDay == null ? "—" : fmtPct(basketDay);

  $("#breadth").textContent = `${posToday}/${basketTodayN || 6} today • ${posCum}/${basketCumN || 6} cumulative`;
  $("#breadthSub").textContent = "Positive today / positive cumulative";

  // Table
  $("#perfTbody").innerHTML = rows.map(rowHTML).join("");

  // Cards
  $("#perfCards").innerHTML = rows.map(cardHTML).join("");
}

$("#refreshBtn")?.addEventListener("click", () => refresh().catch(() => {}));

refresh().catch((e) => {
  $("#asof").textContent = `As-of: error (${String(e?.message || e)})`;
});
