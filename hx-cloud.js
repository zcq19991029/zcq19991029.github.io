/* 华夏工具 · 账号云端偏好（网站根目录 /hx-cloud.js，经典脚本，挂 window.HXC）
   用户原话（2026-11-19）：「永远不存在本机换电脑就看不到的东西，包括 api key 和网页背景，
   跟账号云端走，不留在本机」。

   这一份只做**一件事**：把「localStorage 键 → 字符串值」这张表按账号存到云端，谁都能来读写。
   存哪里：Supabase 表 public.hx_pref，一人一行 —— owner = auth.uid()，data = jsonb（键值快照），
   RLS 只认本人，前端直接用 PostgREST 的 /rest/v1/hx_pref?on_conflict=owner upsert。
   背景图片本体不走这里（一张几 MB 会把 jsonb 行撑爆），它一直在 public.hx_bg 按张存，见 hx-theme.js。

   ── 为什么是「读 → 合并 → 写」，不是直接整行覆盖 ──────────────────────────
   这张 jsonb 是全站共用的：外观（hx-theme / hx-lite）、AI 配置（hx-ai-v1）、每把 Key
   （hx-ai-key:*）、回收站清单（hx-recycle-v1）全住在同一行的同一个 data 里。
   PostgREST 的 upsert 是**整列替换**：body 里 data 是什么，数据库里就变成什么。
   于是只要有人「只把自己那几个键拼一份 data 就 POST」，同一个人另一次写进来的键就被抹掉了 ——
   表现是「刚配好的 API Key 刷新就没了」「换了背景 AI 又不能用了」这种互相踩的怪事，
   而且很难查（两边代码都「正确」，只是谁最后写谁活）。
   所以这一层统一规定：**写之前先 GET 当前整行，{...当前, ...本次改动} 再 POST 回去**，
   只碰本次要改的键。要把并发窗口再压小一点，同一个页面里的所有写还串成一条队列（见 chain），
   保证本页两次写不会交错；跨标签页的竞争压不掉（前端只有 publishable key，没有事务接口），
   但合并写已经把「互相冲掉别人的键」从必然事件降成极小概率的毫秒级窗口。

   降级（这条比功能重要）：
     · 没登录 / 网络挂了 / 401 / 表不存在 → 一律不抛错：prefGet 给 {}，prefMerge 给 null，
       prefPut / prefDel 给 false。调用方（外观、AI 设置）必须能在没有云端的情况下照常工作。
     · 登录态复用全站那 7 个工具的会话：localStorage['paike-session']（含 access_token）。
       这里**不做登录、不续期**，续期是各工具自己的 hx.js 的事；拿不到 token 就当没登录。

   用法：
     await HXC.ready();                       // uid 或 ''（没登录）
     var d = await HXC.prefGet();             // 整个 data
     var n = await HXC.prefMerge({k:'v'});    // 只改 k，别的键原样保留
     await HXC.prefPut('hx-ai-v1', json);     // 等价 prefMerge({['hx-ai-v1']: json})
     await HXC.prefDel('hx-ai-key:plat:u1');  // 删一个键 */
(function (g) {
  'use strict';

  var SUPA = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co';
  // 公开的 publishable key（和 考试/src/app.js、资料库工具/src/app.js 里那串一样），
  // 它本来就随网页发给所有人，不是密钥；service_role 不在前端，也不需要。
  var PUB = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd';
  var TBL = '/rest/v1/hx_pref';
  var SESS = 'paike-session';
  var TIMEOUT = 12000;   // 云端慢的时候不能把页面吊死：超时就当失败，走降级

  function lsGet(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } }

  function session() {
    try { var s = JSON.parse(lsGet(SESS) || 'null'); return s && typeof s === 'object' ? s : null; }
    catch (e) { return null; }
  }
  // access_token：Supabase 会话里就是这一个；拿不到 = 没登录
  function token() { var s = session(); return (s && s.access_token) || ''; }
  // 解 JWT 的 sub 当 uid：续期回来的会话常常只剩 access_token，没有 user 对象
  function jwtSub(t) {
    try {
      var p = String(t).split('.')[1]; if (!p) return '';
      p = p.replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '=';
      return JSON.parse(decodeURIComponent(escape(atob(p)))).sub || '';
    } catch (e) { return ''; }
  }
  function uid() {
    var s = session(); if (!s) return '';
    if (s.user && s.user.id) return String(s.user.id);
    return s.access_token ? String(jwtSub(s.access_token) || '') : '';
  }

  // 带超时的 fetch：AbortController 不支持（老 Safari）就直接发，不加超时
  function request(path, opt) {
    opt = opt || {};
    var t = token(); if (!t) return Promise.reject(new Error('没登录'));
    var h = { apikey: PUB, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
    if (opt.prefer) h.Prefer = opt.prefer;
    var o = { method: opt.method || 'GET', headers: h, cache: 'no-store' };
    if (opt.body !== undefined) o.body = JSON.stringify(opt.body);
    var ac = null, timer = 0;
    try {
      if (typeof g.AbortController === 'function') { ac = new g.AbortController(); o.signal = ac.signal; }
    } catch (e) { ac = null; }
    var done = function () { if (timer) { clearTimeout(timer); timer = 0; } };
    if (ac) timer = setTimeout(function () { try { ac.abort(); } catch (e) { } }, TIMEOUT);
    return g.fetch(SUPA + TBL + path, o).then(function (r) {
      done();
      if (!r.ok) return r.text().then(function (x) { throw new Error((x || '').slice(0, 140) || ('HTTP ' + r.status)); });
      if (r.status === 204) return null;
      return r.json().catch(function () { return null; });
    }, function (e) { done(); throw e; });
  }

  /* 读整行（内部用）。返回 {ok, d} —— 「读成功但云端还没有这一行（d 是 {}）」和
     「读失败（ok:false）」必须分开：合并写看到前者可以照写，看到后者不能瞎写（会把整行写成只有本次的键）。 */
  function readData() {
    var u = uid(); if (!u || !token()) return Promise.resolve({ ok: false, d: null });
    return request('?select=data&owner=eq.' + encodeURIComponent(u) + '&limit=1')
      .then(function (rows) {
        var row = rows && rows[0], d = row && row.data;
        return { ok: true, d: d && typeof d === 'object' ? d : {} };
      })
      .catch(function () { return { ok: false, d: null }; });
  }

  function writeData(u, data) {
    return request('?on_conflict=owner', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{ owner: u, data: data }]
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /* 本页所有写串成一条队列：滑杆拖动会连发几十次 prefMerge，
     不排队的话后发的 GET 可能拿到先发的写之前的数据，自己踩自己。 */
  var chain = Promise.resolve();
  function enqueue(fn) {
    var p = chain.then(fn, fn);
    chain = p.catch(function () { });   // 队列不能被一次失败卡死
    return p;
  }

  function ready() { return Promise.resolve(uid()); }

  function prefGet() { return readData().then(function (r) { return r.d || {}; }); }

  /* 合并写：GET 当前 → {...当前, ...patch} → upsert。
     成功 resolve 合并后的整份 data（调用方可以当「云端现在是什么」用）；
     失败 resolve null（**不 reject**，调用方不该为云端故障写 try/catch）。 */
  function prefMerge(patch) {
    var o = patch && typeof patch === 'object' ? patch : {};
    return enqueue(function () {
      var u = uid(); if (!u) return null;
      return readData().then(function (cur) {
        if (!cur.ok) return null;      // 连当前那份都读不到，宁可这次不写，也别把别人的键冲掉
        var next = {}, k;
        for (k in cur.d) if (Object.prototype.hasOwnProperty.call(cur.d, k)) next[k] = cur.d[k];
        for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) next[k] = o[k];
        return writeData(u, next).then(function (ok) { return ok ? next : null; });
      });
    });
  }

  function prefPut(key, val) {
    if (!key) return Promise.resolve(false);
    var p = {}; p[String(key)] = val == null ? '' : String(val);
    return prefMerge(p).then(function (r) { return !!r; });
  }

  /* 删一个键：同样先读再写（只去掉这一个键，别的键原样留着）。
     云端本来就没有这个键 → 直接 true，省一次写；连读都读不到 → false（不知道删没删掉，别骗调用方）。 */
  function prefDel(key) {
    var k = String(key || ''); if (!k) return Promise.resolve(false);
    return enqueue(function () {
      var u = uid(); if (!u) return false;
      return readData().then(function (cur) {
        if (!cur.ok) return false;
        if (!Object.prototype.hasOwnProperty.call(cur.d, k)) return true;
        var next = {}, n;
        for (n in cur.d) if (Object.prototype.hasOwnProperty.call(cur.d, n) && n !== k) next[n] = cur.d[n];
        return writeData(u, next);
      });
    });
  }

  g.HXC = {
    SUPA: SUPA, TBL: TBL, SESS: SESS,
    ready: ready,
    uid: uid,          // 同步版：当前登录用户 id（没登录给 ''），不想等 Promise 时用
    token: token,
    prefGet: prefGet,
    prefMerge: prefMerge,
    prefPut: prefPut,
    prefDel: prefDel
  };
})(typeof window !== 'undefined' ? window : this);
