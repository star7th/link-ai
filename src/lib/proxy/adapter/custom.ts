import { BaseAdapter, ProxyRequest, ProxyResponse } from './base';

export class CustomAdapter extends BaseAdapter {
  protected getAuthorizationHeader(): string {
    return `Bearer ${this.apiKey}`;
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    return this.doForward(request);
  }
}
