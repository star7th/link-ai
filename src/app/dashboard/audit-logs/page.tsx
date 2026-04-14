"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AuditLog {
  id: number;
  logType: string;
  action: string;
  responseStatus: number;
  totalTokens: number | null;
  responseTime: number | null;
  createdAt: string;
  token: { name: string } | null;
  provider: { name: string } | null;
}

interface AuditLogsResponse {
  logs: AuditLog[];
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/audit");
      if (res.ok) {
        const data: AuditLogsResponse = await res.json();
        setLogs(data.logs.slice(0, 100));
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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

  const logTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      chat: "对话",
      completion: "补全",
      embedding: "嵌入",
      image: "图片",
      audio: "音频",
    };
    return map[type] ?? type;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">审计日志</h1>
          <p className="text-muted-foreground">查看API调用记录</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近调用记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">时间</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">类型</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">令牌</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">提供商</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态码</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">Token用量</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">耗时</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      暂无审计日志
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 text-xs">{formatDate(log.createdAt)}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {logTypeLabel(log.logType)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">{log.token?.name ?? "-"}</td>
                      <td className="py-3 px-4 hidden md:table-cell">{log.provider?.name ?? "-"}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            log.responseStatus >= 200 && log.responseStatus < 300
                              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                              : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                          }`}
                        >
                          {log.responseStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {log.totalTokens != null ? log.totalTokens.toLocaleString() : "-"}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {log.responseTime != null ? `${log.responseTime}ms` : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
