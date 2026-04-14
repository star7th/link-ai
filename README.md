# 智链 AI 网关 | LinkAI Gateway

智链 AI 网关是一款面向企业和个人用户的大模型安全接入网关，专注于调用过程中的**安全防护、数据脱敏、全链路审计与容灾保障**，让每一次 AI 调用都安全可追溯、稳定不掉线。

平台以**令牌路由**为核心机制，让团队管理者统一管控提供商资源、用量配额和安全策略，让每位成员在权限范围内自助创建令牌、选择模型提供商、配置容灾切换，兼顾安全管控与灵活使用。


## 🚀 功能特点

* **统一代理转发**：对外暴露 OpenAI 兼容 API 格式，业务/AI 工具仅需替换 `base_url` 和 `api_key` 即可接入
* **多提供商支持**：支持 OpenAI、Azure OpenAI、Anthropic、通义千问、DeepSeek 等主流大模型提供商，内置协议适配器
* **全链路容灾自愈**：三态熔断器 + 健康探测引擎 + 自动切换备用提供商，保障 AI 调用高可用
* **双层脱敏引擎**：管理员全局强制脱敏 + 用户自定义脱敏规则，支持关键字/正则匹配，防敏感数据泄露
* **分层配额管控**：用户配额 > 令牌配额 > 提供商配额，多层级用量管控，超额自动熔断
* **全链路审计日志**：链式哈希防篡改审计日志，支持完整请求/响应记录，合规可追溯
* **多角色权限体系**：超级管理员 + 普通用户，分层管控兼顾安全与效率
* **零改造接入**：统一入口 + 令牌路由，业务端无需代码改造
* **轻量级部署**：SQLite 数据库 + Docker 一键部署，无需外部中间件依赖

## 📸 截图预览

> 待补充

## 🔧 核心架构

```
┌─────────────────────────────────────────────────────┐
│                   应用层 (Application)                │
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │  管理员管控后台    │  │  普通用户自助控制台        │ │
│  └──────────────────┘  └──────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                 权限管控层 (Authorization)             │
│  用户管理 │ 角色权限 │ 开放范围控制 │ 配额校验 │ 强制规则 │
├─────────────────────────────────────────────────────┤
│                   引擎层 (Engine)                     │
│  代理转发 │ 脱敏规则 │ 容灾自愈 │ 审计日志 │ 配额管控  │
├─────────────────────────────────────────────────────┤
│                   资源层 (Resource)                   │
│         上游提供商资源池（统一配置、全局复用）             │
└─────────────────────────────────────────────────────┘
```

## 🛠️ 技术栈

* **全栈框架**：Next.js (App Router) 15.3
* **UI 框架**：React 19 + Tailwind CSS 3.4
* **语言**：TypeScript 5.x
* **数据库**：SQLite (Prisma ORM)，WAL 模式，零运维
* **认证**：NextAuth.js 4.24
* **测试**：Vitest 3.1
* **容器**：Docker + Docker Compose，支持 x86/ARM

## 📦 安装与部署

### 使用 Docker 部署（推荐）

```bash
# 适用于 x86/x64 架构
docker run -d --name link-ai --restart always -p 3333:3333 -v ~/link-ai_data:/app/data star7th/link-ai:latest

# 适用于 ARM 架构（如树莓派、Apple Silicon）
docker run -d --name link-ai --restart always -p 3333:3333 -v ~/link-ai_data:/app/data star7th/link-ai:arm-latest
```

### 使用 Docker Compose 部署

```bash
git clone https://github.com/star7th/link-ai.git
cd link-ai
docker compose up -d
```

### 开发环境

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 启动开发服务器
npm run dev
```

访问 http://localhost:3333 开始使用。

### 初始化说明

首次启动时，系统会自动：
1. 检查数据库是否存在，不存在则自动初始化数据库结构
2. 首次访问时，系统会引导你创建管理员账户

## 🔄 更新说明

### Docker 部署更新

```bash
# 1. 停止当前容器
docker stop link-ai

# 2. 删除旧容器（数据会保留在挂载的卷中）
docker rm link-ai

# 3. 拉取最新镜像
docker pull star7th/link-ai:latest

# 4. 重新运行容器
docker run -d --name link-ai --restart always -p 3333:3333 -v ~/link-ai_data:/app/data star7th/link-ai:latest
```

## 🧩 项目结构

```
src/
├── app/                        # Next.js App Router 页面与 API
│   ├── dashboard/              # 用户控制台
│   ├── admin/                  # 管理员后台
│   ├── auth/                   # 认证相关页面
│   └── api/
│       ├── proxy/              # AI 代理转发核心路由
│       ├── admin/              # 管理员 API
│       └── user/               # 用户 API
├── components/                 # React 组件
│   ├── ui/                     # 基础 UI 组件
│   ├── layout/                 # 布局组件
│   ├── provider/               # 提供商相关组件
│   ├── token/                  # 令牌相关组件
│   └── audit/                  # 审计日志组件
├── lib/
│   ├── proxy/                  # 代理转发引擎
│   │   ├── engine.ts           # 代理核心引擎
│   │   ├── stream.ts           # 流式响应处理
│   │   └── adapter/            # 提供商协议适配器
│   ├── desensitize/            # 脱敏引擎
│   ├── failover/               # 容灾引擎（熔断器、健康探测）
│   ├── quota/                  # 配额引擎
│   └── audit/                  # 审计引擎
├── context/                    # React 上下文
└── types/                      # TypeScript 类型定义
```

## 🌍 贡献指南

欢迎贡献代码！请随时提交 Pull Request。

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m '添加某项功能'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 📄 许可证

本项目基于 Apache License 2.0 许可证开源 - 详情请查看 LICENSE 文件。

## 🔗 链接

* GitHub 仓库: https://github.com/star7th/link-ai
