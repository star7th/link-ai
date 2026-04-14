import { BaseAdapter, ProxyRequest, ProxyResponse } from './base';

export class AzureAdapter extends BaseAdapter {
  protected getAuthorizationHeader(): string {
    return this.apiKey;
  }

  protected buildUrl(path: string): string {
    let baseUrl = this.provider.apiBaseUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return `${baseUrl}${path}`;
  }

  private adaptResponse(response: any): any {
    if (!response) return response;
    return response;
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const url = this.buildUrl(request.path);
    const headers = {
      ...request.headers,
      'api-key': this.apiKey,
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
      body = this.adaptResponse(body);
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
