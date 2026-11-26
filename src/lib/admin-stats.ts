import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * 管理概览统计聚合。
 *
 * 口径：
 * - 只统计 logType='request'
 * - 成功 = responseStatus 为 2xx；错误 = responseStatus >= 400；其余（空值/3xx）不计入两者
 * - AuditLog.createdAt 在库里是 UTC 毫秒整数，按天/小时分桶一律按 Asia/Shanghai（UTC+8，无夏令时）切
 */

export type StatsRange = 'today' | '7d' | '30d';

export const STATS_RANGES: StatsRange[] = ['today', '7d', '30d'];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Asia/Shanghai 固定偏移（1991 年后无夏令时） */
const SH_OFFSET_MS = 8 * HOUR;
const UNKNOWN_LABEL = '(未知)';

const CACHE_TTL_MS = 45 * 1000;

interface Window {
  start: number;
  end: number;
  /** 当前窗口起点之前的等长窗口，用于环比 */
  prevStart: number;
  prevEnd: number;
  bucketMs: number;
  bucketCount: number;
}

export function isStatsRange(v: string | null | undefined): v is StatsRange {
  return v === 'today' || v === '7d' || v === '30d';
}

/** 上海时区的当天 0 点（UTC 毫秒） */
export function shanghaiDayStart(ms: number): number {
  return Math.floor((ms + SH_OFFSET_MS) / DAY) * DAY - SH_OFFSET_MS;
}

export function buildWindow(range: StatsRange, now = Date.now()): Window {
  const todayStart = shanghaiDayStart(now);
  switch (range) {
    case 'today': {
      const start = todayStart;
      return { start, end: now, prevStart: start - DAY, prevEnd: now - DAY, bucketMs: HOUR, bucketCount: 24 };
    }
    case '7d': {
      const start = todayStart - 6 * DAY;
      return { start, end: now, prevStart: start - 7 * DAY, prevEnd: start - 1, bucketMs: DAY, bucketCount: 7 };
    }
    default: {
      const start = todayStart - 29 * DAY;
      return { start, end: now, prevStart: start - 30 * DAY, prevEnd: start - 1, bucketMs: DAY, bucketCount: 30 };
    }
  }
}

const rawInt = (n: number) => Prisma.raw(String(Math.trunc(n)));

/** 分桶表达式：返回自 epoch 起的「上海时区」桶序号 */
function bucketExpr(bucketMs: number): Prisma.Sql {
  return Prisma.sql`CAST((createdAt + ${rawInt(SH_OFFSET_MS)}) / ${rawInt(bucketMs)} AS INTEGER)`;
}

const baseWhere = (a: number, b: number) =>
  Prisma.sql`logType = 'request' AND createdAt >= CAST(${a} AS INTEGER) AND createdAt <= CAST(${b} AS INTEGER)`;

const OK = Prisma.sql`CASE WHEN responseStatus >= 200 AND responseStatus < 300 THEN 1 ELSE 0 END`;
const ERR = Prisma.sql`CASE WHEN responseStatus >= 400 THEN 1 ELSE 0 END`;

interface SummaryRow {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  success: number;
  errors: number;
  latencyCount: number;
  latencySum: number;
}

async function querySummary(a: number, b: number): Promise<SummaryRow> {
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      CAST(COUNT(*) AS REAL) AS requests,
      CAST(COALESCE(SUM(totalTokens), 0) AS REAL) AS tokens,
      CAST(COALESCE(SUM(promptTokens), 0) AS REAL) AS promptTokens,
      CAST(COALESCE(SUM(completionTokens), 0) AS REAL) AS completionTokens,
      CAST(SUM(${OK}) AS REAL) AS success,
      CAST(SUM(${ERR}) AS REAL) AS errors,
      CAST(COUNT(responseTime) AS REAL) AS latencyCount,
      CAST(COALESCE(SUM(responseTime), 0) AS REAL) AS latencySum
    FROM AuditLog
    WHERE ${baseWhere(a, b)}
  `;
  return rows[0] ?? { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, success: 0, errors: 0, latencyCount: 0, latencySum: 0 };
}

export interface CardStat {
  value: number;
  prev: number;
  /** 环比变化率；上一周期为 0 时为 null */
  change: number | null;
}

function toCard(value: number, prev: number): CardStat {
  return { value, prev, change: prev > 0 ? (value - prev) / prev : null };
}

export interface StatsSummary {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  success: number;
  errors: number;
  successRate: number | null;
  avgLatency: number | null;
  p95Latency: number | null;
}

interface DimensionRow {
  key: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  success: number;
  errors: number;
  latencyCount: number;
  latencySum: number;
}

async function queryDimension(
  column: 'model' | 'providerName',
  a: number,
  b: number,
  limit: number
): Promise<DimensionRow[]> {
  const key = Prisma.sql`COALESCE(NULLIF(TRIM(${Prisma.raw(column)}), ''), ${UNKNOWN_LABEL})`;
  return prisma.$queryRaw<DimensionRow[]>`
    SELECT
      ${key} AS key,
      CAST(COUNT(*) AS REAL) AS requests,
      CAST(COALESCE(SUM(totalTokens), 0) AS REAL) AS tokens,
      CAST(COALESCE(SUM(promptTokens), 0) AS REAL) AS promptTokens,
      CAST(COALESCE(SUM(completionTokens), 0) AS REAL) AS completionTokens,
      CAST(SUM(${OK}) AS REAL) AS success,
      CAST(SUM(${ERR}) AS REAL) AS errors,
      CAST(COUNT(responseTime) AS REAL) AS latencyCount,
      CAST(COALESCE(SUM(responseTime), 0) AS REAL) AS latencySum
    FROM AuditLog
    WHERE ${baseWhere(a, b)}
    GROUP BY key
    ORDER BY tokens DESC, requests DESC, key ASC
    LIMIT ${rawInt(limit)}
  `;
}

interface TrendRow {
  bucket: number | bigint;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  success: number;
  errors: number;
  latencyCount: number;
  latencySum: number;
}

async function queryTrend(w: Window): Promise<TrendRow[]> {
  return prisma.$queryRaw<TrendRow[]>`
    SELECT
      ${bucketExpr(w.bucketMs)} AS bucket,
      CAST(COUNT(*) AS REAL) AS requests,
      CAST(COALESCE(SUM(totalTokens), 0) AS REAL) AS tokens,
      CAST(COALESCE(SUM(promptTokens), 0) AS REAL) AS promptTokens,
      CAST(COALESCE(SUM(completionTokens), 0) AS REAL) AS completionTokens,
      CAST(SUM(${OK}) AS REAL) AS success,
      CAST(SUM(${ERR}) AS REAL) AS errors,
      CAST(COUNT(responseTime) AS REAL) AS latencyCount,
      CAST(COALESCE(SUM(responseTime), 0) AS REAL) AS latencySum
    FROM AuditLog
    WHERE ${baseWhere(w.start, w.end)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
}

interface NamedUsage {
  id: string;
  name: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

async function queryNamed(
  column: 'userId' | 'tokenId',
  a: number,
  b: number,
  limit: number
): Promise<NamedUsage[]> {
  const rows = await prisma.$queryRaw<Array<{ dimId: string; requests: number; tokens: number; promptTokens: number; completionTokens: number }>>`
    SELECT
      ${Prisma.raw(column)} AS dimId,
      CAST(COUNT(*) AS REAL) AS requests,
      CAST(COALESCE(SUM(totalTokens), 0) AS REAL) AS tokens,
      CAST(COALESCE(SUM(promptTokens), 0) AS REAL) AS promptTokens,
      CAST(COALESCE(SUM(completionTokens), 0) AS REAL) AS completionTokens
    FROM AuditLog
    WHERE ${baseWhere(a, b)} AND ${Prisma.raw(column)} IS NOT NULL
    GROUP BY dimId
    ORDER BY tokens DESC, requests DESC, dimId ASC
    LIMIT ${rawInt(limit)}
  `;
  if (!rows.length) return [];
  // 一次性批量取名，避免 N+1
  const names = new Map<string, string>();
  if (column === 'userId') {
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.dimId) } },
      select: { id: true, username: true, name: true },
    });
    for (const u of users) names.set(u.id, u.name || u.username);
  } else {
    const tokens = await prisma.token.findMany({
      where: { id: { in: rows.map((r) => r.dimId) } },
      select: { id: true, name: true },
    });
    for (const t of tokens) names.set(t.id, t.name);
  }
  return rows.map(({ dimId, ...r }) => ({ ...r, id: dimId, name: names.get(dimId) || dimId.slice(0, 10) }));
}

/** 最近秩法百分位（values 无需有序） */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

interface LatencySample {
  model: string;
  providerName: string;
  responseTime: number;
}

async function queryLatencySamples(a: number, b: number): Promise<LatencySample[]> {
  return prisma.$queryRaw<LatencySample[]>`
    SELECT
      COALESCE(NULLIF(TRIM(model), ''), ${UNKNOWN_LABEL}) AS model,
      COALESCE(NULLIF(TRIM(providerName), ''), ${UNKNOWN_LABEL}) AS providerName,
      CAST(responseTime AS REAL) AS responseTime
    FROM AuditLog
    WHERE ${baseWhere(a, b)} AND responseTime IS NOT NULL
  `;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export interface StatsCards {
  today: { requests: CardStat; tokens: CardStat; promptTokens: number; completionTokens: number };
  '7d': { requests: CardStat; tokens: CardStat; promptTokens: number; completionTokens: number };
  '30d': { requests: CardStat; tokens: CardStat; promptTokens: number; completionTokens: number };
}

export interface StatsBreakdownItem {
  key: string;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  share: number;
  successRate: number | null;
  avgLatency: number | null;
  p95Latency: number | null;
}

export interface StatsTrendPoint {
  label: string;
  start: number;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  success: number;
  errors: number;
  avgLatency: number | null;
}

export interface OverviewStats {
  range: StatsRange;
  bucket: 'hour' | 'day';
  window: { start: number; end: number; prevStart: number; prevEnd: number };
  generatedAt: number;
  detail: boolean;
  cards: StatsCards;
  summary: StatsSummary;
  prevSummary: StatsSummary;
  /** 轻量模式（detail=false）下为 null */
  trend: StatsTrendPoint[] | null;
  byModel: StatsBreakdownItem[];
  byProvider: StatsBreakdownItem[];
  topUsers: NamedUsage[];
  topTokens: NamedUsage[];
}

function finalizeSummary(s: SummaryRow, samples: number[], p95: boolean): StatsSummary {
  return {
    requests: s.requests,
    tokens: s.tokens,
    promptTokens: s.promptTokens,
    completionTokens: s.completionTokens,
    success: s.success,
    errors: s.errors,
    successRate: ratio(s.success, s.success + s.errors),
    avgLatency: ratio(s.latencySum, s.latencyCount),
    p95Latency: p95 ? percentile(samples, 95) : null,
  };
}

function toBreakdown(
  rows: DimensionRow[],
  totalTokens: number,
  samples: Map<string, number[]>,
  withP95: boolean
): StatsBreakdownItem[] {
  return rows.map((r) => ({
    key: r.key,
    requests: r.requests,
    tokens: r.tokens,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    share: totalTokens > 0 ? r.tokens / totalTokens : 0,
    successRate: ratio(r.success, r.success + r.errors),
    avgLatency: ratio(r.latencySum, r.latencyCount),
    p95Latency: withP95 ? percentile(samples.get(r.key) ?? [], 95) : null,
  }));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function buildTrend(w: Window, rows: TrendRow[]): StatsTrendPoint[] {
  const baseBucket = Math.floor((w.start + SH_OFFSET_MS) / w.bucketMs);
  // Prisma 把 CAST(.. AS INTEGER) 的结果返回为 BigInt，统一转 number
  const byBucket = new Map(rows.map((r) => [Number(r.bucket), r]));
  const out: StatsTrendPoint[] = [];
  for (let i = 0; i < w.bucketCount; i++) {
    const bucket = baseBucket + i;
    const start = bucket * w.bucketMs - SH_OFFSET_MS;
    const r = byBucket.get(bucket);
    const d = new Date(start + SH_OFFSET_MS);
    const label =
      w.bucketMs === HOUR
        ? `${pad2(d.getUTCHours())}:00`
        : `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    if (!r) {
      out.push({ label, start, requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, success: 0, errors: 0, avgLatency: null });
      continue;
    }
    out.push({
      label,
      start,
      requests: r.requests,
      tokens: r.tokens,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      success: r.success,
      errors: r.errors,
      avgLatency: ratio(r.latencySum, r.latencyCount),
    });
  }
  return out;
}

/**
 * 聚合主入口。
 * @param detail false = 首屏轻量（三窗口数据卡 + 当前窗口的成功率/平均延迟/Top 列表 + 模型/提供商 Top3）
 *               true  = 完整（另含走势序列、P95、全量模型/提供商明细）
 */
export async function getOverviewStats(range: StatsRange, detail: boolean, now = Date.now()): Promise<OverviewStats> {
  const w = buildWindow(range, now);
  const w7 = buildWindow('7d', now);
  const w30 = buildWindow('30d', now);

  // 首屏数据卡：今天 / 7 天 / 30 天，各查当前 + 上一周期
  const [sToday, pToday, s7, p7, s30, p30] = await Promise.all([
    querySummary(w.start, w.end),
    querySummary(w.prevStart, w.prevEnd),
    querySummary(w7.start, w7.end),
    querySummary(w7.prevStart, w7.prevEnd),
    querySummary(w30.start, w30.end),
    querySummary(w30.prevStart, w30.prevEnd),
  ]);

  const cards: StatsCards = {
    today: {
      requests: toCard(sToday.requests, pToday.requests),
      tokens: toCard(sToday.tokens, pToday.tokens),
      promptTokens: sToday.promptTokens,
      completionTokens: sToday.completionTokens,
    },
    '7d': {
      requests: toCard(s7.requests, p7.requests),
      tokens: toCard(s7.tokens, p7.tokens),
      promptTokens: s7.promptTokens,
      completionTokens: s7.completionTokens,
    },
    '30d': {
      requests: toCard(s30.requests, p30.requests),
      tokens: toCard(s30.tokens, p30.tokens),
      promptTokens: s30.promptTokens,
      completionTokens: s30.completionTokens,
    },
  };

  // 当前窗口：上一周期汇总 + Top 列表（一次 groupBy，批量取名）
  const [prevRaw, byUser, byToken, dimLimit] = await Promise.all([
    querySummary(w.prevStart, w.prevEnd),
    queryNamed('userId', w.start, w.end, 10),
    queryNamed('tokenId', w.start, w.end, 10),
    Promise.resolve(detail ? 1000 : 3),
  ]);
  const curRaw = range === 'today' ? sToday : range === '7d' ? s7 : s30;

  const [modelRows, providerRows, samples] = await Promise.all([
    queryDimension('model', w.start, w.end, dimLimit),
    queryDimension('providerName', w.start, w.end, dimLimit),
    detail ? queryLatencySamples(w.start, w.end) : Promise.resolve([] as LatencySample[]),
  ]);

  const trendRows = detail ? await queryTrend(w) : null;

  const modelSamples = new Map<string, number[]>();
  const providerSamples = new Map<string, number[]>();
  let allSamples: number[] = [];
  if (detail) {
    allSamples = samples.map((s) => s.responseTime);
    for (const s of samples) {
      (modelSamples.get(s.model) ?? modelSamples.set(s.model, []).get(s.model)!).push(s.responseTime);
      (providerSamples.get(s.providerName) ?? providerSamples.set(s.providerName, []).get(s.providerName)!).push(
        s.responseTime
      );
    }
  }

  const dimTotal = curRaw.tokens;
  return {
    range,
    bucket: w.bucketMs === HOUR ? 'hour' : 'day',
    window: { start: w.start, end: w.end, prevStart: w.prevStart, prevEnd: w.prevEnd },
    generatedAt: now,
    detail,
    cards,
    summary: finalizeSummary(curRaw, allSamples, detail),
    prevSummary: finalizeSummary(prevRaw, [], false),
    trend: trendRows ? buildTrend(w, trendRows) : null,
    byModel: toBreakdown(modelRows, dimTotal, modelSamples, detail),
    byProvider: toBreakdown(providerRows, dimTotal, providerSamples, detail),
    topUsers: byUser,
    topTokens: byToken,
  };
}

// ---- 服务端内存缓存（按 range + detail 做 key） ----

type CacheMap = Map<string, { expiresAt: number; promise: Promise<OverviewStats> }>;
const g = globalThis as unknown as { __overviewStatsCache?: CacheMap };
const cache: CacheMap = (g.__overviewStatsCache ??= new Map());

export async function getCachedOverviewStats(range: StatsRange, detail: boolean): Promise<OverviewStats> {
  const key = `${range}:${detail ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const entry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    promise: getOverviewStats(range, detail).catch((err) => {
      cache.delete(key);
      throw err;
    }),
  };
  cache.set(key, entry);
  return entry.promise;
}
