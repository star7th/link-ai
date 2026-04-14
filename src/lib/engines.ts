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

  console.log('Engines initialized successfully');
}

export async function shutdownEngines() {
  console.log('Shutting down LinkAI engines...');

  quotaEngine.stopPersistInterval();
  healthChecker.stopChecking();
  auditLogger.stopFlushInterval();

  await auditLogger.flush();
  await quotaEngine.persistToDB();

  console.log('Engines shut down successfully');
}

export { prisma, proxyEngine, rateLimiter, quotaEngine, desensitizeEngine, circuitBreaker, auditLogger, alertEngine, hashToken, setupProviderConfigs };
