// functions/api/coach/latest.js
// Reads latest coach output from KV.
// KV binding name expected: env.MCM_KV (but will fall back to any KV-like binding)

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
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

export async function onRequestGet({ env }) {
  const kv = getKV(env);
  if (!kv) return json({ error: "Missing KV binding (expected env.MCM_KV)" }, 500);

  const data = await kv.get("mcm:coach:latest", "json");
  // Return null if not generated yet (UI will just keep placeholder)
  return json(data || null);
}

