/* 学生端：选桌组队。
 *
 * 流程：用华夏工具的学号账号登录 → 打开这个页面 → 自动进入本班正在组队的房间
 *       → 点一张圆桌就坐下（再点别的桌就是换桌）→ 老师停止后变只读。
 *
 * 只读两个数据来源：jf_team_mine()（我该进哪个房间）和 jf_team_state()（全班坐哪了）。
 * 座位写入走 jf_team_sit / jf_team_stand，权限和「这桌满没满」全在数据库函数里判，
 * 前端不做安全假设。轮询 2.5 秒，页面在后台时停。
 */
(function () {
  'use strict';

  var CFG = window.JFDT_CONFIG || {};
  var API = String(CFG.supabaseUrl || '').replace(/\/$/, '');
  var KEY = CFG.supabasePublishableKey || '';
  var AUTH = API + '/auth/v1';
  var SESSION_KEY = 'paike-session';
  var PORTAL = 'https://zcq19991029.github.io/';
  var POLL_MS = 2500;

  var S = null;          // 最近一次 state
  var timer = null;
  var busy = false;
  var fatal = null;      // 致命状态：no_login / no_room / not_student / error

  /* 我的身份卡背景（2026-11-12）：读 hx_rank_bg，和排位身份卡同一套。 */
  var MY_BG = { bg: '', pos: 50, loaded: false };
  var drag = null;       // 正在拖「我」这张卡：{el, moved}

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 登录态（和华夏工具共用 paike-session） ---------- */

  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* 只覆盖凭证三项，user 等别的字段原样留着，别把其他工具踢下线 */
  function saveSession(patch) {
    try {
      var base = readSession() || {};
      localStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign({}, base, patch)));
    } catch (e) {}
  }

  function token() {
    var s = readSession();
    return s && s.access_token ? s.access_token : '';
  }

  var refreshing = null;

  /** 拿一个还没过期的 access_token；快过期/已过期就用 refresh_token 换一个 */
  function freshToken() {
    var s = readSession();
    if (!s || !s.access_token) return Promise.reject(new Error('NO_LOGIN'));
    var exp = Number(s.expires_at || 0);
    if (!s.refresh_token || (exp && exp - 60 > Date.now() / 1000)) return Promise.resolve(s.access_token);
    if (refreshing) return refreshing;
    refreshing = fetch(AUTH + '/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok || !data || !data.access_token) {
          var err = new Error('NO_LOGIN');
          err.status = 401;
          throw err;
        }
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token || s.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600)
        });
        return data.access_token;
      });
    });
    refreshing = refreshing.then(function (t) { refreshing = null; return t; },
      function (e) { refreshing = null; throw e; });
    return refreshing;
  }

  function rpc(name, args) {
    return freshToken().then(function (t) {
      return fetch(API + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      }).then(function (r) {
        return r.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
          if (!r.ok) {
            var msg = (data && (data.message || data.hint || data.error_description)) || ('请求失败 ' + r.status);
            var err = new Error(String(msg).replace(/^.*?:\s*/, ''));
            err.status = r.status;
            throw err;
          }
          return data;
        });
      });
    });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(text) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 2200);
  }

  /* ---------- 提示区 ---------- */

  function notice(html, cls) {
    var box = $('notice');
    box.innerHTML = html;
    box.hidden = false;
    box.className = 'notice' + (cls ? ' ' + cls : '');
  }
  function clearNotice() { $('notice').hidden = true; $('notice').innerHTML = ''; }

  function showFatal(kind, extra) {
    fatal = kind;
    $('groupBoard').innerHTML = '';
    $('statePill').textContent = '';
    $('statePill').className = 'top-state';
    /* 顶部身份卡统一用 setIdentity 填：没有姓名时卡片自动收成一行（只剩「还没登录」这类说明） */
    if (kind === 'no_login') {
      setIdentity('还没登录', '', '');
      /* 2026-11-03 紧急修：这段是学生进不来的第一道坎。
         ① .notice a 的蓝色会把 .btn-primary 的白字染成和底色一样 → 按钮只剩一坨蓝、看不见「去登录」
            （已在 team.css 里用 .notice a.btn-primary 压住，这里再显式写一遍颜色兜底）；
         ② 原来只有一句「去登录」，学生不知道登录完要干嘛 → 把「登录完回这一页」写成步骤。
         另外如果这个页面是从首页的 iframe 里打开的，target=_blank 跳首页登录会开新标签，
         登录完回 iframe 里这一页就行（它会自己发现登录态）。 */
      notice('<b>请先用学号登录华夏工具，再回来选桌。</b>' +
        '<div class="steps">' +
        '<span>1. 点下面的按钮去登录（账号是<b>学号</b>，密码是第一次登录时自己设的）</span>' +
        '<span>2. 登录成功后，回到这一页 —— 不用刷新，它会自己认出你</span>' +
        '</div>' +
        '<a class="btn-primary" style="color:#fff" href="' + PORTAL + '" target="_blank" rel="noopener">去登录 →</a>' +
        '<br><br><small>忘了密码就在登录页点「忘记密码」。没登录过的话，问老师要课堂码注册。</small>');
      watchLogin();
    } else if (kind === 'not_student') {
      setIdentity('账号没绑定班级', '', '');
      notice('<b>这个账号还没有绑到班级名单上。</b><br>' +
        '要么你用的是老师账号，要么老师还没把这份名单开通到你的学号。' +
        '先问老师确认名单里有你，再回首页重新登录一次。');
    } else if (kind === 'no_room') {
      setIdentity((extra && extra.class) || '本班',
        extra && extra.me ? extra.me.name : '',
        extra && extra.me ? extra.me.no : '');
      notice('<b>老师还没开放组队。</b><br>等老师在加分助手里点「开放组队」，这个页面会自动出现圆桌，不用刷新。');
    } else {
      setIdentity('打不开', '', '');
      notice('<b>读取失败：</b>' + esc(extra && extra.message || '未知错误') +
        '<br>检查一下网络，或者退出重新登录再试。');
    }
  }

  /* ---------- 画分组 ----------
     2026-11-12 重做：学生端「选桌组队」页从圆桌卡片改成和教师端分组看板一致 ——
     左边「未分组」池子 + 右边「第 N 组」卡片，拖自己的身份卡进组/换组/回未分组。 */

  /* 身份卡背景 → 可直接赋给 background 的样式串（精简自总入口 rkdBgStyle） */
  function cardBgStyle(bg, pos) {
    var s = String(bg || '');
    if (!s) return '';
    var p = Math.max(0, Math.min(100, Number(pos) || 50));
    if (/^p:[a-z0-9_-]{1,24}$/.test(s)) {
      var css = (window.rankBgCss && window.rankBgCss(s.slice(2))) || '';
      /* rank-bg.js 没加载出来时 rankBgCss 是空的：这时必须返回空串走默认底，
         否则会拼出「background:;」这种空声明，卡片以为有背景、其实什么都没铺 */
      if (!css) return '';
      return 'background:' + css.replace(/0 0\s*\/\s*100% 100%/g, '50% 50% / cover') + ';';
    }
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s))
      return 'background-image:url("' + s + '");background-size:cover;background-repeat:no-repeat;background-position:50% ' + p + '%;';
    return '';
  }

  /* 确保我的身份牌背景已拉到（只拉一次，背景跟账号走 hx_rank_bg） */
  function ensureMyBg(done) {
    if (MY_BG.loaded) { done(); return; }
    MY_BG.loaded = true;
    rpc('hx_rank_bg_get', {}).then(function (rows) {
      var r = rows && rows[0];
      MY_BG.bg = r ? r.bg : ''; MY_BG.pos = r ? r.pos : 50;
      paintCardBg();          // 顶部那张身份卡同步换背景
      done();
    }).catch(function () { MY_BG.bg = ''; MY_BG.pos = 50; paintCardBg(); done(); });
  }

  /* ---------- 顶部身份卡（2026-11-13 重做） ----------
     用户原话：「这里的是自己名字 id 卡 当然带背景自定义的那种 右边是教师端这样子的样子
     看我的分数这个跳转太丑了 重做」。
     结构写在 team.html 的 #myCard 里（和 scores.html 那张一模一样，样式统一在
     student-ui.css 末尾的「⑪ 身份卡」），这里只做两件事：填字、铺背景。 */

  /* 填「班级 / 姓名 / 学号」三格 + 头像首字。没有姓名时（没登录 / 没绑班级）卡片自动收成一行。 */
  function setIdentity(cls, name, no) {
    var box = $('myCard');
    var c = $('clsName'), nm = $('who'), sno = $('whoNo'), av = $('idcAv');
    if (c) c.textContent = cls || '本班';
    if (nm) nm.textContent = name || '';
    if (sno) sno.textContent = no || '';
    if (av) av.textContent = name ? String(name).slice(0, 1) : '我';
    if (box) box.classList.toggle('is-anon', !name);
  }

  /* 把 hx_rank_bg 铺到卡片背景层；没有背景就留空，露出卡片自带的深蓝渐变 */
  function paintCardBg() {
    var box = $('myCard');
    if (!box) return;
    var bg = $('idcBg') || box.querySelector('.idc-bg');
    var st = cardBgStyle(MY_BG.bg, MY_BG.pos);
    if (bg) bg.setAttribute('style', st || '');
    box.setAttribute('data-nobg', st ? '0' : '1');
  }

  /* 生成「我自己」那条 chip（带身份牌背景，和排位身份卡同一套）。放在组内或未分组池子里。
     别的同学只显示姓氏圆标（他们的背景学生端拿不到，只有自己那份能读）。 */
  function meChipHtml(me) {
    var avatar = esc(String(me.name || '我').slice(0, 1));
    var sub = me.no ? esc(me.no) : '学号';
    var st = cardBgStyle(MY_BG.bg, MY_BG.pos);
    return '<div class="gb-chip me gb-me-card' + (st ? '' : ' no-bg') + '" data-me-bg="1" title="拖到别的组换组，拖回未分组起身">' +
      '<span class="gb-me-bg" aria-hidden="true" style="' + st + '"></span>' +
      '<span class="gb-me-veil" aria-hidden="true"></span>' +
      '<span class="gb-av" aria-hidden="true">' + avatar + '</span>' +
      '<div class="gb-nm"><b>' + esc(me.name) + '</b><small>' + sub + '</small></div>' +
      '<span class="gb-me-tag">我</span>' +
      '</div>';
  }

  /* 坐下 / 换组：请求全走 jf_team_sit，满没满、能不能坐都由云端判，前端不越权 */
  function sit(n) {
    if (busy || !S || S.status !== 'open') return;
    if (S.me && Number(S.me.table) === n) { toast('你已经在这个组了'); return; }
    var filled = (S.seats || []).filter(function (s) { return Number(s.table) === n; }).length;
    if (filled >= S.size) { toast('第 ' + n + ' 组坐满了，换一个吧'); return; }
    busy = true;
    rpc('jf_team_sit', { p_room: S.room, p_table: n }).then(function () {
      return loadState(S.room);
    }).then(function () {
      toast('加入第 ' + n + ' 组');
    }).catch(function (err) {
      toast(err.message || '没进去，再试一次');
      return loadState(S.room).catch(function () {});
    }).then(function () { busy = false; });
  }

  /* 起身（拖回未分组） */
  function stand() {
    if (busy || !S || S.status !== 'open' || !S.me || !S.me.table) return;
    busy = true;
    rpc('jf_team_stand', { p_room: S.room }).then(function () {
      return loadState(S.room);
    }).then(function () { toast('已回到未分组，可以重新选组'); })
      .catch(function (err) { toast(err.message || '操作失败'); })
      .then(function () { busy = false; });
  }

  /* 组号配色（2026-11-13 统一）：和教师端「分组」页 app.js 的 gbTone(组号, 组内序号) 同一套算法 ——
     色相 = ((组号−1)×7 mod 24)×15°，黄金角跳步，相邻两组差 105°，一眼分得开；
     组内第 1~6 人再按序提饱和、压亮度（浅→深），所以同组看着是「浅一档 / 深一档」的同一色系。
     教师端那份由 app.js 内联注入到每个人的 chip 上；学生端不能改 app.js，
     所以这边复算同一套值：组卡片注入 idx 0（组号胶囊用它），组内每人再注入自己的 idx，
     于是「第 N 组」在教师端和学生端是同一个色相、同一种深浅顺序。 */
  function groupTone(gno, idx) {
    var n = Number(gno) || 1;
    var h = (((n - 1) * 7) % 24) * 15;   // 第 1 组 0°(红) → 第 2 组 105°(绿) → … 24 组走完一圈
    var k = (Number(idx) || 0) % 6;      // 组内第 1~6 人循环
    var sat = 58 + k * 6;                // 58 → 88：越靠后颜色越浓
    var lb = 90 - k * 4;                 // 90 → 70：越靠后底色越深
    return '--h:' + h + ';--s:' + sat + '%;--lb:' + lb + '%;';
  }

  function render() {
    if (!S || fatal) return;
    if (drag) return;   // 拖动中别重画，免得把手里这张「我」卡换掉（拖完 loadState 会再画一次）
    var byTable = {};
    (S.seats || []).forEach(function (s) {
      (byTable[s.table] = byTable[s.table] || []).push(s);
    });
    var mine = S.me && S.me.table ? Number(S.me.table) : 0;
    var locked = S.status !== 'open';

    /* 组卡片：和教师端「分组看板」同一套视觉 —— 组号 + 已坐/上限 + 组员列表。
       「自己」那条用身份牌背景（gb-me-card），别人只显示姓氏圆标（拿不到他们的背景）。 */
    var cards = '';
    for (var n = 1; n <= S.tables; n++) {
      var list = byTable[n] || [];
      var full = list.length >= S.size;
      var isMine = mine === n;
      var mem = '';
      list.forEach(function (s, i) {
        var me = S.me && s.student === S.me.id;
        if (me) {
          mem += meChipHtml(S.me);   // 「我」这张固定绿卡，不吃组色（见 roster-board.css 11.3）
        } else {
          /* 每人一份 groupTone(组号, 组内序号)：和教师端 chip 的深浅顺序完全一致 */
          mem += '<div class="gb-chip" style="' + groupTone(n, i) + '" title="' + esc(s.name) + '">' +
            '<span class="gb-av" aria-hidden="true">' + esc(String(s.name || '?').slice(0, 1)) + '</span>' +
            '<div class="gb-nm"><b>' + esc(s.name) + '</b>' + (s.no ? '<small>' + esc(s.no) + '</small>' : '') + '</div>' +
            '</div>';
        }
      });
      for (var i = list.length; i < S.size; i++) mem += '<div class="gb-chip empty">空位</div>';
      if (!mem) mem = '<p class="gb-empty">还没人</p>';
      /* has-tone + 内联 --h/--s/--lb：组号胶囊和组内 chip 都按本组色相上色（见 groupTone） */
      cards += '<section class="gb-group has-tone' + (isMine ? ' is-mine' : '') + (full && !isMine ? ' is-full' : '') +
        '" data-table="' + n + '" style="' + groupTone(n) + '"' +
        (locked && !isMine ? ' data-locked="1"' : '') + '>' +
        '<header class="gb-ghead">' +
          '<span class="gb-gno">第 ' + n + ' 组' + (isMine ? ' · 我在这' : '') + '</span>' +
          '<span class="gb-gcnt"><b>' + list.length + '</b>/' + S.size + ' 人' +
            (full && !isMine ? '<i class="gb-flag">满</i>' : '') + '</span>' +
        '</header>' +
        '<div class="gb-members">' + mem + '</div>' +
        '</section>';
    }

    /* 未分组池子：全班名单里还没坐下的（含自己若没选） */
    var seatedIds = {};
    (S.seats || []).forEach(function (s) { seatedIds[s.student] = 1; });
    var pend = (S.roster || []).filter(function (r) { return !seatedIds[r.id]; });
    var pChips = pend.map(function (r) {
      var me = S.me && r.id === S.me.id;
      if (me) return meChipHtml(S.me);
      return '<div class="gb-chip gb-pend-chip" title="' + esc(r.name) + '">' +
        '<span class="gb-av" aria-hidden="true">' + esc(String(r.name || '?').slice(0, 1)) + '</span>' +
        '<div class="gb-nm"><b>' + esc(r.name) + '</b>' + (r.no ? '<small>' + esc(r.no) + '</small>' : '') + '</div>' +
        '</div>';
    }).join('');

    $('groupBoard').innerHTML =
      '<div class="gb-board">' +
        '<section class="gb-pending" data-drop="pending">' +
          '<header class="gb-phead"><span class="gb-ptitle">未分组</span>' +
            '<span class="gb-gcnt"><b>' + pend.length + '</b> 人</span></header>' +
          '<div class="gb-members">' + (pChips || '<p class="gb-empty">全班都分好组了</p>') + '</div>' +
        '</section>' +
        '<div class="gb-groups">' + cards + '</div>' +
      '</div>' +
      '<p class="gb-hint">把「我」那条卡拖到右边某组就加入；拖到别的组就换组，拖回「未分组」就起身。' +
        (S.status === 'open' ? '点组卡片也能直接进。' : '') + '每 2~3 秒自动刷新。</p>';

    /* 背景是异步拿的：先把「我」那条画出来，背景到位后再补上去（不用整页重画） */
    ensureMyBg(function () {
      var el = document.querySelector('[data-me-bg]');
      if (!el) return;
      var st = cardBgStyle(MY_BG.bg, MY_BG.pos);
      var bgEl = el.querySelector('.gb-me-bg');
      if (bgEl) bgEl.setAttribute('style', st || '');
      el.classList.toggle('no-bg', !st);
    });

    var pill = $('statePill');
    pill.className = 'top-state' + (S.status === 'open' ? '' : S.status === 'locked' ? ' locked' : ' closed');
    pill.textContent = S.status === 'open' ? '组队中' : S.status === 'locked' ? '老师已锁定' : '已结束';

    clearNotice();
    if (S.status === 'locked') {
      notice('<b>老师已经锁定分组了。</b><br>现在只能看，不能改。有意见直接跟老师说。');
    } else if (S.status === 'closed') {
      notice('<b>这次组队已经结束。</b><br>分组结果已交给老师，下面就是最终结果。');
    }

    var left = (S.roster || []).length - (S.seats || []).length;
    $('tip').textContent = S.status === 'open'
      ? '全班 ' + (S.roster || []).length + ' 人，已分组 ' + (S.seats || []).length + ' 人' +
        (left > 0 ? '，还有 ' + left + ' 人没选。' : '，全班都分好了。')
      : '';
  }

  /* ---------- 数据 ---------- */

  function apply(payload) {
    fatal = null;            // 之前“老师还没开房间”之类的提示要先撤掉，否则画不出圆桌
    S = payload;
    var me = payload.me || {};
    /* 顶部身份卡：班级 / 姓名 / 学号 三格分开填（以前是「姓名 · 学号」拼成一行纯文本） */
    setIdentity(payload.class || '本班', me.name, me.no);
    /* 背景异步：先把卡画出来，hx_rank_bg 回来再补背景层，不用整页重画 */
    paintCardBg();
    ensureMyBg(paintCardBg);
    render();
  }

  function loadState(room) {
    return rpc('jf_team_state', { p_room: room }).then(apply);
  }

  function boot() {
    if (!token()) { showFatal('no_login'); return; }
    rpc('jf_team_mine', {}).then(function (res) {
      if (!token()) { showFatal('no_login'); return; }
      if (!res || !res.room) {
        if (res && res.reason === 'not_student') return showFatal('not_student');
        showFatal('no_room', res);
        // 老师随时可能开房间：没房间时也慢速轮询
        schedule(4000);
        return;
      }
      loadState(res.room).then(function () { schedule(POLL_MS); })
        .catch(function (e) { fail(e); });
    }).catch(function (e) { fail(e); });
  }

  function fail(e) {
    if (e && (e.status === 401 || e.message === 'NO_LOGIN')) { showFatal('no_login'); return; }
    showFatal('error', { message: e && e.message });
    schedule(5000);
  }

  /* 没登录时盯着共用登录态：在别的标签页登录完切回来就能自己进去 */
  function watchLogin() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.hidden) { watchLogin(); return; }
      if (token()) { boot(); return; }
      watchLogin();
    }, 1500);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.hidden) { schedule(2000); return; }
      if (fatal === 'no_room') { boot(); return; }
      if (!S) { boot(); return; }
      if (S.status === 'closed') {
        /* 已经结束了：保留最终结果给他看，但老师要是重开了新房间就跟过去 */
        rpc('jf_team_mine').then(function (res) {
          if (res && res.room && Number(res.room) !== Number(S.room)) return loadState(res.room);
        }).then(function () { schedule(5000); }).catch(function () { schedule(5000); });
        return;
      }
      loadState(S.room).then(function () { schedule(POLL_MS); }).catch(function (e) {
        if (e && e.status === 401) return showFatal('no_login');
        schedule(POLL_MS);   // 网络抖一下不打断，下一轮再试
      });
    }, ms);
  }

  /* ---------- 交互 ---------- */

  /* 点组卡片 = 加入/换组（手机上点比拖更稳，两条路都通到 sit()） */
  document.addEventListener('click', function (e) {
    var g = e.target.closest ? e.target.closest('.gb-group') : null;
    if (!g) return;
    if (g.dataset.locked === '1') { toast('老师已锁定，不能改'); return; }
    var n = Number(g.dataset.table);
    if (!n) return;
    sit(n);
  });

  /* 拖动选位：把「我自己」那条身份卡拖到某组加入、拖回未分组起身。鼠标/触摸同一套 pointer 事件 */
  function meDragStart(e) {
    var card = e.target.closest ? e.target.closest('.gb-me-card') : null;
    if (!card || !S || S.status !== 'open' || busy) return;
    if (e.button != null && e.button !== 0) return;   // 只认左键 / 单指
    e.preventDefault();
    var r = card.getBoundingClientRect();
    var el = card.cloneNode(true);
    el.classList.add('me-ghost');
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
    document.body.appendChild(el);
    el.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)';
    drag = { el: el, moved: false };
    document.body.classList.add('me-dragging');
    card.classList.add('is-lifting');   // 原卡半透明，提示「这张被拎起来了」
  }
  function meDragMove(e) {
    if (!drag) return;
    drag.moved = true;
    drag.el.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var g = t && t.closest ? t.closest('.gb-group') : null;
    var p = t && t.closest ? t.closest('.gb-pending') : null;
    document.querySelectorAll('.gb-group, .gb-pending').forEach(function (d) {
      d.classList.toggle('drag-over', d === g || d === p);
    });
  }
  function meDragEnd(e) {
    if (!drag) return;
    document.body.classList.remove('me-dragging');
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var g = t && t.closest ? t.closest('.gb-group') : null;
    var p = t && t.closest ? t.closest('.gb-pending') : null;
    var table = g ? Number(g.dataset.table) : 0;
    document.querySelectorAll('.gb-group, .gb-pending').forEach(function (d) { d.classList.remove('drag-over'); });
    document.querySelectorAll('.gb-me-card.is-lifting').forEach(function (d) { d.classList.remove('is-lifting'); });
    if (drag.el && drag.el.parentNode) drag.el.remove();
    drag = null;
    if (!S || S.status !== 'open') return;
    if (p && !g) { stand(); return; }   // 拖回未分组 = 起身
    if (!table) return;
    sit(table);
  }
  document.addEventListener('pointerdown', meDragStart);
  document.addEventListener('pointermove', meDragMove);
  document.addEventListener('pointerup', meDragEnd);
  document.addEventListener('pointercancel', meDragEnd);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (fatal === 'no_login' && token()) { boot(); return; }
    if (S) loadState(S.room).catch(function () {});
  });

  boot();
})();
