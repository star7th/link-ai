import { prisma } from '../prisma';
import { decrypt } from '../crypto';
import { circuitBreaker } from './circuit-breaker';

let checkInterval: NodeJS.Timeout | null = null;

export const healthChecker = {
  async checkProvider(
    provider: { id: string; apiBaseUrl: string; apiKeyEncrypted: string; protocolType: string; name?: string },
    timeout: number
  ): Promise<{ healthy: boolean; latency: number; error?: string }> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

    try {
      const apiKey = decrypt(provider.apiKeyEncrypted);
      let url = provider.apiBaseUrl.replace(/\/+$/, '');
      if (/\/v\d+$/.test(url)) {
        url += '/models';
      } else {
        url += '/v1/models';
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - startTime;

      if (response.ok) {
        return { healthy: true, latency };
      }

      return { healthy: false, latency, error: `HTTP ${response.status}` };
    } catch (error: any) {
      clearTimeout(timeoutId);
      return { healthy: false, latency: Date.now() - startTime, error: error.message || 'Unknown error' };
    }
  },

  async startChecking(
    getProviders: () => Promise<Array<{ id: string; apiBaseUrl: string; apiKeyEncrypted: string; protocolType: string; name?: string }>>,
    intervalSeconds: number
  ): Promise<NodeJS.Timeout> {
    if (checkInterval) return checkInterval;

    const checkLoop = async () => {
      try {
        const providers = await getProviders();

        for (const provider of providers) {
          const failoverConfig = await prisma.failoverConfig.findUnique({
            where: { providerId: provider.id }
          });

          if (failoverConfig) {
            circuitBreaker.setConfig(provider.id, {
              errorThresholdPercent: failoverConfig.errorThresholdPercent,
              errorWindowSeconds: failoverConfig.errorWindowSeconds,
              minRequestCount: failoverConfig.minRequestCount,
              cooldownSeconds: failoverConfig.cooldownSeconds,
              recoveryObserveSeconds: failoverConfig.recoveryObserveSeconds
            });
          }

          // 跳过禁用主动探测的提供商
          if (failoverConfig && !failoverConfig.healthCheckEnabled) continue;

          const config = circuitBreaker.getConfig(provider.id);

          const healthCheckTimeout = failoverConfig?.healthCheckTimeout || 10;
          const result = await this.checkProvider(provider, healthCheckTimeout);

          await prisma.providerHealthLog.create({
            data: {
              providerId: provider.id,
              checkType: 'active',
              status: result.healthy ? 'success' : 'failure',
              latency: result.latency,
              errorMessage: result.error
            }
          });

          await prisma.provider.update({
            where: { id: provider.id },
            data: {
              lastHealthCheck: new Date()
            }
          });

          if (result.healthy) {
            circuitBreaker.recordHealthSuccess(provider.id, provider.name);
          } else {
            circuitBreaker.recordHealthFailure(provider.id, provider.name);
          }
        }
      } catch (error) {
        console.error('Health check loop error:', error);
      }
    };

    await checkLoop();
    checkInterval = setInterval(checkLoop, intervalSeconds * 1000);
    return checkInterval;
  },

  stopChecking(): void {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  }
};
