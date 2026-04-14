import { NextRequest, NextResponse } from 'next/server';
import { getSystemConfig } from '@/lib/system-config';
import { alertEngine } from '@/lib/alert/engine';
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

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const { channel, message } = body;

  if (!channel || !message) {
    return NextResponse.json({ error: 'Missing channel or message' }, { status: 400 });
  }

  try {
    const channelsConfig = JSON.parse((await getSystemConfig('alert.channels')) || '{}');
    const config = channelsConfig[channel];

    if (!config) {
      return NextResponse.json({ error: `Channel ${channel} not configured` }, { status: 400 });
    }

    await alertEngine.sendAlert(channel, config, `测试告警: ${message}`, 'info');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to send test alert' }, { status: 500 });
  }
}
