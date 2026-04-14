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
  minRequestCount: 5,
  cooldownSeconds: 30,
  recoveryObserveSeconds: 300
};

export function setStateChangeCallback(callback: StateChangeCallback) {
  stateChangeCallback = callback;
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
        data.state = 'half_open';
        data.since = Date.now();
        data.halfOpenSince = Date.now();
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
  }
};
