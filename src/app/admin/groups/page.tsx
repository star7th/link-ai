"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface Group {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  _count: { members: number; groupProviders: number };
}

interface GroupsResponse {
  groups: Group[];
  total: number;
  page: number;
  totalPages: number;
}

interface GroupForm {
  name: string;
  description: string;
}

function CreateGroupModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<GroupForm>({ name: "", description: "" });
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
      setError("用户组名称为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建用户组失败");
      }
      setForm({ name: "", description: "" });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建用户组失败");
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
          <h3 className="text-lg font-semibold mb-4">新建用户组</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入用户组名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">描述</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="请输入描述"
              />
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

function EditGroupModal({
  group,
  isOpen,
  onClose,
  onSuccess,
}: {
  group: Group | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<GroupForm>({ name: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && group) {
      setForm({ name: group.name, description: group.description || "" });
      setError("");
    }
  }, [isOpen, group]);

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
    if (!group) return;
    if (!form.name.trim()) {
      setError("用户组名称为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/groups/${group.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新用户组失败");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新用户组失败");
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
          <h3 className="text-lg font-semibold mb-4">编辑用户组</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入用户组名称"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">描述</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="请输入描述"
              />
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

export default function AdminGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive: boolean;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {}, isDestructive: false });

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limit = 20;

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/groups?${params}`);
      if (res.ok) {
        const data: GroupsResponse = await res.json();
        setGroups(data.groups);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleSearchChange = (value: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      setSearch(value);
    }, 300);
  };

  const handleDelete = (group: Group) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认删除用户组",
      message: `确定要删除用户组 "${group.name}" 吗？此操作不可恢复。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/admin/groups/${group.id}`, {
            method: "DELETE",
          });
          if (res.ok) fetchGroups();
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
          <h1 className="text-3xl font-bold">用户组管理</h1>
          <p className="text-muted-foreground">管理用户组及其配置</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>新建用户组</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="搜索用户组名称..."
                onChange={(e) => handleSearchChange(e.target.value)}
                className="max-w-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">名称</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">描述</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">成员数</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">提供商数</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">创建时间</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : groups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      暂无用户组数据
                    </td>
                  </tr>
                ) : (
                  groups.map((group) => (
                    <tr
                      key={group.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{group.name}</td>
                      <td className="py-3 px-4">{group.description || "-"}</td>
                      <td className="py-3 px-4">{group._count.members}</td>
                      <td className="py-3 px-4">{group._count.groupProviders}</td>
                      <td className="py-3 px-4 hidden lg:table-cell">{formatDate(group.createdAt)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingGroup(group);
                              setShowEditModal(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            onClick={() => handleDelete(group)}
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

      <CreateGroupModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchGroups}
      />

      <EditGroupModal
        group={editingGroup}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingGroup(null);
        }}
        onSuccess={fetchGroups}
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
