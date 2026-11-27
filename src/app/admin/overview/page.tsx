'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatChange, formatFull, formatMs, formatNumber, formatPercent } from '@/components/admin-stats/format';
import type {
  OverviewStats,
  StatsBreakdownItem,
  StatsRange,
} from '@/lib/admin-stats';

// 图表库只在展开走势图后才加载，不进首屏 bundle。
// 就绪状态由页面组件实例自己的 useEffect 跟踪（见下方「图表库」effect）：
// next/dynamic 的 loader 每个模块只执行一次，不能靠 loader 里的回调通知组件，
// 否则页面二次挂载（SPA 内离开再回来）时 loader 不会再跑，组件永远等不到就绪信号。
const loadCharts = () => import('@/components/admin-stats/overview-charts');
const TokenTrendChart = dynamic(() => loadCharts().then((m) => m.TokenTrendChart), { ssr: false });
const RequestTrendChart = dynamic(() => loadCharts().then((m) => m.RequestTrendChart), { ssr: false });

/** 走势图区块的失败占位：与图表内「加载中」同高同风格，带重试入口 */
function ChartLoadingPlaceholder() {
  return (
    <div className="h-[280px] flex items-center justify-center text-sm text-light-text-secondary dark:text-dark-text-secondary">
      <i className="fa-solid fa-spinner fa-spin mr-2" />
      加载中…
    </div>
  );
}

function ChartLoadError({
  message,
  onRetry,
  onReload,
}: {
  message: string;
  onRetry: () => void;
  onReload?: () => void;
}) {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-sm text-light-text-secondary dark:text-dark-text-secondary">
      <span>
        <i className="fa-solid fa-circle-exclamation mr-2 text-error" />
        {message}
      </span>
      <span className="flex items-center gap-4">
        <button type="button" onClick={onRetry} className="underline decoration-dotted hover:text-primary">
          重试
        </button>
        {onReload && (
          <button type="button" onClick={onReload} className="underline decoration-dotted hover:text-primary">
            刷新页面
          </button>
        )}
      </span>
    </div>
  );
}

interface ProviderUsage {
  providerId: string;
  providerName: string;
  tokenUsage: number;
  requestUsage: number;
}

interface SystemOverview {
  totalUsers: number;
  totalActiveTokens: number;
  providerUsage: ProviderUsage[];
}

const RANGES: { key: StatsRange; label: string; hint: string }[] = [
  { key: 'today', label: '今天', hint: '按小时' },
  { key: '7d', label: '近7天', hint: '按天' },
  { key: '30d', label: '近30天', hint: '按天' },
];
const RANGE_LABEL: Record<StatsRange, string> = { today: '今天', '7d': '近7天', '30d': '近30天' };

// 统计数据的模块级内存缓存：SPA 内离开再回到概览页时组件实例会重建（state 清零），
// 缓存在实例之外才活得下来——切回时 TTL 内已加载过的窗口直接命中，不再发请求；
// 超过 TTL 视为过期（「今天」窗口的数据会变），下次挂载照常重新请求。
const STATS_CACHE_TTL = 60_000;
interface CachedEntry<T> {
  at: number;
  data: T;
}
function cacheGet<T>(entry: CachedEntry<T> | null | undefined): T | null {
  return entry && Date.now() - entry.at < STATS_CACHE_TTL ? entry.data : null;
}
const statsCache: {
  light: Partial<Record<StatsRange, CachedEntry<OverviewStats>>>;
  full: Partial<Record<StatsRange, CachedEntry<OverviewStats>>>;
  system: CachedEntry<SystemOverview> | null;
} = { light: {}, full: {}, system: null };
function cachedRange(map: Partial<Record<StatsRange, CachedEntry<OverviewStats>>>): Partial<Record<StatsRange, OverviewStats>> {
  const out: Partial<Record<StatsRange, OverviewStats>> = {};
  for (const r of ['today', '7d', '30d'] as StatsRange[]) {
    const hit = cacheGet(map[r]);
    if (hit) out[r] = hit;
  }
  return out;
}

const LS = {
  range: 'linkai-admin-overview:range',
  chartOpen: 'linkai-admin-overview:chartOpen',
  detailOpen: 'linkai-admin-overview:detailOpen',
};

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** 区域加载遮罩：盖在已有内容上，比小 spinner 更明确 */
function LoadingOverlay({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/75 dark:bg-black/50">
      <span className="inline-flex items-center gap-2 text-sm text-light-text-secondary dark:text-dark-text-secondary">
        <i className="fa-solid fa-spinner fa-spin" />
        {label}
      </span>
    </div>
  );
}

type SortKey = 'tokens' | 'requests' | 'share' | 'successRate' | 'avgLatency';

function BreakdownTable({
  title,
  icon,
  rows,
  totalTokens,
  full,
  loading,
}: {
  title: string;
  icon: string;
  rows: StatsBreakdownItem[];
  totalTokens: number;
  full: boolean;
  loading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('tokens');
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // 空值永远排最后
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return desc ? bv - av : av - bv;
    });
    return list;
  }, [rows, sortKey, desc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(true);
    }
  };

  const th = (key: SortKey, label: string, align = 'text-right') => (
    <th className={`px-3 py-2 ${align} font-medium cursor-pointer select-none whitespace-nowrap`}>
      <button type="button" className="hover:text-primary" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key ? (desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  if (!rows.length && !loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <i className={`${icon} mr-2 text-purple-500`} />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary py-4 text-center">
            该时间窗口内暂无数据
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="text-lg">
          <i className={`${icon} mr-2 text-purple-500`} />
          {title}
          <span className="ml-2 text-xs font-normal text-light-text-secondary dark:text-dark-text-secondary">
            {full ? `共 ${rows.length} 项` : `Top ${rows.length}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-light-text-secondary dark:text-dark-text-secondary border-b">
              <th className="px-3 py-2 text-left font-medium">名称</th>
              {th('requests', '请求')}
              {th('tokens', 'Token')}
              {th('share', '占比')}
              {th('successRate', '成功率')}
              {th('avgLatency', '平均延迟')}
              {full && <th className="px-3 py-2 text-right font-medium">P95 延迟</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className="border-b last:border-b-0">
                <td className="px-3 py-2">
                  <div className="font-medium truncate max-w-[220px]" title={r.key}>
                    {r.key}
                  </div>
                  <div className="h-1.5 mt-1 w-full bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary dark:bg-primary/80 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(r.share * 100, r.tokens > 0 ? 2 : 0))}%` }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatFull(r.requests)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatFull(r.tokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(r.share * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(r.successRate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMs(r.avgLatency)}</td>
                {full && <td className="px-3 py-2 text-right tabular-nums">{formatMs(r.p95Latency)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {totalTokens === 0 && <p className="mt-2 text-xs text-muted-foreground">窗口内 Token 为 0，占比不计。</p>}
      </CardContent>
      {loading && <LoadingOverlay />}
    </Card>
  );
}

function RankList({
  title,
  icon,
  items,
  loading,
  rangeLabel,
}: {
  title: string;
  icon: string;
  items: { id: string; name: string; requests: number; tokens: number }[];
  loading: boolean;
  rangeLabel: string;
}) {
  const max = items[0]?.tokens || 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <i className={`${icon} mr-2 text-yellow-500`} />
          {title}
          <span className="ml-2 text-xs font-normal text-light-text-secondary dark:text-dark-text-secondary">
            {rangeLabel} · Top 10
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse bg-primary/10 rounded" />
            ))}
          </div>
        ) : !items.length ? (
          <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary py-4 text-center">
            {rangeLabel}暂无数据
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={`${item.id}-${index}`} className="flex items-center gap-3">
                <span className={`w-6 text-center text-sm font-bold ${index < 3 ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate" title={item.name}>
                      {item.name}
                    </span>
                    <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary ml-2 whitespace-nowrap">
                      {formatNumber(item.tokens)} tokens · {formatFull(item.requests)} 请求
                    </span>
                  </div>
                  <div className="h-2 bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary dark:bg-primary/80 rounded-full transition-all"
                      style={{ width: `${Math.max((item.tokens / max) * 100, 2)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChangeText({ change, inverse = false }: { change: number | null; inverse?: boolean }) {
  const c = formatChange(change);
  let cls = 'text-muted-foreground';
  if (c.tone === 'up') cls = inverse ? 'text-error' : 'text-green-600 dark:text-green-400';
  else if (c.tone === 'down') cls = inverse ? 'text-green-600 dark:text-green-400' : 'text-error';
  return <span className={cls}>{c.text}</span>;
}

interface CoreCard {
  title: string;
  icon: string;
  color: string;
  bg: string;
  value: string;
  sub: ReactNode;
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<StatsRange>('today');
  const [chartOpen, setChartOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // 图表库状态：按组件实例跟踪，import 成功 / 失败都会落定，不会停在 loading
  const [chartLibStatus, setChartLibStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [chartLibRetry, setChartLibRetry] = useState(0);
  // detail 请求的非 abort 失败（按 range 记录，切窗口后不串）
  const [fullError, setFullError] = useState<{ range: StatsRange; message: string } | null>(null);
  // 手动重试计数：轻量 / detail 两个请求共用
  const [retryTick, setRetryTick] = useState(0);

  // 轻量数据（按 range 缓存在内存里，切回已加载过的窗口不重复请求）
  const [light, setLight] = useState<Partial<Record<StatsRange, OverviewStats>>>(() => cachedRange(statsCache.light));
  const [full, setFull] = useState<Partial<Record<StatsRange, OverviewStats>>>(() => cachedRange(statsCache.full));
  const [loadingLight, setLoadingLight] = useState(true);
  const [loadingFull, setLoadingFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemOverview | null>(() => cacheGet(statsCache.system));

  // 展开状态记忆
  useEffect(() => {
    const r = readStored(LS.range);
    if (r === 'today' || r === '7d' || r === '30d') setRange(r);
    setChartOpen(readStored(LS.chartOpen) === '1');
    setDetailOpen(readStored(LS.detailOpen) === '1');
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) writeStored(LS.range, range);
  }, [range, hydrated]);
  useEffect(() => {
    if (hydrated) writeStored(LS.chartOpen, chartOpen ? '1' : '0');
  }, [chartOpen, hydrated]);
  useEffect(() => {
    if (hydrated) writeStored(LS.detailOpen, detailOpen ? '1' : '0');
  }, [detailOpen, hydrated]);

  // 图表库：展开走势图后才 import。成功 / 失败都写入本实例的 state；
  // 重新展开、点重试、页面二次挂载都会重新走这里（import 结果有模块缓存，重复调用无额外网络开销）。
  useEffect(() => {
    if (!hydrated || !chartOpen) return;
    let cancelled = false;
    loadCharts().then(
      () => {
        if (!cancelled) setChartLibStatus('ready');
      },
      () => {
        if (!cancelled) setChartLibStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hydrated, chartOpen, chartLibRetry]);

  // 系统基础数（用户/令牌/提供商）
  useEffect(() => {
    if (system) return;
    const controller = new AbortController();
    fetch('/api/admin/quotas/overview', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('请求失败'))))
      .then((json) => {
        statsCache.system = { at: Date.now(), data: json };
        setSystem(json);
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') console.warn(err);
      });
    return () => controller.abort();
  }, []);

  // 首屏：当前窗口的轻量数据
  useEffect(() => {
    if (!hydrated) return;
    if (light[range]) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoadingLight(true);
    fetch(`/api/admin/overview/stats?range=${range}`, { signal: controller.signal, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('请求失败'))))
      .then((json) => {
        if (cancelled) return;
        statsCache.light[range] = { at: Date.now(), data: json };
        setLight((prev) => ({ ...prev, [range]: json }));
        setError(null);
      })
      .catch((err: any) => {
        if (!cancelled && err?.name !== 'AbortError') setError(err.message || '加载失败');
      })
      // 已被取代（切窗口 / 卸载）的请求不再回写 loading，避免把新请求的 loading 提前关掉
      .finally(() => {
        if (!cancelled) setLoadingLight(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, hydrated, retryTick]);

  // 点击触发：走势图或完整统计展开时才拉 detail=1
  // - abort 只发生在 cleanup（切窗口 / 收起 / 卸载）；只要仍 needFull 且该窗口没数据，effect 必然重跑发新请求
  // - 非 abort 失败记入 fullError：页面给出「重试」，点一下 retryTick+1 重跑，不存在无数据又无错误的死态
  const needFull = hydrated && (chartOpen || detailOpen);
  useEffect(() => {
    if (!needFull || full[range]) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoadingFull(true);
    setFullError(null);
    fetch(`/api/admin/overview/stats?range=${range}&detail=1`, { signal: controller.signal, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('请求失败'))))
      .then((json) => {
        if (cancelled) return;
        statsCache.full[range] = { at: Date.now(), data: json };
        setFull((prev) => ({ ...prev, [range]: json }));
        setError(null);
      })
      .catch((err: any) => {
        if (cancelled || err?.name === 'AbortError') return;
        const message = err.message || '加载失败';
        setFullError({ range, message });
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingFull(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, needFull, retryTick]);

  const fullData = full[range] ?? null;
  const data: OverviewStats | null = fullData ?? light[range] ?? null;
  const initialLoading = loadingLight && !data;
  // 当前窗口 detail 的失败（只在对应 range 下生效）
  const rangeFullError = fullError?.range === range ? fullError.message : null;
  // 已请求 detail 但当前窗口还没回来、也没失败
  const fullLoading = needFull && !fullData && !rangeFullError;
  const chartLibReady = chartLibStatus === 'ready';
  const trend = fullData?.trend ?? null;

  const rangeLabel = RANGE_LABEL[range];
  const rangeHint = RANGES.find((r) => r.key === range)?.hint ?? '';
  const summary = data?.summary ?? null;
  const prev = data?.prevSummary ?? null;

  // 核心指标卡：一行 5 张，全部跟随当前时间 tag
  const coreCards: CoreCard[] = useMemo(() => {
    const s = initialLoading ? null : summary;
    const cards = data?.cards ?? null;
    return [
      {
        title: `${rangeLabel} Token 总量`,
        icon: 'fa-solid fa-coins',
        color: 'text-pink-500',
        bg: 'bg-pink-500/10 dark:bg-pink-500/20',
        value: s ? formatNumber(s.tokens) : '-',
        sub: cards ? (
          <>
            输入 {formatNumber(cards.promptTokens)} · 输出 {formatNumber(cards.completionTokens)} · 较上期{' '}
            <ChangeText change={cards.tokens.change} />
          </>
        ) : null,
      },
      {
        title: `${rangeLabel}请求数`,
        icon: 'fa-solid fa-paper-plane',
        color: 'text-blue-500',
        bg: 'bg-blue-500/10 dark:bg-blue-500/20',
        value: s ? formatNumber(s.requests) : '-',
        sub: cards ? (
          <>
            较上期 <ChangeText change={cards.requests.change} />
          </>
        ) : null,
      },
      {
        title: `${rangeLabel}成功率`,
        icon: 'fa-solid fa-circle-check',
        color: 'text-green-500',
        bg: 'bg-green-500/10 dark:bg-green-500/20',
        value: s ? formatPercent(s.successRate) : '-',
        sub: s ? (
          <>
            成功 {formatFull(s.success)} · 错误 <span className="text-error">{formatFull(s.errors)}</span>
          </>
        ) : null,
      },
      {
        title: `${rangeLabel}平均延迟`,
        icon: 'fa-solid fa-gauge-high',
        color: 'text-purple-500',
        bg: 'bg-purple-500/10 dark:bg-purple-500/20',
        value: s ? formatMs(s.avgLatency) : '-',
        sub:
          s && prev?.avgLatency && s.avgLatency != null ? (
            <>
              较上期 <ChangeText change={(s.avgLatency - prev.avgLatency) / prev.avgLatency} inverse />
            </>
          ) : (
            <>较上期 上期无数据</>
          ),
      },
      {
        title: `${rangeLabel}P95 延迟`,
        icon: 'fa-solid fa-stopwatch',
        color: 'text-orange-500',
        bg: 'bg-orange-500/10 dark:bg-orange-500/20',
        value: s ? formatMs(s.p95Latency) : '-',
        sub: s && prev?.p95Latency != null && s.p95Latency != null ? (
          <>
            较上期 <ChangeText change={(s.p95Latency - prev.p95Latency) / prev.p95Latency} inverse />
          </>
        ) : (
          <>较上期 上期无数据</>
        ),
      },
    ];
  }, [data, initialLoading, rangeLabel]);

  const dimSummary = data
    ? `模型 ${formatFull(data.modelCount)} 个 · 提供商 ${formatFull(data.providerCount)} 个 · 共 ${formatNumber(data.summary.tokens)} tokens`
    : null;

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* ① 页头：标题 + 描述（左）| 时间 tag（右） */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">管理概览</h1>
          <p className="text-muted-foreground">查看系统整体状态</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1 w-fit">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                range === r.key
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-primary/5 text-light-text-secondary dark:text-dark-text-secondary'
              }`}
              aria-pressed={range === r.key}
            >
              {r.label}
              <span className="ml-1 text-[10px] opacity-70">{r.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-error/30 bg-error/5 dark:bg-error/10 text-error">
          <i className="fa-solid fa-circle-exclamation mr-2" />
          {error}
          <button
            type="button"
            onClick={() => setRetryTick((n) => n + 1)}
            className="ml-3 underline decoration-dotted hover:text-primary"
          >
            重试
          </button>
        </div>
      )}

      {/* ② 核心指标卡：一行 5 张，跟随时间 tag */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {coreCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-light-text-secondary dark:text-dark-text-secondary">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <i className={`${card.icon} ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {initialLoading ? (
                <div className="space-y-2">
                  <div className="h-9 w-24 animate-pulse bg-primary/10 rounded" />
                  <div className="h-3 w-28 animate-pulse bg-primary/10 rounded" />
                </div>
              ) : (
                <>
                  <div className="text-3xl font-bold tabular-nums">{card.value}</div>
                  <div className="mt-1 text-xs text-light-text-secondary dark:text-dark-text-secondary">{card.sub}</div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ③ 用量走势：默认折叠，点击展开才加载图表库 + 聚合 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">
            <i className="fa-solid fa-chart-area mr-2 text-blue-500" />
            用量走势
            <span className="ml-2 text-xs font-normal text-light-text-secondary dark:text-dark-text-secondary">
              {rangeLabel}（{rangeHint}）
            </span>
          </CardTitle>
          {chartOpen && (!trend || chartLibStatus === 'loading') && !rangeFullError && (
            <span className="inline-flex items-center gap-2 text-xs text-light-text-secondary dark:text-dark-text-secondary">
              <i className="fa-solid fa-spinner fa-spin" />
              加载中…
            </span>
          )}
        </CardHeader>
        <CardContent>
          <button
            type="button"
            className="w-full text-left text-sm text-light-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors"
            onClick={() => setChartOpen((v) => !v)}
            aria-expanded={chartOpen}
          >
            <i className={`fa-solid fa-chevron-${chartOpen ? 'up' : 'right'} mr-2`} />
            {chartOpen ? '收起走势图' : '点击展开走势图'}
            {!chartOpen && summary && (
              <span className="ml-2">
                — {rangeLabel}共 {formatFull(summary.requests)} 次请求 · {formatNumber(summary.tokens)} tokens
              </span>
            )}
          </button>
          {!chartOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-light-text-secondary dark:text-dark-text-secondary">
              <span className="font-medium">性能明细</span>
              <span>TTFT P50：{formatMs(data?.ttft?.p50)}</span>
              <span>P95：{formatMs(data?.ttft?.p95)}</span>
              <span>平均：{formatMs(data?.ttft?.avg)}</span>
            </div>
          )}
          {chartOpen && (
            <div className="mt-4 space-y-6">
              {rangeFullError ? (
                <ChartLoadError
                  message={`走势数据${rangeFullError}`}
                  onRetry={() => setRetryTick((n) => n + 1)}
                />
              ) : !trend ? (
                <div className="space-y-6">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-[280px] animate-pulse bg-primary/10 rounded" />
                  ))}
                </div>
              ) : chartLibStatus === 'error' ? (
                <ChartLoadError
                  message="图表组件加载失败"
                  onRetry={() => setChartLibRetry((n) => n + 1)}
                  onReload={() => window.location.reload()}
                />
              ) : chartLibStatus !== 'ready' ? (
                <ChartLoadingPlaceholder />
              ) : (
                <>
                  <div>
                    <div className="text-sm font-medium mb-2">Token 用量（输入 / 输出）</div>
                    <TokenTrendChart data={trend} bucket={fullData!.bucket} loading={!chartLibReady} />
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-2">请求量</div>
                    <RequestTrendChart data={trend} bucket={fullData!.bucket} loading={!chartLibReady} />
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ④ 分布明细：按模型 | 按提供商 双列；默认收起只留一行摘要 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            分布明细
            <span className="ml-2 text-xs font-normal text-light-text-secondary dark:text-dark-text-secondary">
              {rangeLabel}
            </span>
          </h2>
          <button
            type="button"
            className="text-sm underline decoration-dotted hover:text-primary inline-flex items-center"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
          >
            {detailOpen ? '收起' : '查看完整统计'}
            {fullLoading && (
              <span className="ml-2 inline-flex items-center gap-1 no-underline">
                <i className="fa-solid fa-spinner fa-spin" />
                加载中…
              </span>
            )}
          </button>
        </div>
        {initialLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-8 animate-pulse bg-primary/10 rounded" />
                ))}
              </div>
            ))}
          </div>
        ) : !detailOpen ? (
          <button
            type="button"
            className="w-full text-left text-sm px-4 py-3 rounded-lg border hover:bg-primary/5 transition-colors text-light-text-secondary dark:text-dark-text-secondary"
            onClick={() => setDetailOpen(true)}
          >
            <i className="fa-solid fa-chevron-right mr-2" />
            {dimSummary ?? '暂无数据'}
            <span className="ml-2 underline decoration-dotted">，点击查看完整统计</span>
          </button>
        ) : !data ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BreakdownTable
              title="按模型"
              icon="fa-solid fa-cube"
              rows={fullData ? fullData.byModel : data.byModel.slice(0, 3)}
              totalTokens={summary?.tokens ?? 0}
              full={Boolean(fullData)}
              loading={fullLoading}
            />
            <BreakdownTable
              title="按提供商"
              icon="fa-solid fa-chart-pie"
              rows={fullData ? fullData.byProvider : data.byProvider.slice(0, 3)}
              totalTokens={summary?.tokens ?? 0}
              full={Boolean(fullData)}
              loading={fullLoading}
            />
          </div>
        )}
      </div>

      {/* ⑤ 排行榜：用户 | 令牌 双列 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankList
          title="用户用量排行"
          icon="fa-solid fa-ranking-star"
          items={data?.topUsers ?? []}
          loading={initialLoading}
          rangeLabel={rangeLabel}
        />
        <RankList
          title="令牌用量排行"
          icon="fa-solid fa-key"
          items={data?.topTokens ?? []}
          loading={initialLoading}
          rangeLabel={rangeLabel}
        />
      </div>

      {/* ⑥ 系统概况 + 快速操作：收尾 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">系统概况</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            {[
              { title: '用户总数', value: system?.totalUsers, icon: 'fa-solid fa-users', color: 'text-blue-500' },
              { title: '活跃令牌', value: system?.totalActiveTokens, icon: 'fa-solid fa-key', color: 'text-green-500' },
              { title: '上游提供商', value: system?.providerUsage?.length, icon: 'fa-solid fa-server', color: 'text-purple-500' },
            ].map((card) => (
              <div key={card.title} className="flex items-center gap-3 p-4 border rounded-lg">
                <div className="p-2 rounded-lg bg-primary/10">
                  <i className={`${card.icon} ${card.color}`} />
                </div>
                <div>
                  <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">{card.title}</div>
                  <div className="text-2xl font-bold tabular-nums">
                    {card.value === undefined ? <span className="inline-block h-7 w-12 animate-pulse bg-primary/10 rounded align-middle" /> : card.value}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">快速操作</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { href: '/admin/providers', title: '提供商管理', desc: '配置上游 AI 提供商', icon: 'fa-solid fa-server', color: 'text-purple-500', bg: 'bg-purple-500/10 dark:bg-purple-500/20' },
              { href: '/admin/desensitization', title: '脱敏规则', desc: '配置数据脱敏规则', icon: 'fa-solid fa-shield-halved', color: 'text-rose-500', bg: 'bg-rose-500/10 dark:bg-rose-500/20' },
              { href: '/admin/tokens', title: '令牌管理', desc: '管理 API 访问令牌', icon: 'fa-solid fa-key', color: 'text-green-500', bg: 'bg-green-500/10 dark:bg-green-500/20' },
              { href: '/admin/audit-logs', title: '审计日志', desc: '查看请求日志分析', icon: 'fa-solid fa-scroll', color: 'text-orange-500', bg: 'bg-orange-500/10 dark:bg-orange-500/20' },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-3 p-4 border rounded-lg hover:bg-primary/5 transition-all duration-200"
              >
                <div className={`p-2 rounded-lg ${a.bg}`}>
                  <i className={`${a.icon} ${a.color}`} />
                </div>
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">{a.desc}</div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
