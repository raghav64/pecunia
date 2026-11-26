/**
 * "Same dollars in X" comparison, shared by the S&P 500 / Nasdaq page and Compare any ticker.
 * `bench.vals` / `bench.idx` are aligned 1:1 with `base.series` (one entry per portfolio day).
 */
import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { longDate, money, pct, shortDate, signedMoney, tone } from "../lib/format";
import { Kpi, LegendItem, Section, Segmented, axisTick } from "./ui";

export type BaseRow = { d: string; v: number; inv: number; twr: number; spy: number; spyVal: number };
export type Base = {
  end: string;
  stats: { actualValue: number; netInvested: number; gain: number; irr: number; twr: number; dd: number; nTrades: number; nBuys: number };
  series: BaseRow[];
  monthly: { m: string; buy: number; sell: number; n: number }[];
};
export type BenchSeries = {
  ticker: string; label: string; name?: string; invested: number; value: number; gain: number; irr: number | null;
  lateStart?: boolean; firstPrice?: string; stale?: boolean; lastPrice?: string;
  vals: number[]; idx: (number | null)[];
};

const VIEWS = [["value", "Account value"], ["lead", "Who's ahead, over time"], ["flows", "Monthly investing"]] as const;
const RANGES = [["all", "All"], ["2025-01-01", "Since 2025"], ["ytd", "YTD"], ["1y", "1 year"], ["6m", "6 months"], ["3m", "3 months"]] as const;
export const C = { you: "var(--chart)", bench: "var(--orange)", ref: "var(--bench)", inv: "var(--tx-3)" };
export const pts = (x: number) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(1) + " pts";
const evenTicks = (rows: { d: string }[], n: number) => (rows.length ? Array.from({ length: n }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (n - 1))].d) : []);

export default function ShadowView({ base, b }: { base: Base; b: BenchSeries }) {
  const S = base.stats;
  const lead = S.actualValue - b.value;
  const showRef = b.ticker !== "SPY";
  return (
    <>
      {b.lateStart && <div className="rounded-xl bg-orange/10 px-4 py-2.5 text-xs text-orange">{b.ticker} started trading on {b.firstPrice}. Money you invested before then waits as cash in the shadow until that date.</div>}
      {b.stale && <div className="rounded-xl bg-orange/10 px-4 py-2.5 text-xs text-orange">No {b.ticker} prices after {b.lastPrice}; the last price is carried forward.</div>}
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="Net invested (both)" value={money(b.invested)} sub={`${S.nBuys.toLocaleString()} buys`} />
        <Kpi label="Your portfolio" value={money(S.actualValue)} sub={`Gain ${signedMoney(S.gain)} (${pct(S.gain / S.netInvested)})`} tone={tone(S.gain)} />
        <Kpi label={`All in ${b.label}`} value={money(b.value)} sub={`Gain ${signedMoney(b.gain)} (${pct(b.gain / b.invested)})`} tone={tone(b.gain)} />
        <Kpi hero label={lead >= 0 ? `You outperformed ${b.label} by` : `${b.label} outperformed you by`} value={money(Math.abs(lead))}
          sub={lead >= 0 ? `Your picks are worth ${money(lead)} more` : `The same dollars in ${b.ticker} would be worth ${money(-lead)} more`}
          tone={lead >= 0 ? "text-pos" : "text-neg"} />
        <Kpi label="Yearly return on your money (IRR)" value={<>{pct(S.irr)} <span className="text-base text-tx-2">vs {b.irr == null ? "n/a" : pct(b.irr)}</span></>}
          sub={b.irr == null ? "" : `${pts(S.irr - b.irr)} per year`} tone={b.irr != null && S.irr >= b.irr ? "text-pos" : "text-neg"} />
      </div>
      <ValueSection base={base} b={b} showRef={showRef} />
      <TwrSection base={base} b={b} showRef={showRef} />
    </>
  );
}

function ValueSection({ base, b, showRef }: { base: Base; b: BenchSeries; showRef: boolean }) {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("value");
  const rows = useMemo(() => base.series.map((r, i) => ({ d: r.d, you: r.v, bench: b.vals[i], spy: r.spyVal, inv: r.inv, lead: r.v - b.vals[i] })), [base, b]);
  const ticks = useMemo(() => evenTicks(rows, 7), [rows]);
  const leads = rows.map((r) => r.lead), max = Math.max(...leads, 0), min = Math.min(...leads, 0);
  const zero = max - min ? max / (max - min) : 0.5;
  const bigSells = Math.max(0, ...base.monthly.map((m) => m.sell)) > 1000;
  return (
    <Section
      title={`Same dollars in ${b.label}`}
      sub={`${base.stats.nTrades.toLocaleString()} trades replayed, ${longDate(base.series[0].d)} to ${longDate(base.end)}. Each day's net buys go into ${b.ticker} at that day's close.`}
      right={<Segmented size="sm" value={view} options={VIEWS} onChange={setView} />}>
      {view !== "flows" && (
        <div className="mb-2 flex gap-5 text-xs text-tx-2">
          {view === "value" ? (
            <>
              <LegendItem color={C.you} label="Your portfolio" />
              <LegendItem color={C.bench} label={`Same dollars in ${b.ticker}`} />
              {showRef && <LegendItem color={C.ref} label="Same dollars in S&P 500" dash="dashed" />}
              <LegendItem color={C.inv} label="Net invested" dash="dotted" />
            </>
          ) : <span>Above $0: you're ahead. Below $0: {b.ticker} is ahead.</span>}
        </div>
      )}
      <div className="h-[340px]">
        <ResponsiveContainer>
          {view === "flows" ? (
            <ComposedChart data={base.monthly.map((m) => ({ ...m, sellNeg: -m.sell }))} stackOffset="sign">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70}
                allowDataOverflow domain={[bigSells ? "auto" : 0, "auto"]} />
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
              <Tooltip content={<ValueTip t={b.ticker} view={view} />} cursor={{ stroke: "var(--border-strong)" }} />
              {view === "value" ? (
                <>
                  <Line dataKey="inv" stroke={C.inv} strokeDasharray="2 4" dot={false} strokeWidth={1.2} isAnimationActive={false} />
                  {showRef && <Line dataKey="spy" stroke={C.ref} strokeDasharray="5 4" dot={false} strokeWidth={1.3} isAnimationActive={false} />}
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

function startIndex(series: BaseRow[], end: string, r: string) {
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

function TwrSection({ base, b, showRef }: { base: Base; b: BenchSeries; showRef: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("all");
  const S = base.series, e = S.length - 1;
  let i = startIndex(S, base.end, range);
  while (i < e && b.idx[i] == null) i++; // late-listed ticker: start at its first price
  const r0 = S[i], bi = b.idx[i] as number;
  const rows = S.slice(i).map((r, k) => ({ d: r.d, you: r.twr / r0.twr, bench: b.idx[i + k] == null ? null : (b.idx[i + k] as number) / bi, spy: r.spy / r0.spy }));
  const ticks = evenTicks(rows, 6);
  const yrs = (new Date(base.end).getTime() - new Date(r0.d).getTime()) / 864e5 / 365.25;
  const ry = S[e].twr / r0.twr - 1, rt = (b.idx[e] as number) / bi - 1, rs = S[e].spy / r0.spy - 1;
  const ann = (x: number) => (yrs >= 1 ? `${pct(Math.pow(1 + x, 1 / yrs) - 1)}/yr` : " ");
  return (
    <Section
      title={`Time-weighted: your picks vs ${b.label}`}
      sub="This removes the effect of when you added money. Every line starts at 1.00 on the first day of the period."
      right={<Segmented size="sm" value={range} options={RANGES} onChange={setRange} />}>
      <div className="mb-2 flex gap-5 text-xs text-tx-2">
        <LegendItem color={C.you} label="You" /><LegendItem color={C.bench} label={b.ticker} />
        {showRef && <LegendItem color={C.ref} label="S&P 500" dash="dashed" />}
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="d" ticks={ticks} tickFormatter={rows.length < 140 ? (d) => d.slice(5) : shortDate} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(2) + "×"} width={52} />
            <ReferenceLine y={1} stroke="var(--border-strong)" />
            <Tooltip content={<TwrTip t={b.ticker} showRef={showRef} />} cursor={{ stroke: "var(--border-strong)" }} />
            {showRef && <Line dataKey="spy" stroke={C.ref} strokeDasharray="5 4" dot={false} strokeWidth={1.3} isAnimationActive={false} />}
            <Line dataKey="bench" stroke={C.bench} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="you" stroke={C.you} dot={false} strokeWidth={2.2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={`mt-4 grid gap-3 ${showRef ? "grid-cols-4" : "grid-cols-3"}`}>
        <Kpi hero label={`You, since ${longDate(r0.d)}`} value={pct(ry)} sub={ann(ry)} tone={tone(ry)} />
        <Kpi label={b.ticker} value={pct(rt)} sub={ann(rt)} tone={tone(rt)} />
        <Kpi label={`You vs ${b.ticker}`} value={pts(ry - rt)} sub={ry >= rt ? "Your picks did better" : `${b.ticker} did better`} tone={tone(ry - rt)} />
        {showRef && <Kpi label="S&P 500 (reference)" value={pct(rs)} sub={ann(rs)} tone={tone(rs)} />}
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
        <YearTable base={base} b={b} showRef={showRef} />
        <Drawdowns base={base} b={b} />
      </div>
    </Section>
  );
}

function TwrTip({ active, payload, t, showRef }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-tx-2">{longDate(p.d)}</div>
      <div className="num">You <b>{p.you.toFixed(3)}×</b>{p.bench != null && <> · {t} {p.bench.toFixed(3)}×</>}</div>
      {showRef && <div className="num text-tx-2">S&amp;P 500 {p.spy.toFixed(3)}×</div>}
    </div>
  );
}

function YearTable({ base, b, showRef }: { base: Base; b: BenchSeries; showRef: boolean }) {
  const S = base.series;
  const years = [...new Set(S.map((r) => r.d.slice(0, 4)))];
  const rows = years.map((y, yi) => {
    const idx = S.flatMap((r, i) => (r.d.startsWith(y) ? [i] : []));
    const s = idx[0], e = idx[idx.length - 1], p = Math.max(0, s - 1);
    let pi = p;
    while (pi <= e && b.idx[pi] == null) pi++;
    const bench = pi <= e ? (b.idx[e] as number) / (b.idx[pi] as number) - 1 : null;
    return { y, note: yi === 0 ? "partial" : yi === years.length - 1 ? "YTD" : "", you: S[e].twr / S[p].twr - 1, bench, spy: S[e].spy / S[p].spy - 1 };
  });
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold">Calendar-year returns</h3>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
            <th className="pb-2 text-left font-medium">YEAR</th><th className="pb-2 text-right font-medium">YOU</th>
            <th className="pb-2 text-right font-medium">{b.ticker}</th><th className="pb-2 text-right font-medium">DIFFERENCE</th>
            {showRef && <th className="pb-2 text-right font-medium">S&amp;P 500</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.y} className="border-b border-line last:border-0">
              <td className="py-2.5">{r.y} {r.note && <span className="text-xs text-tx-3">({r.note})</span>}</td>
              <td className={`num text-right font-medium ${tone(r.you)}`}>{pct(r.you)}</td>
              <td className={`num text-right ${r.bench == null ? "" : tone(r.bench)}`}>{r.bench == null ? "—" : pct(r.bench)}</td>
              <td className={`num text-right ${r.bench == null ? "" : tone(r.you - r.bench)}`}>{r.bench == null ? "—" : pts(r.you - r.bench)}</td>
              {showRef && <td className="num text-right text-tx-2">{pct(r.spy)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drawdowns({ base, b }: { base: Base; b: BenchSeries }) {
  const rows = useMemo(() => {
    let pkY = 0, pkB = 0;
    return base.series.map((r, i) => {
      pkY = Math.max(pkY, r.twr);
      const x = b.idx[i];
      if (x != null) pkB = Math.max(pkB, x);
      return { d: r.d, you: r.twr / pkY - 1, bench: x == null ? null : x / pkB - 1 };
    });
  }, [base, b]);
  const worstY = Math.min(...rows.map((r) => r.you)), worstB = Math.min(...rows.map((r) => r.bench ?? 0));
  const ticks = evenTicks(rows, 5);
  const floor = Math.floor(Math.min(worstY, worstB) * 20) / 20;
  const yTicks = Array.from({ length: Math.round(-floor * 20) + 1 }, (_, j) => -j * 0.05);
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-tx-2"><LegendItem color={C.you} label="You" /><LegendItem color={C.bench} label={b.ticker} /></div>
      <h3 className="mb-2 text-[13px] font-semibold">
        Drawdown from previous high <span className="font-normal text-tx-2">· worst: you <span className="num text-neg">{pct(worstY)}</span>, {b.ticker} <span className="num text-neg">{pct(worstB)}</span></span>
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
                <div className="num">You {pct(payload[0].payload.you)}{payload[0].payload.bench != null && ` · ${b.ticker} ${pct(payload[0].payload.bench)}`}</div>
              </div>) : null} />
            <Area dataKey="you" stroke={C.you} strokeWidth={1.5} fill="url(#ddFill)" isAnimationActive={false} />
            <Line dataKey="bench" stroke={C.bench} strokeWidth={1.3} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
