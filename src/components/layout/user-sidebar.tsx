"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const userNavItems = [
  { href: "/dashboard/overview", label: "概览", icon: "fa-chart-pie" },
  { href: "/dashboard/tokens", label: "我的令牌", icon: "fa-key" },
  { href: "/dashboard/desensitization", label: "脱敏规则", icon: "fa-shield-halved" },
  { href: "/dashboard/audit-logs", label: "审计日志", icon: "fa-scroll" },
  { href: "/dashboard/usage", label: "用量统计", icon: "fa-chart-bar" },
  { href: "/dashboard/alerts", label: "我的告警", icon: "fa-bell" },
  { href: "/dashboard/profile", label: "个人信息", icon: "fa-user" },
];

export function UserSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen flex flex-col glass-effect border-r border-primary/10 dark:border-primary/15 bg-light-card/85 dark:bg-dark-card/85">
      <div className="p-6 border-b border-primary/10 dark:border-primary/15">
        <Link href="/dashboard" className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          智链 AI 网关
        </Link>
        <p className="text-xs text-light-text-tertiary dark:text-dark-text-tertiary mt-1">用户控制台</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {userNavItems.map((item) => {
          const isActive = pathname === item.href;
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
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="text-sm text-light-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors"
          >
            <i className="fa-solid fa-right-from-bracket mr-2" />
            退出登录
          </button>
        </form>
        <ThemeToggle />
      </div>
    </aside>
  );
}
