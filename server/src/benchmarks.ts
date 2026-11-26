/** Compact payload for the S&P 500 / Nasdaq page, built from analysis.json + shadows + positions snapshot. */
import { join } from "node:path";
import { DATA, readJson } from "./config.js";

type Row = { d: string; v: number; inv: number; twr: number; spy: number; qqq: number; shadow: number; shadow_q: number };
type Trade = { date: string; side: string; flow: number };
type Analysis = { stats: Record<string, any>; series: Row[]; monthly: { m: string; buy: number; sell: number; n: number }[]; trades: Trade[] };
type Shadow = { ticker: string; name: string; invested: number; value: number; gain: number; irr: number | null; twr: number; dd: number; start: string; end: string; late_start: boolean; first_price: string };

const pick = (s: Shadow | null) =>
  s && { ticker: s.ticker, name: s.name, invested: s.invested, value: s.value, gain: s.gain, irr: s.irr, twr: s.twr, dd: s.dd, lateStart: s.late_start, firstPrice: s.first_price };

export function benchmarks() {
  const a = readJson<Analysis>(join(DATA, "analysis.json"));
  if (!a) throw Object.assign(new Error("Analysis not built yet: run ./run.sh or press Refresh"), { status: 404 });
  const st = a.stats;
  const snap = readJson<any>(join(DATA, "positions_snapshot.json"));

  // "why the broker's % differs": how long dollars have actually been invested
  const buys = a.trades.filter((t) => t.side === "BUY");
  const end = new Date(st.end + "T12:00:00Z").getTime();
  const ageDays = (d: string) => (end - new Date(d + "T12:00:00Z").getTime()) / 864e5;
  const total = buys.reduce((s, t) => s + t.flow, 0);
  const sumWhere = (f: (t: Trade) => boolean) => buys.filter(f).reduce((s, t) => s + t.flow, 0);
  const quarters = new Map<string, number>();
  for (const t of buys) {
    const [y, m] = t.date.split("-").map(Number);
    const k = `${y} Q${Math.floor((m - 1) / 3) + 1}`;
    quarters.set(k, (quarters.get(k) ?? 0) + t.flow);
  }

  return {
    end: st.end,
    stats: {
      actualValue: st.actual_value, netInvested: st.net_invested, gain: st.gain_you, irr: st.irr_you, twr: st.twr_you,
      dd: st.dd_you, nTrades: st.n_trades, nBuys: st.n_buys, years: st.years,
    },
    spy: pick(readJson<Shadow>(join(DATA, "shadows", "SPY.json"))) ?? {
      ticker: "SPY", name: "S&P 500", invested: st.net_invested, value: st.shadow_value, gain: st.gain_spy, irr: st.irr_spy,
      twr: st.twr_spy, dd: st.dd_spy, lateStart: false, firstPrice: st.first_trade,
    },
    qqq: pick(readJson<Shadow>(join(DATA, "shadows", "QQQ.json"))) ?? {
      ticker: "QQQ", name: "Nasdaq-100", invested: st.net_invested, value: st.shadow_q_value, gain: st.gain_qqq, irr: st.irr_qqq,
      twr: st.twr_qqq, dd: st.dd_qqq, lateStart: false, firstPrice: st.first_trade,
    },
    // one row per trading day: your value, net invested, TWR index, benchmark indexes and shadow values
    series: a.series.map((r) => ({ d: r.d, v: r.v, inv: r.inv, twr: r.twr, spy: r.spy, qqq: r.qqq, spyVal: r.shadow, qqqVal: r.shadow_q })),
    monthly: a.monthly,
    why: {
      brokerSimpleReturn: snap ? snap.unrealized_pnl / (snap.market_value - snap.unrealized_pnl) : null,
      avgAgeMonths: total ? buys.reduce((s, t) => s + t.flow * ageDays(t.date), 0) / total / 30.4 : 0,
      accountMonths: st.years * 12,
      totalBought: total,
      lastYear: sumWhere((t) => ageDays(t.date) <= 365),
      last6m: sumWhere((t) => ageDays(t.date) <= 182),
      firstYear: sumWhere((t) => t.date < `${Number(st.first_trade.slice(0, 4)) + 1}-01-01`),
      firstYearLabel: st.first_trade.slice(0, 4),
      quarters: [...quarters.entries()].map(([q, amount]) => ({ q, amount })),
    },
  };
}
