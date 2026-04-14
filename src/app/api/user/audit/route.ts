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
  const tokenIdsParam = searchParams.get('tokenIds');

  const tokenIds = tokenIdsParam ? tokenIdsParam.split(',') : null;

  const where: any = { userId };
  if (tokenIds) where.tokenId = { in: tokenIds };

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      token: { select: { id: true, name: true, keyPrefix: true } },
      provider: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return NextResponse.json({ logs });
}
