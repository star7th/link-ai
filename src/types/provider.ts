export type ProtocolType = 'openai' | 'azure' | 'anthropic' | 'dashscope' | 'custom';

export interface Provider {
  id: string;
  name: string;
  code: string;
  protocolType: ProtocolType;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  defaultModels?: string;
  status: 'active' | 'disabled';
  totalRpmLimit?: number;
  totalTpmLimit?: number;
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown';
  lastHealthCheck?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderWithFailover extends Provider {
  failoverConfig?: FailoverConfig;
}

export interface FailoverConfig {
  id: string;
  providerId: string;
  errorThresholdPercent: number;
  errorWindowSeconds: number;
  minRequestCount: number;
  cooldownSeconds: number;
  recoveryObserveSeconds: number;
  healthCheckEnabled: boolean;
  healthCheckInterval: number;
  healthCheckTimeout: number;
}

export interface ProviderHealthLog {
  id: string;
  providerId: string;
  checkType: 'passive' | 'active';
  status: 'success' | 'failure' | 'timeout';
  latency?: number;
  errorMessage?: string;
  createdAt: Date;
}

export interface ProviderTestResult {
  connected: boolean;
  latency?: number;
  models?: string[];
  error?: string;
}

export interface CreateProviderInput {
  name: string;
  code: string;
  protocolType: ProtocolType;
  apiBaseUrl: string;
  apiKey: string;
  defaultModels?: string[];
  totalRpmLimit?: number;
  totalTpmLimit?: number;
  failoverConfig?: Partial<FailoverConfig>;
}

export interface UpdateProviderInput {
  name?: string;
  status?: 'active' | 'disabled';
  apiBaseUrl?: string;
  apiKey?: string;
  totalRpmLimit?: number;
  totalTpmLimit?: number;
}

export interface ProviderScopeInput {
  userIds: string[];
  groupIds: string[];
}
