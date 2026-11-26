import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { shanghaiDayStart } from '@/lib/admin-stats';

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

  // 今天 0 点按 Asia/Shanghai 切（库里 createdAt 是 UTC 毫秒）
  const todayStart = shanghaiDayStart(Date.now());

  const [todayRequests, todayAgg, providerGroups, topUsers] = await Promise.all([
    prisma.auditLog.count({
      where: { logType: 'request', createdAt: { gte: new Date(todayStart) } },
    }),
    prisma.auditLog.aggregate({
      _sum: { totalTokens: true },
      where: { logType: 'request', createdAt: { gte: new Date(todayStart) } },
    }),
    // 一条 groupBy 取代逐个提供商 aggregate
    prisma.auditLog.groupBy({
      by: ['providerId'],
      _sum: { totalTokens: true },
      _count: true,
      where: { logType: 'request', createdAt: { gte: new Date(todayStart) }, providerId: { not: null } },
    }),
    prisma.auditLog.groupBy({
      by: ['userId'],
      _sum: { totalTokens: true },
      where: { logType: 'request', createdAt: { gte: new Date(todayStart) } },
      orderBy: { _sum: { totalTokens: 'desc' } },
      take: 10,
    }),
  ]);

  const providerById = new Map(providers.map((p) => [p.id, p.name]));
  const providerUsage = providerGroups
    .map((g) => ({
      providerId: g.providerId ?? '',
      providerName: providerById.get(g.providerId ?? '') ?? g.providerId ?? '',
      tokenUsage: g._sum?.totalTokens || 0,
      requestUsage: g._count,
    }))
    .filter((p) => p.providerId)
    .sort((a, b) => b.tokenUsage - a.tokenUsage);

  // 一次 findMany 取代逐个用户 findUnique
  const userIds = topUsers.map((u) => u.userId).filter((id): id is string => Boolean(id));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, name: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const topUsersWithInfo = topUsers.map((u) => {
    const user = u.userId ? userById.get(u.userId) : undefined;
    return {
      userId: u.userId,
      username: user?.username,
      name: user?.name,
      tokenUsage: u._sum?.totalTokens || 0,
    };
  });

  return NextResponse.json({
    totalUsers,
    totalActiveTokens: totalTokens,
    todayRequests,
    todayTokens: todayAgg._sum?.totalTokens || 0,
    providerUsage,
    topUsers: topUsersWithInfo,
  });
}
