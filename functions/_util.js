export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

export function getNowInTZ(tz = "America/New_York") {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

export function isRTH(nowET) {
  const minutes = nowET.hour * 60 + nowET.minute;
  return minutes >= (9*60 + 30) && minutes < (16*60);
}

export function cadenceSeconds(nowET) {
  return isRTH(nowET) ? 5 * 60 : 60 * 60;
}

export function roundDownToCadence(nowET, cadenceSec) {
  const totalSec = nowET.hour*3600 + nowET.minute*60 + nowET.second;
  const rounded = Math.floor(totalSec / cadenceSec) * cadenceSec;
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return { ...nowET, hour: h, minute: m, second: s };
}

export function formatLocal(tz, locale = "en-US") {
  const d = new Date();
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "2-digit"
  }).format(d);
}
