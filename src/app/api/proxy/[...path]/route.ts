import { NextRequest, NextResponse } from 'next/server';
import { prisma, proxyEngine, hashToken, rateLimiter, quotaEngine, auditLogger, circuitBreaker, alertEngine } from '@/lib/engines';
import { applyModelRedirect } from '@/lib/proxy/engine';
import { desensitizeEngine } from '@/lib/desensitize/engine';
import { createStreamProxy, extractStreamUsage, extractReadableText, bufferUpstreamStream } from '@/lib/proxy/stream';
import { setupProviderConfigs } from '@/lib/proxy/engine';
import { resolveProxyUrl } from '@/lib/proxy/adapter/base';
import { decrypt } from '@/lib/crypto';
import { isAuditLogFullBodyEnabled } from '@/lib/system-config';
import { resolveTimeout } from '@/lib/proxy/timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return null;
  }

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
      const colonIndex = decoded.indexOf(':');
      const username = colonIndex >= 0 ? decoded.substring(0, colonIndex) : decoded;
      if (username.startsWith('lk-')) {
        return username;
      }
      return username || null;
    } catch {
      return null;
    }
  }

  return null;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}

async function checkIpRules(tokenId: string, ip: string): Promise<boolean> {
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: { tokenIpRules: true }
  });

  if (!token) return false;

  if (token.ipRuleMode === 'allow_all') return true;

  const ipRules = token.tokenIpRules;
  const ipNum = ip === 'unknown' ? 0 : ip.split('.').reduce((acc: number, octet: string) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;

  for (const rule of ipRules) {
    if (rule.ruleType === 'whitelist') {
      const [ruleIp, mask] = rule.ipCidr.split('/');
      const ruleIpNum = ruleIp.split('.').reduce((acc: number, octet: string) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      const maskBits = parseInt(mask || '32', 10);
      const maskNum = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;

      if ((ipNum & maskNum) === (ruleIpNum & maskNum)) {
        return true;
      }
    } else if (rule.ruleType === 'blacklist') {
      const [ruleIp, mask] = rule.ipCidr.split('/');
      const ruleIpNum = ruleIp.split('.').reduce((acc: number, octet: string) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      const maskBits = parseInt(mask || '32', 10);
      const maskNum = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;

      if ((ipNum & maskNum) === (ruleIpNum & maskNum)) {
        return false;
      }
    }
  }

  return token.ipRuleMode === 'whitelist';
}

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

async function handleRequest(
  request: NextRequest,
  method: string,
  pathSegments: string[]
) {
  const startTime = Date.now();
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';

  const apiKey = getBearerToken(request);
  if (!apiKey) {
    auditLogger.log({
      logType: 'operation',
      action: 'api_request',
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 401,
      detail: JSON.stringify({ reason: 'Missing or invalid authorization header' })
    });
    return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
  }

  const tokenHash = hashToken(apiKey);
  const token = await prisma.token.findUnique({
    where: { keyHash: tokenHash },
    include: { user: true }
  });

  if (!token || token.status !== 'active') {
    auditLogger.log({
      tokenId: token?.id,
      userId: token?.userId,
      logType: 'operation',
      action: 'api_request',
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 401,
      detail: JSON.stringify({ reason: token ? 'Token inactive' : 'Token not found' })
    });
    return NextResponse.json({ error: 'Invalid or inactive token' }, { status: 401 });
  }

  if (token.expiresAt && token.expiresAt < new Date()) {
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      logType: 'operation',
      action: 'api_request',
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 401,
      detail: JSON.stringify({ reason: 'Token expired' })
    });
    return NextResponse.json({ error: 'Token expired' }, { status: 401 });
  }

  const ipAllowed = await checkIpRules(token.id, clientIp);
  if (!ipAllowed) {
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      logType: 'operation',
      action: 'api_request',
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 403,
      detail: JSON.stringify({ reason: 'IP not allowed' })
    });
    return NextResponse.json({ error: 'IP not allowed' }, { status: 403 });
  }

  const rpmCheck = rateLimiter.check('token', token.id, 'rpm', token.rpmLimit || 60);
  if (!rpmCheck.allowed) {
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      logType: 'operation',
      action: 'api_request',
      requestMethod: method,
      ipAddress: clientIp,
      userAgent,
      responseStatus: 429,
      detail: JSON.stringify({ reason: 'Rate limit exceeded', retryAfter: rpmCheck.retryAfter })
    });
    return NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rpmCheck.retryAfter }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    include: {
      groupMembers: {
        include: {
          group: {
            include: {
              groupQuotas: true
            }
          }
        }
      }
    }
  });

  if (user) {
    let userTokenLimit = user.quotaTokenLimit;
    let userRequestLimit = user.quotaRequestLimit;

    for (const member of user.groupMembers) {
      for (const quota of member.group.groupQuotas) {
        if (quota.quotaType === 'token_count') {
          userTokenLimit = userTokenLimit ? Math.max(userTokenLimit, quota.quotaLimit) : quota.quotaLimit;
        } else if (quota.quotaType === 'request_count') {
          userRequestLimit = userRequestLimit ? Math.max(userRequestLimit, quota.quotaLimit) : quota.quotaLimit;
        }
      }
    }

    if (userTokenLimit) {
      const userQuotaCheck = await quotaEngine.checkQuota('user', user.id, {
        tokenLimit: userTokenLimit,
        period: user.quotaPeriod
      });
      if (!userQuotaCheck.allowed) {
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          logType: 'operation',
          action: 'api_request',
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: 429,
          detail: JSON.stringify({ reason: 'User quota exceeded' })
        });
        return NextResponse.json({ error: 'User quota exceeded' }, { status: 429 });
      }
    }

    if (userRequestLimit) {
      const userRequestCheck = await quotaEngine.checkQuota('user', user.id, {
        requestLimit: userRequestLimit,
        period: user.quotaPeriod
      });
      if (!userRequestCheck.allowed) {
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          logType: 'operation',
          action: 'api_request',
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: 429,
          detail: JSON.stringify({ reason: 'User request quota exceeded' })
        });
        return NextResponse.json({ error: 'User request quota exceeded' }, { status: 429 });
      }
    }
  }

  if (token.quotaTokenLimit) {
    const tokenQuotaCheck = await quotaEngine.checkQuota('token', token.id, {
      tokenLimit: token.quotaTokenLimit,
      period: token.quotaPeriod
    });
    if (!tokenQuotaCheck.allowed) {
      auditLogger.log({
        tokenId: token.id,
        userId: token.userId,
        logType: 'operation',
        action: 'api_request',
        requestMethod: method,
        ipAddress: clientIp,
        userAgent,
        responseStatus: 429,
        detail: JSON.stringify({ reason: 'Token quota exceeded' })
      });
      return NextResponse.json({ error: 'Token quota exceeded' }, { status: 429 });
    }
  }

  if (token.quotaRequestLimit) {
    const tokenRequestCheck = await quotaEngine.checkQuota('token', token.id, {
      requestLimit: token.quotaRequestLimit,
      period: token.quotaPeriod
    });
    if (!tokenRequestCheck.allowed) {
      auditLogger.log({
        tokenId: token.id,
        userId: token.userId,
        logType: 'operation',
        action: 'api_request',
        requestMethod: method,
        ipAddress: clientIp,
        userAgent,
        responseStatus: 429,
        detail: JSON.stringify({ reason: 'Token request quota exceeded' })
      });
      return NextResponse.json({ error: 'Token request quota exceeded' }, { status: 429 });
    }
  }

  const path = '/' + pathSegments.join('/');

  if (!path.startsWith('/v1/')) {
    return NextResponse.json({ error: 'Unsupported proxy path. Only /v1/ paths are allowed.' }, { status: 400 });
  }

  let body: any = null;
  const contentType = request.headers.get('content-type') || '';
  const desensitizeHitResults: Array<{ ruleName: string; action: string; matchCount: number }> = [];

  if (contentType.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      body = null;
    }
  }

  if (body && method === 'POST' && path.includes('/completions')) {
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
      return NextResponse.json({ error: 'Request blocked by desensitization rules' }, { status: 403 });
    }

    if (allHits.length > 0) {
      desensitizeHitResults.push(...allHits);
    }
  }

  const isStream = body?.stream === true || request.headers.get('accept') === 'text/event-stream';

  try {
    if (isStream) {
      const tokenRecord = await prisma.token.findUnique({
        where: { keyHash: tokenHash },
        include: {
          tokenProviders: {
            include: { provider: true },
            orderBy: { priority: 'asc' }
          }
        }
      });

      if (!tokenRecord) {
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          logType: 'request',
          action: path,
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: 404,
          responseTime: Date.now() - startTime,
          detail: JSON.stringify({ reason: 'Token not found when loading providers' }),
          requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
        });
        return NextResponse.json({ error: 'Token not found' }, { status: 404 });
      }

      let providerList = tokenRecord.tokenProviders;
      if (providerList.length === 0) {
        const allActiveProviders = await prisma.provider.findMany({
          where: { status: 'active' },
          orderBy: { name: 'asc' }
        });
        providerList = allActiveProviders.map((p: any) => ({ provider: p, priority: 1 })) as any;
      }

      const failedProviderIds: string[] = [];

      // Single provider: no failover, use 2-minute timeout
      if (providerList.length === 1) {
        const tp = providerList[0];
        const providerConfig = await prisma.provider.findUnique({ where: { id: tp.provider.id } });
        const apiKey = decrypt(tp.provider.apiKeyEncrypted);
        const url = resolveProxyUrl(tp.provider.apiBaseUrl, path);
        const redirectedBody = applyModelRedirect(body, providerConfig?.modelRedirect || null);

        const headers: Record<string, string> = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'Accept': request.headers.get('accept') || 'application/json',
        };

        try {
          const bodyStr = JSON.stringify(redirectedBody);
          const bodySize = new Blob([bodyStr]).size;
          const timeoutMs = resolveTimeout(tp.provider.timeoutMs, tp.provider.streamTimeoutMs, bodySize, true);
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
            throw new Error(`Upstream stream request failed: ${fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message}`);
          }
          clearTimeout(timer);

          if (upstream.ok && upstream.body) {
            const buffered = await bufferUpstreamStream(upstream);

            if (!buffered) {
              circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
              throw new Error('Single provider stream buffering failed');
            }

            rateLimiter.record('token', token.id, 'rpm');
            if (providerConfig?.totalRpmLimit) {
              rateLimiter.record('provider', tp.provider.id, 'rpm');
            }
            circuitBreaker.recordSuccess(tp.provider.id, tp.provider.name);

            const stream = createStreamProxy(
              new Response(buffered.stream, {
                status: upstream.status,
                headers: { 'Content-Type': 'text/event-stream' },
              }),
              {
                onDone(fullText) {
                  const completeText = buffered.fullText + fullText;
                  const usage = extractStreamUsage(completeText);

                  if (usage.totalTokens > 0) {
                    const period = quotaEngine.store.getCurrentPeriod(token.quotaPeriod);
                    quotaEngine.recordUsage('token', token.id, usage.totalTokens, period);
                  }

                  isAuditLogFullBodyEnabled().then((logFullBody) => {
                    const hasHits = desensitizeHitResults.length > 0;
                    auditLogger.log({
                      tokenId: token.id,
                      userId: token.userId,
                      providerId: tp.provider.id,
                      logType: 'request',
                      action: path,
                      requestMethod: method,
                      responseStatus: upstream.status,
                      responseTime: Date.now() - startTime,
                      promptTokens: usage.promptTokens,
                      completionTokens: usage.completionTokens,
                      totalTokens: usage.totalTokens,
                      isStream: true,
                      failover: false,
                      ipAddress: clientIp,
                      userAgent,
                      requestBody: (logFullBody || hasHits) && body ? JSON.stringify(body).slice(0, 50000) : undefined,
                      responseBody: logFullBody ? extractReadableText(completeText).slice(0, 50000) || completeText.slice(0, 50000) : undefined,
                      desensitizeHits: hasHits ? JSON.stringify(desensitizeHitResults) : undefined,
                    });
                  });
                },
                onError(error) {
                  circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
                  auditLogger.log({
                    tokenId: token.id,
                    userId: token.userId,
                    providerId: tp.provider.id,
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

          circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
          throw new Error(`Single provider returned ${upstream.status}`);
        } catch (error) {
          circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
          const errMsg = error instanceof Error ? error.message : String(error);
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
            detail: JSON.stringify({ reason: 'Single provider failed', error: errMsg }),
            requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
            responseBody: errMsg,
            upstreamUrl: url,
          });
          return NextResponse.json({ error: 'Single provider failed' }, { status: 502 });
        }
      }

      for (const tp of providerList) {
        if (!circuitBreaker.isAvailable(tp.provider.id)) {
          failedProviderIds.push(tp.provider.id);
          continue;
        }

        // 提供商级限流校验
        const providerConfig = await prisma.provider.findUnique({ where: { id: tp.provider.id } });
        if (providerConfig?.totalRpmLimit) {
          const rpmCheck = rateLimiter.check('provider', tp.provider.id, 'rpm', providerConfig.totalRpmLimit);
          if (!rpmCheck.allowed) {
            failedProviderIds.push(tp.provider.id);
            continue;
          }
        }
        if (providerConfig?.totalTpmLimit) {
          const tpmCheck = rateLimiter.check('provider', tp.provider.id, 'tpm', providerConfig.totalTpmLimit, 0);
          if (!tpmCheck.allowed) {
            failedProviderIds.push(tp.provider.id);
            continue;
          }
        }

        // 提供商级配额校验
        const providerQuotaCheck = await quotaEngine.checkQuota('provider', tp.provider.id, {
          tokenLimit: providerConfig?.totalTpmLimit ?? undefined,
          period: 'monthly'
        });
        if (!providerQuotaCheck.allowed) {
          failedProviderIds.push(tp.provider.id);
          continue;
        }

        const apiKey = decrypt(tp.provider.apiKeyEncrypted);
        const url = resolveProxyUrl(tp.provider.apiBaseUrl, path);

        const redirectedBody = applyModelRedirect(body, providerConfig?.modelRedirect || null);

        const headers: Record<string, string> = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'Accept': request.headers.get('accept') || 'application/json',
        };

        try {
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
            throw new Error(`Upstream stream request failed: ${fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message}`);
          }
          clearTimeout(timer);

          if (upstream.ok && upstream.body) {
            // Buffer initial stream data to detect early failures
            const buffered = await bufferUpstreamStream(upstream);

            if (!buffered) {
              // Upstream errored during buffering window → failover
              failedProviderIds.push(tp.provider.id);
              circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
              continue;
            }

            rateLimiter.record('token', token.id, 'rpm');
            if (providerConfig?.totalRpmLimit) {
              rateLimiter.record('provider', tp.provider.id, 'rpm');
            }
            circuitBreaker.recordSuccess(tp.provider.id, tp.provider.name);

            // Wrap the buffered stream with the original proxy logic for onDone/onError
            const stream = createStreamProxy(
              new Response(buffered.stream, {
                status: upstream.status,
                headers: { 'Content-Type': 'text/event-stream' },
              }),
              {
                onDone(fullText) {
                  // Prepend any text already accumulated during buffering
                  const completeText = buffered.fullText + fullText;
                  const usage = extractStreamUsage(completeText);

                  if (usage.totalTokens > 0) {
                    const period = quotaEngine.store.getCurrentPeriod(token.quotaPeriod);
                    quotaEngine.recordUsage('token', token.id, usage.totalTokens, period);
                  }

                  isAuditLogFullBodyEnabled().then((logFullBody) => {
                    const hasHits = desensitizeHitResults.length > 0;
                    auditLogger.log({
                      tokenId: token.id,
                      userId: token.userId,
                      providerId: tp.provider.id,
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
                      responseBody: logFullBody ? extractReadableText(completeText).slice(0, 50000) || completeText.slice(0, 50000) : undefined,
                      desensitizeHits: hasHits ? JSON.stringify(desensitizeHitResults) : undefined,
                    });
                  });
                },
                onError(error) {
                  circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
                  auditLogger.log({
                    tokenId: token.id,
                    userId: token.userId,
                    providerId: tp.provider.id,
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
          failedProviderIds.push(tp.provider.id);
          circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
          auditLogger.log({
            tokenId: token.id,
            userId: token.userId,
            providerId: tp.provider.id,
            logType: 'request',
            action: path,
            requestMethod: method,
            responseStatus: upstream.status,
            responseTime: Date.now() - startTime,
            isStream: true,
            ipAddress: clientIp,
            userAgent,
            detail: JSON.stringify({ reason: 'Provider returned non-ok status', status: upstream.status }),
            requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
            upstreamUrl: url,
            upstreamResponse: upstreamRespBody,
          });
        } catch (error) {
          failedProviderIds.push(tp.provider.id);
          circuitBreaker.recordFailure(tp.provider.id, tp.provider.name);
        }
      }

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
          providerCount: providerList.length,
          failedProviderIds,
          noProviderBound: providerList.length === 0
        }),
        requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
      });
      return NextResponse.json({ error: 'All providers failed' }, { status: 502 });
    }

    const result = await proxyEngine.forwardWithFailover(
      tokenHash,
      path,
      method,
      Object.fromEntries(request.headers.entries()) as Record<string, string>,
      body
    );

    const responseTime = Date.now() - startTime;
    const responseHeaders = new Headers();

    const skipHeaders = new Set([
      'content-encoding', 'content-length', 'content-type', 'transfer-encoding',
    ]);
    for (const [key, value] of Object.entries(result.response.headers)) {
      if (!skipHeaders.has(key)) {
        responseHeaders.set(key, value);
      }
    }

    rateLimiter.record('token', token.id, 'rpm');

    const totalTokens = result.response.body?.usage?.total_tokens || 0;
    if (totalTokens > 0) {
      const period = quotaEngine.store.getCurrentPeriod(token.quotaPeriod);
      quotaEngine.recordUsage('token', token.id, totalTokens, period);

      if (token.quotaTokenLimit) {
        const usage = await quotaEngine.checkQuota('token', token.id, { tokenLimit: token.quotaTokenLimit, period: token.quotaPeriod });
        if (usage.tokenUsage && usage.tokenLimit) {
          const usagePercent = (usage.tokenUsage / usage.tokenLimit) * 100;
          if (usagePercent >= 80) {
            await alertEngine.trigger('quota_warning', {
              type: 'token',
              refId: token.id,
              usage: usage.tokenUsage,
              limit: usage.tokenLimit
            });
          }
        }
      }

      const tpmCheck = rateLimiter.check('token', token.id, 'tpm', token.tpmLimit || 90000, totalTokens);
      if (!tpmCheck.allowed) {
        auditLogger.log({
          tokenId: token.id,
          userId: token.userId,
          logType: 'operation',
          action: path,
          requestMethod: method,
          ipAddress: clientIp,
          userAgent,
          responseStatus: 429,
          detail: JSON.stringify({ reason: 'TPM limit exceeded' }),
          requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
          responseBody: result.response.body ? JSON.stringify(result.response.body).slice(0, 50000) : undefined,
        });
      }
    }

    const logFullBody = await isAuditLogFullBodyEnabled();
    const hasDesensitizeHits = desensitizeHitResults.length > 0;
    auditLogger.log({
      tokenId: token.id,
      userId: token.userId,
      providerId: result.providerId,
      logType: 'request',
      action: path,
      requestMethod: method,
      responseStatus: result.response.status,
      responseTime,
      promptTokens: result.response.body?.usage?.prompt_tokens,
      completionTokens: result.response.body?.usage?.completion_tokens,
      totalTokens: result.response.body?.usage?.total_tokens,
      failover: result.failover,
      ipAddress: clientIp,
      userAgent,
      requestBody: (logFullBody || hasDesensitizeHits || result.response.status !== 200) && body ? JSON.stringify(body).slice(0, 50000) : undefined,
      responseBody: (logFullBody || result.response.status !== 200) && result.response.body ? JSON.stringify(result.response.body).slice(0, 50000) : undefined,
      desensitizeHits: hasDesensitizeHits ? JSON.stringify(desensitizeHitResults) : undefined,
    });

    return NextResponse.json(result.response.body, {
      status: result.response.status,
      headers: responseHeaders
    });

  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

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
      detail: JSON.stringify({ error: errorMsg }),
      requestBody: body ? JSON.stringify(body).slice(0, 50000) : undefined,
      responseBody: errorMsg,
      upstreamUrl: error?.upstreamUrl,
      upstreamResponse: error?.upstreamResponse || errorMsg,
    });

    return NextResponse.json({ error: 'Proxy request failed' }, { status: 502 });
  }
}
