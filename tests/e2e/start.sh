#!/usr/bin/env bash
# 一键拉起 e2e 环境：mock 上游 + 测试库初始化 + 种子 + 网关(next dev, 端口 3210)
# 清理用同目录 stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E="$ROOT/tests/e2e"
TMP="$E2E/.tmp"
GATEWAY_PORT="${GATEWAY_PORT:-3210}"

mkdir -p "$TMP"
rm -f "$TMP"/*.pid "$TMP"/ports.env "$TMP"/next.log "$TMP"/mock.log

# 1. 测试库（独立 SQLite 文件，绝不指向 data/app.db）
export DATABASE_URL="file:$TMP/e2e.db"
echo "[start] DATABASE_URL=$DATABASE_URL"
rm -f "$TMP/e2e.db" "$TMP/e2e.db-journal" "$TMP/e2e.db-wal" "$TMP/e2e.db-shm"

# 2. 测试专用 schema：仓库 schema 保持硬编码路径，这里复制一份并替换 url 为
#    env("DATABASE_URL")，prisma 命令都指向它；generator 无 output 字段时 client
#    仍输出到 node_modules/.prisma/client，next dev 天然加载到测试 client
TEST_SCHEMA="$TMP/schema.prisma"
sed '/datasource db/,/}/ s|url[[:space:]]*=.*|url      = env("DATABASE_URL")|' \
  "$ROOT/prisma/schema.prisma" > "$TEST_SCHEMA"
grep -q 'env("DATABASE_URL")' "$TEST_SCHEMA" || { echo "[start] 测试 schema 生成失败" >&2; exit 1; }

# 3. 初始化表结构（最新 schema，含 AuditLog.ttftMs）
cd "$ROOT"
npx prisma db push --skip-generate --accept-data-loss --schema "$TEST_SCHEMA" >/dev/null
npx prisma generate --schema "$TEST_SCHEMA" >/dev/null
echo "[start] prisma db push + generate 完成（测试专用 schema）"

# 4. mock 上游（随机高位端口）
node "$E2E/mock-upstream.mjs" ${MOCK_ARGS:-} >"$TMP/mock.log" 2>&1 &
echo $! >"$TMP/mock.pid"

for i in $(seq 1 50); do
  MOCK_UPSTREAM_URL="$(sed -n 's/^MOCK_UPSTREAM_PORT=\(.*\)$/http:\/\/127.0.0.1:\1/p' "$TMP/mock.log" | head -1)"
  [ -n "$MOCK_UPSTREAM_URL" ] && break
  sleep 0.2
done
if [ -z "${MOCK_UPSTREAM_URL:-}" ]; then
  echo "[start] mock 上游启动失败：" >&2
  cat "$TMP/mock.log" >&2
  bash "$E2E/stop.sh" >/dev/null 2>&1 || true
  exit 1
fi
export MOCK_UPSTREAM_URL
echo "[start] mock 上游: $MOCK_UPSTREAM_URL"

# 5. 种子数据
node "$E2E/seed.mjs" ${SEED_ARGS:-}
echo "[start] 种子完成"

# 6. 网关（next dev）
npx next dev -p "$GATEWAY_PORT" >"$TMP/next.log" 2>&1 &
echo $! >"$TMP/next.pid"

# 7. 就绪等待
for i in $(seq 1 120); do
  if curl -sf -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/auth/login"; then
    READY=1; break
  fi
  # 进程挂了就快速失败
  if ! kill -0 "$(cat "$TMP/next.pid")" 2>/dev/null; then
    echo "[start] next dev 启动失败：" >&2
    tail -30 "$TMP/next.log" >&2
    bash "$E2E/stop.sh" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 1
done
if [ "${READY:-0}" != 1 ]; then
  echo "[start] 网关就绪超时" >&2
  tail -30 "$TMP/next.log" >&2
  bash "$E2E/stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

# 8. 输出端口信息
cat >"$TMP/ports.env" <<EOF
MOCK_UPSTREAM_URL=$MOCK_UPSTREAM_URL
GATEWAY_URL=http://127.0.0.1:$GATEWAY_PORT
ADMIN_ENTRY=http://127.0.0.1:$GATEWAY_PORT/auth/login
DATABASE_URL=$DATABASE_URL
ADMIN_USER=e2eadmin
ADMIN_PASS=e2e-admin-pass
E2E_TOKEN=lk-e2e-test-token-0001
EOF
cat "$TMP/ports.env"
echo "[start] e2e 环境就绪 ✔"
