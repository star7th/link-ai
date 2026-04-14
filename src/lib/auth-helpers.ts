import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';

/**
 * 检查用户是否已登录的辅助函数
 * @returns 如果用户已登录返回true，否则返回false
 */
export async function isAuthenticated() {
  const authOptions = await buildAuthOptions();
  const session = await getServerSession(authOptions);

  return !!((session as any) && (session as any).user);
}

/**
 * 处理未授权请求的通用函数
 * @returns NextResponse 包含401状态码和错误消息
 */
export function unauthorized() {
  return NextResponse.json(
    { error: '未授权的请求，请先登录' },
    { status: 401 }
  );
}

/**
 * 验证API路由的中间件函数
 * 检查用户是否已登录，如果未登录则返回401响应
 * @returns 如果用户已登录则返回null，否则返回401 Response
 */
export async function validateAuth() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return unauthorized();
  }
  return null;
} 