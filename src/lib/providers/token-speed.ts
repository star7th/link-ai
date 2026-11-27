import { prisma } from '@/lib/prisma';

/**
 * 出字速度（tok/s，decode 口径）计算口径：
 *   AuditLog 中 logType='request'、responseStatus 为 2xx、completionTokens>0 且 responseTime>0 的记录，
 *   速度 = ΣcompletionTokens ÷ Σ(responseTime − ttftMs)(ms) × 1000（累计口径，不是逐请求速度的平均）。
 *   decode 口径：分母不含首字等待（TTFT），仅统计 ttftMs 非空且 0 <= ttftMs < responseTime 的流式成功请求；
 *   ttftMs 缺失或异常的记录只从分母剔除（分子 token 数保留全部成功记录），避免脏数据拉低速度。
 *   某分组剔除后没有有效样本（decode 分母 <= 0）时返回 null（UI 显示空白）。
 *
 * 统计窗口（两个窗口各自独立计算，各自无数据即 null / 空数组）：
 *   - today：今天，服务器本地时区当日 0 点起
 *   - last30d：最近 30 天
 *
 * 聚合：按 ['providerId', 'model'] groupBy，每个窗口两次查询（token 累计 + decode 分母），覆盖全部传入
 *   的 provider，无逐记录 N+1。model 字段为 null 的记录（加字段前的历史数据）计入整体平均值，
 *   但不出现在按模型明细中。model 为请求体里的原始模型名，未做归一化。
 */

const LAST_30D_DAYS = 30;

const SUCCESS_WHERE = {
  logType: 'request',
  responseStatus: { gte: 200, lt: 300 },
  completionTokens: { gt: 0 },
  responseTime: { gt: 0 },
} as const;

export interface ModelTokenSpeed {
  model: string;
  /** 今天出字速度（tok/s，decode 口径），今天无有效样本为 null */
  avgTokenSpeedToday: number | null;
  /** 最近 30 天出字速度（tok/s，decode 口径），无有效样本为 null */
  avgTokenSpeed30d: number | null;
}

export interface ProviderTokenSpeed {
  /** 今天整体出字速度（tok/s，decode 口径），无有效样本为 null */
  avgTokenSpeedToday: number | null;
  /** 最近 30 天整体出字速度（tok/s，decode 口径），无有效样本为 null */
  avgTokenSpeed30d: number | null;
  /** 按模型明细（两个窗口的并集），按最近 30 天速度降序；两个窗口都无带模型的成功记录时为空数组 */
  modelSpeeds: ModelTokenSpeed[];
}

/** 服务器本地时区的当日 0 点 */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

type ModelAcc = { tokens: number; decodeMs: number };
type Acc = Map<string, { tokens: number; decodeMs: number; models: Map<string, ModelAcc> }>;

/** 单条候选 decode 样本（来自成功请求记录的最小字段集） */
export interface DecodeSample {
  providerId: string;
  model?: string | null;
  responseTime: number;
  ttftMs: number | null;
}

/**
 * 判断一条记录是否参与 decode 分母：
 * 仅 ttftMs 非空、ttftMs >= 0 且 ttftMs < responseTime 的记录有效（剔除缺失/异常 TTFT 的脏数据）。
 */
export function isValidDecodeSample(s: {
  responseTime: number;
  ttftMs: number | null;
}): boolean {
  return s.ttftMs !== null && s.ttftMs >= 0 && s.ttftMs < s.responseTime;
}

/** 累计 decode 分母（responseTime − ttftMs）到聚合器（整体 + 按模型） */
export function accumulateDecodeSamples(samples: DecodeSample[], acc: Acc): void {
  for (const s of samples) {
    if (!isValidDecodeSample(s)) continue;
    const decodeMs = s.responseTime - (s.ttftMs as number);
    let cur = acc.get(s.providerId);
    if (!cur) {
      cur = { tokens: 0, decodeMs: 0, models: new Map() };
      acc.set(s.providerId, cur);
    }
    cur.decodeMs += decodeMs;
    if (s.model) {
      const m = cur.models.get(s.model) ?? { tokens: 0, decodeMs: 0 };
      m.decodeMs += decodeMs;
      cur.models.set(s.model, m);
    }
  }
}

async function aggregate(providerIds: string[], since: Date): Promise<Acc> {
  const acc: Acc = new Map();

  // 分子：全部成功记录的 completionTokens（decode 口径下 token 数不做剔除）
  const rows = await prisma.auditLog.groupBy({
    by: ['providerId', 'model'],
    where: {
      ...SUCCESS_WHERE,
      providerId: { in: providerIds },
      createdAt: { gte: since },
    },
    _sum: { completionTokens: true },
  });

  for (const row of rows) {
    if (!row.providerId) continue;
    const tokens = row._sum.completionTokens ?? 0;
    if (tokens <= 0) continue;
    let cur = acc.get(row.providerId);
    if (!cur) {
      cur = { tokens: 0, decodeMs: 0, models: new Map() };
      acc.set(row.providerId, cur);
    }
    cur.tokens += tokens;
    if (row.model) {
      const m = cur.models.get(row.model) ?? { tokens: 0, decodeMs: 0 };
      m.tokens += tokens;
      cur.models.set(row.model, m);
    }
  }

  // 分母：仅 ttftMs 非空且 >= 0 的流式成功记录，逐条在内存里再剔除 ttftMs >= responseTime 的异常值
  const samples = await prisma.auditLog.findMany({
    where: {
      ...SUCCESS_WHERE,
      providerId: { in: providerIds },
      createdAt: { gte: since },
      ttftMs: { not: null, gte: 0 },
    },
    select: { providerId: true, model: true, responseTime: true, ttftMs: true },
  });

  accumulateDecodeSamples(
    samples.map((s) => ({
      providerId: s.providerId as string,
      model: s.model,
      responseTime: s.responseTime,
      ttftMs: s.ttftMs,
    })),
    acc
  );

  return acc;
}

/** decode 口径速度：tokens>0 且 decodeMs>0 才有效，否则 null（无有效样本） */
const tokPerSec = (tokens: number, decodeMs: number): number | null =>
  tokens > 0 && decodeMs > 0 ? (tokens / decodeMs) * 1000 : null;

/**
 * 按 ['providerId', 'model'] 聚合查询，同时计算「今天」和「最近 30 天」两个窗口（decode 口径）。
 * 无数据的 provider 不会出现在结果中（由调用方按需补 null / []）。
 */
export async function getProviderTokenSpeeds(
  providerIds: string[]
): Promise<Map<string, ProviderTokenSpeed>> {
  const result = new Map<string, ProviderTokenSpeed>();
  if (providerIds.length === 0) return result;

  const now = Date.now();
  const [today, last30d] = await Promise.all([
    aggregate(providerIds, startOfToday()),
    aggregate(providerIds, new Date(now - LAST_30D_DAYS * 24 * 60 * 60 * 1000)),
  ]);

  const ids = new Set([...today.keys(), ...last30d.keys()]);
  for (const providerId of ids) {
    const t = today.get(providerId);
    const l = last30d.get(providerId);
    const modelNames = new Set([...(t?.models.keys() ?? []), ...(l?.models.keys() ?? [])]);
    const modelSpeeds: ModelTokenSpeed[] = [];
    for (const model of modelNames) {
      const tm = t?.models.get(model);
      const lm = l?.models.get(model);
      const speed30d = lm ? tokPerSec(lm.tokens, lm.decodeMs) : null;
      modelSpeeds.push({
        model,
        avgTokenSpeedToday: tm ? tokPerSec(tm.tokens, tm.decodeMs) : null,
        avgTokenSpeed30d: speed30d,
      });
    }
    // 按 30 天速度降序；仅今天有数据的模型（30 天为 null）排在最后，之间按今天速度降序
    modelSpeeds.sort(
      (a, b) =>
        (b.avgTokenSpeed30d ?? -1) - (a.avgTokenSpeed30d ?? -1) ||
        (b.avgTokenSpeedToday ?? -1) - (a.avgTokenSpeedToday ?? -1)
    );
    result.set(providerId, {
      avgTokenSpeedToday: t ? tokPerSec(t.tokens, t.decodeMs) : null,
      avgTokenSpeed30d: l ? tokPerSec(l.tokens, l.decodeMs) : null,
      modelSpeeds,
    });
  }
  return result;
}

/** 格式化为 "123.4"；null/非有限值返回空字符串。 */
function formatSpeedNumber(speed: number | null | undefined): string {
  if (speed === null || speed === undefined || !Number.isFinite(speed) || speed <= 0) {
    return '';
  }
  return speed.toFixed(1);
}

/** 格式化为「今日 123.4 / 30日 98.7 tok/s」；两个值各自无数据就各自空白，都没有返回空字符串。 */
export function formatTokenSpeed(
  today: number | null | undefined,
  last30d: number | null | undefined
): string {
  const parts: string[] = [];
  if (formatSpeedNumber(today)) parts.push(`今日 ${formatSpeedNumber(today)}`);
  if (formatSpeedNumber(last30d)) parts.push(`30日 ${formatSpeedNumber(last30d)}`);
  return parts.length ? `${parts.join(' / ')} tok/s` : '';
}
