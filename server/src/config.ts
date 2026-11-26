import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA = process.env.PECUNIA_DATA ? resolve(process.env.PECUNIA_DATA) : join(ROOT, "data");
export const PORT = Number(process.env.PORT || 8787);
export const UV = process.env.UV || join(homedir(), ".local/bin/uv");
export const IS_PROD = process.env.NODE_ENV === "production";

/** Read a JSON file, re-parsing only when its mtime changes. */
const cache = new Map<string, { mtime: number; value: unknown }>();
export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const mtime = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.mtime === mtime) return hit.value as T;
  const value = JSON.parse(readFileSync(path, "utf8")) as T;
  cache.set(path, { mtime, value });
  return value;
}

export type Instrument = { name: string; sector: string; theme: string };
export const instruments = (): Record<string, Instrument> =>
  readJson<Record<string, Instrument>>(join(ROOT, "config", "instruments.json")) ?? {};

export type Settings = { theme: "light" | "dark" | "system"; watchlist: string[]; refreshSeconds: number };
const DEFAULT_SETTINGS: Settings = { theme: "system", watchlist: ["AAPL", "MSFT", "COST", "WMT"], refreshSeconds: 30 };
const SETTINGS = join(DATA, "settings.json");
export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(readJson<Partial<Settings>>(SETTINGS) ?? {}) };
}
export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  mkdirSync(DATA, { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(next, null, 1));
  return next;
}
