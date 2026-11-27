#!/usr/bin/env node
/**
 * e2e 种子脚本：向测试库写入管理员、mock 上游 Provider、访问令牌。
 *
 * 用法：node seed.mjs [--legacy]
 *   --legacy  额外插入一批带历史时间戳、无 ttftMs 的旧记录（验证分子分母配对）
 *
 * 环境变量：
 *   DATABASE_URL      测试库路径（file:...）
 *   MOCK_UPSTREAM_URL mock 上游地址（http://127.0.0.1:PORT）
 *
 * 输出固定测试凭据（幂等，重复执行更新而不报错）：
 *   管理员：e2eadmin / e2e-admin-pass
 *   令牌：  lk-e2e-test-token-0001
 */
import { createCipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) return Buffer.from(envKey, "hex");
  const secret = process.env.NEXTAUTH_SECRET ?? "fallback-secret-for-development";
  return scryptSync(secret, "link-ai-encryption-salt", 32);
}
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

const ADMIN_USERNAME = "e2eadmin";
const ADMIN_PASSWORD = "e2e-admin-pass";
const E2E_TOKEN = "lk-e2e-test-token-0001";

async function main() {
  const legacy = process.argv.includes("--legacy");
  const upstream = process.env.MOCK_UPSTREAM_URL;
  if (!upstream) throw new Error("MOCK_UPSTREAM_URL 未设置");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未设置");

  // 1. 管理员
  const password = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: { password, isAdmin: true, status: "active" },
    create: {
      username: ADMIN_USERNAME,
      name: "E2E Admin",
      password,
      isAdmin: true,
      status: "active",
    },
  });
  console.log(`[seed] 管理员: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} (id=${admin.id})`);

  // 2. Provider 指向 mock 上游
  const provider = await prisma.provider.upsert({
    where: { code: "e2e-mock" },
    update: { apiBaseUrl: upstream, status: "active", healthStatus: "unknown" },
    create: {
      name: "e2e-mock",
      code: "e2e-mock",
      protocolType: "openai",
      apiBaseUrl: upstream,
      apiKeyEncrypted: encrypt("sk-e2e-mock-key"),
      status: "active",
    },
  });
  console.log(`[seed] Provider: e2e-mock -> ${upstream} (id=${provider.id})`);

  // 3. 令牌
  const keyHash = hashToken(E2E_TOKEN);
  const token = await prisma.token.upsert({
    where: { keyHash },
    update: { status: "active", userId: admin.id },
    create: {
      userId: admin.id,
      name: "e2e-token",
      keyPrefix: E2E_TOKEN.slice(0, 8),
      keyHash,
      keyEncrypted: encrypt(E2E_TOKEN),
      status: "active",
    },
  });
  console.log(`[seed] 令牌: ${E2E_TOKEN} (id=${token.id})`);

  // 4. 可选：无 ttftMs 的旧记录（历史时间戳，含 completionTokens 分母数据）
  if (legacy) {
    const providerRef = await prisma.provider.findUnique({ where: { code: "e2e-mock" } });
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 20; i++) {
      // 覆盖最近 7 天，每天 2~3 条
      const createdAt = new Date(now - (i % 7) * 24 * 3600 * 1000 - (i % 5) * 3600 * 1000);
      rows.push({
        userId: admin.id,
        tokenId: token.id,
        providerId: providerRef.id,
        providerName: "e2e-mock",
        model: "mock-model",
        logType: "proxy",
        action: "chat",
        responseStatus: 200,
        responseTime: 800 + (i % 5) * 100,
        ttftMs: null, // 旧记录：无首字耗时
        promptTokens: 10 + (i % 3),
        completionTokens: 150 + (i % 10) * 10,
        totalTokens: 160 + (i % 10) * 10 + (i % 3),
        isStream: true,
        createdAt,
      });
    }
    await prisma.auditLog.deleteMany({ where: { providerName: "e2e-mock-legacy" } });
    await prisma.auditLog.createMany({ data: rows.map((r) => ({ ...r, providerName: "e2e-mock-legacy" })) });
    console.log(`[seed] 旧记录: 插入 ${rows.length} 条无 ttftMs 历史记录 (providerName=e2e-mock-legacy)`);
  }

  console.log("[seed] done");
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
