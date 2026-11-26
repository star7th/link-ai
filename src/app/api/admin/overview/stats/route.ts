import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { getCachedOverviewStats, isStatsRange } from '@/lib/admin-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(request: NextRequest) {
  const session = await getServerSession(await buildAuthOptions());
  if (!session || !((session as any).user?.isAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * GET /api/admin/overview/stats?range=today|7d|30d&detail=0|1
 * - detail=0（默认）：首屏轻量数据
 * - detail=1：另含走势序列、P95、全量模型/提供商明细
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const range = request.nextUrl.searchParams.get('range');
  if (range !== null && !isStatsRange(range)) {
    return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  }
  const detail = request.nextUrl.searchParams.get('detail') === '1';

  try {
    const data = await getCachedOverviewStats(range ?? 'today', detail);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[admin overview stats] failed:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
