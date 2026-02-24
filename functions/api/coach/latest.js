import { json, getNowInTZ, isRTH, formatLocal } from "../../_util.js";

export async function onRequestGet({ env }) {
  if (!env.MCM_KV) return json({ error: "Missing KV binding MCM_KV" }, 500);

  // v0 coach: placeholder (no extra API credits).
  // Next iteration: store last snapshot in KV and compute true hourly summaries.
  const nowET = getNowInTZ("America/New_York");
  const session = isRTH(nowET) ? "RTH" : "ETH";

  return json({
    asof_market: `${nowET.year}-${String(nowET.month).padStart(2,"0")}-${String(nowET.day).padStart(2,"0")} ${String(nowET.hour).padStart(2,"0")}:${String(nowET.minute).padStart(2,"0")} ET`,
    asof_local: formatLocal("America/Chicago"),
    session,
    regime: "—",
    text: [
      "MCM Coach is on. This iteration prioritizes pricing cadence + the teaching layer.",
      "Next iteration: /api/snapshot will store the latest snapshot in KV so the Coach can summarize hourly without spending credits."
    ]
  });
}
