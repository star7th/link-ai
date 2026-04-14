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

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const tokenIds = await prisma.token.findMany({
    where: { userId },
    select: { id: true },
  });

  const tokenIdList = tokenIds.map(t => t.id);

  if (tokenIdList.length === 0) {
    return NextResponse.json({ alerts: [], total: 0, page, limit });
  }

  const [logs, total] = await Promise.all([
    prisma.alertLog.findMany({
      where: {
        rule: {
          triggerCondition: { in: ['token_warning', 'quota_warning', 'quota_exceeded', 'abnormal_request'] },
        },
      },
      include: { rule: { select: { name: true, triggerCondition: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.alertLog.count({
      where: {
        rule: {
          triggerCondition: { in: ['token_warning', 'quota_warning', 'quota_exceeded', 'abnormal_request'] },
        },
      },
    }),
  ]);

  return NextResponse.json({ alerts: logs, total, page, limit });
}
