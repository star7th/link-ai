import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';

export default async function DashboardPage() {
  const authOptions = await buildAuthOptions();
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/login');
  }

  if (((session as any).user).isAdmin) {
    redirect('/admin/overview');
  } else {
    redirect('/dashboard/overview');
  }
}
