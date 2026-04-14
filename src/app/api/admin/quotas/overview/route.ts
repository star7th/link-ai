import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

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

  const [totalUsers, totalTokens, providers] = await Promise.all([
    prisma.user.count(),
    prisma.token.count({ where: { status: 'active' } }),
    prisma.provider.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayRequests, todayTokens] = await Promise.all([
    prisma.auditLog.count({
      where: {
        logType: 'request',
        createdAt: { gte: today },
      },
    }),
    prisma.auditLog.aggregate({
      _sum: { totalTokens: true },
      where: {
        logType: 'request',
        createdAt: { gte: today },
      },
    }),
  ]);

  const providerUsage = await Promise.all(
    providers.map(async (p) => {
      const stats = await prisma.auditLog.aggregate({
        _sum: { totalTokens: true },
        _count: true,
        where: {
          providerId: p.id,
          logType: 'request',
          createdAt: { gte: today },
        },
      });
      return {
        providerId: p.id,
        providerName: p.name,
        tokenUsage: stats._sum.totalTokens || 0,
        requestUsage: stats._count,
      };
    })
  );

  const topUsers = await prisma.auditLog.groupBy({
    by: ['userId'],
    _sum: { totalTokens: true },
    where: {
      logType: 'request',
      createdAt: { gte: today },
    },
    orderBy: { _sum: { totalTokens: 'desc' } },
    take: 10,
  });

  const topUsersWithInfo = await Promise.all(
    topUsers.map(async (u) => {
      const user = await prisma.user.findUnique({
        where: { id: u.userId! },
        select: { username: true, name: true },
      });
      return {
        userId: u.userId,
        username: user?.username,
        name: user?.name,
        tokenUsage: u._sum.totalTokens || 0,
      };
    })
  );

  return NextResponse.json({
    totalUsers,
    totalActiveTokens: totalTokens,
    todayRequests,
    todayTokens: todayTokens._sum.totalTokens || 0,
    providerUsage,
    topUsers: topUsersWithInfo,
  });
}
