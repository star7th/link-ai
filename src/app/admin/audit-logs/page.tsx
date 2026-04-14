"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuditLog {
  id: number;
  logType: string;
  action: string;
  requestMethod: string;
  responseStatus: number;
  responseTime: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isStream: boolean;
  failover: boolean;
  ipAddress: string;
  createdAt: string;
  requestBody?: string;
  responseBody?: string;
  user: { username: string } | null;
  token: { name: string; keyPrefix: string } | null;
  provider: { name: string } | null;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
  fullBodyEnabled: boolean;
}

function LogDetailModal({
  log,
  isOpen,
  onClose,
}: {
  log: AuditLog | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  if (!mounted || !isOpen || !log) return null;

  const tryFormatJson = (str: string | undefined | null) => {
    if (!str) return null;
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-[90vw] max-w-4xl max-h-[85vh] mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-primary/15">
          <h3 className="text-lg font-semibold">审计日志详情</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">时间：</span>{new Date(log.createdAt).toLocaleString("zh-CN")}</div>
            <div><span className="text-muted-foreground">类型：</span>{log.logType}</div>
            <div><span className="text-muted-foreground">用户：</span>{log.user?.username || "-"}</div>
            <div><span className="text-muted-foreground">令牌：</span>{log.token ? `${log.token.keyPrefix}...${log.token.name}` : "-"}</div>
            <div><span className="text-muted-foreground">提供商：</span>{log.provider?.name || "-"}</div>
            <div><span className="text-muted-foreground">方法：</span>{log.requestMethod || "-"}</div>
            <div><span className="text-muted-foreground">路径：</span><span className="font-mono text-xs">{log.action}</span></div>
            <div><span className="text-muted-foreground">状态码：</span>{log.responseStatus}</div>
            <div><span className="text-muted-foreground">耗时：</span>{log.responseTime ? `${log.responseTime}ms` : "-"}</div>
            <div><span className="text-muted-foreground">Token用量：</span>{log.totalTokens || "-"}</div>
            <div><span className="text-muted-foreground">IP：</span>{log.ipAddress || "-"}</div>
            <div><span className="text-muted-foreground">流式：</span>{log.isStream ? "是" : "否"}</div>
          </div>
          {(tryFormatJson(log.requestBody)) && (
            <div>
              <div className="text-sm font-medium mb-1">请求体</div>
              <pre className="text-xs bg-primary/5 dark:bg-primary/10 border border-primary/15 rounded-md p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all">
                {tryFormatJson(log.requestBody)}
              </pre>
            </div>
          )}
          {(tryFormatJson(log.responseBody)) && (
            <div>
              <div className="text-sm font-medium mb-1">响应体</div>
              <pre className="text-xs bg-primary/5 dark:bg-primary/10 border border-primary/15 rounded-md p-3 overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all">
                {tryFormatJson(log.responseBody)}
              </pre>
            </div>
          )}
          {!log.requestBody && !log.responseBody && (
            <div className="text-sm text-muted-foreground text-center py-4">
              未记录请求/响应内容（需开启"记录完整请求/响应"开关）
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

const LOG_TYPE_MAP: Record<string, string> = {
  request: "请求",
  operation: "操作",
  system: "系统",
  desensitize_hit: "脱敏命中",
};

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [logType, setLogType] = useState("");
  const [userId, setUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [fullBodyEnabled, setFullBodyEnabled] = useState(false);
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);
  const limit = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (logType) params.set("logType", logType);
      if (userId) params.set("userId", userId);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data: AuditLogsResponse = await res.json();
        setLogs(data.logs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setFullBodyEnabled(data.fullBodyEnabled ?? false);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page, logType, userId, startDate, endDate]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilter = () => {
    setPage(1);
    fetchLogs();
  };

  const handleToggleFullBody = async () => {
    const newVal = !fullBodyEnabled;
    try {
      const res = await fetch("/api/admin/audit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullBodyEnabled: newVal }),
      });
      if (res.ok) {
        setFullBodyEnabled(newVal);
      }
    } catch {
      // ignore
    }
  };

  const handleViewDetail = async (log: AuditLog) => {
    try {
      const res = await fetch(`/api/admin/audit/${log.id}`);
      if (res.ok) {
        const detail = await res.json();
        setDetailLog(detail);
      }
    } catch {
      setDetailLog(log);
    }
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getLogTypeBadgeClass = (type: string) => {
    switch (type) {
      case "request":
        return "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary";
      case "operation":
        return "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary";
      case "system":
        return "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning";
      case "desensitize_hit":
        return "bg-error/10 text-error dark:bg-error/15 dark:text-error";
      default:
        return "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary";
    }
  };

  const formatTokens = (log: AuditLog) => {
    if (!log.totalTokens) return "-";
    return `${log.totalTokens.toLocaleString()}`;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">审计日志</h1>
        <p className="text-muted-foreground">查看系统审计日志记录</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">日志类型</label>
              <select
                value={logType}
                onChange={(e) => setLogType(e.target.value)}
                className="h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="">全部类型</option>
                <option value="request">请求</option>
                <option value="operation">操作</option>
                <option value="system">系统</option>
                <option value="desensitize_hit">脱敏命中</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">用户ID</label>
              <Input
                placeholder="输入用户ID"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="max-w-[160px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">开始日期</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="max-w-[180px]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">结束日期</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="max-w-[180px]"
              />
            </div>
            <Button onClick={handleFilter}>筛选</Button>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">记录完整请求/响应</span>
              <button
                type="button"
                role="switch"
                aria-checked={fullBodyEnabled}
                onClick={handleToggleFullBody}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  fullBodyEnabled ? "bg-primary" : "bg-light-nav dark:bg-dark-nav"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    fullBodyEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">时间</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">类型</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">用户</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">令牌</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">提供商</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">操作/路径</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态码</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">Token用量</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">耗时</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">IP</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">详情</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-muted-foreground">
                      暂无日志数据
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap text-xs">{formatDateTime(log.createdAt)}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getLogTypeBadgeClass(log.logType)}`}
                        >
                          {LOG_TYPE_MAP[log.logType] || log.logType}
                        </span>
                      </td>
                      <td className="py-3 px-4">{log.user?.username || "-"}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {log.token ? (
                          <span className="text-xs" title={log.token.name}>
                            {log.token.keyPrefix}...{log.token.name}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">{log.provider?.name || "-"}</td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs" title={log.action}>
                          {log.action.length > 40 ? `${log.action.slice(0, 40)}...` : log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            log.responseStatus >= 200 && log.responseStatus < 300
                              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                              : log.responseStatus >= 400 && log.responseStatus < 500
                                ? "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning"
                                : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                          }`}
                        >
                          {log.responseStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">{formatTokens(log)}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {log.responseTime ? `${log.responseTime}ms` : "-"}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell font-mono text-xs">{log.ipAddress || "-"}</td>
                      <td className="py-3 px-4">
                        <Button variant="ghost" size="sm" onClick={() => handleViewDetail(log)}>
                          查看
                        </Button>
                      </td>
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

      <LogDetailModal
        log={detailLog}
        isOpen={!!detailLog}
        onClose={() => setDetailLog(null)}
      />
    </div>
  );
}
