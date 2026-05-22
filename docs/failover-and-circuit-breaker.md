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
        ┌─────────────────────────────────────┐
        │ 最后一个供应商（兜底）：             │
        │ 跳过熔断器/RPM/TPM/配额检查，        │
        │ 无论响应状态如何都直接返回给用户      │
        └─────────────────────────────────────┘
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

令牌通过 `tokenProviders` 关联多个供应商，每个关联有一个 `priority` 字段。容灾时按 `priority` 升序遍历。**最后一个供应商作为兜底**，跳过熔断器、RPM/TPM 限流和配额检查，直接转发请求并将上游响应（无论 HTTP 状态码）返回给用户。若令牌未绑定任何供应商，则 fallback 到所有 `status: active` 的供应商（同样以最后一个为兜底）。当只有一个供应商时，该供应商即为兜底，直接跳过熔断器等检查。

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

### 2.5 兜底机制 (Last Resort)

当有多个供应商时，**最后一个供应商（priority 最高/排在最后的）自动成为兜底供应商**。

**行为**：
- 跳过熔断器检查（即使熔断器 open 也照常发送请求）
- 跳过 RPM/TPM 限流检查
- 跳过配额检查
- 无论上游返回什么 HTTP 状态码（包括 4xx、5xx），都将上游的实际响应返回给用户
- 仍然会记录成功/失败用于可观测性

**设计意图**：即使所有常规检查都失败，也尽量给用户一个真实的上游响应，而不是统一的 502 错误。当只有一个供应商时，该供应商天然就是兜底。

**注意**：如果兜底供应商请求本身抛出异常（如网络超时），由于无法获得上游响应，仍会返回 502。

## 三、请求链路详细流程

### 3.1 非流式请求

**入口**：`src/app/api/proxy/[...path]/route.ts` → 调用 `proxyEngine.forwardWithFailover()`

**源码**：`src/lib/proxy/engine.ts`

```
forwardWithFailover()
  │
  ├── getProvidersForToken()  // 按优先级获取供应商列表
  │
  ├── 如果只有 1 个供应商 → 直接请求（跳过熔断器检查，作为兜底）
  │
  └── 如果有多个供应商 → 循环遍历：
        │
        ├── 最后一个供应商为兜底（isLastResort）
        │
        ├── setupProviderConfig()          // 加载熔断器配置
        ├── [非兜底] circuitBreaker.isAvailable()   // 检查熔断器是否开启
        │   └── 如果 open → 跳过此供应商
        ├── [非兜底] rateLimiter.check() (RPM)      // 检查每分钟请求数限制
        ├── [非兜底] rateLimiter.check() (TPM)      // 检查每分钟 token 数限制
        ├── [非兜底] quotaEngine.checkQuota()       // 检查月度配额
        │
        ├── forwardToProvider()            // 实际转发请求
        │   ├── applyModelRedirect()       // 模型名称重定向
        │   └── adapter.forward()          // 按协议类型适配转发
        │
        ├── 成功 (2xx) → recordSuccess() → 返回响应
        ├── [非兜底] 失败 → recordFailure() → 继续下一个供应商
        └── [兜底] 失败 → recordFailure() → 将上游响应直接返回给用户
```

### 3.2 流式请求 (Stream)

**入口**：`src/app/api/proxy/[...path]/route.ts`

流式请求**不走** `ProxyEngine`，在路由层直接实现容灾循环。流程与非流式类似，但有以下区别：

1. 直接在 route.ts 内循环遍历供应商列表
2. 使用 `fetch()` 直接请求上游，不走 adapter
3. 使用 `bufferUpstreamStream()` 缓冲初始数据以检测早期失败
4. 使用 `createStreamProxy()` 代理 SSE 流式响应
5. 成功返回流，失败 continue 到下一个供应商
6. **最后一个供应商作为兜底**：跳过熔断器/RPM/TPM/配额检查，将上游实际响应返回给用户

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
| `providerId` | 处理该请求的供应商 ID（失败时为导致失败的供应商） |
| `failover` | 是否发生了容灾切换 |
| `upstreamUrl` | 上游请求的完整 URL |
| `upstreamResponse` | 上游返回的响应内容（仅失败时记录） |
| `detail` | JSON 格式的错误详情（关键排查字段） |

### 6.2 错误来源区分

- `isSystemError = true`：系统自身错误（熔断器开启、限流超限、配额超限），不会记录为 `upstreamResponse`
- 无标记：上游实际返回的错误，会记录为 `upstreamResponse`

### 6.3 容灾审计流程

当请求需要容灾（多个供应商依次尝试）且最终失败时，审计日志会产生以下记录：

**每供应商失败记录**（`responseStatus: 502`）：每个尝试过但失败的供应商各一条，`detail` 中包含失败原因：
- `circuit_open` — 被熔断器跳过
- `rpm_limit` / `tpm_limit` / `quota_exceeded` — 被限流/配额跳过
- `http_xxx` — 上游返回非 2xx（附带 `upstreamResponse`）
- `exception: xxx` — 请求异常（超时、网络错误等，附带具体错误信息和 cause）
- `stream_buffer_failed` — 流式缓冲阶段上游断开

**汇总记录**（`responseStatus: 502`）：一条总结记录，`detail` 包含：
```json
{
  "reason": "All providers failed",
  "providerCount": 3,
  "failedProviderIds": ["id_A", "id_B", "id_C"],
  "failedProviderReasons": {
    "id_A": "exception: Upstream stream request failed: timeout",
    "id_B": "exception: Upstream stream request failed: timeout",
    "id_C": "exception: Upstream stream request failed: timeout"
  }
}
```

通过 `failedProviderReasons` 可以直接看到每个供应商的具体失败原因，无需查数据库。

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
1. 在管理后台"审计日志"页面找到 502 记录，点击"查看"
2. 在"详细信息"中查看 `failedProviderReasons`，确认每个供应商的具体失败原因
3. 如果所有供应商都显示 `exception: ... timeout`，可能是前面的供应商超时消耗了太多时间，导致后面的供应商也无法在超时窗口内完成请求（流式默认超时 10 秒/供应商）
4. 如果显示 `circuit_open`，说明熔断器被打开，参考上一条 FAQ
5. 如果 `upstreamResponse` 为空，说明是系统错误（熔断/限流/配额），不是上游问题

### Q: 连接测试正常但请求 502

**原因**：连接测试探测 `/v1/models`，绕过熔断器。实际请求走 `/chat/completions` 等端点，且受熔断器、限流、配额约束。

**排查**：关注 `upstreamResponse` 字段的内容，区分"上游真实返回"还是"系统错误"。
