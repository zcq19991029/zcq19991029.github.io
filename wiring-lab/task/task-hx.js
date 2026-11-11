/* ============================================================================
   课堂任务（教师端 / 大屏）共用的小客户端 —— 2026-11-09

   为什么单独写一份，而不是直接引 rank.js：
     · rank.js 是打包时塞进 project2.html 外壳里的（const HX 在那个页面的作用域里），
       新页面是独立地址 /wiring-lab/task/，拿不到那个 HX；
     · hx-theme.js 只管外观和「未登录跳回总入口」，不提供 rpc（它没有 Supabase 客户端）。
   所以这里把 rank.js 里的 HX 精简拷贝一份（只留 rpc / 续期 / 登录态 / 收 GitHub 回调）。
   ⚠️ 改这里要同步看 src/rank.js 的 HX：两边必须用同一个项目地址、同一个 key、同一个
      localStorage 键（paike-session），否则排位和课堂任务会「一边登了一边没登」。
   ========================================================================== */
const HX = (() => {
  const BASE = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co', KEY = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd';
  const SKEY = 'paike-session'; // 华夏工具全站共用一份登录（排课、接线仿真、刷题…都是它）
  let s = null;
  const now = () => Math.floor(Date.now() / 1000);
  const load = () => { try { s = JSON.parse(localStorage.getItem(SKEY)); } catch (e) { s = null; } return s; };
  const keep = v => { s = v; try { v ? localStorage.setItem(SKEY, JSON.stringify(v)) : localStorage.removeItem(SKEY); } catch (e) { } };
  // 中文错误：直接把 Supabase 的英文原话翻成人话（和 rank.js 同一张表，少一条都会看不懂）
  const ZH = [[/Invalid login credentials/i, '账号或密码不对'], [/User already registered/i, '这个邮箱已经注册过了，直接登录就行'],
    [/Password should be at least/i, '密码至少要 6 位'], [/rate limit|too many/i, '操作太频繁，请过一会儿再试'],
    [/JWT expired|invalid JWT/i, '登录过期了，请重新登录'], [/permission denied/i, '没有权限'],
    [/连不上服务器/i, '连不上服务器，请检查网络']];
  const zh = m => { m = String(m || ''); for (const [re, t] of ZH) if (re.test(m)) return t; return m; };
  /* 12 秒超时（2026-11-11 降载）：Nano 卡住时 fetch 会一直挂着，任务页/大屏就「转圈不动」。
     和 rank.js、总入口同一套口径，超时抛一句人话，调用方的 catch 不用改。 */
  const TIMEOUT = 12000;
  async function api(path, { method = 'GET', body, auth = true } = {}) {
    if (auth) await fresh();
    const h = { apikey: KEY, 'Content-Type': 'application/json' }; if (auth && s) h.Authorization = 'Bearer ' + s.access_token;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) { } }, TIMEOUT) : 0;
    let r;
    try { r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined }); }
    catch (e) { throw new Error(e && e.name === 'AbortError' ? '服务器 12 秒没回应（网络慢，或后端正忙），请再点一次' : '连不上服务器，请检查网络'); }
    finally { if (tm) clearTimeout(tm); }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
    if (!r.ok) throw Object.assign(new Error(zh(j && (j.msg || j.message || j.error_description || j.error) || 'HTTP ' + r.status)), { status: r.status });
    return j;
  }
  // ---------- 这台设备上登录过的账号（和总入口共用 paike-accounts） ----------
  // 谁续期谁把新 refresh_token 写回去：否则账号列表里留着已经轮换作废的旧 rt，
  // 总入口点「切到这个账号」必然 400（用户报的「切不回去」）。
  const AKEY = 'paike-accounts';
  const accounts = () => { try { return JSON.parse(localStorage.getItem(AKEY)) || []; } catch (e) { return []; } };
  const keepAccounts = L => { try { localStorage.setItem(AKEY, JSON.stringify(L)); } catch (e) { } };
  function saveAccount(usedRt) {
    if (!s || !s.refresh_token) return;
    let L = accounts();
    if (usedRt) {
      const i = L.findIndex(x => x.rt === usedRt);
      if (i >= 0) {
        L[i].rt = s.refresh_token; L[i].at = now();
        if (s.user && s.user.id) { L[i].uid = s.user.id; L[i].mail = s.user.email || L[i].mail || ''; L[i].name = (s.user.user_metadata && s.user.user_metadata.name) || L[i].name || ''; }
        keepAccounts(L); return;
      }
    }
    const u = s.user;
    if (!u || !u.id) return;
    L = L.filter(x => x.uid !== u.id);
    L.unshift({ uid: u.id, mail: u.email || '', name: (u.user_metadata && u.user_metadata.name) || '', rt: s.refresh_token, at: now() });
    keepAccounts(L.slice(0, 6));
  }
  // 续期单飞：refresh_token 一次性轮换，同一页并发续期 = 后发的那次 400 把前一次换好的会话抹掉
  let refreshing = null;
  async function fresh() {
    load(); if (!s || now() < s.expires_at - 60) return;
    if (!s.refresh_token) return;
    if (refreshing) return refreshing;
    const usedRt = s.refresh_token, prevUser = s.user || null;
    refreshing = (async () => {
      try {
        take(await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: usedRt }, auth: false }), usedRt, prevUser);
      } catch (e) {
        const cur = load();
        if (cur && cur.access_token && now() < cur.expires_at - 60) return; // 别的页面刚换好
        if (!e.status) throw e;                                            // 网络错误不清会话
        if (cur && cur.refresh_token === usedRt) keep(null);                // 只有自己那把旧 rt 真失效才清
        throw e;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }
  const take = (j, usedRt, prevUser) => {
    keep({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || now() + (j.expires_in || 3600), user: j.user || prevUser || (s && s.user) || null });
    saveAccount(usedRt);
  };
  const rpc = (f, body = {}, auth = true) => api('/rest/v1/rpc/' + f, { method: 'POST', body, auth });
  return {
    online: () => /^https?:$/.test(location.protocol),
    in: () => !!(load() && s.access_token),
    rpc,
    // GitHub 登录跳回来时地址栏 # 后面带凭证：收下并清掉（否则会被当成路由参数）
    grab() {
      const h = new URLSearchParams(location.hash.slice(1)), err = h.get('error_description');
      if (!h.get('access_token') && !err) return null;
      history.replaceState(null, '', location.pathname + location.search);
      if (err) return { error: zh(err.replace(/\+/g, ' ')) };
      keep({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: +h.get('expires_at') || now() + (+h.get('expires_in') || 3600), user: null });
      return { ok: true };
    },
    async user() { load(); if (!s.user) { const u = await api('/auth/v1/user'); load(); s.user = u; keep(s); } return s.user; },
    async me() { return rpc('hx_me'); },
    async out() { try { await api('/auth/v1/logout', { method: 'POST' }); } catch (e) { } keep(null); },
    // 未登录：优先请总入口弹登录（页面常在 iframe 里），否则跳回总入口首页
    login() {
      try { if (window.top !== window && window.top.HXPortal && window.top.HXPortal.login) return window.top.HXPortal.login(); } catch (e) { }
      location.href = HOME + '#wiring';
    },
  };
})();
// 返回接线仿真 / 总入口的相对路径：线上页面在 /wiring-lab/task/，本机自测时根部就是页面目录
const HOME = (() => {
  const p = location.pathname;
  return p.indexOf('/wiring-lab/') >= 0 ? '../../' : './';
})();

/* 可排位的 8 条电路（和 src/rank.js 的 rkCircuits() 同一套 id：2.1～2.6 / E1 / E2）。
   专项（P1…P10）不在课堂任务里：一节实训课的任务就是「连这一张图」，
   一眼能对上教材标题才有意义。要加题在这里加一行即可（SQL 只校验 ^[0-9A-Z.]{2,8}$）。 */
const CIRCUITS = [
  { id: '2.1', short: '单向起动', name: '三相笼型异步电动机单向起动电路' },
  { id: '2.2', short: '电气互锁正反转', name: '三相笼型异步电动机电气互锁正反转控制电路' },
  { id: '2.3', short: '双重互锁正反转', name: '三相笼型异步电动机双重互锁正反转控制电路' },
  { id: '2.4', short: '按钮切换星-三角', name: '按钮切换的星-三角减压起动电路' },
  { id: '2.5', short: '时间继电器星-三角', name: '时间继电器控制的星-三角减压起动电路' },
  { id: '2.6', short: '双速电动机', name: '按钮切换的双速电动机电路' },
  { id: 'E1', short: '联锁正反转能耗制动', name: '三相异步电动机双重联锁正反转启动能耗制动控制线路（电工中级）' },
  { id: 'E2', short: 'C6140T 卧式车床', name: 'C6140T 型卧式车床电气控制线路（电工中级）' },
];
const circuitOf = id => CIRCUITS.find(c => c.id === id) || { id: id, short: id, name: id };
const cname = id => { const c = circuitOf(id); return c.id + ' ' + c.short; };

/* 小工具：全部在这里，两个页面共用（避免各写一份在两端逐渐跑偏） */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
// 用时：小于 1 分钟写 12.3 秒，超过写 1:02.3（大屏上远看更清爽；导出 CSV 用秒数原值）
function fmtSec(sec) {
  if (sec == null || sec === '' || isNaN(+sec)) return '—';
  const s = +sec, m = Math.floor(s / 60), r = s - m * 60;
  return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(1) : r.toFixed(1) + ' 秒';
}
const fmtClock = t => {
  if (!t) return '—';
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};
// 轮询：返回停止函数。页面隐藏时跳过请求（投影时浏览器在后台也不该一直打服务器），回来立刻补一次
// jit：每轮把间隔随机缩放 ±jit（0~1）。全班设备都固定 15 秒会在同一秒一起到期，
//      形成周期性尖峰；抖动后自然错开（2026-11-11 降载）。不传 = 原来那样固定间隔。
function every(ms, fn, jit) {
  let dead = false, t = 0;
  const gap = () => jit ? Math.round(ms * (1 - jit + Math.random() * jit * 2)) : ms;
  const tick = async () => {
    if (dead) return;
    if (!document.hidden) { try { await fn(); } catch (e) { /* 轮询失败不弹窗，下一轮再试 */ } }
    if (!dead) t = setTimeout(tick, gap());
  };
  t = setTimeout(tick, gap());
  const vis = () => { if (!document.hidden && !dead) { clearTimeout(t); tick(); } };
  document.addEventListener('visibilitychange', vis);
  return () => { dead = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}
// 导出 CSV（Excel 直接双击能开：UTF-8 BOM + CRLF）
function downloadCsv(name, rows) {
  const body = rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 完成率 → 一句人话（大屏和教师端同一套说法，学生不会两种解释）
const rateText = r => r == null ? '不计分' : r + '%';
const scoreText = s => s == null ? '—' : (+s).toFixed(1) + ' 分';
/* 完成率分档 → 颜色类（100% 金 / 80% 蓝 / 70% 灰）。档位与数据库 hx_wire_task__calc 一字对应。
   2026-11-09 用户要求：完成率要实时可见 ——「被别人超了就会变 这是很正常的竞争学习」。 */
const rateTier = r => r == null ? 'r-none' : Number(r) >= 100 ? 'r100' : Number(r) >= 80 ? 'r80' : 'r70';
