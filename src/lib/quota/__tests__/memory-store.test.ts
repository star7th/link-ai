/**
 * Quota 内存存储（QuotaMemoryStore）单元测试
 *
 * 测试覆盖：
 * - get / set / increment / delete / clear
 * - getCurrentPeriod 生成正确的日/周/月周期 key
 * - getAll 返回所有条目
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaMemoryStore } from '../memory-store';

let store: QuotaMemoryStore;

beforeEach(() => {
  store = new QuotaMemoryStore();
});

describe('QuotaMemoryStore', () => {
  describe('get / set / increment', () => {
    it('returns zero defaults for unknown keys', () => {
      const usage = store.get('user', 'u1', '2026-04');
      expect(usage.tokens).toBe(0);
      expect(usage.requests).toBe(0);
    });

    it('set stores values, get retrieves them', () => {
      store.set('user', 'u1', '2026-04', 500, 10);
      const usage = store.get('user', 'u1', '2026-04');
      expect(usage.tokens).toBe(500);
      expect(usage.requests).toBe(10);
    });

    it('increment adds to existing values', () => {
      store.set('user', 'u1', '2026-04', 100, 2);
      store.increment('user', 'u1', '2026-04', 50, 1);
      const usage = store.get('user', 'u1', '2026-04');
      expect(usage.tokens).toBe(150);
      expect(usage.requests).toBe(3);
    });

    it('increment on empty key creates entry', () => {
      store.increment('token', 't1', '2026-04', 200, 5);
      const usage = store.get('token', 't1', '2026-04');
      expect(usage.tokens).toBe(200);
      expect(usage.requests).toBe(5);
    });
  });

  describe('delete', () => {
    it('removes a specific key', () => {
      store.set('user', 'u1', '2026-04', 100, 1);
      store.delete('user', 'u1', '2026-04');
      expect(store.get('user', 'u1', '2026-04').tokens).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      store.set('user', 'u1', '2026-04', 100, 1);
      store.set('token', 't1', '2026-04', 200, 2);
      store.clear();
      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('returns all entries with keys', () => {
      store.set('user', 'u1', '2026-04', 100, 1);
      store.set('token', 't1', '2026-04', 200, 2);
      const all = store.getAll();
      expect(all).toHaveLength(2);
      expect(all[0]).toHaveProperty('key');
      expect(all[0]).toHaveProperty('tokens');
      expect(all[0]).toHaveProperty('requests');
    });
  });

  describe('getPeriodKey', () => {
    it('returns YYYY-MM-DD format for a given date', () => {
      const key = store.getPeriodKey(new Date('2026-04-16T00:00:00Z'));
      expect(key).toBe('2026-04-16');
    });
  });

  describe('getCurrentPeriod', () => {
    it('returns monthly period (YYYY-MM)', () => {
      const period = store.getCurrentPeriod('monthly');
      expect(period).toMatch(/^\d{4}-\d{2}$/);
    });

    it('returns weekly period (YYYY-WNN)', () => {
      const period = store.getCurrentPeriod('weekly');
      expect(period).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('returns daily period (YYYY-MM-DD) for unknown type', () => {
      const period = store.getCurrentPeriod('daily');
      expect(period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
