import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useBase } from "../lib/api";
import { longDate, money, pct, signedMoney, tone } from "../lib/format";
import { Kpi, LegendItem, Section, Segmented, Skeleton, axisTick } from "../components/ui";

type Agg = { cost: number; n: number; ret: number; spy_ret: number; edge: number; edge_pct: number; f1: number | null; f3: number | null; f6: number | null };
type Month = { m: string; cost: number; value: number; gain: number; ret: number; spy_ret: number; edge: number; mkt_dd: number; n: number };
type Bucket = Agg & { label: string };
type Episode = Agg & { start: string; trough: string; depth: number; end: string | null; news: { title: string; why: string } | null };
type BigDay = Agg & { d: string; chg: number; news: string | null };
type Dips = { end: string; total: Agg; dip: Agg; calm: Agg; months: Month[]; buckets: Bucket[]; stock_buckets: Bucket[]; episodes: Episode[]; big_days: BigDay[]; spy_dd: [string, number][] };

const mlab = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
const pc = (x: number | null | undefined) => (x == null ? "–" : pct(x));
/** green for good returns, red for losses, fading to neutral near zero */
const retFill = (r: number) => {
  const k = Math.min(Math.abs(r) / (r >= 0 ? 0.8 : 0.4), 1) ** 0.6;
  return `color-mix(in oklab, ${r >= 0 ? "var(--pos)" : "var(--neg)"} ${Math.round(25 + 75 * k)}%, var(--border-strong))`;
};
const SORTS = [["ret", "By return"], ["gain", "By $ gain"], ["edge", "By timing edge"], ["m", "By date"]] as const;

export default function Dips() {
  const { data, error } = useQuery({ queryKey: ["dips"], queryFn: () => api<Dips>("/api/analysis/dips"), staleTime: 5 * 60_000 });
  const base = useBase();
  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-12 pb-12 pt-9">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Buying the dips</h1>
        <p className="mt-1 text-[13px] text-tx-2">Which months' dollars did best, what the market was doing when you bought, and whether buying during sell-offs paid off.</p>
      </header>
      {error && <div className="card p-5 text-sm text-neg">{(error as Error).message}</div>}
      {!data && !error && <Skeleton className="h-[700px]" />}
      {data && <Body d={data} gainYou={base.data?.stats.gain} />}
    </div>
  );
}

function Body({ d, gainYou }: { d: Dips; gainYou?: number }) {
  const T = d.total, D = d.dip, hi = d.buckets[0], cor = d.buckets[d.buckets.length - 1];
  const best = [...d.months].sort((a, b) => b.ret - a.ret)[0], bigG = [...d.months].sort((a, b) => b.gain - a.gain)[0];
  return (
    <>
      <div className="grid grid-cols-4 gap-3">
        <Kpi hero label="Total timing edge" value={signedMoney(T.edge)} tone={tone(T.edge)} sub={`${pct(T.edge_pct)} on ${money(T.cost)} of buys vs paying the 3-month average price`} />
        <Kpi label="Bought in dips (S&P ≥5% off its high)" value={money(D.cost)} sub={`${Math.round((D.cost / T.cost) * 100)}% of buys · timing edge ${signedMoney(D.edge)}`} />
        <Kpi label="Next 6 months: dip buys vs near-high buys" value={<>{pc(D.f6)} <span className="text-base text-tx-2">vs {pc(hi.f6)}</span></>} tone={tone((D.f6 ?? 0) - (hi.f6 ?? 0))} sub="dollar-weighted return over the following 6 months" />
        <Kpi label="Best month by return" value={mlab(best.m)} sub={`${pct(best.ret)} · biggest $ gain: ${mlab(bigG.m)} (${signedMoney(bigG.gain)})`} />
      </div>
      <MonthChart d={d} />
      <MonthTable months={d.months} />
      <Section title="Does buying the dip pay?"
        sub={<><b>Next 3/6 months</b> is how the stock you bought did over the following months, weighted by dollars, so every buy gets the same amount of time. <b>Timing edge</b> is what you have today minus what you'd have if the same dollars had bought the same stock at its average price over the previous 3 months.</>}>
        <div className="grid grid-cols-2 gap-6">
          <BucketTable title="By how far the S&P 500 was below its high" rows={d.buckets} />
          <BucketTable title="By how far the stock itself was below its high" rows={d.stock_buckets} />
        </div>
        <div className="mt-5 space-y-2 rounded-xl bg-orange/[0.08] px-4 py-3 text-[13px] leading-relaxed">
          <p><b>Bottom line:</b> buying when prices were down added about <b className="num">{signedMoney(T.edge)}</b> overall{gainYou ? <>, roughly {Math.round((T.edge / gainYou) * 100)}% of your {money(gainYou)} total gain</> : null}. Most of it came from the {money(D.cost)} bought while the S&amp;P 500 was 5%+ below its high ({signedMoney(D.edge)}). Buys near market highs ({money(hi.cost)}, {Math.round((hi.cost / T.cost) * 100)}% of your money) had a timing edge of {signedMoney(hi.edge)}. Dollars invested during corrections returned {pc(cor.f6)} over the next 6 months vs {pc(hi.f6)} for near-high buys.</p>
          <p className="text-tx-2"><b className="text-tx">Keep in mind:</b> every dip in this period recovered quickly, so dip buying looks great in hindsight. That isn't true of every sell-off (2000–02 and 2008 kept falling for over a year). Your near-high dollars still earned money: staying invested mattered more than timing.</p>
        </div>
      </Section>
      <Section title="Each sell-off and the news behind it" sub="An episode starts when the S&P 500 falls 5%+ below its 52-week high and ends when it's back within 2%. Each card covers what you bought from the start of the slide to the recovery.">
        <div className="space-y-3">
          {[...d.episodes].reverse().map((e) => (
            <div key={e.start} className="rounded-xl border border-line px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`num rounded-full px-2 py-0.5 text-[11px] font-medium ${e.depth >= 0.1 ? "bg-neg/15 text-neg" : "bg-orange/15 text-orange"}`}>−{(e.depth * 100).toFixed(1)}%</span>
                <h3 className="text-[14px] font-semibold">{e.news?.title ?? "S&P 500 drawdown"}</h3>
                {!e.end && <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-tx-2">ongoing</span>}
              </div>
              <div className="mt-1 text-xs text-tx-3">{longDate(e.start)} → low {longDate(e.trough)} → {e.end ? `recovered ${longDate(e.end)}` : "not yet recovered"}</div>
              {e.news?.why && <p className="mt-2 text-[13px] leading-relaxed text-tx-2">{e.news.why}</p>}
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <span>You bought <b className="num">{money(e.cost)}</b> <span className="text-tx-3">({e.n} trades)</span></span>
                <span>Next 6 months <b className={`num ${tone(e.f6 ?? 0)}`}>{pc(e.f6)}</b></span>
                <span>To date <b className={`num ${tone(e.ret)}`}>{pct(e.ret)}</b> <span className="text-tx-3">(S&amp;P {pct(e.spy_ret)})</span></span>
                <span>Timing edge <b className={`num ${tone(e.edge)}`}>{signedMoney(e.edge)}</b></span>
              </div>
            </div>
          ))}
          {!d.episodes.length && <p className="text-sm text-tx-2">No 5%+ sell-offs in this period.</p>}
        </div>
        <p className="mt-3 text-xs text-tx-3">Explanations come from <code>data/dip_news.json</code> (hand-curated).</p>
      </Section>
      <Section title="Days the S&P 500 fell 2% or more" sub="What you bought that day and the next 3 trading days, and how those buys did over the next 3 months.">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">DATE</th><th className="pb-2 text-right font-medium">S&amp;P 500</th>
              <th className="pb-2 pl-6 text-left font-medium">WHY</th><th className="pb-2 text-right font-medium">YOU BOUGHT (NEXT 3D)</th><th className="pb-2 text-right font-medium">NEXT 3 MO</th>
            </tr>
          </thead>
          <tbody>
            {[...d.big_days].reverse().map((b) => (
              <tr key={b.d} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap py-2.5">{longDate(b.d)}</td>
                <td className="num text-right text-neg">{pct(b.chg)}</td>
                <td className="pl-6 text-xs text-tx-2">{b.news ?? ""}</td>
                <td className="num text-right">{b.n ? money(b.cost) : "–"}</td>
                <td className={`num text-right ${b.f3 == null ? "" : tone(b.f3)}`}>{pc(b.f3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function MonthChart({ d }: { d: Dips }) {
  const rows = useMemo(() => {
    const worst: Record<string, number> = {};
    d.spy_dd.forEach(([day, v]) => { const k = day.slice(0, 7); worst[k] = Math.max(worst[k] ?? 0, v); });
    return d.months.map((m) => ({ ...m, label: mlab(m.m), dd: -(worst[m.m] ?? 0) * 100 }));
  }, [d]);
  return (
    <Section title="What you invested each month vs how far the S&P 500 was below its high"
      sub="Bars: dollars invested that month, colored by their return to date (greener = better). Line: the S&P 500's worst point that month vs its 52-week high.">
      <div className="mb-2 flex gap-5 text-xs text-tx-2"><LegendItem color="var(--chart)" label="Invested" /><LegendItem color="var(--orange)" label="S&P 500 below its high" /></div>
      <div className="h-[340px]">
        <ResponsiveContainer>
          <ComposedChart data={rows}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={2} />
            <YAxis yAxisId="l" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={66} />
            <YAxis yAxisId="r" orientation="right" domain={["dataMin", 0]} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}%`} width={44} />
            <Tooltip cursor={{ fill: "var(--raised)", opacity: 0.5 }} content={({ active, payload }: any) => active && payload?.length ? (
              <div className="card px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 text-tx-2">{payload[0].payload.label}</div>
                <div className="num">Invested {money(payload[0].payload.cost)} → <b>{money(payload[0].payload.value)}</b> ({pct(payload[0].payload.ret)})</div>
                <div className="num text-tx-2">Same $ in S&amp;P: {pct(payload[0].payload.spy_ret)} · S&amp;P low {payload[0].payload.dd.toFixed(1)}% vs high</div>
              </div>) : null} />
            <Bar yAxisId="l" dataKey="cost" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.m} fill={retFill(r.ret)} />)}
            </Bar>
            <Line yAxisId="r" dataKey="dd" stroke="var(--orange)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--orange)" }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function MonthTable({ months }: { months: Month[] }) {
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("ret");
  const rows = [...months].sort((a, b) => (sort === "m" ? a.m.localeCompare(b.m) : (b[sort] as number) - (a[sort] as number)));
  const max = Math.max(...months.map((m) => m.cost));
  return (
    <Section title="Every month's dollars, ranked" right={<Segmented size="sm" value={sort} options={SORTS} onChange={setSort} />}
      sub={`Return = what that month's buys are worth today (dividends reinvested) ÷ what they cost. Older months have had more time to grow, so compare against "Same $ in S&P 500", which had the same amount of time.`}>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">MONTH</th><th className="pb-2 text-right font-medium">INVESTED</th><th />
              {["VALUE NOW", "GAIN", "RETURN", "SAME $ IN S&P 500", "S&P BELOW HIGH", "TIMING EDGE"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.m} className="border-b border-line last:border-0">
                <td className="py-2">{mlab(m.m)}</td>
                <td className="num text-right">{money(m.cost)}</td>
                <td className="w-24 pl-3"><div className="h-1.5 rounded-full bg-raised"><div className="h-full rounded-full bg-orange/70" style={{ width: `${(m.cost / max) * 100}%` }} /></div></td>
                <td className="num text-right">{money(m.value)}</td>
                <td className={`num text-right ${tone(m.gain)}`}>{signedMoney(m.gain)}</td>
                <td className={`num text-right font-medium ${tone(m.ret)}`}>{pct(m.ret)}</td>
                <td className={`num text-right ${tone(m.spy_ret)}`}>{pct(m.spy_ret)}</td>
                <td className={`num text-right ${m.mkt_dd >= 0.05 ? "font-semibold" : "text-tx-2"}`}>{(m.mkt_dd * 100).toFixed(1)}%</td>
                <td className={`num text-right ${tone(m.edge)}`}>{signedMoney(m.edge)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
            <th className="pb-2 text-left font-medium">WHEN YOU BOUGHT</th>
            {["INVESTED", "NEXT 3 MO", "NEXT 6 MO", "TO DATE", "TIMING EDGE"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.label} className="border-b border-line last:border-0">
              <td className="py-2.5 pr-2">{b.label}</td>
              <td className="num text-right">{money(b.cost)}</td>
              <td className={`num text-right ${tone(b.f3 ?? 0)}`}>{pc(b.f3)}</td>
              <td className={`num text-right ${tone(b.f6 ?? 0)}`}>{pc(b.f6)}</td>
              <td className="num text-right">{pct(b.ret)}</td>
              <td className={`num text-right ${tone(b.edge)}`}>{signedMoney(b.edge)} <span className="text-[11px] text-tx-3">({pct(b.edge_pct)})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
