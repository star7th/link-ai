#!/usr/bin/env python3
"""Flexible mock OpenAI-compatible server for failover testing."""
import json, sys, time, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class MockHandler(BaseHTTPRequestHandler):
    mode = 'normal'
    slow_delay = 5.0
    request_count = 0
    provider_name = 'unknown'

    def log_message(self, fmt, *args):
        pass  # suppress default logging

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/control':
            params = urllib.parse.parse_qs(parsed.query)
            mode = params.get('mode', [None])[0]
            delay = params.get('delay', [None])[0]
            if mode:
                MockHandler.mode = mode
            if delay:
                MockHandler.slow_delay = float(delay)
            self._json(200, {'mode': MockHandler.mode, 'slow_delay': MockHandler.slow_delay,
                             'provider': self.provider_name, 'request_count': MockHandler.request_count})
            return
        if parsed.path == '/status':
            self._json(200, {'mode': MockHandler.mode, 'slow_delay': MockHandler.slow_delay,
                             'provider': self.provider_name, 'request_count': MockHandler.request_count})
            return
        if parsed.path == '/v1/models':
            self._json(200, {'object': 'list', 'data': [{'id': 'gpt-4o-mini', 'object': 'model', 'owned_by': 'mock'}]})
            return
        self.send_response(404); self.end_headers()

    def do_POST(self):
        MockHandler.request_count += 1
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        try:
            bj = json.loads(body) if body else {}
            is_stream = bj.get('stream', False)
        except Exception:
            is_stream = False

        m = MockHandler.mode

        if m == 'timeout':
            time.sleep(120)
            self.send_response(500); self.end_headers()
            return

        if m == 'slow':
            time.sleep(MockHandler.slow_delay)
            m = 'normal'

        if m == 'error_500':
            self._json(500, {'error': {'message': f'Internal error from {self.provider_name}', 'type': 'internal_error', 'code': 500}})
            return
        if m == 'error_400':
            self._json(400, {'error': {'message': f'Bad request from {self.provider_name}', 'type': 'invalid_request_error', 'code': 'invalid_request'}})
            return
        if m == 'error_429':
            self._json(429, {'error': {'message': f'Rate limit from {self.provider_name}', 'type': 'rate_limit_error', 'code': 'rate_limit_exceeded'}})
            return
        if m == 'error_connection':
            self.connection.close()
            return

        if m == 'partial':
            if is_stream:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                for txt in ["Hello ", "this is partial ", "response so far"]:
                    chunk = json.dumps({"id":"chatcmpl-mock","object":"chat.completion.chunk",
                        "choices":[{"index":0,"delta":{"content":txt},"finish_reason":None}]})
                    self.wfile.write(f'data: {chunk}\n\n'.encode())
                    self.wfile.flush()
                    time.sleep(0.1)
                self.connection.close()
                return
            else:
                self._json(200, {"id":"chatcmpl-mock","object":"chat.completion",
                    "choices":[{"index":0,"message":{"role":"assistant","content":"partial"},"finish_reason":"length"}],
                    "usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}})
                return

        # Normal mode
        content = f"[{self.provider_name}] Hello! Mock response #{MockHandler.request_count}."
        if is_stream:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            role = json.dumps({"id":"chatcmpl-mock","object":"chat.completion.chunk",
                "choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":None}]})
            self.wfile.write(f'data: {role}\n\n'.encode())
            self.wfile.flush()
            words = content.split()
            for w in words:
                c = json.dumps({"id":"chatcmpl-mock","object":"chat.completion.chunk",
                    "choices":[{"index":0,"delta":{"content":w+" "},"finish_reason":None}]})
                self.wfile.write(f'data: {c}\n\n'.encode())
                self.wfile.flush()
                time.sleep(0.02)
            fin = json.dumps({"id":"chatcmpl-mock","object":"chat.completion.chunk",
                "choices":[{"index":0,"delta":{},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}})
            self.wfile.write(f'data: {fin}\n\n'.encode())
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        else:
            self._json(200, {"id":"chatcmpl-mock","object":"chat.completion","created":int(time.time()),
                "model":"gpt-4o-mini",
                "choices":[{"index":0,"message":{"role":"assistant","content":content},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}})

    def _json(self, code, obj):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode())

if __name__ == '__main__':
    port = int(sys.argv[1])
    name = sys.argv[2] if len(sys.argv) > 2 else f"mock-{port}"
    MockHandler.provider_name = name
    server = HTTPServer(('127.0.0.1', port), MockHandler)
    print(f"Mock '{name}' on 127.0.0.1:{port}", flush=True)
    server.serve_forever()
