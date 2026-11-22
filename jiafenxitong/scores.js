/* 学生端：只读查自己的分数（本学期总分 / 平时分分解 / 每节课明细 / 组内互评 / 我的小组 / 登分册）。
 *
 * 数据只有一个来源：jf_my_scores()。这个函数在数据库里用 auth.uid() 反查我是谁，
 * 只把「我自己那一行」还给我 —— 同学的分数不会下发到我的浏览器。
 * 页面自己不做任何分数计算，也不允许任何输入：所有模块全是只读展示。
 *
 * 2026-11-13 合并页签：原来「上课记分 / 总分与登分册」两个 tab 讲的是同一个平时分
 * （88.6% 当前累计完成率 = 88.6 平时分/100），合成单页纵向排，一个数字只出现一次。
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
  /* 2026-11-16 后端拥堵兜底（用户当晚「登录登不上 服务器异常、学生都不行」那次）：
     轮询原来失败也死按 4 秒再打 —— 全班几十台设备 × 每 4 秒 = 后端越喘越被踩。
     现在失败一次退一档 4→8→16→30 秒（封顶 30），**成功立刻回落到 4 秒**，
     页面上照实说明「第 N 次重试、X 秒后再试」，老师看「数据更新于」变旧就知道是服务器在喘。 */
  var failStreak = 0;
  function backoffMs() { return Math.min(30000, POLL_MS * Math.pow(2, Math.min(3, failStreak))); }

  var D = null;            // 最近一次快照
  var CLASS = null;        // 全班考核表（jf_class_scores 返回的摘要，含别人汇总数字）

  /* 教师端「测试查看用户」演示视角（2026-11-17）：
     地址带 ?pv=<班级id> 时，每个 RPC 多带一个 x-hx-probe 头。数据库里先校验「你确实是这个班的教师」，
     再把「我是谁」换成该班的影子身份 —— 查询本身一行不改，所以看到的和真实学生完全一样。
     学生拿这个地址打开也没用：校验不过就回落成他自己（见 hx_preview_class）。 */
  var PV = (function () {
    var m = /[?&]pv=([0-9]{1,19})(?:&|$)/.exec(location.search || '');
    return m ? m[1] : '';
  })();
  var PROBE = null;        // 演示视角的载荷（有值 = 这一页是影子身份在看）
  /* 考核表里当前展开「每节课完成率」的那一行。
     2026-11-13 用户原话：「学生端需要可查明细包括别的组的」—— 从「只可能是自己」放开成任意一行，
     别人的明细按需向 jf_class_student_detail(p_key) 拉一次，缓存进 detailCache。 */
  var boardOpen = '';
  var detailCache = Object.create(null);   // key -> { state:'loading'|'ok'|'err', data, msg }
  var timer = null;
  var fatal = null;        // no_login / not_student / no_data / error

  /* 组内互评（2026-11-04）：老师按「本节课」开放后，组长才能给组员打分、组员才能给组长打分。
     其他课次一律只读；这里只存「本节」的看板，换课要重新拉。
     ok（2026-11-13）：jf_peer_open 至少成功读回过一次才算「知道哪些课开着互评」——
     没读到之前（或一直失败）不能把没录分的项目当 0%，见 peerGateOf()。 */
  var peer = { lessons: [], lesson: '', data: null, msg: '', busy: false, loaded: false, ok: false, queue: Promise.resolve() };

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
      var h = { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
      if (PV) h['x-hx-probe'] = PV;
      return fetch(API + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: h,
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
    $('view').innerHTML = '';
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
      var n = (extra && extra.n) || 1, ms = (extra && extra.ms) || 5000;
      renderMyCard(null, '连不上服务器');
      notice('<b>读取失败：</b>' + esc((extra && extra.message) || '未知错误') +
        '<br><b>第 ' + n + ' 次没成功，' + Math.round(ms / 1000) + ' 秒后自动再试</b> —— 这一页不用动，它自己会回来。' +
        '<br>如果一直这样，多半是服务器在拥堵（不是你的账号或密码问题）：过几分钟再看，或者问老师。');
      schedule(ms);
    }
  }

  /* ---------- 教师端「测试查看用户」演示视角（2026-11-17） ----------
     用户要的是「塞一个测试查看用户，让老师切换成学生端，演示给学生看，权限和真学生一模一样」。
     数据库那边（hx_acting_student）把「我是谁」换成该班的影子身份，查询逻辑一行没改；
     影子身份没有学号账号、不在任何成绩表里，所以它的个人分数区天生是空的。
     这一屏就照它真实的样子画：只画全班考核表（这张表和真学生看到的完全一致），
     上面加一句话说清「这是演示视角」，不做任何假数据。 */
  function showProbe(p) {
    PROBE = p;
    failStreak = 0;
    $('sync').textContent = '';
    renderMyCard(p.me, p.class || '本班');
    paintProbe();
  }

  function paintProbe() {
    var v = $('view');
    if (!v) return;
    clearNotice();
    v.innerHTML = '<div class="card"><h3>演示视角 · 测试查看用户</h3>' +
      '<p class="note">你正在看本班「测试查看用户」眼里的学生端：和本班任何一个真实学生用的是同一套页面、同一份数据，' +
      '只读不写（不能打分、不能占座）。</p>' +
      '<p class="note">「测试查看用户」身上本来就没有分数，所以这一屏少的是你自己的「我的分数」那张卡；' +
      '下面这张全班考核表就是学生登录后看到的那张（只读，学生点不动），能点的只有右上角「去选桌组队」。</p>' +
      '<p class="note">想退出演示：点左上角「返回」回首页，再点一次「小组加分」就回到你自己的老师视角。</p>' +
      '</div>' + renderClassBoard() +
      (CLASS ? '' : '<div class="card"><p class="note">正在读取全班考核表…</p></div>');
  }

  /* ---------- 渲染 ---------- */

  function lessonLabel(l) {
    return '第 ' + (l.seq || '?') + ' 次' + (l.date ? ' · ' + md(l.date) : '');
  }

  /* 这一课的互评是开着还是关着？（决定「没录分的项目」算 0% 还是显示「待评」）
     学生端快照里没有 peerGate 字段（student-feed.js 的 lessonRow 没下发），唯一可靠来源是
     jf_peer_open 返回的「当前开放组长打分的课次」列表，按「第几次课 + 日期」对号。
     三个返回值含义不同，别混：
       true  = 老师开着这一课的互评 → 没录分显示「待评」，学生要补分就现在补
       false = 互评是关的 → 没打分就是 0 分，直接显示 0%（这是本页口径的核心）
       null  = 开放列表还没读回来、或 jf_peer_open 失败 → 不确定，按「待评」保守显示，
               不能让一次网络抖动把全班学生的格子刷成 0%
     peerGate 的语义是「true = 已开放」（见 app.js:1436 lesson.peerGate = !!open），这里保持一致。 */
  function peerGateOf(l) {
    if (!peer.ok) return null;
    var seq = Number(l.seq) || 0, date = String(l.date || '');
    return (peer.lessons || []).some(function (o) {
      return (Number(o.seq) || 0) === seq && String(o.date || '') === date;
    });
  }

  /* 每节课得分详情（2026-11-13 改纵向堆叠）：原来的「课次 × 项目」横向矩阵表
     列名每次都不一样（各课项目不同，跨课取并集），一屏放不下还得左右滑，用户嫌烦。
     改成「每节课一个块、从上往下叠」：块头是课次，块里把这一课的每个项目竖着列一行
     （项目名 + 完成率），最后一行小结只讲完成率 + 扣分/值日。
     2026-11-13 二次改：小结里原来那句「本节项目 4 / 15」是用户已经放弃的分母方案，
     学生端不再出现任何「分子 / 满分」形式，只留完成率一个数。 */
  function renderLessonDetail(ls) {
    if (!ls.length) {
      return '<div class="card"><h3>每节课得分详情</h3>' +
        '<p class="note">还没有课次。老师上完第一次课记分后就会出现在这里。</p></div>';
    }
    var blocks = ls.slice().reverse().map(function (l) {
      var gate = peerGateOf(l);
      var projRows = (l.projects || []).map(function (p) {
        /* 一格三态：undefined = 那节课没这个项目（— ，不参与计算）；
           null = 有项目没录分 —— 互评关着就是 0 分（红字），开着才叫「待评」 */
        var txt;
        if (p.s === undefined) txt = '<span class="na">—</span>';
        else if (p.s === null) txt = gate === false
          ? '<b class="zero">0%</b>'
          : '<span class="wait">待评</span>';
        else txt = '<b>' + scorePct(p.s) + '</b>';
        return '<div class="dl-row"><span class="dl-proj">' + esc(p.n) + '</span><span class="dl-val">' + txt + '</span></div>';
      }).join('');
      var note = [];
      if (l.phone) note.push('<span class="minus">全组 −' + (num(l.phone) * 20) + '%</span>');
      if (l.personal) note.push('<span class="minus">个人 −' + (num(l.personal) * 20) + '%</span>');
      if (l.duty && l.duty.is) note.push('<span class="pill' + (l.duty.absent ? ' bad' : '') + '">值日' + (l.duty.absent ? ' · 缺勤 −' + (l.duty.absent * 20) + '%' : '') + '</span>');
      /* 本节小结（2026-11-13）：只留完成率，且它是这一行的主角。
         l.pct = 本节净得分 ÷ 本节满分；没录的项目本来就已经在分母里按 0 计，
         所以互评关着时不用额外折算，36.7% 这样的数直接就是「没打分算 0」的结果。 */
      var sum;
      if (!(l.projects && l.projects.length)) sum = '<span class="wait">—</span>';  // 这节课压根没设项目，不能算成 0%
      else if (l.pct !== null) sum = '<b>' + pct(l.pct) + '</b>';
      else if (gate === false) sum = '<b class="zero">0%</b>';
      else sum = '<span class="wait">待评</span>';
      var summary = '<div class="dl-sum">' +
        '<span class="dl-pct">完成率 ' + sum + '</span>' +
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
      '<p class="note">每格是那节课该项目的完成率。没录分的项目，老师关闭这一课互评后按 <b>0%</b> 计；' +
      '老师重新打开这一课的互评，才会变回「待评」让你去补分（补上就按新分算）。' +
      '「—」表示那节课没有这个项目，不参与计算。每节课一块，从上往下排。</p></div>';
  }

  /* 值日提示（2026-11-13 精简）：老师都是上课当场设值日组，学生只需要知道「本轮谁值日」。
     原来这张卡常驻一段整学期规则（下课后留下打扫 / 缺勤扣 20% / 一学期只算一次的 5 分项目），
     和页面下方的「怎么算的」完全重复，还占掉首屏一整块，用户嫌啰嗦。
     现在只剩一行事实 + 规则小问号（title 悬浮），有值日缺勤才多一行提醒。
     2026-11-18：老师不再单写「值日提醒」了（用户：「值日组和值日提醒冗余 值日组自动就是提醒啊」），
     文案统一走下面这句默认规则，提醒完全由「本节我组在值日名单里」自动生成。 */
  /* 2026-11-19 用户：「整学期满分100% 正常参加就满分 不然就扣分…不写具体几分整学期这样的法…
     全站不允许再出现具体分数、几比几这种说法 现在是完成率的说法」。
     值日文案统一成完成率口径，不再出现「一学期只算一次 5 分」。 */
  var DUTY_RULE = '值日组下课后留下把教室打扫干净，别提前走；整学期满分 100%，正常参加就是满分，缺勤才扣 —— 全组每人每次 −20%。';

  /** 最近一节「本组要值日」的课次；没有就返回 null（静态小卡和开页弹窗共用这一个口径） */
  function dutyLessonOf(ls) {
    var found = null;
    (ls || []).forEach(function (l) {
      if (l.duty && l.duty.is && (!found || (Number(l.seq) || 0) > (Number(found.seq) || 0))) found = l;
    });
    return found;
  }

  function renderDuty(ls) {
    var dutyLesson = dutyLessonOf(ls);
    if (!dutyLesson) return '';
    var missed = Math.max(0, Number(dutyLesson.duty.absent) || 0);
    return '<div class="card duty-callout">' +
      '<p class="duty-callout-main"><b>' + esc(D.me.gname || ('第 ' + D.me.gno + ' 组')) + '</b>' +
      '<span>本轮值日</span>' +
      '<span class="duty-callout-when">' + esc(lessonLabel(dutyLesson)) + '</span>' +
      '<span class="duty-help" aria-label="值日规则" title="' + esc(DUTY_RULE) + '">?</span></p>' +
      (missed ? '<p class="duty-missed-line">本节已记值日缺勤 ' + missed + ' 次，全组每人 −' + (missed * 20) + '%</p>' : '') +
      '</div>';
  }

  /* ---------- 开页值日提醒弹窗（2026-11-18） ----------
     用户：「需要打开学生端小组加分就弹窗他们组值日 做的炫酷一点」。
     触发条件：只看「最近那一节课」—— 本组在那一节的值日名单里（duty.is）才弹；
     翻旧课不弹（标题写的是「今天」）。
     同一课次 + 同一组只弹一次，键名 jf-duty-seen:<课次id>:<组号>（老数据没有课次 id 时用 seq-日期）。
     用普通 <div> + 高 z-index 遮罩，不用 <dialog>.showModal()：原生模态在浏览器 top layer，
     比任何 z-index 都高，会和全站药丸 / 悬浮层的层级体系打架（老师端课次设置的下拉就栽在这上面）。
     动效全部是 CSS keyframes（扫光 + 组号逐字翻入 + 细光环绕 + 碎屑上浮），不引第三方库；
     prefers-reduced-motion 下只保留淡入（样式见 scores.css 末尾）。
     页面里那张静态 dutyCallout 小卡保留：弹窗关掉之后学生还能回看。 */
  var DUTY_SEEN = 'jf-duty-seen:';
  var dutyPopEl = null;

  function dutySeenKey(l) {
    var id = l && l.id ? String(l.id)
      : ('seq' + (Number(l && l.seq) || 0) + '-' + String((l && l.date) || ''));
    return DUTY_SEEN + id + ':' + (Number(D.me && D.me.gno) || 0);
  }

  function dutyPopClose() {
    if (!dutyPopEl) return;
    var el = dutyPopEl;
    dutyPopEl = null;
    document.removeEventListener('keydown', dutyPopKeys);
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.remove(); }, 340);
  }

  function dutyPopKeys(e) {
    if (e.key === 'Escape') { e.preventDefault(); dutyPopClose(); }
  }

  function maybeDutyPop() {
    if (!D || fatal || dutyPopEl) return;
    /* 只认「最近那一节课」：弹窗标题是「今天你们组值日」，翻出上周的值日组会莫名其妙。
       老师上课当场在课次设置里标值日组，所以最近一节课就是本节。 */
    var latest = null;
    (D.lessons || []).forEach(function (x) {
      if (!latest || (Number(x.seq) || 0) > (Number(latest.seq) || 0)) latest = x;
    });
    if (!latest || !latest.duty || !latest.duty.is) return;
    var l = latest;
    var key = dutySeenKey(l);
    /* 无痕模式 / 禁用存储时读写会抛，读失败就每次都弹，但绝不能因此中断页面 */
    try {
      if (localStorage.getItem(key) === '1') return;
      localStorage.setItem(key, '1');
    } catch (e) { }
    var gno = Number(D.me && D.me.gno) || 0;
    var bits = '';
    for (var i = 0; i < 18; i++) {
      bits += '<i aria-hidden="true" style="--x:' + ((i * 37) % 100) + '%;--dl:' + ((i % 9) * 0.16).toFixed(2) +
        's;--du:' + (2.4 + (i % 4) * 0.55).toFixed(2) + 's;--sz:' + (3 + (i % 3) * 2) + 'px"></i>';
    }
    var el = document.createElement('div');
    el.className = 'duty-pop-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dutyPopTitle');
    el.innerHTML =
      '<div class="duty-pop">' +
        '<span class="duty-pop-rays" aria-hidden="true"></span>' +
        '<span class="duty-pop-ring" aria-hidden="true"></span>' +
        '<span class="duty-pop-sweep" aria-hidden="true"></span>' +
        '<span class="duty-pop-particles" aria-hidden="true">' + bits + '</span>' +
        '<p class="duty-pop-kicker">DUTY · 值日提醒</p>' +
        '<div class="duty-pop-gno" aria-hidden="true">' +
          '<span style="--k:0">第</span><b style="--k:1">' + gno + '</b><span style="--k:2">组</span>' +
        '</div>' +
        '<h2 id="dutyPopTitle" class="duty-pop-title">今天你们组值日</h2>' +
        '<p class="duty-pop-when">' + esc(lessonLabel(l)) + '</p>' +
        '<p class="duty-pop-rule">下课后留下把教室打扫干净，别提前走。</p>' +
        /* 2026-11-19：原来写「一学期只算一次 5 分」，改完成率口径（正常参加就满分，缺勤才扣） */
        '<p class="duty-pop-warn">值日缺勤全组每人 −20%<span>整学期满分 100%，正常参加就满分，缺勤才扣</span></p>' +
        '<button type="button" class="duty-pop-btn">知道了</button>' +
      '</div>';
    document.body.appendChild(el);
    dutyPopEl = el;
    el.addEventListener('click', function (e) {
      if (e.target === el || (e.target.closest && e.target.closest('.duty-pop-btn'))) dutyPopClose();
    });
    document.addEventListener('keydown', dutyPopKeys);
    void el.offsetWidth;          // 强制一次布局，让 .in 的过渡真的从初始态开始播
    el.classList.add('in');
    var btn = el.querySelector('.duty-pop-btn');
    if (btn && btn.focus) btn.focus({ preventScroll: true });
  }

  /* 合并页签（2026-11-13）后，原来「上课记分」那张「累计到现在」卡不再单独存在：
     它的「当前累计完成率」就是平时分（同一个数，只留在总分卡里显示一次），
     「个人项目累计」「值日完成率」降级成平时分的分解项，挪进 renderBreakdown()。
     这里只剩课次明细 + 互评 + 小组三块，顺序沿用原来的上下关系，避免学生找不着。 */
  function renderScore() {
    var ls = (D && D.lessons) || [];
    return renderLessonDetail(ls) + renderPeerCard() + renderGroupCard();
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
      peer.ok = true;                     // 读到过开放列表，才敢按「互评关着 = 0%」判定
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
      /* 读不到开放列表就退回「不知道」（ok=false → 明细里继续显示待评）：
         宁可少判一次 0%，也不能因为一次网络抖动把学生格子全刷成 0% */
      peer.ok = false;
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
  var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真|电子考试|线上刷题)/;
  function isTaskCol(name) { return TASK_COL.test(String(name == null ? '' : name).trim()); }

  /* 逐列「仅教师可评」（2026-11-12 用户规则：收拾板子 / 归位工具的分只能老师给）。
     正常路径上这一列压根不会出现在 d.projects 里 —— app.js 的 peerProjectList() 发布时就滤掉了；
     这里挡的是旧缓存页和「云端 payload 还是上一版」的窗口期。老师锁列的开关在 leader-scoring.js。 */
  function isTeacherOnly(name) {
    var list = (peer.data && peer.data.teacherOnly) || [];
    var n = String(name == null ? '' : name).trim();
    return !!n && list.indexOf(n) >= 0;
  }

  /* 老师已经定过分的格子（2026-11-17 A4）：payload 里的 sealed 只有列号，没有分数。
     用途只有一个 —— 别再把「已经有分」的格子摆成 20%–100% 按钮，让组长以为还要重打一遍。 */
  function peerSealed(project, target) {
    var s = peer.data && peer.data.sealed;
    if (!s) return false;
    var per = s[String(peer.data.me && peer.data.me.group_no)];
    if (!per) return false;
    var cols = per[target && target.key];
    return Array.isArray(cols) && cols.indexOf(Number(project.col)) >= 0;
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
    /* 老师手填 / 一键满分的格子：显示「老师已给分」只读胶囊，不再摆 5 颗按钮。
       要改分找老师（老师那边点一下格子就能改）；学生重新提交会在老师改完之后再覆盖。 */
    if (peerSealed(project, target)) {
      return '<div class="peer-cell is-locked" title="这一格老师已经给过分，你不用再打；要改请找老师">' +
        projTag + '<span>老师已给分</span></div>';
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
    /* 项目列再过一遍：线上排位列 / 仅教师列一律不摆出来（2026-11-17 A4）。
       正常路径上 app.js 的 peerProjectList() 已经不发布这两种列了，这里挡的是
       「云端 payload 还是上一版」的窗口期和浏览器里缓存的旧页面 ——
       组长看到一整列只能看不能点的格子，会以为老师漏了一堆分没打。 */
    var projects = (d.projects || []).filter(function (p) {
      return p && !isTaskCol(p.name) && !isTeacherOnly(p.name);
    });

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
      '</tr></thead>' + rows + '</table></div>' +
      '<p class="note">这里只显示你自己的小组（' + esc(d.me.gname || '') + '，共 ' + d.group.size +
      ' 人），别的小组看不到。「个人项目累计」是组长在课上逐项打分后的合计，仅供参考，有疑问直接找老师。</p></div>';
  }

  /* 2026-11-16：原来的 classBoardDetail() / classBoardDetailOf() 两个「表格下方明细块」的
     渲染函数连同 .cb-detail-panel 一起删掉了 —— 现在统一走 cbPanelHtml() 的悬浮卡。
     数据口径没变（自己用 D，别人用 detailCache），只是换了呈现方式。 */

  /* 拉某个同学的逐课明细（只读）。失败不弹窗、不打断整页，就在悬浮卡里写一句原因。 */
  function loadStudentDetail(key) {
    if (!key || detailCache[key]) return;
    detailCache[key] = { state: 'loading' };
    rpc('jf_class_student_detail', { p_key: key }).then(function (res) {
      if (!res || res.reason) {
        detailCache[key] = {
          state: 'err',
          msg: res && res.reason === 'not_found' ? '这位同学已不在本班名单里' :
            res && res.reason === 'not_student' ? '当前账号不是学生身份' : ''
        };
        paint();
        return;
      }
      detailCache[key] = { state: 'ok', data: res };
      paint();
    }).catch(function (err) {
      detailCache[key] = { state: 'err', msg: (err && err.message) || '' };
      paint();
    });
  }

  function twoN(n) {
    if (n === null || n === undefined || n === '') return '';
    var v = String(n);
    return v.length === 1 ? '0' + v : v;
  }
  /* 组号色相：和教师端 gbTone 同一套（相邻组差 7×15°=105°，一眼分得开） */
  function groupHue(gno) {
    var n = Number(gno) || 1;
    return (((n - 1) * 7) % 24) * 15;
  }
  /* 值日缺勤：整学期一个项目（内部仍按 5 分制记账，0–5 → 百分比；一学期一次，扣到 0 为止） */
  function dutyPctText(v) {
    if (v === null || v === undefined) return '—';
    return pct(Math.round(Math.max(0, Math.min(5, Number(v))) / 5 * 1000) / 10);
  }
  /* 期末至少需考：和教师端四种状态一致（考勤挂科 / 无法达到 / 数字 / —） */
  function neededCell(s) {
    if (s.failed) return '<span class="pill bad">考勤挂科</span>';
    if (s.needed === null || s.needed === undefined) return '—';
    if (s.needed > 100) return '<span class="pill warn">无法达到</span>';
    return num(s.needed);
  }

  /* ── 逐课明细悬浮卡（2026-11-16）──────────────────────────────────────
     用户原话：「@image#3 这里完全不正常显示 完全复刻教师端悬浮窗样式即可 点哪儿亮在哪儿
     方便看 你放最下面不方便 还显示出问题了」。
     老师端那张卡（app.js 的 showFloatDetail / cumDetailHtml + index.html 的 .sumd-* 样式）
     是「贴着点中那一格弹出、表格一动不动」的 fixed 卡片；学生端上一版却塞在表格下面，
     把页面撑长、要看的那一行被推出视野，还随 #view 一起重绘 —— 就是用户说的「不正常显示」。
     这一版照老师端 1:1 做：一个 #cbHost（fixed）+ .sumd-panel，内容 =
     每节课一组（默认收起，点组头展开项目完成率）+ 底部一行汇总。
     数据两路：自己用本机 D（jf_my_scores，不用再打 RPC），
     别人的用 detailCache（jf_class_student_detail，只读）。 */
  function cbPanelHtml(key) {
    var meKey = CLASS && CLASS.me && CLASS.me.key;
    var stu = ((CLASS && CLASS.students) || []).filter(function (s) { return s.key === key; })[0] || {};
    var name = stu.name || '';
    var gno = Number(stu.gno) || 0;
    var ls = [], t = {}, state = 'ok', msg = '';
    if (meKey && key === meKey) {
      ls = (D && D.lessons) || [];
      t = (D && D.total) || {};
    } else {
      var c = detailCache[key];
      state = c ? c.state : 'loading';
      if (state === 'err') msg = c.msg || '';
      if (state === 'ok') {
        var dd = c.data || {};
        ls = dd.lessons || []; t = dd.total || {};
        if (dd.student && dd.student.name) name = dd.student.name;
        if (dd.student && dd.student.gno) gno = Number(dd.student.gno) || gno;
      }
    }
    var head = '<div class="sumd-head">' +
      '<b class="sumd-who">' + (gno ? '第 ' + gno + ' 组 · ' : '') + esc(name) + '</b>' +
      '<span class="sumd-lesson">每节课完成率</span>' +
      '<span class="sumd-total">平时分 <b>' + num(t.regular) + '</b>/100</span>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="sumd-x" data-sumd-close="1" aria-label="关闭明细">✕</button>' +
      '</div>';
    if (state === 'loading') {
      return '<div class="sumd-panel" role="region" aria-label="每节课完成率明细">' + head +
        '<p class="sumd-empty">正在读取这位同学的逐课明细…</p></div>';
    }
    if (state === 'err') {
      return '<div class="sumd-panel" role="region" aria-label="每节课完成率明细">' + head +
        '<p class="sumd-empty">读不到这位同学的明细' + (msg ? '：' + esc(msg) : '') +
        '。点右上角「刷新」再试；一直不行就找老师。</p></div>';
    }
    if (!ls.length) {
      return '<div class="sumd-panel" role="region" aria-label="每节课完成率明细">' + head +
        '<p class="sumd-empty">这位同学还没有课次记录。</p></div>';
    }
    /* 每节课一组，最近的课排最前（和页面里别处一样从近到远） */
    var groups = ls.slice().sort(function (a, b) { return (Number(b.seq) || 0) - (Number(a.seq) || 0); }).map(function (l) {
      var projs = (l.projects || []).map(function (p) {
        var blank = (p.s === null || p.s === undefined);
        return '<span class="sumd-project' + (blank ? ' is-blank' : '') + '">' +
          '<b class="sumd-name">' + esc(p.n || '') + '</b>' +
          '<span class="sumd-pct">' + (blank ? '—' : pct(Number(p.s) / 5 * 100)) + '</span></span>';
      }).join('');
      var lp = (l.pct === null || l.pct === undefined) ? '—' : pct(l.pct);
      return '<div class="sumd-lesson-group">' +
        '<div class="sumd-lesson-head" data-lesson-toggle="1" role="button" tabindex="0">' +
        '<span class="sumd-caret" aria-hidden="true">▾</span>' +
        '<b>' + esc(lessonLabel(l)) + '</b>' +
        '<span class="sumd-pct">' + lp + '</span></div>' +
        '<div class="sumd-lesson-body" hidden>' +
        (projs ? '<div class="sumd-projects">' + projs + '</div>' : '<div class="sumd-noproj">本课没有命名项目</div>') +
        '</div></div>';
    }).join('');
    var dutyRate = (t.duty === null || t.duty === undefined) ? null : Number(t.duty) / 5 * 100;
    var need = t.failed ? '考勤挂科'
      : (t.needed === null || t.needed === undefined ? '—' : (t.needed > 100 ? '无法达到' : num(t.needed)));
    var foot = '项目完成率 <b>' + pct(t.taskRate) + '</b> · 值日完成率 <b>' + pct(dutyRate) +
      '</b> · 考勤完成率 <b>' + pct(t.attRate) + '</b> · 计入总评 <b>' + num(t.contribution) +
      '</b>/40 · 期末至少需考 <b>' + need + '</b>';
    return '<div class="sumd-panel" role="region" aria-label="每节课完成率明细">' + head +
      '<div class="sumd-lessons">' + groups + '</div>' +
      '<div class="sumd-foot">' + foot + '</div></div>';
  }

  /* 找那一行：paint() 会把 #view 整个重写，所以不能缓存 tr 引用，每次都重新按 key 找 */
  function anchorRow(key) {
    var rows = document.querySelectorAll('#view tr[data-board-key]');
    for (var i = 0; i < rows.length; i++) if (rows[i].dataset.boardKey === key) return rows[i];
    return null;
  }

  /* 定位照老师端 placeSumPanel：贴着那一行下方弹出（贴右对齐），下方放不下就翻到上方，
     再夹进可视区。表格一动不动 —— 这正是老师端「下面同学也能同时看到」的做法。 */
  function placeCbHost(host, tr) {
    var r = tr.getBoundingClientRect();
    var w = host.offsetWidth || 380, h = host.offsetHeight || 220;
    var vw = window.innerWidth, vh = window.innerHeight, pad = 10;
    var left = Math.min(Math.max(pad, r.right - w), Math.max(pad, vw - w - pad));
    var top = r.bottom + 8;
    if (top + h > vh - pad) top = r.top - h - 8;
    if (top < pad) top = pad;
    /* 再夹一次下边界：学生端这张表比老师端长得多，翻到上方也可能顶到屏幕顶端。
       夹完最坏是「卡盖住那一行」，但卡片本身一定在屏幕里 —— 比整张跑到视口外好。 */
    if (top + h > vh - pad) top = Math.max(pad, vh - h - pad);
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  function closeCbHost() {
    var host = $('cbHost');
    if (!host) return;
    host.hidden = true;
    host.innerHTML = '';
  }

  /* 把悬浮卡的内容和位置刷成「当前 boardOpen 那一行」。
     paint() 末尾会调一次 —— 行高亮和内容都靠这一处同步，别在别处再塞一份。 */
  function syncCbHost() {
    var host = $('cbHost');
    if (!host) return;
    if (!boardOpen || !CLASS) { closeCbHost(); return; }
    var tr = anchorRow(boardOpen);
    if (!tr) { closeCbHost(); return; }
    host.innerHTML = cbPanelHtml(boardOpen);
    host.hidden = false;
    placeCbHost(host, tr);
  }

  /* 收起：不清 boardOpen 也行，但那样下次 paint() 会又弹出来。
     这里连 DOM 高亮一起摘掉，避免整页重绘（学生端每 4 秒轮询一次，重绘很贵）。 */
  function dismissCb() {
    boardOpen = '';
    var rows = document.querySelectorAll('#view tr.is-sumd-on');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-sumd-on');
    var who = document.querySelector('.cb-open-who');
    if (who && who.parentNode) who.parentNode.removeChild(who);
    closeCbHost();
  }

  /* 全班考核表（2026-11-16 照搬教师端，只读）──────────────────────────────────
     用户原话：「学生端有这个吗？还是你只做了这个？」「这个完全不行 我就要你照搬改为只读权限即可」。
     上一版学生端自己发明了 7 列（组/姓名/学号/平时分/计入总评/期末需考/项目完成率），
     跟老师端那张 8 列考核表长得完全不一样，老师喊「看第几列」学生根本对不上。
     这一版直接照搬 app.js 的 verticalHead / verticalGroup 结构：
       组号（整组 rowspan 合并）· 成员（👑组长 + 序号）· 值日缺勤 · 考勤完成率 ·
       本节完成率 · 平时分（至今完成率）· 计入总评 /40 · 期末至少需考 /100
     所有能改分的地方（值日「缺勤」按钮、考勤可点、平时分 ▾ 明细）一律换成纯文字 ——
     「只读」的全部区别就在这里，其余照搬。
     点任意一行仍在**表格下方**展开「每节课完成率」明细：不插进 <tbody>，
     因为组号格和值日格是 rowspan 合并的，插一行会把整组的竖线错开。
     数据来源 jf_class_scores()；2026-11-16 起多下发 duty / duty_flag / last_pct / last_seq / leader。 */
  function renderClassBoard() {
    if (!CLASS || !Array.isArray(CLASS.students) || !CLASS.students.length) return '';
    var meKey = CLASS.me && CLASS.me.key;
    /* 按组号分块，未分组（gno = 0）排最后 */
    var order = [], bag = {};
    CLASS.students.forEach(function (s) {
      var g = Number(s.gno) || 0;
      if (!bag[g]) { bag[g] = []; order.push(g); }
      bag[g].push(s);
    });
    order.sort(function (a, b) { if (!a) return 1; if (!b) return -1; return a - b; });

    var lastSeq = 0;
    CLASS.students.forEach(function (s) { if (s.last_seq > lastSeq) lastSeq = Number(s.last_seq); });

    /* 每组一个 <tbody>（和教师端 verticalGroup 一致）：组与组之间靠 tbody + tbody 的粗线分隔，
       组号格 / 值日格的 rowspan 只在组内合并，跨组不会串。 */
    var rows = order.map(function (gno) {
      var list = bag[gno], span = list.length, hue = groupHue(gno || 1);
      /* 本组本节是不是值日组：每人 payload 里只有「我自己这组」这一个布尔值，
         组内取或就得到这一组的值（老师端用的是 lesson.dutyGroups，同源） */
      var dutyFlag = list.some(function (s) { return !!s.duty_flag; });
      return '<tbody data-card="' + (gno || 0) + '"' + (dutyFlag ? ' class="is-duty-group"' : '') + '>' + list.map(function (s, i) {
        var isMe = !!(meKey && s.key === meKey);
        var isOpen = !!(boardOpen && s.key === boardOpen);
        var out = '<tr class="vertical-member-row' + (isMe ? ' is-me' : '') + (isOpen ? ' is-sumd-on' : '') + '"' +
          ' data-board-key="' + esc(s.key || '') + '" title="点我弹出每节课完成率悬浮卡（只读）">';
        if (!i) out += '<td class="c-no" rowspan="' + span + '"><span class="gno-swatch"' +
          ' style="--h:' + hue + ';--s:58%;--lb:90%">' + (gno || '—') + '</span></td>';
        out += '<td class="c-mem member-name-cell' + (s.leader ? ' group-leader-name' : '') + '">' +
          (s.leader ? '<span class="leader-crown" aria-label="组长">👑</span> ' : '') + esc(s.name) +
          (s.no === '' || s.no === null || s.no === undefined ? '' : ' <small>' + esc(twoN(s.no)) + '</small>') +
          (isMe ? '<span class="me-tag">我</span>' : '') + '</td>';
        if (!i) out += '<td class="c-duty' + (dutyFlag ? ' is-duty' : '') + '" rowspan="' + span + '">' +
          '<b class="duty-pct" title="整学期值日完成率：一学期一次，扣到 0% 为止">' + dutyPctText(list[0].duty) + '</b>' +
          (dutyFlag ? '<span class="duty-flag">值日</span>' : '') + '</td>';
        out += '<td class="home-attendance">' + pct(s.att_rate) + '</td>';
        out += '<td class="c-sum"><strong>' + pct(s.last_pct) + '</strong></td>';
        out += '<td class="home-grade regular"><strong>' + num(s.regular) +
          (s.task_rate === null || s.task_rate === undefined ? '' :
            ' <span class="completion-rate">（' + pct(s.task_rate) + '）</span>') + '</strong></td>';
        out += '<td class="home-grade contribution"><strong>' + num(s.contribution) + '</strong></td>';
        out += '<td class="home-grade needed"><strong>' + neededCell(s) + '</strong></td>';
        return out + '</tr>';
      }).join('') + '</tbody>';
    }).join('');

    /* 明细不再插在表格下面（2026-11-16）：改成 fixed 悬浮卡，渲染在 #cbHost 里。
       这里只负责给「点中的那一行」打高亮，具体内容由 syncCbHost() 填。 */
    var openS = null;
    if (boardOpen) openS = CLASS.students.filter(function (s) { return s.key === boardOpen; })[0] || null;

    return '<div class="card class-board"><div class="cb-head">' +
      '<h3>全班考核表</h3>' +
      '<span class="cb-ro">只读</span>' +
      (openS ? '<span class="cb-open-who">正在看：' + esc(openS.name || '') + '</span>' : '') +
      '<button type="button" class="cb-refresh" id="cbRefresh" aria-label="刷新全班考核表">刷新</button>' +
      '</div>' +
      '<div class="sheetwrap"><table class="sheet sheet-vertical">' +
      '<colgroup><col class="w-no"><col class="w-mem"><col class="w-duty"><col class="w-attendance">' +
      '<col class="w-sum"><col class="w-grade"><col class="w-grade"><col class="w-grade"></colgroup>' +
      '<thead><tr>' +
      '<th class="c-no">组号</th><th class="c-mem">成员</th><th class="c-duty">值日缺勤</th>' +
      '<th class="home-attendance">考勤完成率</th>' +
      '<th class="c-sum"' + (lastSeq ? ' title="最近一次课：第 ' + lastSeq + ' 次"' : '') + '>本节完成率</th>' +
      '<th class="home-grade regular">平时分<br>（至今完成率）</th>' +
      '<th class="home-grade contribution">计入总评 /40</th>' +
      '<th class="home-grade needed">期末至少需考 /100</th>' +
      '</tr></thead>' + rows + '</table></div>' +
      '<p class="note">和老师端那张考核表是同一张，<b>只读</b>：不能加减分、不能改值日、不能换组长。' +
      '点任意一行（包括别的组），会在那一行旁边弹出「每节课完成率」悬浮卡，点哪行亮哪行，同样只能看。' +
      '老师一存分，点右上角「刷新」就能看到最新。</p></div>';
  }

  /* 本学期总分（2026-11-13 合并页签后成了整页的第一张卡）：
     四个数字全是登分册口径，彼此不重复 —— 平时分是完成率折成百分制，
     计入总评是它×40%，期末至少需考是反推出来的目标分，综合是期末录完后的总评。
     原来的「当前累计完成率 88.6%」就是这张卡里的「平时分 88.6」，
     同一个数只保留这里这一份，不再在别的卡里换个标签再写一遍。 */
  function renderTotal() {
    var d = D, t = d.total;
    var need = t.failed ? '<span class="pill bad">考勤挂科</span>'
      : t.needed === null ? '—'
      : t.needed > 100 ? '<span class="pill warn">已超 100</span>'
      : num(t.needed);
    return '<div class="card"><h3>本学期总分</h3><div class="big">' +
      '<div class="n"><em>' + num(t.regular) + '</em><span>平时分 / 100</span></div>' +
      '<div class="n"><em>' + num(t.contribution) + '</em><span>计入总评 / 40</span></div>' +
      '<div class="n' + (t.failed ? ' bad' : '') + '"><em>' + need + '</em><span>期末至少需考</span></div>' +
      '<div class="n ' + (t.final === null ? '' : (t.final >= d.passScore ? 'good' : 'bad')) + '">' +
      '<em>' + (t.final === null ? '—' : num(t.final)) + '</em><span>综合 / 100</span></div>' +
      '</div><p class="note">平时分就是累计完成率（项目＋考勤合并算出来的那个百分比，折成 100 分制），只在这里显示一次。' +
      '平时分 40% ＋ 期末 60%，及格线 ' + num(d.passScore) + ' 分。' +
      (t.final === null ? '期末还没录入，所以综合成绩先空着。' : '') + '</p></div>';
  }

  /* 平时分怎么来的（2026-11-13 新增，替代原来「上课记分」页的「累计到现在」卡）：
     个人项目累计 / 值日完成率 / 考勤完成率 这三项是平时分的组成部分，不是并列的其他成绩，
     所以收成一条小分解条挂在总分卡下面，字号比大数字小一号，层级上一眼看出从属关系。
     下面那截 kv 是原「明细」卡剩下的、没有别处重复的内容（名次 / 考勤次数 / 记录状态）。 */
  function renderBreakdown() {
    var d = D, t = d.total;
    var ls = d.lessons || [];
    var recorded = ls.filter(function (l) { return l.pct !== null; }).length;
    /* 显示层（2026-11-09 完成率改革）：累计与每课数字一律按百分比显示；
       快照里的原始分值一个字段不改，这里只做显示换算 */
    var taskMax = Number(t.taskMax) || 0;
    /* 2026-11-12 R1：整学期只有一个额外的值日缺勤项目，只算一次；每节课的分母只有「项目数×5」。
       2026-11-19：分值口径只留在代码里（内部 5 分制），下面给老师看的文案不再出现「5 分」。 */
    var namedMax = Math.max(0, taskMax - 5);
    var projectRate = namedMax ? Math.round(Math.max(0, t.project) / namedMax * 1000) / 10 : null;
    var dutyScore = Number(t.duty != null ? t.duty : t.groupScore) || 0;
    var dutyPct = Math.round(Math.max(0, Math.min(5, dutyScore)) / 5 * 1000) / 10;

    return '<div class="card"><h3>平时分怎么来的</h3>' +
      '<div class="sub-stats">' +
      '<div class="s"><b>' + (projectRate == null ? '—' : num(projectRate) + '%') + '</b><span>个人项目累计</span></div>' +
      '<div class="s"><b>' + num(dutyPct) + '%</b><span>值日完成率</span></div>' +
      '<div class="s"><b>' + num(t.attRate) + '%</b><span>考勤完成率</span></div>' +
      '</div>' +
      '<p class="note">这三项按分值加权后合并成上面的平时分，不是简单平均。' +
      '「个人项目累计」只算各节课的项目分，值日单独按整学期一个项目算（正常参加就是满分 100%，缺勤按 20% 一档扣、全组每人一起扣），' +
      '考勤是学期固定项目、满分折 100%。已登记 ' + recorded + ' / ' + ls.length + ' 次课。' +
      (t.pending ? '还有 <b>' + t.pending + '</b> 项没评分，现在的分是暂时的。' : '') + '</p>' +
      '<div class="kv">' +
      '<div>班级名次　<i>' + t.rank + ' / ' + t.count + '</i></div>' +
      '<div>值日扣分　' + (Number(t.dutyLoss) ? '<i class="minus">已扣 ' + num(t.dutyLoss) + ' 档</i>' : '<i>没扣</i>') + '</div>' +
      '<div>考勤　迟到 ' + t.late + ' 次 · 早退 ' + t.early + ' 次 · 旷课 ' + t.truant + ' 次 · 折算 ' + t.converted +
      ' 次 · 合计 <i>' + t.effective + '</i> 次</div>' +
      '<div>实际期末　<i>' + (t.exam === null ? '还没录' : num(t.exam)) + '</i></div>' +
      '<div>记录状态　' + (t.ready ? '<span class="pill">已齐</span>' : '<span class="pill warn">还有没录完的项</span>') + '</div>' +
      '</div></div>';
  }

  /* 规则说明（2026-11-13）：合并后只在页面末尾留一份，别再往上面的卡片里塞同样的公式，
     否则又是「同一句话说两遍」的老问题。 */
  function renderHow() {
    return '<div class="card"><h3>怎么算的</h3><p class="note">' +
      '项目完成率＝值日缺勤与各节课每个项目的完成率一起求平均（每个项目都按满分 100% 计），代码内部按分值计算、界面只显示完成率；' +
      '值日缺勤是整学期只算一次的项目，正常参加就是 100%，缺勤按 20% 一档扣、全组每人一起扣。<br>' +
      '每节课只看那节课的命名项目，不再单独送分，所以项目越加越多时不会把项目分的比重冲淡。<br>' +
      '考勤是学期固定项目，满分折 100%，扣到 0 或者实际加折算旷课达到门槛就算考勤挂科。<br>' +
      '平时分＝100×合并完成率；计入总评＝平时分×40%。<br>' +
      '期末至少需考＝(及格线 − 平时分×0.4)÷0.6，向上取 0.1 分。<br>' +
      '这一页只能看，改不了。分数有疑问直接找老师。</p></div>';
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

  /* 单页渲染（2026-11-13 合并页签）：顺序按「先结论、后细节」排 ——
     本轮值日（一句话）→ 本学期总分 → 平时分怎么来的 → 每节课明细 → 互评 → 我的小组 → 规则 → 登分册。
     两块原来分属两个 tab 的内容现在同一个容器里纵向排，缺一块也不会把另一块顶掉。 */
  function paint() {
    if (!D || fatal) { if (PROBE) paintProbe(); return; }
    $('view').innerHTML = renderDuty(D.lessons || []) +
      renderTotal() + renderBreakdown() +
      renderScore() + renderClassBoard() +
      renderHow() + renderBook();
    clearNotice();
    /* 页头小标签：本节开了互评就写「本节可互评」，否则老实写「只读」 */
    var ro = document.querySelector('.readonly');
    if (ro) {
      var live = !!(peer.data && peer.data.gate);
      ro.textContent = live ? '本节可互评' : '只读';
      ro.classList.toggle('live', live);
    }
    /* 悬浮卡必须在这里重挂：上一行 #view.innerHTML 把所有行都重建了，
       原来那张卡的位置锚（那一行）已经不存在，内容和位置都得按新 DOM 重新算一次。 */
    syncCbHost();
    /* 开页值日提醒（2026-11-18）：paint 每 4 秒都会跑一次，maybeDutyPop 内部靠
       「本地已标记 + 当前已有一张弹窗」双重保险，同一课次同一组只会弹一次。 */
    maybeDutyPop();
  }

  /* 轮询连续失败时把实情写到顶部那行状态里（否则页面看着正常，其实数据早就停了） */
  function warnSync(n, ms) {
    var el = $('sync'); if (!el) return;
    el.classList.add('stale');
    el.textContent = '连不上服务器：第 ' + n + ' 次重试，' + Math.round(ms / 1000) + ' 秒后再试（这一页不用刷新）';
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
      /* 演示视角：影子身份本来就没有分数（「还没被记过任何分的学生」），
         这不是错误，不能按「没数据」画一屏提示把人挡住。 */
      if (payload && payload.reason === 'no_data' && payload.probe) return showProbe(payload);
      if (payload && payload.reason === 'not_student') return showFatal('not_student');
      return showFatal('no_data', payload || {});
    }
    fatal = null;
    failStreak = 0;          // 这一轮拿到了 → 退避归零，回到 4 秒轮询
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
    /* 首次就没拉下来：不是「死在这一页」，而是进退避重试 —— 后端缓过来以后页面自己会回来，
       不用学生去刷新（那时的刷新也是一次打后端）。 */
    failStreak++;
    showFatal('error', { message: e && e.message, n: failStreak, ms: backoffMs() });
  }

  /* 全班考核表：单独拉一次 + 手动刷新，不塞进 4 秒轮询（考核表变化不频繁，别给轮询加压）。
     失败静默降级成 CLASS=null——这张卡不显示，不影响其它卡片。 */
  function loadClassBoard() {
    return rpc('jf_class_scores', {}).then(function (res) {
      if (!res || res.reason) { CLASS = null; paint(); return; }
      CLASS = res;
      /* 明细缓存跟着作废（老师可能刚改过分）：当前展开的那一行重新拉一次 */
      detailCache = Object.create(null);
      paint();
      if (boardOpen && boardOpen !== (CLASS.me && CLASS.me.key)) loadStudentDetail(boardOpen);
    }).catch(function () { CLASS = null; });
  }

  function boot() {
    /* 演示视角：把「去选桌组队」也带上同一个 pv，学生在组队页看到的身份才不会跳回老师 */
    if (PV) { var go = document.querySelector('.idc-go'); if (go) go.href = 'team.html?pv=' + PV; }
    if (!token()) { showFatal('no_login'); return; }
    rpc('jf_my_scores', {}).then(apply).catch(fail);
    loadClassBoard();
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
        /* 一两次抖动静默跳过（不打断人看分）；连续 3 次以上才在顶部写明，并按退避间隔再试 */
        failStreak++;
        if (failStreak >= 3) warnSync(failStreak, backoffMs());
        schedule(backoffMs());
      });
    }, ms);
  }

  /* ---------- 交互：本节互评打分（整页只读，只有互评这一段能点） ---------- */

  /* 点 1–5：记这一格；双击已有分数：撤销。
     2026-11-13 合并页签后整页只有一个 #view，把原来的 #view-score 判断换成它，
     否则老选择器匹配不到、互评按钮点了没反应。 */
  document.addEventListener('click', function (e) {
    var pick = e.target.closest && e.target.closest('[data-peer-pick]');
    if (!pick) return;
    var cell = pick.closest('.peer-cell');
    if (!cell || !cell.closest('#view')) return;
    submitPeer(cell.dataset.project, cell.dataset.target, Number(pick.dataset.peerPick));
  });
  document.addEventListener('dblclick', function (e) {
    var cell = e.target.closest && e.target.closest('.peer-cell.is-set');
    if (!cell || !cell.closest('#view')) return;
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

  /* 全班考核表（只读）：点「刷新」重拉一次；点任意一行展开/收起「每节课完成率」。
     2026-11-13 用户原话「学生端需要可查明细包括别的组的」—— 原来只允许点「我」那一行，
     现在任何一行都能点；别人的明细按需走 loadStudentDetail()（只读 RPC），不会一次全拉下来。 */
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#cbRefresh')) { loadClassBoard(); return; }
    /* 悬浮卡内部的点击：✕ 收起；点某节课的组头展开/收起项目（高度变了要重新定位，别让卡跑出屏幕） */
    var host = $('cbHost');
    if (host && !host.hidden && host.contains(e.target)) {
      if (e.target.closest('[data-sumd-close]')) { dismissCb(); return; }
      var head = e.target.closest('[data-lesson-toggle]');
      if (head) {
        var body = head.parentElement.querySelector('.sumd-lesson-body');
        if (body) {
          body.hidden = !body.hidden;
          head.parentElement.classList.toggle('is-open', !body.hidden);
          var tr = anchorRow(boardOpen);
          if (tr) placeCbHost(host, tr);
        }
      }
      return;
    }
    var row = e.target.closest && e.target.closest('tr[data-board-key]');
    if (!row || !row.closest('#view')) return;
    var key = row.dataset.boardKey;
    if (!key) return;
    if (boardOpen === key) { dismissCb(); return; }   // 点同一行 = 收起
    boardOpen = key;
    if (key !== (CLASS && CLASS.me && CLASS.me.key)) loadStudentDetail(key);
    paint();
  });

  /* 悬浮卡是 fixed 定位：页面一滚 / 窗口一变尺寸，它就和那一行错开了。
     老师端是「直接收起，老师再点一下就有新的」；学生端照做，成本最低。
     注意只监听**窗口**滚动，不捕获表格内部的横向滚动 —— 手机上表格要左右滑着看列，
     一滑就把卡收掉会很难用。 */
  window.addEventListener('scroll', function () {
    var host = $('cbHost');
    if (host && !host.hidden) dismissCb();
  }, { passive: true });
  window.addEventListener('resize', function () {
    var host = $('cbHost');
    if (host && !host.hidden) dismissCb();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var host = $('cbHost');
    if (host && !host.hidden) dismissCb();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (fatal === 'no_login' && token()) return boot();
    if (D) {
      rpc('jf_my_scores', {}).then(apply).catch(function () {});
      loadClassBoard();
    }
  });

  boot();
})();
