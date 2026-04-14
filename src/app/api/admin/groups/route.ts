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
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const [groups, total] = await Promise.all([
    prisma.userGroup.findMany({
      include: {
        _count: { select: { members: true, groupProviders: true } },
        groupQuotas: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.userGroup.count(),
  ]);

  return NextResponse.json({
    groups,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, description, memberIds, providerIds, quotas } = body;

  if (!name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const group = await prisma.userGroup.create({
      data: {
        name,
        description,
        members: memberIds
          ? { create: memberIds.map((uid: string) => ({ userId: uid })) }
          : undefined,
        groupProviders: providerIds
          ? { create: providerIds.map((pid: string) => ({ providerId: pid })) }
          : undefined,
        groupQuotas: quotas
          ? {
              create: quotas.map((q: any) => ({
                quotaType: q.quotaType,
                quotaLimit: q.quotaLimit,
                quotaPeriod: q.quotaPeriod,
              })),
            }
          : undefined,
      },
      include: { members: true, groupProviders: true, groupQuotas: true },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Group name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
  }
}
