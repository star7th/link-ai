import NextAuth, { AuthOptions } from 'next-auth/next';
import CredentialsProvider from 'next-auth/providers/credentials';
import { verifyPassword, recordLoginAttempt } from '@/lib/auth';
import { getJwtSecret } from '@/lib/system-config';
import { prisma } from '@/lib/prisma';

// 一年的秒数
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

// 创建NextAuth选项
export const buildAuthOptions = async (): Promise<AuthOptions> => {
  // 从环境变量获取JWT密钥
  const secret = getJwtSecret();
  
  return {
    providers: [
      CredentialsProvider({
        name: 'Credentials',
        credentials: {
          login: { label: "账户名或邮箱", type: "text" },
          password: { label: "密码", type: "password" }
        },
        async authorize(credentials, req) {
          if (!credentials?.login || !credentials?.password) {
            console.log("凭证不完整");
            return null;
          }

          try {
            // 获取请求IP和UA信息
            const userAgent = req?.headers?.['user-agent'] || '';
            const forwardedFor = req?.headers?.['x-forwarded-for'] as string || '';
            const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : '';
            
            const user = await verifyPassword(
              credentials.login,
              credentials.password
            );

            if (!user) {
              console.log("用户验证失败");
              
              // 尝试查找用户ID以记录失败的登录尝试
              const userCheck = await prisma.user.findFirst({
                where: {
                  OR: [
                    { username: credentials.login },
                    { email: credentials.login }
                  ]
                },
                select: { id: true }
              });
              
              if (userCheck) {
                // 记录登录失败
                await recordLoginAttempt({
                  userId: userCheck.id,
                  ipAddress: ip,
                  userAgent,
                  success: false
                });
              }
              
              return null;
            }

            // 记录登录成功
            await recordLoginAttempt({
              userId: user.id,
              ipAddress: ip,
              userAgent,
              success: true
            });

            return user;
          } catch (error) {
            console.error("验证过程中出错:", error);
            return null;
          }
        }
      })
    ],
    callbacks: {
      async jwt({ token, user }) {
        
        if (user) {
          token.id = user.id;
          token.isAdmin = user.isAdmin;
        }
        return token;
      },
      async session({ session, token }) {
        
        if (token && session.user) {
          session.user.id = token.id as string;
          session.user.isAdmin = token.isAdmin as boolean;
        }
        return session;
      },
    },
    session: {
      strategy: 'jwt',
      maxAge: ONE_YEAR_IN_SECONDS, // 一年有效期
    },
    pages: {
      signIn: '/auth/login',
      newUser: '/auth/register',
    },
    secret,
    debug: process.env.NODE_ENV !== 'production',
    jwt: {
      maxAge: ONE_YEAR_IN_SECONDS
    }
  };
};

// 创建NextAuth处理器
export async function GET(req: Request, res: Response) {
  try {
    const authOptions = await buildAuthOptions();
    return await NextAuth(authOptions)(req, res);
  } catch (error) {
    console.error("NextAuth GET错误:", error);
    throw error;
  }
}

export async function POST(req: Request, res: Response) {
  try {
    const authOptions = await buildAuthOptions();
    return await NextAuth(authOptions)(req, res);
  } catch (error) {
    console.error("NextAuth POST错误:", error);
    throw error;
  }
} 