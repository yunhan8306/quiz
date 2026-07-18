#!/usr/bin/env python3
"""questions.json / glossary.json 검증 스크립트 (RULES.md의 기계 검증 항목).

실행: python3 validate.py
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = {"frequency": 0.40, "centrality": 0.25, "practicality": 0.20, "discrimination": 0.15}
EVAL_KEYS = list(WEIGHTS)
COVERAGES = ("core", "deep", "niche")
COVERAGE_TARGET = {"core": 0.50, "deep": 0.30, "niche": 0.20}


def priority(e):
    return sum(e[k] * w for k, w in WEIGHTS.items())


def load_sections(errors, warnings):
    """data/sections.json 매니페스트 순서대로 섹션 파일들을 로드."""
    sec_dir = os.path.join(ROOT, "data", "sections")
    manifest = json.load(open(os.path.join(ROOT, "data", "sections.json")))
    sections = []
    for sid in manifest["sections"]:
        path = os.path.join(sec_dir, f"{sid}.json")
        if not os.path.exists(path):
            errors.append(f"매니페스트의 '{sid}' 섹션 파일이 없음: data/sections/{sid}.json")
            continue
        s = json.load(open(path))
        if s.get("id") != sid:
            errors.append(f"data/sections/{sid}.json 의 id가 '{s.get('id')}' — 파일명과 불일치")
        sections.append(s)
    on_disk = {f[:-5] for f in os.listdir(sec_dir) if f.endswith(".json")}
    for orphan in sorted(on_disk - set(manifest["sections"])):
        warnings.append(f"data/sections/{orphan}.json 이 매니페스트에 없음 (앱에서 로드되지 않음)")
    return {"sections": sections}


def main():
    errors, warnings = [], []
    q_data = load_sections(errors, warnings)
    g_data = json.load(open(os.path.join(ROOT, "data", "glossary.json")))
    term_ids = {t["id"] for t in g_data["terms"]}
    qids = set()

    # ID 유일성
    for s in q_data["sections"]:
        for q in s["questions"]:
            if q["id"] in qids:
                errors.append(f"중복 id: {q['id']}")
            qids.add(q["id"])

    for s in q_data["sections"]:
        correct_dist = Counter()
        coverage_dist = Counter()
        negative_count = 0

        for q in s["questions"]:
            qid = q["id"]

            # 필수 필드
            for field in ("type", "difficulty", "question", "keywords"):
                if field not in q:
                    errors.append(f"{qid}: '{field}' 누락")

            # 타입별 필드
            if q.get("type") == "choice":
                if not (0 <= q.get("correctIndex", -1) < len(q.get("choices", []))):
                    errors.append(f"{qid}: correctIndex 범위 오류")
                if len(q.get("choices", [])) != 4:
                    warnings.append(f"{qid}: 보기가 4개가 아님 ({len(q.get('choices', []))}개)")
                if not q.get("explanation"):
                    errors.append(f"{qid}: explanation 누락")
                correct_dist[q.get("correctIndex")] += 1
            elif q.get("type") == "short":
                if not q.get("answer"):
                    errors.append(f"{qid}: answer 누락")

            # eval / coverage
            ev = q.get("eval")
            if not ev:
                errors.append(f"{qid}: eval 누락")
            else:
                for k in EVAL_KEYS:
                    v = ev.get(k)
                    if not isinstance(v, int) or not 1 <= v <= 5:
                        errors.append(f"{qid}: eval.{k} 값 오류 ({v})")
            cov = q.get("coverage")
            if cov not in COVERAGES:
                errors.append(f"{qid}: coverage 값 오류 ({cov})")
            else:
                coverage_dist[cov] += 1

            # 참조 무결성
            for k in q.get("keywords", []):
                if k not in term_ids:
                    errors.append(f"{qid}: keywords '{k}' 가 glossary에 없음")
            if not q.get("keywords"):
                warnings.append(f"{qid}: keywords 비어 있음 (최소 1개 권장)")
            for r in q.get("related", []):
                if r not in qids:
                    errors.append(f"{qid}: related '{r}' 문제가 없음")

            # 부정형 표시 ("잡히지 않은 예외" 같은 서술은 제외하고, 부정형 설문만 감지)
            stem = q.get("question", "")
            if re.search(r"(옳지|적절하지|맞지|해당하지|권장되지)\s*\**않은", stem):
                negative_count += 1
                if "**않은**" not in stem:
                    warnings.append(f"{qid}: 부정형인데 강조(**) 없음")

            # 정답 보기가 유독 긴지 (정답 길이 > 나머지 평균의 1.8배)
            if q.get("type") == "choice" and q.get("choices"):
                lens = [len(c) for c in q["choices"]]
                others = [l for i, l in enumerate(lens) if i != q["correctIndex"]]
                if others and lens[q["correctIndex"]] > 1.8 * (sum(others) / len(others)):
                    warnings.append(f"{qid}: 정답 보기가 유독 김 (정답 티 주의)")

        n = len(s["questions"])
        # correctIndex 분산 (같은 번호 40% 초과 금지)
        for idx, cnt in correct_dist.items():
            if n >= 5 and cnt / n > 0.40:
                warnings.append(f"[{s['id']}] correctIndex {idx}번이 {cnt}/{n} — 40% 초과")
        # 부정형 비율 (20% 이하)
        if n >= 5 and negative_count / n > 0.20:
            warnings.append(f"[{s['id']}] 부정형 문제 {negative_count}/{n} — 20% 초과")
        # 커버리지 배분 리포트
        dist = " / ".join(f"{c} {coverage_dist.get(c, 0)}" for c in COVERAGES)
        print(f"[{s['id']}] {n}문제 — {dist} (목표 {int(COVERAGE_TARGET['core']*100)}/{int(COVERAGE_TARGET['deep']*100)}/{int(COVERAGE_TARGET['niche']*100)}%)")

    # 글로서리 참조 무결성
    for t in g_data["terms"]:
        for r in t.get("related", []):
            if r not in term_ids:
                errors.append(f"용어 {t['id']}: related '{r}' 없음")

    print()
    if errors:
        print(f"❌ 오류 {len(errors)}건:")
        for e in errors:
            print("  -", e)
    if warnings:
        print(f"⚠️  경고 {len(warnings)}건:")
        for w in warnings:
            print("  -", w)
    if not errors and not warnings:
        print("✅ 모든 검증 통과")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
