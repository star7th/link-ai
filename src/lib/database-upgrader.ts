import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// 数据库版本定义
const DB_VERSIONS = [
  {
    version: 1,
    name: '初始数据库结构',
    requiredTables: ['User', 'Session'],
    check: async () => {
      return await hasTable('User') && await hasTable('Session');
    }
  },
  {
    version: 2,
    name: '系统配置表',
    requiredTables: ['SystemConfig'],
    check: async () => {
      return await hasTable('SystemConfig');
    },
    upgrade: async () => {
      if (!(await hasTable('SystemConfig'))) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "SystemConfig" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "key" TEXT NOT NULL,
            "value" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
          );
          CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");
        `);

        // 插入默认配置
        const configs = [
          { key: 'timezone', value: 'Asia/Shanghai' },
          { key: 'data_retention_days', value: '30' }
        ];

        for (const config of configs) {
          await prisma.systemConfig.create({
            data: {
              ...config,
            }
          });
        }
      }
    }
  },
  {
    version: 3,
    name: '用户表更新',
    check: async () => {
      return await hasColumn('User', 'username') && 
             !await isColumnRequired('User', 'email');
    },
    upgrade: async () => {
      // 检查username列是否存在
      if (!await hasColumn('User', 'username')) {
        // 添加username列
        await prisma.$executeRawUnsafe(`
          PRAGMA defer_foreign_keys=ON;
          PRAGMA foreign_keys=OFF;
          CREATE TABLE "new_User" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "username" TEXT NOT NULL,
            "name" TEXT,
            "email" TEXT,
            "password" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            "isAdmin" BOOLEAN NOT NULL DEFAULT false
          );
          INSERT INTO "new_User" ("createdAt", "email", "id", "isAdmin", "name", "password", "updatedAt") 
          SELECT "createdAt", "email", "id", "isAdmin", "name", "password", "updatedAt" FROM "User";

          -- 如果User表存在，更新username为name的值或email的值
          UPDATE "new_User" SET "username" = COALESCE("name", "email") WHERE "username" IS NULL;
          
          DROP TABLE "User";
          ALTER TABLE "new_User" RENAME TO "User";
          CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
          PRAGMA foreign_keys=ON;
          PRAGMA defer_foreign_keys=OFF;
        `);
      } else if (await isColumnRequired('User', 'email')) {
        // 如果email是必需的，修改为可选
        await prisma.$executeRawUnsafe(`
          PRAGMA defer_foreign_keys=ON;
          PRAGMA foreign_keys=OFF;
          CREATE TABLE "new_User" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "username" TEXT NOT NULL,
            "name" TEXT,
            "email" TEXT,
            "password" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            "isAdmin" BOOLEAN NOT NULL DEFAULT false
          );
          INSERT INTO "new_User" ("createdAt", "email", "id", "isAdmin", "name", "password", "updatedAt", "username") 
          SELECT "createdAt", "email", "id", "isAdmin", "name", "password", "updatedAt", "username" FROM "User";
          DROP TABLE "User";
          ALTER TABLE "new_User" RENAME TO "User";
          CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
          PRAGMA foreign_keys=ON;
          PRAGMA defer_foreign_keys=OFF;
        `);
      }
    }
  },
  {
    version: 4, 
    name: '用户登录记录表',
    requiredTables: ['LoginRecord'],
    check: async () => {
      return await hasTable('LoginRecord');
    },
    upgrade: async () => {
      if (!await hasTable('LoginRecord')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "LoginRecord" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "ipAddress" TEXT,
            "userAgent" TEXT,
            "success" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "LoginRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          
          CREATE INDEX "LoginRecord_userId_createdAt_idx" ON "LoginRecord"("userId", "createdAt");
        `);
      }
    }
  },
  {
    version: 5,
    name: '用户表扩展字段',
    check: async () => {
      return await hasColumn('User', 'status');
    },
    upgrade: async () => {
      if (!await hasColumn('User', 'status')) {
        await prisma.$executeRawUnsafe(`
          PRAGMA defer_foreign_keys=ON;
          PRAGMA foreign_keys=OFF;
          CREATE TABLE "new_User" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "username" TEXT NOT NULL,
            "name" TEXT,
            "email" TEXT,
            "password" TEXT NOT NULL,
            "isAdmin" BOOLEAN NOT NULL DEFAULT false,
            "status" TEXT NOT NULL DEFAULT 'active',
            "quotaTokenLimit" INTEGER,
            "quotaRequestLimit" INTEGER,
            "quotaPeriod" TEXT NOT NULL DEFAULT 'monthly',
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
          );
          INSERT INTO "new_User" ("id", "username", "name", "email", "password", "isAdmin", "createdAt", "updatedAt")
          SELECT "id", "username", "name", "email", "password", "isAdmin", "createdAt", "updatedAt" FROM "User";
          DROP TABLE "User";
          ALTER TABLE "new_User" RENAME TO "User";
          CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
          CREATE INDEX "User_status_idx" ON "User"("status");
          CREATE INDEX "User_isAdmin_idx" ON "User"("isAdmin");
          PRAGMA foreign_keys=ON;
          PRAGMA defer_foreign_keys=OFF;
        `);
      }
    }
  },
  {
    version: 6,
    name: '提供商相关表',
    check: async () => {
      return await hasTable('Provider');
    },
    upgrade: async () => {
      if (!await hasTable('Provider')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "Provider" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "code" TEXT NOT NULL,
            "protocolType" TEXT NOT NULL,
            "apiBaseUrl" TEXT NOT NULL,
            "apiKeyEncrypted" TEXT NOT NULL,
            "defaultModels" TEXT,
            "status" TEXT NOT NULL DEFAULT 'active',
            "totalRpmLimit" INTEGER,
            "totalTpmLimit" INTEGER,
            "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
            "lastHealthCheck" DATETIME,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
          );
          CREATE UNIQUE INDEX "Provider_name_key" ON "Provider"("name");
          CREATE UNIQUE INDEX "Provider_code_key" ON "Provider"("code");
          CREATE INDEX "Provider_status_idx" ON "Provider"("status");
          CREATE INDEX "Provider_healthStatus_idx" ON "Provider"("healthStatus");
        `);
      }
      if (!await hasTable('ProviderHealthLog')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "ProviderHealthLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "providerId" TEXT NOT NULL,
            "checkType" TEXT NOT NULL,
            "status" TEXT NOT NULL,
            "latency" INTEGER,
            "errorMessage" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ProviderHealthLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE INDEX "ProviderHealthLog_providerId_createdAt_idx" ON "ProviderHealthLog"("providerId", "createdAt");
        `);
      }
      if (!await hasTable('FailoverConfig')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "FailoverConfig" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "providerId" TEXT NOT NULL,
            "errorThresholdPercent" INTEGER NOT NULL DEFAULT 50,
            "errorWindowSeconds" INTEGER NOT NULL DEFAULT 60,
            "minRequestCount" INTEGER NOT NULL DEFAULT 5,
            "cooldownSeconds" INTEGER NOT NULL DEFAULT 30,
            "recoveryObserveSeconds" INTEGER NOT NULL DEFAULT 300,
            "healthCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
            "healthCheckInterval" INTEGER NOT NULL DEFAULT 60,
            "healthCheckTimeout" INTEGER NOT NULL DEFAULT 10,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            CONSTRAINT "FailoverConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "FailoverConfig_providerId_key" ON "FailoverConfig"("providerId");
        `);
      }
    }
  },
  {
    version: 7,
    name: '令牌相关表',
    check: async () => {
      return await hasTable('Token');
    },
    upgrade: async () => {
      if (!await hasTable('Token')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "Token" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "keyPrefix" TEXT NOT NULL,
            "keyHash" TEXT NOT NULL,
            "keyEncrypted" TEXT,
            "status" TEXT NOT NULL DEFAULT 'active',
            "rpmLimit" INTEGER,
            "tpmLimit" INTEGER,
            "ipRuleMode" TEXT NOT NULL DEFAULT 'allow_all',
            "quotaTokenLimit" INTEGER,
            "quotaRequestLimit" INTEGER,
            "quotaPeriod" TEXT NOT NULL DEFAULT 'monthly',
            "lastUsedAt" DATETIME,
            "expiresAt" DATETIME,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "Token_keyHash_key" ON "Token"("keyHash");
          CREATE INDEX "Token_userId_status_idx" ON "Token"("userId", "status");
        `);
      }
      if (!await hasTable('TokenProvider')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "TokenProvider" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "tokenId" TEXT NOT NULL,
            "providerId" TEXT NOT NULL,
            "priority" INTEGER NOT NULL DEFAULT 1,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "TokenProvider_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "TokenProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "TokenProvider_tokenId_providerId_key" ON "TokenProvider"("tokenId", "providerId");
          CREATE INDEX "TokenProvider_tokenId_priority_idx" ON "TokenProvider"("tokenId", "priority");
        `);
      }
      if (!await hasTable('TokenIpRule')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "TokenIpRule" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "tokenId" TEXT NOT NULL,
            "ruleType" TEXT NOT NULL,
            "ipCidr" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "TokenIpRule_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE INDEX "TokenIpRule_tokenId_idx" ON "TokenIpRule"("tokenId");
        `);
      }
      if (!await hasTable('UserProvider')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "UserProvider" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "providerId" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "UserProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "UserProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "UserProvider_userId_providerId_key" ON "UserProvider"("userId", "providerId");
        `);
      }
    }
  },
  {
    version: 8,
    name: '脱敏规则表',
    check: async () => {
      return await hasTable('DesensitizeRule');
    },
    upgrade: async () => {
      if (!await hasTable('DesensitizeRule')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "DesensitizeRule" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT,
            "tokenId" TEXT,
            "name" TEXT NOT NULL,
            "scope" TEXT NOT NULL DEFAULT 'global',
            "ruleType" TEXT NOT NULL,
            "pattern" TEXT NOT NULL,
            "replacement" TEXT,
            "action" TEXT NOT NULL DEFAULT 'replace',
            "isEnabled" BOOLEAN NOT NULL DEFAULT true,
            "priority" INTEGER NOT NULL DEFAULT 0,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            CONSTRAINT "DesensitizeRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE INDEX "DesensitizeRule_userId_scope_idx" ON "DesensitizeRule"("userId", "scope");
          CREATE INDEX "DesensitizeRule_scope_isEnabled_idx" ON "DesensitizeRule"("scope", "isEnabled");
        `);
      }
      if (!await hasTable('TokenDesensitizeRule')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "TokenDesensitizeRule" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "tokenId" TEXT NOT NULL,
            "ruleId" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "TokenDesensitizeRule_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "TokenDesensitizeRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DesensitizeRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "TokenDesensitizeRule_tokenId_ruleId_key" ON "TokenDesensitizeRule"("tokenId", "ruleId");
        `);
      }
    }
  },
  {
    version: 9,
    name: '审计日志表',
    check: async () => {
      return await hasTable('AuditLog');
    },
    upgrade: async () => {
      if (!await hasTable('AuditLog')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "AuditLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT,
            "tokenId" TEXT,
            "providerId" TEXT,
            "providerName" TEXT,
            "logType" TEXT NOT NULL,
            "action" TEXT NOT NULL,
            "requestMethod" TEXT,
            "requestBodyHash" TEXT,
            "responseStatus" INTEGER,
            "responseTime" INTEGER,
            "promptTokens" INTEGER,
            "completionTokens" INTEGER,
            "totalTokens" INTEGER,
            "isStream" BOOLEAN NOT NULL DEFAULT false,
            "failover" BOOLEAN NOT NULL DEFAULT false,
            "originalProviderId" TEXT,
            "ipAddress" TEXT,
            "userAgent" TEXT,
            "detail" TEXT,
            "requestBody" TEXT,
            "responseBody" TEXT,
            "contentHash" TEXT,
            "previousHash" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT "AuditLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT "AuditLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
          );
          CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
          CREATE INDEX "AuditLog_tokenId_createdAt_idx" ON "AuditLog"("tokenId", "createdAt");
          CREATE INDEX "AuditLog_logType_createdAt_idx" ON "AuditLog"("logType", "createdAt");
          CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
        `);
      }
    }
  },
  {
    version: 10,
    name: '用户组相关表',
    check: async () => {
      return await hasTable('UserGroup');
    },
    upgrade: async () => {
      if (!await hasTable('UserGroup')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "UserGroup" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "description" TEXT,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
          );
          CREATE UNIQUE INDEX "UserGroup_name_key" ON "UserGroup"("name");
        `);
      }
      if (!await hasTable('UserGroupMember')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "UserGroupMember" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "groupId" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "role" TEXT NOT NULL DEFAULT 'member',
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "UserGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "UserGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "UserGroupMember_groupId_userId_key" ON "UserGroupMember"("groupId", "userId");
        `);
      }
      if (!await hasTable('UserGroupProvider')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "UserGroupProvider" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "groupId" TEXT NOT NULL,
            "providerId" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "UserGroupProvider_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT "UserGroupProvider_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "UserGroupProvider_groupId_providerId_key" ON "UserGroupProvider"("groupId", "providerId");
        `);
      }
      if (!await hasTable('UserGroupQuota')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "UserGroupQuota" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "groupId" TEXT NOT NULL,
            "quotaType" TEXT NOT NULL,
            "quotaLimit" INTEGER NOT NULL,
            "quotaPeriod" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            CONSTRAINT "UserGroupQuota_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "UserGroupQuota_groupId_quotaType_quotaPeriod_key" ON "UserGroupQuota"("groupId", "quotaType", "quotaPeriod");
        `);
      }
    }
  },
  {
    version: 11,
    name: '告警相关表',
    check: async () => {
      return await hasTable('AlertRule');
    },
    upgrade: async () => {
      if (!await hasTable('AlertRule')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "AlertRule" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "triggerCondition" TEXT NOT NULL,
            "threshold" INTEGER,
            "cooldown" INTEGER NOT NULL DEFAULT 300,
            "channels" TEXT NOT NULL,
            "recipientAdmins" BOOLEAN NOT NULL DEFAULT true,
            "recipientUsers" BOOLEAN NOT NULL DEFAULT false,
            "messageTemplate" TEXT,
            "isEnabled" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL
          );
        `);
      }
      if (!await hasTable('AlertLog')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "AlertLog" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "ruleId" TEXT NOT NULL,
            "level" TEXT NOT NULL,
            "title" TEXT NOT NULL,
            "message" TEXT NOT NULL,
            "recipients" TEXT,
            "status" TEXT NOT NULL DEFAULT 'sent',
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "AlertLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE INDEX "AlertLog_ruleId_createdAt_idx" ON "AlertLog"("ruleId", "createdAt");
          CREATE INDEX "AlertLog_createdAt_idx" ON "AlertLog"("createdAt");
        `);
      }
    }
  },
  {
    version: 12,
    name: '配额快照表',
    check: async () => {
      return await hasTable('QuotaSnapshot');
    },
    upgrade: async () => {
      if (!await hasTable('QuotaSnapshot')) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE "QuotaSnapshot" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "type" TEXT NOT NULL,
            "refId" TEXT NOT NULL,
            "period" TEXT NOT NULL,
            "usedTokens" INTEGER NOT NULL DEFAULT 0,
            "usedRequests" INTEGER NOT NULL DEFAULT 0,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            CONSTRAINT "QuotaSnapshot_refId_fkey" FOREIGN KEY ("refId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
          );
          CREATE UNIQUE INDEX "QuotaSnapshot_type_refId_period_key" ON "QuotaSnapshot"("type", "refId", "period");
          CREATE INDEX "QuotaSnapshot_type_period_idx" ON "QuotaSnapshot"("type", "period");
          CREATE INDEX "QuotaSnapshot_refId_idx" ON "QuotaSnapshot"("refId");
        `);
      }
    }
  }
];

// 获取数据库当前版本
export async function getCurrentDbVersion(): Promise<number> {
  try {
    const config = await prisma.systemConfig.findFirst({
      where: { key: 'db_version' }
    });
    if (config) {
      return parseInt(config.value, 10);
    }
    return 0;
  } catch (error) {
    console.error('获取数据库版本失败', error);
    return 0;
  }
}

// 设置数据库版本
export async function setDbVersion(version: number): Promise<void> {
  try {
    const exists = await prisma.systemConfig.findFirst({
      where: { key: 'db_version' }
    });
    
    if (exists) {
      await prisma.systemConfig.update({
        where: { key: 'db_version' },
        data: { value: String(version) }
      });
    } else {
      await prisma.systemConfig.create({
        data: {
          key: 'db_version',
          value: String(version)
        }
      });
    }
  } catch (error) {
    console.error('设置数据库版本失败', error);
    throw error;
  }
}

// 检查表是否存在
async function hasTable(tableName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, 
      tableName
    );
    return result.length > 0;
  } catch (error) {
    console.error(`检查表 ${tableName} 失败`, error);
    return false;
  }
}

// 检查列是否存在
async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRawUnsafe<any[]>(
      `PRAGMA table_info(${tableName})`
    );
    return result.some(col => col.name === columnName);
  } catch (error) {
    console.error(`检查列 ${tableName}.${columnName} 失败`, error);
    return false;
  }
}

// 检查列是否为必填项
async function isColumnRequired(tableName: string, columnName: string): Promise<boolean> {
  try {
    const result = await prisma.$queryRawUnsafe<any[]>(
      `PRAGMA table_info(${tableName})`
    );
    const column = result.find(col => col.name === columnName);
    return column ? column.notnull === 1 : false;
  } catch (error) {
    console.error(`检查列 ${tableName}.${columnName} 是否必填失败`, error);
    return false;
  }
}

// 备份数据库
export async function backupDatabase(): Promise<string | null> {
  try {
    const dbFile = path.join(process.cwd(), 'data', 'app.db');
    if (!fs.existsSync(dbFile)) {
      console.warn('数据库文件不存在，跳过备份');
      return null;
    }

    // 创建备份目录
    const backupDir = path.join(process.cwd(), 'data', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 创建备份文件
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `app-${timestamp}.db`);
    fs.copyFileSync(dbFile, backupFile);

    // 清理旧备份
    cleanupOldBackups(backupDir, 5);

    console.log(`数据库已备份至 ${backupFile}`);
    return backupFile;
  } catch (error) {
    console.error('备份数据库失败', error);
    return null;
  }
}

// 清理旧备份
function cleanupOldBackups(backupDir: string, keepCount: number): void {
  try {
    // 获取所有备份文件
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('app-') && file.endsWith('.db'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        time: fs.statSync(path.join(backupDir, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time); // 按时间降序排序

    // 删除多余的备份
    if (files.length > keepCount) {
      const toDelete = files.slice(keepCount);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        console.log(`已删除旧备份: ${file.name}`);
      }
    }
  } catch (error) {
    console.error('清理旧备份失败', error);
  }
}

// 升级数据库
export async function upgradeDatabaseIfNeeded(): Promise<boolean> {
  try {
    console.log('检查数据库升级...');
    
    // 检查是否强制升级
    const forceUpgradePath = path.join(process.cwd(), 'data', '.force-upgrade');
    const forceDbUpgradePath = path.join(process.cwd(), 'data', '.db-upgrade-needed');
    let forceUpgrade = false;

    if (fs.existsSync(forceUpgradePath)) {
      console.log('检测到强制升级标记');
      fs.unlinkSync(forceUpgradePath);
      forceUpgrade = true;
    }

    if (fs.existsSync(forceDbUpgradePath)) {
      console.log('检测到数据库升级标记');
      fs.unlinkSync(forceDbUpgradePath);
      forceUpgrade = true;
    }

    // 创建系统配置表和数据库版本记录
    const hasUserTable = await hasTable('User');
    const hasSystemConfigTable = await hasTable('SystemConfig');

    let currentVersion = 0;
    
    if (hasSystemConfigTable) {
      currentVersion = await getCurrentDbVersion();
    }

    // 如果没有表，初始化数据库
    if (!hasUserTable) {
      console.log('数据库为空，初始化数据库...');
      await backupDatabase();
      
      // 如果没有用户表，则通过Prisma初始化数据库
      console.log('使用Prisma初始化数据库...');
      try {
        // 使用Prisma推送schema，创建所有表和关系
        await prisma.$executeRawUnsafe(`PRAGMA foreign_keys=OFF;`);
        // 使用shell执行命令
        const { execSync } = require('child_process');
        try {
          execSync('npx prisma migrate deploy', { stdio: 'inherit' });
          console.log('Prisma迁移成功完成');
        } catch (execError) {
          console.error('执行Prisma迁移命令失败', execError);
          throw execError;
        }
        await prisma.$executeRawUnsafe(`PRAGMA foreign_keys=ON;`);
      } catch (migrateError) {
        console.error('Prisma迁移失败，尝试手动升级', migrateError);
        
        // 如果迁移失败，进行手动升级
        for (const version of DB_VERSIONS) {
          if (version.upgrade) {
            try {
              console.log(`执行版本 ${version.version} 升级...`);
              await version.upgrade();
            } catch (upgradeError) {
              console.error(`版本 ${version.version} 升级失败`, upgradeError);
              throw upgradeError;
            }
          }
        }
      }
      
      // 设置为最新版本
      const latestVersion = DB_VERSIONS[DB_VERSIONS.length - 1].version;
      await setDbVersion(latestVersion);
      console.log(`数据库初始化完成，版本设置为 ${latestVersion}`);
      return true;
    }

    // 如果需要升级
    if (currentVersion < DB_VERSIONS[DB_VERSIONS.length - 1].version || forceUpgrade) {
      console.log(`当前数据库版本 ${currentVersion}，最新版本 ${DB_VERSIONS[DB_VERSIONS.length - 1].version}`);
      await backupDatabase();
      
      // 逐个检查和升级
      for (const version of DB_VERSIONS) {
        if (version.version > currentVersion || forceUpgrade) {
          try {
            const needsUpgrade = forceUpgrade || !(await version.check());
            
            if (needsUpgrade && version.upgrade) {
              console.log(`升级到版本 ${version.version}: ${version.name}`);
              await version.upgrade();
              await setDbVersion(version.version);
              console.log(`已完成版本 ${version.version} 升级`);
            } else {
              console.log(`版本 ${version.version} 已是最新，无需升级`);
              await setDbVersion(version.version);
            }
          } catch (error) {
            console.error(`版本 ${version.version} 升级失败`, error);
            throw error;
          }
        }
      }
      
      return true;
    } else {
      console.log(`当前数据库版本 ${currentVersion} 已是最新，无需升级`);
      return false;
    }
  } catch (error) {
    console.error('数据库升级失败', error);
    throw error;
  }
}

// 重置数据库版本（仅用于测试）
export async function resetDbVersion(): Promise<void> {
  try {
    await setDbVersion(0);
    console.log('数据库版本已重置为 0');
  } catch (error) {
    console.error('重置数据库版本失败', error);
    throw error;
  }
} 