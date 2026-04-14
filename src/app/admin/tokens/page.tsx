"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface TokenUser {
  id: number;
  username: string;
  name: string | null;
}

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
  keyPlain: string | null;
  status: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  quotaTokenLimit: number | null;
  createdAt: string;
  user: TokenUser;
  tokenProviders: TokenProvider[];
}

interface TokensResponse {
  tokens: Token[];
  total: number;
  page: number;
  totalPages: number;
}

interface User {
  id: number;
  username: string;
  name: string | null;
}

interface Provider {
  id: number;
  name: string;
  code: string;
  status: string;
}

interface CreateTokenForm {
  name: string;
  rpmLimit: string;
  tpmLimit: string;
  quotaTokenLimit: string;
  providerIds: string[];
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
    providerIds: [],
  });
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingProviders, setFetchingProviders] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [createdKey, setCreatedKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);

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
      fetch("/api/admin/providers?limit=100")
        .then((res) => res.json())
        .then((data) => {
          setProviders(
            (data.providers || []).filter((p: Provider) => p.status === "active")
          );
        })
        .catch(() => {
          setProviders([]);
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
      const body: Record<string, unknown> = {
        name: form.name,
      };
      if (form.rpmLimit) body.rpmLimit = Number(form.rpmLimit);
      if (form.tpmLimit) body.tpmLimit = Number(form.tpmLimit);
      if (form.quotaTokenLimit) body.quotaTokenLimit = Number(form.quotaTokenLimit);
      if (form.providerIds && form.providerIds.length > 0) {
        body.providerIds = form.providerIds;
      }
      const res = await fetch("/api/admin/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建令牌失败");
      }
      const data = await res.json();
      setForm({
        name: "",
        rpmLimit: "",
        tpmLimit: "",
        quotaTokenLimit: "",
        providerIds: [],
      });
      onSuccess();
      if (data.apiKey) {
        setCreatedKey(data.apiKey);
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
          <h3 className="text-lg font-semibold mb-4">添加令牌</h3>
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
              <label className="block text-sm font-medium mb-1">绑定提供商（可选）</label>
              <div className="space-y-2 max-h-32 overflow-y-auto border border-primary/20 dark:border-primary/30 rounded-md p-2">
                {fetchingProviders ? (
                  <div className="text-sm text-muted-foreground py-2">加载中...</div>
                ) : providers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">暂无可用提供商</div>
                ) : (
                  providers.map((provider) => (
                    <label key={provider.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded border-primary/30 text-primary focus:ring-primary"
                        checked={form.providerIds.includes(provider.id.toString())}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setForm({
                              ...form,
                              providerIds: [...form.providerIds, provider.id.toString()],
                            });
                          } else {
                            setForm({
                              ...form,
                              providerIds: form.providerIds.filter((id) => id !== provider.id.toString()),
                            });
                          }
                        }}
                      />
                      <span className="text-sm">{provider.name}</span>
                      <span className="text-xs text-muted-foreground">({provider.code})</span>
                    </label>
                  ))
                )}
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

export default function AdminTokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive: boolean;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {}, isDestructive: false });

  const limit = 20;

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

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/tokens?${params}`);
      if (res.ok) {
        const data: TokensResponse = await res.json();
        setTokens(data.tokens);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleStatusFilterChange = (value: string) => {
    setPage(1);
    setStatusFilter(value);
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
          const res = await fetch(`/api/admin/tokens/${token.id}/status`, {
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
          const res = await fetch(`/api/admin/tokens/${token.id}`, {
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

  const handleCopyKey = async (token: Token) => {
    const key = token.keyPlain;
    if (!key) {
      alert("密钥不可用");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(key);
      } catch {
        fallbackCopy(key);
      }
    } else {
      fallbackCopy(key);
    }
    setCopiedId(token.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getProviderNames = (tokenProviders: TokenProvider[]) => {
    if (!tokenProviders || tokenProviders.length === 0) return "-";
    return tokenProviders
      .sort((a, b) => a.priority - b.priority)
      .map((tp) => tp.provider.name)
      .join(", ");
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">令牌管理</h1>
          <p className="text-muted-foreground">管理系统 API 令牌</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>添加令牌</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <select
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value)}
                className="h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <option value="">全部状态</option>
                <option value="active">正常</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">名称</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Key前缀</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">所属用户</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">绑定提供商</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">RPM限制</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden xl:table-cell">创建时间</th>
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
                ) : tokens.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      暂无令牌数据
                    </td>
                  </tr>
                ) : (
                  tokens.map((token) => (
                    <tr
                      key={token.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{token.name}</td>
                      <td className="py-3 px-4">
                        <code className="text-xs bg-primary/10 dark:bg-primary/15 px-1.5 py-0.5 rounded">
                          {token.keyPrefix}...
                        </code>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        {token.user.name || token.user.username}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="text-xs">{getProviderNames(token.tokenProviders)}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            token.status === "active"
                              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                              : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                          }`}
                        >
                          {token.status === "active" ? "正常" : "已禁用"}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        {token.rpmLimit ?? "无限制"}
                      </td>
                      <td className="py-3 px-4 hidden xl:table-cell">{formatDate(token.createdAt)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyKey(token)}
                          >
                            {copiedId === token.id ? "已复制" : "复制密钥"}
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

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        isDestructive={confirmDialog.isDestructive}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      <CreateTokenModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchTokens}
      />
    </div>
  );
}
