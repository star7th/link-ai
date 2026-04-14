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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const group = await prisma.userGroup.findUnique({
    where: { id: id },
    include: {
      members: { include: { user: { select: { id: true, username: true, name: true } } } },
      groupProviders: { include: { provider: { select: { id: true, name: true } } } },
      groupQuotas: true,
    },
  });

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  return NextResponse.json(group);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, description } = body;

  const updateData: any = {};
  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  try {
    const group = await prisma.userGroup.update({
      where: { id: id },
      data: updateData,
    });
    return NextResponse.json(group);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Group name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await prisma.userGroup.delete({ where: { id: id } });
  return NextResponse.json({ success: true });
}
