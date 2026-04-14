export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-dark-bg text-foreground">
      {children}
    </div>
  );
} 