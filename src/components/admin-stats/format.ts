export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('en-US');
}

export function formatFull(n: number): string {
  return Number(n).toLocaleString('en-US');
}

/** 0.9521 -> 95.2% */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '-';
  return (ratio * 100).toFixed(digits) + '%';
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
  if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
  return Math.round(ms) + ' ms';
}

/** 环比文案：change 为比例（0.12 = +12%），null 表示上期无数据 */
export function formatChange(change: number | null): { text: string; tone: 'up' | 'down' | 'flat' | 'none' } {
  if (change === null || !Number.isFinite(change)) return { text: '上期无数据', tone: 'none' };
  if (Math.abs(change) < 0.0005) return { text: '持平', tone: 'flat' };
  const sign = change > 0 ? '+' : '-';
  const abs = Math.abs(change);
  const text = abs >= 10 ? `${sign}${abs.toFixed(1)} 倍` : `${sign}${(abs * 100).toFixed(1)}%`;
  return { text, tone: change > 0 ? 'up' : 'down' };
}
