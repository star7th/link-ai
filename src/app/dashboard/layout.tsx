import { UserSidebar } from "@/components/layout/user-sidebar";
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell sidebar={<UserSidebar />}>
      {children}
    </AppShell>
  );
}
