"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Profile {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
  quotaTokenLimit: number | null;
  quotaRequestLimit: number | null;
}

export default function DashboardProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileMsgType, setProfileMsgType] = useState<"success" | "error">("success");

  const [pwForm, setPwForm] = useState({ oldPassword: "", newPassword: "" });
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwMsgType, setPwMsgType] = useState<"success" | "error">("success");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile");
      if (res.ok) {
        const data: Profile = await res.json();
        setProfile(data);
        setForm({ name: data.name || "", email: data.email || "" });
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setProfileMsg("保存成功");
        setProfileMsgType("success");
        fetchProfile();
      } else {
        const data = await res.json();
        setProfileMsg(data.error || "保存失败");
        setProfileMsgType("error");
      }
    } catch {
      setProfileMsg("保存失败");
      setProfileMsgType("error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwForm.oldPassword || !pwForm.newPassword) {
      setPwMsg("请填写完整");
      setPwMsgType("error");
      return;
    }
    setSavingPw(true);
    setPwMsg("");
    try {
      const res = await fetch("/api/user/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pwForm),
      });
      if (res.ok) {
        setPwMsg("密码修改成功");
        setPwMsgType("success");
        setPwForm({ oldPassword: "", newPassword: "" });
      } else {
        const data = await res.json();
        setPwMsg(data.error || "修改失败");
        setPwMsgType("error");
      }
    } catch {
      setPwMsg("修改失败");
      setPwMsgType("error");
    } finally {
      setSavingPw(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <span className="ml-3 text-muted-foreground">加载中...</span>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">个人信息</h1>
          <p className="text-muted-foreground">管理您的账户信息</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">用户名</label>
              <Input value={profile?.username || ""} disabled />
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
            <div className="flex items-center gap-4">
              <Button type="submit" disabled={savingProfile}>
                {savingProfile ? "保存中..." : "保存"}
              </Button>
              {profileMsg && (
                <p className={`text-sm ${profileMsgType === "success" ? "text-success dark:text-success" : "text-error"}`}>
                  {profileMsg}
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">当前密码</label>
              <Input
                type="password"
                value={pwForm.oldPassword}
                onChange={(e) => setPwForm({ ...pwForm, oldPassword: e.target.value })}
                placeholder="请输入当前密码"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">新密码</label>
              <Input
                type="password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                placeholder="请输入新密码"
              />
            </div>
            <div className="flex items-center gap-4">
              <Button type="submit" disabled={savingPw}>
                {savingPw ? "修改中..." : "修改密码"}
              </Button>
              {pwMsg && (
                <p className={`text-sm ${pwMsgType === "success" ? "text-success dark:text-success" : "text-error"}`}>
                  {pwMsg}
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {profile && (
        <Card>
          <CardHeader>
            <CardTitle>账户信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">角色</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  profile.isAdmin
                    ? "bg-primary/10 text-primary"
                    : "bg-primary/10 text-light-text-tertiary dark:bg-primary/15 dark:text-dark-text-tertiary"
                }`}
              >
                {profile.isAdmin ? "管理员" : "普通用户"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">注册时间</span>
              <span>{formatDate(profile.createdAt)}</span>
            </div>
            {profile.quotaTokenLimit && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Token配额</span>
                <span>{profile.quotaTokenLimit.toLocaleString()}</span>
              </div>
            )}
            {profile.quotaRequestLimit && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">请求配额</span>
                <span>{profile.quotaRequestLimit.toLocaleString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
