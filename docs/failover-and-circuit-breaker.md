# 容灾机制与请求链路

## 一、整体架构概览

```
客户端请求
    │
    ▼
┌─────────────────────────────────────┐
│  路由层 (route.ts)                   │
│  认证 → 限流 → 脱敏 → 判断流式/非流式  │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
 流式处理               非流式处理
(route.ts 内置循环)    (ProxyEngine.forwardWithFailover)
    │                     │
    └──────────┬──────────┘
               ▼
    ┌─────────────────────┐
    │  供应商列表 (按 priority 排序)  │
    │  Provider A → B → C          │
    └──────────┬────────────────────┘
               │
               ▼ 对每个供应商依次尝试
    ┌─────────────────────────────────────┐
    │  熔断器检查 → RPM/TPM 限流 → 配额检查 │
    │  → 转发请求 → 判定成功/失败            │
    └─────────────────────────────────────┘
               │
       成功 → 返回响应
       失败 → 尝试下一个供应商
       全部失败 → 返回 502
```

## 二、核心概念

### 2.1 供应商 (Provider)

每个供应商代表一个上游 API 服务（如 OpenAI、Anthropic、Azure 等），独立拥有：
- API 地址 (`apiBaseUrl`)
- 协议类型 (`protocolType`: openai / anthropic / azure / dashscope / custom)
- 熔断器状态
- 限流配置 (RPM / TPM)
- 配额配置
- 健康检查配置

### 2.2 令牌 (Token)

令牌通过 `tokenProviders` 关联多个供应商，每个关联有一个 `priority` 字段。容灾时按 `priority` 升序遍历。若令牌未绑定任何供应商，则 fallback 到所有 `status: active` 的供应商。

### 2.3 熔断器 (Circuit Breaker)

**每个供应商独立维护一个熔断器实例**，状态互不影响。存储在内存 `Map<providerId, CircuitData>` 中，状态变更时异步持久化到数据库 `FailoverConfig` 表。

#### 三种状态

```
         错误率达到阈值 / 健康检查失败
  closed ──────────────────────────────► open
    ▲                                      │
    │                              cooldownSeconds 后
    │                                      │
    │                    ┌─────────────────┘
    │                    ▼
    │               half_open  (探测状态，允许少量请求通过)
    │                    │
    │       ┌────────────┴────────────┐
    │       ▼                         ▼
    │   探测成功                    探测失败
    │  (等待 recoveryObserveSeconds   │
    │    后恢复 closed)               │
    └─────────────────── open ←───────┘
                       (并触发 anti-flap)
```

#### 配置参数 (FailoverConfig)

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `errorThresholdPercent` | 50 | 错误率阈值（百分比），超过此值触发熔断 |
| `errorWindowSeconds` | 60 | 统计窗口时间（秒） |
| `minRequestCount` | 2 | 最小请求数，低于此数量不触发熔断 |
| `cooldownSeconds` | 30 | open 状态冷却时间，过后进入 half_open |
| `recoveryObserveSeconds` | 300 | half_open 观察期，持续成功才恢复 closed |
| `healthCheckEnabled` | true | 是否启用主动健康检查 |
| `healthCheckTimeout` | 10 | 健康检查超时（秒） |

### 2.4 Anti-Flap 防抖机制

防止供应商在 open ↔ half_open 之间快速反复切换。

**触发条件**：当 half_open 状态下探测请求再次失败（`half_open → open`），自动进入 anti-flap 观察模式。

**效果**：观察期（默认 20 分钟）内，阻止 `open → half_open` 的状态转换，保持 open 状态不变。

**退出条件**：
- 观察期超时自动退出
- 健康检查成功恢复到 closed 时主动退出

源码位置：`src/lib/failover/anti-flap.ts`

## 三、请求链路详细流程

### 3.1 非流式请求

**入口**：`src/app/api/proxy/[...path]/route.ts` → 调用 `proxyEngine.forwardWithFailover()`

**源码**：`src/lib/proxy/engine.ts`

```
forwardWithFailover()
  │
  ├── getProvidersForToken()  // 按优先级获取供应商列表
  │
  ├── 如果只有 1 个供应商 → 直接请求（跳过熔断器检查，但仍记录成功/失败）
  │
  └── 如果有多个供应商 → 循环遍历：
        │
        ├── setupProviderConfig()          // 加载熔断器配置
        ├── circuitBreaker.isAvailable()   // 检查熔断器是否开启
        │   └── 如果 open → 跳过此供应商
        ├── rateLimiter.check() (RPM)      // 检查每分钟请求数限制
        ├── rateLimiter.check() (TPM)      // 检查每分钟 token 数限制
        ├── quotaEngine.checkQuota()       // 检查月度配额
        │
        ├── forwardToProvider()            // 实际转发请求
        │   ├── applyModelRedirect()       // 模型名称重定向
        │   └── adapter.forward()          // 按协议类型适配转发
        │
        ├── 成功 (2xx) → recordSuccess() → 返回响应
        └── 失败 → recordFailure() → 继续下一个供应商
```

### 3.2 流式请求 (Stream)

**入口**：`src/app/api/proxy/[...path]/route.ts`

流式请求**不走** `ProxyEngine`，在路由层直接实现容灾循环。流程与非流式类似，但有以下区别：

1. 直接在 route.ts 内循环遍历供应商列表
2. 使用 `fetch()` 直接请求上游，不走 adapter
3. 使用 `bufferUpstreamStream()` 缓冲初始数据以检测早期失败
4. 使用 `createStreamProxy()` 代理 SSE 流式响应
5. 成功返回流，失败 continue 到下一个供应商

### 3.3 Anthropic 协议请求

**入口**：`src/app/api/anthropic/[...path]/route.ts`

独立的路由处理，流式和非流式都有各自的容灾循环，逻辑与上述类似。

## 四、健康检查机制

**源码**：`src/lib/failover/health-check.ts`

### 4.1 探测方式

对供应商的 `/v1/models` 端点发送 GET 请求，判断 HTTP 响应是否 200。

### 4.2 探测间隔

由 `healthCheckInterval` 配置控制，对所有启用了 `healthCheckEnabled` 的供应商循环检查。

### 4.3 检查结果对熔断器的影响

| 当前熔断状态 | 健康检查成功 | 健康检查失败 |
|-------------|-------------|-------------|
| **closed** | 不变 | → open |
| **open** | → half_open（受 anti-flap 限制） | 不变 |
| **half_open** | 等待 recoveryObserveSeconds → closed | 不变 |

**重要**：
- 健康检查失败时，仅 `closed → open` 会触发（不重复打开已打开的熔断器）
- 健康检查成功恢复时，`half_open → closed` 需要经过 `recoveryObserveSeconds` 的观察期
- 健康检查恢复受 anti-flap 保护，观察期内不允许 `open → half_open`

### 4.4 连接测试 vs 健康检查

管理后台的"连接测试"（`src/app/api/admin/providers/[id]/test/route.ts`）也探测 `/v1/models`，但**完全绕过熔断器**。所以可能出现连接测试正常但实际请求被熔断器拦截的情况。

## 五、状态持久化与恢复

### 5.1 持久化

每次熔断器状态变更（`closed → open`、`open → half_open`、`half_open → closed`）时，异步写入 `FailoverConfig` 表的 `circuitState` 和 `circuitStateSince` 字段。持久化失败不影响主流程。

### 5.2 启动恢复

服务启动时，`setupProviderConfigs()` 从数据库读取所有供应商的 `FailoverConfig`，恢复非 closed 状态的熔断器（`src/lib/proxy/engine.ts:270`）。

## 六、审计日志

### 6.1 日志字段

| 字段 | 说明 |
|------|------|
| `providerId` | 最终处理请求的供应商 ID |
| `failover` | 是否发生了容灾切换 |
| `upstreamUrl` | 上游请求的完整 URL |
| `upstreamResponse` | 上游返回的响应内容（仅失败时记录） |
| `detail` | JSON 格式的错误详情 |

### 6.2 错误来源区分

- `isSystemError = true`：系统自身错误（熔断器开启、限流超限、配额超限），不会记录为 `upstreamResponse`
- 无标记：上游实际返回的错误，会记录为 `upstreamResponse`

### 6.3 容灾审计流程

单个请求可能在审计日志中产生多条记录（每个尝试过的供应商一条），最终还有一条汇总记录。流式请求会在"所有供应商失败"时生成一条汇总日志，包含 `failedProviderIds` 列表。

## 七、关键文件索引

| 文件 | 职责 |
|------|------|
| `src/lib/proxy/engine.ts` | 非流式请求容灾引擎 (ProxyEngine) |
| `src/app/api/proxy/[...path]/route.ts` | OpenAI 兼容路由（流式+非流式） |
| `src/app/api/anthropic/[...path]/route.ts` | Anthropic 原生路由 |
| `src/lib/failover/circuit-breaker.ts` | 熔断器核心逻辑 |
| `src/lib/failover/anti-flap.ts` | 防抖机制 |
| `src/lib/failover/health-check.ts` | 主动健康检查 |
| `src/lib/proxy/timeout.ts` | 超时计算 |
| `src/lib/proxy/adapter/*.ts` | 各协议适配器 |
| `src/lib/proxy/stream.ts` | 流式代理工具 |
| `src/app/api/admin/providers/[id]/test/route.ts` | 管理后台连接测试 |

## 八、常见问题排查

### Q: 审计日志显示 "circuit is open"，但供应商实际正常

**原因**：之前该供应商曾触发熔断（可能是健康检查探测 `/v1/models` 偶尔超时），状态被持久化到数据库。后续健康检查成功但未正确恢复。

**排查**：
1. 查看 `FailoverConfig` 表中该供应商的 `circuitState` 字段
2. 查看健康检查日志 `ProviderHealthLog` 表
3. 检查 anti-flap 是否处于观察期（重启后 anti-flap 状态丢失，但熔断器 open 状态被恢复）

### Q: 所有供应商都失败了

**排查步骤**：
1. 查看审计日志的 `detail` 字段，检查 `failedProviderIds` 列表
2. 如果 `upstreamResponse` 为空，说明是系统错误（熔断/限流/配额），不是上游问题
3. 检查 `FailoverConfig` 表所有供应商的 `circuitState`
4. 检查供应商的 RPM/TPM 限制是否设置过低

### Q: 连接测试正常但请求 502

**原因**：连接测试探测 `/v1/models`，绕过熔断器。实际请求走 `/chat/completions` 等端点，且受熔断器、限流、配额约束。

**排查**：关注 `upstreamResponse` 字段的内容，区分"上游真实返回"还是"系统错误"。
