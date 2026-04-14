import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateApiKey, hashToken } from '@/lib/crypto';
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const { name, rpmLimit, tpmLimit, ipRuleMode, quotaTokenLimit, quotaRequestLimit, quotaPeriod, status, providers } = body;

  const existing = await prisma.token.findFirst({
    where: { id: id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const updateData: any = {};
  if (name) updateData.name = name;
  if (rpmLimit !== undefined) updateData.rpmLimit = rpmLimit;
  if (tpmLimit !== undefined) updateData.tpmLimit = tpmLimit;
  if (ipRuleMode) updateData.ipRuleMode = ipRuleMode;
  if (quotaTokenLimit !== undefined) updateData.quotaTokenLimit = quotaTokenLimit;
  if (quotaRequestLimit !== undefined) updateData.quotaRequestLimit = quotaRequestLimit;
  if (quotaPeriod) updateData.quotaPeriod = quotaPeriod;
  if (status) updateData.status = status;

  if (providers) {
    await prisma.tokenProvider.deleteMany({ where: { tokenId: id } });
    if (providers.length > 0) {
      await prisma.tokenProvider.createMany({
        data: providers.map((p: any, idx: number) => ({
          tokenId: id,
          providerId: p.providerId,
          priority: p.priority || idx + 1,
        })),
      });
    }
  }

  const token = await prisma.token.update({
    where: { id: id },
    data: updateData,
    include: {
      tokenProviders: {
        include: { provider: { select: { id: true, name: true, code: true } } },
        orderBy: { priority: 'asc' },
      },
    },
  });

  return NextResponse.json(token);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const existing = await prisma.token.findFirst({
    where: { id: id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  await prisma.token.delete({ where: { id: id } });
  return NextResponse.json({ success: true });
}
