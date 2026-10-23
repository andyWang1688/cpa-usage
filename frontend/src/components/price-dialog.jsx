import { useState } from "react";
import { DollarSign, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { convertUSD } from "../analytics";
import { priceInUSD } from "../currency";
import { useI18n } from "../i18n-context";

const rowKey = (row) => JSON.stringify([row.provider, row.model]);
const rate = (n, currency) => n == null ? "—" : `${currency === "CNY" ? "¥" : "$"}${n.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;

export function PriceDialog({ request, onSaved, currency, fxRate }) {
  const { t, intlLocale } = useI18n();
  const fields = [
    ["input", t("pricingDialog.fieldInput")],
    ["cache_read", t("pricingDialog.fieldCacheRead")],
    ["cache_write", t("pricingDialog.fieldCacheWrite")],
    ["output", t("pricingDialog.fieldOutput")],
  ];
  const priceUnit = (cur) => t("pricingDialog.unitText", { currency: cur === "CNY" ? t("pricingDialog.currencyCny") : t("pricingDialog.currencyUsd") });

  const [open, setOpen] = useState(false), [data, setData] = useState(null),
    [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [query, setQuery] = useState(""), [editing, setEditing] = useState(null),
    [draft, setDraft] = useState({});
  async function run(action) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const load = async () => setData(await request("/pricing"));
  async function save(row, price) {
    await run(async () => {
      setData(await request("/pricing", { method: "POST", body: JSON.stringify({ model: row.model, provider: row.provider, price }) }));
      setEditing(null);
      await onSaved();
    });
  }
  const rows = (data?.models || []).filter((row) => `${row.model} ${row.provider}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={(value) => {
      setOpen(value);
      if (value) { setEditing(null); run(load); }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><DollarSign className="size-4" /><span className="hidden sm:inline">{t("pricingDialog.button")}</span><span className="sr-only sm:hidden">{t("pricingDialog.button")}</span></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("pricingDialog.title")}</DialogTitle>
          <DialogDescription>{t("pricingDialog.desc", { unit: priceUnit(currency), fxRate: currency === "CNY" ? t("pricingDialog.fxRateDesc", { fxRate }) : "" })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("pricingDialog.source")} <a className="underline underline-offset-4" href="https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json" target="_blank" rel="noreferrer">LiteLLM</a>
            {data && ` · ${t("pricingDialog.version")} ${data.version} · ${t("pricingDialog.lastChecked")} ${new Date(data.checked_at * 1000).toLocaleString(intlLocale)}`}
          </p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { setData(await request("/pricing/refresh", { method: "POST" })); await onSaved(); })}>
            <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />{busy ? t("pricingDialog.updating") : t("pricingDialog.update")}
          </Button>
        </div>
        {(error || data?.update_error) && <p role="alert" className="text-sm text-destructive">{error || data.update_error}</p>}
        <Input aria-label={t("pricingDialog.searchAria")} placeholder={t("pricingDialog.searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="max-h-[42dvh] overflow-auto rounded-md border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("pricingDialog.thModelProvider")}</TableHead>
              {fields.map(([key, label]) => <TableHead key={key} className="py-2 text-right whitespace-nowrap">{label}<span className="mt-1 block text-[10px] font-normal text-muted-foreground">{priceUnit(currency)}</span></TableHead>)}
              <TableHead className="text-right">{t("pricingDialog.thActions")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((row) => <TableRow key={rowKey(row)}>
                <TableCell className="max-w-56">
                  <div className="truncate font-medium" title={row.model}>{row.model}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {row.provider || t("pricingDialog.unknownProvider")}
                    <Badge variant="outline" className="text-[10px]">{row.custom ? t("pricingDialog.badgeCustom") : row.price ? t("pricingDialog.badgePublic") : t("pricingDialog.badgeUnpriced")}</Badge>
                    {!!row.price?.tiers?.length && <span>{t("pricingDialog.hasTiers")}</span>}
                  </div>
                </TableCell>
                {fields.map(([key]) => <TableCell className="text-right tabular-nums whitespace-nowrap" key={key}>{rate(convertUSD(row.price?.[key], currency, fxRate), currency)}</TableCell>)}
                <TableCell><div className="flex justify-end">
                  <Button size="icon" variant="ghost" aria-label={t("pricingDialog.ariaEdit", { model: row.model, provider: row.provider || t("pricingDialog.unknownProvider") })} disabled={busy} onClick={() => { setEditing({ ...row, currency, fxRate }); setDraft(Object.fromEntries(fields.map(([key]) => [key, convertUSD(row.price?.[key], currency, fxRate) ?? ""]))); setError(""); }}><Pencil className="size-3.5" /></Button>
                  {row.custom && <Button size="icon" variant="ghost" aria-label={t("pricingDialog.ariaRestore", { model: row.model, provider: row.provider || t("pricingDialog.unknownProvider") })} disabled={busy} onClick={() => save(row, null)}><RotateCcw className="size-3.5" /></Button>}
                </div></TableCell>
              </TableRow>)}
              {!rows.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">{busy ? t("pricingDialog.loading") : data ? t("pricingDialog.noMatches") : t("pricingDialog.notLoaded")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        {editing && <form className="space-y-3 rounded-md border bg-muted/30 p-4" onSubmit={(e) => {
          e.preventDefault();
          save(editing, Object.fromEntries(fields.map(([key]) => [key, priceInUSD(draft[key], editing.price?.[key], editing.currency, editing.fxRate)])));
        }}>
          <p className="break-all text-sm font-medium">{t("pricingDialog.customTitle", { model: editing.model, provider: editing.provider || t("pricingDialog.unknownProvider") })}</p>
          <p className="text-xs text-muted-foreground">{t("pricingDialog.customHint", { unit: priceUnit(editing.currency), convertNote: editing.currency === "CNY" ? t("pricingDialog.convertNote", { fxRate: editing.fxRate }) : "" })}</p>
          {!!editing.price?.tiers?.length && <p className="text-xs text-muted-foreground">{t("pricingDialog.tiersOverride")}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fields.map(([key, label]) => <label key={key} className="space-y-1.5 text-xs text-muted-foreground">
              <span className="block">{label}<span className="mt-1 block text-[10px]">{priceUnit(editing.currency)}</span></span>
              <Input aria-label={t("pricingDialog.unitPriceAria", { label, unit: priceUnit(editing.currency) })} type="number" min="0" step="any" required={key === "input" || key === "output"} placeholder={t("pricingDialog.badgeUnpriced")} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
            </label>)}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>{t("pricingDialog.cancel")}</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? t("pricingDialog.saving") : t("pricingDialog.save")}</Button>
          </div>
        </form>}
        <p className="text-xs leading-relaxed text-muted-foreground">{t("pricingDialog.disclaimer")}</p>
      </DialogContent>
    </Dialog>
  );
}
