import type { ReactNode } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-raised ${className}`} />;
}

export function Kpi({ label, value, sub, tone = "", hero = false }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; hero?: boolean }) {
  return (
    <div className={`card px-4 py-3.5 ${hero ? "border-orange/40 bg-orange/[0.06]" : ""}`}>
      <div className="text-xs text-tx-2">{label}</div>
      <div className={`num mt-1 text-[22px] font-medium leading-tight ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-tx-2">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-raised/70 p-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`rounded-full font-medium transition-colors ${size === "sm" ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-[13px]"} ${v === value ? "bg-sel text-sel-tx" : "text-tx-2 hover:text-tx"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, sub, right, children, className = "" }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card px-6 py-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 max-w-3xl text-[13px] text-tx-2">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export const LegendItem = ({ color, label, dash }: { color: string; label: string; dash?: "dashed" | "dotted" }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block w-3.5" style={dash ? { borderTop: `2px ${dash} ${color}` } : { height: 3, background: color }} />
    {label}
  </span>
);

/** Shared recharts axis styling */
export const axisTick = { fill: "var(--tx-3)", fontSize: 11, fontFamily: "JetBrains Mono" };
