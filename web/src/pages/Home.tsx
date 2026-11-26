import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useHistory, useLiveStream, usePositions, useQuotes, useSettings, useSummary, type HistoryPoint, type Quote } from "../lib/api";
import { clock, longDate, money, pct, plainPct, shortDate, signedMoney, tone } from "../lib/format";

const RANGES = ["1W", "1M", "3M", "YTD", "1Y", "ALL"] as const;
const INDEXES = [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]] as const;

export default function Home() {
  const settings = useSettings();
  const watch = settings.data?.watchlist ?? [];
  const symbols = ["SPY", "QQQ", ...watch];
  useLiveStream(symbols);
  return (
    <div className="mx-auto max-w-[1320px] space-y-7 px-12 pb-12 pt-9">
      <Header />
      <ValueChart />
      <Watchlist symbols={symbols} />
      <div className="grid grid-cols-[1fr_372px] items-start gap-5">
        <PositionsTable />
        <div className="space-y-5">
          <Allocation />
          <BenchCard />
        </div>
      </div>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-raised ${className}`} />;
}

function Header() {
  const { data: s, error } = useSummary();
  if (error) return <div className="card p-5 text-sm text-neg">{(error as Error).message}</div>;
  if (!s) return <Skeleton className="h-28 w-[520px]" />;
  const [whole, cents] = money(s.value, 2).split(".");
  const allTime = s.benchmark ? s.value - s.benchmark.netInvested : s.unrealizedPnl;
  return (
    <header className="flex items-end justify-between">
      <div>
        <div className="text-[13px] text-tx-2">Total portfolio value</div>
        <div className="num mt-1 text-[46px] font-medium leading-none tracking-tight">
          {whole}<span className="text-[28px] text-tx-3">.{cents}</span>
        </div>
        <div className="mt-3 flex items-center gap-2.5 text-[13px]">
          <span className={`num text-sm ${tone(s.dayChange)}`}>{signedMoney(s.dayChange, 2)}</span>
          <span className={`num rounded-full px-2 py-0.5 text-xs font-medium ${s.dayChange >= 0 ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg"}`}>{pct(s.dayChangePct, 2)}</span>
          <span className="text-tx-2">today</span>
          <span className="text-tx-3">·</span>
          <span className={`num ${tone(allTime)}`}>{signedMoney(allTime)} <span className="text-tx-2">all-time</span></span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-tx-2">
        <span className={`size-2 rounded-full ${s.marketState === "open" ? "bg-pos animate-pulse" : "bg-tx-3"}`} />
        {s.marketState === "open" ? "Live" : "Market closed"}
        {s.pricesAsOf ? ` · prices ${clock(s.pricesAsOf)}` : ""} · positions {s.positionsAsOf}
      </div>
    </header>
  );
}

function ValueChart() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("ALL");
  const { data } = useHistory(range);
  const { data: s } = useSummary();
  const points = useMemo(() => {
    if (!data?.length) return [];
    const pts: HistoryPoint[] = [...data];
    const today = new Date().toISOString().slice(0, 10);
    const last = pts[pts.length - 1];
    if (s && today > last.d) pts.push({ ...last, d: today, value: s.value }); // live point
    return pts;
  }, [data, s]);
  const ticks = useMemo(() => {
    const n = 7;
    return points.length ? Array.from({ length: n }, (_, i) => points[Math.round((i * (points.length - 1)) / (n - 1))].d) : [];
  }, [points]);
  const first = points[0], last = points[points.length - 1];
  const change = first && last ? last.value - last.invested - (first.value - first.invested) : 0;
  return (
    <section>
      <div className="mb-2 flex items-center gap-5 text-xs text-tx-2">
        <Legend cls="bg-chart h-[3px]" label="Your portfolio" />
        <Legend cls="h-0.5 border-t-2 border-dashed border-bench" label="Same dollars in S&P 500" />
        <Legend cls="h-0.5 border-t-2 border-dotted border-tx-3" label="Net invested" />
        {range !== "ALL" && first && <span className={`num ml-auto ${tone(change)}`}>{signedMoney(change)} gain over {range}</span>}
      </div>
      <div className="h-[260px]">
        {points.length ? (
          <ResponsiveContainer>
            <ComposedChart data={points} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-fill)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d" ticks={ticks} tickFormatter={range === "1W" || range === "1M" ? (d) => d.slice(5) : shortDate}
                tick={{ fill: "var(--tx-3)", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--border-strong)" }} />
              <Line dataKey="invested" stroke="var(--tx-3)" strokeDasharray="2 4" dot={false} strokeWidth={1} isAnimationActive={false} />
              <Line dataKey="spy" stroke="var(--bench)" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Area dataKey="value" stroke="var(--chart)" strokeWidth={2.2} fill="url(#fillV)" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Skeleton className="h-full w-full" />}
      </div>
      <div className="mt-3 flex justify-center">
        <div className="flex gap-0.5 rounded-full bg-raised/70 p-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`num rounded-full px-3 py-1 text-[11px] font-medium ${r === range ? "bg-sel text-sel-tx" : "text-tx-2 hover:text-tx"}`}>{r}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

const Legend = ({ cls, label }: { cls: string; label: string }) => (
  <span className="flex items-center gap-1.5"><span className={`inline-block w-3.5 ${cls}`} />{label}</span>
);

function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as HistoryPoint;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-2">{longDate(p.d)}</div>
      <div className="num">You <b>{money(p.value)}</b></div>
      <div className="num text-tx-2">S&amp;P shadow {money(p.spy)} · invested {money(p.invested)}</div>
      <div className={`num ${tone(p.value - p.spy)}`}>{p.value >= p.spy ? `You're ahead by ${money(p.value - p.spy)}` : `S&P ahead by ${money(p.spy - p.value)}`}</div>
    </div>
  );
}

function Watchlist({ symbols }: { symbols: string[] }) {
  const { data } = useQuotes(symbols);
  const names: Record<string, string> = Object.fromEntries(INDEXES);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Markets &amp; watchlist</h2>
        <Link to="/analysis/compare" className="text-xs text-tx-2 hover:text-tx">Compare any ticker →</Link>
      </div>
      <div className="grid grid-cols-6 gap-3.5">
        {symbols.map((s) => <TickerCard key={s} symbol={s} q={data?.[s]} label={names[s]} />)}
      </div>
    </section>
  );
}

function TickerCard({ symbol, q, label }: { symbol: string; q?: Quote | null; label?: string }) {
  const up = (q?.changePct ?? 0) >= 0;
  const spark = q ? [q.prevClose, ...q.spark].map((v, i) => ({ i, v })) : [];
  return (
    <Link to={`/analysis/compare`} className="card block px-4 py-3.5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold">{symbol}</div>
          <div className="max-w-[120px] truncate text-xs text-tx-2">{label ?? q?.name ?? "—"}</div>
        </div>
        {label && <span className="num rounded-full bg-raised px-1.5 py-0.5 text-[9px] font-medium text-tx-2">INDEX</span>}
      </div>
      <div className="mt-3.5 flex items-end justify-between">
        <div>
          <div className="num text-[17px] font-medium">{q ? money(q.price, 2) : "—"}</div>
          <div className={`num text-xs ${up ? "text-pos" : "text-neg"}`}>{q ? pct(q.changePct, 2) : ""}</div>
        </div>
        <div className="h-8 w-[72px]">
          {spark.length > 1 && (
            <ResponsiveContainer>
              <LineChart data={spark}>
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Line dataKey="v" dot={false} strokeWidth={1.6} stroke={up ? "var(--pos)" : "var(--neg)"} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </Link>
  );
}

function PositionsTable() {
  const { data, error } = usePositions();
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  if (error) return <div className="card p-5 text-sm text-neg">{(error as Error).message}</div>;
  const rows = (data?.positions ?? []).filter((p) => !q || (p.symbol + " " + p.name).toLowerCase().includes(q.toLowerCase()));
  const shown = all || q ? rows : rows.slice(0, 8);
  return (
    <section className="card px-6 pb-2.5 pt-5">
      <div className="flex items-center justify-between pb-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">Positions</h2>
          <div className="text-xs text-tx-2">{data ? `${data.positions.length} holdings · ${money(data.cash)} cash` : "…"}</div>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search holdings…"
          className="w-48 rounded-full border border-line-strong bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-tx-3 focus:border-orange" />
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
            <th className="pb-2 text-left font-medium">SYMBOL</th>
            {["SHARES", "PRICE", "TODAY", "VALUE", "TOTAL RETURN"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {!data && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={6} className="py-2"><Skeleton className="h-9" /></td></tr>)}
          {shown.map((p) => (
            <tr key={p.symbol} className="border-b border-line last:border-0">
              <td className="py-2.5">
                <div className="flex items-center gap-3">
                  <span className="num grid size-8 place-items-center rounded-full bg-raised text-[11px] font-medium text-tx-2">{p.symbol.slice(0, 2)}</span>
                  <div><div className="font-semibold">{p.symbol}</div><div className="text-xs text-tx-2">{p.name}</div></div>
                </div>
              </td>
              <td className="num text-right text-tx-2">{p.qty.toFixed(3)}</td>
              <td className="num text-right">{money(p.price, 2)}</td>
              <td className={`num text-right ${tone(p.dayPct)}`}>{pct(p.dayPct)}</td>
              <td className="num text-right font-medium">{money(p.value)}</td>
              <td className="text-right">
                <div className={`num ${tone(p.gain)}`}>{signedMoney(p.gain)}</div>
                <div className="num text-[11px] text-tx-2">{pct(p.gainPct)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && !q && data.positions.length > 8 && (
        <button onClick={() => setAll((a) => !a)} className="w-full pt-2.5 text-center text-xs font-medium text-orange">
          {all ? "Show top 8" : `View all ${data.positions.length} positions →`}
        </button>
      )}
    </section>
  );
}

function Allocation() {
  const { data } = usePositions();
  const a = data?.allocation ?? [];
  const max = a[0]?.weight ?? 1;
  const top2 = a.slice(0, 2);
  const conc = top2.reduce((s, x) => s + x.weight, 0);
  return (
    <section className="card space-y-3.5 px-5 py-4.5">
      <h2 className="text-[15px] font-semibold">Sector allocation</h2>
      {!data && <Skeleton className="h-48" />}
      {a.slice(0, 7).map((x, i) => (
        <div key={x.sector}>
          <div className="mb-1 flex justify-between text-xs"><span className="text-tx-2">{x.sector}</span><span className="num">{plainPct(x.weight)}</span></div>
          <div className="h-1.5 rounded-full bg-raised"><div className={`h-full rounded-full bg-orange ${i ? "opacity-70" : ""}`} style={{ width: `${(x.weight / max) * 100}%` }} /></div>
        </div>
      ))}
      {conc > 0.6 && (
        <div className="rounded-xl bg-orange/12 px-3 py-2 text-[11px] font-medium text-orange">
          {plainPct(conc, 0)} in {top2.map((x) => x.sector.toLowerCase()).join(" & ")}: see <Link to="/analysis/sectors" className="underline">Re-orient</Link>
        </div>
      )}
    </section>
  );
}

function BenchCard() {
  const { data: s } = useSummary();
  const b = s?.benchmark;
  if (!b) return <section className="card px-5 py-4.5"><Skeleton className="h-32" /></section>;
  const ahead = b.lead >= 0;
  return (
    <section className="card space-y-2.5 px-5 py-4.5">
      <div className="text-[13px] text-tx-2">{ahead ? "You outperformed the S&P 500 by" : "The S&P 500 outperformed you by"}</div>
      <div className={`num text-3xl font-medium ${ahead ? "text-pos" : "text-neg"}`}>{money(Math.abs(b.lead))}</div>
      <div className="text-xs text-tx-3">Same dollars, same dates · as of {b.asOf}</div>
      <div className="flex gap-6 pt-1.5">
        <div><div className="text-[11px] text-tx-3">Your yearly return</div><div className="num text-base font-medium">{plainPct(b.irr)}</div></div>
        <div><div className="text-[11px] text-tx-3">S&amp;P 500</div><div className="num text-base font-medium text-tx-2">{plainPct(b.irrSpy)}</div></div>
      </div>
      <Link to="/analysis/benchmarks" className="block text-xs font-medium text-orange">Open comparison →</Link>
    </section>
  );
}
