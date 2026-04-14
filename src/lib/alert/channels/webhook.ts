export interface WebhookConfig {
  webhookUrl: string;
  secret?: string;
}

export interface FeishuConfig extends WebhookConfig {
  msgType?: 'text' | 'interactive';
}

export interface DingtalkConfig extends WebhookConfig {}

export interface WecomConfig extends WebhookConfig {}

export async function sendFeishu(config: FeishuConfig, title: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: config.msgType || 'text',
        content: {
          text: `${title}\n${message}`,
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();
    if (result.code !== 0) {
      return { success: false, error: result.msg || 'Feishu webhook error' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send Feishu webhook:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function sendDingtalk(config: DingtalkConfig, title: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const body: any = {
      msgtype: 'text',
      text: {
        content: `${title}\n${message}`,
      },
    };

    if (config.secret) {
      const crypto = await import('crypto');
      const timestamp = Date.now();
      const stringToSign = `${timestamp}\n${config.secret}`;
      const hmac = crypto.createHmac('sha256', config.secret);
      hmac.update(stringToSign);
      const sign = encodeURIComponent(hmac.digest('base64'));
      const url = `${config.webhookUrl}&timestamp=${timestamp}&sign=${sign}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const result = await response.json();
      if (result.errcode !== 0) {
        return { success: false, error: result.errmsg || 'Dingtalk webhook error' };
      }
    } else {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const result = await response.json();
      if (result.errcode !== 0) {
        return { success: false, error: result.errmsg || 'Dingtalk webhook error' };
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send Dingtalk webhook:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function sendWecom(config: WecomConfig, title: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: {
          content: `${title}\n${message}`,
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const result = await response.json();
    if (result.errcode !== 0) {
      return { success: false, error: result.errmsg || 'Wecom webhook error' };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send Wecom webhook:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

export async function sendGenericWebhook(url: string, data: Record<string, any>): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to send webhook:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}
