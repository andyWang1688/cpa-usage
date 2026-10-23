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
  Layers,
  Moon,
  RefreshCw,
  Search,
  Sun,
  WifiOff,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
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
import { LanguageSwitcher } from "@/components/language-switcher";
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
import { compact, convertUSD, dateKey, fmt, groups, money, summarize, trend } from "./analytics";
import { readCurrencySettings, saveCurrencySettings } from "./currency";
import { I18nProvider, useI18n } from "./i18n-context";
import "./index.css";

const initialRange = () => {
  const today = new Date();
  return { from: today, to: today };
};
function Help({ children, ariaLabel }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-muted-foreground"
          aria-label={ariaLabel}
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

function Metric({ label, value, raw, format, detail, help, loading, helpAria, className = "" }) {
  const animated = useCountUp(typeof raw === "number" ? raw : 0);
  const display =
    typeof raw === "number" && format ? format(animated) : value;
  return (
    <Card className={`gap-3 shadow-none ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-0">
        <CardDescription>{label}</CardDescription>
        <Help ariaLabel={helpAria}>{help}</Help>
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
const KEY_PROMPT =
  "请返回 CPA 管理中心重新登录并勾选“记住密码”，然后刷新本页面。";

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
async function request(path, options = {}, t) {
  const key = readManagementKey();
  const keyPrompt = t ? t("auth.keyPrompt") : "请返回 CPA 管理中心重新登录并勾选“记住密码”，然后刷新本页面。";
  if (!key) throw Error(keyPrompt);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (response.status === 401 || response.status === 403) throw Error(keyPrompt);
  const data = await response.json();
  const serviceErr = t ? t("auth.serviceReturned", { status: response.status }) : `服务返回 ${response.status}`;
  if (!response.ok || data.error) throw Error(data.error || serviceErr);
  return data;
}

function App() {
  const { t, dateFnsLocale } = useI18n();

  const chartConfig = useMemo(() => ({
    cache: { label: t("chart.cachedInput"), color: "var(--chart-1)" },
    net: { label: t("chart.netInput"), color: "var(--chart-2)" },
    output: { label: t("chart.output"), color: "var(--chart-3)" },
  }), [t]);

  const costChartConfig = useMemo(() => ({
    cost: { label: t("chart.estimatedCost"), color: "var(--chart-3)" },
  }), [t]);

  const [range, setRange] = useState(initialRange),
    [draft, setDraft] = useState(initialRange),
    [calendarOpen, setCalendarOpen] = useState(false),
    [bucket, setBucket] = useState("hour"),
    [chartMetric, setChartMetric] = useState("tokens"),
    [currencySettings, setCurrencySettings] = useState(readCurrencySettings),
    [model, setModel] = useState("all"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("model"),
    [page, setPage] = useState(0),
    [sort, setSort] = useState("tokens"),
    [dark, setDark] = useState(
      () => localStorage.getItem("cpa-usage-theme") === "dark",
    );
  const generation = useRef(0);
  const { currency, fxRate } = currencySettings;
  const displayMoney = (n) => money(n, currency, fxRate, 6, t("metrics.unpriced"));
  useEffect(() => saveCurrencySettings(currencySettings), [currencySettings]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("cpa-usage-theme", dark ? "dark" : "light");
  }, [dark]);
  async function load() {
    const id = ++generation.current;
    setBusy(true);
    try {
      const d = await request(`/usage?start=${dateKey(range.from)}&end=${dateKey(range.to)}&bucket=${bucket}`, {}, t);
      if (id === generation.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (id === generation.current) setError(e.message);
    } finally {
      if (id === generation.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }

  const apiRequest = (path, options) => request(path, options, t);
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
      (data?.events || []).filter((e) => model === "all" || e.model === model),
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
        : groups(events, tab === "model" ? "model" : "key");
    result = result.filter((r) =>
      (r.name || r.model + " " + r.key)
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
  }, [events, tab, query, sort]);
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
                {t("header.badge")}
              </Badge>
            </a>
            <div className="flex items-center gap-2">
              <PriceDialog request={apiRequest} onSaved={load} currency={currency} fxRate={fxRate} />
              <Badge
                variant="outline"
                className="hidden sm:flex gap-1.5 font-normal"
              >
                {healthy ? (
                  <Check className="size-3 text-primary" />
                ) : (
                  <WifiOff className="size-3" />
                )}
                {healthy ? t("header.healthy") : t("header.unhealthy")}
              </Badge>
              <LanguageSwitcher />
              <Button
                variant="ghost"
                size="icon"
                aria-label={dark ? t("header.themeLight") : t("header.themeDark")}
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
                {t("hero.breadcrumb")}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                {t("hero.title")}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("hero.subtitle")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => load()}
              disabled={busy}
            >
              <RefreshCw className={busy ? "animate-spin" : ""} />
              {busy ? t("hero.refreshing") : t("hero.refresh")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              ariaLabel={t("filter.timeRangeAria")}
              value={activeQuick}
              onChange={quick}
              items={[
                { label: t("filter.today"), value: 1 },
                { label: t("filter.last7Days"), value: 7 },
                { label: t("filter.last30Days"), value: 30 },
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
                  {format(range.from, "yyyy/MM/dd")} –{" "}
                  {format(range.to, "MM/dd")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  mode="range"
                  locale={dateFnsLocale}
                  selected={draft}
                  onSelect={(v) => setDraft(v || {})}
                  defaultMonth={range.from}
                  numberOfMonths={1}
                  disabled={{ after: new Date() }}
                />
                <Separator />
                <div className="flex items-center justify-between gap-4 p-3">
                  <span className="text-xs text-muted-foreground">
                    {t("filter.datePrompt")}
                  </span>
                  <Button
                    size="sm"
                    disabled={!draft.from || !draft.to || draft.from > draft.to}
                    onClick={() => {
                      setRange(draft);
                      setCalendarOpen(false);
                    }}
                  >
                    {t("filter.apply")}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger
                className="w-44 bg-card"
                size="sm"
                aria-label={t("filter.modelSelectAria")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filter.allModels")}</SelectItem>
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
                ? t("filter.updatedAt", { time: format(new Date(data.collected_at), "HH:mm:ss") })
                : t("filter.autoRefresh")}
            </span>
          </div>
          {error && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>{t("alert.fetchErrorTitle")}</AlertTitle>
              <AlertDescription>
                {error}. {data ? t("alert.fetchErrorRetrying") : t("alert.fetchErrorCheckService")}
              </AlertDescription>
            </Alert>
          )}
          {data?.configured && data.collect_err && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>{t("alert.collectErrTitle")}</AlertTitle>
              <AlertDescription>
                {data.collect_err}{t("alert.collectErrSuffix")}
              </AlertDescription>
            </Alert>
          )}
          <section
            aria-label={t("metrics.sectionAria")}
            className="animate-in fade-in slide-in-from-bottom-2 duration-500 grid grid-cols-2 gap-3 lg:grid-cols-5"
          >
            <Metric
              className="col-span-2 lg:col-span-1"
              label={stats.priced && stats.unpriced ? t("metrics.costLabelPartial") : t("metrics.costLabel")}
              value={!stats.n ? t("metrics.none") : stats.priced ? displayMoney(stats.cost) : t("metrics.unpriced")}
              raw={stats.priced ? stats.cost : undefined}
              format={(n) => money(n, currency, fxRate, convertUSD(n, currency, fxRate) >= 100 ? 2 : 6, t("metrics.unpriced"))}
              detail={!stats.n ? t("metrics.costDetailEmpty", { currency }) : `${t("metrics.costDetailPriced", { currency, priced: fmt(stats.priced), total: fmt(stats.n) })}${stats.unpriced ? t("metrics.costDetailUnpriced", { unpriced: fmt(stats.unpriced) }) : ""}${stats.historical ? t("metrics.costDetailHistorical", { historical: fmt(stats.historical) }) : ""}`}
              help={`${t("metrics.costHelpBase")}${currency === "CNY" ? t("metrics.costHelpFx", { fxRate }) : ""}${t("metrics.costHelpDisclaimer")}`}
              loading={loading}
              helpAria={t("metrics.helpAria")}
            />
            <Metric
              label={t("metrics.tokensLabel")}
              value={compact(total)}
              raw={total}
              format={compact}
              detail={t("metrics.tokensDetail", { input: compact(stats.input), output: compact(stats.output) })}
              help={t("metrics.tokensHelp", { total: fmt(total) })}
              loading={loading}
              helpAria={t("metrics.helpAria")}
            />
            <Metric
              label={t("metrics.requestsLabel")}
              value={fmt(stats.n)}
              raw={stats.n}
              format={(v) => fmt(Math.round(v))}
              detail={t("metrics.requestsDetail", { count: fmt(groups(events, "model").length) })}
              help={t("metrics.requestsHelp")}
              loading={loading}
              helpAria={t("metrics.helpAria")}
            />
            <Metric
              label={t("metrics.successRateLabel")}
              value={rate === null ? t("metrics.none") : rate + "%"}
              raw={rate ?? undefined}
              format={(v) => v.toFixed(1) + "%"}
              detail={t("metrics.successRateDetail", { fail: fmt(stats.fail), success: fmt(stats.n - stats.fail) })}
              help={t("metrics.successRateHelp")}
              loading={loading}
              helpAria={t("metrics.helpAria")}
            />
            <Metric
              label={t("metrics.cacheHitRateLabel")}
              value={
                stats.input
                  ? ((stats.cache / stats.input) * 100).toFixed(1) + "%"
                  : t("metrics.none")
              }
              raw={stats.input ? (stats.cache / stats.input) * 100 : undefined}
              format={(v) => v.toFixed(1) + "%"}
              detail={t("metrics.cacheHitRateDetail", { cache: compact(stats.cache) })}
              help={t("metrics.cacheHitRateHelp")}
              loading={loading}
              helpAria={t("metrics.helpAria")}
            />
          </section>
          <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:80ms] shadow-none">
            <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">{chartMetric === "cost" ? t("chart.costTitle") : t("chart.tokensTitle")}</CardTitle>
                <CardDescription className="mt-1.5">
                  {chartMetric === "cost" ? `${t("chart.costDescBase", { currency })}${stats.unpriced ? t("chart.costDescUnpriced", { unpriced: fmt(stats.unpriced) }) : ""}${stats.historical ? t("chart.costDescHistorical", { historical: fmt(stats.historical) }) : ""}` : t("chart.tokensDesc")}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
              <SegmentedControl
                ariaLabel={t("chart.metricAria")}
                value={chartMetric}
                onChange={setChartMetric}
                items={[{ label: t("chart.tokenMetric"), value: "tokens" }, { label: t("chart.costMetric"), value: "cost" }]}
              />
              <SegmentedControl
                ariaLabel={t("chart.granularityAria")}
                value={bucket}
                onChange={setBucket}
                items={[
                  { label: t("chart.hour"), value: "hour" },
                  { label: t("chart.day"), value: "day" },
                  { label: t("chart.month"), value: "month" },
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
                        tickFormatter={(v) =>
                          bucket === "hour"
                            ? v.slice(5)
                            : bucket === "day"
                              ? v.slice(5)
                              : v
                        }
                      />
                      <YAxis
                        tickFormatter={chartMetric === "cost" ? (n) => `${currency === "CNY" ? "¥" : "$"}${compact(n)}` : compact}
                        axisLine={false}
                        tickLine={false}
                        width={chartMetric === "cost" ? 64 : 48}
                      />
                      <ChartTooltip
                        content={chartMetric === "cost" ? <ChartTooltipContent formatter={(value, name, item) => (
                          <div className="space-y-1"><p className="font-medium tabular-nums">{t("chart.tooltipCost", { cost: money(value, currency, fxRate, 1, t("metrics.unpriced")) })}</p>{item.payload.unpriced > 0 && <p className="text-muted-foreground">{t("chart.tooltipPartial", { unpriced: fmt(item.payload.unpriced) })}</p>}</div>
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
                  <p className="text-sm">{stats.n && chartMetric === "cost" ? t("chart.emptyCost") : t("chart.emptyTokens")}</p>
                  <Button variant="outline" size="sm" onClick={() => quick(30)}>
                    {t("chart.viewLast30Days")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:160ms] gap-0 overflow-hidden shadow-none">
            <CardHeader className="pb-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{t("details.title")}</CardTitle>
                  <CardDescription className="mt-1.5">
                    {t("details.subtitle")}
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-60">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t("details.searchPlaceholder")}
                    aria-label={t("details.searchAria")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4">
                <SegmentedControl
                  ariaLabel={t("details.viewAria")}
                  value={tab}
                  onChange={(value) => { setTab(value); setSort(value === "requests" ? "time" : "tokens"); }}
                  items={[
                    {
                      label: (
                        <>
                          <Layers className="size-3.5" />
                          {t("details.byModel")}
                        </>
                      ),
                      value: "model",
                    },
                    {
                      label: (
                        <>
                          <KeyRound className="size-3.5" />
                          {t("details.byKey")}
                        </>
                      ),
                      value: "key",
                    },
                    {
                      label: (
                        <>
                          <Activity className="size-3.5" />
                          {t("details.requests")}
                        </>
                      ),
                      value: "requests",
                    },
                  ]}
                />
                  <Select value={tab === "requests" && sort !== "cost" ? "time" : sort} onValueChange={setSort}>
                    <SelectTrigger
                      className="w-40"
                      size="sm"
                      aria-label={t("details.sortAria")}
                    >
                      <ArrowDownUp className="size-3" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost">{t("details.sortCostDesc")}</SelectItem>
                      {tab === "requests" ? <SelectItem value="time">{t("details.sortTimeDesc")}</SelectItem> : <>
                        <SelectItem value="tokens">{t("details.sortTokensDesc")}</SelectItem>
                        <SelectItem value="requests">{t("details.sortRequestsDesc")}</SelectItem>
                        <SelectItem value="name">{t("details.sortNameAsc")}</SelectItem>
                      </>}
                    </SelectContent>
                  </Select>
              </div>
              <Separator />
              <Table>
                <TableHeader>
                  <TableRow>
                    {(tab === "requests"
                      ? [t("details.thReqTimeModel"), t("details.thKey"), t("details.thStatus"), t("details.thInput"), t("details.thCache"), t("details.thOutput"), t("details.thEstimatedCost")]
                      : [
                          t("details.thModelKey"),
                          t("details.thRequests"),
                          t("details.thSuccessRate"),
                          t("details.thInput"),
                          t("details.thCache"),
                          t("details.thOutput"),
                          t("details.thTotalTokens"),
                          t("details.thEstimatedCost"),
                        ]
                    ).map((s, i) => (
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
                              {format(new Date(r.ts * 1000), "MM-dd HH:mm:ss")}
                            </div>
                            <div
                              className="max-w-56 truncate font-medium"
                              title={r.model}
                            >
                              {r.model}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r.key}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={r.failed ? "destructive" : "secondary"}
                            >
                              {r.failed ? t("details.badgeFailed") : t("details.badgeSuccess")}
                            </Badge>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell
                            className="max-w-64 truncate pl-6 font-medium"
                            title={r.name}
                          >
                            {r.name}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt(r.n)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(((r.n - r.fail) / r.n) * 100).toFixed(1)}%
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
                      <TableCell className="pr-6 text-right tabular-nums whitespace-nowrap" title={r.price_version ? t("details.priceVersionTitle", { version: r.price_version }) : undefined}>
                        <div className="font-medium">{tab === "requests" ? displayMoney(r.cost) : r.priced ? displayMoney(r.cost) : t("metrics.unpriced")}</div>
                        {r.priced > 0 && r.unpriced > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{t("details.partialCostBadge", { unpriced: fmt(r.unpriced) })}</p>}
                        {(r.historical > 0 || r.price_basis === "historical_estimate") && <p className="mt-1 text-[10px] text-muted-foreground">{t("details.historicalEstimateBadge")}</p>}
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
                          ? t("details.loading")
                          : query
                            ? t("details.noMatches")
                            : t("details.noData")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <Separator />
            <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
              <span>{t("details.paginationSummary", { total: fmt(rows.length) })}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t("details.prevPage")}
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
                  aria-label={t("details.nextPage")}
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
              {t("footer.sqlite", { tz: data?.timezone || t("footer.defaultTz"), version: data?.version || "0.1.1" })}
            </span>
            <span>
              {t("footer.tokensSummary")}
              {data?.skipped ? t("footer.skippedSummary", { skipped: data.skipped }) : ""}
            </span>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
