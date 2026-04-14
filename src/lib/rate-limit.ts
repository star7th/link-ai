const store = new Map<string, number[]>();

function getKey(type: string, refId: string, window: 'rpm' | 'tpm'): string {
  return `ratelimit:${type}:${refId}:${window}`;
}

function getWindowMs(): number {
  return 60_000;
}

function filterRpm(key: string, windowMs: number, now: number): number[] {
  const entries = store.get(key);
  if (!entries) return [];
  const cutoff = now - windowMs;
  const filtered = entries.filter((ts) => ts > cutoff);
  if (filtered.length === 0) {
    store.delete(key);
  } else {
    store.set(key, filtered);
  }
  return filtered;
}

function filterTpm(key: string, windowMs: number, now: number): { timestamps: number[]; total: number; oldest: number } {
  const entries = store.get(key);
  if (!entries || entries.length < 2) return { timestamps: [], total: 0, oldest: 0 };
  const cutoff = now - windowMs;
  const filtered: number[] = [];
  for (let i = 0; i < entries.length - 1; i += 2) {
    if (entries[i] > cutoff) {
      filtered.push(entries[i], entries[i + 1]);
    }
  }
  if (filtered.length === 0) {
    store.delete(key);
  } else {
    store.set(key, filtered);
  }
  let total = 0;
  for (let i = 1; i < filtered.length; i += 2) {
    total += filtered[i];
  }
  return { timestamps: filtered, total, oldest: filtered[0] };
}

function purgeExpired(now: number): void {
  const cutoff = now - 120_000;
  for (const [key, entries] of store) {
    if (key.endsWith(':tpm')) {
      let kept = false;
      for (let i = 0; i < entries.length - 1; i += 2) {
        if (entries[i] > cutoff) {
          kept = true;
          break;
        }
      }
      if (!kept) store.delete(key);
      else {
        const filtered: number[] = [];
        for (let i = 0; i < entries.length - 1; i += 2) {
          if (entries[i] > cutoff) {
            filtered.push(entries[i], entries[i + 1]);
          }
        }
        store.set(key, filtered);
      }
    } else {
      const filtered = entries.filter((ts) => ts > cutoff);
      if (filtered.length === 0) store.delete(key);
      else store.set(key, filtered);
    }
  }
}

export const rateLimiter = {
  check(
    type: string,
    refId: string,
    window: 'rpm' | 'tpm',
    limit: number,
    tokenCount?: number,
  ): { allowed: boolean; remaining: number; retryAfter?: number } {
    const now = Date.now();
    purgeExpired(now);

    const key = getKey(type, refId, window);
    const windowMs = getWindowMs();

    if (window === 'tpm') {
      const { total, oldest } = filterTpm(key, windowMs, now);
      const projected = total + (tokenCount ?? 0);
      const remaining = Math.max(0, limit - total);
      if (projected > limit) {
        const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
        return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
      }
      return { allowed: true, remaining };
    }

    const entries = filterRpm(key, windowMs, now);
    const remaining = Math.max(0, limit - entries.length);
    if (entries.length >= limit) {
      const retryAfter = Math.ceil((entries[0] + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
    }
    return { allowed: true, remaining };
  },

  record(
    type: string,
    refId: string,
    window: 'rpm' | 'tpm',
    count: number = 1,
  ): void {
    const now = Date.now();
    const key = getKey(type, refId, window);
    const entries = store.get(key) ?? [];

    if (window === 'tpm') {
      entries.push(now, count);
    } else {
      entries.push(now);
    }

    store.set(key, entries);
  },

  reset(type: string, refId: string): void {
    store.delete(getKey(type, refId, 'rpm'));
    store.delete(getKey(type, refId, 'tpm'));
  },

  cleanup(): void {
    purgeExpired(Date.now());
  },
};
