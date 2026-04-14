"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SecuritySettings {
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumber: boolean;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  globalIpWhitelist: string[];
  globalIpBlacklist: string[];
  allowUserCustomDesensitize: boolean;
}

interface SecurityResponse {
  settings: SecuritySettings;
}

const defaultSettings: SecuritySettings = {
  passwordMinLength: 8,
  passwordRequireUppercase: false,
  passwordRequireNumber: false,
  loginMaxAttempts: 5,
  loginLockMinutes: 30,
  globalIpWhitelist: [],
  globalIpBlacklist: [],
  allowUserCustomDesensitize: false,
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
          checked ? "bg-primary" : "bg-light-nav dark:bg-dark-nav"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function AdminSecurityPage() {
  const [form, setForm] = useState<SecuritySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security");
      if (res.ok) {
        const data: SecurityResponse = await res.json();
        setForm(data.settings);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      setMessage({ type: "success", text: "安全设置已保存" });
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">安全设置</h1>
          <p className="text-muted-foreground">管理系统安全策略与访问控制</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">加载中...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">安全设置</h1>
        <p className="text-muted-foreground">管理系统安全策略与访问控制</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>密码策略</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">最小密码长度</label>
              <Input
                type="number"
                min={4}
                max={128}
                value={form.passwordMinLength}
                onChange={(e) => updateField("passwordMinLength", parseInt(e.target.value) || 8)}
                className="max-w-xs"
              />
            </div>
            <Toggle
              label="要求包含大写字母"
              checked={form.passwordRequireUppercase}
              onChange={(val) => updateField("passwordRequireUppercase", val)}
            />
            <Toggle
              label="要求包含数字"
              checked={form.passwordRequireNumber}
              onChange={(val) => updateField("passwordRequireNumber", val)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>登录安全</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">最大登录尝试次数</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={form.loginMaxAttempts}
                onChange={(e) => updateField("loginMaxAttempts", parseInt(e.target.value) || 5)}
                className="max-w-xs"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">锁定时长（分钟）</label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={form.loginLockMinutes}
                onChange={(e) => updateField("loginLockMinutes", parseInt(e.target.value) || 30)}
                className="max-w-xs"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>IP 访问控制</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">IP 白名单</label>
              <textarea
                rows={4}
                value={form.globalIpWhitelist.join("\n")}
                onChange={(e) =>
                  updateField(
                    "globalIpWhitelist",
                    e.target.value.split("\n").filter((line) => line.trim() !== "")
                  )
                }
                placeholder={"每行一个 IP 或 CIDR，例如：\n192.168.1.0/24\n10.0.0.1"}
                className="w-full max-w-lg rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-y"
              />
              <p className="text-xs text-muted-foreground mt-1">每行一个 IP 地址或 CIDR 段，留空表示不限制</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">IP 黑名单</label>
              <textarea
                rows={4}
                value={form.globalIpBlacklist.join("\n")}
                onChange={(e) =>
                  updateField(
                    "globalIpBlacklist",
                    e.target.value.split("\n").filter((line) => line.trim() !== "")
                  )
                }
                placeholder={"每行一个 IP 或 CIDR，例如：\n192.168.1.100\n10.0.0.0/8"}
                className="w-full max-w-lg rounded-md border border-primary/20 dark:border-primary/30 bg-light-input dark:bg-dark-input px-3 py-2 text-sm text-light-text-primary dark:text-dark-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-y"
              />
              <p className="text-xs text-muted-foreground mt-1">每行一个 IP 地址或 CIDR 段，黑名单中的 IP 将被拒绝访问</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>脱敏权限</CardTitle>
          </CardHeader>
          <CardContent>
            <Toggle
              label="允许用户自定义脱敏规则"
              checked={form.allowUserCustomDesensitize}
              onChange={(val) => updateField("allowUserCustomDesensitize", val)}
            />
          </CardContent>
        </Card>

        {message && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              message.type === "success"
                ? "bg-success/5 text-success dark:bg-success/10 dark:text-success"
                : "bg-error/5 text-error dark:bg-error/10 dark:text-error"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </div>
      </form>
    </div>
  );
}
