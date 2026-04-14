import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
  const format = searchParams.get('format') || 'json';
  const tokenIdsParam = searchParams.get('tokenIds');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const tokenIds = tokenIdsParam ? tokenIdsParam.split(',') : null;

  const where: any = { userId };
  if (tokenIds) where.tokenId = { in: tokenIds };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      token: { select: { id: true, name: true, keyPrefix: true } },
      provider: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 10000
  });

  if (format === 'csv') {
    const headers = [
      'ID', 'Timestamp', 'Token ID', 'Token Name',
      'Provider ID', 'Provider Name', 'Log Type', 'Action', 'Request Method',
      'Response Status', 'Response Time', 'Prompt Tokens', 'Completion Tokens',
      'Total Tokens', 'Is Stream', 'Failover', 'IP Address', 'User Agent'
    ];

    const rows = logs.map(log => [
      log.id,
      log.createdAt.toISOString(),
      log.tokenId,
      log.token?.name,
      log.providerId,
      log.providerName,
      log.logType,
      log.action,
      log.requestMethod,
      log.responseStatus,
      log.responseTime,
      log.promptTokens,
      log.completionTokens,
      log.totalTokens,
      log.isStream,
      log.failover,
      log.ipAddress,
      log.userAgent
    ].map(v => v || ''));

    const csv = [headers.join(','), ...rows.map(row => row.map(v => `"${v}"`).join(','))].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="my-audit-logs-${Date.now()}.csv"`
      }
    });
  }

  return NextResponse.json({ logs }, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="my-audit-logs-${Date.now()}.json"`
    }
  });
}
