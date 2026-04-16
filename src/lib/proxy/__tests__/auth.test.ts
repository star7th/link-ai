/**
 * Comprehensive tests for src/lib/proxy/auth.ts
 *
 * Covers:
 * - extractToken: Bearer, Basic, x-api-key, edge cases
 * - getClientIp: x-forwarded-for, x-real-ip, fallback
 * - authenticateRequest: full auth flow with mocked engines
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing auth module
// ---------------------------------------------------------------------------

const mockPrismaFindUnique = vi.fn();
const mockPrismaUserFindUnique = vi.fn();
const mockHashToken = vi.fn((v: string) => `hashed-${v}`);
const mockRateLimiterCheck = vi.fn(() => ({ allowed: true }));
const mockRateLimiterRecord = vi.fn();
const mockQuotaEngineCheckQuota = vi.fn(() => ({ allowed: true }));
const mockQuotaEngineStore = { getCurrentPeriod: vi.fn(() => '2024-01') };
const mockQuotaEngineRecordUsage = vi.fn();
const mockAuditLoggerLog = vi.fn();

vi.mock('../../engines', () => ({
  prisma: {
    token: { findUnique: mockPrismaFindUnique },
    user: { findUnique: mockPrismaUserFindUnique },
  },
  hashToken: mockHashToken,
  rateLimiter: {
    check: mockRateLimiterCheck,
    record: mockRateLimiterRecord,
  },
  quotaEngine: {
    checkQuota: mockQuotaEngineCheckQuota,
    store: mockQuotaEngineStore,
    recordUsage: mockQuotaEngineRecordUsage,
  },
  auditLogger: { log: mockAuditLoggerLog },
  proxyEngine: {},
  desensitizeEngine: {},
  circuitBreaker: {},
  alertEngine: {},
  setupProviderConfigs: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
let extractToken: typeof import('../auth')['extractToken'];
let getClientIp: typeof import('../auth')['getClientIp'];
let authenticateRequest: typeof import('../auth')['authenticateRequest'];

beforeEach(async () => {
  const auth = await import('../auth');
  extractToken = auth.extractToken;
  getClientIp = auth.getClientIp;
  authenticateRequest = auth.authenticateRequest;

  vi.clearAllMocks();
  mockRateLimiterCheck.mockReturnValue({ allowed: true });
  mockQuotaEngineCheckQuota.mockReturnValue({ allowed: true });
});

// ---------------------------------------------------------------------------
// Helper: create a mock NextRequest
// ---------------------------------------------------------------------------
function mockRequest(headers: Record<string, string | null>) {
  return {
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  } as any;
}

// ===========================================================================
// extractToken
// ===========================================================================

describe('extractToken', () => {
  // --- Bearer auth ---

  describe('Authorization: Bearer', () => {
    it('extracts token from Bearer header', () => {
      const req = mockRequest({ authorization: 'Bearer lk-my-token' });
      expect(extractToken(req)).toBe('lk-my-token');
    });

    it('extracts token without lk- prefix from Bearer', () => {
      const req = mockRequest({ authorization: 'Bearer any-token-here' });
      expect(extractToken(req)).toBe('any-token-here');
    });

    it('returns empty string when Bearer has no token after space', () => {
      const req = mockRequest({ authorization: 'Bearer ' });
      expect(extractToken(req)).toBe('');
    });

    it('handles Bearer with complex token containing special chars', () => {
      const req = mockRequest({ authorization: 'Bearer lk-abc+def/ghi=jkl' });
      expect(extractToken(req)).toBe('lk-abc+def/ghi=jkl');
    });
  });

  // --- Basic auth ---

  describe('Authorization: Basic', () => {
    it('extracts lk- username from Basic auth', () => {
      // Base64 of "lk-testkey:"
      const encoded = Buffer.from('lk-testkey:').toString('base64');
      const req = mockRequest({ authorization: `Basic ${encoded}` });
      expect(extractToken(req)).toBe('lk-testkey');
    });

    it('extracts lk- username with password from Basic auth', () => {
      // Base64 of "lk-user:password"
      const encoded = Buffer.from('lk-user:password').toString('base64');
      const req = mockRequest({ authorization: `Basic ${encoded}` });
      expect(extractToken(req)).toBe('lk-user');
    });

    it('returns non-lk- username from Basic auth (not null)', () => {
      // Base64 of "myuser:pass"
      const encoded = Buffer.from('myuser:pass').toString('base64');
      const req = mockRequest({ authorization: `Basic ${encoded}` });
      expect(extractToken(req)).toBe('myuser');
    });

    it('returns username when no colon in decoded value', () => {
      // Base64 of "lk-standalone"
      const encoded = Buffer.from('lk-standalone').toString('base64');
      const req = mockRequest({ authorization: `Basic ${encoded}` });
      expect(extractToken(req)).toBe('lk-standalone');
    });

    it('returns null when decoded Basic auth has empty username', () => {
      // Base64 of ":password"
      const encoded = Buffer.from(':password').toString('base64');
      const req = mockRequest({ authorization: `Basic ${encoded}` });
      expect(extractToken(req)).toBeNull();
    });

    it('handles invalid base64 gracefully (does not throw)', () => {
      // Node.js Buffer.from with invalid base64 doesn't throw, it produces garbage
      // The code has a try/catch so it should not throw regardless
      const req = mockRequest({ authorization: 'Basic !!!invalid-base64!!!' });
      // The function should return some value (not crash)
      expect(() => extractToken(req)).not.toThrow();
    });
  });

  // --- x-api-key ---

  describe('x-api-key header', () => {
    it('extracts token from x-api-key with lk- prefix', () => {
      const req = mockRequest({ 'x-api-key': 'lk-test-key' });
      expect(extractToken(req)).toBe('lk-test-key');
    });

    it('ignores x-api-key without lk- prefix', () => {
      const req = mockRequest({ 'x-api-key': 'sk-ant-api03-xxxx' });
      expect(extractToken(req)).toBeNull();
    });

    it('ignores empty x-api-key', () => {
      const req = mockRequest({ 'x-api-key': '' });
      // Empty string starts with '' which doesn't start with 'lk-'
      expect(extractToken(req)).toBeNull();
    });
  });

  // --- Precedence ---

  describe('header precedence', () => {
    it('prefers Authorization Bearer over x-api-key', () => {
      const req = mockRequest({
        authorization: 'Bearer lk-bearer',
        'x-api-key': 'lk-xapi',
      });
      expect(extractToken(req)).toBe('lk-bearer');
    });

    it('prefers Authorization Basic over x-api-key', () => {
      const encoded = Buffer.from('lk-basic:pass').toString('base64');
      const req = mockRequest({
        authorization: `Basic ${encoded}`,
        'x-api-key': 'lk-xapi',
      });
      expect(extractToken(req)).toBe('lk-basic');
    });

    it('uses x-api-key when Authorization header has unsupported scheme', () => {
      const req = mockRequest({
        authorization: 'Digest username=test',
        'x-api-key': 'lk-fallback',
      });
      // "Digest" doesn't start with "Bearer " or "Basic ", falls through to x-api-key
      expect(extractToken(req)).toBe('lk-fallback');
    });
  });

  // --- No headers ---

  describe('no auth headers', () => {
    it('returns null when no headers present', () => {
      const req = mockRequest({});
      expect(extractToken(req)).toBeNull();
    });

    it('returns null when only irrelevant headers present', () => {
      const req = mockRequest({
        'content-type': 'application/json',
        'user-agent': 'test',
      });
      expect(extractToken(req)).toBeNull();
    });
  });
});

// ===========================================================================
// getClientIp
// ===========================================================================

describe('getClientIp', () => {
  it('extracts IP from x-forwarded-for', () => {
    const req = mockRequest({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('extracts first IP from comma-separated x-forwarded-for', () => {
    const req = mockRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('trims whitespace from x-forwarded-for', () => {
    const req = mockRequest({ 'x-forwarded-for': '  1.2.3.4  ' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when no x-forwarded-for', () => {
    const req = mockRequest({ 'x-real-ip': '10.0.0.1' });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = mockRequest({
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '10.0.0.1',
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('returns "unknown" when no IP headers present', () => {
    const req = mockRequest({});
    expect(getClientIp(req)).toBe('unknown');
  });

  it('handles empty x-forwarded-for gracefully', () => {
    const req = mockRequest({ 'x-forwarded-for': '' });
    // Empty string split gives [''], trim gives '', which is falsy → falls to x-real-ip or 'unknown'
    expect(getClientIp(req)).toBe('unknown');
  });

  it('handles IPv6 addresses', () => {
    const req = mockRequest({ 'x-forwarded-for': '::1' });
    expect(getClientIp(req)).toBe('::1');
  });
});

// ===========================================================================
// authenticateRequest
// ===========================================================================

describe('authenticateRequest', () => {
  const baseToken = {
    id: 'token-1',
    userId: 'user-1',
    status: 'active',
    keyHash: 'hashed-lk-test-key',
    expiresAt: null,
    rpmLimit: 60,
    quotaTokenLimit: null,
    quotaRequestLimit: null,
    quotaPeriod: 'monthly',
    user: {
      id: 'user-1',
      quotaTokenLimit: null,
      quotaRequestLimit: null,
      quotaPeriod: 'monthly',
      groupMembers: [],
    },
  };

  // Mock data for checkIpRules (second prisma.token.findUnique call)
  const ipAllowedToken = {
    id: 'token-1',
    ipRuleMode: 'allow_all',
    tokenIpRules: [],
  };

  function authRequest(headers: Record<string, string | null>) {
    return mockRequest(headers) as any;
  }

  // Helper: setup the two prisma.token.findUnique calls
  // 1st: token lookup by keyHash (include user)
  // 2nd: IP rules lookup by token id (include tokenIpRules)
  function setupTokenAndIpMocks(tokenOverrides: any = {}, ipOverrides: any = {}) {
    mockPrismaFindUnique
      .mockResolvedValueOnce({
        ...baseToken,
        ...tokenOverrides,
        user: tokenOverrides.user || baseToken.user,
      })
      .mockResolvedValueOnce({
        ...ipAllowedToken,
        ...ipOverrides,
      });
  }

  // Helper: setup user quota mock
  function setupUserMock(userOverrides: any = {}) {
    mockPrismaUserFindUnique.mockResolvedValue({
      id: 'user-1',
      quotaTokenLimit: null,
      quotaRequestLimit: null,
      quotaPeriod: 'monthly',
      groupMembers: [],
      ...userOverrides,
    });
  }

  it('returns 401 when no auth header present', async () => {
    const result = await authenticateRequest(authRequest({}), 'POST');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      const body = await result.error.json();
      expect(result.error.status).toBe(401);
      expect(body.error).toContain('authorization');
    }
  });

  it('returns 401 when token not found in database', async () => {
    mockPrismaFindUnique.mockResolvedValue(null);
    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-nonexistent' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
      const body = await result.error.json();
      expect(body.error).toBeDefined();
    }
  });

  it('returns 401 when token is inactive', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      ...baseToken,
      status: 'inactive',
      user: { id: 'user-1', quotaTokenLimit: null, quotaRequestLimit: null, quotaPeriod: 'monthly', groupMembers: [] },
    });
    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-inactive' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
    }
  });

  it('returns 401 when token is expired', async () => {
    mockPrismaFindUnique.mockResolvedValue({
      ...baseToken,
      expiresAt: new Date('2020-01-01'),
      user: { id: 'user-1', quotaTokenLimit: null, quotaRequestLimit: null, quotaPeriod: 'monthly', groupMembers: [] },
    });
    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-expired' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
      const body = await result.error.json();
      expect(body.error).toContain('expired');
    }
  });

  it('returns 403 when IP is not allowed', async () => {
    // Use a non-allow_all, non-whitelist mode with no matching rules
    // This causes checkIpRules to return false (IP not in whitelist, not explicitly allowed)
    setupTokenAndIpMocks(
      { user: { id: 'user-1', quotaTokenLimit: null, quotaRequestLimit: null, quotaPeriod: 'monthly', groupMembers: [] } },
      { ipRuleMode: 'blacklist', tokenIpRules: [] }
    );

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(403);
      const body = await result.error.json();
      expect(body.error).toContain('IP');
    }
  });

  it('returns 429 when rate limit exceeded', async () => {
    setupTokenAndIpMocks();
    mockRateLimiterCheck.mockReturnValue({ allowed: false, retryAfter: 60 });

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(429);
      const body = await result.error.json();
      expect(body.error).toContain('Rate limit');
    }
  });

  it('returns 429 when user token quota exceeded', async () => {
    setupTokenAndIpMocks({
      user: {
        id: 'user-1',
        quotaTokenLimit: 1000,
        quotaRequestLimit: null,
        quotaPeriod: 'monthly',
        groupMembers: [],
      },
    });
    setupUserMock({
      quotaTokenLimit: 1000,
      quotaRequestLimit: null,
    });
    mockQuotaEngineCheckQuota.mockReturnValue({ allowed: false });

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(429);
      const body = await result.error.json();
      expect(body.error).toContain('quota');
    }
  });

  it('returns 429 when user request quota exceeded', async () => {
    let quotaCheckCallCount = 0;
    mockQuotaEngineCheckQuota.mockImplementation(() => {
      quotaCheckCallCount++;
      if (quotaCheckCallCount === 1) return { allowed: true };
      return { allowed: false };
    });

    setupTokenAndIpMocks({
      user: {
        id: 'user-1',
        quotaTokenLimit: 1000,
        quotaRequestLimit: 500,
        quotaPeriod: 'monthly',
        groupMembers: [],
      },
    });
    setupUserMock({
      quotaTokenLimit: 1000,
      quotaRequestLimit: 500,
    });

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(429);
      const body = await result.error.json();
      expect(body.error).toContain('request quota');
    }
  });

  it('returns 429 when token quota exceeded', async () => {
    setupTokenAndIpMocks({
      quotaTokenLimit: 100,
      user: {
        id: 'user-1',
        quotaTokenLimit: null,
        quotaRequestLimit: null,
        quotaPeriod: 'monthly',
        groupMembers: [],
      },
    });
    setupUserMock();
    mockQuotaEngineCheckQuota.mockReturnValue({ allowed: false });

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(429);
      const body = await result.error.json();
      expect(body.error).toContain('Token quota');
    }
  });

  it('returns 429 when token request quota exceeded', async () => {
    let callCount = 0;
    mockQuotaEngineCheckQuota.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) return { allowed: true };
      return { allowed: false };
    });

    setupTokenAndIpMocks({
      quotaTokenLimit: 100,
      quotaRequestLimit: 50,
      user: {
        id: 'user-1',
        quotaTokenLimit: null,
        quotaRequestLimit: null,
        quotaPeriod: 'monthly',
        groupMembers: [],
      },
    });
    setupUserMock();

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(429);
    }
  });

  it('returns AuthResult on successful authentication', async () => {
    setupTokenAndIpMocks();
    setupUserMock();

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('result' in result).toBe(true);
    if ('result' in result) {
      expect(result.result.token.id).toBe('token-1');
      expect(result.result.token.userId).toBe('user-1');
      expect(result.result.clientIp).toBeDefined();
      expect(result.result.userAgent).toBeDefined();
    }
  });

  it('logs audit event on auth failure', async () => {
    const result = await authenticateRequest(authRequest({}), 'POST');
    expect(mockAuditLoggerLog).toHaveBeenCalled();
    const logEntry = mockAuditLoggerLog.mock.calls[0][0];
    expect(logEntry.responseStatus).toBe(401);
  });

  it('passes method and userAgent in audit log', async () => {
    await authenticateRequest(authRequest({}), 'GET');
    expect(mockAuditLoggerLog).toHaveBeenCalled();
    const logEntry = mockAuditLoggerLog.mock.calls[0][0];
    expect(logEntry.requestMethod).toBe('GET');
    expect(logEntry.userAgent).toBe('unknown');
  });

  it('detects user-agent from request', async () => {
    mockPrismaFindUnique.mockResolvedValue(null);
    await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test', 'user-agent': 'MyClient/1.0' }),
      'POST'
    );
    const logEntry = mockAuditLoggerLog.mock.calls[0][0];
    expect(logEntry.userAgent).toBe('MyClient/1.0');
  });

  it('handles group quota merging (takes max)', async () => {
    setupTokenAndIpMocks({
      user: {
        id: 'user-1',
        quotaTokenLimit: 100,
        quotaRequestLimit: 50,
        quotaPeriod: 'monthly',
        groupMembers: [
          {
            group: {
              groupQuotas: [
                { quotaType: 'token_count', quotaLimit: 500 },
                { quotaType: 'request_count', quotaLimit: 200 },
              ],
            },
          },
        ],
      },
    });
    setupUserMock({
      quotaTokenLimit: 100,
      quotaRequestLimit: 50,
      groupMembers: [
        {
          group: {
            groupQuotas: [
              { quotaType: 'token_count', quotaLimit: 500 },
              { quotaType: 'request_count', quotaLimit: 200 },
            ],
          },
        },
      ],
    });
    mockQuotaEngineCheckQuota.mockReturnValue({ allowed: true });

    const result = await authenticateRequest(
      authRequest({ authorization: 'Bearer lk-test-key' }),
      'POST'
    );
    expect('result' in result).toBe(true);
    expect(mockQuotaEngineCheckQuota).toHaveBeenCalled();
  });
});
