import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { zhCN, enUS } from "date-fns/locale";
import { readLang, saveLang, translations, translate } from "./i18n";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readLang);

  const setLang = (nextLang) => {
    const valid = nextLang === "en" ? "en" : "zh";
    setLangState(valid);
    saveLang(valid);
  };

  const t = useMemo(() => {
    return (key, params) => translate(translations, lang, key, params);
  }, [lang]);

  const dateFnsLocale = lang === "en" ? enUS : zhCN;
  const intlLocale = lang === "en" ? "en-US" : "zh-CN";

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
      document.title = t("app.title");
    }
  }, [lang, t]);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t,
      dateFnsLocale,
      intlLocale,
    }),
    [lang, t, dateFnsLocale, intlLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
