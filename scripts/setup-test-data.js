#!/usr/bin/env node
/**
 * Setup test data for LinkAI disaster recovery testing.
 *
 * Usage: cd /home/wu/projects/link-ai && node scripts/setup-test-data.js
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");
const DB_FILE = path.join(PROJECT_ROOT, "data", "app.db");

function encrypt(plaintext, secret) {
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 16;
  const key = crypto.scryptSync(secret, "link-ai-encryption-salt", 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function main() {
  console.log("=".repeat(60));
  console.log("LinkAI Disaster Recovery Test Data Setup");
  console.log("=".repeat(60));

  // 1. Ensure NEXTAUTH_SECRET
  console.log("\n[1/4] Checking NEXTAUTH_SECRET...");
  let envContent = "";
  if (fs.existsSync(ENV_FILE)) {
    envContent = fs.readFileSync(ENV_FILE, "utf8");
  }
  const secretMatch = envContent.match(/^NEXTAUTH_SECRET=(.+)$/m);
  let NEXTAUTH_SECRET = secretMatch ? secretMatch[1].trim() : null;

  if (!NEXTAUTH_SECRET) {
    NEXTAUTH_SECRET = crypto.randomBytes(32).toString("hex");
    const line = `NEXTAUTH_SECRET=${NEXTAUTH_SECRET}`;
    if (envContent) {
      fs.writeFileSync(ENV_FILE, envContent.trimEnd() + "\n" + line + "\n");
    } else {
      fs.writeFileSync(ENV_FILE, line + "\n");
    }
    console.log(`  Generated new NEXTAUTH_SECRET`);
  } else {
    console.log(`  NEXTAUTH_SECRET found (${NEXTAUTH_SECRET.slice(0, 8)}...)`);
  }
  process.env.NEXTAUTH_SECRET = NEXTAUTH_SECRET;

  // 2. Check DB
  console.log("\n[2/4] Checking database...");
  if (!fs.existsSync(DB_FILE)) {
    console.error(`  Database not found at ${DB_FILE}`);
    process.exit(1);
  }
  console.log(`  Database OK: ${DB_FILE}`);

  // 3. Init Prisma
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.$connect();

  // 4. Setup providers + failover configs + token
  console.log("\n[3/4] Setting up mock providers and failover configs...");

  // Production-grade failover parameters
  const failoverDefaults = {
    errorThresholdPercent: 50,
    errorWindowSeconds: 60,
    minRequestCount: 5,        // production value
    cooldownSeconds: 30,       // production value
    recoveryObserveSeconds: 60, // shortened from 300 for testing
    healthCheckEnabled: false,  // disabled during testing
    healthCheckInterval: 60,   // production value
    healthCheckTimeout: 10,
  };

  const providerDefs = [
    { name: "Mock-Primary", code: "mock-primary", apiBaseUrl: "http://127.0.0.1:9999", apiKey: "mock-key-primary" },
    { name: "Mock-Secondary", code: "mock-secondary", apiBaseUrl: "http://127.0.0.1:9998", apiKey: "mock-key-secondary" },
  ];

  const providerMap = {};
  for (const pDef of providerDefs) {
    const encryptedKey = encrypt(pDef.apiKey, NEXTAUTH_SECRET);
    const provider = await prisma.provider.upsert({
      where: { code: pDef.code },
      update: {
        name: pDef.name,
        protocolType: "openai",
        apiBaseUrl: pDef.apiBaseUrl,
        apiKeyEncrypted: encryptedKey,
        status: "active",
        healthStatus: "unknown",
      },
      create: {
        name: pDef.name,
        code: pDef.code,
        protocolType: "openai",
        apiBaseUrl: pDef.apiBaseUrl,
        apiKeyEncrypted: encryptedKey,
        status: "active",
        healthStatus: "unknown",
      },
    });
    providerMap[pDef.code] = provider.id;

    // Reset circuit state to closed for clean test start
    const fc = await prisma.failoverConfig.upsert({
      where: { providerId: provider.id },
      update: {
        ...failoverDefaults,
        circuitState: "closed",
        circuitStateSince: null,
      },
      create: { providerId: provider.id, ...failoverDefaults },
    });
    console.log(`  ${pDef.name} → ${pDef.apiBaseUrl} (id=${provider.id})`);
    console.log(`    FC: minReq=${fc.minRequestCount} cooldown=${fc.cooldownSeconds}s recoveryObserve=${fc.recoveryObserveSeconds}s`);
  }

  console.log("\n[4/4] Creating test token...");
  const testApiKey = "lk-9RZlv4vPnS1WxSGTH13DrlEM5bUjvCno";
  const keyHash = hashToken(testApiKey);
  const keyPrefix = testApiKey.slice(0, 11);
  const keyEncrypted = encrypt(testApiKey, NEXTAUTH_SECRET);

  // Find or create test user
  const bcrypt = require("bcryptjs");
  const testUser = await prisma.user.upsert({
    where: { username: "testuser" },
    update: {},
    create: { username: "testuser", password: bcrypt.hashSync("testpass123", 10), isAdmin: false, status: "active" },
  });

  const token = await prisma.token.upsert({
    where: { keyHash },
    update: {
      name: "disaster-test-token",
      keyPrefix,
      keyEncrypted,
      status: "active",
      userId: testUser.id,
    },
    create: {
      userId: testUser.id,
      name: "disaster-test-token",
      keyPrefix,
      keyHash,
      keyEncrypted,
      status: "active",
    },
  });

  // Clean and rebind providers
  await prisma.tokenProvider.deleteMany({ where: { tokenId: token.id } });
  await prisma.tokenProvider.create({
    data: { tokenId: token.id, providerId: providerMap["mock-primary"], priority: 1 },
  });
  await prisma.tokenProvider.create({
    data: { tokenId: token.id, providerId: providerMap["mock-secondary"], priority: 2 },
  });

  // Reset audit logs for clean test
  const deleted = await prisma.auditLog.deleteMany({
    where: {
      tokenId: token.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  console.log(`  Token: ${testApiKey} (deleted ${deleted.count} recent audit logs)`);

  await prisma.$disconnect();

  console.log("\n" + "=".repeat(60));
  console.log("SETUP COMPLETE");
  console.log("=".repeat(60));
  console.log(`\n  API Key: ${testApiKey}`);
  console.log(`  Primary:   http://127.0.0.1:9999`);
  console.log(`  Secondary: http://127.0.0.1:9998`);
  console.log(`  Failover:  minReq=5 cooldown=30s recoveryObserve=60s healthCheck=60s\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
