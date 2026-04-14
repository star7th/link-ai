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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { userIds, groupIds } = body;

  await prisma.userProvider.deleteMany({ where: { providerId: id } });
  await prisma.userGroupProvider.deleteMany({ where: { providerId: id } });

  if (userIds && userIds.length > 0) {
    await prisma.userProvider.createMany({
      data: userIds.map((uid: string) => ({ userId: uid, providerId: id })),
    });
  }

  if (groupIds && groupIds.length > 0) {
    await prisma.userGroupProvider.createMany({
      data: groupIds.map((gid: string) => ({ groupId: gid, providerId: id })),
    });
  }

  return NextResponse.json({ success: true });
}
