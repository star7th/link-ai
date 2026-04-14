"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const adminNavItems = [
  { href: "/admin/overview", label: "管理概览", icon: "fa-chart-pie" },
  { href: "/admin/providers", label: "提供商管理", icon: "fa-server" },
  { href: "/admin/tokens", label: "令牌管理", icon: "fa-key" },
  { href: "/admin/desensitization", label: "脱敏规则", icon: "fa-shield-halved" },
  { href: "/admin/audit-logs", label: "审计日志", icon: "fa-scroll" },
  { href: "/admin/users", label: "用户管理", icon: "fa-users" },
  { href: "/admin/settings", label: "系统设置", icon: "fa-gear" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen flex flex-col glass-effect border-r border-primary/10 dark:border-primary/15 bg-light-card/85 dark:bg-dark-card/85">
      <div className="p-6 border-b border-primary/10 dark:border-primary/15">
        <Link href="/admin/overview" className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          智链 AI 网关
        </Link>
        <p className="text-xs text-light-text-tertiary dark:text-dark-text-tertiary mt-1">管理员后台</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {adminNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/admin/overview" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-primary/15 to-secondary/10 text-primary font-medium shadow-sm shadow-primary/10"
                  : "text-light-text-secondary dark:text-dark-text-secondary hover:bg-primary/5 hover:text-primary"
              )}
            >
              <span className={cn(
                "w-5 text-center",
                isActive && "icon-glow"
              )}>
                <i className={`fa-solid ${item.icon}`} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-primary/10 dark:border-primary/15 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-light-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors"
          >
            <i className="fa-solid fa-arrow-right-from-bracket mr-1" />
            返回用户端
          </Link>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="text-sm text-light-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors"
            >
              <i className="fa-solid fa-right-from-bracket mr-1" />
              退出登录
            </button>
          </form>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
