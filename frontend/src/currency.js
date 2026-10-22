import { convertUSD, CURRENCIES, DEFAULT_FX_RATES } from "./analytics.js";

export const CURRENCY_STORAGE_KEY = "cpa-usage-currency";
export const validFxRate = (n) => Number.isFinite(n) && n > 0;
export const fxRateFor = ({ currency, fxRates }) => (currency === "USD" ? 1 : fxRates[currency]);
export function readCurrencySettings(storage) {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(CURRENCY_STORAGE_KEY));
    const fxRates = { ...DEFAULT_FX_RATES };
    // 0.4.0 stored a single USD → CNY rate as `fxRate`.
    if (validFxRate(saved?.fxRate)) fxRates.CNY = saved.fxRate;
    for (const code of Object.keys(fxRates)) {
      if (validFxRate(saved?.fxRates?.[code])) fxRates[code] = saved.fxRates[code];
    }
    return { currency: CURRENCIES.includes(saved?.currency) ? saved.currency : "USD", fxRates };
  } catch {
    return { currency: "USD", fxRates: { ...DEFAULT_FX_RATES } };
  }
}
export function saveCurrencySettings(settings, storage) {
  try { (storage ?? localStorage).setItem(CURRENCY_STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

export function priceInUSD(value, original, currency, fxRate) {
  if (value === "") return null;
  const n = Number(value);
  // Preserve exact USD rates when a converted field was left unchanged.
  if (n === convertUSD(original, currency, fxRate)) return original;
  return currency === "USD" ? n : n / fxRate;
}
