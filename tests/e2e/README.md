# 本地端到端测试环境（批次A：只搭环境）

可重复的本地 e2e 环境：mock 上游 + 独立 SQLite 测试库 + 种子数据 + 网关（next dev）。
**不发任何真实上游请求；不占用 3000/3001；不用 docker。**

## 组件

| 文件 | 作用 |
|---|---|
| `mock-upstream.mjs` | OpenAI 兼容 `/v1/chat/completions` SSE mock 上游，监听 127.0.0.1 随机高位端口 |
| `seed.mjs` | 向测试库写入：管理员、Provider（指向 mock 上游）、令牌；`--legacy` 可插一批无 ttftMs 历史记录 |
| `start.sh` | 一键拉起：建测试库（prisma db push）→ mock 上游 → 种子 → next dev（默认端口 3210）→ 打印端口/入口 |
| `stop.sh` | 一键清理：停进程、释放端口、删除 `tests/e2e/.tmp/` |

## 使用

```bash
bash tests/e2e/start.sh   # 启动，结束时打印所有地址与凭据（也写入 .tmp/ports.env）
bash tests/e2e/stop.sh    # 停止并清理
```

固定测试凭据：
- 管理员：`e2eadmin` / `e2e-admin-pass`，入口 `http://127.0.0.1:3210/auth/login`
- 网关令牌：`lk-e2e-test-token-0001`
- 数据库：`tests/e2e/.tmp/e2e.db`（通过 `DATABASE_URL` 注入，绝不触碰 `data/app.db`）

### mock 上游参数（可选，通过 MOCK_ARGS 传给 start.sh）

```bash
MOCK_ARGS="--TTFT_MS=500 --TOKEN_INTERVAL_MS=10 --TOTAL_TOKENS=200 --ABORT_AFTER_TOKENS=0" \
  bash tests/e2e/start.sh
```

- `TTFT_MS`：首字延迟（默认 500）
- `TOKEN_INTERVAL_MS`：每 X ms 发 1 token（默认 10，约 100 tok/s）
- `TOTAL_TOKENS`：总输出 token 数（默认 200）
- `ABORT_AFTER_TOKENS`：发到第 N 个 token 后直接断开（模拟上游中断，0=不中断）

### 种子附加项

```bash
SEED_ARGS="--legacy" bash tests/e2e/start.sh   # 额外插入无 ttftMs 的历史记录（验证分子分母配对）
```

## 发测试请求

```bash
source tests/e2e/.tmp/ports.env

# 1. 直测 mock 上游（SSE）
curl -s -N "$MOCK_UPSTREAM_URL/v1/chat/completions" -H 'content-type: application/json' \
  -d '{"model":"mock-model","stream":true,"messages":[{"role":"user","content":"hi"}]}'

# 2. 经网关代理（审计日志落到测试库 AuditLog）
curl -s -N "http://127.0.0.1:3210/v1/chat/completions" \
  -H "Authorization: Bearer $E2E_TOKEN" -H 'content-type: application/json' \
  -d '{"model":"mock-model","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

## 注意

- `prisma/schema.prisma` 的 datasource 已改为 `env("DATABASE_URL")`，默认值在 `.env`（`file:../data/app.db`），常规开发行为不变；拉取本目录后若客户端未重新生成，先跑一次 `npx prisma generate`。
- 端口 3210 被占时：`GATEWAY_PORT=3211 bash tests/e2e/start.sh`
