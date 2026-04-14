import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { decrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const userId = searchParams.get('userId');
  const status = searchParams.get('status');

  const where: any = {};
  if (userId) where.userId = userId;
  if (status) where.status = status;

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, name: true } },
        tokenProviders: {
          include: { provider: { select: { id: true, name: true, code: true } } },
          orderBy: { priority: 'asc' }
        },
        _count: { select: { auditLogs: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.token.count({ where })
  ]);

  return NextResponse.json({
    tokens: tokens.map((t: any) => ({
      ...t,
      keyPlain: t.keyEncrypted ? decrypt(t.keyEncrypted) : null,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { name, rpmLimit, tpmLimit, ipRuleMode, quotaTokenLimit, quotaRequestLimit, quotaPeriod, expiresAt, providerIds } = body;

  if (!name) {
    return NextResponse.json({ error: 'Missing required fields: name' }, { status: 400 });
  }

  const { generateApiKey, hashToken, encrypt } = await import('@/lib/crypto');
  const apiKey = generateApiKey();
  const keyPrefix = apiKey.substring(0, 8);
  const keyHash = hashToken(apiKey);
  const keyEncrypted = encrypt(apiKey);

  try {
    const token = await prisma.token.create({
      data: {
        userId: (session as any).user.id,
        name,
        keyPrefix,
        keyHash,
        keyEncrypted,
        rpmLimit,
        tpmLimit,
        ipRuleMode,
        quotaTokenLimit,
        quotaRequestLimit,
        quotaPeriod,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      }
    });

    if (providerIds && providerIds.length > 0) {
      const tokenProviders = providerIds.map((pid: string, idx: number) => ({
        tokenId: token.id,
        providerId: pid,
        priority: idx + 1
      }));
      await prisma.tokenProvider.createMany({ data: tokenProviders });
    }

    return NextResponse.json({ ...token, apiKey }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
  }
}
