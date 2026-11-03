// 刷题数据：本机 localStorage 一份，登录后同步到数据库 quiz_mine（只有自己能读写，见 supabase/quiz-schema.sql）。
// 键：subjects（自建科目）、bank:<科目>（导入的题）、progress:<科目>（刷题记录）。本机按账号分开存，没登录记在“guest”下。
import { api, rpc, signedIn, uid } from './hx.js';

const owner = () => uid() || 'guest';
const lkey = key => `hx-quiz:${owner()}:${key}`;
export function getLocal(key, fallback) { try { const v = JSON.parse(localStorage.getItem(lkey(key))); return v ?? fallback; } catch { return fallback; } }
export function setLocal(key, value) { try { localStorage.setItem(lkey(key), JSON.stringify(value)); return true; } catch { return false; } }

export const cloud = { ok: null, error: '' }; // ok: null 没登录 / true 已同步 / false 同步失败
async function cloudGet(key) {
  const rows = await api(`/rest/v1/quiz_mine?select=data&key=eq.${encodeURIComponent(key)}`);
  return rows && rows[0] ? rows[0].data : null;
}
async function cloudPut(key, data) {
  await api('/rest/v1/quiz_mine?on_conflict=user_id,key', { method: 'POST', body: { key, data, updated_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}
async function cloudDel(key) { await api(`/rest/v1/quiz_mine?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' }); }
const guard = async fn => {
  if (!signedIn() || !uid()) { cloud.ok = null; return null; }
  try { const r = await fn(); cloud.ok = true; cloud.error = ''; return r; }
  catch (e) { cloud.ok = false; cloud.error = e.message; return null; }
};

// 读：先本机，登录了再拉云端合并（merge 决定怎么合）
export async function read(key, fallback, merge = (a, b) => b ?? a) {
  const local = getLocal(key, fallback);
  const remote = await guard(() => cloudGet(key));
  if (remote == null) return local;
  const merged = merge(local, remote);
  setLocal(key, merged);
  return merged;
}
const timers = {};
// 写：本机立即写，云端延迟 1.5 秒合并写（刷题时每题都会写）
export function write(key, value, { now = false } = {}) {
  setLocal(key, value);
  clearTimeout(timers[key]);
  const go = () => guard(() => cloudPut(key, value));
  if (now) return go();
  timers[key] = setTimeout(go, 1500);
}
export async function remove(key) { try { localStorage.removeItem(lkey(key)); } catch { /* ignore */ } await guard(() => cloudDel(key)); }
export function flush() { for (const k of Object.keys(timers)) { clearTimeout(timers[k]); delete timers[k]; } }

// 刷题记录合并：同一题取作答次数多的那份（两台设备各刷了一部分，都保留）
export function mergeProgress(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, r] of Object.entries(b || {})) {
    const l = out[id];
    if (!l || (r.attempts || 0) > (l.attempts || 0) || ((r.attempts || 0) === (l.attempts || 0) && (r.at || 0) > (l.at || 0))) out[id] = r;
  }
  return out;
}
// 自建科目合并：按 id 并集
export function mergeSubjects(a = [], b = []) {
  const map = new Map();
  for (const s of [...(a || []), ...(b || [])]) if (s && s.id) map.set(s.id, { ...map.get(s.id), ...s });
  return [...map.values()].filter(s => !s.deleted);
}

// 公共题库（老师发布，所有人能刷）
// 下发范围（2026-11-02 加）：classes = null → 全部学生；[] → 只自己刷；[班级id...] → 只这些班
export const publicList = () => rpc('quiz_public_list', {}, signedIn()).catch(() => []);
export const publicGet = id => rpc('quiz_public_get', { p_id: id }, signedIn());
export const publish = (id, name, questions, ownerName, classes) => rpc('quiz_publish', {
  p_id: id, p_name: name, p_questions: questions, p_owner_name: ownerName,
  // 不传就是 null（全部学生），保持旧行为
  p_classes: classes === undefined ? null : classes,
});
// 只改下发范围，不重传题库（撤销下发传 []）
export const setClasses = (id, classes) => rpc('quiz_set_classes', { p_id: id, p_classes: classes });
export const unpublish = id => rpc('quiz_unpublish', { p_id: id });

// 我教的班（老师选下发对象用）。走 rank-schema.sql 的 hx_my_classes。
// 2026-11-03 起只返回「自己教的班」：管理员/开发者也不再看到别人的班（见 supabase/2026-11-03-班级权限收回.sql）。
// 非老师返回空数组，不抛错（学生打开刷题不该看到报错）。
export const myClasses = () => signedIn()
  ? rpc('hx_my_classes', {}).catch(() => [])
  : Promise.resolve([]);

// 理论题排位（supabase/quiz-schema.sql 第 3 节）：答对的选择、判断题先进本机待交队列，1 秒后交给服务器判对（断网留着，下次再交）。
// 交过的题记在 ranksent:<科目>，再答对不重复交；分数只在服务器算。
let rankTimer = null;
export function rankPush(bank, id, answer, onDone) {
  if (getLocal('ranksent:' + bank, []).includes(id)) return;
  const q = getLocal('rankq', []);
  if (!q.some(x => x.bank === bank && x.id === id)) q.push({ bank, id, answer });
  setLocal('rankq', q.slice(-1000));
  clearTimeout(rankTimer); rankTimer = setTimeout(() => rankFlush(onDone), 1000);
}
export async function rankFlush(onDone) {
  if (!signedIn()) return;
  for (;;) {
    const q = getLocal('rankq', []); if (!q.length) return;
    const bank = q[0].bank, items = q.filter(x => x.bank === bank).slice(0, 100), ids = new Set(items.map(x => x.id));
    let res = null, keep = false;
    try { res = await rpc('quiz_rank_submit', { p_bank: bank, p_items: items.map(({ id, answer }) => ({ id, answer })) }, true); }
    catch (e) { keep = !e.status || e.status >= 500 || e.status === 401 || e.status === 404; } // 断网、服务器出错、登录过期、数据库脚本还没运行：留着下次交；不是学生、科目不对就丢掉
    if (keep) return;
    setLocal('rankq', getLocal('rankq', []).filter(x => !(x.bank === bank && ids.has(x.id))));
    if (res) { setLocal('ranksent:' + bank, [...new Set([...getLocal('ranksent:' + bank, []), ...ids])]); if (onDone) onDone(bank, res); }
  }
}
export const rankBoard = (bank, mine) => rpc('quiz_rank_board', { p_bank: bank, p_mine: !!mine, p_limit: 100 }, signedIn());
