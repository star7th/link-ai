import { BaseAdapter, ProxyRequest, ProxyResponse } from './base';

export class OpenAIAdapter extends BaseAdapter {
  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    return this.doForward(request);
  }
}
