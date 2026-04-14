import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { quotaEngine } from '@/lib/quota/engine';
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quotaTokenLimit: true, quotaRequestLimit: true, quotaPeriod: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const periodKey = quotaEngine.store.getCurrentPeriod(user.quotaPeriod);
  const usage = quotaEngine.store.get('user', userId, periodKey);

  return NextResponse.json({
    period: periodKey,
    quotaTokenLimit: user.quotaTokenLimit,
    quotaRequestLimit: user.quotaRequestLimit,
    usedTokens: usage.tokens,
    usedRequests: usage.requests,
    tokenUsagePercent: user.quotaTokenLimit ? Math.round((usage.tokens / user.quotaTokenLimit) * 100) : 0,
    requestUsagePercent: user.quotaRequestLimit ? Math.round((usage.requests / user.quotaRequestLimit) * 100) : 0,
  });
}
