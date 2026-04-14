export interface StreamProxyOptions {
  onDone?: (fullText: string) => void;
  onError?: (error: any) => void;
}

export function createStreamProxy(upstreamResponse: Response, options?: StreamProxyOptions): Response {
  const reader = upstreamResponse.body?.getReader();

  if (!reader) {
    return new Response(
      JSON.stringify({ error: { type: 'stream_error', message: 'No upstream body' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let fullBuffer = '';

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          options?.onDone?.(fullBuffer);
          controller.close();
          return;
        }
        fullBuffer += new TextDecoder().decode(value);
        controller.enqueue(value);
      } catch (error) {
        options?.onError?.(error);
        const errorMsg = JSON.stringify({
          error: {
            type: 'stream_interrupted',
            message: '上游连接中断，请重试',
          },
        });
        controller.enqueue(new TextEncoder().encode(`data: ${errorMsg}\n\n`));
        controller.close();
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(stream, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export function extractStreamUsage(data: string): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  try {
    const lines = data.split('\n').filter((l) => l.startsWith('data: '));
    for (let i = lines.length - 1; i >= 0; i--) {
      const jsonStr = lines[i].replace('data: ', '').trim();
      if (jsonStr === '[DONE]') continue;
      const parsed = JSON.parse(jsonStr);
      if (parsed.usage) {
        return {
          promptTokens: parsed.usage.prompt_tokens || 0,
          completionTokens: parsed.usage.completion_tokens || 0,
          totalTokens: parsed.usage.total_tokens || 0,
        };
      }
    }
  } catch {}
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
