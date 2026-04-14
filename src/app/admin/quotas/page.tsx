"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProviderUsage {
  providerId: string;
  providerName: string;
  tokenUsage: number;
  requestUsage: number;
}

interface TopUser {
  userId: number;
  username: string;
  name: string;
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

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "K";
  return num.toString();
}

export default function AdminQuotasPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/quotas/overview");
      if (res.ok) {
        const json: OverviewData = await res.json();
        setData(json);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const statsCards = [
    { label: "用户总数", value: data?.totalUsers ?? 0 },
    { label: "活跃令牌", value: data?.totalActiveTokens ?? 0 },
    { label: "今日请求", value: data?.todayRequests ?? 0 },
    { label: "今日Token用量", value: data?.todayTokens ?? 0, format: true },
  ];

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">配额概览</h1>
        <p className="text-muted-foreground">查看系统用量统计与配额分配</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <span className="text-2xl font-bold">-</span>
              ) : (
                <span className="text-2xl font-bold">
                  {card.format ? formatNumber(card.value) : card.value.toLocaleString()}
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>提供商用量分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/15">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">提供商名</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Token用量</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">请求数</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-muted-foreground">
                        加载中...
                      </td>
                    </tr>
                  ) : !data?.providerUsage.length ? (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-muted-foreground">
                        暂无提供商用量数据
                      </td>
                    </tr>
                  ) : (
                    data.providerUsage.map((provider) => (
                      <tr
                        key={provider.providerId}
                        className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                      >
                        <td className="py-3 px-4 font-medium">{provider.providerName}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(provider.tokenUsage)}</td>
                        <td className="py-3 px-4 text-right">{provider.requestUsage.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>用户用量排行</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/15">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">排名</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">用户名</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Token用量</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-muted-foreground">
                        加载中...
                      </td>
                    </tr>
                  ) : !data?.topUsers.length ? (
                    <tr>
                      <td colSpan={3} className="text-center py-8 text-muted-foreground">
                        暂无用户用量数据
                      </td>
                    </tr>
                  ) : (
                    data.topUsers.slice(0, 10).map((user, idx) => (
                      <tr
                        key={user.userId}
                        className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                              idx < 3
                                ? "bg-primary/10 text-primary"
                                : "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary"
                            }`}
                          >
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium">{user.name || user.username}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(user.tokenUsage)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
