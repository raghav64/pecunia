import { Navigate, Route, Routes } from "react-router-dom";
import Rail from "./components/Rail";
import Home from "./pages/Home";
import Benchmarks from "./pages/Benchmarks";
import Compare from "./pages/Compare";
import Dips from "./pages/Dips";
import Sectors from "./pages/Sectors";
import Data from "./pages/Data";
import { useTheme } from "./lib/theme";

export const ANALYSES = [
  { slug: "benchmarks", title: "S&P 500 / Nasdaq", desc: "Same dollars, same dates", page: Benchmarks },
  { slug: "compare", title: "Compare any ticker", desc: "Shadow your deposits into any stock", page: Compare },
  { slug: "dips", title: "Dip buying", desc: "Best months & the news behind each sell-off", page: Dips },
  { slug: "sectors", title: "Re-orient", desc: "Sector picks, $X calculator, mix builder", page: Sectors },
  { slug: "data", title: "Trades & data", desc: "Every trade, method, reconciliation", page: Data },
] as const;

export default function App() {
  const theme = useTheme();
  return (
    <div className="flex min-h-full">
      <Rail theme={theme} />
      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          {ANALYSES.map(({ slug, page: Page }) => <Route key={slug} path={`/analysis/${slug}`} element={<Page />} />)}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
