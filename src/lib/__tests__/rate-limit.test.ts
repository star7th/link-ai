/**
 * 速率限制器（Rate Limiter）单元测试
 *
 * 测试覆盖：
 * - RPM（每分钟请求数）限流检查和记录
 * - TPM（每分钟 Token 数）限流检查和记录
 * - retryAfter 计算
 * - reset / cleanup
 * - 窗口过期自动清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { rateLimiter } from '../rate-limit';

beforeEach(() => {
  rateLimiter.reset('token', 't1');
  rateLimiter.reset('provider', 'p1');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimiter', () => {
  describe('RPM', () => {
    it('allows requests under limit', () => {
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('tracks consumed requests via record()', () => {
      rateLimiter.record('token', 't1', 'rpm');
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('rejects when limit is reached', () => {
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it('allows again after window expires', () => {
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');

      // Advance past 60s window
      vi.advanceTimersByTime(61_000);
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });
  });

  describe('TPM', () => {
    it('allows token usage under limit', () => {
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 500);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000);
    });

    it('rejects when projected usage exceeds limit', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 800);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 500);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it('allows exactly at limit (not over)', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 999);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 1);
      expect(result.allowed).toBe(true);
    });

    it('allows when exactly at limit with no new tokens', () => {
      // recorded 1000, check with 0 additional → projected = 1000, limit = 1000 → allowed
      rateLimiter.record('provider', 'p1', 'tpm', 1000);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      expect(result.allowed).toBe(true);
    });

    it('rejects when over limit (projected exceeds)', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 1001);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      expect(result.allowed).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears both rpm and tpm entries', () => {
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'tpm', 100);
      rateLimiter.reset('token', 't1');

      const rpmResult = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(rpmResult.allowed).toBe(true);
      expect(rpmResult.remaining).toBe(3);

      const tpmResult = rateLimiter.check('token', 't1', 'tpm', 100);
      expect(tpmResult.allowed).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('does not throw on cleanup', () => {
      rateLimiter.record('token', 't1', 'rpm');
      vi.advanceTimersByTime(120_000);
      expect(() => rateLimiter.cleanup()).not.toThrow();
    });
  });

  describe('record with count', () => {
    it('records multiple tokens in one call', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 500);
      rateLimiter.record('provider', 'p1', 'tpm', 300);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      expect(result.allowed).toBe(true);
    });
  });

  describe('RPM edge cases', () => {
    it('allows exactly at limit (limit - 1 recorded, check should allow)', () => {
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      // 2 recorded, limit 3 → remaining 1, should allow
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('rejects exactly at limit', () => {
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      // 3 recorded, limit 3 → should reject
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('allows after partial window expiry frees up slots', () => {
      // Record 3 at t=0, then advance 30s (half window), record 1 more at t=30s
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      rateLimiter.record('token', 't1', 'rpm');
      vi.advanceTimersByTime(30_000);
      // Now 3 are still in window (30s < 60s), record another
      rateLimiter.record('token', 't1', 'rpm');
      const result = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result.allowed).toBe(false);

      // Advance past 60s — first 3 should expire
      vi.advanceTimersByTime(31_000);
      const result2 = rateLimiter.check('token', 't1', 'rpm', 3);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('TPM edge cases', () => {
    it('check with no recorded tokens returns full remaining', () => {
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1000);
    });

    it('check with zero tokenCount projects correctly', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 500);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      // total = 500, projected = 500, limit = 1000 → allowed
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(500);
    });

    it('retryAfter is positive when TPM exceeded', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 1500);
      const result = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    });

    it('TPM window expiry allows new usage', () => {
      rateLimiter.record('provider', 'p1', 'tpm', 500);
      const r1 = rateLimiter.check('provider', 'p1', 'tpm', 1000, 400);
      // total=500, projected=900, limit=1000 → allowed
      expect(r1.allowed).toBe(true);

      rateLimiter.record('provider', 'p1', 'tpm', 500);
      const r2 = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      // total=1000, projected=1000, limit=1000 → allowed
      expect(r2.allowed).toBe(true);

      rateLimiter.record('provider', 'p1', 'tpm', 1);
      const r3 = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      // total=1001, projected=1001, limit=1000 → rejected
      expect(r3.allowed).toBe(false);

      // Advance past window
      vi.advanceTimersByTime(61_000);
      const r4 = rateLimiter.check('provider', 'p1', 'tpm', 1000, 0);
      expect(r4.allowed).toBe(true);
    });
  });
});
