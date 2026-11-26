import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { X } from "lucide-react";
import { api, useBase, type BasePayload } from "../lib/api";
import { longDate, money, pct, shortDate, tone } from "../lib/format";
import { Kpi, LegendItem, Section, Skeleton, axisTick } from "../components/ui";
import { shortName } from "./Compare";

type RowT = {
  t: string; name: string; ann: number; vol: number; sharpe: number; dd: number; corr: number; beta: number; beat: number; score: number;
  years: Record<string, number | null>; sleeve: { value: number; delta: number; dd: number; vol: number };
};
type SectorsT = {
  end: string; year_keys: string[]; you: { ann: number; vol: number; dd: number; years: Record<string, number> };
  spy_years: Record<string, number>; sectors: { name: string; etf: string; ranked: string[] }[]; rows: Record<string, RowT>;
};
type Series = Record<string, { vals: number[]; idx: (number | null)[] }>;
type Mix = Record<string, number>;

const PRESETS: [string, Mix][] = [
  ["Your actual portfolio", {}],
  ["+ 40% sector ETFs", { XLV: 0.1, XLP: 0.1, XLF: 0.1, XLE: 0.1 }],
  ["+ 40% top-scored stocks", { JNJ: 0.08, WMT: 0.08, JPM: 0.08, RTX: 0.08, XOM: 0.08 }],
  ["30% S&P core + 30% sector ETFs", { SPY: 0.3, XLV: 0.1, XLP: 0.1, XLF: 0.1 }],
  ["Half in defensive ETFs", { XLV: 0.125, XLP: 0.125, XLF: 0.125, XLE: 0.125 }],
];
/** value change for you: "$X more" / "$X less" */
const Eff = ({ x }: { x: number }) => <b className={`num ${x >= 0 ? "text-pos" : "text-neg"}`}>{money(Math.abs(x))} {x >= 0 ? "more" : "less"}</b>;
const Ahead = ({ diff, name }: { diff: number; name: string }) =>
  <span className={`num whitespace-nowrap ${diff >= 0 ? "text-pos" : "text-neg"}`}>{diff >= 0 ? `You +${money(diff)}` : `${name} +${money(-diff)}`}</span>;

function Corr({ c }: { c: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="inline-block h-1.5 w-11 overflow-hidden rounded-full bg-raised">
        <span className="block h-full" style={{ width: `${Math.max(0, c) * 100}%`, background: c > 0.6 ? "var(--neg)" : c > 0.3 ? "var(--orange)" : "var(--pos)" }} />
      </span>
      <span className="num">{c.toFixed(2)}</span>
    </span>
  );
}

/** daily TWR path of a value series with external flows → worst drop + annualized volatility */
function pathStats(vals: number[], base: BasePayload["series"], e: number) {
  const r: number[] = [];
  let tw = 1, pk = 1, dd = 0;
  for (let i = 1; i <= e; i++) {
    const f = base[i].inv - base[i - 1].inv, b = vals[i - 1] + f, x = b > 1 ? vals[i] / b : 1;
    tw *= x; r.push(x - 1); pk = Math.max(pk, tw); dd = Math.min(dd, tw / pk - 1);
  }
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  return { dd, vol: sd * Math.sqrt(252) };
}
function mixVals(mix: Mix, base: BasePayload["series"], S: Series, e: number) {
  const w = Object.values(mix).reduce((a, b) => a + b, 0), out: number[] = [];
  for (let i = 0; i <= e; i++) {
    let v = (1 - w) * base[i].v;
    for (const t in mix) v += mix[t] * (S[t]?.vals[i] ?? 0);
    out.push(v);
  }
  return out;
}
function lumpOrDca(idx: (number | null)[], dates: string[], si: number, ei: number, amt: number, mode: "lump" | "dca") {
  if (mode === "lump") {
    let i = si;
    while (i <= ei && idx[i] == null) i++;
    return i > ei ? null : { inv: amt, val: (amt * (idx[ei] as number)) / (idx[i] as number) };
  }
  let u = 0, inv = 0, last = "";
  for (let i = si; i <= ei; i++) {
    const m = dates[i].slice(0, 7);
    if (m !== last && idx[i] != null) { u += amt / (idx[i] as number); inv += amt; last = m; }
  }
  return inv ? { inv, val: u * (idx[ei] as number) } : null;
}

export default function Sectors() {
  const sx = useQuery({ queryKey: ["sectors"], queryFn: () => api<SectorsT>("/api/analysis/sectors"), staleTime: 5 * 60_000 });
  const base = useBase();
  const tickers = useMemo(() => Object.keys(sx.data?.rows ?? {}).concat("SPY").join(","), [sx.data]);
  const series = useQuery({ queryKey: ["series", tickers], queryFn: () => api<Series>(`/api/shadows/series?symbols=${tickers}`), enabled: !!sx.data, staleTime: 5 * 60_000 });
  const ready = sx.data && base.data && series.data;
  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-12 pb-12 pt-9">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Re-orient: would other sectors have helped?</h1>
        <p className="mt-1 text-[13px] text-tx-2">Every number uses your real deposit dates. Pick the date to measure at: results look very different at a market peak than after a sell-off.</p>
      </header>
      {(sx.error || base.error) && <div className="card p-5 text-sm text-neg">{((sx.error || base.error) as Error).message}</div>}
      {!ready && !sx.error && <Skeleton className="h-[700px]" />}
      {ready && <Body sx={sx.data!} base={base.data!} S={series.data!} />}
    </div>
  );
}

function Body({ sx, base, S }: { sx: SectorsT; base: BasePayload; S: Series }) {
  const ser = base.series, N = ser.length - 1, dates = useMemo(() => ser.map((r) => r.d), [ser]);
  const spyPeak = useMemo(() => ser.reduce((best, r, i) => (r.spy > ser[best].spy ? i : best), 0), [ser]);
  const endOfLastYear = useMemo(() => { const y = ser[N].d.slice(0, 4); return Math.max(0, ser.findIndex((r) => r.d >= `${y}-01-01`) - 1); }, [ser, N]);
  const [e, setE] = useState(N);
  const r = ser[e];
  const youVals = useMemo(() => ser.map((x) => x.v), [ser]);
  const you = useMemo(() => pathStats(youVals, ser, e), [youVals, ser, e]);
  const spy = useMemo(() => pathStats(S.SPY?.vals ?? youVals, ser, e), [S, ser, e, youVals]);
  const etfs = sx.sectors.map((s) => s.etf);
  const beat = etfs.filter((t) => S[t] && S[t].vals[e] > r.v);
  return (
    <>
      <section className="card sticky top-0 z-10 flex flex-wrap items-center gap-5 px-6 py-4">
        <label className="min-w-[320px] flex-1">
          <span className="text-xs text-tx-2">Measure as of <b className="text-tx">{longDate(r.d)}</b>{e === N ? " (latest)" : ""}</span>
          <input type="range" min={60} max={N} value={e} onChange={(ev) => setE(+ev.target.value)} className="mt-1 block w-full accent-[var(--orange)]" />
        </label>
        <div className="flex gap-2">
          {([["Latest close", N], ["S&P 500 peak", spyPeak], [`End of ${+ser[N].d.slice(0, 4) - 1}`, endOfLastYear]] as const).map(([l, i]) => (
            <button key={l} onClick={() => setE(i)} className={`rounded-full border px-3 py-1 text-xs ${e === i ? "border-orange bg-orange/10 text-orange" : "border-line text-tx-2 hover:text-tx"}`}>{l}</button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-4 gap-3">
        <Kpi hero label={`Your portfolio on ${longDate(r.d)}`} value={money(r.v)} sub={`${money(r.inv)} invested · gain ${money(r.v - r.inv)}`} />
        <Kpi label="How bumpy your ride was" value={`${(you.vol * 100).toFixed(0)}% volatility`} sub={`S&P 500 ${(spy.vol * 100).toFixed(0)}% · your worst drop ${pct(you.dd)} vs ${pct(spy.dd)}`} />
        <Kpi label="How closely you track tech (XLK)" value={sx.rows.XLK?.corr.toFixed(2) ?? "–"} sub="1.00 = moves in lockstep. Your portfolio behaves like a tech fund." />
        <Kpi label="Sector ETFs that beat you by this date" value={`${beat.length} of ${etfs.length}`} sub={beat.length ? beat.join(", ") : "None of them"} />
      </div>

      <Section title="Sector ETFs: what each would have done for you" className="[&_table]:whitespace-nowrap"
        sub={<><b>All in</b>: every dollar goes into that ETF on the same day instead. <b>20% sleeve</b>: 20% of every deposit goes to the ETF and 80% to the stocks you actually bought. <b>Moves with you</b> is the correlation of daily returns; lower diversifies you more.</>}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">SECTOR</th><th className="pb-2 text-left font-medium">ETF</th>
              {["ALL IN: VALUE", "WHO'S AHEAD", "RETURN /YR", "VOLATILITY", "WORST DROP", "MOVES WITH YOU", "20% SLEEVE: EFFECT", "20% SLEEVE: WORST DROP"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {sx.sectors.map((s) => {
              const R = sx.rows[s.etf], v = S[s.etf]?.vals[e];
              if (!R || v == null) return null;
              const sleeve = 0.8 * r.v + 0.2 * v, ps = pathStats(mixVals({ [s.etf]: 0.2 }, ser, S, e), ser, e);
              return (
                <tr key={s.etf} className="border-b border-line last:border-0">
                  <td className="py-2.5">{s.name}</td><td className="font-semibold">{s.etf}</td>
                  <td className="num text-right">{money(v)}</td>
                  <td className="text-right"><Ahead diff={r.v - v} name={s.etf} /></td>
                  <td className="num text-right">{pct(R.ann)}</td>
                  <td className="num text-right">{(R.vol * 100).toFixed(0)}%</td>
                  <td className="num text-right text-neg">{pct(R.dd)}</td>
                  <td className="text-right"><Corr c={R.corr} /></td>
                  <td className="text-right"><Eff x={sleeve - r.v} /></td>
                  <td className="num text-right">{pct(ps.dd)} <span className="text-[11px] text-tx-3">(you {pct(you.dd)})</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Picks sx={sx} base={base} S={S} e={e} dates={dates} />
      <MixBuilder base={base} S={S} e={e} allTickers={Object.keys(sx.rows).sort()} names={Object.fromEntries(Object.values(sx.rows).map((x) => [x.t, x.name]))} />
      <Recs sx={sx} base={base} S={S} spyPeak={spyPeak} />
    </>
  );
}

function Picks({ sx, base, S, e, dates }: { sx: SectorsT; base: BasePayload; S: Series; e: number; dates: string[] }) {
  const [sec, setSec] = useState(0);
  const [amt, setAmt] = useState(10000);
  const [mode, setMode] = useState<"lump" | "dca">("lump");
  const [start, setStart] = useState(dates[0]);
  let si = dates.findIndex((d) => d >= start);
  if (si < 0 || si >= e) si = 0;
  const s = sx.sectors[sec], yk = sx.year_keys;
  const youIdx = base.series.map((x) => x.twr);
  const mine = lumpOrDca(youIdx, dates, si, e, amt, mode);
  const list = [s.etf, ...s.ranked];
  return (
    <Section title="Top picks by sector"
      sub={<>The score ranks on more than past return, since past winners often stop winning: <b>35%</b> return per unit of volatility · <b>25%</b> years beating the S&amp;P 500 · <b>20%</b> shallow worst drop · <b>20%</b> low correlation with your portfolio.</>}>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {sx.sectors.map((x, i) => (
          <button key={x.name} onClick={() => setSec(i)} className={`rounded-full px-3 py-1 text-xs font-medium ${i === sec ? "bg-sel text-sel-tx" : "bg-raised/60 text-tx-2 hover:text-tx"}`}>{x.name}</button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-4 text-xs">
        <label className="text-tx-2">Amount<br /><input type="number" min={1} step={100} value={amt} onChange={(ev) => setAmt(Math.max(0, +ev.target.value || 0))} className="num mt-1 w-32 rounded-lg border border-line-strong bg-transparent px-2.5 py-1.5 text-[13px] text-tx outline-none focus:border-orange" /></label>
        <label className="text-tx-2">How<br />
          <select value={mode} onChange={(ev) => setMode(ev.target.value as "lump" | "dca")} className="mt-1 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] text-tx outline-none">
            <option value="lump">Lump sum, once</option><option value="dca">Every month</option>
          </select></label>
        <label className="text-tx-2">Starting<br /><input type="date" value={start} min={dates[0]} max={dates[e]} onChange={(ev) => setStart(ev.target.value)} className="num mt-1 rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] text-tx outline-none" /></label>
        <span className="pb-2 text-tx-2">{money(amt)} {mode === "lump" ? "once" : "every month"} from {longDate(dates[si])} to {longDate(dates[e])}{mine && <> · your own picks: <b className="num text-tx">{money(mine.val)}</b></>}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-[13px] [&_td]:px-2 [&_th]:px-2">
          <thead>
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">#</th><th className="pb-2 text-left font-medium">TICKER</th>
              {["SCORE", `${money(amt)}${mode === "dca" ? "/MO" : ""} →`, "GAIN", "VS YOUR PICKS", "RETURN/YR", "VOL", "WORST DROP", "MOVES WITH YOU", ...yk.map((y, i) => y + (i === yk.length - 1 ? " YTD" : "")), "BEAT S&P"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line bg-orange/[0.07] font-medium">
              <td /><td className="py-2.5">★ Your picks</td><td />
              <td className="num text-right">{mine ? money(mine.val) : "–"}</td>
              <td className={`num text-right ${mine ? tone(mine.val - mine.inv) : ""}`}>{mine ? money(mine.val - mine.inv) : "–"}</td>
              <td /><td className="num text-right">{pct(sx.you.ann)}</td><td className="num text-right">{(sx.you.vol * 100).toFixed(0)}%</td>
              <td className="num text-right text-neg">{pct(sx.you.dd)}</td><td className="num text-right">1.00</td>
              {yk.map((y) => <td key={y} className="num text-right">{pct(sx.you.years[y])}</td>)}<td />
            </tr>
            {list.map((t, i) => {
              const R = sx.rows[t], c = S[t] ? lumpOrDca(S[t].idx, dates, si, e, amt, mode) : null;
              if (!R) return null;
              const etf = i === 0;
              return (
                <tr key={t} className="border-b border-line last:border-0 hover:bg-raised/40">
                  <td className="py-2.5 text-tx-3">{etf ? "ETF" : i}</td>
                  <td>
                    <Link to={`/analysis/compare?t=${t}`} className="font-semibold hover:text-orange">{t}</Link>{" "}
                    <span className="inline-block max-w-[150px] truncate align-bottom text-xs text-tx-2">{shortName(t, R.name)}</span>
                    {!etf && i <= 2 && <span className="ml-1.5 rounded-full bg-pos/15 px-1.5 py-0.5 text-[10px] font-medium text-pos">top pick</span>}
                  </td>
                  <td className="num text-right font-medium">{etf ? "" : (R.score >= 0 ? "+" : "") + R.score.toFixed(2)}</td>
                  <td className="num text-right">{c ? money(c.val) : "–"}</td>
                  <td className={`num text-right ${c ? tone(c.val - c.inv) : ""}`}>{c ? money(c.val - c.inv) : "–"}</td>
                  <td className="text-right">{c && mine ? <Ahead diff={mine.val - c.val} name={t} /> : "–"}</td>
                  <td className="num text-right">{pct(R.ann)}</td>
                  <td className="num text-right">{(R.vol * 100).toFixed(0)}%</td>
                  <td className="num text-right text-neg">{pct(R.dd)}</td>
                  <td className="text-right"><Corr c={R.corr} /></td>
                  {yk.map((y) => { const v = R.years[y]; return <td key={y} className={`num text-right ${v != null && v > sx.spy_years[y] ? "text-pos" : ""}`}>{v == null ? "–" : pct(v)}</td>; })}
                  <td className="num text-right">{R.beat}/{yk.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function MixBuilder({ base, S, e, allTickers, names }: { base: BasePayload; S: Series; e: number; allTickers: string[]; names: Record<string, string> }) {
  const [mix, setMix] = useState<Mix>(PRESETS[1][1]);
  const [preset, setPreset] = useState(1);
  const [add, setAdd] = useState(allTickers[0]);
  const ser = base.series, r = ser[e];
  const w = Object.values(mix).reduce((a, b) => a + b, 0);
  const mv = useMemo(() => mixVals(mix, ser, S, e), [mix, ser, S, e]);
  const ms = useMemo(() => pathStats(mv, ser, e), [mv, ser, e]);
  const ys = useMemo(() => pathStats(ser.map((x) => x.v), ser, e), [ser, e]);
  const sp = useMemo(() => pathStats(S.SPY.vals, ser, e), [S, ser, e]);
  const rows = useMemo(() => ser.slice(0, e + 1).map((x, i) => ({ d: x.d, mix: mv[i], you: x.v, spy: S.SPY.vals[i], inv: x.inv })), [ser, e, mv, S]);
  const ticks = rows.length ? Array.from({ length: 6 }, (_, j) => rows[Math.round((j * (rows.length - 1)) / 5)].d) : [];
  const setW = (t: string, pctv: number) => setMix((m) => {
    const others = Object.entries(m).filter(([k]) => k !== t).reduce((a, [, v]) => a + v, 0);
    return { ...m, [t]: Math.min(pctv / 100, 1 - others) };
  });
  return (
    <Section title="Mix builder: re-run your history with a different mix"
      sub="Choose what share of every deposit goes to each fund or stock. Whatever is left goes into the stocks you actually bought.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {PRESETS.map(([l, m], i) => (
          <button key={l} onClick={() => { setMix({ ...m }); setPreset(i); }} className={`rounded-full px-3 py-1 text-xs font-medium ${preset === i ? "bg-sel text-sel-tx" : "bg-raised/60 text-tx-2 hover:text-tx"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(mix).map(([t, x]) => (
          <div key={t} className="rounded-xl border border-line px-3 py-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="truncate"><b>{t}</b> <span className="text-xs text-tx-2">{shortName(t, names[t])}</span></span>
              <span className="flex items-center gap-1.5"><b className="num">{Math.round(x * 100)}%</b>
                <button onClick={() => { setMix((m) => { const n = { ...m }; delete n[t]; return n; }); setPreset(-1); }} className="text-tx-3 hover:text-neg" aria-label={`Remove ${t}`}><X size={14} /></button></span>
            </div>
            <input type="range" min={0} max={100} value={Math.round(x * 100)} onChange={(ev) => { setW(t, +ev.target.value); setPreset(-1); }} className="mt-1 w-full accent-[var(--orange)]" />
          </div>
        ))}
        {!Object.keys(mix).length && <p className="col-span-4 text-[13px] text-tx-2">No changes: this is your actual portfolio.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <select value={add} onChange={(ev) => setAdd(ev.target.value)} className="rounded-lg border border-line-strong bg-card px-2.5 py-1.5 text-[13px] outline-none">
          {allTickers.map((t) => <option key={t} value={t}>{t} · {shortName(t, names[t])}</option>)}
        </select>
        <button onClick={() => { if (!(add in mix) && w < 1) { setMix((m) => ({ ...m, [add]: Math.min(0.05, 1 - w) })); setPreset(-1); } }} className="rounded-full bg-sel px-3.5 py-1.5 text-[13px] font-medium text-sel-tx">Add</button>
        <span className="text-tx-2">{Math.round((1 - w) * 100)}% of every deposit stays in the stocks you actually bought.</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-3">
        <Kpi hero label="This mix" value={money(mv[e])} sub={`gain ${money(mv[e] - r.inv)} on ${money(r.inv)}`} />
        <Kpi label={mv[e] >= r.v ? "This mix beats your actual portfolio by" : "Your actual portfolio beats this mix by"} value={money(Math.abs(mv[e] - r.v))} sub={`your actual: ${money(r.v)}`} tone={mv[e] >= r.v ? "text-pos" : "text-neg"} />
        <Kpi label="Worst drop" value={pct(ms.dd)} sub={`actual ${pct(ys.dd)} · S&P 500 ${pct(sp.dd)}`} tone={ms.dd >= ys.dd ? "text-pos" : "text-neg"} />
        <Kpi label="Volatility" value={`${(ms.vol * 100).toFixed(0)}%`} sub={`actual ${(ys.vol * 100).toFixed(0)}% · S&P 500 ${(sp.vol * 100).toFixed(0)}%`} tone={ms.vol <= ys.vol ? "text-pos" : "text-neg"} />
      </div>
      <div className="mb-2 mt-4 flex gap-5 text-xs text-tx-2">
        <LegendItem color="var(--orange)" label="This mix" /><LegendItem color="var(--chart)" label="Your actual portfolio" />
        <LegendItem color="var(--bench)" label="All in S&P 500" dash="dashed" /><LegendItem color="var(--tx-3)" label="Invested" dash="dotted" />
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer>
          <LineChart data={rows}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="d" ticks={ticks} tickFormatter={shortDate} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => money(v)} width={70} />
            <Tooltip cursor={{ stroke: "var(--border-strong)" }} content={({ active, payload }: any) => active && payload?.length ? (
              <div className="card px-3 py-2 text-xs shadow-lg">
                <div className="mb-1 text-tx-2">{longDate(payload[0].payload.d)}</div>
                <div className="num">Mix <b>{money(payload[0].payload.mix)}</b> · actual {money(payload[0].payload.you)}</div>
                <div className="num text-tx-2">S&amp;P 500 {money(payload[0].payload.spy)} · invested {money(payload[0].payload.inv)}</div>
              </div>) : null} />
            <Line dataKey="inv" stroke="var(--tx-3)" strokeDasharray="2 4" dot={false} strokeWidth={1} isAnimationActive={false} />
            <Line dataKey="spy" stroke="var(--bench)" strokeDasharray="5 4" dot={false} strokeWidth={1.3} isAnimationActive={false} />
            <Line dataKey="you" stroke="var(--chart)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line dataKey="mix" stroke="var(--orange)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Recs({ sx, base, S, spyPeak }: { sx: SectorsT; base: BasePayload; S: Series; spyPeak: number }) {
  const ser = base.series, N = ser.length - 1, R = sx.rows;
  const at = (mix: Mix, e: number) => mixVals(mix, ser, S, e)[e] - ser[e].v;
  const etf40 = PRESETS[1][1], top40 = PRESETS[2][1];
  const s1 = pathStats(mixVals(etf40, ser, S, N), ser, N), y1 = pathStats(ser.map((r) => r.v), ser, N);
  const helped = sx.sectors.map((s) => s.etf).filter((t) => S[t] && at({ [t]: 0.2 }, N) > 0);
  const lastY = sx.year_keys[sx.year_keys.length - 1];
  const g = (t: string) => R[t];
  const items: [string, string, React.ReactNode][] = [
    ["Key", "Your real risk is one bet, not too few stocks", <>Your daily returns move <b>{g("XLK")?.corr.toFixed(2)}</b> in step with the tech ETF (XLK), but only {g("XLV")?.corr.toFixed(2)} with healthcare, {g("XLP")?.corr.toFixed(2)} with staples and {g("XLE")?.corr.toFixed(2)} with energy. That's why your worst drop was {pct(sx.you.dd)} vs {pct(g("SPY")?.dd ?? 0)} for the S&amp;P 500, and why AI sell-offs hit you hard.</>],
    ["Insight", "The honest answer depends on the date", <>At the S&amp;P 500 peak ({longDate(ser[spyPeak].d)}), putting 40% of every deposit into the four defensive sector ETFs would have left you with <Eff x={at(etf40, spyPeak)} />. Today it's <Eff x={at(etf40, N)} />. Diversifying mostly changes the ride, not the result: volatility {(s1.vol * 100).toFixed(0)}% instead of {(y1.vol * 100).toFixed(0)}%, worst drop {pct(s1.dd)} instead of {pct(y1.dd)}.</>],
    ["Idea", "Healthcare and staples were the best diversifiers", <>XLV as a 20% sleeve would leave you with <Eff x={at({ XLV: 0.2 }, N)} /> today while barely moving with your stocks (correlation {g("XLV")?.corr.toFixed(2)}). In healthcare, JNJ (score {g("JNJ")?.score.toFixed(2)}) and ABBV ({g("ABBV")?.score.toFixed(2)}) had shallow drops and little link to your portfolio. In staples, WMT ({g("WMT")?.score.toFixed(2)}) and PM ({g("PM")?.score.toFixed(2)}) beat the S&amp;P 500 in {g("WMT")?.beat}/{sx.year_keys.length} and {g("PM")?.beat}/{sx.year_keys.length} years.</>],
    ["Note", "Banks: JPM and Berkshire, but they diversify less", <>Financials move more with you (XLF {g("XLF")?.corr.toFixed(2)}, GS {g("GS")?.corr.toFixed(2)}). BRK.B had the smallest drop in the group ({pct(g("BRK.B")?.dd ?? 0)}) with low correlation ({g("BRK.B")?.corr.toFixed(2)}). Your AXP holding returned {pct(g("AXP")?.years[lastY] ?? 0)} in {lastY}.</>],
    ["Note", "Energy and defense as hedges", <>As a 20% sleeve, XLE would leave you with <Eff x={at({ XLE: 0.2 }, N)} /> today {helped.length ? <>(sector ETFs that would have added money: {helped.join(", ")})</> : "(no sector ETF would have added money)"}. XOM and CVX have near-zero correlation with you; RTX beat the S&amp;P 500 in {g("RTX")?.beat}/{sx.year_keys.length} years. Energy is cyclical: treat it as a small hedge.</>],
    ["Insight", "Consumer goods: WMT yes, COST and AAPL less so", <>As a 20% sleeve, WMT would leave you with <Eff x={at({ WMT: 0.2 }, N)} /> and COST with <Eff x={at({ COST: 0.2 }, N)} />. AAPL moves with you ({g("AAPL")?.corr.toFixed(2)}), so it adds return without much diversification.</>],
    ["Idea", "A data-backed way to re-orient (example, not advice)", <>Keep your picks, but route 30–40% of new money to things that don't move with tech: about 10% XLV or JNJ/ABBV, 10% WMT/KO or XLP, 10% JPM/BRK.B, 5–10% XLE/RTX. On your exact deposits, 40% top-scored stocks would leave you with <Eff x={at(top40, N)} /> and 40% sector ETFs with <Eff x={at(etf40, N)} />, both with a worst drop near {pct(s1.dd)}. ETFs avoid depending on which single stocks happened to win, and redirecting new deposits avoids selling (and taxes).</>],
    ["Key", "Watch out for hindsight", <>Picks are scored on this period only. UNH, long a "safe" healthcare name, fell {pct(g("UNH")?.dd ?? 0)}. This page doesn't use valuations, earnings outlook or dividend safety; check those before buying.</>],
  ];
  const tag: Record<string, string> = { Key: "bg-neg/15 text-neg", Insight: "bg-raised text-tx-2", Idea: "bg-pos/15 text-pos", Note: "bg-orange/15 text-orange" };
  return (
    <Section title="What the data says">
      <div className="space-y-2.5">
        {items.map(([k, h, body]) => (
          <div key={h} className="rounded-xl border border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold"><span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag[k]}`}>{k}</span>{h}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-tx-2">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-tx-3">Informational only; not investment advice.</p>
    </Section>
  );
}
