import { redirect } from "next/navigation";
import { hasAdminUser } from '@/lib/auth';

export default async function Home() {
  try {
    const hasAdmin = await hasAdminUser();

    if (hasAdmin) {
      redirect("/auth/login");
    } else {
      redirect("/setup");
    }
  } catch (error) {
    console.error("检查管理员状态时出错:", error);
    redirect("/setup");
  }
}
