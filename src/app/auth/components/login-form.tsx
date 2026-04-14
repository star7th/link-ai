'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function LoginForm() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 注意：这里仅展示UI，实际锁定逻辑应由后端实现
  // 后端应记录用户登录失败次数和锁定状态

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!login || !password) {
      setError('请填写所有字段');
      setLoading(false);
      return;
    }

    try {
      
      // 实际应用中，应该在signIn前检查用户是否已被锁定
      // 例如: const lockStatus = await checkUserLockStatus(login);
      // if (lockStatus.isLocked) { setError(`账户已被锁定，请${lockStatus.remainingTime}后重试`); setLoading(false); return; }
      
      // 调用NextAuth的signIn方法进行登录
      const result = await signIn('credentials', {
        redirect: false, // 不自动重定向
        login, // 用户名或邮箱
        password,
        callbackUrl: '/dashboard' // 设置回调URL
      });


      if (result?.error) {
        // 后端应在验证失败时增加失败计数
        // 例如: await incrementFailedAttempt(login);
        // 并在达到阈值时锁定账户
        
        setError('账号或密码不正确');
        setLoading(false);
        return;
      }

      // 登录成功，后端应重置失败计数
      // 例如: await resetFailedAttempts(login);
      
      // 登录成功后，使用全页面导航而不是客户端路由
      // 这样可以确保下一个页面加载时会包含完整的会话状态
      console.log('登录成功，正在跳转到仪表盘...');
      window.location.href = '/dashboard';
    } catch (error) {
      console.error('登录错误', error);
      setError('登录过程中发生错误');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <form onSubmit={handleSubmit} className="bg-card p-8 rounded-xl shadow-lg border border-purple-600/15">
        <h2 className="text-2xl font-bold text-center mb-6 text-primary">欢迎回来</h2>
        <p className="text-center mb-6 text-foreground text-sm">登录到您的账户</p>
        
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-md text-error text-sm">
            {error}
          </div>
        )}
        
        <div className="mb-4">
          <label htmlFor="login" className="block mb-2 text-sm font-medium text-foreground">
            账户名或邮箱
          </label>
          <input
            id="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full p-3 text-white bg-dark-nav border border-purple-600/30 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-600/50 focus:border-purple-600"
            required
          />
        </div>
        
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              密码
            </label>
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
              <i className="fas fa-circle-notch fa-spin mr-2"></i> 登录中...
            </span>
          ) : (
            '登录'
          )}
        </button>

      </form>
    </div>
  );
} 