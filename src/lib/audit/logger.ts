import { prisma } from '../prisma';
import crypto from 'crypto';

type AuditLogEntry = {
  userId?: string;
  tokenId?: string;
  providerId?: string;
  providerName?: string;
  logType: string;
  action: string;
  requestMethod?: string;
  requestBodyHash?: string;
  responseStatus?: number;
  responseTime?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  isStream?: boolean;
  failover?: boolean;
  originalProviderId?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: string;
  requestBody?: string;
  responseBody?: string;
  desensitizeHits?: string;
};

type PendingEntry = AuditLogEntry & { contentHash?: string; previousHash?: string };

class AuditLogger {
  private buffer: PendingEntry[] = [];
  private lastHash = crypto.createHash('sha256').update('linkai-audit-chain-seed').digest('hex');
  private flushInterval: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  private computeHash(entry: PendingEntry): string {
    const data = JSON.stringify({
      ...entry,
      previousHash: this.lastHash
    });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  log(entry: AuditLogEntry): void {
    const entryWithHash: PendingEntry = { ...entry };
    entryWithHash.contentHash = this.computeHash(entryWithHash);
    entryWithHash.previousHash = this.lastHash;
    this.lastHash = entryWithHash.contentHash;

    this.buffer.push(entryWithHash);

    if (this.buffer.length >= 10) {
      this.flush();
    } else if (!this.flushTimer && !this.flushInterval) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, 5000);
    }
  }

  markDesensitizeHits(tokenId: string, hits: Array<{ ruleName: string; action: string; matchCount: number }>, requestBody: string): void {
    const target = this.buffer.find(e => e.tokenId === tokenId && e.logType === 'request');
    if (target) {
      target.desensitizeHits = JSON.stringify(hits);
      if (!target.requestBody) {
        target.requestBody = requestBody.slice(0, 50000);
      }
    } else {
      prisma.auditLog.updateMany({
        where: { tokenId, logType: 'request' },
        data: {
          desensitizeHits: JSON.stringify(hits),
          requestBody: requestBody.slice(0, 50000),
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }).catch((err: unknown) => {
        console.error('Failed to mark desensitize hits on existing audit log:', err);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0);

    try {
      await prisma.auditLog.createMany({
        data: entries.map(e => ({
          userId: e.userId,
          tokenId: e.tokenId,
          providerId: e.providerId,
          providerName: e.providerName,
          logType: e.logType,
          action: e.action,
          requestMethod: e.requestMethod,
          requestBodyHash: e.requestBodyHash,
          responseStatus: e.responseStatus,
          responseTime: e.responseTime,
          promptTokens: e.promptTokens,
          completionTokens: e.completionTokens,
          totalTokens: e.totalTokens,
          isStream: e.isStream || false,
          failover: e.failover || false,
          originalProviderId: e.originalProviderId,
          ipAddress: e.ipAddress,
          userAgent: e.userAgent,
          detail: e.detail,
          requestBody: e.requestBody,
          responseBody: e.responseBody,
          desensitizeHits: e.desensitizeHits,
          contentHash: e.contentHash,
          previousHash: e.previousHash,
          createdAt: new Date()
        }))
      });
    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      this.buffer.unshift(...entries);

      if (this.buffer.length > 10000) {
        console.warn('Audit log buffer exceeds 10000 entries');
      }
    }
  }

  startFlushInterval(): NodeJS.Timeout {
    if (this.flushInterval) return this.flushInterval;
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 2000);
    return this.flushInterval;
  }

  stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  async getRecentLogs(filter: {
    userId?: string;
    tokenId?: string;
    logType?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const where: any = {};
    if (filter.userId) where.userId = filter.userId;
    if (filter.tokenId) where.tokenId = filter.tokenId;
    if (filter.logType) where.logType = filter.logType;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter.limit || 50,
        skip: filter.offset || 0
      }),
      prisma.auditLog.count({ where })
    ]);

    return { logs, total };
  }
}

export const auditLogger = new AuditLogger();
