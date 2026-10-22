import { createContext, useContext } from "react";
import { createI18n, DEFAULT_LANGUAGE } from "./i18n.js";

export const I18nContext = createContext(createI18n(DEFAULT_LANGUAGE));
export const useI18n = () => useContext(I18nContext);
