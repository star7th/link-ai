import LoginForm from '../components/login-form';
import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

export default async function LoginPage() {
  // 检查用户是否已登录，使用相同的 authOptions 配置
  const authOptions = await buildAuthOptions();
  const session = await getServerSession(authOptions);
  
  // 如果已经登录，直接跳转到仪表盘
  if (session) {
    return redirect('/dashboard');
  }
  
  // 未登录，显示登录表单
  return <LoginForm />;
} 