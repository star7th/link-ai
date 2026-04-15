/**
 * 告警引擎（AlertEngine）单元测试
 *
 * 测试覆盖：
 * - trigger 条件匹配与冷却时间
 * - 各种告警类型标题/消息生成
 * - 禁用规则跳过
 * - 空规则缓存
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({});
const mockFindUnique = vi.fn().mockResolvedValue({ value: '{}' });

vi.mock('../../prisma', () => ({
  prisma: {
    alertRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    alertLog: {
      create: (...args: any[]) => mockCreate(...args),
      findMany: vi.fn().mockResolvedValue([]),
    },
    systemConfig: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

// Mock channel modules to avoid real HTTP calls
vi.mock('../channels/webhook', () => ({
  sendGenericWebhook: vi.fn().mockResolvedValue({ success: true }),
  sendFeishu: vi.fn().mockResolvedValue({ success: true }),
  sendDingtalk: vi.fn().mockResolvedValue({ success: true }),
  sendWecom: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../channels/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { alertEngine } from '../engine';

describe('AlertEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreate.mockClear();
    mockFindUnique.mockResolvedValue({ value: '{}' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('trigger with no rules', () => {
    it('does not call create when no rules loaded', async () => {
      await alertEngine.trigger('provider_down', { providerName: 'test' });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('trigger with loaded rules', () => {
    let mockFindManyRules: any;

    beforeEach(async () => {
      const { prisma } = await import('../../prisma');
      mockFindManyRules = prisma.alertRule.findMany as any;
      mockFindManyRules.mockResolvedValue([
        {
          id: 'rule1',
          triggerCondition: 'provider_down',
          isEnabled: true,
          cooldown: 60,
          channels: '["console"]',
          recipientAdmins: false,
          recipientUsers: false,
        },
      ]);
      await alertEngine.loadRules();
    });

    it('sends alert and logs it', async () => {
      await alertEngine.trigger('provider_down', { providerName: 'OpenAI' });
      expect(mockCreate).toHaveBeenCalled();
      const callData = mockCreate.mock.calls[0][0].data;
      expect(callData.level).toBe('critical');
      expect(callData.ruleId).toBe('rule1');
    });

    it('respects cooldown period', async () => {
      // Reset cooldown from previous test
      vi.advanceTimersByTime(61_000);
      // First trigger
      await alertEngine.trigger('provider_down', { providerName: 'OpenAI' });
      const callCount1 = mockCreate.mock.calls.length;
      expect(callCount1).toBeGreaterThanOrEqual(1);

      // Second trigger within cooldown — should be skipped
      await alertEngine.trigger('provider_down', { providerName: 'OpenAI' });
      expect(mockCreate.mock.calls.length).toBe(callCount1);

      // Advance past cooldown (60s)
      vi.advanceTimersByTime(61_000);
      await alertEngine.trigger('provider_down', { providerName: 'OpenAI' });
      expect(mockCreate.mock.calls.length).toBe(callCount1 + 1);
    });

    it('handles disabled rules', async () => {
      mockFindManyRules.mockResolvedValue([
        {
          id: 'rule2',
          triggerCondition: 'provider_down',
          isEnabled: false,
          cooldown: 60,
          channels: '["console"]',
          recipientAdmins: false,
          recipientUsers: false,
        },
      ]);
      await alertEngine.loadRules();

      await alertEngine.trigger('provider_down', { providerName: 'OpenAI' });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('alert type mapping', () => {
    beforeEach(async () => {
      const { prisma } = await import('../../prisma');
      (prisma.alertRule.findMany as any).mockResolvedValue([
        {
          id: 'r1',
          triggerCondition: 'quota_warning',
          isEnabled: true,
          cooldown: 0,
          channels: '["console"]',
          recipientAdmins: false,
          recipientUsers: false,
        },
      ]);
      await alertEngine.loadRules();
    });

    it('quota_warning produces warning level', async () => {
      await alertEngine.trigger('quota_warning', {
        type: 'provider',
        refId: 'p1',
        usage: 800,
        limit: 1000,
      });
      const callData = mockCreate.mock.calls[0][0].data;
      expect(callData.level).toBe('warning');
    });

    it('quota_exceeded produces critical level', async () => {
      const { prisma } = await import('../../prisma');
      (prisma.alertRule.findMany as any).mockResolvedValue([
        {
          id: 'r2',
          triggerCondition: 'quota_exceeded',
          isEnabled: true,
          cooldown: 0,
          channels: '["console"]',
          recipientAdmins: false,
          recipientUsers: false,
        },
      ]);
      await alertEngine.loadRules();
      await alertEngine.trigger('quota_exceeded', {
        type: 'provider',
        refId: 'p1',
      });
      const callData = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].data;
      expect(callData.level).toBe('critical');
    });
  });

  describe('getRecentAlerts', () => {
    it('delegates to prisma', async () => {
      const alerts = await alertEngine.getRecentAlerts(10);
      expect(alerts).toEqual([]);
    });
  });
});
