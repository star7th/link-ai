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

  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'json';
  const userId = searchParams.get('userId');
  const username = searchParams.get('username');
  const tokenId = searchParams.get('tokenId');
  const tokenName = searchParams.get('tokenName');
  const providerId = searchParams.get('providerId');
  const model = searchParams.get('model');
  const logType = searchParams.get('logType');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const where: any = {};
  if (userId) where.userId = userId;
  if (username) {
    where.user = { username: { contains: username } };
  }
  if (tokenId) where.tokenId = tokenId;
  if (tokenName) {
    where.token = { name: { contains: tokenName } };
  }
  if (providerId) where.providerId = providerId;
  if (model) where.model = { contains: model };
  if (logType) where.logType = logType;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      user: { select: { id: true, username: true, name: true } },
      token: { select: { id: true, name: true, keyPrefix: true } },
      provider: { select: { id: true, name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 10000
  });

  if (format === 'csv') {
    const headers = [
      'ID', 'Timestamp', 'User ID', 'Username', 'Token ID', 'Token Name',
      'Provider ID', 'Provider Name', 'Model', 'Log Type', 'Action', 'Request Method',
      'Response Status', 'Response Time', 'Prompt Tokens', 'Completion Tokens',
      'Total Tokens', 'Is Stream', 'Failover', 'IP Address', 'User Agent'
    ];

    const rows = logs.map(log => [
      log.id,
      log.createdAt.toISOString(),
      log.userId,
      log.user?.username,
      log.tokenId,
      log.token?.name,
      log.providerId,
      log.providerName,
      log.model,
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
        'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.csv"`
      }
    });
  }

  return NextResponse.json({ logs }, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.json"`
    }
  });
}
