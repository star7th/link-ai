import { describe, it, expect } from 'vitest';
import { percentile, summarizeTtft } from '@/lib/admin-stats';
import { bufferUpstreamStream } from '@/lib/proxy/stream';

describe('percentile', () => {
  it('最近秩法：返回第 ceil(p/100*n) 个有序样本', () => {
    expect(percentile([10, 30, 20], 50)).toBe(20);
    expect(percentile([10, 30, 20], 95)).toBe(30);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summarizeTtft', () => {
  it('由样本汇总 P50/P95/平均', () => {
    const s = summarizeTtft([100, 200, 300, 400]);
    expect(s.p50).toBe(200);
    expect(s.p95).toBe(400);
    expect(s.avg).toBe(250);
  });

  it('空样本返回三个 null（无数据时展示 -）', () => {
    expect(summarizeTtft([])).toEqual({ p50: null, p95: null, avg: null });
  });
});

function sseResponse(chunks: string[], delayMs = 0): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream, { status: 200 });
}

describe('bufferUpstreamStream TTFT 采集', () => {
  it('首块数据到达时回调 TTFT，且只回调一次', async () => {
    const ttfts: number[] = [];
    const buffered = await bufferUpstreamStream(
      sseResponse(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']),
      { startTime: Date.now() - 50, onFirstData: (t) => ttfts.push(t) }
    );
    expect(buffered).not.toBeNull();
    expect(ttfts.length).toBe(1);
    expect(ttfts[0]).toBeGreaterThanOrEqual(50);
  });

  it('无回调选项时不报错，仍正常缓冲', async () => {
    const buffered = await bufferUpstreamStream(sseResponse(['data: x\n\n']));
    expect(buffered?.fullText).toContain('data: x');
  });
});
