import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import CredentialsProvider from 'next-auth/providers/credentials';

// 检查是否有管理员用户
export async function hasAdminUser() {
  try {
    // Docker环境中允许通过环境变量覆盖初始化检查
    if (process.env.DOCKER_SETUP === 'true') {
      console.log('Docker环境中启用初始化界面');
      
      // 检查管理员数量
      const adminCount = await prisma.user.count({
        where: {
          isAdmin: true
        }
      });
      
      // 在Docker环境中，如果没有管理员则允许设置，即使数据库已存在
      if (adminCount === 0) {
        console.log('Docker环境中未找到管理员用户，允许进行初始化');
        return false;
      }
    }
    
    // 标准逻辑：检查是否有管理员用户
    const adminCount = await prisma.user.count({
      where: {
        isAdmin: true
      }
    });
    
    return adminCount > 0;
  } catch (error) {
    console.error('检查管理员用户失败:', error);
    // 出错时默认返回false，允许进行初始化
    return false;
  }
}

export async function createUser(data: {
  username: string;
  name?: string | null;
  email?: string | null;
  password: string;
  isAdmin?: boolean;
}) {
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      username: data.username,
      name: data.name,
      email: data.email || null,
      password: hashedPassword,
      isAdmin: data.isAdmin ?? false,
    },
  });

  return user;
}

// 验证用户密码
export async function verifyPassword(usernameOrEmail: string, password: string) {
  // 尝试通过用户名查找用户
  let user = await prisma.user.findFirst({
    where: {
      username: usernameOrEmail,
    },
  });
  
  // 如果没找到，尝试通过邮箱查找
  if (!user && usernameOrEmail.includes('@')) {
    user = await prisma.user.findFirst({
      where: {
        email: usernameOrEmail,
      },
    });
  }
  
  if (!user) {
    return null;
  }
  
  const isValid = await bcrypt.compare(password, user.password);
  
  if (!isValid) {
    return null;
  }
  
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    isAdmin: user.isAdmin
  };
}

// 根据ID获取用户
export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      isAdmin: true,
    },
  });
  
  return user;
}

// 记录登录情况
export async function recordLoginAttempt({
  userId,
  ipAddress,
  userAgent,
  success = true
}: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
}) {
  try {
    // 使用类型断言绕过类型检查
    // 在数据库升级后，prisma客户端会自动更新类型定义
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).loginRecord.create({
      data: {
        userId,
        ipAddress,
        userAgent,
        success
      }
    });
    return true;
  } catch (error) {
    console.error('记录登录尝试失败:', error);
    return false;
  }
}

// 获取用户登录记录
export async function getUserLoginRecords(userId: string, limit = 20, offset = 0) {
  try {
    // 使用类型断言绕过类型检查
    // 在数据库升级后，prisma客户端会自动更新类型定义
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await (prisma as any).loginRecord.findMany({
      where: {
        userId
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit,
      skip: offset
    });
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = await (prisma as any).loginRecord.count({
      where: {
        userId
      }
    });
    
    return { records, total };
  } catch (error) {
    console.error('获取用户登录记录失败:', error);
    return { records: [], total: 0 };
  }
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: '用户名', type: 'text' },
        password: { label: '密码', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { username: credentials.username }
        });

        if (!user) {
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          isAdmin: user.isAdmin
        };
      }
    })
  ],
  session: {
    strategy: 'jwt' as const
  },
  pages: {
    signIn: '/auth/login'
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.isAdmin = user.isAdmin;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = token.isAdmin as boolean;
      }
      return session;
    }
  }
}; 