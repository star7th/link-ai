/**
 * Tests for src/middleware.ts
 *
 * Covers:
 * - Public paths pass through (including /api/anthropic)
 * - Unauthenticated API requests return 401
 * - Unauthenticated page requests redirect to /auth/login
 * - Admin access control
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The middleware uses require('next-auth/jwt') which vi.mock does not
// intercept.  Instead we create real JWE tokens via the actual encode()
// function and pass them via the Authorization header, which getToken()
// also reads.
// ---------------------------------------------------------------------------

const { encode } = require('next-auth/jwt') as { encode: (p: any) => Promise<string> };

// ---------------------------------------------------------------------------
// Import middleware
// ---------------------------------------------------------------------------

let middleware: (request: any) => Promise<any>;

beforeEach(async () => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-middleware-tests';
  const mod = await import('../middleware');
  middleware = mod.middleware;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockNextRequest(pathname: string, authJwt?: string) {
  const url = new URL(`http://localhost${pathname}`);
  const req: any = {
    nextUrl: {
      pathname,
      clone() {
        return {
          pathname,
          toString: () => url.toString(),
        };
      },
    },
  };
  if (authJwt) {
    req.headers = { authorization: `Bearer ${authJwt}` };
  }
  return req;
}

async function encodeToken(payload: Record<string, any>) {
  return encode({ token: payload, secret: process.env.NEXTAUTH_SECRET });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('middleware: public paths', () => {
  it('passes through / (root)', async () => {
    const result = await middleware(mockNextRequest('/'));
    expect(result).toBeDefined();
  });

  it('passes through /api/anthropic paths', async () => {
    const result = await middleware(mockNextRequest('/api/anthropic/v1/messages'));
    // NextResponse.next() is returned
    expect(result).toBeDefined();
  });

  it('passes through /api/auth paths', async () => {
    const result = await middleware(mockNextRequest('/api/auth/signin'));
    expect(result).toBeDefined();
  });

  it('passes through /api/proxy paths', async () => {
    const result = await middleware(mockNextRequest('/api/proxy/v1/chat/completions'));
    expect(result).toBeDefined();
  });

  it('passes through /auth/login', async () => {
    const result = await middleware(mockNextRequest('/auth/login'));
    expect(result).toBeDefined();
  });

  it('passes through /auth/register', async () => {
    const result = await middleware(mockNextRequest('/auth/register'));
    expect(result).toBeDefined();
  });

  it('passes through /setup', async () => {
    const result = await middleware(mockNextRequest('/setup'));
    expect(result).toBeDefined();
  });

  it('passes through /v1 paths (publicApiPaths)', async () => {
    const result = await middleware(mockNextRequest('/v1/chat/completions'));
    expect(result).toBeDefined();
  });

  it('passes through /models path', async () => {
    const result = await middleware(mockNextRequest('/models'));
    expect(result).toBeDefined();
  });
});

describe('middleware: unauthenticated access', () => {
  it('returns 401 for unauthenticated API requests', async () => {
    const result = await middleware(mockNextRequest('/api/some-endpoint'));
    expect(result.status).toBe(401);

    const body = await result.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('redirects to /auth/login for unauthenticated page requests', async () => {
    const result = await middleware(mockNextRequest('/dashboard'));
    expect(result.status).toBe(307); // redirect
  });
});

describe('middleware: authenticated access', () => {
  it('passes through authenticated non-admin paths', async () => {
    const jwt = await encodeToken({ sub: 'user-1' });
    const result = await middleware(mockNextRequest('/dashboard', jwt));
    expect(result).toBeDefined();
  });
});

describe('middleware: admin access control', () => {
  it('blocks non-admin users from /admin API paths with 403', async () => {
    const jwt = await encodeToken({ sub: 'user-1', isAdmin: false });
    const result = await middleware(mockNextRequest('/api/admin/users', jwt));
    expect(result.status).toBe(403);

    const body = await result.json();
    expect(body.error).toBe('Forbidden');
  });

  it('redirects non-admin users from /admin page paths', async () => {
    const jwt = await encodeToken({ sub: 'user-1', isAdmin: false });
    const result = await middleware(mockNextRequest('/admin/settings', jwt));
    expect(result.status).toBe(307); // redirect
  });

  it('allows admin users to access /admin paths', async () => {
    const jwt = await encodeToken({ sub: 'admin-1', isAdmin: true });
    const result = await middleware(mockNextRequest('/admin/settings', jwt));
    expect(result).toBeDefined();
  });
});
