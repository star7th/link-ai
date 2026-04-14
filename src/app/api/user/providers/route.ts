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

  const providers = await prisma.provider.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      code: true,
      protocolType: true,
      status: true,
      healthStatus: true,
      lastHealthCheck: true,
    },
    orderBy: { name: 'asc' }
  });

  return NextResponse.json({ providers });
}
