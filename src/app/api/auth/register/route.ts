import { NextResponse } from 'next/server';
import { createUser, hasAdminUser } from '@/lib/auth';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { message: '请提供必要的注册信息' },
        { status: 400 }
      );
    }
    
    // 检查是否已有管理员账户
    const hasAdmin = await hasAdminUser();
    
    // 如果已有管理员，禁止注册新用户
    if (hasAdmin) {
      return NextResponse.json(
        { message: '注册功能当前已禁用' },
        { status: 403 }
      );
    }

    const user = await createUser({ username, password, isAdmin: !hasAdmin });

    return NextResponse.json(
      { 
        message: '用户创建成功', 
        user: {
          id: user.id,
          username,
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin,
        } 
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { message: '该账户名已被注册' },
        { status: 409 }
      );
    }

    console.error('注册错误:', error);
    return NextResponse.json(
      { message: '注册过程中发生错误' },
      { status: 500 }
    );
  }
} 