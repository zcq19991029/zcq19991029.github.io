/* ============================================================================
   刷题 · 课堂任务大屏（2026-11-24 重写：整块照搬 接线仿真/src/task-board.js）
   ----------------------------------------------------------------------------
   用户原话：「照搬仿真接线那边投屏ui和逻辑 你不要凭空造」。
   所以这个文件不是「照它改的」，是**从 接线仿真/src/task-board.js 复制过来**，
   只换掉数据层（RPC 名字、字段名）和一两处文案，下面这些一个字符都没动：
     · 尺寸求解：pendSize / pendCol / pendPlan / fitPending / doneLayout / availW /
       setMetrics / PEND_KW_OF / DC_KW_OF / PFS_TIERS / DCS_TIERS / MAIN_W / LIST_H …
     · 15 秒轮询（±20% 抖动）、第一屏播入场之后关动画（body.no-anim）、
       新完成的人闪一下（.fresh）、进度环「长一截」的双 rAF 驱动、通报条 8 秒后自摘。
   版式也照搬（见 task.css 里那段逐字复制的大屏样式）：
     主体 = 「还没完成的同学」大身份卡阵列；右上 = 完成率环 + 已完成人数；
     右侧 = 已完成的金色小身份卡（奖牌 / 姓名 / 准确率·用时 / 得分徽标）。

   与接线仿真的差异（每一处都是因为刷题没有那个东西，不是为了好看而改）：
     1) 数据源：接线仿真用 wire_task_board 一次返回 {task, pending, done_rows, done, total, pct}；
        刷题用 hx_quiz_task_board 返回一张全班名单。这里加 fetchBoard() 折成同一个形状，
        好让下面 paint 一行都不用改。
     2) 身份卡背景：接线仿真的卡片背后是「这道电路的历史接线照片」（hx_rank_bgs）；
        刷题没有这道概念，所以 bgStyleOf() 恒返回 ''，卡片走 CSS 里那张默认卡面。
     3) 竞争通报：接线仿真按「完成率档位」变化播报；刷题的成绩只升不降，完成率不会掉，
        所以改播**名次**变化（.mv up / .mv down 的样式和位置完全一样）。
   ========================================================================== */
import { hx, esc, fmtSec, fmtScore, every, taskBoard, taskList } from './task-hx.js';

const B = {
  taskId: null,    // ?t= 指定；为空时自动挑
  task: null,
  classId: null,
  className: '',
  board: null,
  stop: null,
  seen: new Set(), // 已经见过的完成者（学生 id）：用来判断谁是「刚完成」
  fresh: new Set(),// 本轮要高亮的
  timer: null,
  lastAt: '',
  /* 名次变化（照接线仿真的完成率变化那套）：
     「课堂任务实时计分 被别人超了就会变 这是很正常的竞争学习 我们鼓励动态变化 当场就学习刷题反超」
     刷题的成绩只升不降，所以「被超」只体现在**名次**上：别人刷得更好，你的名次就往后掉。
     这不是 bug，是竞争机制，所以大屏要主动说出来：谁被超了、谁反超了。 */
  placePrev: {},   // student_id → 上一轮名次
  moves: [],       // [{sid,name,from,to,up}]
  /* 上一轮画出来的完成率：Apple 环「长一截」的起点。
     没有它就只能在 0 → N 之间长，换人完成那种 55% → 64% 的小跳会看不出来。 */
  pctPrev: null,
};
const $ = s => document.querySelector(s);
const root = $('#bdRoot');

/* 极简模式（hx-lite）：进度环流光只在标准模式下播，极简时静态显示。
   判定和 theme.js / parallel.js 同一套：html 上挂 hx-lite class，或 localStorage hx-lite === '1'。
   模式可能在总入口里随时切，这里顺带监听 hx-lite-change / storage 事件兜底。 */
const isLite = () => {
  try {
    if (document.documentElement.classList.contains('hx-lite')) return true;
    return localStorage.getItem('hx-lite') === '1';
  } catch (e) { return false; }
};
const applyLite = () => document.body.classList.toggle('lite', isLite());
applyLite();
addEventListener('hx-lite-change', applyLite);
addEventListener('storage', e => { if (e && e.key === 'hx-lite') applyLite(); });

/* 身份卡背景：接线仿真的 .pend-bg / .dc-bg 铺的是「这道电路的历史接线照片」（hx_rank_bgs）。
   刷题的课堂任务没有这道概念，所以恒返回 ''，卡片走 task.css 里那张默认卡面
   （data-nobg="1" 那条：斜向暗红→深蓝 + 左上暖光，看着就是一张「没设过背景」的默认卡）。
   DOM 结构和 CSS 一个都没改 —— 哪天刷题也要背景图，把这段换回去就行。 */
function bgStyleOf() { return ''; }

/* ── 左栏（未完成）尺寸档位：和排位/任务页同一套「人多就小」，最大 34vmin 上限不变。
   抽成函数让 paint 和 doneLayout 共用同一份档位，别在两处各写一遍慢慢跑偏。 */
function pendSize(n) { return n <= 12 ? 5.2 : n <= 20 ? 4.4 : n <= 32 ? 3.8 : n <= 48 ? 3.2 : 2.7; }
function pendCol(n) { return n <= 12 ? 34 : n <= 20 ? 28 : n <= 32 ? 24 : n <= 48 ? 20 : 17; }

/* ── 姓名永远不许被压缩（2026-11-16 用户紧急要求）────────────────────────────
   用户原话：「课堂任务投屏名字要始终无压缩 不能显示不全 卡片是自适应可以缩小的 现在就是卡片太大
   右边完成太多了 就压缩位置导致名字显示不全」。
   病根两条：
     ① .pend-grid 的列宽下限是写死的 20vmin（`minmax(20vmin,1fr)`），跟 --pfs 字号脱钩 ——
        人少时字号 5.2vmin（约 56px）却只给 216px 的卡，名字必然被省略号吃掉；
     ② doneLayout 里 pMinW 按 pendCol() 算（34vmin），CSS 却不认这个数，于是「右栏以为左栏只要 34，
        实际上左栏被压到 20」—— 右栏越挤越多，左栏越压越扁，全挤在名字上。
   这一版把「一列至少多宽」变成字号和真实名字长度的函数，并且 JS 算出来的数 CSS 一定照做：
     · PEND_KW / DC_KW 由**最长那个名字**算出来（--pk / --dk 写进 :root，CSS 的 minmax 读它）；
     · 左栏按 PFS_TIERS 从大到小试，必须在给右栏留下 DONE_MIN 的前提下塞得下；
       试不到就整体降一档字号（卡跟着变窄），**绝不靠省略号**。
   一句话：宁可卡片变小，也不让名字缺一个字。 */
const MAIN_W = 172, LIST_H = 66, MARGIN = 3.2, PGAP = 1.1, DONE_MIN = 30;
/* .bd-main 的左右内边距 2.4×2 + 两栏间距 1.6（vmin）—— 算真实可用宽度时要一起扣掉 */
const PAD_X = 4.8, MGAP = 1.6;
/* 真实可用宽度（vmin）。MAIN_W=172 是照 1920×1080 拍的；1440×900 上 100vmin 只有 900px，
   172vmin 已经是 1548px > 屏宽 → 那个常数在非 1080p 投影上是虚的，多算一列就会把左栏挤扁。
   所以每次画之前按 #bdRoot 的实测宽度换算一遍，宁可少一列也不能压名字。 */
function availW() {
  const vminPx = Math.min(innerWidth, innerHeight) / 100 || 1;
  const w = root.clientWidth || innerWidth;
  return Math.max(60, w / vminPx - PAD_X - MGAP);
}
/* 卡宽的构成（单位 = 字号倍数）：
   左栏 头像 1.3 + 间隙 .42 + 名字 N 字 × .95 + 内边距 .88 + 余量 .35
   右栏 内边距 .8 + 奖牌 1.4 + 两处间隙 .68 + 完成率徽标 2.1 + 名字 N 字 × .82 + 余量 .3 */
const PEND_KW_OF = len => +(2.6 + len * 0.95 + 0.35).toFixed(2);
const DC_KW_OF = len => +(5.0 + len * 0.82 + 0.3).toFixed(2);
const longestName = rows => (rows || []).reduce((m, r) => Math.max(m, String((r && (r.name || r.no)) || '').length), 0);
let PEND_KW = 6.5, DC_KW = 7.5;   // 每次 paint 前按真实名单重算（见 setMetrics）
const PFS_TIERS = [5.2, 4.6, 4.1, 3.7, 3.4, 3.1, 2.8, 2.5];

/* 左栏求解：返回 {pfs, col, pMinW}。从「人多就小」那一档起，先保证右栏还有 DONE_MIN 可用。 */
function pendPlan(pN, avail) {
  const budget = avail || (MAIN_W - DONE_MIN - MARGIN);   // 左栏最多能占多宽（vmin）
  const start = pendSize(pN);
  let i = Math.max(0, PFS_TIERS.findIndex(v => v <= start + 1e-9));
  let last = null;
  for (; i < PFS_TIERS.length; i++) {
    const pfs = PFS_TIERS[i], col = pfs * PEND_KW;
    const rows = Math.max(1, Math.floor(LIST_H / (pfs * 2.55 + PGAP)));
    const cols = Math.max(1, Math.ceil(pN / rows));
    const w = cols * col + (cols - 1) * PGAP;
    last = { pfs, col, pMinW: w };
    if (w <= budget) return last;
  }
  return last; // 全班挤满：最后一档是什么就用什么（字已经最小了，再压就真看不清）
}
/* ── 第二遍：量真实容器，定列数，必要时降字号（2026-11-16）────────────────────
   为什么非要量不可：左栏实际宽度 = 总宽 − 右栏宽度，而右栏宽度又取决于「右栏想放几张卡」，
   两边互相牵制。纯算容易差一列，差一列的后果就是「多一行」→ 上下各裁半个卡（实测截到过）。
   所以：先按算出来的样子画出来，再量一次 .pend-grid 的 clientWidth/Height，
   取「能塞下的最大整数列」，列宽用 1fr 均分 —— 卡只会比名字需要的宽一丁点，不会被拉成太空卡，
   也不会因为列数算多而未行溢出。行数还放不下就整体降一档字号（卡跟着变小），**绝不用省略号**。 */
function fitPending() {
  const grid = root.querySelector('.pend-grid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.pend');
  const n = cards.length;
  if (!n) return;
  const W = grid.clientWidth, H = grid.clientHeight;
  if (!W || !H) return;
  const cs = getComputedStyle(grid);
  const gc = parseFloat(cs.columnGap) || 0, gr = parseFloat(cs.rowGap) || gc;
  const vminPx = Math.min(innerWidth, innerHeight) / 100 || 1;
  const cardH = cards[0].getBoundingClientRect().height || (0);
  const pfsNow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pfs')) || 3.8;
  let i = Math.max(0, PFS_TIERS.indexOf(pfsNow));
  if (i < 0) i = 0;
  for (; i < PFS_TIERS.length; i++) {
    const pfs = PFS_TIERS[i];
    const minW = pfs * PEND_KW * vminPx;
    const cols = Math.max(1, Math.floor((W + gc) / (minW + gc)));
    const rows = Math.ceil(n / cols);
    // 行高按当前实测值等比例换算到候选字号（没量到就退回设计值 2.55 倍字号）
    const rowH = (cardH ? cardH * (pfs / pfsNow) : pfs * 2.55 * vminPx) + gr;
    const fits = rows * rowH <= H + 1;
    if (fits || i === PFS_TIERS.length - 1) {
      document.documentElement.style.setProperty('--pfs', pfs + 'vmin');
      /* 列宽 = min(均分宽度, 卡宽上限 1.15×最小宽)。
         为什么要封顶：早先这里写的是 minmax(0,1fr)，一个人未完成时那一列会被拉成整屏宽的一条，
         看着就是用户嫌的「卡片太大」。封顶后卡只比名字宽一小圈，剩下的留白由 justify-content 居中吃掉。 */
      const share = (W - gc * (cols - 1)) / cols;
      const cw = Math.max(1, Math.min(share, minW * 1.15));
      grid.style.gridTemplateColumns = `repeat(${cols}, ${cw.toFixed(1)}px)`;
      return;
    }
  }
}

/* 每次渲染前按名单长度定卡宽，并写进 :root 给 CSS 的 minmax / grid 模板读 */
function setMetrics(pend, done) {
  PEND_KW = PEND_KW_OF(Math.max(2, longestName(pend)));
  DC_KW = DC_KW_OF(Math.max(2, longestName(done)));
  const r = document.documentElement.style;
  r.setProperty('--pk', PEND_KW);
  r.setProperty('--dk', DC_KW);
}

/* ── 右栏（已完成）排位身份卡求解器（2026-11-13 排位改版）─────────────────────
   目标：所有已完成的人一屏放下、不翻页、不滚动；左栏人少时右栏自动向左扩。
   思路：
     1) 左栏按 --pfs/col 那套算「它至少要占多宽才不溢出」→ pMinW；
     2) 剩余宽度（MAIN_W - pMinW - 边距）= 右栏宽度预算 dW；
     3) 在 --dcs 档位里从大到小挑第一档：该档下「列数 × 卡宽」能塞进 dW。
   卡片尺寸全部是 --dcs 的倍数（卡宽 DC_KW、卡高 DC_KH、间距 DC_KG），
   列数由「能塞几行」反推：人多自动缩字号/缩卡宽、人少自动放大；
   左栏人越少 → dW 越大 → 档位越大 → 右栏越向左扩、卡越大。 */
const DC_KH = 1.9, DC_KG = 0.5;   // DC_KW 现在是变量（按名字长度算，见 setMetrics）
function doneLayout(pN, dN, mainW) {
  const MW = mainW || MAIN_W;   // 真实可用宽度（vmin）：1440×900 屏上 172 是虚的，实测只有 ~141，差一列就会把左栏挤扁
  const DCS_TIERS = [3.0, 2.7, 2.4, 2.2, 2.0, 1.85, 1.7, 1.55, 1.4, 1.3];
  // 1) 左栏最小宽度：和 CSS 的 .pend-grid 用同一份 pendulum 求解（pendPlan），口径必须一致，
  //    否则又会出现「右栏以为左栏只要 34vmin、实际 CSS 压到 20vmin」这种把名字挤没的老毛病。
  let pMinW = 0, pfsOut = null;
  if (pN > 0) {
    const P = pendPlan(pN, MW - DONE_MIN - MARGIN);
    pMinW = P.pMinW; pfsOut = P.pfs;
  } else {
    // 全部完成：给「全部完成 ✔」留一小条，别把左栏挤成一条缝（2026-11-13）
    pMinW = 20;
  }
  const dW = Math.max(8, MW - pMinW - MARGIN);
  // 2) 从大到小挑第一档塞得下的 --dcs
  let best = null;
  for (const dcs of DCS_TIERS) {
    const rows = Math.max(1, Math.floor(LIST_H / (dcs * (DC_KH + DC_KG))));
    const cols = Math.max(1, Math.ceil(dN / rows));
    const w = dcs * (cols * DC_KW + (cols - 1) * DC_KG);
    if (w <= dW) { best = { dcs: dcs, cols: cols }; break; }
  }
  if (!best) { // 兜底：最小档（极小班绝不超）
    const dcs = DCS_TIERS[DCS_TIERS.length - 1];
    const rows = Math.max(1, Math.floor(LIST_H / (dcs * (DC_KH + DC_KG))));
    best = { dcs: dcs, cols: Math.max(1, Math.ceil(dN / rows)) };
  }
  // 3) 用实际列数反算右栏宽度，直接写进 inline width，跟 CSS 网格宽度严格一致
  best.w = best.dcs * (best.cols * DC_KW + (best.cols - 1) * DC_KG);
  best.pfs = pfsOut;   // 左栏最终用的字号档（和 pendPlan 同源，paint 直接写 --pfs）
  best.pMinW = pMinW;
  return best;
}

/* 数据形状适配：接线仿真的 wire_task_board 一次就给 {task, pending, done_rows, done, total, pct}；
   刷题的 hx_quiz_task_board 返回一张全班名单（done=true/false 混在一起）。
   折成同一个形状，好让下面搬过来的 paint 一行都不用改。 */
async function fetchBoard() {
  const rows = (await taskBoard(B.taskId, B.classId)) || [];
  const done = rows.filter(r => r.done);
  const total = rows.length;
  const t = Object.assign({}, B.task || {});
  if (t.deleted) t.status = 'void';   // 大屏只认 open / closed / void 三种印章
  return {
    task: t,
    pending: rows.filter(r => !r.done).map(r => ({ student_id: r.student_id, name: r.name, no: r.student_no })),
    done_rows: done.map(r => ({
      student_id: r.student_id, name: r.name, no: r.student_no,
      place: r.place, rate: r.rate, score: r.score, sec: r.seconds, tries: r.tries,
    })),
    done: done.length,
    total: total,
    pct: total ? Math.round(done.length * 100 / total) : 0,
  };
}

/* 得分徽标档位：接线仿真按「前十名 = 完成率 100% = 金」上色，
   刷题第十名之后是 80%/70% 档，所以直接按名次判，视觉语言完全一样。 */
const scoreTier = place => place == null ? 'r-none' : place <= 10 ? 'r100' : place <= 20 ? 'r80' : 'r70';

(async function boot() {
  if (!hx.signedIn()) return gate('先登录', '用教师账号登录后，这一页才能看到本班任务。', true);

  // 有 ?t= 就直接用；没有就从自己的任务里挑一个（优先进行中）
  const q = new URLSearchParams(location.search);
  B.taskId = +(q.get('t') || 0) || null;
  try {
    const me = await hx.me();
    if (!me || !(me.teacher || me.admin || me.dev)) {
      return gate('只有教师能打开大屏', '学生请回到「课堂任务」看自己的任务和成绩。', false);
    }
    const list = (await taskList()) || [];
    if (!B.taskId) {
      const pick = list.find(t => t.status === 'open' && !t.deleted) || list.find(t => !t.deleted);
      if (!pick) return gate('还没有课堂任务', '先在任务页发布一个，再打开大屏。', false);
      B.taskId = Number(pick.id);
    }
    B.task = list.find(t => Number(t.id) === Number(B.taskId)) || null;
    if (!B.task) return gate('任务不存在或没有权限', '可能是这个任务被删了，或者不是你这个班的。', false);
    B.classId = Number(B.task.class_id) || null;
    try {
      const cs = (await hx.rpc('hx_my_classes')) || [];
      B.className = (cs.find(c => Number(c.id) === B.classId) || {}).name || ('班级 #' + B.classId);
    } catch (e) { B.className = '班级 #' + B.classId; }
  } catch (e) { return gate('读取任务失败', e.message, true); }

  await load(true);
  // 15 秒一轮（照接线仿真：轮询统一 15 秒，别让一体机一直发请求）
  // 第三个参数 = ±20% 抖动（12~18 秒）：多台大屏/老师笔记本同开时不会永远同相位一起到期
  B.stop = every(15000, () => load(false), 0.2);
})();

function gate(title, msg, login) {
  root.innerHTML = `<div class="bd-gate"><div>
    <b>${esc(title)}</b><p>${esc(msg)}</p>
    ${login ? '<button class="qt-btn primary" id="bdLogin" type="button">去登录</button>' : ''}
  </div></div>`;
  const b = $('#bdLogin'); if (b) b.onclick = () => { location.href = 'index.html'; };
}

async function load(first) {
  let b;
  /* 首屏那次走一次直接报错给页面（投影已经架好了，不能因为服务器一忙就退回大白屏）；
     后面 12~18 秒的轮询失败不打断画面 —— 跳过一轮下一轮再来更省，也不会把请求叠起来。 */
  try { b = await fetchBoard(); }
  catch (e) {
    if (first) return gate('读取排行榜失败', e.message, true);
    return;
  }
  // 新完成的人：上一轮没见过 → 这一轮加高亮
  const nowIds = new Set((b.done_rows || []).map(r => r.student_id));
  B.fresh = new Set();
  if (!first) nowIds.forEach(id => { if (!B.seen.has(id)) B.fresh.add(id); });
  B.seen = nowIds;
  /* 名次有没有变：后来的人刷得更好 → 前面的人名次往后掉。
     用户明确说这是要鼓励的「竞争学习」，所以这里算出来让大屏当场播报（见 paint 的 bd-moves）。 */
  const placeNow = {};
  (b.done_rows || []).forEach(r => { if (r.place != null) placeNow[r.student_id] = Number(r.place); });
  B.moves = [];
  if (!first) {
    (b.done_rows || []).forEach(r => {
      const sid = r.student_id, was = B.placePrev[sid], now = placeNow[sid];
      if (was == null || now == null || was === now) return;
      B.moves.push({ sid: sid, name: r.name || '', from: was, to: now, up: now < was });
    });
  }
  B.placePrev = placeNow;

  const changed = JSON.stringify(b) !== JSON.stringify(B.board);
  B.board = b;
  if (changed || first) paint(b);
  // 任务结束/作废：停轮询 + 加印章（这里只停一次，避免每轮重复判断）
  if (b.task.status !== 'open' && B.stop) { B.stop(); B.stop = null; }
  const d = new Date(), p = n => String(n).padStart(2, '0');
  B.lastAt = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  const lv = $('#bdLast'); if (lv) lv.textContent = B.lastAt;
}

function paint(b) {
  const t = b.task, pend = b.pending || [], done = b.done_rows || [];
  const pct = Math.max(0, Math.min(100, +b.pct || 0));
  // 人数越多字越小、卡片越窄：保证任何班（20～60 人）都能一屏放下，不出现滚动条；
  // 人少时卡片放大，把整块屏幕铺满（空一大片反而显得没在「督促」）
  const n = pend.length;
  // 卡宽先按「这一屏真实的最长名字」定下来（--pk / --dk），再解两侧的尺寸 —— 顺序不能反，
  // 否则 CSS 还是拿上一帧的卡宽算 minmax，名字又会被压。
  setMetrics(pend, done);
  // 右栏排位身份卡：人数越多字越小、卡越窄；左栏人少时右栏自动向左扩（宽度/列数由求解器给）。
  // 传真实可用宽度进去（见 availW）：1920×1080 之外的分辨率上 MAIN_W 是虚的，不传就会多算一列。
  const L = doneLayout(n, done.length, availW());
  const fs = L.pfs || pendSize(n);
  document.documentElement.style.setProperty('--pfs', fs + 'vmin');
  document.documentElement.style.setProperty('--dcs', L.dcs + 'vmin');
  // 是否第一屏：第一屏播入场动画，之后重绘只保留「新完成那一个」的高亮（见 task.css 的 body.no-anim）
  const firstPaint = !B.painted;
  B.painted = true;
  // 排完版再量一次真实宽度，见 fitPending 的注释（必须在 root.innerHTML 之后）
  setTimeout(() => fitPending(), 0);
  /* 进度环（2026-11-13 重构成 Apple 健身环）：
     r=42、环宽 13 → 周长 = 2πr ≈ 263.89；外沿 48.5 不出 100 的 viewBox，内径 35.5 留给百分比。
     渐变写在下面 <defs> 里：r=42 用 CSS 的 stroke: url(#ringGrad) 喂给 .val，
     SVG 没有原生 conic 渐变，这里用「青绿 → 亮绿 → 薄荷」的四段 linearGradient 近似（不彩虹）。 */
  const C = 2 * Math.PI * 42;
  const offAt = p => (C * (1 - p / 100)).toFixed(1);
  // 本轮从上一轮的值起跑：首次进来直接落在目标值，之后每轮长一截（.7s，缓动在 CSS 里）
  const pctFrom = B.pctPrev == null ? pct : B.pctPrev;

  root.innerHTML = `
  <header class="bd-top">
    <button class="bd-back" id="bdBack" type="button" title="返回课堂任务">← 课堂任务</button>
    <div class="bd-title">
      <small>${esc(B.className)} · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''}</small>
      <b>${esc(t.title || '课堂任务')}</b>
      <div class="sub">${esc(t.bank_name || '')}${t.asked ? ' · ' + t.asked + ' 题' : ''}${t.full != null ? ' · 满分 ' + fmtScore(t.full) + ' 分' : ''}</div>
    </div>
    ${t.status !== 'open' ? `<div style="flex:none;display:flex;flex-direction:column;align-items:center;gap:.6vmin">
      <div class="bd-stamp ${t.status}">${t.status === 'void' ? '已删除' : '已结束'}</div>
      ${t.status === 'closed' ? `<small style="font-size:1.35vmin;color:var(--dim);white-space:nowrap">${
        t.lesson_no ? '分数已按名次写入「小组加分」第 ' + t.lesson_no + ' 次课' : '本任务未填课次，分数不会入账'}</small>` : ''}
    </div>` : ''}
    <div class="bd-stat">
      <div class="ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="ringGrad" x1=".1" y1=".92" x2=".86" y2=".12">
              <stop offset="0" stop-color="#0fae9e"/>
              <stop offset=".4" stop-color="#19c98a"/>
              <stop offset=".75" stop-color="#34d399"/>
              <stop offset="1" stop-color="#a7f3d0"/>
            </linearGradient>
            <linearGradient id="ringGradHi" x1=".1" y1=".92" x2=".86" y2=".12">
              <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
              <stop offset=".55" stop-color="#ffffff" stop-opacity=".5"/>
              <stop offset="1" stop-color="#ffffff" stop-opacity=".85"/>
            </linearGradient>
          </defs>
          <circle class="trk" cx="50" cy="50" r="42" fill="none"/>
          <circle class="trk-in" cx="50" cy="50" r="42" fill="none"/>
          <circle class="val" cx="50" cy="50" r="42" fill="none"
                  stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offAt(pctFrom)}"/>
          <circle class="val-hi" cx="50" cy="50" r="42" fill="none"
                  stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offAt(pctFrom)}"/>
          <g class="capg" style="transform:rotate(${(pctFrom * 3.6).toFixed(1)}deg);opacity:${pctFrom > 0 ? 1 : 0}">
            <circle class="cap-halo" cx="92" cy="50" r="5.2"/>
            <circle class="cap" cx="92" cy="50" r="2.7"/>
          </g>
        </svg>
        <div class="txt"><b>${pct}%</b><em>完成率</em></div>
      </div>
      <div class="bd-count"><b>${b.done}<small> / ${b.total}</small></b><em>已完成</em></div>
    </div>
  </header>

  <main class="bd-main">
    <section class="bd-pending">
      <h2>还没完成的同学 <em>${pend.length}</em> 人</h2>
      <div class="pend-grid" style="align-content:${n <= 32 ? 'center' : 'start'}">
        ${pend.length ? pend.map(p => {
            const st = bgStyleOf(p.student_id);
            return `<div class="pend" data-nobg="${st ? '0' : '1'}">
            <span class="pend-bg" aria-hidden="true"${st ? ` style="${esc(st)}"` : ''}></span>
            <span class="pend-veil" aria-hidden="true"></span>
            <i>${esc((p.name || p.no || '?').trim().slice(0, 1))}</i>
            <div class="nm"><b>${esc(p.name || p.no)}</b><span>${esc(p.no)}</span></div>
          </div>`;
          }).join('')
        : '<div class="pend-empty">全部完成 ✔<small>这一节课没有人掉队</small></div>'}
      </div>
    </section>

    <aside class="bd-done">
      <h3>已完成 <em>${done.length}</em> 人</h3>
      <div class="done-list" style="grid-template-columns:repeat(${L.cols}, calc(var(--dcs) * ${DC_KW}));width:${L.w.toFixed(2)}vmin">
        ${done.map((r, i) => {
            const st = bgStyleOf(r.student_id);
            const place = r.place || (i + 1);
            const medal = place <= 3 ? ' m' + place : '';
            return `<div class="dc${medal}${B.fresh.has(r.student_id) ? ' fresh' : ''}" data-sid="${r.student_id}" data-nobg="${st ? '0' : '1'}">
            <span class="dc-bg" aria-hidden="true"${st ? ` style="${esc(st)}"` : ''}></span>
            <span class="dc-veil" aria-hidden="true"></span>
            <span class="dc-medal"><b>${place}</b></span>
            <div class="dc-who">
              <b class="dc-name">${esc(r.name || r.no)}</b>
              <span class="dc-sub">${r.sec != null ? fmtSec(r.sec) : ''}</span>
            </div>
            <b class="dc-rate ${scoreTier(r.place)}">${r.score == null ? '—' : fmtScore(r.score)}</b>
          </div>`;
          }).join('')}
      </div>
    </aside>
  </main>

  ${B.moves.length ? `<div class="bd-moves">${movesHTML()}</div>` : ''}

  <footer class="bd-foot">
    <span class="dot"></span><span>每 15 秒左右刷新 · 最后更新 <b id="bdLast">${B.lastAt || '—'}</b></span>
    <span class="grow"></span>
    <span>按准确率排名 · 同分看用时（短的在前面）</span>
    <span>练几次都算数，只升不降 · 得分 = 满分 × 准确率</span>
  </footer>
`;

  /* 环「长一截」的驱动：新节点插入时还停在上一轮的 dashoffset，下一帧（双 rAF，保证中间真的画过一帧
     浏览器才会认为「值变了」）再改成本轮的值 —— 这样 CSS 的 .7s 过渡才会真的跑起来。
     直接一次写成本轮值就没有起始值可比，会变成硬跳（上一版就是这样，换人完成时环是闪一下不是长一截）。 */
  const ringVals = root.querySelectorAll('.ring .val, .ring .val-hi');
  const ringCap = root.querySelector('.ring .capg');
  if (pctFrom !== pct) {
    const toOff = offAt(pct), toRot = (pct * 3.6).toFixed(1), toOp = pct > 0 ? '1' : '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ringVals.forEach(el => { el.style.strokeDashoffset = toOff; });
      if (ringCap) { ringCap.style.transform = `rotate(${toRot}deg)`; ringCap.style.opacity = toOp; }
    }));
  }
  B.pctPrev = pct;

  // 返回「上一级」= 刷题的课堂任务页（index.html），不是浏览器上一页、也不是站点根首页。
  const bdBack = $('#bdBack'); if (bdBack) bdBack.onclick = () => { location.href = 'index.html'; };

  // 第一屏之后关掉入场动画（否则每完成一个人，整块名单都重新 fade 一次，投影上看着像闪）
  document.body.classList.toggle('no-anim', !firstPaint);
  // 高亮只播一次：1.6 秒后把 class 摘掉（不整页重绘，避免闪屏）
  if (B.fresh.size) {
    clearTimeout(B.timer);
    B.timer = setTimeout(() => {
      root.querySelectorAll('.dc.fresh').forEach(el => el.classList.remove('fresh'));
    }, 1700);
    // 谁刚完成：在最上面那行副标题里点一下名（老师抬头就能念出来）
    const names = done.filter(r => B.fresh.has(r.student_id)).map(r => r.name).join('、');
    const sub = root.querySelector('.bd-title .sub');
    if (sub && names) {
      const tip = document.createElement('span');
      tip.className = 'bd-flash';
      tip.textContent = '　刚刚完成：' + names;
      tip.style.cssText = 'color:var(--ok);font-weight:800';
      sub.appendChild(tip);
      setTimeout(() => tip.remove(), 3200);
    }
  }
  /* 「被超了 / 反超了」这条 8 秒后自动收掉：它是一次通报，不是常驻内容。
     不整页重绘（重绘会打断右侧名单的滚动位置），只摘掉这一块。 */
  const mv = root.querySelector('.bd-moves');
  if (mv) setTimeout(() => { if (mv.parentNode) mv.remove(); }, 8000);
}

/* 「被超了 / 反超了」通报最多放 4 条：一个人挤进前十，后面几十个全掉档是常态，
   全铺出来会把「一屏放下、不滚动」撑破。先报反超（好消息），再报掉档，剩下的合成一句。 */
function movesHTML() {
  const ups = B.moves.filter(m => m.up);
  const downs = B.moves.filter(m => !m.up);
  const pick = ups.concat(downs).slice(0, 4);
  const rest = B.moves.length - pick.length;
  return pick.map(m => (m.up
    ? `<span class="mv up">🚀 ${esc(m.name)} 反超到 <b>第 ${m.to} 名</b></span>`
    : `<span class="mv down">⚡ ${esc(m.name)} 被超了 <b>第 ${m.from} → ${m.to} 名</b><small>再刷一次就能超回来</small></span>`)).join('')
    + (rest > 0 ? `<span class="mv more">还有 ${rest} 人的名次跟着变了</span>` : '');
}
