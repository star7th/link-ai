import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/crypto';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { getProviderTokenSpeeds } from '@/lib/providers/token-speed';

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

  const provider = await prisma.provider.findUnique({
    where: { id },
    include: { failoverConfig: true }
  });

  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  const speeds = await getProviderTokenSpeeds([provider.id]);

  return NextResponse.json({
    ...provider,
    apiKeyEncrypted: '***',
    // 今天 / 最近 30 天两个窗口各自独立，无数据为 null，前端显示空白
    avgTokenSpeedToday: speeds.get(provider.id)?.avgTokenSpeedToday ?? null,
    avgTokenSpeed30d: speeds.get(provider.id)?.avgTokenSpeed30d ?? null,
    // 按模型明细（两个窗口）；无数据为空数组
    modelSpeeds: speeds.get(provider.id)?.modelSpeeds ?? [],
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, status, totalRpmLimit, totalTpmLimit, apiBaseUrl, apiKey, modelRedirect, timeoutMs, streamTimeoutMs } = body;

  const updateData: any = {};
  if (name) updateData.name = name;
  if (status) updateData.status = status;
  if (totalRpmLimit !== undefined) updateData.totalRpmLimit = totalRpmLimit;
  if (totalTpmLimit !== undefined) updateData.totalTpmLimit = totalTpmLimit;
  if (apiBaseUrl) updateData.apiBaseUrl = apiBaseUrl;
  if (apiKey) updateData.apiKeyEncrypted = encrypt(apiKey);
  if (modelRedirect !== undefined) updateData.modelRedirect = modelRedirect || null;
  if (timeoutMs !== undefined) updateData.timeoutMs = timeoutMs ? Number(timeoutMs) : null;
  if (streamTimeoutMs !== undefined) updateData.streamTimeoutMs = streamTimeoutMs ? Number(streamTimeoutMs) : null;

  const provider = await prisma.provider.update({
    where: { id },
    data: updateData
  });

  return NextResponse.json({ ...provider, apiKeyEncrypted: '***' });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await prisma.provider.delete({
    where: { id }
  });

  return NextResponse.json({ success: true });
}
