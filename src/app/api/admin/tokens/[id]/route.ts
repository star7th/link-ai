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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, status, rpmLimit, tpmLimit, ipRuleMode, quotaTokenLimit, quotaRequestLimit, quotaPeriod, expiresAt, providers } = body;

  const updateData: any = {};
  if (name) updateData.name = name;
  if (status) updateData.status = status;
  if (rpmLimit !== undefined) updateData.rpmLimit = rpmLimit;
  if (tpmLimit !== undefined) updateData.tpmLimit = tpmLimit;
  if (ipRuleMode) updateData.ipRuleMode = ipRuleMode;
  if (quotaTokenLimit !== undefined) updateData.quotaTokenLimit = quotaTokenLimit;
  if (quotaRequestLimit !== undefined) updateData.quotaRequestLimit = quotaRequestLimit;
  if (quotaPeriod) updateData.quotaPeriod = quotaPeriod;
  if (expiresAt) updateData.expiresAt = new Date(expiresAt);

  if (providers !== undefined) {
    await prisma.tokenProvider.deleteMany({ where: { tokenId: id } });
    if (Array.isArray(providers) && providers.length > 0) {
      await prisma.tokenProvider.createMany({
        data: providers.map((p: any, idx: number) => ({
          tokenId: id,
          providerId: p.providerId,
          priority: idx + 1,
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
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await prisma.token.delete({
    where: { id: id }
  });

  return NextResponse.json({ success: true });
}
