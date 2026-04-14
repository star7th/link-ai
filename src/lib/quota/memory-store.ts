export class QuotaMemoryStore {
  private map = new Map<string, { tokens: number; requests: number }>();

  getKey(type: string, refId: string, period: string): string {
    return `quota:${type}:${refId}:${period}`;
  }

  getPeriodKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getCurrentPeriod(periodConfig: string): string {
    if (periodConfig === 'monthly') {
      const date = new Date();
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    } else if (periodConfig === 'weekly') {
      const date = new Date();
      const yearStart = new Date(date.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
      return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    } else {
      return this.getPeriodKey();
    }
  }

  get(type: string, refId: string, period: string): { tokens: number; requests: number } {
    const key = this.getKey(type, refId, period);
    return this.map.get(key) || { tokens: 0, requests: 0 };
  }

  increment(type: string, refId: string, period: string, tokens: number, requests: number): void {
    const key = this.getKey(type, refId, period);
    const current = this.map.get(key) || { tokens: 0, requests: 0 };
    this.map.set(key, {
      tokens: current.tokens + tokens,
      requests: current.requests + requests
    });
  }

  set(type: string, refId: string, period: string, tokens: number, requests: number): void {
    const key = this.getKey(type, refId, period);
    this.map.set(key, { tokens, requests });
  }

  delete(type: string, refId: string, period: string): void {
    const key = this.getKey(type, refId, period);
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  getAll(): Array<{ key: string; tokens: number; requests: number }> {
    return Array.from(this.map.entries()).map(([key, value]) => ({ key, ...value }));
  }
}
