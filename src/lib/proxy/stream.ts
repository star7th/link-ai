export interface StreamProxyOptions {
  onDone?: (fullText: string) => void;
  onError?: (error: any) => void;
}

/**
 * Count SSE data chunks (lines starting with "data: ") in raw bytes.
 */
function countSseDataChunks(text: string): number {
  let count = 0;
  let i = 0;
  while ((i = text.indexOf('\ndata: ', i)) !== -1) {
    // Skip lines that are just "data: \n" (empty keep-alive)
    const after = text.substring(i + 7, i + 8);
    if (after && after !== '\n') {
      count++;
    }
    i++;
  }
  // Also check if the very first line is a data chunk
  if (text.startsWith('data: ') && text.length > 6 && text[6] !== '\n') {
    count++;
  }
  return count;
}

/**
 * Readable wrapper around a raw upstream Response body that buffers initial
 * chunks before exposing a live stream. If the upstream errors during the
 * buffer window, the reader throws so callers can failover.
 *
 * Returns `null` when the upstream errors during buffering.
 * Otherwise returns a `{ stream, bufferedChunks, fullText }` object.
 */
export async function bufferUpstreamStream(
  upstreamResponse: Response,
): Promise<{
    stream: ReadableStream<Uint8Array>;
    bufferedChunks: Uint8Array[];
    fullText: string;
} | null> {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) return null;

  const bufferMs = parseInt(process.env.PROXY_STREAM_BUFFER_MS || '1000', 10);
  const minChunks = parseInt(process.env.PROXY_STREAM_MIN_CHUNKS || '2', 10);
  const decoder = new TextDecoder();

  const bufferedChunks: Uint8Array[] = [];
  let bufferedText = '';
  let chunkCount = 0;
  let settled = false;
  let resolveSettle: (() => void) | null = null;
  let upstreamDone = false;
  let upstreamError: Error | null = null;

  // Settle when timeout or min chunks reached
  const timer = setTimeout(() => {
    settled = true;
    resolveSettle?.();
  }, bufferMs);

  function trySettle() {
    if (chunkCount >= minChunks && !settled) {
      settled = true;
      clearTimeout(timer);
      resolveSettle?.();
    }
  }

  // Start reading upstream in the background
  const readLoop = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          upstreamDone = true;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolveSettle?.();
          }
          return;
        }
        bufferedChunks.push(value);
        bufferedText += decoder.decode(value, { stream: true });
        chunkCount++;
        trySettle();
      }
    } catch (err) {
      upstreamError = err instanceof Error ? err : new Error(String(err));
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveSettle?.();
      }
    }
  })();

  // Wait for settle condition
  if (!settled) {
    await new Promise<void>((resolve) => {
      resolveSettle = resolve;
    });
  }

  // If upstream errored during buffering → failover
  if (upstreamError) {
    reader.cancel();
    return null;
  }

  // If upstream finished during buffering (short response / error body)
  // Check if we got any real SSE data
  if (upstreamDone) {
    // Even if upstream is done, we still have buffered data to send
  }

  // Create a live ReadableStream that first drains the buffer, then continues reading
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // First, drain buffered chunks that were accumulated after settle
      while (bufferedChunks.length > 0) {
        controller.enqueue(bufferedChunks.shift()!);
        // Yield to prevent overwhelming the client
        return;
      }

      // Upstream already finished during buffering
      if (upstreamDone) {
        controller.close();
        return;
      }

      // Continue reading from upstream
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        bufferedText += decoder.decode(value, { stream: true });
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return { stream: source, bufferedChunks: [...bufferedChunks], fullText: bufferedText };
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

export function extractReadableText(data: string): string {
  const parts: string[] = [];
  try {
    const lines = data.split('\n').filter((l) => l.startsWith('data: '));
    for (const line of lines) {
      const jsonStr = line.replace('data: ', '').trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const choices = parsed.choices;
        if (Array.isArray(choices)) {
          for (const choice of choices) {
            const delta = choice.delta;
            if (delta?.content) {
              parts.push(delta.content);
            }
          }
        }
      } catch {
        // skip non-JSON lines
      }
    }
  } catch {}
  return parts.join('');
}
