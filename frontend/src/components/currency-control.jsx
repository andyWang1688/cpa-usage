import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/segmented-control";
import { CURRENCIES } from "../analytics";
import { validFxRate } from "../currency";
import { useI18n } from "../i18n-context";

export function CurrencyControl({ value, onChange }) {
  const { t, number, localCurrency } = useI18n();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [error, setError] = useState("");
  // While USD is shown, the rate button edits the language's local currency.
  const rateCurrency = value.currency === "USD" ? localCurrency : value.currency;
  const fxRate = value.fxRates[rateCurrency];
  const names = { name: t(`currencyName.${rateCurrency}`), code: rateCurrency };
  return <div className="flex flex-wrap items-center gap-2">
    <SegmentedControl ariaLabel={t("displayCurrency")} value={value.currency}
      onChange={(currency) => onChange({ ...value, currency })}
      items={CURRENCIES.map((code) => ({ label: t(`currencyOption.${code}`), value: code }))} />
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setDraft(String(fxRate)); setError(""); }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("editFxRate", names)}>
          1 USD = {number(fxRate, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} {rateCurrency}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <form className="space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault();
          const next = Number(draft);
          if (!validFxRate(next)) { setError(t("fxRateInvalid")); return; }
          onChange({ ...value, fxRates: { ...value.fxRates, [rateCurrency]: next } }); setOpen(false);
        }}>
          <label className="space-y-2 text-sm font-medium">
            <span>{t("fxRateLabel", names)}</span>
            <Input aria-label={t("fxRateInput", names)} type="number" step="any" min="0" value={draft}
              aria-invalid={!!error} onChange={(e) => { setDraft(e.target.value); setError(""); }} />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("fxRateNote")}</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="w-full">{t("saveFxRate")}</Button>
        </form>
      </PopoverContent>
    </Popover>
  </div>;
}
