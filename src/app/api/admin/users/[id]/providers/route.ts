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
  const { providerIds } = body;

  if (!Array.isArray(providerIds)) {
    return NextResponse.json({ error: 'providerIds must be an array' }, { status: 400 });
  }

  await prisma.userProvider.deleteMany({ where: { userId: id } });

  if (providerIds.length > 0) {
    await prisma.userProvider.createMany({
      data: providerIds.map((pid: string) => ({ userId: id, providerId: pid })),
    });
  }

  return NextResponse.json({ success: true });
}
