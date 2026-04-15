import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/crypto';
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

  return NextResponse.json({
    providers: providers.map(p => ({ ...p, apiKeyEncrypted: '***' })),
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
