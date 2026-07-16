# Android 기술 학습 퀴즈

안드로이드 기술 질문을 JSON으로 기록·보관하고, 웹앱으로 풀어보는 학습 도구.

**🔗 바로 풀기: https://yunhan8306.github.io/quiz/android-quiz/**

## 실행

**가장 쉬운 방법**: Finder에서 `Android Quiz.command` 더블클릭 — 서버가 뜨고 브라우저가 자동으로 열린다.

터미널에서는:

```bash
cd android-quiz
python3 server.py                # 시작 + 브라우저 자동 열기
python3 server.py --no-browser   # 브라우저 열지 않고 시작
```

- 이미 실행 중이면 브라우저만 다시 열어준다 (중복 실행 걱정 없음)
- 종료: 해당 터미널에서 `Ctrl+C`
- 의존성 없음 (Python 3 표준 라이브러리만 사용)

서버 없이 `index.html`을 브라우저로 직접 열어도 동작하지만, 이 경우 학습 기록은
`progress.json` 파일 대신 브라우저 localStorage에만 저장된다.

## 구조

```
android-quiz/
├── server.py            # 로컬 서버 (정적 서빙 + 학습 기록 저장 API)
├── index.html
├── app.js               # SPA 로직 (라우팅, 렌더링, 용어 자동 링크)
├── style.css
└── data/
    ├── sections.json    # 섹션 매니페스트 (id 목록 = 표시 순서)
    ├── sections/        # 섹션별 문제 파일 (섹션당 1개)
    │   ├── android-core.json
    │   ├── coroutines.json
    │   └── …
    ├── glossary.json    # 용어 사전 (직접 편집해서 추가)
    └── progress.json    # 학습 기록 (자동 생성/갱신 — 직접 편집 X)
```

## 문제 추가하기 — `data/sections/<섹션id>.json`

해당 섹션 파일의 `questions` 배열에 객체를 추가한다.
**새 섹션**은 `data/sections/<id>.json` 파일(`{id, title, description, questions}`)을 만들고 `data/sections.json`의 목록에 id를 추가한다.

### 객관식 (`type: "choice"`) — 기본 형식

> **문제를 만들기 전에 반드시 [RULES.md](RULES.md)를 읽을 것** — 제작 규칙, 평가 루브릭, 체크리스트가 정의되어 있고 모든 문제는 이 규칙을 따라야 한다. 작성 후 `python3 validate.py`로 검증한다.

```json
{
  "id": "co-008",
  "type": "choice",
  "difficulty": 1,
  "coverage": "core",
  "eval": { "frequency": 5, "centrality": 4, "practicality": 5, "discrimination": 3 },
  "question": "질문 내용 (마크다운 일부 지원: **굵게**, `코드`, 리스트, ```코드블록```)",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctIndex": 1,
  "explanation": "상세 해설 — 정답 선택 후 표시됨. 단순 정답 확인이 아니라 개념 전체를 복습할 수 있게 자세히 쓰는 것을 권장",
  "keywords": ["flow"],
  "related": []
}
```

- 보기를 고르면 즉시 채점되고(⭕/❌ 기록), 해설이 공개됨
- 오답 보기는 '흔한 오해'를 담아 만들면 학습 효과가 좋다
- 정답 위치(`correctIndex`)는 골고루 분산시킬 것

### 주관식 (`type: "short"`) — 필요 시 사용 가능

앱이 계속 지원하는 타입. `answer` 필드에 모범답안을 쓰면 "정답 보기" + ⭕🔺❌ 자기 채점 방식으로 동작한다.

### 필드 설명

| 필드 | 설명 |
|---|---|
| `id` | 전체에서 유일한 ID. 기록/링크의 키 |
| `difficulty` | 1~3 (★ 개수로 표시). 1=정의·용도, 2=비교·원리, 3=내부 구현·엣지 케이스 |
| `coverage` | `core`(핵심) / `deep`(심화) / `niche`(지엽). 섹션당 50/30/20% 배분 목표 |
| `eval` | 평가 4축 각 1~5점 (RULES.md 루브릭 기준). 앱이 가중합으로 우선순위를 계산해 **높은 문제가 상단에 정렬**되고 S필수/A중요/B기본/C지엽 티어 배지가 붙음 |
| `keywords` | `glossary.json`의 용어 `id` 목록. 문제 하단에 칩으로 표시되고, 용어 패널의 "이 용어가 나오는 문제" 목록에 잡힘 |
| `related` | 연관 문제 `id` 목록. 문제 하단에 바로가기 링크로 표시 |


## 용어 추가하기 — `data/glossary.json`

```json
{
  "id": "workmanager",
  "term": "WorkManager",
  "aliases": ["워크매니저"],
  "definition": "설명. 여기 안에 다른 용어(코루틴 등)가 나오면 자동으로 링크됨",
  "related": ["coroutine"]
}
```

- `term`과 `aliases`에 적힌 표기가 문제/답/해설/용어설명 본문에 등장하면
  **자동으로 클릭 가능한 링크**가 된다 (코드 블록 안은 제외, 영단어는 단어 경계 확인)
- 용어 클릭 → 우측 패널에 설명 + 연관 용어 + 그 용어가 나오는 문제 목록
- 패널 안에서 다른 용어를 계속 타고 들어갈 수 있음 (← 이전 버튼으로 되돌아감)

## 학습 기록 — `data/progress.json`

문제를 풀 때마다 자동 저장:

```json
{
  "co-001": {
    "status": "partial",
    "history": [{ "ts": "2026-07-07T12:00:00.000Z", "result": "partial" }],
    "myAnswer": "내가 적어둔 답"
  }
}
```

- 홈 화면: 섹션별 진행률 + 전체 통계 + 복습 대상(틀림/애매) 목록
- 섹션 화면: 상태별 필터 (안 푼 문제 / 틀린 문제 / …)

## 설계 노트: 주관식 vs 객관식

**전부 객관식으로 통일** (2026-07-07 결정):

- 클릭만으로 진행되어 부담이 없고, 자동 채점이라 기록이 객관적
- '알아보기'만 테스트되는 객관식의 약점은, 정답 선택 후 **상세 모범답안 수준의 해설**을 보여주는 것으로 보완 (고르고 → 읽으며 복습)
- 스키마와 앱은 주관식(`short`)도 계속 지원하므로 필요하면 혼용 가능
