export async function getSnapshot(symbols) {
  const u = new URL("/api/snapshot", window.location.origin);
  u.searchParams.set("symbols", symbols.join(","));
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(`snapshot failed: ${r.status}`);
  return await r.json();
}

export async function getCoachLatest() {
  try {
    const r = await fetch(`/api/coach/latest`);
    if (!r.ok) return null;

    const j = await r.json();
    if (!j || !j.coach) return null;

    return {
      asof_local: j.coach.asof_local,
      asof_market: j.coach.asof_market,
      session: j.coach.session,
      text: Array.isArray(j.coach.text) ? j.coach.text : [String(j.coach.text || "")]
    };
  } catch {
    return null;
  }
}

