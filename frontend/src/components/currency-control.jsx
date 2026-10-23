import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/segmented-control";
import { validFxRate } from "../currency";
import { useI18n } from "../i18n-context";

export function CurrencyControl({ value, onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [error, setError] = useState("");
  return <div className="flex flex-wrap items-center gap-2">
    <SegmentedControl ariaLabel={t("currency.controlAria")} value={value.currency}
      onChange={(currency) => onChange({ ...value, currency })}
      items={[{ label: t("currency.usdLabel"), value: "USD" }, { label: t("currency.cnyLabel"), value: "CNY" }]} />
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setDraft(String(value.fxRate)); setError(""); }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("currency.editRateAria")}>
          1 USD = {value.fxRate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })} CNY
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <form className="space-y-3" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fxRate = Number(draft);
          if (!validFxRate(fxRate)) { setError(t("currency.error")); return; }
          onChange({ ...value, fxRate }); setOpen(false);
        }}>
          <label className="space-y-2 text-sm font-medium">
            <span>{t("currency.rateLabel")}</span>
            <Input aria-label={t("currency.inputAria")} type="number" step="any" min="0" value={draft}
              aria-invalid={!!error} onChange={(e) => { setDraft(e.target.value); setError(""); }} />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("currency.hint")}</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" className="w-full">{t("currency.save")}</Button>
        </form>
      </PopoverContent>
    </Popover>
  </div>;
}
