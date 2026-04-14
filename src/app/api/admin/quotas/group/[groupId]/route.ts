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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { quotas } = body;

  if (!Array.isArray(quotas)) {
    return NextResponse.json({ error: 'quotas must be an array' }, { status: 400 });
  }

  await prisma.userGroupQuota.deleteMany({ where: { groupId: groupId } });

  if (quotas.length > 0) {
    await prisma.userGroupQuota.createMany({
      data: quotas.map((q: any) => ({
        groupId: groupId,
        quotaType: q.quotaType,
        quotaLimit: q.quotaLimit,
        quotaPeriod: q.quotaPeriod,
      })),
    });
  }

  const group = await prisma.userGroup.findUnique({
    where: { id: groupId },
    include: { groupQuotas: true },
  });

  return NextResponse.json(group);
}
