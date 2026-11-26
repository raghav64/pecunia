import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Rail from "./components/Rail";
import Home from "./pages/Home";
import Legacy from "./pages/Legacy";
import Benchmarks from "./pages/Benchmarks";
import { useTheme } from "./lib/theme";

export const ANALYSES = [
  { slug: "benchmarks", title: "S&P 500 / Nasdaq", desc: "Same dollars, same dates", legacy: "benchmarks" },
  { slug: "compare", title: "Compare any ticker", desc: "Shadow your deposits into any stock", legacy: "compare" },
  { slug: "dips", title: "Dip buying", desc: "Best months & the news behind each sell-off", legacy: "dips" },
  { slug: "sectors", title: "Re-orient", desc: "Sector picks, $X calculator, mix builder", legacy: "sectors" },
  { slug: "data", title: "Trades & data", desc: "Every trade, method, reconciliation", legacy: "data" },
] as const;

export default function App() {
  const theme = useTheme();
  const [reloadKey, setReloadKey] = useState(0); // bumps after a refresh so embedded pages reload
  return (
    <div className="flex min-h-full">
      <Rail theme={theme} onRefreshed={() => setReloadKey((k) => k + 1)} />
      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/analysis/benchmarks" element={<Benchmarks />} />
          {ANALYSES.filter((a) => a.slug !== "benchmarks").map((a) => (
            <Route key={a.slug} path={`/analysis/${a.slug}`} element={<Legacy page={a.legacy} reloadKey={reloadKey} dark={theme.dark} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
