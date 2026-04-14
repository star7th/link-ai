import { prisma } from '../prisma';
import { QuotaMemoryStore } from './memory-store';
import { decrypt } from '../crypto';

const store = new QuotaMemoryStore();
let persistInterval: NodeJS.Timeout | null = null;

export const quotaEngine = {
  store,

  async checkQuota(type: string, refId: string, config: { tokenLimit?: number; requestLimit?: number; period: string }): Promise<{
    allowed: boolean;
    tokenUsage?: number;
    requestUsage?: number;
    tokenLimit?: number;
    requestLimit?: number;
  }> {
    const period = store.getCurrentPeriod(config.period);
    const usage = store.get(type, refId, period);

    if (config.tokenLimit && usage.tokens >= config.tokenLimit) {
      return { allowed: false, tokenUsage: usage.tokens, tokenLimit: config.tokenLimit };
    }
    if (config.requestLimit && usage.requests >= config.requestLimit) {
      return { allowed: false, requestUsage: usage.requests, requestLimit: config.requestLimit };
    }

    return { allowed: true, tokenUsage: usage.tokens, requestUsage: usage.requests };
  },

  recordUsage(type: string, refId: string, tokens: number, period: string): void {
    store.increment(type, refId, period, tokens, 1);
  },

  async recoverFromDB(): Promise<void> {
    const today = store.getPeriodKey();
    const snapshots = await prisma.quotaSnapshot.findMany({
      where: { period: { gte: today.substring(0, 7) } }
    });

    for (const snapshot of snapshots) {
      store.set(snapshot.type, snapshot.refId, snapshot.period, snapshot.usedTokens, snapshot.usedRequests);
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = store.getPeriodKey(yesterday);

    const aggregated = await prisma.auditLog.groupBy({
      by: ['createdAt'],
      where: { createdAt: { gte: yesterday } },
      _sum: { totalTokens: true },
      orderBy: { createdAt: 'asc' }
    });

    for (const agg of aggregated) {
      const day = agg.createdAt.toISOString().split('T')[0];
      if (day > yesterdayStr) {
        const tokens = agg._sum.totalTokens || 0;
        store.increment('provider', 'aggregated', day, tokens, 0);
      }
    }
  },

  async persistToDB(): Promise<void> {
    const entries = store.getAll();

    for (const entry of entries) {
      const [_, type, refId, period] = entry.key.split(':');
      try {
        await prisma.quotaSnapshot.upsert({
          where: { type_refId_period: { type, refId, period } },
          update: { usedTokens: entry.tokens, usedRequests: entry.requests, updatedAt: new Date() },
          create: { type, refId, period, usedTokens: entry.tokens, usedRequests: entry.requests }
        });
      } catch (e) {
        console.error('Failed to persist quota snapshot', e);
      }
    }
  },

  startPersistInterval(): NodeJS.Timeout {
    if (persistInterval) return persistInterval;
    persistInterval = setInterval(() => {
      this.persistToDB();
    }, 60000);
    return persistInterval;
  },

  stopPersistInterval(): void {
    if (persistInterval) {
      clearInterval(persistInterval);
      persistInterval = null;
    }
  }
};
