import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AppShell } from "@/components/layout/app-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell sidebar={<AdminSidebar />}>
      {children}
    </AppShell>
  );
}
