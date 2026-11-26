/** Live-ish quotes from Yahoo's chart API (1-day, 5-minute bars), cached briefly and de-duplicated. */
export type Quote = {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  spark: number[]; // intraday closes (5-minute bars)
  time: number; // epoch ms of last bar
  marketState: "open" | "closed";
};

const TTL_MS = Number(process.env.QUOTE_TTL_MS || 30_000);
const cache = new Map<string, { at: number; q: Quote }>();
const inflight = new Map<string, Promise<Quote>>();
const SYM_RE = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/;

export const validSymbol = (s: string) => SYM_RE.test(s);

async function fetchQuote(symbol: string): Promise<Quote> {
  const ySym = symbol.replace(".", "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=1d&interval=5m&includePrePost=false`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (pecunia)" }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) throw Object.assign(new Error(`${symbol}: ticker not found`), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`${symbol}: upstream HTTP ${res.status}`), { status: 502 });
  const j = (await res.json()) as any;
  const r = j?.chart?.result?.[0];
  if (!r) throw Object.assign(new Error(`${symbol}: no data`), { status: 502 });
  const m = r.meta ?? {};
  const closes: number[] = (r.indicators?.quote?.[0]?.close ?? []).filter((x: number | null) => x != null);
  const price = m.regularMarketPrice ?? closes.at(-1);
  const prevClose = m.chartPreviousClose ?? m.previousClose ?? closes[0];
  const ts: number[] = r.timestamp ?? [];
  const period = m.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const open = !!period && now >= period.start && now <= period.end;
  return {
    symbol,
    name: m.shortName || m.longName || symbol,
    price,
    prevClose,
    change: price - prevClose,
    changePct: prevClose ? price / prevClose - 1 : 0,
    spark: closes.map((x) => Math.round(x * 100) / 100),
    time: (ts.at(-1) ?? now) * 1000,
    marketState: open ? "open" : "closed",
  };
}

export async function getQuote(symbol: string): Promise<Quote> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.q;
  let p = inflight.get(symbol);
  if (!p) {
    p = fetchQuote(symbol)
      .then((q) => (cache.set(symbol, { at: Date.now(), q }), q))
      .finally(() => inflight.delete(symbol));
    inflight.set(symbol, p);
  }
  try {
    return await p;
  } catch (e) {
    if (hit) return hit.q; // serve stale on upstream failure
    throw e;
  }
}

/** Fetch many symbols with limited concurrency; failures are returned as null. */
export async function getQuotes(symbols: string[], concurrency = 6): Promise<Record<string, Quote | null>> {
  const out: Record<string, Quote | null> = {};
  let i = 0;
  const worker = async () => {
    while (i < symbols.length) {
      const s = symbols[i++];
      try {
        out[s] = await getQuote(s);
      } catch {
        out[s] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return out;
}
