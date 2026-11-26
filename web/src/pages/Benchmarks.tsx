import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { longDate, money, pct, shortDate, signedMoney, tone } from "../lib/format";
import { Kpi, LegendItem, Section, Segmented, Skeleton, axisTick } from "../components/ui";

type Bench = { ticker: string; name: string; invested: number; value: number; gain: number; irr: number | null; twr: number; dd: number; lateStart: boolean; firstPrice: string };
type Row = { d: string; v: number; inv: number; twr: number; spy: number; qqq: number; spyVal: number; qqqVal: number };
type Payload = {
  end: string;
  stats: { actualValue: number; netInvested: number; gain: number; irr: number; twr: number; dd: number; nTrades: number; nBuys: number; years: number };
  spy: Bench; qqq: Bench; series: Row[];
  monthly: { m: string; buy: number; sell: number; n: number }[];
  why: { brokerSimpleReturn: number | null; avgAgeMonths: number; accountMonths: number; totalBought: number; lastYear: number; last6m: number; firstYear: number; firstYearLabel: string; quarters: { q: string; amount: number }[] };
};

const BENCH = [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]] as const;
const VIEWS = [["value", "Account value"], ["lead", "Who's ahead, over time"], ["flows", "Monthly investing"]] as const;
const RANGES = [["all", "All"], ["2025-01-01", "Since 2025"], ["ytd", "YTD"], ["1y", "1 year"], ["6m", "6 months"], ["3m", "3 months"]] as const;
const C = { you: "var(--chart)", bench: "var(--orange)", ref: "var(--bench)", inv: "var(--tx-3)" };
const pts = (x: number) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + " pts";

export default function Benchmarks() {
  const [params, setParams] = useSearchParams();
  const t = (params.get("vs") === "QQQ" ? "QQQ" : "SPY") as "SPY" | "QQQ";
  const { data, error } = useQuery({ queryKey: ["benchmarks"], queryFn: () => api<Payload>("/api/benchmarks"), staleTime: 5 * 60_000 });
  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-12 pb-12 pt-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">You vs the market</h1>
          <p className="mt-1 text-[13px] text-tx-2">Your trades replayed in an index fund: same dollars, same days.</p>
        </div>
        <Segmented value={t} options={BENCH} onChange={(v) => setParams(v === "SPY" ? {} : { vs: v })} />
      </header>
      {error && <div className="card p-5 text-sm text-neg">{(error as Error).message}</div>}
      {!data && !error && <Skeleton className="h-[640px]" />}
      {data && <BenchView data={data} t={t} />}
      {data && <Why data={data} />}
    </div>
  );
}

function BenchView({ data, t }: { data: Payload; t: "SPY" | "QQQ" }) {
  const S = data.stats, b = t === "SPY" ? data.spy : data.qqq, label = t === "SPY" ? "S&P 500" : "Nasdaq-100";
  const lead = S.actualValue - b.value;
  return (
    <>
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="Net invested (both)" value={money(b.invested)} sub={`${S.nBuys.toLocaleString()} buys`} />
        <Kpi label="Your portfolio" value={money(S.actualValue)} sub={`Gain ${signedMoney(S.gain)} (${pct(S.gain / S.netInvested)})`} tone={tone(S.gain)} />
        <Kpi label={`All in ${label}`} value={money(b.value)} sub={`Gain ${signedMoney(b.gain)} (${pct(b.gain / b.invested)})`} tone={tone(b.gain)} />
        <Kpi hero label={lead >= 0 ? `You outperformed the ${label} by` : `The ${label} outperformed you by`} value={money(Math.abs(lead))}
          sub={lead >= 0 ? `Your picks are worth ${money(lead)} more` : `The same dollars in ${t} would be worth ${money(-lead)} more`} tone={lead >= 0 ? "text-pos" : "text-neg"} />
        <Kpi label="Yearly return on your money (IRR)" value={<>{pct(S.irr)} <span className="text-base text-tx-2">vs {b.irr == null ? "n/a" : pct(b.irr)}</span></>}
          sub={b.irr == null ? "" : `${pts(S.irr - b.irr)} per year`} tone={b.irr != null && S.irr >= b.irr ? "text-pos" : "text-neg"} />
      </div>
      {b.lateStart && <div className="rounded-xl bg-orange/10 px-4 py-2.5 text-xs text-orange">{t} started trading on {b.firstPrice}; money invested before then waits as cash.</div>}
      <ValueSection data={data} t={t} label={label} />
      <TwrSection data={data} t={t} label={label} />
    </>
  );
}

function ValueSection({ data, t, label }: { data: Payload; t: "SPY" | "QQQ"; label: string }) {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("value");
  const key = t === "SPY" ? "spyVal" : "qqqVal";
  const rows = useMemo(() => data.series.map((r) => ({ d: r.d, you: r.v, bench: r[key], spy: r.spyVal, inv: r.inv, lead: r.v - r[key] })), [data, key]);
  const ticks = useMemo(() => Array.from({ length: 7 }, (_, i) => rows[Math.round((i * (rows.length - 1)) / 6)].d), [rows]);
  const leads = rows.map((r) => r.lead), max = Math.max(...leads, 0), min = Math.min(...leads, 0);
  const zero = max - min ? max / (max - min) : 0.5;
  return (
    <Section
      title={`Same dollars in the ${label}`}
      sub={`${data.stats.nTrades.toLocaleString()} trades replayed, ${longDate(data.series[0].d)} to ${longDate(data.end)}. Each day's net buys go into ${t} at that day's close.`}
      right={<Segmented size="sm" value={view} options={VIEWS} onChange={setView} />}>
      {view !== "flows" && (
        <div className="mb-2 flex gap-5 text-xs text-tx-2">
          {view === "value" ? (
            <>
              <LegendItem color={C.you} label="Your portfolio" />
              <LegendItem color={C.bench} label={`Same dollars in ${t}`} />
              {t !== "SPY" && <LegendItem color={C.ref} label="Same dollars in S&P 500" dash="dashed" />}
              <LegendItem color={C.inv} label="Net invested" dash="dotted" />
            </>
          ) : <span>Above $0: you're ahead. Below $0: {t} is ahead.</span>}
        </div>
      )}
      <div className="h-[340px]">
        <ResponsiveContainer>
          {view === "flows" ? (
            <ComposedChart data={data.monthly.map((m) => ({ ...m, sellNeg: -m.sell }))} stackOffset="sign">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70}
                allowDataOverflow domain={[Math.max(...data.monthly.map((m) => m.sell)) > 1000 ? "auto" : 0, "auto"]} />
              <Tooltip content={<FlowTip />} cursor={{ fill: "var(--raised)", opacity: 0.5 }} />
              <Bar dataKey="buy" stackId="f" fill="var(--chart)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="sellNeg" stackId="f" fill="var(--neg)" radius={[0, 0, 3, 3]} isAnimationActive={false} />
            </ComposedChart>
          ) : (
            <ComposedChart data={rows}>
              <defs>
                <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={zero} stopColor="var(--pos)" stopOpacity={0.3} />
                  <stop offset={zero} stopColor="var(--neg)" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="leadLine" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={zero} stopColor="var(--pos)" />
                  <stop offset={zero} stopColor="var(--neg)" />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="d" ticks={ticks} tickFormatter={shortDate} tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70} domain={view === "lead" ? ["auto", "auto"] : [0, "auto"]} />
              <Tooltip content={<ValueTip t={t} view={view} />} cursor={{ stroke: "var(--border-strong)" }} />
              {view === "value" ? (
                <>
                  <Line dataKey="inv" stroke={C.inv} strokeDasharray="2 4" dot={false} strokeWidth={1.2} isAnimationActive={false} />
                  {t !== "SPY" && <Line dataKey="spy" stroke={C.ref} strokeDasharray="5 4" dot={false} strokeWidth={1.3} isAnimationActive={false} />}
                  <Line dataKey="bench" stroke={C.bench} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                  <Line dataKey="you" stroke={C.you} dot={false} strokeWidth={2.2} isAnimationActive={false} />
                </>
              ) : (
                <>
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Area dataKey="lead" stroke="url(#leadLine)" strokeWidth={2} fill="url(#leadFill)" isAnimationActive={false} />
                </>
              )}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function ValueTip({ active, payload, t, view }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-2">{longDate(p.d)}</div>
      {view === "value" && <>
        <div className="num">You <b>{money(p.you)}</b></div>
        <div className="num text-tx-2">{t} {money(p.bench)} · invested {money(p.inv)}</div>
      </>}
      <div className={`num ${tone(p.lead)}`}>{p.lead >= 0 ? `You're ahead by ${money(p.lead)}` : `${t} ahead by ${money(-p.lead)}`}</div>
    </div>
  );
}

function FlowTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-2">{p.m}</div>
      <div className="num">Bought <b>{money(p.buy)}</b>{p.sell ? ` · sold ${money(p.sell)}` : ""}</div>
      <div className="text-tx-2">{p.n} orders</div>
    </div>
  );
}

function startIndex(series: Row[], end: string, r: string) {
  if (r === "all") return 0;
  let from = r;
  if (r === "ytd") from = `${end.slice(0, 4)}-01-01`;
  else if (/^\d+[my]$/.test(r)) {
    const e = new Date(end + "T12:00:00Z"), n = parseInt(r);
    if (r.endsWith("y")) e.setUTCFullYear(e.getUTCFullYear() - n); else e.setUTCMonth(e.getUTCMonth() - n);
    from = e.toISOString().slice(0, 10);
  }
  return Math.max(0, series.findIndex((x) => x.d >= from));
}

function TwrSection({ data, t, label }: { data: Payload; t: "SPY" | "QQQ"; label: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("all");
  const S = data.series, k = t === "SPY" ? "spy" : "qqq";
  const i = startIndex(S, data.end, range), base = S[i], e = S.length - 1;
  const rows = S.slice(i).map((r) => ({ d: r.d, you: r.twr / base.twr, bench: r[k] / base[k], spy: r.spy / base.spy }));
  const ticks = Array.from({ length: 6 }, (_, j) => rows[Math.round((j * (rows.length - 1)) / 5)].d);
  const yrs = (new Date(data.end).getTime() - new Date(base.d).getTime()) / 864e5 / 365.25;
  const ry = S[e].twr / base.twr - 1, rt = S[e][k] / base[k] - 1, rs = S[e].spy / base.spy - 1;
  const ann = (x: number) => (yrs >= 1 ? `${pct(Math.pow(1 + x, 1 / yrs) - 1)}/yr` : " ");
  return (
    <Section
      title={`Time-weighted: your picks vs the ${label}`}
      sub="This removes the effect of when you added money. Every line starts at 1.00 on the first day of the period."
      right={<Segmented size="sm" value={range} options={RANGES} onChange={setRange} />}>
      <div className="mb-2 flex gap-5 text-xs text-tx-2">
        <LegendItem color={C.you} label="You" /><LegendItem color={C.bench} label={t} />
        {t !== "SPY" && <LegendItem color={C.ref} label="S&P 500" dash="dashed" />}
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="d" ticks={ticks} tickFormatter={rows.length < 140 ? (d) => d.slice(5) : shortDate} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(2) + "×"} width={52} />
            <ReferenceLine y={1} stroke="var(--border-strong)" />
            <Tooltip content={<TwrTip t={t} />} cursor={{ stroke: "var(--border-strong)" }} />
            {t !== "SPY" && <Line dataKey="spy" stroke={C.ref} strokeDasharray="5 4" dot={false} strokeWidth={1.3} isAnimationActive={false} />}
            <Line dataKey="bench" stroke={C.bench} dot={false} strokeWidth={1.8} isAnimationActive={false} />
            <Line dataKey="you" stroke={C.you} dot={false} strokeWidth={2.2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`mt-4 grid gap-3 ${t !== "SPY" ? "grid-cols-4" : "grid-cols-3"}`}>
        <Kpi hero label={`You, since ${longDate(base.d)}`} value={pct(ry)} sub={ann(ry)} tone={tone(ry)} />
        <Kpi label={t} value={pct(rt)} sub={ann(rt)} tone={tone(rt)} />
        <Kpi label={`You vs ${t}`} value={pts(ry - rt)} sub={ry >= rt ? "Your picks did better" : `${t} did better`} tone={tone(ry - rt)} />
        {t !== "SPY" && <Kpi label="S&P 500 (reference)" value={pct(rs)} sub={ann(rs)} tone={tone(rs)} />}
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        <YearTable data={data} t={t} />
        <Drawdowns data={data} t={t} />
      </div>
    </Section>
  );
}

function TwrTip({ active, payload, t }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-2">{longDate(p.d)}</div>
      <div className="num">You <b>{p.you.toFixed(3)}×</b> · {t} {p.bench.toFixed(3)}×</div>
      {t !== "SPY" && <div className="num text-tx-2">S&amp;P 500 {p.spy.toFixed(3)}×</div>}
    </div>
  );
}

function YearTable({ data, t }: { data: Payload; t: "SPY" | "QQQ" }) {
  const S = data.series, k = t === "SPY" ? "spy" : "qqq";
  const years = [...new Set(S.map((r) => r.d.slice(0, 4)))];
  const rows = years.map((y, yi) => {
    const idx = S.flatMap((r, i) => (r.d.startsWith(y) ? [i] : []));
    const s = idx[0], e = idx[idx.length - 1], p = Math.max(0, s - 1);
    const you = S[e].twr / S[p].twr - 1, bench = S[e][k] / S[p][k] - 1, spy = S[e].spy / S[p].spy - 1;
    return { y, note: yi === 0 ? "partial" : yi === years.length - 1 ? "YTD" : "", you, bench, spy };
  });
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold">Calendar-year returns</h3>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
            <th className="pb-2 text-left font-medium">YEAR</th><th className="pb-2 text-right font-medium">YOU</th>
            <th className="pb-2 text-right font-medium">{t}</th><th className="pb-2 text-right font-medium">DIFFERENCE</th>
            {t !== "SPY" && <th className="pb-2 text-right font-medium">S&amp;P 500</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.y} className="border-b border-line last:border-0">
              <td className="py-2.5">{r.y} {r.note && <span className="text-xs text-tx-3">({r.note})</span>}</td>
              <td className={`num text-right font-medium ${tone(r.you)}`}>{pct(r.you)}</td>
              <td className={`num text-right ${tone(r.bench)}`}>{pct(r.bench)}</td>
              <td className={`num text-right ${tone(r.you - r.bench)}`}>{pts(r.you - r.bench)}</td>
              {t !== "SPY" && <td className="num text-right text-tx-2">{pct(r.spy)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drawdowns({ data, t }: { data: Payload; t: "SPY" | "QQQ" }) {
  const k = t === "SPY" ? "spy" : "qqq";
  const rows = useMemo(() => {
    let pkY = 0, pkB = 0;
    return data.series.map((r) => {
      pkY = Math.max(pkY, r.twr); pkB = Math.max(pkB, r[k]);
      return { d: r.d, you: r.twr / pkY - 1, bench: r[k] / pkB - 1 };
    });
  }, [data, k]);
  const worstY = Math.min(...rows.map((r) => r.you)), worstB = Math.min(...rows.map((r) => r.bench));
  const ticks = Array.from({ length: 5 }, (_, j) => rows[Math.round((j * (rows.length - 1)) / 4)].d);
  const floor = Math.floor(Math.min(worstY, worstB) * 20) / 20; // round down to a 5% step
  const yTicks = Array.from({ length: Math.round(-floor * 20) + 1 }, (_, j) => -j * 0.05);
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-tx-2"><LegendItem color={C.you} label="You" /><LegendItem color={C.bench} label={t} /></div>
      <h3 className="mb-2 text-[13px] font-semibold">
        Drawdown from previous high <span className="font-normal text-tx-2">· worst: you <span className="num text-neg">{pct(worstY)}</span>, {t} <span className="num text-neg">{pct(worstB)}</span></span>
      </h3>
      <div className="h-[210px]">
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <defs>
              <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-fill)" stopOpacity={0.05} />
                <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="d" ticks={ticks} tickFormatter={shortDate} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} domain={[floor, 0]} ticks={yTicks} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} />
            <Tooltip cursor={{ stroke: "var(--border-strong)" }} content={({ active, payload }: any) => active && payload?.length ? (
              <div className="card px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 text-tx-2">{longDate(payload[0].payload.d)}</div>
                <div className="num">You {pct(payload[0].payload.you)} · {t} {pct(payload[0].payload.bench)}</div>
              </div>) : null} />
            <Area dataKey="you" stroke={C.you} strokeWidth={1.5} fill="url(#ddFill)" isAnimationActive={false} />
            <Line dataKey="bench" stroke={C.bench} strokeWidth={1.3} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Why({ data }: { data: Payload }) {
  const w = data.why, S = data.stats;
  let cum = 0;
  const q = w.quarters.map((x) => ({ ...x, cum: ((cum += x.amount) / w.totalBought) * 100 }));
  const simple = w.brokerSimpleReturn;
  return (
    <Section
      title={simple == null ? "Why your broker's return differs" : `Why Webull shows ${pct(simple)} when your time-weighted return is ${pct(S.twr)}`}
      sub="Webull's figure is unrealized P&L ÷ cost basis. Every dollar counts the same whether you invested it in your first month or last week, and most of your money went in recently, so it hasn't had much time to grow.">
      <div className="grid grid-cols-3 gap-3">
        <div className="card bg-page/40 px-4 py-3.5">
          <div className="text-xs text-tx-2">Average time your dollars have been invested</div>
          <div className="num mt-1 text-[26px] font-medium">{w.avgAgeMonths.toFixed(0)} months</div>
          <p className="mt-1 text-xs text-tx-2">The account is {w.accountMonths.toFixed(0)} months old, but a typical dollar has been invested for less than half that time.</p>
        </div>
        <div className="card bg-page/40 px-4 py-3.5">
          <div className="text-xs text-tx-2">Invested in the last 12 months</div>
          <div className="num mt-1 text-[26px] font-medium">{money(w.lastYear)} <span className="text-base text-tx-2">({Math.round((w.lastYear / w.totalBought) * 100)}%)</span></div>
          <p className="mt-1 text-xs text-tx-2">{money(w.last6m)} of it in the last 6 months. Only {money(w.firstYear)} went in during {w.firstYearLabel}, the period with the biggest gains.</p>
        </div>
        <div className="card bg-page/40 px-4 py-3.5 text-[13px]">
          <div className="text-xs text-tx-2">So the measures say different things</div>
          <div className="mt-2 space-y-1">
            {simple != null && <div className="flex justify-between"><span>Simple return (Webull)</span><b className="num">{pct(simple)}</b></div>}
            <div className="flex justify-between"><span>Return on your money (IRR)</span><b className="num">{pct(S.irr)}/yr</b></div>
            <div className="flex justify-between"><span>Time-weighted, timing removed</span><b className="num">{pct(S.twr)}</b></div>
          </div>
          <p className="mt-2 text-xs text-tx-2">To judge your picks against an index, use time-weighted return or the dollar-for-dollar shadow.</p>
        </div>
      </div>
      <h3 className="mb-2 mt-6 text-[13px] font-semibold">When your money went in</h3>
      <div className="h-[230px]">
        <ResponsiveContainer>
          <ComposedChart data={q}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="q" tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} />
            <Tooltip cursor={{ fill: "var(--raised)", opacity: 0.5 }} content={({ active, payload }: any) => active && payload?.length ? (
              <div className="card px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 text-tx-2">{payload[0].payload.q}</div>
                <div className="num">Invested <b>{money(payload[0].payload.amount)}</b></div>
                <div className="num text-tx-2">{payload[0].payload.cum.toFixed(0)}% of all money by then</div>
              </div>) : null} />
            <Bar yAxisId="l" dataKey="amount" fill="var(--chart)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="r" dataKey="cum" stroke="var(--orange)" strokeWidth={2} dot={{ r: 3, fill: "var(--orange)" }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}
