import { prisma } from '@/lib/prisma';
import { initPrisma } from '@/lib/prisma';
import { proxyEngine, setupProviderConfigs } from '@/lib/proxy/engine';
import { rateLimiter } from '@/lib/rate-limit';
import { quotaEngine } from '@/lib/quota/engine';
import { desensitizeEngine } from '@/lib/desensitize/engine';
import { circuitBreaker, setStateChangeCallback } from '@/lib/failover/circuit-breaker';
import { auditLogger } from '@/lib/audit/logger';
import { alertEngine } from '@/lib/alert/engine';
import { healthChecker } from '@/lib/failover/health-check';
import { hashToken } from '@/lib/crypto';
import { getSetting, SETTINGS_KEYS } from '@/lib/settings';

export async function initializeEngines() {
  console.log('Initializing LinkAI engines...');

  await initPrisma();

  await quotaEngine.recoverFromDB();
  quotaEngine.startPersistInterval();

  await desensitizeEngine.loadRules();
  await alertEngine.loadRules();

  await setupProviderConfigs();

  setStateChangeCallback(async (providerId: string, oldState: string, newState: string, providerName?: string) => {
    if (oldState !== newState) {
      if (newState === 'open') {
        await alertEngine.trigger('provider_down', { providerId, providerName });
      } else if (newState === 'closed' && oldState === 'half_open') {
        await alertEngine.trigger('provider_recovered', { providerId, providerName });
      }
    }
  });

  healthChecker.startChecking(
    async () => prisma.provider.findMany({ where: { status: 'active' }, select: { id: true, apiBaseUrl: true, apiKeyEncrypted: true, protocolType: true, name: true } }),
    60
  );

  auditLogger.startFlushInterval();

  setInterval(() => rateLimiter.cleanup(), 60000);

  startAuditLogCleanup();

  console.log('Engines initialized successfully');
}

// 审计日志定时清理
let auditLogCleanupTimer: NodeJS.Timeout | null = null;

function startAuditLogCleanup(): void {
  if (auditLogCleanupTimer) return;

  // 每天执行一次清理
  auditLogCleanupTimer = setInterval(async () => {
    try {
      const retentionDaysStr = await getSetting(SETTINGS_KEYS.DATA_RETENTION_DAYS);
      const retentionDays = parseInt(retentionDaysStr, 10);
      if (isNaN(retentionDays) || retentionDays <= 0) return;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);

      const result = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });

      if (result.count > 0) {
        console.log(`审计日志清理: 删除 ${result.count} 条 ${retentionDays} 天前的记录`);
      }
    } catch (error) {
      console.error('审计日志清理失败:', error);
    }
  }, 24 * 60 * 60 * 1000);
}

function stopAuditLogCleanup(): void {
  if (auditLogCleanupTimer) {
    clearInterval(auditLogCleanupTimer);
    auditLogCleanupTimer = null;
  }
}

export async function shutdownEngines() {
  console.log('Shutting down LinkAI engines...');

  quotaEngine.stopPersistInterval();
  healthChecker.stopChecking();
  auditLogger.stopFlushInterval();
  stopAuditLogCleanup();

  await auditLogger.flush();
  await quotaEngine.persistToDB();

  console.log('Engines shut down successfully');
}

export { prisma, proxyEngine, rateLimiter, quotaEngine, desensitizeEngine, circuitBreaker, auditLogger, alertEngine, hashToken, setupProviderConfigs };
