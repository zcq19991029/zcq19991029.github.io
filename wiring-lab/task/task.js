/* ============================================================================
   课堂任务 · 教师端 / 学生端（2026-11-09）
   ----------------------------------------------------------------------------
   用户原话（需求就按这个实现，改之前先读一遍）：
     「比如我（教师）设置某个班某一节课接线仿真任务要连2.3并成功仿真
       那必须每个同学都要点排位连接完毕才行 未连的同学展示在大屏幕上 督促大家学习
       然后按照排位时间长短给予平时分 按完成率 按照前10名的平均完成时间作为基准
       前十名为完成率百分百 第11-20名完成率为80% 剩下完成的人完成率为70% 未完成为0%
       也就是这个项目算5分 每一节课发布即新增5分项目（总分也就是+5）」

   谁算「完成」：这个学生在任务发布之后，对**指定的那道电路**点过排位并成功仿真
   （= 前端调过一次 rank_finish 判对通过）。所以学生什么都不用点，照常去排位就自动记上。
   赋分档位和冻结规则全在数据库（wire_task_close / hx_wire_task__calc），本页只显示。

   页面结构：先渲染一次骨架（表单不随轮询重画，老师正在打字时不会被清空），
   轮询只重画「当前任务」那一块（paintLive）。
   ========================================================================== */
const ST = {
  me: null,          // hx_me()
  classes: [],       // 点亮了「接线仿真」的班
  tasks: [],         // wire_task_list()
  cur: null,         // 当前正在看的任务（优先进行中）
  board: null,       // wire_task_board(cur.id)
  mine: null,        // 学生端 wire_task_my_result()
  busy: false,
  stop: null,        // 轮询停止函数
  err: '',           // 最近一次读取失败的一句话（显示在当前任务卡顶部，轮询成功就自动清掉）
  tip: '',           // 结束任务后那句「分数已自动进小组加分」（结束即停轮询，所以它不会被下一轮冲掉）
};
const $ = s => document.querySelector(s);
const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const statusText = s => s === 'open' ? '进行中' : s === 'closed' ? '已结束' : s === 'void' ? '已作废' : s;
// 「小组加分」里的项目列名：接线 + 电路号（如 接线2.3）。
// 这是两边约定的死规则：结束任务时按课次写进那一课，列名就用这个；同一课里已被同名占用时
// 对方会自动加「#任务号」（接线2.3#12），所以这里只显示老师最可能看到的那一个名字。
const jfCol = circuit => '接线' + circuit;
// 小组加分入口：站点根下的 /jiafenxitong/。HOME 已经按「线上 /wiring-lab/task/ → ../../」算好了。
const JF_URL = HOME + 'jiafenxitong/';

/* ---------------- 启动 ---------------- */
(async function boot() {
  HX.grab(); // GitHub 登录回来时先收凭证
  $('#back').onclick = () => location.href = HOME;
  $('#outBtn').onclick = async () => { await HX.out(); location.reload(); };

  if (!HX.online()) return gate('课堂任务需要在线版', '成绩和进度存在云端，本机离线文件不能用。<br>请打开在线版（zcq19991029.github.io/wiring-lab/）里的「课堂任务」。');
  if (!HX.in()) return gate('先登录再用课堂任务', '课堂任务和排位共用华夏工具账号。<br>点下面的按钮去登录，登录后回到这一页。', true);

  try { ST.me = await HX.me(); }
  catch (e) { return gate('读取身份失败', esc(e.message), true); }
  paintWho();
  if (ST.me.teacher) return teacherView();
  if (ST.me.student) return studentView();
  return gate('账号还没开通', '教师用教师码、学生用课堂码开通后就能用。（在华夏工具首页填邀请码）', true);
})();

function gate(title, msg, login) {
  $('#main').innerHTML = `<div class="panel span2"><div class="empty" style="padding:60px 24px">
    <b style="display:block;font-size:20px;color:var(--ink);margin-bottom:10px">${esc(title)}</b>
    <div style="line-height:1.9">${msg}</div>
    ${login ? '<div style="margin-top:22px"><button class="btn primary big" id="gateLogin" type="button">去登录</button></div>' : ''}
  </div></div>`;
  const b = $('#gateLogin'); if (b) b.onclick = () => HX.login();
}
function paintWho() {
  const m = ST.me; if (!m) return;
  const role = m.dev ? '开发者' : m.admin ? '管理员' : m.teacher ? '教师' : m.student ? '学生' : '未开通';
  const nm = (m.student && (m.student.name || m.student.no)) || '';
  $('#who').innerHTML = `<span class="role${m.teacher ? '' : ' s'}">${role}</span><span>${esc(nm)}</span>`;
  $('#outBtn').hidden = false;
}

/* ============================================================================
   教师端
   ========================================================================== */
async function teacherView() {
  const main = $('#main');
  main.innerHTML = `<div class="panel span2"><div class="empty">读取班级…</div></div>`;

  try {
    // 只列首页「班级」里点亮了「接线仿真」的班（用户要求：别的班不该出现在这个工具里）
    ST.classes = (await HX.rpc('hx_my_classes')).filter(c => (c.tools || []).includes('wiring'));
  } catch (e) { return gate('读取班级失败', esc(e.message)); }

  if (!ST.classes.length) {
    return gate('还没有点亮「接线仿真」的班', '去华夏工具首页的「班级」里导入考勤表，并勾上「接线仿真」，再回来发布任务。');
  }
  try { ST.tasks = await HX.rpc('wire_task_list'); }
  catch (e) { ST.tasks = []; ST.err = '任务列表读取失败：' + e.message; }

  await pickCurrent();
  renderTeacher();
  // 进行中才轮询；4 秒一次（大屏 3 秒，教师端稍慢一点，两边都不会打爆服务器）
  if (ST.cur && ST.cur.status === 'open') ST.stop = every(4000, async () => {
    await refreshBoard(); paintLive();
  });
}

// 当前要看的任务：优先进行中的那个（一个班同时只有一个）；没有就显示最近一个
async function pickCurrent() {
  const open = ST.tasks.find(t => t.status === 'open');
  ST.cur = open || ST.tasks[0] || null;
  ST.board = null;
  ST.tip = ''; // 换任务就把「刚结束、已入账」那句清掉，免得挂到别的任务上
  if (ST.cur) await refreshBoard();
}
async function refreshBoard() {
  if (!ST.cur) return;
  try { ST.board = await HX.rpc('wire_task_board', { p_task: ST.cur.id }); ST.err = ''; }
  catch (e) { ST.board = null; ST.err = '进度读取失败：' + e.message; }
}

function renderTeacher() {
  const cls = ST.classes;
  const def = cls[0];
  // 课次默认值：这个班历史上最大课次 + 1（老师一般按顺序上课，省得每次手填）
  const maxNo = ST.tasks.filter(t => t.class_id === def.id && t.lesson_no).reduce((a, t) => Math.max(a, t.lesson_no), 0);
  const cur = ST.cur;
  $('#main').innerHTML = `
  <section class="panel">
    <h2>发布本节课任务 <span class="tag">发布即新增一个 5 分项目</span></h2>
    <div class="body">
      <div class="form">
        <div class="field"><label for="fCls">班级</label>
          <select id="fCls">${cls.map(c => `<option value="${c.id}">${esc(c.name)}${c.term ? ' · ' + esc(c.term) : ''}（${c.total} 人）</option>`).join('')}</select>
        </div>
        <div class="field"><label for="fCir">电路</label>
          <select id="fCir">${CIRCUITS.map(c => `<option value="${c.id}">${esc(c.id)} ${esc(c.short)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="fNo">课次（第几次课）· 必填</label><input id="fNo" type="number" min="1" max="99" value="${maxNo + 1}">
          <small class="hint">课次 = 小组加分里的第几次课；结束任务后成绩自动进那一课的「接线2.3」列，不用导出</small></div>
        <div class="field"><label for="fDate">上课日期</label><input id="fDate" type="date" value="${todayStr()}"></div>
        <div class="field full"><label for="fTitle">任务名（可改）</label><input id="fTitle" maxlength="60" placeholder="2.3 双重互锁正反转 · 排位"></div>
        <div class="field full"><label for="fNote">任务说明（可选）</label><textarea id="fNote" maxlength="200" placeholder="每人接完并仿真成功，按排位用时给分"></textarea></div>
      </div>
      <div class="acts">
        <button class="btn primary big" id="fGo" type="button">发布任务</button>
        <span class="hint" id="fMsg"></span>
      </div>
      <p class="hint">课次 = 「小组加分」里的第几次课，是两边唯一对接口：<b>填错课次，分数会记到别的课上</b>。<br>
        一个班同时只能有一个进行中的任务；换题请先结束上一个（结束那一刻才入账）。<br>
        学生「完成」= 在任务发布之后，把这道电路点排位并仿真成功（不用另外点签到）。</p>
    </div>
  </section>

  <section class="panel" id="live"><div class="empty">加载进度…</div></section>

  <section class="panel span2" id="hist"><div class="empty">加载历史任务…</div></section>`;

  // 电路一变，任务名跟着变（老师多半直接用默认名，别让他手打）
  const fCir = $('#fCir'), fTitle = $('#fTitle');
  const syncTitle = () => { if (!fTitle.dataset.touched) fTitle.value = cname(fCir.value) + ' · 排位'; };
  fCir.onchange = syncTitle; syncTitle();
  fTitle.oninput = () => { fTitle.dataset.touched = '1'; };
  // 切班：课次默认值跟着这个班走
  $('#fCls').onchange = () => {
    const id = +$('#fCls').value;
    const mx = ST.tasks.filter(t => t.class_id === id && t.lesson_no).reduce((a, t) => Math.max(a, t.lesson_no), 0);
    $('#fNo').value = mx + 1;
  };
  $('#fGo').onclick = publish;
  paintLive();
  paintHist();
}

async function publish() {
  if (ST.busy) return;
  const cls = +$('#fCls').value, cir = $('#fCir').value;
  const title = $('#fTitle').value.trim() || (cname(cir) + ' · 排位');
  const note = $('#fNote').value.trim();
  const no = $('#fNo').value ? +$('#fNo').value : null;
  if (!no || no < 1) {
    $('#fMsg').innerHTML = '<span style="color:var(--bad)">请填课次：接线成绩按课次进「小组加分」，填错会记到别的课上。</span>';
    return;
  }
  const date = $('#fDate').value || null;
  ST.busy = true; $('#fGo').disabled = true; $('#fMsg').textContent = '发布中…';
  try {
    const r = await HX.rpc('wire_task_open', {
      p_class: cls, p_circuit: cir, p_title: title, p_note: note, p_lesson_no: no, p_lesson_date: date,
    });
    // 发布成功就在按钮旁边说清楚「现在开始学生去排位就算完成」，别让人再猜
    ST.tasks = await HX.rpc('wire_task_list');
    await pickCurrent();
    if (ST.stop) ST.stop();
    if (ST.cur && ST.cur.status === 'open') ST.stop = every(4000, async () => { await refreshBoard(); paintLive(); });
    // 表单值保留（连着发两个班时省事），只把提示和进度刷新
    paintLive(); paintHist();
    $('#fMsg').innerHTML = '<span style="color:var(--ok)">已发布（任务 #' + (r && r.id) + ' · 第 ' + no + ' 次课）：学生去排位、接对仿真成功就算完成；结束后分数自动进「小组加分」第 ' + no + ' 次课。</span>';
    const box = $('#live'); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('#fMsg').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>';
  } finally { ST.busy = false; $('#fGo').disabled = false; }
}

// 当前任务面板（轮询只重画这一块）
function paintLive() {
  const box = $('#live'); if (!box) return;
  const b = ST.board, t = b && b.task;
  if (!t) {
    // 有任务但读不到进度（网络抖动/权限变更）：说清楚是「读失败，会自动重试」，不要假装没有任务
    box.innerHTML = `<h2>当前任务</h2><div class="empty">${ST.cur
      ? '进度读取失败' + (ST.err ? '：' + esc(ST.err) : '') + '（会自动重试）'
      : '这个班还没有任务。在上面发布一个吧。'}</div>`;
    return;
  }
  const rows = b.done_rows || [];
  const pend = b.pending || [];
  const pct = b.pct || 0;
  const canAct = t.status === 'open';
  box.innerHTML = `
    <h2>当前任务 <span class="tag">${esc(t.class_name)}</span></h2>
    <div class="body">
      <div class="task-head">
        <div style="min-width:0;flex:1">
          <b>${esc(t.title || cname(t.circuit))}</b>
          <div class="meta">${esc(cname(t.circuit))} · 第 ${t.lesson_no || '—'} 次课 · ${esc(t.lesson_date || '—')} · 发布于 ${fmtClock(t.opened_at)}${t.closed_at ? ' · 结束于 ' + fmtClock(t.closed_at) : ''}</div>
        </div>
        <span class="state ${t.status}">${statusText(t.status)}${t.frozen ? ' · 得分已冻结' : ''}</span>
      </div>
      ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
      ${ST.err ? `<p class="err">${esc(ST.err)}</p>` : ''}
      ${ST.tip ? `<p class="hint" style="color:var(--ok)">${esc(ST.tip)}</p>` : ''}
      <div class="kpis">
        <div class="kpi"><em>已完成 / 总人数</em><b>${b.done}<small> / ${b.total}</small></b></div>
        <div class="kpi"><em>完成进度</em><b>${pct}<small style="margin-left:0">%</small></b></div>
        <div class="kpi"><em>基准用时（前 10 名平均）</em><b>${b.base_sec == null ? '—' : fmtSec(b.base_sec)}</b></div>
        <div class="kpi"><em>还没完成</em><b>${pend.length}<small>人</small></b></div>
      </div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
      <div class="acts">
        <button class="btn" id="lvBoard" type="button">打开大屏（投影）</button>
        ${canAct ? '<button class="btn primary" id="lvClose" type="button">结束任务并冻结得分</button><button class="btn danger" id="lvVoid" type="button">作废</button>' : ''}
        ${t.status === 'closed' ? '<button class="btn" id="lvJf" type="button">打开小组加分</button>' : ''}
        <button class="btn ghost" id="lvCsv" type="button">导出名单 CSV</button>
      </div>
      <p class="hint">赋分：第 1–10 名 <b>100%</b>（5 分）· 第 11–20 名 <b>80%</b>（4 分）· 其余已完成 <b>70%</b>（3.5 分）· 未完成 <b>0 分</b>。<br>
        名次按用时从短到长排，会随新完成的人实时变化；<b>结束任务那一刻算一次并写死</b>，之后不再变。</p>

      <div class="tbl-wrap scroll-y" style="margin-top:14px">
        <table class="tbl"><thead><tr>
          <th class="num">名次</th><th>姓名</th><th>学号</th><th class="num">用时</th><th class="num">完成率</th><th class="num">得分</th>
        </tr></thead><tbody>
          ${rows.map(r => `<tr class="${r.place === 1 ? 'r1' : r.place <= 10 ? 'r2' : ''}">
            <td class="num">${r.place == null ? '—' : r.place}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.no)}</td>
            <td class="num">${fmtSec(r.sec)}</td><td class="num">${rateText(r.rate)}</td><td class="num">${scoreText(r.score)}</td></tr>`).join('')}
          ${rows.length ? '' : '<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">还没有人完成</td></tr>'}
        </tbody></table>
      </div>
      ${pend.length ? `<p class="hint" style="margin-top:12px">还没完成（${pend.length} 人）：${pend.map(p => esc(p.name)).join('、')}</p>` : ''}
      ${t.status === 'closed' ? (t.lesson_no
        ? `<p class="hint" style="color:var(--ok)">✓ 分数已冻结并进入「小组加分」· 第 ${t.lesson_no} 次课 · 列名「${esc(jfCol(t.circuit))}」</p>`
        : '<p class="hint" style="color:var(--warn)">⚠ 这个任务没填课次，分数进不了「小组加分」，建议作废重发</p>') : ''}
    </div>`;

  $('#lvBoard').onclick = () => window.open('board.html?t=' + t.id, '_blank');
  $('#lvCsv').onclick = () => exportCsv(b);
  const jfBtn = $('#lvJf'); if (jfBtn) jfBtn.onclick = () => window.open(JF_URL, '_blank', 'noopener');
  const c1 = $('#lvClose'), c2 = $('#lvVoid');
  if (c1) c1.onclick = async () => {
    if (!confirm('结束这个任务？\n\n结束时会按当前名次算一次分并冻结，之后成绩不再变。')) return;
    c1.disabled = true;
    try {
      ST.board = await HX.rpc('wire_task_close', { p_task: t.id });
      ST.tasks = await HX.rpc('wire_task_list');
      ST.cur = ST.tasks.find(x => x.id === t.id) || ST.cur;
      if (ST.stop) { ST.stop(); ST.stop = null; }
      // 结束即入账：把「分数已冻结 + 自动写入小组加分第几次课」说清楚，并给一个直接去看的入口
      const nt = (ST.board && ST.board.task) || t;
      ST.tip = nt.lesson_no
        ? '分数已冻结，并自动写入「小组加分」第 ' + nt.lesson_no + ' 次课的「' + jfCol(nt.circuit) + '」列（不用导出 CSV）。'
        : '分数已冻结。这个任务没填课次，分数进不了「小组加分」，建议作废重发。';
      paintLive(); paintHist();
    } catch (e) { alert('结束失败：' + e.message); c1.disabled = false; }
  };
  if (c2) c2.onclick = async () => {
    if (!confirm('作废这个任务？\n\n作废后不计分（记录保留），适合发错班/发错题。')) return;
    c2.disabled = true;
    try {
      await HX.rpc('wire_task_void', { p_task: t.id });
      ST.tasks = await HX.rpc('wire_task_list');
      ST.cur = ST.tasks.find(x => x.id === t.id) || ST.cur;
      await refreshBoard();
      if (ST.stop) { ST.stop(); ST.stop = null; }
      paintLive(); paintHist();
    } catch (e) { alert('作废失败：' + e.message); c2.disabled = false; }
  };
}

function paintHist() {
  const box = $('#hist'); if (!box) return;
  const list = ST.tasks.filter(t => !ST.cur || t.id !== ST.cur.id);
  box.innerHTML = `<h2>历史任务 <span class="tag">共 ${ST.tasks.length} 个（每个都是一次 5 分项目）</span></h2>
    <div class="body tight"><div class="tbl-wrap scroll-y">
      <table class="tbl"><thead><tr>
        <th>时间</th><th>班级</th><th>电路</th><th>课次</th><th class="num">完成</th><th class="num">平均用时</th><th>状态</th><th></th>
      </tr></thead><tbody>
      ${list.length ? list.map(t => `<tr>
        <td>${fmtClock(t.opened_at)}</td><td>${esc(t.class_name)}</td><td>${esc(cname(t.circuit))}</td>
        <td>${t.lesson_no || '—'}${t.lesson_date ? '<br><span class="muted" style="font-size:12px">' + esc(t.lesson_date) + '</span>' : ''}</td>
        <td class="num">${t.done}/${t.total}</td><td class="num">${t.avg_sec == null ? '—' : fmtSec(t.avg_sec)}</td>
        <td><span class="state ${t.status}"${t.status === 'closed' && !t.lesson_no ? ' title="没填课次，无法入账"' : ''}>${
          t.status === 'closed' ? '已结束 · 已入账' : statusText(t.status)}</span></td>
        <td><button class="btn ghost" data-look="${t.id}" type="button">看这份</button></td></tr>`).join('')
        : '<tr><td colspan="8" class="muted" style="text-align:center;padding:22px">没有更早的任务</td></tr>'}
      </tbody></table></div></div>`;
  box.querySelectorAll('[data-look]').forEach(btn => btn.onclick = async () => {
    ST.cur = ST.tasks.find(x => x.id === +btn.dataset.look) || ST.cur;
    ST.tip = '';
    await refreshBoard();
    if (ST.stop) { ST.stop(); ST.stop = null; }
    if (ST.cur && ST.cur.status === 'open') ST.stop = every(4000, async () => { await refreshBoard(); paintLive(); });
    paintLive(); paintHist();
    $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// 导出名单：已完成按名次，未完成排在后面（0 分）。老师直接贴到小组加分的项目列。
function exportCsv(b) {
  const t = b.task;
  const head = ['名次', '学号', '姓名', '用时(秒)', '完成率(%)', '得分(满分5)', '完成时间'];
  const rows = (b.done_rows || []).map(r => [r.place == null ? '' : r.place, r.no, r.name, r.sec, r.rate == null ? '' : r.rate, r.score == null ? '' : r.score, fmtClock(r.at)]);
  (b.pending || []).forEach(p => rows.push(['', p.no, p.name, '', 0, 0, '未完成']));
  downloadCsv('课堂任务-' + t.class_name + '-' + t.circuit + '-' + (t.lesson_date || todayStr()) + '.csv', [head, ...rows]);
}

/* ============================================================================
   学生端
   ========================================================================== */
async function studentView() {
  const main = $('#main');
  const paint = () => {
    const d = ST.mine;
    if (!d || !d.student) { main.innerHTML = `<div class="panel span2"><div class="empty">名单里没有绑定你的学号，请找老师</div></div>`; return; }
    const t = d.task;
    if (!t) {
      main.innerHTML = `<div class="panel span2"><div class="empty">老师还没发布课堂任务。<br>等发布了这里会显示「你有没有完成」「现在第几名」「能拿几分」。</div></div>`;
      return;
    }
    const m = d.mine;
    main.innerHTML = `
      <section class="panel span2">
        <h2>本节课任务 <span class="tag">${esc(statusText(t.status))}</span></h2>
        <div class="body">
          <div class="task-head">
            <div style="min-width:0;flex:1">
              <b>${esc(t.title || cname(t.circuit))}</b>
              <div class="meta">${esc(cname(t.circuit))} · 第 ${t.lesson_no || '—'} 次课 · ${esc(t.lesson_date || '—')} · 发布于 ${fmtClock(t.opened_at)}</div>
            </div>
            <span class="state ${t.status}">${statusText(t.status)}</span>
          </div>
          ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
          <div class="mine-card" style="margin-top:16px">
            <div class="kpi ${m.finished ? 'mine-done' : 'mine-todo'}"><em>我的状态</em><b>${m.finished ? '已完成' : '还没完成'}</b></div>
            <div class="kpi"><em>我的用时</em><b>${fmtSec(m.sec)}</b></div>
            <div class="kpi"><em>当前名次</em><b>${m.place == null ? '—' : '第 ' + m.place + ' 名'}</b></div>
            <div class="kpi"><em>完成率 / 得分</em><b>${m.finished ? rateText(m.rate) + ' · ' + scoreText(m.score) : '—'}</b></div>
          </div>
          <div class="kpis">
            <div class="kpi"><em>全班已完成</em><b>${d.done}<small>/ ${d.total}</small></b></div>
          </div>
          <p class="hint">${m.finished
            ? '你已经算完成。名次会随更快的同学完成而实时变化；老师结束任务时冻结最终得分。'
            : '去「接线仿真」里选这道电路，点右上角「排位」，全部接对仿真成功就自动算完成（不用在这里点任何按钮）。'}
            <br>赋分：第 1–10 名 100%（5 分）· 第 11–20 名 80%（4 分）· 其余已完成 70%（3.5 分）。</p>
          <div class="acts"><a class="btn primary big" href="${HOME}">去排位</a></div>
        </div>
      </section>`;
  };
  try { ST.mine = await HX.rpc('wire_task_my_result'); } catch (e) { return gate('读取任务失败', esc(e.message), true); }
  paint();
  if (ST.mine && ST.mine.task && ST.mine.task.status === 'open') {
    ST.stop = every(5000, async () => { try { ST.mine = await HX.rpc('wire_task_my_result'); paint(); } catch (e) { } });
  }
}
