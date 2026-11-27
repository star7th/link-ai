#!/usr/bin/env bash
# 一键清理 e2e 环境：停进程、释放端口、删临时库
set -uo pipefail

E2E="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$E2E/.tmp"

for f in "$TMP/next.pid" "$TMP/mock.pid"; do
  if [ -f "$f" ]; then
    PID="$(cat "$f")"
    kill "$PID" 2>/dev/null || true
    # next dev 会派生 worker，兜底杀进程组
    kill -- -"$PID" 2>/dev/null || true
  fi
done
# 按端口兜底清理
MOCK_PORT=$(grep -oP '(?<=MOCK_UPSTREAM_URL=http://127\.0\.0\.1:)\d+' "$TMP/ports.env" 2>/dev/null || true)
for port in "${GATEWAY_PORT:-3210}" "$MOCK_PORT"; do
  [ -z "$port" ] && continue
  for i in $(seq 1 10); do
    lsof -t -i ":$port" >/dev/null 2>&1 || break
    PIDS=$(lsof -t -i ":$port" 2>/dev/null || true)
    [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
    sleep 0.5
  done
  if lsof -t -i ":$port" >/dev/null 2>&1; then
    fuser -k "$port/tcp" 2>/dev/null || true
    sleep 0.5
  fi
done

rm -rf "$TMP"
echo "[stop] e2e 环境已清理（进程停止、端口释放、$TMP 已删除）"
