/**
 * 脱敏引擎补充测试
 *
 * 覆盖以下场景（主测试文件未覆盖的）：
 * - 无效正则表达式容错
 * - 关键字包含正则特殊字符（如 . * +）
 * - 用户级别规则
 * - Token 级别规则
 * - 关键字替换（不只是 block）
 * - 多条规则链式替换
 * - processResponse 只做替换不做拦截
 * - reloadRules 重新加载
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockRules: any[] = [];
let mockTokenRuleLinks: any[] = [];

vi.mock('@/lib/prisma', () => ({
  default: {
    desensitizeRule: {
      findMany: vi.fn().mockImplementation(async () => mockRules),
    },
    tokenDesensitizeRule: {
      findMany: vi.fn().mockImplementation(async () => mockTokenRuleLinks),
    },
  },
}));

import { DesensitizeEngine } from '../engine';

describe('DesensitizeEngine (additional)', () => {
  let engine: DesensitizeEngine;

  beforeEach(() => {
    engine = new DesensitizeEngine();
    mockRules = [];
    mockTokenRuleLinks = [];
  });

  describe('invalid regex pattern', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'bad-regex',
          name: 'BadRegex',
          scope: 'global',
          ruleType: 'regex',
          pattern: '[invalid(regex',
          replacement: '[REDACTED]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];
    });

    it('handles invalid regex gracefully without throwing', async () => {
      const result = await engine.processRequest('u1', 't1', 'some text with [invalid(regex stuff');
      expect(result.blocked).toBe(false);
      expect(result.content).toBe('some text with [invalid(regex stuff');
      expect(result.hits).toHaveLength(0);
    });
  });

  describe('keyword with regex special chars', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'kw-dot',
          name: 'DotKeyword',
          scope: 'global',
          ruleType: 'keyword',
          pattern: 'C++',
          replacement: '[LANG]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];
    });

    it('keyword matching escapes regex special characters', async () => {
      const result = await engine.processRequest('u1', 't1', 'I love C++ programming');
      expect(result.content).toBe('I love [LANG] programming');
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0].matchCount).toBe(1);
    });
  });

  describe('user-scope rules', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'global-rule',
          name: 'GlobalPhone',
          scope: 'global',
          ruleType: 'regex',
          pattern: '1[3-9]\\d{9}',
          replacement: '[PHONE]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
        {
          id: 'user-rule',
          name: 'UserSpecific',
          scope: 'user',
          ruleType: 'keyword',
          pattern: '内部代号',
          replacement: '[REDACTED]',
          action: 'replace',
          priority: 0,
          userId: 'user-abc',
          isEnabled: true,
        },
      ];
    });

    it('user-scope rules apply only for matching user', async () => {
      // user-abc should see both global + user rules
      const result1 = await engine.processRequest('user-abc', 't1', '联系13812345678 内部代号Alpha');
      expect(result1.content).toContain('[PHONE]');
      expect(result1.content).toContain('[REDACTED]');
      expect(result1.hits).toHaveLength(2);
    });

    it('other users only see global rules', async () => {
      const result2 = await engine.processRequest('user-xyz', 't1', '联系13812345678 内部代号Alpha');
      expect(result2.content).toContain('[PHONE]');
      expect(result2.content).toContain('内部代号Alpha'); // not replaced
      expect(result2.hits).toHaveLength(1);
    });
  });

  describe('token-scope rules', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'token-rule',
          name: 'TokenRule',
          scope: 'token',
          ruleType: 'keyword',
          pattern: '敏感词A',
          replacement: '[FILTERED]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];
      mockTokenRuleLinks = [
        { tokenId: 'tok-1', ruleId: 'token-rule' },
      ];
    });

    it('token-scope rules apply for linked token', async () => {
      const result = await engine.processRequest('u1', 'tok-1', '包含敏感词A');
      expect(result.content).toBe('包含[FILTERED]');
      expect(result.hits).toHaveLength(1);
    });

    it('token-scope rules do not apply for unlinked token', async () => {
      const result = await engine.processRequest('u1', 'tok-other', '包含敏感词A');
      expect(result.content).toBe('包含敏感词A');
      expect(result.hits).toHaveLength(0);
    });
  });

  describe('keyword replace action (not block)', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'kw-replace',
          name: 'KeywordReplace',
          scope: 'global',
          ruleType: 'keyword',
          pattern: '密码',
          replacement: '[SECRET]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];
    });

    it('replaces keyword and continues processing', async () => {
      const result = await engine.processRequest('u1', 't1', '请输入密码');
      expect(result.content).toBe('请输入[SECRET]');
      expect(result.blocked).toBe(false);
    });

    it('replaces multiple occurrences', async () => {
      const result = await engine.processRequest('u1', 't1', '密码1和密码2');
      expect(result.content).toBe('[SECRET]1和[SECRET]2');
      expect(result.hits[0].matchCount).toBe(2);
    });
  });

  describe('chained replacements', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'chain1',
          name: 'Step1',
          scope: 'global',
          ruleType: 'keyword',
          pattern: '步骤1',
          replacement: '步骤2',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
        {
          id: 'chain2',
          name: 'Step2',
          scope: 'global',
          ruleType: 'keyword',
          pattern: '步骤2',
          replacement: '步骤3',
          action: 'replace',
          priority: 1,
          userId: null,
          isEnabled: true,
        },
      ];
    });

    it('applies rules sequentially — output of rule1 feeds into rule2', async () => {
      // Rule1: 步骤1 → 步骤2 (priority 0)
      // Rule2: 步骤2 → 步骤3 (priority 1)
      // After rule1 replaces 步骤1 with 步骤2, rule2 should replace the new 步骤2
      const result = await engine.processRequest('u1', 't1', '开始步骤1');
      expect(result.content).toBe('开始步骤3');
      expect(result.hits).toHaveLength(2);
    });
  });

  describe('reloadRules', () => {
    it('reloads rules on next processRequest', async () => {
      mockRules = [
        {
          id: 'r1',
          name: 'V1Rule',
          scope: 'global',
          ruleType: 'keyword',
          pattern: 'test',
          replacement: '[V1]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];

      const result1 = await engine.processRequest('u1', 't1', 'test content');
      expect(result1.content).toBe('[V1] content');

      // Update mock rules
      mockRules = [
        {
          id: 'r1',
          name: 'V2Rule',
          scope: 'global',
          ruleType: 'keyword',
          pattern: 'test',
          replacement: '[V2]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
      ];

      // processRequest calls loadRules internally, so it picks up new mock
      const result2 = await engine.processRequest('u1', 't1', 'test content');
      expect(result2.content).toBe('[V2] content');
    });
  });

  describe('processResponse with replace rules', () => {
    beforeEach(() => {
      mockRules = [
        {
          id: 'resp-replace',
          name: 'ResponseFilter',
          scope: 'global',
          ruleType: 'keyword',
          pattern: 'internal-error',
          replacement: '[REDACTED]',
          action: 'replace',
          priority: 0,
          userId: null,
          isEnabled: true,
        },
        {
          id: 'resp-block',
          name: 'ResponseBlock',
          scope: 'global',
          ruleType: 'keyword',
          pattern: 'forbidden',
          replacement: '',
          action: 'block',
          priority: 1,
          userId: null,
          isEnabled: true,
        },
      ];
    });

    it('applies replace rules in response', async () => {
      const result = await engine.processResponse('u1', 't1', 'Error: internal-error occurred');
      expect(result.content).toBe('Error: [REDACTED] occurred');
      expect(result.hits).toHaveLength(1);
    });

    it('skips block rules and does not set blocked flag', async () => {
      const result = await engine.processResponse('u1', 't1', 'forbidden word');
      expect(result.content).toBe('forbidden word');
      expect(result.hits).toHaveLength(0);
      // processResponse doesn't have a blocked field in its return type,
      // but it should not throw or behave unexpectedly
    });

    it('response never has blocked=true', async () => {
      const result = await engine.processResponse('u1', 't1', 'some internal-error and forbidden stuff');
      // replace rules should work, block rules should be skipped
      expect(result.content).toContain('[REDACTED]');
      expect(result.content).toContain('forbidden');
    });
  });
});
