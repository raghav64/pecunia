import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { longDate, money, signedMoney, tone } from "../lib/format";
import { Section, Segmented, Skeleton } from "../components/ui";

type Trade = { date: string; symbol: string; side: "BUY" | "SELL"; qty: number; price: number; amount: number };
type Recon = { symbol: string; rebuilt: number; webull: number; diff: number; px: number };
type PerSym = { symbol: string; bought: number; sold: number; divs: number; mv: number; pnl: number; ret: number; first: string; n: number; open: boolean };
type DataT = {
  end: string; trades: Trade[]; reconciliation: Recon[]; perSymbol: PerSym[];
  legacySells: { date: string; symbol: string; qty: number; flow: number }[];
  reconGap: number; holdingsValue: number; brokerMarketValue: number | null; positionsAsOf: string | null;
  nTrades: number; firstTrade: string; dividends: number; missingPrices: string[];
};
const SIDES = [["", "All"], ["BUY", "Buys"], ["SELL", "Sells"]] as const;
const LIMIT = 500;

export default function Data() {
  const { data, error } = useQuery({ queryKey: ["trades"], queryFn: () => api<DataT>("/api/trades"), staleTime: 5 * 60_000 });
  return (
    <div className="mx-auto max-w-[1320px] space-y-5 px-12 pb-12 pt-9">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trades &amp; method</h1>
        <p className="mt-1 text-[13px] text-tx-2">Every filled order, how the numbers are calculated, and a check against Webull's positions.</p>
      </header>
      {error && <div className="card p-5 text-sm text-neg">{(error as Error).message}</div>}
      {!data && !error && <Skeleton className="h-[600px]" />}
      {data && <TradeLog d={data} />}
      {data && <PerSymbol rows={data.perSymbol} />}
      {data && <Method d={data} />}
    </div>
  );
}

function TradeLog({ d }: { d: DataT }) {
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"" | "BUY" | "SELL">("");
  const rows = useMemo(() => {
    const Q = q.trim().toUpperCase();
    return d.trades.filter((t) => (!side || t.side === side) && (!Q || t.symbol.includes(Q) || t.date.includes(Q))).reverse();
  }, [d, q, side]);
  const net = rows.reduce((s, t) => s + (t.side === "BUY" ? t.amount : -t.amount), 0);
  return (
    <Section title="Trade log" sub="Filled orders from Webull's order history (read-only). These are the exact cash flows every comparison replays."
      right={<div className="flex items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbol or date (2025-04)…"
          className="w-56 rounded-full border border-line-strong bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-tx-3 focus:border-orange" />
        <Segmented size="sm" value={side} options={SIDES} onChange={setSide} />
      </div>}>
      <div className="mb-2 text-xs text-tx-2"><span className="num">{rows.length.toLocaleString()}</span> trades · net <span className="num">{money(net)}</span></div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              {["DATE", "SYMBOL", "SIDE"].map((h) => <th key={h} className="pb-2 text-left font-medium">{h}</th>)}
              {["QTY", "PRICE", "AMOUNT"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, LIMIT).map((t, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="num py-1.5 text-tx-2">{t.date}</td>
                <td className="font-semibold">{t.symbol}</td>
                <td className={t.side === "SELL" ? "text-neg" : "text-tx-2"}>{t.side}</td>
                <td className="num text-right">{t.qty}</td>
                <td className="num text-right">{money(t.price, 2)}</td>
                <td className="num text-right">{money(t.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > LIMIT && <p className="py-2 text-center text-xs text-tx-3">Showing the latest {LIMIT}. Filter to narrow down.</p>}
      </div>
    </Section>
  );
}

function PerSymbol({ rows }: { rows: PerSym[] }) {
  return (
    <Section title="Lifetime P&L by stock" sub="Everything you bought and sold in each symbol, plus dividends, against today's value.">
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">SYMBOL</th><th className="pb-2 text-left font-medium">FIRST BUY</th>
              {["ORDERS", "BOUGHT", "SOLD", "DIVIDENDS", "VALUE NOW", "P&L", "RETURN"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => b.pnl - a.pnl).map((r) => (
              <tr key={r.symbol} className="border-b border-line last:border-0">
                <td className="py-1.5 font-semibold">{r.symbol}{!r.open && <span className="ml-1 text-xs font-normal text-tx-3">(closed)</span>}</td>
                <td className="num text-tx-2">{r.first}</td>
                <td className="num text-right">{r.n}</td>
                <td className="num text-right">{money(r.bought)}</td>
                <td className="num text-right">{r.sold ? money(r.sold) : "–"}</td>
                <td className="num text-right">{r.divs ? money(r.divs, 2) : "–"}</td>
                <td className="num text-right">{money(r.mv)}</td>
                <td className={`num text-right ${tone(r.pnl)}`}>{signedMoney(r.pnl)}</td>
                <td className={`num text-right ${tone(r.ret)}`}>{(r.ret >= 0 ? "+" : "−") + Math.abs(r.ret).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Method({ d }: { d: DataT }) {
  const ok = d.reconciliation.filter((r) => Math.abs(r.diff) <= 0.01).length;
  const legacy = d.legacySells;
  return (
    <Section title="Method & data quality">
      <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-tx-2">
        <li><b className="text-tx">Trades:</b> {d.nTrades.toLocaleString()} filled orders since {longDate(d.firstTrade)}, pulled read-only from Webull and dated in US Eastern time.</li>
        <li><b className="text-tx">Prices:</b> Yahoo Finance daily closes, with splits applied to older trades. Dividends ({money(d.dividends)} so far) are reinvested on the ex-date, matching Webull's automatic reinvestment.</li>
        <li><b className="text-tx">Shadow portfolios:</b> each day's net buys go into the ticker at that day's adjusted close; sells come out. If a ticker listed after your first trade, money waits in cash until its first day.</li>
        <li><b className="text-tx">IRR</b> is the yearly return on your invested money from those exact cash flows. <b className="text-tx">Time-weighted return</b> multiplies daily returns (close ÷ (previous close + that day's net buys)), so the timing of deposits doesn't count.</li>
        <li><b className="text-tx">Valuation:</b> closing prices on {longDate(d.end)}. Rebuilt holdings {money(d.holdingsValue)}{d.brokerMarketValue != null && <> vs Webull's {money(d.brokerMarketValue)} (positions as of {d.positionsAsOf})</>}.</li>
        <li><b className="text-tx">Left out:</b> {legacy.length ? <>{legacy.length} sells of {[...new Set(legacy.map((t) => t.symbol))].join(", ")} ({money(legacy.reduce((s, t) => s - t.flow, 0), 2)} total). Those shares never appear as buys in this history and look like sign-up promo stock.</> : "nothing."}</li>
        {d.missingPrices.length > 0 && <li className="text-neg">Missing prices for: {d.missingPrices.join(", ")}</li>}
      </ul>
      <h3 className="mb-1 mt-6 text-[13px] font-semibold">Reconciliation: rebuilt shares vs Webull</h3>
      <p className="mb-2 text-xs text-tx-2">{ok} of {d.reconciliation.length} positions match within 0.01 shares. Net value of all differences: <span className="num">{money(d.reconGap, 2)}</span>.</p>
      <div className="max-h-[340px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line text-[11px] font-medium tracking-wide text-tx-3">
              <th className="pb-2 text-left font-medium">SYMBOL</th>
              {["REBUILT", "WEBULL", "DIFFERENCE", "≈ $"].map((h) => <th key={h} className="pb-2 text-right font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.reconciliation.map((r) => (
              <tr key={r.symbol} className="border-b border-line last:border-0">
                <td className="py-1.5 font-semibold">{r.symbol}</td>
                <td className="num text-right">{r.rebuilt}</td>
                <td className="num text-right">{r.webull}</td>
                <td className={`num text-right ${Math.abs(r.diff) <= 0.01 ? "text-tx-2" : "text-neg"}`}>{r.diff}</td>
                <td className="num text-right text-tx-2">{money(r.diff * r.px, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mb-1 mt-6 text-[13px] font-semibold">Refresh &amp; scripts</h3>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-tx-2">
        <li>The <b className="text-tx">Refresh</b> button in the rail runs the full pipeline (Webull → prices → every analysis).</li>
        <li><code className="num text-xs">./run.sh</code>: the same refresh from Terminal. <code className="num text-xs">uv run python scripts/shadow.py COST NVDA</code>: shadow any ticker.</li>
      </ul>
    </Section>
  );
}
