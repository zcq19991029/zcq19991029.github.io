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
  /* 完成率变化（2026-11-09 用户要求）：
     「课堂任务实时计分 被别人超了就会变 这是很正常的竞争学习 我们鼓励动态变化 当场就学习刷题反超」
     名次按用时从短到长排，后来的人更快就把前面的人挤下去 → 完成率 100% 掉到 80%。
     这不是 bug，是竞争机制，所以大屏要主动说出来：谁被超了、谁反超了。 */
  ratePrev: {},   // student_id → 上一轮的完成率
  moves: [],      // [{sid,name,from,to,up}] 本轮掉档/升档的人
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
            <span>${esc(r.name)}</span>
            <b class="dc-rate ${rateTier(r.rate)}" title="当前完成率（被更快的同学超了会掉档）">${rateText(r.rate)}</b>
            <em>${r.place == null ? '' : '#' + r.place} ${Math.round(r.sec)}s</em>
          </span>`).join('')}
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
