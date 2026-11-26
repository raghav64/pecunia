import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, useBase, usePositions } from "../lib/api";
import { money, pct, signedMoney, tone } from "../lib/format";
import { Section, Skeleton } from "../components/ui";
import ShadowView from "../components/ShadowView";

type ShadowSummary = { ticker: string; name: string; value: number; gain: number; irr: number | null; twr: number; dd: number; late_start: boolean; end: string; invested: number };
type Shadow = ShadowSummary & { stale: boolean; first_price: string; last_price: string; vals: number[]; idx: (number | null)[] };

const BLUE = ["COST", "AMZN", "GOOGL", "WMT", "MSFT"];
const TICKER_RE = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/;
export const shortName = (t: string, name?: string) =>
  ({ SPY: "S&P 500", QQQ: "Nasdaq-100" } as Record<string, string>)[t] ??
  (name ?? t).replace(/,? (Inc\.?|Corporation|Corp\.?|(and )?Company|Co\.|Holdings,? Inc\.?|Wholesale Corporation|Incorporated)$/i, "").replace(/^(State Street|Invesco|Vanguard|SPDR|iShares) /, "").trim();

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const t = (params.get("t") ?? "COST").toUpperCase();
  const [input, setInput] = useState("");
  const [inputErr, setInputErr] = useState<string | null>(null);
  const base = useBase();
  const positions = usePositions();
  const list = useQuery({ queryKey: ["shadows"], queryFn: () => api<ShadowSummary[]>("/api/shadows") });
  const shadow = useQuery({
    queryKey: ["shadow", t],
    queryFn: () => api<Shadow>(`/api/shadow/${encodeURIComponent(t)}`),
    enabled: TICKER_RE.test(t),
    staleTime: 10 * 60_000,
    retry: false,
  });
  // a freshly computed ticker joins the leaderboard
  useEffect(() => { if (shadow.data) list.refetch(); }, [shadow.data?.ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const held = new Set(positions.data?.positions.map((p) => p.symbol) ?? []);
  const byT = useMemo(() => Object.fromEntries((list.data ?? []).map((s) => [s.ticker, s])), [list.data]);
  const chips = [...new Set([...BLUE, ...[...held].filter((s) => byT[s]), ...(byT[t] ? [t] : [])])].filter((s) => s !== "SPY" && s !== "QQQ");
  const you = base.data?.stats.actualValue ?? 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = input.trim().toUpperCase();
    if (!TICKER_RE.test(v)) { setInputErr(`"${input}" doesn't look like a ticker`); return; }
    setInputErr(null); setInput(""); setParams({ t: v });
  }

  const bench = shadow.data && {
    ticker: shadow.data.ticker, label: shortName(shadow.data.ticker, shadow.data.name), name: shadow.data.name,
    invested: shadow.data.invested, value: shadow.data.value, gain: shadow.data.gain, irr: shadow.data.irr,
    lateStart: shadow.data.late_start, firstPrice: shadow.data.first_price, stale: shadow.data.stale, lastPrice: shadow.data.last_price,
    vals: shadow.data.vals, idx: shadow.data.idx,
  };
  const aligned = shadow.data && base.data && shadow.data.vals.length === base.data.series.length;

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-12 pb-12 pt-9">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Compare against any ticker</h1>
        <p className="mt-1 text-[13px] text-tx-2">Every dollar you invested goes into this ticker instead, on the same day. Dividends are reinvested.</p>
      </header>

      <section className="card flex flex-wrap items-end justify-between gap-5 px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs text-tx-2">Blue chips & your holdings</div>
          <div className="flex flex-wrap gap-2">
            {chips.map((s) => {
              const d = byT[s], lead = d ? you - d.value : 0;
              return (
                <button key={s} onClick={() => setParams({ t: s })}
                  className={`rounded-xl border px-3.5 py-2 text-left transition-colors ${s === t ? "border-orange bg-orange/10" : "border-line hover:border-line-strong"}`}>
                  <div className={`text-[13px] font-semibold ${s === t ? "text-orange" : ""}`}>{s}</div>
                  <div className={`num text-[11px] ${d ? (lead >= 0 ? "text-pos" : "text-neg") : "text-tx-3"}`}>
                    {!d ? "not run yet" : lead >= 0 ? `You +${money(lead)}` : `${s} +${money(-lead)}`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <form onSubmit={submit} className="flex items-start gap-2">
          <div>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Any ticker: NVDA, BRK.B, VTI…"
              className="num w-60 rounded-full border border-line-strong bg-transparent px-4 py-2 text-[13px] uppercase outline-none placeholder:normal-case placeholder:text-tx-3 focus:border-orange" />
            {inputErr && <div className="mt-1 px-2 text-xs text-neg">{inputErr}</div>}
          </div>
          <button className="rounded-full bg-sel px-4 py-2 text-[13px] font-medium text-sel-tx">Run analysis</button>
        </form>
      </section>

      {shadow.isFetching && !shadow.data && (
        <div className="card flex items-center gap-3 px-6 py-5 text-sm text-tx-2">
          <span className="size-4 animate-spin rounded-full border-2 border-orange border-r-transparent" />
          Running the shadow analysis for <b className="text-tx">{t}</b>: fetching prices and replaying {base.data?.stats.nTrades.toLocaleString() ?? "your"} trades…
        </div>
      )}
      {shadow.error && <div className="card px-6 py-5 text-sm text-neg">Couldn't analyze {t}: {(shadow.error as Error).message}. Check the symbol (Yahoo format, e.g. BRK.B, ^GSPC).</div>}
      {!base.data && <Skeleton className="h-[500px]" />}
      {base.data && bench && aligned && <ShadowView base={base.data} b={bench} />}
      {base.data && shadow.data && !aligned && <div className="card px-6 py-5 text-sm text-tx-2">This result is from an older data build. Press Refresh to rebuild.</div>}

      <Section title="Leaderboard: same dollars, every ticker you've run" sub="Click a row to open it. Value is what your exact deposits would be worth today.">
        <Leaderboard rows={list.data} you={base.data?.stats} current={t} onPick={(s) => { setParams({ t: s }); scrollTo({ top: 0, behavior: "smooth" }); }} />
      </Section>
    </div>
  );
}

function Leaderboard({ rows, you, current, onPick }: {
  rows?: ShadowSummary[]; you?: { actualValue: number; gain: number; irr: number; twr: number; dd: number }; current: string; onPick: (t: string) => void;
}) {
  const [q, setQ] = useState("");
  if (!rows || !you) return <Skeleton className="h-64" />;
  const all = [{ ticker: "YOU", name: "Your portfolio", value: you.actualValue, gain: you.gain, irr: you.irr, twr: you.twr, dd: you.dd, late_start: false } as any, ...rows]
    .filter((r) => !q || r.ticker === "YOU" || (r.ticker + " " + r.name).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.value - a.value);
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…"
        className="mb-3 w-48 rounded-full border border-line-strong bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-tx-3 focus:border-orange" />
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              {["#", "TICKER", "NAME"].map((h) => <th key={h} className="pb-2 text-left font-medium">{h}</th>)}
              {["VALUE", "GAIN", "IRR", "TIME-WEIGHTED", "WORST DROP", "WHO'S AHEAD"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {all.map((r, i) => {
              const me = r.ticker === "YOU", lead = you.actualValue - r.value;
              return (
                <tr key={r.ticker} onClick={() => !me && onPick(r.ticker)}
                  className={`border-b border-line last:border-0 ${me ? "bg-orange/[0.07] font-medium" : "cursor-pointer hover:bg-raised/50"} ${r.ticker === current ? "bg-raised/60" : ""}`}>
                  <td className="py-2 text-tx-3">{i + 1}</td>
                  <td className="py-2 font-semibold">{me ? "★ You" : r.ticker}{r.late_start && <span title="Listed after your first deposit" className="text-tx-3">*</span>}</td>
                  <td className="max-w-[260px] truncate py-2 text-tx-2">{shortName(r.ticker, r.name)}</td>
                  <td className="num text-right">{money(r.value)}</td>
                  <td className={`num text-right ${tone(r.gain)}`}>{signedMoney(r.gain)}</td>
                  <td className="num text-right">{r.irr == null ? "—" : pct(r.irr)}</td>
                  <td className="num text-right">{pct(r.twr)}</td>
                  <td className="num text-right text-neg">{pct(r.dd)}</td>
                  <td className={`num text-right ${me ? "" : lead >= 0 ? "text-pos" : "text-neg"}`}>{me ? "" : lead >= 0 ? `You, by ${money(lead)}` : `${r.ticker}, by ${money(-lead)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
