/**
 * Webhook 通道发送函数单元测试
 *
 * 测试覆盖：
 * - sendGenericWebhook：成功/失败/网络错误
 * - sendFeishu：成功/HTTP错误/业务错误
 * - sendDingtalk：无签名/有签名两种模式
 * - sendWecom：成功/失败
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  sendGenericWebhook,
  sendFeishu,
  sendDingtalk,
  sendWecom,
} from '../channels/webhook';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('sendGenericWebhook', () => {
  it('returns success on 200 response', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const result = await sendGenericWebhook('https://example.com/hook', { title: 'test' });
    expect(result.success).toBe(true);
  });

  it('returns failure on non-200 response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await sendGenericWebhook('https://example.com/hook', { title: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await sendGenericWebhook('https://example.com/hook', { title: 'test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('sendFeishu', () => {
  it('returns success on code=0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0 }),
    });
    const result = await sendFeishu({ webhookUrl: 'https://open.feishu.cn/hook' }, 'title', 'msg');
    expect(result.success).toBe(true);
  });

  it('returns failure on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    const result = await sendFeishu({ webhookUrl: 'https://open.feishu.cn/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toContain('502');
  });

  it('returns failure when code != 0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 19001, msg: 'invalid webhook' }),
    });
    const result = await sendFeishu({ webhookUrl: 'https://open.feishu.cn/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid webhook');
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const result = await sendFeishu({ webhookUrl: 'https://open.feishu.cn/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
  });

  it('uses custom msgType when configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0 }),
    });
    await sendFeishu(
      { webhookUrl: 'https://open.feishu.cn/hook', msgType: 'interactive' },
      'title',
      'msg',
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.msg_type).toBe('interactive');
  });
});

describe('sendDingtalk', () => {
  it('returns success without secret', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });
    const result = await sendDingtalk({ webhookUrl: 'https://oapi.dingtalk.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(true);
    // Should not add timestamp/sign params
    expect(mockFetch.mock.calls[0][0]).toBe('https://oapi.dingtalk.com/hook');
  });

  it('returns success with secret (signs request)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });
    const result = await sendDingtalk(
      { webhookUrl: 'https://oapi.dingtalk.com/hook', secret: 'SEC123' },
      'title',
      'msg',
    );
    expect(result.success).toBe(true);
    // URL should contain timestamp and sign
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('timestamp=');
    expect(calledUrl).toContain('sign=');
  });

  it('returns failure on errcode != 0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 300001, errmsg: 'sign not match' }),
    });
    const result = await sendDingtalk({ webhookUrl: 'https://oapi.dingtalk.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('sign not match');
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await sendDingtalk({ webhookUrl: 'https://oapi.dingtalk.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
  });
});

describe('sendWecom', () => {
  it('returns success on errcode=0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });
    const result = await sendWecom({ webhookUrl: 'https://qyapi.weixin.qq.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(true);
  });

  it('returns failure on errcode != 0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 93000, errmsg: 'invalid webhook url' }),
    });
    const result = await sendWecom({ webhookUrl: 'https://qyapi.weixin.qq.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid webhook url');
  });

  it('returns failure on network error', async () => {
    mockFetch.mockRejectedValue(new Error('DNS error'));
    const result = await sendWecom({ webhookUrl: 'https://qyapi.weixin.qq.com/hook' }, 'title', 'msg');
    expect(result.success).toBe(false);
  });
});
