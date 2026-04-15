/**
 * Creates a TransformStream that normalizes SSE events from upstream providers.
 *
 * Some providers (e.g. Zhipu GLM) occasionally emit events without the required
 * `\n\n` separator, causing two `data:` lines to stick together:
 *
 *   data: {"id":"aaa"}data: {"id":"bbb"}
 *
 * This transform inserts the missing `\n\n` so clients parse events correctly.
 * Well-formed SSE (already separated by `\n\n`) passes through unchanged.
 */
export function normalizeSSEStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buf = '';

  return new TransformStream({
    transform(chunk, controller) {
      buf += decoder.decode(chunk, { stream: true });
      flush(controller, false);
    },
    flush(controller) {
      flush(controller, true);
    },
  });

  function flush(controller: TransformStreamDefaultController<Uint8Array>, isFinal: boolean) {
    if (buf.length === 0) return;

    const normalized = insertMissingSeparators(buf);
    buf = normalized;

    if (!isFinal) {
      const lastBoundary = normalized.lastIndexOf('\n\n');
      if (lastBoundary === -1) return;

      const toEmit = normalized.substring(0, lastBoundary + 2);
      buf = normalized.substring(lastBoundary + 2);
      controller.enqueue(encoder.encode(toEmit));
    } else {
      if (normalized.length > 0) {
        controller.enqueue(encoder.encode(normalized));
      }
      buf = '';
    }
  }

  /**
   * Only match `data:` that appears at the start of a line (preceded by
   * start-of-string or \n).  This avoids false positives when the JSON
   * payload itself contains the substring "data:".
   */
  function insertMissingSeparators(text: string): string {
    let result = '';
    let lastIdx = 0;

    const linePattern = /(?:^|\n)(data:)/g;
    let match: RegExpExecArray | null;
    const positions: number[] = [];

    while ((match = linePattern.exec(text)) !== null) {
      positions.push(match.index + (match[0].length - 5));
    }

    if (positions.length <= 1) return text;

    for (let i = 0; i < positions.length; i++) {
      const dataIdx = positions[i];

      if (i === 0) {
        result += text.substring(lastIdx, dataIdx);
      } else {
        const gap = text.substring(lastIdx, dataIdx);
        if (gap.endsWith('\n\n')) {
          result += gap;
        } else if (gap.endsWith('\n')) {
          result += gap + '\n';
        } else {
          result += gap + '\n\n';
        }
      }

      lastIdx = dataIdx;
    }

    result += text.substring(lastIdx);
    return result;
  }
}

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
  let _resolveSettle: (() => void) | null = null;
  let upstreamDone = false;
  let upstreamError: Error | null = null;
  let readLoopFinished = false;
  const resolveSettle = () => _resolveSettle?.();

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

  // Start reading upstream in the background — stops reading once settled
  // so that pull() becomes the sole consumer of the reader afterwards.
  const readLoopPromise = (async () => {
    try {
      while (!settled) {
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
    } finally {
      readLoopFinished = true;
    }
  })();

  // Wait for settle condition
  if (!settled) {
    await new Promise<void>((resolve) => {
      _resolveSettle = resolve;
    });
  }

  // Ensure the read loop has fully exited before we hand the reader to pull()
  await readLoopPromise;

  // If upstream errored during buffering → failover
  if (upstreamError) {
    reader.cancel();
    return null;
  }

  // Snapshot the buffered data for the caller (used in onDone for stats)
  const snapshotChunks = [...bufferedChunks];
  const snapshotText = bufferedText;

  // Create a live ReadableStream that first drains the buffer, then continues reading
  // This is now the ONLY consumer of the reader — no concurrent reads.
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // First, drain buffered chunks that were accumulated during buffering phase
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

      // Continue reading from upstream — we are now the sole reader
      try {
        const { done, value } = await reader.read();
        if (done) {
          upstreamDone = true;
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

  return {
    stream: source,
    bufferedChunks: snapshotChunks,
    fullText: snapshotText,
  };
}

export function createStreamProxy(upstreamResponse: Response, options?: StreamProxyOptions): Response {
  const body = upstreamResponse.body;

  if (!body) {
    return new Response(
      JSON.stringify({ error: { type: 'stream_error', message: 'No upstream body' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let fullBuffer = '';
  const decoder = new TextDecoder();
  const reader = body.getReader();

  // Wrap the upstream body to intercept errors and convert to SSE error event
  let streamCancelled = false;
  const errorHandled = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            try { controller.close(); } catch {}
            return;
          }
          try {
            controller.enqueue(value);
          } catch {
            // Controller closed (cancelled), stop reading
            return;
          }
        }
      } catch (error) {
        if (streamCancelled) return;
        options?.onError?.(error);
        if (streamCancelled) return;
        const errorMsg = JSON.stringify({
          error: { type: 'stream_interrupted', message: '上游连接中断，请重试' },
        });
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${errorMsg}\n\n`));
          controller.close();
        } catch {
          // Controller already closed, ignore
        }
      }
    },
    cancel() {
      streamCancelled = true;
      reader.cancel();
    },
  });

  // Pipe through SSE normalizer, then through a tracker for fullBuffer
  const normalizer = normalizeSSEStream();
  const tracker = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      fullBuffer += decoder.decode(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      options?.onDone?.(fullBuffer);
    },
  });

  const normalizedStream = errorHandled.pipeThrough(normalizer).pipeThrough(tracker);

  return new Response(normalizedStream, {
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
