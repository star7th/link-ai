export type AuditLogType = 'request' | 'operation' | 'system' | 'desensitize_hit';

export interface AuditLog {
  id: string;
  userId?: string;
  tokenId?: string;
  providerId?: string;
  providerName?: string;
  logType: AuditLogType;
  action: string;
  requestMethod?: string;
  requestBodyHash?: string;
  responseStatus?: number;
  responseTime?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  isStream: boolean;
  failover: boolean;
  originalProviderId?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: string;
  contentHash?: string;
  previousHash?: string;
  createdAt: Date;
}

export interface AuditLogEntry {
  userId?: string;
  tokenId?: string;
  providerId?: string;
  providerName?: string;
  logType: AuditLogType;
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
}

export interface DesensitizeHit {
  ruleName: string;
  action: string;
  matchCount: number;
}

export interface AuditLogFilter {
  userId?: string;
  tokenId?: string;
  providerId?: string;
  logType?: AuditLogType;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogListResult {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}
