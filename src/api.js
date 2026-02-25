// src/api.js

export async function getSnapshot(symbols) {
  const u = new URL("/api/snapshot", window.location.origin);
  u.searchParams.set("symbols", symbols.join(","));
  u.searchParams.set("_", String(Date.now())); // cache-bust
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(`snapshot failed: ${r.status}`);
  return await r.json();
}

export async function getCoachLatest() {
  try {
    const u = new URL("/api/coach/latest", window.location.origin);
    u.searchParams.set("_", String(Date.now())); // cache-bust

    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) return null;

    const j = await r.json();

    // Accept either:
    // 1) { ok:true, coach:{...} }
    // 2) { coach:{...} }
    // 3) direct coach object { asof_local, text, ... }
    // 4) null
    const coach = (j && typeof j === "object" && "coach" in j) ? j.coach : j;

    if (!coach || typeof coach !== "object") return null;

    return {
      asof_local: coach.asof_local || null,
      asof_market: coach.asof_market || null,
      session: coach.session || null,
      text: Array.isArray(coach.text) ? coach.text : [String(coach.text || "")]
    };
  } catch {
    return null;
  }
}