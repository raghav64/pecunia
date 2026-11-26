/** Read-only views over the analysis outputs for the Compare, Re-orient and Data pages. */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, readJson } from "./config.js";

type Shadow = {
  ticker: string; name: string; type: string; invested: number; value: number; gain: number; irr: number | null;
  twr: number; twr_ann: number | null; dd: number; late_start: boolean; stale: boolean; first_price: string;
  last_price: string; start: string; end: string; vals: number[]; idx: (number | null)[];
};

const shadowDir = () => join(DATA, "shadows");
export const loadShadow = (t: string) => readJson<Shadow>(join(shadowDir(), `${t.replace("^", "_")}.json`));

/** Every saved shadow, without the daily arrays (for chips and the leaderboard). */
export function shadowList() {
  if (!existsSync(shadowDir())) return [];
  return readdirSync(shadowDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Shadow>(join(shadowDir(), f)))
    .filter((s): s is Shadow => !!s)
    .map(({ vals, idx, ...rest }) => rest)
    .sort((a, b) => b.value - a.value);
}

/** Daily value + index arrays for a set of tickers (Re-orient calculators and mix builder). */
export function shadowSeries(tickers: string[]) {
  const out: Record<string, { vals: number[]; idx: (number | null)[] }> = {};
  for (const t of tickers) {
    const s = loadShadow(t);
    if (s) out[t] = { vals: s.vals.map((v) => Math.round(v * 100) / 100), idx: s.idx };
  }
  return out;
}

/** Trade log, reconciliation and method facts for the Data page. */
export function tradeData() {
  const a = readJson<any>(join(DATA, "analysis.json"));
  if (!a) throw Object.assign(new Error("Analysis not built yet: run ./run.sh or press Refresh"), { status: 404 });
  const snap = readJson<any>(join(DATA, "positions_snapshot.json"));
  const st = a.stats;
  return {
    end: st.end,
    trades: a.trades.map((t: any) => ({ date: t.date, symbol: t.symbol, side: t.side, qty: t.qty, price: t.price, amount: Math.abs(t.flow) })),
    reconciliation: a.reconciliation.filter((r: any) => r.webull || Math.abs(r.rebuilt) > 1e-6),
    perSymbol: a.per_symbol,
    legacySells: st.legacy_sells ?? [],
    reconGap: st.recon_value_gap,
    holdingsValue: st.holdings_value,
    brokerMarketValue: snap?.market_value ?? null,
    positionsAsOf: snap?.as_of ?? null,
    nTrades: st.n_trades, firstTrade: st.first_trade, dividends: st.dividends, missingPrices: st.missing_prices ?? [],
  };
}
