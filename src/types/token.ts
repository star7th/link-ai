export type TokenStatus = 'active' | 'disabled';
export type IpRuleMode = 'allow_all' | 'whitelist' | 'blacklist';
export type QuotaPeriod = 'daily' | 'weekly' | 'monthly';

export interface Token {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  status: TokenStatus;
  rpmLimit?: number;
  tpmLimit?: number;
  ipRuleMode: IpRuleMode;
  quotaTokenLimit?: number;
  quotaRequestLimit?: number;
  quotaPeriod: QuotaPeriod;
  lastUsedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TokenWithProviders extends Token {
  tokenProviders: TokenProviderItem[];
}

export interface TokenProviderItem {
  id: string;
  tokenId: string;
  providerId: string;
  priority: number;
  provider?: {
    id: string;
    name: string;
    protocolType: string;
    healthStatus: string;
  };
}

export interface TokenIpRule {
  id: string;
  tokenId: string;
  ruleType: 'whitelist' | 'blacklist';
  ipCidr: string;
  createdAt: Date;
}

export interface CreateTokenInput {
  name: string;
  providers: Array<{ providerId: string; priority: number }>;
  rpmLimit?: number;
  tpmLimit?: number;
  ipRuleMode?: IpRuleMode;
  ipRules?: Array<{ ruleType: 'whitelist' | 'blacklist'; ipCidr: string }>;
  quotaTokenLimit?: number;
  quotaRequestLimit?: number;
  quotaPeriod?: QuotaPeriod;
  desensitizeRuleIds?: string[];
}

export interface UpdateTokenInput {
  name?: string;
  providers?: Array<{ providerId: string; priority: number }>;
  rpmLimit?: number;
  tpmLimit?: number;
  ipRuleMode?: IpRuleMode;
  ipRules?: Array<{ ruleType: 'whitelist' | 'blacklist'; ipCidr: string }>;
  quotaTokenLimit?: number;
  quotaRequestLimit?: number;
  quotaPeriod?: QuotaPeriod;
  desensitizeRuleIds?: string[];
}

export interface TokenRotateResult {
  key: string;
  message: string;
}

export interface TokenCreateResult {
  id: string;
  name: string;
  key: string;
  message: string;
}
