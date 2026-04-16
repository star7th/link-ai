import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// next-auth/jwt exports getToken at runtime but TS 5.8 bundler resolution
// fails to resolve the type. Suppress to unblock compilation.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getToken }: { getToken: (params: { req: any; secret?: string }) => Promise<any> } = require('next-auth/jwt');

const publicPaths = ['/auth/login', '/auth/register', '/api/auth', '/setup', '/api/proxy', '/api/anthropic', '/v1'];
const publicApiPaths = ['/chat/', '/completions', '/models', '/embeddings', '/images/', '/audio/', '/files', '/moderations'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPath = pathname === '/'
    || publicPaths.some(path => pathname.startsWith(path))
    || publicApiPaths.some(path => pathname.startsWith(path));

  if (isPublicPath) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && !(token as any).isAdmin) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
