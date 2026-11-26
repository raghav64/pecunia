import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "pecunia-theme";

const apply = (t: Theme) => {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  return dark;
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) || "system");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    localStorage.setItem(KEY, theme);
    setDark(apply(theme));
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(apply("system"));
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
  const toggle = () => setTheme(dark ? "light" : "dark");
  return { theme, dark, setTheme, toggle };
}
