/**
 * 配额引擎（quotaEngine）单元测试
 *
 * 测试覆盖：
 * - checkQuota：token 限制、请求限制
 * - recordUsage：增量记录
 * - period 传递到 memory store
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma to prevent DB calls
vi.mock('@/lib/prisma', () => ({
  prisma: {
    quotaSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { quotaEngine } from '../engine';
import { QuotaMemoryStore } from '../memory-store';

describe('quotaEngine', () => {
  let store: QuotaMemoryStore;
  const monthlyPeriod: string = new QuotaMemoryStore().getCurrentPeriod('monthly');
  const dailyPeriod: string = new QuotaMemoryStore().getCurrentPeriod('daily');

  beforeEach(() => {
    quotaEngine.store.clear();
  });

  describe('checkQuota', () => {
    it('allows when under token limit', async () => {
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        tokenLimit: 1000,
        period: 'monthly',
      });
      expect(result.allowed).toBe(true);
      expect(result.tokenUsage).toBe(0);
    });

    it('blocks when token usage equals limit', async () => {
      quotaEngine.store.set('provider', 'p1', monthlyPeriod, 1000, 0);
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        tokenLimit: 1000,
        period: 'monthly',
      });
      expect(result.allowed).toBe(false);
      expect(result.tokenUsage).toBe(1000);
      expect(result.tokenLimit).toBe(1000);
    });

    it('allows when token usage is just under limit', async () => {
      quotaEngine.store.set('provider', 'p1', monthlyPeriod, 999, 0);
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        tokenLimit: 1000,
        period: 'monthly',
      });
      expect(result.allowed).toBe(true);
      expect(result.tokenUsage).toBe(999);
    });

    it('blocks when request count equals limit', async () => {
      quotaEngine.store.set('provider', 'p1', dailyPeriod, 0, 10);
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        requestLimit: 10,
        period: 'daily',
      });
      expect(result.allowed).toBe(false);
      expect(result.requestUsage).toBe(10);
    });

    it('allows when request count is under limit', async () => {
      quotaEngine.store.set('provider', 'p1', dailyPeriod, 0, 5);
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        requestLimit: 10,
        period: 'daily',
      });
      expect(result.allowed).toBe(true);
      expect(result.requestUsage).toBe(5);
    });

    it('token limit check takes precedence over request limit', async () => {
      quotaEngine.store.set('provider', 'p1', monthlyPeriod, 1000, 100);
      const result = await quotaEngine.checkQuota('provider', 'p1', {
        tokenLimit: 1000,
        requestLimit: 200,
        period: 'monthly',
      });
      expect(result.allowed).toBe(false);
      expect(result.tokenLimit).toBe(1000);
    });

    it('isolates different providers', async () => {
      quotaEngine.store.set('provider', 'p1', monthlyPeriod, 999, 0);
      const result1 = await quotaEngine.checkQuota('provider', 'p1', {
        tokenLimit: 1000,
        period: 'monthly',
      });
      expect(result1.allowed).toBe(true);

      const result2 = await quotaEngine.checkQuota('provider', 'p2', {
        tokenLimit: 1000,
        period: 'monthly',
      });
      expect(result2.allowed).toBe(true);
      expect(result2.tokenUsage).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('accumulates tokens and requests across calls', () => {
      quotaEngine.recordUsage('provider', 'p1', 100, monthlyPeriod);
      quotaEngine.recordUsage('provider', 'p1', 200, monthlyPeriod);

      const usage = quotaEngine.store.get('provider', 'p1', monthlyPeriod);
      expect(usage.tokens).toBe(300);
      expect(usage.requests).toBe(2);
    });
  });
});
