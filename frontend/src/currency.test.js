import test from "node:test";
import assert from "node:assert/strict";
import { convertUSD, DEFAULT_FX_RATE, groups, money, summarize, trend } from "./analytics.js";
import { CURRENCY_STORAGE_KEY, fxRateFor, priceInUSD, readCurrencySettings, saveCurrencySettings, validFxRate } from "./currency.js";
import { DEFAULT_FX_RATES } from "./analytics.js";

test("USD and CNY formatting preserve free and unpriced amounts", () => {
  assert.equal(money(2), "$2.00");
  assert.equal(money(2, "CNY"), "¥14.40");
  assert.equal(money(2, "CNY", 7.5), "¥15.00");
  assert.equal(money(0, "CNY"), "¥0.00");
  assert.equal(money(null, "CNY"), "未定价");
  assert.equal(money(undefined, "CNY"), "未定价");
  assert.equal(money(0.00000001, "CNY"), "< ¥0.000001");
  assert.equal(money(0.0000005, "CNY"), "¥0.000004");
  assert.equal(convertUSD(null, "CNY"), null);
  assert.equal(convertUSD(0, "CNY"), 0);
  assert.equal(money(150, "CNY", 7.2, 2), "¥1,080.00");
});

test("card, grouped details and trend convert the same canonical USD total", () => {
  const events = [1.25, 0.75, null].map((cost) => ({
    ts: 1770000000, model: "m", input: 100, cache: 20, output: 10, reasoning: 0, failed: false, cost,
  }));
  const total = summarize(events), grouped = groups(events, "model")[0], bucket = trend(events, "day")[0];
  assert.equal(convertUSD(total.cost, "CNY", 7.5), 15);
  assert.equal(convertUSD(grouped.cost, "CNY", 7.5), 15);
  assert.equal(convertUSD(bucket.cost, "CNY", 7.5), 15);
  assert.equal(total.unpriced, 1);
  assert.equal(total.cost, 2);
  assert.deepEqual(events.map((e) => e.cost), [1.25, 0.75, null]);
});

test("settings persist and invalid saved settings safely fall back", () => {
  let saved = null;
  const storage = {
    getItem: (key) => { assert.equal(key, CURRENCY_STORAGE_KEY); return saved; },
    setItem: (key, value) => { assert.equal(key, CURRENCY_STORAGE_KEY); saved = value; },
  };
  const defaults = { currency: "USD", fxRates: { CNY: DEFAULT_FX_RATE, BRL: DEFAULT_FX_RATES.BRL } };
  assert.deepEqual(readCurrencySettings(storage), defaults);
  saveCurrencySettings({ currency: "BRL", fxRates: { CNY: 7.38, BRL: 5.31 } }, storage);
  assert.deepEqual(readCurrencySettings(storage), { currency: "BRL", fxRates: { CNY: 7.38, BRL: 5.31 } });
  for (const fxRate of [0, -1, null, "7.2", "Infinity"]) {
    saved = JSON.stringify({ currency: "CNY", fxRates: { CNY: fxRate, BRL: fxRate } });
    assert.deepEqual(readCurrencySettings(storage), { ...defaults, currency: "CNY" });
  }
  saved = JSON.stringify({ currency: "EUR", fxRates: { CNY: 7.2 } });
  assert.equal(readCurrencySettings(storage).currency, "USD");
  saved = "{broken";
  assert.deepEqual(readCurrencySettings(storage), defaults);
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.deepEqual(readCurrencySettings(blocked), defaults);
  assert.doesNotThrow(() => saveCurrencySettings({ currency: "CNY", fxRates: { CNY: 7.5, BRL: 5.5 } }, blocked));
});

test("0.4.0 settings keep their CNY rate", () => {
  const storage = { getItem: () => JSON.stringify({ currency: "CNY", fxRate: 7.38 }) };
  assert.deepEqual(readCurrencySettings(storage), { currency: "CNY", fxRates: { CNY: 7.38, BRL: DEFAULT_FX_RATES.BRL } });
  assert.equal(fxRateFor(readCurrencySettings(storage)), 7.38);
  assert.equal(fxRateFor({ currency: "USD", fxRates: { CNY: 7.38 } }), 1);
});

test("only finite positive exchange rates are accepted", () => {
  for (const invalid of [0, -7.2, Infinity, -Infinity, NaN, null, "7.2"]) assert.equal(validFxRate(invalid), false);
  assert.equal(validFxRate(7.2), true);
  assert.equal(validFxRate(0.001), true);
});

test("CNY price edits save USD, preserve untouched precision, and distinguish blanks from zero", () => {
  assert.equal(priceInUSD("15", 1, "CNY", 7.5), 2);
  assert.equal(priceInUSD("2", 1, "USD", 7.5), 2);
  assert.equal(priceInUSD("", 1, "CNY", 7.5), null);
  assert.equal(priceInUSD("0", null, "CNY", 7.5), 0);
  for (const original of [0, 0.123456789123, 1.25, 15]) {
    assert.equal(priceInUSD(String(convertUSD(original, "CNY", 7.38)), original, "CNY", 7.38), original);
  }
});

test("BRL converts with its own rate and saves edits in USD", () => {
  assert.equal(convertUSD(2, "BRL", 5.5), 11);
  assert.equal(convertUSD(null, "BRL", 5.5), null);
  assert.equal(money(2, "BRL", 5.5), "R$11.00");
  assert.equal(money(2, "BRL", 5.5, 6, { locale: "pt-BR", display: "symbol" }), "R$\u00a011,00");
  assert.equal(money(2, "USD", 1, 6, { locale: "pt-BR", display: "symbol" }), "US$\u00a02,00");
  assert.equal(money(null, "BRL", 5.5, 6, { unpriced: "Sem preço" }), "Sem preço");
  assert.equal(money(0.00000001, "BRL", 5.5, 6, { locale: "pt-BR", display: "symbol" }), "< R$\u00a00,000001");
  assert.equal(priceInUSD("11", 1, "BRL", 5.5), 2);
  assert.equal(priceInUSD(String(convertUSD(0.123456789, "BRL", 5.31)), 0.123456789, "BRL", 5.31), 0.123456789);
});
