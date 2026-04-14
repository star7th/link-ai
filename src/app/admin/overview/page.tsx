'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ProviderUsage {
  providerId: string;
  providerName: string;
  tokenUsage: number;
  requestUsage: number;
}

interface TopUser {
  userId: string;
  username: string | null;
  name: string | null;
  tokenUsage: number;
}

interface OverviewData {
  totalUsers: number;
  totalActiveTokens: number;
  todayRequests: number;
  todayTokens: number;
  providerUsage: ProviderUsage[];
  topUsers: TopUser[];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOverview() {
      try {
        const res = await fetch('/api/admin/quotas/overview');
        if (!res.ok) throw new Error('请求失败');
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message || '加载失败');
      } finally {
        setLoading(false);
      }
    }
    fetchOverview();
  }, []);

  const statCards = [
    {
      title: '用户总数',
      value: data?.totalUsers ?? 0,
      icon: 'fa-solid fa-users',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10 dark:bg-blue-500/20',
    },
    {
      title: '活跃令牌',
      value: data?.totalActiveTokens ?? 0,
      icon: 'fa-solid fa-key',
      color: 'text-green-500',
      bg: 'bg-green-500/10 dark:bg-green-500/20',
    },
    {
      title: '上游提供商',
      value: data?.providerUsage?.length ?? 0,
      icon: 'fa-solid fa-server',
      color: 'text-purple-500',
      bg: 'bg-purple-500/10 dark:bg-purple-500/20',
    },
    {
      title: '今日请求',
      value: data?.todayRequests ?? 0,
      icon: 'fa-solid fa-arrow-right-arrow-left',
      color: 'text-orange-500',
      bg: 'bg-orange-500/10 dark:bg-orange-500/20',
    },
    {
      title: '今日Token用量',
      value: data?.todayTokens ?? 0,
      icon: 'fa-solid fa-chart-line',
      color: 'text-pink-500',
      bg: 'bg-pink-500/10 dark:bg-pink-500/20',
    },
  ];

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">管理概览</h1>
        <p className="text-muted-foreground">查看系统整体状态</p>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-error/30 bg-error/5 dark:bg-error/10 text-error">
          <i className="fa-solid fa-circle-exclamation mr-2" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-light-text-secondary dark:text-dark-text-secondary">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <i className={`${card.icon} ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-9 w-24 animate-pulse bg-primary/10 rounded" />
              ) : (
                <div className="text-3xl font-bold">{formatNumber(card.value)}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">快速操作</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link
            href="/admin/providers"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-primary/5 transition-all duration-200"
          >
            <div className="p-2 rounded-lg bg-purple-500/10 dark:bg-purple-500/20">
              <i className="fa-solid fa-server text-purple-500" />
            </div>
            <div>
              <div className="font-medium">提供商管理</div>
              <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">配置上游 AI 提供商</div>
            </div>
          </Link>
          <Link
            href="/admin/desensitization"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-primary/5 transition-all duration-200"
          >
            <div className="p-2 rounded-lg bg-rose-500/10 dark:bg-rose-500/20">
              <i className="fa-solid fa-shield-halved text-rose-500" />
            </div>
            <div>
              <div className="font-medium">脱敏规则</div>
              <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">配置数据脱敏规则</div>
            </div>
          </Link>
          <Link
            href="/admin/tokens"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-primary/5 transition-all duration-200"
          >
            <div className="p-2 rounded-lg bg-green-500/10 dark:bg-green-500/20">
              <i className="fa-solid fa-key text-green-500" />
            </div>
            <div>
              <div className="font-medium">令牌管理</div>
              <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">管理 API 访问令牌</div>
            </div>
          </Link>
          <Link
            href="/admin/audit-logs"
            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-primary/5 transition-all duration-200"
          >
            <div className="p-2 rounded-lg bg-orange-500/10 dark:bg-orange-500/20">
              <i className="fa-solid fa-scroll text-orange-500" />
            </div>
            <div>
              <div className="font-medium">审计日志</div>
              <div className="text-sm text-light-text-secondary dark:text-dark-text-secondary">查看请求日志分析</div>
            </div>
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <i className="fa-solid fa-ranking-star mr-2 text-yellow-500" />
              今日用户用量排行
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse bg-primary/10 rounded" />
                ))}
              </div>
            ) : !data?.topUsers?.length ? (
              <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary py-4 text-center">
                今日暂无数据
              </p>
            ) : (
              <div className="space-y-2">
                {data.topUsers.map((user, index) => {
                  const maxUsage = data.topUsers[0]?.tokenUsage || 1;
                  const percent = Math.max((user.tokenUsage / maxUsage) * 100, 2);
                  return (
                    <div key={user.userId} className="flex items-center gap-3">
                      <span className={`w-6 text-center text-sm font-bold ${index < 3 ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">
                            {user.name || user.username || user.userId}
                          </span>
                          <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary ml-2 whitespace-nowrap">
                            {formatNumber(user.tokenUsage)} tokens
                          </span>
                        </div>
                        <div className="h-2 bg-primary/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary dark:bg-primary/80 rounded-full transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <i className="fa-solid fa-chart-pie mr-2 text-purple-500" />
              提供商用量分布
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse bg-primary/10 rounded" />
                ))}
              </div>
            ) : !data?.providerUsage?.length ? (
              <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary py-4 text-center">
                今日暂无数据
              </p>
            ) : (
              <div className="space-y-3">
                {data.providerUsage
                  .sort((a, b) => b.tokenUsage - a.tokenUsage)
                  .map((provider) => {
                    const maxUsage = data.providerUsage.reduce(
                      (max, p) => Math.max(max, p.tokenUsage),
                      1
                    );
                    const percent = Math.max((provider.tokenUsage / maxUsage) * 100, 2);
                    return (
                      <div key={provider.providerId}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium">{provider.providerName}</span>
                          <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
                            <span>{formatNumber(provider.tokenUsage)} tokens</span>
                            <span className="mx-1">·</span>
                            <span>{provider.requestUsage} 请求</span>
                          </div>
                        </div>
                        <div className="h-2 bg-primary/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary dark:bg-primary/80 rounded-full transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
