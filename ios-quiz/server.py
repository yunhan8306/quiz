#!/usr/bin/env python3
"""iOS Quiz 로컬 서버.

실행:  python3 server.py  →  http://localhost:8765

- 정적 파일(index.html, app.js, data/*.json 등) 서빙
- GET  /api/progress : 학습 기록 조회 (data/progress.json)
- POST /api/progress : 학습 기록 저장
"""
import json
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
PROGRESS_PATH = os.path.join(ROOT, "data", "progress.json")
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path == "/api/progress":
            data = b"{}"
            if os.path.exists(PROGRESS_PATH):
                with open(PROGRESS_PATH, "rb") as f:
                    data = f.read()
            self._send_json(data)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/progress":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                json.loads(body)
            except ValueError:
                self.send_error(400, "invalid json")
                return
            os.makedirs(os.path.dirname(PROGRESS_PATH), exist_ok=True)
            with open(PROGRESS_PATH, "wb") as f:
                f.write(body)
            self._send_json(b'{"ok":true}')
        else:
            self.send_error(404)

    def _send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        # 문제/용어 JSON을 수정하면 새로고침만으로 반영되도록 캐시 비활성화
        if self.path.endswith(".json"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    import argparse
    import threading
    import webbrowser

    parser = argparse.ArgumentParser(description="iOS Quiz 로컬 서버")
    parser.add_argument("--no-browser", action="store_true", help="브라우저 자동 열기 비활성화")
    args = parser.parse_args()

    url = f"http://localhost:{PORT}"
    try:
        server = HTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # 이미 실행 중 (포트 점유) → 브라우저만 열고 종료
        print(f"이미 {url} 에서 실행 중입니다. 브라우저만 엽니다.")
        if not args.no_browser:
            webbrowser.open(url)
        raise SystemExit(0)

    print(f"iOS Quiz 서버 실행 중 → {url}")
    print("종료: Ctrl+C")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")
