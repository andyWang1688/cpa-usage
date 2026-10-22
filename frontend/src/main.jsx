import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownUp,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  KeyRound,
  Languages,
  Layers,
  Moon,
  RefreshCw,
  Search,
  Sun,
  UserRound,
  WifiOff,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/segmented-control";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { PriceDialog } from "@/components/price-dialog";
import { CurrencyControl } from "@/components/currency-control";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { convertUSD, dateKey, groups, summarize, trend } from "./analytics";
import { fxRateFor, readCurrencySettings, saveCurrencySettings } from "./currency";
import { createI18n, detectLanguage, LANGUAGES, saveLanguage, UNKNOWN_KEY } from "./i18n";
import { I18nContext, useI18n } from "./i18n-context";
import "./index.css";

const initialRange = () => {
  const today = new Date();
  return { from: today, to: today };
};
function Help({ children }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-muted-foreground"
          aria-label={t("metricHelp")}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}
function useCountUp(target, duration = 550) {
  const [value, setValue] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function Metric({ label, value, raw, format, detail, help, loading, className = "" }) {
  const animated = useCountUp(typeof raw === "number" ? raw : 0);
  const display =
    typeof raw === "number" && format ? format(animated) : value;
  return (
    <Card className={`gap-3 shadow-none ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardDescription>{label}</CardDescription>
        <Help>{help}</Help>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-28" />
        ) : (
          <div
            className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums"
            title={String(value)}
          >
            {display}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
const API_BASE = "/v0/management/plugins/usage-report/api";
// Errors raised here carry an i18n message key; see errorText in i18n.js.
const requestError = (code, params) => Object.assign(Error(code), { code, params });

function xorBytes(bytes, keyBytes) {
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    output[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return output;
}

// Read the CPA management panel session from same-origin localStorage,
// following the secure-storage format used across the CPA plugin ecosystem.
function decodeCPAStorage(raw) {
  if (!raw) return null;
  const prefix = "enc::v1::";
  let text = raw;
  if (text.startsWith(prefix)) {
    const binary = atob(text.slice(prefix.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const storageKey = `cli-proxy-api-webui::secure-storage|${location.host}|${navigator.userAgent}`;
    text = new TextDecoder().decode(
      xorBytes(bytes, new TextEncoder().encode(storageKey)),
    );
  }
  return JSON.parse(text);
}

function readManagementKey() {
  try {
    const parsed = decodeCPAStorage(localStorage.getItem("cli-proxy-auth"));
    const state = parsed && parsed.state ? parsed.state : parsed;
    const value = state && state.managementKey;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}
async function request(path, options = {}) {
  const key = readManagementKey();
  if (!key) throw requestError("keyPrompt");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (response.status === 401 || response.status === 403) throw requestError("keyPrompt");
  const data = await response.json();
  if (data.error) throw Error(data.error);
  if (!response.ok) throw requestError("serviceStatus", { status: response.status });
  return data;
}

function App() {
  const [range, setRange] = useState(initialRange),
    [draft, setDraft] = useState(initialRange),
    [calendarOpen, setCalendarOpen] = useState(false),
    [bucket, setBucket] = useState("hour"),
    [chartMetric, setChartMetric] = useState("tokens"),
    [currencySettings, setCurrencySettings] = useState(readCurrencySettings),
    [model, setModel] = useState("all"),
    [data, setData] = useState(null),
    [error, setError] = useState(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("model"),
    [page, setPage] = useState(0),
    [sort, setSort] = useState("tokens"),
    [dark, setDark] = useState(
      () => localStorage.getItem("cpa-usage-theme") === "dark",
    ),
    [lang, setLang] = useState(detectLanguage);
  const i18n = useMemo(() => createI18n(lang), [lang]);
  const { t, fmt, compact, money, percent, keyLabel, errorText, withSymbol, bucketTick, formats } = i18n;
  const chartConfig = {
    cache: { label: t("chartCache"), color: "var(--chart-1)" },
    net: { label: t("chartNet"), color: "var(--chart-2)" },
    output: { label: t("chartOutput"), color: "var(--chart-3)" },
  };
  const costChartConfig = { cost: { label: t("estimatedCost"), color: "var(--chart-3)" } };
  const generation = useRef(0);
  const { currency } = currencySettings;
  const fxRate = fxRateFor(currencySettings);
  const displayMoney = (n) => money(n, currency, fxRate);
  useEffect(() => saveCurrencySettings(currencySettings), [currencySettings]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("cpa-usage-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t("documentTitle");
  }, [lang]);
  async function load() {
    const id = ++generation.current;
    setBusy(true);
    try {
      const d = await request(`/usage?start=${dateKey(range.from)}&end=${dateKey(range.to)}&bucket=${bucket}`);
      if (id === generation.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (id === generation.current) setError(e);
    } finally {
      if (id === generation.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 60000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [range, bucket]);
  const events = useMemo(
    () =>
      (data?.events || [])
        .filter((e) => model === "all" || e.model === model)
        // Requests recorded before client keys were stored have none.
        .map((e) => (e.client ? e : { ...e, client: UNKNOWN_KEY })),
    [data, model],
  );
  const stats = useMemo(() => summarize(events), [events]),
    buckets = useMemo(() => trend(events, bucket), [events, bucket]);
  const costBuckets = useMemo(() => buckets.map((b) => ({
    ...b, cost: convertUSD(b.cost, currency, fxRate),
  })), [buckets, currency, fxRate]);
  const modelNames = useMemo(
    () => [...new Set((data?.events || []).map((e) => e.model))].sort(),
    [data],
  );
  useEffect(() => {
    if (model !== "all" && !modelNames.includes(model)) setModel("all");
  }, [modelNames]);
  useEffect(() => setPage(0), [tab, query, model, range, sort]);
  const rows = useMemo(() => {
    let result =
      tab === "requests"
        ? [...events].reverse()
        : groups(events, tab === "model" ? "model" : tab === "key" ? "client" : "key");
    result = result.filter((r) =>
      (r.name ? keyLabel(r.name) : `${r.model} ${keyLabel(r.client)} ${keyLabel(r.key)}`)
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    if (sort === "cost")
      result.sort((a, b) => {
        const aCost = tab === "requests" ? a.cost : a.priced ? a.cost : null;
        const bCost = tab === "requests" ? b.cost : b.priced ? b.cost : null;
        return (bCost ?? -1) - (aCost ?? -1);
      });
    else if (tab !== "requests")
      result.sort((a, b) =>
        sort === "requests"
          ? b.n - a.n
          : sort === "name"
            ? a.name.localeCompare(b.name)
            : b.input + b.output - (a.input + a.output),
      );
    return result;
  }, [events, tab, query, sort, keyLabel]);
  const maxPage = Math.max(0, Math.ceil(rows.length / 8) - 1),
    shown = rows.slice(
      Math.min(page, maxPage) * 8,
      (Math.min(page, maxPage) + 1) * 8,
    );
  const total = stats.input + stats.output,
    rate = stats.n
      ? (((stats.n - stats.fail) / stats.n) * 100).toFixed(1)
      : null;
  const healthy =
    data?.configured && data?.collected_at && !data?.collect_err && !error;
  const quick = (days) =>
    setRange({ from: subDays(new Date(), days - 1), to: new Date() });
  const todayKey = dateKey(new Date());
  const fromKey = dateKey(range.from);
  const toKey = dateKey(range.to);
  const spansToday = toKey === todayKey;
  const activeQuick =
    spansToday && fromKey === todayKey
      ? 1
      : spansToday && fromKey === dateKey(subDays(new Date(), 6))
        ? 7
        : spansToday && fromKey === dateKey(subDays(new Date(), 29))
          ? 30
          : 0;
  return (
    <I18nContext.Provider value={i18n}>
    <TooltipProvider>
      <div className="min-h-dvh">
        <header className="border-b bg-card">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
            <a
              href="/"
              className="flex items-center gap-3 font-semibold tracking-tight"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="size-4" />
              </span>
              CPA Usage
              <Badge
                variant="outline"
                className="hidden sm:inline-flex font-normal text-muted-foreground"
              >
                LOCAL
              </Badge>
            </a>
            <div className="flex items-center gap-2">
              <PriceDialog request={request} onSaved={load} currency={currency} fxRate={fxRate} />
              <Badge
                variant="outline"
                className="hidden sm:flex gap-1.5 font-normal"
              >
                {healthy ? (
                  <Check className="size-3 text-primary" />
                ) : (
                  <WifiOff className="size-3" />
                )}
                {healthy ? t("collecting") : t("waiting")}
              </Badge>
              <Select value={lang} onValueChange={(value) => { setLang(value); saveLanguage(value); }}>
                <SelectTrigger size="sm" className="gap-1.5" aria-label={t("language")}>
                  <Languages className="size-3.5" />
                  <span className="hidden sm:inline">
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LANGUAGES).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={dark ? t("lightTheme") : t("darkTheme")}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("breadcrumb")}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                {t("heroTitle")}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("heroSubtitle")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => load()}
              disabled={busy}
            >
              <RefreshCw className={busy ? "animate-spin" : ""} />
              {busy ? t("refreshing") : t("refresh")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              ariaLabel={t("range")}
              value={activeQuick}
              onChange={quick}
              items={[
                { label: t("today"), value: 1 },
                { label: t("last7"), value: 7 },
                { label: t("last30"), value: 30 },
              ]}
            />
            <Popover
              open={calendarOpen}
              onOpenChange={(o) => {
                setCalendarOpen(o);
                if (o) setDraft(range);
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarDays />
                  {format(range.from, formats.rangeFrom)} –{" "}
                  {format(range.to, formats.rangeTo)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="range"
                  locale={i18n.dateLocale}
                  selected={draft}
                  onSelect={(v) => setDraft(v || {})}
                  defaultMonth={range.from}
                  numberOfMonths={1}
                  disabled={{ after: new Date() }}
                />
                <Separator />
                <div className="flex items-center justify-between gap-4 p-3">
                  <span className="text-xs text-muted-foreground">
                    {t("pickRange")}
                  </span>
                  <Button
                    size="sm"
                    disabled={!draft.from || !draft.to || draft.from > draft.to}
                    onClick={() => {
                      setRange(draft);
                      setCalendarOpen(false);
                    }}
                  >
                    {t("apply")}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger
                className="w-44 bg-card"
                size="sm"
                aria-label={t("filterModel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allModels")}</SelectItem>
                {modelNames.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CurrencyControl value={currencySettings} onChange={setCurrencySettings} />
            <span className="ml-auto text-xs text-muted-foreground">
              {data?.collected_at
                ? t("updatedAt", { time: format(new Date(data.collected_at), "HH:mm:ss") })
                : t("autoRefresh")}
            </span>
          </div>
          {error && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>{t("loadFailed")}</AlertTitle>
              <AlertDescription>
                {t(data ? "loadFailedStale" : "loadFailedEmpty", { error: errorText(error) })}
              </AlertDescription>
            </Alert>
          )}
          {data?.configured && data.collect_err && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>{t("collectAttention")}</AlertTitle>
              <AlertDescription>
                {t("collectError", { error: i18n.serverMessage(data.collect_err) })}
              </AlertDescription>
            </Alert>
          )}
          <section
            aria-label={t("coreMetrics")}
            className="animate-in fade-in slide-in-from-bottom-2 duration-500 grid grid-cols-2 gap-3 lg:grid-cols-5"
          >
            <Metric
              className="col-span-2 lg:col-span-1"
              label={stats.priced && stats.unpriced ? t("estimatedCostPartial") : t("estimatedCost")}
              value={!stats.n ? t("noData") : stats.priced ? displayMoney(stats.cost) : t("unpriced")}
              raw={stats.priced ? stats.cost : undefined}
              format={(n) => money(n, currency, fxRate, convertUSD(n, currency, fxRate) >= 100 ? 2 : 6)}
              detail={!stats.n ? t("costDetailEmpty", { currency }) : t("costDetail", { currency, priced: stats.priced, total: stats.n, count: stats.n }) + (stats.unpriced ? t("costDetailUnpriced", { count: stats.unpriced }) : "") + (stats.historical ? t("costDetailHistorical", { count: stats.historical }) : "")}
              help={t("costHelp") + (currency === "USD" ? "" : t("costHelpRate", { rate: i18n.number(fxRate, { maximumFractionDigits: 8 }), currency })) + t("costHelpDisclaimer")}
              loading={loading}
            />
            <Metric
              label={t("totalTokens")}
              value={compact(total)}
              raw={total}
              format={compact}
              detail={t("tokensDetail", { input: compact(stats.input), output: compact(stats.output) })}
              help={t("tokensHelp", { total })}
              loading={loading}
            />
            <Metric
              label={t("requests")}
              value={fmt(stats.n)}
              raw={stats.n}
              format={(v) => fmt(Math.round(v))}
              detail={t("modelsCalled", { count: groups(events, "model").length })}
              help={t("requestsHelp")}
              loading={loading}
            />
            <Metric
              label={t("successRate")}
              value={rate === null ? t("noData") : percent(rate)}
              raw={rate ?? undefined}
              format={percent}
              detail={t("successDetail", { failed: stats.fail, succeeded: stats.n - stats.fail })}
              help={t("successHelp")}
              loading={loading}
            />
            <Metric
              label={t("cacheRate")}
              value={
                stats.input
                  ? percent((stats.cache / stats.input) * 100)
                  : t("noData")
              }
              raw={stats.input ? (stats.cache / stats.input) * 100 : undefined}
              format={percent}
              detail={t("cacheDetail", { cache: compact(stats.cache) })}
              help={t("cacheHelp")}
              loading={loading}
            />
          </section>
          <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:80ms] shadow-none">
            <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{chartMetric === "cost" ? t("costTrend") : t("tokenTrend")}</CardTitle>
                <CardDescription className="mt-1.5">
                  {chartMetric === "cost" ? t("costTrendDetail", { currency }) + (stats.unpriced ? t("costTrendUnpriced", { count: stats.unpriced }) : "") + (stats.historical ? t("costTrendHistorical", { count: stats.historical }) : "") : t("tokenTrendDetail")}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
              <SegmentedControl
                ariaLabel={t("trendMetric")}
                value={chartMetric}
                onChange={setChartMetric}
                items={[{ label: t("tokens"), value: "tokens" }, { label: t("cost"), value: "cost" }]}
              />
              <SegmentedControl
                ariaLabel={t("bucketing")}
                value={bucket}
                onChange={setBucket}
                items={[
                  { label: t("hour"), value: "hour" },
                  { label: t("day"), value: "day" },
                  { label: t("month"), value: "month" },
                ]}
              />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-72 w-full" />
              ) : buckets.length && (chartMetric !== "cost" || stats.priced) ? (
                <>
                  <ChartContainer
                    className="h-[280px] w-full sm:h-[330px]"
                    config={chartMetric === "cost" ? costChartConfig : chartConfig}
                  >
                    <AreaChart
                      accessibilityLayer
                      data={chartMetric === "cost" ? costBuckets : buckets}
                      margin={{ top: 12, left: 0, right: 12, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 4" />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={35}
                        tickMargin={12}
                        tickFormatter={(v) => bucketTick(v, bucket)}
                      />
                      <YAxis
                        tickFormatter={chartMetric === "cost" ? (n) => withSymbol(currency, compact(n)) : compact}
                        axisLine={false}
                        tickLine={false}
                        width={chartMetric === "cost" ? 64 : 48}
                      />
                      <ChartTooltip
                        content={chartMetric === "cost" ? <ChartTooltipContent formatter={(value, name, item) => (
                          <div className="space-y-1"><p className="font-medium tabular-nums">{t("tooltipCost", { amount: money(value, currency, 1) })}</p>{item.payload.unpriced > 0 && <p className="text-muted-foreground">{t("tooltipPartial", { count: item.payload.unpriced })}</p>}</div>
                        )} /> : <ChartTooltipContent valueFormatter={fmt} />}
                      />
                      {(chartMetric === "cost" ? ["cost"] : ["cache", "net", "output"]).map((k) => (
                        <Area
                          key={k}
                          dataKey={k}
                          type="linear"
                          connectNulls={false}
                          stackId="total"
                          stroke={`var(--color-${k})`}
                          fill={`var(--color-${k})`}
                          fillOpacity={k === "output" ? 0.8 : 0.6}
                          animationDuration={450}
                          animationEasing="ease-out"
                        />
                      ))}
                    </AreaChart>
                  </ChartContainer>
                  <div className="mt-4 flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
                    {Object.entries(chartMetric === "cost" ? costChartConfig : chartConfig).map(([k, v]) => (
                      <span key={k} className="flex items-center gap-2">
                        <span
                          className="size-2 rounded-sm"
                          style={{ background: v.color }}
                        />
                        {v.label}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Activity className="size-8 opacity-40" />
                  <p className="text-sm">{stats.n && chartMetric === "cost" ? t("chartUnpriced") : t("chartEmpty")}</p>
                  <Button variant="outline" size="sm" onClick={() => quick(30)}>
                    {t("viewLast30")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:160ms] gap-0 overflow-hidden shadow-none">
            <CardHeader className="pb-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{t("details")}</CardTitle>
                  <CardDescription className="mt-1.5">
                    {t("detailsSubtitle")}
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-60">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchDetails")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4">
                <SegmentedControl
                  ariaLabel={t("detailsView")}
                  value={tab}
                  onChange={(value) => { setTab(value); setSort(value === "requests" ? "time" : "tokens"); }}
                  items={[
                    {
                      label: (
                        <>
                          <Layers className="size-3.5" />
                          {t("byModel")}
                        </>
                      ),
                      value: "model",
                    },
                    {
                      label: (
                        <>
                          <KeyRound className="size-3.5" />
                          {t("byKey")}
                        </>
                      ),
                      value: "key",
                    },
                    {
                      label: (
                        <>
                          <UserRound className="size-3.5" />
                          {t("byAccount")}
                        </>
                      ),
                      value: "account",
                    },
                    {
                      label: (
                        <>
                          <Activity className="size-3.5" />
                          {t("requestsTab")}
                        </>
                      ),
                      value: "requests",
                    },
                  ]}
                />
                  <Select value={tab === "requests" && sort !== "cost" ? "time" : sort} onValueChange={setSort}>
                    <SelectTrigger
                      className="min-w-36"
                      size="sm"
                      aria-label={t("sortDetails")}
                    >
                      <ArrowDownUp className="size-3" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">{t("sortCost")}</SelectItem>
                      {tab === "requests" ? <SelectItem value="time">{t("sortTime")}</SelectItem> : <>
                        <SelectItem value="tokens">{t("sortTokens")}</SelectItem>
                        <SelectItem value="requests">{t("sortRequests")}</SelectItem>
                        <SelectItem value="name">{t("sortName")}</SelectItem>
                      </>}
                    </SelectContent>
                  </Select>
              </div>
              <Separator />
              <Table>
                <TableHeader>
                  <TableRow>
                    {(tab === "requests"
                      ? ["colTimeModel", "colKey", "colStatus", "colInput", "colCache", "colOutput", "colCost"]
                      : [
                          "colModelKey",
                          "colRequests",
                          "colSuccessRate",
                          "colInput",
                          "colCache",
                          "colOutput",
                          "colTotalTokens",
                          "colCost",
                        ]
                    ).map((key) => t(key)).map((s, i) => (
                      <TableHead key={s} className={i ? "text-right" : "pl-6"}>
                        {s}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r, i) => (
                    <TableRow
                      key={tab === "requests" ? `${r.ts}-${i}` : r.name}
                      className="animate-in fade-in duration-500"
                      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                    >
                      {tab === "requests" ? (
                        <>
                          <TableCell className="pl-6">
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(r.ts * 1000), formats.requestTime)}
                            </div>
                            <div
                              className="max-w-56 truncate font-medium"
                              title={r.model}
                            >
                              {r.model}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-right font-mono text-xs"
                            title={t("accountTitle", { account: keyLabel(r.key) })}
                          >
                            {keyLabel(r.client)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={r.failed ? "destructive" : "secondary"}
                            >
                              {r.failed ? t("failed") : t("succeeded")}
                            </Badge>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell
                            className="max-w-64 truncate pl-6 font-medium"
                            title={keyLabel(r.name)}
                          >
                            {keyLabel(r.name)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt(r.n)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {percent(((r.n - r.fail) / r.n) * 100)}
                          </TableCell>
                        </>
                      )}
                      {["input", "cache", "output"].map((k) => (
                        <TableCell
                          key={k}
                          className="text-right tabular-nums"
                          title={fmt(r[k])}
                        >
                          {compact(r[k])}
                        </TableCell>
                      ))}
                      {tab !== "requests" && (
                        <TableCell
                          className="text-right font-medium tabular-nums"
                          title={fmt(r.input + r.output)}
                        >
                          {compact(r.input + r.output)}
                        </TableCell>
                      )}
                      <TableCell className="pr-6 text-right tabular-nums whitespace-nowrap" title={r.price_version ? t("priceVersion", { version: String(r.price_version) }) : undefined}>
                        <div className="font-medium">{tab === "requests" ? displayMoney(r.cost) : r.priced ? displayMoney(r.cost) : t("unpriced")}</div>
                        {r.priced > 0 && r.unpriced > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{t("partialUnpriced", { count: r.unpriced })}</p>}
                        {(r.historical > 0 || r.price_basis === "historical_estimate") && <p className="mt-1 text-[10px] text-muted-foreground">{t("historicalEstimate")}</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!shown.length && (
                    <TableRow>
                      <TableCell
                        colSpan={tab === "requests" ? 7 : 8}
                        className="h-32 text-center text-muted-foreground"
                      >
                        {loading
                          ? t("loadingDetails")
                          : query
                            ? t("noMatches")
                            : t("noDetails")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <Separator />
            <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
              <span>{t("recordsCount", { count: rows.length })}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("previousPage")}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span>
                  {Math.min(page, maxPage) + 1} / {maxPage + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("nextPage")}
                  disabled={page >= maxPage}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </Card>
          <footer className="flex flex-wrap items-center justify-between gap-2 pb-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Database className="size-3" />
              {t("footerStorage", { timezone: data?.timezone || t("localTimezone"), version: data?.version || "0.1.1" })}
            </span>
            <span>
              {t("footerNote")}
              {data?.skipped ? t("footerSkipped", { count: data.skipped }) : ""}
            </span>
          </footer>
        </main>
      </div>
    </TooltipProvider>
    </I18nContext.Provider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
