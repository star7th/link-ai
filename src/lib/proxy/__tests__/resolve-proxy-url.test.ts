/**
 * resolveProxyUrl 单元测试
 *
 * 测试覆盖：
 * - 裸域名（无路径）直接拼接
 * - 已有 /v1 路径且请求路径也含 /v1 时去重
 * - 已有 /v4 路径时替换 /v1 前缀
 * - dashscope 兼容模式路径处理
 * - 无 /v\d 路径时直接拼接
 * - 尾部斜杠清理
 */

import { describe, it, expect } from 'vitest';
import { resolveProxyUrl } from '../adapter/base';

describe('resolveProxyUrl', () => {
  describe('bare origin (no path in base URL)', () => {
    it('appends request path as-is', () => {
      expect(resolveProxyUrl('https://api.openai.com', '/v1/chat/completions'))
        .toBe('https://api.openai.com/v1/chat/completions');
    });

    it('trims trailing slashes from base', () => {
      expect(resolveProxyUrl('https://api.openai.com/', '/v1/chat/completions'))
        .toBe('https://api.openai.com/v1/chat/completions');
    });
  });

  describe('base URL with /v1 path', () => {
    it('deduplicates when request path starts with /v1', () => {
      expect(resolveProxyUrl('https://api.openai.com/v1', '/v1/chat/completions'))
        .toBe('https://api.openai.com/v1/chat/completions');
    });

    it('deduplicates /v1/models', () => {
      expect(resolveProxyUrl('https://api.openai.com/v1', '/v1/models'))
        .toBe('https://api.openai.com/v1/models');
    });
  });

  describe('base URL with /v4 path (e.g. Zhipu GLM)', () => {
    it('replaces /v1/ prefix in request path with /v4/', () => {
      expect(resolveProxyUrl('https://open.bigmodel.cn/api/paas/v4', '/v1/chat/completions'))
        .toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    });
  });

  describe('dashscope compatible mode', () => {
    it('deduplicates /v1 path', () => {
      expect(resolveProxyUrl('https://dashscope.aliyuncs.com/compatible-mode/v1', '/v1/chat/completions'))
        .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    });
  });

  describe('base URL with non-version path', () => {
    it('appends request path directly', () => {
      expect(resolveProxyUrl('https://custom.api.com/proxy', '/v1/chat/completions'))
        .toBe('https://custom.api.com/proxy/v1/chat/completions');
    });
  });

  describe('edge cases', () => {
    it('handles double trailing slashes', () => {
      const result = resolveProxyUrl('https://api.openai.com//', '/v1/models');
      expect(result).toBe('https://api.openai.com/v1/models');
    });

    it('handles root request path', () => {
      const result = resolveProxyUrl('https://api.openai.com', '/');
      expect(result).toBe('https://api.openai.com/');
    });
  });
});
