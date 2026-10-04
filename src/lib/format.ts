const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export function money(n: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const s = (opts.whole ? usdWhole : usd).format(Math.abs(n));
  if (n < 0) return `−${s}`;
  return opts.sign && n > 0 ? `+${s}` : s;
}

export function moneyCompact(n: number): string {
  return n < 0 ? `−${compact.format(-n)}` : compact.format(n);
}

export function percentChange(from: number, to: number): string | null {
  if (from === 0) return null;
  const pct = ((to - from) / Math.abs(from)) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}
