import test from "node:test";
import assert from "node:assert/strict";
import {
  LANG_STORAGE_KEY,
  getTranslator,
  readLang,
  saveLang,
  translate,
  translations,
} from "./i18n.js";
import { money } from "./analytics.js";

function getLeafKeys(obj, prefix = "") {
  let keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys = keys.concat(getLeafKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

test("zh and en dictionaries have matching leaf keys", () => {
  const zhKeys = getLeafKeys(translations.zh);
  const enKeys = getLeafKeys(translations.en);

  assert.deepEqual(
    zhKeys,
    enKeys,
    `Key mismatch: missing in en: ${zhKeys.filter((k) => !enKeys.includes(k)).join(", ")} | missing in zh: ${enKeys.filter((k) => !zhKeys.includes(k)).join(", ")}`,
  );
  assert.ok(zhKeys.length > 50, "Expected a comprehensive translation set");
});

test("translate interpolates parameters and falls back gracefully", () => {
  const tZh = getTranslator("zh");
  const tEn = getTranslator("en");

  // Interpolation
  assert.equal(
    tZh("filter.updatedAt", { time: "12:00:00" }),
    "更新于 12:00:00",
  );
  assert.equal(
    tEn("filter.updatedAt", { time: "12:00:00" }),
    "Updated at 12:00:00",
  );

  assert.equal(
    tZh("metrics.requestsDetail", { count: "5" }),
    "5 个模型参与调用",
  );
  assert.equal(
    tEn("metrics.requestsDetail", { count: "5" }),
    "5 models called",
  );

  // Missing param keeps placeholder
  assert.equal(tZh("filter.updatedAt"), "更新于 {{time}}");

  // Unknown key falls back to key itself
  assert.equal(tZh("unknown.key.foo"), "unknown.key.foo");
  assert.equal(tEn("unknown.key.foo"), "unknown.key.foo");

  // Partial dictionary fallback
  const mockDict = {
    zh: { greeting: "你好 {{name}}" },
    en: {},
  };
  assert.equal(translate(mockDict, "en", "greeting", { name: "Alice" }), "你好 Alice");
});

test("readLang and saveLang handle storage and navigator fallbacks safely", () => {
  let store = {};
  const mockStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
  };

  // Default when storage is empty and nav is undefined: zh
  assert.equal(readLang(mockStorage, null), "zh");

  // Browser nav lang detection
  assert.equal(readLang(mockStorage, "zh-CN"), "zh");
  assert.equal(readLang(mockStorage, "zh-TW"), "zh");
  assert.equal(readLang(mockStorage, "en-US"), "en");
  assert.equal(readLang(mockStorage, "ja-JP"), "en");

  // Persisting lang
  saveLang("en", mockStorage);
  assert.equal(store[LANG_STORAGE_KEY], "en");
  assert.equal(readLang(mockStorage, "zh-CN"), "en"); // stored preference overrides nav

  saveLang("zh", mockStorage);
  assert.equal(readLang(mockStorage, "en-US"), "zh");

  // Invalid stored value falls back to nav / zh
  store[LANG_STORAGE_KEY] = "fr";
  assert.equal(readLang(mockStorage, "en-US"), "en");
  assert.equal(readLang(mockStorage, "zh-CN"), "zh");

  // Throwing storage is caught safely
  const brokenStorage = {
    getItem: () => {
      throw new Error("Blocked");
    },
    setItem: () => {
      throw new Error("Blocked");
    },
  };
  assert.equal(readLang(brokenStorage, "en-GB"), "en");
  assert.doesNotThrow(() => saveLang("en", brokenStorage));
});

test("money formatting supports localized unpriced label", () => {
  assert.equal(money(null, "USD", 7.2, 6, "未定价"), "未定价");
  assert.equal(money(null, "USD", 7.2, 6, "Unpriced"), "Unpriced");
  assert.equal(money(undefined, "CNY", 7.2, 6, "Unpriced"), "Unpriced");
  assert.equal(money(10, "USD", 7.2, 2, "Unpriced"), "$10.00");
});
