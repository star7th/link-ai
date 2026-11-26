import { prisma } from '@/lib/prisma';

/**
 * 平均 token 速度（tok/s）计算口径：
 *   AuditLog 中 logType='request'、responseStatus 为 2xx、completionTokens>0 且 responseTime>0 的记录，
 *   速度 = ΣcompletionTokens ÷ ΣresponseTime(ms) × 1000（累计口径，不是逐请求速度的平均）。
 *   responseTime 为代理记录的请求总耗时（含首 token 等待），流式请求为整段流的总耗时。
 *   无符合条件的记录时返回 null（UI 显示空白）。
 *
 * 统计窗口（两个窗口各自独立计算，各自无数据即 null / 空数组）：
 *   - today：今天，服务器本地时区当日 0 点起
 *   - last30d：最近 30 天
 *
 * 聚合：按 ['providerId', 'model'] groupBy，每个窗口一次查询、覆盖全部传入的 provider，无 N+1。
 *   model 字段为 null 的记录（加字段前的历史数据）计入整体平均值，但不出现在按模型明细中。
 *   model 为请求体里的原始模型名，未做归一化（项目内没有现成的归一化逻辑）。
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
  /** 今天平均速度（tok/s），今天无数据为 null */
  avgTokenSpeedToday: number | null;
  /** 最近 30 天平均速度（tok/s），无数据为 null */
  avgTokenSpeed30d: number | null;
}

export interface ProviderTokenSpeed {
  /** 今天整体平均速度（tok/s），无数据为 null */
  avgTokenSpeedToday: number | null;
  /** 最近 30 天整体平均速度（tok/s），无数据为 null */
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

type Acc = Map<string, { tokens: number; ms: number; models: Map<string, { tokens: number; ms: number }> }>;

async function aggregate(providerIds: string[], since: Date): Promise<Acc> {
  const acc: Acc = new Map();
  const rows = await prisma.auditLog.groupBy({
    by: ['providerId', 'model'],
    where: {
      ...SUCCESS_WHERE,
      providerId: { in: providerIds },
      createdAt: { gte: since },
    },
    _sum: { completionTokens: true, responseTime: true },
  });

  for (const row of rows) {
    if (!row.providerId) continue;
    const tokens = row._sum.completionTokens ?? 0;
    const ms = row._sum.responseTime ?? 0;
    if (tokens <= 0 || ms <= 0) continue;
    let cur = acc.get(row.providerId);
    if (!cur) {
      cur = { tokens: 0, ms: 0, models: new Map() };
      acc.set(row.providerId, cur);
    }
    cur.tokens += tokens;
    cur.ms += ms;
    if (row.model) {
      const m = cur.models.get(row.model) ?? { tokens: 0, ms: 0 };
      m.tokens += tokens;
      m.ms += ms;
      cur.models.set(row.model, m);
    }
  }
  return acc;
}

const tokPerSec = (tokens: number, ms: number): number | null =>
  tokens > 0 && ms > 0 ? (tokens / ms) * 1000 : null;

/**
 * 按 ['providerId', 'model'] 聚合查询，同时计算「今天」和「最近 30 天」两个窗口。
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
      const speed30d = lm ? tokPerSec(lm.tokens, lm.ms) : null;
      modelSpeeds.push({
        model,
        avgTokenSpeedToday: tm ? tokPerSec(tm.tokens, tm.ms) : null,
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
      avgTokenSpeedToday: t ? tokPerSec(t.tokens, t.ms) : null,
      avgTokenSpeed30d: l ? tokPerSec(l.tokens, l.ms) : null,
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
