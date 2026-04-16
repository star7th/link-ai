import { BaseAdapter, ProxyRequest, ProxyResponse, resolveProxyUrl } from './base';

export class AzureAdapter extends BaseAdapter {
  protected getAuthorizationHeader(): string {
    return this.apiKey;
  }

  protected buildUrl(path: string): string {
    return resolveProxyUrl(this.provider.apiBaseUrl, path);
  }

  private adaptResponse(response: any): any {
    if (!response) return response;
    return response;
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const url = this.buildUrl(request.path);
    const { 'content-type': _ct, ...restHeaders } = request.headers;
    const headers: Record<string, string> = {
      ...restHeaders,
      'api-key': this.apiKey,
      'Content-Type': 'application/json'
    };

    const encodedBody = request.body ? new Blob([JSON.stringify(request.body)], { type: 'application/json' }) : undefined;

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: encodedBody
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
