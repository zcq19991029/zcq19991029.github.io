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
  /* 2026-11-12 R1：一节可有多个项目（满分 = 项目数 × 5），不能再按 5 分封顶 */
  /* 老快照（没有 raw 字段）的分子 = 旧 net + 旧 earned；新快照直接用 raw */
  function rawOf(l) {
    if (l.raw != null) return l.raw;
    return (Number(l.earned) || 0) + (Number(l.net) || 0);
  }

  /* 身份卡（2026-11-12 起用；2026-11-13 和选桌页统一成同一张）：顶部那张「我自己的 id 卡」，
     背景跟账号走（hx_rank_bg）。数据层 public.hx_rank_bg（hx_rank_bg_get 一人一行 {bg,pos}），
     预设复用根目录 rank-bg.js 的 window.rankBgCss —— 和排位排行榜 / 总入口身份卡弹窗是同一套背景。
     结构写在 scores.html 的 #myCard 里（team.html 顶部那张一模一样，样式统一在 student-ui.css），
     这里只负责填字 + 铺背景，不再自己拼 innerHTML。 */
  var MY_CARD = { bg: '', pos: 50, loaded: false };

  /* 预设键 p:<k> 或 base64 图 → 可直接赋给 background 的样式串（精简自总入口 rkdBgStyle） */
  function cardBgStyle(bg, pos) {
    var s = String(bg || '');
    if (!s) return '';
    var p = Math.max(0, Math.min(100, Number(pos) || 50));
    if (/^p:[a-z0-9_-]{1,24}$/.test(s)) {
      var css = (window.rankBgCss && window.rankBgCss(s.slice(2))) || '';
      /* rank-bg.js 没加载出来时 rankBgCss 是空的：必须返回空串走卡片默认底，
         否则拼出「background:;」会让人以为背景铺上了 */
      if (!css) return '';
      return 'background:' + css.replace(/0 0\s*\/\s*100% 100%/g, '50% 50% / cover') + ';';
    }
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s))
      return 'background-image:url("' + s + '");background-size:cover;background-repeat:no-repeat;background-position:50% ' + p + '%;';
    return '';
  }

  /* 把 hx_rank_bg 铺到卡片的背景层；没有背景就留空，露出卡片自带的深蓝渐变 */
  function paintMyCardBg() {
    var box = $('myCard');
    if (!box) return;
    var bg = $('idcBg') || box.querySelector('.idc-bg');
    var st = cardBgStyle(MY_CARD.bg, MY_CARD.pos);
    if (bg) bg.setAttribute('style', st || '');
    box.setAttribute('data-nobg', st ? '0' : '1');
    if (MY_CARD.loaded) return;
    MY_CARD.loaded = true;
    rpc('hx_rank_bg_get', {}).then(function (rows) {
      var r = rows && rows[0];
      MY_CARD.bg = r ? r.bg : ''; MY_CARD.pos = r ? r.pos : 50;
      paintMyCardBg();          // loaded 已置 true，这一轮只重画、不再请求
    }).catch(function () { MY_CARD.bg = ''; MY_CARD.pos = 50; });
  }

  /* 填身份卡：班级（小字）/ 姓名（大字）/ 学号 / 组别胶囊 + 头像首字。
     me 为空（没登录 / 没绑班级 / 读不到）时只留第一行的说明文字，卡片自动收成一行。 */
  function renderMyCard(me, cls) {
    var box = $('myCard');
    if (!box) return;
    var name = (me && me.name) || '';
    var no = (me && (me.no || me.sid)) || '';
    var g = me ? (me.gname || (me.group_no ? '第 ' + me.group_no + ' 组' : '')) : '';
    var c = $('clsName'), nm = $('who'), sno = $('whoNo'), av = $('idcAv'), gp = $('idcG');
    if (c) c.textContent = cls || (name ? '本班' : '还没登录');
    if (nm) nm.textContent = name;
    if (sno) sno.textContent = no;
    if (av) av.textContent = name ? String(name).slice(0, 1) : '我';
    if (gp) { gp.textContent = g; gp.hidden = !g; }
    box.classList.toggle('is-anon', !name);
    paintMyCardBg();
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
    ['view-score', 'view-total'].forEach(function (id) { $(id).innerHTML = ''; });
    $('sync').textContent = '';
    /* 身份卡统一走 renderMyCard（第二个参数是卡片第一行的说明字）：
       没有姓名时卡片自动收成一行，不会留一片空白 */
    if (kind === 'no_login') {
      renderMyCard(null, '还没登录');
      notice('<b>请先用学号登录华夏工具，再回来看分数。</b>' +
        '<div class="steps">' +
        '<span>1. 点下面的按钮去登录（账号是<b>学号</b>，密码是第一次登录时自己设的）</span>' +
        '<span>2. 登录成功后，回到这一页 —— 不用刷新，它会自己认出你</span>' +
        '</div>' +
        '<a class="btn-primary" style="color:#fff" href="' + PORTAL + '" target="_blank" rel="noopener">去登录 →</a>' +
        '<br><br><small>忘了密码就在登录页点「忘记密码」。没登录过的话，问老师要课堂码注册。</small>');
      watchLogin();
    } else if (kind === 'not_student') {
      renderMyCard(null, '账号没绑定班级');
      notice('<b>这个账号还没有绑到班级名单上。</b><br>' +
        '要么你用的是老师账号，要么老师还没把这份名单开通到你的学号。' +
        '先问老师确认名单里有你，再回首页重新登录一次。');
    } else if (kind === 'no_data') {
      renderMyCard(extra && extra.me, (extra && extra.class) || '本班');
      notice('<b>老师还没发布分数。</b><br>' +
        '老师在加分助手里一记分，这里会自动出现你的分数，不用刷新。' +
        '<br><br>先把这一页留着，等上课记完分再回来看。');
      schedule(5000);
    } else {
      renderMyCard(null, '打不开');
      notice('<b>读取失败：</b>' + esc(extra && extra.message || '未知错误') +
        '<br>检查一下网络，或者退出重新登录再试。');
      schedule(5000);
    }
  }

  /* ---------- 渲染 ---------- */

  function lessonLabel(l) {
    return '第 ' + (l.seq || '?') + ' 次' + (l.date ? ' · ' + md(l.date) : '');
  }

  /* 每节课得分详情（2026-11-13 改纵向堆叠）：原来的「课次 × 项目」横向矩阵表
     列名每次都不一样（各课项目不同，跨课取并集），一屏放不下还得左右滑，用户嫌烦。
     改成「每节课一个块、从上往下叠」：块头是课次，块里把这一课的每个项目竖着列一行
     （项目名 + 完成率），最后跟「本节原始分 / 完成率 / 扣分·值日」三行小结。 */
  function renderLessonDetail(ls) {
    if (!ls.length) {
      return '<div class="card"><h3>每节课得分详情</h3>' +
        '<p class="note">还没有课次。老师上完第一次课记分后就会出现在这里。</p></div>';
    }
    var blocks = ls.slice().reverse().map(function (l) {
      var projRows = (l.projects || []).map(function (p) {
        var txt;
        if (p.s === undefined) txt = '<span class="na">—</span>';
        else if (p.s === null) txt = '<span class="wait">待评</span>';
        else txt = '<b>' + scorePct(p.s) + '</b>';
        return '<div class="dl-row"><span class="dl-proj">' + esc(p.n) + '</span><span class="dl-val">' + txt + '</span></div>';
      }).join('');
      var note = [];
      if (l.phone) note.push('<span class="minus">全组 −' + (num(l.phone) * 20) + '%</span>');
      if (l.personal) note.push('<span class="minus">个人 −' + (num(l.personal) * 20) + '%</span>');
      if (l.duty && l.duty.is) note.push('<span class="pill' + (l.duty.absent ? ' bad' : '') + '">值日' + (l.duty.absent ? ' · 缺勤 −' + (l.duty.absent * 20) + '%' : '') + '</span>');
      var summary = '<div class="dl-sum">' +
        '<span>本节项目 <b>' + (l.max ? num(rawOf(l)) + ' / ' + l.max : '—') + '</b></span>' +
        '<span>完成率 <b>' + (l.pct === null ? '还没录' : pct(l.pct)) + '</b></span>' +
        (note.length ? '<span class="dl-note">' + note.join('') + '</span>' : '') +
        '</div>';
      return '<div class="dl-block">' +
        '<div class="dl-head">' + lessonLabel(l) + '</div>' +
        (projRows || '<p class="note">这节课还没有项目分。</p>') +
        summary +
        '</div>';
    }).join('');
    return '<div class="card"><h3>每节课得分详情</h3>' +
      '<div class="dl-list">' + blocks + '</div>' +
      '<p class="note">每格是那节课该项目的完成率（20%–100%），「待评」表示还没录、不是 0 分；「—」表示那节课没有这个项目。' +
      '「本节项目」= 原始项目分（分子 / 满分），「完成率」= 扣分后的最终完成率。每节课一块，从上往下排。</p></div>';
  }

  function renderScore() {
    var d = D;
    if (!d) return '';
    var ls = d.lessons || [];
    var recorded = ls.filter(function (l) { return l.pct !== null; }).length;
    /* 显示层（2026-11-09 完成率改革）：累计与每课数字一律按百分比显示；
       快照里的原始分值一个字段不改，这里只做显示换算 */
    var taskMax = Number(d.total.taskMax) || 0;
    /* 2026-11-12 R1：整学期只有一个额外的 5 分值日缺勤项目，只算一次；每节课的分母只有「项目数×5」 */
    var namedMax = Math.max(0, taskMax - 5);
    var totalRate = taskMax ? Math.round(Math.max(0, d.total.total) / taskMax * 1000) / 10 : null;
    var projectRate = namedMax ? Math.round(Math.max(0, d.total.project) / namedMax * 1000) / 10 : null;
    var dutyScore = Number(d.total.duty != null ? d.total.duty : d.total.groupScore) || 0;
    var dutyPct = Math.round(Math.max(0, Math.min(5, dutyScore)) / 5 * 1000) / 10;

    var html = '';

    /* 值日提醒（第 5 条需求）：学生一进来看得到自己组要不要值日、老师留的提醒 */
    var dutyLesson = null;
    ls.forEach(function (l) {
      if (l.duty && l.duty.is && (!dutyLesson || (Number(l.seq) || 0) > (Number(dutyLesson.seq) || 0))) dutyLesson = l;
    });
    if (dutyLesson) {
      var missed = Math.max(0, Number(dutyLesson.duty.absent) || 0);
      html += '<div class="card duty-callout"><h3>' + (dutyLesson.recorded ? '最近一次值日安排' : '本组本节课要值日') + '</h3>' +
        '<p class="duty-callout-main"><b>' + esc(d.me.gname || ('第 ' + d.me.gno + ' 组')) + '</b> · ' +
        esc(lessonLabel(dutyLesson)) + (dutyLesson.recorded ? ' 轮到你们组值日。' : ' 轮到你们组值日，别忘了。') + '</p>' +
        '<p class="note">' + (dutyLesson.duty.note ? esc(dutyLesson.duty.note)
          : '值日组下课后留下把教室打扫干净，别提前走；值日缺勤全组每人扣 20%，一学期只算一次 5 分。') +
        (missed ? '<br><b class="duty-missed">本节已记值日缺勤 ' + missed + ' 次，全组每人 −' + (missed * 20) + '%。</b>' : '') +
        '</p></div>';
    }

    html += '<div class="card"><h3>累计到现在</h3><div class="big">' +
      '<div class="n"><em>' + (totalRate == null ? '—' : num(totalRate) + '%') + '</em><span>当前累计完成率</span></div>' +
      '<div class="n good"><em>' + (projectRate == null ? '—' : num(projectRate) + '%') + '</em><span>个人项目累计</span></div>' +
      '<div class="n"><em>' + num(dutyPct) + '%</em><span>值日完成率</span></div>' +
      '</div><p class="note">当前累计完成率 ＝（值日缺勤 ＋ 各节项目分 − 扣分）÷（5 ＋ 各节项目满分），内部按分值计算、显示按百分比。' +
      '值日缺勤整学期只算一次 5 分，没缺勤就是 100%。已登记 ' + recorded + ' / ' + ls.length + ' 次课。</p></div>';

    html += renderLessonDetail(ls);
    html += renderPeerCard() + renderGroupCard();
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
    if (isTeacherOnly(project)) {
      peer.msg = '「' + project + '」只有老师能给分，学生端不用打。';
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
    if (isTaskCol(project) || isTeacherOnly(project)) return;   // 这两种列学生从来没打过，也就没有可撤销的分
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
  var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真)/;
  function isTaskCol(name) { return TASK_COL.test(String(name == null ? '' : name).trim()); }

  /* 逐列「仅教师可评」（2026-11-12 用户规则：收拾板子 / 归位工具的分只能老师给）。
     正常路径上这一列压根不会出现在 d.projects 里 —— app.js 的 peerProjectList() 发布时就滤掉了；
     这里挡的是旧缓存页和「云端 payload 还是上一版」的窗口期。老师锁列的开关在 leader-scoring.js。 */
  function isTeacherOnly(name) {
    var list = (peer.data && peer.data.teacherOnly) || [];
    var n = String(name == null ? '' : name).trim();
    return !!n && list.indexOf(n) >= 0;
  }

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
    /* 仅教师列：只读占位，同样不带 data-project / data-target */
    if (isTeacherOnly(project.name)) {
      return '<div class="peer-cell is-locked" title="这一列只有老师能给分（收拾板子 / 归位工具这类），学生不用打">' +
        projTag + '<span>仅教师评分 · 这一列你不用打</span></div>';
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
    var dutyScore = Number(t.duty != null ? t.duty : t.groupScore) || 0;
    var dutyPct = Math.round(Math.max(0, Math.min(5, dutyScore)) / 5 * 1000) / 10;
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
      '<div>值日完成率　<i>' + num(dutyPct) + '%</i>' + (Number(t.dutyLoss) ? '（已扣 ' + num(t.dutyLoss) + ' 档）' : '') + '</div>' +
      '<div>考勤完成率　<i>' + num(t.attRate) + '%</i></div>' +
      '<div>迟到 ' + t.late + ' 次 · 早退 ' + t.early + ' 次 · 旷课 ' + t.truant + ' 次 · 折算 ' + t.converted +
      ' 次 · 合计 <i>' + t.effective + '</i> 次</div>' +
      '<div>实际期末　<i>' + (t.exam === null ? '还没录' : num(t.exam)) + '</i></div>' +
      '<div>记录状态　' + (t.ready ? '<span class="pill">已齐</span>' : '<span class="pill warn">还有没录完的项</span>') + '</div>' +
      '</div></div>';

    html += '<div class="card"><h3>怎么算的</h3><p class="note">' +
      '项目完成率＝(值日缺勤 5 分＋各节项目净得分)÷(5＋各节项目满分)，内部按分值计算、显示按百分比；' +
      '值日缺勤是整学期只算一次的项目，一学期没缺勤就是 100%，缺勤按 20% 一档扣、全组每人一起扣。<br>' +
      '每节课的项目满分＝那节课的命名项目数×5，不再单独送分，所以项目越加越多时不会把项目分的比重冲淡。<br>' +
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
    $('view-total').innerHTML = renderTotal() + renderBook();
    ['score', 'total'].forEach(function (k) {
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
    /* 顶部身份卡：班级 + 姓名 + 学号 + 组别一次填完（原来班级/姓名是拆在 .top-main 里的纯文本，
       2026-11-13 起和选桌页统一成同一张卡，都走 renderMyCard） */
    renderMyCard(payload.me, (payload.cls && payload.cls.name) || '本班');
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
    });
  });

  /* 点 1–5：记这一格；双击已有分数：撤销 */
  document.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('[data-peer-pick]');
    if (!pick) return;
    var cell = pick.closest('.peer-cell');
    if (!cell || !cell.closest('#view-score')) return;
    submitPeer(cell.dataset.project, cell.dataset.target, Number(pick.dataset.peerPick));
  });
  document.addEventListener('dblclick', function (e) {
    var cell = e.target.closest && e.target.closest('.peer-cell.is-set');
    if (!cell || !cell.closest('#view-score')) return;
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
