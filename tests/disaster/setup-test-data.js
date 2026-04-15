#!/usr/bin/env node
/**
 * Setup test data for LinkAI disaster recovery testing.
 *
 * Uses Prisma Client for all DB operations.
 * Does NOT modify project source code.
 *
 * Usage: cd /home/wu/projects/link-ai && node tests/disaster/setup-test-data.js
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(PROJECT_ROOT, ".env");
const DB_FILE = path.join(PROJECT_ROOT, "data", "app.db");

// ─── Crypto helpers (matching src/lib/crypto.ts) ───────────────────────────

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

function generateApiKey() {
  const bytes = crypto.randomBytes(24);
  return `lk-${bytes.toString("base64url").slice(0, 32)}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("LinkAI Disaster Recovery Test Data Setup");
  console.log("=".repeat(60));

  // 1. Ensure NEXTAUTH_SECRET
  console.log("\n[1/5] Checking NEXTAUTH_SECRET...");
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
    console.log(`  ✅ Generated new NEXTAUTH_SECRET in .env`);
  } else {
    console.log(`  ✅ NEXTAUTH_SECRET found (${NEXTAUTH_SECRET.slice(0, 8)}...)`);
  }
  process.env.NEXTAUTH_SECRET = NEXTAUTH_SECRET;

  // 2. Check DB exists
  console.log("\n[2/5] Checking database...");
  if (!fs.existsSync(DB_FILE)) {
    console.error(`  ❌ Database not found at ${DB_FILE}`);
    console.error("  Run 'npx prisma migrate deploy' first.");
    process.exit(1);
  }
  console.log(`  ✅ Database exists: ${DB_FILE}`);

  // 3. Init Prisma
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("  ✅ Prisma client connected");

  // 4. Create test users
  console.log("\n[3/5] Creating test users...");
  const bcrypt = require("bcryptjs");
  const adminPass = bcrypt.hashSync("testpass123", 10);
  const userPass = bcrypt.hashSync("testpass123", 10);

  const testAdmin = await prisma.user.upsert({
    where: { username: "testadmin" },
    update: {},
    create: { username: "testadmin", password: adminPass, isAdmin: true, status: "active" },
  });
  console.log(`  ✅ User: testadmin (id=${testAdmin.id}, admin=${testAdmin.isAdmin})`);

  const testUser = await prisma.user.upsert({
    where: { username: "testuser" },
    update: {},
    create: { username: "testuser", password: userPass, isAdmin: false, status: "active" },
  });
  console.log(`  ✅ User: testuser (id=${testUser.id}, admin=${testUser.isAdmin})`);

  // 5. Create mock providers + failover configs
  console.log("\n[4/5] Creating mock providers and failover configs...");

  const providerDefs = [
    { name: "Mock-Primary", code: "mock-primary", apiBaseUrl: "http://127.0.0.1:9999", apiKey: "mock-key-primary" },
    { name: "Mock-Secondary", code: "mock-secondary", apiBaseUrl: "http://127.0.0.1:9998", apiKey: "mock-key-secondary" },
  ];

  const failoverDefaults = {
    errorThresholdPercent: 50,
    errorWindowSeconds: 60,
    minRequestCount: 2,
    cooldownSeconds: 30,
    recoveryObserveSeconds: 60,
    healthCheckEnabled: true,
    healthCheckInterval: 60,
    healthCheckTimeout: 5,
  };

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
    console.log(`  ✅ Provider: ${pDef.name} → ${pDef.apiBaseUrl} (id=${provider.id})`);

    // Upsert failover config
    const fc = await prisma.failoverConfig.upsert({
      where: { providerId: provider.id },
      update: failoverDefaults,
      create: { providerId: provider.id, ...failoverDefaults },
    });
    console.log(`  ✅ FailoverConfig: threshold=${fc.errorThresholdPercent}% minReq=${fc.minRequestCount} cooldown=${fc.cooldownSeconds}s`);
  }

  // 6. Create token
  console.log("\n[5/5] Creating test token...");
  const apiKey = generateApiKey();
  const keyHash = hashToken(apiKey);
  const keyPrefix = apiKey.slice(0, 11); // "lk-" + 8 chars
  const keyEncrypted = encrypt(apiKey, NEXTAUTH_SECRET);

  const token = await prisma.token.upsert({
    where: { keyHash },
    update: {
      name: "test-disaster-token",
      keyPrefix,
      keyEncrypted,
      status: "active",
    },
    create: {
      userId: testUser.id,
      name: "test-disaster-token",
      keyPrefix,
      keyHash,
      keyEncrypted,
      status: "active",
    },
  });
  console.log(`  ✅ Token: ${token.name} (id=${token.id})`);

  // Clean and rebind providers
  await prisma.tokenProvider.deleteMany({ where: { tokenId: token.id } });

  await prisma.tokenProvider.create({
    data: { tokenId: token.id, providerId: providerMap["mock-primary"], priority: 1 },
  });
  console.log(`  ✅ Bound Mock-Primary (priority=1)`);

  await prisma.tokenProvider.create({
    data: { tokenId: token.id, providerId: providerMap["mock-secondary"], priority: 2 },
  });
  console.log(`  ✅ Bound Mock-Secondary (priority=2)`);

  await prisma.$disconnect();

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("✅ SETUP COMPLETE");
  console.log("=".repeat(60));
  console.log(`
🔑 Test Token API Key (save this!):
   ${apiKey}

📋 Test Users:
   Admin:  testadmin / testpass123
   User:   testuser  / testpass123

🔗 Providers:
   Primary:   Mock-Primary   → http://127.0.0.1:9999
   Secondary: Mock-Secondary → http://127.0.0.1:9998

⚙️  Failover Config (both providers):
   errorThresholdPercent: 50%
   errorWindowSeconds:    60s
   minRequestCount:       2
   cooldownSeconds:       30s
   recoveryObserveSeconds: 60s
   healthCheckEnabled:    true
   healthCheckInterval:   60s
   healthCheckTimeout:    10s
`);

  console.log("=".repeat(60));
  console.log("📖 USAGE GUIDE");
  console.log("=".repeat(60));
  console.log(`
1. Start mock providers (two terminals):

   Terminal 1 - Primary (normal):
     node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode normal

   Terminal 2 - Secondary (normal):
     node scripts/mock-provider.js --port 9998 --name "Mock-Secondary" --mode normal

2. Start LinkAI gateway:
     npm run dev

3. Test normal request:
   curl -X POST http://localhost:3000/v1/chat/completions \\
     -H "Authorization: Bearer ${apiKey}" \\
     -H "Content-Type: application/json" \\
     -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"hello"}]}'

4. Test disaster scenarios:

   a) Primary 500 errors → failover to Secondary:
      Kill Terminal 1, restart: node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode error
      Send 3+ requests → gateway should switch to Secondary

   b) Primary rate limited:
      node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode ratelimit

   c) Primary timeout:
      node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode timeout

   d) Primary partial SSE stream (add "stream": true to body):
      node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode partial

   e) Recovery:
      Switch Primary back to --mode normal
      Wait for cooldown (10s) + health check (10s)
      Gateway should detect recovery and route back

5. Check database state:
   sqlite3 data/app.db "SELECT id, name, code, healthStatus FROM Provider;"
   sqlite3 data/app.db "SELECT * FROM FailoverConfig;"
`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
