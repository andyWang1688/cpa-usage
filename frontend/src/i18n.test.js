import test from "node:test";
import assert from "node:assert/strict";
import { createI18n, detectLanguage, LANGUAGE_STORAGE_KEY, LANGUAGES, translate, translateServerMessage, UNKNOWN_KEY } from "./i18n.js";

const placeholders = (message) => {
  const forms = typeof message === "object" ? Object.values(message) : [message];
  // Currency messages may use either the localized name or the ISO code.
  return [...new Set(forms.flatMap((m) => [...m.matchAll(/\{(\w+)\}/g)].map(([, name]) => (name === "name" ? "code" : name))))].sort();
};

test("every language defines the same messages and placeholders", () => {
  const [base, ...others] = Object.values(LANGUAGES).map((l) => l.messages);
  for (const messages of others) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(base).sort());
    for (const key of Object.keys(base)) {
      // Plural forms may drop {count} (e.g. "Nenhum …"); compare the rest.
      const plural = typeof messages[key] === "object" || typeof base[key] === "object";
      const names = (m) => placeholders(m).filter((n) => !plural || n !== "count");
      assert.deepEqual(names(messages[key]), names(base[key]), key);
    }
  }
});

test("language follows the saved choice, then the browser", () => {
  const storage = (value) => ({ getItem: (key) => { assert.equal(key, LANGUAGE_STORAGE_KEY); return value; } });
  assert.equal(detectLanguage(storage("pt-BR"), ["zh-CN"]), "pt-BR");
  assert.equal(detectLanguage(storage("zh-CN"), ["pt-BR"]), "zh-CN");
  assert.equal(detectLanguage(storage(null), ["pt-BR", "en"]), "pt-BR");
  assert.equal(detectLanguage(storage(null), ["en-US", "pt-PT"]), "pt-BR");
  assert.equal(detectLanguage(storage("fr"), ["en-US"]), "zh-CN");
  assert.equal(detectLanguage(storage(null), ["portuguese"]), "zh-CN");
  const blocked = { getItem() { throw Error("blocked"); } };
  assert.equal(detectLanguage(blocked, ["pt"]), "pt-BR");
});

test("messages interpolate localized numbers and pick plural forms", () => {
  assert.equal(translate("zh-CN", "modelsCalled", { count: 1234 }), "1,234 个模型参与调用");
  assert.equal(translate("pt-BR", "modelsCalled", { count: 0 }), "Nenhum modelo chamado");
  assert.equal(translate("pt-BR", "modelsCalled", { count: 1 }), "1 modelo chamado");
  assert.equal(translate("pt-BR", "modelsCalled", { count: 1234 }), "1.234 modelos chamados");
  assert.equal(translate("pt-BR", "costDetail", { currency: "BRL", priced: 1, total: 1, count: 1 }), "BRL · 1 de 1 requisição com preço");
  assert.equal(translate("pt-BR", "priceVersion", { version: String(1234) }), "Versão de preço 1234");
  assert.equal(translate("pt-BR", "updatedAt", {}), "Atualizado às {time}");
  assert.equal(translate("pt-BR", "missingKey"), "missingKey");
  assert.equal(translate("xx", "refresh"), "刷新");
});

test("known server messages are translated, others pass through", () => {
  assert.equal(translateServerMessage("pt-BR", "价格表正在更新"), "A tabela de preços está sendo atualizada");
  assert.equal(translateServerMessage("pt-BR", "价格源返回 HTTP 503"), "A fonte de preços respondeu HTTP 503");
  assert.equal(translateServerMessage("pt-BR", "sqlite open: boom"), "sqlite open: boom");
  assert.equal(translateServerMessage("zh-CN", "价格表正在更新"), "价格表正在更新");
});

test("bound helpers localize labels, money, ticks and request errors", () => {
  const zh = createI18n("zh-CN"), pt = createI18n("pt-BR");
  assert.equal(zh.keyLabel(UNKNOWN_KEY), UNKNOWN_KEY);
  assert.equal(pt.keyLabel(UNKNOWN_KEY), "Chave desconhecida");
  assert.equal(pt.keyLabel("key-abc"), "key-abc");
  assert.equal(zh.money(2, "CNY", 7.2), "¥14.40");
  assert.equal(pt.money(2, "BRL", 5.5), "R$ 11,00");
  assert.equal(pt.money(null, "BRL", 5.5), "Sem preço");
  assert.equal(zh.withSymbol("CNY", "1.2K"), "¥1.2K");
  assert.equal(pt.withSymbol("BRL", "1,2 mil"), "R$ 1,2 mil");
  assert.equal(zh.percent(98.25), "98.3%");
  assert.equal(pt.percent(98.25), "98,3%");
  assert.equal(zh.bucketTick("2026-10-21 14:00", "hour"), "10-21 14:00");
  assert.equal(pt.bucketTick("2026-10-21 14:00", "hour"), "21/10 14:00");
  assert.equal(pt.bucketTick("2026-10-21", "day"), "21/10");
  assert.equal(pt.bucketTick("2026-10", "month"), "10/2026");
  const keyPrompt = Object.assign(Error("keyPrompt"), { code: "keyPrompt" });
  assert.equal(zh.errorText(keyPrompt), "请返回 CPA 管理中心重新登录并勾选“记住密码”，然后刷新本页面。");
  assert.match(pt.errorText(keyPrompt), /lembrar senha/);
  assert.equal(pt.errorText(Object.assign(Error("serviceStatus"), { code: "serviceStatus", params: { status: 502 } })), "O serviço respondeu 502");
  assert.equal(pt.errorText(Error("无效开始日期")), "Data inicial inválida");
  assert.equal(createI18n("fr").lang, "zh-CN");
});
