/** Portfolio views: positions snapshot (from Webull) marked to live quotes, plus history from the analysis engine. */
import { join } from "node:path";
import { DATA, instruments, readJson } from "./config.js";
import { getQuotes, type Quote } from "./quotes.js";

type Snapshot = {
  as_of: string;
  cash: number;
  net_liquidation: number;
  market_value: number;
  unrealized_pnl: number;
  positions: Record<string, [qty: number, avgCost: number, last: number, mv: number, pnl: number]>;
};
type SeriesPoint = { d: string; v: number; inv: number; shadow: number; shadow_q: number };
type Analysis = { stats: Record<string, any>; series: SeriesPoint[] };

export const snapshot = () => readJson<Snapshot>(join(DATA, "positions_snapshot.json"));
export const analysis = () => readJson<Analysis>(join(DATA, "analysis.json"));

export type Position = {
  symbol: string; name: string; sector: string;
  qty: number; avgCost: number; price: number; prevClose: number;
  value: number; dayChange: number; dayPct: number; weight: number;
  gain: number; gainPct: number; live: boolean;
};

export async function positions(): Promise<{ positions: Position[]; cash: number; asOf: string; quotes: Record<string, Quote | null> }> {
  const snap = snapshot();
  if (!snap) throw Object.assign(new Error("No positions yet: run ./run.sh or press Refresh"), { status: 503 });
  const info = instruments();
  const syms = Object.keys(snap.positions);
  const quotes = await getQuotes(syms);
  const rows: Position[] = syms.map((s) => {
    const [qty, avgCost, last] = snap.positions[s];
    const q = quotes[s];
    const price = q?.price ?? last;
    const prevClose = q?.prevClose ?? last;
    const value = qty * price;
    const cost = qty * avgCost;
    return {
      symbol: s, name: info[s]?.name ?? q?.name ?? s, sector: info[s]?.sector ?? "Other / unclassified",
      qty, avgCost, price, prevClose, value,
      dayChange: qty * (price - prevClose), dayPct: prevClose ? price / prevClose - 1 : 0,
      weight: 0, gain: value - cost, gainPct: cost ? value / cost - 1 : 0, live: !!q,
    };
  });
  const total = rows.reduce((a, r) => a + r.value, 0) + snap.cash;
  rows.forEach((r) => (r.weight = total ? r.value / total : 0));
  rows.sort((a, b) => b.value - a.value);
  return { positions: rows, cash: snap.cash, asOf: snap.as_of, quotes };
}

export async function summary() {
  const { positions: rows, cash, asOf, quotes } = await positions();
  const mv = rows.reduce((a, r) => a + r.value, 0);
  const day = rows.reduce((a, r) => a + r.dayChange, 0);
  const cost = rows.reduce((a, r) => a + r.qty * r.avgCost, 0);
  const value = mv + cash;
  const live = Object.values(quotes).filter(Boolean) as Quote[];
  const a = analysis();
  const st = a?.stats ?? {};
  return {
    value, cash, marketValue: mv,
    dayChange: day, dayChangePct: value - day ? day / (value - day) : 0,
    unrealizedPnl: mv - cost,
    positionsAsOf: asOf,
    pricesAsOf: live.length ? Math.max(...live.map((q) => q.time)) : null,
    marketState: live.some((q) => q.marketState === "open") ? "open" : "closed",
    count: rows.length,
    benchmark: a ? {
      // from the last full analysis run (same dollars, same dates)
      asOf: st.end, you: st.actual_value, spy: st.shadow_value, qqq: st.shadow_q_value,
      lead: st.actual_value - st.shadow_value, irr: st.irr_you, irrSpy: st.irr_spy,
      twr: st.twr_you, twrSpy: st.twr_spy, dd: st.dd_you, ddSpy: st.dd_spy, netInvested: st.net_invested,
    } : null,
  };
}

const RANGE_DAYS: Record<string, number> = { "1W": 7, "1M": 31, "3M": 92, "1Y": 366 };
export function history(range: string) {
  const a = analysis();
  if (!a) return [];
  const s = a.series;
  const last = new Date(s.at(-1)!.d + "T12:00:00Z");
  let from = "";
  if (range === "YTD") from = `${last.getUTCFullYear()}-01-01`;
  else if (RANGE_DAYS[range]) from = new Date(last.getTime() - RANGE_DAYS[range] * 864e5).toISOString().slice(0, 10);
  return s.filter((p) => p.d >= from).map((p) => ({ d: p.d, value: p.v, invested: p.inv, spy: p.shadow, qqq: p.shadow_q }));
}

export function allocation(rows: Position[], cash: number) {
  const by = new Map<string, number>();
  rows.forEach((r) => by.set(r.sector, (by.get(r.sector) ?? 0) + r.value));
  const total = [...by.values()].reduce((a, b) => a + b, 0) + cash;
  return [...by.entries()].map(([sector, value]) => ({ sector, value, weight: value / total })).sort((a, b) => b.value - a.value);
}
