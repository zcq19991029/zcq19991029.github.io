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
    var html = '<div class="card"><h3>累计到现在</h3><div class="big">' +
      '<div class="n"><em>' + num(d.total.total) + '</em><span>当前累计总分</span></div>' +
      '<div class="n good"><em>' + num(d.total.project) + '</em><span>个人项目累计</span></div>' +
      '</div><p class="note">当前累计 = 全组累计 ' + num(d.total.groupScore) +
      ' + 个人项目 ' + num(d.total.project) +
      ' − 本人扣分 ' + num(d.total.personal) + '。已登记 ' + recorded + ' / ' + ls.length + ' 次课。</p></div>';

    html += '<div class="card"><h3>每次课的分数（新的在上面）</h3>';
    if (!ls.length) {
      html += '<p class="note">还没有课次。老师上完第一次课记分后就会出现在这里。</p>';
    } else {
      ls.slice().reverse().forEach(function (l) {
        var minus = [];
        if (l.phone) minus.push('<span class="minus">−' + num(l.phone) + '</span> 全组扣分');
        if (l.personal) minus.push('<span class="minus">−' + num(l.personal) + '</span> 我的个人扣分');
        html += '<div class="lesson">' +
          '<div class="lesson-head"><b>' + lessonLabel(l) + '</b>' +
          '<span class="pct">' + (l.pct === null ? '<span class="pill warn">还没录分</span>' : pct(l.pct)) + '</span></div>' +
          '<div class="kv">' +
          '<div>小组分 <i>' + num(l.group) + ' / 5</i>' + (minus.length ? '　' + minus.join('　') : '') + '</div>' +
          '<div>本课净得 <i>' + num(l.net) + ' / 5</i>' +
          (l.duty ? '　值日 <i>' + num(l.duty) + ' / 5</i>' : '') +
          (l.projects.length ? '　个人项目 <i>' + num(l.earned) + ' / ' + l.projects.length * 5 + '</i>' : '') +
          '</div>' +
          '</div></div>';
      });
    }
    html += '</div>';
    return html;
  }

  function renderLeader() {
    var d = D;
    if (!d) return '';
    var ls = (d.lessons || []).filter(function (l) { return l.projects.length; });
    var html = '<div class="card"><h3>组内个人评分</h3><div class="big">' +
      '<div class="n good"><em>' + num(d.total.project) + '</em><span>个人项目累计</span></div>' +
      '<div class="n"><em>' + (d.group && d.group.size ? d.group.rank + ' / ' + d.group.size : '—') +
      '</em><span>组内名次（按累计）</span></div>' +
      '</div><p class="note">' + esc(d.me.gname || '') + '，共 ' + (d.group ? d.group.size : 0) + ' 人。' +
      '个人项目由组长在课上逐项打分，每项满分 5 分；「待评」表示还没录，不是 0 分。</p></div>';

    html += '<div class="card"><h3>每节课我的项目分</h3>';
    if (!ls.length) {
      html += '<p class="note">还没有录入个人项目。组长在「组内个人评分」里打分后就会出现在这里。</p>';
    } else {
      ls.slice().reverse().forEach(function (l) {
        html += '<div class="lesson"><div class="lesson-head"><b>' + lessonLabel(l) + '</b>' +
          '<span class="pct">' + num(l.earned) + ' / ' + l.projects.length * 5 + '</span></div>' +
          '<div class="proj">' + l.projects.map(function (p) {
            return '<span><span class="nm">' + esc(p.n) + '</span>' +
              (p.s === null ? '<span class="sc wait">待评</span>' : '<span class="sc">' + num(p.s) + ' / 5</span>') +
              '</span>';
          }).join('') + '</div></div>';
      });
    }
    html += '</div>';
    return html;
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
      '<div>项目完成率　<i>' + num(t.taskEarned) + ' / ' + num(t.taskMax) + '（' + num(t.taskRate) + '%）</i>' +
      (t.pending ? '　<span class="pill warn">' + t.pending + ' 项待评</span>' : '') + '</div>' +
      '<div>考勤项目　<i>' + num(t.att) + ' / ' + num(t.attMax) + '（' + num(t.attRate) + '%）</i></div>' +
      '<div>迟到 ' + t.late + ' 次 · 早退 ' + t.early + ' 次 · 旷课 ' + t.truant + ' 次 · 折算 ' + t.converted +
      ' 次 · 合计 <i>' + t.effective + '</i> 次</div>' +
      '<div>实际期末　<i>' + (t.exam === null ? '还没录' : num(t.exam)) + '</i></div>' +
      '<div>记录状态　' + (t.ready ? '<span class="pill">已齐</span>' : '<span class="pill warn">还有没录完的项</span>') + '</div>' +
      '</div></div>';

    html += '<div class="card"><h3>怎么算的</h3><p class="note">' +
      '合并完成率＝(项目净得分＋考勤分)÷(项目满分＋9)。考勤是学期固定 9 分：' +
      '扣到 0 或者实际加折算旷课达到门槛，就算考勤挂科。<br>' +
      '平时分＝100×合并完成率；计入总评＝平时分×40%。<br>' +
      '期末至少需考＝(及格线 − 平时分×0.4)÷0.6，向上取 0.1 分。<br>' +
      '这一页只能看，改不了。分数有疑问直接找老师。</p></div>';
    return html;
  }

  function renderBook() {
    var d = D, t = d.total;
    var ls = d.lessons || [];
    /* 不列「班级」：页头已经写着班名，留着它只会把日期列挤到屏幕外面去 */
    var head = '<tr><th>学号</th><th>姓名</th>' +
      ls.map(function (l) { return '<th>' + (l.date ? md(l.date) : '第' + l.seq + '次') + '</th>'; }).join('') +
      '<th>成绩</th><th>考勤%</th><th>平时成绩合计</th><th>考试%</th><th>总评</th></tr>';
    var row = '<tr><td>' + esc(d.me.sid || d.me.no || '') + '</td><td class="nm"><b>' + esc(d.me.name) + '</b></td>' +
      ls.map(function (l) { return '<td>' + (l.pct === null ? '' : num(l.pct)) + '</td>'; }).join('') +
      '<td>' + num(t.taskRate) + '</td>' +
      '<td>' + num(t.attRate) + '</td>' +
      '<td><b>' + num(t.regular) + '</b></td>' +
      '<td>' + (t.exam === null ? '' : num(t.exam)) + '</td>' +
      '<td><b>' + (t.final === null ? '' : num(t.final)) + '</b></td></tr>';
    return '<div class="card"><h3>成绩登分册（只显示我自己这一行）</h3>' +
      '<div class="scroll"><table class="book"><thead>' + head + '</thead><tbody>' + row + '</tbody></table></div>' +
      '<p class="note">班级：' + esc(d.cls.name) + '。每一格是那一次课的课堂项目完成率（％）。' +
      '「成绩」是整学期的项目完成率，「平时成绩合计」就是平时分，' +
      '「考试％」是实际期末，「总评」是平时×40%＋期末×60%。' +
      '格子空着表示那次课还没录分。往右滑可以看到后面的课。</p></div>';
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

  /* ---------- 交互：只有切页签，没有任何写入 ---------- */

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.tab;
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
