'use strict';

/* ============================== 상태 ============================== */

const app = document.getElementById('app');
const panel = document.getElementById('panel');

const state = {
  sections: [],
  glossary: [],
  progress: {},          // { [questionId]: { status, history, myAnswer } }
  serverOk: true,
  filter: 'all',
  termRegex: null,
  termMap: new Map(),    // 소문자 표기 → term id
  termById: new Map(),
  questionById: new Map(),
  sectionByQid: new Map(),
  panelStack: [],        // 용어 패널 탐색 히스토리
};

const STATUS_LABEL = { none: '안 풂', correct: '맞음', partial: '애매함', wrong: '틀림' };

/* 진행기록 저장 키 — init()에서 퀴즈별로 확정 (아래 LEGACY_KEY 참고) */
const LEGACY_KEY = 'quiz-progress';
let STORAGE_KEY = LEGACY_KEY;

/* 우선순위 = 평가 4축 가중합 (RULES.md 참고) */
const EVAL_WEIGHTS = { frequency: 0.40, centrality: 0.25, practicality: 0.20, discrimination: 0.15 };
const EVAL_LABEL = { frequency: '출제빈도', centrality: '중심성', practicality: '실무', discrimination: '변별력' };
const TIERS = [
  { key: 'S', label: '필수', min: 4.2 },
  { key: 'A', label: '중요', min: 3.4 },
  { key: 'B', label: '기본', min: 2.6 },
  { key: 'C', label: '지엽', min: 0 },
];
const COVERAGE_LABEL = { core: '핵심', deep: '심화', niche: '지엽' };

function priorityOf(q) {
  if (!q.eval) return 3;
  let sum = 0;
  for (const [k, w] of Object.entries(EVAL_WEIGHTS)) sum += (q.eval[k] || 3) * w;
  return sum;
}

function tierOf(q) {
  const p = priorityOf(q);
  return TIERS.find((t) => p >= t.min);
}

/* ============================== 초기화 ============================== */

init();

async function init() {
  try {
    const [manifest, gData, config] = await Promise.all([
      fetch('data/sections.json').then((r) => r.json()),
      fetch('data/glossary.json').then((r) => r.json()),
      fetch('quiz.config.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.sections = await Promise.all(
      manifest.sections.map((id) => fetch('data/sections/' + id + '.json').then((r) => r.json()))
    );
    state.glossary = gData.terms;
    // 퀴즈별 저장 키 — 같은 사이트(origin)에 여러 퀴즈가 있어도 진행기록이 섞이지 않도록
    STORAGE_KEY = LEGACY_KEY + ':' + ((config && config.name) || location.pathname);
  } catch (e) {
    app.innerHTML = '<p class="error">데이터를 불러오지 못했습니다. <code>python3 server.py</code>로 실행했는지 확인하세요.</p>';
    return;
  }

  if (isLocalServerContext()) {
    try {
      const r = await fetch('/api/progress');
      if (!r.ok) throw new Error();
      state.progress = await r.json();
    } catch (e) {
      state.serverOk = false;
      state.progress = loadLocalProgress();
    }
  } else {
    // 정적 호스팅(GitHub Pages 등): 진행기록 서버가 원래 없음 → 브라우저 저장만 사용
    state.serverOk = false;
    state.progress = loadLocalProgress();
  }
  updateServerBadge();

  buildIndexes();
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.term');
    if (t) openTerm(t.dataset.term);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });
  render();
}

function buildIndexes() {
  for (const s of state.sections) {
    for (const q of s.questions) {
      state.questionById.set(q.id, q);
      state.sectionByQid.set(q.id, s);
    }
  }
  const patterns = [];
  for (const t of state.glossary) {
    state.termById.set(t.id, t);
    for (const p of [t.term, ...(t.aliases || [])]) {
      state.termMap.set(p.toLowerCase(), t.id);
      patterns.push(p);
    }
  }
  patterns.sort((a, b) => b.length - a.length); // 긴 표기 우선 (StateFlow > Flow)
  if (patterns.length) {
    const alt = patterns.map(escapeRegex).join('|');
    state.termRegex = new RegExp('(' + alt + ')', 'gi');
  }
}

/* localhost에서만 진행기록 서버(/api)를 기대 — 정적 호스팅에선 서버가 없는 게 정상 */
function isLocalServerContext() {
  return ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
}

function updateServerBadge() {
  const badge = document.getElementById('server-badge');
  if (state.serverOk || !isLocalServerContext()) {
    // 서버 연결됨(로컬) 또는 정적 호스팅(정상) → 경고 숨김
    badge.textContent = '';
    badge.classList.remove('warn');
    return;
  }
  // 로컬인데 서버 미실행 → 파일 저장이 안 되므로 경고
  badge.textContent = '⚠ 서버 미실행 · 브라우저에만 저장됨';
  badge.classList.add('warn');
}

/* ============================== 진행 기록 ============================== */

let saveTimer = null;

/* 신규 키를 읽되, 없으면 레거시 단일 키(quiz-progress)를 1회 이전해 기존 기록 보존 */
function loadLocalProgress() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (raw == null && STORAGE_KEY !== LEGACY_KEY) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy != null) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_KEY);
      raw = legacy;
    }
  }
  try { return JSON.parse(raw || '{}'); }
  catch (_) { return {}; }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  if (!state.serverOk) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.progress, null, 2),
    }).catch(() => { state.serverOk = false; updateServerBadge(); });
  }, 400);
}

function getEntry(qid) {
  if (!state.progress[qid]) state.progress[qid] = {};
  return state.progress[qid];
}

function setResult(q, result) {
  const p = getEntry(q.id);
  p.status = result;
  p.history = (p.history || []).concat({ ts: new Date().toISOString(), result });
  saveProgress();
  const dot = document.querySelector(`#q-${cssEscape(q.id)} .status`);
  if (dot) { dot.className = 'status ' + result; dot.title = STATUS_LABEL[result]; }
}

/* ---------- 진행기록 백업/복원 ---------- */

function exportProgress() {
  const id = STORAGE_KEY.replace(/^quiz-progress:?/, '') || 'quiz';
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'quiz';
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `progress-${safe}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importProgress(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('형식 오류');
      if (confirm('현재 진행기록을 가져온 파일 내용으로 덮어씁니다. 계속할까요?')) {
        state.progress = data;
        saveProgress();
        render();
      }
    } catch (_) {
      alert('가져오기 실패: 올바른 진행기록 JSON 파일이 아닙니다.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function resetProgress() {
  if (!confirm('모든 진행기록을 삭제합니다. 되돌릴 수 없어요. 계속할까요?')) return;
  state.progress = {};
  saveProgress();
  render();
}

/* ============================== 라우팅 ============================== */

function render() {
  closePanel();
  const h = location.hash || '#/';
  if (h.startsWith('#/s/')) {
    renderSection(decodeURIComponent(h.slice(4)));
  } else if (h.startsWith('#/q/')) {
    const qid = decodeURIComponent(h.slice(4));
    const sec = state.sectionByQid.get(qid);
    if (sec) renderSection(sec.id, qid); else renderHome();
  } else {
    renderHome();
  }
  if (!h.startsWith('#/q/')) window.scrollTo(0, 0);
}

/* ============================== 홈 화면 ============================== */

function sectionStats(s) {
  const st = { total: s.questions.length, correct: 0, partial: 0, wrong: 0, none: 0 };
  for (const q of s.questions) {
    const status = (state.progress[q.id] || {}).status || 'none';
    st[status]++;
  }
  st.done = st.total - st.none;
  return st;
}

function renderHome() {
  const total = { total: 0, correct: 0, partial: 0, wrong: 0, none: 0, done: 0 };
  const cards = state.sections.map((s) => {
    const st = sectionStats(s);
    for (const k of Object.keys(total)) total[k] += st[k];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    return `
      <a class="section-card" href="#/s/${encodeURIComponent(s.id)}">
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.description || '')}</p>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="section-meta">
          <span>${st.done}/${st.total} 풀이</span>
          <span class="mini-stats">
            <b class="c-correct">${st.correct}</b> · <b class="c-partial">${st.partial}</b> · <b class="c-wrong">${st.wrong}</b>
          </span>
        </div>
      </a>`;
  }).join('');

  const review = [];
  for (const s of state.sections) {
    for (const q of s.questions) {
      const status = (state.progress[q.id] || {}).status;
      if (status === 'wrong' || status === 'partial') review.push({ q, s, status });
    }
  }
  review.sort((a, b) => priorityOf(b.q) - priorityOf(a.q)); // 중요한 것부터 복습
  const reviewHtml = review.length
    ? `<section class="review">
        <h2>🔁 복습 대상 <span class="count">${review.length}</span></h2>
        <ul>${review.map(({ q, s, status }) => `
          <li><span class="status ${status}"></span>
            <a href="#/q/${encodeURIComponent(q.id)}">${esc(firstLine(q.question))}</a>
            <span class="dim">— ${esc(s.title)}</span></li>`).join('')}
        </ul>
      </section>`
    : '';

  app.innerHTML = `
    <div class="home-head">
      <h1>iOS 기술 면접 퀴즈</h1>
      <p class="dim">총 ${total.total}문제 · ${total.done}문제 풀이 · 맞음 ${total.correct} / 애매 ${total.partial} / 틀림 ${total.wrong}</p>
      <div class="data-tools">
        <button id="export-progress" class="tool-btn" title="진행기록을 JSON 파일로 저장">⬇ 내보내기</button>
        <label class="tool-btn" for="import-progress" title="JSON 파일에서 진행기록 불러오기">⬆ 가져오기</label>
        <input id="import-progress" type="file" accept="application/json,.json" hidden>
        <button id="reset-progress" class="tool-btn danger" title="모든 진행기록 삭제">↺ 초기화</button>
      </div>
    </div>
    <div class="section-grid">${cards}</div>
    ${reviewHtml}`;

  document.getElementById('export-progress').addEventListener('click', exportProgress);
  document.getElementById('import-progress').addEventListener('change', importProgress);
  document.getElementById('reset-progress').addEventListener('click', resetProgress);
}

/* ============================== 섹션 화면 ============================== */

function renderSection(sectionId, focusQid) {
  const s = state.sections.find((x) => x.id === sectionId);
  if (!s) { renderHome(); return; }
  // 섹션이 바뀌거나 특정 문제로 이동할 때만 필터 초기화 (필터 칩 클릭 시에는 유지)
  if (focusQid || state.lastSection !== sectionId) state.filter = 'all';
  state.lastSection = sectionId;

  app.innerHTML = `
    <div class="section-head">
      <a class="back" href="#/">← 홈</a>
      <h1>${esc(s.title)}</h1>
      <p class="dim">${esc(s.description || '')}</p>
      <div class="filters">
        ${[['all', '전체'], ['none', '안 푼 문제'], ['wrong', '틀린 문제'], ['partial', '애매한 문제'], ['correct', '맞춘 문제']]
          .map(([k, label]) => `<button class="chip ${state.filter === k ? 'active' : ''}" data-filter="${k}">${label}</button>`).join('')}
      </div>
    </div>
    <div id="qlist"></div>`;

  app.querySelectorAll('.chip[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      renderSection(sectionId);
    });
  });

  const list = document.getElementById('qlist');
  const filtered = s.questions.filter((q) => {
    if (state.filter === 'all') return true;
    const status = (state.progress[q.id] || {}).status || 'none';
    return status === state.filter;
  });
  if (!filtered.length) {
    list.innerHTML = '<p class="dim empty">해당하는 문제가 없습니다.</p>';
    return;
  }
  const sorted = [...filtered].sort((a, b) => priorityOf(b) - priorityOf(a));
  for (const q of sorted) list.appendChild(questionCard(q, q.id === focusQid));

  if (focusQid) {
    const el = document.getElementById('q-' + focusQid);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

/* ============================== 문제 카드 ============================== */

function questionCard(q, expanded) {
  const p = state.progress[q.id] || {};
  const status = p.status || 'none';
  const tier = tierOf(q);
  const card = document.createElement('article');
  card.className = 'qcard';
  card.id = 'q-' + q.id;
  card.innerHTML = `
    <div class="qhead" role="button" tabindex="0">
      <span class="status ${status}" title="${STATUS_LABEL[status]}"></span>
      <span class="tier tier-${tier.key}" title="우선순위 ${priorityOf(q).toFixed(2)}">${tier.key} ${tier.label}</span>
      <span class="qtitle"></span>
      <span class="qbadges">
        <span class="diff">${'★'.repeat(q.difficulty || 1)}</span>
        <span class="badge ${q.type}">${q.type === 'choice' ? '객관식' : '주관식'}</span>
      </span>
    </div>
    <div class="qbody hidden"></div>`;
  card.querySelector('.qtitle').textContent = firstLine(q.question);

  const head = card.querySelector('.qhead');
  const body = card.querySelector('.qbody');
  const toggle = () => {
    if (!body.dataset.built) { buildBody(q, body); body.dataset.built = '1'; }
    body.classList.toggle('hidden');
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  if (expanded) toggle();
  return card;
}

function buildBody(q, body) {
  const p = getEntry(q.id);

  const qText = document.createElement('div');
  qText.className = 'qtext';
  qText.innerHTML = md(q.question);
  linkifyElement(qText);
  body.appendChild(qText);

  if (q.eval) {
    const meta = document.createElement('div');
    meta.className = 'eval-meta';
    const parts = Object.keys(EVAL_WEIGHTS).map((k) => `${EVAL_LABEL[k]} ${q.eval[k]}`);
    meta.textContent = `우선순위 ${priorityOf(q).toFixed(2)} · ${parts.join(' · ')}`
      + (q.coverage ? ` · ${COVERAGE_LABEL[q.coverage] || q.coverage}` : '');
    body.appendChild(meta);
  }

  if (q.keywords && q.keywords.length) {
    const kw = document.createElement('div');
    kw.className = 'keywords';
    for (const id of q.keywords) {
      const t = state.termById.get(id);
      if (!t) continue;
      const chip = document.createElement('span');
      chip.className = 'term chip-term';
      chip.dataset.term = id;
      chip.textContent = '# ' + t.term;
      kw.appendChild(chip);
    }
    body.appendChild(kw);
  }

  if (q.type === 'choice') buildChoiceBody(q, body);
  else buildShortBody(q, body, p);

  if (q.related && q.related.length) {
    const rel = document.createElement('div');
    rel.className = 'related';
    rel.innerHTML = '<span class="dim">연관 문제:</span> ';
    q.related.forEach((rid, i) => {
      const rq = state.questionById.get(rid);
      if (!rq) return;
      if (i > 0) rel.appendChild(document.createTextNode(' · '));
      const a = document.createElement('a');
      a.href = '#/q/' + encodeURIComponent(rid);
      a.textContent = firstLine(rq.question);
      rel.appendChild(a);
    });
    body.appendChild(rel);
  }
}

/* --- 객관식 --- */
function buildChoiceBody(q, body) {
  const wrap = document.createElement('div');
  wrap.className = 'choices';
  let answered = false;

  const explain = document.createElement('div');
  explain.className = 'answer hidden';

  const buttons = q.choices.map((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.innerHTML = `<span class="num">${i + 1}</span> ${md(c).replace(/^<p>|<\/p>$/g, '')}`;
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      buttons.forEach((b, j) => {
        b.disabled = true;
        if (j === q.correctIndex) b.classList.add('correct');
      });
      const ok = i === q.correctIndex;
      if (!ok) btn.classList.add('wrong');
      explain.innerHTML = `<div class="verdict ${ok ? 'ok' : 'no'}">${ok ? '⭕ 정답!' : '❌ 오답 — 정답은 ' + (q.correctIndex + 1) + '번'}</div>` + md(q.explanation || '');
      linkifyElement(explain);
      explain.classList.remove('hidden');
      retry.classList.remove('hidden');
      setResult(q, ok ? 'correct' : 'wrong');
    });
    wrap.appendChild(btn);
    return btn;
  });
  body.appendChild(wrap);
  body.appendChild(explain);

  const retry = document.createElement('button');
  retry.className = 'ghost hidden';
  retry.textContent = '다시 풀기';
  retry.addEventListener('click', () => {
    answered = false;
    buttons.forEach((b) => { b.disabled = false; b.classList.remove('correct', 'wrong'); });
    explain.classList.add('hidden');
    retry.classList.add('hidden');
  });
  body.appendChild(retry);
}

/* --- 주관식 --- */
function buildShortBody(q, body, p) {
  const ta = document.createElement('textarea');
  ta.className = 'my-answer';
  ta.placeholder = '내 답을 먼저 적어보세요 (선택, 자동 저장)';
  ta.value = p.myAnswer || '';
  let taTimer = null;
  ta.addEventListener('input', () => {
    clearTimeout(taTimer);
    taTimer = setTimeout(() => { getEntry(q.id).myAnswer = ta.value; saveProgress(); }, 400);
  });
  body.appendChild(ta);

  const reveal = document.createElement('button');
  reveal.className = 'primary';
  reveal.textContent = '정답 보기';
  body.appendChild(reveal);

  const answer = document.createElement('div');
  answer.className = 'answer hidden';
  body.appendChild(answer);

  const grade = document.createElement('div');
  grade.className = 'grade hidden';
  grade.innerHTML = '<span class="dim">스스로 채점:</span>';
  [['correct', '⭕ 맞았다'], ['partial', '🔺 애매하다'], ['wrong', '❌ 틀렸다']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'grade-btn ' + k;
    b.textContent = label;
    b.addEventListener('click', () => {
      setResult(q, k);
      grade.querySelectorAll('.grade-btn').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    grade.appendChild(b);
  });
  body.appendChild(grade);

  reveal.addEventListener('click', () => {
    if (!answer.dataset.built) {
      answer.innerHTML = md(q.answer);
      linkifyElement(answer);
      answer.dataset.built = '1';
    }
    answer.classList.toggle('hidden');
    grade.classList.toggle('hidden', answer.classList.contains('hidden'));
    reveal.textContent = answer.classList.contains('hidden') ? '정답 보기' : '정답 숨기기';
  });
}

/* ============================== 용어 패널 ============================== */

function openTerm(id) {
  if (!state.termById.has(id)) return;
  state.panelStack.push(id);
  renderPanel();
}

function closePanel() {
  state.panelStack = [];
  panel.classList.add('hidden');
}

function renderPanel() {
  const id = state.panelStack[state.panelStack.length - 1];
  const t = state.termById.get(id);
  if (!t) return;

  panel.innerHTML = `
    <div class="panel-head">
      <button class="ghost panel-back ${state.panelStack.length > 1 ? '' : 'hidden'}">← 이전</button>
      <button class="ghost panel-close">✕ 닫기</button>
    </div>
    <h2 class="panel-term">${esc(t.term)}</h2>
    ${t.aliases && t.aliases.length ? `<p class="dim aliases">${t.aliases.map(esc).join(' · ')}</p>` : ''}
    <div class="panel-def"></div>
    <div class="panel-related"></div>
    <div class="panel-questions"></div>`;

  panel.querySelector('.panel-close').addEventListener('click', closePanel);
  panel.querySelector('.panel-back').addEventListener('click', () => {
    state.panelStack.pop();
    renderPanel();
  });

  const def = panel.querySelector('.panel-def');
  def.innerHTML = md(t.definition);
  linkifyElement(def, id); // 자기 자신은 링크 제외 → 연관 용어로 계속 탐색 가능

  const relBox = panel.querySelector('.panel-related');
  const related = (t.related || []).filter((rid) => state.termById.has(rid));
  if (related.length) {
    relBox.innerHTML = '<h3>연관 용어</h3>';
    for (const rid of related) {
      const chip = document.createElement('span');
      chip.className = 'term chip-term';
      chip.dataset.term = rid;
      chip.textContent = '# ' + state.termById.get(rid).term;
      relBox.appendChild(chip);
    }
  }

  const qBox = panel.querySelector('.panel-questions');
  const qs = [];
  for (const s of state.sections) {
    for (const q of s.questions) {
      if ((q.keywords || []).includes(id)) qs.push({ q, s });
    }
  }
  if (qs.length) {
    qBox.innerHTML = '<h3>이 용어가 나오는 문제</h3>';
    const ul = document.createElement('ul');
    for (const { q, s } of qs) {
      const li = document.createElement('li');
      const status = (state.progress[q.id] || {}).status || 'none';
      li.innerHTML = `<span class="status ${status}"></span>`;
      const a = document.createElement('a');
      a.href = '#/q/' + encodeURIComponent(q.id);
      a.textContent = firstLine(q.question);
      a.addEventListener('click', closePanel);
      li.appendChild(a);
      li.insertAdjacentHTML('beforeend', ` <span class="dim">— ${esc(s.title)}</span>`);
      ul.appendChild(li);
    }
    qBox.appendChild(ul);
  }

  panel.classList.remove('hidden');
}

/* ============================== 용어 자동 링크 ============================== */

function linkifyElement(root, excludeId) {
  if (!state.termRegex) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (n.parentElement && n.parentElement.closest('code, pre, a, .term, button, textarea')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  const isWord = (c) => !!c && /[A-Za-z0-9]/.test(c);

  for (const node of nodes) {
    const text = node.nodeValue;
    state.termRegex.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = state.termRegex.exec(text))) {
      const start = m.index, end = start + m[0].length;
      // 영단어 경계 확인 (Flow가 workflow에 매칭되는 것 방지)
      if ((isWord(text[start - 1]) && isWord(m[0][0])) ||
          (isWord(text[end]) && isWord(m[0][m[0].length - 1]))) continue;
      const tid = state.termMap.get(m[0].toLowerCase());
      if (!tid || tid === excludeId) continue;
      if (!frag) frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(text.slice(last, start)));
      const span = document.createElement('span');
      span.className = 'term';
      span.dataset.term = tid;
      span.textContent = m[0];
      frag.appendChild(span);
      last = end;
    }
    if (frag) {
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.replaceWith(frag);
    }
  }
}

/* ============================== 미니 마크다운 ============================== */

function md(src) {
  if (!src) return '';
  const blocks = [];
  src = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });

  let out = esc(src)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  const lines = out.split('\n');
  let html = '', inList = false, para = [];
  const flushPara = () => {
    if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; }
  };
  for (const line of lines) {
    const block = line.match(/^\u0000(\d+)\u0000$/);
    const item = line.match(/^\s*[-•]\s+(.*)$/);
    if (block) {
      if (inList) { html += '</ul>'; inList = false; }
      flushPara();
      html += line;
    } else if (item) {
      flushPara();
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + item[1] + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') flushPara();
      else para.push(line);
    }
  }
  if (inList) html += '</ul>';
  flushPara();
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

/* ============================== 유틸 ============================== */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstLine(s) {
  const line = String(s).split('\n')[0].replace(/\*\*/g, '').replace(/`/g, '');
  return line.length > 90 ? line.slice(0, 90) + '…' : line;
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
