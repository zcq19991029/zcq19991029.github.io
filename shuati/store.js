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
export const publicList = () => rpc('quiz_public_list', {}, signedIn()).catch(() => []);
export const publicGet = id => rpc('quiz_public_get', { p_id: id }, signedIn());
export const publish = (id, name, questions, ownerName) => rpc('quiz_publish', { p_id: id, p_name: name, p_questions: questions, p_owner_name: ownerName });
export const unpublish = id => rpc('quiz_unpublish', { p_id: id });
