import { isInObservation, enterObservation, recordObservationFailure, exitObservation } from './anti-flap';
import { prisma } from '../prisma';

type CircuitState = 'closed' | 'open' | 'half_open';

type CircuitData = {
  state: CircuitState;
  successWindow: number[];
  failWindow: number[];
  since: number;
  providerId: string;
  providerName?: string;
  halfOpenSince: number;
};

type CircuitBreakerConfig = {
  errorThresholdPercent: number;
  errorWindowSeconds: number;
  minRequestCount: number;
  cooldownSeconds: number;
  recoveryObserveSeconds: number;
};

type StateChangeCallback = (providerId: string, oldState: CircuitState, newState: CircuitState, providerName?: string) => void;

let stateChangeCallback: StateChangeCallback | null = null;

const circuits = new Map<string, CircuitData>();
const configs = new Map<string, CircuitBreakerConfig>();

const defaultConfig: CircuitBreakerConfig = {
  errorThresholdPercent: 50,
  errorWindowSeconds: 60,
  minRequestCount: 2,
  cooldownSeconds: 30,
  recoveryObserveSeconds: 300
};

export function setStateChangeCallback(callback: StateChangeCallback | null) {
  stateChangeCallback = callback;
}

// 将熔断器状态持久化到数据库（异步，不阻塞主流程）
async function persistState(providerId: string): Promise<void> {
  const data = circuits.get(providerId);
  if (!data) return;
  try {
    await prisma.failoverConfig.upsert({
      where: { providerId },
      update: {
        circuitState: data.state,
        circuitStateSince: data.since ? new Date(data.since) : null,
      },
      create: {
        providerId,
        circuitState: data.state,
        circuitStateSince: data.since ? new Date(data.since) : null,
      },
    });
  } catch (error) {
    // 持久化失败不应影响主流程，仅记录日志
    console.error(`[CircuitBreaker] 持久化状态失败 providerId=${providerId}:`, error);
  }
}

// 启动时从数据库恢复熔断器状态
export function restoreState(providerId: string, state: CircuitState, since: number): void {
  if (state === 'closed') return; // closed 是默认状态，无需恢复
  let data = circuits.get(providerId);
  if (!data) {
    data = { state: 'closed', successWindow: [], failWindow: [], since: Date.now(), providerId, halfOpenSince: 0 };
    circuits.set(providerId, data);
  }
  data.state = state;
  data.since = since;
  if (state === 'half_open') {
    data.halfOpenSince = since;
  }
}

export const circuitBreaker = {
  setConfig(providerId: string, config: Partial<CircuitBreakerConfig>): void {
    configs.set(providerId, { ...defaultConfig, ...config });
  },

  getConfig(providerId: string): CircuitBreakerConfig {
    return configs.get(providerId) || defaultConfig;
  },

  trimWindows(data: CircuitData, windowSeconds: number): void {
    const cutoff = Date.now() - windowSeconds * 1000;
    data.successWindow = data.successWindow.filter(t => t > cutoff);
    data.failWindow = data.failWindow.filter(t => t > cutoff);
  },

  calculateErrorRate(data: CircuitData): number {
    const total = data.successWindow.length + data.failWindow.length;
    if (total === 0) return 0;
    return (data.failWindow.length / total) * 100;
  },

  recordSuccess(providerId: string, providerName?: string): void {
    const config = this.getConfig(providerId);
    let data = circuits.get(providerId);

    if (!data) {
      data = { state: 'closed', successWindow: [], failWindow: [], since: Date.now(), providerId, halfOpenSince: 0 };
      circuits.set(providerId, data);
    }

    if (providerName && !data.providerName) {
      data.providerName = providerName;
    }

    const oldState = data.state;
    this.trimWindows(data, config.errorWindowSeconds);
    data.successWindow.push(Date.now());

    if (data.state === 'half_open') {
      // 观察期内持续成功才恢复，防止提供商抖动
      const observeElapsed = Date.now() - data.halfOpenSince;
      if (observeElapsed >= config.recoveryObserveSeconds * 1000) {
        data.state = 'closed';
        data.since = Date.now();
        data.halfOpenSince = 0;
        // 熔断恢复正常，退出 anti-flap 观察模式
        exitObservation(providerId);
        // 持久化状态变更（异步，不阻塞）
        persistState(providerId);
        if (stateChangeCallback) {
          stateChangeCallback(providerId, oldState, 'closed', data.providerName);
        }
      }
    }
  },

  recordFailure(providerId: string, providerName?: string): void {
    const config = this.getConfig(providerId);
    let data = circuits.get(providerId);

    if (!data) {
      data = { state: 'closed', successWindow: [], failWindow: [], since: Date.now(), providerId, halfOpenSince: 0 };
      circuits.set(providerId, data);
    }

    if (providerName && !data.providerName) {
      data.providerName = providerName;
    }

    const oldState = data.state;
    this.trimWindows(data, config.errorWindowSeconds);
    data.failWindow.push(Date.now());

    if (data.state === 'half_open') {
      data.state = 'open';
      data.since = Date.now();
      // half_open→open 表示提供商又失败了，进入 anti-flap 观察模式
      enterObservation(providerId);
      // 持久化状态变更（异步，不阻塞）
      persistState(providerId);
      if (stateChangeCallback) {
        stateChangeCallback(providerId, oldState, 'open', data.providerName);
      }
      return;
    }

    const total = data.successWindow.length + data.failWindow.length;
    if (total >= config.minRequestCount) {
      const errorRate = this.calculateErrorRate(data);
      if (errorRate >= config.errorThresholdPercent) {
        data.state = 'open';
        data.since = Date.now();
        // 持久化状态变更（异步，不阻塞）
        persistState(providerId);
        if (stateChangeCallback && oldState !== 'open') {
          stateChangeCallback(providerId, oldState, 'open', data.providerName);
        }
      }
    }
  },

  isAvailable(providerId: string): boolean {
    const config = this.getConfig(providerId);
    const data = circuits.get(providerId);

    if (!data || data.state === 'closed') return true;
    if (data.state === 'open') {
      const elapsed = Date.now() - data.since;
      if (elapsed >= config.cooldownSeconds * 1000) {
        // anti-flap 检查：如果处于观察期，阻止 open→half_open 切换，保持 open
        if (isInObservation(providerId)) {
          // 观察期内，尝试记录本次探测失败（如果观察期内累积3次失败则延长观察）
          return false;
        }
        data.state = 'half_open';
        data.since = Date.now();
        data.halfOpenSince = Date.now();
        // 持久化状态变更（异步，不阻塞）
        persistState(providerId);
        return true;
      }
      return false;
    }
    return data.state === 'half_open';
  },

  getState(providerId: string): CircuitData | undefined {
    return circuits.get(providerId);
  },

  reset(providerId: string): void {
    circuits.delete(providerId);
  },

  resetAll(): void {
    circuits.clear();
  },

  // 健康检查专用通道：不干扰用户请求的错误率统计
  // 健康检查成功时，只更新 Provider 的 healthStatus，不自动恢复熔断器
  async recordHealthSuccess(providerId: string, providerName?: string): Promise<void> {
    try {
      await prisma.provider.update({
        where: { id: providerId },
        data: { healthStatus: 'healthy', lastHealthCheck: new Date() },
      });
    } catch (error) {
      console.error(`[CircuitBreaker] 健康检查成功状态更新失败 providerId=${providerId}:`, error);
    }
  },

  // 健康检查失败时：更新 healthStatus，如果熔断器是 closed 则直接打开
  async recordHealthFailure(providerId: string, providerName?: string): Promise<void> {
    try {
      await prisma.provider.update({
        where: { id: providerId },
        data: { healthStatus: 'down', lastHealthCheck: new Date() },
      });
    } catch (error) {
      console.error(`[CircuitBreaker] 健康检查失败状态更新失败 providerId=${providerId}:`, error);
    }

    // 健康检查失败意味着端点不可达，如果当前是 closed 状态，直接设为 open
    let data = circuits.get(providerId);
    if (!data) {
      data = { state: 'closed', successWindow: [], failWindow: [], since: Date.now(), providerId, halfOpenSince: 0 };
      circuits.set(providerId, data);
    }

    if (providerName && !data.providerName) {
      data.providerName = providerName;
    }

    if (data.state === 'closed') {
      const oldState = data.state;
      data.state = 'open';
      data.since = Date.now();
      persistState(providerId);
      if (stateChangeCallback) {
        stateChangeCallback(providerId, oldState, 'open', data.providerName);
      }
    }
  }
};
