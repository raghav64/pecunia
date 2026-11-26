const nf = (d: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const money = (v: number, d = 0) => (v < 0 ? "−$" : "$") + nf(d).format(Math.abs(v));
export const signedMoney = (v: number, d = 0) => (v >= 0 ? "+" : "−") + "$" + nf(d).format(Math.abs(v));
export const pct = (v: number, d = 1) => (v >= 0 ? "+" : "−") + nf(d).format(Math.abs(v * 100)) + "%";
export const plainPct = (v: number, d = 1) => nf(d).format(v * 100) + "%";
export const tone = (v: number) => (v >= 0 ? "text-pos" : "text-neg");

export const shortDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
export const longDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
