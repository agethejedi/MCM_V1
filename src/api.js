export async function getSnapshot(symbols) {
  const u = new URL("/api/snapshot", window.location.origin);
  u.searchParams.set("symbols", symbols.join(","));
  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(`snapshot failed: ${r.status}`);
  return await r.json();
}

export async function getCoachLatest() {
  const r = await fetch("/api/coach/latest", { cache: "no-store" });
  if (!r.ok) return null;
  return await r.json();
}
