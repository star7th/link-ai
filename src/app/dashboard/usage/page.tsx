"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageData {
  period: string;
  usage: {
    tokens: number;
    requests: number;
    tokenLimit: number;
    requestLimit: number;
    tokenUsagePercent: number;
    requestUsagePercent: number;
  };
  byProvider: {
    provider: string;
    tokens: number;
  }[];
}

export default function DashboardUsagePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/usage");
      if (res.ok) {
        const data: UsageData = await res.json();
        setUsage(data);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">用量统计</h1>
          <p className="text-muted-foreground">查看API使用量与配额</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <span className="ml-3 text-muted-foreground">加载中...</span>
        </div>
      ) : !usage ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            暂无用量数据
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-light-text-tertiary dark:text-dark-text-tertiary">
                  总Token用量（{usage.period}）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-light-text-primary dark:text-dark-text-primary">
                  {usage.usage.tokens.toLocaleString()}
                </p>
                {usage.usage.tokenLimit > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-light-text-tertiary dark:text-dark-text-tertiary">
                      <span>配额使用</span>
                      <span>
                        {usage.usage.tokens.toLocaleString()} / {usage.usage.tokenLimit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10 dark:bg-primary/15">
                      <div
                        className={`h-full rounded-full transition-all ${
                          usage.usage.tokenUsagePercent > 90
                            ? "bg-error"
                            : usage.usage.tokenUsagePercent > 70
                              ? "bg-warning"
                              : "bg-success"
                        }`}
                        style={{ width: `${Math.min(usage.usage.tokenUsagePercent, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-light-text-tertiary dark:text-dark-text-tertiary text-right">
                      {usage.usage.tokenUsagePercent.toFixed(1)}%
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-light-text-tertiary dark:text-dark-text-tertiary">
                  总请求数（{usage.period}）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-light-text-primary dark:text-dark-text-primary">
                  {usage.usage.requests.toLocaleString()}
                </p>
                {usage.usage.requestLimit > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-light-text-tertiary dark:text-dark-text-tertiary">
                      <span>配额使用</span>
                      <span>
                        {usage.usage.requests.toLocaleString()} / {usage.usage.requestLimit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10 dark:bg-primary/15">
                      <div
                        className={`h-full rounded-full transition-all ${
                          usage.usage.requestUsagePercent > 90
                            ? "bg-error"
                            : usage.usage.requestUsagePercent > 70
                              ? "bg-warning"
                              : "bg-success"
                        }`}
                        style={{ width: `${Math.min(usage.usage.requestUsagePercent, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-light-text-tertiary dark:text-dark-text-tertiary text-right">
                      {usage.usage.requestUsagePercent.toFixed(1)}%
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>提供商用量分布</CardTitle>
            </CardHeader>
            <CardContent>
              {usage.byProvider.length === 0 ? (
                <p className="text-center py-6 text-muted-foreground">暂无提供商用量数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-primary/15">
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">提供商</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Token用量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.byProvider.map((item, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                        >
                          <td className="py-3 px-4 font-medium">{item.provider}</td>
                          <td className="py-3 px-4 text-right">{item.tokens.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
