import "./globals.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import AuthContext from "@/context/AuthContext";
import { ThemeProvider } from "@/components/theme-provider";
import DynamicToaster from "@/components/dynamic-toaster";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body className="font-sans bg-light-bg dark:bg-dark-bg text-light-text-primary dark:text-dark-text-primary">
        <ThemeProvider defaultTheme="dark">
          <AuthContext>
            {children}
          </AuthContext>
          <DynamicToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
