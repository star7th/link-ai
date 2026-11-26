/**
 * stream_options.include_usage 注入 + token 估算兜底 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  shouldInjectStreamUsage,
  injectStreamUsage,
  prepareStreamUsageInjection,
  isStreamOptionsRejected,
  markInjectionUnsupported,
  isInjectionUnsupported,
  resetInjectionUnsupportedForTests,
  retryWithoutInjection,
  estimateTokens,
  applyUsageFallback,
  extractNonStreamResponseText,
} from '../usage';

describe('injectStreamUsage', () => {
  it('injects stream_options when absent', () => {
    const body = { model: 'gpt-4', messages: [], stream: true };
    const result = injectStreamUsage(body);
    expect(result.injected).toBe(true);
    expect(result.body).toEqual({ model: 'gpt-4', messages: [], stream: true, stream_options: { include_usage: true } });
  });

  it('leaves body untouched when include_usage already present', () => {
    const body = { stream: true, stream_options: { include_usage: true } };
    const result = injectStreamUsage(body);
    expect(result.injected).toBe(false);
    expect(result.body).toBe(body);
  });

  it('keeps include_usage:false untouched', () => {
    const body = { stream: true, stream_options: { include_usage: false, other: 1 } };
    const result = injectStreamUsage(body);
    expect(result.injected).toBe(false);
    expect(result.body).toBe(body);
  });

  it('only adds include_usage when stream_options lacks it', () => {
    const body = { stream: true, stream_options: { other: 1 } };
    const result = injectStreamUsage(body);
    expect(result.injected).toBe(true);
    expect(result.body).toEqual({ stream: true, stream_options: { other: 1, include_usage: true } });
  });

  it('does not inject for non-stream requests', () => {
    const body = { model: 'gpt-4', messages: [] };
    const result = injectStreamUsage(body);
    expect(result.injected).toBe(false);
    expect(result.body).toBe(body);
  });

  it('does not mutate the original body', () => {
    const body = { stream: true, messages: [] };
    const result = injectStreamUsage(body);
    expect(result.body).not.toBe(body);
    expect(body).not.toHaveProperty('stream_options');
  });
});

describe('shouldInjectStreamUsage', () => {
  it('injects for /v1/chat/completions on openai provider', () => {
    expect(shouldInjectStreamUsage('/v1/chat/completions', 'openai')).toBe(true);
  });

  it('does not inject for anthropic protocol', () => {
    expect(shouldInjectStreamUsage('/v1/chat/completions', 'anthropic')).toBe(false);
  });

  it('does not inject for Responses API', () => {
    expect(shouldInjectStreamUsage('/v1/responses', 'openai')).toBe(false);
  });

  it('does not inject for non-completions paths', () => {
    expect(shouldInjectStreamUsage('/v1/models', 'openai')).toBe(false);
  });
});

describe('prepareStreamUsageInjection', () => {
  beforeEach(() => resetInjectionUnsupportedForTests());

  it('skips injection for provider marked unsupported', () => {
    markInjectionUnsupported('p1');
    const body = { stream: true, messages: [] };
    const result = prepareStreamUsageInjection(body, '/v1/chat/completions', 'openai', 'p1');
    expect(result.injected).toBe(false);
    expect(result.body).toBe(body);
    expect(isInjectionUnsupported('p1')).toBe(true);
    expect(isInjectionUnsupported('p2')).toBe(false);
  });

  it('injects for other providers of same kind', () => {
    markInjectionUnsupported('p1');
    const result = prepareStreamUsageInjection({ stream: true }, '/v1/chat/completions', 'openai', 'p2');
    expect(result.injected).toBe(true);
  });
});

describe('isStreamOptionsRejected', () => {
  it('true for 400 mentioning stream_options', () => {
    expect(isStreamOptionsRejected(400, '{"error":{"message":"Unrecognized request argument supplied: stream_options"}}')).toBe(true);
    expect(isStreamOptionsRejected(400, 'unknown parameter: stream_options.include_usage')).toBe(true);
  });

  it('true for 400 unknown-param wording without the literal name', () => {
    expect(isStreamOptionsRejected(400, 'Additional properties are not allowed (\'include_usage\' was unexpected)')).toBe(true);
    expect(isStreamOptionsRejected(400, 'Unknown name "stream_options"')).toBe(true);
  });

  it('false for non-400 status', () => {
    expect(isStreamOptionsRejected(401, 'stream_options is bad')).toBe(false);
    expect(isStreamOptionsRejected(500, 'unknown parameter')).toBe(false);
  });

  it('false for unrelated 400 errors', () => {
    expect(isStreamOptionsRejected(400, 'Invalid max_tokens: must be greater than 0')).toBe(false);
    expect(isStreamOptionsRejected(400, 'context length exceeded')).toBe(false);
  });
});

describe('retryWithoutInjection', () => {
  beforeEach(() => resetInjectionUnsupportedForTests());

  it('does nothing for non-400 response', async () => {
    const upstream = new Response('ok', { status: 200 });
    const resend = vi.fn();
    const out = await retryWithoutInjection(upstream, resend, 'p1');
    expect(out).toBe(upstream);
    expect(resend).not.toHaveBeenCalled();
    expect(isInjectionUnsupported('p1')).toBe(false);
  });

  it('retries once with original body and marks provider when rejected', async () => {
    const upstream = new Response('Unrecognized request argument supplied: stream_options', { status: 400 });
    const retried = new Response('ok', { status: 200 });
    const resend = vi.fn().mockResolvedValue(retried);
    const out = await retryWithoutInjection(upstream, resend, 'p1');
    expect(out).toBe(retried);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(isInjectionUnsupported('p1')).toBe(true);
  });

  it('does not retry for unrelated 400 and preserves error body', async () => {
    const upstream = new Response('{"error":"bad model"}', { status: 400 });
    const resend = vi.fn();
    const out = await retryWithoutInjection(upstream, resend, 'p1');
    expect(out).not.toBe(upstream);
    expect(out.status).toBe(400);
    expect(await out.text()).toBe('{"error":"bad model"}');
    expect(resend).not.toHaveBeenCalled();
    expect(isInjectionUnsupported('p1')).toBe(false);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('CJK counts ~1 token per char', () => {
    expect(estimateTokens('你好世界')).toBe(4);
  });

  it('other text counts ~4 chars per token, rounded up', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('mixes both runs', () => {
    // 你好 = 2, " world" = 6 chars -> ceil(6/4)=2
    expect(estimateTokens('你好 world')).toBe(4);
  });
});

describe('applyUsageFallback', () => {
  it('keeps real usage untouched', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(applyUsageFallback(usage, '你好')).toBe(usage);
  });

  it('estimates completionTokens when no usage at all', () => {
    expect(applyUsageFallback({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }, '你好世界')).toEqual({
      promptTokens: 0,
      completionTokens: 4,
      totalTokens: 4,
    });
  });

  it('keeps promptTokens and adds estimate when completion missing', () => {
    expect(applyUsageFallback({ promptTokens: 10, completionTokens: 0, totalTokens: 0 }, 'abcd')).toEqual({
      promptTokens: 10,
      completionTokens: 1,
      totalTokens: 11,
    });
  });

  it('returns original usage when text is empty', () => {
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    expect(applyUsageFallback(usage, '')).toBe(usage);
  });
});

describe('extractNonStreamResponseText', () => {
  it('extracts chat completion content', () => {
    const body = { choices: [{ message: { content: 'hello' } }, { message: { content: [{ type: 'text', text: ' world' }] } }] };
    expect(extractNonStreamResponseText(body, false)).toBe('hello world');
  });

  it('extracts responses api output_text', () => {
    const body = { output: [{ type: 'output_text', text: 'hi' }] };
    expect(extractNonStreamResponseText(body, true)).toBe('hi');
  });

  it('returns empty for error bodies', () => {
    expect(extractNonStreamResponseText({ error: 'x' }, false)).toBe('');
    expect(extractNonStreamResponseText(null, false)).toBe('');
  });
});
