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
  const { memberIds } = body;

  if (!Array.isArray(memberIds)) {
    return NextResponse.json({ error: 'memberIds must be an array' }, { status: 400 });
  }

  await prisma.userGroupMember.deleteMany({ where: { groupId: id } });

  if (memberIds.length > 0) {
    await prisma.userGroupMember.createMany({
      data: memberIds.map((uid: string) => ({ groupId: id, userId: uid })),
    });
  }

  const group = await prisma.userGroup.findUnique({
    where: { id: id },
    include: { members: { include: { user: { select: { id: true, username: true, name: true } } } } },
  });

  return NextResponse.json(group);
}
