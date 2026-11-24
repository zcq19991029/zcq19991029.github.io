/* ============================================================================
   刷题 · 课堂任务大屏（2026-11-22）
   ----------------------------------------------------------------------------
   只做三件事（照 接线仿真/src/task-board.js）：
     1) 每 5 秒拉一次 hx_quiz_task_board，铺「名次 / 姓名 / 小组 / 准确率 / 得分 / 用时 / 练习次数」；
     2) 和上一轮比较：新交卷的人闪一下，名次上升/下降的人高亮一下（绿色升、红色降）；
     3) 顶部大字任务标题 + 已完成/总人数 + 平均准确率 + 平均得分，右侧整列「未完成名单」。

   ⚠ 2026-11-24：hx_quiz_task_board 现在返回**全班名单**（没交的 done=false、place=null），
     所以「已完成」必须数 done=true 的行，不能再拿 rows.length 当已完成人数（那是老口径）。
     总人数也直接由行数来，不再另调 hx_class_students —— 两个来源会在「有人刚退班」时
     出现「已完成 12 / 49」但名单只有 48 行的错位。
   只读：写操作都在任务页，多个大屏同开不会互相抢状态。
   ========================================================================== */
import { hx, esc, fmtSec, fmtScore, taskBoard, taskList, every } from './task-hx.js';

const B = {
  taskId: null,
  task: null,
  className: '',
  total: 0,
  rows: [],
  prev: new Map(),   // student_id → 上一轮名次（判上升/下降）
  first: true,
  stop: null,
  lastAt: '',
  tick: 0,
  err: '',
};
const root = () => document.getElementById('bdRoot');

(async function boot() {
  if (!hx.signedIn()) return gate('先登录', '用教师账号登录后，这一页才能看到本班任务。');
  let me;
  try { me = await hx.me(); } catch (e) { return gate('读取身份失败', e.message); }
  if (!me || !(me.teacher || me.admin || me.dev)) {
    return gate('只有教师能打开大屏', '学生请回到「课堂任务」看自己的任务和成绩。');
  }

  const id = +(new URLSearchParams(location.search).get('t') || 0) || null;
  B.taskId = id;
  try { await loadMeta(); } catch (e) { return gate('读取任务失败', e.message); }
  if (!B.taskId) return gate('还没有课堂任务', '先在任务页发布一个，再打开大屏。');

  try { await load(); } catch (e) { return gate('读取排行榜失败', e.message); }
  // 5 秒一轮（用户要求「5 秒轮询」）；每 6 轮（约 30 秒）顺手刷新一次任务状态，
  // 老师在任务页点了「结束」，大屏不用等刷新就能盖上「已结束」印章。
  B.stop = every(5000, async () => {
    B.tick++;
    if (B.tick % 6 === 0) { try { await loadMeta(); } catch (e) { /* 状态刷新失败不影响榜单 */ } }
    await load();
  });
})();

function gate(title, msg) {
  root().innerHTML = `<div class="bd-gate"><div>
    <b>${esc(title)}</b><p>${esc(msg)}</p>
    <p style="margin-top:2vmin"><a class="bd-back" href="index.html" style="display:inline-flex;align-items:center">← 回课堂任务</a></p>
  </div></div>`;
}

async function loadMeta() {
  // 任务元信息：title / class / lesson / status。列表接口老师能看自己所有班，按 id 找就行。
  const list = (await taskList()) || [];
  if (!B.taskId) {
    const pick = list.find(t => t.status === 'open' && !t.deleted) || list.find(t => !t.deleted);
    if (!pick) return;
    B.taskId = Number(pick.id);
  }
  B.task = list.find(t => Number(t.id) === Number(B.taskId)) || null;
  if (!B.task) throw new Error('任务不存在或没有权限');

  // 班级名 / 总人数：老师自己的班列表 + 名单（总人数 = 没退班的人）
  try {
    const cs = (await hx.rpc('hx_my_classes')) || [];
    B.className = (cs.find(c => Number(c.id) === Number(B.task.class_id)) || {}).name || ('班级 #' + B.task.class_id);
  } catch (e) { B.className = '班级 #' + B.task.class_id; }
  /* 总人数改由榜单行数来（见文件头 2026-11-24 那段）：
     这里原来还调一次 hx_class_students，只为数人头；现在 board 一份数据就够，
     少一个接口、也少一处「两个来源对不上」的可能。 */
}

async function load() {
  const rows = (await taskBoard(B.taskId)) || [];
  const prev = B.prev;
  const now = new Map();
  const moves = new Map();
  (rows || []).forEach(r => {
    // 没交卷的人 place 是 null —— 不参与名次变化的判定，否则每轮都会被当成「从 undefined 变到 NaN」
    if (!r.done) return;
    const sid = String(r.student_id);
    now.set(sid, Number(r.place));
    if (!B.first && prev.has(sid) && Number(prev.get(sid)) !== Number(r.place)) {
      moves.set(sid, { from: Number(prev.get(sid)), to: Number(r.place) });
    }
  });
  B.moves = moves;
  B.fresh = new Set();
  if (!B.first) (rows || []).forEach(r => {
    if (r.done && !prev.has(String(r.student_id))) B.fresh.add(String(r.student_id));
  });
  B.prev = now;
  B.rows = rows || [];
  const d = new Date(), p = n => String(n).padStart(2, '0');
  B.lastAt = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  paint();
  B.first = false;
}

function paint() {
  const t = B.task || {};
  const rows = B.rows || [];
  const done = rows.filter(r => r.done);
  const undone = rows.filter(r => !r.done);
  const n = done.length, total = rows.length;
  const avg = n ? Math.round(done.reduce((a, r) => a + (Number(r.rate) || 0), 0) / n) : 0;
  const avgScore = n ? done.reduce((a, r) => a + (Number(r.score) || 0), 0) / n : 0;

  /* 列数 / 每列行数：人多自动分栏，字号跟着降一档，保证一屏放下、绝不滚动。
     ⚠ 2026-11-24 上限从 4 栏改成 3 栏：加了「得分」以后一行要塞五样东西，
       1600×900 上 4 栏时每栏只有 ~300px，姓名被挤成「赵…」、用时整列被
       overflow:hidden 裁掉（出图看出来的）。3 栏每栏 ~410px，姓名才有 100px 以上。 */
  let cols = 1;
  if (n > 16) cols = 3; else if (n > 8) cols = 2;

  /* 再按屏宽收一档：一栏至少要 38vmin，才放得下「名次 + 姓名 + 得分 + 准确率 + 用时」。
     竖屏（900×1600）上 3 栏每栏只有 300px，会重演上面那个「姓名只剩一个字」的毛病。 */
  const vw = window.innerWidth || 1600, vh = window.innerHeight || 900;
  const vmin = Math.min(vw, vh) / 100;
  const narrow = vw <= vh;   // 竖屏时未完成栏折到下面（见 CSS 的 max-aspect-ratio:1/1）
  const todoW = narrow ? 0 : Math.min(Math.max(20 * vmin, vw * 0.24), 34 * vmin);
  const listW = vw - 4.4 * vmin - todoW - (narrow ? 0 : 1.6 * vmin);
  cols = Math.min(cols, Math.max(1, Math.floor(listW / (38 * vmin))));
  const per = Math.max(1, Math.ceil(n / cols));
  const size = per <= 8 ? 's1' : per <= 14 ? 's2' : 's3';

  const list = done.map(r => {
    const sid = String(r.student_id);
    const place = Number(r.place) || 0;
    const mv = B.moves && B.moves.get(sid);
    const up = mv && mv.to < mv.from;
    const down = mv && mv.to > mv.from;
    const medal = place <= 3 ? ' m' + place : '';
    const rateCls = Number(r.rate) >= 100 ? ' gold' : Number(r.rate) < 60 ? ' low' : '';
    const tries = Number(r.tries) || 1;
    return `<div class="bd-row${medal}${B.fresh && B.fresh.has(sid) ? ' fresh' : ''}${up ? ' up' : ''}${down ? ' down' : ''}">
      <span class="pl">${place}</span>
      <span class="bd-who">
        <b>${esc(r.name || '—')}</b>
        <span>${r.group_name ? esc(r.group_name) + ' · ' : ''}${tries > 1 ? '<em>练' + tries + '次</em>' : '1 次'}</span>
      </span>
      <span class="bd-sc">${fmtScore(r.score)}<small>分</small></span>
      <span class="bd-rate${rateCls}">${r.rate}%</span>
      <span class="bd-sec">${r.seconds == null ? '—' : fmtSec(r.seconds)}</span>
      ${mv ? `<span class="bd-move">${up ? '▲' + (mv.from - mv.to) : '▼' + (mv.to - mv.from)}</span>` : ''}
    </div>`;
  }).join('');

  /* 未完成整列：这是老师上课时最要用的一块 —— 谁还没交，一眼点名字。
     人数多时靠 CSS 的多列自动折行（.bd-todoitems），一屏内不滚动。 */
  const todo = undone.length
    ? `<div class="bd-todohead">未完成 <b>${undone.length}</b><small> / ${total} 人</small></div>
       <div class="bd-todoitems">${undone.map(r => `<span>${esc(r.name || '—')}</span>`).join('')}</div>`
    : `<div class="bd-todohead">未完成 <b>0</b></div><div class="bd-todook">全班都交了 ✓</div>`;

  const stamp = t.deleted ? '<span class="bd-stamp">已删除</span>'
    : t.status === 'closed' ? '<span class="bd-stamp">已结束</span>' : '';

  root().innerHTML = `
    <header class="bd-head">
      <a class="bd-back" href="index.html" title="回课堂任务">← 课堂任务</a>
      <div class="bd-title">
        <small>${esc(B.className)} · 第 ${t.lesson_no || '—'} 次课${t.lesson_date ? ' · ' + esc(t.lesson_date) : ''} · ${esc(t.bank_name || '')}</small>
        <b>${esc(t.title || '课堂任务')}</b>
      </div>
      ${stamp}
      <div class="bd-stats">
        <div class="bd-kpi"><b>${n}<small> / ${total || '—'}</small></b><em>已完成</em></div>
        <div class="bd-kpi"><b>${avg}<small>%</small></b><em>平均准确率</em></div>
        <div class="bd-kpi"><b>${n ? fmtScore(avgScore) : '—'}<small> 分</small></b><em>平均得分</em></div>
        <div class="bd-kpi"><b>${t.full == null ? '5' : (+t.full).toFixed(1)}<small> 分</small></b><em>满分</em></div>
      </div>
    </header>

    <div class="bd-split">
      ${n
        ? `<div class="bd-list ${size}" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${per},minmax(0,1fr));grid-auto-flow:column">${list}</div>`
        : '<div class="bd-list"><div class="bd-empty">还没有人交卷 —— 学生交卷后这里会实时出现名次</div></div>'}
      <aside class="bd-todo${undone.length ? '' : ' ok'}">${todo}</aside>
    </div>

    <footer class="bd-foot">
      <span>● 每 5 秒刷新 · 最后更新 <b>${B.lastAt}</b></span>
      <span class="grow"></span>
      <span>按准确率排名；同分看用时（短的在前面）· 练几次都算数，只升不降</span>
      <span>满分 ${t.full == null ? '5' : (+t.full).toFixed(1)} 分 · 得分 = 满分 × 准确率</span>
    </footer>`;

  // 高亮只播一遍：下一轮重画自然就没了；这里再兜一次，防止「轮询恰好失败」时一直亮着
  setTimeout(() => {
    root().querySelectorAll('.bd-row.fresh,.bd-row.up,.bd-row.down').forEach(el => {
      el.classList.remove('fresh', 'up', 'down');
    });
  }, 2200);
}
