const SYMBOLS = ["MSFT","AXP","CRM","NKE","MMM"];

let state = {
  data: null,
  lastUpdate: null
};

async function loadSnapshot() {
  try {
    const res = await fetch(`/api/snapshot?symbols=${SYMBOLS.join(",")}`);
    const json = await res.json();
    state.data = json;
    state.lastUpdate = new Date();
    render();
  } catch (err) {
    console.error("Snapshot fetch failed:", err);
  }
}

function tileColor(last, baseline) {
  if (last == null) return "#2a2a2a";
  return last >= baseline ? "#103c1c" : "#3c1010";
}

function confirmColor(flag) {
  return flag ? "#3cff73" : "#ff5a5a";
}

function render() {
  const container = document.getElementById("tiles");
  if (!container || !state.data) return;

  container.innerHTML = "";

  Object.values(state.data).forEach(stock => {

    if (!stock || !stock.symbol) return;

    const tile = document.createElement("div");
    tile.className = "tile";

    const last = stock.last;
    const baseline = stock.baseline;

    tile.style.background = tileColor(last, baseline);

    const reversal = stock?.rth?.reversal?.confirmed ?? false;
    const confirmText = reversal ? "CONFIRMED REVERSAL" : "NOT CONFIRMED";

    tile.innerHTML = `
      <div class="symbol">${stock.symbol}</div>
      <div class="price">$${last ?? "—"}</div>
      <div class="baseline">Baseline: $${baseline ?? "—"}</div>
      <div class="confirm" style="color:${confirmColor(reversal)}">
        ${confirmText}
      </div>
    `;

    container.appendChild(tile);
  });

  const stamp = document.getElementById("timestamp");
  if (stamp && state.lastUpdate)
    stamp.innerText = "Last update: " + state.lastUpdate.toLocaleTimeString();
}

function startPolling() {
  loadSnapshot(); // first load

  // IMPORTANT: 60 second polling
  setInterval(loadSnapshot, 60000);
}

document.addEventListener("DOMContentLoaded", startPolling);
