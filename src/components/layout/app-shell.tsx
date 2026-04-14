"use client";

export function AppShell({ children, sidebar }: { children: React.ReactNode; sidebar: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {sidebar}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
