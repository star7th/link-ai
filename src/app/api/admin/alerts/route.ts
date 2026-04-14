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

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const alerts = await prisma.alertLog.findMany({
    include: {
      rule: { select: { name: true, triggerCondition: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  });

  return NextResponse.json({ alerts });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { name, triggerCondition, threshold, cooldown, channels, recipientAdmins, recipientUsers, messageTemplate, isEnabled } = body;

  if (!name || !triggerCondition) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const rule = await prisma.alertRule.create({
      data: {
        name,
        triggerCondition,
        threshold,
        cooldown,
        channels: JSON.stringify(channels || []),
        recipientAdmins: recipientAdmins ?? true,
        recipientUsers: recipientUsers ?? false,
        messageTemplate,
        isEnabled: isEnabled ?? true
      }
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create alert rule' }, { status: 500 });
  }
}
