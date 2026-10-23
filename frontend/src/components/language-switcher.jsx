import React from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "../i18n-context";

export function LanguageSwitcher({ className = "" }) {
  const { lang, setLang, t } = useI18n();
  const nextLang = lang === "zh" ? "en" : "zh";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 gap-1.5 px-2.5 text-xs font-medium transition-transform active:scale-95 ${className}`}
          aria-label={t("header.switchLangAria")}
          onClick={() => setLang(nextLang)}
        >
          <Languages className="size-3.5 text-muted-foreground" />
          <span className="hidden sm:inline">{t("header.switchLangText")}</span>
          <span className="sm:hidden">{t("header.switchLangShort")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {t("header.switchLangAria")}
      </TooltipContent>
    </Tooltip>
  );
}
