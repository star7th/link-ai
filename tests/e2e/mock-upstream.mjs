#!/usr/bin/env node
/**
 * e2e mock 上游：OpenAI 兼容 /v1/chat/completions（流式 SSE）
 *
 * 可参数化（环境变量或 CLI --key=value）：
 *   TTFT_MS            首字延迟，默认 500
 *   TOKEN_INTERVAL_MS  出字间隔（每 X ms 发 1 token），默认 10（约 100 tok/s）
 *   TOTAL_TOKENS       总输出 token 数，默认 200
 *   ABORT_AFTER_TOKENS >0 时发到第 N 个 token 后直接断开连接（模拟中断），默认 0 不中断
 *
 * 监听 127.0.0.1 随机高位端口，启动后打印 MOCK_UPSTREAM_PORT=<port>
 */
import http from "node:http";

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([A-Za-z_]+)=(.*)$/);
  if (m) args[m[1]] = m[2];
}
const TTFT_MS = parseInt(args.TTFT_MS ?? process.env.TTFT_MS ?? "500", 10);
const TOKEN_INTERVAL_MS = parseInt(args.TOKEN_INTERVAL_MS ?? process.env.TOKEN_INTERVAL_MS ?? "10", 10);
const TOTAL_TOKENS = parseInt(args.TOTAL_TOKENS ?? process.env.TOTAL_TOKENS ?? "200", 10);
const ABORT_AFTER_TOKENS = parseInt(args.ABORT_AFTER_TOKENS ?? process.env.ABORT_AFTER_TOKENS ?? "0", 10);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname !== "/v1/chat/completions") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let model = "mock-model";
    let stream = true;
    try {
      const parsed = JSON.parse(body || "{}");
      model = parsed.model ?? model;
      stream = parsed.stream ?? stream;
    } catch {}

    const chunkPayload = (content) => ({
      id: "chatcmpl-e2e-mock",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    });

    if (!stream) {
      // 非流式：等满 TTFT + TOTAL_TOKENS*INTERVAL 后一次性返回
      const text = "a".repeat(TOTAL_TOKENS);
      const finish = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-e2e-mock",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: TOTAL_TOKENS, total_tokens: TOTAL_TOKENS + 10 },
          })
        );
      };
      setTimeout(finish, TTFT_MS + TOTAL_TOKENS * TOKEN_INTERVAL_MS);
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const writeChunk = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // 首 token：角色 + 首字（计入 TTFT）
    let startTimer = null;
    let tokenInterval = null;
    const cleanup = () => {
      if (startTimer) clearTimeout(startTimer);
      if (tokenInterval) clearInterval(tokenInterval);
    };
    res.on("close", cleanup);

    startTimer = setTimeout(() => {
      writeChunk({
        id: "chatcmpl-e2e-mock",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: "a" }, finish_reason: null }],
      });

      let sent = 1;
      tokenInterval = setInterval(() => {
        if (ABORT_AFTER_TOKENS > 0 && sent >= ABORT_AFTER_TOKENS) {
          clearInterval(tokenInterval);
          // 模拟上游中断：直接断开，不发 finish
          res.destroy();
          return;
        }
        writeChunk(chunkPayload("a"));
        sent++;
        if (sent >= TOTAL_TOKENS) {
          clearInterval(tokenInterval);
          writeChunk({
            id: "chatcmpl-e2e-mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          });
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, TOKEN_INTERVAL_MS);

    }, TTFT_MS);
  });
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`MOCK_UPSTREAM_PORT=${port}`);
  console.log(
    `[mock-upstream] listening http://127.0.0.1:${port} ttft=${TTFT_MS}ms interval=${TOKEN_INTERVAL_MS}ms total=${TOTAL_TOKENS} abortAfter=${ABORT_AFTER_TOKENS}`
  );
});
