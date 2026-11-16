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
  binAll: [],        // wire_task_bin()（回收站：老师删掉的任务，所有班）
  bin: [],           // 当前班级的回收站
  cls: null,         // 当前班级 id：课堂任务、历史任务、回收站都只显示这个班（用户要求「按班级隔离」）
  /* ★ 2026-11-16 用户要求「课堂任务支持发布多个 无论是不是同一节课都允许」：
     ST.cur（单个进行中）改成 ST.opens（进行中任务的数组）。一个班可以同时有好几节课的任务，
     甚至同一节课发好几道电路。每张卡各自折叠、各自有看板和按钮。 */
  opens: [],         // 本班所有**进行中**的任务
  view: null,        // 正在回看的历史任务 id：从「历史任务」点「看这份」进来，只读
  boards: {},        // taskId → wire_task_board()（多开以后每张卡一份，不能只存一份）
  mine: null,        // 学生端 wire_task_my_result()
  liveOpen: {},      // 折叠状态：taskId → 是否展开（缺省 = 展开）
  histOpen: false,   // 历史任务面板：默认收起，点标题才展开
  binOpen: false,    // 回收站面板：同上
  busy: false,
  lessons: [],       // 本班在「小组加分」里已有的课次（发布表单的下拉，见 task-lessons.js）
  stop: null,        // 轮询停止函数
  err: '',           // 最近一次读取失败的一句话（轮询成功就自动清掉）
  tip: '',           // 结束/删除任务后那句提示（结束即停轮询，所以它不会被下一轮冲掉）
};
const $ = s => document.querySelector(s);
const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const statusText = s => s === 'open' ? '进行中' : s === 'closed' ? '已结束' : s === 'void' ? '已作废' : s;
// 「小组加分」里的项目列名：接线 + 电路号（如 接线2.3）。
// 这是两边约定的死规则：结束任务时按课次写进那一课，列名就用这个；同一课里已被同名占用时
// 对方会自动加「#任务号」（接线2.3#12），所以这里只显示老师最可能看到的那一个名字。
const jfCol = circuit => '接线' + circuit;
/* 任务列表排序（2026-11-11 用户要求「按班级课次隔离，新课任务在最上面」）：
   进行中的排最前（2026-11-16 起可以同时有多个，"open 最前"这一档仍然有效），
   其余按发布时间倒序 —— 和学生榜 SQL（wire_task_student_list 的
   (status='open') desc, opened_at desc）同一套口径，教师端/学生端/大屏看到的顺序一致。
   wire_task_list 本身只按 opened_at desc 排，open 最前这一档在这里补。 */
const sortTasks = list => (list || []).slice().sort((a, b) =>
  ((b.status === 'open') ? 1 : 0) - ((a.status === 'open') ? 1 : 0) ||
  String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
// 小组加分入口：站点根下的 /jiafenxitong/。SITE 已经按「线上 /wiring-lab/task/ → ../../」算好了。
const JF_URL = SITE + 'jiafenxitong/';

/* ---------------- 启动 ---------------- */
(async function boot() {
  HX.grab(); // GitHub 登录回来时先收凭证
  /* 返回按钮（2026-11-13 初版 → 11-14 改路径 → 11-15 用户最终定「框里不摆」）：
     点「← 接线仿真」回的是上一级 = 接线仿真主页 /wiring-lab/（**不是站点根**，写 HOME 会把
     整个总入口首页装进 iframe，就是那次「冗余首页 + 双返回」）。
     2026-11-15 用户补充：「按理说不需要接线仿真（返回）按钮，只需要点返回就回到上一级即接线仿真的
     排位界面」—— 总入口左上角本来就有「← 返回」，它走 window.HXBack() → goTool()，
     回的就是接线仿真排位界面；页面里再摆一颗功能相同的按钮既重复，又让人以为有两个「上一级」。
     所以：在总入口 iframe 里隐藏它；单独打开这一页（没有外层返回栏）时才保留，否则无路可退。 */
  const backBtn = $('#lvBack');
  if (backBtn) {
    if (window.top !== window) backBtn.style.display = 'none';
    else backBtn.onclick = () => goTool();
  }
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
  try { await loadTasks(); }
  catch (e) { ST.tasksAll = []; ST.binAll = []; ST.err = '任务列表读取失败：' + e.message; }
  /* 2026-11-12（R2）：课堂任务和历史任务都按班级隔离。
     班级上下文就取发布表单那个「班级」下拉（ST.cls）—— 一个老师带好几个班时，
     原来两张表把所有班的任务混在一起，还总把别的班的「进行中」当成当前任务。
     默认落在「有进行中任务」的那个班（老师打开这页多半是来看这节课的），没有就第一个班。 */
  ST.cls = defaultClass();
  ST.tasks = tasksOf(ST.cls);
  ST.bin = binOf(ST.cls);
  ST.liveOpen = {};
  ST.histOpen = false;
  ST.binOpen = false;

  await pickOpen();
  renderTeacher();
  syncPoll();
}

// 当前班级的任务（tasksAll 里只留本班）
const tasksOf = cls => ST.tasksAll.filter(t => Number(t.class_id) === Number(cls));
// 当前班级的回收站（ST.binAll 里只留本班）
const binOf = cls => (ST.binAll || []).filter(t => Number(t.class_id) === Number(cls));
const className = id => (ST.classes.find(c => Number(c.id) === Number(id)) || {}).name || '';
/* 本班「进行中」的任务（2026-11-16 起是数组，可能 0 个、1 个或多个）。
   界面上每一张卡 = 一条 open 任务；点历史里的「看这份」时只渲染那一条（ST.view），
   进行中的任务同时被轮询，但界面上暂时让位给回看的那一条。 */
const openTasks = () => ST.tasks.filter(t => t.status === 'open');
const viewTask = () => (ST.view ? ST.tasks.find(t => t.id === ST.view) : null) || null;
// 重新拉「任务列表 + 回收站」，并保持「只留当前班级」（换班 / 发布 / 结束 / 删除 / 撤销都用这一条）
async function loadTasks() {
  const [list, bin] = await Promise.all([
    HX.rpc('wire_task_list'),
    /* 回收站读失败不该拖垮整页（老库还没跑 2026-11-16 迁移时这个函数不存在） */
    HX.rpc('wire_task_bin').catch(() => []),
  ]);
  ST.tasksAll = sortTasks(list);
  ST.binAll = Array.isArray(bin) ? bin : [];
}
async function reloadTasks() {
  await loadTasks();
  ST.tasks = tasksOf(ST.cls);
  ST.bin = binOf(ST.cls);
}
// 默认班级：优先「有进行中任务」的班（最新的那个），否则第一个班
function defaultClass() {
  const open = ST.tasksAll.find(t => t.status === 'open');
  const id = open ? Number(open.class_id) : Number(ST.classes[0].id);
  return ST.classes.some(c => Number(c.id) === id) ? id : Number(ST.classes[0].id);
}
// 轮询跟着「进行中的任务」走：换班 / 发布 / 结束 / 重新拉起都要重开，否则还在读上一个班的进度
// （在回看历史任务时不轮询：已结束的数据不会变，白打接口）
function syncPoll() {
  if (ST.stop) { ST.stop(); ST.stop = null; }
  if (!ST.opens.length || ST.view) return;
  /* 多开时每张卡一份看板，请求数随任务数线性增长：2 个以上就把间隔从 4 秒放宽到 6 秒，
     别让「一节课发了三道题」把免费版数据库顶住。 */
  const gap = ST.opens.length > 1 ? 6000 : 4000;
  ST.stop = every(gap, async () => { await refreshBoards(); paintLive(); });
}
// 切班：换当前任务、重开轮询、三张表就地重画（发布表单不重画，老师正在填的内容不会被冲掉）
async function setClass(v) {
  const id = Number(v);
  if (!id || id === ST.cls) return;
  ST.cls = id;
  ST.tasks = tasksOf(id);
  ST.bin = binOf(id);
  ST.liveOpen = {}; ST.err = '';
  await pickOpen();
  syncPoll();
  paintLive(); paintHist(); paintBin();
}

/* 重新定位「进行中的任务」。
   ★ 2026-11-12 深夜修（用户原话：「为什么都是当前任务 我都冻结了 为什么还不算历史任务呢」）：
     原来在没有进行中任务时会把**最近一个已结束的任务**顶到「当前任务」里，于是老师刚冻结完，
     抬头一看它还在「当前任务」，历史上却少了一条。现在没有进行中的任务就是空列表。
   ★ 2026-11-16：单个 → 数组（可以同时多个），看板也跟着按任务 id 分别存。 */
async function pickOpen() {
  ST.opens = openTasks();
  ST.view = null;
  ST.boards = {};
  ST.tip = ''; // 换任务就把「刚结束、已入账」那句清掉，免得挂到别的任务上
  if (ST.opens.length) await refreshBoards();
  else ST.boards = {};
}
/* 拉看板：回看模式下只拉那一条，否则把本班每个进行中的任务都拉一份。
   并发拉（Promise.all）—— 串行等三个任务就是三次往返，老师会觉得「点了没反应」。 */
async function refreshBoards() {
  const vt = viewTask();
  const list = vt ? [vt] : ST.opens;
  const boards = {};
  let bad = '';
  await Promise.all(list.map(async t => {
    try { boards[t.id] = await HX.rpc('wire_task_board', { p_task: t.id }); }
    catch (e) { bad = bad || ('进度读取失败：' + e.message); }
  }));
  ST.boards = boards;
  ST.err = bad;
}

/* 折叠面板骨架：标题栏整条可点，收起时只留标题 + 摘要
   （用户 2026-11-12：冻结的任务要收起来，历史任务也要能展开）
   cls：外层 class。顶级面板要 span2（占满 .pg-main 两栏），
   而「当前任务」里嵌套的卡片在 .live-stack 里，不能再加 span2（那是栅格语义，套两层会错）。 */
function foldHead(title, tagHtml, open) {
  return `<h2 class="fold-head"><button class="fold" type="button" aria-expanded="${open}">
      <svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      <span class="fold-t">${esc(title)}</span>${tagHtml || ''}</button></h2>`;
}
function foldInto(box, title, tagHtml, open, body, onToggle, cls) {
  box.className = (cls || 'panel span2') + (open ? '' : ' collapsed');
  box.innerHTML = foldHead(title, tagHtml, open) + body;
  const btn = box.querySelector('.fold');
  if (btn) btn.onclick = () => onToggle(!open);
}

function renderTeacher() {
  const cls = ST.classes;
  /* 「当前任务」这块在多开之后是「卡片堆叠容器 #live」，不再是一整块 panel，
     所以它必须自己带 span2 —— .pg-main 在 ≥1180px 是两栏栅格，只有直接子元素加了
     span2 才占满整行。漏掉它的后果 = 卡片全挤在左半栏、右边一大片空白（2026-11-16 实测截到过）。 */
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
        <small class="hint full" id="fNoInfo"></small>
        <div class="field full"><label for="fTitle">任务名（可改）</label><input id="fTitle" maxlength="60" placeholder="2.3 双重互锁正反转 · 排位"></div>
        <div class="field full"><label for="fNote">任务说明（可选）</label><textarea id="fNote" maxlength="200" placeholder="每人接完并仿真成功，按排位用时给分"></textarea></div>
      </div>
      <div class="acts">
        <button class="btn primary big" id="fGo" type="button">发布任务</button>
        <span class="hint" id="fMsg"></span>
      </div>
      <p class="hint">课次直接选「小组加分」里已有的课次，会显示那节课的日期和主题；<b>这里不再填上课日期</b> —— 日期只认「小组加分」那一课自己的（要新建课次、要改日期，都在「小组加分」里做）。<b>填错课次，分数会记到别的课上</b>。<br>
        可以同时发布多个任务（<b>同一节课发几道电路也行</b>），每个任务都是一个独立的 5 分项目，各自结束、各自入账。<br>
        学生「完成」= 在任务发布之后，把这道电路点排位并仿真成功（不用另外点签到）。</p>
    </div>
  </section>

  <div id="live" class="live-stack span2"><div class="panel"><div class="empty">加载进度…</div></div></div>

  <section class="panel span2" id="hist"><div class="empty">加载历史任务…</div></section>

  <section class="panel span2" id="bin" style="display:none"></section>`;

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
  /* 2026-11-16 删掉了「上课日期」输入框，这里的两行 oninput/onchange 也一起删 ——
     只删 HTML 不删绑定的话 $('#fDate') 是 null，赋 .oninput 直接抛 TypeError，
     顶层脚本中断 = 整个页面空白（2026-11-13 踩过一次）。 */
  buildLessonPicker();
  $('#fGo').onclick = publish;
  paintLive();
  paintHist();
  paintBin();
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

// 选完立刻说清楚「写进哪一课、哪一列」，列已存在当场提醒（别等发布后的横幅）
// 2026-11-16 起这里不再有「上课日期」可比对：日期只认「小组加分」那一课自己的。
function paintLessonInfo() {
  const info = $('#fNoInfo'), box = $('#fNoBox');
  if (!info || !box) return;
  const col = jfCol($('#fCir').value);
  const lines = [];

  if (box.dataset.mode === 'select') {
    const l = pickedLesson();
    if (l) {
      lines.push(`会写进「小组加分」第 <b>${l.seq}</b> 次课（${esc(l.date || '日期未填')} · ${esc(l.topic || '未填主题')}）的「${esc(col)}」列`);
      if (l.wireCols.indexOf(col) >= 0) {
        lines.push(`<span class="warnl">这一课已经有「${esc(col)}」列了，新的成绩会并进去/覆盖</span>`);
      }
    } else {
      const n = nextLessonNo();
      lines.push(`会新建「小组加分」第 <b>${n}</b> 次课（<b>日期留空</b>，到「小组加分」的课次设置里自己填），结束后写入「${esc(col)}」列`);
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
  /* 上课日期：2026-11-16 用户要求「上课时间无需再次填写，删除」。
     理由有二 —— ① 「小组加分」那边已经写过时间了，两处填等于两处可能对不上；
     ② 为了用 Claude 改过电脑时区，换台机器新建任务时「今天」会不一样，日期就写歪了。
     所以这里**不再有自己的日期**：选了已有课次就带那一课自己的日期（那是小组加分的数据），
     「新建第 N 次课」一律留空，老师到「小组加分」的课次设置里自己填（那边本来就能自定义）。 */
  const lessonDate = (picked && picked.date) || null;
  ST.busy = true; $('#fGo').disabled = true; btnWait($('#fGo'), '发布中…'); $('#fMsg').textContent = '发布中…';
  try {
    const r = await HX.rpc('wire_task_open', {
      p_class: cls, p_circuit: cir, p_title: title, p_note: note, p_lesson_no: no, p_lesson_date: lessonDate,
    });
    // 发布成功就把「成绩会落到哪一课、哪一列」说清楚，别让人再猜。
    // 刚发的任务一定属于「当前选中的班」：先锁到那个班再重拉，下面两张表才不会显示成别的班。
    ST.cls = cls;
    await reloadTasks();
    await pickOpen();
    syncPoll();
    // 表单值保留（连着发两个班时省事），只把提示和进度刷新
    paintLive(); paintHist(); paintBin();
    $('#fMsg').innerHTML = `<span style="color:var(--ok)">已发布（任务 #${(r && r.id) || '—'} · 第 ${no} 次课）：学生去排位、接对仿真成功就算完成；结束后分数自动进「小组加分」第 ${no} 次课「${esc(jfCol(cir))}」列${isNew ? '（这一课结束时会自动建）' : ''}。</span>`;
    const live = $('#live'); if (live) live.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    $('#fMsg').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>';
  } finally { ST.busy = false; $('#fGo').disabled = false; btnDone($('#fGo')); }
}

/* 2026-11-15 用户：「按钮点了没反馈，不知道啥时候给结果」。
   这一页是 /wiring-lab/task/ 的独立目录页，没有引 hx-theme.js（HXBusy 不在这里），
   所以只做最小的「换字」：按钮变灰的同时把字也换掉，失败时换回原字。
   不改任何请求顺序，也不碰按钮以外的东西 —— 结束/作废要等云端重算名次，这一两秒最容易被当成卡死。 */
function btnWait(btn, text) { if (!btn) return; btn.dataset.hxOld = btn.innerHTML; btn.textContent = text; }
function btnDone(btn) { if (!btn || btn.dataset.hxOld == null) return; btn.innerHTML = btn.dataset.hxOld; delete btn.dataset.hxOld; }

/* ============================================================================
   当前任务面板（2026-11-16 起一个班可以同时有多个进行中的任务）
   ----------------------------------------------------------------------------
   用户原话：「课堂任务支持发布多个 无论是不是同一节课都允许」。
   于是这一块从「一张卡」变成「一列卡」：每个进行中的任务一张，各自有看板、按钮、折叠状态。
   · 轮询一次刷新全部进行中的任务（见 syncPoll / refreshBoards），间隔按任务数放宽；
   · 折叠状态按任务 id 记在 ST.liveOpen 里，某一张卡重画不会把别的卡连带展开/收起；
   · 回看历史任务（ST.view）时这一块只渲染那一张，进行中的仍照常轮询、只是暂时让位；
   · 顶部一行 tip 是「刚结束 / 刚删除」那类收尾提示 —— 多卡时它不能挂在某一张卡里，
     否则卡一消失（任务被结束就不在进行中列表里了）提示也跟着消失。
   ========================================================================== */
const cardOpen = t => (typeof ST.liveOpen[t.id] === 'boolean' ? ST.liveOpen[t.id] : true);

function paintLive() {
  const box = $('#live'); if (!box) return;
  const vt = viewTask();
  const list = vt ? [vt] : ST.opens;
  const notes = [];
  if (ST.err) notes.push(`<div class="live-tip bad">${esc(ST.err)}</div>`);
  if (ST.tip) notes.push(`<div class="live-tip">${esc(ST.tip)}</div>`);
  if (!list.length) { box.innerHTML = notes.join('') + liveEmpty(); return; }
  box.innerHTML = notes.join('') + list.map(t => liveCard(t, !!vt)).join('');
  list.forEach(t => bindLiveCard(t, !!vt));
}

function liveEmpty() {
  /* 本班没有进行中的任务。
     两种情况要分开说：① 一个任务都没有（引导去发布）；② 有历史任务（引导去历史里看）。 */
  const histN = ST.tasks.filter(x => x.status !== 'open').length;
  const inner = histN
    ? `<div class="empty">这个班现在<b>没有进行中的任务</b>。<br>
       已经结束 / 作废的 <b>${histN}</b> 个都在下面的「历史任务」里，点标题就能展开，进去能看名次和得分，也能「重新拉起」让没做完的学生补做。</div>`
    : `<div class="empty">这个班还没有任务。在上面发布一个吧（<b>同一节课可以发多个</b>）。</div>`;
  return `<section class="panel">${foldHead('当前任务', `<span class="tag">${esc(className(ST.cls))} · 无进行中</span>`, true)}
    <div class="body">${inner}</div></section>`;
}

// 一张「当前任务」卡（t = 任务行，viewing = 是不是在回看历史任务）
function liveCard(t, viewing) {
  const b = ST.boards[t.id];
  const open = cardOpen(t);
  const title = viewing ? '历史任务 · 查看中' : '当前任务';
  const multi = !viewing && ST.opens.length > 1;
  const tag = `<span class="tag">${esc(t.class_name || className(t.class_id))} · ${statusText(t.status)}${t.frozen ? ' · 得分已冻结' : ''}${
    b ? ' · 完成 ' + b.done + '/' + b.total : ''}${multi ? ' · 任务 #' + t.id : ''}</span>`;
  /* 有任务、但进度没读到（网络抖动 / 权限变更）：别假装没有任务，也别让下面的 b.xxx 抛错。 */
  if (!b) {
    return `<section class="panel${open ? '' : ' collapsed'}" data-card="${t.id}">
      ${foldHead(title, tag, open)}
      <div class="body"><div class="empty">进度读取失败（会自动重试；也可以点标题收起再展开重试）</div></div>
    </section>`;
  }
  const rows = b.done_rows || [];
  const pend = b.pending || [];
  const pct = b.pct || 0;
  const canAct = t.status === 'open';
  return `<section class="panel${open ? '' : ' collapsed'}" data-card="${t.id}">
    ${foldHead(title, tag, open)}
    <div class="body">
      <div class="task-head">
        <div style="min-width:0;flex:1">
          <b>${esc(t.title || cname(t.circuit))}</b>
          <div class="meta">${esc(cname(t.circuit))} · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''} · 发布于 ${fmtClock(t.opened_at)}${t.closed_at ? ' · 结束于 ' + fmtClock(t.closed_at) : ''}</div>
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
        <button class="btn" data-act="board" type="button">打开大屏（投影）</button>
        ${canAct ? '<button class="btn primary" data-act="close" type="button">结束任务并冻结得分</button><button class="btn danger" data-act="void" type="button">作废</button>' : ''}
        <button class="btn ghost" data-act="lesson" type="button" title="课次填错了就改这里，分数会跟着落到正确的课次">改课次</button>
        ${t.status === 'closed' ? '<button class="btn" data-act="jf" type="button">打开小组加分</button>' : ''}
        ${t.status === 'closed' ? '<button class="btn primary" data-act="reopen" type="button" title="让没完成的学生补做：任务回到进行中，再次结束时按最新名次重新冻结得分">重新拉起（补做）</button>' : ''}
        ${viewing ? '<button class="btn ghost" data-act="exit" type="button" title="回看结束，回到本班的当前任务">退出查看</button>' : ''}
        <button class="btn ghost" data-act="csv" type="button">导出名单 CSV</button>
        <button class="btn danger" data-act="del" type="button" title="删错了可以在下面的「回收站」里撤销删除">删除任务</button>
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
        : '<p class="hint" style="color:var(--warn)">⚠ 这个任务没填课次，分数进不了「小组加分」，建议删除重发</p>') : ''}
    </div>
  </section>`;
}

function bindLiveCard(t, viewing) {
  const card = document.querySelector('#live [data-card="' + t.id + '"]');
  if (!card) return;
  const b = ST.boards[t.id];
  const on = (sel, fn) => { const el = card.querySelector(sel); if (el) el.onclick = () => fn(el); };
  on('.fold', () => { ST.liveOpen[t.id] = !cardOpen(t); paintLive(); });
  on('[data-act="board"]', () => window.open('board.html?t=' + t.id, '_blank'));
  on('[data-act="csv"]', () => { if (b) exportCsv(b); });
  on('[data-act="lesson"]', () => editLesson(t));
  on('[data-act="exit"]', async () => { ST.view = null; await pickOpen(); syncPoll(); paintLive(); paintHist(); });
  on('[data-act="jf"]', () => window.open(JF_URL, '_blank', 'noopener'));
  on('[data-act="close"]', btn => closeTask(t, btn));
  on('[data-act="void"]', btn => voidTask(t, btn));
  on('[data-act="del"]', btn => deleteTask(t, btn));
  on('[data-act="reopen"]', btn => reopenTask(t, btn));
}

/* 结束任务并冻结得分。
   ★ 顺序很重要（2026-11-12）：pickOpen 会清空 ST.tip，所以「分数已冻结并写入第 N 次课」
     必须**在 pickOpen 之后**再赋值，否则这句提示会凭空消失。 */
async function closeTask(t, btn) {
  if (!confirm('结束「' + (t.title || cname(t.circuit)) + '」？\n\n结束时会按当前名次算一次分并冻结，之后成绩不再变。')) return;
  btn.disabled = true; btnWait(btn, '结束中…');
  try {
    const nb = await HX.rpc('wire_task_close', { p_task: t.id });
    const nt = (nb && nb.task) || t;
    await reloadTasks();
    ST.view = null;
    await pickOpen();
    syncPoll();
    ST.tip = nt.lesson_no
      ? '「' + (nt.title || cname(nt.circuit)) + '」分数已冻结，并自动写入「小组加分」第 ' + nt.lesson_no + ' 次课的「' + jfCol(nt.circuit) + '」列（不用导出 CSV）。'
      : '「' + (nt.title || cname(nt.circuit)) + '」分数已冻结。这个任务没填课次，分数进不了「小组加分」，建议删除重发。';
    paintLive(); paintHist(); paintBin();
  } catch (e) { alert('结束失败：' + e.message); btn.disabled = false; btnDone(btn); }
}

async function voidTask(t, btn) {
  if (!confirm('作废「' + (t.title || cname(t.circuit)) + '」？\n\n作废后不计分（记录保留），适合发错班/发错题。')) return;
  btn.disabled = true; btnWait(btn, '作废中…');
  try {
    await HX.rpc('wire_task_void', { p_task: t.id });
    await reloadTasks();
    ST.view = null;
    await pickOpen();
    syncPoll();
    paintLive(); paintHist(); paintBin();
  } catch (e) { alert('作废失败：' + e.message); btn.disabled = false; btnDone(btn); }
}

/* 重新拉起（2026-11-11 用户要求「让没刷的人补刷，再关闭」）：closed → open，
   已完成的旧成绩保留（不删数据），没做的学生补排位自动记上；
   再次结束时 wire_task_close 按全部记录重算冻结 —— 补做的同学更快会让前面的人掉档，
   这是排位规则本身，确认弹窗里要说清楚。 */
async function reopenTask(t, btn) {
  if (!confirm('重新拉起「' + (t.title || cname(t.circuit)) + '」？\n\n重开后任务回到「进行中」，没完成的学生可以补做（已完成的旧成绩保留）。\n再次「结束任务」时会按最新名次重新冻结得分：如果补做的同学用时更短，\n前面的人完成率可能掉档（100%→80%），这是排位规则本身。')) return;
  btn.disabled = true; btnWait(btn, '重新拉起中…');
  try {
    await HX.rpc('wire_task_reopen', { p_task: t.id });
    await reloadTasks();
    ST.view = null;
    await pickOpen();
    syncPoll();
    ST.tip = '「' + (t.title || cname(t.circuit)) + '」已重新拉起：没完成的学生去排位就自动补记，都补完了再点「结束任务」重新冻结得分。';
    paintLive(); paintHist(); paintBin();
  } catch (e) { alert('重新拉起失败：' + e.message); btn.disabled = false; btnDone(btn); }
}

/* 删除任务（2026-11-16 用户要求：「发布错了不能只有冻结 在历史记录不好看 支持删除和撤销删除
   删除任务那分数情况也全部绑定删除 防止有的学生手速快比别人多这个分不公平」）。
   服务端只打一个 deleted_at（软删除），所以撤销删除能原样恢复；「分数一起删」由
   小组加分/wire-task-link.js 在下次同步时把那一列整列删掉（见那边文件头 ④）。 */
async function deleteTask(t, btn) {
  const nm = t.title || cname(t.circuit);
  const msg = '删除「' + nm + '」？\n\n'
    + (t.done ? '已经有 ' + t.done + ' 人完成。\n\n' : '')
    + '删除后：\n'
    + '· 它不再出现在「历史任务」里（挪到下面的「回收站」）；\n'
    + '· 它已经写进「小组加分」的那一列分数会跟着一起删掉（否则先刷完的人就白拿这 5 分）；\n'
    + '· 学生端也看不到它了。\n\n'
    + '删错了到「回收站」点「撤销删除」就能恢复：完成记录一条没丢，分数也会写回去。';
  if (!confirm(msg)) return;
  btn.disabled = true; btnWait(btn, '删除中…');
  try {
    await HX.rpc('wire_task_delete', { p_task: t.id });
    await reloadTasks();
    ST.view = null;
    await pickOpen();
    syncPoll();
    ST.tip = '「' + nm + '」已删除。它写进「小组加分」的那一列分数会在下次打开「小组加分」时一并删掉；删错了到下面「回收站」点「撤销删除」。';
    paintLive(); paintHist(); paintBin();
  } catch (e) { alert('删除失败：' + e.message); btn.disabled = false; btnDone(btn); }
}

/* 改课次（2026-11-10）：课次下拉上线前的历史任务走了旧数字框默认 1，分数记错课次。
   老师在这里改课次号，改完 wire-task-link.js 下次同步会按新课次把分数落对。
   旧的错课次列老师自己到「小组加分」记分页删掉即可（尊重老师手动删列）。
   ★ 2026-11-16 起不再问「上课日期」：用户要求课堂任务不自己绑时间。改完课次后，
     日期自动取「小组加分」里那一课自己的日期（取不到就留空），老师要改日期去小组加分改。 */
async function editLesson(t) {
  const cur = t.lesson_no || '';
  const L = window.HX_LESSONS;
  const list = (L && typeof L.list === 'function') ? L.list(L.read(), t.class_id) : [];
  const hit = list.find(l => Number(l.seq) === Number(cur));
  const no = prompt('把「' + (t.title || cname(t.circuit)) + '」的课次改到第几次课？\n\n现在：第 ' + (cur || '—') + ' 次课' + (hit ? '（' + (hit.date || '日期未填') + ' · ' + (hit.topic || '未填主题') + '）' : '')
    + '\n改错课次，分数会记到别的课上，务必和「小组加分」里的课次对上。', cur);
  if (no == null) return;
  const n = parseInt(no, 10);
  if (!n || n < 1) { alert('课次号要填 ≥1 的整数'); return; }
  /* 日期跟着「小组加分」那一课走：找到就把它的日期同步过来，找不到（这一课还没建）就留空，
     绝不拿本机「今天」顶上 —— 电脑时区被改过，today 不一定是真的今天。 */
  const target = list.find(l => Number(l.seq) === n);
  const lessonDate = (target && target.date) || null;
  try {
    await HX.rpc('wire_task_update_lesson', { p_task: t.id, p_lesson_no: n, p_lesson_date: lessonDate });
    await reloadTasks();
    /* reloadTasks 之后 ST.tasks 里全是新对象，旧 t 已经悬空。
       先 pickOpen 重新定位「进行中」的任务（它顺手把 ST.view 清空），
       如果刚才改的是历史任务，再把回看指针指回去 —— 否则老师一改课次就被弹回别处。 */
    await pickOpen();
    if (t.status !== 'open') { ST.view = t.id; await refreshBoards(); }
    ST.tip = '课次已改为第 ' + n + ' 次课，分数会跟着落到正确的课次（旧的错课次列到「小组加分」记分页删掉）。';
    paintLive(); paintHist(); paintBin();
  } catch (e) { alert('改课次失败：' + e.message); }
}

/* 历史任务（2026-11-12 按用户要求改三处；2026-11-16 加「删除」）
   ① 默认收起、点标题展开（以前是整张表平铺在页面上，把「当前任务」挤到看不见）；
   ② 只列当前班级的任务 —— 一个老师带几个班时，以前所有班的任务混在一张表里。
   ③ **历史 = 本班所有「非进行中」且没被删除的任务**（原来写的是 `t.id !== ST.cur.id`，
      于是「当前任务」一旦顶了一条已结束的上来，它就从历史里消失了；
      现在按状态切，正在回看的那条也照样留在历史里，点「看这份」不会让它凭空不见）。
      删掉的任务不进这里（用户：「在历史记录不好看」）—— 它们在下面的「回收站」里。 */
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
            <button class="btn ghost" data-look="${t.id}" type="button">看这份</button>
            <button class="btn danger" data-del="${t.id}" type="button" title="删掉它，分数也一起删；删错了在回收站里撤销删除">删除</button></td></tr>`).join('')
        : '<tr><td colspan="7" class="muted" style="text-align:center;padding:22px">没有更早的任务</td></tr>'}
      </tbody></table></div></div>`;
  foldInto(box, '历史任务', tag, ST.histOpen, body, v => { ST.histOpen = v; paintHist(); });
  box.querySelectorAll('[data-look]').forEach(btn => btn.onclick = async () => {
    /* 「看这份」= 回看模式：ST.view 指向它，进行中的任务不受影响。
       原来是把「当前任务」直接改掉，等于把一条已结束的任务冒充成「当前任务」。 */
    btnWait(btn, '读取中…');
    ST.view = +btn.dataset.look;
    ST.tip = '';
    await refreshBoards();
    syncPoll();
    ST.liveOpen[ST.view] = true; // 点「看这份」＝要看详情：那张卡直接展开
    paintLive(); paintHist();
    $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  box.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
    const t = ST.tasks.find(x => x.id === +btn.dataset.del);
    if (!t) return;
    if (ST.view === t.id) { ST.view = null; }
    await deleteTask(t, btn);
  });
  /* 历史列表里的「重新拉起」（2026-11-11）：closed 任务让没刷的人补做 */
  box.querySelectorAll('[data-reopen]').forEach(btn => btn.onclick = async () => {
    const t = ST.tasks.find(x => x.id === +btn.dataset.reopen);
    if (!t) return;
    await reopenTask(t, btn);
    $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ============================================================================
   回收站（2026-11-16）
   ----------------------------------------------------------------------------
   用户原话：「发布错了不能只有冻结 在历史记录不好看 支持删除和撤销删除」。
   删掉的任务进这里，不进历史、不计分、学生看不到；点「撤销删除」原样回来。
   ★ 没有已删除的任务时整块面板藏起来（display:none），页面上不留一块空表。
   ========================================================================== */
function paintBin() {
  const box = $('#bin'); if (!box) return;
  const all = ST.bin || [];
  if (!all.length) { box.style.display = 'none'; box.innerHTML = ''; box.className = 'panel span2'; return; }
  box.style.display = '';
  const body = `<div class="body tight"><div class="tbl-wrap scroll-y">
      <table class="tbl"><thead><tr>
        <th>删除时间</th><th>电路</th><th>课次</th><th class="num">完成</th><th>原状态</th><th></th>
      </tr></thead><tbody>
      ${all.map(t => `<tr>
        <td>${fmtClock(t.deleted_at)}</td><td>${esc(cname(t.circuit))}</td>
        <td>${t.lesson_no || '—'}${t.lesson_date ? '<br><span class="muted" style="font-size:12px">' + esc(t.lesson_date) + '</span>' : ''}</td>
        <td class="num">${t.done}/${t.total}</td>
        <td><span class="state ${t.status}">${statusText(t.status)}</span></td>
        <td><button class="btn ghost" data-restore="${t.id}" type="button">撤销删除</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint">这里的任务不进历史、不计分、学生也看不到。撤销删除后任务回到原来的状态，完成记录一条没丢；
        它写进「小组加分」的那一列分数，会在下次打开「小组加分」时自动写回去。</p></div>`;
  foldInto(box, '回收站', `<span class="tag">${esc(className(ST.cls))} · 已删除 ${all.length} 个</span>`, ST.binOpen, body, v => { ST.binOpen = v; paintBin(); });
  box.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = async () => {
    const t = (ST.bin || []).find(x => x.id === +btn.dataset.restore);
    if (!t) return;
    btn.disabled = true; btnWait(btn, '恢复中…');
    try {
      await HX.rpc('wire_task_restore', { p_task: t.id });
      await reloadTasks();
      await pickOpen();
      syncPoll();
      ST.tip = '「' + (t.title || cname(t.circuit)) + '」已撤销删除：任务回到原来的状态，成绩记录都在；打开「小组加分」会自动把那一列分数写回去。';
      paintLive(); paintHist(); paintBin();
    } catch (e) { alert('撤销删除失败：' + e.message); btn.disabled = false; btnDone(btn); }
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
   ----------------------------------------------------------------------------
   2026-11-16：老师可以同时发布多个任务（同一节课也能发多个），所以这里改成
   「一条任务一张卡」—— 每条显示自己的状态/用时/名次/得分，不再只显示最新那一条。
   数据来自 wire_task_my_result() 的 items（open 排前、最多 10 条）；
   items 缺失时退回老字段 task/mine，老库没跑迁移也不白屏。
   ========================================================================== */
async function studentView() {
  const main = $('#main');
  const one = (t, m, total, done) => `
      <section class="panel span2">
        <h2>${t.status === 'open' ? '本节课任务' : '已结束的任务'} <span class="tag">${esc(statusText(t.status))} · 第 ${t.lesson_no || '—'} 次课</span></h2>
        <div class="body">
          <div class="task-head">
            <div style="min-width:0;flex:1">
              <b>${esc(t.title || cname(t.circuit))}</b>
              <div class="meta">${esc(cname(t.circuit))} · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''} · 发布于 ${fmtClock(t.opened_at)}</div>
            </div>
            <span class="state ${t.status}">${statusText(t.status)}</span>
          </div>
          ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
          <div class="mine-card" style="margin-top:16px">
            <div class="kpi ${m.finished ? 'mine-done' : 'mine-todo'}"><em>我的状态</em><b>${m.finished ? '已完成' : '还没完成'}</b></div>
            <div class="kpi"><em>我的用时</em><b>${fmtSec(m.sec)}</b></div>
            <div class="kpi"><em>${t.status === 'open' ? '当前名次' : '最终名次'}</em><b>${m.place == null ? '—' : '第 ' + m.place + ' 名'}</b></div>
            <div class="kpi"><em>完成率 / 得分</em><b>${m.finished ? rateText(m.rate) + ' · ' + scoreText(m.score) : '—'}</b></div>
          </div>
          <div class="kpis">
            <div class="kpi"><em>全班已完成</em><b>${done}<small>/ ${total}</small></b></div>
          </div>
          <p class="hint">${m.finished
            ? (t.status === 'open'
              ? '你已经算完成。名次会随更快的同学完成而实时变化；老师结束任务时冻结最终得分。'
              : '这个任务的得分已经冻结，老师不用再操作了。')
            : '去「接线仿真」里选这道电路，点右上角「排位」，全部接对仿真成功就自动算完成（不用在这里点任何按钮）。'}
            <br>赋分：第 1–10 名 100%（5 分）· 第 11–20 名 80%（4 分）· 其余已完成 70%（3.5 分）。</p>
          <div class="acts"><a class="btn primary big" href="${TOOL}">去排位</a></div>
        </div>
      </section>`;
  const paint = () => {
    const d = ST.mine;
    if (!d || !d.student) { main.innerHTML = `<div class="panel span2"><div class="empty">名单里没有绑定你的学号，请找老师</div></div>`; return; }
    const items = (Array.isArray(d.items) && d.items.length)
      ? d.items
      : (d.task ? [{ task: d.task, mine: d.mine, total: d.total, done: d.done }] : []);
    if (!items.length) {
      main.innerHTML = `<div class="panel span2"><div class="empty">老师还没发布课堂任务。<br>等发布了这里会显示「你有没有完成」「现在第几名」「能拿几分」。</div></div>`;
      return;
    }
    const opens = items.filter(x => x.task.status === 'open').length;
    main.innerHTML = (opens > 1
      ? `<div class="panel span2"><div class="body"><p class="hint" style="margin:0">现在有 <b>${opens}</b> 个进行中的任务，<b>每一个都要做</b>（各算一个 5 分项目）。</p></div></div>`
      : '') + items.map(x => one(x.task, x.mine || {}, x.total, x.done)).join('');
  };
  try { ST.mine = await HX.rpc('wire_task_my_result'); } catch (e) { return gate('读取任务失败', esc(e.message), true); }
  paint();
  const anyOpen = () => ((ST.mine && ST.mine.items) || []).some(x => x && x.task && x.task.status === 'open')
    || (ST.mine && ST.mine.task && ST.mine.task.status === 'open');
  if (anyOpen()) {
    ST.stop = every(5000, async () => { try { ST.mine = await HX.rpc('wire_task_my_result'); paint(); } catch (e) { } });
  }
}
