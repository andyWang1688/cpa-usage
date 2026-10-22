export const fmt = (n, locale = "zh-CN") => Number(n || 0).toLocaleString(locale);
export const compact = (n, locale = "en") =>
  new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n || 0);
export const CURRENCIES = ["USD", "CNY", "BRL"];
// USD → currency rates used until the user sets their own.
export const DEFAULT_FX_RATES = { CNY: 7.2, BRL: 5.5 };
export const DEFAULT_FX_RATE = DEFAULT_FX_RATES.CNY;
export const convertUSD = (n, currency = "USD", fxRate = DEFAULT_FX_RATES[currency]) =>
  Number.isFinite(n) && currency !== "USD" ? n * fxRate : n;
const currencyFormat = (currency, locale, display, maximumFractionDigits = 6) =>
  new Intl.NumberFormat(locale, {
    style: "currency", currency: CURRENCIES.includes(currency) ? currency : "USD", currencyDisplay: display, minimumFractionDigits: 2, maximumFractionDigits,
  });
export const currencySymbol = (currency, { locale = "en-US", display = "narrowSymbol" } = {}) =>
  currencyFormat(currency, locale, display).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
export const money = (n, currency = "USD", fxRate = DEFAULT_FX_RATES[currency], maximumFractionDigits = 6, { locale = "en-US", display = "narrowSymbol", unpriced = "未定价" } = {}) => {
  if (!Number.isFinite(n)) return unpriced;
  const value = convertUSD(n, currency, fxRate);
  if (value > 0 && value < 0.000001) return `< ${currencyFormat(currency, locale, display).format(0.000001)}`;
  return currencyFormat(currency, locale, display, maximumFractionDigits).format(value);
};
export const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function summarize(events) {
  return events.reduce(
    (s, e) => ({
      n: s.n + 1,
      input: s.input + e.input,
      output: s.output + e.output,
      cache: s.cache + e.cache,
      reasoning: s.reasoning + e.reasoning,
      fail: s.fail + Number(e.failed),
      cost: s.cost + (Number.isFinite(e.cost) ? e.cost : 0),
      priced: s.priced + Number(Number.isFinite(e.cost)),
      unpriced: s.unpriced + Number(!Number.isFinite(e.cost)),
      historical: s.historical + Number(e.price_basis === "historical_estimate"),
    }),
    { n: 0, input: 0, output: 0, cache: 0, reasoning: 0, fail: 0, cost: 0, priced: 0, unpriced: 0, historical: 0 },
  );
}
export function groups(events, key) {
  const m = new Map();
  for (const e of events) {
    if (!m.has(e[key])) m.set(e[key], []);
    m.get(e[key]).push(e);
  }
  return [...m]
    .map(([name, evs]) => ({ name, ...summarize(evs) }))
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}
export function trend(events, bucket) {
  const map = new Map();
  for (const e of events) {
    const d = new Date(e.ts * 1000),
      label =
        bucket === "month"
          ? dateKey(d).slice(0, 7)
          : bucket === "hour"
            ? `${dateKey(d)} ${String(d.getHours()).padStart(2, "0")}:00`
            : dateKey(d);
    if (!map.has(label))
      map.set(label, { label, cache: 0, net: 0, output: 0, requests: 0, cost: null, unpriced: 0 });
    const b = map.get(label);
    b.cache += e.cache;
    b.net += Math.max(0, e.input - e.cache);
    b.output += e.output;
    b.requests++;
    if (Number.isFinite(e.cost)) b.cost = (b.cost ?? 0) + e.cost;
    else b.unpriced++;
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}
