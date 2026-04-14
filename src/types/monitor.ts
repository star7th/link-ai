/**
 * 监控项通知绑定关系
 */
export interface MonitorNotificationBinding {
  id: string;
  monitorId: string;
  notificationChannelId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  notificationChannel: {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    config: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * 监控状态记录
 */
export interface MonitorStatus {
  id: string;
  monitorId: string;
  status: number;
  message?: string;
  ping?: number;
  timestamp: Date;
}

/**
 * 扩展的监控项数据类型
 */
export interface ExtendedMonitor {
  id: string;
  name: string;
  type: string;
  config: Record<string, any>;
  active: boolean;
  interval: number;
  retries: number;
  retryInterval: number;
  resendInterval: number;
  upsideDown: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  lastCheckAt?: Date | null;
  nextCheckAt?: Date | null;
  lastStatus?: number | null;
  notificationBindings?: MonitorNotificationBinding[];
  statusHistory?: MonitorStatus[];
}

/**
 * 简化的通知绑定数据
 */
export interface SimpleNotificationBinding {
  notificationId: string;
  enabled: boolean;
}

/**
 * 监控表单数据
 */
export interface MonitorFormData {
  name: string;
  type: string;
  url?: string;
  httpMethod?: string;
  statusCodes?: string;
  maxRedirects?: number | string;
  ignoreTls?: boolean;
  requestBody?: string;
  requestHeaders?: string;
  keyword?: string;
  hostname?: string;
  port?: number | string;
  username?: string;
  password?: string;
  database?: string;
  query?: string;
  interval?: number | string;
  retries?: number | string;
  retryInterval?: number | string;
  resendInterval?: number | string;
  upsideDown?: boolean;
  description?: string;
  active?: boolean;
  notificationBindings?: SimpleNotificationBinding[];
  config?: {
    url?: string;
    httpMethod?: string;
    statusCodes?: string;
    maxRedirects?: number;
    ignoreTls?: boolean;
    requestBody?: string;
    requestHeaders?: string;
    keyword?: string;
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    query?: string;
  };
} 