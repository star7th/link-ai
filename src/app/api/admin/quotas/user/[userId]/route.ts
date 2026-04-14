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
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { quotaTokenLimit, quotaRequestLimit, quotaPeriod } = body;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(quotaTokenLimit !== undefined && { quotaTokenLimit }),
      ...(quotaRequestLimit !== undefined && { quotaRequestLimit }),
      ...(quotaPeriod && { quotaPeriod }),
    },
  });

  return NextResponse.json(user);
}
