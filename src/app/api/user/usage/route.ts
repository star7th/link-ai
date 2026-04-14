import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { quotaEngine } from '@/lib/quota/engine';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAuth(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return session.user.id;
}

export async function GET(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const { searchParams } = new URL(request.url);
  const tokenId = searchParams.get('tokenId');
  const period = searchParams.get('period') || 'monthly';

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quotaTokenLimit: true, quotaRequestLimit: true, quotaPeriod: true }
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const periodKey = quotaEngine.store.getCurrentPeriod(period);

  let usage = { tokens: 0, requests: 0 };

  if (tokenId) {
    const tokenUsage = quotaEngine.store.get('token', tokenId, periodKey);
    usage = { tokens: tokenUsage.tokens, requests: tokenUsage.requests };
  } else {
    const userUsage = quotaEngine.store.get('user', userId, periodKey);
    usage = { tokens: userUsage.tokens, requests: userUsage.requests };
  }

  const year = parseInt(periodKey.substring(0, 4));
  const month = parseInt(periodKey.split('-')[1]) - 1;
  const logs = await prisma.auditLog.groupBy({
    by: ['providerId'],
    where: {
      userId,
      createdAt: { gte: new Date(year, month, 1) }
    },
    _sum: { totalTokens: true },
    orderBy: { _sum: { totalTokens: 'desc' } }
  });

  const providerStats = await Promise.all(
    logs.map(async (log) => {
      const provider = await prisma.provider.findUnique({
        where: { id: log.providerId! },
        select: { id: true, name: true }
      });
      return {
        provider: provider?.name || 'Unknown',
        tokens: log._sum.totalTokens || 0
      };
    })
  );

  return NextResponse.json({
    period: periodKey,
    usage: {
      tokens: usage.tokens,
      requests: usage.requests,
      tokenLimit: user.quotaTokenLimit,
      requestLimit: user.quotaRequestLimit,
      tokenUsagePercent: user.quotaTokenLimit ? Math.round((usage.tokens / user.quotaTokenLimit) * 100) : 0,
      requestUsagePercent: user.quotaRequestLimit ? Math.round((usage.requests / user.quotaRequestLimit) * 100) : 0
    },
    byProvider: providerStats
  });
}
