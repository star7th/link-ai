/**
 * Anti-flap（防抖动）模块单元测试
 *
 * 测试覆盖：
 * - enterObservation / exitObservation 状态管理
 * - isInObservation 时间窗口判定
 * - recordObservationFailure 累积失败退出观察
 * - clearProvider 清理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isInObservation,
  enterObservation,
  recordObservationFailure,
  exitObservation,
  clearProvider,
} from '../anti-flap';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('anti-flap', () => {
  describe('isInObservation', () => {
    it('returns false for unknown provider', () => {
      expect(isInObservation('unknown')).toBe(false);
    });

    it('returns true right after entering observation', () => {
      enterObservation('p1');
      expect(isInObservation('p1')).toBe(true);
    });

    it('returns false after observation window expires (20 min)', () => {
      enterObservation('p1');
      vi.advanceTimersByTime(20 * 60 * 1000 - 1);
      expect(isInObservation('p1')).toBe(true);
      vi.advanceTimersByTime(2);
      expect(isInObservation('p1')).toBe(false);
    });
  });

  describe('enterObservation', () => {
    it('resets failureCount on entry', () => {
      enterObservation('p1');
      recordObservationFailure('p1');
      recordObservationFailure('p1');
      enterObservation('p1');
      // failureCount should be 0 now
      const exited = recordObservationFailure('p1');
      expect(exited).toBe(false);
    });
  });

  describe('recordObservationFailure', () => {
    it('returns false before 3 failures', () => {
      enterObservation('p1');
      expect(recordObservationFailure('p1')).toBe(false);
      expect(recordObservationFailure('p1')).toBe(false);
    });

    it('returns true on 3rd failure (exits observation)', () => {
      enterObservation('p1');
      recordObservationFailure('p1');
      recordObservationFailure('p1');
      const exited = recordObservationFailure('p1');
      expect(exited).toBe(true);
      // After exit, isInObservation should be false
      expect(isInObservation('p1')).toBe(false);
    });

    it('returns false for provider not in observation', () => {
      expect(recordObservationFailure('unknown')).toBe(false);
    });
  });

  describe('exitObservation', () => {
    it('clears observation state', () => {
      enterObservation('p1');
      exitObservation('p1');
      expect(isInObservation('p1')).toBe(false);
    });
  });

  describe('clearProvider', () => {
    it('removes provider state entirely', () => {
      enterObservation('p1');
      clearProvider('p1');
      expect(isInObservation('p1')).toBe(false);
      // Should not crash
      recordObservationFailure('p1');
    });
  });
});
