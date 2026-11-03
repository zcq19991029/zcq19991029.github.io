// 华夏工具 · 刷题：界面和刷题流程。题库解析、AI 解析沿用 imports.js / ai.js；存储见 store.js；账号见 hx.js。
import * as hx from './hx.js';
import * as store from './store.js';
import { providers, getSettings, saveSettings, setAiProfile, chat, streamChat, listModels, explainQuestion } from './ai.js';
import { readMaterial, normalizeQuestions, aiImport, aiGenerate } from './imports.js';
import { figSvg, figName } from './symbols.js';

// 内置课程题库（data/ 下的 JSON）；第一个是默认科目
const BUILTIN = [
  { id: 'wiring', name: '电气接线原理', file: 'data/wiring.json', tag: '期末理论' },
  { id: 'mcu', name: '单片机应用技术', file: 'data/mcu.json', tag: '期末理论' },
  { id: 'psychology', name: '教育心理学', file: 'data/questions.json', tag: '教资' },
  { id: 'education', name: '教育学', file: 'data/education.json', tag: '教资' },
];
const TYPES = [['single', '单选'], ['multiple', '多选'], ['judgment', '判断'], ['fill', '填空'], ['term', '名词解释'], ['short', '简答'], ['prog', '程序分析']];
const SELF = new Set(['term', 'short', 'prog']); // 主观题：看参考答案自己判对错
const SCOPES = [['todo', '待掌握'], ['wrong', '错题'], ['new', '未做'], ['done', '已做'], ['known', '已记住']];
// 出题顺序：题库顺序、刷题顺序（按上次作答时间，没做过的排在后面）各有正序倒序，再加随机
const ORDERS = [['seq', '题库正序', '按题库里的编号从前往后'], ['seqR', '题库倒序', '按题库里的编号从后往前'], ['time', '刷题正序', '先出很久以前做的，没做过的在最后'], ['timeR', '刷题倒序', '先出最近做的，没做过的在最后'], ['rand', '随机', '打乱顺序']];
const VIEWS = [
  ['practice', '刷题', 'M4 4h16v12H5.17L4 17.17V4zm2 2v7h12V6H6zm2 2h8v2H8V8z'],
  ['overview', '概览', 'M5 19V9h3v10H5zm5.5 0V5h3v14h-3zM16 19v-7h3v7h-3z'],
  ['rank', '排行', 'M7 3h10v4.5a5 5 0 0 1-4 4.9V15h3.5v2h-9v-2H11v-2.6a5 5 0 0 1-4-4.9V3zM3 4h3v2H5v1a2 2 0 0 0 2 2v2a4 4 0 0 1-4-4V4zm15 0h3v3a4 4 0 0 1-4 4V9a2 2 0 0 0 2-2V6h-1V4zM6 19h12v2H6v-2z'],
  ['bank', '题库', 'M4 5h7v14H4V5zm9 0h7v14h-7V5zM6 7v3h3V7H6zm9 0v3h3V7h-3z'],
  ['settings', '设置', 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm8.6 5.3l-1.9-.4a7 7 0 0 1-.6 1.4l1.1 1.6-1.6 1.6-1.6-1.1c-.4.3-.9.5-1.4.6l-.4 1.9h-2.3l-.4-1.9a7 7 0 0 1-1.4-.6l-1.6 1.1-1.6-1.6 1.1-1.6c-.3-.4-.5-.9-.6-1.4l-1.9-.4v-2.3l1.9-.4c.1-.5.3-1 .6-1.4L5.6 6.6l1.6-1.6 1.6 1.1c.4-.3.9-.5 1.4-.6l.4-1.9h2.3l.4 1.9c.5.1 1 .3 1.4.6l1.6-1.1 1.6 1.6-1.1 1.6c.3.4.5.9.6 1.4l1.9.4v2.3z'],
];

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const optText = o => o.text || (o.fig ? `［图：${figName(o.fig)}］` : ''); // 选项是图形符号时，给 AI 和扩展的文字
const figText = q => q.fig ? `\n［图：${figName(q.fig)}］` : '';
const typeName = t => (TYPES.find(x => x[0] === t) || [, t])[1];
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// 选项展示顺序：内置题库都是「答案总落在同一个位置」（电气接线原理 370 题里 213 题答案在 B，占 58%），
// 同学不用看题、只数位置就能蒙对，等于白刷。所以显示时把选项打乱——题库本身不动（答案仍记在 key 上），
// 判分照旧比 key，只是位置变了。用题目 id 做种子，同一道题每次打开顺序固定，不会一刷新就变来变去。
const seedOf = s => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function showOpts(q) { // 判断题（✓/✗）不打乱，两个选项本来就是固定的
  const o = q.options || [];
  if (!o.length || q.type === 'judgment' || o.length < 2) return o;
  let s = seedOf(q.id) || 1;
  const a = [...o];
  for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const norm = t => String(t || '').replace(/[\s（）()，,。.、:：；;“”"'？?！!]/g, '').toLowerCase();
// 填空的可接受写法：答案本身、括号前的部分、括号里“或”列出的写法，如“83（或 0x83、83H）”
const variants = a => { const s = String(a), m = s.match(/^(.*?)[（(](.*)[)）]$/), v = [s]; if (m) { v.push(m[1]); m[2].replace(/^(或|约)\s*/, '').split(/[、，,]|或/).forEach(x => v.push(x)); } return v.map(norm).filter(Boolean); };
const blankOk = (a, t) => variants(a).includes(norm(t));
// 危险按钮点两下才执行：第一下变成“确认…？”，3 秒内再点才执行（应用内浏览器里 confirm() 不弹框、直接当取消）
function sure(b, label, fn) {
  if (b.dataset.sure) { clearTimeout(+b.dataset.sure); delete b.dataset.sure; b.textContent = b.dataset.txt; return fn(); }
  b.dataset.txt = b.textContent; b.textContent = label;
  b.dataset.sure = setTimeout(() => { delete b.dataset.sure; b.textContent = b.dataset.txt; }, 3000);
}
// 作答记录 picked：选择题是选的选项；填空、主观题是 ['ok'] 或 ['no']（填空填的字在 S.typed）
let tapAt = 0; // 上次用指针点选项的时间，挡掉随后补发的 click
// “夜夜题库AI伴侣”扩展装了会在页面根上挂 #icve-companion（扩展 content.js）；只看有没有，不碰扩展里的 Key
const hasExt = () => !!document.getElementById('icve-companion');
const isRight = (q, p) => !!p && (q.type === 'fill' || SELF.has(q.type) ? p[0] === 'ok' : sameSet(p, q.answer));
function toast(msg, act, fn) { // act/fn：toast 里带一个按钮（如“撤销”）
  const t = $('toast'); t.innerHTML = esc(msg) + (act ? ` <button type="button" class="btn sm ghost" style="height:28px;margin-left:6px">${esc(act)}</button>` : '');
  if (act) t.querySelector('button').onclick = () => { t.classList.remove('show'); fn(); };
  // 只有显示时能点（class act）：以前用 style 设 pointer-events，提示淡出后透明的“撤销”还挡在题卡上，点选项没反应
  t.classList.toggle('act', !!act); t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), act ? 4000 : 2200);
}

// 快捷键：每个动作两个键位，可在“设置”里改。答完题时 记住/再练 优先，没答时 上一题/下一题
const KEY_ACTS = [['know', '记住并下一题'], ['again', '再练（不熟）'], ['prev', '上一题'], ['next', '下一题'], ['submit', '提交 / 看答案'], ['ask', '问 AI']];
const KEY_DEF = { know: [' ', 'ArrowLeft'], again: ['ArrowRight', ''], prev: ['ArrowLeft', ''], next: ['ArrowRight', ''], submit: ['Enter', ''], ask: ['/', ''] };
const keyMap = () => ({ ...KEY_DEF, ...store.getLocal('keys', {}) });
const keyName = k => ({ ' ': '空格', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '回车', Escape: 'Esc', Backspace: '退格' }[k] || (k.length === 1 ? k.toUpperCase() : k));
const keyOf = a => keyMap()[a].filter(Boolean).map(keyName).join(' / ') || '无';

const S = {
  view: 'practice', me: null, user: null,
  subjects: [], subject: null, // 当前科目 {id, name, kind: builtin|public|mine, ...}
  base: {}, // 科目 id → 课程题（内置或老师发布）
  bank: [], // 当前科目里自己导入的题
  questions: [], records: {},
  type: 'single', scope: 'todo', mode: 'seq',
  queue: [], i: 0, picked: {}, // picked：题 id → 本轮选的选项（作答过）
  sel: new Set(), ai: {}, draft: null, imode: 'pick', typed: {}, shown: {}, // typed：填空填的字；shown：主观题已看参考答案
  undo: {}, lastId: null, chat: [], // undo：题 id → 标记前的状态（误点“记住”能撤销）
  askDraft: '', // “问 AI”打了一半的字：关掉抽屉、切到别的抽屉都不丢，发出去才清
  hsel: new Set(), hf: 'all', // 概览“刷题记录”：勾选的题、筛选
  rmine: false, // 排行：只看本班
};
const prefs = () => store.getLocal('prefs', {});
const savePrefs = () => store.setLocal('prefs', { subject: S.subject?.id, type: S.type, scope: S.scope, mode: S.mode });
const inPortal = () => { try { return window.top !== window && window.top.location.pathname === '/'; } catch { return false; } };
const isTeacher = () => !!(S.me && (S.me.teacher || S.me.admin || S.me.dev));
const rec = id => S.records[id] || { status: 'new', attempts: 0, wrong: 0 };
const inScope = (r, s) => s === 'todo' ? r.status !== 'known' : s === 'wrong' ? r.wrong > 0 && r.status !== 'known' : s === 'new' ? !r.attempts : s === 'done' ? r.attempts > 0 : r.status === 'known';

// ---------- 科目和题库 ----------
async function loadSubjects(withPublic = true) { // withPublic=false：先不等老师发布的题库（联网慢），内置科目马上能刷
  const [mine, pub] = await Promise.all([store.read('subjects', [], store.mergeSubjects), withPublic ? store.publicList() : S.subjects.filter(s => s.kind === 'public').map(s => ({ id: s.pid, name: s.name, owner_name: s.owner, total: s.total }))]);
  const mineIds = new Set(mine.map(s => s.id));
  S.subjects = [
    ...BUILTIN.map(s => ({ ...s, kind: 'builtin' })),
    ...(pub || []).filter(p => !(p.mine && mineIds.has(p.id))).map(p => ({ id: 'pub-' + p.id, pid: p.id, name: p.name, kind: 'public', owner: p.owner_name, tag: p.owner_name ? p.owner_name + ' 发布' : '老师发布', total: p.total,
      // 下发范围（2026-11-02）：targets 是给人看的说明，class_ids 给发布面板回填复选框
      mine: p.mine, targets: p.targets, class_ids: p.class_ids })),
    ...mine.map(s => ({ ...s, kind: 'mine' })),
  ];
}
async function baseOf(sub) {
  if (S.base[sub.id]) return S.base[sub.id];
  let list = [];
  if (sub.kind === 'builtin') {
    // 离线版：题库已经内联在文件里（window.__BANK），file:// 下 fetch 会被浏览器拦，直接取
    if (window.__OFFLINE && window.__BANK && window.__BANK[sub.file]) list = window.__BANK[sub.file];
    else { const r = await fetch(sub.file + '?v=20261031', { cache: 'no-cache' }); if (!r.ok) throw new Error('题库加载失败 HTTP ' + r.status); list = await r.json(); }
  }
  else if (sub.kind === 'public') { const r = await store.publicGet(sub.pid); list = (r && r.questions) || []; }
  return (S.base[sub.id] = list);
}
async function openSubject(id) {
  const sub = S.subjects.find(s => s.id === id) || S.subjects[0];
  S.subject = sub; S.ai = {}; S.draft = null;
  paintSubj();
  $('card').innerHTML = '<div class="empty"><p class="muted">正在加载题库…</p></div>';
  // 手快连点两个科目时，先发的那次可能后回来。用序号记住“谁最后一次点的”，
  // 回来的旧结果直接丢掉，否则会出现左上角写着一个科目、中间却是另一个科目
  const seq = S.subSeq = (S.subSeq || 0) + 1;
  let base = [];
  try { base = await baseOf(sub); } catch (e) { toast(e.message); }
  const bank = await store.read('bank:' + sub.id, [], (a, b) => (b && b.length ? b : a));
  const records = await store.read('progress:' + sub.id, {}, store.mergeProgress);
  if (seq !== S.subSeq || S.subject !== sub) return; // 期间又换过一次科目，这次结果作废
  S.bank = bank;
  const seen = new Set(base.map(q => q.id));
  S.questions = [...base, ...S.bank.filter(q => !seen.has(q.id))];
  S.records = records;
  if (!S.questions.some(q => q.type === S.type)) S.type = (TYPES.find(t => S.questions.some(q => q.type === t[0])) || TYPES[0])[0];
  savePrefs(); buildQueue(true);
  paintSubj(); // 加载完再对一次：科目名、标题、右侧题型，保证和中间内容是同一个科目
  show(S.view);
}
// 左上角科目名 + 标签页标题：只有一个来源（S.subject），别的地方不要单独改
function paintSubj() {
  const n = S.subject ? S.subject.name : '';
  if ($('subjName').textContent !== n) $('subjName').textContent = n;
  document.title = n ? n + ' · 刷题' : '刷题 · 华夏工具';
}
const saveRecords = () => store.write('progress:' + S.subject.id, S.records);

// ---------- 出题队列 ----------
const sessKey = () => `sess:${S.subject.id}:${S.type}:${S.scope}:${S.mode}`;
function buildQueue(resume) {
  const ids = S.questions.filter(q => q.type === S.type && inScope(rec(q.id), S.scope)).map(q => q.id);
  const saved = resume && store.getLocal(sessKey(), null);
  const known = new Set(S.questions.map(q => q.id));
  if (saved && Array.isArray(saved.ids) && saved.ids.length && saved.ids.every(id => known.has(id))) {
    const had = new Set(saved.ids), fresh = ids.filter(id => !had.has(id)); // 题库加了新题：接在本轮后面，不打断进度
    S.queue = [...saved.ids, ...order(fresh)]; S.i = Math.min(saved.i || 0, S.queue.length); S.picked = saved.picked || {};
  } else { S.queue = order(ids); S.i = 0; S.picked = {}; }
  S.sel = new Set(S.picked[S.queue[S.i]] || []);
}
function order(ids) {
  if (S.mode === 'rand') return shuffle(ids);
  if (S.mode === 'seqR') return [...ids].reverse();
  if (S.mode === 'time' || S.mode === 'timeR') {
    const at = id => rec(id).at || 0, done = ids.filter(at).sort((a, b) => at(a) - at(b));
    return [...(S.mode === 'time' ? done : done.reverse()), ...ids.filter(id => !at(id))];
  }
  return ids;
}
const saveSess = () => store.setLocal(sessKey(), { ids: S.queue, i: S.i, picked: S.picked });
const clearSess = () => { for (const [t] of TYPES) for (const [sc] of SCOPES) for (const [m] of ORDERS) store.setLocal(`sess:${S.subject.id}:${t}:${sc}:${m}`, null); };
// 清空重刷：清掉本科目的已记住、错题、作答记录，从头开始
function resetAll() { S.records = {}; S.hsel.clear(); store.write('progress:' + S.subject.id, {}, { now: true }); clearSess(); buildQueue(false); toast('已清空，从头开始刷'); show('practice'); }
const cur = () => S.questions.find(q => q.id === S.queue[S.i]);
function go(i) {
  S.i = Math.max(0, Math.min(i, S.queue.length)); S.sel = new Set(S.picked[S.queue[S.i]] || []);
  saveSess(); renderCard(); renderBar();
  if ($('card').getBoundingClientRect().top < 60) scrollTo({ top: 0, behavior: 'smooth' }); // 题卡顶看得见就不滚：滚动中点选项，手机上会被当成停住滚动
}

// ---------- 作答 ----------
function pick(k) {
  const q = cur(); if (!q || S.picked[q.id]) return;
  if (q.type === 'multiple') { S.sel.has(k) ? S.sel.delete(k) : S.sel.add(k); renderCard(); return; }
  S.sel = new Set([k]); submit();
}
function submit() {
  const q = cur(); if (!q || S.picked[q.id]) return;
  if (q.type === 'fill') {
    const v = [...$('card').querySelectorAll('.blank')].map(i => i.value.trim()); if (!v.some(Boolean)) return $('card').querySelector('.blank')?.focus();
    S.typed[q.id] = v; const ok = q.answer.every((a, n) => blankOk(a, v[n])); return answer(q, [ok ? 'ok' : 'no'], ok);
  }
  if (!S.sel.size) return;
  const sel = [...S.sel].sort(); answer(q, sel, sameSet(sel, q.answer));
}
function selfGrade(ok) { const q = cur(); if (q && !S.picked[q.id]) answer(q, [ok ? 'ok' : 'no'], ok); }
function override() { // 填空判错、其实意思对：算对
  const q = cur(), r = { ...rec(q.id) }; r.wrong = Math.max(0, (r.wrong || 0) - 1); r.ok = true; r.last = ['ok'];
  S.records[q.id] = r; S.picked[q.id] = ['ok']; saveRecords(); saveSess(); renderHero(); renderScopes(); renderCard(); renderBar();
}
function answer(q, sel, ok) {
  const r = { ...rec(q.id) };
  r.attempts = (r.attempts || 0) + 1; if (!ok) { r.wrong = (r.wrong || 0) + 1; r.status = 'unknown'; }
  r.last = sel; r.ok = ok; r.at = Date.now();
  S.records[q.id] = r; S.picked[q.id] = sel;
  if (ok) rankAdd(q, sel);
  saveRecords(); saveSess(); renderHero(); renderScopes(); renderCard(); renderBar();
  if (navigator.vibrate) navigator.vibrate(ok ? 12 : [20, 40, 20]);
}
function mark(status) {
  const q = cur(); if (!q) return;
  const before = rec(q.id).status, at = S.i;
  S.undo[q.id] = before;
  S.records[q.id] = { ...rec(q.id), status, at: Date.now() };
  saveRecords(); renderHero(); renderScopes(); go(S.i + 1);
  if (status === 'known' && before !== 'known') toast('已记住', '撤销', () => { unmark(q.id); go(at); });
}
function unmark(id) { // 撤销误点的“记住”：回到标记前的状态
  S.records[id] = { ...rec(id), status: S.undo[id] || 'new' }; delete S.undo[id];
  saveRecords(); renderHero(); renderScopes(); renderCard(); renderBar();
}

// ---------- 渲染 ----------
function renderNav() {
  const btn = ([id, label, d]) => `<button type="button" data-v="${id}" aria-current="${S.view === id}">${d ? `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>` : ''}${label}</button>`;
  $('tabs').innerHTML = VIEWS.map(([a, b]) => btn([a, b])).join('');
  $('dock').innerHTML = VIEWS.map(btn).join('');
  for (const b of document.querySelectorAll('[data-v]')) b.onclick = () => show(b.dataset.v);
  // 顶栏换成「一块跟着当前项滑过去」的指示器（只在桌面顶栏做；手机底部 dock 每项都带图标，滑块会挡图标）
  try { window.HXNav && window.HXNav.slide($('tabs')); } catch (e) { }
}
function renderWho() { if (inPortal()) $('brand').style.display = 'none'; } // 账号只在首页管理；总入口顶栏已有 logo
function show(v) {
  S.view = v;
  for (const [id] of VIEWS) $('v-' + id).hidden = id !== v;
  for (const b of document.querySelectorAll('[data-v]')) b.setAttribute('aria-current', b.dataset.v === v);
  $('bar').hidden = v !== 'practice';
  paintSubj(); // 每次换栏目都对一次标题：保证左上角的科目名永远和中间内容是同一个
  if (!S.subject) return;
  if (v === 'practice') renderPractice();
  if (v === 'overview') renderOverview();
  if (v === 'rank') renderRank();
  if (v === 'bank') renderBank();
  if (v === 'settings') renderSettings();
}
function counts(list = S.questions) {
  let known = 0, wrong = 0, done = 0;
  for (const q of list) { const r = rec(q.id); if (r.status === 'known') known++; if (r.wrong > 0 && r.status !== 'known') wrong++; if (r.attempts) done++; }
  return { total: list.length, known, wrong, done };
}
function renderHero() {
  const c = counts(), pct = c.total ? Math.round(c.known / c.total * 100) : 0;
  $('hero').innerHTML = `<h1>${esc(S.subject.name)}</h1><div class="meter"><i style="width:${pct}%"></i></div>
    <div class="stats"><span><b>${pct}%</b>已掌握</span><span><b>${c.done}</b>/ ${c.total} 已做</span><span><b>${c.wrong}</b>错题</span></div>`;
}
function renderScopes() {
  const ofType = S.questions.filter(q => q.type === S.type);
  $('scopes').innerHTML = SCOPES.map(([s, n]) => `<button type="button" class="chip" data-s="${s}" aria-pressed="${S.scope === s}">${n}<small>${ofType.filter(q => inScope(rec(q.id), s)).length}</small></button>`).join('');
  for (const b of $('scopes').children) b.onclick = () => { S.scope = b.dataset.s; savePrefs(); buildQueue(true); renderPractice(); };
}
function renderPractice() {
  renderHero();
  $('types').innerHTML = TYPES.map(([t, n]) => { const k = S.questions.filter(q => q.type === t).length; return k ? `<button type="button" data-t="${t}" aria-pressed="${S.type === t}">${n}<small>${k}</small></button>` : ''; }).join('');
  const nt = $('types').children.length || 1; $('types').style.gridTemplateColumns = `repeat(${nt > 4 ? Math.ceil(nt / 2) : nt}, 1fr)`; // 题型多（单片机 6 种）分两行
  for (const b of $('types').children) b.onclick = () => { S.type = b.dataset.t; savePrefs(); buildQueue(true); renderPractice(); };
  renderScopes();
  const o = ORDERS.find(x => x[0] === S.mode) || ORDERS[0];
  $('modeBtn').textContent = (S.mode === 'rand' ? '⚄ ' : /R$/.test(S.mode) ? '↑ ' : '↓ ') + o[1];
  $('modeBtn').onclick = openOrderSheet;
  renderCard(); renderBar();
}
function renderCard() {
  const card = $('card'), q = cur();
  card.classList.remove('drag', 'dragging', 'back', 'fly'); card.style.transform = card.style.opacity = '';
  if (q && q.id !== S.lastId) { card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter'); }
  S.lastId = q && q.id; delete card.dataset.hxq;
  if (!S.questions.length) { card.innerHTML = '<div class="empty"><h2>这个科目还没有题</h2><p class="muted">到“题库”里导入资料，或让 AI 根据资料出题。</p><button class="btn" type="button" id="toBank">去导入</button></div>'; $('toBank').onclick = () => show('bank'); return; }
  if (!S.queue.length) { card.innerHTML = `<div class="empty"><h2>${S.scope === 'wrong' ? '没有错题' : '这里没有题'}</h2><p class="muted">换个题型或范围试试。</p></div>`; return; }
  if (!q) { // 一轮做完
    const ids = S.queue, done = ids.filter(id => S.picked[id]), right = done.filter(id => isRight(S.questions.find(x => x.id === id) || { answer: [] }, S.picked[id]));
    card.innerHTML = `<div class="empty"><h2>本轮完成</h2><p class="muted">共 ${ids.length} 题，作答 ${done.length} 题，答对 ${right.length} 题${done.length ? `，正确率 ${Math.round(right.length / done.length * 100)}%` : ''}。</p>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" type="button" id="again">再来一轮</button>${S.scope !== 'wrong' && counts().wrong ? '<button class="btn ghost" type="button" id="toWrong">刷错题</button>' : ''}<button class="btn danger" type="button" id="wipe">清空重刷</button></div></div>`;
    $('wipe').onclick = e => sure(e.currentTarget, '确认清空？', resetAll);
    $('again').onclick = () => { store.setLocal(sessKey(), null); buildQueue(false); renderPractice(); };
    if ($('toWrong')) $('toWrong').onclick = () => { S.scope = 'wrong'; savePrefs(); buildQueue(false); renderPractice(); };
    return;
  }
  const picked = S.picked[q.id], r = rec(q.id), ai = S.ai[q.id];
  // 按打乱后的顺序显示，字母标签按“显示位置”重新编（第 1 个就是 A）：这样答案落在哪个字母上不再固定，
  // 但判分和记录仍用 o.key（题库里的原字母），所以已答记录、排行榜、AI 解析都照旧对得上。
  const view = showOpts(q), letter = i => 'ABCDEF'[i] || String(i + 1);
  const opts = view.map((o, i) => {
    let cls = '';
    if (picked) { const inAns = q.answer.includes(o.key), chose = picked.includes(o.key); cls = inAns && chose ? 'right' : chose ? 'wrong' : inAns ? (q.type === 'multiple' ? 'right miss' : 'right') : ''; }
    else if (S.sel.has(o.key)) cls = 'sel';
    const why = ai && ai.data && ai.data[o.key] ? `<small class="why">${esc(ai.data[o.key])}</small>` : '';
    return `<button type="button" class="opt ${cls}" data-k="${esc(o.key)}" ${picked ? 'disabled' : ''}><i>${q.type === 'judgment' ? (o.key === 'T' ? '✓' : '✗') : letter(i)}</i><span>${o.fig ? `<span style="display:block">${figSvg(o.fig)}</span>` : ''}${esc(o.text)}${why}</span></button>`;
  }).join('');
  const self = SELF.has(q.type), typed = S.typed[q.id] || [];
  let stem = esc(q.stem);
  if (q.type === 'fill') { let n = 0; stem = stem.replace(/____/g, () => { const k = n++, v = typed[k] || ''; return `<input class="blank${picked && typed.length ? (blankOk(q.answer[k], v) ? ' right' : ' wrong') : ''}" data-n="${k}" value="${esc(v)}" ${picked ? 'disabled' : ''} autocomplete="off" aria-label="第 ${k + 1} 空" style="width:${Math.min(12, Math.max(4, String(q.answer[k]).replace(/[（(].*$/, '').length + 2))}em">`; }); }
  const extra = (q.fig ? `<figure style="margin:4px 0 12px;display:flex;justify-content:center;padding:10px;border-radius:12px;background:rgba(127,127,127,.08)">${figSvg(q.fig, true)}</figure>` : '') + (q.code ? `<pre class="code">${esc(q.code)}</pre>` : '') + (q.sub ? `<ol class="subs">${q.sub.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '');
  const ref = () => `<div class="ref">${esc(q.answer[0])}</div>`;
  let fb = '';
  if (self && !picked) fb = S.shown[q.id] ? `<div class="fb self"><b>参考答案</b>${ref()}<div class="row"><button class="btn ghost" type="button" id="noBtn">没答对</button><button class="btn okb" type="button" id="okBtn">答对了</button></div></div>`
    : '<button class="btn submit" type="button" id="showBtn">看参考答案</button>';
  if (picked && (self || q.type === 'fill')) {
    const ok = isRight(q, picked), ans = q.answer.map((a, n) => (q.answer.length > 1 ? `第 ${n + 1} 空 ` : '') + a).join('；');
    fb = `<div class="fb ${ok ? 'ok' : 'bad'}"><b>${self ? (ok ? '答对了' : '没答对') : ok ? '回答正确' : '答案是 ' + esc(ans)}</b>${self ? ref() : ''}${q.type === 'fill' && !ok && typed.length ? '<div class="ai"><button class="btn sm ghost" type="button" id="ovBtn">意思对，算我对</button></div>' : ''}</div>`;
  } else if (picked) {
    const ok = isRight(q, picked), ans = q.type === 'judgment' ? (q.answer[0] === 'T' ? '正确' : '错误') : q.answer.join('');
    // 只要网页里配了自己的 Key 就给「✦ AI 逐项解析」。以前装了扩展就把这个按钮藏掉（怕和扩展的「学会这题」重复），
    // 结果是用户明明填了 Key 却找不到按钮 —— 扩展归扩展，网页归网页，两个都给，用户自己挑。
    const aiPart = !ai ? (getSettings().apiKey ? '<button class="btn sm ghost" type="button" id="aiBtn">✦ AI 逐项解析</button>' : '')
      : ai.state === 'load' ? '<span>AI 正在解析…</span>'
      : ai.state === 'err' ? `<span style="color:var(--bad)">${esc(ai.msg)}</span><button class="btn sm ghost" type="button" id="aiBtn">重试</button>`
      : (ai.data._tip ? `<div class="tip">速记：${esc(ai.data._tip)}</div>` : '') + (ai.data._review && !/^一致/.test(ai.data._review) ? `<div class="tip">题库复核：${esc(ai.data._review)}</div>` : '');
    fb = `<div class="fb ${ok ? 'ok' : 'bad'}"><b>${ok ? '回答正确' : '答案是 ' + esc(ans)}</b>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}<div class="ai">${aiPart}</div></div>`;
  }
  const tag = (r.wrong ? `<span style="color:var(--bad)">错过 ${r.wrong} 次</span>` : r.status === 'known' ? '<span style="color:var(--ok)">已记住</span>' : '')
    + (r.status === 'known' && q.id in S.undo ? '<button class="btn sm ghost" type="button" id="undoBtn" style="height:26px">撤销记住</button>' : '');
  const hint = picked ? `<div class="hint">左滑或 <kbd>${esc(keyOf('know'))}</kbd> 记住 · 右滑或 <kbd>${esc(keyOf('again'))}</kbd> 再练</div>` : '';
  card.innerHTML = `<div class="qhead"><span class="qtype">${typeName(q.type)}</span><span>${S.i + 1} / ${S.queue.length}</span><span class="sp"></span>${tag}</div>
    <h2 class="stem">${stem}</h2>${extra}${opts ? `<div class="opts">${opts}</div>` : ''}
    ${q.type === 'multiple' && !picked ? `<button class="btn submit" type="button" id="submitBtn" ${S.sel.size ? '' : 'disabled'}>提交答案${S.sel.size ? `（已选 ${[...S.sel].sort().join('')}）` : ''}</button>` : ''}${q.type === 'fill' && !picked ? '<button class="btn submit" type="button" id="submitBtn">提交答案</button>' : ''}${fb}${hint}
    <div class="veil" aria-hidden="true"><i></i></div>`;
  card.classList.toggle('drag', !!picked);
  // 给“夜夜题库AI伴侣”浏览器扩展（智慧职教AI伴学项目）读题：题型、题干、选项；答完才带答案
  card.dataset.hxq = JSON.stringify({ type: typeName(q.type), stem: q.stem + figText(q) + (q.code ? '\n' + q.code : ''), options: (q.options || []).map(o => ({ label: o.key, text: optText(o) })), answer: picked ? (q.type === 'judgment' ? (q.answer[0] === 'T' ? '正确' : '错误') : q.answer.join(q.type === 'fill' ? '；' : '')) : '' });
  for (const b of card.querySelectorAll('.opt')) b.onclick = e => { if (!e.detail || Date.now() - tapAt > 800) pick(b.dataset.k); }; // 鼠标、手指在 pointerup 已选过（见下面手势），这里管键盘
  const blanks = [...card.querySelectorAll('.blank:not([disabled])')];
  blanks.forEach((b, n) => b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); n < blanks.length - 1 ? blanks[n + 1].focus() : submit(); } });
  if ($('submitBtn')) $('submitBtn').onclick = submit;
  if ($('showBtn')) $('showBtn').onclick = () => { S.shown[q.id] = true; renderCard(); };
  if ($('okBtn')) $('okBtn').onclick = () => selfGrade(true);
  if ($('noBtn')) $('noBtn').onclick = () => selfGrade(false);
  if ($('ovBtn')) $('ovBtn').onclick = override;
  if ($('aiBtn')) $('aiBtn').onclick = () => explain(q);
  if ($('undoBtn')) $('undoBtn').onclick = () => unmark(q.id);
}
function renderBar() {
  const q = cur(), picked = q && S.picked[q.id];
  const mid = q && picked
    ? '<button class="btn ghost" type="button" id="againBtn">再练</button><button class="btn okb" type="button" id="knowBtn">记住了 ✓</button>'
    : `<button class="btn ghost" type="button" id="sheetBtn">答题卡${q && S.queue.length ? ' ' + (S.i + 1) + '/' + S.queue.length : ''}</button>`;
  $('bar').innerHTML = `<button class="nav" type="button" id="prevBtn" aria-label="上一题" ${S.i > 0 ? '' : 'disabled'}>‹</button><div class="mid">${mid}</div><button class="nav" type="button" id="nextBtn" aria-label="下一题" ${q ? '' : 'disabled'}>›</button>`;
  $('prevBtn').onclick = () => go(S.i - 1);
  $('nextBtn').onclick = () => go(S.i + 1);
  if ($('sheetBtn')) $('sheetBtn').onclick = openCardSheet;
  if ($('againBtn')) $('againBtn').onclick = () => fly(1);
  if ($('knowBtn')) $('knowBtn').onclick = () => fly(-1);
}
async function explain(q) {
  S.ai[q.id] = { state: 'load' }; renderCard();
  try { S.ai[q.id] = { state: 'done', data: await explainQuestion(q, S.picked[q.id] || [], null, S.subject.name) }; }
  catch (e) { S.ai[q.id] = { state: 'err', msg: e.message }; }
  if (cur() === q) renderCard();
}

// ---------- 底部抽屉：答题卡、科目 ----------
function openSheet(html, bind, cls) {
  $('sheetBody').innerHTML = html; bind && bind();
  $('sheet').classList.remove('ask', 'big'); // cls：'ask'（问 AI，聊天区自适应）/ 'big'（放大）
  String(cls || '').split(' ').forEach(c => c && $('sheet').classList.add(c));
  $('sheet').classList.add('show'); $('sheetBg').classList.add('show');
}
function closeSheet() { $('sheet').classList.remove('show'); $('sheetBg').classList.remove('show'); }
// 点周边关掉可以理解，但打了一半的字不能跟着没：关之前先把草稿留住，再打开原样带回来
$('sheetBg').onclick = () => {
  const inp = $('askIn'), draft = $('sheet').classList.contains('ask') && inp ? inp.value : '';
  closeSheet();
  if (draft && draft.trim()) toast('草稿留着了，再点“问 AI”继续');
};
function openCardSheet() {
  const cells = S.queue.map((id, n) => {
    const p = S.picked[id], q = S.questions.find(x => x.id === id), r = rec(id);
    const cls = p ? (isRight(q, p) ? 'right' : 'wrong') : r.status === 'known' ? 'known' : r.attempts ? 'done' : '';
    return `<button type="button" class="cell ${cls} ${n === S.i ? 'cur' : ''}" data-n="${n}">${n + 1}</button>`;
  }).join('');
  openSheet(`<h3>答题卡 <small class="muted">${typeName(S.type)} · ${SCOPES.find(s => s[0] === S.scope)[1]} · ${S.queue.length} 题</small></h3>
    <div class="legend"><span><i style="background:var(--ok)"></i>本轮答对</span><span><i style="background:var(--bad)"></i>本轮答错</span><span><i style="background:var(--acc3)"></i>以前做过</span><span><i style="background:linear-gradient(135deg,#22c55e,#38bdf8)"></i>已记住</span></div>
    <div class="grid">${cells}</div>`, () => {
    for (const c of $('sheetBody').querySelectorAll('.cell')) c.onclick = () => { closeSheet(); go(+c.dataset.n); };
    $('sheetBody').querySelector('.cur')?.scrollIntoView({ block: 'center' });
  });
}
function openOrderSheet() {
  openSheet(`<h3>出题顺序</h3><div class="slist">${ORDERS.map(([m, n, d]) => `<button type="button" class="sitem" data-m="${m}" aria-current="${S.mode === m}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>`, () => {
    for (const b of $('sheetBody').querySelectorAll('[data-m]')) b.onclick = () => { closeSheet(); S.mode = b.dataset.m; savePrefs(); buildQueue(false); renderPractice(); toast(ORDERS.find(x => x[0] === S.mode)[1]); };
  });
}
function openSubjectSheet() {
  const item = s => `<button type="button" class="sitem" data-id="${esc(s.id)}" aria-current="${S.subject && S.subject.id === s.id}"><b>${esc(s.name)}</b>${s.tag ? `<span class="tg">${esc(s.tag)}</span>` : ''}${s.total ? `<small>${s.total} 题</small>` : ''}</button>`;
  const g = k => S.subjects.filter(s => s.kind === k);
  openSheet(`<h3>选择科目</h3>
    <div class="sgroup">课程题库</div><div class="slist">${[...g('builtin'), ...g('public')].map(item).join('')}</div>
    <div class="sgroup">我的科目</div><div class="slist">${g('mine').map(item).join('')}
    <button type="button" class="sitem" id="newSubj" style="justify-content:center;color:var(--acc3)"><b style="flex:none">＋ 新建科目</b></button></div>`, () => {
    // 换科目留在当前栏目（在概览就看新科目的概览，在排行就看新科目的排行），不要硬踢回刷题
    for (const b of $('sheetBody').querySelectorAll('.sitem[data-id]')) b.onclick = async () => { closeSheet(); await openSubject(b.dataset.id); };
    $('newSubj').onclick = () => { closeSheet(); show('bank'); setTimeout(() => $('newName')?.focus(), 50); };
  });
}
$('subjBtn').onclick = openSubjectSheet;

// ---------- 概览 ----------
function renderOverview() {
  const c = counts(), wrong = S.questions.filter(q => inScope(rec(q.id), 'wrong')).sort((a, b) => rec(b.id).wrong - rec(a.id).wrong);
  let att = 0, bad = 0; for (const r of Object.values(S.records)) { att += r.attempts || 0; bad += r.wrong || 0; }
  const bars = TYPES.map(([t, n]) => { const l = S.questions.filter(q => q.type === t); if (!l.length) return ''; const k = counts(l); return `<div><span>${n}</span><div class="meter"><i style="width:${k.known / k.total * 100}%"></i></div><small class="muted">${k.known} / ${k.total}</small></div>`; }).join('');
  $('v-overview').innerHTML = `<div class="hero glow"><h1>${esc(S.subject.name)}</h1><div class="meter"><i style="width:${c.total ? c.known / c.total * 100 : 0}%"></i></div>
      <div class="stats"><span><b>${c.known}</b>已记住</span><span><b>${c.done}</b>/ ${c.total} 已做</span><span><b>${att ? Math.round((att - bad) / att * 100) : 0}%</b>正确率</span><span><b>${att}</b>次作答</span></div></div>
    <div class="panel"><h3>各题型掌握</h3><div class="bars">${bars}</div></div>
    <div class="panel"><h3>错题${wrong.length ? ` <small class="muted">${wrong.length}</small>` : ''}</h3>${wrong.length ? `<div class="wl">${wrong.slice(0, 50).map(q => `<button type="button" data-id="${esc(q.id)}"><small>错 ${rec(q.id).wrong}</small>${esc(q.stem)}</button>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn sm" type="button" id="drill">刷错题</button></div>` : '<p class="muted">还没有错题。</p>'}</div>
    <div class="panel" id="hist">${histHtml()}</div>
    <p class="muted" style="text-align:center">${hx.signedIn() ? (store.cloud.ok === false ? '进度同步失败：' + esc(store.cloud.error) + '（已存在本机）' : '进度跟账号同步，换手机、换电脑都能接着刷') : '没登录：进度只存在这台设备'}</p>`;
  for (const b of $('v-overview').querySelectorAll('.wl button')) b.onclick = () => { const q = S.questions.find(x => x.id === b.dataset.id); S.type = q.type; S.scope = 'wrong'; savePrefs(); buildQueue(false); const n = S.queue.indexOf(q.id); show('practice'); if (n >= 0) go(n); };
  if ($('drill')) $('drill').onclick = () => { S.scope = 'wrong'; if (!wrong.some(q => q.type === S.type)) S.type = wrong[0].type; savePrefs(); buildQueue(false); show('practice'); };
  bindHist();
}
// 刷题记录：做过的题（最近的在前），勾选后“放回重刷”= 清掉这几题的记录，回到“未做”“待掌握”里
const HF = [['all', '全部'], ['known', '已记住'], ['wrong', '错过'], ['right', '没错过']];
function histList() {
  const f = S.hf, ok = r => f === 'all' || (f === 'known' ? r.status === 'known' : f === 'wrong' ? r.wrong > 0 : !r.wrong);
  return S.questions.filter(q => { const r = rec(q.id); return (r.attempts || r.status === 'known') && ok(r); }).sort((a, b) => (rec(b.id).at || 0) - (rec(a.id).at || 0));
}
function histHtml() {
  const list = histList(), shown = list.slice(0, 300), n = S.hsel.size, all = shown.length && shown.every(q => S.hsel.has(q.id));
  return `<h3>刷题记录 <small class="muted">${list.length}</small></h3>
    <div class="chips" style="margin-bottom:10px">${HF.map(([k, t]) => `<button type="button" class="chip" data-hf="${k}" aria-pressed="${S.hf === k}">${t}</button>`).join('')}</div>
    ${shown.length ? `<div class="hl">${shown.map(q => { const r = rec(q.id); return `<label><input type="checkbox" data-h="${esc(q.id)}" ${S.hsel.has(q.id) ? 'checked' : ''}><span>${esc(q.stem)}</span><small>${typeName(q.type)}${r.status === 'known' ? ' · 已记住' : ''}${r.wrong ? ' · 错 ' + r.wrong : ''}</small></label>`; }).join('')}</div>` : '<p class="muted">这里还没有题。</p>'}
    <div class="row" style="margin-top:12px;flex-wrap:wrap">${shown.length ? `<button class="btn sm ghost" type="button" id="hAll">${all ? '全不选' : '全选'}</button><button class="btn sm" type="button" id="hBack" ${n ? '' : 'disabled'}>放回重刷${n ? '（' + n + '）' : ''}</button>` : ''}<span class="sp" style="flex:1"></span><button class="btn sm danger" type="button" id="hWipe">清空全部重刷</button></div>`;
}
function bindHist() {
  const box = $('hist'); if (!box) return;
  const redraw = () => { box.innerHTML = histHtml(); bindHist(); };
  for (const b of box.querySelectorAll('[data-hf]')) b.onclick = () => { S.hf = b.dataset.hf; redraw(); };
  for (const c of box.querySelectorAll('[data-h]')) c.onchange = () => { c.checked ? S.hsel.add(c.dataset.h) : S.hsel.delete(c.dataset.h); redraw(); };
  if ($('hAll')) $('hAll').onclick = () => { const shown = histList().slice(0, 300), all = shown.every(q => S.hsel.has(q.id)); for (const q of shown) all ? S.hsel.delete(q.id) : S.hsel.add(q.id); redraw(); };
  if ($('hBack')) $('hBack').onclick = () => {
    const ids = [...S.hsel]; for (const id of ids) delete S.records[id];
    S.hsel.clear(); saveRecords(); clearSess(); buildQueue(false); renderOverview(); toast(`已放回 ${ids.length} 题，在“未做”里能刷到`);
  };
  $('hWipe').onclick = e => sure(e.currentTarget, '确认清空全部记录？', resetAll);
}

// ---------- 理论题排行：每个课程科目一个榜，分数 = 答对过的不同选择、判断题数（服务器判对、去重，见 supabase/quiz-schema.sql 第 3 节） ----------
const RANKED = new Set(['single', 'multiple', 'judgment']);
const rankable = sub => !!sub && (sub.kind === 'builtin' || sub.kind === 'public');
const isStudent = () => !!(S.me && S.me.student);
const rankDone = bank => { if (S.view === 'rank' && S.subject && S.subject.id === bank) renderRank(); };
function rankAdd(q, sel) { // 只交课程题库里的原题（自己导入到这个科目的题不算）
  if (!isStudent() || !rankable(S.subject) || !RANKED.has(q.type) || !(S.base[S.subject.id] || []).some(x => x.id === q.id)) return;
  store.rankPush(S.subject.id, q.id, sel, rankDone);
}
async function renderRank() {
  const sub = S.subject, el = $('v-rank'), n = (S.base[sub.id] || []).filter(q => RANKED.has(q.type)).length;
  const head = body => `<div class="hero glow"><h1>${esc(sub.name)}</h1>${body}</div>`, note = t => `<p class="muted" style="margin:10px 0 0">${t}</p>`;
  if (!rankable(sub)) { delete el.dataset.for; el.innerHTML = head(note('自建科目不排位，换到课程题库看排行。')); return; }
  const who = isStudent() || isTeacher(), mineOnly = who && S.rmine;
  const seg = who ? `<div class="seg" id="rseg" style="grid-template-columns:1fr 1fr"><button type="button" data-m="0" aria-pressed="${!mineOnly}">全校</button><button type="button" data-m="1" aria-pressed="${mineOnly}">${isStudent() ? '本班' : '我的班'}</button></div>` : '';
  const bind = () => { for (const b of el.querySelectorAll('#rseg button')) b.onclick = () => { S.rmine = b.dataset.m === '1'; renderRank(); }; };
  if (el.dataset.for !== sub.id) { el.dataset.for = sub.id; el.innerHTML = head(note('正在加载排行…')) + seg; bind(); }
  let rows;
  try { rows = await store.rankBoard(sub.id, mineOnly); }
  catch (e) { if (S.subject === sub && S.view === 'rank') { el.innerHTML = head(note('排行榜暂时打不开：' + esc(e.message))) + seg; bind(); } return; }
  if (S.subject !== sub || S.view !== 'rank') return; // 加载期间换了科目或页面
  const me = rows.find(r => r.me), total = rows.length ? rows[0].total : 0;
  const mine = isStudent()
    ? (me ? `<div class="meter"><i style="width:${n ? me.score / n * 100 : 0}%"></i></div><div class="stats"><span><b>${me.score}</b>/ ${n} 题答对</span><span>第 <b>${me.place}</b>名</span><span><b>${total}</b>人上榜</span></div>`
          : note('答对一道单选、多选或判断就上榜'))
    : note(hx.signedIn() ? (isTeacher() ? '教师不上榜' : '开通学生账号后上榜') : '登录学生账号后，答对的题计入排行');
  let prev = 0;
  const list = rows.map(r => {
    const gap = prev && r.place > prev + 1 ? '<li class="gap">⋯</li>' : ''; prev = r.place;
    return `${gap}<li class="${r.me ? 'me ' : ''}p${Math.min(r.place, 4)}"><i>${r.place}</i><div><b>${esc(r.name)}</b><span>${esc(r.class_name)}</span></div><em>${r.score}<small>题</small></em></li>`;
  }).join('');
  el.innerHTML = head(mine) + seg + `<div class="panel">${rows.length ? `<ol class="rb">${list}</ol>` : '<p class="muted">还没有人上榜。</p>'}<p class="muted rrule">单选、多选、判断答对过的题，每题只算一次</p></div>`;
  bind();
}

// ---------- 题库：新建科目、导入资料、AI 出题、导出、发布 ----------
function renderBank() {
  const sub = S.subject, base = S.base[sub.id] || [], d = S.draft;
  // 发布时间是「更新发布」，撤销下发单独一个字按钮：撤销只把学生那边的可见性收回来，题库留着，老师自己还能刷
  const pubBtns = isTeacher() ? `<button class="btn sm" type="button" id="pubBtn">${sub.published || sub.kind === 'public' ? '更新发布' : '发布给学生'}</button>${sub.published ? '<button class="btn sm danger" type="button" id="unpubBtn">取消发布</button>' : ''}` : '';
  $('v-bank').innerHTML = `
    <div class="panel"><h3>${esc(sub.name)}</h3>
      <dl class="kv"><dt>来源</dt><dd>${sub.kind === 'builtin' ? '课程题库' : sub.kind === 'public' ? esc(sub.tag) : '我的科目'}</dd>${base.length ? `<dt>课程题</dt><dd>${base.length} 题</dd>` : ''}<dt>我导入的</dt><dd>${S.bank.length} 题</dd>${isTeacher() && (sub.published || sub.kind === 'public') && sub.targets ? `<dt>下发范围</dt><dd>${esc(sub.targets)}</dd>` : ''}</dl>
      <div class="f" style="margin-top:12px"><div class="line"><button class="btn sm ghost" type="button" id="expBtn">导出 JSON</button>${S.bank.length ? '<button class="btn sm ghost" type="button" id="clrBtn">清空我导入的</button>' : ''}${sub.kind === 'mine' ? '<button class="btn sm ghost" type="button" id="renBtn">改名</button><button class="btn sm danger" type="button" id="delBtn">删除科目</button>' : ''}${pubBtns}</div></div></div>
    <div class="panel"><h3>新建科目</h3><div class="f"><div class="line"><input id="newName" maxlength="30" placeholder="科目名称" style="flex:1"><button class="btn sm" type="button" id="newBtn">新建</button></div></div></div>
    <div class="panel"><h3>导入资料 · ${esc(sub.name)}</h3>
      <div class="f">
        <div class="radio"><label><input type="radio" name="im" value="pick" ${S.imode === 'pick' ? 'checked' : ''}>资料里有现成的题</label><label><input type="radio" name="im" value="gen" ${S.imode === 'gen' ? 'checked' : ''}>根据资料出题（AI）</label></div>
        <input id="mFile" type="file" accept=".pdf,.docx,.txt,.md,.json">
        <textarea id="mText" rows="6" placeholder="或者把资料文字粘贴在这里"></textarea>
        <div class="line" id="genRow" ${S.imode === 'gen' ? '' : 'hidden'}><label for="perChunk">每段出题</label><select id="perChunk" style="width:auto">${[10, 15, 20, 30].map(n => `<option ${n === 15 ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="muted">资料按约 6000 字一段</span></div>
        <div class="line"><button class="btn" type="button" id="goImport">预览</button><span class="muted" id="imMsg">${getSettings().apiKey ? '' : 'JSON 题库直接导入；文字资料要先在“设置”里填 AI Key'}</span></div>
      </div>
      ${d ? `<div style="margin-top:14px"><div class="row"><b style="flex:1">预览 ${d.length} 题</b><button class="btn sm" type="button" id="okImport" ${d.length ? '' : 'disabled'}>确认导入</button><button class="btn sm ghost" type="button" id="noImport">放弃</button></div>
        <div class="pv" style="margin-top:10px">${d.map((q, n) => `<div><p><small>${typeName(q.type)}</small> ${esc(q.stem)}<br><small>${(q.options || []).map(o => esc(o.key + '. ' + optText(o))).join('　')} ｜ 答案 ${esc(q.answer.join(q.type === 'fill' ? '；' : ''))}</small></p><button type="button" data-del="${n}" aria-label="删除">✕</button></div>`).join('')}</div></div>` : ''}
    </div>`;
  const on = (id, fn) => { if ($(id)) $(id).onclick = fn; };
  on('expBtn', () => { const blob = new Blob([JSON.stringify(S.questions, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = sub.name + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
  on('clrBtn', e => sure(e.currentTarget, `确认清空 ${S.bank.length} 题？`, () => setBank([])));
  on('renBtn', async () => { const n = prompt('科目新名字', sub.name)?.trim(); if (!n) return; await saveMine(m => m.map(s => s.id === sub.id ? { ...s, name: n.slice(0, 30) } : s)); S.view = 'bank'; await openSubject(sub.id); });
  on('delBtn', e => sure(e.currentTarget, '确认删除科目？', async () => {
    await saveMine(m => m.filter(s => s.id !== sub.id)); await store.remove('bank:' + sub.id); await store.remove('progress:' + sub.id);
    S.view = 'practice'; await openSubject(BUILTIN[0].id); toast('已删除');
  }));
  on('newBtn', async () => {
    const n = $('newName').value.trim(); if (!n) return $('newName').focus();
    const id = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await saveMine(m => [...m, { id, name: n.slice(0, 30) }]); S.view = 'bank'; await openSubject(id); toast('已新建，接着导入资料');
  });
  for (const r of document.querySelectorAll('input[name=im]')) r.onchange = () => { S.imode = r.value; $('genRow').hidden = r.value !== 'gen'; };
  on('goImport', startImport);
  on('okImport', confirmImport);
  on('noImport', () => { S.draft = null; renderBank(); });
  for (const x of document.querySelectorAll('[data-del]')) x.onclick = () => { S.draft.splice(+x.dataset.del, 1); renderBank(); };
  on('pubBtn', () => openPublishSheet(() => { renderBank(); loadSubjects().then(paintSubj); }));
  on('unpubBtn', e => sure(e.currentTarget, '确认取消发布？', async () => {
    try { await store.unpublish(sub.id); await saveMine(m => m.map(s => s.id === sub.id ? { ...s, published: false } : s)); S.subject.published = false; toast('已取消发布'); renderBank(); } catch (e) { toast(e.message); }
  }));
}
async function saveMine(fn) {
  const mine = fn(S.subjects.filter(s => s.kind === 'mine').map(({ kind, ...s }) => s));
  await store.write('subjects', mine, { now: true });
  await loadSubjects();
}
async function setBank(list) {
  S.bank = list; await store.write('bank:' + S.subject.id, list, { now: true });
  if (store.cloud.ok === false) toast('题已存在本机，云端同步失败：' + store.cloud.error);
  S.view = 'bank'; await openSubject(S.subject.id);
}
async function startImport() {
  const msg = $('imMsg'), file = $('mFile').files[0], pasted = $('mText').value.trim(), sub = S.subject;
  $('goImport').disabled = true; msg.textContent = '正在读取资料…';
  try {
    let m = file ? await readMaterial(file) : { text: pasted };
    if (!file && /^[[{]/.test(pasted)) try { m = { json: JSON.parse(pasted) }; } catch { /* 不是 JSON，当文字资料 */ }
    let qs;
    if (m.json) { const r = normalizeQuestions(m.json, sub.id); qs = r.questions; if (r.rejected.length) toast(`有 ${r.rejected.length} 题格式不对，已跳过`); }
    else if (S.imode === 'gen') qs = await aiGenerate(m.text || '', sub.id, sub.name, +$('perChunk').value, t => (msg.textContent = t));
    else qs = await aiImport(m.text || '', sub.id, t => (msg.textContent = t));
    const have = new Set(S.questions.map(q => norm(q.stem)));
    const fresh = qs.filter(q => { const k = norm(q.stem); if (have.has(k)) return false; have.add(k); return true; });
    S.draft = fresh; renderBank();
    toast(`识别到 ${qs.length} 题${qs.length - fresh.length ? `，${qs.length - fresh.length} 题和已有的重复，已去掉` : ''}`);
  } catch (e) {
    if (e.partialQuestions?.length) { S.draft = e.partialQuestions; renderBank(); }
    if ($('imMsg')) $('imMsg').textContent = e.message; else toast(e.message);
  } finally { if ($('goImport')) $('goImport').disabled = false; }
}
async function confirmImport() {
  const add = S.draft.map((q, n) => ({ ...q, number: S.bank.length + n + 1 }));
  S.draft = null; await setBank([...S.bank, ...add]); toast(`已导入 ${add.length} 题`);
}

// ---------- 发布：选下发到哪些班（2026-11-02）----------
// 用户要求：「教师账号导入的资料允许专业班级下发和撤销，也可以只自己刷」
// 三种状态，对应数据库里 target_classes 的三态：
//   全部学生  → null     （老行为，默认）
//   只自己刷  → []       （不发出去，题还在自己科目里）
//   指定班级  → [id...]
function openPublishSheet(onDone) {
  const sub = S.subject, pid = sub.kind === 'public' ? sub.pid : sub.id;
  const cur = sub.kind === 'public' ? sub.class_ids : undefined; // 已发布过的题库带回来
  const isNew = !sub.published && sub.kind !== 'public';

  openSheet(`<h3>发布 <small class="muted">${S.questions.length} 题</small></h3>
    <p class="muted" style="margin:0 0 12px">发给谁刷？学生的“科目”列表里只会出现发给他的题库。</p>
    <div class="radio" style="flex-direction:column;gap:8px">
      <label><input type="radio" name="tg" value="all" ${isNew || cur == null ? 'checked' : ''}> 全部学生（所有班都能刷）</label>
      <label><input type="radio" name="tg" value="self" ${!isNew && cur && cur.length === 0 ? 'checked' : ''}> 只自己刷（不发给学生，题留在我的科目里）</label>
      <label><input type="radio" name="tg" value="cls" ${!isNew && cur && cur.length ? 'checked' : ''}> 只发给指定班级</label>
    </div>
    <div id="clsPick" style="margin-top:12px" hidden>
      <div class="sgroup">我教的班</div>
      <div id="clsList" class="slist"><div class="muted" style="padding:10px">正在读取班级…</div></div>
    </div>
    <div class="line" style="margin-top:14px"><button class="btn" type="button" id="pubGo">确认发布</button><button class="btn sm ghost" type="button" id="pubNo">取消</button></div>`,
  async () => {
    const rad = () => ($('sheetBody').querySelector('input[name=tg]:checked') || {}).value;
    const sync = () => { $('clsPick').hidden = rad() !== 'cls'; };
    for (const r of $('sheetBody').querySelectorAll('input[name=tg]')) r.onchange = sync;
    sync();

    // 班级列表懒加载：只有选了“指定班级”才去查，不选就不打扰数据库
    let classes = null;
    const loadCls = async () => {
      if (classes) return;
      const r = await store.myClasses();
      classes = (r || []).filter(c => c && c.name);
      const box = $('clsList');
      if (!box) return;
      if (!classes.length) { box.innerHTML = '<div class="muted" style="padding:10px">你还没有班级。到首页「班级」新建一个、导入名单后再来发布。</div>'; return; }
      const sel = new Set(cur || []);
      box.innerHTML = classes.map(c =>
        `<label class="sitem" style="justify-content:flex-start;gap:10px;cursor:pointer">
           <input type="checkbox" data-cid="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>
           <b style="flex:1">${esc(c.name)}</b>
           <small>${c.bound || 0}/${c.total || 0} 人</small>
         </label>`).join('');
    };
    // 一开始就选中“指定班级”的，立刻加载
    if (rad() === 'cls') loadCls();
    for (const r of $('sheetBody').querySelectorAll('input[name=tg]')) {
      const prev = r.onchange;
      r.onchange = () => { prev(); if (rad() === 'cls') loadCls(); };
    }

    $('pubNo').onclick = closeSheet;
    $('pubGo').onclick = async () => {
      const mode = rad();
      let classes2;
      if (mode === 'all') classes2 = null;
      else if (mode === 'self') classes2 = [];
      else {
        const picked = [...$('sheetBody').querySelectorAll('input[data-cid]:checked')].map(x => +x.dataset.cid);
        if (!picked.length) { toast('至少选一个班；不想发给学生就选“只自己刷”'); return; }
        classes2 = picked;
      }
      $('pubGo').disabled = true;
      try {
        await store.publish(pid, sub.name, S.questions, hx.name(S.user, S.me), classes2);
        if (sub.kind === 'mine') { await saveMine(m => m.map(s => s.id === sub.id ? { ...s, published: true } : s)); S.subject.published = true; }
        // 把新的下发范围写回内存，面板再打开时能回填
        S.subject.class_ids = classes2; S.subject.targets = mode === 'all' ? '全部学生' : mode === 'self' ? '只自己刷' : classes2.length + ' 个班';
        closeSheet();
        toast(mode === 'self' ? '已保存（只自己刷，学生看不到）' : mode === 'all' ? '已发布给全部学生' : `已发布给 ${classes2.length} 个班`);
        if (onDone) onDone();
      } catch (e) { toast(e.message); }
      finally { if ($('pubGo')) $('pubGo').disabled = false; }
    };
  });
}

// ---------- 设置 ----------
function renderSettings() {
  const s = getSettings(), p = providers[s.provider], models = [...new Set([...(s.models || []), ...p.models])];
  $('v-settings').innerHTML = `
    <div class="panel"><h3>AI 解析</h3>${hasExt()
      ? '<p class="extok">已装“夜夜题库AI伴侣”：题干下的“✦ 学会这题”用的是扩展里的 Key，这里不填也能讲题。<b>这里填了自己的 Key 之后，题目下还会多出一个网页自己的“✦ AI 逐项解析”</b>，两个都能点，随便用哪个。</p>'
      : '<p class="muted" style="margin-top:0">填自己的 AI Key 后，答题后能逐项解析，也能识别资料、根据资料出题。请求直接从浏览器发给服务商。</p>'}
      <div class="f">
        <label for="prov">服务商</label><select id="prov">${Object.entries(providers).map(([k, v]) => `<option value="${k}" ${k === s.provider ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <label for="base">接口地址</label><input id="base" type="url" value="${esc(s.baseUrl)}" placeholder="https://api.example.com/v1">
        <label for="model">模型</label><div class="line"><select id="model" style="flex:1;min-width:0">${models.map(m => `<option value="${esc(m)}" ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}<option value="" ${models.includes(s.model) ? '' : 'selected'}>手动填写…</option></select><button class="btn sm ghost" type="button" id="lsModels">读取模型</button></div>
        <input id="modelIn" value="${esc(models.includes(s.model) ? '' : s.model)}" placeholder="模型 ID" ${models.includes(s.model) ? 'hidden' : ''}>
        <label for="key">API Key</label><input id="key" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-…">
        <div class="radio"><label><input type="checkbox" id="remember" ${s.remember ? 'checked' : ''}>在这台设备长期保存 Key（公共电脑别勾）</label></div>
        <div class="line"><button class="btn sm" type="button" id="saveAi">保存</button><button class="btn sm ghost" type="button" id="testAi">测试连接</button><span class="muted" id="aiMsg"></span></div>
      </div></div>
    <div class="panel"><h3>快捷键</h3><div class="keys">${KEY_ACTS.map(([a, n]) => `<div><span>${n}</span>${[0, 1].map(k => `<button type="button" data-ka="${a}" data-ki="${k}">${esc(keyName(keyMap()[a][k] || '') || '—')}</button>`).join('')}</div>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center"><button class="btn sm ghost" type="button" id="keyDef">恢复默认</button><span class="muted">点一个键位再按键盘；按退格清空</span></div></div>
    <div class="panel guide" id="guide"><h3>使用说明</h3>${guide()}</div>
    <div class="panel"><h3>本科目</h3><div class="row" style="flex-wrap:wrap"><button class="btn sm ghost" type="button" id="reload">重新加载题库</button><button class="btn sm danger" type="button" id="resetP">重置“${esc(S.subject.name)}”的刷题记录</button></div></div>`;
  for (const b of $('v-settings').querySelectorAll('[data-ka]')) b.onclick = () => {
    for (const x of $('v-settings').querySelectorAll('.rec')) x.classList.remove('rec');
    b.classList.add('rec'); b.textContent = '按一个键…'; S.recKey = { a: b.dataset.ka, i: +b.dataset.ki };
  };
  $('keyDef').onclick = () => { store.setLocal('keys', {}); renderSettings(); toast('快捷键已恢复默认'); };
  $('reload').onclick = async () => { S.base = {}; await loadSubjects(); await openSubject(S.subject.id); toast('题库已重新加载'); };
  const collect = () => ({ provider: $('prov').value, baseUrl: $('base').value.trim(), model: ($('model').value || $('modelIn').value).trim(), models: s.models || [], apiKey: $('key').value.trim(), remember: $('remember').checked });
  $('prov').onchange = () => { const v = providers[$('prov').value]; saveSettings({ ...collect(), baseUrl: v.baseUrl, model: v.models[0] || '', models: [] }); renderSettings(); };
  $('model').onchange = () => { $('modelIn').hidden = !!$('model').value; saveSettings(collect()); if ($('model').value) $('aiMsg').textContent = '已选 ' + $('model').value; else $('modelIn').focus(); };
  $('modelIn').onchange = () => saveSettings(collect());
  $('saveAi').onclick = () => { saveSettings(collect()); $('aiMsg').textContent = '已保存'; };
  $('testAi').onclick = async () => { saveSettings(collect()); $('aiMsg').textContent = '正在测试…'; try { await chat([{ role: 'user', content: '只回复：连接成功' }]); $('aiMsg').textContent = '连接成功'; } catch (e) { $('aiMsg').textContent = e.message; } };
  $('lsModels').onclick = async () => { saveSettings(collect()); $('aiMsg').textContent = '正在读取…'; try { const ms = await listModels(), c = collect(); saveSettings({ ...c, models: ms, model: ms.includes(c.model) ? c.model : ms[0] || c.model }); renderSettings(); $('aiMsg').textContent = `读到 ${ms.length} 个模型，在模型框里选`; } catch (e) { $('aiMsg').textContent = e.message; } };
  $('resetP').onclick = e => sure(e.currentTarget, '确认清空？', resetAll);
}

// ---------- 键盘、手势 ----------
addEventListener('keydown', e => {
  if (S.recKey) { // 正在改快捷键
    e.preventDefault(); const { a, i } = S.recKey; S.recKey = null;
    if (e.key !== 'Escape') { const m = keyMap(), k = e.key === 'Backspace' || e.key === 'Delete' ? '' : e.key; m[a] = [...m[a]]; m[a][i] = k; store.setLocal('keys', m); }
    return renderSettings();
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,textarea,select,[contenteditable]')) return;
  if ($('sheet').classList.contains('show')) { if (e.key === 'Escape') closeSheet(); return; }
  const m = keyMap(), is = a => m[a].includes(e.key), hit = fn => { e.preventDefault(); fn(); };
  if (is('ask')) return hit(openAsk);
  if (S.view !== 'practice') return;
  const q = cur();
  if (!q) { if (is('prev')) hit(() => go(S.i - 1)); return; }
  const picked = S.picked[q.id];
  if (picked && is('know')) return hit(() => fly(-1));
  if (picked && is('again')) return hit(() => fly(1));
  // 数字键 = 选屏幕上第几个（和显示顺序一致）；字母键 = 按屏幕上那个字母找（不是题库原字母）
  if (!picked && /^[1-6a-fA-F]$/.test(e.key) && q.options && q.options.length) {
    const v = showOpts(q);
    const o = /\d/.test(e.key) ? v[+e.key - 1] : v['ABCDEF'.indexOf(e.key.toUpperCase())];
    if (o) return hit(() => pick(o.key));
  }
  if (!picked && is('submit')) { if (q.type === 'multiple' || q.type === 'fill') return hit(submit); if (SELF.has(q.type) && !S.shown[q.id]) return hit(() => { S.shown[q.id] = true; renderCard(); }); }
  if (is('prev')) return hit(() => go(S.i - 1));
  if (is('next')) return hit(() => go(S.i + 1));
});
// 答完后拖题卡：左“记住”、右“再练”；手指、鼠标都行。按住时只跟手走，松手才判定：
// 拖过门槛（蒙版上的圆圈变实心）或往那边甩一下才飞出去；拖回中间、停住再松手、浏览器接管手势，都放回原处
const gate = card => Math.min(card.offsetWidth * .32, 140);
function veil(card, dx) { // 蒙版随距离变实，左绿 ✓、右红 ✕
  const v = card.querySelector('.veil'); if (!v) return;
  const p = Math.min(1, Math.abs(dx) / gate(card));
  v.style.setProperty('--p', p.toFixed(3)); v.classList.toggle('k', dx < 0); v.classList.toggle('a', dx > 0); v.classList.toggle('go', p >= 1);
}
function place(card) { // 圆圈放在题卡露在屏幕里那一段的正中（题长时题卡比屏幕高）
  const v = card.querySelector('.veil'); if (!v) return;
  const r = card.getBoundingClientRect(), t = Math.max(r.top, 60), b = Math.min(r.bottom, innerHeight - 90);
  v.style.setProperty('--cy', `${Math.round(Math.max(70, Math.min(r.height - 70, (t + b) / 2 - r.top)))}px`);
}
function fly(dir) {
  const card = $('card'), q = cur(); if (!q || !S.picked[q.id] || card.classList.contains('fly')) return;
  card.classList.remove('dragging', 'back'); place(card); veil(card, dir * gate(card)); card.classList.add('fly');
  card.style.transform = `translateX(${dir * (card.offsetWidth + 80)}px) rotate(${dir * 8}deg)`;
  setTimeout(() => mark(dir < 0 ? 'known' : 'unknown'), 220);
}
(() => {
  const card = $('card'); let st = null;
  card.addEventListener('pointerdown', e => {
    const q = cur();
    if (!q || !S.picked[q.id] || e.button > 0 || e.target.closest('button:not(:disabled),a,input,textarea,select,.code,.ref,.tip')) return;
    st = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, dx: 0, pts: [] };
  });
  card.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on) { if (Math.abs(dx) < 8) return; if (Math.abs(dy) > Math.abs(dx)) { st = null; return; } st.on = true; try { card.setPointerCapture(e.pointerId); } catch {} card.classList.remove('back'); card.classList.add('dragging'); place(card); }
    st.dx = dx; st.pts.push([e.timeStamp, dx]); while (st.pts.length > 2 && e.timeStamp - st.pts[0][0] > 100) st.pts.shift();
    card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`; veil(card, dx);
  });
  const end = e => {
    if (!st || e.pointerId !== st.id) return;
    const s = st; st = null; if (!s.on) return;
    card.classList.remove('dragging');
    if (e.type === 'pointerup') { // 只看手指最后的位置和最近 0.1 秒的速度；停住再松手速度就是 0
      const dx = s.dx, [t0, x0] = s.pts[0] || [0, 0], dt = e.timeStamp - t0, v = dt > 0 && dt < 160 ? (dx - x0) / dt : 0;
      if (Math.abs(dx) >= gate(card) || (Math.abs(dx) > 40 && Math.abs(v) > .5 && Math.sign(v) === Math.sign(dx))) return fly(dx > 0 ? 1 : -1);
    }
    card.classList.add('back'); card.style.transform = ''; veil(card, 0);
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  card.addEventListener('touchmove', e => { if (st && st.on && e.cancelable) e.preventDefault(); }, { passive: false }); // 拖着时别让页面滚动抢走手势
  // 选项在松手时就选：按下时选项缩小、新题入场还在动，松手点落到按钮外面时浏览器不发 click，表现为“点了没反应”
  let tap = null;
  card.addEventListener('pointerdown', e => { const o = e.button > 0 ? null : e.target.closest('.opt:not(:disabled)'); tap = o && { k: o.dataset.k, x: e.clientX, y: e.clientY, id: e.pointerId }; });
  card.addEventListener('pointerup', e => {
    if (!tap || e.pointerId !== tap.id) return;
    const t = tap; tap = null;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 14) { tapAt = Date.now(); pick(t.k); }
  });
  card.addEventListener('pointercancel', () => { tap = null; });
})();

// ---------- 专注模式、首次提示、问 AI、使用说明 ----------
// 嵌在首页里时让首页也收起它的顶栏，专注才是整屏
const tellTop = on => { try { if (window.parent !== window) window.parent.postMessage({ hx: 'focus', on }, location.origin); } catch (e) { } };
const setFocus = on => { document.body.classList.toggle('focus', on); store.setLocal('focus', on); tellTop(on); if (on) show('practice'); };
$('focusBtn').onclick = () => setFocus(true);
$('unfocus').onclick = () => setFocus(false);
function openNotice() {
  openSheet(`<h3>开始刷题</h3><div class="guide">
    <p>选题型和范围，点选项作答；答完<b>左滑记住、右滑再练</b>，电脑上按 <kbd>${esc(keyOf('know'))}</kbd> / <kbd>${esc(keyOf('again'))}</kbd>。</p>
    <p>“记住”的题不再出现在“待掌握”里；点错了可以撤销。</p>
    <p>想看 AI 逐项讲解：在“设置”里填自己的 AI Key，或装“夜夜题库AI伴侣”浏览器扩展。</p></div>
    <div class="row" style="margin-top:16px"><button class="btn ghost" type="button" id="nGuide" style="flex:1">使用说明</button><button class="btn" type="button" id="nOk" style="flex:1">开始</button></div>`, () => {
    $('nOk').onclick = closeSheet;
    $('nGuide').onclick = () => { closeSheet(); show('settings'); setTimeout(() => $('guide')?.scrollIntoView({ behavior: 'smooth' }), 80); };
  });
  store.setLocal('notice', 1);
}
// 问 AI 的模型可选项：设置里“读取模型”读到的 + 服务商默认 + 当前选中的，去重
function askModels() {
  const st = getSettings();
  const list = [...(st.models || []), ...((providers[st.provider] || {}).models || []), st.model].filter(Boolean);
  return [...new Set(list)];
}
// 思考程度映射到真实参数：开不开服务商的思考模式、temperature、输出预算（max_tokens）
const THINK = {
  低: { think: false, temperature: 0.2, maxTokens: 800 },
  中: { think: true, temperature: 0.3, maxTokens: 1400 },
  高: { think: true, temperature: 0.5, maxTokens: 2600 },
};
function askOpts() {
  const lv = THINK[store.getLocal('askThink', '低')] ? store.getLocal('askThink', '低') : '低';
  const preset = THINK[lv];
  const budget = +store.getLocal('askBudget', preset.maxTokens) || preset.maxTokens;
  return { lv, model: store.getLocal('askModel', '') || getSettings().model, think: preset.think, temperature: preset.temperature, budget };
}
const shortModel = m => String(m || '').split('/').pop();

function openAsk() {
  const q = S.view === 'practice' ? cur() : null;
  let withQ = !!q;
  const big = !!store.getLocal('askBig', false); // 上次的窗口大小记着
  const o = askOpts(), models = askModels();
  const draw = () => {
    const box = $('chat'); if (!box) return;
    box.innerHTML = S.chat.length ? S.chat.map(m => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${esc(m.show || m.content)}</div>`).join('') : `<p class="muted">${getSettings().apiKey ? '问这道题、知识点，或让 AI 出几道类似的题。' : '先在“设置”里填自己的 AI Key。'}</p>`;
    box.scrollTop = box.scrollHeight;
  };
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';
  openSheet(`<h3>问 AI<span style="flex:1"></span>${S.chat.length ? '<button class="btn sm ghost" type="button" id="chatClr">清空</button>' : ''}<button class="btn sm ghost" type="button" id="askBig" title="放大／还原窗口">${big ? '还原' : '放大'}</button></h3>
    <div class="chat" id="chat"></div>
    ${S.askDraft.trim() ? '<p class="muted" style="margin:0 0 6px;font-size:12px">上次没发出去的内容已经带回来了</p>' : ''}
    ${q ? `<div class="quote" id="quote"><span>引用：${esc(q.stem)}</span><button type="button" id="unquote" aria-label="不引用">✕</button></div>` : ''}
    <div class="askbox"><textarea id="askIn" rows="1" placeholder="输入问题，回车发送"></textarea></div>
    <div class="askbar">
      ${Rec ? '<button class="rbtn" type="button" id="mic" aria-label="语音输入"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>' : ''}
      <div class="pw"><button class="apill" type="button" id="modelBtn" aria-expanded="false"><b>${esc(shortModel(o.model) || '未选模型')}</b>${CARET}</button>
        <div class="pmenu" id="modelMenu"><h4>模型</h4>${models.map(m => `<button type="button" data-model="${esc(m)}" aria-selected="${m === o.model}">${esc(m)}<i>✓</i></button>`).join('')}</div></div>
      <div class="pw"><button class="apill" type="button" id="thinkBtn" aria-expanded="false"><b id="thinkLab">思考 · ${o.lv}</b>${CARET}</button>
        <div class="pmenu" id="thinkMenu"><h4>思考程度</h4>
          <div class="aseg" id="thinkSeg">${['低', '中', '高'].map(v => `<button type="button" data-lv="${v}" aria-pressed="${v === o.lv}">${v}</button>`).join('')}</div>
          <div class="alab"><span>输出预算</span><b id="budVal">${o.budget}</b></div>
          <input type="range" id="budget" min="400" max="2600" step="100" value="${o.budget}" aria-label="输出预算">
          <p class="muted" style="margin:2px 10px 6px;font-size:11.5px;line-height:1.5">中／高会打开服务商的思考模式，回答更细但更慢。</p>
        </div></div>
      <span class="sp"></span>
      <button class="rbtn go" type="button" id="askGo" aria-label="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>`, () => {
    draw();
    const inp = $('askIn');
    inp.oninput = () => { S.askDraft = inp.value; inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 150) + 'px'; };
    inp.value = S.askDraft || ''; inp.oninput();
    setTimeout(() => inp.focus(), 300);
    if ($('unquote')) $('unquote').onclick = () => { withQ = false; $('quote').remove(); };
    if ($('chatClr')) $('chatClr').onclick = () => { S.chat = []; openAsk(); };
    // 放大／还原：只换抽屉尺寸，不重建内容，聊天和草稿都留在原位
    $('askBig').onclick = () => {
      const on = !$('sheet').classList.contains('big');
      $('sheet').classList.toggle('big', on); store.setLocal('askBig', on); $('askBig').textContent = on ? '还原' : '放大';
      draw();
    };
    // 两个下拉：互斥打开，点外面／Esc 收起
    const menus = [['modelBtn', 'modelMenu'], ['thinkBtn', 'thinkMenu']];
    const closeMenus = () => menus.forEach(([b, m]) => { $(m).classList.remove('show'); $(b).setAttribute('aria-expanded', 'false'); });
    menus.forEach(([b, m]) => {
      $(b).onclick = e => {
        e.stopPropagation();
        const open = $(m).classList.contains('show');
        closeMenus();
        if (!open) { $(m).classList.add('show'); $(b).setAttribute('aria-expanded', 'true'); }
      };
      $(m).onclick = e => e.stopPropagation();
    });
    // 点页面其他地方收起下拉（每次打开重新挂，避免重复绑定）
    if (window.__askCloser) document.removeEventListener('click', window.__askCloser);
    window.__askCloser = closeMenus;
    document.addEventListener('click', window.__askCloser);
    // 换模型：只影响问 AI，不动设置页里选的默认模型
    for (const b of $('modelMenu').querySelectorAll('[data-model]')) b.onclick = () => {
      store.setLocal('askModel', b.dataset.model);
      for (const x of $('modelMenu').querySelectorAll('[data-model]')) x.setAttribute('aria-selected', String(x === b));
      $('modelBtn').querySelector('b').textContent = shortModel(b.dataset.model);
      closeMenus();
    };
    // 思考程度：分段和预算滑块联动，改了就存
    const seg = $('thinkSeg'), bud = $('budget'), budVal = $('budVal'), thinkLab = $('thinkLab');
    const paintBud = v => { bud.value = v; budVal.textContent = v; store.setLocal('askBudget', +v); };
    seg.onclick = e => {
      const b = e.target.closest('[data-lv]'); if (!b) return;
      const lv = b.dataset.lv;
      store.setLocal('askThink', lv);
      for (const x of seg.querySelectorAll('[data-lv]')) x.setAttribute('aria-pressed', String(x === b));
      thinkLab.textContent = '思考 · ' + lv;
      paintBud(THINK[lv].maxTokens);
    };
    bud.oninput = () => paintBud(+bud.value);
    bud.onchange = () => { store.setLocal('askBudget', +bud.value); };
    inp.onkeydown = e => {
      if (e.key === 'Escape') { return closeSheet(); } // Esc 关掉，草稿照样留着
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    };
    $('askGo').onclick = send;
    if (Rec) $('mic').onclick = () => {
      const r = new Rec(); r.lang = 'zh-CN'; r.interimResults = true; $('mic').classList.add('on');
      r.onresult = ev => { inp.value = [...ev.results].map(x => x[0].transcript).join(''); inp.oninput(); };
      r.onend = r.onerror = () => $('mic')?.classList.remove('on'); r.start();
    };
    async function send() {
      const text = inp.value.trim(); if (!text) return;
      if (!getSettings().apiKey) { S.askDraft = inp.value; closeSheet(); show('settings'); return toast('先填自己的 AI Key'); }
      let content = text;
      if (withQ && q) {
        content = `题目（${typeName(q.type)}）：${q.stem}${figText(q)}${q.code ? '\n' + q.code : ''}${(q.options || []).length ? '\n' + q.options.map(o => o.key + '. ' + optText(o)).join('\n') : ''}${S.picked[q.id] ? '\n题库答案：' + q.answer.join(q.type === 'fill' ? '；' : '') : ''}\n\n我的问题：${text}`;
        withQ = false; $('quote')?.remove();
      }
      S.chat.push({ role: 'user', content, show: text }); inp.value = ''; inp.oninput(); // 发出去了才清草稿（oninput 会把 S.askDraft 同步成空）
      const a = { role: 'assistant', content: '…' }; S.chat.push(a); draw(); $('askGo').disabled = true;
      try {
        const msgs = [{ role: 'system', content: `你是耐心的${S.subject ? '“' + S.subject.name + '”课程' : ''}辅导老师，用简洁的中文回答学生，不用 Markdown 标记；题库答案可能有误，有疑点要说明。` }, ...S.chat.slice(0, -1).slice(-12).map(({ role, content }) => ({ role, content }))];
        const oo = askOpts(); // 每次发送现读，下拉里改了立刻生效
        a.content = await streamChat(msgs, t => { a.content = t; draw(); }, { model: oo.model, think: oo.think, temperature: oo.temperature, maxTokens: oo.budget });
      } catch (e) { a.content = '出错了：' + e.message; }
      if ($('askGo')) $('askGo').disabled = false; draw();
    }
  }, 'ask' + (big ? ' big' : '')); // 'ask'：聊天区跟着抽屉高度自适应；'big'：上次放大过就还是大的
}
$('askBtn').onclick = openAsk;
const guide = () => `<h4>刷题</h4><ul>
  <li>顶上选科目，下面选题型和范围（待掌握、错题、未做…）；“顺序 / 随机”切换出题方式。</li>
  <li>答完：<b>左滑或按 ${esc(keyOf('know'))}</b> 记住并下一题，<b>右滑或按 ${esc(keyOf('again'))}</b> 再练；鼠标也能拖题卡。按住时题卡只跟着手指走，松手才算：拖回中间再松手就放回原处。点错了用提示里的“撤销”，或回到那题点“撤销记住”。快捷键可以在上面改。</li>
  <li>“专注”只留题卡；“问 AI”（${esc(keyOf('ask'))}）可以引用当前题目提问，浏览器支持时可以语音输入。</li>
  <li>登录后进度跟账号走；没登录只存在这台设备。账号、外观在首页右上角设置。</li></ul>
<h4>AI 解析（网页自带）</h4><ol>
  <li>到硅基流动、DeepSeek 等服务商注册，创建 API Key。</li>
  <li>在上面“AI 解析”里选服务商、填 Key，点“读取模型”选一个，保存，再点“测试连接”。</li>
  <li>答完一道题点“✦ AI 逐项解析”。Key 只存在你的浏览器，请求直接发给服务商。</li></ol>
<h4>浏览器扩展：夜夜题库AI伴侣</h4><ol>
  <li>安装：在电脑版 Chrome 或 Edge 里，从 <a href="https://github.com/zcq19991029/chorme-AIkuozhan/releases/latest" target="_blank" rel="noopener">发布页</a> 下载学生安装包（0.7.0 起支持本刷题页）并解压到固定文件夹；打开 <code>chrome://extensions</code>（Edge 是 <code>edge://extensions</code>），打开“开发者模式”，点“加载已解压的扩展程序”，选解压出来的 <code>extension</code> 文件夹。</li>
  <li>设置 AI：点浏览器右上角的扩展图标 →“设置”，填自己的硅基流动 API Key（在 cloud.siliconflow.cn 注册后创建），点“读取模型”选一个对话模型，保存，再点“测试”。</li>
  <li>调用：打开本刷题页，每道题题干后面出现“✦ 学会这题”，点它在右侧打开零基础讲解，可以继续追问。答完再点，讲解会对照标准答案。</li>
  <li>扩展更新后，在扩展页点“重新加载”，再刷新本页。</li></ol>
<p>网页和扩展的 Key 各存各的，互不影响。装了扩展不填网页 Key 也能用扩展讲题；<b>在这里也填一份，题目下就会同时有扩展的“✦ 学会这题”和网页的“✦ AI 逐项解析”</b>，点哪个都行。</p>`;

// ---------- 启动 ----------
// 登录了但没开通（GitHub 新账号等，身份“未开通”）：整页挡住，只引导去首页填邀请码；没登录的照样能刷
function lock(on) {
  let el = document.getElementById('hxLock');
  if (!on) { if (el) el.remove(); return false; }
  if (!el) { el = document.createElement('div'); el.id = 'hxLock'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:var(--card,#f5f5f7);color:var(--ink,#1d1d1f);font-size:16px';
  el.innerHTML = '<b style="font-size:20px">这个账号还没开通</b><a href="https://zcq19991029.github.io/" target="_top" style="padding:10px 22px;border-radius:999px;background:#0a84ff;color:#fff;text-decoration:none">填写邀请码开通</a>';
  return true;
}
async function boot() {
  S.user = S.me = null;
  if (hx.signedIn()) { try { [S.user, S.me] = await Promise.all([hx.user(), hx.me()]); } catch { S.user = S.me = null; } }
  if (lock(S.me && !S.me.teacher && !S.me.admin && !S.me.dev && !S.me.student && !S.me.left)) return;
  setAiProfile(hx.uid() || 'default');
  const p = prefs();
  S.type = p.type || 'single'; S.scope = p.scope || 'todo'; S.mode = ORDERS.some(o => o[0] === p.mode) ? p.mode : 'seq';
  renderNav(); renderWho();
  const pub = String(p.subject || '').startsWith('pub-');
  await loadSubjects(pub);
  await openSubject(p.subject && S.subjects.some(s => s.id === p.subject) ? p.subject : BUILTIN[0].id);
  if (!pub) await loadSubjects(); // 老师发布的题库随后补进科目列表
  store.rankFlush(rankDone); // 上次没交上的答对记录
}
if (store.getLocal('focus', false)) { document.body.classList.add('focus'); tellTop(true); }
if (!store.getLocal('notice', 0)) setTimeout(openNotice, 600);
let was = hx.signedIn();
hx.onChange(() => { const n = hx.signedIn(); if (n !== was) { was = n; store.flush(); S.base = {}; boot(); } }); // 在总入口或别的工具登录、退出
{ // 扩展在页面加载完后才挂上，挂上（或停用后刷新）时重画用到它的地方
  let ext = hasExt();
  new MutationObserver(() => { if (hasExt() === ext) return; ext = !ext; if (!S.subject) return; if (S.view === 'settings') renderSettings(); if (S.view === 'practice') renderCard(); }).observe(document.documentElement, { childList: true });
}
addEventListener('pagehide', () => { if (S.subject) store.write('progress:' + S.subject.id, S.records, { now: true }); });
boot();
