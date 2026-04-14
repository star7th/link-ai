import SetupForm from '@/app/auth/components/setup-form';
import { hasAdminUser } from '@/lib/auth';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';

export default async function SetupPage() {
  try {
    const hasAdmin = await hasAdminUser();

    if (hasAdmin) {
      console.log("系统已初始化（有管理员），重定向到登录页");
      return redirect('/auth/login');
    }

    const session = await getServerSession(await buildAuthOptions());

    if (session) {
      console.log("用户已登录，重定向到首页");
      return redirect('/');
    }
  } catch (error) {
    console.error("检查管理员状态出错:", error);
    return redirect('/auth/login');
  }

  console.log("显示系统初始化表单");
  return (
    <SetupForm />
  );
}