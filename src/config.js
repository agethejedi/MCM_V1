export const SYMBOLS = [
  { symbol: "MSFT", name: "Microsoft",        threshold: 0.005, category: "Mega-cap Liquidity Leader", cohort: "liquidity_leader" },
  { symbol: "CRM",  name: "Salesforce",       threshold: 0.010, category: "Enterprise Software / IT Budgets", cohort: "reflex_bounce" },
  { symbol: "JPM",  name: "JPMorgan",         threshold: 0.008, category: "Cyclical Financials", cohort: "macro_sensitive" },
  { symbol: "AXP",  name: "American Express", threshold: 0.012, category: "Payments / Affluent Spend", cohort: "macro_sensitive" },
  { symbol: "NKE",  name: "Nike",             threshold: 0.010, category: "Consumer Discretionary", cohort: "macro_sensitive" },
  { symbol: "IBM",  name: "IBM",              threshold: 0.007, category: "Value Tech / Rebalancing", cohort: "liquidity_leader" }
];

export const DAYS_TO_TRACK = 10;

// UI refresh from backend cache (safe)
export const UI_REFRESH_MS = 30_000;
