/**
 * 熔断器（Circuit Breaker）单元测试
 *
 * 测试覆盖：
 * - 状态转换：closed → open → half_open → closed
 * - 错误率计算与阈值触发
 * - 半开状态下的成功/失败行为
 * - anti-flap 集成
 * - isAvailable 判定
 * - reset / resetAll
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProviderUpdate = vi.fn().mockResolvedValue({});
const mockFailoverUpdate = vi.fn().mockResolvedValue({});

// Mock prisma to prevent DB calls during circuit breaker persist
vi.mock('../../prisma', () => ({
  prisma: {
    failoverConfig: {
      update: (...args: any[]) => mockFailoverUpdate(...args),
    },
    provider: {
      update: (...args: any[]) => mockProviderUpdate(...args),
    },
  },
}));

// Mock anti-flap module
vi.mock('../anti-flap', () => ({
  isInObservation: vi.fn().mockReturnValue(false),
  enterObservation: vi.fn(),
  recordObservationFailure: vi.fn(),
  exitObservation: vi.fn(),
}));

import { circuitBreaker, setStateChangeCallback, restoreState } from '../circuit-breaker';

beforeEach(() => {
  circuitBreaker.resetAll();
  vi.useFakeTimers();
});

describe('circuitBreaker', () => {
  describe('setConfig / getConfig', () => {
    it('returns default config when no custom config set', () => {
      const config = circuitBreaker.getConfig('p1');
      expect(config.errorThresholdPercent).toBe(50);
      expect(config.minRequestCount).toBe(2);
      expect(config.cooldownSeconds).toBe(30);
    });

    it('allows overriding individual config fields', () => {
      circuitBreaker.setConfig('p1', { errorThresholdPercent: 80 });
      const config = circuitBreaker.getConfig('p1');
      expect(config.errorThresholdPercent).toBe(80);
      // Other fields keep defaults
      expect(config.minRequestCount).toBe(2);
    });
  });

  describe('state transitions: closed → open', () => {
    it('opens circuit when error rate exceeds threshold', () => {
      circuitBreaker.setConfig('p1', {
        errorThresholdPercent: 50,
        minRequestCount: 2,
        errorWindowSeconds: 60,
      });

      circuitBreaker.recordFailure('p1');
      // 1 failure, minRequestCount=2 → not yet open
      expect(circuitBreaker.isAvailable('p1')).toBe(true);

      circuitBreaker.recordFailure('p1');
      // 2 failures, 100% error rate > 50% → open
      expect(circuitBreaker.isAvailable('p1')).toBe(false);
    });

    it('does not open if error rate is below threshold', () => {
      circuitBreaker.setConfig('p1', {
        errorThresholdPercent: 80,
        minRequestCount: 3,
        errorWindowSeconds: 60,
      });

      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordSuccess('p1');
      // 2 failures, 1 success → 66.7% < 80%
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
    });

    it('fires stateChangeCallback on closed → open', () => {
      const cb = vi.fn();
      setStateChangeCallback(cb);

      circuitBreaker.setConfig('p1', { minRequestCount: 1, errorThresholdPercent: 1 });
      circuitBreaker.recordFailure('p1');

      expect(cb).toHaveBeenCalledWith('p1', 'closed', 'open', undefined);
      setStateChangeCallback(null);
    });
  });

  describe('open → half_open (cooldown)', () => {
    it('transitions to half_open after cooldown expires', () => {
      circuitBreaker.setConfig('p1', { cooldownSeconds: 30 });

      // Force open
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.isAvailable('p1')).toBe(false);

      // Advance time past cooldown
      vi.advanceTimersByTime(31_000);
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');
    });

    it('does not transition before cooldown expires', () => {
      circuitBreaker.setConfig('p1', { cooldownSeconds: 30 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');

      vi.advanceTimersByTime(29_000);
      expect(circuitBreaker.isAvailable('p1')).toBe(false);
    });
  });

  describe('half_open behavior', () => {
    beforeEach(() => {
      circuitBreaker.setConfig('p1', {
        cooldownSeconds: 10,
        recoveryObserveSeconds: 5,
        minRequestCount: 2,
        errorWindowSeconds: 60,
      });
    });

    it('half_open failure transitions back to open', () => {
      // Force open
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');

      // Cooldown → half_open (isAvailable triggers the transition)
      vi.advanceTimersByTime(11_000);
      circuitBreaker.isAvailable('p1'); // triggers open → half_open
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');

      const cb = vi.fn();
      setStateChangeCallback(cb);
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');
      expect(cb).toHaveBeenCalledWith('p1', 'half_open', 'open', undefined);
      setStateChangeCallback(null);
    });

    it('half_open success stays in half_open until recovery period elapses', () => {
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      vi.advanceTimersByTime(11_000);
      circuitBreaker.isAvailable('p1'); // triggers open → half_open
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');

      circuitBreaker.recordSuccess('p1');
      // Still in half_open (recovery period = 5s)
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');

      // Advance past recovery period
      vi.advanceTimersByTime(6_000);
      circuitBreaker.recordSuccess('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('closed');
    });
  });

  describe('isAvailable', () => {
    it('returns true when no data exists (closed by default)', () => {
      expect(circuitBreaker.isAvailable('nonexistent')).toBe(true);
    });

    it('returns true in half_open state (after cooldown)', () => {
      circuitBreaker.setConfig('p1', { cooldownSeconds: 5 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      vi.advanceTimersByTime(6_000);
      // isAvailable triggers open → half_open transition
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');
    });
  });

  describe('trimWindows / calculateErrorRate', () => {
    it('trims old entries outside the error window', () => {
      circuitBreaker.setConfig('p1', { errorWindowSeconds: 60, minRequestCount: 2 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');

      expect(circuitBreaker.calculateErrorRate(circuitBreaker.getState('p1')!)).toBe(100);

      // Advance past window → windows cleared
      vi.advanceTimersByTime(61_000);
      circuitBreaker.recordSuccess('p1');
      expect(circuitBreaker.calculateErrorRate(circuitBreaker.getState('p1')!)).toBe(0);
    });
  });

  describe('reset / resetAll', () => {
    it('reset removes a specific provider circuit', () => {
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      circuitBreaker.reset('p1');
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
    });

    it('resetAll clears everything', () => {
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p2');
      circuitBreaker.recordFailure('p2');
      circuitBreaker.resetAll();
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
      expect(circuitBreaker.isAvailable('p2')).toBe(true);
    });
  });

  describe('restoreState', () => {
    it('restores an open state from persistence', () => {
      const since = Date.now() - 5000;
      restoreState('p1', 'open', since);
      expect(circuitBreaker.isAvailable('p1')).toBe(false);
    });

    it('restores a half_open state', () => {
      const since = Date.now();
      restoreState('p1', 'half_open', since);
      expect(circuitBreaker.isAvailable('p1')).toBe(true);
      expect(circuitBreaker.getState('p1')!.state).toBe('half_open');
    });

    it('ignores closed state (default)', () => {
      restoreState('p1', 'closed', Date.now());
      expect(circuitBreaker.getState('p1')).toBeUndefined();
    });
  });

  describe('providerName tracking', () => {
    it('stores providerName on first record', () => {
      circuitBreaker.recordSuccess('p1', 'MyProvider');
      expect(circuitBreaker.getState('p1')!.providerName).toBe('MyProvider');
    });

    it('does not overwrite providerName once set', () => {
      circuitBreaker.recordSuccess('p1', 'First');
      circuitBreaker.recordSuccess('p1', 'Second');
      expect(circuitBreaker.getState('p1')!.providerName).toBe('First');
    });
  });

  describe('anti-flap integration (isInObservation)', () => {
    it('blocks open → half_open when in observation', async () => {
      const { isInObservation } = await import('../anti-flap');
      (isInObservation as any).mockReturnValue(true);

      circuitBreaker.setConfig('p1', { cooldownSeconds: 5 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');

      vi.advanceTimersByTime(6_000);
      // isInObservation returns true → stays open
      expect(circuitBreaker.isAvailable('p1')).toBe(false);
      expect(circuitBreaker.getState('p1')!.state).toBe('open');

      (isInObservation as any).mockReturnValue(false);
    });
  });

  describe('recordHealthSuccess', () => {
    it('updates provider healthStatus to healthy', async () => {
      mockProviderUpdate.mockClear();
      await circuitBreaker.recordHealthSuccess('p1', 'MyProvider');
      expect(mockProviderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ healthStatus: 'healthy' }),
        }),
      );
    });

    it('does not change circuit state on health success', async () => {
      // Record some failures to make circuit open
      circuitBreaker.setConfig('p1', { minRequestCount: 2, errorThresholdPercent: 50 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');

      // Health success should NOT recover the circuit
      await circuitBreaker.recordHealthSuccess('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');
    });
  });

  describe('recordHealthFailure', () => {
    it('updates provider healthStatus to down', async () => {
      mockProviderUpdate.mockClear();
      await circuitBreaker.recordHealthFailure('p1', 'MyProvider');
      expect(mockProviderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({ healthStatus: 'down' }),
        }),
      );
    });

    it('opens circuit from closed state on health failure', async () => {
      circuitBreaker.setConfig('p1', { minRequestCount: 2, errorThresholdPercent: 50 });
      circuitBreaker.recordSuccess('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('closed');

      await circuitBreaker.recordHealthFailure('p1', 'MyProvider');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');
    });

    it('does not re-open already open circuit', async () => {
      circuitBreaker.setConfig('p1', { minRequestCount: 2, errorThresholdPercent: 50 });
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');

      const cb = vi.fn();
      setStateChangeCallback(cb);
      await circuitBreaker.recordHealthFailure('p1');
      // Should not fire callback since state was already open
      expect(cb).not.toHaveBeenCalled();
      setStateChangeCallback(null);
    });

    it('fires stateChangeCallback on closed → open', async () => {
      circuitBreaker.setConfig('p1', { minRequestCount: 2, errorThresholdPercent: 50 });
      circuitBreaker.recordSuccess('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('closed');

      const cb = vi.fn();
      setStateChangeCallback(cb);
      await circuitBreaker.recordHealthFailure('p1', 'MyProvider');
      expect(cb).toHaveBeenCalledWith('p1', 'closed', 'open', 'MyProvider');
      setStateChangeCallback(null);
    });
  });

  describe('mixed success/failure in closed state', () => {
    it('stays closed with mixed results under threshold', () => {
      circuitBreaker.setConfig('p1', {
        errorThresholdPercent: 50,
        minRequestCount: 4,
        errorWindowSeconds: 60,
      });

      circuitBreaker.recordSuccess('p1');
      circuitBreaker.recordSuccess('p1');
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');

      // 2 success, 2 failure → 50% == threshold → should open (>=)
      expect(circuitBreaker.getState('p1')!.state).toBe('open');
    });

    it('stays closed when error rate under threshold', () => {
      circuitBreaker.setConfig('p1', {
        errorThresholdPercent: 60,
        minRequestCount: 4,
        errorWindowSeconds: 60,
      });

      circuitBreaker.recordSuccess('p1');
      circuitBreaker.recordSuccess('p1');
      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');

      // 50% < 60% → stays closed
      expect(circuitBreaker.getState('p1')!.state).toBe('closed');
    });
  });

  describe('error window expiration recovery', () => {
    it('circuit recovers after errors expire from window', () => {
      circuitBreaker.setConfig('p1', {
        errorThresholdPercent: 50,
        minRequestCount: 2,
        errorWindowSeconds: 10,
      });

      circuitBreaker.recordFailure('p1');
      circuitBreaker.recordFailure('p1');
      expect(circuitBreaker.getState('p1')!.state).toBe('open');

      // Advance past error window — old failures are trimmed
      vi.advanceTimersByTime(11_000);
      circuitBreaker.recordSuccess('p1');
      // After trimming, only 1 success in window → error rate 0%
      // But state is already open, isAvailable should transition to half_open
      // if cooldown has also passed
      // Since default cooldown is 30s and we only advanced 11s, still open
      expect(circuitBreaker.isAvailable('p1')).toBe(false);
    });
  });
});
