import { redirect } from 'next/navigation';

export default async function RegisterPage() {
  // 普通注册页面直接重定向到登录页
  return redirect('/auth/login');
} 