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
  const { name, triggerCondition, threshold, cooldown, channels, recipientAdmins, recipientUsers, messageTemplate, isEnabled } = body;

  const updateData: any = {};
  if (name) updateData.name = name;
  if (triggerCondition) updateData.triggerCondition = triggerCondition;
  if (threshold !== undefined) updateData.threshold = threshold;
  if (cooldown !== undefined) updateData.cooldown = cooldown;
  if (channels) updateData.channels = JSON.stringify(channels);
  if (recipientAdmins !== undefined) updateData.recipientAdmins = recipientAdmins;
  if (recipientUsers !== undefined) updateData.recipientUsers = recipientUsers;
  if (messageTemplate !== undefined) updateData.messageTemplate = messageTemplate;
  if (isEnabled !== undefined) updateData.isEnabled = isEnabled;

  const rule = await prisma.alertRule.update({
    where: { id: id },
    data: updateData,
  });

  return NextResponse.json(rule);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await prisma.alertRule.delete({ where: { id: id } });
  return NextResponse.json({ success: true });
}
