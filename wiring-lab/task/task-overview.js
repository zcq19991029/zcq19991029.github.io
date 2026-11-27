/* ============================================================================
   课堂任务 · 未完成总览大屏（2026-11-18）
   ----------------------------------------------------------------------------
   用户原话：「我还想要个当前班级已开放课堂任务中所有未完成名单投屏，包含任务名和
   未完成名单，这样我可以一个一个找人上希沃跳转排位 督促学习」。
   所以这一页只做两件事：
     1) 把「进行中」的任务全部列出来（一个班一块），每行 = 任务名 + 还没完成的人；
     2) 点某个名字 = 以他身份打开那道题的排位（复用 task-hx.js 的 openRankFor），
        学生上希沃/一体机接完，rank_finish 自动算他完成，这里下一轮就少一个人。
   ⚠️ 只读：不写任何数据。点名字只写 localStorage['hx-rank-pick']（选手身份）+ 开新标签页。
   ⚠️ 已结束 / 已作废 / 已删除的任务不上屏（用户要的是「当前已开放」）。
   ⚠️ 没登录 / 学生账号 → 直接给一句人话，不白屏。
   ========================================================================== */
const OV = {
  me: null,
  classes: [],   // 我教的、点亮了「接线仿真」的班
  tasks: [],     // wire_task_list() 的全部（本班过滤在 load 里做）
  boards: {},    // taskId → wire_task_board()
  seen: {},      // taskId → Map(上一轮未完成的 student_id → 显示名)：判断「谁刚完成」
  fresh: {},     // taskId → Array(本轮刚刚完成的学生显示名)
  cls: null,     // ?cls= 指定的班（任务页点进来时带的）；null = 我所有班一起看
  stop: null,
  clockT: 0,
  err: '',
  t0: Date.now(),
};
const $ = s => document.querySelector(s);
const root = $('#ovRoot');

/* 这一页要「站最后一排也看得清」：人少时**放大**（投影上 6 个人就该占满一屏），
   人多时缩一档，但**下限只到 .8**（1080p 上约 22px）——再小就不如让它多滚两行。
   列数由 CSS 的 auto-fill 自己排，这里只管字号。 */
const sizeTier = n => n <= 6 ? 1.35 : n <= 12 ? 1.15 : n <= 20 ? 1 : n <= 32 ? .92 : n <= 48 ? .86 : .8;

function ovExit() {
  if (OV.stop) { try { OV.stop(); } catch (e) { } OV.stop = null; }
  clearTimeout(OV.clockT); OV.clockT = 0;
  return goTool();
}
window.HXBack = function () { return ovExit(); };

function ovBackBtnHtml() {
  if (window.top !== window) return '';
  return '<button class="ov-back" id="ovBack" type="button" title="返回接线仿真">← 返回</button>';
}
function bindOvBack() {
  const b = $('#ovBack');
  if (b) b.onclick = () => ovExit();
}

function gate(title, msg, login) {
  clearTimeout(OV.clockT); OV.clockT = 0;
  root.innerHTML = `<div class="bd-gate"><div>
    <b>${esc(title)}</b><p>${msg}</p>
    <div class="ov-gate-acts">
      ${login ? '<button class="btn primary" id="ovLogin" type="button">去登录</button>' : ''}
      ${window.top === window ? '<button class="btn ghost" id="ovBack" type="button">← 返回接线仿真</button>' : ''}
    </div>
  </div></div>`;
  const b = $('#ovLogin'); if (b) b.onclick = () => HX.login();
  bindOvBack();
}

(async function boot() {
  HX.grab();
  if (!HX.online()) return gate('需要在线版', '未完成总览依赖云端进度，本机离线文件不能用。', false);
  if (!HX.in()) return gate('先登录', '用教师账号登录后，这一页才能看到本班的未完成名单。', true);
  /* ?cls= 是任务页点进来时带的（「当前班级」）。带了就只上这一个班的任务；
     不带（老师直接在地址栏打开）就把他所有点亮了接线仿真的班都铺出来。 */
  OV.cls = +(new URLSearchParams(location.search).get('cls') || 0) || null;
  try {
    OV.me = await HX.boot(() => HX.me());
    if (!OV.me.teacher) return gate('只有教师能打开未完成总览', '学生请用接线仿真里的排位，或者看任务页里自己的成绩。', false);
    OV.classes = (await HX.boot(() => HX.rpc('hx_my_classes'))).filter(c => (c.tools || []).includes('wiring'));
    if (!OV.classes.length) return gate('还没有点亮「接线仿真」的班', '去华夏工具首页的「班级」里勾上「接线仿真」，再回来。', false);
  } catch (e) { return gate('读取班级失败', esc(e.message), true); }

  await load(true);
  /* 15 秒一轮（和大屏 board.html 同一口径；±20% 抖动，多台设备不会同相位打请求）。
     第一次失败给「再试一次」，之后失败静默跳过这一轮 —— 投影不能因为一次抖动变白屏。 */
  OV.stop = every(15000, () => load(false), 0.2);
})();

async function load(first) {
  try {
    const list = await (first ? HX.boot(() => HX.rpc('wire_task_list')) : HX.rpc('wire_task_list'));
    OV.tasks = Array.isArray(list) ? list : [];
    const open = OV.tasks.filter(t => t.status === 'open'
      && (!OV.cls || Number(t.class_id) === OV.cls));
    /* 每个进行中的任务各拉一份看板（并发）：未完成名单只在这里面。
       open 任务一般 1~3 个，请求数可控；某个失败了只让那一块显示「读取中…」，不拖垮整页。 */
    const boards = {};
    await Promise.all(open.map(async t => {
      try { boards[t.id] = await HX.rpc('wire_task_board', { p_task: t.id }); } catch (e) { }
    }));
    OV.boards = boards;
    OV.err = '';
    paintBoard(open, first);
    paintFoot();
  } catch (e) {
    if (first) return gate('读取任务失败', e.message, true);
    OV.err = e.message;
    paintFoot();
  }
}

/* 谁刚完成：上一轮在未完成名单里、本轮已消失的同学即为「刚刚完成」，收集姓名用于块头提示与高亮。 */
function trackFresh(open, first) {
  const fresh = {};
  open.forEach(t => {
    const b = OV.boards[t.id];
    if (!b) return;
    const pend = b.pending || [];
    const now = new Map();
    pend.forEach(p => now.set(String(p.student_id), String(p.name || p.no || p.student_id)));
    if (!first) {
      const was = OV.seen[t.id];
      if (was) {
        const doneNames = [];
        was.forEach((nm, id) => { if (!now.has(id)) doneNames.push(nm); });
        if (doneNames.length) fresh[t.id] = doneNames;
      }
    }
    OV.seen[t.id] = now;
  });
  OV.fresh = fresh;
}

function paintBoard(open, first) {
  trackFresh(open, first);
  if (!open.length) {
    root.innerHTML = `<header class="ov-top">
        ${ovBackBtnHtml()}
        <b>课堂任务 · 未完成总览</b>
        <span class="ov-sub">本班现在没有进行中的任务</span>
        <span class="ov-clock" id="ovClock">${clock()}</span>
      </header>
      <div class="ov-empty">
        <b>没有已开放的课堂任务</b>
        <p>去「课堂任务」页发布一个（同一个班可以同时发多个）。发布后这里会自动出现任务名和未完成名单。</p>
      </div>`;
    bindOvBack();
    tick();
    return;
  }
  const totalPend = open.reduce((a, t) => a + (((OV.boards[t.id] || {}).pending) || []).length, 0);
  root.style.setProperty('--ofs', sizeTier(totalPend));
  const clsName = OV.cls ? ((OV.tasks.find(t => Number(t.class_id) === OV.cls) || {}).class_name || '') : '';
  root.innerHTML = `<header class="ov-top">
      ${ovBackBtnHtml()}
      <b>课堂任务 · 未完成总览</b>
      <span class="ov-sub">${clsName ? '<b>' + esc(clsName) + '</b> · ' : ''}进行中 <em>${open.length}</em> 个任务 · 共 <em>${totalPend}</em> 人还没完成 · <b class="ov-tip">点名字＝以他身份打开这一题的排位</b></span>
      <span class="ov-clock" id="ovClock">${clock()}</span>
    </header>
    <div class="ov-wrap">${open.map(t => blockHTML(t)).join('')}</div>`;
  bindOvBack();
  root.querySelectorAll('[data-rank-for]').forEach(btn => {
    btn.onclick = () => {
      const t = open.find(x => String(x.id) === btn.dataset.task);
      const b = OV.boards[btn.dataset.task] || {};
      const p = (b.pending || []).find(x => String(x.student_id) === btn.dataset.rankFor);
      if (t && p) openRankFor(t, p, t.class_name);
    };
  });
  tick();
}

function blockHTML(t) {
  const b = OV.boards[t.id];
  const pend = (b && b.pending) || [];
  const done = b ? +b.done : 0, total = b ? +b.total : 0;
  const freshNames = OV.fresh[t.id] || [];
  const title = t.title || t.circuit;
  const cls = t.class_name || '';
  if (!b) {
    return `<section class="ov-block">
      <div class="ov-h"><b>${esc(title)}</b><span class="ov-meta">${esc(cls)} · ${esc(t.circuit || '')}</span></div>
      <p class="ov-wait">读取进度…（下一轮自动重试）</p></section>`;
  }
  return `<section class="ov-block${freshNames.length ? ' fresh' : ''}">
    <div class="ov-h">
      <b>${esc(title)}</b>
      <span class="ov-meta">${esc(cls)} · ${esc(t.circuit || '')} · 已完成 <em>${done}</em>/<em>${total}</em></span>
      ${freshNames.length ? `<span class="ov-fresh">刚刚完成：${esc(freshNames.join('、'))}</span>` : ''}
      <span class="ov-left ${pend.length ? '' : 'ok'}">${pend.length ? '还差 ' + pend.length + ' 人' : '全部完成 ✔'}</span>
    </div>
    ${pend.length ? `<div class="ov-grid">${pend.map(p => `
      <button type="button" class="ov-chip"
              data-task="${esc(t.id)}" data-rank-for="${esc(p.student_id)}"
              title="点一下：以「${esc(p.name || p.no || '')}」的身份打开这一题的排位（接完自动算他完成）">
        <i>${esc(String(p.name || p.no || '?').trim().slice(0, 1))}</i>
        <b>${esc(p.name || p.no)}</b>
        <span class="ov-ico" aria-hidden="true">▶</span>
      </button>`).join('')}</div>`
      : '<p class="ov-wait ok">这一题全班都完成了 ✔</p>'}
  </section>`;
}

function paintFoot() {
  let el = $('#ovFoot');
  if (!el) { el = document.createElement('div'); el.id = 'ovFoot'; el.className = 'ov-foot'; document.body.appendChild(el); }
  el.innerHTML = OV.err
    ? '<span class="bad">读取失败：' + esc(OV.err) + '（下一轮自动重试）</span>'
    : '每 15 秒自动刷新 · 只读，不会改任何成绩';
}

const clock = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
};
function tick() {
  clearTimeout(OV.clockT);
  OV.clockT = 0;
  const el = $('#ovClock');
  if (!el) return;
  el.textContent = clock();
  OV.clockT = setTimeout(tick, 1000);
}

/* 全屏键（希沃/一体机上顺手）：浏览器 F11 之外再给一颗，按 Esc 退出由浏览器管。
   不放按钮也行，但投影时老师更愿意点一颗看得见的按钮。 */
document.addEventListener('keydown', e => {
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement === document.body) {
    try { document.documentElement.requestFullscreen(); } catch (err) { }
  }
});
