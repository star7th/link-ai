/**
 * applyModelRedirect 单元测试
 *
 * 测试覆盖：
 * - 正常模型重定向
 * - 无匹配规则时返回原始 body
 * - 空/无效 JSON 规则容错
 * - 无 body 或无 model 字段时跳过
 */

import { describe, it, expect } from 'vitest';
import { applyModelRedirect } from '../engine';

describe('applyModelRedirect', () => {
  it('redirects model when rule matches', () => {
    const body = { model: 'gpt-4', messages: [] };
    const rules = JSON.stringify([{ from: 'gpt-4', to: 'gpt-4-turbo' }]);
    expect(applyModelRedirect(body, rules)).toEqual({ model: 'gpt-4-turbo', messages: [] });
  });

  it('returns original body when no rule matches', () => {
    const body = { model: 'claude-3', messages: [] };
    const rules = JSON.stringify([{ from: 'gpt-4', to: 'gpt-4-turbo' }]);
    expect(applyModelRedirect(body, rules)).toEqual({ model: 'claude-3', messages: [] });
  });

  it('returns original body when modelRedirectStr is null', () => {
    const body = { model: 'gpt-4', messages: [] };
    expect(applyModelRedirect(body, null)).toBe(body);
  });

  it('returns original body when body is null', () => {
    expect(applyModelRedirect(null, JSON.stringify([{ from: 'a', to: 'b' }]))).toBeNull();
  });

  it('returns original body when body has no model field', () => {
    const body = { messages: [] };
    expect(applyModelRedirect(body, JSON.stringify([{ from: 'a', to: 'b' }]))).toBe(body);
  });

  it('handles invalid JSON gracefully', () => {
    const body = { model: 'gpt-4', messages: [] };
    expect(applyModelRedirect(body, 'not-json')).toBe(body);
  });

  it('handles non-array JSON gracefully', () => {
    const body = { model: 'gpt-4', messages: [] };
    expect(applyModelRedirect(body, JSON.stringify({ from: 'a', to: 'b' }))).toBe(body);
  });

  it('applies first matching rule', () => {
    const body = { model: 'gpt-4', messages: [] };
    const rules = JSON.stringify([
      { from: 'gpt-4', to: 'gpt-4-turbo' },
      { from: 'gpt-4', to: 'gpt-4-32k' },
    ]);
    expect(applyModelRedirect(body, rules)).toEqual({ model: 'gpt-4-turbo', messages: [] });
  });

  it('does not mutate original body', () => {
    const body = { model: 'gpt-4', messages: [] };
    const rules = JSON.stringify([{ from: 'gpt-4', to: 'gpt-4-turbo' }]);
    const result = applyModelRedirect(body, rules);
    expect(body.model).toBe('gpt-4');
    expect(result.model).toBe('gpt-4-turbo');
  });
});
