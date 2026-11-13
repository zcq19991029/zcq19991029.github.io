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
  tasksAll: [],      // wire_task_list() 的原始结果（所有班）
  tasks: [],         // 当前班级的任务（= tasksAll 里本班那些）
  cls: null,         // 当前班级 id：课堂任务、历史任务都只显示这个班（用户要求「按班级隔离」）
  cur: null,         // **进行中**的任务（本班最多一个，没有就是 null）—— 已结束/已作废的一律不算
  view: null,        // 正在回看的历史任务 id：从「历史任务」点「看这份」进来，只读，不占「当前任务」的位置
  board: null,       // wire_task_board(正在看的那个任务.id)
  mine: null,        // 学生端 wire_task_my_result()
  liveOpen: null,    // 当前任务面板展开状态：null = 按状态自动（进行中展开 / 已冻结收起）
  histOpen: false,   // 历史任务面板：默认收起，点标题才展开
  busy: false,
  lessons: [],       // 本班在「小组加分」里已有的课次（发布表单的下拉，见 task-lessons.js）
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
/* 任务列表排序（2026-11-11 用户要求「按班级课次隔离，新课任务在最上面」）：
   进行中的排最前（一个班同时只有一个 open），其余按发布时间倒序 —— 和学生榜 SQL
   （wire_task_student_list 的 (status='open') desc, opened_at desc）同一套口径，
   教师端/学生端/大屏看到的顺序一致。wire_task_list 本身只按 opened_at desc 排，
   open 最前这一档在这里补。 */
const sortTasks = list => (list || []).slice().sort((a, b) =>
  ((b.status === 'open') ? 1 : 0) - ((a.status === 'open') ? 1 : 0) ||
  String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
// 小组加分入口：站点根下的 /jiafenxitong/。HOME 已经按「线上 /wiring-lab/task/ → ../../」算好了。
const JF_URL = HOME + 'jiafenxitong/';

/* ---------------- 启动 ---------------- */
(async function boot() {
  HX.grab(); // GitHub 登录回来时先收凭证
  // 返回按钮（2026-11-13）：点「← 接线仿真」回到上一级 = 接线仿真主页（/wiring-lab/）。
  // 是跳 HOME，不是浏览器 history.back、也不是首页；页面嵌在总入口 iframe 里时，
  // HOME 已按「线上 /wiring-lab/task/ → ../../，本机 → ./」算好（见 task-hx.js）。
  const backBtn = $('#lvBack');
  if (backBtn) backBtn.onclick = () => location.href = HOME;
  // 右上角那颗「退出」已删除（U1）：退出应该走总入口左上角「返回」，不在这里单开一颗。

  if (!HX.online()) return gate('课堂任务需要在线版', '成绩和进度存在云端，本机离线文件不能用。<br>请打开在线版（zcq19991029.github.io/wiring-lab/）里的「课堂任务」。');
  if (!HX.in()) return gate('先登录再用课堂任务', '课堂任务和排位共用华夏工具账号。<br>点下面的按钮去登录，登录后回到这一页。', true);

  try { ST.me = await HX.me(); }
  catch (e) { return gate('读取身份失败', esc(e.message), true); }
  await paintWho();
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
async function paintWho() {
  const m = ST.me; if (!m) return;
  // 学生端显示学号姓名；教师/开发者/管理员没有「学生姓名」，从登录账号取一个名字，右上角不空着
  const nm = (m.student && (m.student.name || m.student.no)) || '';
  let who = nm;
  if (!who) {
    try {
      const u = await HX.user();
      const gh = (u.identities || []).find(i => i.provider === 'github');
      who = (u.user_metadata && u.user_metadata.name)
        || (gh && gh.identity_data && gh.identity_data.user_name)
        || (u.email || '').split('@')[0] || '';
    } catch (e) { who = ''; }
  }
  $('#who').innerHTML = who ? `<span>${esc(who)}</span>` : '';
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
  try { ST.tasksAll = sortTasks(await HX.rpc('wire_task_list')); }
  catch (e) { ST.tasksAll = []; ST.err = '任务列表读取失败：' + e.message; }

  /* 2026-11-12（R2）：课堂任务和历史任务都按班级隔离。
     班级上下文就取发布表单那个「班级」下拉（ST.cls）—— 一个老师带好几个班时，
     原来两张表把所有班的任务混在一起，还总把别的班的「进行中」当成当前任务。
     默认落在「有进行中任务」的那个班（老师打开这页多半是来看这节课的），没有就第一个班。 */
  ST.cls = defaultClass();
  ST.tasks = tasksOf(ST.cls);
  ST.liveOpen = null;
  ST.histOpen = false;

  await pickCurrent();
  renderTeacher();
  syncPoll();
}

// 当前班级的任务（tasksAll 里只留本班）
const tasksOf = cls => ST.tasksAll.filter(t => Number(t.class_id) === Number(cls));
const className = id => (ST.classes.find(c => Number(c.id) === Number(id)) || {}).name || '';
/* 界面上「当前要渲染的那一个任务」：
   默认 = 进行中的任务；点了历史里的「看这份」就临时换成那一条（ST.view），
   但 ST.cur 本身永远是「进行中」，这样「当前任务 / 历史任务」两个分区的边界才不会糊。 */
const showing = () => (ST.view ? ST.tasks.find(t => t.id === ST.view) : ST.cur) || null;
// 重新拉任务列表，并保持「只留当前班级」（换班 / 发布 / 结束 / 作废 / 重新拉起都用这一条）
async function reloadTasks() {
  ST.tasksAll = sortTasks(await HX.rpc('wire_task_list'));
  ST.tasks = tasksOf(ST.cls);
}
// 默认班级：优先「有进行中任务」的班（最新的那个），否则第一个班
function defaultClass() {
  const open = ST.tasksAll.find(t => t.status === 'open');
  const id = open ? Number(open.class_id) : Number(ST.classes[0].id);
  return ST.classes.some(c => Number(c.id) === id) ? id : Number(ST.classes[0].id);
}
// 轮询跟着「当前任务」走：换班 / 结束 / 重新拉起都要重开，否则还在读上一个班的进度
// （在回看历史任务时不轮询：已结束的数据不会变，白打接口）
function syncPoll() {
  if (ST.stop) { ST.stop(); ST.stop = null; }
  if (ST.cur && ST.cur.status === 'open' && !ST.view) ST.stop = every(4000, async () => { await refreshBoard(); paintLive(); });
}
// 切班：换当前任务、重开轮询、两张表就地重画（发布表单不重画，老师正在填的内容不会被冲掉）
async function setClass(v) {
  const id = Number(v);
  if (!id || id === ST.cls) return;
  ST.cls = id;
  ST.tasks = tasksOf(id);
  ST.liveOpen = null; ST.err = '';
  await pickCurrent();
  syncPoll();
  paintLive(); paintHist();
}

// 当前任务 = 本班**进行中**的那一个（一个班同时只有一个 open）。
// ★ 2026-11-12 深夜修（用户原话：「为什么都是当前任务 我都冻结了 为什么还不算历史任务呢」）：
//   原来写的是 `ST.cur = open || ST.tasks[0]` —— 没有进行中的任务时，把**最近一个已结束的任务**
//   顶到「当前任务」里，于是老师刚冻结完，抬头一看它还在「当前任务」，历史上却少了一条。
//   现在没有进行中的任务就是 null，那个面板显示空状态并指向「历史任务」。
async function pickCurrent() {
  ST.cur = ST.tasks.find(t => t.status === 'open') || null;
  ST.view = null;
  ST.board = null;
  ST.tip = ''; // 换任务就把「刚结束、已入账」那句清掉，免得挂到别的任务上
  if (showing()) await refreshBoard();
}
async function refreshBoard() {
  const t = showing();
  if (!t) return;
  try { ST.board = await HX.rpc('wire_task_board', { p_task: t.id }); ST.err = ''; }
  catch (e) { ST.board = null; ST.err = '进度读取失败：' + e.message; }
}

// 折叠面板骨架：标题栏整条可点，收起时只留标题 + 摘要（用户 2026-11-12：冻结的任务要收起来，历史任务也要能展开）
function foldInto(box, title, tagHtml, open, body, onToggle) {
  box.className = 'panel span2' + (open ? '' : ' collapsed');
  box.innerHTML = `<h2 class="fold-head"><button class="fold" type="button" aria-expanded="${open}">
      <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      <span class="fold-t">${esc(title)}</span>${tagHtml || ''}</button></h2>` + body;
  const btn = box.querySelector('.fold');
  if (btn) btn.onclick = () => onToggle(!open);
}

function renderTeacher() {
  const cls = ST.classes;
  $('#main').innerHTML = `
  <section class="panel span2">
    <h2>发布本节课任务 <span class="tag">发布即新增一个 5 分项目</span></h2>
    <div class="body">
      <div class="form">
        <div class="field"><label for="fCls">班级</label>
          <select id="fCls">${cls.map(c => `<option value="${c.id}"${Number(c.id) === Number(ST.cls) ? ' selected' : ''}>${esc(c.name)}${c.term ? ' · ' + esc(c.term) : ''}（${c.total} 人）</option>`).join('')}</select>
        </div>
        <div class="field"><label for="fCir">电路</label>
          <select id="fCir">${CIRCUITS.map(c => `<option value="${c.id}">${esc(c.id)} ${esc(c.short)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="fNo">课次（第几次课）· 必填</label>
          <div id="fNoBox"></div>
        </div>
        <div class="field"><label for="fDate">上课日期</label><input id="fDate" type="date" value="${todayStr()}"></div>
        <small class="hint full" id="fNoInfo"></small>
        <div class="field full"><label for="fTitle">任务名（可改）</label><input id="fTitle" maxlength="60" placeholder="2.3 双重互锁正反转 · 排位"></div>
        <div class="field full"><label for="fNote">任务说明（可选）</label><textarea id="fNote" maxlength="200" placeholder="每人接完并仿真成功，按排位用时给分"></textarea></div>
      </div>
      <div class="acts">
        <button class="btn primary big" id="fGo" type="button">发布任务</button>
        <span class="hint" id="fMsg"></span>
      </div>
      <p class="hint">课次直接选「小组加分」里已有的课次，会显示那节课的日期和主题；日期对不上会红字提醒。<b>填错课次，分数会记到别的课上</b>。<br>
        一个班同时只能有一个进行中的任务；换题请先结束上一个（结束那一刻才入账）。<br>
        学生「完成」= 在任务发布之后，把这道电路点排位并仿真成功（不用另外点签到）。</p>
    </div>
  </section>

  <section class="panel span2" id="live"><div class="empty">加载进度…</div></section>

  <section class="panel span2" id="hist"><div class="empty">加载历史任务…</div></section>`;

  // 电路一变，任务名跟着变（老师多半直接用默认名，别让他手打）
  const fCir = $('#fCir'), fTitle = $('#fTitle');
  const syncTitle = () => { if (!fTitle.dataset.touched) fTitle.value = cname(fCir.value) + ' · 排位'; };
  // 电路变了，落点列名（接线2.3）跟着变，下面的提示要重画
  fCir.onchange = () => { syncTitle(); paintLessonInfo(); };
  syncTitle();
  fTitle.oninput = () => { fTitle.dataset.touched = '1'; };
  // 切班：每个班的课次不一样，整个下拉重建（默认选中这个班最后一节）；
  // 下面的「当前任务 / 历史任务」也跟着只显示这个班（用户要求按班级隔离）
  $('#fCls').onchange = async () => { buildLessonPicker(); await setClass($('#fCls').value); };
  // 日期改了要重新比对「课次日期」是否一致
  $('#fDate').oninput = paintLessonInfo;
  $('#fDate').onchange = paintLessonInfo;
  buildLessonPicker();
  $('#fGo').onclick = publish;
  paintLive();
  paintHist();
}

/* ============================================================================
   课次：从「小组加分」已有课次里选（2026-11-09）
   ----------------------------------------------------------------------------
   原来是裸数字框，老师得自己记住「第几次课是哪天、什么主题」，填错就把分记到别的课上。
   现在给下拉：数据 = 同一源下 localStorage 的 jfdt.v1（解析在 task-lessons.js）。
   ⚠️ 读不到就退回数字框：换设备、清缓存、还没打开过「小组加分」都会出现，
      不能因为读不到课次清单就让老师发不了任务。
   ========================================================================== */
const NEW_LESSON = '__new';

const maxTaskNo = classId => ST.tasks
  .filter(t => Number(t.class_id) === Number(classId) && t.lesson_no)
  .reduce((a, t) => Math.max(a, +t.lesson_no), 0);

function buildLessonPicker() {
  const box = $('#fNoBox'); if (!box) return;
  const cls = +$('#fCls').value;
  const L = window.HX_LESSONS;
  ST.lessons = (L && typeof L.list === 'function') ? L.list(L.read(), cls) : [];

  if (!ST.lessons.length) {
    // 读不到课的清单：保留原来的行为（数字框，默认本班历史最大课次 + 1）
    box.dataset.mode = 'input';
    box.innerHTML = `<input id="fNo" type="number" min="1" max="99" value="${maxTaskNo(cls) + 1}">`;
    $('#fNo').oninput = paintLessonInfo;
    paintLessonInfo();
    return;
  }

  box.dataset.mode = 'select';
  /* 默认选中谁？—— 只认「日期正好是今天」的那一节，否则默认「新建」。
     为什么不用「最后一节」：小组加分的课次常常还没建到这一节（接线任务本来就会自动建课次），
     这时候「最后一节」其实是**上一周**的课，默认选中它 = 一声不响把今天的分记到上周去，
     正好是这次要消灭的那种错误。日期对上今天才自动选，对不上就让老师自己选（或新建），
     宁可多一次点击，也不要默默记错课。 */
  const today = todayStr();
  const sameDay = ST.lessons.filter(l => l.date === today);
  const def = sameDay.length ? sameDay[sameDay.length - 1] : null;
  const last = ST.lessons[ST.lessons.length - 1];
  const next = Math.max(last.seq, maxTaskNo(cls)) + 1;
  box.innerHTML = `<select id="fNo">${ST.lessons.map(l => {
    const v = l.id || 'seq:' + l.seq;
    return `<option value="${esc(v)}"${l === def ? ' selected' : ''}>${esc(lessonLabel(l))}${l.date === today ? '（今天）' : ''}</option>`;
  }).join('')}<option value="${NEW_LESSON}"${def ? '' : ' selected'}>＋ 新建第 ${next} 次课（没上过的课）</option></select>`;
  $('#fNo').onchange = paintLessonInfo;
  paintLessonInfo();
}

function lessonLabel(l) {
  return ['第 ' + l.seq + ' 次课', l.date || '日期未填', l.topic || '未填主题'].join(' · ');
}
// 选中的课次对象；null = 选了「新建」（或当前是数字框）
function pickedLesson() {
  const box = $('#fNoBox');
  if (!box || box.dataset.mode !== 'select') return null;
  const v = $('#fNo').value;
  if (v === NEW_LESSON) return null;
  return ST.lessons.find(l => (l.id || 'seq:' + l.seq) === v) || null;
}
function nextLessonNo() {
  const last = ST.lessons[ST.lessons.length - 1];
  return Math.max(last ? last.seq : 0, maxTaskNo(+$('#fCls').value)) + 1;
}

// 选完立刻说清楚「写进哪一课、哪一列」，日期对不上/列已存在当场提醒（别等发布后的横幅）
function paintLessonInfo() {
  const info = $('#fNoInfo'), box = $('#fNoBox');
  if (!info || !box) return;
  const col = jfCol($('#fCir').value);
  const date = $('#fDate').value || '';
  const lines = [];

  if (box.dataset.mode === 'select') {
    const l = pickedLesson();
    if (l) {
      lines.push(`会写进「小组加分」第 <b>${l.seq}</b> 次课（${esc(l.date || '日期未填')} · ${esc(l.topic || '未填主题')}）的「${esc(col)}」列`);
      if (l.wireCols.indexOf(col) >= 0) {
        lines.push(`<span class="warnl">这一课已经有「${esc(col)}」列了，新的成绩会并进去/覆盖</span>`);
      }
      if (date && l.date && date !== l.date) {
        lines.push(`<span class="badl">任务日期 ${esc(date)} 和这一课的日期 ${esc(l.date)} 不一致，可能记错课次</span>`);
      }
    } else {
      const n = nextLessonNo();
      lines.push(`会新建「小组加分」第 <b>${n}</b> 次课（日期取上面的上课日期${date ? '：' + esc(date) : ''}），结束后写入「${esc(col)}」列`);
    }
  } else {
    const n = $('#fNo').value ? +$('#fNo').value : 0;
    lines.push(n
      ? `会写进「小组加分」第 <b>${n}</b> 次课的「${esc(col)}」列（读不到课次清单，结束时会按号码对上，没有就新建）`
      : '<span class="badl">请填课次</span>');
  }
  info.innerHTML = lines.join('<br>');
}

async function publish() {
  if (ST.busy) return;
  const cls = +$('#fCls').value, cir = $('#fCir').value;
  const title = $('#fTitle').value.trim() || (cname(cir) + ' · 排位');
  const note = $('#fNote').value.trim();
  // 课次：选了已有课次 → 用它的 seq 和日期（避免两边日期错位）；选了「新建」→ 按最大+1
  const box = $('#fNoBox');
  const picked = pickedLesson();
  const isNew = !!(box && box.dataset.mode === 'select' && !picked);
  const no = picked ? picked.seq : (box && box.dataset.mode === 'select' ? nextLessonNo() : ($('#fNo').value ? +$('#fNo').value : null));
  if (!no || no < 1) {
    $('#fMsg').innerHTML = '<span style="color:var(--bad)">请选课次：接线成绩按课次进「小组加分」，选错会记到别的课上。</span>';
    return;
  }
  const date = $('#fDate').value || null;
  // 日期优先用所选课次自己的：两边不一致时以「小组加分」那一课为准，分数不会落到别的时间轴上
  const lessonDate = (picked && picked.date) || date;
  ST.busy = true; $('#fGo').disabled = true; $('#fMsg').textContent = '发布中…';
  try {
    const r = await HX.rpc('wire_task_open', {
      p_class: cls, p_circuit: cir, p_title: title, p_note: note, p_lesson_no: no, p_lesson_date: lessonDate,
    });
    // 发布成功就把「成绩会落到哪一课、哪一列」说清楚，别让人再猜。
    // 刚发的任务一定属于「当前选中的班」：先锁到那个班再重拉，下面两张表才不会显示成别的班。
    ST.cls = cls;
    await reloadTasks();
    await pickCurrent();
    ST.liveOpen = null; // 新任务进行中 → 回到自动（展开）
    syncPoll();
    // 表单值保留（连着发两个班时省事），只把提示和进度刷新
    paintLive(); paintHist();
    $('#fMsg').innerHTML = `<span style="color:var(--ok)">已发布（任务 #${(r && r.id) || '—'} · 第 ${no} 次课）：学生去排位、接对仿真成功就算完成；结束后分数自动进「小组加分」第 ${no} 次课「${esc(jfCol(cir))}」列${isNew ? '（这一课结束时会自动建）' : ''}。</span>`;
    const live = $('#live'); if (live) live.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('#fMsg').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>';
  } finally { ST.busy = false; $('#fGo').disabled = false; }
}

// 当前任务面板（轮询只重画这一块）
// 2026-11-12：整块做成可折叠 —— 进行中默认展开；已结束/已冻结默认收起（和「历史任务」一个样子），
// 点标题展开。收起时标题栏上仍然写着班级、状态、完成人数，不用展开也能一眼看完。
function paintLive() {
  const box = $('#live'); if (!box) return;
  const t = showing();
  const b = ST.board;
  const histN = ST.tasks.filter(x => x.status !== 'open').length;
  if (!t) {
    /* 本班没有进行中的任务。
       两种情况要分开说：① 一个任务都没有（引导去发布）；② 有历史任务（引导去历史里看，
       顺便把刚冻结那条「分数已入账」的提示带上 —— 它原来是挂在面板 body 里的，面板一空就没了）。 */
    const tip = ST.tip ? `<p class="fold-note">${esc(ST.tip)}</p>`
      : ST.err ? `<p class="fold-note bad">${esc(ST.err)}</p>` : '';
    const inner = histN
      ? `<div class="empty">这个班现在<b>没有进行中的任务</b>。<br>
         已经结束 / 作废的 <b>${histN}</b> 个都在下面的「历史任务」里，点标题就能展开，进去能看名次和得分，也能「重新拉起」让没做完的学生补做。</div>`
      : `<div class="empty">这个班还没有任务。在上面发布一个吧。</div>`;
    foldInto(box, '当前任务', `<span class="tag">${esc(className(ST.cls))} · 无进行中</span>`, true,
      tip + `<div class="body">${inner}</div>`, () => { });
    return;
  }
  /* 有任务、但进度没读到（网络抖动 / 权限变更）：别假装没有任务，也别让下面的 b.xxx 抛错。 */
  if (!b) {
    foldInto(box, t.status === 'open' ? '当前任务' : '历史任务 · 查看中',
      `<span class="tag">${esc(t.class_name)} · ${statusText(t.status)}</span>`, true,
      `<div class="body"><div class="empty">进度读取失败${ST.err ? '：' + esc(ST.err) : ''}（会自动重试；也可以点标题收起再展开重试）</div></div>`,
      () => { });
    return;
  }
  const rows = b && b.done_rows || [];
  const pend = b && b.pending || [];
  const pct = (b && b.pct) || 0;
  const canAct = t.status === 'open';
  const viewing = !canAct && ST.view === t.id;   // 正在回看一条历史任务
  // 展开状态：老师点过就听老师的；没点过则「进行中展开、已冻结收起」
  const open = ST.liveOpen == null ? t.status === 'open' : ST.liveOpen;
  const tag = `<span class="tag">${esc(t.class_name)} · ${statusText(t.status)}${t.frozen ? ' · 得分已冻结' : ''}${b ? ' · 完成 ' + b.done + '/' + b.total : ''}</span>`;
  // 收尾提示（「分数已冻结并写入第 N 次课」）放在 body 外面：收起时也看得见
  const note = ST.err ? `<p class="fold-note bad">${esc(ST.err)}</p>`
    : ST.tip ? `<p class="fold-note">${esc(ST.tip)}</p>` : '';
  const body = `<div class="body">
      <div class="task-head">
        <div style="min-width:0;flex:1">
          <b>${esc(t.title || cname(t.circuit))}</b>
          <div class="meta">${esc(cname(t.circuit))} · 第 ${t.lesson_no || '—'} 次课 · ${esc(t.lesson_date || '—')} · 发布于 ${fmtClock(t.opened_at)}${t.closed_at ? ' · 结束于 ' + fmtClock(t.closed_at) : ''}</div>
        </div>
        <span class="state ${t.status}">${statusText(t.status)}${t.frozen ? ' · 得分已冻结' : ''}</span>
      </div>
      ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
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
        <button class="btn ghost" id="lvLesson" type="button" title="课次填错了就改这里，分数会跟着落到正确的课次">改课次</button>
        ${t.status === 'closed' ? '<button class="btn" id="lvJf" type="button">打开小组加分</button>' : ''}
        ${t.status === 'closed' ? '<button class="btn primary" id="lvReopen" type="button" title="让没完成的学生补做：任务回到进行中，再次结束时按最新名次重新冻结得分">重新拉起（补做）</button>' : ''}
        ${viewing ? '<button class="btn ghost" id="lvExit" type="button" title="回看结束，回到本班的当前任务">退出查看</button>' : ''}
        <button class="btn ghost" id="lvCsv" type="button">导出名单 CSV</button>
      </div>
      <p class="hint">赋分：第 1–10 名 <b>100%</b>（5 分）· 第 11–20 名 <b>80%</b>（4 分）· 其余已完成 <b>70%</b>（3.5 分）· 未完成 <b>0 分</b>。<br>
        名次按用时从短到长排，会随新完成的人实时变化；<b>结束任务那一刻算一次并写死</b>，之后不再变。</p>

      <div class="live-cols">
        <div class="live-done">
          <h3>已完成 <em>${rows.length}</em> 人 <small>完成率按名次实时算，被更快的同学超了就会掉档</small></h3>
          <div class="tbl-wrap scroll-y">
            <table class="tbl"><thead><tr>
              <th class="num">名次</th><th>姓名</th><th>学号</th><th class="num">用时</th><th class="num">完成率</th><th class="num">得分</th>
            </tr></thead><tbody>
              ${rows.map(r => `<tr class="${r.place === 1 ? 'r1' : r.place <= 10 ? 'r2' : ''}">
                <td class="num">${r.place == null ? '—' : r.place}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.no)}</td>
                <td class="num">${fmtSec(r.sec)}</td>
                <td class="num rate ${rateTier(r.rate)}">${rateText(r.rate)}</td>
                <td class="num">${scoreText(r.score)}</td></tr>`).join('')}
              ${rows.length ? '' : '<tr><td colspan="6" class="muted" style="text-align:center;padding:22px">还没有人完成</td></tr>'}
            </tbody></table>
          </div>
        </div>
        <div class="live-pend">
          <h3>还没完成 <em>${pend.length}</em> 人</h3>
          ${pend.length ? `<div class="pend-grid2 scroll-y">${pend.map(p => `<span class="pend-chip" title="${esc((p.name || '') + ' · ' + (p.no || ''))}">
              <i>${esc(String(p.name || p.no || '?').trim().slice(0, 1))}</i>
              <b>${esc(p.name || p.no)}</b></span>`).join('')}</div>`
            : '<p class="hint" style="color:var(--ok)">全部完成 ✔ 这一节课没有人掉队</p>'}
        </div>
      </div>
      <p class="hint" style="margin-top:12px">完成率是<b>实时</b>的：后来的人用时更短，就会把前面的人挤下一档（100% → 80% → 70%）。
        这就是竞争 —— <b>再刷一次、把用时压下去就能反超回来</b>（重刷只记更快的那次，慢的不会顶掉好成绩）。结束任务那一刻才冻结。</p>
      ${t.status === 'closed' ? (t.lesson_no
        ? `<p class="hint" style="color:var(--ok)">✓ 分数已冻结并进入「小组加分」· 第 ${t.lesson_no} 次课 · 列名「${esc(jfCol(t.circuit))}」</p>`
        : '<p class="hint" style="color:var(--warn)">⚠ 这个任务没填课次，分数进不了「小组加分」，建议作废重发</p>') : ''}
    </div>`;
  /* 标题随状态走：进行中叫「当前任务」；点「看这份」回看历史时如实标成「历史任务 · 查看中」，
     不让老师误以为这条还活着（2026-11-12 用户反馈后加的）。 */
  foldInto(box, viewing ? '历史任务 · 查看中' : (t.status === 'open' ? '当前任务' : '历史任务 · 查看中'),
    tag, open, note + body, v => { ST.liveOpen = v; paintLive(); });

  $('#lvBoard').onclick = () => window.open('board.html?t=' + t.id, '_blank');
  $('#lvCsv').onclick = () => exportCsv(b);
  const lvLesson = $('#lvLesson'); if (lvLesson) lvLesson.onclick = () => editLesson(t);
  const lvExit = $('#lvExit');
  if (lvExit) lvExit.onclick = async () => { ST.view = null; await pickCurrent(); paintLive(); paintHist(); };
  const jfBtn = $('#lvJf'); if (jfBtn) jfBtn.onclick = () => window.open(JF_URL, '_blank', 'noopener');
  const c1 = $('#lvClose'), c2 = $('#lvVoid');
  if (c1) c1.onclick = async () => {
    if (!confirm('结束这个任务？\n\n结束时会按当前名次算一次分并冻结，之后成绩不再变。')) return;
    c1.disabled = true;
    try {
      /* ★ 顺序很重要（2026-11-12）：先把服务端返回的看板存下来（要拿 lesson_no 拼提示），
         再 reloadTasks + pickCurrent —— pickCurrent 会清空 ST.tip 和 ST.board，
         所以「分数已冻结并写入第 N 次课」必须**在 pickCurrent 之后**再赋值，否则这句提示会凭空消失。
         结束之后这条任务已经是 closed，pickCurrent 找不到 open 的任务 → 当前任务面板进空状态，
         它自己就落到下面的「历史任务」里了（这轮修的就是这个）。 */
      ST.board = await HX.rpc('wire_task_close', { p_task: t.id });
      const nt = (ST.board && ST.board.task) || t;
      await reloadTasks();
      if (ST.stop) { ST.stop(); ST.stop = null; }
      ST.liveOpen = null; // 冻结后自动收起
      ST.view = null;
      await pickCurrent();
      // 结束即入账：把「分数已冻结 + 自动写入小组加分第几次课」说清楚，并给一个直接去看的入口
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
      await reloadTasks();
      if (ST.stop) { ST.stop(); ST.stop = null; }
      ST.liveOpen = null; // 作废后同样收起
      ST.view = null;
      await pickCurrent();   // 作废的这条已经不算「当前任务」，直接落到历史里
      paintLive(); paintHist();
    } catch (e) { alert('作废失败：' + e.message); c2.disabled = false; }
  };
  /* 重新拉起（2026-11-11 用户要求「让没刷的人补刷，再关闭」）：closed → open，
     已完成的旧成绩保留（不删数据），没做的学生补排位自动记上；
     再次结束时 wire_task_close 按全部记录重算冻结 —— 补做的同学更快会让前面的人掉档，
     这是排位规则本身，确认弹窗里要说清楚。 */
  const c3 = $('#lvReopen');
  if (c3) c3.onclick = async () => {
    if (!confirm('重新拉起这个任务？\n\n重开后任务回到「进行中」，没完成的学生可以补做（已完成的旧成绩保留）。\n再次「结束任务」时会按最新名次重新冻结得分：如果补做的同学用时更短，\n前面的人完成率可能掉档（100%→80%），这是排位规则本身。')) return;
    c3.disabled = true;
    try {
      await HX.rpc('wire_task_reopen', { p_task: t.id });
      await reloadTasks();
      if (ST.stop) { ST.stop(); ST.stop = null; }
      ST.liveOpen = null; // 回到进行中 → 自动展开
      ST.view = null;
      await pickCurrent();   // 重新拉起后它又是本班唯一 open 的任务 → 自动占回「当前任务」
      syncPoll();
      ST.tip = '任务已重新拉起：没完成的学生去排位就自动补记，都补完了再点「结束任务」重新冻结得分。';
      paintLive(); paintHist();
    } catch (e) { alert('重新拉起失败：' + e.message); c3.disabled = false; }
  };
}

/* 改课次（2026-11-10）：课次下拉上线前的历史任务走了旧数字框默认 1，分数记错课次。
   老师在这里改课次号（和日期），改完 wire-task-link.js 下次同步会按新课次把分数落对。
   旧的错课次列老师自己到「小组加分」记分页删掉即可（尊重老师手动删列）。 */
async function editLesson(t) {
  const cur = t.lesson_no || '';
  const curDate = t.lesson_date || todayStr();
  const no = prompt('把「' + (t.title || cname(t.circuit)) + '」的课次改到第几次课？\n\n现在：第 ' + (cur || '—') + ' 次课（' + curDate + '）\n改错课次，分数会记到别的课上，务必和「小组加分」里的课次对上。', cur);
  if (no == null) return;
  const n = parseInt(no, 10);
  if (!n || n < 1) { alert('课次号要填 ≥1 的整数'); return; }
  const date = prompt('上课日期（不填保持原样）', curDate);
  try {
    await HX.rpc('wire_task_update_lesson', { p_task: t.id, p_lesson_no: n, p_lesson_date: (date && date.trim()) || null });
    await reloadTasks();
    /* reloadTasks 之后 ST.tasks 里全是新对象，旧 t 已经悬空。
       先 pickCurrent 重新定位「进行中」的任务（它顺手把 ST.view 清空），
       如果刚才改的是历史任务，再把回看指针指回去 —— 否则老师一改课次就被弹回别处。 */
    await pickCurrent();
    if (t.status !== 'open') { ST.view = t.id; await refreshBoard(); }
    ST.tip = '课次已改为第 ' + n + ' 次课，分数会跟着落到正确的课次（旧的错课次列到「小组加分」记分页删掉）。';
    paintLive(); paintHist();
  } catch (e) { alert('改课次失败：' + e.message); }
}

/* 历史任务（2026-11-12 按用户要求改三处）
   ① 默认收起、点标题展开（以前是整张表平铺在页面上，把「当前任务」挤到看不见）；
   ② 只列当前班级的任务 —— 一个老师带几个班时，以前所有班的任务混在一张表里。
   ③ **历史 = 本班所有「非进行中」的任务**（原来写的是 `t.id !== ST.cur.id`，
      于是「当前任务」一旦顶了一条已结束的上来，它就从历史里消失了；
      现在按状态切，正在回看的那条也照样留在历史里，点「看这份」不会让它凭空不见）。 */
function paintHist() {
  const box = $('#hist'); if (!box) return;
  const all = ST.tasks.filter(t => t.status !== 'open');
  const tag = `<span class="tag">${esc(className(ST.cls))} · 共 ${all.length} 个（每个都是一次 5 分项目）</span>`;
  const body = `<div class="body tight"><div class="tbl-wrap scroll-y">
      <table class="tbl"><thead><tr>
        <th>时间</th><th>电路</th><th>课次</th><th class="num">完成</th><th class="num">平均用时</th><th>状态</th><th></th>
      </tr></thead><tbody>
      ${all.length ? all.map(t => `<tr>
        <td>${fmtClock(t.opened_at)}</td><td>${esc(cname(t.circuit))}</td>
        <td>${t.lesson_no || '—'}${t.lesson_date ? '<br><span class="muted" style="font-size:12px">' + esc(t.lesson_date) + '</span>' : ''}</td>
        <td class="num">${t.done}/${t.total}</td><td class="num">${t.avg_sec == null ? '—' : fmtSec(t.avg_sec)}</td>
        <td><span class="state ${t.status}"${t.status === 'closed' && !t.lesson_no ? ' title="没填课次，无法入账"' : ''}>${
          t.status === 'closed' ? '已结束 · 已入账' : statusText(t.status)}</span></td>
        <td>${t.status === 'closed' ? '<button class="btn ghost" data-reopen="' + t.id + '" type="button" title="让没完成的学生补做：任务回到进行中，再次结束时按最新名次重新冻结">重新拉起</button>' : ''}
            <button class="btn ghost" data-look="${t.id}" type="button">看这份</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="muted" style="text-align:center;padding:22px">没有更早的任务</td></tr>'}
      </tbody></table></div></div>`;
  foldInto(box, '历史任务', tag, ST.histOpen, body, v => { ST.histOpen = v; paintHist(); });
  box.querySelectorAll('[data-look]').forEach(btn => btn.onclick = async () => {
    /* 「看这份」= 回看模式：ST.view 指向它，ST.cur（进行中的任务）不受影响。
       原来是把 ST.cur 直接改掉，等于把一条已结束的任务冒充成「当前任务」。 */
    ST.view = +btn.dataset.look;
    ST.tip = '';
    await refreshBoard();
    syncPoll();
    ST.liveOpen = true; // 点「看这份」＝要看详情：面板直接展开
    paintLive(); paintHist();
    $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  /* 历史列表里的「重新拉起」（2026-11-11）：closed 任务让没刷的人补做，逻辑同 paintLive 的 lvReopen */
  box.querySelectorAll('[data-reopen]').forEach(btn => btn.onclick = async () => {
    const id = +btn.dataset.reopen;
    if (!confirm('重新拉起这个任务？\n\n重开后任务回到「进行中」，没完成的学生可以补做（已完成的旧成绩保留）。\n再次「结束任务」时会按最新名次重新冻结得分：如果补做的同学用时更短，\n前面的人完成率可能掉档（100%→80%），这是排位规则本身。')) return;
    btn.disabled = true;
    try {
      await HX.rpc('wire_task_reopen', { p_task: id });
      await reloadTasks();
      ST.tip = '';
      ST.view = null;               // 重开后它变成「进行中」，不再是回看对象
      await pickCurrent();          // pickCurrent 会顺手把这条拉成当前任务并读看板
      syncPoll();
      ST.liveOpen = null;
      paintLive(); paintHist();
      $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { alert('重新拉起失败：' + e.message); btn.disabled = false; }
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
