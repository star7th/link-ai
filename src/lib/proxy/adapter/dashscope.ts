import { BaseAdapter, ProxyRequest, ProxyResponse } from './base';

export class DashScopeAdapter extends BaseAdapter {
  protected getAuthorizationHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  private adaptRequestBody(body: any): any {
    if (!body) return body;

    const adapted: any = {
      model: body.model,
      input: {
        messages: body.messages || []
      },
      parameters: {}
    };

    if (body.temperature !== undefined) adapted.parameters.temperature = body.temperature;
    if (body.top_p !== undefined) adapted.parameters.top_p = body.top_p;
    if (body.max_tokens !== undefined) adapted.parameters.max_tokens = body.max_tokens;
    if (body.stream !== undefined) adapted.incremental_output = body.stream;

    return adapted;
  }

  private adaptResponse(response: any): any {
    if (!response || !response.output) {
      return {
        id: response.request_id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: response.model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: response.output?.text || response.output?.choices?.[0]?.message?.content || ''
          },
          finish_reason: response.output?.finish_reason || 'stop'
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
    const finalHeaders: Record<string, string> = {
      ...Object.fromEntries(Object.entries(request.headers).filter(([k]) => k !== 'content-type')),
      'Authorization': this.getAuthorizationHeader(),
      'Content-Type': 'application/json'
    };
    const bodyStr = adaptedBody ? JSON.stringify(adaptedBody) : undefined;

    const response = await fetch(url, {
      method: request.method,
      headers: finalHeaders,
      body: bodyStr
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
