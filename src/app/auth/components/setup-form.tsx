'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function SetupForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      console.log("开始初始化系统...");
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
        throw new Error(data.message || '系统初始化失败');
      }

      console.log("初始化成功，正在登录...");
      // 初始化成功后自动登录
      const result = await signIn('credentials', {
        redirect: false, // 不自动重定向
        login: username,
        password,
        callbackUrl: '/'
      });

      console.log("登录结果:", result);

      if (result?.error) {
        setError('自动登录失败，请尝试手动登录');
        setLoading(false);
        return;
      }

      // 登录成功，使用全页面导航而不是客户端路由
      // 这确保了会话状态会被正确应用到下一个页面
      console.log("登录成功，跳转到首页");
      window.location.href = '/';
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('系统初始化过程中发生错误');
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center max-w-4xl mx-auto">
      <div className="w-full bg-card p-8 rounded-xl shadow-lg border border-purple-600/15">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full opacity-20 animate-pulse"></div>
              <div className="absolute inset-2 bg-dark-bg rounded-full flex items-center justify-center">
                <span className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-600">LA</span>
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-primary">欢迎使用智链 AI 网关</h1>
          <p className="text-xl text-foreground mt-2">系统初始化</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="bg-dark-nav/30 p-4 rounded-lg border border-purple-600/10">
              <h3 className="text-lg font-medium text-primary mb-2">功能特点</h3>
              <ul className="space-y-2 text-sm text-foreground/80">
                <li className="flex items-center">
                  <span className="inline-block w-5 h-5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full mr-2 flex-shrink-0"></span>
                  <span>高颜值的界面设计，支持深色/浅色主题</span>
                </li>
                <li className="flex items-center">
                  <span className="inline-block w-5 h-5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full mr-2 flex-shrink-0"></span>
                  <span>内置完善的用户认证系统</span>
                </li>
                <li className="flex items-center">
                  <span className="inline-block w-5 h-5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full mr-2 flex-shrink-0"></span>
                  <span>数据库自动升级机制</span>
                </li>
                <li className="flex items-center">
                  <span className="inline-block w-5 h-5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full mr-2 flex-shrink-0"></span>
                  <span>响应式设计，完美适配各种设备</span>
                </li>
              </ul>
            </div>
            
            <div className="bg-dark-nav/30 p-4 rounded-lg border border-purple-600/10">
              <h3 className="text-lg font-medium text-primary mb-2">系统要求</h3>
              <p className="text-sm text-foreground/80">
                您现在创建的账户将成为系统管理员，拥有全部权限。初始化完成后，您可以开始定制您的应用程序。
              </p>
            </div>
          </div>
          
          <div>
            <form onSubmit={handleSubmit}>
              {error && (
                <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-error text-sm">
                  {error}
                </div>
              )}
              
              <div className="mb-4">
                <label htmlFor="username" className="block mb-2 text-sm font-medium text-foreground">
                  管理员账户名 <span className="text-red-500">*</span>
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600"
                  required
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
                  className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600"
                  required
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
                  className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600"
                  required
                />
              </div>
              
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-md hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-70"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <i className="fas fa-circle-notch fa-spin mr-2"></i> 正在初始化...
                  </span>
                ) : (
                  '开始使用应用'
                )}
              </button>
            </form>
          </div>
        </div>
        
        <div className="text-center mt-6 text-foreground/60 text-sm">
          <p>智链 AI 网关 · 安全可追溯的大模型接入平台</p>
        </div>
      </div>
    </div>
  );
} 