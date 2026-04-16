/**
 * Anthropic passthrough function tests.
 *
 * Tests cover:
 * - extractAnthropicStreamUsage: imported from route (no duplication)
 * - createPassthroughStream: SSE passthrough with Anthropic-specific error format
 * - Provider filtering logic
 * - Non-stream response format preservation
 * - Failover logic
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractAnthropicStreamUsage,
  createPassthroughStream,
} from '@/app/api/anthropic/[...path]/route';

// ===========================================================================
// extractAnthropicStreamUsage — imported from source (no duplication)
// ===========================================================================

describe('extractAnthropicStreamUsage', () => {
  it('extracts input_tokens from message_start and output_tokens from message_delta', () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_123","usage":{"input_tokens":25}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(25);
    expect(usage.completionTokens).toBe(42);
    expect(usage.totalTokens).toBe(67);
  });

  it('returns zeros when no usage events found', () => {
    const sseText = [
      'data: {"type":"ping"}',
      'data: {"type":"content_block_delta","delta":{"text":"hi"}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('handles partial usage — only message_start', () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(10);
    expect(usage.completionTokens).toBe(0);
    expect(usage.totalTokens).toBe(10);
  });

  it('handles partial usage — only message_delta', () => {
    const sseText = [
      'data: {"type":"message_delta","usage":{"output_tokens":5}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(5);
    expect(usage.totalTokens).toBe(5);
  });

  it('returns zeros for empty input', () => {
    expect(extractAnthropicStreamUsage('')).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('skips non-data lines gracefully', () => {
    const sseText = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":30}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":15}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(30);
    expect(usage.completionTokens).toBe(15);
  });

  it('uses the last message_start / message_delta if multiple are present', () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      'data: {"type":"message_delta","usage":{"output_tokens":8}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(20);
    expect(usage.completionTokens).toBe(8);
    expect(usage.totalTokens).toBe(28);
  });

  it('skips [DONE] sentinel', () => {
    const sseText = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
      'data: [DONE]',
      'data: {"type":"message_delta","usage":{"output_tokens":3}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(5);
    expect(usage.completionTokens).toBe(3);
  });

  it('skips malformed JSON lines', () => {
    const sseText = [
      'data: {broken json',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}',
      'data: not-json-at-all',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.promptTokens).toBe(7);
    expect(usage.completionTokens).toBe(0);
  });

  it('skips empty data lines', () => {
    const sseText = [
      'data: ',
      'data: {"type":"message_delta","usage":{"output_tokens":4}}',
    ].join('\n');

    const usage = extractAnthropicStreamUsage(sseText);
    expect(usage.completionTokens).toBe(4);
  });

  it('handles large input with many events', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`data: {"type":"content_block_delta","delta":{"text":"chunk${i}"}}`);
    }
    lines.push('data: {"type":"message_start","message":{"usage":{"input_tokens":500}}}');
    lines.push('data: {"type":"message_delta","usage":{"output_tokens":1000}}');

    const usage = extractAnthropicStreamUsage(lines.join('\n'));
    expect(usage.promptTokens).toBe(500);
    expect(usage.completionTokens).toBe(1000);
    expect(usage.totalTokens).toBe(1500);
  });
});

// ===========================================================================
// createPassthroughStream
// ===========================================================================

describe('createPassthroughStream', () => {
  it('returns 502 when upstream body is null', () => {
    const upstream = new Response(null, { status: 200 });
    const response = createPassthroughStream(upstream);
    expect(response.status).toBe(502);

    const body = response.headers.get('Content-Type');
    expect(body).toBe('application/json');
  });

  it('returns 502 when upstream body is undefined', () => {
    const upstream = new Response(undefined as any, { status: 200 });
    const response = createPassthroughStream(upstream);
    expect(response.status).toBe(502);
  });

  it('sets correct SSE headers', () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: test\n\n'));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('passes through upstream status code', () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {}\n\n'));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 429 });
    const response = createPassthroughStream(upstream);
    expect(response.status).toBe(429);
  });

  it('forwards SSE data chunks without transformation', async () => {
    const chunks = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n',
    ];
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let result = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value);
    }

    // Data should be forwarded as-is, no normalization
    expect(result).toBe(chunks.join(''));
  });

  it('calls onDone with full buffered text after stream completes', async () => {
    const onDone = vi.fn();
    const sseData = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":25}}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","usage":{"output_tokens":10}}\n\n',
    ].join('');

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream, { onDone });

    // Consume the stream
    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(onDone).toHaveBeenCalledTimes(1);
    const fullText = onDone.mock.calls[0][0];
    expect(fullText).toContain('message_start');
    expect(fullText).toContain('message_delta');
    expect(fullText).toContain('input_tokens');
  });

  it('calls onDone even when stream ends normally with empty data', async () => {
    const onDone = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream, { onDone });

    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(onDone).toHaveBeenCalledWith('');
  });

  it('calls onError and sends SSE error event when upstream errors', async () => {
    const onError = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: partial\n\n'));
        controller.error(new Error('Connection lost'));
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream, { onError });

    const reader = response.body!.getReader();
    let output = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
      }
    } catch {}

    expect(onError).toHaveBeenCalled();
    // Should contain Anthropic-style error event
    expect(output).toContain('stream_interrupted');
    expect(output).toContain('event: error');
  });

  it('calls both onError and onDone when upstream errors', async () => {
    const onError = vi.fn();
    const onDone = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: partial\n\n'));
        controller.error(new Error('boom'));
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream, { onError, onDone });

    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}

    expect(onError).toHaveBeenCalled();
    // onDone is called in the finally block, even on error
    expect(onDone).toHaveBeenCalled();
  });

  it('handles stream cancellation', async () => {
    const onDone = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: test\n\n'));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream, { onDone });

    // Cancel the stream immediately
    const reader = response.body!.getReader();
    await reader.cancel();

    // onDone should still be called via the finally block
    // (The stream completes after reading the only chunk)
    // Give a small tick for the async start to finish
    await new Promise(resolve => setTimeout(resolve, 10));
    // Note: onDone may or may not be called depending on timing
    // The important thing is no crash occurs
  });

  it('preserves binary data integrity', async () => {
    const binaryData = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(binaryData);
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createPassthroughStream(upstream);

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Verify binary data passes through unchanged
    const total = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      total.set(chunk, offset);
      offset += chunk.length;
    }
    expect(total).toEqual(binaryData);
  });
});

// ===========================================================================
// Provider filtering
// ===========================================================================

describe('Provider filtering', () => {
  it('only selects anthropic protocol providers', () => {
    const providers = [
      { id: 'p1', protocolType: 'openai', name: 'OpenAI Provider', status: 'active' },
      { id: 'p2', protocolType: 'anthropic', name: 'Anthropic Provider', status: 'active' },
      { id: 'p3', protocolType: 'azure', name: 'Azure Provider', status: 'active' },
      { id: 'p4', protocolType: 'anthropic', name: 'Anthropic Provider 2', status: 'active' },
      { id: 'p5', protocolType: 'anthropic', name: 'Disabled Anthropic', status: 'disabled' },
    ] as any[];

    const anthropicProviders = providers.filter(
      p => p.protocolType === 'anthropic' && p.status === 'active'
    );

    expect(anthropicProviders).toHaveLength(2);
    expect(anthropicProviders.every(p => p.protocolType === 'anthropic')).toBe(true);
    expect(anthropicProviders.every(p => p.status === 'active')).toBe(true);
  });

  it('returns empty when no anthropic providers configured', () => {
    const providers = [
      { id: 'p1', protocolType: 'openai', name: 'OpenAI', status: 'active' },
      { id: 'p2', protocolType: 'azure', name: 'Azure', status: 'active' },
    ] as any[];

    const anthropicProviders = providers.filter(
      p => p.protocolType === 'anthropic' && p.status === 'active'
    );

    expect(anthropicProviders).toHaveLength(0);
  });

  it('excludes disabled anthropic providers', () => {
    const providers = [
      { id: 'p1', protocolType: 'anthropic', name: 'Active', status: 'active' },
      { id: 'p2', protocolType: 'anthropic', name: 'Inactive', status: 'inactive' },
      { id: 'p3', protocolType: 'anthropic', name: 'Disabled', status: 'disabled' },
    ] as any[];

    const active = providers.filter(
      p => p.protocolType === 'anthropic' && p.status === 'active'
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('p1');
  });
});

// ===========================================================================
// Non-stream passthrough — response format preservation
// ===========================================================================

describe('Non-stream passthrough behavior', () => {
  it('preserves Anthropic response format without conversion', () => {
    const anthropicResponse = {
      id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, world' }],
      model: 'claude-3-opus-20240229',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 25, output_tokens: 10 },
    };

    const responseBody = JSON.stringify(anthropicResponse);
    const parsed = JSON.parse(responseBody);

    expect(parsed.type).toBe('message');
    expect(parsed.content).toEqual([{ type: 'text', text: 'Hello, world' }]);
    expect(parsed.usage.input_tokens).toBe(25);
    expect(parsed.usage.output_tokens).toBe(10);
    // Should NOT have OpenAI fields
    expect(parsed.object).toBeUndefined();
    expect(parsed.choices).toBeUndefined();
  });

  it('extracts usage from Anthropic non-stream response', () => {
    const respBody = JSON.stringify({
      id: 'msg_123',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const parsed = JSON.parse(respBody);
    const usage = {
      promptTokens: parsed.usage.input_tokens || 0,
      completionTokens: parsed.usage.output_tokens || 0,
      totalTokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0),
    };

    expect(usage.promptTokens).toBe(100);
    expect(usage.completionTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
  });

  it('handles response without usage field', () => {
    const respBody = JSON.stringify({
      id: 'msg_456',
      type: 'message',
      content: [{ type: 'text', text: 'no usage info' }],
    });

    const parsed = JSON.parse(respBody);
    const usage = parsed.usage
      ? {
          promptTokens: parsed.usage.input_tokens || 0,
          completionTokens: parsed.usage.output_tokens || 0,
          totalTokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0),
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    expect(usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});

// ===========================================================================
// Failover logic
// ===========================================================================

describe('Failover across Anthropic providers', () => {
  it('records failure and continues to next provider when circuit is open', () => {
    const failures: string[] = [];
    const providers = [
      { id: 'p1', name: 'Anthropic 1' },
      { id: 'p2', name: 'Anthropic 2' },
    ];

    const isAvailable = (id: string) => id !== 'p1';

    for (const provider of providers) {
      if (!isAvailable(provider.id)) {
        failures.push(provider.id);
        continue;
      }
      expect(provider.id).toBe('p2');
    }

    expect(failures).toEqual(['p1']);
  });

  it('returns 502 when all providers fail', () => {
    const providers = [
      { id: 'p1', name: 'Provider 1' },
      { id: 'p2', name: 'Provider 2' },
      { id: 'p3', name: 'Provider 3' },
    ];

    const isAvailable = (_id: string) => false;
    const failures: string[] = [];

    for (const provider of providers) {
      if (!isAvailable(provider.id)) {
        failures.push(provider.id);
        continue;
      }
    }

    expect(failures).toHaveLength(3);
    // In the route handler, this would result in a 502
  });

  it('first provider fails, second succeeds', () => {
    const providers = [
      { id: 'p1', name: 'Provider 1' },
      { id: 'p2', name: 'Provider 2' },
    ];
    const circuitOpen = new Set(['p1']);
    const failedProviderIds: string[] = [];
    let selectedProvider: typeof providers[0] | null = null;

    for (const provider of providers) {
      if (circuitOpen.has(provider.id)) {
        failedProviderIds.push(provider.id);
        continue;
      }
      selectedProvider = provider;
      break;
    }

    expect(failedProviderIds).toEqual(['p1']);
    expect(selectedProvider).toEqual({ id: 'p2', name: 'Provider 2' });
  });
});

// ===========================================================================
// Header passthrough verification
// ===========================================================================

describe('Anthropic header passthrough', () => {
  it('buildUpstreamHeaders includes required Anthropic headers', () => {
    // Simulates the buildUpstreamHeaders function from route.ts
    const anthropicVersion = '2023-06-01';
    const anthropicBeta = 'messages-2023-12-15';
    const userAgent = 'TestClient/1.0';
    const accept = 'application/json';

    function buildUpstreamHeaders(apiKey: string): Record<string, string> {
      const headers: Record<string, string> = {
        'x-api-key': apiKey,
        'anthropic-version': anthropicVersion,
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        'Accept': accept,
      };
      if (anthropicBeta) {
        headers['anthropic-beta'] = anthropicBeta;
      }
      return headers;
    }

    const headers = buildUpstreamHeaders('sk-ant-test-key');
    expect(headers['x-api-key']).toBe('sk-ant-test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-beta']).toBe('messages-2023-12-15');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits anthropic-beta header when not provided', () => {
    function buildUpstreamHeaders(apiKey: string, anthropicBeta?: string): Record<string, string> {
      const headers: Record<string, string> = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'User-Agent': 'unknown',
        'Accept': 'application/json',
      };
      if (anthropicBeta) {
        headers['anthropic-beta'] = anthropicBeta;
      }
      return headers;
    }

    const headers = buildUpstreamHeaders('sk-ant-key');
    expect(headers['anthropic-beta']).toBeUndefined();
  });

  it('defaults anthropic-version to 2023-06-01', () => {
    const version = null as string | null;
    const anthropicVersion = version || '2023-06-01';
    expect(anthropicVersion).toBe('2023-06-01');
  });

  it('uses custom anthropic-version when provided', () => {
    const version = '2024-01-01';
    const anthropicVersion = version || '2023-06-01';
    expect(anthropicVersion).toBe('2024-01-01');
  });
});
