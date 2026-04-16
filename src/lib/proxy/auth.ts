/**
 * Shared authentication and authorization logic for API proxy routes.
 *
 * Extracted from the OpenAI proxy route so the Anthropic passthrough route
 * can reuse the same token validation, IP checking, rate limiting, and quota logic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, hashToken, rateLimiter, quotaEngine, auditLogger } from '@/lib/engines';

export interface AuthResult {
  token: Awaited<ReturnType<typeof prisma.token.findUnique>> & {
    user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
  };
  clientIp: string;
  userAgent: string;
}

/**
 * Extract bearer token from Authorization header or x-api-key header.
 *
 * For Anthropic passthrough we also accept x-api-key as the link-ai token
 * (so clients that natively use x-api-key can send their link-ai key there).
 */
export function extractToken(request: NextRequest): string | null {
  // 1. Authorization: Bearer xxx
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
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
  }

  // 2. x-api-key header — treat as link-ai token if it looks like one
  const xApiKey = request.headers.get('x-api-key');
  if (xApiKey && xApiKey.startsWith('lk-')) {
    return xApiKey;
  }

  return null;
}

export function getClientIp(request: NextRequest): string {
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

/**
 * Authenticate a request and return the validated token + metadata,
 * or return a NextResponse error if authentication fails.
 */
export async function authenticateRequest(
  request: NextRequest,
  method: string,
): Promise<{ result: AuthResult } | { error: NextResponse }> {
  const clientIp = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';

  const apiKey = extractToken(request);
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
    return { error: NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 }) };
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
    return { error: NextResponse.json({ error: 'Invalid or inactive token' }, { status: 401 }) };
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
    return { error: NextResponse.json({ error: 'Token expired' }, { status: 401 }) };
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
    return { error: NextResponse.json({ error: 'IP not allowed' }, { status: 403 }) };
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
    return { error: NextResponse.json({ error: 'Rate limit exceeded', retryAfter: rpmCheck.retryAfter }, { status: 429 }) };
  }

  // User-level quota checks
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
        return { error: NextResponse.json({ error: 'User quota exceeded' }, { status: 429 }) };
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
        return { error: NextResponse.json({ error: 'User request quota exceeded' }, { status: 429 }) };
      }
    }
  }

  // Token-level quota checks
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
      return { error: NextResponse.json({ error: 'Token quota exceeded' }, { status: 429 }) };
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
      return { error: NextResponse.json({ error: 'Token request quota exceeded' }, { status: 429 }) };
    }
  }

  return {
    result: {
      token: token as any,
      clientIp,
      userAgent,
    }
  };
}
