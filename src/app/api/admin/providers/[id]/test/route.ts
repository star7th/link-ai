import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildModelsUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+$/.test(url)) {
    url += '/models';
  } else {
    url += '/v1/models';
  }
  return url;
}

async function requireAdmin(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const provider = await prisma.provider.findUnique({ where: { id: id } });
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
  }

  const start = Date.now();
  try {
    const apiKey = decrypt(provider.apiKeyEncrypted);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (provider.protocolType === 'azure') {
      headers['api-key'] = apiKey;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const modelsUrl = buildModelsUrl(provider.apiBaseUrl);
    const response = await fetch(modelsUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    const latency = Date.now() - start;

    if (response.ok) {
      const data = await response.json();
      const models = data.data ? data.data.map((m: any) => m.id).slice(0, 20) : [];
      return NextResponse.json({ connected: true, latency, models });
    } else {
      return NextResponse.json({
        connected: false,
        latency,
        error: `HTTP ${response.status}`,
      });
    }
  } catch (error: any) {
    return NextResponse.json({
      connected: false,
      latency: Date.now() - start,
      error: error.message || 'Connection failed',
    });
  }
}
