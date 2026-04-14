'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

interface RegisterFormProps {
  isAdminSetup?: boolean;
}

export default function RegisterForm({ isAdminSetup = true }: RegisterFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // 验证表单
    if (!username || !password || !confirmPassword) {
      setError('请填写所有必填字段');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少为6个字符');
      setLoading(false);
      return;
    }

    try {
      console.log("开始注册:", username);
      // 调用注册API
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || '注册失败');
      }

      console.log("注册成功，开始登录");
      // 注册成功后自动登录
      const result = await signIn('credentials', {
        redirect: false,
        login: username, // 使用用户名登录
        password,
      });

      console.log("登录结果:", result);
      if (result?.error) {
        setError('自动登录失败，请尝试手动登录');
        setLoading(false);
        return;
      }

      // 登录成功，直接跳转到仪表盘
      console.log("登录成功，跳转到仪表盘");
      router.push('/dashboard');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('注册过程中发生错误');
      }
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <form onSubmit={handleSubmit} className="bg-card p-8 rounded-xl shadow-lg border border-purple-600/15">
        <h2 className="text-2xl font-bold text-center mb-6 text-primary">
          {isAdminSetup ? "创建管理员账户" : "创建新账户"}
        </h2>
        {isAdminSetup && (
          <p className="text-center mb-6 text-foreground text-sm">您是第一个用户，将被设置为系统管理员</p>
        )}
        
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-error text-sm">
            {error}
          </div>
        )}
        
        <div className="mb-4">
          <label htmlFor="username" className="block mb-2 text-sm font-medium text-foreground">
            账户名 <span className="text-red-500">*</span>
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600 z-10"
            required
            style={{ zIndex: 10 }}
          />
        </div>
        
        <div className="mb-4">
          <label htmlFor="password" className="block mb-2 text-sm font-medium text-foreground">
            密码 <span className="text-red-500">*</span>
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600 z-10"
            required
            style={{ zIndex: 10 }}
          />
        </div>
        
        <div className="mb-6">
          <label htmlFor="confirmPassword" className="block mb-2 text-sm font-medium text-foreground">
            确认密码 <span className="text-red-500">*</span>
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600 z-10"
            required
            style={{ zIndex: 10 }}
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-md hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-70 z-10"
          style={{ zIndex: 10 }}
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <i className="fas fa-circle-notch fa-spin mr-2"></i> 注册中...
            </span>
          ) : (
            isAdminSetup ? "创建管理员账户" : "注册"
          )}
        </button>
      </form>
    </div>
  );
} 