import { decrypt } from '../../crypto';

export interface ProviderConfig {
  id: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  protocolType: 'openai' | 'azure' | 'anthropic' | 'dashscope' | 'custom';
  defaultModels?: string;
}

export interface ProxyRequest {
  provider: ProviderConfig;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
}

/**
 * Smart URL resolver that prevents double-path issues.
 *
 * Problem: clients send /v1/chat/completions but providers have different base URLs:
 *   - https://api.openai.com/v1          → wants /v1/chat/completions
 *   - https://api.openai.com             → wants /v1/chat/completions
 *   - https://open.bigmodel.cn/api/paas/v4 → wants /v4/chat/completions
 *   - https://open.bigmodel.cn/api/paas   → wants /v4/chat/completions
 *   - https://dashscope.aliyuncs.com/compatible-mode/v1 → wants /v1/chat/completions
 *
 * Strategy:
 * 1. If apiBaseUrl has no path (bare origin), append requestPath as-is
 * 2. If apiBaseUrl has a path AND requestPath starts with that path, deduplicate
 * 3. If apiBaseUrl has a path but requestPath doesn't start with it,
 *    strip the /v1/ prefix from requestPath and append the rest (e.g. /chat/completions)
 */
export function resolveProxyUrl(apiBaseUrl: string, requestPath: string): string {
  let baseUrl = apiBaseUrl.replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname.replace(/\/+$/, ''); // e.g. "/v1", "/api/paas/v4", ""

    if (!basePath || basePath === '/') {
      // No path in base URL, just append
      url.pathname = requestPath;
    } else if (requestPath.startsWith(basePath)) {
      // Request path already contains the base path prefix — deduplicate
      const remaining = requestPath.slice(basePath.length) || '/';
      url.pathname = basePath + remaining;
    } else {
      if (/\/v\d+$/.test(basePath)) {
        const stripped = requestPath.replace(/^\/v1\//, '/');
        url.pathname = basePath + stripped;
      } else {
        url.pathname = basePath + requestPath;
      }
    }
    return url.toString();
  } catch {
    return baseUrl + requestPath;
  }
}

export abstract class BaseAdapter {
  protected provider: ProviderConfig;
  protected apiKey: string;

  constructor(provider: ProviderConfig) {
    this.provider = provider;
    this.apiKey = decrypt(provider.apiKeyEncrypted);
  }

  protected getAuthorizationHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  protected buildUrl(path: string): string {
    return resolveProxyUrl(this.provider.apiBaseUrl, path);
  }

  abstract forward(request: ProxyRequest): Promise<ProxyResponse>;

  protected async doForward(request: ProxyRequest): Promise<ProxyResponse> {
    const url = this.buildUrl(request.path);
    const { authorization, host, 'content-length': _cl, 'content-type': _ct, connection, 'x-forwarded-for': _xff, 'x-real-ip': _xri, ...restHeaders } = request.headers;
    const headers = {
      ...restHeaders,
      'Authorization': this.getAuthorizationHeader(),
      'Content-Type': 'application/json'
    };

    const timeoutMs = request.timeoutMs || parseInt(process.env.PROXY_UPSTREAM_TIMEOUT || '20000', 10);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body ? JSON.stringify(request.body) : undefined,
        signal: controller.signal
      });
    } catch (err: any) {
      throw new Error(`Upstream request failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    }
    // 收到响应头就取消超时，让后续 body 读取不受超时限制
    clearTimeout(timer);

    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    let body: any;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      status: response.status,
      headers: headersObj,
      body
    };
  }
}
