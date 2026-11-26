import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBase, type BasePayload } from "../lib/api";
import { money, pct } from "../lib/format";
import { Section, Segmented, Skeleton, axisTick } from "../components/ui";
import ShadowView from "../components/ShadowView";

type Payload = BasePayload;
const BENCH = [["SPY", "S&P 500"], ["QQQ", "Nasdaq-100"]] as const;

export default function Benchmarks() {
  const [params, setParams] = useSearchParams();
  const t = (params.get("vs") === "QQQ" ? "QQQ" : "SPY") as "SPY" | "QQQ";
  const { data, error } = useBase();
  const bench = useMemo(() => {
    if (!data) return null;
    const b = t === "SPY" ? data.spy : data.qqq;
    return {
      ...b, label: t === "SPY" ? "the S&P 500" : "the Nasdaq-100",
      vals: data.series.map((r) => (t === "SPY" ? r.spyVal : r.qqqVal)),
      idx: data.series.map((r) => (t === "SPY" ? r.spy : r.qqq)),
    };
  }, [data, t]);
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
      {data && bench && <ShadowView base={data} b={bench} />}
      {data && <Why data={data} />}
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
