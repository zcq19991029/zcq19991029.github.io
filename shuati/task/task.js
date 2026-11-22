/* ============================================================================
   刷题 · 课堂任务 · 页面逻辑（2026-11-22）
   ----------------------------------------------------------------------------
   照 接线仿真/src/task.js 的结构：
     · 先用 hx_me 认身份，老师/管理员/开发者进教师端，学生进学生端；
     · 教师端「左边选题、右边发布 + 任务列表」，一屏填完，不在教室里点来点去；
     · 学生端「任务卡 → 逐题作答 → 成绩页」，支持带图选项（symbols.js 的 figSvg）。
   数据全走 task-hx.js 里的 RPC，判分和「只升不降」全在数据库（hx_quiz_task_submit），
   前端不自己算分 —— 否则学生改一下 JS 就能改成绩。
   ========================================================================== */
import {
  hx, $, esc, typeName, statusText, fmtSec, fmtClock, fmtScore, mdStr, todayStr,
  taskList, taskGet, taskSubmit, taskReview, jIcon,
} from './task-hx.js';
import { figSvg } from '../symbols.js';

const S = {
  me: null,
  cls: 0,            // 当前班级 id
  classes: [],       // hx_my_classes
  tasks: [],         // hx_quiz_task_list
  banks: [],         // 可选的题库（quiz_public_list 里 target_classes 含本班或为空）
  bank: '',          // 当前题库 id
  qs: [],            // 当前题库的题（老师端带 answer，学生端不走这里）
  picked: new Set(), // 已选 qid，Set 的插入顺序就是题序
  types: new Set(['single', 'judgment', 'fill']),
  chapter: '',
  kw: '',
  page: 0,
  pageSize: 20,
  busy: false,
  quiz: null,        // { task, questions, mine } —— 学生作答中
  answers: {},       // { qid: ['C'] } / { qid: ['12','7'] }
  idx: 0,
  started: 0,
  result: null,      // { r, review, answers, task }
};
const MAIN = () => $('#main');

/* ---------------- 启动 ---------------- */
(async function boot() {
  if (!hx.signedIn()) {
    return gate('先登录再用课堂任务',
      '课堂任务和刷题共用华夏工具账号。<br>登录后回到这一页，就能按班级发题/做题。', true);
  }
  let me;
  try { me = await hx.me(); }
  catch (e) { return gate('读取身份失败', esc(e.message), true); }
  if (!me) return gate('读取身份失败', '账号状态没读到，请刷新重试。', true);

  S.me = me;
  paintWho(me);
  if (me.teacher || me.admin || me.dev) return teacherView();
  if (me.student) return studentView();
  return gate('账号还没开通',
    '教师用教师码、学生用课堂码开通后就能用。<br>在华夏工具首页填邀请码即可。', true);
})();

function paintWho(me) {
  const nm = (me.student && (me.student.name || me.student.no)) || me.title || '';
  $('#who').textContent = nm;
}

function gate(title, msg, login) {
  const box = $('#gate');
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `<div class="box">
    <b>${esc(title)}</b>
    <p>${msg}</p>
    ${login ? '<a class="qt-btn primary big" href="../../" target="_top">去首页登录</a>' : ''}
  </div>`;
  MAIN().innerHTML = '';
}

/* ============================================================================
   教师端
   ========================================================================== */
async function teacherView() {
  MAIN().className = 'qt-main';
  MAIN().innerHTML = '<div class="qt-panel"><div class="qt-empty">读取班级…</div></div>';
  try {
    S.classes = await hx.rpc('hx_my_classes');
  } catch (e) { return gate('读取班级失败', esc(e.message)); }
  if (!S.classes || !S.classes.length) {
    return gate('还没有班级',
      '先在华夏工具首页的「班级」里导入名单，再回来发布课堂任务。');
  }

  S.cls = Number(S.classes[0].id);
  await Promise.all([loadTasks(), loadBanks()]);
  renderTeacher();
  await chooseBank(S.banks[0] && S.banks[0].id);
}

async function loadTasks() {
  try { S.tasks = (await taskList(S.cls)) || []; S.err = ''; }
  catch (e) { S.tasks = []; S.err = '任务列表读取失败：' + e.message; }
}

/* 题库可见范围：老师自己的 + 发给这个班的；target_classes 为 NULL（全部学生）或空数组
   （只自己刷）也算「可用」—— 这两份内置题库现在就是空数组，不列出来老师根本没题可选。 */
async function loadBanks() {
  let list = [];
  try { list = await hx.rpc('quiz_public_list'); } catch (e) { list = []; }
  S.banks = (list || []).filter(b => {
    const ids = Array.isArray(b.class_ids) ? b.class_ids.map(Number) : [];
    return !ids.length || ids.includes(Number(S.cls));
  });
}

const className = id => (S.classes.find(c => Number(c.id) === Number(id)) || {}).name || '';
const classTotal = id => Number((S.classes.find(c => Number(c.id) === Number(id)) || {}).total || 0);

function renderTeacher() {
  MAIN().className = 'qt-main cols2';
  MAIN().innerHTML = `
  <div class="qt-col">
    <section class="qt-panel">
      <h2>① 选题 <span class="qt-tag" id="bankTag">—</span></h2>
      <div class="qt-body">
        <div class="qt-form">
          <div class="qt-field"><label for="fCls">班级</label>
            <select id="fCls">${S.classes.map(c =>
              `<option value="${c.id}"${Number(c.id) === Number(S.cls) ? ' selected' : ''}>${esc(c.name)}${c.term ? ' · ' + esc(c.term) : ''}（${c.total} 人）</option>`).join('')}</select>
          </div>
          <div class="qt-field"><label for="fBank">题库</label>
            <select id="fBank"></select>
          </div>
        </div>
        <div class="qt-filters">
          <div id="fTypes" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          <select id="fChapter" aria-label="章节"></select>
          <input id="fKw" type="search" placeholder="搜题干关键词…" aria-label="搜索题目">
          <button class="qt-chip" id="fReset" type="button">重置筛选</button>
        </div>
        <div class="qt-selbar" id="selbar"></div>
        <div class="qt-qlist" id="qlist"></div>
        <div class="qt-pagebar" id="pagebar"></div>
      </div>
    </section>
  </div>

  <div class="qt-col">
    <section class="qt-panel">
      <h2>② 发布设置</h2>
      <div class="qt-body">
        <div class="qt-form">
          <div class="qt-field full"><label for="fTitle">任务标题</label>
            <input id="fTitle" maxlength="60" placeholder="课堂任务 11-22 第1次课">
          </div>
          <div class="qt-field"><label for="fLessonNo">第几次课（可空）</label>
            <input id="fLessonNo" type="number" min="1" max="999" inputmode="numeric">
          </div>
          <div class="qt-field"><label for="fLessonDate">上课日期（默认今天，决定记到小组加分哪节课）</label>
            <input id="fLessonDate" type="date">
          </div>
          <div class="qt-field"><label for="fFull">满分</label>
            <input id="fFull" type="number" min="1" max="50" step="0.5" value="5">
          </div>
        </div>
        <div class="qt-form" style="margin-top:12px">
          <div class="qt-field full"><label for="fNote">备注（可选）</label>
            <textarea id="fNote" maxlength="200" placeholder="做完交卷，按准确率给分"></textarea>
          </div>
        </div>
        <div class="qt-acts">
          <button class="qt-btn primary big" id="fGo" type="button">发布任务</button>
          <span class="qt-msg" id="fMsg"></span>
        </div>
        <p class="qt-hint">发布后学生打开「刷题 → 课堂任务」就能看到；<b>一人一次，重复提交只升不降</b>。<br>
          课次用于「小组加分」按课次入账；不填也能发，但那边找不到课次。<br>
          同一个班可以同时发多个任务，也可以对已发的任务点「再发一次」重复练。</p>
      </div>
    </section>

    <section class="qt-panel">
      <h2>任务列表 <span class="qt-tag" id="tasksTag"></span></h2>
      <div class="qt-body" id="tasks"></div>
    </section>
  </div>`;

  // 班级 / 题库切换
  $('#fCls').onchange = async () => {
    S.cls = Number($('#fCls').value);
    S.picked.clear(); S.qs = []; S.bank = ''; S.page = 0; S.chapter = ''; S.kw = '';
    await Promise.all([loadTasks(), loadBanks()]);
    paintBankOptions();
    paintTasks();
    if (!S.banks.length) {
      $('#fBank').innerHTML = '<option value="">这个班没有可用题库</option>';
      paintFilterTypes(); paintChapters(); paintList();
      return;
    }
    await chooseBank(S.banks[0].id);
    if ($('#fTitle') && !$('#fTitle').dataset.touched) $('#fTitle').value = defaultTitle();
  };
  $('#fBank').onchange = () => chooseBank($('#fBank').value);
  $('#fTypes').onclick = e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    const t = b.dataset.type;
    if (S.types.has(t)) S.types.delete(t); else S.types.add(t);
    S.page = 0;
    paintFilterTypes(); paintList();
  };
  $('#fChapter').onchange = () => { S.chapter = $('#fChapter').value; S.page = 0; paintList(); };
  $('#fKw').oninput = () => { S.kw = $('#fKw').value; S.page = 0; paintList(); };
  $('#fReset').onclick = () => {
    S.types = new Set(['single', 'judgment', 'fill']); S.chapter = ''; S.kw = '';
    $('#fKw').value = ''; S.page = 0;
    paintFilterTypes(); paintChapters(); paintList();
  };
  $('#fTitle').oninput = () => { $('#fTitle').dataset.touched = '1'; };
  $('#fGo').onclick = publish;

  paintBankOptions();
  paintFilterTypes();
  paintChapters();
  paintList();
  paintTasks();
  $('#fLessonNo').value = nextLessonNo();
  /* 2026-11-22：日期默认就是今天 —— 小组加分的入账按日期找课次（quiz-task-link.js），
     留空会退回「课次号」，而课次号是刷题任务自己的计数器，和记分表的课次序号不是一套。 */
  $('#fLessonDate').value = todayStr();
  $('#fTitle').value = defaultTitle();
}

function defaultTitle() {
  return `课堂任务 ${mdStr()} 第${nextLessonNo()}次课`;
}
function nextLessonNo() {
  const max = S.tasks.reduce((a, t) => Math.max(a, Number(t.lesson_no) || 0), 0);
  return max + 1;
}

function paintBankOptions() {
  const sel = $('#fBank');
  if (!sel) return;
  sel.innerHTML = S.banks.length
    ? S.banks.map(b => `<option value="${esc(b.id)}"${b.id === S.bank ? ' selected' : ''}>${esc(b.name)}（${b.total} 题）</option>`).join('')
    : '<option value="">没有可用题库</option>';
  if (!S.bank && S.banks.length) S.bank = S.banks[0].id, sel.value = S.bank;
}

async function chooseBank(id, keepPicked) {
  if (!id) { S.bank = ''; S.qs = []; paintList(); return; }
  S.bank = id;
  if (!keepPicked) S.picked.clear();
  S.page = 0; S.chapter = ''; S.kw = '';
  const kw = $('#fKw'); if (kw) kw.value = '';
  painting(true);
  try {
    const d = await hx.rpc('quiz_public_get', { p_id: id });
    S.qs = (d && d.questions) || [];
    const tag = $('#bankTag');
    if (tag) tag.textContent = `${d && d.name || ''} · ${S.qs.length} 题`;
  } catch (e) {
    S.qs = [];
    toast($('#fMsg'), '题库读取失败：' + e.message, 'bad');
  } finally { painting(false); }
  paintChapters();
  paintList();
}

function painting(on) {
  const list = $('#qlist');
  if (list && on) list.innerHTML = '<div class="qt-empty">读取题库…</div>';
}

const chapterOf = q => {
  const sec = String(q.sec || '').trim();
  if (sec) {
    const first = sec.split(/[.．、\/·]/)[0].trim();
    return first || sec;
  }
  return q.chapter ? String(q.chapter).trim() : '未分章';
};
const chapterLabel = q => q.secTitle || q.chapter || chapterOf(q);

function paintFilterTypes() {
  const box = $('#fTypes');
  if (!box) return;
  box.innerHTML = [['single', '单选'], ['judgment', '判断'], ['fill', '填空']]
    .map(([t, n]) => `<button class="qt-chip${S.types.has(t) ? ' on' : ''}" data-type="${t}" type="button">${n}</button>`)
    .join('');
}

function paintChapters() {
  const sel = $('#fChapter');
  if (!sel) return;
  const set = new Set(S.qs.map(chapterOf));
  if (S.chapter && !set.has(S.chapter)) S.chapter = '';
  sel.innerHTML = '<option value="">全部章节</option>' + [...set].map(c =>
    `<option value="${esc(c)}"${c === S.chapter ? ' selected' : ''}>${esc(c)}</option>`).join('');
}

function filtered() {
  const kw = S.kw.trim().toLowerCase();
  return S.qs.filter(q => {
    if (!S.types.has(q.type)) return false;
    if (S.chapter && chapterOf(q) !== S.chapter) return false;
    if (kw) {
      const hay = [q.stem, q.explanation, ...(q.options || []).map(o => o.text)].join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function isPicked(id) { return S.picked.has(id); }

function paintList() {
  const box = $('#qlist');
  if (!box) return;
  const all = filtered();
  const pages = Math.max(1, Math.ceil(all.length / S.pageSize));
  if (S.page >= pages) S.page = pages - 1;
  const start = S.page * S.pageSize;
  const view = all.slice(start, start + S.pageSize);

  if (!S.qs.length) {
    box.innerHTML = '<div class="qt-empty"><b>还没有选题库</b>这个班没有可用题库，或者题库读取失败。</div>';
  } else if (!all.length) {
    box.innerHTML = '<div class="qt-empty">当前筛选下没有题。<br>换个题型 / 章节，或点「重置筛选」。</div>';
  } else {
    box.innerHTML = view.map(q => {
      const on = isPicked(q.id);
      const no = S.qs.findIndex(x => x.id === q.id) + 1;
      return `<label class="qt-qrow${on ? ' on' : ''}">
        <input type="checkbox" data-id="${esc(q.id)}"${on ? ' checked' : ''}>
        <span style="min-width:0">
          <span class="qt-qstem">${esc(q.stem)}</span>
          <span class="qt-qmeta">
            <i class="t">${esc(typeName(q.type))}</i>
            <i>${esc(chapterLabel(q))}</i>
            ${q.fig ? '<i>带图</i>' : ''}
          </span>
        </span>
        <span class="qt-qno">${no}</span>
      </label>`;
    }).join('');
  }

  box.onchange = e => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    const id = cb.dataset.id;
    if (cb.checked) S.picked.add(id); else S.picked.delete(id);
    cb.closest('.qt-qrow').classList.toggle('on', cb.checked);
    paintSelbar();
  };

  paintSelbar();
  const pg = $('#pagebar');
  if (pg) {
    pg.innerHTML = all.length
      ? `<span>共 ${all.length} 题 · 第 ${S.page + 1}/${pages} 页</span>
         <button class="qt-btn sm ghost" id="pgPrev" type="button"${S.page <= 0 ? ' disabled' : ''}>上一页</button>
         <button class="qt-btn sm ghost" id="pgNext" type="button"${S.page >= pages - 1 ? ' disabled' : ''}>下一页</button>`
      : '';
    const prev = $('#pgPrev'), next = $('#pgNext');
    if (prev) prev.onclick = () => { S.page--; paintList(); };
    if (next) next.onclick = () => { S.page++; paintList(); };
  }
  const tag = $('#bankTag');
  if (tag && S.qs.length) tag.textContent = `${(S.banks.find(b => b.id === S.bank) || {}).name || ''} · ${S.qs.length} 题`;
}

function paintSelbar() {
  const bar = $('#selbar');
  if (!bar) return;
  const n = S.picked.size;
  bar.innerHTML = `已选 <b>${n}</b> 题
    <span class="grow"></span>
    <button class="qt-btn sm ghost" id="selPage" type="button">全选本页</button>
    <button class="qt-btn sm ghost" id="selAll" type="button">全选筛选结果</button>
    <button class="qt-btn sm ghost" id="selClear" type="button"${n ? '' : ' disabled'}>清空</button>`;
  $('#selPage').onclick = () => {
    const all = filtered(), start = S.page * S.pageSize;
    all.slice(start, start + S.pageSize).forEach(q => S.picked.add(q.id));
    paintList();
  };
  $('#selAll').onclick = () => { filtered().forEach(q => S.picked.add(q.id)); paintList(); };
  $('#selClear').onclick = () => { S.picked.clear(); paintList(); };
}

/* ---------------- 发布 ---------------- */
function toast(el, msg, cls) {
  if (!el) return;
  el.className = 'qt-msg' + (cls ? ' ' + cls : '');
  el.textContent = msg;
}

async function publish() {
  if (S.busy) return;
  const msg = $('#fMsg');
  const ids = [...S.picked];
  if (!ids.length) return toast(msg, '还没选题：先在左边勾几道题。', 'bad');
  const title = $('#fTitle').value.trim();
  if (!title) return toast(msg, '任务标题不能为空。', 'bad');
  const full = Number($('#fFull').value);
  if (!(full >= 1 && full <= 50)) return toast(msg, '满分要在 1~50 之间。', 'bad');
  const no = $('#fLessonNo').value ? Number($('#fLessonNo').value) : null;
  const date = $('#fLessonDate').value || null;

  const btn = $('#fGo');
  S.busy = true; btn.disabled = true; btn.textContent = '发布中…';
  try {
    const r = await hx.rpc('hx_quiz_task_save', {
      p_id: null, p_bank: S.bank, p_title: title, p_note: $('#fNote').value.trim(),
      p_class: S.cls, p_qids: ids, p_full: full, p_lesson_no: no, p_lesson_date: date,
    });
    await loadTasks();
    paintTasks();
    toast(msg, `已发布（任务 #${r.id} · ${r.asked} 题，${full} 分）。学生现在就能在「课堂任务」里做。`, 'ok');
  } catch (e) {
    toast(msg, '发布失败：' + e.message, 'bad');
  } finally { S.busy = false; btn.disabled = false; btn.textContent = '发布任务'; }
}

/* ---------------- 任务列表 ---------------- */
function paintTasks() {
  const box = $('#tasks');
  if (!box) return;
  const tag = $('#tasksTag');
  if (tag) tag.textContent = `${className(S.cls)} · ${S.tasks.length} 个`;
  const errHtml = S.err ? `<p class="qt-hint" style="color:var(--qt-bad)">${esc(S.err)}</p>` : '';

  if (!S.tasks.length) {
    box.innerHTML = errHtml + '<div class="qt-empty"><b>这个班还没有任务</b>选好题，在右边填写标题和课次，点「发布任务」。</div>';
    return;
  }

  box.innerHTML = errHtml + `<div class="qt-tasks">${S.tasks.map(t => {
    const del = !!t.deleted;
    const total = classTotal(t.class_id);
    return `<article class="qt-task${t.status === 'open' && !del ? ' pending' : ''}" data-id="${t.id}">
      <div class="qt-task-head">
        <b>${esc(t.title)}</b>
        ${del ? '<span class="qt-badge del">已删除</span>' : `<span class="qt-badge ${t.status}">${statusText(t.status)}</span>`}
        ${t.mine_rate != null ? `<span class="qt-badge mine">我 ${t.mine_rate}%</span>` : ''}
      </div>
      <div class="qt-task-meta">
        ${esc(t.bank_name || t.bank)} · ${t.asked} 题 · 满分 ${fmtScore(t.full)} 分
        · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''}
        · 发布于 ${fmtClock(t.opened_at)}
        ${t.closed_at ? ' · 结束于 ' + fmtClock(t.closed_at) : ''}
      </div>
      <div class="qt-task-stats">
        <div><em>完成人数</em><b>${t.done}<small> / ${total || '—'}</small></b></div>
        <div><em>平均准确率</em><b>${t.avg_rate == null ? '—' : t.avg_rate}<small>%</small></b></div>
        <div><em>题数</em><b>${t.asked}<small> 题</small></b></div>
      </div>
      <div class="qt-acts">
        ${!del ? `<button class="qt-btn sm" data-act="board" data-id="${t.id}" type="button">打开大屏</button>` : ''}
        ${!del && t.status === 'open' ? `<button class="qt-btn sm" data-act="close" data-id="${t.id}" type="button">结束</button>` : ''}
        ${!del && t.status === 'closed' ? `<button class="qt-btn sm" data-act="reopen" data-id="${t.id}" type="button">重开</button>` : ''}
        ${!del ? `<button class="qt-btn sm ghost" data-act="repost" data-id="${t.id}" type="button">再发一次</button>` : ''}
        ${!del ? `<button class="qt-btn sm danger" data-act="del" data-id="${t.id}" type="button">删除</button>` : ''}
        ${del ? `<button class="qt-btn sm" data-act="restore" data-id="${t.id}" type="button">恢复</button>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;

  box.querySelectorAll('[data-act]').forEach(b => {
    b.onclick = () => taskAct(b.dataset.act, Number(b.dataset.id), b);
  });
}

async function taskAct(act, id, btn) {
  const t = S.tasks.find(x => Number(x.id) === id);
  if (!t) return;
  if (act === 'board') { window.open('board.html?t=' + id, '_blank'); return; }
  if (act === 'repost') return repost(t);

  const words = {
    close: ['结束「' + t.title + '」？', '结束后学生不能再交卷，已交的成绩保留。'],
    reopen: ['重开「' + t.title + '」？', '重开后学生可以继续做，之前的成绩保留。'],
    del: ['删除「' + t.title + '」？', '删除后学生看不到它，成绩行保留（供小组加分整列删）。可以恢复。'],
    restore: ['恢复「' + t.title + '」？', '恢复后学生会重新看到这个任务。'],
  }[act];
  if (words && !confirm(words[0] + '\n\n' + words[1])) return;

  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '处理中…';
  try {
    const fn = { close: 'hx_quiz_task_close', reopen: 'hx_quiz_task_reopen', del: 'hx_quiz_task_del', restore: 'hx_quiz_task_restore' }[act];
    await hx.rpc(fn, { p_task: id });
    S.tasks = await taskList(S.cls);
    paintTasks();
  } catch (e) {
    alert('操作失败：' + e.message);
    btn.disabled = false; btn.textContent = old;
  }
}

async function repost(t) {
  let d;
  try { d = await taskGet(t.id); }
  catch (e) { return alert('读取任务失败：' + e.message); }
  const task = d.task;
  // 题库可能已经不在当前班级的可见列表里（比如后来改了下发范围），补一个选项，别让老师卡住
  if (!S.banks.some(b => b.id === task.bank)) {
    S.banks.unshift({ id: task.bank, name: task.bank_name || task.bank, total: (d.questions || []).length, class_ids: [] });
    paintBankOptions();
  }
  S.bank = task.bank;
  if ($('#fBank')) $('#fBank').value = task.bank;
  await chooseBank(task.bank, true);
  S.picked = new Set(task.qids || []);
  $('#fTitle').value = String(task.title || '').replace(/（再发）$/, '') + '（再发）';
  $('#fTitle').dataset.touched = '1';
  $('#fLessonNo').value = task.lesson_no || '';
  $('#fLessonDate').value = task.lesson_date || '';
  $('#fFull').value = task.full;
  $('#fNote').value = task.note || '';
  paintList();
  toast($('#fMsg'), `已把任务 #${task.id} 的 ${(task.qids || []).length} 道题带回发布区，改标题后点「发布任务」就是新的一条。`, 'ok');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================================
   学生端
   ========================================================================== */
async function studentView() {
  MAIN().className = 'qt-main';
  MAIN().innerHTML = '<div class="qt-panel"><div class="qt-empty">读取任务…</div></div>';
  try { S.tasks = (await taskList()) || []; }
  catch (e) { return gate('读取任务失败', esc(e.message), true); }
  paintStudent();
}

function paintStudent() {
  const cls = (S.me.student && S.me.student.class) || '';
  const opens = S.tasks.filter(t => t.status === 'open');
  const doneT = S.tasks.filter(t => t.status !== 'open');
  if (!S.tasks.length) {
    MAIN().innerHTML = `<div class="qt-panel"><div class="qt-empty">
      <b>老师还没发布课堂任务</b>${cls ? esc(cls) + ' · ' : ''}发布后这里会出现任务卡，点开就能做题。</div></div>`;
    return;
  }
  const card = t => {
    const mine = t.mine_rate != null;
    const total = t.asked;
    return `<article class="qt-task qt-stu-card${t.status === 'open' ? ' pending' : ''}">
      <div class="qt-task-head">
        <b>${esc(t.title)}</b>
        <span class="qt-badge ${t.status}">${statusText(t.status)}</span>
        ${mine ? `<span class="qt-badge mine">已交卷</span>` : ''}
      </div>
      <div class="qt-task-meta">
        ${esc(t.bank_name || t.bank)} · ${total} 题 · 满分 ${fmtScore(t.full)} 分
        · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''}
        ${t.closed_at ? ' · 结束于 ' + fmtClock(t.closed_at) : ''}
      </div>
      ${t.note ? `<div class="qt-task-meta" style="color:var(--qt-ink)">${esc(t.note)}</div>` : ''}
      <div class="qt-task-stats">
        <div><em>我的准确率</em><b>${mine ? t.mine_rate + '<small>%</small>' : '—'}</b></div>
        <div><em>我的得分</em><b>${mine ? fmtScore(t.mine_score) + '<small> / ' + fmtScore(t.full) + '</small>' : '—'}</b></div>
        <div><em>交卷状态</em><b style="font-size:16px">${mine ? '已完成' : '还没做'}</b></div>
      </div>
      <div class="qt-acts">
        ${t.status === 'open'
          ? `<button class="qt-btn primary" data-do="${t.id}" type="button">${mine ? '再练一次（只升不降）' : '开始作答'}</button>`
          : ''}
        ${mine ? `<button class="qt-btn" data-look="${t.id}" type="button">查看成绩</button>` : ''}
      </div>
    </article>`;
  };
  MAIN().innerHTML = `
    ${opens.length ? `<section class="qt-panel"><h2>进行中 <span class="qt-tag">${esc(cls)} · ${opens.length} 个</span></h2>
      <div class="qt-body"><div class="qt-tasks">${opens.map(card).join('')}</div></div></section>` : ''}
    ${doneT.length ? `<section class="qt-panel"><h2>已结束 <span class="qt-tag">${doneT.length} 个</span></h2>
      <div class="qt-body"><div class="qt-tasks">${doneT.map(card).join('')}</div></div></section>` : ''}
    ${!opens.length && !doneT.length ? '<div class="qt-panel"><div class="qt-empty">没有任务</div></div>' : ''}`;

  MAIN().querySelectorAll('[data-do]').forEach(b => b.onclick = () => openQuiz(Number(b.dataset.do)));
  MAIN().querySelectorAll('[data-look]').forEach(b => b.onclick = () => openQuiz(Number(b.dataset.look), true));
}

/* ---------------- 作答 ---------------- */
async function openQuiz(id, lookOnly) {
  const t = S.tasks.find(x => Number(x.id) === id);
  if (S.me.student && S.me.student.probe) return alert('演示视角只能看，不能作答。');
  let d;
  try { d = await taskGet(id); }
  catch (e) { return alert('打开任务失败：' + e.message); }

  if (lookOnly) {
    // 「查看成绩」：没交过卷的人 review 会被数据库拒绝，所以先看 mine
    if (!d.mine) return alert('你还没交卷，先做一次吧。');
    try {
      const review = await taskReview(id);
      /* 成绩页上还有「再练一次」：它要拿题目重新开一轮，所以这里也要把 S.quiz 立起来。
         以前只赋 S.result，点「再练一次」时 S.quiz 是 null，直接抛 TypeError。 */
      S.quiz = { task: d.task, questions: d.questions || [], mine: d.mine };
      S.answers = {};
      S.result = { r: { ...d.mine, kept: true }, review, answers: {}, task: d.task, look: true };
      renderResult();
    } catch (e) { alert('读取成绩失败：' + e.message); }
    return;
  }

  S.quiz = { task: d.task, questions: d.questions || [], mine: d.mine };
  S.answers = {};
  S.idx = 0;
  S.started = Date.now();
  // 填空题先铺好空数组，输入框直接绑定
  S.quiz.questions.forEach(q => {
    if (q.type === 'fill') S.answers[q.id] = blanksOf(q).map(() => '');
  });
  renderQuiz();
}

const blanksOf = q => {
  const n = (String(q.stem || '').match(/_{2,}/g) || []).length;
  return new Array(Math.max(1, n)).fill('');
};

function hasAnswer(q) {
  const a = S.answers[q.id];
  if (!a) return false;
  if (q.type === 'fill') return a.some(x => String(x || '').trim() !== '');
  return a.length > 0;
}

function renderQuiz() {
  let box = $('#quiz');
  if (!box) {
    box = document.createElement('div');
    box.id = 'quiz';
    box.className = 'qt-quiz';
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
  }
  const { task, questions } = S.quiz;
  const n = questions.length;
  const q = questions[S.idx];
  if (!q) return;
  const ans = S.answers[q.id] || [];
  const pct = Math.round((S.idx + 1) / n * 100);

  const optHtml = () => {
    if (q.type === 'fill') {
      const blanks = blanksOf(q);
      return `<div class="qt-fills">${blanks.map((_, i) => `<label>
        <span>第 ${i + 1} 空</span>
        <input data-blank="${i}" value="${esc(ans[i] || '')}" autocomplete="off" placeholder="填答案">
      </label>`).join('')}</div>`;
    }
    const opts = (q.options && q.options.length) ? q.options
      : (q.type === 'judgment' ? [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }] : []);
    return `<div class="qt-opts">${opts.map((o, i) => {
      const on = ans.includes(o.key);
      const letter = q.type === 'judgment' ? jIcon(o.key) : ('ABCDEF'[i] || String(i + 1));
      return `<button class="qt-opt${on ? ' on' : ''}" data-k="${esc(o.key)}" type="button">
        <span class="k">${letter}</span>
        <span class="tx">${o.fig ? figSvg(o.fig) : ''}${esc(o.text || '')}</span>
      </button>`;
    }).join('')}</div>`;
  };

  box.innerHTML = `
    <div class="qt-quiz-top">
      <button class="qt-btn sm ghost" id="qClose" type="button">关闭</button>
      <div class="t"><b>${esc(task.title)}</b>
        <span>${esc(task.bank_name || '')} · 第 ${S.idx + 1} / ${n} 题 · 满分 ${fmtScore(task.full)} 分</span>
      </div>
      <div class="qt-progress"><i style="width:${pct}%"></i></div>
    </div>
    <div class="qt-qwrap">
      <div class="qt-qcard">
        <div class="qt-qhead">
          <span class="n">第 ${S.idx + 1} 题</span>
          <span class="ty">${esc(typeName(q.type))}</span>
          ${q.secTitle || q.sec ? `<span>${esc(q.secTitle || q.sec)}</span>` : ''}
        </div>
        <div class="qt-stem">${esc(q.stem)}</div>
        ${q.fig ? `<div class="qt-fig">${figSvg(q.fig, true)}</div>` : ''}
        ${q.code ? `<pre class="qt-code">${esc(q.code)}</pre>` : ''}
        ${optHtml()}
        <div class="qt-dots">${questions.map((x, i) =>
          `<i class="${i === S.idx ? 'cur' : ''}${hasAnswer(x) ? ' done' : ''}"></i>`).join('')}</div>
        <div class="qt-qfoot">
          <button class="qt-btn ghost" id="qPrev" type="button"${S.idx === 0 ? ' disabled' : ''}>上一题</button>
          <span class="grow"></span>
          ${S.idx < n - 1
            ? '<button class="qt-btn primary" id="qNext" type="button">下一题</button>'
            : '<button class="qt-btn primary big" id="qDone" type="button">交卷</button>'}
        </div>
      </div>
    </div>`;

  $('#qClose').onclick = closeQuiz;
  $('#qPrev').onclick = () => { if (S.idx > 0) { S.idx--; renderQuiz(); } };
  if ($('#qNext')) $('#qNext').onclick = () => { if (S.idx < n - 1) { S.idx++; renderQuiz(); } };
  if ($('#qDone')) $('#qDone').onclick = submitQuiz;

  if (q.type === 'fill') {
    box.querySelectorAll('[data-blank]').forEach(inp => {
      inp.oninput = () => {
        const a = (S.answers[q.id] || blanksOf(q).map(() => '')).slice();
        a[Number(inp.dataset.blank)] = inp.value;
        S.answers[q.id] = a;
      };
    });
  } else {
    box.querySelectorAll('.qt-opt').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.k;
        if (q.type === 'multiple') {
          const a = new Set(S.answers[q.id] || []);
          if (a.has(k)) a.delete(k); else a.add(k);
          S.answers[q.id] = [...a];
        } else {
          S.answers[q.id] = [k];
        }
        renderQuiz();
      };
    });
  }
}

function closeQuiz() {
  const box = $('#quiz');
  if (box) box.remove();
  document.body.style.overflow = '';
  S.quiz = null;
  S.result = null;
}

async function submitQuiz() {
  const { task, questions } = S.quiz;
  const miss = questions.filter(q => !hasAnswer(q)).length;
  if (miss && !confirm(`还有 ${miss} 题没作答，没答的算错。确定交卷？`)) return;
  const seconds = Math.round((Date.now() - S.started) / 10) / 100;
  const btn = $('#qDone');
  if (btn) { btn.disabled = true; btn.textContent = '交卷中…'; }
  try {
    const r = await taskSubmit(task.id, S.answers, seconds);
    let review = [];
    try { review = await taskReview(task.id); } catch (e) { review = []; }
    S.result = { r, review, answers: { ...S.answers }, task, seconds };
    renderResult();
  } catch (e) {
    alert('交卷失败：' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '交卷'; }
  }
}

/* 和数据库 hx_quiz_task__norm 同一套：去空白 + 全角标点转半角 + 小写。
   前端只用来标红错题，最终分数以服务端返回为准。 */
const norm = t => String(t == null ? '' : t)
  .replace(/[，。、；：？！（）【】“”‘’]/g, m => ({
    '，': ',', '。': '.', '、': ',', '；': ';', '：': ':', '？': '?', '！': '!',
    '（': '(', '）': ')', '【': '[', '】': ']', '“': '"', '”': '"', '‘': "'", '’': "'",
  }[m]))
  .replace(/\s/g, '').toLowerCase();

function isRight(q, my) {
  if (!my || !my.length) return false;
  const a = Array.isArray(q.answer) ? q.answer : [];
  if (q.type === 'single' || q.type === 'judgment') {
    return String(my[0] || '').toUpperCase() === String(a[0] || '').toUpperCase();
  }
  if (q.type === 'multiple') {
    const A = a.map(x => String(x).toUpperCase()).sort();
    const B = my.map(x => String(x).toUpperCase()).sort();
    return A.length === B.length && A.every((x, i) => x === B[i]);
  }
  if (q.type === 'fill') {
    if (a.length !== my.length) return false;
    return a.every((x, i) => norm(x) === norm(my[i]));
  }
  return false;
}

function answerText(q, arr) {
  if (!arr || !arr.length || arr.every(x => String(x || '').trim() === '')) return '未作答';
  if (q.type === 'judgment') return arr.map(x => x === 'T' ? '✓ 正确' : '✗ 错误').join('、');
  if (q.type === 'fill') return arr.map(x => String(x || '（空）')).join(' / ');
  return arr.join('、');
}

function renderResult() {
  const R = S.result;
  if (!R) return;
  let box = $('#quiz');
  if (!box) {
    box = document.createElement('div');
    box.id = 'quiz';
    box.className = 'qt-quiz';
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
  }
  const { r, review, answers, task } = R;
  const hasReview = Array.isArray(review) && review.length > 0;
  const look = !!R.look;
  /* 「查看成绩」（look）= 从任务卡回看历史成绩：服务端只存分数，不存当时的作答明细
     （表契约里没有 answers 列，别为了这个去改库）。所以这一档只列正确答案和解析，
     不假装「你的答案 = 未作答」—— 那会把答对的人也说成全错。交卷当页的明细照旧完整。 */
  const wrong = hasReview && !look ? review.map(q => ({ q, my: answers[q.id] })).filter(x => !isRight(x.q, x.my)) : [];
  const keptTip = r.kept === false
    ? '<div class="qt-score-hero"><div></div><div><div class="score">这次没有超过之前的成绩</div><div class="sub">系统保留了你的最好成绩（只升不降），这次不用重交。</div></div></div>' : '';

  box.innerHTML = `
    <div class="qt-quiz-top">
      <button class="qt-btn sm ghost" id="rClose" type="button">返回任务</button>
      <div class="t"><b>${esc(task.title)}</b><span>${look ? '成绩回看' : '交卷结果'}</span></div>
    </div>
    <div class="qt-qwrap">
      <div class="qt-result">
        <div class="qt-score-hero">
          <div class="rate">${r.rate}<small>%</small></div>
          <div>
            <div class="score">${fmtScore(r.score)} <small>/ ${fmtScore(task.full)} 分</small></div>
            <div class="sub">答对 ${r.right} / ${r.asked} 题${R.seconds ? ' · 用时 ' + fmtSec(R.seconds) : ''}</div>
          </div>
        </div>
        ${keptTip}
        ${!hasReview
          ? '<div class="qt-panel"><div class="qt-empty"><b>分数已记上</b>这次没读到答案和解析，以服务端分数为准；刷新后从任务卡点「查看成绩」可以再看。</div></div>'
          : look ? `<div class="qt-panel"><h2>答案与解析 <span class="qt-tag">共 ${review.length} 题</span></h2>
          <div class="qt-body"><p class="qt-hint">历史成绩只保存分数，不保存当时选的答案；下面是这套题的正确答案和解析。</p>
          <div class="qt-wrong">${review.map(q => `<div class="w">
            <h3>${esc(q.stem)}</h3>
            <div class="ln"><b>正确答案</b><span class="ok">${esc(answerText(q, q.answer))}</span></div>
            ${q.explanation ? `<div class="ex"><b>解析：</b>${esc(q.explanation)}</div>` : ''}
          </div>`).join('')}</div></div></div>`
          : wrong.length ? `<div class="qt-panel"><h2>错题 ${wrong.length} 道 <span class="qt-tag">正确答案 + 解析</span></h2>
          <div class="qt-body"><div class="qt-wrong">${wrong.map(({ q, my }) => `<div class="w">
            <h3>${esc(q.stem)}</h3>
            <div class="ln"><b>你的答案</b><span class="bad">${esc(answerText(q, my))}</span></div>
            <div class="ln"><b>正确答案</b><span class="ok">${esc(answerText(q, q.answer))}</span></div>
            ${q.explanation ? `<div class="ex"><b>解析：</b>${esc(q.explanation)}</div>` : ''}
          </div>`).join('')}</div></div></div>`
          : `<div class="qt-panel"><div class="qt-empty"><b>全对，太稳了</b>这套题没有错题。</div></div>`}
        <div class="qt-acts" style="justify-content:center">
          <button class="qt-btn big" id="rBack" type="button">返回任务</button>
          ${task.status === 'open' ? '<button class="qt-btn primary big" id="rAgain" type="button">再练一次（只升不降）</button>' : ''}
        </div>
      </div>
    </div>`;

  $('#rClose').onclick = () => { closeQuiz(); studentView(); };
  $('#rBack').onclick = () => { closeQuiz(); studentView(); };
  if ($('#rAgain')) $('#rAgain').onclick = () => {
    S.idx = 0; S.answers = {};
    S.quiz.questions.forEach(q => { if (q.type === 'fill') S.answers[q.id] = blanksOf(q).map(() => ''); });
    S.started = Date.now();
    S.result = null;
    renderQuiz();
  };
}
