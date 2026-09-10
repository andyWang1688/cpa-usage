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
  Settings2,
  Sun,
  Terminal,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { compact, dateKey, fmt, groups, summarize, trend } from "./analytics";
import "./index.css";

const chartConfig = {
  cache: { label: "缓存输入", color: "var(--chart-1)" },
  net: { label: "净输入", color: "var(--chart-2)" },
  output: { label: "输出", color: "var(--chart-3)" },
};
const initialRange = () => ({ from: subDays(new Date(), 6), to: new Date() });
function Help({ children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-muted-foreground"
          aria-label="指标说明"
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}
function Metric({ label, value, detail, help, loading }) {
  return (
    <Card className="gap-3 shadow-none">
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
            {value}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
function App() {
  const [range, setRange] = useState(initialRange),
    [draft, setDraft] = useState(initialRange),
    [calendarOpen, setCalendarOpen] = useState(false),
    [bucket, setBucket] = useState("day"),
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
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("cpa-usage-theme", dark ? "dark" : "light");
  }, [dark]);
  async function load(collect = false) {
    const id = ++generation.current;
    setBusy(true);
    try {
      if (collect) {
        const r = await fetch("/api/collect", {
          method: "POST",
          headers: { "X-CPA-Usage": "1" },
        });
        if (!r.ok) throw Error("采集请求失败");
      }
      const r = await fetch(
        `/api/usage?start=${dateKey(range.from)}&end=${dateKey(range.to)}&bucket=${bucket}`,
      );
      if (!r.ok) throw Error(`服务返回 ${r.status}`);
      const d = await r.json();
      if (d.error) throw Error(d.error);
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
    if (tab !== "requests")
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
                LOCAL
              </Badge>
            </a>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="hidden sm:flex gap-1.5 font-normal"
              >
                {healthy ? (
                  <Check className="size-3 text-primary" />
                ) : (
                  <WifiOff className="size-3" />
                )}
                {healthy ? "采集正常" : "等待连接"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label={dark ? "切换浅色" : "切换深色"}
                onClick={() => setDark(!dark)}
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="服务设置">
                    <Settings2 />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>本地服务</DialogTitle>
                    <DialogDescription>
                      密钥只存于本机配置文件，不进入浏览器。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">版本</span>
                      <Badge variant="secondary">
                        v{data?.version || "0.1.0"}
                      </Badge>
                    </div>
                    <Separator />
                    <p>首次连接或修改 CPA 地址、密钥：</p>
                    <pre className="rounded-md bg-muted p-3 font-mono">
                      cpa-usage configure
                    </pre>
                    <p>安装新版本并自动重启：</p>
                    <pre className="rounded-md bg-muted p-3 font-mono">
                      cpa-usage update
                    </pre>
                    <p className="text-muted-foreground">
                      配置和 SQLite 历史独立保存，更新不会覆盖。仅监听
                      127.0.0.1。
                    </p>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                工作台 / 用量分析
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                每一份用量，都有迹可循。
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                请求表现、Token 流向与模型分布，一处看清。
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => load(true)}
              disabled={busy}
            >
              <RefreshCw className={busy ? "animate-spin" : ""} />
              {busy ? "正在同步" : "同步用量"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => quick(1)}>
                今天
              </Button>
              <Button variant="ghost" size="sm" onClick={() => quick(7)}>
                近 7 天
              </Button>
              <Button variant="ghost" size="sm" onClick={() => quick(30)}>
                近 30 天
              </Button>
            </div>
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
                  locale={zhCN}
                  selected={draft}
                  onSelect={(v) => setDraft(v || {})}
                  defaultMonth={range.from}
                  numberOfMonths={1}
                  disabled={{ after: new Date() }}
                />
                <Separator />
                <div className="flex items-center justify-between gap-4 p-3">
                  <span className="text-xs text-muted-foreground">
                    选择开始和结束日期
                  </span>
                  <Button
                    size="sm"
                    disabled={!draft.from || !draft.to || draft.from > draft.to}
                    onClick={() => {
                      setRange(draft);
                      setCalendarOpen(false);
                    }}
                  >
                    应用
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger
                className="w-44 bg-card"
                size="sm"
                aria-label="筛选模型"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模型</SelectItem>
                {modelNames.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">
              {data?.collected_at
                ? "更新于 " + format(new Date(data.collected_at), "HH:mm:ss")
                : "每 60 秒自动刷新"}
            </span>
          </div>
          {error && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>暂时无法获取用量</AlertTitle>
              <AlertDescription>
                {error}。
                {data
                  ? "下方保留上次结果，请重试。"
                  : "请确认本地服务正在运行。"}
              </AlertDescription>
            </Alert>
          )}
          {data && !data.configured && (
            <Alert>
              <Terminal />
              <AlertTitle>连接你的 CLIProxyAPI</AlertTitle>
              <AlertDescription>
                <span>
                  在终端运行 <code>cpa-usage configure</code> 设置 CPA 地址和
                  management key；采集不依赖浏览器开启。
                </span>
              </AlertDescription>
            </Alert>
          )}
          {data?.configured && data.collect_err && (
            <Alert variant="destructive">
              <WifiOff />
              <AlertTitle>采集需要关注</AlertTitle>
              <AlertDescription>
                {data.collect_err}。历史记录仍可查看。
              </AlertDescription>
            </Alert>
          )}
          <section
            aria-label="核心指标"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <Metric
              label="总 Token"
              value={compact(total)}
              detail={`输入 ${compact(stats.input)} / 输出 ${compact(stats.output)}`}
              help={`精确值 ${fmt(total)}。输入包含缓存，输出包含推理，不重复累加。`}
              loading={loading}
            />
            <Metric
              label="请求次数"
              value={fmt(stats.n)}
              detail={`${fmt(groups(events, "model").length)} 个模型参与调用`}
              help="包含成功、失败和零 Token 请求。"
              loading={loading}
            />
            <Metric
              label="请求成功率"
              value={rate === null ? "暂无" : rate + "%"}
              detail={`${fmt(stats.fail)} 次失败 / ${fmt(stats.n - stats.fail)} 次成功`}
              help="按 CPA 返回的 failed 标记统计，不推断错误原因。"
              loading={loading}
            />
            <Metric
              label="缓存命中率"
              value={
                stats.input
                  ? ((stats.cache / stats.input) * 100).toFixed(1) + "%"
                  : "暂无"
              }
              detail={`复用 ${compact(stats.cache)} 输入 Token`}
              help="缓存读取 Token / 输入 Token。缓存是输入的一部分。"
              loading={loading}
            />
          </section>
          <Card className="shadow-none">
            <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Token 趋势</CardTitle>
                <CardDescription className="mt-1.5">
                  缓存输入、净输入和输出的堆叠分布
                </CardDescription>
              </div>
              <Tabs value={bucket} onValueChange={setBucket}>
                <TabsList>
                  <TabsTrigger value="hour">小时</TabsTrigger>
                  <TabsTrigger value="day">天</TabsTrigger>
                  <TabsTrigger value="month">月</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-72 w-full" />
              ) : buckets.length ? (
                <>
                  <ChartContainer
                    className="h-[280px] w-full sm:h-[330px]"
                    config={chartConfig}
                  >
                    <AreaChart
                      accessibilityLayer
                      data={buckets}
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
                        tickFormatter={compact}
                        axisLine={false}
                        tickLine={false}
                        width={48}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent valueFormatter={fmt} />}
                      />
                      {["cache", "net", "output"].map((k) => (
                        <Area
                          key={k}
                          dataKey={k}
                          type="linear"
                          stackId="total"
                          stroke={`var(--color-${k})`}
                          fill={`var(--color-${k})`}
                          fillOpacity={k === "output" ? 0.8 : 0.6}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ChartContainer>
                  <div className="mt-4 flex flex-wrap justify-center gap-6 text-xs text-muted-foreground">
                    {Object.entries(chartConfig).map(([k, v]) => (
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
                  <p className="text-sm">这个时间范围内，还没有用量。</p>
                  <Button variant="outline" size="sm" onClick={() => quick(30)}>
                    查看近 30 天
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="gap-0 overflow-hidden shadow-none">
            <CardHeader className="pb-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">用量明细</CardTitle>
                  <CardDescription className="mt-1.5">
                    从模型到每次请求，逐层查看
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-60">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="搜索模型或 Key"
                    aria-label="搜索明细"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <Tabs value={tab} onValueChange={setTab} className="gap-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4">
                <TabsList>
                  <TabsTrigger value="model">
                    <Layers className="size-3.5" />
                    按模型
                  </TabsTrigger>
                  <TabsTrigger value="key">
                    <KeyRound className="size-3.5" />按 Key
                  </TabsTrigger>
                  <TabsTrigger value="requests">
                    <Activity className="size-3.5" />
                    请求
                  </TabsTrigger>
                </TabsList>
                {tab !== "requests" && (
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger
                      className="w-36"
                      size="sm"
                      aria-label="明细排序"
                    >
                      <ArrowDownUp className="size-3" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tokens">Token 降序</SelectItem>
                      <SelectItem value="requests">请求数降序</SelectItem>
                      <SelectItem value="name">名称排序</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Separator />
              <Table>
                <TableHeader>
                  <TableRow>
                    {(tab === "requests"
                      ? ["时间 / 模型", "Key", "状态", "输入", "缓存", "输出"]
                      : [
                          "模型 / Key",
                          "请求",
                          "成功率",
                          "输入",
                          "缓存",
                          "输出",
                          "总 Token",
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
                              {r.failed ? "失败" : "成功"}
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
                          className="pr-6 text-right font-medium tabular-nums"
                          title={fmt(r.input + r.output)}
                        >
                          {compact(r.input + r.output)}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!shown.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-32 text-center text-muted-foreground"
                      >
                        {loading
                          ? "正在加载明细…"
                          : query
                            ? "没有匹配结果，换个关键词试试。"
                            : "暂无明细"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Tabs>
            <Separator />
            <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
              <span>{fmt(rows.length)} 条记录 · Key 已匿名化</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="上一页"
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
                  aria-label="下一页"
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
              本地 SQLite · {data?.timezone || "本机时区"} · v
              {data?.version || "0.1.0"}
            </span>
            <span>
              输入包含缓存，输出包含推理
              {data?.skipped ? ` · ${data.skipped} 条无效记录未统计` : ""}
            </span>
          </footer>
        </main>
      </div>
    </TooltipProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
