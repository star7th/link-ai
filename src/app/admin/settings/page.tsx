"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SystemSettings {
  timezone: string;
  dataRetentionDays: number;
  registrationEnabled: boolean;
  auditLogArchiveEnabled: boolean;
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>({
    timezone: "Asia/Shanghai",
    dataRetentionDays: 90,
    registrationEnabled: true,
    auditLogArchiveEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch {
        // ignore fetch errors
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setMessage("保存成功");
        setTimeout(() => setMessage(""), 3000);
      } else {
        const data = await res.json();
        setMessage(data.error || "保存失败");
      }
    } catch {
      setMessage("保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <p className="text-muted-foreground text-center py-8">加载中...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">系统设置</h1>
        <p className="text-muted-foreground">管理系统全局配置</p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">基本设置</h3>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-md space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">时区</label>
              <Input
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                placeholder="Asia/Shanghai"
              />
              <p className="text-xs text-muted-foreground mt-1">系统使用的时区，例如 Asia/Shanghai</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">数据保留天数</label>
              <Input
                type="number"
                value={settings.dataRetentionDays}
                onChange={(e) => setSettings({ ...settings, dataRetentionDays: Number(e.target.value) })}
                placeholder="90"
                min={1}
              />
              <p className="text-xs text-muted-foreground mt-1">审计日志等数据保留的天数，超出将自动清理</p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="registrationEnabled"
                checked={settings.registrationEnabled}
                onChange={(e) => setSettings({ ...settings, registrationEnabled: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="registrationEnabled" className="text-sm font-medium">
                开放用户注册
              </label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">允许新用户自行注册账户</p>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="auditLogArchiveEnabled"
                checked={settings.auditLogArchiveEnabled}
                onChange={(e) => setSettings({ ...settings, auditLogArchiveEnabled: e.target.checked })}
                className="h-4 w-4 form-checkbox"
              />
              <label htmlFor="auditLogArchiveEnabled" className="text-sm font-medium">
                启用审计日志归档
              </label>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">自动归档过期的审计日志</p>
          </div>

          <div className="flex items-center gap-4 pt-4 border-t border-primary/15">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存设置"}
            </Button>
            {message && (
              <span
                className={`text-sm ${message === "保存成功" ? "text-success dark:text-success" : "text-error"}`}
              >
                {message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
