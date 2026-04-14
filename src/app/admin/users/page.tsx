"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface User {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  status: string;
  createdAt: string;
  _count: { tokens: number };
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CreateUserForm {
  username: string;
  password: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CreateUserForm>({
    username: "",
    password: "",
    name: "",
    email: "",
    isAdmin: false,
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
    if (!form.username.trim() || !form.password.trim()) {
      setError("用户名和密码为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建用户失败");
      }
      setForm({ username: "", password: "", name: "", email: "", isAdmin: false });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建用户失败");
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
          <h3 className="text-lg font-semibold mb-4">添加用户</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                用户名 <span className="text-error">*</span>
              </label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="请输入用户名"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                密码 <span className="text-error">*</span>
              </label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="请输入密码"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">姓名</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">邮箱</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="请输入邮箱"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isAdmin"
                checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="isAdmin" className="text-sm font-medium">
                管理员权限
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

function EditUserModal({
  user,
  isOpen,
  onClose,
  onSuccess,
}: {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", isAdmin: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && user) {
      setForm({ name: user.name || "", email: user.email || "", isAdmin: user.isAdmin });
      setError("");
    }
  }, [isOpen, user]);

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
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新用户失败");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新用户失败");
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
          <h3 className="text-lg font-semibold mb-4">编辑用户</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">用户名</label>
              <Input value={user?.username || ""} disabled />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">姓名</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">邮箱</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="请输入邮箱"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="editIsAdmin"
                checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="editIsAdmin" className="text-sm font-medium">
                管理员权限
              </label>
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

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
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

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const data: UsersResponse = await res.json();
        setUsers(data.users);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearchChange = (value: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      setSearch(value);
    }, 300);
  };

  const handleStatusFilterChange = (value: string) => {
    setPage(1);
    setStatusFilter(value);
  };

  const handleToggleStatus = (user: User) => {
    const newStatus = user.status === "active" ? "disabled" : "active";
    const label = newStatus === "disabled" ? "禁用" : "启用";
    setConfirmDialog({
      isOpen: true,
      title: `确认${label}用户`,
      message: `确定要${label}用户 "${user.username}" 吗？`,
      isDestructive: newStatus === "disabled",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/admin/users/${user.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          });
          if (res.ok) fetchUsers();
        } catch {
          // ignore
        }
      },
    });
  };

  const handleResetPassword = (user: User) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认重置密码",
      message: `确定要重置用户 "${user.username}" 的密码吗？系统将生成新的随机密码。`,
      isDestructive: false,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            alert(`新密码: ${data.password || "请查看返回结果"}`);
          }
        } catch {
          // ignore
        }
      },
    });
  };

  const handleDelete = (user: User) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认删除用户",
      message: `确定要删除用户 "${user.username}" 吗？此操作不可恢复。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/admin/users/${user.id}`, {
            method: "DELETE",
          });
          if (res.ok) fetchUsers();
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
          <h1 className="text-3xl font-bold">用户管理</h1>
          <p className="text-muted-foreground">管理系统用户账户</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>添加用户</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="搜索用户名、姓名或邮箱..."
                onChange={(e) => handleSearchChange(e.target.value)}
                className="max-w-sm"
              />
            </div>
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
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">用户名</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">姓名</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">邮箱</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">角色</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">令牌数</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">创建时间</th>
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
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      暂无用户数据
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{user.username}</td>
                      <td className="py-3 px-4">{user.name || "-"}</td>
                      <td className="py-3 px-4 hidden md:table-cell">{user.email || "-"}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            user.isAdmin
                              ? "bg-primary/10 text-primary"
                              : "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary"
                          }`}
                        >
                          {user.isAdmin ? "管理员" : "普通用户"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            user.status === "active"
                              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                              : "bg-error/10 text-error dark:bg-error/15 dark:text-error"
                          }`}
                        >
                          {user.status === "active" ? "正常" : "已禁用"}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">{user._count.tokens}</td>
                      <td className="py-3 px-4 hidden lg:table-cell">{formatDate(user.createdAt)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingUser(user);
                              setShowEditModal(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(user)}
                          >
                            {user.status === "active" ? "禁用" : "启用"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetPassword(user)}
                          >
                            重置密码
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            onClick={() => handleDelete(user)}
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

      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchUsers}
      />

      <EditUserModal
        user={editingUser}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingUser(null);
        }}
        onSuccess={fetchUsers}
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
