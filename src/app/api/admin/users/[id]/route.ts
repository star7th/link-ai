import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
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

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      isAdmin: true,
      status: true,
      quotaTokenLimit: true,
      quotaRequestLimit: true,
      quotaPeriod: true,
      createdAt: true,
      updatedAt: true,
      userProviders: { select: { providerId: true } },
      groupMembers: {
        select: {
          group: { select: { id: true, name: true } }
        }
      },
      _count: { select: { tokens: true } }
    }
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, email, isAdmin, status, password, quotaTokenLimit, quotaRequestLimit, quotaPeriod, groupIds, providerIds } = body;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (email !== undefined) updateData.email = email;
  if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
  if (status !== undefined) updateData.status = status;
  if (quotaTokenLimit !== undefined) updateData.quotaTokenLimit = quotaTokenLimit;
  if (quotaRequestLimit !== undefined) updateData.quotaRequestLimit = quotaRequestLimit;
  if (quotaPeriod !== undefined) updateData.quotaPeriod = quotaPeriod;

  if (password) {
    updateData.password = await bcrypt.hash(password, 10);
  }

  if (groupIds !== undefined) {
    await prisma.userGroupMember.deleteMany({ where: { userId: id } });
    if (groupIds.length > 0) {
      await prisma.userGroupMember.createMany({
        data: groupIds.map((groupId: string) => ({ groupId, userId: id })),
      });
    }
  }

  if (providerIds !== undefined) {
    await prisma.userProvider.deleteMany({ where: { userId: id } });
    if (providerIds.length > 0) {
      await prisma.userProvider.createMany({
        data: providerIds.map((providerId: string) => ({ userId: id, providerId })),
      });
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      isAdmin: true,
      status: true,
      quotaTokenLimit: true,
      quotaRequestLimit: true,
      quotaPeriod: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(user);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (existing.isAdmin) {
    const adminCount = await prisma.user.count({ where: { isAdmin: true } });
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last admin user' }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
