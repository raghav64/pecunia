import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../lib/api";

type Job = { id: string; status: "running" | "done" | "error"; step: number; steps: number; label: string; log: string[]; started: number; finished: number | null };

export default function RefreshPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // resume if a job is already running
  useEffect(() => {
    api<Job | { status: "idle" }>("/api/refresh").then((j) => { if (j.status === "running") follow((j as Job).id); }).catch(() => {});
  }, []);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [job?.log.length]);

  function follow(id: string) {
    const es = new EventSource(`/api/refresh/${id}/events`);
    const on = (e: MessageEvent) => {
      const j = JSON.parse(e.data) as Job;
      setJob(j);
      if (j.status !== "running") {
        es.close();
        if (j.status === "done") { qc.invalidateQueries(); onDone(); }
      }
    };
    ["progress", "done", "error"].forEach((t) => es.addEventListener(t, on as EventListener));
  }

  async function start(mode: "full" | "prices") {
    setErr(null);
    try {
      const r = await api<{ jobId: string }>("/api/refresh", { method: "POST", body: JSON.stringify({ mode }) });
      follow(r.jobId);
    } catch (e: any) { setErr(e.message); }
  }

  const pct = job?.steps ? Math.round(((job.status === "done" ? job.steps : job.step - 0.5) / job.steps) * 100) : 4;
  const secs = job ? Math.round(((job.finished ?? Date.now()) - job.started) / 1000) : 0;

  return (
    <div className="absolute bottom-16 left-[84px] w-[380px] rounded-2xl border border-line-strong bg-card p-4 text-sm shadow-2xl shadow-black/30">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-semibold">{!job ? "Refresh data" : job.status === "running" ? `Refreshing… ${secs}s` : job.status === "done" ? `✓ Updated in ${secs}s` : "Refresh failed"}</h4>
        <button onClick={onClose} className="text-tx-3 hover:text-tx" aria-label="Close"><X size={16} /></button>
      </div>
      {!job && (
        <div className="space-y-2">
          {([["full", "Full refresh", "New trades + positions from Webull (read-only), fresh prices, rebuild every analysis. ~2 min."],
             ["prices", "Prices only", "Skip Webull; re-pull prices and rebuild from saved trades."]] as const).map(([m, t, d]) => (
            <button key={m} onClick={() => start(m)} className="block w-full rounded-xl border border-line px-3 py-2.5 text-left hover:border-orange hover:bg-raised/50">
              <b className="block text-[13px]">{t}</b><span className="text-xs text-tx-2">{d}</span>
            </button>
          ))}
          {err && <p className="text-xs text-neg">{err}</p>}
        </div>
      )}
      {job && (
        <>
          <p className="text-xs text-tx-2">{job.status === "error" ? "The previous data is kept. If Webull login failed, try Prices only." : `Step ${job.step || 1} of ${job.steps || "?"}: ${job.label}`}</p>
          <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full bg-orange transition-all" style={{ width: `${pct}%` }} /></div>
          <pre ref={logRef} className="num max-h-36 overflow-auto rounded-lg bg-page p-2 text-[10.5px] leading-snug text-tx-2">{job.log.join("\n")}</pre>
          {job.status === "error" && <button onClick={() => { setJob(null); start("prices"); }} className="mt-2 text-xs font-medium text-orange">Retry with prices only →</button>}
        </>
      )}
    </div>
  );
}
