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
const esc = s => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ---------- 상태 (localStorage) ---------- */
const KEY = "pyquiz_v2";
let S = { prog: {}, bm: {}, theme: "light", view: "learn", cram: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
// v1 -> v2 마이그레이션
try { if (!localStorage.getItem(KEY)) { const v1 = JSON.parse(localStorage.getItem("pyquiz_v1") || "{}");
  if (v1.prog) { S.prog = v1.prog; S.bm = v1.bm || {}; S.theme = v1.theme || "light"; } } } catch (e) {}
S.prog = S.prog || {}; S.bm = S.bm || {}; S.activity = S.activity || {};
S.expl = S.expl || {};                                  // 문항별 자기설명 텍스트
if (S.ai) { delete S.ai; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }   // (구버전) 클라이언트 키 즉시 영구 삭제 — 이제 키는 서버 프록시에만
S.examDate = S.examDate || "";                          // 시험일(YYYY-MM-DD) — D-day 플래너
S.model = S.model || "";                                // 멘티가 고른 AI 모델 id(여러 모델 허용 시)
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const now = () => Date.now();
function todayStr() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function logActivity(correct) { const t = todayStr(); const a = S.activity[t] = S.activity[t] || { a: 0, c: 0 }; a.a++; if (correct) a.c++; }

/* ---------- SRS (5박스 Leitner) ---------- */
const DAY = 864e5;
const BOX_MS = [0, 15 * 60e3, DAY, 3 * DAY, 7 * DAY, 14 * DAY];
const CRAM_MS = [0, 60e3, 3 * 60e3, 8 * 60e3, 20 * 60e3, 45 * 60e3];
const BOX_NAME = ["미학습", "불안정", "학습중", "익숙", "탄탄", "숙달"];
function boxMs(b) { b = Math.max(0, Math.min(5, b)); return (S.cram ? CRAM_MS : BOX_MS)[b]; }
function recordAnswer(q, correct, confident, pick) {
  const p = S.prog[q.id] || { box: 0, attempts: 0, firstTry: null, lapses: 0 };
  if (!p.attempts) p.firstTry = !!correct;       // 첫 시도 정답 여부(대시보드용, 한 번만)
  logActivity(!!correct);
  p.attempts = (p.attempts || 0) + 1;
  p.status = correct ? "correct" : "wrong";
  p.pick = pick; p.lastResult = !!correct; p.lastConfidence = !!confident; p.lastAt = now();
  p.conf = null;                                   // 이번 답의 확신도는 호출부(onPick)가 다시 설정 — 다른 경로의 stale conf 제거(보정 통계 오염 방지)
  if (!correct) { p.box = 1; p.lapses = (p.lapses || 0) + 1; }
  else if (confident) { p.box = Math.min(5, (p.box || 0) + 1); }
  else { p.box = Math.max(1, p.box || 1); }       // 맞았지만 찍음 → 승급 보류
  p.dueAt = now() + boxMs(p.box);
  S.prog[q.id] = p;
  if (SESSION && SESSION.ids.includes(q.id)) {
    SESSION.solved.add(q.id);
    updateSessionProgress();
  }
  save();
}
function markGuessed(q) {                          // "사실 찍었어요" → 승급 취소 + 즉시 복습
  const p = S.prog[q.id]; if (!p) return;
  p.lastConfidence = false; p.conf = "guess"; p.box = Math.max(1, (p.box || 1) - 1);
  if (p.attempts <= 1) p.firstTry = false;         // 찍어서 맞힌 건 첫시도 정답으로 치지 않음
  p.dueAt = now(); save();                          // 약속대로 바로 복습 큐에
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
    ? vk.map(k => `<div class="v${(prev.vars || {})[k] !== st.vars[k] ? " chg" : ""}"><span class="vk">${esc(k)}</span>=<span>${esc(st.vars[k])}</span></div>`).join("")
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

/* ---------- 🤖 AI 도우미 (서버리스 프록시 경유 — 멘티는 키 입력 없음) ---------- */
const AI_PROXY = ((typeof window !== "undefined" && window.MENTO_AI_PROXY) || "").trim();   // 멘토가 index.html에서 설정
const AI_TOKEN = ((typeof window !== "undefined" && window.MENTO_AI_TOKEN) || "").trim();   // (선택) 공유 토큰
const AI_MODELS = (Array.isArray(typeof window !== "undefined" && window.MENTO_AI_MODELS) ? window.MENTO_AI_MODELS : [])
  .map(m => typeof m === "string" ? { id: m, label: m } : m).filter(m => m && m.id);   // 멘티가 고를 수 있는 모델 목록(없으면 워커 기본값 사용)
function currentModel() { if (!AI_MODELS.length) return ""; const ids = AI_MODELS.map(m => m.id); return ids.includes(S.model) ? S.model : ids[0]; }
const AI_FMT = " 코드는 반드시 ```python 코드펜스로 감싸라. 수식은 LaTeX($, \\\\(, \\\\[ 등) 대신 일반 텍스트나 백틱 코드로 써라(LaTeX는 렌더되지 않음). 강조는 **굵게**만 사용.";
const AI_SYS = "너는 파이썬을 가르치는 친절하고 정확한 멘토다. 학생이 한 문제에 대해 '자기설명'(왜 그렇게 푸는지 자기 말로 설명한 글)을 작성했다. 학생의 자기설명만 평가하라: (1) 추론이 맞는지 짚고, (2) 틀렸거나 빠진 핵심·오개념이 있으면 콕 집어 바로잡고, (3) 마지막에 한 줄 격려. 정답을 그대로 받아쓰지 말고 학생의 사고 과정을 다듬는 데 집중하라. 한국어로 3~5문장, 군더더기 없이." + AI_FMT;
const CHAT_SYS = "너는 파이썬 학습을 돕는 친절한 한국어 튜터다. 학생이 보고 있는 문제 맥락이 주어지면 그 맥락에 맞춰 답하라. 단순히 정답만 던지지 말고 핵심 개념과 풀이 단계를 짚어 스스로 이해하도록 도와라. 코드 예시는 짧게, 설명은 간결하게 한국어로." + AI_FMT;
function aiConfigured() { return !!AI_PROXY; }
function stripHtml(h) { const d = document.createElement("div"); d.innerHTML = h || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); }
function qContext(q, showAnswer) { // 채팅/피드백에 넣을 문제 요약 (정답은 이미 푼 경우에만 포함 — 미리보기 유출 방지)
  const opts = q.sec === "obj" ? "\n보기:\n" + q.options.map(o => `${o.m}. ${o.t}`).join("\n") : "";
  const code = (q.code && q.code.length) ? "\n코드:\n" + q.code.join("\n") : "";
  const ans = showAnswer ? (q.sec === "obj" ? `정답 ${cheatAnswer(q)}` : `정답 ${q.answerText}`) : "정답 비공개(학생이 아직 푸는 중)";
  return `제${q.ch}장 ${q.num}번\n${q.stem}${code}${opts}\n(${ans})`;
}
function explPrompt(q, userExpl) {
  const expl = stripHtml(q.explHtml).slice(0, 700);
  return `[문제]\n${qContext(q, true)}\n[공식 해설 요약]\n${expl}\n\n[학생의 자기설명]\n${userExpl}\n\n위 학생의 자기설명을 평가해줘.`;   // 피드백은 답한 뒤이므로 정답 포함
}
async function aiChat(messages) {  // 프록시로 messages 전송 → 응답 텍스트
  if (!AI_PROXY) throw new Error("AI 도우미가 설정되지 않았습니다(관리자: index.html의 MENTO_AI_PROXY).");
  const headers = { "Content-Type": "application/json" };
  if (AI_TOKEN) headers["X-Class-Token"] = AI_TOKEN;
  const r = await fetch(AI_PROXY, { method: "POST", headers, body: JSON.stringify({ messages, model: currentModel() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("프록시 오류 " + r.status));
  return j.text || "(빈 응답)";
}
async function runAiFeedback(btn) {
  const id = btn.dataset.aifb, q = qById(id), card = btn.closest(".card");
  if (!card.classList.contains("done")) return;     // 답하기 전엔 피드백 금지(정답 유출 방지 — CSS 게이팅의 JS 백업)
  const out = $(`[data-aiout="${id}"]`, card), ta = $("[data-expl]", card);
  const expl = ((ta && ta.value) || "").trim();
  S.expl[id] = expl; save();
  if (!expl) { out.innerHTML = `<div class="ai-note">먼저 ✍️ 풀이 근거를 한두 문장 적어주세요.</div>`; return; }
  if (!aiConfigured()) { out.innerHTML = `<div class="ai-note">🤖 AI 기능이 아직 설정되지 않았습니다(관리자 설정 필요).</div>`; return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = "🤖 생각 중…";
  out.innerHTML = `<div class="ai-note">AI가 설명을 평가하는 중…</div>`;
  try { const r = await aiChat([{ role: "system", content: AI_SYS }, { role: "user", content: explPrompt(q, expl) }]); out.innerHTML = `<div class="ai-fb ai-rich"><div class="ai-fb-h">🤖 AI 피드백</div>${mdRender(r)}</div>`; }
  catch (e) { out.innerHTML = `<div class="ai-err">⚠ ${esc(String((e && e.message) || e))}</div>`; }
  finally { btn.disabled = false; btn.textContent = old; }
}

/* ---------- 🤖 AI 채팅 패널 (상시 도우미) ---------- */
let CHAT = [], chatCtxId = null, chatBusy = false;
function openChat() { const p = $("#aichat"), bg = $("#aichatBg"); if (p) { p.classList.add("open"); if (bg) bg.hidden = false; const i = $("#aiInput"); if (i) i.focus(); } }
function closeChat() { const p = $("#aichat"), bg = $("#aichatBg"); if (p) p.classList.remove("open"); if (bg) bg.hidden = true; }
function toggleChat() { const p = $("#aichat"); if (p && p.classList.contains("open")) closeChat(); else openChat(); }
function chatCtxBar() {
  const bar = $("#aiCtxBar"); if (!bar) return;
  if (chatCtxId) { const q = qById(chatCtxId); bar.innerHTML = `<span class="ctx-chip">📌 제${q.ch}장 ${q.num}번 참고 중 <button id="aiCtxClear" aria-label="문제 맥락 해제">✕</button></span>`; }
  else bar.innerHTML = "";
}
function mdInline(s) {              // 인라인(이미 esc된 텍스트): 코드/LaTeX/굵게/기울임/취소선/링크
  const ic = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { ic.push(c); return `@@IC${ic.length - 1}@@`; })
       .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => { ic.push(x.trim()); return `@@IC${ic.length - 1}@@`; })
       .replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => { ic.push(x.trim()); return `@@IC${ic.length - 1}@@`; });
  s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
       .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
       .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
       .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  return s.replace(/@@IC(\d+)@@/g, (m, i) => `<code>${ic[+i]}</code>`);
}
function mdCodeBlock(lang, raw) {   // 코드블록(언어 라벨+복사버튼, 파이썬은 기존 hi()로 구문강조)
  lang = (lang || "").toLowerCase();
  const py = lang === "python" || lang === "py" || lang === "";
  const body = raw.split("\n").map(l => py ? hi(l) : esc(l)).join("\n");
  return `<div class="ai-cb" data-code="${esc(raw)}"><div class="ai-cb-top"><span>${esc(lang || "code")}</span><button class="ai-copy" type="button">복사</button></div><pre class="ai-code"><code>${body}</code></pre></div>`;
}
function mdRow(line) { return line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()); }
function mdRender(raw) {            // AI 출력용 마크다운 → HTML (먼저 esc → XSS 안전). 헤딩/목록/표/인용/코드 지원.
  const cbs = [];
  const src = String(raw || "").replace(/```([a-zA-Z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
    cbs.push(mdCodeBlock(lang, code.replace(/\n$/, ""))); return `\n@@CB${cbs.length - 1}@@\n`;
  });
  const L = src.split("\n"), out = []; let i = 0;
  const isList = s => /^\s*([-*+]|\d+\.)\s+/.test(s);
  const isHr = s => /^\s*([-*_])(\s*\1){2,}\s*$/.test(s);
  let m;
  while (i < L.length) {
    const line = L[i];
    if ((m = line.trim().match(/^@@CB(\d+)@@$/))) { out.push(cbs[+m[1]]); i++; continue; }
    if (!line.trim()) { i++; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { const t = m[1].length <= 1 ? "h3" : m[1].length === 2 ? "h4" : "h5"; out.push(`<${t}>${mdInline(esc(m[2]))}</${t}>`); i++; continue; }
    if (isHr(line)) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(line)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) { b.push(L[i].replace(/^>\s?/, "")); i++; } out.push(`<blockquote>${mdInline(esc(b.join("\n"))).replace(/\n/g, "<br>")}</blockquote>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < L.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(L[i + 1])) {
      const head = mdRow(line); i += 2; const rows = [];
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) { rows.push(mdRow(L[i])); i++; }
      out.push(`<div class="ai-tblwrap"><table class="ai-tbl"><thead><tr>${head.map(c => `<th>${mdInline(esc(c))}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${mdInline(esc(c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line), items = [];
      while (i < L.length && isList(L[i])) {
        items.push(L[i].replace(/^\s*([-*+]|\d+\.)\s+/, "")); i++;
        while (i < L.length && L[i].trim() && !isList(L[i]) && /^\s+\S/.test(L[i])) { items[items.length - 1] += "\n" + L[i].trim(); i++; }
      }
      const tg = ordered ? "ol" : "ul";
      out.push(`<${tg}>${items.map(it => `<li>${mdInline(esc(it)).replace(/\n/g, "<br>")}</li>`).join("")}</${tg}>`); continue;
    }
    const p = []; while (i < L.length && L[i].trim() && !/^@@CB\d+@@$/.test(L[i].trim()) && !/^#{1,6}\s/.test(L[i]) && !/^>\s?/.test(L[i]) && !isList(L[i]) && !isHr(L[i])) { p.push(L[i]); i++; }
    out.push(`<p>${mdInline(esc(p.join("\n"))).replace(/\n/g, "<br>")}</p>`);
  }
  return out.join("");
}
function chatRender() {
  const th = $("#aiThread"); if (!th) return;
  if (!CHAT.length) th.innerHTML = `<div class="ai-c-empty">파이썬·문제에 대해 무엇이든 물어보세요.<br>문제 카드의 <b>🤖 질문</b> 버튼을 누르면 그 문제를 바로 가져옵니다.</div>`;
  else th.innerHTML = CHAT.map(m => `<div class="ai-msg ${m.role}${m.role === "assistant" ? " ai-rich" : ""}">${m.role === "assistant" ? mdRender(m.content) : esc(m.content).replace(/\n/g, "<br>")}</div>`).join("");
  th.scrollTop = th.scrollHeight;
}
function askAboutQuestion(id) { chatCtxId = id; openChat(); chatCtxBar(); const i = $("#aiInput"); if (i) { i.placeholder = "이 문제에 대해 물어보세요"; i.focus(); } }
let typeTimer = null;
function stopType() { if (typeTimer) { clearInterval(typeTimer); typeTimer = null; } }
function typewrite(el, full) {     // AI 홈페이지풍 타자기 렌더(마크다운 점진 렌더)
  stopType();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || full.length < 40) { el.innerHTML = mdRender(full); return; }
  const total = full.length, step = Math.max(2, Math.floor(total / 140)); let pos = 0;
  const th = $("#aiThread");
  el.innerHTML = "";
  typeTimer = setInterval(() => {
    pos += step;
    if (pos >= total) { el.innerHTML = mdRender(full); stopType(); }
    else el.innerHTML = mdRender(full.slice(0, pos)) + '<span class="ai-caret"></span>';
    if (th) th.scrollTop = th.scrollHeight;
  }, 14);
}
async function sendChat() {
  const inp = $("#aiInput"); if (!inp || chatBusy) return;
  const text = inp.value.trim(); if (!text) return;
  if (!aiConfigured()) { CHAT.push({ role: "assistant", content: "AI 기능이 아직 설정되지 않았습니다(관리자 설정 필요)." }); chatRender(); return; }
  stopType();
  CHAT.push({ role: "user", content: text }); inp.value = ""; chatRender();
  chatBusy = true; const sb = $("#aiSend"); if (sb) sb.disabled = true;
  const th = $("#aiThread"); const wait = document.createElement("div"); wait.className = "ai-msg assistant pending"; wait.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>'; if (th) { th.appendChild(wait); th.scrollTop = th.scrollHeight; }
  const sys = [{ role: "system", content: CHAT_SYS }];
  if (chatCtxId) { const q = qById(chatCtxId); if (q) { const solved = !!(S.prog[chatCtxId] && S.prog[chatCtxId].status); sys.push({ role: "system", content: "[학생이 보고 있는 문제]\n" + qContext(q, solved) }); } }
  let hist = CHAT.slice(-12); while (hist.length && hist[0].role === "assistant") hist.shift();   // Gemini는 contents가 user로 시작해야 함
  let animate = false;
  try {
    const r = await aiChat(sys.concat(hist));
    CHAT.push({ role: "assistant", content: r }); animate = true;
  } catch (e) { CHAT.push({ role: "assistant", content: "⚠ " + String((e && e.message) || e) }); }
  finally {
    chatBusy = false; if (sb) sb.disabled = false; chatRender();
    if (animate) { const bs = th ? th.querySelectorAll(".ai-msg.assistant") : []; const last = bs[bs.length - 1]; if (last) typewrite(last, CHAT[CHAT.length - 1].content); }
  }
}
function initChatPanel() {
  const fab = $("#aiFab"), panel = $("#aichat");
  if (!aiConfigured()) { if (fab) fab.style.display = "none"; if (panel) panel.style.display = "none"; return; }
  const pick = $(".ai-model-pick"), mbtn = $("#aiModelBtn"), menu = $("#aiModelMenu"), curEl = $("#aiModelCur");
  if (pick) {
    if (AI_MODELS.length > 1 && mbtn && menu && curEl) {
      pick.style.display = "";
      const setLabel = () => { const m = AI_MODELS.find(x => x.id === currentModel()); curEl.textContent = m ? m.label : "모델"; };
      setLabel();
      menu.innerHTML = AI_MODELS.map(m => `<button type="button" class="ai-model-item${m.id === currentModel() ? " on" : ""}" data-mid="${esc(m.id)}" role="option">${esc(m.label)}</button>`).join("");
      mbtn.onclick = () => { const open = menu.hidden; menu.hidden = !open; mbtn.setAttribute("aria-expanded", String(open)); };
      menu.querySelectorAll(".ai-model-item").forEach(it => it.onclick = () => {
        S.model = it.dataset.mid; save(); setLabel();
        menu.querySelectorAll(".ai-model-item").forEach(x => x.classList.toggle("on", x.dataset.mid === S.model));
        menu.hidden = true; mbtn.setAttribute("aria-expanded", "false");
      });
    } else pick.style.display = "none";
  }
  chatRender(); chatCtxBar();
  if (fab) fab.onclick = toggleChat;
  const bg = $("#aichatBg"); if (bg) bg.onclick = closeChat;
  const cl = $("#aiChatClose"); if (cl) cl.onclick = closeChat;
  const clr = $("#aiChatClear"); if (clr) clr.onclick = () => { stopType(); CHAT = []; chatCtxId = null; chatRender(); chatCtxBar(); };
  const form = $("#aiForm"); if (form) form.onsubmit = e => { e.preventDefault(); sendChat(); };
  const inp = $("#aiInput"); if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
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
  const opts = q.options.map(o => `<li class="opt" data-m="${esc(o.m)}" role="button" tabindex="0"><span class="m">${esc(o.m)}</span><span>${esc(o.t)}</span></li>`).join("");
  const ask = aiConfigured() ? `<button class="askbtn" data-ask="${q.id}" title="이 문제 AI에게 질문" aria-label="이 문제 AI에게 질문">🤖 질문</button>` : "";
  return `<div class="card" id="q-${q.id}" data-id="${q.id}">
    <div class="qhead">${badge}<span class="badge">제${q.ch}장 · ${q.num}번</span>${tagChips(q)}<span class="sp"></span>
      ${ask}<button class="star ${star}" data-star="${q.id}" title="북마크" aria-label="북마크 토글">★</button></div>
    <div class="stem">${esc(q.stem)}</div>
    <div class="codeslot"></div>
    ${q.sec === "obj" ? `<div class="confrow" data-conf-for="${q.id}"><span class="conf-label">확신도</span>
      <button class="confchip" data-conf="sure">😎 확실</button><button class="confchip on" data-conf="mid">🙂 보통</button><button class="confchip" data-conf="guess">🤔 찍음</button></div>` : ""}
    <div class="selfexpl">
      <textarea data-expl="${q.id}" rows="2" placeholder="✍️ (선택) 왜 이게 답일지 / 어떻게 풀지 먼저 설명해보세요">${esc(S.expl[q.id] || "")}</textarea>
      ${aiConfigured() ? `<div class="expl-tools"><button class="btn sm aifb" data-aifb="${q.id}">🤖 AI 피드백</button></div>` : ""}
      <div class="ai-out" data-aiout="${q.id}"></div></div>
    ${q.sec === "obj" ? `<ul class="opts">${opts}</ul>` :
      `<div class="subans"><input type="text" placeholder="답을 입력…" data-sub="${q.id}"><button class="btn sm" data-subchk="${q.id}">확인</button><button class="reveal-btn sm" data-subhint="${q.id}">💡 힌트</button><div class="hintbox" data-hintbox="${q.id}"></div></div>`}
    <div class="ansslot"></div>
  </div>`;
}
function mountCard(card, q) {
  if (q.code && q.code.length) $(".codeslot", card).appendChild(codeWidget(q.code, q.codeTrace));
  else $(".codeslot", card).remove();
  const done = S.prog[q.id];
  const isSolved = SESSION ? (SESSION.solved && SESSION.solved.has(q.id)) : (done && done.status);
  // 복습 뷰에서는 능동 회상을 위해 항상 새로 풀게 한다(정답 미공개)
  if (S.view !== "review" && isSolved) { if (q.sec === "obj") revealAnswer(card, q, done.pick); else restoreSub(card, q, done); return; }
  showStudy(card, q);
}
function answerBox(q) { return `<div class="answer">정답: ${esc(q.answer)} ${esc(q.answerText)}</div>`; }
function retryBtn(q) { return `<button class="reveal-btn retry" data-retry="${q.id}">🔄 다시 풀기</button>`; }
function explBox(q) { const d = document.createElement("div"); d.className = "expl"; d.innerHTML = q.explHtml; enhanceBlocks(d, q.codeBlocks); return d; }
function disposeAnim(root) {  // 제거되는 DOM의 코드위젯 애니 타이머·ANIM 엔트리 정리
  $$(".play", root).forEach(p => { const id = p.dataset.cw; if (id && ANIM[id]) { if (ANIM[id].timer) clearInterval(ANIM[id].timer); delete ANIM[id]; } });
}
function rerenderCard(id) {
  const q = qById(id), old = document.getElementById("q-" + id); if (!q || !old) return;
  disposeAnim(old);
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
    card.classList.add("done"); recordAnswer(q, false, false, null); // 그냥 보기 = 미정답 취급(복습 예약)
    slot.innerHTML = answerBox(q) + retryBtn(q);
    if (q.sec === "obj") markOptions(card, q, null);
    const sa = $(".subans", card); if (sa) sa.remove();
    slot.appendChild(explBox(q)); updateProgress(); refreshNav();
  };
}
function cardConf(card) {                  // 카드에서 사전 선택한 확신도(없으면 보통)
  const chip = $(".confrow .confchip.on", card);
  return (chip && chip.dataset.conf) || "mid";
}
function onPick(card, q, m) {
  if (card.classList.contains("done")) return;
  const ok = m === q.answer;
  const level = cardConf(card);            // 답 보기 전에 고른 확신도(확실/보통/찍음)
  recordAnswer(q, ok, level !== "guess", m); // '찍음'만 비확신 → 박스 승급 보류
  const p = S.prog[q.id];
  if (p) { p.conf = level; if (level === "guess") { if (p.attempts <= 1) p.firstTry = false; p.dueAt = now(); } save(); }   // 사전 '찍음' = 사후 markGuessed와 동일 처리(첫시도 정답 인정 X·즉시 복습)
  revealAnswer(card, q, m);
  updateProgress(); refreshNav();
  toast(ok ? "정답! 🎉" : "오답 — 해설을 확인하세요");
}
function hintLadder(ans) {           // 주관식 단계적 힌트(인식→생성 사다리): 길이→첫글자→절반공개
  const a = String(ans || "").trim();
  if (!a) return [];
  const rungs = [`길이 ${a.length}글자`];
  if (a.length > 1) rungs.push(`첫 글자: "${a[0]}"`);    // 1글자 정답은 첫글자=정답 전체 → 누출 방지로 생략
  const half = Math.ceil(a.length / 2);
  if (a.length > 2) rungs.push(`${a.slice(0, half)}${"○".repeat(a.length - half)}`);  // 2글자는 첫글자 힌트와 중복 → 생략
  return rungs;
}
function onSubCheck(card, q) {
  if (card.classList.contains("done")) return;     // 채점 후 재채점 방지
  const inp = $(`[data-sub="${q.id}"]`, card), slot = $(".ansslot", card);
  const val = inp ? inp.value : "";
  const sa = $(".subans", card); if (sa) sa.remove();
  const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");
  const guess = norm(val);
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
    recordAnswer(q, v !== "wrong", v === "correct", val);
    card.classList.add("done"); card.classList.remove("correct", "wrong"); card.classList.add(v === "wrong" ? "wrong" : "correct");
    self.querySelector(".selfgrade").innerHTML = "기록됨 — " + (v === "correct" ? "맞음 ✅" : v === "unsure" ? "헷갈림 🤔 (복습 예약)" : "틀림 ❌ (복습 예약)") + " " + retryBtn(q);
    updateProgress(); refreshNav();
  });
}

/* ---------- 진도/네비 ---------- */
function updateProgress() {
  const ids = QS.map(q => q.id);
  const done = ids.filter(i => S.prog[i] && S.prog[i].status).length;
  const correct = ids.filter(i => S.prog[i] && S.prog[i].status && S.prog[i].firstTry).length;
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
let _scrollTo = null;
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
  if (!("IntersectionObserver" in window)) { ops.forEach(op => emitOp(main, op)); return; } // 구형 브라우저 폴백
  function more() {
    if (_io) { _io.disconnect(); _io = null; }
    const old = document.getElementById("sentinel"); if (old) old.remove();
    let cards = 0;
    while (idx < ops.length && cards < BATCH) { const op = ops[idx++]; emitOp(main, op); if (op.t === "card") cards++; }
    // 펜딩 스크롤 타깃: 보이지 않으면 찾을 때까지 배치를 계속 로드
    if (_scrollTo) {
      const el = document.getElementById("q-" + _scrollTo);
      if (el) { el.scrollIntoView({ behavior: "smooth" }); _scrollTo = null; }
      else if (idx < ops.length) { more(); return; }
      else _scrollTo = null;
    }
    if (idx < ops.length) { const s = document.createElement("div"); s.id = "sentinel"; s.style.height = "1px"; main.appendChild(s); _io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: "800px" }); _io.observe(s); }
  }
  more();
}
function renderLearn() {
  const main = $("#main"); main.innerHTML = "";
  if (SESSION) {
    const list = SESSION.ids.map(qById).filter(Boolean);
    const solved = SESSION.solved ? SESSION.solved.size : 0;
    const head = document.createElement("div"); head.className = "session-head";
    head.innerHTML = `<div class="sh-title">🎯 ${esc(SESSION.label)} <span class="rh-tag">약점·복습 우선</span></div>
      <div class="sh-row"><span class="muted">진행 ${solved} / ${list.length}</span><button class="ghost" id="endSession">✕ 세션 종료</button></div>`;
    main.appendChild(head);
    $("#endSession").onclick = () => { SESSION = null; setView("learn"); };
    if (!list.length) { main.insertAdjacentHTML("beforeend", `<div class="empty">세션 문항이 없습니다.</div>`); return; }
    lazyRender(main, list.map(q => ({ t: "card", q })));
    return;
  }
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

/* ---------- 🔮 코드 출력 예측 모드 ---------- */
function predOutput(q) {            // 예측 대상: 출력 또는 예외가 있는 stem 코드
  if (!q.codeTrace || !q.codeTrace.length) return null;
  const f = q.codeTrace[q.codeTrace.length - 1];
  if (!(f.out || "") && !f.error) return null;
  return { out: f.out || "", err: f.error || null };
}
const PRED_POOL = QS.filter(q => q.code && q.code.length && predOutput(q));
function predNorm(s) { return (s || "").replace(/\r/g, "").split("\n").map(l => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, ""); }
function predScore(q) { const p = S.prog[q.id]; if (!p || !p.status) return 0; if (p.lastResult === false) return 1; return 2 + (p.box || 0); }
let PRED = null;
function buildPredQueue() {
  const pool = PRED_POOL.slice();
  shuffle(pool, seeded((now() & 0x7fffffff) || 1));
  pool.sort((a, b) => predScore(a) - predScore(b));   // 안 푼 것·틀린 것·낮은 박스 먼저
  return { queue: pool, i: 0, n: 0, c: 0, recorded: new Set() };
}
function predRecord(correct) {
  if (PRED.recorded.has(PRED.i)) return;              // 인덱스당 1회만 기록(재렌더·중복클릭 방지)
  PRED.recorded.add(PRED.i);
  const q = PRED.queue[PRED.i]; PRED.n++; if (correct) PRED.c++;
  recordAnswer(q, correct, correct, null);            // 정확 예측 = 확신 인출 → 박스 승급 / 오답 = 복습 예약
  updateProgress(); refreshNav(); updatePredHead();
}
function updatePredHead() {
  const el = $(".rh-sub");
  if (el && S.view === "predict" && PRED) el.innerHTML = `이번 세션 <b>${PRED.n}</b>문항 풀이 · 정답 <b>${PRED.c}</b> · 남은 문제 ${Math.max(0, PRED.queue.length - PRED.i)}`;
}
function renderPredict() {
  const main = $("#main"); main.innerHTML = "";
  if (!PRED_POOL.length) { main.innerHTML = '<div class="empty">예측 연습이 가능한 코드 문제가 없습니다.</div>'; return; }
  if (!PRED) PRED = buildPredQueue();
  while (PRED.i < PRED.queue.length && PRED.recorded.has(PRED.i)) PRED.i++;   // 이미 기록한 문항은 건너뜀(이탈 후 복귀 시 재출제 방지)
  const head = document.createElement("div"); head.className = "review-head";
  head.innerHTML = `<div class="rh-title">🔮 코드 출력 예측 <span class="rh-tag">정답 보기 전에 결과를 먼저 맞혀보세요</span></div>
    <div class="rh-sub">이번 세션 <b>${PRED.n}</b>문항 풀이 · 정답 <b>${PRED.c}</b> · 남은 문제 ${Math.max(0, PRED.queue.length - PRED.i)}</div>`;
  main.appendChild(head);
  if (PRED.i >= PRED.queue.length) {
    const done = document.createElement("div"); done.className = "empty";
    done.innerHTML = `🎉 예측 연습을 한 바퀴 끝냈어요!<br><br>이번 세션 ${PRED.n}문항 중 <b>${PRED.c}</b>문항 정확히 예측.<br><br>
      <button class="cta" id="predRestart" style="max-width:280px;margin:14px auto 0">🔄 다시 섞어서 풀기</button>`;
    main.appendChild(done);
    $("#predRestart").onclick = () => { PRED = buildPredQueue(); render(); };
    return;
  }
  const q = PRED.queue[PRED.i];
  const card = document.createElement("div"); card.className = "card predict-card"; card.id = "pred-" + q.id;
  card.innerHTML = `<div class="qhead"><span class="badge">제${q.ch}장 · ${q.num}번</span>${q.concept ? `<span class="tg concept">${esc(q.concept)}</span>` : ""}<span class="sp"></span><span class="pred-count">${PRED.i + 1} / ${PRED.queue.length}</span></div>
    <div class="stem">🔮 다음 코드를 실행하면 무엇이 <b>출력</b>될까요? <span class="muted">(예외가 발생하면 어떤 예외인지)</span></div>
    <div class="codeslot"></div>
    <div class="predin"><textarea data-predin rows="3" placeholder="예상 출력을 입력…&#10;(Enter=확인, Shift+Enter=줄바꿈)"></textarea>
      <div class="predbtns"><button class="btn" data-predchk>확인</button>
        <button class="reveal-btn" data-predskip>잘 모르겠어요 (정답 보기)</button></div></div>
    <div class="ansslot"></div>`;
  main.appendChild(card);
  $(".codeslot", card).appendChild(codeWidget(q.code, null));   // 트레이스 숨김(출력 미리보기 방지)
  const ta = $("[data-predin]", card);
  $("[data-predchk]", card).onclick = () => predReveal(card, q, ta.value, "check");
  $("[data-predskip]", card).onclick = () => predReveal(card, q, null, "skip");
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); predReveal(card, q, ta.value, "check"); } });
  ta.focus();
}
function predReveal(card, q, userVal, mode) {
  const exp = predOutput(q);
  const expStr = (exp.out || "") + (exp.err ? ((exp.out ? "\n" : "") + "⚠ " + exp.err) : "");
  const auto = mode === "check" && userVal != null && !exp.err && predNorm(exp.out) !== "" && predNorm(userVal) === predNorm(exp.out);
  const pending = !auto && mode === "check";          // 자가채점 대기(채점 전까지 "다음" 숨김 → 기록 누락 방지)
  const inwrap = $(".predin", card); if (inwrap) inwrap.remove();
  const slot = $(".ansslot", card);
  let html = "";
  if (mode === "check") html += `<div class="pred-user"><div class="pa-label">내 예측</div><pre>${esc(userVal) || '<span class="muted">(빈칸)</span>'}</pre></div>`;
  html += `<div class="pred-actual"><div class="pa-label">실제 출력</div><pre>${esc(expStr) || '<span class="muted">(출력 없음)</span>'}</pre></div>`;
  slot.innerHTML = html;
  const after = document.createElement("div"); slot.appendChild(after);
  if (auto) {
    card.classList.add("correct"); predRecord(true);
    after.innerHTML = `<div class="answer">✅ 정답! 정확히 예측했어요. (복습 안정도 ↑)</div>`;
  } else if (mode === "skip") {
    card.classList.add("wrong"); predRecord(false);
    after.innerHTML = `<div class="pred-note">📌 복습 큐에 추가했어요. 아래 단계별 실행으로 이유를 확인하세요.</div>`;
  } else {
    after.innerHTML = `<div class="selfgrade">스스로 채점:
      <button class="btn sm" data-pg="correct">✅ 맞았어요</button>
      <button class="reveal-btn" data-pg="wrong">❌ 틀렸어요</button>
      ${exp.err ? '<span class="muted">· 예외가 발생하는 문제예요</span>' : ''}</div>`;
    after.querySelectorAll("[data-pg]").forEach(b => b.onclick = () => {
      const ok = b.dataset.pg === "correct"; predRecord(ok);
      card.classList.add(ok ? "correct" : "wrong");
      after.querySelector(".selfgrade").innerHTML = "기록됨 — " + (ok ? "맞음 ✅ (복습 안정도 ↑)" : "틀림 ❌ (복습 큐에 추가)");
      nav.querySelector("[data-prednext]").classList.remove("hidden");   // 채점 후 다음 버튼 노출
    });
  }
  const why = document.createElement("div"); why.className = "pred-why";
  why.innerHTML = `<div class="pa-label">단계별 실행으로 확인</div>`;
  why.appendChild(codeWidget(q.code, q.codeTrace));    // 이제 트레이스 포함(왜 그런지 추적)
  slot.appendChild(why);
  const nav = document.createElement("div"); nav.className = "prednav";
  nav.innerHTML = `<button class="reveal-btn" data-predexpl>📖 해설 보기</button><button class="cta prednext${pending ? " hidden" : ""}" data-prednext>다음 문제 →</button>`;
  slot.appendChild(nav);
  nav.querySelector("[data-prednext]").onclick = () => { PRED.i++; render(); };
  nav.querySelector("[data-predexpl]").onclick = () => openInLearn(q.id);
}
function openInLearn(id) { SESSION = null; F = { ch: "all", type: "all", st: "all", q: "", concept: "" }; _scrollTo = id; syncFilterUI(); setView("learn"); }

/* ---------- 🎯 맞춤 학습 세션 / 약점 출제 ---------- */
function weaknessIds() {            // 지금 가장 도움 되는 순서로 문항 id 나열(중복 제거)
  const seen = new Set(), out = [];
  const push = q => { if (q && !seen.has(q.id)) { seen.add(q.id); out.push(q.id); } };
  dueList().forEach(push);                                   // 1) 복습 시점 도래
  QS.filter(q => { const p = S.prog[q.id]; return p && (p.status === "wrong" || p.firstTry === false); })
    .sort((a, b) => (S.prog[b.id].lastAt || 0) - (S.prog[a.id].lastAt || 0)).forEach(push); // 2) 최근 오답
  const weak = stat().weak.map(w => w.concept);
  QS.filter(q => weak.includes(q.concept) && !(S.prog[q.id] && S.prog[q.id].status)).forEach(push); // 3) 약점개념 미학습
  QS.filter(q => { const p = S.prog[q.id]; return p && (p.box === 1 || p.box === 2); }).forEach(push); // 4) 낮은 박스
  QS.filter(q => !(S.prog[q.id] && S.prog[q.id].status)).forEach(push);   // 5) 그 외 미학습(채움)
  return out;
}
let SESSION = null;
function startSession(n) {
  const ids = weaknessIds().slice(0, n);
  if (!ids.length) { toast("맞춤 세션을 만들 데이터가 부족해요. 먼저 문제를 풀어보세요."); return; }
  SESSION = { ids, label: `맞춤 세션 ${ids.length}문항`, solved: new Set() };
  setView("learn");
}
function updateSessionProgress() {
  const el = $(".session-head .muted");
  if (el && SESSION) el.textContent = `진행 ${SESSION.solved.size} / ${SESSION.ids.length}`;
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
function recentDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); out.push(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)); } return out; }
function dailyChartSVG() {
  const days = recentDays(14), vals = days.map(k => (S.activity[k] || { a: 0 }).a), cor = days.map(k => (S.activity[k] || { c: 0 }).c);
  const max = Math.max(1, ...vals), W = 300, H = 66, bw = W / 14, gap = 3;
  let bars = "";
  days.forEach((k, i) => {
    const h = vals[i] / max * H, hc = cor[i] / max * H, x = i * bw;
    bars += `<rect x="${x + gap}" y="${H - h}" width="${bw - gap * 2}" height="${h}" rx="2" fill="var(--line)"/>`;
    if (hc) bars += `<rect x="${x + gap}" y="${H - hc}" width="${bw - gap * 2}" height="${hc}" rx="2" fill="var(--accent)"/>`;
  });
  const tot = vals.reduce((a, b) => a + b, 0);
  return `<svg viewBox="0 0 ${W} ${H + 14}" class="chart" preserveAspectRatio="none">${bars}
    <text x="0" y="${H + 12}" class="cl">${days[0].slice(5)}</text>
    <text x="${W}" y="${H + 12}" class="cl" text-anchor="end">오늘</text></svg>
    <div class="muted" style="margin-top:4px">최근 14일 ${tot}문항 풀이 · 막대=시도, 진한색=정답</div>`;
}
function boxDistHTML() {
  const boxes = [0, 0, 0, 0, 0, 0];
  QS.forEach(q => boxes[(S.prog[q.id] || {}).box || 0]++);
  const cols = ["#94a3b8", "#ef4444", "#f59e0b", "#eab308", "#84cc16", "#16a34a"];
  const tot = QS.length;
  return `<div class="stackbar">${boxes.map((v, i) => v ? `<span style="width:${v / tot * 100}%;background:${cols[i]}" title="${BOX_NAME[i]} ${v}"></span>` : "").join("")}</div>
    <div class="legend">${boxes.map((v, i) => `<span><i style="background:${cols[i]}"></i>${BOX_NAME[i]} ${v}</span>`).join("")}</div>`;
}
function difficultyHTML() {
  const dif = {}; QS.forEach(q => { const p = S.prog[q.id]; if (!p || !p.status) return; const d = q.difficulty || "기타"; const e = dif[d] = dif[d] || { a: 0, c: 0 }; e.a++; if (p.firstTry) e.c++; });
  const order = ["쉬움", "보통", "어려움"];
  const rows = order.filter(d => dif[d]).map(d => { const e = dif[d], acc = e.c / e.a; const cls = acc >= 0.8 ? "ok" : acc >= 0.5 ? "warn" : "bad"; return `<div class="chrow"><span class="chname">${d}</span><span class="chbar"><i style="width:${Math.round(acc * 100)}%" class="${cls}bar"></i></span><span class="chnum">${e.c}/${e.a}</span><span class="chacc ${cls}">${pct(acc)}</span></div>`; });
  return rows.length ? rows.join("") : `<div class="muted">아직 푼 문제가 없습니다.</div>`;
}
function daysUntilExam() { if (!S.examDate) return null; const t = new Date(S.examDate + "T00:00:00").getTime(), today = new Date(todayStr() + "T00:00:00").getTime(); if (isNaN(t)) return null; return Math.round((t - today) / 864e5); }   // 자정 기준 비교(시험 당일=D-0)
function examPlanHTML() {          // 🗓️ 시험 D-day + 적응형 하루 목표
  const d = daysUntilExam();
  if (d === null) return `<div class="muted">시험일을 설정하면 남은 기간에 맞춰 "오늘 풀 양"을 자동으로 계산해 드립니다(분산 학습).</div>
    <div class="plan-set"><input type="date" id="examDateInput"><button class="btn sm" id="saveExamDate">설정</button></div>`;
  const unseen = QS.filter(q => !(S.prog[q.id] && S.prog[q.id].status)).length;
  const due = dueList().length, remaining = unseen + due, daysLeft = Math.max(1, d);
  const daily = Math.ceil(remaining / daysLeft);
  const goal = d <= 0 ? remaining : daily;
  const dlabel = d < 0 ? "시험일이 지났습니다" : d === 0 ? "오늘이 시험! 🔥" : `D-${d}`;
  return `<div class="dday">${esc(dlabel)}</div><div class="muted">${esc(S.examDate)} 기준 남은 ${Math.max(0, d)}일</div>
    <div class="kv"><span>안 푼 문제</span><b>${unseen}</b></div>
    <div class="kv"><span>복습 대기</span><b>${due}</b></div>
    <div class="kv"><span>오늘 권장 목표</span><b>${goal}문항</b></div>
    ${remaining ? `<div class="plan-cta"><button class="cta" data-act="session" data-n="${Math.min(40, Math.max(5, goal))}">🎯 오늘 목표만큼 맞춤 세션 시작</button></div>` : `<div class="muted" style="margin-top:8px">🎉 안 푼 문제·복습이 없습니다. 모의시험으로 점검하세요!</div>`}
    <div class="plan-set"><input type="date" id="examDateInput" value="${esc(S.examDate)}"><button class="btn sm ghostbtn" id="saveExamDate">변경</button></div>`;
}
function calibrationHTML() {       // 🎯 확신도 보정 + 과신(확신했는데 틀림) 큐
  const lv = { sure: { a: 0, c: 0, label: "😎 확실" }, mid: { a: 0, c: 0, label: "🙂 보통" }, guess: { a: 0, c: 0, label: "🤔 찍음" } };
  QS.forEach(q => { const p = S.prog[q.id]; if (!p || !p.status || !p.conf || !lv[p.conf]) return; lv[p.conf].a++; if (p.lastResult) lv[p.conf].c++; });
  const anyData = Object.keys(lv).some(k => lv[k].a > 0);
  let h = anyData ? Object.keys(lv).filter(k => lv[k].a).map(k => { const L = lv[k], acc = L.c / L.a, cls = acc >= 0.8 ? "ok" : acc >= 0.5 ? "warn" : "bad"; return `<div class="chrow"><span class="chname" style="width:64px">${L.label}</span><span class="chbar"><i style="width:${Math.round(acc * 100)}%" class="${cls}bar"></i></span><span class="chnum">${L.c}/${L.a}</span><span class="chacc ${cls}">${pct(acc)}</span></div>`; }).join("")
    : `<div class="muted">객관식을 풀 때 답 고르기 전에 확신도(확실/보통/찍음)를 선택하면 여기에 "내 확신이 얼마나 정확한지" 보정 그래프가 표시됩니다.</div>`;
  const over = QS.filter(q => { const p = S.prog[q.id]; return p && p.conf === "sure" && p.lastResult === false; });
  if (over.length) h += `<div class="over-head">⚠ 확신했는데 틀린 ${over.length}문항 <span class="w-hint">(가장 위험한 오개념 — 최우선 복습)</span></div>` +
    over.slice(0, 8).map(q => `<button class="missrow" data-review="${q.id}"><span class="badge">제${q.ch}장</span> ${esc(q.stem.slice(0, 44))}… <span class="mini-tag">${esc(q.concept || "")}</span></button>`).join("");
  return h;
}
function aiSettingsHTML() {        // 🤖 AI 도우미 상태(키는 서버 프록시에만 — 멘티 입력 없음)
  if (aiConfigured()) return `<div class="muted">🤖 AI 도우미가 켜져 있습니다. 문제 카드의 <b>🤖 질문</b> 버튼이나 오른쪽 아래 <b>🤖</b> 버튼으로 언제든 물어보세요. 자기설명을 적고 <b>🤖 AI 피드백</b>도 받을 수 있습니다. <span class="w-hint">(비용은 운영자 계정으로 처리됩니다.)</span></div>`;
  return `<div class="muted">🤖 AI 도우미가 아직 설정되지 않았습니다. <span class="w-hint">관리자: <code>proxy/README.md</code> 안내대로 프록시를 배포하고 <code>web/index.html</code>의 <code>MENTO_AI_PROXY</code>에 주소를 넣으세요.</span></div>`;
}
const MAP_COLS = ["#94a3b8", "#ef4444", "#f59e0b", "#eab308", "#84cc16", "#16a34a"];
function conceptMapHTML() {       // 🗺️ 개념별 숙련도(평균 Leitner 박스) 지도
  const m = {};
  QS.forEach(q => {
    if (!q.concept) return;
    const e = m[q.concept] = m[q.concept] || { ch: q.ch, total: 0, at: 0, boxSum: 0 };
    e.total++; const p = S.prog[q.id];
    if (p && p.status) { e.at++; e.boxSum += (p.box || 0); }
  });
  const byCh = {};
  Object.entries(m).forEach(([c, e]) => (byCh[e.ch] = byCh[e.ch] || []).push([c, e]));
  let h = "";
  Object.keys(byCh).map(Number).sort((a, b) => a - b).forEach(ch => {
    h += `<div class="cmap-ch">제${ch}장</div><div class="cmap-grid">`;
    byCh[ch].sort((a, b) => a[0].localeCompare(b[0], "ko")).forEach(([c, e]) => {
      const lvl = e.at ? Math.round(e.boxSum / e.at) : 0;
      h += `<button class="cmap-tile" data-act="drill" data-concept="${esc(c)}" title="${esc(c)} · 학습 ${e.at}/${e.total}">
        <span class="cmap-dot" style="background:${MAP_COLS[lvl]}"></span><span class="cmap-name">${esc(c)}</span><span class="cmap-frac">${e.at}/${e.total}</span></button>`;
    });
    h += `</div>`;
  });
  const legend = ["미학습", "불안정", "학습중", "익숙", "탄탄", "숙달"].map((nm, i) => `<span><i style="background:${MAP_COLS[i]}"></i>${nm}</span>`).join("");
  return h + `<div class="legend cmap-legend">${legend}</div>`;
}
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
    <div class="widget"><div class="w-label">🗓️ 시험 D-day 플래너 <span class="w-hint">(남은 기간 기반 하루 목표)</span></div>${examPlanHTML()}</div>
    <div class="widget"><div class="w-label">🎯 맞춤 학습 세션 <span class="w-hint">(약점·복습 우선 자동 구성)</span></div>
      <div class="muted">지금 가장 도움이 되는 문제만 모아 짧게 집중 학습합니다.</div>
      <div class="sessbtns">
        <button class="btn sm" data-act="session" data-n="10">10문항 (~10분)</button>
        <button class="btn sm" data-act="session" data-n="20">20문항 (~20분)</button>
        <button class="btn sm" data-act="session" data-n="30">30문항 (~30분)</button>
        <button class="btn sm ghostbtn" data-act="go-predict">🔮 출력 예측 연습</button></div></div>
    <div class="widget"><div class="w-label">📄 파이널 스프린트 치트시트 <span class="w-hint">(시험 직전 마무리)</span></div>
      <div class="muted">내 약점 개념·자주 틀린 문제·함정·북마크를 한 장으로 모아 인쇄하거나 PDF로 저장합니다.</div>
      <button class="btn sm" data-act="go-cheat" style="margin-top:10px">치트시트 열기 →</button></div>
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
    <div class="widget"><div class="w-label">📈 일별 학습량</div>${dailyChartSVG()}</div>
    <div class="dash-row">
      <div class="widget"><div class="w-label">🧩 학습 단계 분포 <span class="w-hint">(복습 안정도)</span></div>${boxDistHTML()}</div>
      <div class="widget"><div class="w-label">🎚️ 난이도별 정답률 <span class="w-hint">(첫시도)</span></div>${difficultyHTML()}</div>
    </div>
    <div class="widget"><div class="w-label">🗺️ 개념 지도 <span class="w-hint">(색=숙련도, 클릭하면 집중 학습)</span></div>${conceptMapHTML()}</div>
    <div class="widget"><div class="w-label">🎯 확신 보정 <span class="w-hint">(내 확신 vs 실제 정답률)</span></div>${calibrationHTML()}</div>
    <div class="widget backup"><div class="w-label">진도 백업</div>
      <div class="muted">진도는 이 브라우저에만 저장됩니다. 기기를 바꾸거나 초기화 전에 백업하세요.</div>
      <div class="bkbtns"><button class="btn sm" id="exportBtn">⬇ 내보내기(.json)</button>
        <button class="btn sm ghostbtn" id="importBtn">⬆ 가져오기</button>
        <input type="file" id="importFile" accept=".json" hidden></div></div>
    <div class="widget"><div class="w-label">🤖 AI 도우미</div>${aiSettingsHTML()}</div>`;
  main.appendChild(wrap);
}

/* ---------- 📄 파이널 스프린트 치트시트 ---------- */
function cheatAnswer(q) {           // 치트시트용 정답 텍스트(객관식=보기, 주관식=정답)
  if (q.sec === "obj") { const o = (q.options || []).find(x => x.m === q.answer); return q.answer + (o ? " " + o.t : ""); }
  return String(q.answerText || "");
}
function cheatQRow(q) {
  return `<div class="cheat-q"><span class="cq-stem">${esc(q.stem.replace(/\s+/g, " ").trim().slice(0, 90))}</span>
    <span class="cq-ans">→ ${esc(cheatAnswer(q).slice(0, 90))}</span>
    ${(q.traps || []).map(t => `<span class="tg trap">⚠ ${esc(t)}</span>`).join("")}</div>`;
}
function cheatWeakIds() {           // 내가 약한 문항: 첫시도 오답 / 오답 / 박스1 / 복습 도래
  return QS.filter(q => { const p = S.prog[q.id]; return p && (p.firstTry === false || p.status === "wrong" || p.box === 1 || isDue(q.id)); });
}
function renderCheat() {
  const main = $("#main"); main.innerHTML = "";
  const s = stat(), r = readiness(s);
  const myWeak = cheatWeakIds();
  const wrap = document.createElement("div"); wrap.className = "cheat";
  let body = `<div class="cheat-head"><h1>🐍 파이썬 기말 — 나의 마무리 노트</h1>
    <div class="cheat-meta">푼 문항 ${s.allAt}/${QS.length} · 첫시도 정답률 ${pct(s.ftAccAll)} · 준비도 <b>${r.label}</b></div></div>`;
  // 1) 약점 개념별 내 오답
  let conceptHtml = "";
  s.weak.forEach(w => {
    const qs = myWeak.filter(q => q.concept === w.concept).slice(0, 8);
    if (!qs.length) return;
    conceptHtml += `<div class="cheat-concept"><h3>${esc(w.concept)} <span class="cc-acc">첫시도 정답률 ${pct(w.acc)}</span></h3>${qs.map(cheatQRow).join("")}</div>`;
  });
  if (conceptHtml) body += `<section class="cheat-sec"><h2>🎯 약점 개념 — 다시 확인할 문제</h2>${conceptHtml}</section>`;
  // 2) 자주 걸린 함정
  const trapCount = {};
  (myWeak.length ? myWeak : QS).forEach(q => (q.traps || []).forEach(t => trapCount[t] = (trapCount[t] || 0) + 1));
  const traps = Object.entries(trapCount).sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (traps.length) body += `<section class="cheat-sec"><h2>⚠ 자주 걸린 함정</h2><div class="cheat-traps">${traps.map(([t, c]) => `<span class="tg trap">⚠ ${esc(t)} <b>×${c}</b></span>`).join("")}</div></section>`;
  // 3) 북마크
  const bms = QS.filter(q => S.bm[q.id]).slice(0, 30);
  if (bms.length) body += `<section class="cheat-sec"><h2>🔖 북마크한 문제</h2>${bms.map(cheatQRow).join("")}</section>`;
  // 4) 복습 대기 핵심
  const due = dueList().slice(0, 20);
  if (due.length) body += `<section class="cheat-sec"><h2>🔁 복습 대기 핵심 정리</h2>${due.map(cheatQRow).join("")}</section>`;
  // 데이터 부족 안내
  if (!conceptHtml && !bms.length && !due.length)
    body += `<section class="cheat-sec"><div class="muted">아직 학습 데이터가 적어 위 함정 목록만 표시됩니다. 학습·예측·모의시험을 진행하면 내 약점·오답이 이 노트에 자동으로 정리됩니다.</div></section>`;
  wrap.innerHTML = `<div class="cheat-toolbar no-print">
      <button class="ghost" data-act="go-dashboard">← 대시보드</button>
      <button class="btn" id="printCheat">🖨 인쇄 / PDF 저장</button></div>
    <div class="cheat-sheet">${body}</div>`;
  main.appendChild(wrap);
  $("#printCheat").onclick = () => window.print();
}

/* ---------- 모의시험 ---------- */
const PRESETS = { quick: { n: 18, t: 20, label: "빠른 진단 (18문항 · 20분)" }, standard: { n: 36, t: 45, label: "표준 모의 (36문항 · 45분)" }, full: { n: 60, t: 75, label: "실전 모의 (60문항 · 75분)" } };
function seeded(seed) { let x = seed >>> 0 || 1; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }
function shuffle(arr, rnd) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
function pickExam(n) {
  const rnd = seeded(now() & 0x7fffffff);
  const perCh = Math.max(1, Math.round(n / CH.length));
  const picked = [];
  CH.forEach(c => {
    const pool = QS.filter(q => q.ch === c.ch && q.sec === "obj"); // 자동채점 위해 객관식만
    const byCon = {}; pool.forEach(q => (byCon[q.concept] = byCon[q.concept] || []).push(q));
    const cons = Object.keys(byCon); cons.forEach(k => shuffle(byCon[k], rnd));
    let i = 0; const take = [];
    while (take.length < perCh && cons.some(k => byCon[k].length)) { const k = cons[i % cons.length]; if (byCon[k].length) take.push(byCon[k].pop()); i++; }
    picked.push(...take);
  });
  shuffle(picked, rnd);
  return picked.slice(0, n).map(q => q.id);
}
function pickWeakExam(n) {            // 약점·오답 우선, 자동채점 위해 객관식만
  const ids = weaknessIds().map(qById).filter(q => q && q.sec === "obj").map(q => q.id).slice(0, n);
  if (ids.length < n) {              // 부족하면 무작위 객관식으로 채움
    const have = new Set(ids), fill = QS.filter(q => q.sec === "obj" && !have.has(q.id));
    shuffle(fill, seeded((now() & 0x7fffffff) || 1));
    fill.slice(0, n - ids.length).forEach(q => ids.push(q.id));
  }
  shuffle(ids, seeded((now() & 0x7fffffff) || 7));
  return ids;
}
function startExam(preset) {
  let ids, t;
  if (preset === "weak") { ids = pickWeakExam(30); t = 35; }
  else { const p = PRESETS[preset]; ids = pickExam(p.n); t = p.t; }
  if (!ids.length) { toast("출제할 문항이 부족해요"); return; }
  S.exam = { preset, ids, answers: {}, flags: {}, startAt: now(), durationMs: t * 60e3, submitted: false };
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
    const opts = q.sec === "obj" ? `<ul class="opts">${q.options.map(o => `<li class="opt" data-m="${esc(o.m)}" role="button" tabindex="0"><span class="m">${esc(o.m)}</span><span>${esc(o.t)}</span></li>`).join("")}</ul>`
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
    <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="preset" data-preset="${k}">${p.label}</button>`).join("")}
      <button class="preset weak" data-preset="weak">🎯 약점 집중 모의고사 (내 약점·오답 30문항 · 35분)</button></div>
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
      <div class="muted">${objs.length}문항 중 ${correct}문항 정답${subCnt ? ` · 주관식 ${subCnt}문항(직접 확인)` : ""} · ${usedMin}분 사용</div></div>
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
  const showFilters = v === "learn" && !SESSION;          // 세션 중에는 필터/검색 숨김
  $("#filters").style.display = showFilters ? "" : "none";
  $("#search").style.display = showFilters ? "" : "none";
  if (_io) { _io.disconnect(); _io = null; }
  window.scrollTo(0, 0);
  render();
}
function render() {
  // 렌더 정리: 이전 애니메이션 타이머·옵저버·센티넬 해제(누수/유령 콜백 방지)
  for (const k in ANIM) { if (ANIM[k].timer) clearInterval(ANIM[k].timer); delete ANIM[k]; }
  if (_io) { _io.disconnect(); _io = null; }
  const sen = document.getElementById("sentinel"); if (sen) sen.remove();
  refreshNav(); updateProgress();
  if (S.view === "learn") renderLearn();
  else if (S.view === "review") renderReview();
  else if (S.view === "predict") renderPredict();
  else if (S.view === "dashboard") renderDashboard();
  else if (S.view === "cheat") renderCheat();
  else if (S.view === "exam") renderExam();
}

/* ---------- 이벤트 ---------- */
let _toastTimer = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove("show"), 1600); }
document.addEventListener("click", e => {
  const t = e.target;
  const _mm = $("#aiModelMenu"); if (_mm && !_mm.hidden && !t.closest(".ai-model-pick")) _mm.hidden = true;   // 모델 메뉴 바깥 클릭 시 닫기
  const cp = t.closest(".ai-copy"); if (cp) { const cb = cp.closest(".ai-cb"); if (cb && navigator.clipboard) navigator.clipboard.writeText(cb.dataset.code || "").then(() => { const o = cp.textContent; cp.textContent = "복사됨!"; setTimeout(() => { cp.textContent = o; }, 1200); }).catch(() => {}); return; }
  const play = t.closest(".play"); if (play) { const id = play.dataset.cw; const a = $("#" + id + "-anim"); if (a) { a.classList.toggle("show"); if (a.classList.contains("show") && ANIM[id].step < 0) animStep(id, 1); } return; }
  const ac = t.closest(".animctl button"); if (ac) { const id = ac.dataset.cw, act = ac.dataset.act; if (act === "next") animStep(id, 1); else if (act === "prev") animStep(id, -1); else if (act === "reset") { ANIM[id].step = -1; if (ANIM[id].timer) { clearInterval(ANIM[id].timer); ANIM[id].timer = null; } animRender(id); } else if (act === "play") animPlay(id, ac); return; }
  const rt = t.closest("[data-retry]"); if (rt) { const id = rt.dataset.retry; const p = S.prog[id]; if (p) { p.status = null; } if (SESSION && SESSION.solved) { SESSION.solved.delete(id); updateSessionProgress(); } save(); rerenderCard(id); updateProgress(); refreshNav(); return; } // 이력(첫시도·박스) 보존, UI만 새로 풀기
  const gl = t.closest("[data-guess]"); if (gl) { const id = gl.dataset.guess; markGuessed(qById(id)); gl.outerHTML = '<span class="guess-done">🤔 찍음으로 표시됨 — 복습에 추가했어요</span>'; updateProgress(); refreshNav(); return; }
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
  const sh = t.closest("[data-subhint]"); if (sh) {
    const q = qById(sh.dataset.subhint), box = $(".hintbox", sh.closest(".subans"));
    const rungs = hintLadder(q.answerText), shown = box.querySelectorAll(".hint-rung").length;
    if (shown < rungs.length) { const d = document.createElement("div"); d.className = "hint-rung"; d.innerHTML = `💡 힌트 ${shown + 1}: ${esc(rungs[shown])}`; box.appendChild(d); }
    if (shown + 1 >= rungs.length) { sh.disabled = true; sh.textContent = "힌트 모두 사용"; }
    return;
  }
  const cc = t.closest(".confchip"); if (cc) { const card = cc.closest(".card"); if (card && !card.classList.contains("done")) { $$(".confchip", cc.closest(".confrow")).forEach(x => x.classList.remove("on")); cc.classList.add("on"); } return; }
  const fb = t.closest("[data-aifb]"); if (fb) { runAiFeedback(fb); return; }
  const ask = t.closest("[data-ask]"); if (ask) { askAboutQuestion(ask.dataset.ask); return; }
  // 액션(대시보드/리포트)
  const actEl = t.closest("[data-act]"); if (actEl) { handleAct(actEl.dataset.act, actEl.dataset.concept, actEl.dataset.n); return; }
  if (t.id === "clearConcept") { F.concept = ""; render(); return; }
  if (t.id === "exportBtn") { exportProgress(); return; }
  if (t.id === "importBtn") { $("#importFile").click(); return; }
  if (t.id === "saveExamDate") { const v = ($("#examDateInput") || {}).value || ""; S.examDate = v; save(); renderDashboard(); toast(v ? "시험일을 설정했습니다" : "시험일을 비웠습니다"); return; }
  if (t.id === "aiCtxClear") { chatCtxId = null; chatCtxBar(); return; }
  const mr = t.closest("[data-review]"); if (mr) { F = { ch: "all", type: "all", st: "all", q: "", concept: "" }; _scrollTo = mr.dataset.review; syncFilterUI(); setView("learn"); return; }
});
// 키보드 접근성: 보기에서 Enter/Space로 선택
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.classList && e.target.classList.contains("opt")) { e.preventDefault(); e.target.click(); }
});
function handleAct(act, concept, n) {
  if (act === "session") { startSession(+n || 20); return; }
  SESSION = null;   // 그 외 대시보드 이동은 세션을 종료
  if (act === "go-review") setView("review");
  else if (act === "go-predict") setView("predict");
  else if (act === "go-cheat") setView("cheat");
  else if (act === "go-dashboard") setView("dashboard");
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
  const blob = new Blob([JSON.stringify({ v: 2, prog: S.prog, bm: S.bm, activity: S.activity, expl: S.expl, examDate: S.examDate, at: now() })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "python-study-progress.json"; a.click();
  toast("진도를 내보냈습니다");
}
document.addEventListener("change", e => {
  if (e.target.id === "cramChk") { S.cram = e.target.checked; save(); render(); }
  if (e.target.dataset && e.target.dataset.expl != null) { S.expl[e.target.dataset.expl] = e.target.value; save(); }   // 자기설명 자동 저장(blur 시)
  if (e.target.id === "importFile") {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { const d = JSON.parse(rd.result); if (d && typeof d === "object" && d.prog && typeof d.prog === "object" && !Array.isArray(d.prog)) { S.prog = d.prog; S.bm = (d.bm && typeof d.bm === "object") ? d.bm : {}; S.activity = (d.activity && typeof d.activity === "object") ? d.activity : (S.activity || {}); S.expl = (d.expl && typeof d.expl === "object") ? d.expl : (S.expl || {}); if (typeof d.examDate === "string") S.examDate = d.examDate; save(); toast("진도를 복원했습니다"); render(); } else toast("올바른 백업 파일이 아닙니다"); } catch (x) { toast("파일을 읽을 수 없습니다"); } };
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
$("#nav").onclick = e => { const b = e.target.closest("[data-view]"); if (b) { SESSION = null; setView(b.dataset.view); } };
$("#themeBtn").onclick = () => { S.theme = S.theme === "dark" ? "light" : "dark"; applyTheme(); save(); };
$("#resetBtn").onclick = () => { if (confirm("진도·정오답·북마크 기록을 모두 지울까요? (되돌릴 수 없습니다)")) { S.prog = {}; S.bm = {}; save(); render(); toast("기록을 초기화했습니다"); } };
function applyTheme() { document.documentElement.setAttribute("data-theme", S.theme); $("#themeBtn").textContent = S.theme === "dark" ? "☀️" : "🌙"; }

/* ---------- 초기화 ---------- */
try {
  applyTheme(); buildChapterFilter();
  var p = new URLSearchParams(location.search), ch = p.get("ch"), vw = p.get("view");
  if (ch && chMap[+ch]) { F.ch = ch; }
  if (vw && ["learn", "review", "predict", "dashboard", "cheat", "exam"].includes(vw)) S.view = vw;
  syncFilterUI();
  setView(S.view || "learn");
  initChatPanel();
} catch (e) {
  var em = $("#main"); if (em) em.innerHTML = '<div class="empty">⚠ 화면을 그리는 중 오류가 발생했습니다:<br><br><code>' + esc(String((e && e.message) || e)) + '</code><br><br>이 메시지를 캡처해 보내주시면 바로 고쳐드리겠습니다.</div>';
}
})();
