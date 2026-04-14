"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AlertRule {
  id: number;
  name: string;
  triggerCondition: string;
  threshold: number;
  cooldown: number;
  channels: string[];
  recipientAdmins: number[];
  recipientUsers: number[];
  isEnabled: boolean;
}

interface AlertLog {
  id: number;
  level: string;
  title: string;
  message: string;
  status: string;
  createdAt: string;
  rule: { name: string } | null;
}

interface AlertLogsResponse {
  logs: AlertLog[];
  total: number;
  page: number;
}

interface AlertChannels {
  email: { host: string; port: number; secure: boolean; user: string; from: string } & Record<string, unknown>;
  feishu: { webhookUrl: string } & Record<string, unknown>;
  dingtalk: { webhookUrl: string } & Record<string, unknown>;
  wecom: { webhookUrl: string } & Record<string, unknown>;
  [key: string]: Record<string, unknown>;
}

interface CreateRuleForm {
  name: string;
  triggerCondition: string;
  threshold: number;
  cooldown: number;
  channels: string[];
  recipientAdmins: number[];
  recipientUsers: number[];
  messageTemplate: string;
  isEnabled: boolean;
}

function CreateRuleModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreateRuleForm>({
    name: "",
    triggerCondition: "error_rate",
    threshold: 10,
    cooldown: 300,
    channels: [],
    recipientAdmins: [],
    recipientUsers: [],
    messageTemplate: "",
    isEnabled: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("规则名称为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建规则失败");
      }
      setForm({
        name: "",
        triggerCondition: "error_rate",
        threshold: 10,
        cooldown: 300,
        channels: [],
        recipientAdmins: [],
        recipientUsers: [],
        messageTemplate: "",
        isEnabled: true,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建规则失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (channel: string) => {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter((c) => c !== channel)
        : [...prev.channels, channel],
    }));
  };

  if (!mounted || !isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-w-lg w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">创建告警规则</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                规则名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入规则名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">触发条件</label>
              <select
                value={form.triggerCondition}
                onChange={(e) => setForm({ ...form, triggerCondition: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="error_rate">错误率</option>
                <option value="response_time">响应时间</option>
                <option value="token_usage">Token用量</option>
                <option value="request_count">请求次数</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">阈值</label>
                <Input
                  type="number"
                  value={form.threshold}
                  onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })}
                  placeholder="阈值"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">冷却时间(秒)</label>
                <Input
                  type="number"
                  value={form.cooldown}
                  onChange={(e) => setForm({ ...form, cooldown: Number(e.target.value) })}
                  placeholder="冷却时间"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">通知渠道</label>
              <div className="flex flex-wrap gap-2">
                {["email", "feishu", "dingtalk", "wecom"].map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => toggleChannel(channel)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      form.channels.includes(channel)
                        ? "bg-primary text-white border-primary"
                        : "border-primary/20 dark:border-primary/30 text-light-text-primary dark:text-dark-text-primary hover:bg-primary/5"
                    }`}
                  >
                    {channel === "email"
                      ? "邮件"
                      : channel === "feishu"
                        ? "飞书"
                        : channel === "dingtalk"
                          ? "钉钉"
                          : "企业微信"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">消息模板</label>
              <textarea
                value={form.messageTemplate}
                onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })}
                placeholder="请输入告警消息模板"
                rows={3}
                className="w-full rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="ruleIsEnabled"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="ruleIsEnabled" className="text-sm font-medium">
                启用规则
              </label>
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end space-x-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "创建"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function AdminAlertsPage() {
  const [activeTab, setActiveTab] = useState<"rules" | "logs" | "channels">("rules");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);
  const [channels, setChannels] = useState<AlertChannels>({
    email: { host: "", port: 465, secure: true, user: "", from: "" },
    feishu: { webhookUrl: "" },
    dingtalk: { webhookUrl: "" },
    wecom: { webhookUrl: "" },
  });
  const [rulesLoading, setRulesLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsSaving, setChannelsSaving] = useState(false);
  const [channelsMessage, setChannelsMessage] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const logsLimit = 50;

  const fetchRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await fetch("/api/admin/alerts/rules");
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setRulesLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(logsPage),
        limit: String(logsLimit),
      });
      const res = await fetch(`/api/admin/alerts/logs?${params}`);
      if (res.ok) {
        const data: AlertLogsResponse = await res.json();
        setLogs(data.logs || []);
        setLogsTotal(data.total);
        setLogsTotalPages(Math.ceil(data.total / logsLimit) || 1);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLogsLoading(false);
    }
  }, [logsPage]);

  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const res = await fetch("/api/admin/alerts/channels");
      if (res.ok) {
        const data = await res.json();
        if (data.channels) {
          setChannels((prev) => ({
            ...prev,
            ...data.channels,
          }));
        }
      }
    } catch {
      // ignore fetch errors
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs();
    }
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab === "channels") {
      fetchChannels();
    }
  }, [activeTab, fetchChannels]);

  const handleSaveChannels = async () => {
    setChannelsSaving(true);
    setChannelsMessage("");
    try {
      const res = await fetch("/api/admin/alerts/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channels }),
      });
      if (res.ok) {
        setChannelsMessage("保存成功");
        setTimeout(() => setChannelsMessage(""), 3000);
      } else {
        const data = await res.json();
        setChannelsMessage(data.error || "保存失败");
      }
    } catch {
      setChannelsMessage("保存失败");
    } finally {
      setChannelsSaving(false);
    }
  };

  const handleTestChannel = async (channel: string) => {
    try {
      const res = await fetch("/api/admin/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, message: "测试告警消息" }),
      });
      if (res.ok) {
        alert("测试消息已发送");
      } else {
        const data = await res.json();
        alert(data.error || "发送失败");
      }
    } catch {
      alert("发送失败");
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/admin/alerts/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !rule.isEnabled }),
      });
      if (res.ok) fetchRules();
    } catch {
      // ignore
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

  const getLevelBadgeClass = (level: string) => {
    switch (level) {
      case "critical":
        return "bg-error/10 text-error dark:bg-error/15 dark:text-error";
      case "warning":
        return "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning";
      case "info":
        return "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary";
      default:
        return "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary";
    }
  };

  const getLevelLabel = (level: string) => {
    switch (level) {
      case "critical":
        return "严重";
      case "warning":
        return "警告";
      case "info":
        return "信息";
      default:
        return level;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "pending":
        return "待处理";
      case "sent":
        return "已发送";
      case "failed":
        return "发送失败";
      default:
        return status;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning";
      case "sent":
        return "bg-success/10 text-success dark:bg-success/15 dark:text-success";
      case "failed":
        return "bg-error/10 text-error dark:bg-error/15 dark:text-error";
      default:
        return "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary";
    }
  };

  const tabs = [
    { key: "rules" as const, label: "告警规则" },
    { key: "logs" as const, label: "告警日志" },
    { key: "channels" as const, label: "通知渠道" },
  ];

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">告警管理</h1>
          <p className="text-muted-foreground">管理系统告警规则与通知</p>
        </div>
        {activeTab === "rules" && (
          <Button onClick={() => setShowCreateModal(true)}>创建规则</Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-primary/15">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-light-text-primary dark:hover:text-dark-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "rules" && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/15">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">规则名称</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">触发条件</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">阈值</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">冷却(秒)</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">通知渠道</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rulesLoading ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        加载中...
                      </td>
                    </tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-muted-foreground">
                        暂无告警规则
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule) => (
                      <tr
                        key={rule.id}
                        className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                      >
                        <td className="py-3 px-4 font-medium">{rule.name}</td>
                        <td className="py-3 px-4">{rule.triggerCondition}</td>
                        <td className="py-3 px-4">{rule.threshold}</td>
                        <td className="py-3 px-4 hidden md:table-cell">{rule.cooldown}</td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {rule.channels.map((ch) => (
                              <span
                                key={ch}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                              >
                                {ch === "email"
                                  ? "邮件"
                                  : ch === "feishu"
                                    ? "飞书"
                                    : ch === "dingtalk"
                                      ? "钉钉"
                                      : "企业微信"}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              rule.isEnabled
                                ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                                : "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary"
                            }`}
                          >
                            {rule.isEnabled ? "已启用" : "已禁用"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleRule(rule)}
                            >
                              {rule.isEnabled ? "禁用" : "启用"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "logs" && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/15">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">时间</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">级别</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">标题</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">规则</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">消息</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {logsLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        加载中...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        暂无告警日志
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
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getLevelBadgeClass(log.level)}`}
                          >
                            {getLevelLabel(log.level)}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium">{log.title}</td>
                        <td className="py-3 px-4 hidden md:table-cell">{log.rule?.name || "-"}</td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          <span className="text-xs" title={log.message}>
                            {log.message.length > 60 ? `${log.message.slice(0, 60)}...` : log.message}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(log.status)}`}
                          >
                            {getStatusLabel(log.status)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {logsTotalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-primary/15">
                <p className="text-sm text-muted-foreground">
                  共 {logsTotal} 条记录，第 {logsPage}/{logsTotalPages} 页
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={logsPage <= 1}
                    onClick={() => setLogsPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  {Array.from({ length: logsTotalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === logsTotalPages || Math.abs(p - logsPage) <= 1)
                    .map((p, idx, arr) => {
                      const showEllipsis = idx > 0 && arr[idx - 1] < p - 1;
                      return (
                        <span key={p} className="flex items-center gap-2">
                          {showEllipsis && (
                            <span className="text-muted-foreground px-1">...</span>
                          )}
                          <Button
                            variant={p === logsPage ? "default" : "outline"}
                            size="sm"
                            onClick={() => setLogsPage(p)}
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
                    disabled={logsPage >= logsTotalPages}
                    onClick={() => setLogsPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "channels" && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">通知渠道配置</h3>
          </CardHeader>
          <CardContent className="space-y-8">
            {channelsLoading ? (
              <p className="text-center py-8 text-muted-foreground">加载中...</p>
            ) : (
              <>
                <div className="space-y-4">
                  <h4 className="font-medium text-base">邮件 (Email)</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">SMTP主机</label>
                      <Input
                        value={(channels.email?.host as string) || ""}
                        onChange={(e) =>
                          setChannels((prev) => ({
                            ...prev,
                            email: { ...prev.email, host: e.target.value },
                          }))
                        }
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">端口</label>
                      <Input
                        type="number"
                        value={(channels.email?.port as number) || 465}
                        onChange={(e) =>
                          setChannels((prev) => ({
                            ...prev,
                            email: { ...prev.email, port: Number(e.target.value) },
                          }))
                        }
                        placeholder="465"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">用户名</label>
                      <Input
                        value={(channels.email?.user as string) || ""}
                        onChange={(e) =>
                          setChannels((prev) => ({
                            ...prev,
                            email: { ...prev.email, user: e.target.value },
                          }))
                        }
                        placeholder="user@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">发件人地址</label>
                      <Input
                        value={(channels.email?.from as string) || ""}
                        onChange={(e) =>
                          setChannels((prev) => ({
                            ...prev,
                            email: { ...prev.email, from: e.target.value },
                          }))
                        }
                        placeholder="noreply@example.com"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleTestChannel("email")}>
                      测试
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-base">飞书 (Feishu)</h4>
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL</label>
                    <Input
                      value={(channels.feishu?.webhookUrl as string) || ""}
                      onChange={(e) =>
                        setChannels((prev) => ({
                          ...prev,
                          feishu: { ...prev.feishu, webhookUrl: e.target.value },
                        }))
                      }
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleTestChannel("feishu")}>
                    测试
                  </Button>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-base">钉钉 (DingTalk)</h4>
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL</label>
                    <Input
                      value={(channels.dingtalk?.webhookUrl as string) || ""}
                      onChange={(e) =>
                        setChannels((prev) => ({
                          ...prev,
                          dingtalk: { ...prev.dingtalk, webhookUrl: e.target.value },
                        }))
                      }
                      placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleTestChannel("dingtalk")}>
                    测试
                  </Button>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-base">企业微信 (WeCom)</h4>
                  <div>
                    <label className="block text-sm font-medium mb-1">Webhook URL</label>
                    <Input
                      value={(channels.wecom?.webhookUrl as string) || ""}
                      onChange={(e) =>
                        setChannels((prev) => ({
                          ...prev,
                          wecom: { ...prev.wecom, webhookUrl: e.target.value },
                        }))
                      }
                      placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleTestChannel("wecom")}>
                    测试
                  </Button>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-primary/15">
                  <Button onClick={handleSaveChannels} disabled={channelsSaving}>
                    {channelsSaving ? "保存中..." : "保存配置"}
                  </Button>
                  {channelsMessage && (
                    <span
                      className={`text-sm ${channelsMessage === "保存成功" ? "text-success dark:text-success" : "text-error"}`}
                    >
                      {channelsMessage}
                    </span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <CreateRuleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchRules}
      />
    </div>
  );
}
