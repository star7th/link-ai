/**
 * SSE 流处理工具函数单元测试
 *
 * 测试覆盖：
 * - normalizeSSEStream：SSE 分隔符修复
 * - extractStreamUsage：从 SSE 数据提取 token 用量
 * - extractReadableText：从 SSE 数据提取可读文本
 */

import { describe, it, expect } from 'vitest';
import {
  extractStreamUsage,
  extractReadableText,
  normalizeSSEStream,
} from '../stream';

describe('normalizeSSEStream', () => {
  async function pipeThroughNormalizer(input: string): Promise<string> {
    const normalizer = normalizeSSEStream();
    const writer = normalizer.writable.getWriter();
    const reader = normalizer.readable.getReader();

    writer.write(new TextEncoder().encode(input));
    writer.close();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks.map(c => new TextDecoder().decode(c)).join('');
  }

  it('passes well-formed SSE through unchanged', async () => {
    const input = 'data: {"id":"1"}\n\ndata: {"id":"2"}\n\n';
    const output = await pipeThroughNormalizer(input);
    expect(output).toBe(input);
  });

  it('inserts missing \\n between data: lines that have only \\n separator', async () => {
    // This is the real scenario: provider sends \n instead of \n\n between events
    const input = 'data: {"id":"aaa"}\ndata: {"id":"bbb"}\n\n';
    const output = await pipeThroughNormalizer(input);
    expect(output).toContain('data: {"id":"aaa"}\n\ndata: {"id":"bbb"}\n\n');
  });

  it('does not modify data: stuck together without newline (no regex match)', async () => {
    // The normalizer regex only matches data: after \n or at start of string
    // Stuck-together data: without newline is NOT handled by the current implementation
    const input = 'data: {"id":"aaa"}data: {"id":"bbb"}\n\n';
    const output = await pipeThroughNormalizer(input);
    // This passes through as-is (potential improvement area)
    expect(output).toContain('data: {"id":"aaa"}data: {"id":"bbb"}');
  });

  it('handles single data: line without change', async () => {
    const input = 'data: hello\n\n';
    const output = await pipeThroughNormalizer(input);
    expect(output).toBe(input);
  });
});

describe('extractStreamUsage', () => {
  it('extracts usage from the last SSE chunk', () => {
    const data = [
      'data: {"id":"1","choices":[]}',
      'data: {"id":"1","choices":[{"delta":{"content":"hello"}}]}',
      'data: {"id":"1","usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
      'data: [DONE]',
    ].join('\n');

    const usage = extractStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it('returns zeros when no usage is present', () => {
    const data = 'data: {"choices":[]}\ndata: [DONE]\n';
    expect(extractStreamUsage(data)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('handles partial usage fields', () => {
    const data = 'data: {"usage":{"total_tokens":50}}\n';
    const usage = extractStreamUsage(data);
    expect(usage.totalTokens).toBe(50);
    expect(usage.promptTokens).toBe(0);
  });

  it('returns zeros for empty input', () => {
    expect(extractStreamUsage('')).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('skips [DONE] entries', () => {
    const data = 'data: [DONE]\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}\n';
    const usage = extractStreamUsage(data);
    expect(usage.totalTokens).toBe(15);
  });
});

describe('extractReadableText', () => {
  it('concatenates delta content from all SSE chunks', () => {
    const data = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: {"choices":[{"delta":{"content":"!"}}]}',
      'data: [DONE]',
    ].join('\n');

    expect(extractReadableText(data)).toBe('Hello world!');
  });

  it('returns empty string for no content', () => {
    const data = 'data: {"choices":[{"delta":{}}]}\ndata: [DONE]\n';
    expect(extractReadableText(data)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(extractReadableText('')).toBe('');
  });

  it('skips non-JSON lines gracefully', () => {
    const data = 'not-json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n';
    expect(extractReadableText(data)).toBe('ok');
  });

  it('handles chunks without choices array', () => {
    const data = 'data: {"id":"1"}\ndata: {"choices":[{"delta":{"content":"text"}}]}\ndata: [DONE]\n';
    expect(extractReadableText(data)).toBe('text');
  });
});
