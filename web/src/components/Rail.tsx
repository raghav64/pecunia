import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChartLine, Compass, House, Menu, Moon, RefreshCw, Search, Sun, Table2, TrendingDown, type LucideIcon } from "lucide-react";
import { ANALYSES } from "../App";
import RefreshPanel from "./RefreshPanel";
import type { useTheme } from "../lib/theme";

const ICONS: Record<string, LucideIcon> = { benchmarks: ChartLine, compare: Search, dips: TrendingDown, sectors: Compass, data: Table2 };

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid size-11 place-items-center rounded-xl transition-colors ${active ? "bg-raised text-tx" : "text-tx-2 hover:bg-raised/60 hover:text-tx"}`}
    >
      {children}
    </button>
  );
}

export default function Rail({ theme, onRefreshed }: { theme: ReturnType<typeof useTheme>; onRefreshed: () => void }) {
  const [menu, setMenu] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const loc = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <aside ref={ref} className="sticky top-0 z-30 flex h-screen w-[72px] flex-none flex-col items-center gap-1.5 border-r border-line bg-rail py-5">
      <NavLink to="/" title="Pecunia" className="mb-3">
        <img src="/favicon.png" alt="pecunia" className="size-9 rounded-lg" />
      </NavLink>
      <NavLink to="/" end>{({ isActive }) => <RailButton label="Home" active={isActive}><House size={20} /></RailButton>}</NavLink>
      <RailButton label="Analysis menu" active={menu} onClick={() => setMenu((m) => !m)}><Menu size={20} /></RailButton>
      <div className="my-1 h-px w-7 bg-line" />
      {ANALYSES.map((a) => {
        const Icon = ICONS[a.slug];
        return (
          <NavLink key={a.slug} to={`/analysis/${a.slug}`}>
            {({ isActive }) => <RailButton label={a.title} active={isActive}><Icon size={20} /></RailButton>}
          </NavLink>
        );
      })}
      <div className="flex-1" />
      <RailButton label="Refresh data" active={refresh} onClick={() => setRefresh((r) => !r)}><RefreshCw size={20} /></RailButton>
      <RailButton label={theme.dark ? "Light theme" : "Dark theme"} onClick={theme.toggle}>
        {theme.dark ? <Sun size={20} /> : <Moon size={20} />}
      </RailButton>

      {menu && (
        <div className="absolute left-[84px] top-24 w-[340px] rounded-2xl border border-line-strong bg-card p-2 shadow-2xl shadow-black/30">
          <div className="num px-3 pb-2 pt-1 text-[10px] font-medium tracking-wider text-tx-3">ANALYSIS</div>
          {ANALYSES.map((a) => {
            const Icon = ICONS[a.slug];
            return (
              <NavLink key={a.slug} to={`/analysis/${a.slug}`}
                className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 ${isActive ? "bg-raised" : "hover:bg-raised/60"}`}>
                <span className="grid size-[34px] place-items-center rounded-lg bg-orange/15 text-orange"><Icon size={18} /></span>
                <span>
                  <span className="block text-[13px] font-medium">{a.title}</span>
                  <span className="block text-xs text-tx-2">{a.desc}</span>
                </span>
              </NavLink>
            );
          })}
        </div>
      )}
      {refresh && <RefreshPanel onClose={() => setRefresh(false)} onDone={onRefreshed} />}
    </aside>
  );
}
