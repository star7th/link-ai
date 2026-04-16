/**
 * Anthropic protocol passthrough route.
 *
 * Accepts requests in native Anthropic format (x-api-key / anthropic-version headers,
 * Anthropic body schema) and transparently forwards them to Anthropic-protocol providers.
 * No format conversion is performed — the response is returned as-is from the upstream.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, rateLimiter, quotaEngine, auditLogger, circuitBreaker, alertEngine, hashToken } from '@/lib/engines';
import { applyModelRedirect } from '@/lib/proxy/engine';
import { bufferUpstreamStream } from '@/lib/proxy/stream';
import { resolveProxyUrl } from '@/lib/proxy/adapter/base';
import { decrypt } from '@/lib/crypto';
import { isAuditLogFullBodyEnabled } from '@/lib/system-config';
import { resolveTimeout } from '@/lib/proxy/timeout';
import { authenticateRequest, getClientIp } from '@/lib/proxy/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// HTTP method handlers
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'GET', path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'POST', path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'PUT', path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'DELETE', path);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'PATCH', path);
}

// ---------------------------------------------------------------------------
// Anthropic SSE usage extraction
// ---------------------------------------------------------------------------

/**
 * Extract token usage from a full Anthropic SSE stream text.
 *
 * Anthropic stream events:
 *   - message_start: contains message.usage.input_tokens
 *   - message_delta:  contains usage.output_tokens
 */
// Exported for testing
export function extractAnthropicStreamUsage(fullText: string): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const lines = fullText.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.substring(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);

        // message_start event carries input_tokens
        if (parsed.type === 'message_start' && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens || inputTokens;
        }

        // message_delta event carries output_tokens
        if (parsed.type === 'message_delta' && parsed.usage) {
          outputTokens = parsed.usage.output_tokens || outputTokens;
        }
      } catch {
        // skip non-JSON lines
      }
    }
  } catch {
    // ignore
  }

  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Create a passthrough SSE stream that simply forwards upstream bytes
 * (no normalizeSSEStream — Anthropic SSE format differs from OpenAI).
 * Tracks the full text for onDone usage reporting.
 */
// Exported for testing
export function createPassthroughStream(
  upstreamResponse: Response,
  options?: {
    onDone?: (fullText: string) => void;
    onError?: (error: any) => void;
  }
): Response {
  const body = upstreamResponse.body;
  if (!body) {
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'stream_error', message: 'No upstream body' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let fullBuffer = '';
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let streamCancelled = false;

  const passthrough = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            try { controller.close(); } catch {}
            return;
          }
          fullBuffer += decoder.decode(value, { stream: true });
          try {
            controller.enqueue(value);
          } catch {
            return;
          }
        }
      } catch (error) {
        if (streamCancelled) return;
        options?.onError?.(error);
        const errorMsg = JSON.stringify({
          type: 'error',
          error: { type: 'stream_interrupted', message: 'Upstream connection interrupted' },
        });
        try {
          controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${errorMsg}\n\n`));
          controller.close();
        } catch {
          // controller already closed
        }
      } finally {
        options?.onDone?.(fullBuffer);
      }
    },
    cancel() {
      streamCancelled = true;
      reader.cancel();
    },
  });

  return new Response(passthrough, {
    status: upstreamResponse.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

interface AnthropicProvider {
  id: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  protocolType: string;
  name: string;
  modelRedirect?: string | null;
  timeoutMs?: number | null;
  streamTimeoutMs?: number | null;
}

/**
 * Load the list of Anthropic-protocol providers for a given token.
 * If the token has bound providers, filter for protocolType === 'anthropic'.
 * Otherwise fall back to all active Anthropic providers.
 */
async function getAnthropicProviders(tokenId: string, tokenHash: string): Promise<AnthropicProvider[]> {
  const token = await prisma.token.findUnique({
    where: { keyHash: tokenHash },
    include: {
      tokenProviders: {
        include: { provider: true },
        orderBy: { priority: 'asc' }
      }
    }
  });

  if (!token) return [];

  if (token.tokenProviders.length > 0) {
    return token.tokenProviders
      .filter((tp: any) => tp.provider.protocolType === 'anthropic' && tp.provider.status === 'active')
      .map((tp: any) => ({
        id: tp.provider.id,
        apiBaseUrl: tp.provider.apiBaseUrl,
        apiKeyEncrypted: tp.provider.apiKeyEncrypted,
        protocolType: tp.provider.protocolType,
        name: tp.provider.name,
        modelRedirect: tp.provider.modelRedirect,
        timeoutMs: tp.provider.timeoutMs,
        streamTimeoutMs: tp.provider.streamTimeoutMs,
      }));
  }

  // No providers bound — use all active anthropic providers
  const allProviders = await prisma.provider.findMany({
    where: { status: 'active', protocolType: 'anthropic' },
    orderBy: { name: 'asc' }
  });

  return allProviders.map((p: any) => ({
    id: p.id,
    apiBaseUrl: p.apiBaseUrl,
    apiKeyEncrypted: p.apiKeyEncrypted,
    protocolType: p.protocolType,
    name: p.name,
    modelRedirect: p.modelRedirect,
    timeoutMs: p.timeoutMs,
    streamTimeoutMs: p.streamTimeoutMs,
  }));
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

async function handleRequest(
  request: NextRequest,
  method: string,
  pathSegments: string[]
) {
  const startTime = Date.now();

  // --- Authentication & authorization ---
  const authResult = await authenticateRequest(request, method);
  if ('error' in authResult) return authResult.error;
  const { token, clientIp, userAgent } = authResult.result;

  // --- Path validation ---
  const path = '/' + pathSegments.join('/');
  if (!path.startsWith('/v1/')) {
    return NextResponse.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Only /v1/ paths are supported.' } },
      { status: 400 }
    );
  }

  // --- Parse body ---
  let body: any = null;
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  // --- Desensitization ---
  const { desensitizeEngine } = await import('@/lib/engines');
  const desensitizeHitResults: Array<{ ruleName: string; action: string; matchCount: number }> = [];

  if (body && method === 'POST') {
    const messages = body.messages || [];
    let blocked = false;
    const allHits: Array<{ ruleName: string; action: string; matchCount: number }> = [];

    const processText = async (text: string): Promise<string> => {
      if (!text || blocked) return text;
      const result = await desensitizeEngine.processRequest(token.userId, token.id, text);
      if (result.blocked) {
        blocked = true;
        allHits.push(...result.hits);
        return text;
      }
      if (result.hits.length > 0) {
        allHits.push(...result.hits);
        return result.content;
      }
      return text;
    };

    const processedMessages = [];
    for (const m of messages) {
      if (blocked) {
        processedMessages.push(m);
        continue;
      }
      if (typeof m.content === 'string') {
        const processed = await processText(m.content);
        processedMessages.push({ ...m, content: processed });
      } else if (Array.isArray(m.content)) {
        const processedParts = [];
        for (const part of m.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            const processed = await processText(part.text);
            processedParts.push({ ...part, text: processed });
          } else {
            processedParts.push(part);
          }
        }
        processedMessages.push({ ...m, content: processedParts });
      } else {
        processedMessages.push(m);
      }
    }
    body.messages = processedMessages;

    if (blocked) {
      auditLogger.log({
        tokenId: token.id,
        userId: token.userId,
        logType: 'request',
        action: path,
        requestMethod: method,
        ipAddress: clientIp,
        userAgent,
        responseStatus: 403,
        responseTime: Date.now() - startTime,
        detail: JSON.stringify({ reason: 'Blocked by desensitization rules' }),
        requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
        desensitizeHits: JSON.stringify(allHits),
      });
      return NextResponse.json(
        { type: 'error', error: { type: 'permission_error', message: 'Request blocked by content policy' } },
        { status: 403 }
      );
    }

    if (allHits.length > 0) {
      desensitizeHitResults.push(...allHits);
    }
  }

  const isStream = body?.stream === true || request.headers.get('accept') === 'text/event-stream';

  // --- Load Anthropic providers ---
  const tokenHash = hashTokenFromAuth(request);
  const providers = await getAnthropicProviders(token.id, tokenHash);

  if (providers.length === 0) {
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      logType: 'request',
      action: path,
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 502,
      responseTime: Date.now() - startTime,
      detail: JSON.stringify({ reason: 'No anthropic providers available' }),
      requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
    });
    return NextResponse.json(
      { type: 'error', error: { type: 'api_error', message: 'No Anthropic providers available' } },
      { status: 502 }
    );
  }

  // --- Build upstream headers (passthrough) ---
  const anthropicVersion = request.headers.get('anthropic-version') || '2023-06-01';
  const anthropicBeta = request.headers.get('anthropic-beta');

  function buildUpstreamHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion,
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'Accept': request.headers.get('accept') || 'application/json',
    };
    if (anthropicBeta) {
      headers['anthropic-beta'] = anthropicBeta;
    }
    return headers;
  }

  // --- Stream handling ---
  if (isStream) {
    const failedProviderIds: string[] = [];

    for (const provider of providers) {
      if (!circuitBreaker.isAvailable(provider.id)) {
        failedProviderIds.push(provider.id);
        continue;
      }

      const providerConfig = await prisma.provider.findUnique({ where: { id: provider.id } });
      if (providerConfig?.totalRpmLimit) {
        const rpmCheck = rateLimiter.check('provider', provider.id, 'rpm', providerConfig.totalRpmLimit);
        if (!rpmCheck.allowed) {
          failedProviderIds.push(provider.id);
          continue;
        }
      }
      if (providerConfig?.totalTpmLimit) {
        const tpmCheck = rateLimiter.check('provider', provider.id, 'tpm', providerConfig.totalTpmLimit, 0);
        if (!tpmCheck.allowed) {
          failedProviderIds.push(provider.id);
          continue;
        }
      }

      const providerQuotaCheck = await quotaEngine.checkQuota('provider', provider.id, {
        tokenLimit: providerConfig?.totalTpmLimit ?? undefined,
        period: 'monthly'
      });
      if (!providerQuotaCheck.allowed) {
        failedProviderIds.push(provider.id);
        continue;
      }

      const url = resolveProxyUrl(provider.apiBaseUrl, path);
      try {
        const apiKey = decrypt(provider.apiKeyEncrypted);
        auditLogger.log({ logType: 'debug', action: 'anthropic_forward', detail: url, providerId: provider.id });
        const redirectedBody = applyModelRedirect(body, providerConfig?.modelRedirect || null);
        const headers = buildUpstreamHeaders(apiKey);

        const bodyStr = JSON.stringify(redirectedBody);
        const bodySize = new Blob([bodyStr]).size;
        const timeoutMs = resolveTimeout(providerConfig?.timeoutMs, providerConfig?.streamTimeoutMs, bodySize, true);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let upstream: Response;
        try {
          upstream = await fetch(url, {
            method: request.method,
            headers,
            body: bodyStr,
            signal: controller.signal
          });
        } catch (fetchErr: any) {
          clearTimeout(timer);
          const errMsg = fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message;
          const cause = fetchErr.cause?.message || '';
          throw new Error(`Upstream stream request failed: ${errMsg}${cause ? ` (${cause})` : ''}`, { cause: fetchErr });
        }
        clearTimeout(timer);

        if (upstream.ok && upstream.body) {
          const buffered = await bufferUpstreamStream(upstream);

          if (!buffered) {
            failedProviderIds.push(provider.id);
            circuitBreaker.recordFailure(provider.id, provider.name);
            continue;
          }

          rateLimiter.record('token', token.id, 'rpm');
          if (providerConfig?.totalRpmLimit) {
            rateLimiter.record('provider', provider.id, 'rpm');
          }
          circuitBreaker.recordSuccess(provider.id, provider.name);

          const stream = createPassthroughStream(
            new Response(buffered.stream, {
              status: upstream.status,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
            {
              onDone(fullText) {
                const completeText = buffered.fullText + fullText;
                const usage = extractAnthropicStreamUsage(completeText);

                if (usage.totalTokens > 0) {
                  const period = quotaEngine.store.getCurrentPeriod(token.quotaPeriod);
                  quotaEngine.recordUsage('token', token.id, usage.totalTokens, period);
                }

                isAuditLogFullBodyEnabled().then((logFullBody) => {
                  const hasHits = desensitizeHitResults.length > 0;
                  auditLogger.log({
                    tokenId: token.id,
                    userId: token.userId,
                    providerId: provider.id,
                    logType: 'request',
                    action: path,
                    requestMethod: method,
                    responseStatus: upstream.status,
                    responseTime: Date.now() - startTime,
                    promptTokens: usage.promptTokens,
                    completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                    isStream: true,
                    failover: failedProviderIds.length > 0,
                    ipAddress: clientIp,
                    userAgent,
                    requestBody: (logFullBody || hasHits) && body ? JSON.stringify(body).slice(0, 50000) : undefined,
                    responseBody: logFullBody ? completeText.slice(0, 50000) : undefined,
                    desensitizeHits: hasHits ? JSON.stringify(desensitizeHitResults) : undefined,
                  });
                });
              },
              onError(error) {
                circuitBreaker.recordFailure(provider.id, provider.name);
                auditLogger.log({
                  tokenId: token.id,
                  userId: token.userId,
                  providerId: provider.id,
                  logType: 'request',
                  action: path,
                  requestMethod: method,
                  responseStatus: 502,
                  responseTime: Date.now() - startTime,
                  isStream: true,
                  ipAddress: clientIp,
                  userAgent,
                  detail: JSON.stringify({ reason: 'Stream interrupted', error: error instanceof Error ? error.message : String(error) }),
                  requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
                  responseBody: error instanceof Error ? error.message : String(error),
                  upstreamUrl: url,
                });
              }
            }
          );

          return stream;
        }

        let upstreamRespBody: string | undefined;
        try { upstreamRespBody = (await upstream.text()).slice(0, 50000); } catch {}
        failedProviderIds.push(provider.id);
        circuitBreaker.recordFailure(provider.id, provider.name);
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          providerId: provider.id,
          logType: 'request',
          action: path,
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: upstream.status,
          responseTime: Date.now() - startTime,
          isStream: true,
          detail: JSON.stringify({ reason: 'Provider returned non-ok status', status: upstream.status }),
          requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
          upstreamUrl: url,
          upstreamResponse: upstreamRespBody,
        });
      } catch (error: any) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const causeMsg = error?.cause?.message || '';
        console.error(`[Anthropic stream] Provider ${provider.id} (${provider.name}) failed: ${errMsg}${causeMsg ? ` — cause: ${causeMsg}` : ''}`);
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          providerId: provider.id,
          logType: 'request',
          action: path,
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: 502,
          responseTime: Date.now() - startTime,
          isStream: true,
          detail: JSON.stringify({ reason: 'Provider error', error: errMsg, cause: causeMsg }),
          requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
          upstreamUrl: url,
          upstreamResponse: errMsg,
        });
        failedProviderIds.push(provider.id);
        circuitBreaker.recordFailure(provider.id, provider.name);
      }
    }

    // All providers failed
    const lastError = 'No providers could handle the request';
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      logType: 'request',
      action: path,
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 502,
      responseTime: Date.now() - startTime,
      isStream: true,
      detail: JSON.stringify({
        reason: 'All providers failed',
        providerCount: providers.length,
        failedProviderIds,
      }),
      requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
    });
    return NextResponse.json(
      { type: 'error', error: { type: 'api_error', message: 'All providers failed', detail: lastError } },
      { status: 502 }
    );
  }

  // --- Non-stream handling ---
  const failedProviderIds: string[] = [];

  for (const provider of providers) {
    if (!circuitBreaker.isAvailable(provider.id)) {
      failedProviderIds.push(provider.id);
      continue;
    }

    const providerConfig = await prisma.provider.findUnique({ where: { id: provider.id } });
    if (providerConfig?.totalRpmLimit) {
      const rpmCheck = rateLimiter.check('provider', provider.id, 'rpm', providerConfig.totalRpmLimit);
      if (!rpmCheck.allowed) {
        failedProviderIds.push(provider.id);
        continue;
      }
    }
    if (providerConfig?.totalTpmLimit) {
      const tpmCheck = rateLimiter.check('provider', provider.id, 'tpm', providerConfig.totalTpmLimit, 0);
      if (!tpmCheck.allowed) {
        failedProviderIds.push(provider.id);
        continue;
      }
    }

    const url = resolveProxyUrl(provider.apiBaseUrl, path);
    try {
      const apiKey = decrypt(provider.apiKeyEncrypted);
      auditLogger.log({ logType: 'debug', action: 'anthropic_forward', detail: url, providerId: provider.id });
      const redirectedBody = applyModelRedirect(body, providerConfig?.modelRedirect || null);
      const headers = buildUpstreamHeaders(apiKey);

      const bodyStr = redirectedBody ? JSON.stringify(redirectedBody) : undefined;
      const bodySize = bodyStr ? new Blob([bodyStr]).size : 0;
      const timeoutMs = resolveTimeout(providerConfig?.timeoutMs, providerConfig?.streamTimeoutMs, bodySize, false);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let upstream: Response;
      try {
        upstream = await fetch(url, {
          method: request.method,
          headers,
          body: bodyStr,
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        const errMsg = fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message;
        const cause = fetchErr.cause?.message || '';
        throw new Error(`Upstream request failed: ${errMsg}${cause ? ` (${cause})` : ''}`, { cause: fetchErr });
      }
      clearTimeout(timer);

      if (upstream.ok) {
        circuitBreaker.recordSuccess(provider.id, provider.name);
        if (providerConfig?.totalRpmLimit) {
          rateLimiter.record('provider', provider.id, 'rpm');
        }
        rateLimiter.record('token', token.id, 'rpm');

        // Passthrough: return upstream response as-is
        const respBody = await upstream.text();

        // Extract usage for audit/quota
        let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        try {
          const parsed = JSON.parse(respBody);
          if (parsed.usage) {
            usage.promptTokens = parsed.usage.input_tokens || 0;
            usage.completionTokens = parsed.usage.output_tokens || 0;
            usage.totalTokens = usage.promptTokens + usage.completionTokens;
          }
        } catch {}

        if (usage.totalTokens > 0) {
          const period = quotaEngine.store.getCurrentPeriod(token.quotaPeriod);
          quotaEngine.recordUsage('token', token.id, usage.totalTokens, period);

          if (token.quotaTokenLimit) {
            const quotaCheck = await quotaEngine.checkQuota('token', token.id, { tokenLimit: token.quotaTokenLimit, period: token.quotaPeriod });
            if (quotaCheck.tokenUsage && quotaCheck.tokenLimit) {
              const usagePercent = (quotaCheck.tokenUsage / quotaCheck.tokenLimit) * 100;
              if (usagePercent >= 80) {
                await alertEngine.trigger('quota_warning', {
                  type: 'token',
                  refId: token.id,
                  usage: quotaCheck.tokenUsage,
                  limit: quotaCheck.tokenLimit
                });
              }
            }
          }
        }

        const responseHeaders = new Headers();
        upstream.headers.forEach((value, key) => {
          if (key !== 'content-encoding' && key !== 'transfer-encoding') {
            responseHeaders.set(key, value);
          }
        });

        const logFullBody = await isAuditLogFullBodyEnabled();
        const hasDesensitizeHits = desensitizeHitResults.length > 0;
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          providerId: provider.id,
          logType: 'request',
          action: path,
          requestMethod: method,
          responseStatus: upstream.status,
          responseTime: Date.now() - startTime,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          failover: failedProviderIds.length > 0,
          ipAddress: clientIp,
          userAgent,
          requestBody: (logFullBody || hasDesensitizeHits || upstream.status !== 200) && body ? JSON.stringify(body).slice(0, 50000) : undefined,
          responseBody: (logFullBody || upstream.status !== 200) ? respBody.slice(0, 50000) : undefined,
          desensitizeHits: hasDesensitizeHits ? JSON.stringify(desensitizeHitResults) : undefined,
        });

        return new Response(respBody, {
          status: upstream.status,
          headers: responseHeaders,
        });
      }

      let upstreamRespBody: string | undefined;
      try { upstreamRespBody = (await upstream.text()).slice(0, 50000); } catch {}
      failedProviderIds.push(provider.id);
      circuitBreaker.recordFailure(provider.id, provider.name);
      auditLogger.log({
        tokenId: token.id,
        userId: token.userId,
        providerId: provider.id,
        logType: 'request',
        action: path,
        requestMethod: method,
        ipAddress: clientIp,
        userAgent,
        responseStatus: upstream.status,
        responseTime: Date.now() - startTime,
        detail: JSON.stringify({ reason: 'Provider returned non-ok status', status: upstream.status }),
        requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
        upstreamUrl: url,
        upstreamResponse: upstreamRespBody,
      });
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const causeMsg = error?.cause?.message || '';
      console.error(`[Anthropic] Provider ${provider.id} (${provider.name}) failed: ${errMsg}${causeMsg ? ` — cause: ${causeMsg}` : ''}`);
      auditLogger.log({
        tokenId: token.id,
        userId: token.userId,
        providerId: provider.id,
        logType: 'request',
        action: path,
        requestMethod: method,
        ipAddress: clientIp,
        userAgent,
        responseStatus: 502,
        responseTime: Date.now() - startTime,
        detail: JSON.stringify({ reason: 'Provider error', error: errMsg, cause: causeMsg }),
        requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
        upstreamUrl: url,
        upstreamResponse: errMsg,
      });
      failedProviderIds.push(provider.id);
      circuitBreaker.recordFailure(provider.id, provider.name);
    }
  }

  // All providers failed
  const responseTime = Date.now() - startTime;
  auditLogger.log({
    tokenId: token.id,
    userId: token.userId,
    logType: 'request',
    action: path,
    requestMethod: method,
    responseStatus: 502,
    responseTime,
    ipAddress: clientIp,
    userAgent,
    detail: JSON.stringify({
      reason: 'All providers failed',
      providerCount: providers.length,
      failedProviderIds,
    }),
    requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
  });

  return NextResponse.json(
    { type: 'error', error: { type: 'api_error', message: 'All providers failed', detail: 'No providers could handle the request' } },
    { status: 502 }
  );
}

/**
 * Re-derive the token hash from the auth header.
 * Since we already validated the token in authenticateRequest, this is just
 * needed to look up providers bound to this token.
 */
function hashTokenFromAuth(request: NextRequest): string {
  let apiKey: string | null = null;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7);
  } else {
    const xApiKey = request.headers.get('x-api-key');
    if (xApiKey?.startsWith('lk-')) apiKey = xApiKey;
  }
  return hashToken(apiKey || '');
}
