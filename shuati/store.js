// 刷题数据：本机 localStorage 一份，登录后同步到数据库 quiz_mine（只有自己能读写，见 supabase/quiz-schema.sql）。
// 键：subjects（自建科目）、bank:<科目>（导入的题）、progress:<科目>（刷题记录）。本机按账号分开存，没登录记在“guest”下。
import { api, rpc, signedIn, uid } from './hx.js';

const owner = () => uid() || 'guest';
const lkey = key => `hx-quiz:${owner()}:${key}`;
export function getLocal(key, fallback) { try { const v = JSON.parse(localStorage.getItem(lkey(key))); return v ?? fallback; } catch { return fallback; } }
export function setLocal(key, value) { try { localStorage.setItem(lkey(key), JSON.stringify(value)); return true; } catch { return false; } }

/* ---------- 静态数据短缓存（2026-11-11 降载，和总入口同一口径） ----------
   只缓存「老师偶尔才改一次」的东西：题库列表、题库内容、老师名单、我教的班。
   **绝不缓存**答题进度（progress:）、错题、排位（rankBoard）—— 那些随时在变，缓存了就是错分。
   · key 带 userId：同一台电脑换账号绝不串号；带版本号：结构一变就把 CACHE_V 升一位整体作废；
   · 任何异常（无痕模式 / 存满 / 脏数据）一律当未命中，直接走网络，不能因为缓存把刷题弄白屏；
   · 写操作（发布 / 改下发范围 / 撤销下发 / 转发）之后必须 cdrop，否则老师改完自己还看旧的。 */
const CACHE_V = 'v1', CACHE_TTL = 300000;
const ckey = n => `hx-quiz-cache-${CACHE_V}:${owner()}:${n}`;
/* 总入口改名单（加人/删人/导入/改班级工具）会写 hx-roster-bust 时间戳：
   比缓存新就整份作废 —— 老师刚加的班，刷题的下发范围里要立刻能选到。 */
function cget(n) {
  try {
    const o = JSON.parse(localStorage.getItem(ckey(n)));
    if (!o || !o.t || Date.now() - o.t >= CACHE_TTL) return null;
    const bust = +(localStorage.getItem('hx-roster-bust') || 0);
    if (bust && bust > o.t) return null;
    return o.v;
  } catch { return null; }
}
function cset(n, v) { try { localStorage.setItem(ckey(n), JSON.stringify({ t: Date.now(), v })); } catch { /* 存不下就算了 */ } }
function cdrop(n) { try { localStorage.removeItem(ckey(n)); } catch { /* 同上 */ } }
/* 只有「真拿到东西」才写缓存：请求失败时上游都 .catch(() => []) 兜成空数组，
   要是把空数组也存下来，一次网络抖动就会让老师 5 分钟看不到自己的班/题库 —— 空结果一律不缓存。 */
const cwrap = (n, run) => {
  const hit = cget(n);
  if (hit !== null) return Promise.resolve(hit);
  return run().then(v => { if (Array.isArray(v) ? v.length : v != null) cset(n, v); return v; });
};

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
/* 题库列表 / 题库内容都是「老师偶尔改一次」的静态数据，缓存 5 分钟：
   一个班 40 人同时开同一套题，原来就是 40 次 quiz_public_get 全量下载；
   缓存后同一台电脑重复打开 0 请求（换账号 / 过期 / 老师改过才重拉）。 */
export const publicList = () => cwrap('publist', () => rpc('quiz_public_list', {}, signedIn()).catch(() => []));
export const publicGet = id => cwrap('pub:' + id, () => rpc('quiz_public_get', { p_id: id }, signedIn()));
// 发布 / 改范围 / 撤销 / 转发之后：列表和这份题库的缓存都得作废，否则老师自己看到的是旧的
const dropPub = id => { cdrop('publist'); if (id) cdrop('pub:' + id); };
export const publish = (id, name, questions, ownerName, classes, teachers) => rpc('quiz_publish', {
  p_id: id, p_name: name, p_questions: questions, p_owner_name: ownerName,
  // 不传就是 null（全部学生），保持旧行为
  p_classes: classes === undefined ? null : classes,
  // 发给哪些老师（2026-11-08 加）：不传 = null = 不按老师下发，行为和以前一样。
  // ⚠️ 只发老师时 classes 必须传 []：数据库里传 null（= 全部学生可见）会直接报错，不允许悄悄发全校。
  p_teachers: teachers === undefined ? null : teachers,
}).then(r => { dropPub(id); return r; });
// 只改下发范围，不重传题库（撤销下发传 []）
export const setClasses = (id, classes) => rpc('quiz_set_classes', { p_id: id, p_classes: classes }).then(r => { dropPub(id); return r; });
// 只改「发给哪些老师」，不重传题库
export const setTeachers = (id, teachers) => rpc('quiz_set_teachers', { p_id: id, p_teachers: teachers }).then(r => { dropPub(id); return r; });
/* 转发：老师把看到的题复制成自己名下的一份，之后能随便改、按自己的班下发。
   是复制不是授权 —— 几个老师各改一份互不干扰，排位也算在各自那份上。见 2026-11-08-题库发给老师.sql。 */
export const forward = (id, newName, ownerName, classes) => rpc('quiz_forward', {
  p_id: id, p_new_name: newName || '', p_owner_name: ownerName || '',
  p_classes: classes === undefined ? null : classes,
}).then(r => { cdrop('publist'); return r; });
// 发题时能选哪些老师（不返回邮箱；管理员/开发者也在里面）
export const teacherList = () => signedIn() ? cwrap('teachers', () => rpc('quiz_teacher_list', {}).catch(() => [])) : Promise.resolve([]);
export const unpublish = id => rpc('quiz_unpublish', { p_id: id }).then(r => { dropPub(id); return r; });

/* 题库分享码（2026-11-08）：用户要求「用户自己上传的也可以通过分享码（二维码加6位分享码）发给他的朋友去刷题」。
   和发布不是一回事 —— 发布是「按班级下发」，分享码是「谁拿到码谁能刷」，不占班级、不进公共题库列表。
   表见 supabase/2026-11-08-题库分享码.sql；取码那一步对 anon 也开放（朋友可能还没登录）。
   create 多传 ownerName：署名不能靠数据库猜 —— 老师/开发者不在 hx_students 里，
   猜出来的就是邮箱前缀（实测过，变成 phh4j926xq）。前端有 hx.name()，传过来才准。 */
export const shareCreate = (name, questions, days, ownerName = '') => rpc('quiz_share_create', { p_name: name, p_questions: questions, p_days: days, p_owner_name: ownerName }, true);
export const shareGet = code => rpc('quiz_share_get', { p_code: code }, signedIn());
export const shareList = () => rpc('quiz_share_list', {}, true);
export const shareDel = code => rpc('quiz_share_del', { p_code: code }, true);

// 我教的班（老师选下发对象用）。走 rank-schema.sql 的 hx_my_classes。
// 2026-11-03 起只返回「自己教的班」：管理员/开发者也不再看到别人的班（见 supabase/2026-11-03-班级权限收回.sql）。
// 非老师返回空数组，不抛错（学生打开刷题不该看到报错）。
// 班级名单是「老师偶尔改一次」的静态数据 → 缓存 5 分钟（老师改班级在总入口，那边改完最多 5 分钟这里跟上）。
export const myClasses = () => signedIn()
  ? cwrap('classes', () => rpc('hx_my_classes', {}).catch(() => []))
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
