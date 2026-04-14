import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAuth(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return (session as any).user.id;
}

export async function GET(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const tokens = await prisma.token.findMany({
    where: { userId },
    include: {
      tokenProviders: {
        include: { provider: { select: { id: true, name: true, code: true } } },
        orderBy: { priority: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json({ tokens });
}

export async function POST(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const {
    name, rpmLimit, tpmLimit, ipRuleMode,
    quotaTokenLimit, quotaRequestLimit, quotaPeriod,
    expiresAt, providers, ipRules, desensitizeRuleIds
  } = body;

  if (!name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  }

  const { generateApiKey, hashToken, encrypt } = await import('@/lib/crypto');
  const apiKey = generateApiKey();
  const keyPrefix = apiKey.substring(0, 8);
  const keyHash = hashToken(apiKey);
  const keyEncrypted = encrypt(apiKey);

  try {
    const token = await prisma.$transaction(async (tx: any) => {
      const token = await tx.token.create({
        data: {
          userId,
          name,
          keyPrefix,
          keyHash,
          keyEncrypted,
          rpmLimit,
          tpmLimit,
          ipRuleMode: ipRuleMode || 'allow_all',
          quotaTokenLimit,
          quotaRequestLimit,
          quotaPeriod: quotaPeriod || 'monthly',
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });

      if (providers && Array.isArray(providers) && providers.length > 0) {
        await tx.tokenProvider.createMany({
          data: providers.map((p: any, idx: number) => ({
            tokenId: token.id,
            providerId: p.providerId,
            priority: p.priority || idx + 1,
          })),
        });
      }

      if (ipRules && Array.isArray(ipRules) && ipRules.length > 0) {
        await tx.tokenIpRule.createMany({
          data: ipRules.map((rule: any) => ({
            tokenId: token.id,
            ruleType: rule.ruleType || 'whitelist',
            ipCidr: rule.ipCidr,
          })),
        });
      }

      if (desensitizeRuleIds && Array.isArray(desensitizeRuleIds) && desensitizeRuleIds.length > 0) {
        await tx.tokenDesensitizeRule.createMany({
          data: desensitizeRuleIds.map((ruleId: string) => ({
            tokenId: token.id,
            ruleId,
          })),
        });
      }

      return token;
    });

    return NextResponse.json({ ...token, apiKey }, { status: 201 });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Token key conflict' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
  }
}
