import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/crypto';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { getProviderTokenSpeeds } from '@/lib/providers/token-speed';

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
  const status = searchParams.get('status');

  const where: any = {};
  if (status) where.status = status;

  const [providers, total] = await Promise.all([
    prisma.provider.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.provider.count({ where })
  ]);

  // 单次聚合查询取回本页所有供应商的平均 token 速度，避免 N+1
  const speeds = await getProviderTokenSpeeds(providers.map(p => p.id));

  return NextResponse.json({
    providers: providers.map(p => ({
      ...p,
      apiKeyEncrypted: '***',
      // 今天 / 最近 30 天两个窗口各自独立，无数据为 null，前端显示空白
      avgTokenSpeedToday: speeds.get(p.id)?.avgTokenSpeedToday ?? null,
      avgTokenSpeed30d: speeds.get(p.id)?.avgTokenSpeed30d ?? null,
      // 按模型明细（两个窗口）；无数据为空数组
      modelSpeeds: speeds.get(p.id)?.modelSpeeds ?? []
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, code, protocolType, apiBaseUrl, apiKey, totalRpmLimit, totalTpmLimit, modelRedirect, timeoutMs, streamTimeoutMs } = body;

  if (!name || !code || !protocolType || !apiBaseUrl || !apiKey) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const apiKeyEncrypted = encrypt(apiKey);

    const provider = await prisma.provider.create({
      data: {
        name,
        code,
        protocolType,
        apiBaseUrl,
        apiKeyEncrypted,
        totalRpmLimit,
        totalTpmLimit,
        modelRedirect: modelRedirect || null,
        timeoutMs: timeoutMs ? Number(timeoutMs) : null,
        streamTimeoutMs: streamTimeoutMs ? Number(streamTimeoutMs) : null,
      }
    });

    return NextResponse.json({ ...provider, apiKeyEncrypted: '***' }, { status: 201 });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Provider with this name or code already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create provider' }, { status: 500 });
  }
}
