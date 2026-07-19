# 백엔드 기술 학습 퀴즈

언어(Java/Kotlin/Python)·프레임워크(Spring/Django/Express) 무관, **서버 공통 지식**만 다루는 학습 퀴즈. 140문제 · 10섹션.

바이블급 서적·커리큘럼의 목차를 주제 지도로 삼아 제작했다 (콘텐츠는 전부 오리지널):
컴퓨터 네트워킹 하향식 접근 · Real MySQL 8.0 · 데이터 중심 애플리케이션 설계(DDIA) · 가상 면접 사례로 배우는 대규모 시스템 설계 · HTTP 완벽 가이드 · OSTEP · roadmap.sh/backend · System Design Primer · 한국 기술면접 커리큘럼.

## 실행

```bash
python3 server.py   # http://localhost:8767 자동 오픈
```

또는 `Backend Quiz.command` 더블클릭. (android-quiz는 8765를 쓰므로 포트가 다르다)

## 섹션

| id | 제목 | 문제 수 |
|---|---|---|
| network | 네트워크 기초 | 16 |
| http-api | HTTP & API 설계 | 15 |
| os-concurrency | 운영체제 & 동시성 | 14 |
| database | 데이터베이스 | 18 |
| cache | 캐시 전략 | 12 |
| async-mq | 비동기 & 메시지 큐 | 12 |
| auth-security | 인증 & 보안 | 14 |
| distributed | 분산 시스템 | 15 |
| system-design | 시스템 설계 | 14 |
| infra | 인프라 & 운영 | 10 |

## 데이터 구조·규칙

- 문제: `data/sections/<섹션id>.json` (섹션당 1파일), 순서: `data/sections.json`
- 용어사전: `data/glossary.json` (270용어, 해설에서 자동 링크)
- 제작·평가 규칙: `RULES.md` (루브릭 4축 가중치 40/25/20/15, 티어 S/A/B/C)
- 검증: `python3 validate.py` (ID·참조 무결성, correctIndex 분포, 정답 길이 티 등)

문제 추가·보강은 `/quiz-add` 스킬 사용.
