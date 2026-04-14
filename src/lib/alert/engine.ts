import { prisma } from '../prisma';

class AlertEngine {
  private rulesCache = new Map<string, any[]>();
  private lastTriggerTime = new Map<string, number>();

  async trigger(condition: string, data: Record<string, any>): Promise<void> {
    const rules = this.rulesCache.get(condition) || [];

    for (const rule of rules) {
      if (!rule.isEnabled) continue;

      const triggerKey = `${rule.id}:${condition}`;
      const lastTrigger = this.lastTriggerTime.get(triggerKey) || 0;
      const cooldown = rule.cooldown * 1000;

      if (Date.now() - lastTrigger < cooldown) continue;

      this.lastTriggerTime.set(triggerKey, Date.now());

      let title = '';
      let message = '';
      let level = 'info';

      switch (condition) {
        case 'provider_down':
          title = `Provider ${data.providerName || data.providerId} is down`;
          message = `Health check failed for provider ${data.providerName || data.providerId}`;
          level = 'critical';
          break;
        case 'quota_warning':
          title = `Quota warning for ${data.type} ${data.refId}`;
          message = `Quota usage ${(data.usage / data.limit * 100).toFixed(1)}% for ${data.type} ${data.refId}`;
          level = 'warning';
          break;
        case 'quota_exceeded':
          title = `Quota exceeded for ${data.type} ${data.refId}`;
          message = `Quota limit reached for ${data.type} ${data.refId}`;
          level = 'critical';
          break;
        case 'abnormal_request':
          title = `Abnormal request detected`;
          message = `Abnormal request pattern detected: ${data.reason}`;
          level = 'warning';
          break;
        case 'login_anomaly':
          title = `Login anomaly detected`;
          message = `Multiple failed login attempts detected`;
          level = 'warning';
          break;
        default:
          title = `Alert: ${condition}`;
          message = JSON.stringify(data);
      }

      await this.sendAlert(rule, level, title, message);
    }
  }

  async sendAlert(rule: any, level: string, title: string, message: string): Promise<void> {
    const channels = JSON.parse(rule.channels || '[]');
    const recipients: string[] = [];

    if (rule.recipientAdmins) {
      recipients.push('admin');
    }
    if (rule.recipientUsers) {
      recipients.push('users');
    }

    const channelConfig = await this.getChannelConfig();

    for (const channel of channels) {
      try {
        await this.sendViaChannel(channel, channelConfig[channel], { level, title, message });
        recipients.push(channel);
      } catch (error) {
        console.error(`Failed to send alert via ${channel}:`, error);
      }
    }

    await prisma.alertLog.create({
      data: {
        ruleId: rule.id,
        level,
        title,
        message,
        recipients: JSON.stringify(recipients),
        status: 'sent',
        createdAt: new Date()
      }
    });
  }

  private async getChannelConfig(): Promise<Record<string, any>> {
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'alert.channels' }
      });
      return JSON.parse(config?.value || '{}');
    } catch {
      return {};
    }
  }

  private async sendViaChannel(channel: string, config: any, data: { level: string; title: string; message: string }): Promise<void> {
    if (channel === 'console') {
      console.log(`[${data.level.toUpperCase()}] ${data.title}: ${data.message}`);
      return;
    }

    const { sendGenericWebhook } = await import('./channels/webhook');
    const { sendFeishu, sendDingtalk, sendWecom } = await import('./channels/webhook');
    const { sendEmail } = await import('./channels/email');

    const titleStr = `[${data.level.toUpperCase()}] ${data.title}`;

    if (channel === 'email' && config?.smtp) {
      const recipients = config.recipients || [];
      if (recipients.length > 0) {
        const result = await sendEmail(config, recipients, titleStr, data.message);
        if (!result.success) throw new Error(result.error);
      }
      return;
    }

    if (channel === 'webhook' && config?.url) {
      const result = await sendGenericWebhook(config.url, data);
      if (!result.success) throw new Error(result.error);
      return;
    }

    if (channel === 'feishu' && config?.webhookUrl) {
      const result = await sendFeishu(config, titleStr, data.message);
      if (!result.success) throw new Error(result.error);
      return;
    }

    if (channel === 'dingtalk' && config?.webhookUrl) {
      const result = await sendDingtalk(config, titleStr, data.message);
      if (!result.success) throw new Error(result.error);
      return;
    }

    if (channel === 'wecom' && config?.webhookUrl) {
      const result = await sendWecom(config, titleStr, data.message);
      if (!result.success) throw new Error(result.error);
      return;
    }
  }

  async loadRules(): Promise<void> {
    const rules = await prisma.alertRule.findMany({
      where: { isEnabled: true },
      orderBy: { createdAt: 'desc' }
    });

    this.rulesCache.clear();
    for (const rule of rules) {
      const condition = rule.triggerCondition;
      if (!this.rulesCache.has(condition)) {
        this.rulesCache.set(condition, []);
      }
      this.rulesCache.get(condition)!.push(rule);
    }
  }

  async getRecentAlerts(limit: number = 50): Promise<any[]> {
    return prisma.alertLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }
}

export const alertEngine = new AlertEngine();
