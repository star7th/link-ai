/**
 * createStreamProxy 单元测试
 *
 * 测试覆盖：
 * - 正常流式响应转发
 * - 上游无 body 时返回 502
 * - 错误事件发送 SSE error 消息
 * - onDone 回调收到完整文本
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStreamProxy } from '../stream';

describe('createStreamProxy', () => {
  it('returns 502 when upstream body is null', () => {
    const upstream = new Response(null, { status: 200 });
    const response = createStreamProxy(upstream);
    expect(response.status).toBe(502);
  });

  it('returns 502 when upstream body is undefined', () => {
    const upstream = new Response(undefined as any, { status: 200 });
    const response = createStreamProxy(upstream);
    expect(response.status).toBe(502);
  });

  it('sets correct SSE headers', () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createStreamProxy(upstream);
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
    const response = createStreamProxy(upstream);
    expect(response.status).toBe(429);
  });

  it('calls onDone with full buffered text after stream ends', async () => {
    const onDone = vi.fn();
    const sseData = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createStreamProxy(upstream, { onDone });

    // Consume the stream to trigger onDone
    const reader = response.body!.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(onDone).toHaveBeenCalled();
    expect(onDone.mock.calls[0][0]).toContain('data: {"choices":[{"delta":{"content":"Hi"}}]}');
  });

  it('calls onError when upstream errors', async () => {
    const onError = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.error(new Error('upstream crashed'));
      },
    });
    const upstream = new Response(body, { status: 200 });
    const response = createStreamProxy(upstream, { onError });

    const reader = response.body!.getReader();
    let chunks = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks += new TextDecoder().decode(value);
      }
    } catch {}

    expect(onError).toHaveBeenCalled();
    // The error handler should have sent an SSE error event
    expect(chunks).toContain('stream_interrupted');
  });
});
