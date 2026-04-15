/**
 * DashScope 适配器单元测试
 *
 * 测试覆盖：
 * - adaptRequestBody：OpenAI → DashScope 格式转换
 * - adaptResponse：DashScope → OpenAI 格式转换
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../crypto', () => ({
  decrypt: (v: string) => `decrypted-${v}`,
}));

import { DashScopeAdapter } from '../adapter/dashscope';

describe('DashScopeAdapter', () => {
  const adapter = new DashScopeAdapter({
    id: 'p1',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEncrypted: 'encrypted-key',
    protocolType: 'dashscope',
  });

  describe('adaptRequestBody', () => {
    it('converts OpenAI format to DashScope format', () => {
      const body = {
        model: 'qwen-turbo',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
        stream: true,
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.model).toBe('qwen-turbo');
      expect(adapted.input.messages).toEqual(body.messages);
      expect(adapted.parameters.temperature).toBe(0.7);
      expect(adapted.parameters.top_p).toBe(0.9);
      expect(adapted.parameters.max_tokens).toBe(1024);
      expect(adapted.incremental_output).toBe(true);
    });

    it('handles missing optional fields', () => {
      const body = {
        model: 'qwen-turbo',
        messages: [{ role: 'user', content: 'hello' }],
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.parameters).toEqual({});
      expect(adapted.incremental_output).toBeUndefined();
    });

    it('returns null body as-is', () => {
      expect(adapter['adaptRequestBody'](null)).toBeNull();
    });

    it('uses empty messages array when missing', () => {
      const body = { model: 'qwen-turbo' };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.input.messages).toEqual([]);
    });
  });

  describe('adaptResponse', () => {
    it('returns response as-is when output exists (text format)', () => {
      const dashResp = {
        request_id: 'req-123',
        model: 'qwen-turbo',
        output: {
          text: 'Hello from Qwen!',
          finish_reason: 'stop',
        },
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      // output exists → returns raw response unchanged
      const adapted = adapter['adaptResponse'](dashResp);
      expect(adapted.output.text).toBe('Hello from Qwen!');
      expect(adapted.request_id).toBe('req-123');
    });

    it('handles choices-style output', () => {
      const dashResp = {
        request_id: 'req-456',
        model: 'qwen-turbo',
        output: {
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
          text: 'Hi',
          finish_reason: 'stop',
        },
        usage: {},
      };
      // Since output exists, adaptResponse returns the response as-is
      const adapted = adapter['adaptResponse'](dashResp);
      // The raw DashScope format is returned unchanged
      expect(adapted.output.choices[0].message.content).toBe('Hi');
    });

    it('converts response when output is missing (non-standard)', () => {
      const dashResp = {
        request_id: 'req-789',
        model: 'qwen-turbo',
        usage: {},
      };
      const adapted = adapter['adaptResponse'](dashResp);
      expect(adapted.object).toBe('chat.completion');
      expect(adapted.id).toBe('req-789');
      expect(adapted.choices[0].message.content).toBe('');
    });
  });
});
