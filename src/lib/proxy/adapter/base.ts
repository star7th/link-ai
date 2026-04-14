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
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
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
    let baseUrl = this.provider.apiBaseUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return `${baseUrl}${path}`;
  }

  abstract forward(request: ProxyRequest): Promise<ProxyResponse>;

  protected async doForward(request: ProxyRequest): Promise<ProxyResponse> {
    const url = this.buildUrl(request.path);
    const { authorization, host, 'content-length': _cl, connection, 'x-forwarded-for': _xff, 'x-real-ip': _xri, ...restHeaders } = request.headers;
    const headers = {
      ...restHeaders,
      'Authorization': this.getAuthorizationHeader(),
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body ? JSON.stringify(request.body) : undefined
    });

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
