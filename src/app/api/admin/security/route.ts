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

const SECURITY_KEYS = [
  'security.passwordMinLength',
  'security.passwordRequireUppercase',
  'security.passwordRequireNumber',
  'security.loginMaxAttempts',
  'security.loginLockMinutes',
  'security.globalIpWhitelist',
  'security.globalIpBlacklist',
  'security.allowUserCustomDesensitize',
];

const DEFAULTS: Record<string, any> = {
  'security.passwordMinLength': 8,
  'security.passwordRequireUppercase': true,
  'security.passwordRequireNumber': true,
  'security.loginMaxAttempts': 5,
  'security.loginLockMinutes': 30,
  'security.globalIpWhitelist': '[]',
  'security.globalIpBlacklist': '[]',
  'security.allowUserCustomDesensitize': true,
};

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const settings: Record<string, any> = {};
  for (const key of SECURITY_KEYS) {
    const val = await getSystemConfig(key);
    if (val !== null) {
      try {
        settings[key.replace('security.', '')] = JSON.parse(val);
      } catch {
        settings[key.replace('security.', '')] = val;
      }
    } else {
      settings[key.replace('security.', '')] = DEFAULTS[key];
    }
  }

  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();

  for (const [key, value] of Object.entries(body)) {
    const fullKey = `security.${key}`;
    if (SECURITY_KEYS.includes(fullKey)) {
      await setSystemConfig(fullKey, JSON.stringify(value));
    }
  }

  return NextResponse.json({ success: true });
}
