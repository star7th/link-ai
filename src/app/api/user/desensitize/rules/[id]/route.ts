import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { desensitizeEngine } from '@/lib/desensitize/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAuth(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return (session as any).user.id;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const { name, ruleType, pattern, replacement, action, isEnabled, priority } = body;

  const existing = await prisma.desensitizeRule.findFirst({
    where: { id: id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  const updateData: any = {};
  if (name) updateData.name = name;
  if (ruleType) updateData.ruleType = ruleType;
  if (pattern) updateData.pattern = pattern;
  if (replacement !== undefined) updateData.replacement = replacement;
  if (action) updateData.action = action;
  if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
  if (priority !== undefined) updateData.priority = priority;

  const rule = await prisma.desensitizeRule.update({
    where: { id: id },
    data: updateData,
  });
  await desensitizeEngine.reloadRules();
  return NextResponse.json(rule);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const existing = await prisma.desensitizeRule.findFirst({
    where: { id: id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  await prisma.desensitizeRule.delete({ where: { id: id } });
  await desensitizeEngine.reloadRules();
  return NextResponse.json({ success: true });
}
