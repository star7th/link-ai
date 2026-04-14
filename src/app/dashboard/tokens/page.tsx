"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface TokenProvider {
  priority: number;
  provider: {
    id: number;
    name: string;
    code: string;
  };
}

interface Token {
  id: number;
  name: string;
  keyPrefix: string;
  status: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  quotaTokenLimit: number | null;
  createdAt: string;
  tokenProviders: TokenProvider[];
}

interface TokensResponse {
  tokens: Token[];
}

interface CreateTokenForm {
  name: string;
  rpmLimit: string;
  tpmLimit: string;
  quotaTokenLimit: string;
  providers: { providerId: string; priority: number }[];
}

interface AvailableProvider {
  id: string;
  name: string;
  code: string;
}

function CreateTokenModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreateTokenForm>({
    name: "",
    rpmLimit: "",
    tpmLimit: "",
    quotaTokenLimit: "",
    providers: [],
  });
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingProviders, setFetchingProviders] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const fallbackCopy = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      setCreatedKey("");
      setKeyCopied(false);
      setFetchingProviders(true);
      fetch("/api/user/providers")
        .then((res) => res.json())
        .then((data) => {
          setAvailableProviders(data.providers || []);
        })
        .catch(() => {
          setAvailableProviders([]);
        })
        .finally(() => {
          setFetchingProviders(false);
        });
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("令牌名称为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = { name: form.name };
      if (form.rpmLimit) body.rpmLimit = Number(form.rpmLimit);
      if (form.tpmLimit) body.tpmLimit = Number(form.tpmLimit);
      if (form.quotaTokenLimit) body.quotaTokenLimit = Number(form.quotaTokenLimit);
      if (form.providers.length > 0) body.providers = form.providers;
      const res = await fetch("/api/user/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建令牌失败");
      }
      const data = await res.json();
      setForm({ name: "", rpmLimit: "", tpmLimit: "", quotaTokenLimit: "", providers: [] });
      onSuccess();
      if (data.key) {
        setCreatedKey(data.key);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建令牌失败");
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
      <div className="relative max-w-md w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">创建令牌</h3>
          {createdKey ? (
            <div className="space-y-4">
              <div className="rounded-md bg-success/5 dark:bg-success/10 border border-success/20 p-4">
                <p className="text-sm font-medium text-success mb-2">令牌创建成功</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-primary/10 dark:bg-primary/15 rounded px-3 py-2 break-all select-all">
                    {createdKey}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(createdKey).then(() => {
                          setKeyCopied(true);
                          setTimeout(() => setKeyCopied(false), 2000);
                        }).catch(() => {
                          fallbackCopy(createdKey);
                          setKeyCopied(true);
                          setTimeout(() => setKeyCopied(false), 2000);
                        });
                      } else {
                        fallbackCopy(createdKey);
                        setKeyCopied(true);
                        setTimeout(() => setKeyCopied(false), 2000);
                      }
                    }}
                  >
                    {keyCopied ? "已复制" : "复制"}
                  </Button>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={onClose}>
                  关闭
                </Button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入令牌名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">RPM限制</label>
              <Input
                type="number"
                value={form.rpmLimit}
                onChange={(e) => setForm({ ...form, rpmLimit: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">TPM限制</label>
              <Input
                type="number"
                value={form.tpmLimit}
                onChange={(e) => setForm({ ...form, tpmLimit: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Token配额限制</label>
              <Input
                type="number"
                value={form.quotaTokenLimit}
                onChange={(e) => setForm({ ...form, quotaTokenLimit: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">绑定提供商（可选，不选则默认使用全部可用提供商）</label>
              <div className="space-y-2">
                {form.providers.length > 0 && (
                  <div className="space-y-1 border border-primary/20 dark:border-primary/30 rounded-md p-2">
                    {form.providers.map((p, idx) => {
                      const prov = availableProviders.find((ap) => ap.id === p.providerId);
                      return (
                        <div
                          key={p.providerId}
                          draggable
                          onDragStart={() => setDragIdx(idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragIdx !== null && dragIdx !== idx) {
                              const items = [...form.providers];
                              const [moved] = items.splice(dragIdx, 1);
                              items.splice(idx, 0, moved);
                              setForm({ ...form, providers: items });
                            }
                            setDragIdx(null);
                          }}
                          onDragEnd={() => setDragIdx(null)}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none ${dragIdx === idx ? "opacity-50 bg-primary/10" : "hover:bg-primary/5"}`}
                        >
                          <span className="text-xs text-muted-foreground">☰</span>
                          <span className="text-xs font-mono text-muted-foreground">{idx + 1}.</span>
                          <span className="text-sm">{prov?.name || p.providerId}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-6 w-6 p-0 text-error hover:text-error"
                            onClick={() => {
                              setForm({ ...form, providers: form.providers.filter((_, i) => i !== idx) });
                            }}
                          >
                            ×
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto border border-primary/20 dark:border-primary/30 rounded-md p-2">
                  {fetchingProviders ? (
                    <div className="text-sm text-muted-foreground py-2">加载中...</div>
                  ) : availableProviders.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-2">暂无可用提供商</div>
                  ) : (
                    availableProviders
                      .filter((ap) => !form.providers.some((p) => p.providerId === ap.id))
                      .map((provider) => (
                        <label key={provider.id} className="flex items-center gap-2 cursor-pointer py-1">
                          <input
                            type="checkbox"
                            className="rounded border-primary/30 text-primary focus:ring-primary"
                            checked={false}
                            onChange={() => {
                              setForm({ ...form, providers: [...form.providers, { providerId: provider.id, priority: form.providers.length + 1 }] });
                            }}
                          />
                          <span className="text-sm">{provider.name}</span>
                          <span className="text-xs text-muted-foreground">({provider.code})</span>
                        </label>
                      ))
                  )}
                </div>
              </div>
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
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function EditTokenModal({
  token,
  isOpen,
  onClose,
  onSuccess,
}: {
  token: Token | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({ name: "", rpmLimit: "", tpmLimit: "", status: "", providers: [] as { providerId: string; priority: number }[] });
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && token) {
      setForm({
        name: token.name,
        rpmLimit: token.rpmLimit?.toString() ?? "",
        tpmLimit: token.tpmLimit?.toString() ?? "",
        status: token.status,
        providers: token.tokenProviders.map((tp, idx) => ({ providerId: String(tp.provider.id), priority: idx + 1 })),
      });
      setError("");
      fetch("/api/user/providers")
        .then((res) => res.json())
        .then((data) => setAvailableProviders(data.providers || []))
        .catch(() => setAvailableProviders([]));
    }
  }, [isOpen, token]);

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
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        status: form.status,
      };
      if (form.rpmLimit) body.rpmLimit = Number(form.rpmLimit);
      if (form.tpmLimit) body.tpmLimit = Number(form.tpmLimit);
      body.providers = form.providers.map((p, idx) => ({ providerId: p.providerId, priority: idx + 1 }));
      const res = await fetch(`/api/user/tokens/${token.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新令牌失败");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新令牌失败");
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
      <div className="relative max-w-md w-full mx-4 dark:bg-dark-card bg-light-card rounded-lg shadow-lg border border-primary/15 overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">编辑令牌</h3>
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
              <label className="block text-sm font-medium mb-1">状态</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">RPM限制</label>
              <Input
                type="number"
                value={form.rpmLimit}
                onChange={(e) => setForm({ ...form, rpmLimit: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">TPM限制</label>
              <Input
                type="number"
                value={form.tpmLimit}
                onChange={(e) => setForm({ ...form, tpmLimit: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">绑定提供商（拖动排序调整优先级）</label>
              <div className="space-y-2">
                {form.providers.length > 0 && (
                  <div className="space-y-1 border border-primary/20 dark:border-primary/30 rounded-md p-2">
                    {form.providers.map((p, idx) => {
                      const prov = availableProviders.find((ap) => ap.id === p.providerId);
                      return (
                        <div
                          key={p.providerId}
                          draggable
                          onDragStart={() => setDragIdx(idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragIdx !== null && dragIdx !== idx) {
                              const items = [...form.providers];
                              const [moved] = items.splice(dragIdx, 1);
                              items.splice(idx, 0, moved);
                              setForm({ ...form, providers: items });
                            }
                            setDragIdx(null);
                          }}
                          onDragEnd={() => setDragIdx(null)}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none ${dragIdx === idx ? "opacity-50 bg-primary/10" : "hover:bg-primary/5"}`}
                        >
                          <span className="text-xs text-muted-foreground">☰</span>
                          <span className="text-xs font-mono text-muted-foreground">{idx + 1}.</span>
                          <span className="text-sm">{prov?.name || p.providerId}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-6 w-6 p-0 text-error hover:text-error"
                            onClick={() => {
                              setForm({ ...form, providers: form.providers.filter((_, i) => i !== idx) });
                            }}
                          >
                            ×
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto border border-primary/20 dark:border-primary/30 rounded-md p-2">
                  {availableProviders
                    .filter((ap) => !form.providers.some((p) => p.providerId === ap.id))
                    .map((provider) => (
                      <label key={provider.id} className="flex items-center gap-2 cursor-pointer py-1">
                        <input
                          type="checkbox"
                          className="rounded border-primary/30 text-primary focus:ring-primary"
                          checked={false}
                          onChange={() => {
                            setForm({ ...form, providers: [...form.providers, { providerId: provider.id, priority: form.providers.length + 1 }] });
                          }}
                        />
                        <span className="text-sm">{provider.name}</span>
                      </label>
                    ))}
                </div>
              </div>
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

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingToken, setEditingToken] = useState<Token | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive: boolean;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {}, isDestructive: false });

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/tokens");
      if (res.ok) {
        const data: TokensResponse = await res.json();
        setTokens(data.tokens);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleRotate = (token: Token) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认轮换密钥",
      message: `确定要轮换令牌 "${token.name}" 的密钥吗？旧密钥将立即失效。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/user/tokens/${token.id}/rotate`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            alert(`新密钥: ${data.key}\n${data.message || ""}\n请妥善保管，此密钥仅显示一次。`);
          }
        } catch {
          // ignore
        }
      },
    });
  };

  const handleToggleStatus = (token: Token) => {
    const newStatus = token.status === "active" ? "disabled" : "active";
    const label = newStatus === "disabled" ? "禁用" : "启用";
    setConfirmDialog({
      isOpen: true,
      title: `确认${label}令牌`,
      message: `确定要${label}令牌 "${token.name}" 吗？`,
      isDestructive: newStatus === "disabled",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/user/tokens/${token.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          if (res.ok) fetchTokens();
        } catch {
          // ignore
        }
      },
    });
  };

  const handleDelete = (token: Token) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认删除令牌",
      message: `确定要删除令牌 "${token.name}" 吗？此操作不可恢复。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/user/tokens/${token.id}`, {
            method: "DELETE",
          });
          if (res.ok) fetchTokens();
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

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">令牌管理</h1>
          <p className="text-muted-foreground">管理API访问令牌</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>创建令牌</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <span className="ml-3 text-muted-foreground">加载中...</span>
        </div>
      ) : tokens.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            暂无令牌数据
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.map((token) => (
            <Card key={token.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold">{token.name}</CardTitle>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      token.status === "active"
                        ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                        : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                    }`}
                  >
                    {token.status === "active" ? "正常" : "已禁用"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">密钥前缀:</span>
                  <code className="text-xs bg-primary/10 dark:bg-primary/15 px-1.5 py-0.5 rounded">
                    {token.keyPrefix}...
                  </code>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">RPM限制:</span>
                  <span>{token.rpmLimit ?? "无限制"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">TPM限制:</span>
                  <span>{token.tpmLimit ?? "无限制"}</span>
                </div>
                {token.quotaTokenLimit && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Token配额:</span>
                    <span>{token.quotaTokenLimit.toLocaleString()}</span>
                  </div>
                )}
                {token.tokenProviders.length > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">提供商:</span>
                    <div className="flex flex-wrap gap-1">
                      {token.tokenProviders.map((tp, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                        >
                          {idx + 1}. {tp.provider.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {token.tokenProviders.length === 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">提供商:</span>
                    <span className="text-xs text-muted-foreground">默认使用全部可用</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">创建时间:</span>
                  <span>{formatDate(token.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1 pt-2 border-t border-primary/15">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingToken(token);
                      setShowEditModal(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRotate(token)}
                  >
                    轮换密钥
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleStatus(token)}
                  >
                    {token.status === "active" ? "禁用" : "启用"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    onClick={() => handleDelete(token)}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateTokenModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchTokens}
      />

      <EditTokenModal
        token={editingToken}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingToken(null);
        }}
        onSuccess={fetchTokens}
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
