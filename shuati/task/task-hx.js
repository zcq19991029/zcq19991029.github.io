/* ============================================================================
   刷题 · 课堂任务共用的小客户端（2026-11-22）
   ----------------------------------------------------------------------------
   照 接线仿真/src/task-hx.js 的分工：这里只放「RPC 封装 + 时间/秒/状态格式化」
   + 几个两页共用的小工具，页面逻辑全在 task.js / task-board.js。

   为什么直接 import ../hx.js，而不是像接线仿真那样再抄一份 HX：
     刷题本来就是 module 页面（app.js 已经在用 import），symbols.js 也只能 import；
     再抄一份登录态反而容易和 刷题/app.js 的续期打架（同一个 paike-session 两套续期单飞）。
   ========================================================================== */
import * as hx from '../hx.js';

export { hx };

export const $ = s => document.querySelector(s);

export const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export const typeName = t => ({ single: '单选', judgment: '判断', fill: '填空', multiple: '多选' }[t] || t || '题');
export const statusText = s => s === 'open' ? '进行中' : s === 'closed' ? '已结束' : s;

// 用时：小于 1 分钟写「12.3 秒」，超过写「1:02.3」。大屏上远看更清爽；CSV 用秒数原值。
export function fmtSec(sec) {
  if (sec == null || sec === '' || isNaN(+sec)) return '—';
  const s = +sec, m = Math.floor(s / 60), r = s - m * 60;
  return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) : r.toFixed(1) + ' 秒';
}

export function fmtClock(t) {
  if (!t) return '—';
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export const fmtScore = s => s == null ? '—' : (+s).toFixed(1);

export const todayStr = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

export const mdStr = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate());
};

/* 轮询：页面隐藏时跳过（投影时浏览器在后台不该一直打服务器），回来立刻补一次。
   和接线仿真/刷题 app.js 同一套口径，失败静默、下一轮再试。
   第三个参数 jit 是抖动比例（0.2 = ±20%）：照搬接线仿真 —— 多台大屏/老师笔记本同开时
   不会永远同相位一起到期，服务器不会在同一秒被五六台投影仪同时敲。 */
export function every(ms, fn, jit) {
  let dead = false, t = 0;
  const gap = () => jit ? Math.round(ms * (1 - jit + Math.random() * jit * 2)) : ms;
  const tick = async () => {
    if (dead) return;
    if (!document.hidden) { try { await fn(); } catch (e) { /* 轮询失败不弹窗 */ } }
    if (!dead) t = setTimeout(tick, gap());
  };
  t = setTimeout(tick, gap());
  const vis = () => { if (!document.hidden && !dead) { clearTimeout(t); tick(); } };
  document.addEventListener('visibilitychange', vis);
  return () => { dead = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}

/* ---------- 课堂任务 RPC（名字和数据库契约一一对应，别在前端改简称） ---------- */
// 显式带 p_class: null：PostgREST 对「只有一个带默认值的参数」解析不稳，省略时偶尔报找不到函数
export const taskList = (p_class) => hx.rpc('hx_quiz_task_list', { p_class: p_class == null ? null : p_class });
export const taskGet = (id) => hx.rpc('hx_quiz_task_get', { p_id: id });
/* 榜单（hx_quiz_task_board）。新版 SQL 返回**全班名单**（带 done / tries）；
   旧版只返回交了卷的人、也没有这两列 —— 前端发布与 SQL 执行之间必然有时间差，所以要兼容。
   ⚠ 兼容**不能**图省事把 done 一律当 true：那样「未完成名单」会直接变成「全班都交了」，
     老师会以为人都交齐了（2026-11-24 用户就是这么报的：「现在课堂任务简陋还会直接显示全完成了」）。
     正确做法是用班级名单反推：名单里有、榜单里没有 = 没交。所以这里第二个参数要传 class_id。
   学生也会看这一页（页内排行榜），但 hx_class_students 只给教师/管理员 —— 学生那边反推会失败，
   降级成「没有未完成信息」，等 SQL 跑完自然就对了。 */
export async function taskBoard(id, classId) {
  const raw = (await hx.rpc('hx_quiz_task_board', { p_task: id })) || [];
  const rows = raw.map(r => Object.assign({}, r, {
    done: r.done === undefined ? true : !!r.done,
    tries: r.tries == null ? 1 : Number(r.tries) || 1,
  }));
  if (raw.length && raw[0].done !== undefined) return rows;   // 新版：数据库已经给了 done
  if (!classId) return rows;
  let roster = [];
  try { roster = (await hx.rpc('hx_class_students', { p_class: classId })) || []; }
  catch (e) { return rows; }                                  // 名单也拿不到：降级，成绩那半截仍然是对的
  const had = new Set(raw.map(r => String(r.student_id)));
  const miss = roster.filter(s => !s.left_school && !had.has(String(s.id))).map(s => ({
    place: null, student_id: s.id, name: s.name, student_no: s.student_no, group_name: null,
    rate: null, score: null, seconds: null, finished_at: null, tries: 0, done: false,
  }));
  return rows.concat(miss);
}
export const taskScores = (cls) => hx.rpc('hx_quiz_task_scores', { p_class: cls });
export const taskSubmit = (id, answers, seconds) =>
  hx.rpc('hx_quiz_task_submit', { p_task: id, p_answers: answers, p_seconds: seconds });
export const taskGrade = (id, answers) => hx.rpc('hx_quiz_task_grade', { p_task: id, p_answers: answers });
export const taskReview = (id) => hx.rpc('hx_quiz_task_review', { p_task: id });

// 判断题的选项图标（题库里 judgment 的 key 固定是 T / F）
export const jIcon = k => k === 'T' ? '✓' : '✗';
