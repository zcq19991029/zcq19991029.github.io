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
   和接线仿真/刷题 app.js 同一套口径，失败静默、下一轮再试。 */
export function every(ms, fn) {
  let dead = false, t = 0;
  const tick = async () => {
    if (dead) return;
    if (!document.hidden) { try { await fn(); } catch (e) { /* 轮询失败不弹窗 */ } }
    if (!dead) t = setTimeout(tick, ms);
  };
  t = setTimeout(tick, ms);
  const vis = () => { if (!document.hidden && !dead) { clearTimeout(t); tick(); } };
  document.addEventListener('visibilitychange', vis);
  return () => { dead = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}

/* ---------- 课堂任务 RPC（名字和数据库契约一一对应，别在前端改简称） ---------- */
// 显式带 p_class: null：PostgREST 对「只有一个带默认值的参数」解析不稳，省略时偶尔报找不到函数
export const taskList = (p_class) => hx.rpc('hx_quiz_task_list', { p_class: p_class == null ? null : p_class });
export const taskGet = (id) => hx.rpc('hx_quiz_task_get', { p_id: id });
export const taskBoard = (id) => hx.rpc('hx_quiz_task_board', { p_task: id });
export const taskScores = (cls) => hx.rpc('hx_quiz_task_scores', { p_class: cls });
export const taskSubmit = (id, answers, seconds) =>
  hx.rpc('hx_quiz_task_submit', { p_task: id, p_answers: answers, p_seconds: seconds });
export const taskGrade = (id, answers) => hx.rpc('hx_quiz_task_grade', { p_task: id, p_answers: answers });
export const taskReview = (id) => hx.rpc('hx_quiz_task_review', { p_task: id });

// 判断题的选项图标（题库里 judgment 的 key 固定是 T / F）
export const jIcon = k => k === 'T' ? '✓' : '✗';
