/**
 * 审计日志（AuditLogger）单元测试
 *
 * 测试覆盖：
 * - log() 将条目加入缓冲区
 * - 缓冲区达到阈值自动 flush
 * - flush() 清空缓冲区
 * - hash chain 链式验证
 * - markDesensitizeHits 追加到缓冲条目
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before any imports that use it
const mockCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      createMany: (...args: any[]) => mockCreateMany(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { auditLogger } from '../logger';

describe('AuditLogger', () => {
  beforeEach(() => {
    mockCreateMany.mockClear();
    mockUpdateMany.mockClear();
  });

  describe('log()', () => {
    it('auto-flushes when buffer reaches 10 entries', async () => {
      for (let i = 0; i < 10; i++) {
        auditLogger.log({
          logType: 'request',
          action: '/v1/chat/completions',
          responseStatus: 200,
        });
      }
      // Should have flushed immediately (buffer size >= 10)
      expect(mockCreateMany).toHaveBeenCalled();
    });
  });

  describe('flush()', () => {
    it('creates entries in database', async () => {
      auditLogger.log({
        logType: 'request',
        action: '/v1/chat/completions',
        responseStatus: 200,
        responseTime: 150,
      });

      await auditLogger.flush();

      expect(mockCreateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              logType: 'request',
              action: '/v1/chat/completions',
              responseStatus: 200,
              responseTime: 150,
            }),
          ]),
        }),
      );
    });

    it('clears buffer after successful flush', async () => {
      auditLogger.log({ logType: 'request', action: '/test' });
      await auditLogger.flush();

      // Second flush should not call createMany again (buffer empty)
      mockCreateMany.mockClear();
      await auditLogger.flush();
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });

  describe('hash chain', () => {
    it('each entry has contentHash and previousHash', async () => {
      auditLogger.log({ logType: 'request', action: '/first' });
      auditLogger.log({ logType: 'request', action: '/second' });

      await auditLogger.flush();

      const data = mockCreateMany.mock.calls[0][0].data as any[];

      // First entry has previousHash (seed hash), second has first's contentHash
      expect(data[0].previousHash).toBeTruthy();
      expect(data[0].contentHash).toBeTruthy();
      expect(data[1].previousHash).toBe(data[0].contentHash);
    });

    it('hash chain entries are unique', async () => {
      auditLogger.log({ logType: 'request', action: '/a' });
      auditLogger.log({ logType: 'request', action: '/b' });

      await auditLogger.flush();

      const data = mockCreateMany.mock.calls[0][0].data as any[];
      expect(data[0].contentHash).not.toBe(data[1].contentHash);
    });
  });

  describe('markDesensitizeHits()', () => {
    it('appends hits to matching buffer entry without throwing', () => {
      auditLogger.log({
        tokenId: 't1',
        logType: 'request',
        action: '/v1/chat/completions',
      });

      expect(() => {
        auditLogger.markDesensitizeHits('t1', [
          { ruleName: 'phone', action: 'replace', matchCount: 1 },
        ], '{"messages":[{"content":"13812345678"}]}');
      }).not.toThrow();
    });

    it('falls back to DB update when buffer is empty', () => {
      expect(() => {
        auditLogger.markDesensitizeHits('t1', [], 'test body');
      }).not.toThrow();
    });
  });
});
