/**
 * Anthropic 适配器单元测试
 *
 * 测试覆盖：
 * - adaptRequestBody：OpenAI → Anthropic 格式转换
 * - adaptResponse：Anthropic → OpenAI 格式转换
 * - buildUrl：路径处理
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../crypto', () => ({
  decrypt: (v: string) => `decrypted-${v}`,
}));

import { AnthropicAdapter } from '../adapter/anthropic';

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter({
    id: 'p1',
    apiBaseUrl: 'https://api.anthropic.com',
    apiKeyEncrypted: 'encrypted-key',
    protocolType: 'anthropic',
  });

  describe('buildUrl', () => {
    it('prepends /v1 when path does not start with /v1/', () => {
      expect(adapter['buildUrl']('/chat/completions')).toBe(
        'https://api.anthropic.com/v1/chat/completions',
      );
    });

    it('does not double /v1 when path already has it', () => {
      expect(adapter['buildUrl']('/v1/chat/completions')).toBe(
        'https://api.anthropic.com/v1/chat/completions',
      );
    });

    it('trims trailing slash from base URL', () => {
      const a2 = new AnthropicAdapter({
        id: 'p2',
        apiBaseUrl: 'https://api.anthropic.com/',
        apiKeyEncrypted: 'key',
        protocolType: 'anthropic',
      });
      expect(a2['buildUrl']('/chat/completions')).toBe(
        'https://api.anthropic.com/v1/chat/completions',
      );
    });
  });

  describe('adaptRequestBody', () => {
    it('converts OpenAI format to Anthropic format', () => {
      const body = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1024,
        stream: true,
        stop: ['\n'],
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.model).toBe('claude-3-opus');
      expect(adapted.messages).toEqual(body.messages);
      expect(adapted.temperature).toBe(0.7);
      expect(adapted.top_p).toBe(0.9);
      expect(adapted.max_tokens).toBe(1024);
      expect(adapted.stream).toBe(true);
      expect(adapted.stop_sequences).toEqual(['\n']);
      expect(adapted.stop).toBeUndefined();
    });

    it('sets default max_tokens to 4096', () => {
      const body = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'hello' }],
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.max_tokens).toBe(4096);
    });

    it('converts stop string to array', () => {
      const body = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'hello' }],
        stop: '\n',
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.stop_sequences).toEqual(['\n']);
    });

    it('returns body as-is when no messages', () => {
      const body = { model: 'claude-3-opus', data: 'test' };
      expect(adapter['adaptRequestBody'](body)).toEqual(body);
    });

    it('returns null body as-is', () => {
      expect(adapter['adaptRequestBody'](null)).toBeNull();
    });

    it('omits optional fields when not provided', () => {
      const body = {
        model: 'claude-3-opus',
        messages: [{ role: 'user', content: 'hello' }],
      };
      const adapted = adapter['adaptRequestBody'](body);
      expect(adapted.temperature).toBeUndefined();
      expect(adapted.top_p).toBeUndefined();
      expect(adapted.stream).toBeUndefined();
      expect(adapted.stop_sequences).toBeUndefined();
    });
  });

  describe('adaptResponse', () => {
    it('converts Anthropic response to OpenAI format when content is falsy', () => {
      // The adaptResponse converts when content is falsy (null/undefined)
      const anthropicResp = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus',
        content: null,
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const adapted = adapter['adaptResponse'](anthropicResp);
      expect(adapted.object).toBe('chat.completion');
      expect(adapted.choices).toHaveLength(1);
      expect(adapted.choices[0].message.content).toBe('');
      expect(adapted.choices[0].finish_reason).toBe('end_turn');
      expect(adapted.usage.prompt_tokens).toBe(10);
      expect(adapted.usage.completion_tokens).toBe(5);
      expect(adapted.usage.total_tokens).toBe(15);
    });

    it('returns response as-is when content is an array (truthy)', () => {
      const anthropicResp = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-opus',
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      // content is truthy array → returned as-is
      const adapted = adapter['adaptResponse'](anthropicResp);
      expect(adapted.content).toEqual([{ type: 'text', text: 'Hello!' }]);
      expect(adapted.id).toBe('msg_123');
    });

    it('returns response as-is when content is empty array', () => {
      const resp = {
        id: 'msg_123',
        model: 'claude-3-opus',
        content: [],
        stop_reason: 'stop',
        usage: {},
      };
      // Empty array is truthy → returned as-is
      const adapted = adapter['adaptResponse'](resp);
      expect(adapted.content).toEqual([]);
    });

    it('converts response with no content field at all', () => {
      const resp = {
        id: 'msg_456',
        model: 'claude-3-opus',
        usage: { input_tokens: 5, output_tokens: 3 },
      };
      const adapted = adapter['adaptResponse'](resp);
      expect(adapted.object).toBe('chat.completion');
      expect(adapted.choices[0].message.content).toBe('');
      expect(adapted.usage.total_tokens).toBe(8);
    });
  });
});
