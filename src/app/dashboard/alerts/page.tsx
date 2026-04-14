"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Alert {
  id: number;
  level: string;
  title: string;
  message: string;
  createdAt: string;
  rule: { name: string } | null;
}

interface AlertsResponse {
  alerts: Alert[];
  total: number;
  page: number;
}

function LevelBadge({ level }: { level: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    info: {
      bg: "bg-primary/10 dark:bg-primary/15",
      text: "text-primary dark:text-primary",
      label: "信息",
    },
    warning: {
      bg: "bg-warning/10 dark:bg-warning/15",
      text: "text-warning dark:text-warning",
      label: "警告",
    },
    critical: {
      bg: "bg-error/10 dark:bg-error/15",
      text: "text-error dark:text-error",
      label: "严重",
    },
  };
  const c = config[level] || config.info;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

export default function DashboardAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const limit = 20;

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`/api/user/alerts?${params}`);
      if (res.ok) {
        const data: AlertsResponse = await res.json();
        setAlerts(data.alerts);
        setTotal(data.total);
        setTotalPages(Math.ceil(data.total / limit));
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">告警记录</h1>
          <p className="text-muted-foreground">查看系统告警与通知</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>告警列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">时间</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">级别</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">标题</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">消息</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">规则</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      暂无告警记录
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr
                      key={alert.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 text-xs whitespace-nowrap">{formatDate(alert.createdAt)}</td>
                      <td className="py-3 px-4">
                        <LevelBadge level={alert.level} />
                      </td>
                      <td className="py-3 px-4 font-medium">{alert.title}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-xs break-all">{alert.message}</span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">{alert.rule?.name ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-primary/15">
              <p className="text-sm text-muted-foreground">
                共 {total} 条记录，第 {page}/{totalPages} 页
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .map((p, idx, arr) => {
                    const showEllipsis = idx > 0 && arr[idx - 1] < p - 1;
                    return (
                      <span key={p} className="flex items-center gap-2">
                        {showEllipsis && (
                          <span className="text-muted-foreground px-1">...</span>
                        )}
                        <Button
                          variant={p === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPage(p)}
                          className="min-w-[36px]"
                        >
                          {p}
                        </Button>
                      </span>
                    );
                  })}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
