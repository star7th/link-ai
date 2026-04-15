import { prisma } from '@/lib/prisma';
import { OpenAIAdapter } from '@/lib/proxy/adapter/openai';
import { AnthropicAdapter } from '@/lib/proxy/adapter/anthropic';
import { AzureAdapter } from '@/lib/proxy/adapter/azure';
import { DashScopeAdapter } from '@/lib/proxy/adapter/dashscope';
import { CustomAdapter } from '@/lib/proxy/adapter/custom';
import { ProviderConfig, ProxyRequest, ProxyResponse } from '@/lib/proxy/adapter/base';
import { circuitBreaker } from '@/lib/failover/circuit-breaker';
import { restoreState } from '@/lib/failover/circuit-breaker';
import { rateLimiter } from '@/lib/rate-limit';
import { quotaEngine } from '@/lib/quota/engine';

export function applyModelRedirect(body: any, modelRedirectStr: string | null): any {
  if (!body || !body.model || !modelRedirectStr) return body;
  try {
    const rules: Array<{ from: string; to: string }> = JSON.parse(modelRedirectStr);
    if (!Array.isArray(rules)) return body;
    const match = rules.find(r => r.from === body.model);
    if (match) {
      return { ...body, model: match.to };
    }
  } catch {}
  return body;
}

export class ProxyEngine {
  private adapterMap = new Map<string, new (p: ProviderConfig) => any>();

  constructor() {
    this.adapterMap.set('openai', OpenAIAdapter);
    this.adapterMap.set('anthropic', AnthropicAdapter);
    this.adapterMap.set('azure', AzureAdapter);
    this.adapterMap.set('dashscope', DashScopeAdapter);
    this.adapterMap.set('custom', CustomAdapter);
  }

  async getProviderWithConfig(providerId: string): Promise<any> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { failoverConfig: true }
    });
    return provider;
  }

  async setupProviderConfig(providerId: string): Promise<void> {
    const provider = await this.getProviderWithConfig(providerId);
    if (provider?.failoverConfig) {
      circuitBreaker.setConfig(providerId, {
        errorThresholdPercent: provider.failoverConfig.errorThresholdPercent,
        errorWindowSeconds: provider.failoverConfig.errorWindowSeconds,
        minRequestCount: provider.failoverConfig.minRequestCount,
        cooldownSeconds: provider.failoverConfig.cooldownSeconds,
        recoveryObserveSeconds: provider.failoverConfig.recoveryObserveSeconds
      });
    }
  }

  private async getProvidersForToken(tokenHash: string): Promise<Array<{ id: string; apiBaseUrl: string; apiKeyEncrypted: string; protocolType: string; name: string; modelRedirect?: string | null }>> {
    const token = await prisma.token.findUnique({
      where: { keyHash: tokenHash },
      include: {
        tokenProviders: {
          include: { provider: true },
          orderBy: { priority: 'asc' }
        }
      }
    });

    if (!token || token.status !== 'active') {
      return [];
    }

    if (token.tokenProviders.length > 0) {
      return token.tokenProviders.map((tp: any) => ({
        id: tp.provider.id,
        apiBaseUrl: tp.provider.apiBaseUrl,
        apiKeyEncrypted: tp.provider.apiKeyEncrypted,
        protocolType: tp.provider.protocolType,
        name: tp.provider.name,
        modelRedirect: tp.provider.modelRedirect
      }));
    }

    const allProviders = await prisma.provider.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' }
    });
    return allProviders.map((p: any) => ({
      id: p.id,
      apiBaseUrl: p.apiBaseUrl,
      apiKeyEncrypted: p.apiKeyEncrypted,
      protocolType: p.protocolType,
      name: p.name,
      modelRedirect: p.modelRedirect
    }));
  }

  async forwardWithFailover(
    tokenHash: string,
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: any
  ): Promise<{ response: ProxyResponse; providerId: string; failover: boolean; streamed: boolean }> {
    const providers = await this.getProvidersForToken(tokenHash);

    if (providers.length === 0) {
      throw new Error('No active providers configured for this token');
    }

    // Single provider: no failover needed, use longer timeout (2 min)
    if (providers.length === 1) {
      const provider = providers[0];
      await this.setupProviderConfig(provider.id);
      const providerConfig = await this.getProviderWithConfig(provider.id);

      // Skip circuit breaker check for single provider — no backup to switch to
      // but still record success/failure for observability
      try {
        const response = await this.forwardToProvider(provider, path, method, headers, body, 120000);
        if (response.status >= 200 && response.status < 300) {
          circuitBreaker.recordSuccess(provider.id, provider.name);
          if (providerConfig?.totalRpmLimit) {
            rateLimiter.record('provider', provider.id, 'rpm');
          }
          return { response, providerId: provider.id, failover: false, streamed: false };
        }
        circuitBreaker.recordFailure(provider.id, provider.name);
        throw new Error(`Provider ${provider.name} returned ${response.status}`);
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, provider.name);
        throw error instanceof Error ? error : new Error(`Provider ${provider.name} request failed`);
      }
    }

    let lastError: Error | null = null;
    let failover = false;
    let streamed = false;

    for (const provider of providers) {
      await this.setupProviderConfig(provider.id);

      if (!circuitBreaker.isAvailable(provider.id)) {
        lastError = new Error(`Provider ${provider.name} circuit is open`);
        failover = true;
        continue;
      }

      const providerConfig = await this.getProviderWithConfig(provider.id);

      if (providerConfig?.totalRpmLimit) {
        const rpmCheck = rateLimiter.check('provider', provider.id, 'rpm', providerConfig.totalRpmLimit);
        if (!rpmCheck.allowed) {
          lastError = new Error(`Provider ${provider.name} RPM limit exceeded`);
          failover = true;
          continue;
        }
      }

      if (providerConfig?.totalTpmLimit) {
        const tpmCheck = rateLimiter.check('provider', provider.id, 'tpm', providerConfig.totalTpmLimit, 0);
        if (!tpmCheck.allowed) {
          lastError = new Error(`Provider ${provider.name} TPM limit exceeded`);
          failover = true;
          continue;
        }
      }

      const quotaCheck = await quotaEngine.checkQuota('provider', provider.id, {
        tokenLimit: providerConfig?.totalTpmLimit,
        period: 'monthly'
      });

      if (!quotaCheck.allowed) {
        lastError = new Error(`Provider ${provider.name} quota exceeded`);
        failover = true;
        continue;
      }

      try {
        const response = await this.forwardToProvider(provider, path, method, headers, body);

        // Whitelist: only 2xx is considered success.
        // Anything else (3xx, 4xx, 5xx) triggers failover.
        if (response.status >= 200 && response.status < 300) {
          circuitBreaker.recordSuccess(provider.id, provider.name);
          if (providerConfig?.totalRpmLimit) {
            rateLimiter.record('provider', provider.id, 'rpm');
          }
          return { response, providerId: provider.id, failover, streamed };
        }

        circuitBreaker.recordFailure(provider.id, provider.name);
        lastError = new Error(`Provider ${provider.name} returned ${response.status}`);
        failover = true;
      } catch (error) {
        circuitBreaker.recordFailure(provider.id, provider.name);
        lastError = error instanceof Error ? error : new Error(`Provider ${provider.name} request failed`);
        failover = true;
      }
    }

    throw lastError || new Error('All providers failed');
  }

  private async forwardToProvider(
    provider: { id: string; apiBaseUrl: string; apiKeyEncrypted: string; protocolType: string; name: string; modelRedirect?: string | null },
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: any,
    timeoutMs?: number
  ): Promise<ProxyResponse> {
    const AdapterClass = this.adapterMap.get(provider.protocolType) || OpenAIAdapter;
    const adapter = new AdapterClass(provider as ProviderConfig);

    const redirectedBody = applyModelRedirect(body, provider.modelRedirect || null);

    const request: ProxyRequest = {
      provider: provider as ProviderConfig,
      path,
      method,
      headers,
      body: redirectedBody,
      timeoutMs
    };

    return adapter.forward(request);
  }
}

export const proxyEngine = new ProxyEngine();

export async function setupProviderConfigs() {
  const providers = await prisma.provider.findMany({
    where: { status: 'active' },
    include: { failoverConfig: true }
  });

  for (const provider of providers) {
    if (provider.failoverConfig) {
      circuitBreaker.setConfig(provider.id, {
        errorThresholdPercent: provider.failoverConfig.errorThresholdPercent,
        errorWindowSeconds: provider.failoverConfig.errorWindowSeconds,
        minRequestCount: provider.failoverConfig.minRequestCount,
        cooldownSeconds: provider.failoverConfig.cooldownSeconds,
        recoveryObserveSeconds: provider.failoverConfig.recoveryObserveSeconds
      });

      // 恢复持久化的熔断器状态
      const savedState = provider.failoverConfig.circuitState as 'closed' | 'open' | 'half_open';
      if (savedState && savedState !== 'closed') {
        const since = provider.failoverConfig.circuitStateSince
          ? new Date(provider.failoverConfig.circuitStateSince).getTime()
          : Date.now();
        restoreState(provider.id, savedState, since);
      }
    }
  }
}
