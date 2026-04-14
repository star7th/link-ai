'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode, useEffect, useState } from 'react';

interface AuthContextProps {
  children: ReactNode;
}

export default function AuthContext({ children }: AuthContextProps) {
  const [hasError, setHasError] = useState(false);
  
  // 监听会话错误并记录
  useEffect(() => {
    // 检查URL参数是否有会话错误
    const urlParams = new URLSearchParams(window.location.search);
    const sessionError = urlParams.get('error');
    
    if (sessionError) {
      console.error('检测到会话错误:', sessionError);
      setHasError(true);
    }
    
    console.log('AuthContext 已初始化');
  }, []);
  
  return (
    <SessionProvider 
      refetchInterval={hasError ? 5 : 0} // 如果有错误，每5秒尝试一次
      refetchOnWindowFocus={hasError} // 如果有错误，在窗口获取焦点时重新获取
    >
      {children}
    </SessionProvider>
  );
} 