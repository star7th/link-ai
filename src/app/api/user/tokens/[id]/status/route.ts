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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const { status } = body;

  if (!status || !['active', 'disabled'].includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const existing = await prisma.token.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const token = await prisma.token.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(token);
}
