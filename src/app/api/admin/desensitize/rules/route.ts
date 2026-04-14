import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { desensitizeEngine } from '@/lib/desensitize/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');

  const where: any = {};
  if (scope) where.scope = scope;

  const rules = await prisma.desensitizeRule.findMany({
    where,
    orderBy: [{ scope: 'asc' }, { priority: 'desc' }],
  });

  return NextResponse.json({ rules });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, ruleType, pattern, replacement, action, scope, isEnabled, priority } = body;

  if (!name || !ruleType || !pattern) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const rule = await prisma.desensitizeRule.create({
      data: {
        name,
        ruleType,
        pattern,
        replacement,
        action: action || 'replace',
        scope: scope || 'global',
        isEnabled: isEnabled !== false,
        priority: priority || 0,
      },
    });
    await desensitizeEngine.reloadRules();
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}
