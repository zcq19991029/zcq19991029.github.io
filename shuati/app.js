// 华夏工具 · 刷题：界面和刷题流程。题库解析、AI 解析沿用 imports.js / ai.js；存储见 store.js；账号见 hx.js。
import * as hx from './hx.js';
import * as store from './store.js';
import { AI_PAGE, aiState, aiReady, aiProfiles, aiThinkLevels, ensureHxAi, streamChat, explainQuestion, parseStudySpec } from './ai.js';
import { readMaterial, readImages, normalizeQuestions, aiImport, aiGenerate, aiVision, isImageFile } from './imports.js';
import { figSvg, figName } from './symbols.js';

// 内置课程题库（data/ 下的 JSON）；第一个是默认科目
/* 2026-11-08：这 4 套「搬到了开发者名下」。
   用户原话：「内置的转换成开发者的权限 算我上传的 搬我那里 这个我同意」。
   做法不是把 JSON 删掉，而是同一份题**两边都有**：
     · 云端（quiz_public，owner = 开发者，id 就是这里的 id）——登录后优先读它，可以发布给班级、可以改；
     · 本地 data/*.json —— 没网、没登录、云端还没搬过时的兜底。
   为什么 id 必须一字不改（wiring / mcu / psychology / education）：
   排位表 quiz_rank_hits.bank / quiz_rank_keys.bank 存的就是这 4 个名字，
   换了 bank 名，1896 道题（370+245+540+741）的排位成绩全部对不上，等于把历史数据作废。
   搬的动作见设置页「把内置题库搬到我的账号」按钮（只有开发者看得到）。 */
const BUILTIN = [
  { id: 'wiring', name: '电气接线原理', file: 'data/wiring.json', tag: '期末理论' },
  { id: 'mcu', name: '单片机应用技术', file: 'data/mcu.json', tag: '期末理论' },
  { id: 'psychology', name: '教育心理学', file: 'data/questions.json', tag: '教资' },
  { id: 'education', name: '教育学', file: 'data/education.json', tag: '教资' },
];
const BUILTIN_IDS = new Set(BUILTIN.map(s => s.id));
const TYPES = [['single', '单选'], ['multiple', '多选'], ['judgment', '判断'], ['fill', '填空'], ['term', '名词解释'], ['short', '简答'], ['prog', '程序分析']];
const SELF = new Set(['term', 'short', 'prog']); // 主观题：看参考答案自己判对错
// 出题要求（导入区“根据资料出题”）：默认只出选择题；填空/简答要用户自己勾，
// 因为它们在刷题页只能「看参考答案自评」，不参与排行榜计分，默认勾上会让人误会。
// scope（2026-11-09）：从「一段手写文字」改成「勾选的章节数组」，空数组 = 整份资料（和以前 scope:'' 一样）。
const GEN_DEF = {
  scope: [], level: '中等', extra: '',
  count: { single: 5, multiple: 3, judgment: 5, fill: 5, short: 3, prog: 3 },
  on: { single: true, multiple: true, judgment: true, fill: false, short: false, prog: false }
};
// 程序分析（prog）2026-11-08 加：单片机、C 语言资料里最常见的题型，以前导入这条路没开
const GEN_TYPES = [['single', '单选'], ['multiple', '多选'], ['judgment', '判断'], ['fill', '填空'], ['short', '简答'], ['prog', '程序分析']];
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
// 硅基流动注册二维码、邀请链接：二维码内联 base64（离线打包成单文件时外部图片会丢）
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
  sel: new Set(), ai: {}, draft: null, imode: 'pick', gen: null, pending: [], typed: {}, shown: {}, // typed：填空填的字；shown：主观题已看参考答案
  undo: {}, lastId: null, chat: [], // undo：题 id → 标记前的状态（误点“记住”能撤销）
  askDraft: '', // “问 AI”打了一半的字：关掉抽屉、切到别的抽屉都不丢，发出去才清
  hsel: new Set(), hf: 'all', // 概览“刷题记录”：勾选的题、筛选
  rmine: false, // 排行：只看本班
  study: null, // 题库页「给这道题提要求」：{ qid, text, busy, err, spec:{read,items}, ask }
};
const prefs = () => store.getLocal('prefs', {});
const savePrefs = () => store.setLocal('prefs', { subject: S.subject?.id, type: S.type, scope: S.scope, mode: S.mode });
const inPortal = () => { try { return window.top !== window && window.top.location.pathname === '/'; } catch { return false; } };
const isTeacher = () => !!(S.me && (S.me.teacher || S.me.admin || S.me.dev));
// 开发者最高权限（2026-11-08 用户明确：「开发者拥有以上全部功能 管理员开发者都属于教师账号 只不过开发者最高权限」）。
// 目前只有两件事只给开发者：把内置题库搬到自己的账号、删别人发布的题库。
const isDev = () => !!(S.me && S.me.dev);
const rec = id => S.records[id] || { status: 'new', attempts: 0, wrong: 0 };
const inScope = (r, s) => s === 'todo' ? r.status !== 'known' : s === 'wrong' ? r.wrong > 0 && r.status !== 'known' : s === 'new' ? !r.attempts : s === 'done' ? r.attempts > 0 : r.status === 'known';

// ---------- 科目和题库 ----------
async function loadSubjects(withPublic = true) { // withPublic=false：先不等老师发布的题库（联网慢），内置科目马上能刷
  const [mine, pub, shares] = await Promise.all([
    store.read('subjects', [], store.mergeSubjects),
    withPublic ? store.publicList() : S.subjects.filter(s => s.kind === 'public').map(s => ({ id: s.pid, name: s.name, owner_name: s.owner, total: s.total })),
    store.read('shares', []), // 别人用分享码给我的题库（2026-11-08）
  ]);
  const mineIds = new Set(mine.map(s => s.id));
  /* 内置 4 套搬到云端之后，quiz_public 里会出现 id 就叫 wiring / mcu / psychology / education 的记录。
     它们**不能**再以「pub-wiring」这种第二个身份出现 —— 否则科目列表里一门课变两张卡，
     排行榜也会裂成 wiring 和 pub-wiring 两份。所以这类记录直接挂到内置那张卡上（cloud 标记），
     题目来源改成云端，local 那份 data/*.json 退成兜底。 */
  const cloudBuiltin = new Map();
  for (const p of (pub || [])) if (p && BUILTIN_IDS.has(p.id)) cloudBuiltin.set(p.id, p);
  S.subjects = [
    ...BUILTIN.map(s => {
      const p = cloudBuiltin.get(s.id);
      return p
        ? { ...s, kind: 'builtin', cloud: true, pid: p.id, owner: p.owner_name, total: p.total, targets: p.targets, class_ids: p.class_ids, teacher_ids: p.teacher_ids, mine: p.mine }
        : { ...s, kind: 'builtin' };
    }),
    ...(pub || []).filter(p => !BUILTIN_IDS.has(p.id) && !(p.mine && mineIds.has(p.id))).map(p => ({ id: 'pub-' + p.id, pid: p.id, name: p.name, kind: 'public', owner: p.owner_name, tag: p.owner_name ? p.owner_name + ' 发布' : '老师发布', total: p.total,
      // 下发范围（2026-11-02）：targets 是给人看的说明，class_ids 给发布面板回填复选框
      // 2026-11-08 加 teacher_ids：发给指定老师时回填那一栏
      mine: p.mine, targets: p.targets, class_ids: p.class_ids, teacher_ids: p.teacher_ids })),
    /* 分享码换来的题库：不是「我的科目」（自己没编过），也不是「别人发布」（不走班级），
       单独一类 shared，卡片上标清是谁分享的码。 */
    ...(shares || []).filter(s => s && s.id).map(s => ({ id: s.id, code: s.code, name: s.name, kind: 'shared', tag: s.owner ? s.owner + ' 分享' : '分享码', total: s.total })),
    ...mine.map(s => ({ ...s, kind: 'mine' })),
  ];
  /* 首屏为了快，是「先不等云端、直接把内置科目画出来」的；云端那条「这套题已经搬到开发者名下」
     的信息要晚一步才到。所以这里补两件事：
       · 把 S.subject 换成新对象（不然它还指着刚才那份没有 cloud 标记的，题库页就一直显示「本地只读」）；
       · 云端这份第一次出现时，清掉先前从 data/*.json 读到的那份缓存，让 baseOf 重新去云端取。 */
  if (S.subject) {
    const fresh = S.subjects.find(s => s.id === S.subject.id);
    if (fresh) {
      if (fresh.cloud && !S.subject.cloud) delete S.base[fresh.id];
      S.subject = fresh;
    }
  }
}
async function baseOf(sub) {
  if (S.base[sub.id]) return S.base[sub.id];
  let list = [];
  if (sub.kind === 'builtin') {
    /* 云端优先（2026-11-08）：搬到开发者名下之后，题目以 quiz_public 那份为准 ——
       开发者在题库页改完再发布，学生下次进来就是新题，不用跟着改代码重新发站。
       拿不到（没网 / 没登录 / 还没搬过 / 被从「全部学生」改成只发某几个班）就退回本地 JSON。 */
    if (sub.cloud && sub.pid) {
      try { const r = await store.publicGet(sub.pid); if (r && Array.isArray(r.questions) && r.questions.length) list = r.questions; } catch { /* 落到下面的本地兜底 */ }
    }
    if (!list.length) {
      // 离线版：题库已经内联在文件里（window.__BANK），file:// 下 fetch 会被浏览器拦，直接取
      if (window.__OFFLINE && window.__BANK && window.__BANK[sub.file]) list = window.__BANK[sub.file];
      else { const r = await fetch(sub.file + '?v=20261031', { cache: 'no-cache' }); if (!r.ok) throw new Error('题库加载失败 HTTP ' + r.status); list = await r.json(); }
    }
  }
  else if (sub.kind === 'public') { const r = await store.publicGet(sub.pid); list = (r && r.questions) || []; }
  /* 分享码换来的题库：题目存在本机（sharedq:<码>），第二次打开不再拉网；
     本机没有（换了设备 / 清了缓存）才凭码再取一次 —— 码过期了就在这一步报错，说得清楚。 */
  else if (sub.kind === 'shared') {
    const cached = store.getLocal('sharedq:' + sub.code, null);
    if (Array.isArray(cached) && cached.length) list = cached;
    else {
      const r = await store.shareGet(sub.code);
      list = (r && r.questions) || [];
      if (list.length) store.setLocal('sharedq:' + sub.code, list);
    }
  }
  return (S.base[sub.id] = list);
}
// 七个跳动的像素方块：全站加载提示的统一长相（样式在 hx-theme.js 注入的 #hx-pill-style 里，
// 尺寸随视口自适应）。刷题原来这里是一行干文字「正在加载题库…」，2026-11-04 统一成像素动效。
function pxBlocks() {
  let s = '<span class="hx-px" aria-hidden="true">';
  for (let i = 0; i < 7; i++) s += `<i style="--i:${i}"></i>`;
  return s + '</span>';
}
async function openSubject(id) {
  const sub = S.subjects.find(s => s.id === id) || S.subjects[0];
  S.subject = sub; S.ai = {}; S.draft = null; S.pending = []; S.imText = ''; S.study = null; // 换了科目，先说的一半话不带过去
  paintSubj();
  // 加载提示统一规则（2026-11-04，用户：「加载动效呢 像素动效没有随机使用啊」）：
  // 首选像素动效——HXLoadFx 从特效包随机挑一个画 canvas（会话内固定，见 loadfx.js 头注释），
  // 「正在加载题库…」以药丸形式跟在动效下方作状态说明（要的是结合，不是二选一）；
  // 播不了（reduced-motion / hx-lite / 特效包没出来 / canvas 建不出来）回落到原来的方块药丸。
  // 无论走哪条路，屏幕上只有这一套加载提示。
  const card = $('card'); card.innerHTML = '';
  // 2026-11-06 时序返修：首屏那一轮由 index.html 里的 #hxBoot 整屏闪屏负责（第一帧就有像素动效），
  // 这里不再往题卡里塞第二套；只有之后切科目 / 重新打开时（闪屏已撤）才在题卡里画「canvas + 药丸」。
  const splash = !!(window.HXLoadFx && HXLoadFx.booting && HXLoadFx.booting());
  const loadfx = (!splash && window.HXLoadFx) ? HXLoadFx.mount(card, 'quiz', '正在加载题库…') : null;
  if (!loadfx && !splash) card.innerHTML = '<div class="hx-loadwrap"><div class="hx-loadpill" role="status">' + pxBlocks() + '<b>正在加载题库…</b></div></div>';
  // 手快连点两个科目时，先发的那次可能后回来。用序号记住“谁最后一次点的”，
  // 回来的旧结果直接丢掉，否则会出现左上角写着一个科目、中间却是另一个科目
  const seq = S.subSeq = (S.subSeq || 0) + 1;
  let base = [];
  try { base = await baseOf(sub); } catch (e) { toast(e.message); }
  const bank = await store.read('bank:' + sub.id, [], (a, b) => (b && b.length ? b : a));
  const records = await store.read('progress:' + sub.id, {}, store.mergeProgress);
  if (seq !== S.subSeq || S.subject !== sub) { if (loadfx) loadfx.done(); return; } // 期间又换过一次科目，这次结果作废
  S.bank = bank;
  const seen = new Set(base.map(q => q.id));
  S.questions = [...base, ...S.bank.filter(q => !seen.has(q.id))];
  S.records = records;
  if (!S.questions.some(q => q.type === S.type)) S.type = (TYPES.find(t => S.questions.some(q => q.type === t[0])) || TYPES[0])[0];
  savePrefs(); buildQueue(true);
  paintSubj(); // 加载完再对一次：科目名、标题、右侧题型，保证和中间内容是同一个科目
  if (loadfx) loadfx.done(); // 收掉加载动效再换题卡（show 会重画 #card），不留第二套
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
/* 2026-11-08：给网站外壳（总入口）左上角「返回」用的「上一步」接口。
   外壳先问当前工具能不能自己退一步：true = 工具退了（外壳什么都不做），false = 已经在第一屏，外壳回首页。
   本站的第一屏是「练习」（practice），其余栏目（总览/排位/题库/设置）都退它一步。 */
window.HXBack = function () {
  if (S.view && S.view !== 'practice') { show('practice'); return true; }
  return false;
};
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
/* ---------- 学习卡色块（2026-11-07） ----------
   用户拿他自己做的「高数交互解析」页面当参考：一张暖黄卡，里面四块 ——
   零基础做题步骤 / 顺口溜 / 必须记住的小表 / 易错提醒。要求「有机融合进刷题，
   点 AI 解析的时候也用色块区域铺开」。所以这里是一个纯渲染函数，两个来源共用：
     · AI 解析 —— ai.js 回来的 _lead / _steps / _tip / _table / _warn / _review
     · 题库自带 —— 题目上的 tip 字段（老师手写的一句口诀，见 imports.js）
   没有内容时返回空串，调用处直接拼，不用先判断。
   ── 为什么固定这个顺序 ──
   先怎么做（步骤）→ 再好记（口诀）→ 再背下来（小表）→ 最后别踩坑（易错），
   这是从零到能用的顺序；缺哪块就不画，别用「暂无」占位。 */
function studyCard(d, src) {
  if (!d) return '';
  const lead = String(d._lead || '').trim();
  const steps = (Array.isArray(d._steps) ? d._steps : []).map(x => String(x || '').trim()).filter(Boolean);
  const tip = String(d._tip || '').trim();
  const rows = (Array.isArray(d._table) ? d._table : []).filter(r => r && (r[0] || r[1]));
  const warn = String(d._warn || '').trim();
  const note = String(d._note || '').trim();
  if (!lead && !steps.length && !tip && !rows.length && !warn && !note) return '';
  const blocks = [];
  if (steps.length) blocks.push(`<section class="g"><h5>零基础做题步骤</h5><ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>`);
  if (tip) blocks.push(`<section class="g mnemonic"><h5>顺口溜 · 速记</h5><p>${esc(tip)}</p></section>`);
  if (rows.length) {
    /* 有「条件/结果」两列就画表头；整行没有拆开的（模型只给了半句，或者一句话里带了两个箭头）
       那一行自己拉满两列 —— 逐行判断，不能因为别的行是全的就给它补一个破折号。 */
    const two = rows.some(r => r[0] && r[1]);
    const body = rows.map(r => (r[0] && r[1])
      ? `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`
      : `<tr><td colspan="${two ? 2 : 1}">${esc(r[0] || r[1])}</td></tr>`).join('');
    blocks.push(`<section class="g"><h5>必须记住的小表</h5><table${two ? ' class="two"' : ''}>${two ? '<tr><th>条件</th><th>结果</th></tr>' : ''}${body}</table></section>`);
  }
  if (warn) blocks.push(`<section class="g warn"><h5>易错提醒与自检</h5><p>${esc(warn)}</p></section>`);
  return `<div class="study"><div class="study-head"><h4>学习卡</h4><span class="sp"></span>${src ? `<span class="study-src">${esc(src)}</span>` : ''}</div>
    ${lead ? `<p class="study-lead"><b>考什么：</b>${esc(lead)}</p>` : ''}
    ${blocks.length ? `<div class="study-grid">${blocks.join('')}</div>` : ''}
    ${note ? `<p class="study-note"><b>题库复核：</b>${esc(note)}</p>` : ''}</div>`;
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
    // 首页「AI 设置」配好了就给「✦ AI 逐项解析」；没配就在原位给一句提示 + 去 /ai/ 的链接（离线版只提示没有 AI）。
    const aiPart = !ai ? (aiReady() ? '<button class="btn sm ghost" type="button" id="aiBtn">✦ AI 逐项解析</button>' : noAiHint())
      : ai.state === 'load' ? '<span>AI 正在解析…</span>'
      : ai.state === 'err' ? `<span style="color:var(--bad)">${esc(ai.msg)}</span><button class="btn sm ghost" type="button" id="aiBtn">重试</button>`
      // 解析成功后按钮留着改成「重新解析」：以前一旦拿到结果就没了，模型答得不好只能刷新页面
      : '<button class="btn sm ghost" type="button" id="aiBtn">重新解析</button>';
    fb = `<div class="fb ${ok ? 'ok' : 'bad'}"><b>${ok ? '回答正确' : '答案是 ' + esc(ans)}</b>${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}<div class="ai">${aiPart}</div></div>`;
  }
  /* 学习卡：三个来源，分开标、别让人以为是同一个地方来的 ——
       老师补充（老版「说人话写学习卡」留下的 study）/ AI 解析 / 题库自带（导入 JSON 里的 tip）
       新版存的是「给 AI 的要求」（q.spec），学生看不到成品文案，只有 AI 现场解析的结果
     「题库复核」原来单独一行灰字，现在并进卡片底部的脚注 —— 它说的是题库准不准，不是知识点。
     ── 为什么 !picked 就整块不画 ──
     口诀往往就是把答案编进去了（「写 1 关管子」= 选 B），答题前摆出来等于送分。
     和参考答案、解析一样，都是答完才给。 */
  const aiDone = ai && ai.state === 'done' && ai.data;
  const mine = q.study && typeof q.study === 'object' ? q.study : null;
  const cards = !picked ? ''
    : (mine ? studyCard({ _lead: mine.lead, _steps: mine.steps, _table: mine.table, _tip: mine.tip, _warn: mine.warn }, '老师补充') : '')
      + (aiDone ? studyCard({ ...ai.data, _note: /^一致/.test(ai.data._review || '') ? '' : ai.data._review }, 'AI 解析') : '')
      + (String(q.tip || '').trim() ? studyCard({ _tip: String(q.tip).trim() }, '题库自带') : '');
  const tag = (r.wrong ? `<span style="color:var(--bad)">错过 ${r.wrong} 次</span>` : r.status === 'known' ? '<span style="color:var(--ok)">已记住</span>' : '')
    + (r.status === 'known' && q.id in S.undo ? '<button class="btn sm ghost" type="button" id="undoBtn" style="height:26px">撤销记住</button>' : '');
  const hint = picked ? `<div class="hint">左滑或 <kbd>${esc(keyOf('know'))}</kbd> 记住 · 右滑或 <kbd>${esc(keyOf('again'))}</kbd> 再练</div>` : '';
  card.innerHTML = `<div class="qhead"><span class="qtype">${typeName(q.type)}</span><span>${S.i + 1} / ${S.queue.length}</span><span class="sp"></span>${tag}</div>
    <h2 class="stem">${stem}</h2>${extra}${opts ? `<div class="opts">${opts}</div>` : ''}
    ${q.type === 'multiple' && !picked ? `<button class="btn submit" type="button" id="submitBtn" ${S.sel.size ? '' : 'disabled'}>提交答案${S.sel.size ? `（已选 ${[...S.sel].sort().join('')}）` : ''}</button>` : ''}${q.type === 'fill' && !picked ? '<button class="btn submit" type="button" id="submitBtn">提交答案</button>' : ''}${fb}${cards}${hint}
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
  /* 第 4 个参数是科目名（提示词里带一句“这是XX课程的题”），
     第 5 个是老师对这道题提的要求 —— q.spec.items 在题库页存下来的那几条祈使句。
     拼成一段塞进提示词，内容仍由模型按 PARSE_SPEC 现场生成（2026-11-08 用户拍板的方向）。 */
  const spec = ((q.spec && q.spec.items) || []).join('；');
  try { S.ai[q.id] = { state: 'done', data: await explainQuestion(q, S.picked[q.id] || [], null, S.subject.name, spec) }; }
  catch (e) { S.ai[q.id] = { state: 'err', msg: e.message }; }
  if (cur() === q) renderCard();
}

// ---------- 底部抽屉：答题卡、科目 ----------
function openSheet(html, bind, cls) {
  $('sheetBody').innerHTML = html; bind && bind();
  $('sheet').classList.remove('ask', 'big', 'solid'); // cls：'ask'（问 AI，聊天区自适应）/ 'big'（放大）/ 'solid'（铺实底，别透出下面的页面）
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
    ${g('shared').length ? `<div class="sgroup">分享给我的</div><div class="slist">${g('shared').map(item).join('')}</div>` : ''}
    <div class="sgroup">我的科目</div><div class="slist">${g('mine').map(item).join('')}
    <button type="button" class="sitem" id="newSubj" style="justify-content:center;color:var(--acc3)"><b style="flex:none">＋ 新建科目</b></button>
    <button type="button" class="sitem" id="joinBtn" style="justify-content:center;color:var(--acc3)"><b style="flex:none">输入分享码</b></button></div>`, () => {
    // 换科目留在当前栏目（在概览就看新科目的概览，在排行就看新科目的排行），不要硬踢回刷题
    for (const b of $('sheetBody').querySelectorAll('.sitem[data-id]')) b.onclick = async () => { closeSheet(); await openSubject(b.dataset.id); };
    $('newSubj').onclick = () => { closeSheet(); show('bank'); setTimeout(() => $('newName')?.focus(), 50); };
    // 2026-11-08：朋友把 6 位分享码发过来，从这里输进去就能刷
    $('joinBtn').onclick = () => openJoinSheet('');
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
  // 2026-11-06：子模块（排行）的加载态也换成「canvas 像素动效 + 药丸」结合体，
  // 不再是一行裸文字「正在加载排行…」。占位节点交给 HXLoadFx.auto() 就地升级；
  // 播不了（省电 / 关动画 / 特效包缺失）时 auto() 会填回落药丸，不会空屏。
  if (el.dataset.for !== sub.id) {
    el.dataset.for = sub.id;
    el.innerHTML = head('<div class="hx-loadwrap sm" data-fxload="正在加载排行…" data-fxtool="quiz"></div>') + seg;
    if (window.HXLoadFx) HXLoadFx.auto(el);
    bind();
  }
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

// ---------- 导入区的小零件（说明、模板、出题要求、识别报告） ----------
/* 出题「范围」的选项 = 当前题库里已有的章节。
   ── 为什么取 source / sourceTitle ──
   题库的数据结构里没有单独的 chapter 字段（normalizeQuestions 也不产生），能当章节用的只有
   source：内置题库就是「项目3 并行 I/O 端口与 C51 语言」「电气控制技术实训 第3版 项目1」这种，
   老师自己导入时也会写在 source／出处里。所以从题目里收集、去重，不在代码里写死章节名单 ——
   换一门课、换一本教材，选项自动跟着变。
   空串跳过（教育心理学有 460 题没写来源），别生成一个空白选项。 */
function bankChapters() {
  const out = [], seen = new Set();
  for (const q of S.questions || []) {
    const raw = String(q.source || q.sourceTitle || '').trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw); out.push(raw);
  }
  // 项目2 / 项目10 这种按数字排，别让「项目10」排到「项目2」前面
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
}
// 出题要求存在本机：老师这次勾了「只出单选 10 道」，下次打开还是这套，不用重填
function genState() {
  if (!S.gen) S.gen = { ...GEN_DEF, count: { ...GEN_DEF.count }, on: { ...GEN_DEF.on }, ...(store.getLocal('importGen', null) || {}) };
  S.gen.count = { ...GEN_DEF.count, ...(S.gen.count || {}) };
  S.gen.on = { ...GEN_DEF.on, ...(S.gen.on || {}) };
  /* 老存档迁移：2026-11-09 以前 scope 是一段手写文字（如「第 5 章」），现在是章节数组。
     能对上现有章节的就勾上；对不上的直接丢掉 —— 留着一句界面上看不见的话，
     用户会以为范围还在生效，实际却悄悄按整份资料出题，比丢掉更坏。 */
  if (typeof S.gen.scope === 'string') {
    const old = S.gen.scope.trim();
    S.gen.scope = old ? bankChapters().filter(c => c === old) : [];
  }
  if (!Array.isArray(S.gen.scope)) S.gen.scope = [];
  return S.gen;
}
const saveGen = () => store.setLocal('importGen', genState());
// 真正交给 AI 的题型和数量：勾了且数量大于 0 才算
function genTypes() {
  const g = genState(), out = {};
  for (const [t] of GEN_TYPES) {
    if (!g.on[t]) continue;
    const n = Math.max(0, Math.min(50, Math.round(+g.count[t] || 0)));
    if (n) out[t] = n;
  }
  return out;
}
// 没配 AI 时的统一提示（2026-11-08 Z5：AI 只在首页「AI 设置」配，刷题不再自存 Key）。
// 链接用站点根的 /ai/（线上 /shuati/ 的上一层就是根）；target=_top：刷题嵌在首页 iframe 里时整页跳过去。
// 离线单文件没有 AI，也没有首页可去，只说一句。
function noAiHint(cap = 'text') {
  const st = aiState(cap);
  if (st.offline) return `<span class="noai muted" data-noai>${esc(st.msg)}</span>`;
  return `<span class="noai" data-noai><span>${esc(st.msg)}</span><a class="btn sm ghost" href="${AI_PAGE}" target="_top">去首页 AI 设置</a></span>`;
}
const noAiWarn = (cap = 'text') => `<div class="imp-warn">${noAiHint(cap)}</div>`;
// 下载一段文本：导出题库、下载模板共用
function downloadText(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 下载的模板：4 种题型各一道，老师照着改就行（不用 AI，直接拖回来导入）
const TPL = [
  { type: 'single', stem: '并行 I/O 端口工作在输入方式时，要先向端口写（　）。', options: [{ key: 'A', text: '0' }, { key: 'B', text: '1' }, { key: 'C', text: '0xFF' }, { key: 'D', text: '任意值' }], answer: ['B'], explanation: '写 1 关掉端口内部的场效应管，引脚才能被外部电路拉低。' },
  { type: 'multiple', stem: '下面属于单片机最小系统组成部分的有（　）。', options: [{ key: 'A', text: '时钟电路' }, { key: 'B', text: '复位电路' }, { key: 'C', text: '电源' }, { key: 'D', text: '打印机' }], answer: ['A', 'B', 'C'], explanation: '最小系统 = 单片机 + 时钟 + 复位 + 电源。' },
  { type: 'judgment', stem: '定时器工作在方式 2 时是 8 位自动重装。', options: [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }], answer: ['T'], explanation: '方式 2 为 8 位自动重装载定时/计数。' },
  { type: 'fill', stem: '8051 单片机的 P0 口作为通用 I/O 使用时，需要外接 ____。', answer: ['上拉电阻'], explanation: 'P0 是开漏输出，没有内部上拉。' },
  // 程序分析题（2026-11-08）：代码放 code、小问放 sub、参考答案放 answer，跟内置单片机题库同一个形状
  { type: 'prog', stem: '阅读下面的程序，P1 口接 8 个 LED（D1 接 P1.0，低电平点亮），回答问题。', code: '#include <reg51.h>\nvoid main()\n{\n    P1 = 0xFE;\n    while(1);\n}', sub: ['上电后哪个灯先亮？', '程序会不会自己停下来？'], answer: ['（1）D1 先亮（0xFE 只有最低位为 0）。（2）不会，while(1) 是死循环。'], explanation: '最低位为 0，P1.0 输出低电平。' }
];
function genHtml() {
  const g = genState();
  /* 章节选项来自当前题库；顺手把「已经不在题库里的旧勾选」剔掉，
     否则界面上看不到那一项，提示词里却还带着它（切科目后最容易出现）。 */
  const chs = bankChapters();
  g.scope = g.scope.filter(c => chs.includes(c));
  return `<div class="gen" id="gen" ${S.imode === 'gen' ? '' : 'hidden'}>
        <div class="genfield">
          <span class="gt">出题范围</span>
          ${chs.length ? `<div class="chgrid" id="genScope">${chs.map(c => `<label class="${g.scope.includes(c) ? 'on' : ''}"><input type="checkbox" data-ch="${esc(c)}" ${g.scope.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>` : '<p class="muted" style="margin:0">这个题库还没有章节信息（题目里没写「来源」）。不勾就是整份资料。</p>'}
          <p class="muted" style="margin:0">勾哪几章就只出这几章的题；一个都不勾 = 整份资料。选项来自当前题库已有的章节。</p>
        </div>
        <div class="gt">题型和数量（整份资料一共要几道）</div>
        ${GEN_TYPES.map(([t, n]) => `<div class="genrow"><label><input type="checkbox" data-tp="${t}" ${g.on[t] ? 'checked' : ''}>${n}</label><input type="number" min="0" max="50" step="1" data-n="${t}" value="${esc(g.count[t])}"><span class="muted">道</span>${t === 'fill' || t === 'short' || t === 'prog' ? '<span class="muted">· 只能自评，不计分</span>' : ''}</div>`).join('')}
        <label for="genLevel">难度</label>
        <select id="genLevel">${['基础', '中等', '综合'].map(v => `<option ${v === g.level ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label for="genExtra">额外要求</label>
        <textarea id="genExtra" rows="3" placeholder="例如：多考电路图和端口地址；不要出计算量太大的；答案要能在原文找到依据">${esc(g.extra)}</textarea>
        <p class="muted" style="margin:0">填空、简答、程序分析也会存进题库：填空能自动判分（题干里的 ____ 就是填空框）；简答、程序分析只能「看参考答案」自己判，不参与排行榜（排行榜只算单选、多选、判断）。程序分析会把代码和几个小问分开摆，跟内置单片机题库里那 11 道一个样子。</p>
      </div>`;
}
function bindGen() {
  const g = genState();
  const box = $('v-bank');
  // 章节多选：勾一下改数组，同时给 label 加 .on（不用 :has，老内核也稳）
  for (const c of box.querySelectorAll('#genScope [data-ch]')) c.onchange = () => {
    const set = new Set(g.scope);
    if (c.checked) set.add(c.dataset.ch); else set.delete(c.dataset.ch);
    g.scope = [...set];
    const lab = c.closest('label'); if (lab) lab.classList.toggle('on', c.checked);
    saveGen();
  };
  if ($('genLevel')) $('genLevel').onchange = e => { g.level = e.target.value; saveGen(); };
  if ($('genExtra')) $('genExtra').oninput = e => { g.extra = e.target.value; saveGen(); };
  for (const c of box.querySelectorAll('[data-tp]')) c.onchange = () => { g.on[c.dataset.tp] = c.checked; saveGen(); };
  for (const n of box.querySelectorAll('[data-n]')) n.oninput = () => { g.count[n.dataset.n] = Math.max(0, Math.min(50, Math.round(+n.value || 0))); saveGen(); };
}
// 识别报告：先给人看“认出来多少、为什么有没认出来的”，再决定要不要入库
function draftHtml(d) {
  if (!d) return '';
  const cnt = GEN_TYPES.map(([t, n]) => { const k = d.qs.filter(q => q.type === t).length; return k ? `${n} ${k}` : ''; }).filter(Boolean).join(' · ');
  const keep = d.pick.size;
  return `<div class="imp-rep" id="impRep">
        <h4>识别报告</h4>
        <p style="margin:0">识别到 <b>${d.qs.length}</b> 题${cnt ? `（${cnt}）` : ''}${d.rej.length ? `，有 <b>${d.rej.length}</b> 条没认出来` : ''}${d.dup ? `，<b>${d.dup}</b> 题和已有的重复，已自动去掉` : ''}</p>
        ${d.rej.length ? `<details class="rejbox" open><summary>没认出来的 ${d.rej.length} 条：</summary><ul class="rej">${d.rej.slice(0, 10).map(r => `<li>第 ${r.index} 条${r.stem ? `「${esc(r.stem)}」` : ''}：${esc(r.reason)}</li>`).join('')}${d.rej.length > 10 ? `<li>……还有 ${d.rej.length - 10} 条，多半是同一类问题（缺答案、选项不够、题型不支持），按上面的原因改原文再导一次。</li>` : ''}</ul></details>` : ''}
        <div class="line" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn sm" type="button" id="okImport" ${keep ? '' : 'disabled'}>全部添加${keep ? `（${keep}）` : ''}</button>
          <button class="btn sm ghost" type="button" id="dtlBtn">${d.open ? '收起明细' : '看逐条明细'}</button>
          <button class="btn sm ghost" type="button" id="noImport">放弃</button>
        </div>
        ${d.open ? `<div class="hl" style="margin-top:10px">${d.qs.length ? d.qs.map((q, i) => `<label><input type="checkbox" data-pick="${i}" ${d.pick.has(i) ? 'checked' : ''}><span title="${esc(q.stem)}">${esc(q.stem)}</span><small>${typeName(q.type)} · ${q.type === 'short' ? '看参考答案自评' : esc(String(q.answer.join('、')).slice(0, 14))}</small></label>`).join('') : '<p class="muted" style="margin:0">一道都没认出来，换个格式或换份资料再试。</p>'}</div>` : ''}
      </div>`;
}

/* ---------- 给这道题提要求，AI 按它解析（2026-11-08 改方向） ----------
   用户原话两段，第二段把方向拧过来了：
     「手写 json 谁会写？我只会写人话，需要 ai 理解和询问确认」
     「口诀是相当于给 skills 给 ai 解析回答内容的规范约束 也就是点了 ai 解析他会有指定模块
       各自解析 而不是我们写进去 不同 api 回复还不固定呢」
   所以这里存的**不是学生看到的文字**，是一段「给 AI 的要求」：
   老师大白话 → AI 整理成 1～5 条祈使句 → 老师点头存进 q.spec.items →
   以后点「✦ AI 逐项解析」，这几条拼进提示词，内容每次由模型现场生成。
   ── 为什么不存成卡片 ──
   存成卡片就是「我们写进去」：一段死了的文案，换个模型也不会变，还容易过期。
   存成要求，模型每次都按规范重新生成，不同 API 回复不固定也不影响格式。
   ── 为什么只给「我导入的题」提要求 ──
   内置课程题是 data/*.json 里的只读文件，写进去下次刷新就没了；要能改得做覆盖层，
   那是另一件事。这里只动 S.bank（自己导入／自己出的题），存哪儿写哪儿，不骗人。 */
const specHas = q => !!(q && q.spec && (q.spec.items || []).length);
const studyHas = q => !!(q && q.study && (q.study.tip || q.study.lead || (q.study.steps || []).length || (q.study.table || []).length || q.study.warn));
function studyPanel() {
  const list = S.bank || [];
  if (!list.length) return `<div class="panel" id="stPanel"><h3>给这道题提要求</h3>
      <p class="muted" style="margin:0">这条只对<b>你自己导入的题</b>有用。先把题目导进来（上面那块），再回来写。</p></div>`;
  const st = S.study || (S.study = { qid: '', text: '', busy: false, err: '', spec: null, ask: [] });
  // 换过科目、或者选中的题被删掉了：回落到第一题，别让下拉框显示成空的
  if (!st.qid || !list.some(q => q.id === st.qid)) { st.qid = list[0].id; st.spec = null; st.ask = []; st.err = ''; }
  const opts = list.map((q, i) => `<option value="${esc(q.id)}" ${q.id === st.qid ? 'selected' : ''}>第 ${i + 1} 题 · ${esc(String(q.stem || '').slice(0, 24))}${specHas(q) ? '（已有要求）' : studyHas(q) ? '（已有卡）' : ''}</option>`).join('');
  const cur = list.find(q => q.id === st.qid);
  const saved = cur && specHas(cur)
    ? `<div class="st-saved"><b>这道题现在就按这几条讲：</b><ol>${cur.spec.items.map(x => `<li>${esc(x)}</li>`).join('')}</ol><span class="muted">在下面重新说一段再存，会整组换掉。</span></div>`
    : '';
  return `<div class="panel" id="stPanel"><h3>给这道题提要求（AI 按它解析）</h3>
      ${aiReady() ? '' : noAiWarn()}
      <p class="imp-note" style="margin:0 0 12px">不用写 JSON，也不用替 AI 写解析。你只管说「这题该怎么讲」：重点强调什么、别讲什么、用什么说法。<b>AI 把这段话整理成几条要求</b>，你核对完再保存；以后学生点「✦ AI 逐项解析」，AI 就照这几条现场生成 —— 换模型、换服务商都不影响。</p>
      <div class="f">
        <label for="stQ">给哪道题提要求</label>
        <select id="stQ">${opts}</select>
        ${saved}
        <label for="stText">你要 AI 怎么讲这道题</label>
        <textarea id="stText" rows="4" placeholder="例如：这题重点讲写 1 关管子、写 0 才读得进；先看方向寄存器定的是输入还是输出，输出才要写；别讲太多寄存器细节，学生记不住；0 和 1 千万别记反。">${esc(st.text || '')}</textarea>
        <div class="line"><button class="btn" type="button" id="stGo" ${st.busy ? 'disabled' : ''}>${st.busy ? 'AI 正在整理…' : st.spec ? '再整理一次' : '让 AI 整理成要求'}</button><span class="muted" id="stMsg">${esc(st.err || 'AI 会把含糊的地方列出来问你')}</span></div>
      </div>
      <div id="stOut">${studyOut(st)}</div>
    </div>`;
}
// 整理结果：先说「我理解成」→ 再列要求清单 → 最后是没听准的问题 + 两个按钮
function studyOut(st) {
  if (!st || !st.spec) return '';
  const c = st.spec, ask = st.ask || [], items = c.items || [];
  return `<div class="st-out">
      ${c.read ? `<p class="st-read"><b>我理解你的意思是：</b>${esc(c.read)}</p>` : ''}
      ${items.length ? `<div class="st-spec"><b>以后 AI 解析这道题，会照这几条做：</b><ol>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
      ${ask.length ? `<div class="st-ask"><b>这几点我没听准，你看要不要补一句：</b><ul>${ask.map(a => `<li>${esc(a)}</li>`).join('')}</ul><span class="muted">补完再点一次「让 AI 整理」；觉得没问题，直接存也行。</span></div>` : ''}
      ${items.length ? '' : '<p class="muted" style="margin:0">这段话里没整理出具体要求 —— 看一眼上面那几个问题，说具体点再试。</p>'}
      <div class="line" style="margin-top:12px"><button class="btn sm" type="button" id="stSave" ${items.length ? '' : 'disabled'}>就这样，存进这道题</button><button class="btn sm ghost" type="button" id="stDrop">不对，我再说一遍</button></div>
    </div>`;
}
// 只重画「整理结果」这一小块：整页重画会连输入框里的字、光标和滚动位置一起丢掉
function paintStudy() {
  const st = S.study; if (!st) return;
  const out = $('stOut'); if (out) out.innerHTML = studyOut(st);
  const go = $('stGo');
  if (go) { go.disabled = !!st.busy; go.textContent = st.busy ? 'AI 正在整理…' : st.spec ? '再整理一次' : '让 AI 整理成要求'; }
  if ($('stMsg')) $('stMsg').textContent = st.err || 'AI 会把含糊的地方列出来问你';
  bindStudyBtns();
}
function bindStudyBtns() {
  if ($('stSave')) $('stSave').onclick = saveStudyCard;
  if ($('stDrop')) $('stDrop').onclick = () => {
    const st = S.study; if (!st) return;
    st.spec = null; st.ask = []; st.err = ''; paintStudy();
    if ($('stText')) $('stText').focus();
  };
}
async function runStudyCard() {
  const st = S.study, q = (S.bank || []).find(x => x.id === (st && st.qid));
  if (!st || !q) return toast('先在上面选一道题');
  const words = String(st.text || '').trim();
  if (words.length < 4) { if ($('stText')) $('stText').focus(); return toast('先用一句话说说你想让 AI 怎么讲这道题'); }
  if (!aiReady()) return toast(aiState().msg);
  st.busy = true; st.err = ''; st.spec = null; st.ask = [];
  paintStudy();
  try {
    const got = await parseStudySpec(q, words);
    st.spec = got; st.ask = got.ask || [];
  } catch (e) { st.err = '没整理出来：' + (e.message || e); }
  st.busy = false;
  paintStudy();
}
async function saveStudyCard() {
  const st = S.study, c = st && st.spec; if (!c) return;
  const q = (S.bank || []).find(x => x.id === st.qid); if (!q) return toast('这道题已经不在题库里了');
  const items = (c.items || []).map(x => String(x).trim()).filter(Boolean).slice(0, 5);
  if (!items.length) return toast('还没整理出要求，再补一句');
  if ($('stSave')) $('stSave').disabled = true;
  const spec = {
    items,
    // 原话留一份：以后觉得要求不准，能回头看看当时到底是怎么说的
    words: String(st.text || '').trim().slice(0, 400),
    at: Date.now()
  };
  const n = S.bank.indexOf(q) + 1;
  st.spec = null; st.ask = []; st.err = ''; st.text = '';
  await setBank(S.bank.map(x => x.id === q.id ? { ...x, spec } : x));
  toast(`已存进第 ${n} 题，以后点 AI 解析就按这几条讲`);
}

// ---------- 题库：新建科目、导入资料、AI 出题、导出、发布 ----------
function renderBank() {
  const sub = S.subject, base = S.base[sub.id] || [], d = S.draft;
  /* 这套题是不是「我自己名下的」：决定能不能发布/撤销。
     builtin 的本地只读那份、别人发来的 public、别人搬的 builtin，都不是自己的 ——
     点「更新发布」数据库会直接报「这是别的老师发布的题库」，那种按钮不该出现。
     2026-11-08：不能只看 sub.mine。它是服务端 quiz_public_list 返回的 `mine = (owner = auth.uid())`，
     而「云端有这份但列表还没回来 / 老缓存 / 测试桩没这个字段」时它是 undefined ——
     于是开发者自己搬上去的内置题会瞬间失去「更新发布」按钮（_quiz-builtin-cloud.cjs 抓到的就是这条）。
     加一道按 owner_name 的本地兜底：列表里显示的发布者就是我当前显示名，也算我的。
     （owner_name 是发布时写死在库里的，改名后可能对不上，所以它只是兜底，主判据仍是 sub.mine） */
  const myName = hx.name(S.user, S.me);
  const ownIt = sub.kind === 'mine'
    || sub.mine === true
    || (sub.kind !== 'public' && !!sub.cloud && !!myName && sub.owner === myName);
  // 发布时间是「更新发布」，撤销下发单独一个字按钮：撤销只把学生那边的可见性收回来，题库留着，老师自己还能刷
  const pubBtns = isTeacher() && ownIt ? `<button class="btn sm" type="button" id="pubBtn">${sub.published || sub.cloud || sub.kind === 'public' ? '更新发布' : '发布给学生'}</button>${sub.published || sub.cloud ? '<button class="btn sm danger" type="button" id="unpubBtn">取消发布</button>' : ''}` : '';
  /* 来源这一行现在有三种意思，得说清楚，不然用户分不清「题到底在哪」：
     · 云端（builtin + cloud）—— 题存在数据库里，挂在开发者名下，能改能发布；
     · 课程题库 —— 只有本地 data/*.json，改不了（刷新回原样）；
     · 我的科目 / 别人发布 —— 老两类不变。 */
  const srcText = sub.kind === 'builtin'
    ? (sub.cloud ? `课程题库 · 已搬到云端${sub.owner ? `（${esc(sub.owner)}）` : ''}` : '课程题库 · 本地只读')
    : sub.kind === 'public' ? esc(sub.tag) : '我的科目';
  const pubBtns2 = sub.kind === 'builtin' && !sub.cloud && isDev()
    ? '<button class="btn sm" type="button" id="moveBtn">搬到我的账号</button>'
    : pubBtns;
  /* 转发（2026-11-08）：别人发给我的题，我能复制一份到自己名下，再发给我自己的班。
     条件：是老师 + 这套题不是我发的 + 是「发布」类（builtin 云端 / public）。
     我的科目、分享码来的不用转发 —— 那些本来就在我自己名下。 */
  const canFwd = isTeacher()
    && (sub.kind === 'public' ? !sub.mine : (sub.kind === 'builtin' && sub.cloud && !sub.mine))
    && !sub.forwarded;
  const fwdBtn = canFwd ? '<button class="btn sm ghost" type="button" id="fwdBtn">转发给自己</button>' : '';
  // 「这套题是发给我的」提示：老师看到别人发来、还没有自己那份时，说清可以转发
  const sentToMe = canFwd && sub.teacher_ids && sub.teacher_ids.length
    ? '<p class="muted" style="margin:8px 0 0">这套题是发给老师的：你能自己刷。要发给你的学生，点「转发给自己」复制一份，再在那一份里选班级。</p>' : '';
  $('v-bank').innerHTML = `
    <div class="panel"><h3>${esc(sub.name)}</h3>
      <dl class="kv"><dt>来源</dt><dd>${srcText}</dd>${base.length ? `<dt>课程题</dt><dd>${base.length} 题</dd>` : ''}<dt>我导入的</dt><dd>${S.bank.length} 题</dd>${isTeacher() && (sub.published || sub.kind === 'public') && sub.targets ? `<dt>下发范围</dt><dd>${esc(sub.targets)}</dd>` : ''}</dl>
      ${sub.kind === 'builtin' && !sub.cloud ? '<p class="muted" style="margin:8px 0 0">这套题现在是随代码发布的本地文件，改不了。搬到你的账号之后就能在云端改、也能发布给班级。</p>' : ''}
      ${sentToMe}
      <div class="f" style="margin-top:12px"><div class="line"><button class="btn sm ghost" type="button" id="expBtn">导出 JSON</button>${S.questions.length ? '<button class="btn sm ghost" type="button" id="shareBtn">生成分享码</button>' : ''}${S.bank.length ? '<button class="btn sm ghost" type="button" id="clrBtn">清空我导入的</button>' : ''}${sub.kind === 'mine' ? '<button class="btn sm ghost" type="button" id="renBtn">改名</button><button class="btn sm danger" type="button" id="delBtn">删除科目</button>' : sub.kind === 'shared' ? '<button class="btn sm danger" type="button" id="delBtn">移出我的列表</button>' : ''}${fwdBtn}${pubBtns2}</div></div></div>
    <div class="panel"><h3>新建科目</h3><div class="f"><div class="line"><input id="newName" maxlength="30" placeholder="科目名称" style="flex:1"><button class="btn sm" type="button" id="newBtn">新建</button></div></div></div>
    <div class="panel" id="impPanel"><h3>导入资料 · ${esc(sub.name)}</h3>
      ${aiReady() ? '' : noAiWarn()}
      <div class="imp-note">
        <b>两种导入方式</b>
        <ul>
          <li><b>我这份资料里本来就有题目</b> —— 网页会把资料里的文字发给 AI，让它把题干、选项、答案原样抠出来。<b>不会替你编题</b>。</li>
          <li><b>我这份资料是教材／讲义，没有题目</b> —— 网页会让 AI 照着你圈定的范围出题。</li>
        </ul>
        <p class="muted" style="margin:6px 0 0">两种都要用 AI，都要先配好模型（首页「AI 设置」）。扫描件（拍照／图片 PDF）读不出文字——可以拍下来或用截图，直接在下面选图片，让支持看图的模型来读。手上有整理好的 JSON 题库？拖进来就行，纯本地导入，不用 AI、不花钱。</p>
      </div>
      <div class="f" style="margin-top:12px">
        <div class="radio"><label><input type="radio" name="im" value="pick" ${S.imode === 'pick' ? 'checked' : ''}>资料里有现成的题</label><label><input type="radio" name="im" value="gen" ${S.imode === 'gen' ? 'checked' : ''}>根据资料出题（AI）</label></div>
        ${genHtml()}
        <input id="mFile" type="file" multiple accept=".pdf,.docx,.txt,.md,.json,image/*">
        <textarea id="mText" rows="5" placeholder="或者把资料文字粘贴在这里（也可以直接粘贴题库 JSON、粘贴截图）">${esc(S.imText || '')}</textarea>
        <div class="line"><button class="btn" type="button" id="goImport">预览</button><span class="muted" id="imMsg">JSON 题库不用 AI，直接导入；文字／图片资料要先配好 AI 模型</span></div>
        <div class="muted" id="imFiles">${S.pending.length ? `已选 ${S.pending.length} 个文件（点「预览」开始）` : ''}</div>
      </div>
      <details class="imp-tpl"><summary>题库格式说明 · 下载模板</summary>
        <p style="margin:8px 0">一题一条，字段：<code>stem</code> 题干 / <code>type</code> 题型（single 单选、multiple 多选、judgment 判断、fill 填空、short 简答、prog 程序分析）/ <code>options</code> 选项 / <code>answer</code> 答案 / <code>explanation</code> 解析。判断题选项写 T（正确）、F（错误）；填空题在题干里用 <code>____</code> 表示空。程序分析题再多两个字段：<code>code</code> 放代码、<code>sub</code> 放几个小问（数组），参考答案照旧写在 <code>answer</code>。</p>
        <div class="line"><button class="btn sm ghost" type="button" id="tplBtn">下载模板</button><span class="muted">照着填，填好直接拖进来</span></div>
      </details>
      ${draftHtml(d)}
    </div>
    ${studyPanel()}`;
  const on = (id, fn) => { if ($(id)) $(id).onclick = fn; };
  on('expBtn', () => downloadText(sub.name + '.json', JSON.stringify(S.questions, null, 1)));
  on('shareBtn', openShareSheet); // 生成分享码（6 位 + 二维码）
  /* 转发给自己（2026-11-08）：老师收到别人发来的题，复制一份到自己名下。
     复制完默认「只自己刷」，老师再去那一份里选班级发给自己的学生 ——
     这样「老师也能自己刷」和「老师再发给学生」两件事都成立，而且不用原作者的权限。
     题库 id 由服务端生成（f-xxxx），前端不自己编，避免撞车覆盖别人的题库。 */
  on('fwdBtn', e => {
    const nm = sub.name;
    sure(e.currentTarget, `把「${nm}」复制一份到你名下？复制后你能改、能发给你自己的班；原来那份不动。`, async () => {
      try {
        toast('正在复制…');
        const r = await store.forward(sub.pid || sub.id, nm, hx.name(S.user, S.me), []);
        await loadSubjects();
        await openSubject('pub-' + r.id);
        toast(`已复制 ${r.total} 题到你名下（现在只自己刷；选班级就能发给你的学生）`);
      } catch (err) { toast('转发失败：' + (err.message || err)); }
    });
  });
  on('clrBtn', e => sure(e.currentTarget, `确认清空 ${S.bank.length} 题？`, () => setBank([])));
  on('renBtn', async () => { const n = (await hxPrompt('科目新名字', sub.name))?.trim(); if (!n) return; await saveMine(m => m.map(s => s.id === sub.id ? { ...s, name: n.slice(0, 30) } : s)); S.view = 'bank'; await openSubject(sub.id); });
  on('delBtn', e => sure(e.currentTarget, sub.kind === 'shared' ? '确认移出列表？' : '确认删除科目？', async () => {
    if (sub.kind === 'shared') { // 分享来的：只动本机这份清单，不碰对方的码
      await dropShared(sub);
      S.view = 'practice'; await openSubject(BUILTIN[0].id); toast('已移出，这个码还能再加回来');
      return;
    }
    await saveMine(m => m.filter(s => s.id !== sub.id)); await store.remove('bank:' + sub.id); await store.remove('progress:' + sub.id);
    S.view = 'practice'; await openSubject(BUILTIN[0].id); toast('已删除');
  }));
  on('newBtn', async () => {
    const n = $('newName').value.trim(); if (!n) return $('newName').focus();
    const id = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    await saveMine(m => [...m, { id, name: n.slice(0, 30) }]); S.view = 'bank'; await openSubject(id); toast('已新建，接着导入资料');
  });
  // 导入区：两种方式只切“出题要求”的显隐，不整块重画（重画会丢刚粘贴的资料和已选的文件）
  for (const r of document.querySelectorAll('input[name=im]')) r.onchange = () => {
    S.imode = r.value; store.setLocal('importMode', S.imode);
    if ($('gen')) $('gen').hidden = r.value !== 'gen';
  };
  bindGen();
  on('tplBtn', () => {
    downloadText('题库模板.json', JSON.stringify({ 说明: '一题一条；type 可写 single/multiple/judgment/fill/short/prog；判断题选项写 T（正确）、F（错误）；填空题题干用 ____ 表示空；程序分析题把代码写在 code、小问写在 sub、参考答案写在 answer。填好直接拖进导入区即可，不用 AI。', questions: TPL }, null, 2));
    toast('模板已下载，照着填，填完拖进来');
  });
  if ($('mFile')) $('mFile').onchange = () => {
    const files = [...$('mFile').files];
    if (!files.length) return;
    $('imFiles').textContent = `已选 ${files.length} 个文件：${files.map(f => f.name).join('、').slice(0, 60)}`;
  };
  if ($('mText')) {
    $('mText').oninput = e => { S.imText = e.target.value; };
    // 手机和电脑都能直接粘贴截图（老师最常用的一步：截图 → Ctrl+V）
    $('mText').onpaste = e => {
      const items = [...((e.clipboardData || {}).items || [])].filter(i => /^image\//.test(i.type));
      if (!items.length) return;
      e.preventDefault();
      const pics = items.map(i => i.getAsFile()).filter(Boolean);
      if (!pics.length) return;
      S.pending = [...S.pending, ...pics];
      $('imFiles').textContent = `已粘贴 ${S.pending.length} 张截图（点「预览」开始）`;
    };
  }
  if ($('impPanel')) {
    const panel = $('impPanel');
    panel.ondragover = e => { e.preventDefault(); panel.classList.add('drop'); };
    panel.ondragleave = () => panel.classList.remove('drop');
    panel.ondrop = e => {
      e.preventDefault(); panel.classList.remove('drop');
      const files = [...((e.dataTransfer || {}).files || [])];
      if (!files.length) return;
      S.pending = files;
      $('imFiles').textContent = `已选 ${files.length} 个文件：${files.map(f => f.name).join('、').slice(0, 60)}`;
      if (files.every(f => /\.json$/i.test(f.name))) startImport(); // JSON 纯本地解析，直接给报告
    };
  }
  on('goImport', startImport);
  // 给这道题提要求：换题就清掉上一题的整理结果（不然会把给甲的要求存到乙身上）
  if ($('stQ')) $('stQ').onchange = e => {
    const st = S.study; if (!st) return;
    st.qid = e.target.value; st.card = null; st.ask = []; st.err = '';
    paintStudy();
  };
  if ($('stText')) $('stText').oninput = e => { if (S.study) S.study.text = e.target.value; };
  on('stGo', runStudyCard);
  bindStudyBtns();
  on('okImport', confirmImport);
  on('dtlBtn', () => { if (S.draft) { S.draft.open = !S.draft.open; renderBank(); } });
  on('noImport', () => { S.draft = null; renderBank(); });
  // 逐条明细里勾掉不要的题：只改按钮上的数字，不重画整块（重画会跳到面板顶部）
  for (const c of document.querySelectorAll('[data-pick]')) c.onchange = () => {
    if (!S.draft) return;
    const i = +c.dataset.pick;
    c.checked ? S.draft.pick.add(i) : S.draft.pick.delete(i);
    const b = $('okImport'), n = S.draft.pick.size;
    if (b) { b.disabled = !n; b.textContent = '全部添加' + (n ? `（${n}）` : ''); }
  };
  on('pubBtn', () => openPublishSheet(() => { renderBank(); loadSubjects().then(paintSubj); }));
  /* 把内置的那套搬到开发者账号（只有开发者看得到这个按钮）。
     用户原话：「内置的转换成开发者的权限 算我上传的 搬我那里 这个我同意」。
     搬完 quiz_public 里就有一行 id = wiring/mcu/psychology/education、owner = 他自己的记录；
     前端 baseOf 会优先读它，data/*.json 退成没网时的兜底。题目 id 一个不动，
     所以 1896 题的历史排位成绩照样算在这门课头上。 */
  on('moveBtn', e => {
    const n = S.questions.length;
    sure(e.currentTarget, `把「${sub.name}」${n} 题搬到你的账号？搬完能在云端改、也能发布给班级。`, async () => {
      toast(`正在搬 ${n} 题，别关页面…`);
      try {
        await store.publish(sub.id, sub.name, S.questions, hx.name(S.user, S.me), null);
        S.base = {};
        await loadSubjects();
        await openSubject(sub.id);
        toast(`已搬到你的账号：${n} 题，学生现在刷的就是云端这份`);
      } catch (err) { toast('搬失败：' + (err.message || err)); }
    });
  });
  on('unpubBtn', e => sure(e.currentTarget, '确认取消发布？', async () => {
    try {
      await store.unpublish(sub.id);
      if (sub.kind === 'mine') await saveMine(m => m.map(s => s.id === sub.id ? { ...s, published: false } : s));
      else S.subject.published = false;
      S.base = {};            // 云端那份没了，内置科目要退回 data/*.json
      toast('已取消发布');
      await loadSubjects(); await openSubject(sub.id);
    } catch (e) { toast(e.message); }
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
  const sub = S.subject;
  // 文件来源三种：文件框、拖进面板、粘贴截图。拖/粘的放在 S.pending 里
  const files = S.pending.length ? S.pending : [...($('mFile').files || [])];
  S.pending = [];
  const pics = files.filter(f => isImageFile(f.name));
  const docs = files.filter(f => !isImageFile(f.name));
  const pasted = ($('mText').value || '').trim();
  if (!files.length && !pasted) return toast('先选一个文件、粘贴资料，或粘一段题库 JSON');
  const btn = $('goImport'); if (btn) btn.disabled = true;
  if ($('imMsg')) $('imMsg').textContent = '正在读取资料…';
  try {
    let text = pasted, json = null;
    for (const f of docs) {
      const m = await readMaterial(f);
      if (m.json) { json = m.json; continue; } // 一个 JSON 就够，别的文档不再读
      if (m.text) text = text ? text + '\n\n' + m.text : m.text;
    }
    // 粘贴／拖进来的 JSON 题库：纯本地解析，不用 AI、不花钱
    if (!json && /^[[{]/.test(text)) { try { json = JSON.parse(text); text = ''; } catch { /* 不是 JSON，当文字资料 */ } }
    if (json) {
      showReport(normalizeQuestions(json, sub.id));
      if ($('imMsg')) $('imMsg').textContent = '这是本地解析的 JSON：不用 AI，也没花钱。核对没问题就点「全部添加」。';
      return;
    }
    if (!text.trim() && !pics.length) throw new Error('这个文件里没有读到文字。PDF 请确认不是扫描件；扫描件可以拍成图片再选图片导入。');
    const gen = S.imode === 'gen';
    const g = genState();
    // 章节数组 → 提示词里的「范围」一句；没勾任何章节 = 空串，genPrompt 会照旧写「整份资料」
    const opts = { scope: g.scope.length ? g.scope.join('；') : '', level: g.level, extra: (g.extra || '').trim(), types: genTypes() };
    let got = { questions: [], rejected: [] };
    const tick = t => { if ($('imMsg')) $('imMsg').textContent = t; };
    if (text.trim()) {
      got = gen ? await aiGenerate(text, sub.id, sub.name, opts, tick) : await aiImport(text, sub.id, tick);
    }
    if (pics.length) {
      await ensureHxAi(); // 看图走首页那套（HXAI.vision）；boot 时一般已经加载好了
      const images = await readImages(pics);
      const vis = await aiVision(images, { subject: sub.id, subjectName: sub.name, mode: gen ? 'gen' : 'pick', opts, onProgress: tick });
      got = { questions: [...got.questions, ...vis.questions], rejected: [...got.rejected, ...vis.rejected] };
    }
    showReport(got);
  } catch (e) {
    // 中途出错也要把已经拿到的题交出来，别让老师白等一场
    if (e.partialQuestions?.length) {
      showReport({ questions: e.partialQuestions, rejected: e.partialRejected || [] });
      if ($('imMsg')) $('imMsg').textContent = '出错了，下面是出错前已经认出来的部分：' + e.message;
      return;
    }
    if ($('imMsg')) $('imMsg').textContent = e.message; else toast(e.message);
  } finally { if ($('goImport')) $('goImport').disabled = false; }
}
// 识别结果先出报告、再入库：去掉和已有题库重复的题干，把没认出来的原因一起带出来
function showReport(got) {
  const list = Array.isArray(got) ? got : (got.questions || []);
  const rej = (Array.isArray(got) ? [] : got.rejected) || [];
  const have = new Set(S.questions.map(q => norm(q.stem)));
  const qs = []; let dup = 0;
  for (const q of list) {
    const k = norm(q.stem);
    if (!k) continue;
    if (have.has(k)) { dup++; continue; }
    have.add(k); qs.push(q);
  }
  S.draft = { qs, rej, dup, open: false, pick: new Set(qs.map((_, i) => i)) };
  renderBank();
  toast(qs.length ? `识别到 ${qs.length} 题${rej.length ? `，${rej.length} 条没认出来` : ''}` : '一道题都没认出来，看看报告里的原因');
}
async function confirmImport() {
  const d = S.draft; if (!d) return;
  const qs = d.qs.filter((q, i) => d.pick.has(i));
  if (!qs.length) return toast('一道题都没勾，先勾上要留的题');
  const add = qs.map((q, n) => ({ ...q, number: S.bank.length + n + 1 }));
  S.draft = null; await setBank([...S.bank, ...add]); toast(`已导入 ${add.length} 题`);
}

// ---------- 发布：选下发到哪些班 / 哪些老师（2026-11-02 建，2026-11-08 加老师这一维）----------
// 用户要求：「教师账号导入的资料允许专业班级下发和撤销，也可以只自己刷」
// 2026-11-08 又要求：「开发者没有发布给老师账号的功能 发给老师 老师也可以再发给学生 也可以自己刷」
// 四种状态，对应数据库里 target_classes / target_teachers 的组合：
//   全部学生    → classes = null,  teachers = null   （老行为，默认）
//   只自己刷    → classes = [],    teachers = null
//   指定班级    → classes = [id...], teachers = null
//   指定老师    → classes = [],    teachers = [uid...]  ← 学生看不到，老师能看到、能转发
// ※ 「指定老师」必须一起把班级传成空数组：数据库里只发老师却传 classes=null 会直接报错，
//   因为 null 的意思是「全部学生可见」——那就等于发给全校了。
function openPublishSheet(onDone) {
  const sub = S.subject, pid = sub.kind === 'public' ? sub.pid : sub.id;
  const cur = sub.kind === 'public' ? sub.class_ids : undefined;   // 已发布过的题库带回来
  const curT = sub.kind === 'public' ? sub.teacher_ids : undefined;
  const isNew = !sub.published && sub.kind !== 'public';
  // 回填默认值：有老师名单就选「指定老师」，否则按班级三态走
  const mode0 = (curT && curT.length) ? 'tea' : (isNew || cur == null) ? 'all' : cur.length ? 'cls' : 'self';

  openSheet(`<h3>发布 <small class="muted">${S.questions.length} 题</small></h3>
    <p class="muted" style="margin:0 0 12px">发给谁刷？发给学生之后，只有名单里的人能在“科目”里看到这套题。</p>
    <div class="radio" style="flex-direction:column;gap:8px">
      <label><input type="radio" name="tg" value="all" ${mode0 === 'all' ? 'checked' : ''}> 全部学生（所有班都能刷）</label>
      <label><input type="radio" name="tg" value="self" ${mode0 === 'self' ? 'checked' : ''}> 只自己刷（不发给学生，题留在我的科目里）</label>
      <label><input type="radio" name="tg" value="cls" ${mode0 === 'cls' ? 'checked' : ''}> 只发给指定班级</label>
      <label><input type="radio" name="tg" value="tea" ${mode0 === 'tea' ? 'checked' : ''}> 只发给指定老师（学生看不到；老师能自己刷，也能再发给他自己的班）</label>
    </div>
    <div id="clsPick" style="margin-top:12px" hidden>
      <div class="sgroup">我教的班</div>
      <div id="clsList" class="slist"><div class="muted" style="padding:10px">正在读取班级…</div></div>
    </div>
    <div id="teaPick" style="margin-top:12px" hidden>
      <div class="sgroup">老师账号</div>
      <div id="teaL" class="slist"><div class="muted" style="padding:10px">正在读教师名单…</div></div>
      <p class="muted" style="margin:8px 0 0">老师收到后能自己刷，也能点“转发给自己”复制一份，再发给他自己的班。</p>
    </div>
    <div class="line" style="margin-top:14px"><button class="btn" type="button" id="pubGo">确认发布</button><button class="btn sm ghost" type="button" id="pubNo">取消</button></div>`,
  async () => {
    const rad = () => ($('sheetBody').querySelector('input[name=tg]:checked') || {}).value;
    const sync = () => { $('clsPick').hidden = rad() !== 'cls'; $('teaPick').hidden = rad() !== 'tea'; };
    for (const r of $('sheetBody').querySelectorAll('input[name=tg]')) r.onchange = sync;
    sync();

    // 班级 / 教师名单都懒加载：只有选了那一项才去查，不选就不打扰数据库
    let classes = null;
    const loadCls = async () => {
      if (classes) return;
      const r = await store.myClasses();
      // 首页 → 班级 里点亮了「刷题」的班才列出来（和接线仿真 / 考试 / 考勤 / 小组加分同一套 hx_classes.tools）。
      // 两种空要分开说：一个班都没有，vs 有班但都没开刷题 —— 后者是老师忘了点开关，不能提示成「去建班」。
      const all = (r || []).filter(c => c && c.name);
      classes = all.filter(c => (c.tools || []).includes('quiz'));
      const box = $('clsList');
      if (!box) return;
      if (!classes.length) {
        box.innerHTML = all.length
          ? `<div class="muted" style="padding:10px">你有 ${all.length} 个班，但首页「班级」里都还没点亮「刷题」。去首页点一下刷题开关，这些班才会出现在这里。</div>`
          : '<div class="muted" style="padding:10px">你还没有班级。到首页「班级」新建一个、导入名单后再来发布。</div>';
        return;
      }
      const sel = new Set(cur || []);
      box.innerHTML = classes.map(c =>
        `<label class="sitem" style="justify-content:flex-start;gap:10px;cursor:pointer">
           <input type="checkbox" data-cid="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>
           <b style="flex:1">${esc(c.name)}</b>
           <small>${c.bound || 0}/${c.total || 0} 人</small>
         </label>`).join('');
    };
    let teas = null;
    const loadTea = async () => {
      if (teas) return;
      const r = await store.teacherList();
      teas = (r || []).filter(t => t && t.uid);
      const box = $('teaL');
      if (!box) return;
      if (!teas.length) { box.innerHTML = '<div class="muted" style="padding:10px">还没有别的教师账号。让对方用教师邀请码开通后再来发。</div>'; return; }
      const sel = new Set(curT || []);
      box.innerHTML = teas.map(t =>
        `<label class="sitem" style="justify-content:flex-start;gap:10px;cursor:pointer">
           <input type="checkbox" data-tuid="${esc(t.uid)}" ${sel.has(t.uid) ? 'checked' : ''}>
           <b style="flex:1">${esc(t.name || '（没名字）')}</b>
           <small>${t.is_dev ? '开发者' : t.is_admin ? '管理员' : '教师'}</small>
         </label>`).join('');
    };
    if (rad() === 'cls') loadCls();
    if (rad() === 'tea') loadTea();
    for (const r of $('sheetBody').querySelectorAll('input[name=tg]')) {
      const prev = r.onchange;
      r.onchange = () => { prev(); if (rad() === 'cls') loadCls(); if (rad() === 'tea') loadTea(); };
    }

    $('pubNo').onclick = closeSheet;
    $('pubGo').onclick = async () => {
      const mode = rad();
      let classes2, teachers2 = null;
      if (mode === 'all') classes2 = null;
      else if (mode === 'self') classes2 = [];
      else if (mode === 'tea') {
        const picked = [...$('sheetBody').querySelectorAll('input[data-tuid]:checked')].map(x => x.dataset.tuid);
        if (!picked.length) { toast('至少选一位老师'); return; }
        classes2 = [];        // 关键：发给老师时学生一律看不到
        teachers2 = picked;
      } else {
        const picked = [...$('sheetBody').querySelectorAll('input[data-cid]:checked')].map(x => +x.dataset.cid);
        if (!picked.length) { toast('至少选一个班；不想发给学生就选“只自己刷”'); return; }
        classes2 = picked;
      }
      $('pubGo').disabled = true;
      try {
        await store.publish(pid, sub.name, S.questions, hx.name(S.user, S.me), classes2, teachers2);
        if (sub.kind === 'mine') { await saveMine(m => m.map(s => s.id === sub.id ? { ...s, published: true } : s)); S.subject.published = true; }
        // 把新的下发范围写回内存，面板再打开时能回填
        S.subject.class_ids = classes2; S.subject.teacher_ids = teachers2;
        S.subject.targets = mode === 'all' ? '全部学生' : mode === 'self' ? '只自己刷'
          : mode === 'tea' ? teachers2.length + ' 位老师' : classes2.length + ' 个班';
        closeSheet();
        toast(mode === 'self' ? '已保存（只自己刷，学生看不到）'
          : mode === 'all' ? '已发布给全部学生'
          : mode === 'tea' ? `已发给 ${teachers2.length} 位老师（学生看不到；老师能转发给自己的班）`
          : `已发布给 ${classes2.length} 个班`);
        if (onDone) onDone();
      } catch (e) { toast(e.message); }
      finally { if ($('pubGo')) $('pubGo').disabled = false; }
    };
  });
}

// ---------- 题库分享码（2026-11-08）----------
// 用户要求：「用户自己上传的也可以通过分享码（二维码加6位分享码）发给他的朋友去刷题练习」。
// 和「发布给班级」是两条路：发布进 quiz_public、按班下发；分享码只是给码，谁拿到谁能刷。
// 二维码用总入口那份离线生成器（fx/hx-qr.js，window.HXQR），不发请求、不依赖外部服务。
const SHARE_SITE = 'https://zcq19991029.github.io/shuati/';
const shareLink = code => SHARE_SITE + '#join=' + code;
/* 画二维码：HXQR.create 给的是模块矩阵，这里逐格填。PX 是每格像素 —— 8 够手机扫，
   太小（≤5）在低分辨率屏上会糊，太大面板放不下。失败就返回 false，界面自己退成只显示码。 */
function drawQr(cv, text, px) {
  try {
    const ctx = cv.getContext('2d');
    if (!ctx || !window.HXQR) return false;
    const m = HXQR.create(text, { errorCorrectionLevel: 'M' }).modules, N = m.size;
    const PX = px || 8, Q = 4, W = (N + Q * 2) * PX;
    cv.width = W; cv.height = W;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#000';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m.get(r, c)) ctx.fillRect((Q + c) * PX, (Q + r) * PX, PX, PX);
    return true;
  } catch { return false; }
}
function openShareSheet() {
  const sub = S.subject, total = S.questions.length;
  if (!total) return toast('这个科目还没有题，先导入或出题');
  openSheet(`<h3>生成分享码 <small class="muted">${esc(sub.name)} · ${total} 题</small></h3>
    <p class="muted" style="margin:0 0 12px">把码发给朋友，他打开刷题、输入这 6 位码就能刷这套题。<b>不占班级、也不进公共题库</b>，你随时可以撤销。发出去的是一份快照 —— 之后你再改题，要让对方拿到新题，得重新生成一个码。</p>
    <div class="f"><label for="shDays">有效期</label><select id="shDays"><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option></select></div>
    <div class="line" style="margin-top:14px"><button class="btn" type="button" id="shGo">生成分享码</button><button class="btn sm ghost" type="button" id="shNo">取消</button></div>
    <div id="shOut"></div>`, () => {
    $('shNo').onclick = closeSheet;
    $('shGo').onclick = async () => {
      const days = +$('shDays').value || 30;
      $('shGo').disabled = true; $('shGo').textContent = '正在生成…';
      try {
        // 第 4 参是署名：和全站头像/班级列表同一个来源（hx.name），不交给数据库猜
        const code = await store.shareCreate(sub.name, S.questions, days, hx.name(S.user, S.me));
        const link = shareLink(code);
        $('shOut').innerHTML = `<div class="sh-out">
            <div class="sh-code"><b>${esc(code)}</b><span class="muted">6 位分享码</span></div>
            <div class="sh-qr"><canvas id="shQr" width="240" height="240" role="img" aria-label="分享码二维码 ${esc(code)}"></canvas></div>
            <div class="line" style="justify-content:center"><button class="btn sm ghost" type="button" id="shCopy">复制链接</button><button class="btn sm ghost" type="button" id="shDl">保存二维码</button><button class="btn sm danger" type="button" id="shKill">撤销这个码</button></div>
            <code class="alink" id="shLink">${esc(link)}</code>
            <p class="muted" style="margin:8px 0 0">也可以只把 6 位码念给对方：打开刷题 → 左上角科目名 → 输入分享码。</p>
          </div>`;
        if (!drawQr($('shQr'), link, 8)) $('shQr').parentNode.hidden = true; // 生成器没加载出来就只显示码，不摆一个空白框
        $('shCopy').onclick = () => copyText(link);
        $('shDl').onclick = () => {
          try {
            const a = document.createElement('a'); a.download = '华夏工具-分享码-' + code + '.png';
            a.href = $('shQr').toDataURL('image/png'); a.click();
          } catch { toast('保存失败，长按二维码图片试试'); }
        };
        $('shKill').onclick = e => sure(e.currentTarget, '确认撤销？撤销后这个码立刻失效', async () => {
          try { await store.shareDel(code); toast('已撤销，这个码不能用了'); } catch (err) { toast(err.message); }
        });
        $('shGo').textContent = '再生成一个';
      } catch (e) {
        toast('生成失败：' + (e.message || e));
        $('shGo').textContent = '生成分享码';
      } finally { if ($('shGo')) $('shGo').disabled = false; }
    };
  });
}
// 输码加入：把码里那套题存成本机一个科目（kind: 'shared'），题目也缓存下来，下次打开不再拉网
function openJoinSheet(pre) {
  openSheet(`<h3>输入分享码</h3>
    <p class="muted" style="margin:0 0 12px">别人发你的 6 位码，输进来就能把这套题加到「分享给我的」里刷。不用注册成老师、也不用进班。</p>
    <div class="f"><label for="jnCode">分享码</label><input id="jnCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="例如 K7M2QP" value="${esc(pre || '')}" style="text-transform:uppercase;letter-spacing:.22em;font-weight:600"></div>
    <div class="line" style="margin-top:14px"><button class="btn" type="button" id="jnGo">加进来</button><button class="btn sm ghost" type="button" id="jnNo">取消</button></div>`, () => {
    $('jnNo').onclick = closeSheet;
    const go = async () => {
      const code = String($('jnCode').value || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return toast('分享码是 6 位字母或数字');
      $('jnGo').disabled = true; $('jnGo').textContent = '正在取题…';
      try {
        const r = await store.shareGet(code);
        const qs = (r && r.questions) || [];
        if (!qs.length) throw new Error('这个码里没有题');
        const id = 'share-' + code;
        const list = (await store.read('shares', [])).filter(x => x && x.id !== id);
        list.push({ id, code, name: r.name || ('分享 ' + code), owner: r.owner_name || '', total: qs.length, at: Date.now() });
        await store.write('shares', list, { now: true });
        store.setLocal('sharedq:' + code, qs); // 题目存本机，断网也能刷
        S.base[id] = qs;
        await loadSubjects(); await openSubject(id);
        closeSheet();
        toast(`已加入「${r.name || code}」，${qs.length} 题`);
      } catch (e) {
        toast(e.message || String(e));
        $('jnGo').textContent = '加进来';
      } finally { if ($('jnGo')) $('jnGo').disabled = false; }
    };
    $('jnGo').onclick = go;
    $('jnCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    setTimeout(() => $('jnCode') && $('jnCode').focus(), 60);
  });
}
// 删掉一个「分享给我的」科目：本机这份清单去掉，缓存也清掉（码本身还在对方那儿，不影响别人）
async function dropShared(sub) {
  const list = (await store.read('shares', [])).filter(x => x && x.id !== sub.id);
  await store.write('shares', list, { now: true });
  try { localStorage.removeItem('hx-quiz:' + (hx.uid() || 'guest') + ':sharedq:' + sub.code); } catch { /* ignore */ }
  delete S.base[sub.id];
}

// ---------- 设置 ----------
// 复制文本：优先 clipboard API（要 https 或 localhost），不行退回选中 + execCommand
function copyText(t) {
  const done = () => toast('已复制');
  const ta = () => { // 最后兜底：放个隐形输入框选中，让用户自己按 Ctrl+C
    const el = document.createElement('textarea'); el.value = t; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请手动抄下面的链接'); }
    el.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, ta);
  else ta();
}
function renderSettings() {
  /* 2026-11-08（Z5）：「AI 解析」整张卡删掉了 —— Key、服务商、模型统一在首页「AI 设置」配。 */
  $('v-settings').innerHTML = `
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
    <p>想看 AI 逐项讲解：在首页「AI 设置」配一套模型，或装“夜夜题库AI伴侣”浏览器扩展。</p></div>
    <div class="row" style="margin-top:16px"><button class="btn ghost" type="button" id="nGuide" style="flex:1">使用说明</button><button class="btn" type="button" id="nOk" style="flex:1">开始</button></div>`, () => {
    $('nOk').onclick = closeSheet;
    $('nGuide').onclick = () => { closeSheet(); show('settings'); setTimeout(() => $('guide')?.scrollIntoView({ behavior: 'smooth' }), 80); };
  });
  store.setLocal('notice', 1);
}
/* 问 AI 的「模型 / 思考程度」（2026-11-08 Z5 改走首页 HXAI）：
   模型下拉 = 首页「AI 设置」里配好的那几套（不选 = 首页给刷题指定的 / 文本默认）；
   思考程度 = HXAI 的三档 thinkLevel（不选 = 那套配置自己的档位），「深度」按 reason 能力找模型，没配推理就回落文本。
   输出预算照旧（max_tokens）。老存档里的「低 / 中 / 高」自动对到 快速 / 均衡 / 深度。 */
const OLD_LV = { 低: 'quick', 中: 'balanced', 高: 'deep' };
const BUDGET = { quick: 800, balanced: 1400, deep: 2600 };
function askProfile() {
  const id = store.getLocal('askProfile', '');
  return (id && aiProfiles().find(p => p.id === id)) || null;
}
function askOpts() {
  const picked = askProfile(), def = aiState('text').profile;
  const prof = picked || def || null;
  let lv = store.getLocal('askThink', '');
  lv = OLD_LV[lv] || lv;
  if (!BUDGET[lv]) lv = (prof && BUDGET[prof.thinkLevel]) ? prof.thinkLevel : 'balanced';
  const budget = +store.getLocal('askBudget', BUDGET[lv]) || BUDGET[lv];
  return { lv, picked, prof, budget, explicit: !!BUDGET[OLD_LV[store.getLocal('askThink', '')] || store.getLocal('askThink', '')] };
}
const lvName = id => (aiThinkLevels().find(x => x.id === id) || {}).name || id;
const profName = p => p ? (p.name || p.model || '未命名') : '';
const shortModel = m => String(m || '').split('/').pop();

function openAsk() {
  const q = S.view === 'practice' ? cur() : null;
  let withQ = !!q;
  const big = !!store.getLocal('askBig', false); // 上次的窗口大小记着
  const o = askOpts(), profs = aiProfiles(), lvs = aiThinkLevels();
  const draw = () => {
    const box = $('chat'); if (!box) return;
    box.innerHTML = S.chat.length ? S.chat.map(m => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${esc(m.show || m.content)}</div>`).join('') : `<p class="muted">${aiReady() ? '问这道题、知识点，或让 AI 出几道类似的题。</p>' : '</p>' + noAiHint()}`;
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
      <div class="pw"><button class="apill" type="button" id="modelBtn" aria-expanded="false"><b>${esc(shortModel(profName(o.prof)) || '未配模型')}</b>${CARET}</button>
        <div class="pmenu" id="modelMenu"><h4>模型</h4>${profs.length ? `<button type="button" data-prof="" aria-selected="${!o.picked}">首页默认<i>✓</i></button>` + profs.map(p => `<button type="button" data-prof="${esc(p.id)}" aria-selected="${!!o.picked && o.picked.id === p.id}">${esc(profName(p))}${p.model && p.name ? ` · ${esc(shortModel(p.model))}` : ''}<i>✓</i></button>`).join('') : `<p class="muted" style="margin:4px 10px 8px;font-size:12px">${noAiHint()}</p>`}</div></div>
      <div class="pw"><button class="apill" type="button" id="thinkBtn" aria-expanded="false"><b id="thinkLab">思考 · ${esc(lvName(o.lv))}</b>${CARET}</button>
        <div class="pmenu" id="thinkMenu"><h4>思考程度</h4>
          <div class="aseg" id="thinkSeg">${lvs.map(v => `<button type="button" data-lv="${esc(v.id)}" aria-pressed="${v.id === o.lv}">${esc(v.name)}</button>`).join('')}</div>
          <div class="alab"><span>输出预算</span><b id="budVal">${o.budget}</b></div>
          <input type="range" id="budget" min="400" max="2600" step="100" value="${o.budget}" aria-label="输出预算">
          <p class="muted" style="margin:2px 10px 6px;font-size:11.5px;line-height:1.5">均衡／深度会让模型多想一会儿，回答更细但更慢；深度优先用首页设的推理模型。</p>
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
    // 换模型：只影响问 AI，不动首页「AI 设置」里给刷题选的那套
    for (const b of $('modelMenu').querySelectorAll('[data-prof]')) b.onclick = () => {
      store.setLocal('askProfile', b.dataset.prof);
      for (const x of $('modelMenu').querySelectorAll('[data-prof]')) x.setAttribute('aria-selected', String(x === b));
      $('modelBtn').querySelector('b').textContent = shortModel(profName(askOpts().prof)) || '未配模型';
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
      thinkLab.textContent = '思考 · ' + lvName(lv);
      paintBud(BUDGET[lv] || 1400);
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
      if (!aiReady()) { S.askDraft = inp.value; draw(); return toast(aiState().msg); } // 提示 + 去 /ai/ 的链接就在聊天区里
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
        a.content = await streamChat(msgs, t => { a.content = t; draw(); }, {
          profile: oo.picked || undefined, // 下拉里换过就用那套，否则交给 HXAI 按「刷题指定 → 能力默认」挑
          thinkLevel: oo.explicit ? oo.lv : undefined, // 没动过思考程度 = 跟那套配置自己的档位
          cap: oo.lv === 'deep' ? 'reason' : 'text', // 深度优先找推理模型，没配就由 HXAI 回落文本
          maxTokens: oo.budget
        });
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
<h4>AI 解析</h4><ol>
  <li>AI 统一在首页「AI 设置」里配（服务商、Key、模型都在那儿，刷题不再单独填）。</li>
  <li>答完一道题点“✦ AI 逐项解析”；顶上“问 AI”可以引用当前题提问。</li>
  <li>没配时这些位置会提示「还没配置 AI」，点旁边的链接去首页配。</li></ol>
<h4>浏览器扩展：夜夜题库AI伴侣</h4><ol>
  <li>安装：在电脑版 Chrome 或 Edge 里，从 <a href="https://github.com/zcq19991029/chorme-AIkuozhan/releases/latest" target="_blank" rel="noopener">发布页</a> 下载学生安装包（0.7.0 起支持本刷题页）并解压到固定文件夹；打开 <code>chrome://extensions</code>（Edge 是 <code>edge://extensions</code>），打开“开发者模式”，点“加载已解压的扩展程序”，选解压出来的 <code>extension</code> 文件夹。</li>
  <li>设置 AI：点浏览器右上角的扩展图标 →“设置”，填自己的硅基流动 API Key（在 cloud.siliconflow.cn 注册后创建），点“读取模型”选一个对话模型，保存，再点“测试”。</li>
  <li>调用：打开本刷题页，每道题题干后面出现“✦ 学会这题”，点它在右侧打开零基础讲解，可以继续追问。答完再点，讲解会对照标准答案。</li>
  <li>扩展更新后，在扩展页点“重新加载”，再刷新本页。</li></ol>
<p>网页和扩展的 Key 各存各的，互不影响。装了扩展不填网页 Key 也能用扩展讲题；<b>在这里也填一份，题目下就会同时有扩展的“✦ 学会这题”和网页的“✦ AI 逐项解析”</b>，点哪个都行。</p>`;

// ---------- 启动 ----------
// 未登录 / 登录了但没开通：整页挡住。
// 2026-11-08 用户定：「没登录的人不允许使用任何工具」——原来这里写「没登录的照样能刷」，那是 2026-11-01
// 修注册时临时放开的，后来忘了收。现在两道：hx-theme.js 的 gate() 负责跳回总入口（单独打开时），
// 这里负责「已经在工具页里但没资格用」的那一档（嵌在总入口里、或者 hx-theme 没跑起来时兜底）。
function lock(on) {
  let el = document.getElementById('hxLock');
  if (!on) { if (el) el.remove(); return false; }
  if (!el) { el = document.createElement('div'); el.id = 'hxLock'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:var(--card,#f5f5f7);color:var(--ink,#1d1d1f);font-size:16px';
  el.innerHTML = hx.signedIn()
    ? '<b style="font-size:20px">这个账号还没开通</b><a href="https://zcq19991029.github.io/" target="_top" style="padding:10px 22px;border-radius:999px;background:var(--acc,#0a84ff);color:var(--on-acc,#fff);text-decoration:none">填写邀请码开通</a>'
    : '<b style="font-size:20px">先登录才能刷题</b><span style="color:var(--dim,#6e6e73)">没登录的人不能用任何工具</span><a href="https://zcq19991029.github.io/" target="_top" style="padding:10px 22px;border-radius:999px;background:var(--acc,#0a84ff);color:var(--on-acc,#fff);text-decoration:none">去首页登录</a>';
  return true;
}
async function boot() {
  S.user = S.me = null;
  // 未登录：什么工具都不给（2026-11-08 用户定）。放在最前面，免得先把题库拉下来再挡住。
  if (!hx.signedIn()) { if (window.HXLoadFx) HXLoadFx.finishBoot(); lock(true); return; }
  if (hx.signedIn()) { try { [S.user, S.me] = await Promise.all([hx.user(), hx.me()]); } catch { S.user = S.me = null; } }
  if (lock(S.me && !S.me.teacher && !S.me.admin && !S.me.dev && !S.me.student && !S.me.left)) { if (window.HXLoadFx) HXLoadFx.finishBoot(); return; }
  // 首页那套 AI 配置（hx-ai.js → window.HXAI）尽早拿到：题卡、导入区、问 AI 都要判断“配没配模型”。
  // 离线版不加载（没有 AI）；加载失败很快返回，最多等 1.5 秒，不挡首屏。
  await Promise.race([ensureHxAi(), new Promise(r => setTimeout(r, 1500))]);
  const p = prefs();
  S.type = p.type || 'single'; S.scope = p.scope || 'todo'; S.mode = ORDERS.some(o => o[0] === p.mode) ? p.mode : 'seq';
  S.imode = store.getLocal('importMode', 'pick') === 'gen' ? 'gen' : 'pick'; // 上次选的导入方式
  renderNav(); renderWho();
  const pub = String(p.subject || '').startsWith('pub-');
  await loadSubjects(pub);
  await openSubject(p.subject && S.subjects.some(s => s.id === p.subject) ? p.subject : BUILTIN[0].id);
  // 首屏内容已经画好（openSubject 末尾的 show()），撤掉 #hxBoot：整层淡出，
  // 屏幕上不会出现「内容已渲染、像素闪屏才盖上来」的空窗。
  if (window.HXLoadFx) HXLoadFx.finishBoot();
  if (!pub) {
    await loadSubjects(); // 老师发布的题库随后补进科目列表
    // 内置这套刚被认出来「云端有份新的」（搬到开发者名下之后就是这样）：题目要重取一遍，
    // 否则屏幕上还是启动时从 data/*.json 读的那份，改完发布也对不上。
    if (S.subject && S.subject.cloud && !(S.base[S.subject.id] || []).length) await openSubject(S.subject.id);
  }
  store.rankFlush(rankDone); // 上次没交上的答对记录
}
if (store.getLocal('focus', false)) { document.body.classList.add('focus'); tellTop(true); }
if (!store.getLocal('notice', 0)) setTimeout(openNotice, 600);
/* 分享码深链（2026-11-08）：别人扫二维码打开就是 .../shuati/#join=K7M2QP。
   直接把输码面板弹出来、码也填好，少一步手输；处理完把 hash 清掉，
   否则刷新一次又弹一遍。没登录也能走到这里 —— 取码那一步对 anon 开放。 */
{
  const m = /[#&]join=([A-Za-z0-9]{1,12})/.exec(location.hash || '');
  if (m) {
    const code = m[1].toUpperCase();
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// 下可能不让改 */ }
    setTimeout(() => openJoinSheet(code), 900);
  }
}
let was = hx.signedIn();
hx.onChange(() => { const n = hx.signedIn(); if (n !== was) { was = n; store.flush(); S.base = {}; boot(); } }); // 在总入口或别的工具登录、退出
{ // 扩展在页面加载完后才挂上，挂上（或停用后刷新）时重画用到它的地方
  let ext = hasExt();
  new MutationObserver(() => { if (hasExt() === ext) return; ext = !ext; if (!S.subject) return; if (S.view === 'settings') renderSettings(); if (S.view === 'practice') renderCard(); }).observe(document.documentElement, { childList: true });
}
addEventListener('pagehide', () => { if (S.subject) store.write('progress:' + S.subject.id, S.records, { now: true }); });
boot();
