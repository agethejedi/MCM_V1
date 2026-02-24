import { json } from "../../_util.js";

export async function onRequestGet({ env, request }) {
  if (!env.MCM_KV) return json({ error: "Missing KV binding MCM_KV" }, 500);
  const url = new URL(request.url);
  const hours = Math.min(72, Math.max(1, Number(url.searchParams.get("hours") || 24)));
  return json({ ok: true, hours, items: [] });
}
