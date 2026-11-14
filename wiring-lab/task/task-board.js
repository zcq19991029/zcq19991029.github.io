/* ============================================================================
   课堂任务 · 大屏（2026-11-09）
   ----------------------------------------------------------------------------
   只做三件事：
     1) 每 15 秒拉一次 wire_task_board，把「未完成名单 / 已完成人数 / 完成率」画出来；
     2) 和上一轮比较，谁是新完成的，就给他一个小金块高亮（1.6 秒后自动熄），旁边飘一句「刚刚完成」；
     3) 任务结束/作废后停止轮询，右下角压一个印章（不弹窗，不打断老师讲课）。

   ⚠️ 为什么大屏只读不写：这一页可能同时开在希沃一体机和老师笔记本上，
      写操作一律在任务页做，两个大屏之间不会互相抢状态。
   ========================================================================== */
const B = {
  taskId: null,   // ?t= 指定；为空时自动挑
  board: null,
  stop: null,
  seen: new Set(),// 已经见过的完成者（学生 id）：用来判断谁是「刚完成」
  fresh: new Set(),// 本轮要高亮的
  timer: null,
  lastAt: '',
  bg: {},          // 身份卡背景：student_id → { bg, pos }（hx_rank_bgs，按电路缓存）
  bgCircuit: null, // 已拉过背景的那道电路（换题才重拉）
  /* 完成率变化（2026-11-09 用户要求）：
     「课堂任务实时计分 被别人超了就会变 这是很正常的竞争学习 我们鼓励动态变化 当场就学习刷题反超」
     名次按用时从短到长排，后来的人更快就把前面的人挤下去 → 完成率 100% 掉到 80%。
     这不是 bug，是竞争机制，所以大屏要主动说出来：谁被超了、谁反超了。 */
  ratePrev: {},   // student_id → 上一轮的完成率
  moves: [],      // [{sid,name,from,to,up}] 本轮掉档/升档的人
  /* 上一轮画出来的完成率（2026-11-13）：Apple 环「长一截」的起点。
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

/* 身份卡背景（照 rank.js 的 rkBgStyle 独立复制一份，避免 task-board.js 依赖 rank.js）：
   只认两种背景串：预设键 p:<k>、压缩图片 data URL；其余返回 ''（调用方走默认深色底）。
   预设键的 css 是「层列表 + 每层自己的 position/size」，只能喂给 background 简写；
   这里把「0 0 / 100% 100%」换成「50% 50% / cover」，窄卡等比裁切不糊、不变形。 */
function rkBgStyle(bg, tune) {
  const s = String(bg || ''); if (!s) return '';
  const t = (tune && typeof tune === 'object') ? tune : { pos: Number(tune) };
  const rawPos = Number(t.pos);
  const p = Math.max(0, Math.min(100, Number.isFinite(rawPos) ? Math.round(rawPos) : 50));
  const z = Math.max(60, Math.min(300, Math.round(Number(t.zoom)) || 100)) / 100;
  const sc = z === 1 ? '' : `;transform:scale(${z})`;
  if (/^p:[a-z0-9_-]{1,24}$/.test(s)) {
    const css = (window.rankBgCss && window.rankBgCss(s.slice(2))) || '';
    const ty = (50 - p) * 0.5;
    const tf = `translateY(${ty}%)` + (z === 1 ? '' : ` scale(${z})`);
    return `background:${css.replace(/0 0\s*\/\s*100% 100%/g, '50% 50% / cover')};transform:${tf}`;
  }
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s))
    return `background-image:url("${s}");background-size:cover;background-repeat:no-repeat;background-position:50% ${p}%${sc}`;
  return '';
}
// 某个学生 → 背景 style 串（拿不到 / 没设过 / 不在榜上 → ''）
function bgStyleOf(sid) {
  const b = B.bg && B.bg[sid];
  if (!b || !b.bg) return '';
  return rkBgStyle(b.bg, { pos: b.pos != null ? b.pos : 50, zoom: 100 });
}

/* ── 左栏（未完成）尺寸档位：和排位/任务页同一套「人多就小」，最大 34vmin 上限不变。
   抽成函数让 paint 和 doneLayout 共用同一份档位，别在两处各写一遍慢慢跑偏。 */
function pendSize(n) { return n <= 12 ? 5.2 : n <= 20 ? 4.4 : n <= 32 ? 3.8 : n <= 48 ? 3.2 : 2.7; }
function pendCol(n) { return n <= 12 ? 34 : n <= 20 ? 28 : n <= 32 ? 24 : n <= 48 ? 20 : 17; }

/* ── 右栏（已完成）排位身份卡求解器（2026-11-13 排位改版）─────────────────────
   目标：所有已完成的人一屏放下、不翻页、不滚动；左栏人少时右栏自动向左扩。
   思路：
     1) 左栏按 --pfs/col 那套算「它至少要占多宽才不溢出」→ pMinW；
     2) 剩余宽度（MAIN_W - pMinW - 边距）= 右栏宽度预算 dW；
     3) 在 --dcs 档位里从大到小挑第一档：该档下「列数 × 卡宽」能塞进 dW。
   卡片尺寸全部是 --dcs 的倍数（卡宽 DC_KW、卡高 DC_KH、间距 DC_KG），
   列数由「能塞几行」反推：人多自动缩字号/缩卡宽、人少自动放大；
   左栏人越少 → dW 越大 → 档位越大 → 右栏越向左扩、卡越大。 */
const DC_KW = 7.5, DC_KH = 1.9, DC_KG = 0.5;
function doneLayout(pN, dN) {
  const MAIN_W = 172, LIST_H = 66, MARGIN = 3.2, PGAP = 1.1;
  const DCS_TIERS = [3.0, 2.7, 2.4, 2.2, 2.0, 1.85, 1.7, 1.55, 1.4, 1.3];
  // 1) 左栏最小宽度（未完成卡片高度 ≈ pfs*2.55，间距 1.1vmin，都要实测过才敢用）
  let pMinW = 0;
  if (pN > 0) {
    const pfs = pendSize(pN), col = pendCol(pN);
    const rows = Math.max(1, Math.floor(LIST_H / (pfs * 2.55 + PGAP)));
    const cols = Math.max(1, Math.ceil(pN / rows));
    pMinW = cols * col + (cols - 1) * PGAP;
  } else {
    // 全部完成：给「全部完成 ✔」留一小条，别把左栏挤成一条缝（2026-11-13）
    pMinW = 20;
  }
  const dW = Math.max(8, MAIN_W - pMinW - MARGIN);
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
  return best;
}

(async function boot() {
  HX.grab();
  if (!HX.online()) return gate('需要在线版', '大屏依赖云端进度，本机离线文件不能用。', false);
  if (!HX.in()) return gate('先登录', '用教师账号登录后，这一页才能看到本班任务。', true);

  // 有 ?t= 就直接用；没有就从自己的任务里挑一个（优先进行中）
  const q = new URLSearchParams(location.search);
  B.taskId = +(q.get('t') || 0) || null;
  try {
    const me = await HX.me();
    if (!me.teacher) return gate('只有教师能打开大屏', '学生请用接线仿真里的排位，或者看任务页里自己的成绩。', false);
    if (!B.taskId) {
      const list = await HX.rpc('wire_task_list');
      const pick = list.find(t => t.status === 'open') || list[0];
      if (!pick) return gate('还没有课堂任务', '先在任务页发布一个，再打开大屏。', false);
      B.taskId = pick.id;
    }
  } catch (e) { return gate('读取任务失败', e.message, true); }

  await load(true);
  // 15 秒一轮（2026-11-11 用户批准：轮询统一降到 15 秒，别让一体机一直发请求）
  // 第三个参数 = ±20% 抖动（12~18 秒）：多台大屏/老师笔记本同开时不会永远同相位一起到期
  B.stop = every(15000, () => load(false), 0.2);
})();

function gate(title, msg, login) {
  root.innerHTML = `<div class="bd-gate"><div>
    <b>${esc(title)}</b><p>${msg}</p>
    ${login ? '<button class="btn primary" id="bdLogin" type="button">去登录</button>' : ''}
  </div></div>`;
  const b = $('#bdLogin'); if (b) b.onclick = () => HX.login();
}

async function load(first) {
  let b;
  try { b = await HX.rpc('wire_task_board', { p_task: B.taskId }); }
  catch (e) {
    if (first) return gate('读取进度失败', e.message, true);
    return; // 轮询失败不打断画面，下一轮再试
  }
  // 新完成的人：上一轮没见过 → 这一轮加高亮
  const nowIds = new Set((b.done_rows || []).map(r => r.student_id));
  B.fresh = new Set();
  if (!first) nowIds.forEach(id => { if (!B.seen.has(id)) B.fresh.add(id); });
  B.seen = nowIds;
  /* 完成率有没有变：后来的人更快 → 前面的人被挤下档，100% 变 80%、80% 变 70%。
     用户明确说这是要鼓励的「竞争学习」，所以这里算出来让大屏当场播报（见 paint 的 bd-moves）。 */
  const rateNow = {};
  (b.done_rows || []).forEach(r => { if (r.rate != null) rateNow[r.student_id] = Number(r.rate); });
  B.moves = [];
  if (!first) {
    (b.done_rows || []).forEach(r => {
      const sid = r.student_id, was = B.ratePrev[sid], now = rateNow[sid];
      if (was == null || now == null || was === now) return;
      B.moves.push({ sid: sid, name: r.name || '', from: was, to: now, up: now > was });
    });
  }
  B.ratePrev = rateNow;
  // 身份卡背景：按电路缓存，只拉一次；hx_rank_bgs 失败（函数没建 / 网络抖）只降级为无背景，不拖垮看板
  const cir = b.task && b.task.circuit;
  if (cir && cir !== B.bgCircuit) {
    B.bgCircuit = cir;
    B.bg = {};
    try {
      let bgs = await HX.rpc('hx_rank_bgs', { p_circuit: cir, p_limit: 200 }) || [];
      if (!Array.isArray(bgs)) bgs = (bgs && Array.isArray(bgs.data)) ? bgs.data : [];
      bgs.forEach(x => { if (x && x.student_id != null) B.bg[x.student_id] = x; });
    } catch (e) { /* 降级：保持无背景 */ }
  }
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
  const fs = pendSize(n);
  const col = pendCol(n);
  document.documentElement.style.setProperty('--pfs', fs + 'vmin');
  // 右栏排位身份卡：人数越多字越小、卡越窄；左栏人少时右栏自动向左扩（宽度/列数由求解器给）。
  const L = doneLayout(n, done.length);
  document.documentElement.style.setProperty('--dcs', L.dcs + 'vmin');
  // 是否第一屏：第一屏播入场动画，之后重绘只保留「新完成那一个」的高亮（见 task.css 的 body.no-anim）
  const firstPaint = !B.painted;
  B.painted = true;
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
    <button class="bd-back" id="bdBack" type="button" title="返回接线仿真">← 接线仿真</button>
    <div class="bd-title">
      <small>${esc(t.class_name)} · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''}</small>
      <b>${esc(t.title || cname(t.circuit))}</b>
      <div class="sub">${esc(cname(t.circuit))}${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    ${t.status !== 'open' ? `<div style="flex:none;display:flex;flex-direction:column;align-items:center;gap:.6vmin">
      <div class="bd-stamp ${t.status}">${t.status === 'void' ? '已作废' : '已结束'}</div>
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
      <div class="pend-grid" style="grid-template-columns:repeat(auto-fill,minmax(${col},1fr));align-content:${n <= 32 ? 'center' : 'start'}">
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
            <b class="dc-rate ${rateTier(r.rate)}">${rateText(r.rate)}</b>
          </div>`;
          }).join('')}
      </div>
    </aside>
  </main>

  ${B.moves.length ? `<div class="bd-moves">${movesHTML()}</div>` : ''}

  <footer class="bd-foot">
    <span class="dot"></span><span>每 15 秒左右刷新 · 最后更新 <b id="bdLast">${B.lastAt || '—'}</b></span>
    <span class="grow"></span>
    <span>基准用时（前 10 名平均）<b>${b.base_sec == null ? '—' : fmtSec(b.base_sec)}</b></span>
    <span>赋分：前 10 名 100% · 11–20 名 80% · 其余已完成 70%</span>
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

  // 返回「上一级」= 接线仿真主页（/wiring-lab/ 外壳），不是浏览器上一页、也不是站点根首页。
  // 2026-11-14 修：原来写 location.href = HOME（HOME 现在是站点根 '../../'），把总入口整页
  // 装进了这一帧 → 冗余首页 + 双返回。改成 goTool()（task-hx.js 里定义，回 ../ 外壳）。
  const bdBack = $('#bdBack'); if (bdBack) bdBack.onclick = () => goTool();

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
    ? `<span class="mv up">🚀 ${esc(m.name)} 反超成功 <b>${Math.round(m.from)}% → ${Math.round(m.to)}%</b></span>`
    : `<span class="mv down">⚡ ${esc(m.name)} 被超了 <b>${Math.round(m.from)}% → ${Math.round(m.to)}%</b><small>再刷一次就能超回来</small></span>`)).join('')
    + (rest > 0 ? `<span class="mv more">还有 ${rest} 人的完成率跟着变了</span>` : '');
}
