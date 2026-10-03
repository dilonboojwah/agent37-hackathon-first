import crypto from "node:crypto";

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Format integer cents as dollars, e.g. -123456 -> "-$1,234.56". */
export function money(cents: number, currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const symbol = currency === "EUR" ? "€" : "$";
  const abs = Math.abs(cents) / 100;
  return `${sign}${symbol}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
