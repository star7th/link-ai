"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Provider {
  id: number;
  name: string;
  code: string;
  protocolType: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  status: string;
  healthStatus: string;
  totalRpmLimit: number | null;
  totalTpmLimit: number | null;
  modelRedirect: string | null;
  createdAt: string;
}

interface ProvidersResponse {
  providers: Provider[];
  total: number;
  page: number;
  totalPages: number;
}

interface ModelRedirectRule {
  from: string;
  to: string;
}

interface CreateProviderForm {
  name: string;
  code: string;
  protocolType: string;
  apiBaseUrl: string;
  apiKey: string;
  totalRpmLimit: string;
  totalTpmLimit: string;
  modelRedirectRules: ModelRedirectRule[];
}

interface EditProviderForm {
  name: string;
  status: string;
  apiBaseUrl: string;
  apiKey: string;
  totalRpmLimit: string;
  totalTpmLimit: string;
  modelRedirectRules: ModelRedirectRule[];
}

interface TestResult {
  connected: boolean;
  latency?: number;
  models?: string[];
  error?: string;
}

const PROTOCOL_TYPES = [
  { value: "openai", label: "OpenAI" },
  { value: "azure", label: "Azure" },
  { value: "anthropic", label: "Anthropic" },
  { value: "dashscope", label: "DashScope" },
  { value: "custom", label: "Custom" },
];

function parseModelRedirect(json: string | null): ModelRedirectRule[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr;
    return [];
  } catch {
    return [];
  }
}

function serializeModelRedirect(rules: ModelRedirectRule[]): string | null {
  const filtered = rules.filter(r => r.from.trim() && r.to.trim());
  return filtered.length > 0 ? JSON.stringify(filtered) : null;
}

function HealthBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    healthy: {
      bg: "bg-success/10 dark:bg-success/15",
      text: "text-success dark:text-success",
      label: "健康",
    },
    degraded: {
      bg: "bg-warning/10 dark:bg-warning/15",
      text: "text-warning dark:text-warning",
      label: "降级",
    },
    down: {
      bg: "bg-error/10 dark:bg-error/15",
      text: "text-error dark:text-error",
      label: "故障",
    },
    unknown: {
      bg: "bg-primary/10 dark:bg-primary/15",
      text: "text-light-text-tertiary dark:text-dark-text-tertiary",
      label: "未知",
    },
  };
  const c = config[status] || config.unknown;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

function TestResultModal({
  result,
  isOpen,
  onClose,
  loading,
}: {
  result: TestResult | null;
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
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

  if (!mounted || !isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-w-md w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">连接测试结果</h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <span className="ml-3 text-muted-foreground">测试中...</span>
            </div>
          ) : result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">连接状态:</span>
                {result.connected ? (
                  <span className="text-success dark:text-success font-medium">成功</span>
                ) : (
                  <span className="text-error dark:text-error font-medium">失败</span>
                )}
              </div>
              {result.latency !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">延迟:</span>
                  <span className="text-sm">{result.latency}ms</span>
                </div>
              )}
              {result.error && (
                <div>
                  <span className="text-sm font-medium">错误信息:</span>
                  <p className="text-sm text-error mt-1 break-all">{result.error}</p>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function ModelRedirectEditor({
  rules,
  onChange,
}: {
  rules: ModelRedirectRule[];
  onChange: (rules: ModelRedirectRule[]) => void;
}) {
  const addRule = () => {
    onChange([...rules, { from: "", to: "" }]);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: "from" | "to", value: string) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={rule.from}
            onChange={(e) => updateRule(index, "from", e.target.value)}
            placeholder="请求模型名"
            className="flex-1"
          />
          <span className="text-muted-foreground text-sm shrink-0">→</span>
          <Input
            value={rule.to}
            onChange={(e) => updateRule(index, "to", e.target.value)}
            placeholder="重写为"
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-error hover:text-error shrink-0"
            onClick={() => removeRule(index)}
          >
            删除
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        + 添加映射
      </Button>
      {rules.length > 0 && (
        <p className="text-xs text-muted-foreground">
          当客户端请求左侧模型时，将自动替换为右侧模型名发送给上游
        </p>
      )}
    </div>
  );
}

function CreateProviderModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreateProviderForm>({
    name: "",
    code: "",
    protocolType: "openai",
    apiBaseUrl: "",
    apiKey: "",
    totalRpmLimit: "",
    totalTpmLimit: "",
    modelRedirectRules: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    if (!form.name.trim() || !form.code.trim() || !form.apiBaseUrl.trim() || !form.apiKey.trim()) {
      setError("名称、代码、API地址和API密钥为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        code: form.code,
        protocolType: form.protocolType,
        apiBaseUrl: form.apiBaseUrl,
        apiKey: form.apiKey,
      };
      if (form.totalRpmLimit) body.totalRpmLimit = Number(form.totalRpmLimit);
      if (form.totalTpmLimit) body.totalTpmLimit = Number(form.totalTpmLimit);
      const modelRedirect = serializeModelRedirect(form.modelRedirectRules);
      if (modelRedirect) body.modelRedirect = modelRedirect;
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建提供商失败");
      }
      setForm({
        name: "",
        code: "",
        protocolType: "openai",
        apiBaseUrl: "",
        apiKey: "",
        totalRpmLimit: "",
        totalTpmLimit: "",
        modelRedirectRules: [],
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建提供商失败");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted || !isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-w-lg w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden">
        <div className="p-6 max-h-[85vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">添加提供商</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入提供商名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                代码 <span className="text-error">*</span>
              </label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="请输入唯一代码（如 openai-main）"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                协议类型 <span className="text-error">*</span>
              </label>
              <select
                value={form.protocolType}
                onChange={(e) => setForm({ ...form, protocolType: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {PROTOCOL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                API地址 <span className="text-error">*</span>
              </label>
              <Input
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                API密钥 <span className="text-error">*</span>
              </label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="请输入API密钥"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">RPM限制</label>
                <Input
                  type="number"
                  value={form.totalRpmLimit}
                  onChange={(e) => setForm({ ...form, totalRpmLimit: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">TPM限制</label>
                <Input
                  type="number"
                  value={form.totalTpmLimit}
                  onChange={(e) => setForm({ ...form, totalTpmLimit: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="border-t border-primary/15 pt-3">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-light-text-primary dark:hover:text-dark-text-primary transition-colors"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>▶</span>
                高级设置
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">模型重定向</label>
                    <ModelRedirectEditor
                      rules={form.modelRedirectRules}
                      onChange={(rules) => setForm({ ...form, modelRedirectRules: rules })}
                    />
                  </div>
                </div>
              )}
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

function EditProviderModal({
  provider,
  isOpen,
  onClose,
  onSuccess,
}: {
  provider: Provider | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<EditProviderForm>({
    name: "",
    status: "active",
    apiBaseUrl: "",
    apiKey: "",
    totalRpmLimit: "",
    totalTpmLimit: "",
    modelRedirectRules: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && provider) {
      setForm({
        name: provider.name,
        status: provider.status,
        apiBaseUrl: provider.apiBaseUrl,
        apiKey: "",
        totalRpmLimit: provider.totalRpmLimit?.toString() ?? "",
        totalTpmLimit: provider.totalTpmLimit?.toString() ?? "",
        modelRedirectRules: parseModelRedirect(provider.modelRedirect),
      });
      setError("");
      setShowAdvanced(!!provider.modelRedirect);
    }
  }, [isOpen, provider]);

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
    if (!provider) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        status: form.status,
        apiBaseUrl: form.apiBaseUrl,
      };
      if (form.apiKey.trim()) body.apiKey = form.apiKey;
      if (form.totalRpmLimit) body.totalRpmLimit = Number(form.totalRpmLimit);
      if (form.totalTpmLimit) body.totalTpmLimit = Number(form.totalTpmLimit);
      body.modelRedirect = serializeModelRedirect(form.modelRedirectRules);
      const res = await fetch(`/api/admin/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新提供商失败");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新提供商失败");
    } finally {
      setLoading(false);
    }
  };

  if (!mounted || !isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-w-lg w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden">
        <div className="p-6 max-h-[85vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">编辑提供商</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">代码</label>
              <Input value={provider?.code || ""} disabled />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">状态</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="active">正常</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API地址</label>
              <Input
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API密钥</label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="留空则不修改"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">RPM限制</label>
                <Input
                  type="number"
                  value={form.totalRpmLimit}
                  onChange={(e) => setForm({ ...form, totalRpmLimit: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">TPM限制</label>
                <Input
                  type="number"
                  value={form.totalTpmLimit}
                  onChange={(e) => setForm({ ...form, totalTpmLimit: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="border-t border-primary/15 pt-3">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-light-text-primary dark:hover:text-dark-text-primary transition-colors"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>▶</span>
                高级设置
              </button>
              {showAdvanced && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">模型重定向</label>
                    <ModelRedirectEditor
                      rules={form.modelRedirectRules}
                      onChange={(rules) => setForm({ ...form, modelRedirectRules: rules })}
                    />
                  </div>
                </div>
              )}
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end space-x-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "保存中..." : "保存"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive: boolean;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {}, isDestructive: false });

  const limit = 20;

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`/api/admin/providers?${params}`);
      if (res.ok) {
        const data: ProvidersResponse = await res.json();
        setProviders(data.providers);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleTest = async (provider: Provider) => {
    setTestingId(provider.id);
    setTestLoading(true);
    setTestResult(null);
    setShowTestModal(true);
    try {
      const res = await fetch(`/api/admin/providers/${provider.id}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult(data);
      } else {
        setTestResult({ connected: false, error: data.error || "测试失败" });
      }
    } catch {
      setTestResult({ connected: false, error: "网络请求失败" });
    } finally {
      setTestLoading(false);
      setTestingId(null);
    }
  };

  const handleDelete = (provider: Provider) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认删除提供商",
      message: `确定要删除提供商 "${provider.name}" 吗？此操作不可恢复。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/admin/providers/${provider.id}`, {
            method: "DELETE",
          });
          if (res.ok) fetchProviders();
        } catch {
          // ignore
        }
      },
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const protocolLabel = (type: string) => {
    return PROTOCOL_TYPES.find((t) => t.value === type)?.label ?? type;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">提供商管理</h1>
          <p className="text-muted-foreground">管理AI服务提供商配置</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>添加提供商</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>提供商列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">名称</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">代码</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">协议类型</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">API地址</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">健康状态</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">RPM限制</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : providers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      暂无提供商数据
                    </td>
                  </tr>
                ) : (
                  providers.map((provider) => (
                    <tr
                      key={provider.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{provider.name}</td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <code className="text-xs bg-primary/10 dark:bg-primary/15 px-1.5 py-0.5 rounded">
                          {provider.code}
                        </code>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {protocolLabel(provider.protocolType)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-xs break-all">{provider.apiBaseUrl}</span>
                      </td>
                      <td className="py-3 px-4">
                        <HealthBadge status={provider.healthStatus} />
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {provider.totalRpmLimit ?? "-"}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            provider.status === "active"
                              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                              : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                          }`}
                        >
                          {provider.status === "active" ? "正常" : "已禁用"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={testingId === provider.id}
                            onClick={() => handleTest(provider)}
                          >
                            {testingId === provider.id ? "测试中" : "测试连接"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingProvider(provider);
                              setShowEditModal(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            onClick={() => handleDelete(provider)}
                          >
                            删除
                          </Button>
                        </div>
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

      <CreateProviderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchProviders}
      />

      <EditProviderModal
        provider={editingProvider}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingProvider(null);
        }}
        onSuccess={fetchProviders}
      />

      <TestResultModal
        result={testResult}
        isOpen={showTestModal}
        onClose={() => {
          setShowTestModal(false);
          setTestResult(null);
        }}
        loading={testLoading}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDestructive={confirmDialog.isDestructive}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
