/* ============================================================================
   课堂任务 · 大屏（2026-11-09）
   ----------------------------------------------------------------------------
   只做三件事：
     1) 每 3 秒拉一次 wire_task_board，把「未完成名单 / 已完成人数 / 完成率」画出来；
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
};
const $ = s => document.querySelector(s);
const root = $('#bdRoot');

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
  // 3 秒一轮：用户要求「每完成一个人就自动刷新」，3 秒足够快，又不会让一体机一直发请求
  B.stop = every(3000, () => load(false));
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
  const changed = JSON.stringify(b) !== JSON.stringify(B.board);
  B.board = b;
  if (changed || first) paint(b);
  // 任务结束/作废：停轮询 + 加印章（这里只停一次，避免每 3 秒重复判断）
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
  const fs = n <= 12 ? '5.2' : n <= 20 ? '4.4' : n <= 32 ? '3.8' : n <= 48 ? '3.2' : '2.7';
  const col = n <= 12 ? '34vmin' : n <= 20 ? '28vmin' : n <= 32 ? '24vmin' : n <= 48 ? '20vmin' : '17vmin';
  document.documentElement.style.setProperty('--pfs', fs + 'vmin');
  // 已完成头像条：人多就两列 + 缩字号（否则 40 个完成的人一条条堆下来会溢出右栏）
  const dCols = done.length > 18 ? 2 : 1;
  const dSize = done.length > 30 ? '1.55' : done.length > 18 ? '1.75' : '2.1';
  document.documentElement.style.setProperty('--dcs', dSize + 'vmin');
  // 是否第一屏：第一屏播入场动画，之后重绘只保留「新完成那一个」的高亮（见 task.css 的 body.no-anim）
  const firstPaint = !B.painted;
  B.painted = true;
  // 进度环：周长 = 2πr，r=44 → 276.46
  const C = 2 * Math.PI * 44, off = C * (1 - pct / 100);

  root.innerHTML = `
  <header class="bd-top">
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
          <circle class="trk" cx="50" cy="50" r="44" fill="none" stroke-width="9"/>
          <circle class="val" cx="50" cy="50" r="44" fill="none" stroke-width="9"
                  stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
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
        ${pend.length ? pend.map(p => `<div class="pend">
            <i>${esc((p.name || p.no || '?').trim().slice(0, 1))}</i>
            <div class="nm"><b>${esc(p.name || p.no)}</b><span>${esc(p.no)}</span></div>
          </div>`).join('')
        : '<div class="pend-empty">全部完成 ✔<small>这一节课没有人掉队</small></div>'}
      </div>
    </section>

    <aside class="bd-done">
      <h3>已完成 <em>${done.length}</em> 人</h3>
      <div class="done-list" style="grid-template-columns:repeat(${dCols},minmax(0,1fr))">
        ${done.map(r => `<span class="done-chip${B.fresh.has(r.student_id) ? ' fresh' : ''}" data-sid="${r.student_id}">
            <i>${esc((r.name || '').trim().slice(0, 1))}</i>
            <span>${esc(r.name)}</span><em>${r.place == null ? '' : '#' + r.place} ${Math.round(r.sec)}s</em>
          </span>`).join('')}
      </div>
    </aside>
  </main>

  <footer class="bd-foot">
    <span class="dot"></span><span>每 3 秒刷新 · 最后更新 <b id="bdLast">${B.lastAt || '—'}</b></span>
    <span class="grow"></span>
    <span>基准用时（前 10 名平均）<b>${b.base_sec == null ? '—' : fmtSec(b.base_sec)}</b></span>
    <span>赋分：前 10 名 100% · 11–20 名 80% · 其余已完成 70%</span>
  </footer>
`;

  // 第一屏之后关掉入场动画（否则每完成一个人，整块名单都重新 fade 一次，投影上看着像闪）
  document.body.classList.toggle('no-anim', !firstPaint);
  // 高亮只播一次：1.6 秒后把 class 摘掉（不整页重绘，避免闪屏）
  if (B.fresh.size) {
    clearTimeout(B.timer);
    B.timer = setTimeout(() => {
      root.querySelectorAll('.done-chip.fresh').forEach(el => el.classList.remove('fresh'));
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
}
