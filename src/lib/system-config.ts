import { prisma } from './prisma';

// 系统配置键名常量
export const CONFIG_KEYS = {
  REGISTRATION_ENABLED: 'registration_enabled',
  AUDIT_LOG_FULL_BODY: 'audit_log_full_body',
};

// 获取系统配置值
export async function getSystemConfig(key: string): Promise<string | null> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key },
    });
    
    return config?.value || null;
  } catch (error) {
    console.error(`获取系统配置${key}失败:`, error);
    return null;
  }
}

// 设置系统配置值
export async function setSystemConfig(key: string, value: string): Promise<void> {
  try {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedAt: new Date() },
      create: { key, value },
    });
    console.log(`系统配置${key}更新成功`);
  } catch (error) {
    console.error(`设置系统配置${key}失败:`, error);
    throw new Error(`无法保存系统配置: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 获取JWT密钥
export function getJwtSecret(): string {
  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret) {
    throw new Error('未设置必要的NEXTAUTH_SECRET环境变量，请配置此环境变量后重启应用');
  }
  return envSecret;
}

// 检查注册功能是否启用
export async function isRegistrationEnabled(): Promise<boolean> {
  const value = await getSystemConfig(CONFIG_KEYS.REGISTRATION_ENABLED);
  return value !== 'false';
}

export async function isAuditLogFullBodyEnabled(): Promise<boolean> {
  const value = await getSystemConfig(CONFIG_KEYS.AUDIT_LOG_FULL_BODY);
  return value === 'true';
}

// 设置注册功能状态
export async function setRegistrationEnabled(enabled: boolean): Promise<void> {
  await setSystemConfig(CONFIG_KEYS.REGISTRATION_ENABLED, enabled ? 'true' : 'false');
}

// 系统初始化后禁用注册功能
export async function disableRegistrationAfterInit(): Promise<void> {
  const hasAdmin = await prisma.user.count({
    where: { isAdmin: true }
  });
  
  // 检查是否已经有管理员用户，如果有，则禁用注册
  if (hasAdmin > 0) {
    console.log('系统已初始化（存在管理员用户），禁用注册功能');
    await setRegistrationEnabled(false);
  } else {
    console.log('系统未初始化（不存在管理员用户），保持注册功能开启');
    await setRegistrationEnabled(true);
  }
} 