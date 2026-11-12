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

  /* 座位风格（2026-11-12 U4）：round 圆桌 / grid 行列，纯显示层切换，不动数据。
     记住学生上次选的那个，下次进来还是它。 */
  var seatStyle = 'round';
  try { seatStyle = localStorage.getItem('jf-team-style') || 'round'; } catch (e) {}
  if (seatStyle !== 'grid') seatStyle = 'round';
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
    $('desks').innerHTML = '';
    $('seatToolbar').hidden = true;
    $('bar').hidden = true;
    $('statePill').textContent = '';
    $('statePill').className = 'top-state';
    if (kind === 'no_login') {
      $('clsName').textContent = '还没登录';
      $('who').textContent = '';
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
      $('clsName').textContent = '账号没绑定班级';
      $('who').textContent = '';
      notice('<b>这个账号还没有绑到班级名单上。</b><br>' +
        '要么你用的是老师账号，要么老师还没把这份名单开通到你的学号。' +
        '先问老师确认名单里有你，再回首页重新登录一次。');
    } else if (kind === 'no_room') {
      $('clsName').textContent = (extra && extra.class) || '本班';
      $('who').textContent = extra && extra.me ? extra.me.name + ' · ' + extra.me.no : '';
      notice('<b>老师还没开放组队。</b><br>等老师在加分助手里点「开放组队」，这个页面会自动出现圆桌，不用刷新。');
    } else {
      $('clsName').textContent = '打不开';
      $('who').textContent = '';
      notice('<b>读取失败：</b>' + esc(extra && extra.message || '未知错误') +
        '<br>检查一下网络，或者退出重新登录再试。');
    }
  }

  /* ---------- 画桌卡 ----------
     2026-11-06 用户：「学生端目前的圆桌太丑了 就用排课 ui 和卡片交互设计」。
     原来是一圈圆点 + 圆形排布（.desk-round + seatDots 算圆周坐标），在手机上又小又挤，
     名字只能缩在圆里。现在换成和排课同款的卡片：桌号 + 已坐/容量 + 座位上的人名，
     点一张卡就坐这桌。座位点（seatDots）连同那条圆周计算一起删掉——卡片上的
     「空位」占位格就是座位，不另外画点了。 */

  /* 座位风格切换（圆桌 / 行列）：只改 #desks 的布局 class，数据一个字节都不动 */
  function applyStyle() {
    var desks = $('desks');
    desks.classList.toggle('style-grid', seatStyle === 'grid');
    desks.classList.toggle('style-round', seatStyle === 'round');
    document.querySelectorAll('#styleSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.style === seatStyle);
    });
  }

  /* 顶部工具栏：风格胶囊 + 一张可拖的「我」卡。拖到某桌 = 坐那桌（drag 见文末交互区） */
  function renderToolbar() {
    var tb = $('seatToolbar');
    if (!S) { tb.hidden = true; return; }
    tb.hidden = false;
    applyStyle();
    var mine = S.me && S.me.table ? Number(S.me.table) : 0;
    var open = S.status === 'open';
    var chip = $('meChip');
    chip.hidden = false;
    chip.className = 'me-chip' + (mine ? ' seated' : '') + (open ? '' : ' locked');
    chip.textContent = mine ? ('我 · 第 ' + mine + ' 桌') : '我 · 还没选桌';
    chip.dataset.seated = mine ? '1' : '0';
  }

  /* 坐下 / 换桌：请求全走 jf_team_sit，满没满、能不能坐都由云端判，前端不越权 */
  function sit(n) {
    if (busy || !S || S.status !== 'open') return;
    if (S.me && Number(S.me.table) === n) { toast('你已经在第 ' + n + ' 桌了'); return; }
    var filled = (S.seats || []).filter(function (s) { return Number(s.table) === n; }).length;
    if (filled >= S.size) { toast('第 ' + n + ' 桌坐满了，换一张吧'); return; }
    busy = true;
    rpc('jf_team_sit', { p_room: S.room, p_table: n }).then(function () {
      return loadState(S.room);
    }).then(function () {
      toast('坐好了：第 ' + n + ' 桌');
    }).catch(function (err) {
      toast(err.message || '没坐进去，再试一次');
      return loadState(S.room).catch(function () {});
    }).then(function () { busy = false; });
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
    var html = '';

    for (var n = 1; n <= S.tables; n++) {
      var list = byTable[n] || [];
      var full = list.length >= S.size;
      var isMine = mine === n;
      /* 座位按「已坐的人 + 剩余空位」画满整排：一眼看出这桌还剩几个位置 */
      var seats = '';
      for (var i = 0; i < S.size; i++) {
        var s = list[i];
        if (s) {
          var me = S.me && s.student === S.me.id;
          seats += '<span class="tc-seat' + (me ? ' me' : '') + '" title="' +
            esc(s.name) + '">' + esc(s.name) + '</span>';
        } else {
          seats += '<span class="tc-seat empty">空位</span>';
        }
      }
      var foot = isMine
        ? (locked ? '你在这桌' : '你在这桌 · 点别的桌换桌')
        : full ? '已坐满'
          : locked ? '老师已锁定'
            : '点一下坐这桌';
      html += '<button class="desk tcard' + (isMine ? ' mine' : '') + (full && !isMine ? ' full' : '') + '"' +
        ' data-table="' + n + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="tc-head">' +
          '<span class="tc-no">第 ' + n + ' 桌' + (isMine ? ' · 我在这' : '') + '</span>' +
          '<span class="tc-count"><b>' + list.length + '</b>/' + S.size + '</span>' +
        '</span>' +
        '<span class="tc-seats">' + seats + '</span>' +
        '<span class="tc-foot">' + foot + '</span>' +
        '</button>';
    }
    $('desks').innerHTML = html;
    renderToolbar();

    var pill = $('statePill');
    pill.className = 'top-state' + (S.status === 'open' ? '' : S.status === 'locked' ? ' locked' : ' closed');
    pill.textContent = S.status === 'open' ? '组队中' : S.status === 'locked' ? '老师已锁定' : '已结束';

    clearNotice();
    if (S.status === 'locked') {
      notice('<b>老师已经锁定分组了。</b><br>现在只能看，不能改。有意见直接跟老师说。');
    } else if (S.status === 'closed') {
      notice('<b>这次组队已经结束。</b><br>分组结果已交给老师，下面就是最终结果。');
    }

    var bar = $('bar'), info = $('barInfo'), stand = $('btnStand');
    if (mine) {
      bar.hidden = false;
      info.innerHTML = '你坐在 <b>第 ' + mine + ' 桌</b>' +
        (S.status === 'open' ? '，想换就直接点别的桌' : '');
      stand.hidden = S.status !== 'open';
    } else if (S.status === 'open') {
      bar.hidden = false;
      info.innerHTML = '<b>还没选桌</b>：点上面任意一张桌卡坐下';
      stand.hidden = true;
    } else {
      bar.hidden = true;
    }

    var left = (S.roster || []).length - (S.seats || []).length;
    $('tip').textContent = S.status === 'open'
      ? '全班 ' + (S.roster || []).length + ' 人，已选 ' + (S.seats || []).length + ' 人' +
        (left > 0 ? '，还有 ' + left + ' 人没选。' : '，全班都选好了。') +
        ' 把上面的「我」拖到某桌，或直接点某桌坐下；点别的桌就是换桌。每 2~3 秒自动刷新，能看到别人刚坐下的位置。'
      : '';
  }

  /* ---------- 数据 ---------- */

  function apply(payload) {
    fatal = null;            // 之前“老师还没开房间”之类的提示要先撤掉，否则画不出圆桌
    S = payload;
    $('clsName').textContent = payload.class || '本班';
    $('who').textContent = payload.me ? payload.me.name + ' · ' + payload.me.no : '';
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

  /* 点桌卡 = 坐下/换桌（手机上点比拖更稳，两条路都通到 sit()） */
  document.addEventListener('click', function (e) {
    var desk = e.target.closest ? e.target.closest('.desk') : null;
    if (!desk) return;
    var n = Number(desk.dataset.table);
    if (!n) return;
    sit(n);
  });

  /* 拖动选位：把「我」这张卡拖到某桌坐下。鼠标/触摸同一套 pointer 事件 */
  function meDragStart(e) {
    var chip = e.target.closest ? e.target.closest('#meChip') : null;
    if (!chip || chip.hidden || !S || S.status !== 'open' || busy) return;
    if (e.button != null && e.button !== 0) return;   // 只认左键 / 单指
    e.preventDefault();
    var r = chip.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'me-ghost';
    el.textContent = chip.textContent;
    el.style.width = r.width + 'px';
    document.body.appendChild(el);
    el.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0)';
    drag = { el: el, moved: false };
    document.body.classList.add('me-dragging');
  }
  function meDragMove(e) {
    if (!drag) return;
    drag.moved = true;
    drag.el.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var desk = t && t.closest ? t.closest('.desk') : null;
    document.querySelectorAll('.desk').forEach(function (d) {
      d.classList.toggle('drag-over', d === desk);
    });
  }
  function meDragEnd(e) {
    if (!drag) return;
    document.body.classList.remove('me-dragging');
    var t = document.elementFromPoint(e.clientX, e.clientY);
    var desk = t && t.closest ? t.closest('.desk') : null;
    var table = desk ? Number(desk.dataset.table) : 0;
    document.querySelectorAll('.desk').forEach(function (d) { d.classList.remove('drag-over'); });
    if (drag.el && drag.el.parentNode) drag.el.remove();
    drag = null;
    if (!table || !S || S.status !== 'open') return;
    sit(table);
  }
  document.addEventListener('pointerdown', meDragStart);
  document.addEventListener('pointermove', meDragMove);
  document.addEventListener('pointerup', meDragEnd);
  document.addEventListener('pointercancel', meDragEnd);

  /* 座位风格切换：记进 localStorage，下次进来还是这个 */
  document.querySelectorAll('#styleSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      seatStyle = b.dataset.style;
      try { localStorage.setItem('jf-team-style', seatStyle); } catch (e) {}
      applyStyle();
    });
  });

  $('btnStand').addEventListener('click', function () {
    if (busy || !S || S.status !== 'open' || !S.me) return;
    busy = true;
    rpc('jf_team_stand', { p_room: S.room }).then(function () {
      return loadState(S.room);
    }).then(function () { toast('已起身，可以重新选桌'); })
      .catch(function (err) { toast(err.message || '操作失败'); })
      .then(function () { busy = false; });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (fatal === 'no_login' && token()) { boot(); return; }
    if (S) loadState(S.room).catch(function () {});
  });

  boot();
})();
