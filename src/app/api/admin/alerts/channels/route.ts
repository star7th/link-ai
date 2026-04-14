import { NextRequest, NextResponse } from 'next/server';
import { getSystemConfig, setSystemConfig } from '@/lib/system-config';
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

  const val = await getSystemConfig('alert.channels');
  const channels = val ? JSON.parse(val) : {};

  return NextResponse.json({ channels });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  await setSystemConfig('alert.channels', JSON.stringify(body));

  return NextResponse.json({ success: true });
}
