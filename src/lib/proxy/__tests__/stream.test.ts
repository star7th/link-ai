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
  extractResponsesStreamUsage,
  extractResponsesReadableText,
  extractResponsesNonStreamText,
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

describe('extractResponsesStreamUsage', () => {
  it('extracts usage from response.completed event', () => {
    const data = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.content_part.added"}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":200,"total_tokens":300}}}',
      'data: [DONE]',
    ].join('\n');

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
    });
  });

  it('finds response.completed among multiple events', () => {
    const data = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"hello"}}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":50,"output_tokens":80,"total_tokens":130}}}',
    ].join('\n');

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 50,
      completionTokens: 80,
      totalTokens: 130,
    });
  });

  it('returns zeros when no usage info is present', () => {
    const data = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.content_part.added"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesStreamUsage(data)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('returns zeros for empty input', () => {
    expect(extractResponsesStreamUsage('')).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('falls back to top-level usage object', () => {
    const data = 'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":20,"total_tokens":30}}\n';

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it('falls back to prompt_tokens / completion_tokens field names', () => {
    const data = 'data: {"response":{"usage":{"prompt_tokens":15,"completion_tokens":25,"total_tokens":40}}}\n';

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 15,
      completionTokens: 25,
      totalTokens: 40,
    });
  });
});

describe('extractResponsesReadableText', () => {
  it('extracts text from response.content_part.delta events', () => {
    const data = [
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"Hello"}}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Hello');
  });

  it('concatenates multiple delta events in order', () => {
    const data = [
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":" world"}}',
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"!"}}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Hello world!');
  });

  it('only extracts text from delta events, ignoring other event types', () => {
    const data = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"yes"}}',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1}}}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('yes');
  });

  it('returns empty string for empty input', () => {
    expect(extractResponsesReadableText('')).toBe('');
  });

  it('handles [DONE] without errors', () => {
    const data = [
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"ok"}}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('ok');
  });

  it('handles response.output_text.delta with string delta', () => {
    const data = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.output_text.delta","delta":" there"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Hello there');
  });

  it('extracts full text from response.output_text.done fallback', () => {
    const data = [
      'data: {"type":"response.output_text.done","text":"Complete response text"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Complete response text');
  });

  it('extracts text from response.refusal.delta events', () => {
    const data = [
      'data: {"type":"response.refusal.delta","delta":"I cannot "}',
      'data: {"type":"response.refusal.delta","delta":"help with that."}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('I cannot help with that.');
  });

  it('extracts text from response.reasoning.delta with delta.text', () => {
    const data = [
      'data: {"type":"response.reasoning.delta","delta":{"text":"Let me think"}}',
      'data: {"type":"response.reasoning.delta","delta":{"text":" about this."}}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Let me think about this.');
  });

  it('extracts text from response.reasoning.delta with string delta', () => {
    const data = [
      'data: {"type":"response.reasoning.delta","delta":"Reasoning as string"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Reasoning as string');
  });

  it('extracts text from response.reasoning_text.delta events', () => {
    const data = [
      'data: {"type":"response.reasoning_text.delta","delta":"Step 1: "}',
      'data: {"type":"response.reasoning_text.delta","delta":"Analyze the problem."}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Step 1: Analyze the problem.');
  });

  it('handles mixed event types in a single stream', () => {
    const data = [
      'data: {"type":"response.created"}',
      'data: {"type":"response.output_text.delta","delta":"Hello "}',
      'data: {"type":"response.content_part.delta","delta":{"type":"text_delta","text":"world"}}',
      'data: {"type":"response.reasoning.delta","delta":{"text":"(thinking)"}}',
      'data: {"type":"response.refusal.delta","delta":"[refused]"}',
      'data: {"type":"response.output_text.done","text":"final"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('Hello world(thinking)[refused]final');
  });

  it('skips response.reasoning.delta with no extractable text', () => {
    const data = [
      'data: {"type":"response.reasoning.delta","delta":{"summary":"non-text"}}',
      'data: {"type":"response.output_text.delta","delta":"visible"}',
      'data: [DONE]',
    ].join('\n');

    expect(extractResponsesReadableText(data)).toBe('visible');
  });
});

describe('extractResponsesStreamUsage - additional', () => {
  it('handles usage with only total_tokens field', () => {
    const data = 'data: {"type":"response.completed","response":{"usage":{"total_tokens":999}}}\n';

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 999,
    });
  });

  it('prefers response.usage over top-level usage', () => {
    const data = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":20,"total_tokens":30}},"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}\n';

    const usage = extractResponsesStreamUsage(data);
    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });
});

describe('extractResponsesNonStreamText', () => {
  it('extracts output_text from output array', () => {
    const body = {
      status: 'completed',
      output: [{ type: 'output_text', text: 'Hello world' }],
    };
    expect(extractResponsesNonStreamText(body)).toBe('Hello world');
  });

  it('extracts text from message items in output', () => {
    const body = {
      status: 'completed',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Hi there' }],
      }],
    };
    expect(extractResponsesNonStreamText(body)).toBe('Hi there');
  });

  it('concatenates multiple output_text items', () => {
    const body = {
      output: [
        { type: 'output_text', text: 'Part 1. ' },
        { type: 'output_text', text: 'Part 2.' },
      ],
    };
    expect(extractResponsesNonStreamText(body)).toBe('Part 1. Part 2.');
  });

  it('returns empty string for empty output array', () => {
    expect(extractResponsesNonStreamText({ output: [] })).toBe('');
  });

  it('returns empty string when output is missing', () => {
    expect(extractResponsesNonStreamText({})).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    expect(extractResponsesNonStreamText(null)).toBe('');
    expect(extractResponsesNonStreamText(undefined)).toBe('');
  });

  it('skips non-text output items', () => {
    const body = {
      output: [
        { type: 'function_call', name: 'get_weather', arguments: '{}' },
        { type: 'output_text', text: 'The weather is sunny.' },
      ],
    };
    expect(extractResponsesNonStreamText(body)).toBe('The weather is sunny.');
  });

  it('handles multiple message items', () => {
    const body = {
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Msg1' }],
        },
        {
          type: 'message',
          content: [{ type: 'output_text', text: ' Msg2' }],
        },
      ],
    };
    expect(extractResponsesNonStreamText(body)).toBe('Msg1 Msg2');
  });

  it('skips content parts that are not output_text', () => {
    const body = {
      output: [{
        type: 'message',
        content: [
          { type: 'refusal', refusal: 'Nope' },
          { type: 'output_text', text: 'Actual text' },
        ],
      }],
    };
    expect(extractResponsesNonStreamText(body)).toBe('Actual text');
  });
});
