# 智链 AI 网关 - API 接口设计

## 一、接口设计规范

### 1.1 通用约定

| 项目 | 规范 |
|------|------|
| 基础路径 | `/api` |
| 认证方式 | NextAuth Session Cookie（管理/用户接口）+ Bearer Token（代理接口） |
| 请求格式 | JSON |
| 响应格式 | `{ "success": boolean, "data": any, "error": string? }` |
| 分页参数 | `?page=1&pageSize=20` |
| 时间格式 | ISO 8601（`2026-04-13T09:00:00.000Z`） |
| 列表排序 | `?sortBy=createdAt&sortOrder=desc` |

### 1.2 认证方式说明

**管理/用户接口**：通过 NextAuth.js Session 认证，请求需携带 Session Cookie。

**代理转发接口**：通过平台令牌认证，请求头 `Authorization: Bearer lk-xxxx`。

### 1.3 通用错误码

| HTTP 状态码 | 错误信息 | 说明 |
|-------------|----------|------|
| 400 | Bad Request | 参数校验失败 |
| 401 | Unauthorized | 未认证或令牌无效 |
| 403 | Forbidden | 无权限访问 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突（如用户名重复） |
| 429 | Too Many Requests | 触发限流或配额用尽 |
| 500 | Internal Server Error | 服务内部错误 |
| 503 | Service Unavailable | 所有上游提供商不可用 |

---

## 二、代理转发接口（核心）

### 2.1 代理转发

```
POST /v1/{path}
```

**说明**：代理所有 AI 模型调用请求到上游提供商，兼容 OpenAI API 格式。标准 OpenAI SDK 可直接将 `base_url` 设为网关地址使用。

**认证**：Bearer Token（平台令牌）

**请求头**：

```
Authorization: Bearer lk-xxxxxxxx
Content-Type: application/json
```

**路径映射**：

| 客户端请求 | 说明 |
|-----------|------|
| `/v1/chat/completions` | Chat 补全 |
| `/v1/completions` | 文本补全 |
| `/v1/embeddings` | 向量嵌入 |
| `/v1/models` | 模型列表 |
| `/v1/*` | 其他 `/v1/` 开头的路径透传 |

> **路径说明**：对外暴露标准 `/v1/*` 路径（通过 Next.js rewrites 映射到内部 `/api/proxy/v1/*`），兼容 OpenAI SDK 默认行为。内部路径 `/api/proxy/v1/*` 仍可使用。
>
> **安全限制**：仅代理 `/v1/` 路径前缀的请求，其他路径返回 400 错误，防止路径遍历等安全风险。

**请求体**：与 OpenAI API 格式完全一致（透传到上游提供商）

**成功响应**：与上游提供商返回格式一致（或转换为 OpenAI 格式）

**流式响应**：`Content-Type: text/event-stream`，SSE 格式逐 chunk 透传

**错误响应**：

```json
{
  "success": false,
  "error": {
    "type": "upstream_error",
    "message": "所有上游提供商不可用，请稍后重试",
    "code": "all_providers_failed"
  }
}
```

---

## 三、认证接口

### 3.1 用户登录

```
POST /api/auth/[...nextauth]
```

由 NextAuth.js 处理， Credentials Provider 模式。

### 3.2 用户注册

```
POST /api/auth/register
```

**请求体**：

```json
{
  "username": "string",
  "password": "string",
  "name": "string?",
  "email": "string?"
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "username": "admin",
    "isAdmin": true
  }
}
```

### 3.3 退出登录

```
POST /api/auth/signout
```

由 NextAuth.js 处理。

---

## 四、管理员接口

### 4.1 用户管理

#### 用户列表

```
GET /api/admin/users?page=1&pageSize=20&status=active&groupId=xxx&keyword=xxx
```

**响应**：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "clx...",
        "username": "user1",
        "name": "张三",
        "email": "user@example.com",
        "isAdmin": false,
        "status": "active",
        "groups": [{ "id": "clx...", "name": "研发组" }],
        "tokenCount": 3,
        "quotaUsage": { "usedTokens": 50000, "limitTokens": 100000 },
        "createdAt": "2026-04-01T00:00:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "pageSize": 20
  }
}
```

#### 创建用户

```
POST /api/admin/users
```

**请求体**：

```json
{
  "username": "string (required)",
  "password": "string (required)",
  "name": "string?",
  "email": "string?",
  "isAdmin": false,
  "groupIds": ["clx..."],
  "providerIds": ["clx..."],
  "quotaTokenLimit": 100000,
  "quotaRequestLimit": 5000,
  "quotaPeriod": "monthly"
}
```

#### 更新用户

```
PUT /api/admin/users/{id}
```

**请求体**：同创建用户，所有字段可选

#### 启停/删除用户

```
PATCH /api/admin/users/{id}/status
Body: { "status": "active" | "disabled" }

DELETE /api/admin/users/{id}
```

#### 重置密码

```
POST /api/admin/users/{id}/reset-password
Body: { "newPassword": "string" }
```

#### 分配提供商开放范围

```
PUT /api/admin/users/{id}/providers
Body: { "providerIds": ["clx...", "clx..."] }
```

---

### 4.2 用户组管理

#### 用户组列表

```
GET /api/admin/groups?page=1&pageSize=20
```

#### 创建用户组

```
POST /api/admin/groups
Body: {
  "name": "string",
  "description": "string?",
  "memberIds": ["userId..."],
  "providerIds": ["providerId..."],
  "quotas": [
    { "quotaType": "token_count", "quotaLimit": 500000, "quotaPeriod": "monthly" }
  ]
}
```

#### 更新用户组

```
PUT /api/admin/groups/{id}
```

#### 删除用户组

```
DELETE /api/admin/groups/{id}
```

#### 管理组成员

```
PUT /api/admin/groups/{id}/members
Body: { "memberIds": ["userId..."] }
```

---

### 4.3 提供商管理

#### 提供商列表

```
GET /api/admin/providers?status=active
```

**响应**：

```json
{
  "success": true,
  "data": [
    {
      "id": "clx...",
      "name": "OpenAI",
      "code": "openai",
      "protocolType": "openai",
      "apiBaseUrl": "https://api.openai.com",
      "apiKeyEncrypted": "******",
      "status": "active",
      "healthStatus": "healthy",
      "totalRpmLimit": 1000,
      "openUserCount": 15,
      "openGroupCount": 3,
      "createdAt": "2026-04-01T00:00:00.000Z"
    }
  ]
}
```

#### 创建提供商

```
POST /api/admin/providers
Body: {
  "name": "string",
  "code": "string",
  "protocolType": "openai | azure | anthropic | dashscope | custom",
  "apiBaseUrl": "string",
  "apiKey": "string (明文，服务端加密存储)",
  "defaultModels": ["gpt-4o", "gpt-4o-mini"],
  "totalRpmLimit": 1000,
  "totalTpmLimit": 100000,
  "failoverConfig": {
    "errorThresholdPercent": 50,
    "errorWindowSeconds": 60,
    "cooldownSeconds": 30,
    "recoveryObserveSeconds": 300,
    "healthCheckEnabled": true,
    "healthCheckInterval": 60
  }
}
```

#### 更新提供商

```
PUT /api/admin/providers/{id}
```

#### 删除提供商

```
DELETE /api/admin/providers/{id}
```

#### 测试提供商连接

```
POST /api/admin/providers/{id}/test
```

**响应**：

```json
{
  "success": true,
  "data": {
    "connected": true,
    "latency": 235,
    "models": ["gpt-4o", "gpt-4o-mini"]
  }
}
```

#### 配置提供商开放范围

```
PUT /api/admin/providers/{id}/scope
Body: {
  "userIds": ["userId..."],
  "groupIds": ["groupId..."]
}
```

#### 提供商健康日志

```
GET /api/admin/providers/{id}/health-logs?page=1&pageSize=50
```

---

### 4.4 令牌管理（管理员）

#### 全平台令牌列表

```
GET /api/admin/tokens?page=1&pageSize=20&userId=xxx&status=active
```

**说明**：令牌列表返回 `keyPlain` 字段（解密后的完整密钥），管理员可直接复制。

#### 创建令牌

```
POST /api/admin/tokens
Body: {
  "name": "string (required)",
  "rpmLimit": 60,
  "tpmLimit": 100000,
  "quotaTokenLimit": 50000,
  "providerIds": ["clx..."]
}
```

**说明**：创建令牌默认绑定当前管理员用户，`providerIds` 可选绑定提供商。返回的 `apiKey` 为完整密钥明文。

#### 轮转令牌（重新生成 Key）

```
POST /api/admin/tokens/{id}/rotate
```

#### 禁用/删除令牌

```
PATCH /api/admin/tokens/{id}/status
Body: { "status": "disabled" }

DELETE /api/admin/tokens/{id}
```

---

### 4.5 脱敏规则管理（管理员）

#### 全局脱敏规则列表

```
GET /api/admin/desensitization/rules?scope=global
```

#### 创建全局脱敏规则

```
POST /api/admin/desensitization/rules
Body: {
  "name": "手机号脱敏",
  "ruleType": "regex",
  "pattern": "1[3-9]\\d{9}",
  "replacement": "[PHONE]",
  "action": "replace"
}
```

---

### 4.6 配额管理

#### 配额总览

```
GET /api/admin/quotas/overview
```

**响应**：

```json
{
  "success": true,
  "data": {
    "totalUsers": 50,
    "totalTokenUsage": 1500000,
    "totalRequestUsage": 30000,
    "providerUsage": [
      { "providerId": "...", "providerName": "OpenAI", "tokenUsage": 1000000, "requestUsage": 20000 }
    ],
    "topUsers": [
      { "userId": "...", "username": "user1", "tokenUsage": 200000 }
    ]
  }
}
```

#### 修改用户/组配额

```
PUT /api/admin/quotas/user/{userId}
Body: { "quotaTokenLimit": 200000, "quotaRequestLimit": 10000, "quotaPeriod": "monthly" }

PUT /api/admin/quotas/group/{groupId}
Body: { "quotas": [{ "quotaType": "token_count", "quotaLimit": 500000, "quotaPeriod": "monthly" }] }
```

---

### 4.7 安全策略

#### 获取/更新全局安全策略

```
GET /api/admin/security
PUT /api/admin/security
Body: {
  "passwordMinLength": 8,
  "passwordRequireUppercase": true,
  "passwordRequireNumber": true,
  "loginMaxAttempts": 5,
  "loginLockMinutes": 30,
  "globalIpWhitelist": ["192.168.0.0/16"],
  "globalIpBlacklist": [],
  "allowUserCustomDesensitize": true
}
```

---

### 4.8 审计日志

#### 全量审计日志

```
GET /api/admin/audit?page=1&pageSize=50&logType=request&userId=xxx&tokenId=xxx&startDate=2026-04-01&endDate=2026-04-13
```

**响应额外字段**：`fullBodyEnabled`（boolean）表示是否开启了完整请求/响应记录。

#### 审计日志详情

```
GET /api/admin/audit/{id}
```

**说明**：返回单条审计日志完整详情，包含 `requestBody` 和 `responseBody` 字段。

#### 切换完整请求/响应记录

```
PUT /api/admin/audit
Body: { "fullBodyEnabled": true | false }
```

#### 导出审计日志

```
GET /api/admin/audit-logs/export?format=json|csv&startDate=2026-04-01&endDate=2026-04-13
```

#### 操作日志

```
GET /api/admin/audit-logs/operations?page=1&pageSize=50
```

#### 系统事件日志

```
GET /api/admin/audit-logs/system-events?page=1&pageSize=50
```

---

### 4.9 告警配置

#### 告警规则 CRUD

```
GET    /api/admin/alerts/rules
POST   /api/admin/alerts/rules
PUT    /api/admin/alerts/rules/{id}
DELETE /api/admin/alerts/rules/{id}
```

#### 告警通知渠道配置

```
GET /api/admin/alerts/channels
PUT /api/admin/alerts/channels
Body: {
  "email": { "smtp": "smtp.example.com", "port": 465, "user": "xxx", "password": "xxx", "from": "xxx" },
  "feishu": { "webhookUrl": "https://open.feishu.cn/..." },
  "dingtalk": { "webhookUrl": "https://oapi.dingtalk.com/...", "secret": "xxx" },
  "wecom": { "webhookUrl": "https://qyapi.weixin.qq.com/..." }
}
```

#### 告警日志

```
GET /api/admin/alerts/logs?page=1&pageSize=50&level=critical
```

#### 测试告警通知

```
POST /api/admin/alerts/test
Body: { "channel": "feishu", "message": "测试告警" }
```

---

### 4.10 系统设置

```
GET /api/admin/settings
PUT /api/admin/settings
Body: {
  "timezone": "Asia/Shanghai",
  "dataRetentionDays": 30,
  "registrationEnabled": false,
  "auditLogArchiveEnabled": true
}
```

---

## 五、普通用户接口

### 5.1 个人信息

```
GET  /api/user/profile
PUT  /api/user/profile
Body: { "name": "string", "email": "string" }

PUT  /api/user/password
Body: { "oldPassword": "string", "newPassword": "string" }
```

### 5.2 我的令牌

#### 令牌列表

```
GET /api/user/tokens
```

#### 创建令牌

```
POST /api/user/tokens
Body: {
  "name": "我的令牌",
  "providers": [
    { "providerId": "clx...", "priority": 1 },
    { "providerId": "clx...", "priority": 2 }
  ],
  "rpmLimit": 60,
  "tpmLimit": 100000,
  "ipRuleMode": "allow_all",
  "ipRules": [],
  "quotaTokenLimit": 50000,
  "quotaRequestLimit": 3000,
  "quotaPeriod": "monthly",
  "desensitizeRuleIds": ["clx..."]
}
```

**响应**：

```json
{
  "success": true,
  "data": {
    "id": "clx...",
    "name": "我的令牌",
    "key": "lk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "message": "令牌明文仅显示一次，请妥善保存"
  }
}
```

#### 更新令牌

```
PUT /api/user/tokens/{id}
```

#### 启停/删除令牌

```
PATCH /api/user/tokens/{id}/status
DELETE /api/user/tokens/{id}
```

#### 轮转令牌（重新生成 Key）

```
POST /api/user/tokens/{id}/rotate
```

**响应**：

```json
{
  "success": true,
  "data": {
    "key": "lk-new_random_32chars",
    "message": "新令牌明文仅显示一次，旧令牌已立即失效"
  }
}
```

### 5.3 我的脱敏规则

```
GET    /api/user/desensitization/rules
POST   /api/user/desensitization/rules
PUT    /api/user/desensitization/rules/{id}
DELETE /api/user/desensitization/rules/{id}
```

### 5.4 我的审计日志

```
GET /api/user/audit-logs?page=1&pageSize=50&tokenId=xxx&startDate=xxx&endDate=xxx
GET /api/user/audit-logs/export?format=json|csv&startDate=xxx&endDate=xxx
```

### 5.5 我的用量统计

```
GET /api/user/usage?period=monthly&startDate=2026-04-01&endDate=2026-04-30
```

**响应**：

```json
{
  "success": true,
  "data": {
    "period": "2026-04",
    "totalTokens": 50000,
    "totalRequests": 1200,
    "quotaLimit": 100000,
    "quotaRemaining": 50000,
    "quotaUsagePercent": 50,
    "byToken": [
      { "tokenId": "...", "tokenName": "令牌1", "tokens": 30000, "requests": 800 }
    ],
    "byProvider": [
      { "providerId": "...", "providerName": "OpenAI", "tokens": 40000, "requests": 1000 }
    ],
    "dailyTrend": [
      { "date": "2026-04-01", "tokens": 2000, "requests": 50 }
    ]
  }
}
```

### 5.6 我的可用提供商

```
GET /api/user/providers
```

### 5.7 我的配额信息

```
GET /api/user/quotas
```

### 5.8 我的告警

```
GET /api/user/alerts?page=1&pageSize=20
```
