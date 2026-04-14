import { prisma } from './prisma';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// 系统设置键名常量
export const SETTINGS_KEYS = {
  TIMEZONE: 'timezone',
  DATA_RETENTION_DAYS: 'data_retention_days',
  PROXY_ENABLED: 'proxy_enabled',
  PROXY_SERVER: 'proxy_server',
  PROXY_PORT: 'proxy_port',
  PROXY_USERNAME: 'proxy_username',
  PROXY_PASSWORD: 'proxy_password',
};

// 默认设置值
const DEFAULT_SETTINGS = {
  [SETTINGS_KEYS.TIMEZONE]: 'Asia/Shanghai',
  [SETTINGS_KEYS.DATA_RETENTION_DAYS]: '30',
  [SETTINGS_KEYS.PROXY_ENABLED]: 'false',
  [SETTINGS_KEYS.PROXY_SERVER]: '',
  [SETTINGS_KEYS.PROXY_PORT]: '',
  [SETTINGS_KEYS.PROXY_USERNAME]: '',
  [SETTINGS_KEYS.PROXY_PASSWORD]: '',
};

/**
 * 获取单个系统设置项
 */
export async function getSetting(key: string): Promise<string> {
  const config = await prisma.systemConfig.findUnique({
    where: { key },
  });
  
  if (!config) {
    // 如果配置不存在，创建默认配置
    const defaultValue = DEFAULT_SETTINGS[key] || '';
    await prisma.systemConfig.create({
      data: {
        key,
        value: defaultValue,
      },
    });
    return defaultValue;
  }
  
  return config.value;
}

/**
 * 批量获取系统设置
 */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const configs = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: keys,
      },
    },
  });
  
  // 构建结果对象，包含所有请求的键
  const result: Record<string, string> = {};
  
  // 处理查询结果
  for (const key of keys) {
    const config = configs.find(c => c.key === key);
    if (config) {
      result[key] = config.value;
    } else {
      // 如果某项配置不存在，创建默认值
      const defaultValue = DEFAULT_SETTINGS[key] || '';
      await prisma.systemConfig.create({
        data: {
          key,
          value: defaultValue,
        },
      });
      result[key] = defaultValue;
    }
  }
  
  return result;
}

/**
 * 获取所有通用设置项
 */
export async function getAllGeneralSettings(): Promise<Record<string, string>> {
  return getSettings([
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.DATA_RETENTION_DAYS,
  ]);
}

/**
 * 获取所有代理设置项
 */
export async function getAllProxySettings(): Promise<Record<string, string>> {
  return getSettings([
    SETTINGS_KEYS.PROXY_ENABLED,
    SETTINGS_KEYS.PROXY_SERVER,
    SETTINGS_KEYS.PROXY_PORT,
    SETTINGS_KEYS.PROXY_USERNAME,
    SETTINGS_KEYS.PROXY_PASSWORD,
  ]);
}

/**
 * 更新系统设置
 */
export async function updateSetting(key: string, value: string): Promise<void> {
  console.log(`更新设置: ${key} = ${value}`);
  
  const config = await prisma.systemConfig.findUnique({
    where: { key },
  });
  
  if (config) {
    console.log(`更新现有设置: ${key}, 原值=${config.value}, 新值=${value}`);
    await prisma.systemConfig.update({
      where: { key },
      data: { value },
    });
  } else {
    console.log(`创建新设置: ${key} = ${value}`);
    await prisma.systemConfig.create({
      data: {
        key,
        value,
      },
    });
  }
}

/**
 * 批量更新系统设置
 */
export async function updateSettings(settings: Record<string, string>): Promise<void> {
  console.log('批量更新设置:', settings);
  
  // 创建操作队列
  const updates = [];
  
  // 处理代理启用状态 - 特别确保它正确转换为字符串
  if (SETTINGS_KEYS.PROXY_ENABLED in settings) {
    const proxyEnabled = settings[SETTINGS_KEYS.PROXY_ENABLED].toLowerCase();
    // 确保值是 'true' 或 'false'
    settings[SETTINGS_KEYS.PROXY_ENABLED] = (proxyEnabled === 'true') ? 'true' : 'false';
  }
  
  // 添加所有更新到队列
  for (const [key, value] of Object.entries(settings)) {
    updates.push(updateSetting(key, value));
  }
  
  // 并行执行所有更新
  await Promise.all(updates);
}

/**
 * 重置所有设置为默认值
 */
export async function resetSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await updateSetting(key, value);
  }
}

// 通知渠道相关功能
interface NotificationConfig {
  [key: string]: string | number | boolean;
}

/**
 * 获取所有通知渠道
 */
export async function getNotificationChannels() {
  try {
    // 使用 findMany 查询 NotificationChannel 表中的所有记录
    const channels = await prisma.$queryRaw`
      SELECT * FROM NotificationChannel 
      ORDER BY createdAt DESC
    `;
    return Array.isArray(channels) ? channels : [];
  } catch (error) {
    console.error('获取通知渠道失败:', error);
    return [];
  }
}

/**
 * 获取单个通知渠道
 */
export async function getNotificationChannelById(id: string) {
  try {
    const channel = await prisma.$queryRaw`
      SELECT * FROM NotificationChannel 
      WHERE id = ${id} 
      LIMIT 1
    `;
    return Array.isArray(channel) && channel.length > 0 ? channel[0] : null;
  } catch (error) {
    console.error(`获取通知渠道 ID: ${id} 失败:`, error);
    return null;
  }
}

/**
 * 创建通知渠道
 */
export async function createNotificationChannel(data: {
  name: string;
  type: string;
  enabled?: boolean;
  defaultForNewMonitors?: boolean;
  config: NotificationConfig;
}) {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const configJson = JSON.stringify(data.config);
    
    // 检查是否有defaultForNewMonitors列
    const hasDefaultColumn = await checkDefaultColumnExists();
    
    if (!hasDefaultColumn) {
      // 添加defaultForNewMonitors列
      await prisma.$executeRaw`ALTER TABLE NotificationChannel ADD COLUMN defaultForNewMonitors BOOLEAN DEFAULT FALSE`;
    }
    
    // 使用参数化查询以防止SQL注入
    await prisma.$executeRaw`
      INSERT INTO NotificationChannel (
        id, name, type, enabled, defaultForNewMonitors, config, createdAt, updatedAt
      )
      VALUES (
        ${id}, 
        ${data.name}, 
        ${data.type}, 
        ${data.enabled !== false}, 
        ${!!data.defaultForNewMonitors},
        ${configJson}, 
        ${now}, 
        ${now}
      )
    `;
    
    return getNotificationChannelById(id);
  } catch (error) {
    console.error('创建通知渠道失败:', error);
    throw new Error('创建通知渠道失败');
  }
}

/**
 * 更新通知渠道
 */
export async function updateNotificationChannel(
  id: string, 
  data: {
    name?: string;
    type?: string;
    enabled?: boolean;
    defaultForNewMonitors?: boolean;
    config?: NotificationConfig;
  }
) {
  try {
    // 获取当前通知渠道数据
    const channel = await getNotificationChannelById(id);
    if (!channel) {
      throw new Error(`找不到ID为 ${id} 的通知渠道`);
    }
    
    // 检查是否有defaultForNewMonitors列
    const hasDefaultColumn = await checkDefaultColumnExists();
    
    if (!hasDefaultColumn) {
      // 添加defaultForNewMonitors列
      await prisma.$executeRaw`ALTER TABLE NotificationChannel ADD COLUMN defaultForNewMonitors BOOLEAN DEFAULT FALSE`;
    }
    
    // 更新时间
    const now = new Date().toISOString();
    
    // 执行更新 - 使用模板字符串而不是手动构建SQL
    if (data.name !== undefined && data.type !== undefined && data.config !== undefined && data.enabled !== undefined && data.defaultForNewMonitors !== undefined) {
      await prisma.$executeRaw`
        UPDATE NotificationChannel 
        SET name = ${data.name}, 
            type = ${data.type}, 
            enabled = ${data.enabled}, 
            defaultForNewMonitors = ${!!data.defaultForNewMonitors}, 
            config = ${JSON.stringify(data.config)}, 
            updatedAt = ${now}
        WHERE id = ${id}
      `;
    } else {
      // 更新部分字段
      if (data.name !== undefined) {
        await prisma.$executeRaw`UPDATE NotificationChannel SET name = ${data.name}, updatedAt = ${now} WHERE id = ${id}`;
      }
      
      if (data.type !== undefined) {
        await prisma.$executeRaw`UPDATE NotificationChannel SET type = ${data.type}, updatedAt = ${now} WHERE id = ${id}`;
      }
      
      if (data.enabled !== undefined) {
        await prisma.$executeRaw`UPDATE NotificationChannel SET enabled = ${data.enabled}, updatedAt = ${now} WHERE id = ${id}`;
      }
      
      if (data.defaultForNewMonitors !== undefined) {
        await prisma.$executeRaw`UPDATE NotificationChannel SET defaultForNewMonitors = ${!!data.defaultForNewMonitors}, updatedAt = ${now} WHERE id = ${id}`;
      }
      
      if (data.config !== undefined) {
        await prisma.$executeRaw`UPDATE NotificationChannel SET config = ${JSON.stringify(data.config)}, updatedAt = ${now} WHERE id = ${id}`;
      }
    }
    
    // 重新获取并返回更新后的通知渠道
    return getNotificationChannelById(id);
  } catch (error) {
    console.error(`更新通知渠道 ID: ${id} 失败:`, error);
    throw new Error('更新通知渠道失败');
  }
}

// 辅助函数，检查NotificationChannel表是否已有defaultForNewMonitors列
async function checkDefaultColumnExists(): Promise<boolean> {
  try {
    const columns = await prisma.$queryRaw`PRAGMA table_info(NotificationChannel)`;
    // 类型安全的检查
    if (Array.isArray(columns)) {
      return columns.some((col) => typeof col === 'object' && col !== null && 'name' in col && col.name === 'defaultForNewMonitors');
    }
    return false;
  } catch (error) {
    console.error('检查列存在性失败:', error);
    return false;
  }
}

/**
 * 删除通知渠道
 */
export async function deleteNotificationChannel(id: string) {
  try {
    // 检查通知渠道是否存在
    const channel = await getNotificationChannelById(id);
    if (!channel) {
      throw new Error('通知渠道不存在');
    }
    
    // 执行删除
    await prisma.$executeRaw`
      DELETE FROM NotificationChannel 
      WHERE id = ${id}
    `;
    
    return true;
  } catch (error) {
    console.error(`删除通知渠道 ID: ${id} 失败:`, error);
    throw new Error('删除通知渠道失败');
  }
}

/**
 * 切换通知渠道的启用状态
 */
export async function toggleNotificationChannelEnabled(id: string) {
  try {
    // 先获取当前状态
    const channel = await getNotificationChannelById(id);
    if (!channel) {
      throw new Error(`找不到ID为 ${id} 的通知渠道`);
    }
    
    const newStatus = !channel.enabled;
    
    // 更新状态
    await prisma.$executeRaw`
      UPDATE NotificationChannel 
      SET enabled = ${newStatus}, updatedAt = ${new Date().toISOString()}
      WHERE id = ${id}
    `;
    
    return newStatus;
  } catch (error) {
    console.error(`切换通知渠道 ID: ${id} 的启用状态失败:`, error);
    throw new Error('切换通知渠道状态失败');
  }
}

/**
 * 切换通知渠道的默认状态
 */
export async function toggleNotificationChannelDefault(id: string) {
  try {
    // 先获取当前状态
    const channel = await getNotificationChannelById(id);
    if (!channel) {
      throw new Error(`找不到ID为 ${id} 的通知渠道`);
    }
    
    // 检查当前是否有defaultForNewMonitors字段，没有则添加
    const hasDefaultColumn = await checkDefaultColumnExists();
    
    if (!hasDefaultColumn) {
      // 添加defaultForNewMonitors列
      await prisma.$executeRaw`ALTER TABLE NotificationChannel ADD COLUMN defaultForNewMonitors BOOLEAN DEFAULT FALSE`;
    }
    
    // 更新状态 - 如果需要只允许一个默认通知，可以先将所有通知的默认状态设为false
    // 如果想要允许多个默认通知，则只需切换当前通知的状态
    
    // 单个默认通知的实现（取消注释下面的代码）:
    // await prisma.$executeRaw`
    //   UPDATE NotificationChannel 
    //   SET defaultForNewMonitors = FALSE, updatedAt = ${new Date().toISOString()}
    //   WHERE defaultForNewMonitors = TRUE
    // `;
    
    // 获取当前的defaultForNewMonitors状态，如果不存在则默认为false
    const currentDefault = !!channel.defaultForNewMonitors;
    const newStatus = !currentDefault;
    
    // 更新状态
    await prisma.$executeRaw`
      UPDATE NotificationChannel 
      SET defaultForNewMonitors = ${newStatus}, updatedAt = ${new Date().toISOString()}
      WHERE id = ${id}
    `;
    
    return newStatus;
  } catch (error) {
    console.error(`切换通知渠道 ID: ${id} 的默认状态失败:`, error);
    throw new Error('切换通知渠道默认状态失败');
  }
}

/**
 * 更新管理员密码
 */
export async function updateAdminPassword(userId: string, currentPassword: string, newPassword: string) {
  // 获取用户
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  
  if (!user) {
    throw new Error('用户不存在');
  }
  
  // 验证当前密码
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    throw new Error('当前密码不正确');
  }
  
  // 设置新密码
  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  return prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedNewPassword
    }
  });
} 