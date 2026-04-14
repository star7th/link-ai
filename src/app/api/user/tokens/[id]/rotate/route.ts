import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateApiKey, hashToken, encrypt } from '@/lib/crypto';
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const existing = await prisma.token.findFirst({
    where: { id: id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const apiKey = generateApiKey();
  const keyPrefix = apiKey.substring(0, 8);
  const keyHash = hashToken(apiKey);
  const keyEncrypted = encrypt(apiKey);

  await prisma.token.update({
    where: { id: id },
    data: { keyPrefix, keyHash, keyEncrypted },
  });

  return NextResponse.json({
    key: apiKey,
    message: '新令牌明文仅显示一次，旧令牌已立即失效',
  });
}
