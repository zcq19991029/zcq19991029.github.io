/* 学生端：只读查自己的分数（上课记分 / 组内个人评分 / 本学期总分 / 成绩登分册）。
 *
 * 数据只有一个来源：jf_my_scores()。这个函数在数据库里用 auth.uid() 反查我是谁，
 * 只把「我自己那一行」还给我 —— 同学的分数不会下发到我的浏览器。
 * 页面自己不做任何分数计算，也不允许任何输入：四个模块全是只读展示。
 *
 * 实时性：老师那边一存分，客户端会把新的快照发布上去；这里每 4 秒拉一次，
 * 所以最慢几秒就能看到新分数，不用刷新。
 */
(function () {
  'use strict';

  var CFG = window.JFDT_CONFIG || {};
  var API = String(CFG.supabaseUrl || '').replace(/\/$/, '');
  var KEY = CFG.supabasePublishableKey || '';
  var AUTH = API + '/auth/v1';
  var SESSION_KEY = 'paike-session';
  var PORTAL = 'https://zcq19991029.github.io/';
  var POLL_MS = 4000;

  var D = null;            // 最近一次快照
  var tab = 'score';
  var timer = null;
  var fatal = null;        // no_login / not_student / no_data / error

  /* 组内互评（2026-11-04）：老师按「本节课」开放后，组长才能给组员打分、组员才能给组长打分。
     其他课次一律只读；这里只存「本节」的看板，换课要重新拉。 */
  var peer = { lessons: [], lesson: '', data: null, msg: '', busy: false, loaded: false, queue: Promise.resolve() };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 登录态（和华夏工具共用 paike-session） ---------- */

  function readSession() {
    try { var raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  /* 只覆盖凭证三项，别把其他工具的登录态弄坏 */
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
          var err = new Error('NO_LOGIN'); err.status = 401; throw err;
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

  /* ---------- 小工具 ---------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    if (v === null || v === undefined || v === '' || !isFinite(v)) return '';
    var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10;
    return n % 1 === 0 ? String(n) : n.toFixed(1);
  }
  function md(date) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    return m ? (Number(m[2]) + '-' + m[3]) : String(date || '');
  }
  function pct(v) { return v === null || v === undefined ? '—' : num(v) + '%'; }
  /* 显示层（2026-11-09 完成率改革）：5 分制单位 → 百分比（1–5 → 20%–100%），
     提交与存储仍是 1–5 分，一个字段都不改 */
  function scorePct(v) {
    var n = Math.round(Math.max(0, Math.min(5, Number(v) || 0)) / 5 * 1000) / 10;
    return (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1)) + '%';
  }

  function notice(html, cls) {
    var box = $('notice');
    box.innerHTML = html;
    box.hidden = false;
    box.className = 'notice' + (cls ? ' ' + cls : '');
  }
  function clearNotice() { $('notice').hidden = true; $('notice').innerHTML = ''; }

  function showFatal(kind, extra) {
    fatal = kind;
    ['view-score', 'view-leader', 'view-total', 'view-book'].forEach(function (id) { $(id).innerHTML = ''; });
    $('sync').textContent = '';
    if (kind === 'no_login') {
      $('clsName').textContent = '还没登录';
      $('who').textContent = '';
      notice('<b>请先用学号登录华夏工具，再回来看分数。</b>' +
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
    } else if (kind === 'no_data') {
      $('clsName').textContent = (extra && extra.class) || '本班';
      $('who').textContent = extra && extra.me ? (extra.me.name || '') + (extra.me.no ? ' · ' + extra.me.no : '') : '';
      notice('<b>老师还没发布分数。</b><br>' +
        '老师在加分助手里一记分，这里会自动出现你的分数，不用刷新。' +
        '<br><br>先把这一页留着，等上课记完分再回来看。');
      schedule(5000);
    } else {
      $('clsName').textContent = '打不开';
      $('who').textContent = '';
      notice('<b>读取失败：</b>' + esc(extra && extra.message || '未知错误') +
        '<br>检查一下网络，或者退出重新登录再试。');
      schedule(5000);
    }
  }

  /* ---------- 渲染 ---------- */

  function lessonLabel(l) {
    return '第 ' + (l.seq || '?') + ' 次' + (l.date ? ' · ' + md(l.date) : '');
  }

  function renderScore() {
    var d = D;
    if (!d) return '';
    var ls = d.lessons || [];
    var recorded = ls.filter(function (l) { return l.pct !== null; }).length;
    /* 显示层（2026-11-09 完成率改革）：累计与每课数字一律按百分比显示；
       快照里的原始分值一个字段不改，这里只做显示换算 */
    var taskMax = Number(d.total.taskMax) || 0;
    var namedMax = Math.max(0, taskMax - 5 * (d.lessons || []).length);   // 命名项目的满分 = taskMax − 每课5
    var totalRate = taskMax ? Math.round(Math.max(0, d.total.total) / taskMax * 1000) / 10 : null;
    var projectRate = namedMax ? Math.round(Math.max(0, d.total.project) / namedMax * 1000) / 10 : null;
    var html = '<div class="card"><h3>累计到现在</h3><div class="big">' +
      '<div class="n"><em>' + (totalRate == null ? '—' : num(totalRate) + '%') + '</em><span>当前累计完成率</span></div>' +
      '<div class="n good"><em>' + (projectRate == null ? '—' : num(projectRate) + '%') + '</em><span>个人项目累计</span></div>' +
      '</div><p class="note">当前累计完成率 ＝（全组累计 ＋ 个人项目 − 本人扣分）÷ 项目满分，内部按分值计算、显示按百分比。' +
      '已登记 ' + recorded + ' / ' + ls.length + ' 次课。</p></div>';

    html += '<div class="card"><h3>每次课的分数（新的在上面）</h3>';
    if (!ls.length) {
      html += '<p class="note">还没有课次。老师上完第一次课记分后就会出现在这里。</p>';
    } else {
      ls.slice().reverse().forEach(function (l) {
        var minus = [];
        if (l.phone) minus.push('<span class="minus">−' + (num(l.phone) * 20) + '%</span> 全组扣分');
        if (l.personal) minus.push('<span class="minus">−' + (num(l.personal) * 20) + '%</span> 我的个人扣分');
        html += '<div class="lesson">' +
          '<div class="lesson-head"><b>' + lessonLabel(l) + '</b>' +
          '<span class="pct">' + (l.pct === null ? '<span class="pill warn">还没录分</span>' : pct(l.pct)) + '</span></div>' +
          '<div class="kv">' +
          '<div>干净又卫生 <i>' + scorePct(l.group) + '</i>' + (minus.length ? '　' + minus.join('　') : '') + '</div>' +
          '<div>本课净得 <i>' + scorePct(l.net) + '</i></div>' +
          '</div>' +
          /* 2026-11-10 用户要求：学生端要看到「项目详细分」，不能只有一个笼统的「个人项目 X%」。
             把每节课的每个命名项目逐项列出来（项目名 + 该项得分），没录的标「待评」。 */
          (l.projects && l.projects.length
            ? '<div class="proj">' + l.projects.map(function (p) {
                return '<span><span class="nm">' + esc(p.n) + '</span>' +
                  (p.s === null ? '<span class="sc wait">待评</span>' : '<span class="sc">' + scorePct(p.s) + '</span>') +
                  '</span>';
              }).join('') + '</div>'
            : '') +
          '</div>';
      });
    }
    html += '</div>';
    return html;
  }

  /* ---------- 组内互评（2026-11-04） ----------
     只对「老师当节点了开放」的那一节课生效；其他课次仍只看自己快照，改不了。
     数据全在云端：jf_peer_open 列出开放的课，jf_peer_mine 拉本节我这一组，
     jf_peer_submit / jf_peer_clear 打分和撤分。
     2026-11-09 起取消了「教师逐列确认」：学生提交直接计入成绩（老师随时可以手改）。
     历史上被标成 confirmed 的列仍然锁定，学生改不了（老师那边可以「清空本列」重新来）。 */

  function peerMineMap() {
    var map = Object.create(null);
    ((peer.data && peer.data.mine) || []).forEach(function (r) { map[r.project + '\u0000' + r.target] = r.score; });
    return map;
  }
  function peerScore(project, target) {
    return peerMineMap()[project + '\u0000' + target];
  }
  /* 没有「待确认」这一档了：提交了就计入。confirmed = 历史确认过的锁定列，rejected = 老师作废的列 */
  function peerStatusText(s) { return s === 'confirmed' ? '已锁定' : s === 'rejected' ? '已作废' : '已计入'; }
  function peerStatusClass(s) { return 'peer-badge is-' + (s === 'confirmed' ? 'confirmed' : s === 'rejected' ? 'rejected' : 'counted'); }

  function refreshPeer(reset) {
    return rpc('jf_peer_open', {}).then(function (res) {
      peer.lessons = (res && res.lessons) || [];
      peer.loaded = true;
      if (!peer.lessons.length) { peer.lesson = ''; peer.data = null; return null; }
      var keep = !reset && peer.lessons.some(function (l) { return l.lesson === peer.lesson; });
      if (!keep) peer.lesson = peer.lessons[0].lesson;
      return rpc('jf_peer_mine', { p_lesson: peer.lesson }).then(function (d) {
        peer.data = d && d.ok ? d : null;
        return peer.data;
      });
    }).catch(function (e) {
      peer.loaded = true;
      /* 云端没装这套函数时不该把整页打挂：静默降级成只读 */
      if (e && e.status === 401) throw e;
      peer.lessons = [];
      peer.data = null;
      return null;
    });
  }

  /* 打分的请求排队发：先点 3 再双击撤销，两个请求按点击顺序到云端，最后一定是「撤销」。
     界面上先乐观更新（点完立刻变），失败再退回原值。 */
  function peerRun(task) {
    peer.queue = peer.queue.then(task, task);
    return peer.queue;
  }

  function submitPeer(project, target, score) {
    if (!peer.data) return;
    /* 排位列兜底：正常界面点不到（按钮不渲染），这条挡旧缓存页 / 控制台直调 */
    if (isTaskCol(project)) {
      peer.msg = '「' + project + '」是线上排位列：只有真实完成排位才能得分，不能互评打分。';
      paint();
      return;
    }
    var lessonKey = peer.data.lesson, prev = peerScore(project, target);
    upsertMine(project, target, score);
    peer.busy = true;
    paint();
    peerRun(function () {
      return rpc('jf_peer_submit', { p_lesson: lessonKey, p_project: project, p_target: target, p_score: score });
    }).then(function () {
      peer.msg = '已提交 ' + scorePct(score) + '，已计入成绩。';
    }, function (e) {
      upsertMine(project, target, prev);
      peer.msg = (e && e.message) || '提交失败，检查网络后重试。';
    }).then(function () {
      peer.busy = false;
      return refreshPeer(false);
    }).catch(function () {}).then(function () { paint(); });
  }

  function clearPeer(project, target) {
    if (!peer.data) return;
    if (isTaskCol(project)) return;   // 排位列从来不打分，也就没有可撤销的分
    var lessonKey = peer.data.lesson, prev = peerScore(project, target);
    if (prev == null) return;
    upsertMine(project, target, null);
    peer.busy = true;
    paint();
    peerRun(function () {
      return rpc('jf_peer_clear', { p_lesson: lessonKey, p_project: project, p_target: target });
    }).then(function () {
      peer.msg = '已撤销这一格的加分。';
    }, function (e) {
      upsertMine(project, target, prev);
      peer.msg = (e && e.message) || '撤销失败，检查网络后重试。';
    }).then(function () {
      peer.busy = false;
      return refreshPeer(false);
    }).catch(function () {}).then(function () { paint(); });
  }

  function upsertMine(project, target, score) {
    if (!peer.data) return;
    if (!Array.isArray(peer.data.mine)) peer.data.mine = [];
    var hit = peer.data.mine.find(function (r) { return r.project === project && r.target === target; });
    if (score == null) { peer.data.mine = peer.data.mine.filter(function (r) { return r !== hit; }); return; }
    if (hit) hit.score = score;
    else peer.data.mine.push({ project: project, target: target, score: score });
  }

  /* 线上排位列（2026-11-11 修互评刷分漏洞）：列名带「线上连线排位 / 接线」前缀的是
     课堂任务自动入账的成绩列，只有学生真实完成线上排位才能得分。
     互评（组长给组员 / 组员给组长）对这一列一律只读：不渲染 20%–100% 打分按钮，
     也不能撤销 —— 互相刷分就行、没人真去做排位，这条口子必须堵死。
     ⚠ 前缀口径与 app.js 的 taskScore()、wire-task-link.js 的 NAME_PREFIX 保持一致，
       三处必须一起改，否则老数据的旧列名「接线2.3」会漏判。 */
  var TASK_COL = /^(?:接线|线上连线排位)/;
  function isTaskCol(name) { return TASK_COL.test(String(name == null ? '' : name).trim()); }

  function peerCellHtml(project, target) {
    var value = peerScore(project.name, target.key), locked = project.status === 'confirmed';
    var label = esc(target.name) + ' · ' + esc(project.name);
    /* 2026-11-11 手机适配：窄屏下整张表会被拆成「一人一张卡」，表头（项目名）看不见了，
       所以每个格子自带一份项目名；宽屏由 CSS 隐藏，桌面端外观不变。 */
    var projTag = '<span class="peer-cell-proj">' + esc(project.name) + '</span>';
    /* 线上排位列：只读占位（不带 data-project / data-target，点击和双击都进不来），
       配一行小字说明「只有真实完成排位才能得分」，避免学生以为这一列坏了 */
    if (isTaskCol(project.name)) {
      return '<div class="peer-cell is-locked" title="线上排位列：只有真实完成线上排位才能自动得分，互评打不了分">' +
        projTag + '<span>线上排位列 · 只有真实完成排位才能得分</span></div>';
    }
    if (value != null) {
      return '<div class="peer-cell is-set" data-score="' + value + '" data-project="' + esc(project.name) +
        '" data-target="' + esc(target.key) + '" role="button" tabindex="0" title="双击撤销这一格的加分">' +
        projTag + '<span class="peer-score">' + scorePct(value) + '</span></div>';
    }
    if (locked) {
      return '<div class="peer-cell is-locked" title="老师已确认这一列，不能再改">' +
        projTag + '<span>已锁定</span></div>';
    }
    return '<div class="peer-cell" data-project="' + esc(project.name) + '" data-target="' + esc(target.key) + '" role="group" aria-label="' + label + '">' +
      projTag +
      [1, 2, 3, 4, 5].map(function (s) {
        /* 2026-11-09 显示层改革：按钮显示 20%~100%；data-peer-pick 仍是 1–5 */
        return '<button type="button" class="peer-pick p' + s + '" data-peer-pick="' + s + '" aria-label="' + label + ' 给 ' + scorePct(s) + '" title="给 ' + scorePct(s) + '">' + scorePct(s) + '</button>';
      }).join('') + '</div>';
  }

  function renderPeerCard() {
    if (!peer.loaded) {
      return '<div class="card peer-card"><div class="peer-card-head"><h3>组内互评</h3></div>' +
        '<p class="note">正在读取本节课的互评状态…</p></div>';
    }
    if (peer.lessons.length === 0) {
      return '<div class="card peer-card"><div class="peer-card-head"><h3>组内互评</h3>' +
        '<span class="peer-pill is-closed">未开放 · 只读</span></div>' +
        '<p class="note">老师还没开放本节课的「组长打分」。开放后：组长给本组组员打分，组员给组长打分（取平均），' +
        '提交后直接计入成绩。其他课次一律只读。</p></div>';
    }
    var d = peer.data;
    if (!d) {
      return '<div class="card peer-card"><div class="peer-card-head"><h3>组内互评</h3>' +
        '<span class="peer-pill is-open">教师已开放</span></div>' +
        '<p class="note">' + (peer.loaded
          ? '老师开放了本节课的互评，但名单里找不到你所在的组。先找老师确认一下座位和分组，再回来打分。'
          : '正在读取本节课的互评名单…') +
        (peer.msg ? '（' + esc(peer.msg) + '）' : '') + '</p></div>';
    }

    var targets = d.me.is_leader
      ? (d.members || []).filter(function (m) { return m.key !== d.me.key; })
      : (d.members || []).filter(function (m) { return m.key === (d.leader && d.leader.key); });
    var projects = d.projects || [];

    var html = '<div class="card peer-card"><div class="peer-card-head"><h3>组内互评 · 第 ' + d.seq + ' 次课</h3>' +
      '<span class="peer-pill is-open">教师已开放</span>' +
      (peer.lessons.length > 1 ? '<select id="peerLessonSel" aria-label="选择开放互评的课次">' +
        peer.lessons.map(function (l) {
          return '<option value="' + esc(l.lesson) + '"' + (l.lesson === d.lesson ? ' selected' : '') + '>第' + l.seq + '次 · ' + esc(md(l.date)) + '</option>';
        }).join('') + '</select>' : '') +
      '</div>' +
      '<p class="note">' + (d.me.is_leader
        ? '你是 <b>第 ' + d.me.group_no + ' 组组长</b>：给本组组员逐项打分（每项满分 100%，按 20% 一档）。'
        : '你是 <b>第 ' + d.me.group_no + ' 组组员</b>：给组长 <b>' + esc((d.leader && d.leader.name) || '') + '</b> 打分（每项满分 100%，按 20% 一档）。') +
      '点 20%–100% 直接记分，双击分数撤销。提交后直接计入成绩（老师可以随时手改）。' +
      (peer.msg ? '<br><b class="peer-msg">' + esc(peer.msg) + '</b>' : '') + '</p>';

    if (!projects.length) {
      html += '<p class="note">老师还没在本节课填项目名称，等填好后再来打分。</p>';
    } else if (!targets.length) {
      html += '<p class="note">本组暂时没有可打分的对象。</p>';
    } else {
      html += '<div class="peer-scroll"><table class="peer-grid"><thead><tr><th>成员</th>' +
        projects.map(function (p) {
          return '<th><span class="peer-proj">' + esc(p.name) + '</span>' +
            '<em class="' + peerStatusClass(p.status) + '">' + peerStatusText(p.status) + '</em></th>';
        }).join('') + '</tr></thead><tbody>' +
        targets.map(function (m) {
          return '<tr><th class="peer-who">' + (m.leader ? '<span aria-label="组长">👑</span> ' : '') + esc(m.name) + '</th>' +
            projects.map(function (p) { return '<td>' + peerCellHtml(p, m) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (projects.length > 2 ? '<p class="peer-swipe-hint">左右滑动可以看更多项目列 →</p>' : '');
    }

    var got = (d.got || []).map(function (g) {
      var st = (projects.filter(function (p) { return p.name === g.project; })[0] || {}).status || 'pending';
      /* 组长分至少 2 人打分才算（2026-11-09 用户要求）：只有 1 人打的时候如实说「还差 1 人」，
         别把一个人的分当成全组的评价展示出来，组长自己也会以为已经定了。 */
      var body;
      if (g.avg && g.count < 2) {
        body = '<span class="peer-wait">还差 ' + (2 - g.count) + ' 人（至少 2 人打分才取平均）</span>';
      } else {
        body = g.avg ? scorePct(g.score) + '<small>（' + g.count + ' 人平均）</small>' : scorePct(g.score);
      }
      return '<span class="peer-got-item"><b>' + esc(g.project) + '</b> ' + body +
        ' <em class="' + peerStatusClass(st) + '">' + (g.avg && g.count < 2 ? '暂不计入' : peerStatusText(st)) + '</em></span>';
    }).join('');
    html += '<div class="peer-got"><span class="peer-got-label">我收到的分</span>' +
      (got || '<span class="note">还没有人给我打分。</span>') + '</div>' +
      '<p class="note">组长分数 = 组员给的分求平均，<b>至少 2 个人打分才算</b>（打几次除几次，不除组员总数）。' +
      '例如两个组员分别打 60% 和 100% → 组长 80%；只有 1 个人打的时候先不计入，等第二个组员打完就自动算上。' +
      '提交后直接计入总分，老师可以随时手改。</p></div>';
    return html;
  }

  function renderLeader() {
    var d = D;
    if (!d) return '';
    var ls = (d.lessons || []).filter(function (l) { return l.projects.length; });
    var namedMax = Math.max(0, (Number(d.total.taskMax) || 0) - 5 * (d.lessons || []).length);
    var projectRate = namedMax ? num(Math.round(Math.max(0, d.total.project) / namedMax * 1000) / 10) + '%' : '—';
    var html = renderPeerCard() + renderGroupCard() +
      '<div class="card"><h3>组内个人评分</h3><div class="big">' +
      '<div class="n good"><em>' + projectRate + '</em><span>个人项目累计</span></div>' +
      '<div class="n"><em>' + (d.group && d.group.size ? d.group.rank + ' / ' + d.group.size : '—') +
      '</em><span>组内名次（按累计）</span></div>' +
      '</div><p class="note">' + esc(d.me.gname || '') + '，共 ' + (d.group ? d.group.size : 0) + ' 人。' +
      '个人项目由组长在课上逐项打分，每项满分 100%（20% 一档）；「待评」表示还没录，不是 0 分。</p></div>';

    html += '<div class="card"><h3>每节课我的项目分</h3>';
    if (!ls.length) {
      html += '<p class="note">还没有录入个人项目。组长在「组内个人评分」里打分后就会出现在这里。</p>';
    } else {
      ls.slice().reverse().forEach(function (l) {
        html += '<div class="lesson"><div class="lesson-head"><b>' + lessonLabel(l) + '</b>' +
          '<span class="pct">' + num(Math.round(Math.max(0, l.earned) / (l.projects.length * 5) * 1000) / 10) + '%</span></div>' +
          '<div class="proj">' + l.projects.map(function (p) {
            return '<span><span class="nm">' + esc(p.n) + '</span>' +
              (p.s === null ? '<span class="sc wait">待评</span>' : '<span class="sc">' + scorePct(p.s) + '</span>') +
              '</span>';
          }).join('') + '</div></div>';
      });
    }
    html += '</div>';
    return html;
  }

  /* 我的小组（2026-11-10，用户拍板 B 方案）：自己这一组的组员名单 + 各自项目分，看不到别组。
     组员名单来自快照里的 d.group.members（发布时只塞了本组成员，别组一个字节都没下发），
     前端不做任何分数计算，只把姓名/学号/个人项目累计/平时分平铺出来。 */
  function renderGroupCard() {
    var d = D;
    if (!d || !d.group || !Array.isArray(d.group.members) || !d.group.members.length) {
      return '';
    }
    var members = d.group.members.slice().sort(function (a, b) {
      return (Number(b.project) || 0) - (Number(a.project) || 0);
    });
    var rows = members.map(function (m, i) {
      var isMe = (m.sid && d.me.sid && m.sid === d.me.sid) || (!m.sid && !d.me.sid && m.name === d.me.name);
      return '<tr' + (isMe ? ' class="me-row"' : '') + '>' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="nm"><b>' + esc(m.name) + '</b>' + (isMe ? '<span class="me-tag">我</span>' : '') + '</td>' +
        '<td>' + esc(m.sid || '') + '</td>' +
        '<td>' + (m.project == null ? '—' : num(m.project)) + '</td>' +
        '<td>' + (m.regular == null ? '—' : num(m.regular)) + '</td>' +
        '</tr>';
    }).join('');
    var myRank = 0;
    members.forEach(function (m, i) {
      var isMe = (m.sid && d.me.sid && m.sid === d.me.sid) || (!m.sid && !d.me.sid && m.name === d.me.name);
      if (isMe) myRank = i + 1;
    });
    return '<div class="card group-card"><div class="group-card-head">' +
      '<h3>我的小组</h3>' +
      '<span class="group-rank-badge">组内排名 第 ' + myRank + ' 名</span>' +
      '</div>' +
      '<div class="group-kpis">' +
      '<div class="group-kpi"><span>我的平时分</span><b>' + num(d.total ? d.total.regular : 0) + '</b></div>' +
      '<div class="group-kpi"><span>小组人数</span><b>' + d.group.size + ' 人</b></div>' +
      '<div class="group-kpi"><span>组内第 1</span><b>' + esc(members[0] ? members[0].name : '—') + '</b></div>' +
      '</div>' +
      '<div class="scroll"><table class="book group"><thead><tr>' +
      '<th>#</th><th>组员</th><th>学号</th><th>个人项目累计</th><th>平时分</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="note">这里只显示你自己的小组（' + esc(d.me.gname || '') + '，共 ' + d.group.size +
      ' 人），别的小组看不到。「个人项目累计」是组长在课上逐项打分后的合计，仅供参考，有疑问直接找老师。</p></div>';
  }

  function renderTotal() {
    var d = D, t = d.total;
    var need = t.failed ? '<span class="pill bad">考勤挂科</span>'
      : t.needed === null ? '—'
      : t.needed > 100 ? '<span class="pill warn">已超 100</span>'
      : num(t.needed);
    var html = '<div class="card"><h3>本学期总分</h3><div class="big">' +
      '<div class="n"><em>' + num(t.regular) + '</em><span>平时分 / 100</span></div>' +
      '<div class="n"><em>' + num(t.contribution) + '</em><span>计入总评 / 40</span></div>' +
      '<div class="n' + (t.failed ? ' bad' : '') + '"><em>' + need + '</em><span>期末至少需考</span></div>' +
      '<div class="n ' + (t.final === null ? '' : (t.final >= d.passScore ? 'good' : 'bad')) + '">' +
      '<em>' + (t.final === null ? '—' : num(t.final)) + '</em><span>综合 / 100</span></div>' +
      '</div><p class="note">平时分 40% ＋ 期末 60%。及格线 ' + num(d.passScore) + ' 分。' +
      (t.final === null ? '期末还没录入，所以综合成绩先空着。' : '') + '</p></div>';

    html += '<div class="card"><h3>明细</h3><div class="kv">' +
      '<div>班级名次　<i>' + t.rank + ' / ' + t.count + '</i></div>' +
      '<div>项目完成率　<i>' + num(t.taskRate) + '%</i>' +
      (t.pending ? '　<span class="pill warn">' + t.pending + ' 项待评</span>' : '') + '</div>' +
      '<div>考勤完成率　<i>' + num(t.attRate) + '%</i></div>' +
      '<div>迟到 ' + t.late + ' 次 · 早退 ' + t.early + ' 次 · 旷课 ' + t.truant + ' 次 · 折算 ' + t.converted +
      ' 次 · 合计 <i>' + t.effective + '</i> 次</div>' +
      '<div>实际期末　<i>' + (t.exam === null ? '还没录' : num(t.exam)) + '</i></div>' +
      '<div>记录状态　' + (t.ready ? '<span class="pill">已齐</span>' : '<span class="pill warn">还有没录完的项</span>') + '</div>' +
      '</div></div>';

    html += '<div class="card"><h3>怎么算的</h3><p class="note">' +
      '合并完成率＝(项目净得分＋考勤分)÷(项目满分＋9)，内部按分值计算、显示按百分比；' +
      '考勤是学期固定项目，满分折 100%，扣到 0 或者实际加折算旷课达到门槛就算考勤挂科。<br>' +
      '平时分＝100×合并完成率；计入总评＝平时分×40%。<br>' +
      '期末至少需考＝(及格线 − 平时分×0.4)÷0.6，向上取 0.1 分。<br>' +
      '这一页只能看，改不了。分数有疑问直接找老师。</p></div>';
    return html;
  }

  function renderBook() {
    var d = D, t = d.total;
    var ls = d.lessons || [];
    /* 不列「班级」：页头已经写着班名，留着它只会把日期列挤到屏幕外面去 */
    /* 2026-11-08 用户截图：「学生端缺少信息 这个表最后也要给换算后的分数」。
       原来只有百分制的「平时成绩合计 / 考试%」，学生看不出总评是怎么来的。
       现在把两段折合单列出来（平时×40%、期末×60%），中间一步一目了然，不用自己乘。 */
    var head = '<tr><th>学号</th><th>姓名</th>' +
      ls.map(function (l) { return '<th>' + (l.date ? md(l.date) : '第' + l.seq + '次') + '</th>'; }).join('') +
      '<th>成绩</th><th>考勤%</th><th>平时成绩合计</th><th>折合 40%</th><th>考试%</th><th>折合 60%</th><th>总评</th></tr>';
    var examCut = t.exam === null ? null : num(t.exam * 0.6);
    var row = '<tr><td>' + esc(d.me.sid || d.me.no || '') + '</td><td class="nm"><b>' + esc(d.me.name) + '</b></td>' +
      ls.map(function (l) { return '<td>' + (l.pct === null ? '' : num(l.pct)) + '</td>'; }).join('') +
      '<td>' + num(t.taskRate) + '</td>' +
      '<td>' + num(t.attRate) + '</td>' +
      '<td><b>' + num(t.regular) + '</b></td>' +
      '<td>' + num(t.regular * 0.4) + '</td>' +
      '<td>' + (t.exam === null ? '' : num(t.exam)) + '</td>' +
      '<td>' + (examCut === null ? '' : examCut) + '</td>' +
      '<td><b>' + (t.final === null ? '' : num(t.final)) + '</b></td></tr>';
    return '<div class="card"><h3>成绩登分册（只显示我自己这一行）</h3>' +
      '<div class="scroll"><table class="book"><thead>' + head + '</thead><tbody>' + row + '</tbody></table></div>' +
      '<p class="note">班级：' + esc(d.cls.name) + '。每一格是那一次课的课堂项目完成率（％）。' +
      '「成绩」是整学期的项目完成率，「平时成绩合计」就是平时分（百分制），' +
      '「折合 40%」是它计入总评的分数；「考试％」是实际期末，「折合 60%」同理；' +
      '「总评」＝平时折合＋期末折合。格子空着表示那次课还没录分，期末没录时折合和总评都空着。往右滑可以看到后面的课。</p></div>';
  }

  function paint() {
    if (!D || fatal) return;
    $('view-score').innerHTML = renderScore();
    $('view-leader').innerHTML = renderLeader();
    $('view-total').innerHTML = renderTotal();
    $('view-book').innerHTML = renderBook();
    ['score', 'leader', 'total', 'book'].forEach(function (k) {
      $('view-' + k).classList.toggle('hide', k !== tab);
    });
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === tab);
    });
    clearNotice();
    /* 页头小标签：本节开了互评就写「本节可互评」，否则老实写「只读」 */
    var ro = document.querySelector('.readonly');
    if (ro) {
      var live = !!(peer.data && peer.data.gate);
      ro.textContent = live ? '本节可互评' : '只读';
      ro.classList.toggle('live', live);
    }
  }

  function paintSync() {
    var el = $('sync');
    var at = D && D.at ? new Date(D.at) : null;
    if (!at || isNaN(at.getTime())) { el.textContent = ''; el.classList.remove('stale'); return; }
    var mins = (Date.now() - at.getTime()) / 60000;
    var hh = at.getHours(), mm = ('0' + at.getMinutes()).slice(-2);
    el.classList.toggle('stale', mins > 10);
    el.textContent = '数据更新于 ' + hh + ':' + mm + '（每 4 秒自动刷新）' +
      (mins > 10 ? ' · 老师最近没更新' : '');
  }

  /* ---------- 数据 ---------- */

  function apply(payload) {
    if (!payload || payload.reason) {
      if (payload && payload.reason === 'not_student') return showFatal('not_student');
      return showFatal('no_data', payload || {});
    }
    fatal = null;
    D = payload;
    $('clsName').textContent = (payload.cls && payload.cls.name) || '本班';
    $('who').textContent = (payload.me.name || '') + (payload.me.no ? ' · ' + payload.me.no : '') +
      (payload.me.gname ? ' · ' + payload.me.gname : '');
    paint();
    paintSync();
    /* 只读页也带上本节互评：没开放时这里只多一次查询，不会挡住看分 */
    refreshPeer(false).then(function () { paint(); }).catch(function () {});
    schedule(POLL_MS);
  }

  function fail(e) {
    if (e && (e.status === 401 || e.message === 'NO_LOGIN')) return showFatal('no_login');
    showFatal('error', { message: e && e.message });
  }

  function boot() {
    if (!token()) { showFatal('no_login'); return; }
    rpc('jf_my_scores', {}).then(apply).catch(fail);
  }

  function watchLogin() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.hidden) return watchLogin();
      if (token()) return boot();
      watchLogin();
    }, 1500);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (document.hidden) return schedule(2000);
      if (!token()) return showFatal('no_login');
      rpc('jf_my_scores', {}).then(apply).catch(function (e) {
        if (e && e.status === 401) return showFatal('no_login');
        schedule(POLL_MS);   // 网络抖一下不打断，下一轮再试
      });
    }, ms);
  }

  /* ---------- 交互：切页签 + 本节互评打分（其他课次仍然只读） ---------- */

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.tab;
      paint();
      if (tab === 'leader') refreshPeer(true).then(function () { paint(); }).catch(function () {});
    });
  });

  /* 点 1–5：记这一格；双击已有分数：撤销 */
  document.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('[data-peer-pick]');
    if (!pick) return;
    var cell = pick.closest('.peer-cell');
    if (!cell || !cell.closest('#view-leader')) return;
    submitPeer(cell.dataset.project, cell.dataset.target, Number(pick.dataset.peerPick));
  });
  document.addEventListener('dblclick', function (e) {
    var cell = e.target.closest && e.target.closest('.peer-cell.is-set');
    if (!cell || !cell.closest('#view-leader')) return;
    e.preventDefault();
    clearPeer(cell.dataset.project, cell.dataset.target);
  });
  document.addEventListener('change', function (e) {
    var sel = e.target;
    if (!sel || sel.id !== 'peerLessonSel') return;
    peer.lesson = sel.value;
    peer.data = null;
    peer.msg = '';
    rpc('jf_peer_mine', { p_lesson: peer.lesson }).then(function (d) {
      peer.data = d && d.ok ? d : null;
      paint();
    }).catch(function (err) {
      peer.msg = (err && err.message) || '读取失败，检查网络后重试。';
      paint();
    });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (fatal === 'no_login' && token()) return boot();
    if (D) { rpc('jf_my_scores', {}).then(apply).catch(function () {}); }
  });

  boot();
})();
