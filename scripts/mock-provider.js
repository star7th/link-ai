#!/usr/bin/env node
/**
 * Mock OpenAI-compatible Provider for LinkAI disaster recovery testing.
 *
 * Supports runtime mode switching via HTTP:
 *   POST /_control { "mode": "error" }  - switch mode
 *   GET  /_control                    - check current mode
 *
 * Usage:
 *   node scripts/mock-provider.js --port 9999 --name "Mock-Primary" --mode normal
 */

const http = require("http");
const crypto = require("crypto");
const { parseArgs } = require("util");

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "9999" },
    name: { type: "string", default: "Mock-Provider" },
    mode: { type: "string", default: "normal" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`
Usage: node scripts/mock-provider.js [options]

Options:
  --port <number>   Port to listen on (default: 9999)
  --name <string>   Provider display name (default: Mock-Provider)
  --mode <string>   Initial behavior mode (default: normal)
                    normal    - return standard OpenAI response
                    error     - return 500 error
                    timeout   - delay 30s then return
                    slow      - delay 10s then return
                    very-slow - delay 45s then return
                    partial   - incomplete SSE stream (breaks mid-stream)
                    ratelimit - return 429 error
  --help            Show this help

Runtime control:
  POST /_control { "mode": "<mode>" }  Switch mode at runtime
  GET  /_control                      Get current mode
`);
  process.exit(0);
}

const PORT = parseInt(args.port, 10);
const NAME = args.name;
let MODE = args.mode;

console.log(`[${NAME}] Starting on port ${PORT}, mode: ${MODE}`);

function jsonRes(res, status, body) {
  const bodyStr = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(bodyStr),
  });
  res.end(bodyStr);
}

function handleChatCompletions(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const timestamp = new Date().toISOString();
    console.log(`[${NAME}][${timestamp}] POST /v1/chat/completions | mode=${MODE}`);

    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {}

    const isStream = parsed.stream === true;
    const model = parsed.model || "gpt-3.5-turbo";
    const userMsg = parsed.messages?.[parsed.messages.length - 1]?.content?.slice(0, 80) || "(no message)";

    switch (MODE) {
      case "error":
        console.log(`[${NAME}]   -> 500 Internal Server Error`);
        jsonRes(res, 500, {
          error: {
            message: `[${NAME}] Simulated internal error`,
            type: "server_error",
            code: "internal_error",
          },
        });
        break;

      case "timeout":
        console.log(`[${NAME}]   -> Will respond after 30s delay...`);
        setTimeout(() => {
          console.log(`[${NAME}]   -> 200 OK (after timeout)`);
          jsonRes(res, 200, {
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: `[${NAME}] Response after 30s timeout simulation` },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
          });
        }, 30000);
        break;

      case "slow":
        console.log(`[${NAME}]   -> Will respond after 10s delay...`);
        setTimeout(() => {
          jsonRes(res, 200, {
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: `[${NAME}] Response after 10s slow simulation` },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
          });
        }, 10000);
        break;

      case "very-slow":
        console.log(`[${NAME}]   -> Will respond after 45s delay...`);
        setTimeout(() => {
          jsonRes(res, 200, {
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: `[${NAME}] Response after 45s very-slow simulation` },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
          });
        }, 45000);
        break;

      case "partial":
        if (isStream) {
          console.log(`[${NAME}]   -> SSE stream (partial - will break mid-stream)`);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const id = `chatcmpl-${crypto.randomUUID()}`;
          const chunks = [
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: " from " }, finish_reason: null }] })}\n\n`,
          ];
          chunks.forEach((chunk, i) => {
            setTimeout(() => {
              res.write(chunk);
            }, i * 200);
          });
          setTimeout(() => {
            console.log(`[${NAME}]   -> SSE stream ABORTED (partial)`);
            res.destroy();
          }, 500);
        } else {
          jsonRes(res, 200, {
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: `[${NAME}] Partial response...` },
                finish_reason: "length",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          });
        }
        break;

      case "ratelimit":
        console.log(`[${NAME}]   -> 429 Rate Limit Exceeded`);
        jsonRes(res, 429, {
          error: {
            message: `[${NAME}] Rate limit exceeded. Please retry after 60s.`,
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
          },
        });
        break;

      case "normal":
      default:
        if (isStream) {
          console.log(`[${NAME}]   -> SSE stream (normal)`);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const id = `chatcmpl-${crypto.randomUUID()}`;
          const content = `[${NAME}] Mock streaming response for model ${model}. You said: "${userMsg}"`;
          const words = content.split(" ");
          words.forEach((word, i) => {
            setTimeout(() => {
              const chunk = {
                id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: { content: (i === 0 ? "" : " ") + word },
                    finish_reason: null,
                  },
                ],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }, i * 50);
          });
          setTimeout(() => {
            res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
            console.log(`[${NAME}]   -> SSE stream complete`);
          }, words.length * 50 + 100);
        } else {
          console.log(`[${NAME}]   -> 200 OK`);
          jsonRes(res, 200, {
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: `[${NAME}] Mock response for model ${model}. You said: "${userMsg}"`,
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
          });
        }
        break;
    }
  });
}

function handleModels(req, res) {
  jsonRes(res, 200, {
    object: "list",
    data: [
      { id: "gpt-3.5-turbo", object: "model", owned_by: NAME },
      { id: "gpt-4", object: "model", owned_by: NAME },
      { id: "gpt-4o", object: "model", owned_by: NAME },
    ],
  });
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url === "/v1/models") return handleModels(req, res);
  if (req.method === "POST" && req.url === "/v1/chat/completions") return handleChatCompletions(req, res);

  // Runtime control endpoint
  if (req.method === "POST" && req.url === "/_control") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const validModes = ["normal", "error", "timeout", "slow", "very-slow", "partial", "ratelimit"];
        if (parsed.mode && validModes.includes(parsed.mode)) {
          const oldMode = MODE;
          MODE = parsed.mode;
          console.log(`[${NAME}] Mode switched: ${oldMode} → ${MODE}`);
          jsonRes(res, 200, { ok: true, oldMode, newMode: MODE });
        } else {
          jsonRes(res, 400, { error: "Invalid mode", validModes });
        }
      } catch {
        jsonRes(res, 400, { error: "Invalid JSON body" });
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/_control") {
    jsonRes(res, 200, { mode: MODE, pid: process.pid });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    return jsonRes(res, 200, { status: "ok", provider: NAME, mode: MODE });
  }

  jsonRes(res, 404, { error: { message: `Not found: ${req.method} ${req.url}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[${NAME}] Running at http://127.0.0.1:${PORT} mode=${MODE} pid=${process.pid}`);
});

server.on("error", (err) => {
  console.error(`[${NAME}] Server error:`, err.message);
  process.exit(1);
});
