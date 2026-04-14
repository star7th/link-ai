export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-dark-bg relative">
      <div className="w-full max-w-md z-10 relative">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-cyan-600">
            智链 AI 网关
          </h1>
          <p className="text-foreground mt-2">企业级 AI 模型安全网关平台</p>
        </div>
        <div className="relative">
          {children}
        </div>
      </div>
    </div>
  );
} 