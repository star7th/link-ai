import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
  Prisma: {
    join: (vals: unknown[]) => ({ values: vals, __prismaJoin: true }),
    sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, values: vals }),
  },
}));

describe('getProviderTokenSpeeds 缓存', () => {
  beforeEach(() => {
    vi.resetModules();
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
    delete (globalThis as unknown as { __providerTokenSpeedCache?: unknown }).__providerTokenSpeedCache;
  });

  it('同 key 第二次调用命中缓存，不再触发查询', async () => {
    const { getProviderTokenSpeeds } = await import('../token-speed');
    await getProviderTokenSpeeds(['p1', 'p2']);
    expect(queryRaw).toHaveBeenCalledTimes(2); // 两个窗口各一次
    await getProviderTokenSpeeds(['p1', 'p2']);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('相同 provider 集合不同顺序命中同一缓存条目', async () => {
    const { getProviderTokenSpeeds } = await import('../token-speed');
    await getProviderTokenSpeeds(['b', 'a']);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    await getProviderTokenSpeeds(['a', 'b']);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('TTL 过期后重新查询', async () => {
    vi.useFakeTimers();
    try {
      const { getProviderTokenSpeeds } = await import('../token-speed');
      await getProviderTokenSpeeds(['p1']);
      expect(queryRaw).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(46_000);
      await getProviderTokenSpeeds(['p1']);
      expect(queryRaw).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('查询失败时删除缓存条目并抛错，下次调用重新查询', async () => {
    const { getProviderTokenSpeeds } = await import('../token-speed');
    queryRaw.mockRejectedValueOnce(new Error('db down'));
    await expect(getProviderTokenSpeeds(['p1'])).rejects.toThrow('db down');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    // 失败后缓存已删，再次调用会重新查询并成功
    const second = await getProviderTokenSpeeds(['p1']);
    expect(second.size).toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('空 providerIds 不触发查询', async () => {
    const { getProviderTokenSpeeds } = await import('../token-speed');
    await getProviderTokenSpeeds([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
