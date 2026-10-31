// 华夏工具账号（Supabase 华夏工具项目）。登录存在 localStorage paike-session，和总入口、接线仿真、排课、小组加分共用（同一网站）。
// 续期前先重读：别的页面可能刚续过期，续期后旧凭证作废，拿旧的再续会把所有工具一起踢下线。
const BASE = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co', KEY = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd', SKEY = 'paike-session';
let s = null;
const now = () => Math.floor(Date.now() / 1000);
function load() { try { s = JSON.parse(localStorage.getItem(SKEY)); } catch { s = null; } return s; }
function keep(v) { s = v; try { if (v) localStorage.setItem(SKEY, JSON.stringify(v)); else localStorage.removeItem(SKEY); } catch { /* 无痕模式 */ } }
const ZH = [[/Invalid login credentials/i, '账号或密码不对'], [/rate limit|too many/i, '操作太频繁，请过一会儿再试'], [/JWT expired|invalid JWT/i, '登录过期了，请重新登录'], [/Failed to fetch|NetworkError/i, '连不上服务器，请检查网络']];
const zh = m => { m = String(m || ''); for (const [re, t] of ZH) if (re.test(m)) return t; return m; };

async function fresh() {
  load(); if (!s || now() < s.expires_at - 60) return;
  try {
    const j = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false });
    keep({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || now() + (j.expires_in || 3600), user: j.user || s.user || null });
  } catch (e) { if (e.status) keep(null); throw e; }
}
export async function api(path, o = {}) {
  const auth = o.auth !== false;
  if (auth) await fresh();
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...(o.headers || {}) };
  if (auth && s) h.Authorization = 'Bearer ' + s.access_token;
  let r;
  try { r = await fetch(BASE + path, { method: o.method || 'GET', headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) }); }
  catch { throw new Error('连不上服务器，请检查网络'); }
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) { const err = new Error(zh(j && (j.msg || j.message || j.error_description || j.error) || 'HTTP ' + r.status)); err.status = r.status; throw err; }
  return j;
}
export const signedIn = () => !!(load() && s.access_token);
export const uid = () => (signedIn() && s.user && s.user.id) || null;
export const rpc = (f, body, auth) => api('/rest/v1/rpc/' + f, { method: 'POST', body: body || {}, auth });
export async function user() { load(); if (!s) return null; if (!s.user) { const u = await api('/auth/v1/user'); load(); s.user = u; keep(s); } return s.user; }
export async function me() { return signedIn() ? rpc('hx_me') : null; }
export function name(u, m) {
  const d = (u && u.user_metadata) || {};
  return (m && m.student && m.student.name) || d.full_name || d.name || d.user_name || ((u && u.email) || '').split('@')[0] || '我';
}
export function onChange(fn) { addEventListener('storage', e => { if (e.key === SKEY) fn(); }); }
