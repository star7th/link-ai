import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

export async function GET(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      isAdmin: true,
      createdAt: true,
      quotaTokenLimit: true,
      quotaRequestLimit: true,
      quotaPeriod: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PUT(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const { name, email } = body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
    },
    select: { id: true, username: true, name: true, email: true },
  });

  return NextResponse.json(user);
}
