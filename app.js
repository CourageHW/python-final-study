/* ===== 멘토링 파이썬 기말 — 인터랙티브 학습 앱 ===== */
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
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- 상태 (localStorage) ---------- */
const KEY = "pyquiz_v1";
let S = { prog: {}, bm: {}, theme: "light" };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
S.prog = S.prog || {}; S.bm = S.bm || {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

/* ---------- 파이썬 구문 강조 (라인 단위) ---------- */
const KW = new Set(("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" "));
const BI = new Set(("print len range int str float list dict set tuple bool abs sum min max sorted enumerate zip map filter open type isinstance id input round any all chr ord super object Exception ValueError KeyError IndexError TypeError AttributeError NotImplementedError append insert pop remove sort index count keys values items get add discard split join strip lstrip rstrip replace upper lower capitalize title startswith endswith isdigit isalpha islower isspace format encode read readline readlines write close seek tell").split(" "));
function hi(line) {
  let out = "", i = 0, n = line.length;
  const peek = () => line[i];
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
let widgetSeq = 0;
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
const ANIM = {};
function animRender(id) {
  const A = ANIM[id]; if (!A) return;
  const pre = $("#" + id + "-pre");
  $$(".ln", pre).forEach(e => e.classList.remove("active", "errln"));
  const info = $("#" + id + "-info");
  if (A.step < 0) {
    $("#" + id + "-vars").innerHTML = '<span class="nochg">실행 전</span>';
    $("#" + id + "-out").textContent = "";
    info.textContent = ""; return;
  }
  const st = A.trace[A.step], prev = A.step > 0 ? A.trace[A.step - 1] : { vars: {} };
  if (st.line) { const ln = pre.querySelector(`.ln[data-l="${st.line}"]`); if (ln) ln.classList.add(st.error ? "errln" : "active"); }
  // 변수
  const vk = Object.keys(st.vars || {});
  $("#" + id + "-vars").innerHTML = vk.length
    ? vk.map(k => { const chg = prev.vars[k] !== st.vars[k];
        return `<div class="v${chg ? " chg" : ""}"><span class="vk">${esc(k)}</span>=<span>${esc(st.vars[k])}</span></div>`; }).join("")
    : '<span class="nochg">(아직 변수 없음)</span>';
  // 출력
  const ob = $("#" + id + "-out");
  ob.textContent = st.out || "";
  if (st.error) ob.innerHTML += `<span class="err">⚠ ${esc(st.error)}</span>`;
  info.textContent = `${A.step + 1} / ${A.trace.length}` + (st.final ? " · 완료" : "");
}
function animStep(id, d) {
  const A = ANIM[id]; if (!A) return;
  A.step = Math.max(-1, Math.min(A.trace.length - 1, A.step + d));
  animRender(id);
}
function animPlay(id, btn) {
  const A = ANIM[id]; if (!A) return;
  if (A.timer) { clearInterval(A.timer); A.timer = null; btn.textContent = "▶ 자동"; return; }
  if (A.step >= A.trace.length - 1) A.step = -1;
  btn.textContent = "⏸ 정지";
  A.timer = setInterval(() => {
    if (A.step >= A.trace.length - 1) { clearInterval(A.timer); A.timer = null; btn.textContent = "▶ 자동"; return; }
    animStep(id, 1);
  }, 900);
}

/* ---------- 코드블록 플레이스홀더를 위젯으로 치환 (해설·개념·미니 공통) ---------- */
function enhanceBlocks(container, blocks) {
  $$(".codeblk", container).forEach(div => {
    const cb = blocks && blocks[+div.dataset.i];
    if (!cb) return;
    div.replaceWith(codeWidget(cb.display, cb.trace));
  });
}

/* ---------- 문제 카드 ---------- */
function cardHTML(q) {
  const done = S.prog[q.id];
  const cls = done ? " " + done.status : "";
  const star = S.bm[q.id] ? "on" : "";
  const badge = q.sec === "sub" ? `<span class="badge sub">주관식</span>` : `<span class="badge">객관식</span>`;
  const opts = q.options.map(o =>
    `<li class="opt" data-m="${esc(o.m)}"><span class="m">${esc(o.m)}</span><span>${esc(o.t)}</span></li>`).join("");
  return `<div class="card${cls}" id="q-${q.id}" data-id="${q.id}">
    <div class="qhead">${badge}<span class="badge">제${q.ch}장 · ${q.num}번</span><span class="sp"></span>
      <button class="star ${star}" data-star="${q.id}" title="북마크">★</button></div>
    <div class="stem">${esc(q.stem)}</div>
    <div class="codeslot"></div>
    ${q.sec === "obj" ? `<ul class="opts">${opts}</ul>` :
      `<div class="subans"><input type="text" placeholder="답을 입력…" data-sub="${q.id}"><button class="btn sm" data-subchk="${q.id}">확인</button></div>`}
    <div class="ansslot"></div>
  </div>`;
}

function mountCard(card, q) {
  // 스템 코드 위젯
  if (q.code && q.code.length) $(".codeslot", card).appendChild(codeWidget(q.code, q.codeTrace));
  else $(".codeslot", card).remove();
  const done = S.prog[q.id];
  if (done) {                                   // 이미 푼 문제: 결과 복원
    if (q.sec === "obj") revealAnswer(card, q, done.pick);
    else restoreSub(card, q, done);
    return;
  }
  // 미응답: 객관식 보기는 항상 hover·클릭 채점 + '그냥 보기' 버튼 제공
  showStudy(card, q);
}

function answerBox(q) {
  return `<div class="answer">정답: ${esc(q.answer)} ${esc(q.answerText)}</div>`;
}
function retryBtn(q) {
  return `<button class="reveal-btn retry" data-retry="${q.id}">🔄 다시 풀기</button>`;
}
function rerenderCard(id) {           // 카드 하나를 미응답 상태로 새로 그림
  const q = qById(id);
  const old = document.getElementById("q-" + id);
  if (!q || !old) return;
  const tmp = document.createElement("div"); tmp.innerHTML = cardHTML(q);
  const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  mountCard(fresh, q);
}
function explBox(q) {
  const d = document.createElement("div");
  d.className = "expl";
  d.innerHTML = q.explHtml;
  enhanceBlocks(d, q.codeBlocks);
  return d;
}

function showStudy(card, q) {
  const slot = $(".ansslot", card);
  slot.innerHTML = `<button class="reveal-btn" data-reveal="1">💡 정답·해설 보기</button>`;
  $("[data-reveal]", slot).onclick = () => {
    card.classList.add("done");
    slot.innerHTML = answerBox(q) + retryBtn(q);
    if (q.sec === "obj") markOptions(card, q, null);
    const sa = $(".subans", card); if (sa) sa.remove();
    slot.appendChild(explBox(q));
  };
}

function markOptions(card, q, pick) {
  $$(".opt", card).forEach(o => {
    const m = o.dataset.m;
    if (m === q.answer) o.classList.add("right");
    else if (pick && m === pick) o.classList.add("wrong");
  });
}

function revealAnswer(card, q, pick) {
  card.classList.add("done");
  card.classList.remove("correct", "wrong");
  if (pick != null) card.classList.add(pick === q.answer ? "correct" : "wrong");
  if (q.sec === "obj") markOptions(card, q, pick);
  const sa = $(".subans", card); if (sa) sa.remove();
  const slot = $(".ansslot", card);
  slot.innerHTML = answerBox(q) + retryBtn(q);
  slot.appendChild(explBox(q));
}
function restoreSub(card, q, done) {
  card.classList.add("done", done.status);
  const sa = $(".subans", card); if (sa) sa.remove();
  const slot = $(".ansslot", card);
  slot.innerHTML = answerBox(q) + retryBtn(q);
  slot.appendChild(explBox(q));
}

/* 객관식 선택 */
function onPick(card, q, m) {
  if (card.classList.contains("done")) return; // 이미 채점됨
  const ok = m === q.answer;
  S.prog[q.id] = { status: ok ? "correct" : "wrong", pick: m };
  save();
  revealAnswer(card, q, m);            // 정/오답 표시 + 해설 자동 펼침
  updateProgress();
  toast(ok ? "정답! 🎉" : "오답 — 해설을 확인하세요");
}
/* 주관식 자가채점 */
function onSubCheck(card, q) {
  const inp = $(`[data-sub="${q.id}"]`, card);
  const slot = $(".ansslot", card);
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const guess = norm(inp.value);
  const auto = guess && (norm(q.answerText).includes(guess) || guess.includes(norm(q.answerText)));
  slot.innerHTML = answerBox(q) + retryBtn(q);
  const self = document.createElement("div");
  self.innerHTML = `<div style="margin:6px 0;font-size:13px;color:var(--muted)">스스로 채점:
    <button class="btn sm" data-self="correct">맞았다</button>
    <button class="reveal-btn" data-self="wrong">틀렸다</button>
    ${auto ? '<span style="color:var(--ok);font-weight:700"> · 자동판정: 정답에 가까움 ✓</span>' : ''}</div>`;
  slot.appendChild(self);
  slot.appendChild(explBox(q));
  self.querySelectorAll("[data-self]").forEach(b => b.onclick = () => {
    S.prog[q.id] = { status: b.dataset.self, pick: inp.value }; save();
    card.classList.remove("correct", "wrong"); card.classList.add("done", b.dataset.self);
    updateProgress(); toast("기록되었습니다");
  });
}

/* ---------- 진도 ---------- */
function updateProgress() {
  const ids = QS.map(q => q.id);
  const done = ids.filter(i => S.prog[i]).length;
  const correct = ids.filter(i => S.prog[i] && S.prog[i].status === "correct").length;
  const pct = Math.round(done / ids.length * 100);
  $("#progbar").style.width = pct + "%";
  $("#progtext").textContent = `진도 ${done}/${ids.length} (${pct}%) · 정답 ${correct} · 오답 ${done - correct}`;
}

/* ---------- 필터 + 렌더 ---------- */
let F = { ch: "all", type: "all", st: "all", q: "" };
let _io = null; // 지연 렌더링용 IntersectionObserver
function match(q) {
  if (F.ch !== "all" && q.ch !== +F.ch) return false;
  if (F.type !== "all" && q.sec !== F.type) return false;
  const p = S.prog[q.id];
  if (F.st === "unseen" && p) return false;
  if (F.st === "wrong" && !(p && p.status === "wrong")) return false;
  if (F.st === "bookmark" && !S.bm[q.id]) return false;
  if (F.q) {
    const hay = (q.stem + " " + q.code.join(" ") + " " + q.options.map(o => o.t).join(" ") + " " + q.explHtml).toLowerCase();
    if (!hay.includes(F.q.toLowerCase())) return false;
  }
  return true;
}
function fullChapterView() {
  return F.ch !== "all" && F.type === "all" && F.st === "all" && !F.q;
}
function emitOp(main, op) {
  if (op.t === "intro") {
    const intro = document.createElement("details");
    intro.className = "chapter-intro";
    intro.innerHTML = `<summary>${esc(op.c.title)} — 개념 한눈에 보기</summary>${op.c.conceptHtml}`;
    enhanceBlocks(intro, op.c.conceptBlocks);
    main.appendChild(intro);
  } else if (op.t === "sec") {
    const h = document.createElement("div"); h.className = "sec-title";
    h.textContent = op.text; main.appendChild(h);
  } else if (op.t === "card") {
    const tmp = document.createElement("div"); tmp.innerHTML = cardHTML(op.q);
    const card = tmp.firstElementChild; main.appendChild(card); mountCard(card, op.q);
  } else if (op.t === "mini") {
    const m = document.createElement("div"); m.className = "mini-wrap";
    m.innerHTML = op.c.miniHtml; enhanceBlocks(m, op.c.miniBlocks); main.appendChild(m);
  }
}
function render() {
  const main = $("#main");
  if (_io) { _io.disconnect(); _io = null; }
  main.innerHTML = "";
  const list = QS.filter(match);
  if (!list.length) { main.innerHTML = `<div class="empty">조건에 맞는 문제가 없습니다.</div>`; updateProgress(); return; }
  const byCh = {};
  list.forEach(q => (byCh[q.ch] = byCh[q.ch] || []).push(q));
  const showIntro = fullChapterView();
  // 렌더 작업 큐(점진 렌더링) — 모바일 과부하 방지
  const ops = [];
  Object.keys(byCh).map(Number).sort((a, b) => a - b).forEach(ch => {
    const c = chMap[ch];
    ops.push(showIntro && c.conceptHtml ? { t: "intro", c } : { t: "sec", text: c.title });
    const obj = byCh[ch].filter(q => q.sec === "obj"), sub = byCh[ch].filter(q => q.sec === "sub");
    [["Ⅰ. 객관식", obj], ["Ⅱ. 주관식", sub]].forEach(([title, arr]) => {
      if (!arr.length) return;
      if (showIntro) ops.push({ t: "sec", text: title });
      arr.forEach(q => ops.push({ t: "card", q }));
    });
    if (showIntro && c.miniHtml) ops.push({ t: "mini", c });
  });
  let idx = 0;
  const BATCH = 16;
  function more() {
    if (_io) { _io.disconnect(); _io = null; }
    const old = document.getElementById("sentinel"); if (old) old.remove();
    let cards = 0;
    while (idx < ops.length && cards < BATCH) {
      const op = ops[idx++]; emitOp(main, op);
      if (op.t === "card") cards++;
    }
    if (idx < ops.length) {
      const s = document.createElement("div"); s.id = "sentinel"; s.style.height = "1px";
      main.appendChild(s);
      _io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: "800px" });
      _io.observe(s);
    }
  }
  more();
  updateProgress();
}

/* ---------- 이벤트 ---------- */
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 1600); }

document.addEventListener("click", e => {
  const t = e.target;
  // 코드 애니메이션
  const play = t.closest(".play"); if (play) { const id = play.dataset.cw; const a = $("#" + id + "-anim"); a.classList.toggle("show"); if (a.classList.contains("show") && ANIM[id].step < 0) animStep(id, 1); return; }
  const ac = t.closest(".animctl button"); if (ac) { const id = ac.dataset.cw, act = ac.dataset.act;
    if (act === "next") animStep(id, 1); else if (act === "prev") animStep(id, -1);
    else if (act === "reset") { ANIM[id].step = -1; if (ANIM[id].timer) { clearInterval(ANIM[id].timer); ANIM[id].timer = null; } animRender(id); }
    else if (act === "play") animPlay(id, ac); return; }
  // 다시 풀기 (채점 후 재시도 — 답 변경 가능)
  const rt = t.closest("[data-retry]");
  if (rt) { const id = rt.dataset.retry; delete S.prog[id]; save(); rerenderCard(id); updateProgress(); return; }
  // 북마크
  const star = t.closest("[data-star]"); if (star) { const id = star.dataset.star; S.bm[id] = !S.bm[id]; if (!S.bm[id]) delete S.bm[id]; save(); star.classList.toggle("on"); if (F.st === "bookmark") render(); return; }
  // 객관식 선택 (모드 무관 — 항상 클릭 채점)
  const opt = t.closest(".opt");
  if (opt) { const card = opt.closest(".card");
    if (card && !card.classList.contains("done")) onPick(card, qById(card.dataset.id), opt.dataset.m);
    return; }
  // 주관식 확인
  const sc = t.closest("[data-subchk]"); if (sc) { const card = sc.closest(".card"); onSubCheck(card, qById(card.dataset.id)); return; }
});
function qById(id) { return QS.find(q => q.id === id); }

/* 필터 칩 */
function buildChapterFilter() {
  const wrap = $("#chapFilter");
  wrap.innerHTML = `<button class="chip on" data-ch="all">전체 장</button>` +
    CH.map(c => `<button class="chip" data-ch="${c.ch}">제${c.ch}장</button>`).join("");
  wrap.onclick = e => { const b = e.target.closest("[data-ch]"); if (!b) return;
    $$(".chip", wrap).forEach(x => x.classList.remove("on")); b.classList.add("on");
    F.ch = b.dataset.ch; render(); window.scrollTo(0, 0); };
}
$("#typeFilter").onclick = e => { const b = e.target.closest("[data-type]"); if (!b) return;
  $$("#typeFilter button").forEach(x => x.classList.remove("on")); b.classList.add("on"); F.type = b.dataset.type; render(); };
$("#statusFilter").onclick = e => { const b = e.target.closest("[data-st]"); if (!b) return;
  $$("#statusFilter button").forEach(x => x.classList.remove("on")); b.classList.add("on"); F.st = b.dataset.st; render(); };
let stim; $("#search").oninput = e => { clearTimeout(stim); stim = setTimeout(() => { F.q = e.target.value.trim(); render(); }, 250); };
$("#themeBtn").onclick = () => { S.theme = S.theme === "dark" ? "light" : "dark"; applyTheme(); save(); };
$("#resetBtn").onclick = () => { if (confirm("진도·정오답·북마크 기록을 모두 지울까요?")) { S.prog = {}; S.bm = {}; save(); render(); toast("기록을 초기화했습니다"); } };
function applyTheme() { document.documentElement.setAttribute("data-theme", S.theme); $("#themeBtn").textContent = S.theme === "dark" ? "☀️" : "🌙"; }

/* ---------- 초기화 ---------- */
try {
  applyTheme();
  buildChapterFilter();
  /* 딥링크: ?ch=6 (장 선택) — 공유용 */
  var p = new URLSearchParams(location.search);
  var ch = p.get("ch");
  if (ch && chMap[+ch]) {
    F.ch = ch;
    var b = $(`#chapFilter [data-ch="${ch}"]`);
    if (b) { $$("#chapFilter .chip").forEach(x => x.classList.remove("on")); b.classList.add("on"); }
  }
  render();
} catch (e) {
  var em = $("#main");
  if (em) em.innerHTML = '<div class="empty">⚠ 화면을 그리는 중 오류가 발생했습니다:<br><br><code>' +
    esc(String((e && e.message) || e)) + '</code><br><br>이 메시지를 캡처해 보내주시면 바로 고쳐드리겠습니다.</div>';
}
})();
