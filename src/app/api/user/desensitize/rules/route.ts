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

export async function GET(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const rules = await prisma.desensitizeRule.findMany({
    where: { userId, scope: 'user' },
    orderBy: { priority: 'desc' },
  });

  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const userId = await requireAuth(request);
  if (typeof userId !== 'string') return userId;

  const body = await request.json();
  const { name, ruleType, pattern, replacement, action, isEnabled, priority } = body;

  if (!name || !ruleType || !pattern) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const rule = await prisma.desensitizeRule.create({
    data: {
      userId,
      name,
      ruleType,
      pattern,
      replacement,
      action: action || 'replace',
      scope: 'user',
      isEnabled: isEnabled !== false,
      priority: priority || 0,
    },
  });
  await desensitizeEngine.reloadRules();
  return NextResponse.json(rule, { status: 201 });
}
