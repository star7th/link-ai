// @vitest-environment jsdom
/**
 * 管理概览页走势图：SPA 内切走再切回（组件卸载后重新挂载）不能停在「加载中」。
 *
 * 回归背景：图表库就绪信号曾经由 next/dynamic 的 loader 回调通知组件，而 loader
 * 对同一个 dynamic() 只执行一次（结果缓存在模块级 subscription 里），二次挂载时
 * 不再执行，新组件实例永远等不到就绪信号 → 走势图一直「加载中」。
 * 下面的 next/dynamic mock 按「loader 只执行一次」建模，复现该行为。
 * 回归保护：把页面换回上述旧实现时，本文件两个用例都会失败（停在「加载中」，图表渲染不全）。
 */
import { StrictMode, createElement, type ReactNode } from 'react';
import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverviewStats, StatsRange } from '@/lib/admin-stats';

vi.mock('next/dynamic', async () => {
  const React = await import('react');
  const cache = new WeakMap<Function, Promise<unknown>>();
  return {
    default: (loader: () => Promise<unknown>) => {
      // 与 next/dynamic 的 react-loadable 运行时一致：
      // - loader 对同一个 dynamic() 只执行一次，结果缓存在组件实例之外（模块级 subscription）
      // - 未就绪时不挂起，先渲染空，就绪后由外部 store 通知重渲染
      let loaded: unknown;
      let promise: Promise<unknown> | undefined;
      const subs = new Set<() => void>();
      const ensure = () => {
        if (!promise) {
          promise = cache.get(loader);
          if (!promise) {
            promise = loader().then((m) => {
              loaded = m;
              cache.set(loader, promise!);
              subs.forEach((f) => f());
              return m;
            });
          }
        }
        return promise;
      };
      const subscribe = (cb: () => void) => {
        subs.add(cb);
        return () => subs.delete(cb);
      };
      const Loadable = (props: Record<string, unknown>) => {
        const mod = React.useSyncExternalStore(subscribe, () => loaded, () => loaded);
        ensure();
        return mod ? (createElement(mod as never, props as never) as never) : null;
      };
      return Loadable;
    },
  };
});

// 图表本体与 bug 无关：换成不依赖 recharts 的轻量替身，只保留「按需加载 + 就绪后才渲染」的契约
vi.mock('@/components/admin-stats/overview-charts', () => ({
  TokenTrendChart: ({ loading }: { loading?: boolean }) =>
    createElement('div', { 'data-testid': 'token-chart', 'data-loading': String(Boolean(loading)) },
      loading ? '图表加载中' : 'Token 柱状图'),
  RequestTrendChart: ({ loading }: { loading?: boolean }) =>
    createElement('div', { 'data-testid': 'request-chart', 'data-loading': String(Boolean(loading)) },
      loading ? '图表加载中' : '请求折线图'),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}));

const TREND = [
  {
    label: '00:00',
    start: 0,
    requests: 2,
    tokens: 20,
    promptTokens: 12,
    completionTokens: 8,
    success: 2,
    errors: 0,
    avgLatency: 120,
  },
];

function stats(range: StatsRange, detail: boolean): OverviewStats {
  const summary = {
    requests: 2,
    tokens: 20,
    promptTokens: 12,
    completionTokens: 8,
    success: 2,
    errors: 0,
    successRate: 1,
    avgLatency: 120,
    p95Latency: 150,
  };
  return {
    range,
    bucket: 'hour',
    window: { start: 0, end: 1, prevStart: 0, prevEnd: 0 },
    generatedAt: 1,
    detail,
    cards: {
      promptTokens: 12,
      completionTokens: 8,
      tokens: { change: 0.1 },
      requests: { change: 0.1 },
      successRate: { change: 0 },
    },
    modelCount: 1,
    providerCount: 1,
    summary,
    prevSummary: { ...summary, p95Latency: 140 },
    trend: detail ? TREND : null,
    byModel: [],
    byProvider: [],
    topUsers: [],
    topTokens: [],
  };
}

let calls: string[] = [];

beforeEach(() => {
  // 模块级缓存 / dynamic 加载器都挂在模块上：每个用例从干净模块图开始
  vi.resetModules();
  calls = [];
  localStorage.setItem('linkai-admin-overview:chartOpen', '1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const body = url.includes('quotas/overview')
        ? { totalUsers: 1, totalActiveTokens: 1, providerUsage: [] }
        : stats(new URL(url, 'http://x').searchParams.get('range') as StatsRange, url.includes('detail=1'));
      return { ok: true, json: async () => body } as Response;
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sleep = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

// 同时认替身和真实 recharts 容器：vi.resetModules() 后 loader 首次 import 拿到的是替身还是真实模块存在时序竞争，与被测行为无关
const chartCount = () =>
  new Set([
    ...document.querySelectorAll('[data-testid="token-chart"], [data-testid="request-chart"], .recharts-responsive-container'),
  ]).size;
const loadingCount = () => screen.queryAllByText(/加载中/).length;

async function mountOverview(label = '挂载') {
  const { default: AdminOverviewPage } = await import('@/app/admin/overview/page');
  const utils = render(createElement(StrictMode, null, createElement(AdminOverviewPage)));
  await waitFor(() => {
    if (chartCount() !== 2) {
      throw new Error(
        `${label}后走势图未渲染（图表数 ${chartCount()}，页面「加载中」${loadingCount()} 处）：` +
          (document.querySelector('.mt-4.space-y-6')?.innerHTML ?? '')
      );
    }
  });
  return utils;
}

describe('admin overview 走势图', () => {
  it('SPA 内切走再切回：重新挂载后走势图立即渲染，不停在加载中', async () => {
    const first = await mountOverview();
    expect(loadingCount()).toBe(0);
    first.unmount();

    const second = await mountOverview();
    expect(loadingCount()).toBe(0);
    expect(chartCount()).toBe(2);
    second.unmount();
  }, 30000);

  it('切回时命中模块级缓存：已加载过的数据不再发请求', async () => {
    const first = await mountOverview();
    const firstCalls = [...calls];
    expect(firstCalls).toEqual(
      expect.arrayContaining([
        '/api/admin/quotas/overview',
        '/api/admin/overview/stats?range=today',
        '/api/admin/overview/stats?range=today&detail=1',
      ])
    );
    first.unmount();

    calls = [];
    const second = await mountOverview();
    expect(chartCount()).toBe(2);
    expect(calls).toEqual([]);
    second.unmount();
  }, 30000);
});
