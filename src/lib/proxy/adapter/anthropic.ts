import { BaseAdapter, ProxyRequest, ProxyResponse } from './base';

export class AnthropicAdapter extends BaseAdapter {
  protected getAuthorizationHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  protected buildUrl(path: string): string {
    let baseUrl = this.provider.apiBaseUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    if (!path.startsWith('/v1/')) {
      path = `/v1${path}`;
    }
    return `${baseUrl}${path}`;
  }

  private adaptRequestBody(body: any): any {
    if (!body || !body.messages) return body;

    const adapted: any = {
      model: body.model,
      max_tokens: body.max_tokens || 4096,
      messages: body.messages
    };

    if (body.temperature !== undefined) adapted.temperature = body.temperature;
    if (body.top_p !== undefined) adapted.top_p = body.top_p;
    if (body.stream !== undefined) adapted.stream = body.stream;
    if (body.stop) adapted.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];

    return adapted;
  }

  private adaptResponse(response: any): any {
    if (!response || !response.content) {
      return {
        id: response.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: response.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.content?.[0]?.text || ''
          },
          finish_reason: response.stop_reason || 'stop'
        }],
        usage: {
          prompt_tokens: response.usage?.input_tokens || 0,
          completion_tokens: response.usage?.output_tokens || 0,
          total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      };
    }

    return response;
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    const url = this.buildUrl(request.path);
    const adaptedBody = this.adaptRequestBody(request.body);

    const { 'content-type': _ct, ...restHeaders } = request.headers;
    const headers: Record<string, string> = {
      ...restHeaders,
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };

    const encodedBody = adaptedBody ? new Blob([JSON.stringify(adaptedBody)], { type: 'application/json' }) : undefined;

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
