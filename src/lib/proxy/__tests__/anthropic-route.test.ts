/**
 * Route-level integration tests for the Anthropic passthrough route.
 *
 * Tests the full request flow through POST/GET handlers with mocked
 * dependencies. Covers:
 * - Path validation (only /v1/ paths)
 * - Auth failure passthrough
 * - Non-stream success and failover
 * - Stream success and failover
 * - Header forwarding
 * - No providers available
 * - Desensitization blocking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all dependencies
// ---------------------------------------------------------------------------

const mockPrismaTokenFindUnique = vi.fn();
const mockPrismaProviderFindUnique = vi.fn();
const mockPrismaProviderFindMany = vi.fn();
const mockPrismaUserFindUnique = vi.fn();

vi.mock('@/lib/engines', () => ({
  prisma: {
    token: { findUnique: mockPrismaTokenFindUnique },
    provider: {
      findUnique: mockPrismaProviderFindUnique,
      findMany: mockPrismaProviderFindMany,
    },
    user: { findUnique: mockPrismaUserFindUnique },
  },
  hashToken: (v: string) => `hashed-${v}`,
  rateLimiter: {
    check: vi.fn(() => ({ allowed: true })),
    record: vi.fn(),
  },
  quotaEngine: {
    checkQuota: vi.fn(() => ({ allowed: true })),
    store: { getCurrentPeriod: vi.fn(() => '2024-01') },
    recordUsage: vi.fn(),
  },
  auditLogger: { log: vi.fn() },
  circuitBreaker: {
    isAvailable: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
  alertEngine: { trigger: vi.fn() },
  desensitizeEngine: {
    processRequest: vi.fn(() => ({ blocked: false, hits: [], content: '' })),
  },
  setupProviderConfigs: vi.fn(),
}));

vi.mock('@/lib/proxy/engine', () => ({
  applyModelRedirect: vi.fn((body, _redirect) => body),
}));

vi.mock('@/lib/proxy/stream', () => ({
  bufferUpstreamStream: vi.fn(),
}));

vi.mock('@/lib/proxy/adapter/base', () => ({
  resolveProxyUrl: vi.fn((base, path) => `${base}${path}`),
}));

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn((v) => `decrypted-${v}`),
}));

vi.mock('@/lib/system-config', () => ({
  isAuditLogFullBodyEnabled: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('@/lib/proxy/timeout', () => ({
  resolveTimeout: vi.fn(() => 30000),
}));

// ---------------------------------------------------------------------------
// Auth mock — can be configured per test
// ---------------------------------------------------------------------------

const mockAuthenticateRequest = vi.fn();

vi.mock('@/lib/proxy/auth', () => ({
  authenticateRequest: mockAuthenticateRequest,
  getClientIp: vi.fn(() => '127.0.0.1'),
  extractToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const headers = new Map<string, string>();
  for (const [k, v] of Object.entries(options.headers || {})) {
    headers.set(k.toLowerCase(), v);
  }

  return {
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    json: () => Promise.resolve(options.body ?? {}),
    method: options.method || 'POST',
    nextUrl: new URL(options.url || 'http://localhost/api/anthropic/v1/messages'),
  } as any;
}

// ---------------------------------------------------------------------------
// Import route handlers after mocks
// ---------------------------------------------------------------------------

let POST: any;
let GET: any;

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: successful auth
  mockAuthenticateRequest.mockResolvedValue({
    result: {
      token: {
        id: 'token-1',
        userId: 'user-1',
        keyHash: 'hashed-lk-test',
        status: 'active',
        rpmLimit: 60,
        quotaTokenLimit: null,
        quotaRequestLimit: null,
        quotaPeriod: 'monthly',
      },
      clientIp: '127.0.0.1',
      userAgent: 'TestClient/1.0',
    },
  });

  // Default: token with no bound providers → fall back to all active anthropic providers
  mockPrismaTokenFindUnique.mockResolvedValue({
    id: 'token-1',
    keyHash: 'hashed-lk-test-key',
    tokenProviders: [],  // Empty → falls through to prisma.provider.findMany
  });
  mockPrismaProviderFindMany.mockResolvedValue([
    {
      id: 'prov-1',
      apiBaseUrl: 'https://api.anthropic.com',
      apiKeyEncrypted: 'enc-key-1',
      protocolType: 'anthropic',
      name: 'Anthropic Direct',
      status: 'active',
      modelRedirect: null,
      timeoutMs: null,
      streamTimeoutMs: null,
    },
  ]);

  mockPrismaProviderFindUnique.mockResolvedValue({
    id: 'prov-1',
    totalRpmLimit: null,
    totalTpmLimit: null,
    modelRedirect: null,
  });

  const route = await import('@/app/api/anthropic/[...path]/route');
  POST = route.POST;
  GET = route.GET;
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Anthropic route: path validation', () => {
  it('rejects non-/v1/ paths with 400', async () => {
    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/something/else',
      body: { model: 'claude-3', stream: false },
    });
    const params = Promise.resolve({ path: ['something', 'else'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toContain('/v1/');
  });

  it('accepts /v1/messages path', async () => {
    // Mock successful non-stream response
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1', type: 'message', usage: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    // Should not be 400 — either success or 502 depending on fetch mock
    expect(response.status).not.toBe(400);
  });
});

describe('Anthropic route: auth failure', () => {
  it('passes through 401 when auth fails', async () => {
    const { NextResponse } = await import('next/server');
    mockAuthenticateRequest.mockResolvedValue({
      error: NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 }),
    });

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: {},
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(401);
  });

  it('passes through 429 when rate limited', async () => {
    const { NextResponse } = await import('next/server');
    mockAuthenticateRequest.mockResolvedValue({
      error: NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 }),
    });

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: {},
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(429);
  });
});

describe('Anthropic route: no providers', () => {
  it('returns 502 when no anthropic providers available', async () => {
    mockPrismaProviderFindMany.mockResolvedValue([]);
    // Also mock token having no bound providers
    mockPrismaTokenFindUnique.mockResolvedValue({
      id: 'token-1',
      keyHash: 'hashed-lk-test',
      tokenProviders: [],
    });

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.error.type).toBe('api_error');
    expect(body.error.message).toContain('No Anthropic providers');
  });
});

describe('Anthropic route: non-stream success', () => {
  it('passes through upstream response as-is', async () => {
    const upstreamBody = JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from Claude' }],
      model: 'claude-3-opus-20240229',
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-123' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: {
        authorization: 'Bearer lk-test-key',
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: { model: 'claude-3', stream: false, messages: [{ role: 'user', content: 'Hi' }] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.type).toBe('message');
    expect(body.content[0].text).toBe('Hello from Claude');
    expect(body.usage.input_tokens).toBe(10);
  });

  it('includes upstream response headers (except encoding)', async () => {
    const upstreamBody = JSON.stringify({ id: 'msg_1', type: 'message' });
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-abc',
          'content-encoding': 'gzip',
          'transfer-encoding': 'chunked',
        },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.headers.get('x-request-id')).toBe('req-abc');
    // content-encoding and transfer-encoding should be stripped
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('transfer-encoding')).toBeNull();
  });
});

describe('Anthropic route: non-stream failover', () => {
  it('tries next provider when first returns non-2xx', async () => {
    const callCount = { value: 0 };
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount.value++;
      if (callCount.value === 1) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'overloaded' }), { status: 529 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'msg_ok', type: 'message' }), { status: 200 })
      );
    });
    global.fetch = mockFetch;

    // Set up two providers
    const { circuitBreaker } = await import('@/lib/engines');
    (circuitBreaker.isAvailable as any).mockReturnValue(true);

    mockPrismaProviderFindMany.mockResolvedValue([
      {
        id: 'prov-1',
        apiBaseUrl: 'https://api1.anthropic.com',
        apiKeyEncrypted: 'enc-1',
        protocolType: 'anthropic',
        name: 'Provider 1',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
      {
        id: 'prov-2',
        apiBaseUrl: 'https://api2.anthropic.com',
        apiKeyEncrypted: 'enc-2',
        protocolType: 'anthropic',
        name: 'Provider 2',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
    ]);

    // Both providers have no rate limits
    mockPrismaProviderFindUnique.mockResolvedValue({
      id: 'prov-1',
      totalRpmLimit: null,
      totalTpmLimit: null,
      modelRedirect: null,
    });

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns 502 when all providers fail', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'overloaded' }), { status: 529 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.error.type).toBe('api_error');
  });

  it('skips providers when circuit breaker is open', async () => {
    const { circuitBreaker } = await import('@/lib/engines');
    let callCount = 0;
    (circuitBreaker.isAvailable as any).mockImplementation(() => {
      callCount++;
      return callCount > 1; // First provider is unavailable
    });

    mockPrismaProviderFindMany.mockResolvedValue([
      {
        id: 'prov-1',
        apiBaseUrl: 'https://api1.anthropic.com',
        apiKeyEncrypted: 'enc-1',
        protocolType: 'anthropic',
        name: 'Provider 1',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
      {
        id: 'prov-2',
        apiBaseUrl: 'https://api2.anthropic.com',
        apiKeyEncrypted: 'enc-2',
        protocolType: 'anthropic',
        name: 'Provider 2',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
    ]);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_ok', type: 'message' }), { status: 200 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(200);
    // Only prov-2 should have been tried
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles fetch timeout (AbortError) and fails over', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce({ name: 'AbortError', message: 'The operation was aborted' })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'msg_ok', type: 'message' }), { status: 200 })
      );
    global.fetch = mockFetch;

    mockPrismaProviderFindMany.mockResolvedValue([
      {
        id: 'prov-1',
        apiBaseUrl: 'https://api1.anthropic.com',
        apiKeyEncrypted: 'enc-1',
        protocolType: 'anthropic',
        name: 'Provider 1',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
      {
        id: 'prov-2',
        apiBaseUrl: 'https://api2.anthropic.com',
        apiKeyEncrypted: 'enc-2',
        protocolType: 'anthropic',
        name: 'Provider 2',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
    ]);

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(200);
  });
});

describe('Anthropic route: header forwarding', () => {
  it('forwards anthropic-version header to upstream', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), { status: 200 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: {
        authorization: 'Bearer lk-test-key',
        'content-type': 'application/json',
        'anthropic-version': '2024-01-01',
      },
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    await POST(req, { params });

    // Check the headers passed to fetch
    const fetchCall = mockFetch.mock.calls[0];
    const fetchHeaders = fetchCall[1].headers;
    expect(fetchHeaders['anthropic-version']).toBe('2024-01-01');
  });

  it('forwards anthropic-beta header when present', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), { status: 200 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: {
        authorization: 'Bearer lk-test-key',
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15',
      },
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    await POST(req, { params });

    const fetchCall = mockFetch.mock.calls[0];
    const fetchHeaders = fetchCall[1].headers;
    expect(fetchHeaders['anthropic-beta']).toBe('messages-2023-12-15');
  });

  it('uses decrypted API key in x-api-key header', async () => {
    const { decrypt } = await import('@/lib/crypto');
    (decrypt as any).mockReturnValue('sk-ant-real-key');

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_1', type: 'message' }), { status: 200 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    await POST(req, { params });

    const fetchCall = mockFetch.mock.calls[0];
    const fetchHeaders = fetchCall[1].headers;
    expect(fetchHeaders['x-api-key']).toBe('sk-ant-real-key');
  });
});

describe('Anthropic route: GET method', () => {
  it('handles GET requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      method: 'GET',
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await GET(req, { params });
    // Should not throw, at minimum reach the fetch or fail gracefully
    expect([200, 502]).toContain(response.status);
  });
});

describe('Anthropic route: stream handling', () => {
  it('detects stream mode from body.stream=true', async () => {
    const { bufferUpstreamStream } = await import('@/lib/proxy/stream');
    const sseChunks = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
      'event: message_delta\n',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
    ];

    const mockUpstreamBody = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    (bufferUpstreamStream as any).mockResolvedValue({
      stream: mockUpstreamBody,
      bufferedChunks: sseChunks.map(c => new TextEncoder().encode(c)),
      fullText: sseChunks.join(''),
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(mockUpstreamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: { 'content-type': 'application/json' },
      body: { model: 'claude-3', stream: true, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('returns 502 when bufferUpstreamStream returns null (upstream error)', async () => {
    const { bufferUpstreamStream } = await import('@/lib/proxy/stream');
    // Reset mock to clear state from previous test, then set to return null
    (bufferUpstreamStream as any).mockReset().mockResolvedValue(null);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(new ReadableStream({
        start(controller) { controller.close(); },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: { 'content-type': 'application/json' },
      body: { model: 'claude-3', stream: true, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(502);
  });
});

describe('Anthropic route: desensitization', () => {
  it('returns 403 when desensitization blocks the request', async () => {
    const { desensitizeEngine } = await import('@/lib/engines');
    (desensitizeEngine.processRequest as any).mockResolvedValue({
      blocked: true,
      hits: [{ ruleName: 'PII Detection', action: 'block', matchCount: 1 }],
      content: 'blocked',
    });

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      headers: { 'content-type': 'application/json' },
      body: {
        model: 'claude-3',
        stream: false,
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
      },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.type).toBe('permission_error');
  });
});

describe('Anthropic route: provider rate limits', () => {
  it('skips provider when provider RPM limit exceeded', async () => {
    const { rateLimiter } = await import('@/lib/engines');
    let rpmCallCount = 0;
    (rateLimiter.check as any).mockImplementation((_scope: string, _id: string, type: string) => {
      if (type === 'rpm') {
        rpmCallCount++;
        // Provider RPM check fails
        return { allowed: rpmCallCount > 1 };
      }
      return { allowed: true };
    });

    mockPrismaProviderFindMany.mockResolvedValue([
      {
        id: 'prov-1',
        apiBaseUrl: 'https://api1.anthropic.com',
        apiKeyEncrypted: 'enc-1',
        protocolType: 'anthropic',
        name: 'Provider 1',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
      {
        id: 'prov-2',
        apiBaseUrl: 'https://api2.anthropic.com',
        apiKeyEncrypted: 'enc-2',
        protocolType: 'anthropic',
        name: 'Provider 2',
        status: 'active',
        modelRedirect: null,
        timeoutMs: null,
        streamTimeoutMs: null,
      },
    ]);

    // First provider has RPM limit
    mockPrismaProviderFindUnique.mockResolvedValue({
      id: 'prov-1',
      totalRpmLimit: 10,
      totalTpmLimit: null,
      modelRedirect: null,
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg_ok', type: 'message' }), { status: 200 })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    const response = await POST(req, { params });
    // Should still succeed with second provider
    expect(response.status).toBe(200);
  });
});

describe('Anthropic route: quota recording', () => {
  it('records usage when non-stream response has usage', async () => {
    const { quotaEngine } = await import('@/lib/engines');

    const upstreamBody = JSON.stringify({
      id: 'msg_1',
      type: 'message',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    global.fetch = mockFetch;

    const req = createMockRequest({
      url: 'http://localhost/api/anthropic/v1/messages',
      body: { model: 'claude-3', stream: false, messages: [] },
    });
    const params = Promise.resolve({ path: ['v1', 'messages'] });

    await POST(req, { params });

    expect(quotaEngine.recordUsage).toHaveBeenCalledWith(
      'token', 'token-1', 150, '2024-01'
    );
  });
});
