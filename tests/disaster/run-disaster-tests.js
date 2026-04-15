#!/usr/bin/env node
/**
 * LinkAI Disaster Recovery Automated Tests
 *
 * Runs 11 disaster recovery test scenarios against the LinkAI gateway.
 *
 * Prerequisites:
 *   - Node.js >= 18
 *   - sqlite3 CLI on PATH
 *   - Test data set up (run: node tests/disaster/setup-test-data.js)
 *
 * Usage:
 *   node tests/disaster/run-disaster-tests.js
 *   VERBOSE=1 node tests/disaster/run-disaster-tests.js  # show mock/gateway logs
 */

const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  primaryPort: 9999,
  secondaryPort: 9998,
  gatewayPort: 3002,
  token: "lk-JCZJpabkYymMz5JT2pFCQ_RcdIxWZnN3",
  dbPath: path.resolve(__dirname, "..", "..", "data", "app.db"),
  mockScript: path.resolve(__dirname, "mock-provider.js"),
  projectRoot: path.resolve(__dirname, "..", ".."),
  upstreamTimeout: 20000,
};

// ─── Process Management ──────────────────────────────────────────────────────

let processes = [];
let primaryProc = null;
let secondaryProc = null;

function startProcess(cmd, args, label, opts = {}) {
  const proc = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: CONFIG.projectRoot,
    env: { ...process.env, ...opts.env },
    detached: false,
  });

  const verbose = process.env.VERBOSE === "1";

  proc.stdout.on("data", (data) => {
    if (verbose) {
      data.toString().trim().split("\n").forEach((line) => {
        console.log(`[${label}] ${line}`);
      });
    }
  });

  proc.stderr.on("data", (data) => {
    if (verbose) {
      data.toString().trim().split("\n").forEach((line) => {
        console.log(`[${label}:ERR] ${line}`);
      });
    }
  });

  proc.on("error", (err) => {
    console.error(`[${label}] Process error: ${err.message}`);
  });

  processes.push(proc);
  return proc;
}

function killProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  try {
    proc.kill("SIGTERM");
    const p = proc;
    setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
    }, 3000);
  } catch {}
}

function killAll() {
  for (const proc of processes) {
    killProcess(proc);
  }
  setTimeout(() => {
    for (const proc of processes) {
      if (proc.exitCode === null) {
        try { proc.kill("SIGKILL"); } catch {}
      }
    }
    processes = [];
    primaryProc = null;
    secondaryProc = null;
  }, 3000);
}

// ─── Mock Control (via /_control endpoint) ───────────────────────────────────

async function setMockMode(port, mode) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ mode });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/_control",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.ok) resolve(parsed);
            else reject(new Error(`Mode switch failed: ${body}`));
          } catch {
            reject(new Error(`Invalid response: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.write(data);
    req.end();
  });
}

// ─── HTTP Request ────────────────────────────────────────────────────────────

function sendRequest({ stream = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: `disaster-test-${Date.now()}` }],
      stream,
    });

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeout}ms`));
    }, timeout);

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: CONFIG.gatewayPort,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(reqBody),
        },
      },
      (res) => {
        clearTimeout(timer);
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          if (stream) {
            resolve({ status: res.statusCode, headers: res.headers, body: raw, streamed: true });
          } else {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw), streamed: false });
            } catch {
              resolve({ status: res.statusCode, headers: res.headers, body: raw, streamed: false });
            }
          }
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.write(reqBody);
    req.end();
  });
}

// ─── Database Query ──────────────────────────────────────────────────────────

function queryDB(sql) {
  try {
    const result = execSync(`sqlite3 "${CONFIG.dbPath}" "${sql}"`, {
      encoding: "utf8",
      timeout: 5000,
      cwd: CONFIG.projectRoot,
    });
    return result.trim();
  } catch (err) {
    throw new Error(`DB query failed: ${err.message}`);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForReady(port, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(
          { hostname: "127.0.0.1", port, path: "/", timeout: 2000 },
          (res) => { res.resume(); resolve(res.statusCode); }
        );
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      });
      return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function resetMocksToNormal() {
  try { await setMockMode(CONFIG.primaryPort, "normal"); } catch {}
  try { await setMockMode(CONFIG.secondaryPort, "normal"); } catch {}
  await sleep(200);
}

function extractProviderName(body) {
  if (!body) return null;
  const content = body?.choices?.[0]?.message?.content || "";
  if (typeof content !== "string") return null;
  if (content.includes("Mock-Primary")) return "Primary";
  if (content.includes("Mock-Secondary")) return "Secondary";
  return null;
}

// ─── Test Tracking ───────────────────────────────────────────────────────────

const testResults = [];

function recordTest(index, name, passed, duration, detail = "") {
  const icon = passed ? "✅" : "❌";
  const time = (duration / 1000).toFixed(1);
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`[${index}/11] ${name}... ${icon} (${time}s)${suffix}`);
  testResults.push({ index, name, passed, duration, detail });
}

// ─── Test Scenarios ──────────────────────────────────────────────────────────

/**
 * 场景1: 正常请求走 Primary
 */
async function testNormal() {
  const start = Date.now();
  try {
    await resetMocksToNormal();
    const res = await sendRequest();
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider === "Primary";
    recordTest(1, "正常走 Primary", ok, Date.now() - start,
      ok ? "" : `status=${res.status} provider=${provider}`);
    return ok;
  } catch (e) {
    recordTest(1, "正常走 Primary", false, Date.now() - start, e.message);
    return false;
  }
}

/**
 * 场景2: Primary 返回 500 → 自动切到 Secondary
 */
async function testPrimaryError() {
  const start = Date.now();
  try {
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    const res = await sendRequest();
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider === "Secondary";
    recordTest(2, "Primary error 切 Secondary", ok, Date.now() - start,
      ok ? "" : `status=${res.status} provider=${provider}`);
    return ok;
  } catch (e) {
    recordTest(2, "Primary error 切 Secondary", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景3: Primary very-slow (45s) → 网关 20s 超时 → 切到 Secondary
 */
async function testPrimaryTimeout() {
  const start = Date.now();
  try {
    await setMockMode(CONFIG.primaryPort, "very-slow");
    await sleep(300);
    // Gateway upstream timeout is 20s; very-slow delays 45s → will timeout
    const res = await sendRequest({ timeout: 90000 });
    const elapsed = Date.now() - start;
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider === "Secondary" && elapsed < 25000;
    recordTest(3, "Primary timeout 切 Secondary", ok, elapsed,
      ok ? "" : `status=${res.status} provider=${provider} elapsed=${elapsed}ms`);
    return ok;
  } catch (e) {
    recordTest(3, "Primary timeout 切 Secondary", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景4: Primary 429 Rate Limit → 切到 Secondary
 */
async function testPrimaryRateLimit() {
  const start = Date.now();
  try {
    await setMockMode(CONFIG.primaryPort, "ratelimit");
    await sleep(300);
    const res = await sendRequest();
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider === "Secondary";
    recordTest(4, "Primary 429 切 Secondary", ok, Date.now() - start,
      ok ? "" : `status=${res.status} provider=${provider}`);
    return ok;
  } catch (e) {
    recordTest(4, "Primary 429 切 Secondary", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景5: Primary partial 模式 + stream:true → SSE 中断处理
 */
async function testStreamInterrupt() {
  const start = Date.now();
  try {
    await setMockMode(CONFIG.primaryPort, "partial");
    await sleep(300);
    const res = await sendRequest({ stream: true, timeout: 30000 });

    // Gateway 应优雅处理 partial stream:
    //  - buffer 阶段检测到中断 → failover 到 Secondary
    //  - 或返回已接收的部分数据
    const bodyStr = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
    const isGraceful = res.status === 200 || res.status === 502;
    const hasContent = bodyStr.length > 0;
    const hasStreamData = bodyStr.includes("data:") || bodyStr.includes("choices");
    const ok = isGraceful && hasContent && hasStreamData;

    recordTest(5, "Stream 中断处理", ok, Date.now() - start,
      ok ? "" : `status=${res.status} body_len=${bodyStr.length} has_data=${bodyStr.includes("data:")} has_choices=${bodyStr.includes("choices")}`);
    return ok;
  } catch (e) {
    recordTest(5, "Stream 中断处理", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景6: Primary + Secondary 都 error → 502
 */
async function testAllDown() {
  const start = Date.now();
  try {
    await setMockMode(CONFIG.primaryPort, "error");
    await setMockMode(CONFIG.secondaryPort, "error");
    await sleep(300);
    const res = await sendRequest();
    const ok = res.status === 502;
    recordTest(6, "全部宕机", ok, Date.now() - start,
      ok ? "" : `status=${res.status} (expected 502)`);
    return ok;
  } catch (e) {
    recordTest(6, "全部宕机", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景7: Primary 恢复 normal → 等熔断器冷却后请求重新走 Primary
 */
async function testPrimaryRecovery() {
  const start = Date.now();
  try {
    // Explicitly trigger circuit breaker: set primary error, send 3 requests (minRequestCount=2)
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    console.log("    发送请求触发熔断...");
    for (let i = 0; i < 3; i++) {
      try { await sendRequest({ timeout: 10000 }); } catch {}
    }
    // Switch primary back to normal before cooldown
    await setMockMode(CONFIG.primaryPort, "normal");
    // Wait for cooldown (30s) + buffer
    console.log("    等待熔断器冷却 (35s)...");
    await sleep(35000);
    // In half_open state, request should go to now-normal Primary and succeed
    const res = await sendRequest();
    const ok = res.status === 200;
    recordTest(7, "Primary 恢复", ok, Date.now() - start,
      ok ? "" : `status=${res.status}`);
    return ok;
  } catch (e) {
    recordTest(7, "Primary 恢复", false, Date.now() - start, e.message);
    return false;
  }
}

/**
 * 场景8: 熔断→等冷却→half_open 仍 error→回到 open
 *
 * 流程：
 *   1. 发够 minRequestCount(2) 次请求触发熔断
 *   2. 等 cooldown(30s) → 进入 half_open
 *   3. 发请求 (half_open，仍 error) → 回到 open
 *   4. 再发请求验证走了 Secondary 而非 Primary
 */
async function testHalfOpenRefail() {
  const start = Date.now();
  try {
    // Trigger circuit breaker
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    console.log("    发送请求触发熔断...");
    for (let i = 0; i < 3; i++) {
      try { await sendRequest({ timeout: 10000 }); } catch {}
    }
    // Wait for cooldown to enter half_open
    console.log("    等待熔断器冷却 (35s)...");
    await sleep(35000);
    // Primary still error → half_open probe fails → back to open → failover to secondary
    const res = await sendRequest({ timeout: 15000 });
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider !== "Primary";
    recordTest(8, "Half-open 再失败", ok, Date.now() - start,
      ok ? "" : `status=${res.status} provider=${provider}`);
    return ok;
  } catch (e) {
    recordTest(8, "Half-open 再失败", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景9: Anti-flap — 熔断→半开→成功又失败→进入防抖观察期
 *
 * 流程：
 *   1. 触发熔断 (primary error, 发3次)
 *   2. 等冷却进入 half_open
 *   3. 切 primary normal, 发1次 (half_open 成功开始恢复)
 *   4. 立刻切 primary error, 发多次
 *   5. 验证 anti-flap 观察期内 circuitState 保持 open
 */
async function testAntiFlap() {
  const start = Date.now();
  try {
    // Trigger circuit breaker
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    console.log("    发送请求触发熔断...");
    for (let i = 0; i < 3; i++) {
      try { await sendRequest({ timeout: 10000 }); } catch {}
    }
    // Wait for cooldown to enter half_open
    console.log("    等待熔断器冷却 (35s)...");
    await sleep(35000);
    // Switch primary to normal, send 1 request (half_open success starts recovery)
    await setMockMode(CONFIG.primaryPort, "normal");
    await sleep(300);
    try { await sendRequest({ timeout: 10000 }); } catch {}
    // Immediately switch to error, send multiple requests
    // half_open success then immediate failure → enters anti-flap observation
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      try { await sendRequest({ timeout: 10000 }); } catch {}
    }
    // Wait for async DB persistence
    await sleep(1000);
    // Verify anti-flap: circuitState should be open (observation prevents flipping)
    const sql =
      "SELECT FC.circuitState FROM FailoverConfig FC " +
      "JOIN Provider P ON FC.providerId = P.id " +
      "WHERE P.code = 'mock-primary'";
    const state = queryDB(sql);
    const ok = state === "open";
    recordTest(9, "Anti-flap 防抖动", ok, Date.now() - start,
      `circuitState=${state}${ok ? "" : " (expected open)"}`);
    return ok;
  } catch (e) {
    recordTest(9, "Anti-flap 防抖动", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景10: 熔断状态持久化 — 显式触发熔断后查 DB 验证 circuitState=open
 */
async function testPersistence() {
  const start = Date.now();
  try {
    // Explicitly trigger circuit breaker
    await setMockMode(CONFIG.primaryPort, "error");
    await sleep(300);
    console.log("    发送请求触发熔断...");
    for (let i = 0; i < 3; i++) {
      try { await sendRequest({ timeout: 10000 }); } catch {}
    }
    // Wait for async persistence
    await sleep(1000);

    const sql =
      "SELECT FC.circuitState FROM FailoverConfig FC " +
      "JOIN Provider P ON FC.providerId = P.id " +
      "WHERE P.code = 'mock-primary'";
    const state = queryDB(sql);

    const ok = state === "open";
    recordTest(10, "熔断状态持久化", ok, Date.now() - start,
      `circuitState=${state}${ok ? "" : " (expected open)"}`);
    return ok;
  } catch (e) {
    recordTest(10, "熔断状态持久化", false, Date.now() - start, e.message);
    return false;
  } finally {
    await resetMocksToNormal();
  }
}

/**
 * 场景11: 连接拒绝 — Primary 端口无服务 → 切到 Secondary
 */
async function testConnectionRefused() {
  const start = Date.now();
  try {
    // Kill Primary mock 模拟连接拒绝
    killProcess(primaryProc);
    // 等端口释放
    await sleep(2000);

    const res = await sendRequest({ timeout: 15000 });
    const provider = extractProviderName(res.body);
    const ok = res.status === 200 && provider !== "Primary";

    recordTest(11, "连接拒绝", ok, Date.now() - start,
      ok ? "" : `status=${res.status} provider=${provider}`);
    return ok;
  } catch (e) {
    recordTest(11, "连接拒绝", false, Date.now() - start, e.message);
    return false;
  } finally {
    // 重启 Primary mock
    primaryProc = startProcess(
      "node",
      [CONFIG.mockScript, "--port", String(CONFIG.primaryPort), "--name", "Mock-Primary", "--mode", "normal"],
      "mock-primary"
    );
    await sleep(1000);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== LinkAI 容灾自动化测试 ===\n");

  // 检查数据库
  if (!fs.existsSync(CONFIG.dbPath)) {
    console.error(`❌ Database not found: ${CONFIG.dbPath}`);
    console.error("   Run: node tests/disaster/setup-test-data.js");
    process.exit(1);
  }

  // 1. 启动 Mock Providers
  console.log("[启动] Mock Primary (port 9999)...");
  primaryProc = startProcess(
    "node",
    [CONFIG.mockScript, "--port", String(CONFIG.primaryPort), "--name", "Mock-Primary", "--mode", "normal"],
    "mock-primary"
  );

  console.log("[启动] Mock Secondary (port 9998)...");
  secondaryProc = startProcess(
    "node",
    [CONFIG.mockScript, "--port", String(CONFIG.secondaryPort), "--name", "Mock-Secondary", "--mode", "normal"],
    "mock-secondary"
  );

  // 2. 启动 LinkAI Gateway
  console.log("[启动] LinkAI Gateway (port 3002)...");
  startProcess(
    "npm",
    ["run", "dev", "--", "-p", String(CONFIG.gatewayPort)],
    "gateway",
    { env: { PROXY_UPSTREAM_TIMEOUT: String(CONFIG.upstreamTimeout), PROXY_STREAM_UPSTREAM_TIMEOUT: "10000" } }
  );

  // 3. 等待就绪
  console.log("\n[等待] 服务就绪...");

  const primaryReady = await waitForReady(CONFIG.primaryPort, 10000);
  const secondaryReady = await waitForReady(CONFIG.secondaryPort, 10000);
  const gatewayReady = await waitForReady(CONFIG.gatewayPort, 120000);

  if (!primaryReady) {
    console.error("❌ Mock Primary 未就绪");
    killAll();
    process.exit(1);
  }
  if (!secondaryReady) {
    console.error("❌ Mock Secondary 未就绪");
    killAll();
    process.exit(1);
  }
  if (!gatewayReady) {
    console.error("❌ Gateway 未就绪");
    killAll();
    process.exit(1);
  }

  console.log("✅ 所有服务就绪\n");

  // 4. 依次运行测试
  await testNormal();
  await testPrimaryError();
  await testPrimaryTimeout();
  await testPrimaryRateLimit();
  await testStreamInterrupt();
  await testAllDown();
  await testPrimaryRecovery();
  await testHalfOpenRefail();
  await testAntiFlap();
  await testPersistence();
  await testConnectionRefused();

  // 5. 汇总
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.filter((r) => !r.passed).length;

  console.log("\n=== 测试结果汇总 ===");
  console.log(`通过: ${passed}/${testResults.length}`);
  console.log(`失败: ${failed}/${testResults.length}`);

  // 6. 清理
  killAll();

  process.exit(failed > 0 ? 1 : 0);
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on("SIGINT", () => {
  console.log("\n[中断] 清理中...");
  killAll();
  process.exit(130);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  killAll();
  process.exit(1);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  killAll();
  process.exit(1);
});
