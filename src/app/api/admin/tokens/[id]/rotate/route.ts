import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateApiKey, hashToken, encrypt } from '@/lib/crypto';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = await prisma.token.findFirst({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const apiKey = generateApiKey();
  const keyPrefix = apiKey.substring(0, 8);
  const keyHash = hashToken(apiKey);
  const keyEncrypted = encrypt(apiKey);

  await prisma.token.update({
    where: { id },
    data: { keyPrefix, keyHash, keyEncrypted },
  });

  return NextResponse.json({ key: apiKey });
}
