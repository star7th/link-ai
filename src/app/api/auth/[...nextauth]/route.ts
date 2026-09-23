import NextAuth from 'next-auth/next';
// next-auth v4 types can't be resolved with TS 5.8 bundler resolution;
// use any-compatible workaround to avoid blocking compilation.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AuthOptions = any;
import CredentialsProvider from 'next-auth/providers/credentials';
import { verifyPassword, recordLoginAttempt } from '@/lib/auth';
import { clientIpFromHeaders, isLocked, recordFail, recordSuccess } from '@/lib/login-throttle';
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
            const ip = clientIpFromHeaders(req?.headers);

            // 暴力破解防护：锁定中的账号直接拒绝（错误文案统一为「账号或密码不正确」，服务端日志留痕）
            if (isLocked(credentials.login)) {
              console.warn(`登录锁定中，拒绝尝试: ip=${ip} login=${credentials.login}`);
              return null;
            }

            const user = await verifyPassword(
              credentials.login,
              credentials.password
            );

            if (!user) {
              console.log("用户验证失败");

              // 记录失败（达阈值会触发锁定）
              recordFail(credentials.login);

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

            // 记录登录成功（清除失败计数）
            recordSuccess(credentials.login);
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
      async jwt({ token, user }: { token: any; user?: any }) {
        
        if (user) {
          token.id = user.id;
          token.isAdmin = user.isAdmin;
        }
        return token;
      },
      async session({ session, token }: { session: any; token: any }) {
        
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