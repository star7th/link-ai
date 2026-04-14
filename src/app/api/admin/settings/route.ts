import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSystemConfig, setSystemConfig } from '@/lib/system-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

const SETTINGS_KEYS = [
  'system.timezone',
  'system.dataRetentionDays',
  'system.registrationEnabled',
  'system.auditLogArchiveEnabled',
];

const DEFAULTS: Record<string, any> = {
  'system.timezone': 'Asia/Shanghai',
  'system.dataRetentionDays': 90,
  'system.registrationEnabled': false,
  'system.auditLogArchiveEnabled': true,
};

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const settings: Record<string, any> = {};
  for (const key of SETTINGS_KEYS) {
    const val = await getSystemConfig(key);
    if (val !== null) {
      try {
        settings[key.replace('system.', '')] = JSON.parse(val);
      } catch {
        settings[key.replace('system.', '')] = val;
      }
    } else {
      settings[key.replace('system.', '')] = DEFAULTS[key];
    }
  }

  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();

  for (const [key, value] of Object.entries(body)) {
    const fullKey = `system.${key}`;
    if (SETTINGS_KEYS.includes(fullKey)) {
      await setSystemConfig(fullKey, JSON.stringify(value));
    }
  }

  return NextResponse.json({ success: true });
}
