/* ===== 멘토링 파이썬 기말 — 인터랙티브 학습 앱 v2 ===== */
(function () {
"use strict";
const DATA = window.QUIZ_DATA;
if (!DATA || !DATA.questions) {
  var _m = document.getElementById("main");
  if (_m) _m.innerHTML = '<div class="empty">⚠ 학습 데이터를 불러오지 못했습니다.<br><br>이 화면이 보이면 브라우저가 자바스크립트를 막고 있는 것입니다.<br><b>카카오톡·메신저의 내장 브라우저 대신 Safari나 Chrome으로 열어주세요.</b></div>';
  return;
}
const QS = DATA.questions, CH = DATA.chapters;
const chMap = {}; CH.forEach(c => chMap[c.ch] = c);
const qById = id => QS.find(q => q.id === id);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- 상태 (localStorage) ---------- */
const KEY = "pyquiz_v2";
let S = { prog: {}, bm: {}, theme: "light", view: "learn", cram: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
// v1 -> v2 마이그레이션
try { if (!localStorage.getItem(KEY)) { const v1 = JSON.parse(localStorage.getItem("pyquiz_v1") || "{}");
  if (v1.prog) { S.prog = v1.prog; S.bm = v1.bm || {}; S.theme = v1.theme || "light"; } } } catch (e) {}
S.prog = S.prog || {}; S.bm = S.bm || {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const now = () => Date.now();

/* ---------- SRS (5박스 Leitner) ---------- */
const DAY = 864e5;
const BOX_MS = [0, 15 * 60e3, DAY, 3 * DAY, 7 * DAY, 14 * DAY];
const CRAM_MS = [0, 60e3, 3 * 60e3, 8 * 60e3, 20 * 60e3, 45 * 60e3];
const BOX_NAME = ["미학습", "불안정", "학습중", "익숙", "탄탄", "숙달"];
function boxMs(b) { b = Math.max(0, Math.min(5, b)); return (S.cram ? CRAM_MS : BOX_MS)[b]; }
function recordAnswer(q, correct, confident, pick) {
  const p = S.prog[q.id] || { box: 0, attempts: 0, firstTry: null, lapses: 0 };
  if (!p.attempts) p.firstTry = !!correct;       // 첫 시도 정답 여부(대시보드용, 한 번만)
  p.attempts = (p.attempts || 0) + 1;
  p.status = correct ? "correct" : "wrong";
  p.pick = pick; p.lastResult = !!correct; p.lastConfidence = !!confident; p.lastAt = now();
  if (!correct) { p.box = 1; p.lapses = (p.lapses || 0) + 1; }
  else if (confident) { p.box = Math.min(5, (p.box || 0) + 1); }
  else { p.box = Math.max(1, p.box || 1); }       // 맞았지만 찍음 → 승급 보류
  p.dueAt = now() + boxMs(p.box);
  S.prog[q.id] = p; save();
}
function markGuessed(q) {                          // "사실 찍었어요" → 승급 취소
  const p = S.prog[q.id]; if (!p) return;
  p.lastConfidence = false; p.box = Math.max(1, (p.box || 1) - 1);
  p.dueAt = now() + boxMs(p.box); save();
}
function isDue(id) { const p = S.prog[id]; return p && p.box >= 1 && (p.dueAt || 0) <= now(); }
function dueList() {
  let arr = QS.filter(q => {
    const p = S.prog[q.id]; if (!p) return false;
    if (S.cram) return p.box <= 3 || p.lastResult === false; // 벼락치기: 약한 것 폭넓게
    return isDue(q.id);
  });
  arr.sort((a, b) => {
    const pa = S.prog[a.id], pb = S.prog[b.id];
    if ((pa.box || 9) !== (pb.box || 9)) return (pa.box || 9) - (pb.box || 9); // 낮은 박스 먼저
    return (pa.dueAt || 0) - (pb.dueAt || 0);
  });
  return arr;
}

/* ---------- 파이썬 구문 강조 (라인 단위) ---------- */
const KW = new Set(("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
const BI = new Set(("print len range int str float list dict set tuple bool abs sum min max sorted enumerate zip map filter open type isinstance id input round any all chr ord super object Exception ValueError KeyError IndexError TypeError AttributeError NotImplementedError append insert pop remove sort index count keys values items get add discard split join strip lstrip rstrip replace upper lower capitalize title startswith endswith isdigit isalpha islower isspace format encode read readline readlines write close seek tell").split(" "));
function hi(line) {
  let out = "", i = 0, n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === "#") { out += `<span class="tk-co">${esc(line.slice(i))}</span>`; break; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n && line[j] !== c) { if (line[j] === "\\") j++; j++; }
      out += `<span class="tk-str">${esc(line.slice(i, j + 1))}</span>`; i = j + 1; continue;
    }
    if (/[0-9]/.test(c) && (i === 0 || !/[A-Za-z_]/.test(line[i - 1]))) {
      let j = i; while (j < n && /[0-9.]/.test(line[j])) j++;
      out += `<span class="tk-num">${esc(line.slice(i, j))}</span>`; i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_]/.test(line[j])) j++;
      const w = line.slice(i, j);
      const cls = KW.has(w) ? "tk-kw" : (BI.has(w) ? "tk-bi" : "");
      out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w); i = j; continue;
    }
    if (/[-+*/%=<>!&|^~.,:()\[\]{}]/.test(c)) { out += `<span class="tk-op">${esc(c)}</span>`; i++; continue; }
    out += esc(c); i++;
  }
  return out || "&nbsp;";
}

/* ---------- 코드 위젯 + 단계별 실행 애니메이션 ---------- */
let widgetSeq = 0; const ANIM = {};
function codeWidget(lines, trace) {
  const id = "cw" + (widgetSeq++);
  const lh = lines.map((l, k) => `<span class="ln" data-l="${k + 1}">${hi(l)}</span>`).join("");
  const playBtn = trace ? `<button class="play" data-cw="${id}">▶ 단계별 실행</button>` : "";
  const anim = trace ? `
    <div class="anim" id="${id}-anim">
      <div class="pane"><h5>변수 상태</h5><div class="vars" id="${id}-vars"><span class="nochg">실행 전</span></div></div>
      <div class="pane"><h5>출력</h5><div class="outbox" id="${id}-out"></div></div>
      <div class="animctl">
        <button data-act="reset" data-cw="${id}">⟲</button>
        <button data-act="prev" data-cw="${id}">◀ 이전</button>
        <button data-act="play" data-cw="${id}">▶ 자동</button>
        <button data-act="next" data-cw="${id}">다음 ▶</button>
        <span class="stepinfo" id="${id}-info"></span>
      </div>
    </div>` : "";
  const el = document.createElement("div");
  el.className = "codewrap";
  el.innerHTML = `<div class="codetop"><span class="dot"></span><span class="dot y"></span><span class="dot g"></span>${playBtn}</div>
    <pre class="code" id="${id}-pre">${lh}</pre>${anim}`;
  if (trace) ANIM[id] = { lines, trace, step: -1, timer: null };
  return el;
}
function animRender(id) {
  const A = ANIM[id]; if (!A) return;
  const pre = $("#" + id + "-pre");
  $$(".ln", pre).forEach(e => e.classList.remove("active", "errln"));
  const info = $("#" + id + "-info");
  if (A.step < 0) { $("#" + id + "-vars").innerHTML = '<span class="nochg">실행 전</span>'; $("#" + id + "-out").textContent = ""; info.textContent = ""; return; }
  const st = A.trace[A.step], prev = A.step > 0 ? A.trace[A.step - 1] : { vars: {} };
  if (st.line) { const ln = pre.querySelector(`.ln[data-l="${st.line}"]`); if (ln) ln.classList.add(st.error ? "errln" : "active"); }
  const vk = Object.keys(st.vars || {});
  $("#" + id + "-vars").innerHTML = vk.length
    ? vk.map(k => `<div class="v${prev.vars[k] !== st.vars[k] ? " chg" : ""}"><span class="vk">${esc(k)}</span>=<span>${esc(st.vars[k])}</span></div>`).join("")
    : '<span class="nochg">(아직 변수 없음)</span>';
  const ob = $("#" + id + "-out"); ob.textContent = st.out || "";
  if (st.error) ob.innerHTML += `<span class="err">⚠ ${esc(st.error)}</span>`;
  info.textContent = `${A.step + 1} / ${A.trace.length}` + (st.final ? " · 완료" : "");
}
function animStep(id, d) { const A = ANIM[id]; if (!A) return; A.step = Math.max(-1, Math.min(A.trace.length - 1, A.step + d)); animRender(id); }
function animPlay(id, btn) {
  const A = ANIM[id]; if (!A) return;
  if (A.timer) { clearInterval(A.timer); A.timer = null; btn.textContent = "▶ 자동"; return; }
  if (A.step >= A.trace.length - 1) A.step = -1;
  btn.textContent = "⏸ 정지";
  A.timer = setInterval(() => { if (A.step >= A.trace.length - 1) { clearInterval(A.timer); A.timer = null; btn.textContent = "▶ 자동"; return; } animStep(id, 1); }, 900);
}
function enhanceBlocks(container, blocks) {
  $$(".codeblk", container).forEach(div => { const cb = blocks && blocks[+div.dataset.i]; if (cb) div.replaceWith(codeWidget(cb.display, cb.trace)); });
}

/* ---------- 문제 카드 (학습·복습 공통) ---------- */
function tagChips(q) {
  let h = "";
  if (q.difficulty) h += `<span class="tg diff-${q.difficulty}">${q.difficulty}</span>`;
  if (q.concept) h += `<span class="tg concept">${esc(q.concept)}</span>`;
  (q.traps || []).forEach(t => h += `<span class="tg trap">⚠ ${esc(t)}</span>`);
  return h;
}
function cardHTML(q) {
  const star = S.bm[q.id] ? "on" : "";
  const badge = q.sec === "sub" ? `<span class="badge sub">주관식</span>` : `<span class="badge">객관식</span>`;
  const opts = q.options.map(o => `<li class="opt" data-m="${esc(o.m)}"><span class="m">${esc(o.m)}</span><span>${esc(o.t)}</span></li>`).join("");
  return `<div class="card" id="q-${q.id}" data-id="${q.id}">
    <div class="qhead">${badge}<span class="badge">제${q.ch}장 · ${q.num}번</span>${tagChips(q)}<span class="sp"></span>
      <button class="star ${star}" data-star="${q.id}" title="북마크">★</button></div>
    <div class="stem">${esc(q.stem)}</div>
    <div class="codeslot"></div>
    ${q.sec === "obj" ? `<ul class="opts">${opts}</ul>` :
      `<div class="subans"><input type="text" placeholder="답을 입력…" data-sub="${q.id}"><button class="btn sm" data-subchk="${q.id}">확인</button></div>`}
    <div class="ansslot"></div>
  </div>`;
}
function mountCard(card, q) {
  if (q.code && q.code.length) $(".codeslot", card).appendChild(codeWidget(q.code, q.codeTrace));
  else $(".codeslot", card).remove();
  const done = S.prog[q.id];
  // 복습 뷰에서는 능동 회상을 위해 항상 새로 풀게 한다(정답 미공개)
  if (S.view !== "review" && done && done.status) { if (q.sec === "obj") revealAnswer(card, q, done.pick); else restoreSub(card, q, done); return; }
  showStudy(card, q);
}
function answerBox(q) { return `<div class="answer">정답: ${esc(q.answer)} ${esc(q.answerText)}</div>`; }
function retryBtn(q) { return `<button class="reveal-btn retry" data-retry="${q.id}">🔄 다시 풀기</button>`; }
function explBox(q) { const d = document.createElement("div"); d.className = "expl"; d.innerHTML = q.explHtml; enhanceBlocks(d, q.codeBlocks); return d; }
function rerenderCard(id) {
  const q = qById(id), old = document.getElementById("q-" + id); if (!q || !old) return;
  const tmp = document.createElement("div"); tmp.innerHTML = cardHTML(q);
  const fresh = tmp.firstElementChild; old.replaceWith(fresh); mountCard(fresh, q);
}
function markOptions(card, q, pick) {
  $$(".opt", card).forEach(o => { const m = o.dataset.m; if (m === q.answer) o.classList.add("right"); else if (pick && m === pick) o.classList.add("wrong"); });
}
function confidenceLink(q) {  // 정답 맞힌 직후 "사실 찍었어요"
  return `<button class="guess-link" data-guess="${q.id}">🤔 사실 찍었어요 (복습에 다시 넣기)</button>`;
}
function revealAnswer(card, q, pick) {
  card.classList.add("done"); card.classList.remove("correct", "wrong");
  const ok = pick != null && pick === q.answer;
  if (pick != null) card.classList.add(ok ? "correct" : "wrong");
  if (q.sec === "obj") markOptions(card, q, pick);
  const sa = $(".subans", card); if (sa) sa.remove();
  const slot = $(".ansslot", card);
  const guess = (ok && S.prog[q.id] && S.prog[q.id].lastConfidence !== false) ? confidenceLink(q) : "";
  slot.innerHTML = answerBox(q) + retryBtn(q) + guess;
  slot.appendChild(explBox(q));
}
function restoreSub(card, q, done) {
  card.classList.add("done", done.status);
  const sa = $(".subans", card); if (sa) sa.remove();
  const slot = $(".ansslot", card); slot.innerHTML = answerBox(q) + retryBtn(q); slot.appendChild(explBox(q));
}
function showStudy(card, q) {
  const slot = $(".ansslot", card);
  slot.innerHTML = `<button class="reveal-btn" data-reveal="1">💡 정답·해설 보기</button>`;
  $("[data-reveal]", slot).onclick = () => {
    card.classList.add("done"); recordAnswer(q, q.answer, false, null); // 그냥 보기 = 미정답 취급(복습 예약)
    slot.innerHTML = answerBox(q) + retryBtn(q);
    if (q.sec === "obj") markOptions(card, q, null);
    const sa = $(".subans", card); if (sa) sa.remove();
    slot.appendChild(explBox(q)); updateProgress(); refreshNav();
  };
}
function onPick(card, q, m) {
  if (card.classList.contains("done")) return;
  const ok = m === q.answer;
  recordAnswer(q, ok, ok, m);              // 정답이면 일단 '확신'으로 기록(아래 '찍었어요'로 정정 가능)
  revealAnswer(card, q, m);
  updateProgress(); refreshNav();
  toast(ok ? "정답! 🎉" : "오답 — 해설을 확인하세요");
}
function onSubCheck(card, q) {
  const inp = $(`[data-sub="${q.id}"]`, card), slot = $(".ansslot", card);
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const guess = norm(inp.value);
  const auto = guess && (norm(q.answerText).includes(guess) || guess.includes(norm(q.answerText)));
  slot.innerHTML = answerBox(q);
  const self = document.createElement("div");
  self.innerHTML = `<div class="selfgrade">스스로 채점:
    <button class="btn sm" data-self="correct">✅ 맞음</button>
    <button class="reveal-btn" data-self="unsure">🤔 헷갈림</button>
    <button class="reveal-btn" data-self="wrong">❌ 틀림</button>
    ${auto ? '<span class="autohit">· 자동판정: 정답에 가까움 ✓</span>' : ''}</div>`;
  slot.appendChild(self); slot.appendChild(explBox(q));
  self.querySelectorAll("[data-self]").forEach(b => b.onclick = () => {
    const v = b.dataset.self;
    recordAnswer(q, v !== "wrong", v === "correct", inp.value);
    card.classList.add("done"); card.classList.remove("correct", "wrong"); card.classList.add(v === "wrong" ? "wrong" : "correct");
    self.querySelector(".selfgrade").innerHTML = "기록됨 — " + (v === "correct" ? "맞음 ✅" : v === "unsure" ? "헷갈림 🤔 (복습 예약)" : "틀림 ❌ (복습 예약)");
    updateProgress(); refreshNav();
  });
}

/* ---------- 진도/네비 ---------- */
function updateProgress() {
  const ids = QS.map(q => q.id);
  const done = ids.filter(i => S.prog[i] && S.prog[i].status).length;
  const correct = ids.filter(i => S.prog[i] && S.prog[i].firstTry).length;
  const pct = Math.round(done / ids.length * 100);
  $("#progbar").style.width = Math.max(2, pct) + "%";
  $("#progtext").textContent = `진도 ${done}/${ids.length} (${pct}%) · 첫시도 정답 ${correct}`;
}
function refreshNav() {
  const n = dueList().length;
  const b = $("#reviewCount"); if (b) { b.textContent = n ? n : ""; b.style.display = n ? "" : "none"; }
}

/* ---------- 필터 + 학습 뷰 ---------- */
let F = { ch: "all", type: "all", st: "all", q: "", concept: "" };
let _io = null;
function match(q) {
  if (F.concept && q.concept !== F.concept) return false;
  if (F.ch !== "all" && q.ch !== +F.ch) return false;
  if (F.type !== "all" && q.sec !== F.type) return false;
  const p = S.prog[q.id];
  if (F.st === "unseen" && p && p.status) return false;
  if (F.st === "wrong" && !(p && p.status === "wrong")) return false;
  if (F.st === "bookmark" && !S.bm[q.id]) return false;
  if (F.q) { const hay = (q.stem + " " + q.code.join(" ") + " " + q.options.map(o => o.t).join(" ") + " " + q.concept + " " + q.explHtml).toLowerCase(); if (!hay.includes(F.q.toLowerCase())) return false; }
  return true;
}
function fullChapterView() { return F.ch !== "all" && F.type === "all" && F.st === "all" && !F.q && !F.concept; }
function emitOp(main, op) {
  if (op.t === "intro") { const i = document.createElement("details"); i.className = "chapter-intro"; i.innerHTML = `<summary>${esc(op.c.title)} — 개념 한눈에 보기</summary>${op.c.conceptHtml}`; enhanceBlocks(i, op.c.conceptBlocks); main.appendChild(i); }
  else if (op.t === "sec") { const h = document.createElement("div"); h.className = "sec-title"; h.textContent = op.text; main.appendChild(h); }
  else if (op.t === "card") { const tmp = document.createElement("div"); tmp.innerHTML = cardHTML(op.q); const c = tmp.firstElementChild; main.appendChild(c); mountCard(c, op.q); }
  else if (op.t === "mini") { const m = document.createElement("div"); m.className = "mini-wrap"; m.innerHTML = op.c.miniHtml; enhanceBlocks(m, op.c.miniBlocks); main.appendChild(m); }
}
function lazyRender(main, ops) {
  let idx = 0; const BATCH = 14;
  function more() {
    if (_io) { _io.disconnect(); _io = null; }
    const old = document.getElementById("sentinel"); if (old) old.remove();
    let cards = 0;
    while (idx < ops.length && cards < BATCH) { const op = ops[idx++]; emitOp(main, op); if (op.t === "card") cards++; }
    if (idx < ops.length) { const s = document.createElement("div"); s.id = "sentinel"; s.style.height = "1px"; main.appendChild(s); _io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: "800px" }); _io.observe(s); }
  }
  more();
}
function renderLearn() {
  const main = $("#main"); main.innerHTML = "";
  if (F.concept) main.appendChild(conceptBanner());
  const list = QS.filter(match);
  if (!list.length) { main.insertAdjacentHTML("beforeend", `<div class="empty">조건에 맞는 문제가 없습니다.</div>`); return; }
  const byCh = {}; list.forEach(q => (byCh[q.ch] = byCh[q.ch] || []).push(q));
  const showIntro = fullChapterView();
  const ops = [];
  Object.keys(byCh).map(Number).sort((a, b) => a - b).forEach(ch => {
    const c = chMap[ch];
    ops.push(showIntro && c.conceptHtml ? { t: "intro", c } : { t: "sec", text: c.title });
    const obj = byCh[ch].filter(q => q.sec === "obj"), sub = byCh[ch].filter(q => q.sec === "sub");
    [["Ⅰ. 객관식", obj], ["Ⅱ. 주관식", sub]].forEach(([title, arr]) => { if (!arr.length) return; if (showIntro) ops.push({ t: "sec", text: title }); arr.forEach(q => ops.push({ t: "card", q })); });
    if (showIntro && c.miniHtml) ops.push({ t: "mini", c });
  });
  lazyRender(main, ops);
}
function conceptBanner() {
  const d = document.createElement("div"); d.className = "concept-banner";
  d.innerHTML = `🎯 <b>${esc(F.concept)}</b> 개념 집중 학습 중 <button class="ghost" id="clearConcept">✕ 해제</button>`;
  return d;
}

/* ---------- 복습 뷰 (SRS) ---------- */
function renderReview() {
  const main = $("#main"); main.innerHTML = "";
  const head = document.createElement("div"); head.className = "review-head";
  const list = dueList();
  head.innerHTML = `<div class="rh-title">🔁 복습 큐 <b>${list.length}</b>문항
      <label class="cram"><input type="checkbox" id="cramChk" ${S.cram ? "checked" : ""}> 🔥 벼락치기 모드</label></div>
    <div class="rh-sub">${S.cram ? "약한 문제를 폭넓게, 짧은 간격으로 반복합니다." : "틀리거나 헷갈린 문제가 복습 시점이 되면 여기 모입니다."}</div>`;
  main.appendChild(head);
  if (!list.length) {
    const future = QS.map(q => S.prog[q.id]).filter(p => p && p.box >= 1 && p.dueAt > now()).sort((a, b) => a.dueAt - b.dueAt)[0];
    const msg = future ? `다음 복습 예정: <b>${fmtWhen(future.dueAt)}</b> 후` : "아직 복습할 문제가 없습니다. 학습 탭에서 문제를 풀어보세요!";
    main.insertAdjacentHTML("beforeend", `<div class="empty">🎉 지금 복습할 문제가 없습니다.<br><br>${msg}</div>`);
    return;
  }
  lazyRender(main, list.map(q => ({ t: "card", q })));
}
function fmtWhen(ts) {
  const d = ts - now(); if (d <= 0) return "지금";
  const m = Math.round(d / 60e3); if (m < 60) return m + "분"; const h = Math.round(m / 60); if (h < 24) return h + "시간"; return Math.round(h / 24) + "일";
}

/* ---------- 대시보드 ---------- */
function stat() {
  const attempted = id => S.prog[id] && S.prog[id].status;
  // 장별
  const byCh = CH.map(c => {
    const qs = QS.filter(q => q.ch === c.ch), at = qs.filter(q => attempted(q.id));
    const ft = at.filter(q => S.prog[q.id].firstTry).length;
    const mastered = qs.filter(q => (S.prog[q.id] || {}).box >= 4).length;
    return { ch: c.ch, title: c.title, total: qs.length, attempted: at.length, ftAcc: at.length ? ft / at.length : null, mastered };
  });
  // 개념별 약점
  const cm = {};
  QS.forEach(q => { if (!q.concept) return; const e = cm[q.concept] = cm[q.concept] || { total: 0, at: 0, ft: 0, due: 0 }; e.total++; const p = S.prog[q.id]; if (p && p.status) { e.at++; if (p.firstTry) e.ft++; if (isDue(q.id)) e.due++; } });
  const weak = Object.entries(cm).filter(([k, v]) => v.at >= 2).map(([k, v]) => ({ concept: k, acc: v.ft / v.at, at: v.at, total: v.total, due: v.due, score: (1 - v.ft / v.at) * 2 + v.due * 0.5 })).sort((a, b) => b.score - a.score).slice(0, 5);
  // 스킬별 실수
  const sk = {};
  QS.forEach(q => { const p = S.prog[q.id]; if (!p || p.firstTry !== false) return; (q.skills || []).forEach(s => sk[s] = (sk[s] || 0) + 1); });
  const skillMiss = Object.entries(sk).sort((a, b) => b[1] - a[1]);
  // 종합
  const allAt = QS.filter(q => attempted(q.id));
  const ftAccAll = allAt.length ? allAt.filter(q => S.prog[q.id].firstTry).length / allAt.length : 0;
  const coverage = allAt.length / QS.length;
  const maturity = QS.filter(q => (S.prog[q.id] || {}).box >= 4).length / QS.length;
  return { byCh, weak, skillMiss, allAt: allAt.length, ftAccAll, coverage, maturity };
}
function readiness(s) {
  if (s.allAt < 25) return { label: "데이터 부족", cls: "r0", desc: "문제를 더 풀면 준비도가 표시됩니다." };
  const score = s.ftAccAll * 0.55 + s.coverage * 0.25 + s.maturity * 0.20;
  if (score >= 0.8) return { label: "시험 준비 완료", cls: "r4", desc: "탄탄합니다! 모의시험으로 확인하세요." };
  if (score >= 0.6) return { label: "거의 준비됨", cls: "r3", desc: "약점 개념만 보완하면 됩니다." };
  if (score >= 0.4) return { label: "보완 필요", cls: "r2", desc: "약점 개념 위주로 복습하세요." };
  return { label: "기초 다지기", cls: "r1", desc: "장별 개념부터 차근차근 풀어보세요." };
}
function pct(x) { return x == null ? "—" : Math.round(x * 100) + "%"; }
function renderDashboard() {
  const main = $("#main"); main.innerHTML = "";
  const s = stat(), r = readiness(s), due = dueList().length;
  const wrap = document.createElement("div"); wrap.className = "dash";
  // Today's plan
  let cta;
  if (due) cta = { txt: `🔁 복습할 ${due}문항 풀기`, act: "go-review" };
  else if (s.weak.length) cta = { txt: `🔥 약점 «${s.weak[0].concept}» 집중 학습`, act: "drill", concept: s.weak[0].concept };
  else if (s.allAt < QS.length) cta = { txt: `📚 안 푼 문제 이어 풀기`, act: "go-learn-unseen" };
  else cta = { txt: `📝 모의시험으로 점검하기`, act: "go-exam" };
  wrap.innerHTML = `
    <div class="widget plan"><div class="w-label">오늘의 학습</div>
      <button class="cta" data-act="${cta.act}" data-concept="${esc(cta.concept || "")}">${cta.txt}</button></div>
    <div class="dash-row">
      <div class="widget ready ${r.cls}"><div class="w-label">시험 준비도</div><div class="ready-label">${r.label}</div><div class="ready-desc">${r.desc}</div></div>
      <div class="widget"><div class="w-label">진행 요약</div>
        <div class="kv"><span>푼 문항</span><b>${s.allAt}/${QS.length}</b></div>
        <div class="kv"><span>첫시도 정답률</span><b>${pct(s.ftAccAll)}</b></div>
        <div class="kv"><span>숙달(복습 안정)</span><b>${pct(s.maturity)}</b></div>
        <div class="kv"><span>복습 대기</span><b>${due}문항</b></div></div>
    </div>
    <div class="widget"><div class="w-label">장별 진도·정답률</div>${s.byCh.map(c => {
      const acc = c.ftAcc; const cls = acc == null ? "" : acc >= 0.8 ? "ok" : acc >= 0.5 ? "warn" : "bad";
      return `<div class="chrow"><span class="chname">제${c.ch}장</span>
        <span class="chbar"><i style="width:${Math.round(c.attempted / c.total * 100)}%"></i></span>
        <span class="chnum">${c.attempted}/${c.total}</span>
        <span class="chacc ${cls}">${pct(acc)}</span></div>`; }).join("")}</div>
    <div class="widget"><div class="w-label">🔥 약점 개념 Top 5 <span class="w-hint">(첫시도 기준)</span></div>
      ${s.weak.length ? s.weak.map(w => `<div class="weakrow"><span class="wk-name">${esc(w.concept)}</span>
        <span class="wk-acc bad">${pct(w.acc)}</span>
        <button class="btn sm" data-act="drill" data-concept="${esc(w.concept)}">집중 학습 →</button></div>`).join("")
      : `<div class="muted">아직 약점을 판단할 데이터가 부족합니다 (개념당 2문항 이상 풀면 표시).</div>`}</div>
    <div class="widget"><div class="w-label">실수 유형 <span class="w-hint">(어떤 사고가 막히는지)</span></div>
      ${s.skillMiss.length ? s.skillMiss.map(([k, v]) => `<div class="skrow"><span>${esc(k)}</span><span class="skbar"><i style="width:${Math.min(100, v * 12)}%"></i></span><span class="sknum">${v}</span></div>`).join("")
      : `<div class="muted">틀린 문제가 쌓이면 여기 실수 유형이 분석됩니다.</div>`}</div>
    <div class="widget backup"><div class="w-label">진도 백업</div>
      <div class="muted">진도는 이 브라우저에만 저장됩니다. 기기를 바꾸거나 초기화 전에 백업하세요.</div>
      <div class="bkbtns"><button class="btn sm" id="exportBtn">⬇ 내보내기(.json)</button>
        <button class="btn sm ghostbtn" id="importBtn">⬆ 가져오기</button>
        <input type="file" id="importFile" accept=".json" hidden></div></div>`;
  main.appendChild(wrap);
}

/* ---------- 모의시험 ---------- */
const PRESETS = { quick: { n: 18, t: 20, label: "빠른 진단 (18문항 · 20분)" }, standard: { n: 36, t: 45, label: "표준 모의 (36문항 · 45분)" }, full: { n: 60, t: 75, label: "실전 모의 (60문항 · 75분)" } };
function seeded(seed) { let x = seed >>> 0; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }
function pickExam(n) {
  const rnd = seeded(((now() / 1000) | 0));
  const perCh = Math.max(1, Math.round(n / CH.length));
  const picked = [];
  CH.forEach(c => {
    let pool = QS.filter(q => q.ch === c.ch);
    // 개념 균형: 개념별로 섞어 뽑기
    const byCon = {}; pool.forEach(q => (byCon[q.concept] = byCon[q.concept] || []).push(q));
    const cons = Object.keys(byCon); cons.forEach(k => byCon[k].sort(() => rnd() - 0.5));
    let i = 0; const take = [];
    while (take.length < perCh && cons.some(k => byCon[k].length)) { const k = cons[i % cons.length]; if (byCon[k].length) take.push(byCon[k].pop()); i++; }
    picked.push(...take);
  });
  picked.sort(() => rnd() - 0.5);
  return picked.slice(0, n).map(q => q.id);
}
function startExam(preset) {
  const p = PRESETS[preset];
  S.exam = { preset, ids: pickExam(p.n), answers: {}, flags: {}, startAt: now(), durationMs: p.t * 60e3, submitted: false };
  save(); renderExam();
}
function renderExam() {
  const main = $("#main"); main.innerHTML = "";
  const ex = S.exam;
  if (!ex || ex.submitted) { renderExamSetup(main, ex); return; }
  // 진행 화면
  const bar = document.createElement("div"); bar.className = "exam-bar"; bar.id = "examBar";
  bar.innerHTML = `<span id="examTimer" class="ex-timer"></span>
    <span class="ex-prog"><b id="examAnswered">0</b>/${ex.ids.length} 응답</span>
    <button class="btn" id="submitExam">제출하기</button>`;
  main.appendChild(bar);
  const list = document.createElement("div"); main.appendChild(list);
  ex.ids.forEach((id, k) => {
    const q = qById(id);
    const div = document.createElement("div"); div.className = "card exam-card"; div.id = "ex-" + id; div.dataset.id = id;
    const opts = q.sec === "obj" ? `<ul class="opts">${q.options.map(o => `<li class="opt" data-m="${esc(o.m)}"><span class="m">${esc(o.m)}</span><span>${esc(o.t)}</span></li>`).join("")}</ul>`
      : `<div class="subans"><input type="text" placeholder="답 입력…" data-exsub="${id}"></div>`;
    div.innerHTML = `<div class="qhead"><span class="badge">${k + 1}.</span><span class="badge ${q.sec === "sub" ? "sub" : ""}">제${q.ch}장</span><span class="sp"></span>
      <button class="flagbtn ${ex.flags[id] ? "on" : ""}" data-flag="${id}">🚩 검토</button></div>
      <div class="stem">${esc(q.stem)}</div><div class="codeslot"></div>${opts}`;
    list.appendChild(div);
    if (q.code && q.code.length) { const cw = codeWidget(q.code, null); $(".codeslot", div).appendChild(cw); } else $(".codeslot", div).remove();
    // 복원
    const a = ex.answers[id];
    if (a != null) { if (q.sec === "obj") $$(".opt", div).forEach(o => o.classList.toggle("pick", o.dataset.m === a)); else { const inp = $(`[data-exsub="${id}"]`, div); if (inp) inp.value = a; } }
  });
  examTick(); updateExamAnswered();
}
let _examTimer = null;
function examTick() {
  if (_examTimer) clearInterval(_examTimer);
  const upd = () => {
    const ex = S.exam; if (!ex || ex.submitted) { clearInterval(_examTimer); return; }
    const left = ex.startAt + ex.durationMs - now();
    const el = $("#examTimer"); if (!el) { clearInterval(_examTimer); return; }
    if (left <= 0) { el.textContent = "⏰ 시간 종료"; submitExam(); return; }
    const m = Math.floor(left / 60e3), s = Math.floor((left % 60e3) / 1000);
    el.textContent = `⏱ ${m}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("urgent", left < 60e3);
  };
  upd(); _examTimer = setInterval(upd, 1000);
}
function updateExamAnswered() { const ex = S.exam; const el = $("#examAnswered"); if (el) el.textContent = Object.keys(ex.answers).length; }
function submitExam() {
  const ex = S.exam; if (!ex || ex.submitted) return;
  if (_examTimer) clearInterval(_examTimer);
  ex.submitted = true; ex.endAt = now();
  // 채점 + SRS 반영
  ex.result = ex.ids.map(id => {
    const q = qById(id), a = ex.answers[id];
    const correct = q.sec === "obj" ? a === q.answer : null; // 주관식은 자동채점 보류(사용자 확인)
    if (q.sec === "obj") { recordAnswer(q, correct, correct, a == null ? null : a); if (!correct) S.prog[id].dueAt = now(); } // 시험 오답은 즉시 복습
    return { id, a, correct, ch: q.ch, concept: q.concept, sec: q.sec, skills: q.skills };
  });
  save(); renderExamReport(); refreshNav();
}
function renderExamSetup(main, ex) {
  const setup = document.createElement("div"); setup.className = "dash";
  setup.innerHTML = `<div class="widget"><div class="w-label">📝 모의시험</div>
    <div class="muted">장·개념을 균형 있게 무작위 출제합니다. 시험 중에는 채점·해설이 보이지 않고, 제출 후 약점 리포트와 복습 큐가 만들어집니다.</div>
    <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset" data-preset="${k}">${p.label}</button>`).join("")}</div>
    ${ex && ex.submitted ? `<button class="reveal-btn" id="lastReport">최근 시험 결과 다시 보기</button>` : ""}</div>`;
  main.appendChild(setup);
}
function renderExamReport() {
  const main = $("#main"); main.innerHTML = "";
  const ex = S.exam, res = ex.result;
  const objs = res.filter(r => r.sec === "obj");
  const correct = objs.filter(r => r.correct).length;
  const subCnt = res.filter(r => r.sec === "sub").length;
  const score = objs.length ? Math.round(correct / objs.length * 100) : 0;
  const usedMin = Math.round((ex.endAt - ex.startAt) / 60e3);
  // 장별
  const chAgg = {}; res.forEach(r => { const e = chAgg[r.ch] = chAgg[r.ch] || { t: 0, c: 0, o: 0 }; e.t++; if (r.sec === "obj") { e.o++; if (r.correct) e.c++; } });
  const wrong = res.filter(r => r.sec === "obj" && !r.correct);
  const wrap = document.createElement("div"); wrap.className = "dash";
  wrap.innerHTML = `<div class="widget"><div class="w-label">📝 시험 결과</div>
      <div class="score-big">${score}<span>점</span></div>
      <div class="muted">객관식 ${correct}/${objs.length} 정답 · 주관식 ${subCnt}문항(직접 확인) · ${usedMin}분 사용</div></div>
    <div class="widget"><div class="w-label">장별 성적</div>${Object.keys(chAgg).map(Number).sort((a,b)=>a-b).map(ch => { const e = chAgg[ch]; const acc = e.o ? e.c / e.o : null; const cls = acc == null ? "" : acc >= 0.8 ? "ok" : acc >= 0.5 ? "warn" : "bad"; return `<div class="chrow"><span class="chname">제${ch}장</span><span class="chnum">${e.o ? e.c + "/" + e.o : "주관식"}</span><span class="chacc ${cls}">${pct(acc)}</span></div>`; }).join("")}</div>
    <div class="widget"><div class="w-label">틀린 문제 (${wrong.length}) — 복습 큐에 추가됨</div>
      ${wrong.length ? wrong.map(r => { const q = qById(r.id); return `<button class="missrow" data-review="${r.id}"><span class="badge">제${q.ch}장</span> ${esc(q.stem.slice(0, 48))}… <span class="mini-tag">${esc(q.concept)}</span></button>`; }).join("") : `<div class="muted">객관식 전부 정답! 🎉</div>`}
      ${subCnt ? `<div class="muted" style="margin-top:8px">주관식 ${subCnt}문항은 자동채점이 어려워, 학습 탭에서 정답·해설로 직접 확인하세요.</div>` : ""}</div>
    <div class="widget"><button class="cta" data-act="go-review">🔁 틀린 문제 복습하러 가기 (${dueList().length})</button>
      <button class="reveal-btn" data-act="go-exam">새 시험 보기</button></div>`;
  main.appendChild(wrap);
}

/* ---------- 라우터 ---------- */
function setView(v) {
  S.view = v; save();
  $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  $("#filters").style.display = v === "learn" ? "" : "none";
  $("#search").style.display = v === "learn" ? "" : "none";
  if (_io) { _io.disconnect(); _io = null; }
  window.scrollTo(0, 0);
  render();
}
function render() {
  refreshNav(); updateProgress();
  if (S.view === "learn") renderLearn();
  else if (S.view === "review") renderReview();
  else if (S.view === "dashboard") renderDashboard();
  else if (S.view === "exam") renderExam();
}

/* ---------- 이벤트 ---------- */
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1600); }
document.addEventListener("click", e => {
  const t = e.target;
  const play = t.closest(".play"); if (play) { const id = play.dataset.cw; const a = $("#" + id + "-anim"); if (a) { a.classList.toggle("show"); if (a.classList.contains("show") && ANIM[id].step < 0) animStep(id, 1); } return; }
  const ac = t.closest(".animctl button"); if (ac) { const id = ac.dataset.cw, act = ac.dataset.act; if (act === "next") animStep(id, 1); else if (act === "prev") animStep(id, -1); else if (act === "reset") { ANIM[id].step = -1; if (ANIM[id].timer) { clearInterval(ANIM[id].timer); ANIM[id].timer = null; } animRender(id); } else if (act === "play") animPlay(id, ac); return; }
  const rt = t.closest("[data-retry]"); if (rt) { const id = rt.dataset.retry; delete S.prog[id]; save(); rerenderCard(id); updateProgress(); refreshNav(); return; }
  const gl = t.closest("[data-guess]"); if (gl) { const id = gl.dataset.guess; markGuessed(qById(id)); gl.outerHTML = '<span class="guess-done">🤔 찍음으로 표시됨 — 복습에 추가했어요</span>'; refreshNav(); return; }
  const star = t.closest("[data-star]"); if (star) { const id = star.dataset.star; S.bm[id] = !S.bm[id]; if (!S.bm[id]) delete S.bm[id]; save(); star.classList.toggle("on"); if (F.st === "bookmark" && S.view === "learn") render(); return; }
  // 시험 카드 선택
  if (S.view === "exam" && S.exam && !S.exam.submitted) {
    const eopt = t.closest(".exam-card .opt"); if (eopt) { const card = eopt.closest(".exam-card"); const id = card.dataset.id; $$(".opt", card).forEach(o => o.classList.remove("pick")); eopt.classList.add("pick"); S.exam.answers[id] = eopt.dataset.m; save(); updateExamAnswered(); return; }
    const fl = t.closest("[data-flag]"); if (fl) { const id = fl.dataset.flag; S.exam.flags[id] = !S.exam.flags[id]; fl.classList.toggle("on"); save(); return; }
  }
  if (t.closest("#submitExam")) { if (confirm("시험을 제출할까요?")) submitExam(); return; }
  const preset = t.closest("[data-preset]"); if (preset) { startExam(preset.dataset.preset); return; }
  if (t.closest("#lastReport")) { renderExamReport(); return; }
  // 객관식(학습/복습) 선택
  const opt = t.closest(".card:not(.exam-card) .opt"); if (opt) { const card = opt.closest(".card"); if (card && !card.classList.contains("done")) onPick(card, qById(card.dataset.id), opt.dataset.m); return; }
  const sc = t.closest("[data-subchk]"); if (sc) { const card = sc.closest(".card"); onSubCheck(card, qById(card.dataset.id)); return; }
  // 액션(대시보드/리포트)
  const actEl = t.closest("[data-act]"); if (actEl) { handleAct(actEl.dataset.act, actEl.dataset.concept); return; }
  if (t.id === "clearConcept") { F.concept = ""; render(); return; }
  if (t.id === "exportBtn") { exportProgress(); return; }
  if (t.id === "importBtn") { $("#importFile").click(); return; }
  const mr = t.closest("[data-review]"); if (mr) { F.concept = ""; setView("learn"); setTimeout(() => { const el = document.getElementById("q-" + mr.dataset.review); if (el) el.scrollIntoView(); }, 100); return; }
});
function handleAct(act, concept) {
  if (act === "go-review") setView("review");
  else if (act === "go-exam") setView("exam");
  else if (act === "go-learn-unseen") { F = { ch: "all", type: "all", st: "unseen", q: "", concept: "" }; syncFilterUI(); setView("learn"); }
  else if (act === "drill") { F = { ch: "all", type: "all", st: "all", q: "", concept: concept }; syncFilterUI(); setView("learn"); }
}
function syncFilterUI() {
  $$("#chapFilter .chip").forEach(x => x.classList.toggle("on", x.dataset.ch === F.ch));
  $$("#typeFilter button").forEach(x => x.classList.toggle("on", x.dataset.type === F.type));
  $$("#statusFilter button").forEach(x => x.classList.toggle("on", x.dataset.st === F.st));
}
// 진도 백업
function exportProgress() {
  const blob = new Blob([JSON.stringify({ v: 2, prog: S.prog, bm: S.bm, at: now() })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "python-study-progress.json"; a.click();
  toast("진도를 내보냈습니다");
}
document.addEventListener("change", e => {
  if (e.target.id === "cramChk") { S.cram = e.target.checked; save(); render(); }
  if (e.target.id === "importFile") {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { const d = JSON.parse(rd.result); if (d.prog) { S.prog = d.prog; S.bm = d.bm || {}; save(); toast("진도를 복원했습니다"); render(); } else toast("올바른 백업 파일이 아닙니다"); } catch (x) { toast("파일을 읽을 수 없습니다"); } };
    rd.readAsText(f);
  }
});

/* 필터 칩 */
function buildChapterFilter() {
  const wrap = $("#chapFilter");
  wrap.innerHTML = `<button class="chip on" data-ch="all">전체 장</button>` + CH.map(c => `<button class="chip" data-ch="${c.ch}">제${c.ch}장</button>`).join("");
  wrap.onclick = e => { const b = e.target.closest("[data-ch]"); if (!b) return; F.concept = ""; F.ch = b.dataset.ch; syncFilterUI(); render(); window.scrollTo(0, 0); };
}
$("#typeFilter").onclick = e => { const b = e.target.closest("[data-type]"); if (!b) return; F.type = b.dataset.type; syncFilterUI(); render(); };
$("#statusFilter").onclick = e => { const b = e.target.closest("[data-st]"); if (!b) return; F.st = b.dataset.st; syncFilterUI(); render(); };
let stim; $("#search").oninput = e => { clearTimeout(stim); stim = setTimeout(() => { F.q = e.target.value.trim(); if (S.view === "learn") render(); }, 250); };
$("#nav").onclick = e => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); };
$("#themeBtn").onclick = () => { S.theme = S.theme === "dark" ? "light" : "dark"; applyTheme(); save(); };
$("#resetBtn").onclick = () => { if (confirm("진도·정오답·북마크 기록을 모두 지울까요? (되돌릴 수 없습니다)")) { S.prog = {}; S.bm = {}; save(); render(); toast("기록을 초기화했습니다"); } };
function applyTheme() { document.documentElement.setAttribute("data-theme", S.theme); $("#themeBtn").textContent = S.theme === "dark" ? "☀️" : "🌙"; }

/* ---------- 초기화 ---------- */
try {
  applyTheme(); buildChapterFilter();
  var p = new URLSearchParams(location.search), ch = p.get("ch"), vw = p.get("view");
  if (ch && chMap[+ch]) { F.ch = ch; }
  if (vw && ["learn", "review", "dashboard", "exam"].includes(vw)) S.view = vw;
  syncFilterUI();
  setView(S.view || "learn");
} catch (e) {
  var em = $("#main"); if (em) em.innerHTML = '<div class="empty">⚠ 화면을 그리는 중 오류가 발생했습니다:<br><br><code>' + esc(String((e && e.message) || e)) + '</code><br><br>이 메시지를 캡처해 보내주시면 바로 고쳐드리겠습니다.</div>';
}
})();
