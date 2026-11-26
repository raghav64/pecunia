import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type Quote = {
  symbol: string; name: string; price: number; prevClose: number; change: number; changePct: number;
  spark: number[]; time: number; marketState: "open" | "closed";
};
export type Summary = {
  value: number; cash: number; marketValue: number; dayChange: number; dayChangePct: number; unrealizedPnl: number;
  positionsAsOf: string; pricesAsOf: number | null; marketState: "open" | "closed"; count: number;
  benchmark: null | {
    asOf: string; you: number; spy: number; qqq: number; lead: number; irr: number; irrSpy: number;
    twr: number; twrSpy: number; dd: number; ddSpy: number; netInvested: number;
  };
};
export type Position = {
  symbol: string; name: string; sector: string; qty: number; avgCost: number; price: number; prevClose: number;
  value: number; dayChange: number; dayPct: number; weight: number; gain: number; gainPct: number; live: boolean;
};
export type Positions = { positions: Position[]; cash: number; asOf: string; allocation: { sector: string; value: number; weight: number }[] };
export type HistoryPoint = { d: string; value: number; invested: number; spy: number; qqq: number };
export type Settings = { theme: "light" | "dark" | "system"; watchlist: string[]; refreshSeconds: number };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", "X-Pecunia": "1", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings"), staleTime: Infinity });
export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("/api/portfolio/summary") });
export const usePositions = () => useQuery({ queryKey: ["positions"], queryFn: () => api<Positions>("/api/positions"), refetchInterval: 60_000 });
export const useHistory = (range: string) =>
  useQuery({ queryKey: ["history", range], queryFn: () => api<HistoryPoint[]>(`/api/portfolio/history?range=${range}`), staleTime: 5 * 60_000 });
export const useQuotes = (symbols: string[]) =>
  useQuery({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: () => api<Record<string, Quote | null>>(`/api/quotes?symbols=${symbols.join(",")}`),
    enabled: symbols.length > 0,
  });

/** Subscribes to /api/stream and writes pushed data straight into the query cache. */
export function useLiveStream(watch: string[]) {
  const qc = useQueryClient();
  const key = watch.join(",");
  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("portfolio", (e) => qc.setQueryData(["summary"], JSON.parse((e as MessageEvent).data)));
    es.addEventListener("quotes", (e) => {
      const all = JSON.parse((e as MessageEvent).data) as Record<string, Quote | null>;
      qc.setQueryData(["quotes", key], (old: Record<string, Quote | null> | undefined) => ({ ...old, ...all }));
    });
    return () => es.close();
  }, [qc, key]);
}
