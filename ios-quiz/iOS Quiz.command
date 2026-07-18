#!/bin/bash
# 더블클릭으로 iOS Quiz 실행 (서버 시작 + 브라우저 자동 열기)
cd "$(dirname "$0")"
exec python3 server.py
