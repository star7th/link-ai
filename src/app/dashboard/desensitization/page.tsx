"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface DesensitizeRule {
  id: number;
  name: string;
  ruleType: string;
  pattern: string;
  replacement: string;
  action: string;
  isEnabled: boolean;
}

interface RulesResponse {
  rules: DesensitizeRule[];
}

interface RuleForm {
  name: string;
  ruleType: string;
  pattern: string;
  replacement: string;
  action: string;
  isEnabled: boolean;
}

const RULE_TYPES = [
  { value: "regex", label: "正则表达式" },
  { value: "keyword", label: "关键词" },
];

const ACTION_TYPES = [
  { value: "replace", label: "替换" },
  { value: "mask", label: "掩码" },
  { value: "block", label: "拦截" },
];

const REGEX_PRESETS = [
  { label: "手机号", pattern: "1[3-9]\\d{9}", replacement: "[PHONE]" },
  { label: "邮箱", pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", replacement: "[EMAIL]" },
  { label: "身份证", pattern: "\\d{17}[\\dXx]", replacement: "[ID_CARD]" },
  { label: "银行卡号", pattern: "\\d{16,19}", replacement: "[BANK_CARD]" },
  { label: "IP地址", pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}", replacement: "[IP]" },
];

function CreateRuleModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<RuleForm>({
    name: "",
    ruleType: "regex",
    pattern: "",
    replacement: "",
    action: "replace",
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
    if (!form.name.trim() || !form.pattern.trim()) {
      setError("名称和匹配内容为必填项");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/user/desensitize/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建规则失败");
      }
      setForm({ name: "", ruleType: "regex", pattern: "", replacement: "", action: "replace", isEnabled: true });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建规则失败");
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
          <h3 className="text-lg font-semibold mb-4">创建脱敏规则</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                名称 <span className="text-error">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="请输入规则名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">类型</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.ruleType === "keyword" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, ruleType: "keyword", pattern: "", replacement: "" })}
                >
                  关键字
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.ruleType === "regex" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, ruleType: "regex" })}
                >
                  正则
                </Button>
              </div>
            </div>
            {form.ruleType === "regex" && (
              <div>
                <label className="block text-sm font-medium mb-1">常用正则</label>
                <div className="flex flex-wrap gap-2">
                  {REGEX_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          pattern: preset.pattern,
                          replacement: preset.replacement,
                          name: prev.name || preset.label + "脱敏",
                        }));
                      }}
                      className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border border-primary/20 bg-primary/5 text-light-text-primary dark:text-dark-text-primary hover:bg-primary/10 hover:border-primary/40 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                匹配内容 <span className="text-error">*</span>
              </label>
              <Input
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                placeholder={form.ruleType === "regex" ? "请输入正则表达式" : "请输入关键词"}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">替换内容</label>
              <Input
                value={form.replacement}
                onChange={(e) => setForm({ ...form, replacement: e.target.value })}
                placeholder="替换后的文本"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">处置策略</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
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

function EditRuleModal({
  rule,
  isOpen,
  onClose,
  onSuccess,
}: {
  rule: DesensitizeRule | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<RuleForm>({
    name: "",
    ruleType: "regex",
    pattern: "",
    replacement: "",
    action: "replace",
    isEnabled: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen && rule) {
      setForm({
        name: rule.name,
        ruleType: rule.ruleType,
        pattern: rule.pattern,
        replacement: rule.replacement,
        action: rule.action,
        isEnabled: rule.isEnabled,
      });
      setError("");
    }
  }, [isOpen, rule]);

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
    if (!rule) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/user/desensitize/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "更新规则失败");
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "更新规则失败");
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
          <h3 className="text-lg font-semibold mb-4">编辑脱敏规则</h3>
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
              <label className="block text-sm font-medium mb-1">类型</label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.ruleType === "keyword" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, ruleType: "keyword" })}
                >
                  关键字
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.ruleType === "regex" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, ruleType: "regex" })}
                >
                  正则
                </Button>
              </div>
            </div>
            {form.ruleType === "regex" && (
              <div>
                <label className="block text-sm font-medium mb-1">常用正则</label>
                <div className="flex flex-wrap gap-2">
                  {REGEX_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          pattern: preset.pattern,
                          replacement: preset.replacement,
                        }));
                      }}
                      className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border border-primary/20 bg-primary/5 text-light-text-primary dark:text-dark-text-primary hover:bg-primary/10 hover:border-primary/40 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">
                匹配内容 <span className="text-error">*</span>
              </label>
              <Input
                value={form.pattern}
                onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">替换内容</label>
              <Input
                value={form.replacement}
                onChange={(e) => setForm({ ...form, replacement: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">处置策略</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full h-10 rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="editRuleIsEnabled"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="editRuleIsEnabled" className="text-sm font-medium">
                启用
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

export default function DesensitizationPage() {
  const [rules, setRules] = useState<DesensitizeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState<DesensitizeRule | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDestructive: boolean;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {}, isDestructive: false });

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/desensitize/rules");
      if (res.ok) {
        const data: RulesResponse = await res.json();
        setRules(data.rules);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleToggleRuleEnabled = async (rule: DesensitizeRule) => {
    try {
      const res = await fetch(`/api/user/desensitize/rules/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !rule.isEnabled }),
      });
      if (res.ok) fetchRules();
    } catch {
      // ignore
    }
  };

  const handleDelete = (rule: DesensitizeRule) => {
    setConfirmDialog({
      isOpen: true,
      title: "确认删除规则",
      message: `确定要删除脱敏规则 "${rule.name}" 吗？此操作不可恢复。`,
      isDestructive: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/user/desensitize/rules/${rule.id}`, {
            method: "DELETE",
          });
          if (res.ok) fetchRules();
        } catch {
          // ignore
        }
      },
    });
  };

  const ruleTypeLabel = (type: string) => {
    return RULE_TYPES.find((t) => t.value === type)?.label ?? type;
  };

  const actionLabel = (action: string) => {
    return ACTION_TYPES.find((a) => a.value === action)?.label ?? action;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">脱敏规则</h1>
          <p className="text-muted-foreground">管理请求/响应内容脱敏规则</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>创建规则</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>规则列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">名称</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">类型</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">匹配内容</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden lg:table-cell">替换内容</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">处置策略</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">状态</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      加载中...
                    </td>
                  </tr>
                ) : rules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      暂无脱敏规则
                    </td>
                  </tr>
                ) : (
                  rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="border-b border-primary/10 hover:bg-primary/5 transition-colors"
                    >
                      <td className="py-3 px-4 font-medium">{rule.name}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {ruleTypeLabel(rule.ruleType)}
                        </span>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <code className="text-xs bg-primary/10 dark:bg-primary/15 px-1.5 py-0.5 rounded break-all">
                          {rule.pattern}
                        </code>
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">{rule.replacement || "-"}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary">
                          {actionLabel(rule.action)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleToggleRuleEnabled(rule)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            rule.isEnabled ? "bg-primary" : "bg-light-nav dark:bg-dark-nav"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              rule.isEnabled ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingRule(rule);
                              setShowEditModal(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            onClick={() => handleDelete(rule)}
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
        </CardContent>
      </Card>

      <CreateRuleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchRules}
      />

      <EditRuleModal
        rule={editingRule}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingRule(null);
        }}
        onSuccess={fetchRules}
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
