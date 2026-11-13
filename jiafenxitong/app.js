/* 夜夜小组制加分助手 —— 主逻辑
   数据全部保存在本机 localStorage，无需网络、无需服务器。 */
(function () {
  'use strict';

  var LS_KEY = 'jfdt.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ================= 工具 ================= */

  function uid(p) {
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function clamp(v, lo, hi) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  /* 分组卡片配色（2026-11-10 用户定：同组同色 + 组内深浅轮换）。
     色系 = 组号定（组号 mod 24 取色相，组1 蓝、组2 绿、组3 橙…24 色环轮换）；
     组内深浅 = 组内第 i 个成员在同色相下取不同亮度（浅→深阶梯），
     所以同一组的人看起来是「浅蓝 / 淡蓝 / 深蓝」一类的同色系不同深浅，一眼是同一伙人。
     未分组的人不传（走毛玻璃半透明白，roster-board.css 里 .gb-pend-chip 单独处理）。
     返回内联 style 的 --h/--s/--lb 三段，浅深色由 roster-board.css 里 .gb-av / .gb-chip 决定。 */
  function gbTone(gno, idx) {
    var n = Number(gno) || 1;
    var slot = ((n - 1) * 7) % 24;                    // 黄金角跳步：相邻组色相差 7×15°=105°，一眼分得开
    var h = slot * 15;                                 // 24 槽 × 15° = 360° 全色环
    var k = idx % 6;                                   // 组内第 1~6 人循环
    var sat = 58 + k * 6;                              // 58 → 88：越靠后颜色越浓
    var lb = 90 - k * 4;                               // 90 → 70：越靠后底色越深
    return '--h:' + h + ';--s:' + sat + '%;--lb:' + lb + '%;';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    return n > 0 ? '+' + n : (n < 0 ? '−' + Math.abs(n) : '0');
  }

  function signClass(n) {
    return n > 0 ? 'pos' : (n < 0 ? 'neg' : '');
  }

  /* ================= 完成率百分比显示（2026-11-09 显示层改革 / 2026-11-12 值日缺勤改革） =================
     硬约束：内部存储与计算公式一个字都不动——scores 的 phone/personal 仍按 5 分制记账、
     leaderScores 项目分仍是 1–5、考勤仍是 9 分制。下面这组工具只负责「显示的时候」换算：
       · 5 分制单位 → 百分比：值 ÷ 5 × 100（项目分 1–5 → 20%~100%；值日缺勤 5→0 → 100%~0%）
       · 每课完成率 = 本节项目净得分 ÷ (5 × 已命名项目数)
       · 整学期分母 = 5（值日缺勤，整学期只算一次）+ Σ每课 5 × 已命名项目数
       · 考勤 → (9 − 累计扣分)/9 百分比，保留 1 位小数（照 performanceRate 的 round(x×1000)/10 口径）
     数值口径保持不变的位置（用户明确只要这些保持数值）：平时分三列、实际期末/综合、考试分数输入框。 */
  function pctNum(v) {           // 入参已经是百分数（80 表示 80%），保留 1 位小数
    return Math.round((Number(v) + Number.EPSILON) * 10) / 10;
  }
  function pctText(v) {          // '80%' / '88.9%'：整数不带小数点
    var n = pctNum(v);
    return (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1)) + '%';
  }
  /** 5 分制单位 → 百分比文本（值日缺勤、个人项目分共用） */
  function scorePctText(v) {
    return pctText(Math.max(0, Math.min(5, Number(v) || 0)) / 5 * 100);
  }
  /** 考勤 9 分制 → 完成率百分比文本 */
  function attPctText(score) {
    return pctText(Math.max(0, Math.min(9, Number(score) || 0)) / 9 * 100);
  }
  /** 一节课里「已命名」的个人项目列数（空名不算分母） */
  function namedProjectCount(lesson) {
    var A = window.JFDT_ASSESSMENT;
    var names = (A && A.projectNames && A.projectNames(lesson)) || [];
    return names.filter(function (n) { return String(n == null ? '' : n).trim(); }).length;
  }
  /** 每课完成率分母 = 5 × 已命名项目数（2026-11-12：每课那 5 分送分已取消） */
  function lessonMaxOf(lesson) {
    return 5 * namedProjectCount(lesson);
  }
  /** 某成员某课的项目完成率文本：本节项目净得分 ÷ (5 × 已命名项目数)；没命名项目返回 '—' */
  function memberLessonRateText(lesson, gno, member, i) {
    var A = window.JFDT_ASSESSMENT;
    if (!A || !A.lessonNet) return '—';
    var rec = A.lessonNet(lesson, gno, i, memberKey(member));
    if (!rec.max) return '—';
    return pctText(Math.max(0, rec.earned) / rec.max * 100);
  }
  /** 学期层面的完成率分母（与 assessment.js taskEvidence 的 maximum 同口径）：
      值日缺勤 5 分整学期只算一次 + 每课 5 × 该课已命名项目数，逐课累加。 */
  function semesterProjectMax(lessons) {
    return (lessons || []).length
      ? 5 + (lessons || []).reduce(function (a, l) { return a + lessonMaxOf(l); }, 0)
      : 0;
  }
  /** 审计「加减分」列：±分值文本 → ±百分比（如 −1 → −20%、+1/人 → +20%/人） */
  function auditDeltaPct(text) {
    if (text == null || text === '') return '—';
    var m = /^([+\-]?)(\d+(?:\.\d+)?)(\/人)?$/.exec(String(text));
    if (!m) return String(text);            // '—' 等非数值照原样
    var v = Number(m[2]) / 5 * 100;
    var body = pctText(v).slice(0, -1);      // 去掉 % 再拼，避免 '-20%%'
    return (m[1] === '-' ? '−' : m[1]) + body + '%' + (m[3] || '');
  }

  /** 打开 <dialog>。极老的浏览器没有 showModal，退化成 open 属性，
      总比点按钮「什么都不发生」强。 */
  function openDlg(d) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  /** 弹窗都按 Windows 窗口的习惯来：点旁边的空白也能随手关掉。
      Esc 和标题栏那个 ✕ 是浏览器原生行为，不用管。 */
  function wireDialog(d) {
    var down = null;
    d.addEventListener('pointerdown', function (ev) {
      down = (ev.target === d) ? { x: ev.clientX, y: ev.clientY } : null;
    });
    d.addEventListener('click', function (ev) {
      var from = down;
      down = null;
      if (ev.target !== d || !from) return;            // 点在内容上 → 不关
      /* 移动过一段距离 = 在拉右下角缩放（拖拽结束时也会冒一个 click），别误关 */
      if (Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) > 6) return;
      /* 正好落在缩放手柄上 → 也不关 */
      var r = d.getBoundingClientRect();
      if (ev.clientX >= r.right - 24 && ev.clientY >= r.bottom - 24) return;
      if (typeof d.close === 'function') d.close();
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('dialog'), wireDialog);

  /* ================= 侧栏（宽屏常驻可折叠 / 窄屏抽屉） =================
     2026-11-13 用户：「把顶部导航栏整理好放左边侧栏，做成可展开可回缩样式」。
     · 宽屏（body.sidebar-layout，≥1100px）：侧栏本来就在左边常驻，☰ 只负责「收起 / 展开」。
       收起时给 body 加 nav-collapsed，侧栏收成 64px 图标条、main 的 margin-left 跟着变小 ——
       内容区真的宽出来，不是只把菜单藏掉。
     · 窄屏：还是原来那套抽屉（body.nav-open + 遮罩），行为一个字都没改。
     两条逻辑靠 sidebar-layout 这个类分流，不会互相打架。 */
  (function () {
    var body = document.body;
    var toggle = document.getElementById('navToggle');
    var scrim = document.getElementById('navScrim');
    var NAV_KEY = 'hx-jf-nav-collapsed';   // 键名按用户要求固定，刷新后保持

    function wide() { return body.classList.contains('sidebar-layout'); }
    /* localStorage 在无痕/被策略禁掉时读写都会抛异常，两边都兜住：
       存不下只是「刷新后不保持」，不影响当前这次折叠 */
    function stored() {
      try { return localStorage.getItem(NAV_KEY) === '1'; } catch (e) { return false; }
    }

    /* ☰ 在两种模式下说法不一样：宽屏是「展开 / 收起菜单」，窄屏是「打开菜单」。
       aria-expanded 也各按各的状态写，不能只改 class（读屏只认 aria）。 */
    function syncToggle() {
      if (!toggle) return;
      if (wide()) {
        var collapsed = body.classList.contains('nav-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? '展开菜单' : '收起菜单');
        toggle.title = collapsed
          ? '展开菜单（左侧栏现在收成一列图标）'
          : '收起菜单（把左侧栏收成一列图标，内容区变宽）';
      } else {
        var open = body.classList.contains('nav-open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', '打开菜单');
        toggle.title = '打开菜单';
      }
    }

    function setNav(open) {
      body.classList.toggle('nav-open', open);
      if (scrim) scrim.hidden = !open;
      syncToggle();
    }

    function setCollapsed(collapsed) {
      body.classList.toggle('nav-collapsed', !!collapsed);
      try { localStorage.setItem(NAV_KEY, collapsed ? '1' : '0'); } catch (e) { }
      syncToggle();
    }

    if (toggle) toggle.addEventListener('click', function () {
      if (wide()) setCollapsed(!body.classList.contains('nav-collapsed'));
      else setNav(!body.classList.contains('nav-open'));
    });
    if (scrim) scrim.addEventListener('click', function () { setNav(false); });
    var tabs = document.getElementById('tabs');
    /* 宽屏侧栏常驻：点菜单只是切页，不要顺手把侧栏关掉（窄屏才收抽屉） */
    if (tabs) tabs.addEventListener('click', function (e) {
      if (e.target.closest('button[data-view]') && !wide()) setNav(false);
    });

    /* 刷新后保持：ui-feedback.js 排在 app.js 前面，跑到这里 body.sidebar-layout 已经就位，
       所以直接恢复折叠态。窄屏也多挂一个 nav-collapsed —— 无害，CSS 只在宽屏认它。 */
    body.classList.toggle('nav-collapsed', stored());
    syncToggle();
    /* 窗口跨过 1100px 时 ui-feedback.js 会重算 sidebar-layout（它先注册、先执行），
       这里跟着换回 ☰ 的文案与 aria；顺手把窄屏抽屉收起来，免得回宽屏时残留 nav-open */
    window.addEventListener('resize', function () { if (wide()) setNav(false); syncToggle(); });
  })();

  /* ================= 状态 ================= */

  var S = null;
  var saveTimer = null;
  /* 云端模块（cloud.js）。没有它（比如离线打开、或被浏览器拦了 CDN）就退化成纯本机模式，
     界面上会明确写出来，不会偷偷当成"已同步"。 */
  var CLOUD = window.JFDT_CLOUD || null;
  var UI = window.JFDT_UI;
  function scoreFeedback(gno, f, i, delta) {
    if (UI && delta) UI.feedback(gno, f, i, delta,
      '第 ' + gno + ' 组 ' + (i != null ? memberName(curClass(), gno, +i) + ' 个人分' : FIELD_NAME[f] || f) +
      ' ' + (delta > 0 ? '+' : '−') + Math.abs(delta) * 20 + '%');
  }
  var CLOUD_ON = false;      // 云端真的可用（已登录且已激活）
  var cloudRec = null;       // 最近一次从云端拉到的记录
  var appVersionMeta={commit:(document.querySelector('meta[name="build-commit"]')||{}).content||'',builtAt:(document.querySelector('meta[name="build-published-at"]')||{}).content||''};
  var appVersionLatest=null,appVersionChecking=null,appVersionUpdatePending=false,appVersionReloadTimer=null,appVersionLastCheck=0;
  function appVersionDate(value,includeYear){var date=new Date(value);if(!Number.isFinite(date.getTime()))return '';return date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:includeYear?'numeric':undefined,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
  function appVersionKey(info){return String(info.commit||'').replace(/-dirty$/,'')+'|'+String(info.builtAt||'');}
  function renderAppVersion(message){var chip=$('#appVersionChip'),button=$('#btnCheckAppVersion');if(!chip)return;var current=appVersionMeta,release=appVersionLatest||current,when=appVersionDate(release.builtAt,false),commit=String(release.commit||'').replace(/-dirty$/,'');chip.classList.toggle('update-pending',appVersionUpdatePending);if(message){chip.textContent=message;chip.title='当前版本 '+(appVersionDate(current.builtAt,true)||'发布时间未知')+' · '+(current.commit||'源码版本未知')+'；检测到 '+(appVersionDate(release.builtAt,true)||'发布时间未知')+' · '+commit;}else if(when){chip.textContent='版本发布于 '+when;chip.title='当前应用版本发布时间（北京时间）：'+appVersionDate(release.builtAt,true)+'；源码版本：'+commit;}else{chip.textContent='应用版本读取中';chip.title='正在读取本次发布的版本和时间';}if(button)button.title=appVersionUpdatePending?'已发现新版；同步完成后会自动更新':'立即检测新版本（系统每5分钟自动检查）';}
  function canAutoReloadForVersion(){if(document.visibilityState==='hidden'||editingGrade()||document.querySelector('dialog[open]'))return false;if(!CLOUD||!CLOUD.profile())return true;if(!S||!CLOUD_ON)return false;var sync=CLOUD.status();return sync.mode==='ok'&&!sync.pending&&!CLOUD.isDirty(S);}
  function tryAutoUpdateAppVersion(manual){if(!appVersionUpdatePending||appVersionReloadTimer)return false;if(!canAutoReloadForVersion()){renderAppVersion('发现新版本 · 保存并同步后自动更新');return false;}var target=appVersionKey(appVersionLatest),marker='jfdt.appUpdateTarget';try{if(!manual&&sessionStorage.getItem(marker)===target){renderAppVersion('发现新版本 · 点击↻重试');return false;}sessionStorage.setItem(marker,target);}catch(e){}renderAppVersion('发现新版本 · 正在安全更新');var button=$('#btnCheckAppVersion');if(button)button.setAttribute('aria-busy','true');appVersionReloadTimer=setTimeout(function(){appVersionReloadTimer=null;if(!canAutoReloadForVersion()){try{if(sessionStorage.getItem(marker)===target)sessionStorage.removeItem(marker);}catch(e){}renderAppVersion('发现新版本 · 保存并同步后自动更新');if(button)button.removeAttribute('aria-busy');return;}window.location.reload();},500);return true;}
  function checkAppVersion(manual){if(appVersionChecking)return appVersionChecking;var button=$('#btnCheckAppVersion');if(button){button.disabled=true;button.setAttribute('aria-busy','true');}var versionUrl=new URL('version.json',document.baseURI).href;appVersionChecking=fetch(versionUrl+'?check='+Date.now(),{cache:'no-store',credentials:'same-origin'}).then(function(response){if(!response.ok)throw Error('HTTP '+response.status);return response.json();}).then(function(info){if(!info||typeof info.commit!=='string'||!info.builtAt||!Number.isFinite(new Date(info.builtAt).getTime()))throw Error('版本信息格式无效');appVersionLastCheck=Date.now();appVersionLatest={commit:info.commit,builtAt:info.builtAt};var currentKey=appVersionKey(appVersionMeta),latestKey=appVersionKey(appVersionLatest);if(!appVersionMeta.commit||!appVersionMeta.builtAt){appVersionMeta=appVersionLatest;appVersionUpdatePending=false;renderAppVersion();return true;}if(currentKey===latestKey){appVersionUpdatePending=false;try{sessionStorage.removeItem('jfdt.appUpdateTarget');}catch(e){}renderAppVersion();return true;}appVersionUpdatePending=true;renderAppVersion();tryAutoUpdateAppVersion(!!manual);return true;}).catch(function(){appVersionLastCheck=Date.now();var chip=$('#appVersionChip');if(chip&&!appVersionMeta.builtAt){chip.textContent='版本检测失败';chip.title='无法读取应用发布时间；请点击↻重试。';}else if(chip)chip.title='当前显示本地版本；最近一次自动检测未成功，可点击↻重试。';if(button)button.title='版本检测失败，点击↻重试';return false;}).finally(function(){appVersionChecking=null;if(button){button.disabled=false;if(!appVersionReloadTimer)button.removeAttribute('aria-busy');}});return appVersionChecking;}

  function defaultState() {
    var seed = window.SEED_DATA;
    if (!seed || !seed.classes) return null;
    var classes = JSON.parse(JSON.stringify(seed.classes));
    classes.forEach(function (c) {
      c.groups.forEach(function (g) {
        if (!g.id) g.id = uid('g');
        g.members.forEach(function (m) {
          if (!m.id) m.id = uid('m');
        });
      });
    });
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      classes: classes,
      lessons: [],
      undo: [],
      ui: { classId: classes[0] ? classes[0].id : null, lessonId: null, scoreLayout: null }
    };
  }

  /** 老数据迁移：补上全班名单（roster），并把分组成员的完整学号/班内序号补齐。
      老版本只存了「姓名 + 短序号」，这里按姓名与官方名单对上。 */
  // Keep legacy remaining points while restoring an immutable five-point base.
  function normalizeProjectBase(score,members){if(!score)return;var base=Math.min(5,(+score.group||0)+(score.first?1:0)),phone=+score.phone||0,personal=score.personal||{},next={};members.forEach(function(m,i){if(!m.name)return;var remain=Math.max(0,base-phone-(+personal[String(i)]||0));next[String(i)]=5-remain;});score.group=5;score.first=0;score.phone=0;score.personal=next;}
  function migrateProjectBases(state){var legacyIds=new Set((state.lessons||[]).filter(function(l){return l.memberProjectBase!==5;}).map(function(l){return l.id;}));(state.lessons||[]).forEach(function(l){if(l.memberProjectBase===5)return;var cls=(state.classes||[]).find(function(c){return c.id===l.classId;});if(!cls)return;(cls.groups||[]).forEach(function(g){normalizeProjectBase((l.scores||{})[String(g.no)],g.members||[]);});l.memberProjectBase=5;});function obsolete(op){return op&&(op.f==='group'||op.f==='first'||(legacyIds.has(op.lessonId)&&(op.i!=null||op.f==='phone'||op.reset)));}state.projectLegacyUndoArchive=(state.projectLegacyUndoArchive||[]).concat((state.undo||[]).filter(obsolete).map(function(op){return {kind:'undo',op:op};}),(state.redo||[]).filter(function(e){return obsolete(e.op);}).map(function(e){return {kind:'redo',entry:e};}));state.undo=(state.undo||[]).filter(function(op){return !obsolete(op);});state.redo=(state.redo||[]).filter(function(e){return !obsolete(e.op);});function snapshot(op,score){var l=(state.lessons||[]).find(function(l){return l.id===op.lessonId;}),cls=l&&(state.classes||[]).find(function(c){return c.id===l.classId;}),g=cls&&(cls.groups||[]).find(function(g){return g.no===op.gno;});if(g)normalizeProjectBase(score,g.members||[]);}state.undo.forEach(function(op){if(op.reset&&op.old)snapshot(op,op.old);});state.redo.forEach(function(e){if(e.op.reset&&e.op.old)snapshot(e.op,e.op.old);if(e.scores)snapshot(e.op,e.scores);});return state;}
  /* ================= 值日改制迁移（2026-11-09） =================
     旧制：值日是「学期一次 5 分」的加分项目（sc.duty / sc.dutyParticipation），另有特殊表现记录
           （cls.specialRecords / specialRecordsTrash）。
     新制：值日缺勤（2026-11-12 再改）——整学期一个 5 分项目，缺勤教师点一次「每人 −20%」，
           全组每人同扣一档（记在 sc.dutyAbsent，按课累计）；特殊表现功能整体删除。
           旧分值一律作废，所有人重新规划。
     迁移只做删除，全部幂等：跑多少次结果都一样；旧数据经此处理后项目总分自动不含值日分。 */
  function migrateDutyReform(state){
    function strip(score){if(score&&typeof score==='object'){delete score.duty;delete score.dutyParticipation;}}
    (state.lessons||[]).forEach(function(l){if(l&&l.scores)Object.keys(l.scores).forEach(function(k){strip(l.scores[k]);});});
    /* 撤销/重做里不能再留值日分操作，否则一撤销就把旧值日分复活 */
    state.undo=(state.undo||[]).filter(function(op){return !(op&&op.f==='duty');});
    state.redo=(state.redo||[]).filter(function(e){return !(e&&e.op&&e.op.f==='duty');});
    (state.undo||[]).forEach(function(op){if(op&&op.reset&&op.old)strip(op.old);});
    (state.redo||[]).forEach(function(e){if(e){if(e.op&&e.op.reset&&e.op.old)strip(e.op.old);if(e.scores)strip(e.scores);}});
    (state.classes||[]).forEach(function(c){delete c.specialRecords;delete c.specialRecordsTrash;});
    return state;
  }
  function migrate(s) {
    migrateProjectBases(s);
    migrateDutyReform(s);
    var seed = window.SEED_DATA;
    if (!s.undo) s.undo = [];
    if (!s.ui) s.ui = {};
    if (!seed || !seed.classes) return s;
    var byName = {};
    seed.classes.forEach(function (c) { byName[c.name] = c; });
    s.classes.forEach(function (c) {
      if (!c.roster || !c.roster.length) {
        var sc = byName[c.name];
        if (sc && sc.roster) c.roster = JSON.parse(JSON.stringify(sc.roster));
      }
      var idx = {};
      rosterOf(c).forEach(function (r) { if (r.name) idx[r.name] = r; });
      c.groups.forEach(function (g) {
        g.members.forEach(function (m) {
          if (m.id == null) m.id = uid('m');
          var hit = idx[m.name];
          if (!hit) return;
          if (m.no == null) m.no = hit.no;
          if (!m.sid || !/^\d{8,}$/.test(String(m.sid))) m.sid = hit.sid;
        });
      });
    });
    return s;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* 隐私模式 */ }
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.classes && s.lessons) return migrate(s);
      } catch (e) { /* 损坏则重建 */ }
    }
    return defaultState();
  }

  /* 学生只读查分（2026-11-04）：算好「每人一份」的分数快照发布到云端，学生页只读自己那一行。
     4 秒防抖 + 内容 hash 比对，连续改分不会把请求打爆。实现在 student-feed.js。 */
  function publishStudentFeed() {
    if (!CLOUD_ON) return;
    if (window.JFDT_FEED) window.JFDT_FEED.touch(S, memberTotals);
  }

  /* ================= 认不到人的历史分修复（2026-11-09） =================
     用户报「历史加分都没了 项目记录也没了」。线上实测：分一条没删，是**认不到人**——
     组长打分存成 leaderScores[组号].members[成员键]，换组后组号变了，记录还挂在旧组号下，
     取分却按「人现在所在的组号」查，于是变成孤儿（26工器1 班 289 格）。
     修法见 score-repair.js：能按学号/成员 ID 认出人就把记录搬到他现在那一组，认不出原样留着。
     这里只负责「什么时候修 + 怎么记账」。 */
  function repairOrphanScores(silent) {
    var R = window.JFDT_SCORE_REPAIR;
    if (!R || !S) return 0;
    var res = R.repairAll(S);
    var n = res.moved + res.merged;
    if (!n) return 0;
    addOperationLog('修复', '把 ' + n + ' 条「换组后认不到人」的历史分接回本人（' +
      res.byClass.map(function (x) { return x.name + ' ' + (x.moved + x.merged) + ' 条'; }).join('；') + '）' +
      (res.stranded ? '；另有 ' + res.stranded + ' 条找不到人，原样保留' : ''));
    save();
    if (!silent) { renderScore(); renderPool(); }
    return n;
  }

  /** 2026-11-09：把待分配的人分进组的入口（名单页下拉 / 拖拽 / 组内加人 / 均匀填充）当场跑一次
      「认不到人」修复——带学号补回来的学生，名下还挂在旧组号的历史分立刻接回，
      不用等下次打开页面（启动修复）才看到。repairClass 只搬不删、幂等，
      认不出人（没学号 / 学号错）时不会动任何数据，也绝不会认到别人头上。 */
  function repairOrphansAfterAssign(cls) {
    var R = window.JFDT_SCORE_REPAIR;
    if (!R || !cls || !S) return 0;
    var res = R.repairClass(S, cls);
    var n = res.moved + res.merged;
    if (n) addOperationLog('修复', cls.name + ' · 接回 ' + n + ' 条「认不到人」的历史分（学生分进组时自动执行）');
    return n;
  }

  function save(flash) {
    S.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
    } catch (e) {
      var failEl = $('#saveState');
      if (failEl) failEl.textContent = '⚠ 保存失败：浏览器存储已满或被禁用';
      return;
    }
    publishStudentFeed();
    if (flash !== false) {
      var el = $('#saveState');
      if (el) {
        var d = new Date();
        el.textContent = '已保存 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
        el.classList.add('flash');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function () { el.classList.remove('flash'); }, 1200);
      }
    }
    /* 本机先落盘，云端在后台合并推送；离线时排队等恢复 */
    if (CLOUD && CLOUD_ON) CLOUD.touch(function () { return S; });
  }

  /* ================= 查询 ================= */

  function getClass(id) {
    for (var i = 0; i < S.classes.length; i++) if (S.classes[i].id === id) return S.classes[i];
    return null;
  }

  function lessonsOf(classId) {
    return S.lessons.filter(function (l) { return l.classId === classId; })
      .sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
  }

  function getLesson(id) {
    for (var i = 0; i < S.lessons.length; i++) if (S.lessons[i].id === id) return S.lessons[i];
    return null;
  }

  /* 每节课一组的记分记录。2026-11-12 起 `group` / `first` 只是老数据的残留字段（不再参与计分）：
     手机未入袋记 `phone`（次数）、本人扣分记 `personal[成员下标]`（分，5 分制）、
     值日缺勤记 `dutyAbsent`（本课该组缺勤几档，1 档 = 20%，全组每人同扣）。 */
  function sc(lesson, gno) {
    var k = String(gno);
    if (!lesson.scores[k]) lesson.scores[k] = { first: 0, group: lesson.memberProjectBase===5?5:0, phone: 0, personal: {} };
    return lesson.scores[k];
  }

  function groupOf(cls, gno) {
    for (var i = 0; i < cls.groups.length; i++) if (cls.groups[i].no === gno) return cls.groups[i];
    return null;
  }

  /* ================= 全班名单 / 待分配 ================= */

var GROUP_CAP = 7;          // 老师还没在分组向导里定过人数时用的老默认上限（保持旧数据行为不变）

/** 老师这次给全班定的「每组最多几人」，存在 cls.groupLimit 上（2026-11-08 分组向导里填的）。
    没定过返回 0，表示沿用老的 GROUP_CAP=7。
    它只决定「满没满 / 要不要标红」，任何情况下都不会因为把它改小就删人 ——
    用户原话：「我一旦不小心点错了 就会抹除我部分同学 强制变为6人 那老师完全无法恢复正确靠自己」。 */
function classGroupLimit(cls) {
  var v = Math.round(Number(cls && cls.groupLimit) || 0);
  return v >= 2 ? Math.min(40, v) : 0;
}

/** 某个组实际适用的上限：本组特许（g.cap）优先，没特许才用班级上限。
    老版本把 memberCount(g) 也塞进 max() 里，于是 7 人组的上限永远显示 7、永远看不出超员，
    正是用户说的「老师完全无法恢复正确」。现在人数只用来判断超没超，不参与算上限。
    2026-11-12 修「无法降低本组上限」：原来 return Math.max(班级上限, 本组特许) 永远取大，
    老师想把 7 人组单独改成 5/6 人，Math.max 只会把它顶回 7，根本降不下去。
    改成 g.cap 优先——高于或低于全班默认都可以，只影响这一组；没特许才落到班级上限。 */
function groupTargetCap(cls, g) {
  var limit = classGroupLimit(cls), own = Number(g && g.cap) || 0;
  /* 本组特许 g.cap 优先（高于或低于全班默认都算数） */
  if (own) return own;
  if (limit) return limit;
  /* 老师还没在向导里定过人数：完全沿用旧行为（上限 = max(7, 现有人数)），
     老班级里那些 8 人组不会被升级后突然标红。 */
  return Math.max(GROUP_CAP, memberCount(g));
}

/** 原来到处调用的 groupCap(g)：签名保持不变，不传 cls 就按当前班级算。 */
function groupCap(g, cls) { return groupTargetCap(cls || curClass(), g); }

/** 这组超了几个人（0 = 没超）。
    用户要求：「超出的人标红 但是不移除原来组」——超出来的人照样留在 g.members 里，
    只有界面上标红，等老师自己决定拖走 / 留下 / 单独建一组。 */
function overCountOf(cls, g) {
  return Math.max(0, memberCount(g) - groupTargetCap(cls, g));
}

function rosterOf(cls) {
  if (!cls.roster) cls.roster = [];
  return cls.roster;
}

/** 实际有名字的成员数（名单页可能留了空占位格，末尾的空格不算） */
function memberCount(g) {
  var n = g.members.length;
  while (n > 0 && !g.members[n - 1].name) n--;
  return n;
}

function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }
function groupLeaderKey(g) {
  var named = g.members.filter(function (m) { return !!m.name; });
  var stored = String(g.leaderKey || '');
  return stored && named.some(function (m) { return memberKey(m) === stored; })
    ? stored
    : (named[0] ? memberKey(named[0]) : '');
}
function groupMemberEntries(g) {
  var entries = g.members.map(function (m, i) { return { m: m, i: i }; }).filter(function (x) { return !!x.m.name; });
  var lead = groupLeaderKey(g);
  if (!lead) return entries;
  return entries.sort(function (a, b) {
    return (memberKey(a.m) === lead ? -1 : 0) - (memberKey(b.m) === lead ? -1 : 0);
  });
}
function isGroupLeader(g, m) { return !!m && memberKey(m) === groupLeaderKey(g); }
function setGroupLeader(cls, g, member) {
  if (!g || !member || !member.name) return false;
  var next = memberKey(member), old = groupLeaderKey(g), first = g.members.find(function (m) { return !!m.name; }), defaultKey = first ? memberKey(first) : '';
  if (next === old) next = defaultKey;
  if (next === old) return false;
  if (next && next === defaultKey) delete g.leaderKey; else if (next) g.leaderKey = next; else delete g.leaderKey;
  var restoredDefault = next === defaultKey;
  addOperationLog('组长', cls.name + ' · 第' + g.no + '组 · ' + member.name + (restoredDefault ? '恢复默认组长' : '成为组长'));
  save();
  renderGroups(cls, curLesson(cls));
  if (view === 'leader') renderLeader();
  /* 本节课若已经开放了互评，立刻把新组长重发上去 —— 否则学生端还按旧组长收分 */
  peerSyncGroups(cls, true);
  flash(restoredDefault ? '已恢复第1位成员为第' + g.no + '组组长' : member.name + '已设为第' + g.no + '组组长');
  return true;
}

/** 末尾的空占位格先清掉再追加，免得名单里出现「空一格再是人」 */
function pushMember(g, m) {
  while (g.members.length && !g.members[g.members.length - 1].name) g.members.pop();
  g.members.push(m);
}

/** 从组里移除第 j 个成员。
    个人扣分是按「组内位置」存的，删掉中间一个人会让后面所有人的扣分错位，
    所以这里把所有历史课次里该组的 personal 索引一并左移。 */
function removeMemberAt(cls, g, j) {
  var removed = g.members[j];
  g.members.splice(j, 1);
  if (removed && g.leaderKey === memberKey(removed)) delete g.leaderKey;
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id) return;
    var s = l.scores[String(g.no)];
    if (!s || !s.personal) return;
    var np = {};
    Object.keys(s.personal).forEach(function (k) {
      var i = +k;
      if (i === j) return;
      np[String(i > j ? i - 1 : i)] = s.personal[k];
    });
    s.personal = np;
  });
}

/* ================= 分组变动时的分数迁移（2026-11-08） =================
   用户原话：「分完组之后我之前弄的加分全部丢失了基本上」。
   根因：lesson.scores 是按「组号 gno」存整组四列，个人扣分又按「组内下标 i」存
   （见 sc() / remaining() / memberTotals()）。组一重排、或者组里少一个人，下标整体错位，
   看上去就像分全丢了；旧代码在「按选座确认分组」里甚至会把整组 personal 清空。
   现在凡是会改变「组号 → 成员顺序」的动作，都先拍一张按【学生身份】记的快照，
   动完再按身份写回；实在对不上人的保留在原处并报数，绝不静默清零。 */

/** 学生身份键：学号优先，没有学号退回「姓名#班内序号」。和看板的 gbRowKey 同一套口径。
    不拿组内下标当身份 —— 下标一变分数就错位，正是上面那件投诉的根。 */
function studentKeyOf(m) {
  if (!m || !m.name) return '';
  if (m.sid) return 's:' + m.sid;
  return 'n:' + m.name + '#' + (m.no == null ? '' : m.no);
}

/** 动结构之前拍快照：只记「哪个组号的第几个位置是谁」，分数本身留在 lesson.scores 里不动。
    layout 用 studentKeyOf（学号 / 姓名#序号），给「个人扣分」用；
    keys 用 memberKey（sid: / id:），给「个人项目分 leaderScores」用 —— 两套键不能混。 */
function scoreLayoutSnapshot(cls) {
  var layout = {}, keys = {};
  (cls.groups || []).forEach(function (g) {
    layout[g.no] = g.members.map(function (m) { return studentKeyOf(m); });
    keys[g.no] = g.members.map(function (m) { return memberKey(m); });
  });
  return { layout: layout, keys: keys };
}

/** 按身份把每节课的「个人扣分」重新对齐到新的组内顺序，返回对不上的条数（调用方负责提示）。
    三件事按顺序做：
    ① 把旧布局里「一人一格」的扣分摊成「身份 → 扣分」的池子；
    ② 清空本班还在的组的 personal，再按新成员顺序一人一格写回；
    ③ 池子里没领走的（人已经不在任何组 / 老数据下标对不上身份）放回原组原位置；
       位置被别人占了就挪进 personalUnmatched 留着，并计入返回值 —— 绝不清零。 */
function realignPersonalScores(cls, snap) {
  var layout = (snap && snap.layout) || {};
  var unmatched = 0;
  var groupNos = {};
  (cls.groups || []).forEach(function (g) { groupNos[String(g.no)] = g; });
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id || !l.scores) return;
    var pool = Object.create(null);   // 身份 → [{value,gno,idx}]
    var loose = [];                   // 没有身份的旧值
    Object.keys(l.scores).forEach(function (gno) {
      var s = l.scores[gno];
      if (!s || !s.personal) return;
      Object.keys(s.personal).forEach(function (idx) {
        var v = +s.personal[idx] || 0;
        if (!v) return;
        var key = (layout[gno] || [])[+idx] || '';
        if (key) (pool[key] = pool[key] || []).push({ value: v, gno: gno, idx: String(idx) });
        else loose.push({ value: v, gno: gno, idx: String(idx) });
      });
    });
    Object.keys(groupNos).forEach(function (gno) {
      var s = l.scores[gno];
      if (s) s.personal = {};
    });
    Object.keys(groupNos).forEach(function (gno) {
      var g = groupNos[gno], s = l.scores[gno];
      if (!s) return;
      g.members.forEach(function (m, i) {
        if (!m.name) return;
        var bag = pool[studentKeyOf(m)];
        if (!bag || !bag.length) return;
        s.personal[String(i)] = bag.shift().value;
      });
    });
    var rest = loose.slice();
    Object.keys(pool).forEach(function (k) { pool[k].forEach(function (x) { rest.push(x); }); });
    rest.forEach(function (x) {
      var s = l.scores[x.gno];
      if (!s) { unmatched++; return; }
      if (!groupNos[x.gno]) return;                    // 已删掉的历史组：personal 没清过，原样留着
      if (s.personal[x.idx] != null) {                 // 格子被别人占了：挪进待核对，不清零
        s.personalUnmatched = s.personalUnmatched || {};
        s.personalUnmatched[x.idx] = (s.personalUnmatched[x.idx] || 0) + x.value;
        unmatched++;
        return;
      }
      s.personal[x.idx] = x.value;                     // 空着就放回原处
    });
  });
  return unmatched;
}

/** 换组前先把这个人每一节课的个人扣分取出来（取出的同时从原组删掉，
    removeMemberAt 会把原组后面的人整体左移，两边不会打架）。 */
function takePersonalOf(cls, gno, idx) {
  var out = [];
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id) return;
    var s = l.scores[String(gno)];
    var v = s && s.personal ? +s.personal[String(idx)] || 0 : 0;
    if (!v) return;
    out.push({ lessonId: l.id, value: v });
    delete s.personal[String(idx)];
  });
  return out;
}

/** 人落到新组的新位置以后，把这笔扣分写回去。
    以前人走了扣分留在原组，算到了原位置新坐下的同学头上 —— 这也是「分丢/算错」的来源之一。 */
function putPersonalOf(cls, gno, idx, bag) {
  if (!bag || !bag.length) return;
  bag.forEach(function (x) {
    var l = getLesson(x.lessonId);
    if (!l || !l.scores) return;
    var s = l.scores[String(gno)];
    /* 目标组这节本来没有分数记录：只新建一张「个人扣分表」，group 记 0，
       免得无中生有地给这一组添上默认的 5 分。 */
    if (!s) s = l.scores[String(gno)] = { first: 0, group: 0, phone: 0, personal: {} };
    if (!s.personal) s.personal = {};
    s.personal[String(idx)] = (+s.personal[String(idx)] || 0) + x.value;
  });
}

/* ---- 个人项目分（leaderScores）的搬迁（2026-11-08 追加） ----
   个人项目分存成 leaderScores[组号].members[成员键]，成员键是 sid:xxx / id:xxx。
   它不跟着人走：人从第 3 组换到第 5 组，这份分还挂在「第 3 组」名下，
   而 projectScore() 是按「人现在所在的组号」去找的 —— 一个数字都找不到，
   老师看到的就是「换完组个人项目分全没了」。所以换组时必须整条记录搬过去。 */

/** 把某人在某组某节课的项目分取出来（取出的同时从旧组删掉），返回按课次分装的包 */
function takeLeaderOf(cls, gno, key) {
  var out = [];
  if (!key) return out;
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id || !l.leaderScores) return;
    var rec = l.leaderScores[String(gno)];
    if (!rec || !rec.members || !rec.members[key]) return;
    var meta = {};
    if (l.peerMeta) Object.keys(l.peerMeta).forEach(function (mk) {
      var p = mk.split('|');
      if (p[0] === String(gno) && p[1] === key) { meta[p[2]] = l.peerMeta[mk]; delete l.peerMeta[mk]; }
    });
    out.push({
      lessonId: l.id,
      values: rec.members[key],
      projects: rec.projects && rec.projects.slice ? rec.projects.slice() : null,
      meta: meta
    });
    delete rec.members[key];
  });
  return out;
}

/** 落到新组以后把项目分写回去。目标组这节还没有记录就新建一条空壳（不伪造任何分数）。 */
function putLeaderOf(cls, gno, key, bag) {
  if (!bag || !bag.length || !key) return;
  bag.forEach(function (x) {
    var l = getLesson(x.lessonId);
    if (!l) return;
    if (!l.leaderScores) l.leaderScores = {};
    var rec = l.leaderScores[String(gno)];
    if (!rec) {
      rec = l.leaderScores[String(gno)] = {
        projects: (x.projects || (window.JFDT_ASSESSMENT ? window.JFDT_ASSESSMENT.projectNames(l) : []) || []).slice(),
        members: {}, signedBy: '', note: ''
      };
    }
    if (!rec.members) rec.members = {};
    rec.members[key] = x.values;
    if (x.meta && l.peerMeta) {
      Object.keys(x.meta).forEach(function (col) {
        l.peerMeta[String(gno) + '|' + key + '|' + col] = x.meta[col];
      });
    }
  });
}

/** 整班重排以后，按「成员键」把所有个人项目分重新归到人现在所在的组号下面。
    只清「本班还在的组」的记录；已经删掉的历史组原样留着（那是旧数据，不能凭空抹掉）。
    搬不动的（记录指向的组已经不在了 / 同一个键撞车）留在原处并计数报给老师，绝不清零。 */
function realignLeaderScores(cls, snap) {
  var moved = 0, stranded = 0, groupNos = {};
  (cls.groups || []).forEach(function (g) { groupNos[String(g.no)] = g; });
  S.lessons.forEach(function (l) {
    if (l.classId !== cls.id || !l.leaderScores) return;
    var pool = Object.create(null);            // 成员键 → [{values, gno, projects}]
    Object.keys(l.leaderScores).forEach(function (gno) {
      var rec = l.leaderScores[gno];
      if (!rec || !rec.members) return;
      Object.keys(rec.members).forEach(function (key) {
        (pool[key] = pool[key] || []).push({ values: rec.members[key], gno: gno, projects: rec.projects });
      });
    });
    Object.keys(groupNos).forEach(function (gno) {
      var rec = l.leaderScores[gno];
      if (rec && rec.members) rec.members = {};
    });
    Object.keys(groupNos).forEach(function (gno) {
      var g = groupNos[gno];
      g.members.forEach(function (m) {
        if (!m.name) return;
        var key = memberKey(m), bag = pool[key];
        if (!bag || !bag.length) return;
        var x = bag.shift();
        var rec = l.leaderScores[gno];
        if (!rec) {
          rec = l.leaderScores[gno] = {
            projects: (x.projects || (window.JFDT_ASSESSMENT ? window.JFDT_ASSESSMENT.projectNames(l) : []) || []).slice(),
            members: {}, signedBy: '', note: ''
          };
        }
        if (!rec.members) rec.members = {};
        rec.members[key] = x.values;
        if (x.gno === gno) return;
        moved++;
        if (l.peerMeta) Object.keys(l.peerMeta).forEach(function (mk) {
          var p = mk.split('|');
          if (p[0] === String(x.gno) && p[1] === key) {
            l.peerMeta[String(gno) + '|' + key + '|' + p[2]] = l.peerMeta[mk];
            delete l.peerMeta[mk];
          }
        });
      });
    });
    Object.keys(pool).forEach(function (key) {
      pool[key].forEach(function (x) {
        var rec = l.leaderScores[x.gno];
        if (!rec) { stranded++; return; }
        if (!rec.members) rec.members = {};
        if (rec.members[key]) { stranded++; return; }
        rec.members[key] = x.values;           // 人已经不在本班任何组里：留在原组号下面，不清零
      });
    });
  });
  /* 2026-11-09 追加：上面是按「成员键精确匹配」搬的，键一变（比如后来才补学号）就搬不动，
     记录留在旧组号下变成孤儿 —— 线上 26工器1 班就是这样丢了 289 格。这里再按「学号/成员ID
     认人」兜一次：认出人在哪一组就把记录搬过去，认不出的原样留着。只搬不删、幂等。 */
  var REPAIR = window.JFDT_SCORE_REPAIR;
  if (REPAIR && REPAIR.repairClass) {
    var fixed = REPAIR.repairClass(S, cls);
    moved += fixed.moved;
    stranded += fixed.stranded;
  }
  return { moved: moved, stranded: stranded };
}

/* ================= 分组快照 / 人数对账 / 掉队归位（2026-11-08 追加） =================
   团队在生产数据里抓到的现场：26工器1 班 49 人、10 次课、4015 分都在，可 cls.groups 里
   只剩 5 个组 29 人 —— 另外约 20 人掉进了「待分配」。分没丢，人丢了，老师看到的却是
   「我的加分全没了」。用户原话：「老师完全无法恢复正确靠自己」。
   所以这里补三件事：
   ① 每次动分组前存一份完整快照（最多 5 份），给一颗「撤回上一次分组」整份还原；
   ② 动完立刻做人数对账，「分之前几个组多少人 → 分之后几个组多少人」，少了人就红字拦一下；
   ③ 从上过课的记分表倒推「这人原来在第几组」，一键放回去，并把匹配依据和命中数写出来。 */

var GROUP_SNAP_MAX = 5;      // 只留最近 5 份，再多会把 localStorage 撑满

/** 一份完整快照：组结构（含顺序、组长、本组特许）+ 本班所有课次的 scores / leaderScores。
    分数必须一起拍：换组会把个人扣分、个人项目分跟着人搬，只还原人不还原分，下一次算分就错位。 */
function groupSnapshotData(cls) {
  return {
    groups: JSON.parse(JSON.stringify(cls.groups || [])),
    limit: cls.groupLimit == null ? null : cls.groupLimit,
    lessons: lessonsOf(cls.id).map(function (l) {
      return {
        id: l.id,
        scores: JSON.parse(JSON.stringify(l.scores || {})),
        leaderScores: JSON.parse(JSON.stringify(l.leaderScores || {}))
      };
    })
  };
}

/** 动结构之前存一份可回滚的快照。label 是给老师看的人话（「按组数重排：49 人分 8 组」）。 */
function pushGroupSnapshot(cls, label) {
  if (!cls) return null;
  if (!S.groupSnapshots) S.groupSnapshots = [];
  var data = groupSnapshotData(cls);
  var snap = {
    id: uid('gs'), clsId: cls.id, clsName: cls.name || '',
    label: String(label || '分组'), at: new Date().toISOString(),
    groups: data.groups, limit: data.limit, lessons: data.lessons
  };
  S.groupSnapshots.push(snap);
  while (S.groupSnapshots.length > GROUP_SNAP_MAX) S.groupSnapshots.shift();
  return snap;
}

/** 本班最近一份快照（没有就 null）。 */
function lastGroupSnapshot(cls) {
  if (!cls || !S.groupSnapshots) return null;
  var hit = null;
  S.groupSnapshots.forEach(function (x) { if (x.clsId === cls.id) hit = x; });
  return hit;
}

/** 撤回最近一份分组快照：组结构、每组顺序、分数一起整份还原，然后把这份快照用掉。 */
function restoreGroupSnapshot(cls, snap) {
  if (!cls || !snap || snap.clsId !== cls.id) return false;
  cls.groups = JSON.parse(JSON.stringify(snap.groups));
  if (snap.limit == null) delete cls.groupLimit; else cls.groupLimit = snap.limit;
  (snap.lessons || []).forEach(function (x) {
    var l = getLesson(x.id);
    if (!l) return;
    l.scores = JSON.parse(JSON.stringify(x.scores || {}));
    l.leaderScores = JSON.parse(JSON.stringify(x.leaderScores || {}));
  });
  S.groupSnapshots = (S.groupSnapshots || []).filter(function (x) { return x.id !== snap.id; });
  gbUndo = null; gbPick = null; gbAddTo = -1;
  addOperationLog('分组', cls.name + ' · 撤回上一次分组：' + snap.label);
  save();
  renderPool(); renderScore();
  flash('已撤回：' + snap.label);
  return true;
}

/** 一组组数人头：只数有名字的人和非空组（名单页末尾的空占位格不算）。 */
function headcountOfGroups(groups) {
  var g = 0, p = 0;
  (groups || []).forEach(function (x) { var n = memberCount(x); if (n) { g++; p += n; } });
  return { groups: g, people: p };
}

/** 首页（记分页 / 分组看板）该画哪些组 —— 动态识别，不写死组数。
    用户原话：「我明明工器2班分了7组新的 但是首页还没变 咋回事」「空组删除不要再首页显示了
    又没人是不是 应该动态识别才对」。
    真实原因：模板给新班 13 个空组，按组数分完 7 组以后，第 8～13 组虽然一个人都没有，
    但因为历史课次里留着它们的分数格子（groupHasHistory），一直没被删掉，于是一直画在首页上。
    老师看到「7 组有人 + 6 组空白」，第一反应就是「分了个寂寞 / 首页没变」。
    规则：**只画组里至少有一个人的组**。空组一律不画。
    ⚠ 只影响显示，不动数据：空组里可能还挂着历史分，删了反而找不回来；
      要真删组请走「分组…」的清理（那里会保留有历史记分的组）。 */
function visibleGroups(cls) {
  var gs = (cls && cls.groups) || [];
  return gs.filter(function (g) { return memberCount(g) > 0; });
}

/** 这个班「实际有几个组」——所有显示组数的地方都用它，别再用 cls.groups.length。 */
function groupCountOf(cls) { return visibleGroups(cls).length; }

/** 组结构 → 身份键到「姓名 + 原组号」的表，用来算「谁掉出去了」。 */
function memberIndexByKey(groups) {
  var out = Object.create(null);
  (groups || []).forEach(function (g) {
    (g.members || []).forEach(function (m) {
      if (!m.name) return;
      var k = studentKeyOf(m);
      if (!out[k]) out[k] = { name: m.name, gno: g.no, sid: m.sid || '' };
    });
  });
  return out;
}

/** 动完之后的核对单：beforeGroups 是动手前的深拷贝，cls.groups 是现在。
    返回 {before, after, dropped}；dropped 是「刚才还在某个组里、现在一个组都不在」的人。 */
function reconcileGroups(cls, beforeGroups, label) {
  var before = headcountOfGroups(beforeGroups), after = headcountOfGroups(cls.groups || []);
  var was = memberIndexByKey(beforeGroups), now = memberIndexByKey(cls.groups || []);
  var dropped = Object.keys(was).filter(function (k) { return !now[k]; }).map(function (k) { return was[k]; });
  return { before: before, after: after, dropped: dropped, label: label || '' };
}

/** 这位同学原来在第几组：从历史记分里倒推，三档依据，越靠前越可信。
    ① 组长评分表 leaderScores[组号].members[成员键]：键是学号/成员ID，最硬；
    ② 分组快照 groupSnapshots：里面有完整成员对象，能按姓名命中；
    ③ 都没有就不猜 —— 列出来让老师自己拖，不搞黑箱。 */
function originalGroupIndex(cls) {
  var bySid = Object.create(null), byName = Object.create(null);
  function bump(map, key, gno, basis, weight, order) {
    if (!key) return;
    var cur = map[key];
    if (!cur || weight > cur.weight || (weight === cur.weight && order >= cur.order)) {
      map[key] = { gno: Number(gno) || 0, basis: basis, weight: weight, order: order, hits: (cur && cur.gno === Number(gno) ? cur.hits : 0) + 1 };
    } else if (cur.gno === Number(gno)) {
      cur.hits++;
    }
  }
  /* ① 组长评分表：最近一次课说了算（order 用课次序号） */
  lessonsOf(cls.id).forEach(function (l) {
    var ls = l.leaderScores;
    if (!ls) return;
    Object.keys(ls).forEach(function (gno) {
      var rec = ls[gno];
      if (!rec || !rec.members) return;
      Object.keys(rec.members).forEach(function (key) {
        var v = rec.members[key];
        if (!v) return;
        /* 「有分」比「只有一个空壳数组」更可信，权重给高一点 */
        var has = Array.isArray(v) ? v.some(function (x) { return +x > 0; }) : false;
        var mk = String(key);
        if (mk.indexOf('sid:') !== 0) return;      // id:xxx 只有在成员对象还在时才认得出，这里跳过
        bump(bySid, mk.slice(4), gno, '组长评分表的学号', has ? 30 : 20, Number(l.seq) || 0);
      });
    });
  });
  /* ② 分组快照：越新的快照权重越高 */
  var snaps = (S.groupSnapshots || []).filter(function (x) { return x.clsId === cls.id; });
  snaps.forEach(function (snap, si) {
    (snap.groups || []).forEach(function (g) {
      (g.members || []).forEach(function (m) {
        if (!m.name) return;
        var w = 10 + si;
        if (m.sid) bump(bySid, String(m.sid), g.no, '分组快照（' + String(snap.at || '').slice(0, 10) + '）', w, si);
        bump(byName, String(m.name), g.no, '分组快照（' + String(snap.at || '').slice(0, 10) + '）', w, si);
      });
    });
  });
  return { bySid: bySid, byName: byName };
}

/** 待分配名单里「其实有原组可回」的人。返回 [{r, gno, basis, hits}]，命中不了的不进列表。 */
function droppedWithHome(cls) {
  if (!cls) return [];
  var idx = originalGroupIndex(cls);
  var nameCount = Object.create(null);
  rosterOf(cls).forEach(function (r) { if (r.name) nameCount[r.name] = (nameCount[r.name] || 0) + 1; });
  var map = placedMap(cls);
  return pendingList(cls).map(function (r) {
    if (!r || !r.name) return null;
    if (groupOfStudent(cls, r, map) !== null) return null;
    var hit = r.sid ? idx.bySid[String(r.sid)] : null;
    if (!hit && (nameCount[r.name] || 0) === 1) hit = idx.byName[r.name];
    if (!hit || !hit.gno) return null;
    return { r: r, gno: hit.gno, basis: hit.basis, hits: hit.hits || 1 };
  }).filter(Boolean);
}

/** 组号不存在就补一个空组：原组号恢复了，那一组的历史小组分才跟着回来。 */
function ensureGroupNo(cls, no) {
  var g = groupOf(cls, Number(no));
  if (g) return g;
  var maxNo = cls.groups.reduce(function (a, x) { return Math.max(a, Number(x.no) || 0); }, 0);
  var ng = { id: uid('g'), no: Number(no) || (maxNo + 1), members: [], restored: true };
  cls.groups.push(ng);
  return ng;
}

/** 「把掉出的人放回原组」：按倒推出的原组号一个一个放回去。
    放回去以后个人扣分按身份重新对齐；个人项目分本来就在同一个组号下面，不用搬。
    返回 {moved, groups, people}，交给调用方去报数。 */
function restoreDroppedToHome(cls) {
  var rows = droppedWithHome(cls);
  if (!rows.length) return { moved: 0, rows: [] };
  pushGroupSnapshot(cls, '把掉出的人放回原组（' + rows.length + ' 人）');
  var snap = scoreLayoutSnapshot(cls);
  rows.forEach(function (x) {
    var g = ensureGroupNo(cls, x.gno);
    pushMember(g, { id: uid('m'), name: x.r.name, sid: x.r.sid || '', no: x.r.no == null ? null : x.r.no });
  });
  realignPersonalScores(cls, snap);
  realignLeaderScores(cls, snap);
  addOperationLog('分组', cls.name + ' · 把掉出的人放回原组：' + rows.length + ' 人（' +
    rows.map(function (x) { return x.r.name + '→第' + x.gno + '组'; }).join('、') + '）');
  save();
  renderPool(); renderScore();
  return { moved: rows.length, rows: rows };
}

  /** 姓名 / 学号 → 所在组号 */
  function placedMap(cls) {
    var byName = Object.create(null), bySid = Object.create(null), legacyByName = Object.create(null), nameCounts = Object.create(null);
    rosterOf(cls).forEach(function (r) { nameCounts[r.name] = (nameCounts[r.name] || 0) + 1; });
    cls.groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        byName[m.name] = g.no;
        if (m.sid) bySid[m.sid] = g.no;
        if (!m.sid || String(m.sid).length < 8) legacyByName[m.name] = g.no;
      });
    });
    return { byName: byName, bySid: bySid, legacyByName: legacyByName, nameCounts: nameCounts };
  }

  /** 该生在哪个组；未分配返回 null。优先按学号匹配，再退回姓名。 */
  function groupOfStudent(cls, r, map) {
    map = map || placedMap(cls);
    if (r.sid && map.bySid[r.sid] !== undefined) return map.bySid[r.sid];
    if ((map.nameCounts[r.name] || 0) > 1) return null;
    if (r.sid && String(r.sid).length >= 8) return map.legacyByName[r.name] === undefined ? null : map.legacyByName[r.name];
    if (map.byName[r.name] !== undefined) return map.byName[r.name];
    return null;
  }

  /** 全班名单里还没进组的学生 */
  function pendingList(cls) {
    if (!cls) return [];
    var map = placedMap(cls);
    return rosterOf(cls).filter(function (r) { return groupOfStudent(cls, r, map) === null; });
  }

  /* ---- 学生自助选座的座位表 ----
     选座表和经典分组是两套数据：学生点圆桌坐下、老师代点放桌，都只写进选座表
     （jf_team_seats），要点「按选座确认分组」才写回 cls.groups。
     以前统计和待分配只认经典分组，于是出现了「看板说已选 59/59，下面还挂着 7 个待分配」
     的自相矛盾——老师明明看到 7 个人坐在桌上，统计却说他们没分。
     现在统一口径：坐在桌上的人算「已选座 · 待确认」，不再算待分配，也不再进一键分组的池子
     （一键分组会把他挪到别的组，和圆桌上的座次打架）。 */
  var tmSeatClass = null;   // tmState 是哪个班拉回来的，免得把 A 班的座位算到 B 班头上
  var tmSeatSig = '';
  var tmTried = Object.create(null);   // 哪个班已经自动拉过座位（记分页每次加分都会重画，不能每次都发请求）

  function seatIndex(cls) {
    var out = { bySid: Object.create(null), byName: Object.create(null), nameCounts: Object.create(null), n: 0 };
    if (!cls || !tmState || tmSeatClass !== cls.id) return out;
    (tmState.seats || []).forEach(function (s) {
      if (!s || !s.name || !Number(s.table)) return;
      if (s.no) out.bySid[String(s.no)] = Number(s.table);
      out.nameCounts[s.name] = (out.nameCounts[s.name] || 0) + 1;
      out.byName[s.name] = Number(s.table);
      out.n++;
    });
    return out;
  }

  /** 这个人在选座表里坐第几桌；没坐返回 0 */
  function seatedTable(cls, r, seat) {
    if (!r) return 0;
    seat = seat || seatIndex(cls);
    if (r.sid && seat.bySid[String(r.sid)]) return seat.bySid[String(r.sid)];
    /* 同名的人不能靠姓名猜桌 */
    return (seat.nameCounts[r.name] || 0) === 1 ? (seat.byName[r.name] || 0) : 0;
  }

  /** 已经坐在圆桌上、但还没写进分组的名单行 */
  function seatedNotGrouped(cls) {
    if (!cls) return [];
    var seat = seatIndex(cls);
    if (!seat.n) return [];
    var map = placedMap(cls);
    return rosterOf(cls).filter(function (r) {
      return groupOfStudent(cls, r, map) === null && !!seatedTable(cls, r, seat);
    });
  }

  /** 真正没着落的人：既不在任何组，也不在圆桌上 */
  function truePendingList(cls) {
    if (!cls) return [];
    var seated = seatedNotGrouped(cls);
    if (!seated.length) return pendingList(cls);
    return pendingList(cls).filter(function (r) { return seated.indexOf(r) < 0; });
  }

  /** 所有班级加起来还有多少人没分配 */
  function pendingTotal() {
    return visibleClasses().reduce(function (a, c) { return a + truePendingList(c).length; }, 0);
  }

  /* ================= 计算 ================= */

  /** 单个小组某节课的「本节」得分（0–5 标尺 = 本组本节项目的成员平均完成）
      2026-11-12：每课不再送 5 分，本节只看本课命名项目；
      手机未入袋 / 个人扣分从本节项目分里扣，不跨课。值日缺勤是整学期项目，不在本节里。 */
  function dutyGroups(lesson){return Array.isArray(lesson.dutyGroups)?lesson.dutyGroups:(lesson.dutyGroup?[Number(lesson.dutyGroup)]:[]);}
  /** 值日组统一写入：dutyGroups(数组) 与 dutyGroup(首组) 一起改，口径只此一处。
      课次设置弹窗和记分页主界面的值日点选都调它；落盘/记日志/重画由调用方各自处理。
      cls 参数为签名保留（与调用点统一），当前写入不需要用到它。 */
  function setLessonDuty(cls, lesson, duties) {
    duties = (duties || []).map(function (n) { return Number(n); }).filter(Boolean);
    lesson.dutyGroups = duties;
    lesson.dutyGroup = duties.length ? duties[0] : null;
  }
  function groupTotal(lesson, gno) {
    var A = window.JFDT_ASSESSMENT, cls = getClass(lesson.classId), g = cls && groupOf(cls, gno);
    if (!A || !g) return 0;
    var n = namedProjectCount(lesson);
    if (!n) return 0;
    var sum = 0, cnt = 0;
    g.members.forEach(function (m, i) {
      if (!m.name) return;
      sum += A.lessonNet(lesson, gno, i, memberKey(m)).earned;
      cnt++;
    });
    return cnt ? Math.round(sum / cnt / n * 100) / 100 : 0;
  }

  /** 小组累计（该班全部课次） */
  function groupCum(cls, gno) {
    return Math.round(lessonsOf(cls.id).reduce(function (a, l) { return a + groupTotal(l, gno); }, 0)*100)/100;
  }

  /** 有命名项目的课次数量（小组累计完成率的分母：每课 5 分） */
  function groupLessonSpan(ls) {
    var n = (ls || []).filter(function (l) { return namedProjectCount(l) > 0; }).length;
    return n || 1;
  }

  function groupCumThrough(cls,gno,lesson) { return Math.round(lessonsOf(cls.id).filter(function(l){return Number(l.seq)<=Number(lesson.seq);}).reduce(function(total,l){return total+groupTotal(l,gno);},0)*100)/100; }

  /** 某节课是否给该组记过任何东西 */
  function touched(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return false;
    if (s.first || s.group || s.phone || s.dutyAbsent) return true;
    return Object.keys(s.personal || {}).some(function (k) { return s.personal[k]; });
  }

  function personalSum(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s || !s.personal) return 0;
    return Object.keys(s.personal).reduce(function (a, k) { return a + (+s.personal[k] || 0); }, 0);
  }

  /** 个人总分 = 全组累计加分 + 个人项目累计分 − 本人累计个人扣分 */
  function projectScore(lesson, gno, member) {
    var record = lesson.leaderScores && lesson.leaderScores[String(gno)];
    var id = member.sid ? 'sid:' + member.sid : 'id:' + member.id;
    return record && record.members && record.members[id]
      ? record.members[id].reduce(function(a,n){ return a + (+n || 0); },0) : 0;
  }

  /* 本节「课堂任务」分：只数接线课堂任务自动入账的列（新列名「线上接线仿真 接线2.3」，
     2026-11-13 改前缀之前的「线上连线排位 接线2.3」、以及最早无前缀的「接线2.3」照旧认），
     手工项目列（协作 / 安全 / 5S…）不算在内。
     2026-11-09 用户要求「课堂任务积分直接丢进上课计分首页总表内」——
     以前这部分只在侧栏「组内个人评分」里看得到，总表只体现成一个变大的「本节完成率」，
     老师上课时看不出这分是哪来的。null = 本节这个人没有课堂任务分。
     ⚠ 前缀常量在 wire-task-link.js 的 NAME_PREFIX，两处必须一起改。
     2026-11-13 起这条正则还兼任「排位列只读」的判定（见 leader-scoring.js 与本节说明）：
     命中它的列是接线仿真课堂任务自动生成的，老师/学生都不能手改。 */
  var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真)/;
  function taskScore(lesson, gno, member) {
    var rec = lesson.leaderScores && lesson.leaderScores[String(gno)];
    if (!rec || !rec.members || !member) return null;
    var id = member.sid ? 'sid:' + member.sid : 'id:' + member.id;
    var values = rec.members[id];
    if (!Array.isArray(values)) return null;
    var A = window.JFDT_ASSESSMENT;
    var names = (A && A.projectNames && A.projectNames(lesson)) || [];
    var sum = 0, hit = 0;
    names.forEach(function (n, i) {
      if (!TASK_COL.test(String(n == null ? '' : n).trim())) return;
      var v = values[i];
      if (v == null || v === '') return;
      hit++; sum += Number(v) || 0;
    });
    return hit ? Math.round(sum * 100) / 100 : null;
  }

  /** 每人的学期合计（2026-11-12 值日缺勤改革后口径）：
      total = 值日缺勤（整学期 5 分，按组扣）＋ Σ本节个人项目得分 − Σ本节实际抵扣的扣分 */
  function memberTotals(cls) {
    var ls = lessonsOf(cls.id), A = window.JFDT_ASSESSMENT;
    var out = [];
    cls.groups.forEach(function (g) {
      var duty = A ? A.dutyScore(ls, g.no) : 5;
      g.members.forEach(function (m, idx) {
        if (!m.name) return;
        var project = 0, ded = 0;
        ls.forEach(function (l) {
          if (!A || !A.lessonNet) return;
          var rec = A.lessonNet(l, g.no, idx, memberKey(m));
          project += rec.raw;
          ded += rec.raw - rec.earned;   // 实际抵扣掉的扣分（最多扣完本节项目分）
        });
        out.push({
          name: m.name, sid: m.sid, no: m.no, gno: g.no,
          groupScore: duty, project: project, personal: ded, duty: duty,
          total: Math.round((duty + project - ded) * 100) / 100
        });
      });
    });
    out.sort(function (a, b) { return b.total - a.total || a.gno - b.gno; });
    return out;
  }

  /* ================= 撤销 ================= */

  var UNDO_MAX = 60;
  /* 显示口径 2026-11-12：group/first 是老数据残留（不再计分）；值日缺勤单独记 dutyAbsent */
  var FIELD_NAME = { first: '首个正确', group: '值日缺勤送分', phone: '全组扣分', dutyAbsent: '值日缺勤' };

  /** 记一笔可撤销的改动。只存"反做"需要的信息，很轻。
      op 三种形态：
        {lessonId, gno, f, old, neu}          标量（first / group / phone）
        {lessonId, gno, i, old, neu, name}    个人扣分（第 i 个成员）
        {lessonId, gno, reset:true, old}      整组清零（old 是该组原 scores 的副本） */
  function operationEffect(op){if(op.effect)return op.effect;var l=getLesson(op.lessonId),cls=l&&getClass(l.classId),g=cls&&groupOf(cls,op.gno),now=l&&l.scores[String(op.gno)];if(op.reset&&op.old&&now&&g){function points(sc,i){return Math.max(0,5-(+sc.phone||0)-(+((sc.personal||{})[String(i)])||0));}var patch=g.members.map(function(m,i){return {path:'point:'+i,delta:points(now,i)-points(op.old,i)};}).filter(function(x){return x.delta;});return patch;}return [{path:op.i!=null?'point:'+op.i:op.f,delta:op.i!=null?(+op.old||0)-(+op.neu||0):(+op.neu||0)-(+op.old||0)}].filter(function(x){return x.delta;});}
  function inverseEffects(a,b){return a.length===b.length&&a.every(function(x){return b.some(function(y){return x.path===y.path&&Math.abs(x.delta+y.delta)<1e-8;});});}
  function applyEffect(op,effect,direction){var l=getLesson(op.lessonId),cls=getClass(l.classId),g=groupOf(cls,op.gno),scored=sc(l,op.gno),actual=[];effect.forEach(function(e){var old,next;if(e.path.startsWith('leader:')){var token=e.path.slice(7),cut=token.lastIndexOf('|'),mk=token.slice(0,cut),col=+token.slice(cut+1),r=l.leaderScores&&l.leaderScores[String(op.gno)];if(!r)return;var values=r.members[mk]||(r.members[mk]=[]);old=Number(values[col])||0;next=Math.max(0,Math.min(5,old+direction*e.delta));values[col]=next===0&&direction<0&&e.wasBlank?null:next;}else if(e.path.startsWith('point:')){var i=e.path.slice(6),values=g.members.map(function(_,j){return remaining(l,g.no,j);});var base=5;old=values[+i];next=Math.max(0,Math.min(base,old+direction*e.delta));scored.phone=0;scored.group=base;scored.first=0;g.members.forEach(function(_,j){scored.personal[String(j)]=base-(String(j)===i?next:values[j]);});}else if(e.path.startsWith('personal:')){var i=e.path.slice(9);old=+scored.personal[i]||0;next=Math.max(0,Math.min(5,old+direction*e.delta));scored.personal[i]=next;}else{old=+scored[e.path]||0;next=Math.max(0,Math.min(e.path==='phone'?1000000:(e.path==='dutyAbsent'?20:5),old+direction*e.delta));scored[e.path]=next;}if(next!==old)actual.push({path:e.path,delta:next-old,wasBlank:e.wasBlank});});return actual;}
  function pushUndo(op) {
    if (!S.undo) S.undo = [];
    op.id=op.id||uid('op');
    op.effect=operationEffect(op);
    var auditLesson=getLesson(op.lessonId),auditClass=auditLesson&&getClass(auditLesson.classId),auditGroup=auditClass&&groupOf(auditClass,op.gno);
    if(auditGroup&&!op.audit){var totals=memberTotals(auditClass),effects=op.effect,points=effects.filter(function(e){return /^(point:|personal:)/.test(e.path);}),targets=(points.length?points.map(function(e){return +e.path.split(':')[1];}):auditGroup.members.map(function(_,i){return i;})).filter(function(i,p,a){return a.indexOf(i)===p&&auditGroup.members[i]&&auditGroup.members[i].name;});var deltas=targets.map(function(i){return effects.reduce(function(sum,e){return sum+(e.path==='point:'+i?e.delta:e.path==='personal:'+i?-e.delta:['group','first'].includes(e.path)?e.delta:e.path==='phone'||e.path==='dutyAbsent'?-e.delta:0);},0);});op.audit={source:(op.label&&String(op.label).indexOf('值日缺勤')===0)?'值日缺勤':'上课记分',lesson:auditClass.name+' · 第'+auditLesson.seq+'次课 · '+auditLesson.date+' · '+(auditLesson.topic||''),student:targets.length===1?auditGroup.members[targets[0]].name:'第'+op.gno+'组 · '+targets.map(function(i){return auditGroup.members[i].name;}).join('、'),sid:targets.length===1?auditGroup.members[targets[0]].sid||'':'全组操作',delta:deltas.length&&deltas.every(function(d){return d===deltas[0];})?(deltas[0]>0?'+':'')+deltas[0]+(targets.length>1?'/人':''):'—',after:targets.map(function(i){var m=auditGroup.members[i],row=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===op.gno&&t.name===m.name;});return row?row.total:'—';}).join(' / '),afterPct:targets.map(function(i){var m=auditGroup.members[i],row=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===op.gno&&t.name===m.name;});if(!row)return '—';var semesterMax=semesterProjectMax(lessonsOf(auditClass.id));if(!semesterMax)return '0%';return pctText(Math.max(0,row.total)/semesterMax*100);}).join(' / ')};}

    op.at = new Date().toISOString();
    addOperationLog('记分', undoLabel(reverseOp(op)),op);
    var opposite=-1;for(var oi=S.undo.length-1;oi>=0&&op.f!=='group'&&(+sc(getLesson(op.lessonId),op.gno).group===5);oi--){var previous=S.undo[oi];if(previous.lessonId===op.lessonId&&previous.gno===op.gno&&operationEffect(previous).some(function(e){return op.effect.some(function(x){return e.path===x.path;});})){if(inverseEffects(operationEffect(previous),op.effect))opposite=oi;break;}}
    if(opposite>=0)S.undo.splice(opposite,1);else S.undo.push(op);
    if (S.undo.length > UNDO_MAX) S.undo.shift();
    renderUndoBtn();
  }

  function dropUndo() { S.undo = []; renderUndoBtn(); }

  /** 某节课被清零 / 删除后，指向它的撤销记录就没意义了 */
  function dropUndoForLesson(lessonId) {
    S.undo = (S.undo || []).filter(function (op) { return op.lessonId !== lessonId; });
    renderUndoBtn();
  }

  function undoLabel(op) {
    var lesson = getLesson(op.lessonId), cls = lesson && getClass(lesson.classId);
    var g = (cls ? cls.name + ' · 第' + lesson.seq + '次课 · ' : '') + '第 ' + op.gno + ' 组';
    if(op.projectBatch)return g+' 已命名项目全员满分（每项100%）';
    if (op.reset) return g + ' '+(op.label||'本节清零');
    if (op.i != null) {
      return g + ' ' + (op.name || '成员') + ' 个人扣分 ' + scorePctText(op.neu) + ' → ' + scorePctText(op.old);
    }
    return g + ' ' + (FIELD_NAME[op.f] || op.f) + ' ' + showVal(op.f, op.neu) +
      ' → ' + showVal(op.f, op.old);
  }

  function reverseOp(op){return Object.assign({},op,{old:op.neu,neu:op.old});}

  function showVal(f, v) {
    if (f === 'first') return v ? '已加' : '未加';
    /* 值日缺勤 / 老送分字段按百分比显示；全组扣分存的是「次数」，保持计数 */
    if (f === 'dutyAbsent') return pctText(Math.max(0, Math.min(5, +v || 0)) * 20) + ' 扣';
    if (f === 'group') return scorePctText(v);
    return String(v);
  }

  function addOperationLog(kind, detail, op) {
    if (!S.operationLog) S.operationLog=[];
    S.operationLog.push({id:uid('log'),at:new Date().toISOString(),kind:kind,detail:detail,lessonId:op&&op.lessonId,opId:op&&op.id,audit:op&&op.audit?JSON.parse(JSON.stringify(op.audit)):undefined});
    if(S.operationLog.length>500) S.operationLog.splice(0,S.operationLog.length-500);
  }
  function canUndoAt(index) {
    var op=(S.undo||[])[index]; if(!op || !getLesson(op.lessonId))return false;if(op.projectBatch&&JSON.stringify(window.JFDT_ASSESSMENT.projectNames(getLesson(op.lessonId)))!==JSON.stringify(op.projectNames))return false;
    return true;
  }
  function renderOperationLog() {
    var list=$('#operationLogList'); if(!list) return;
    var classFilter=$('#logClassFilter'),savedClass=classFilter.value,search=$('#logSearch').value.trim().toLowerCase();
    /* 用可见班级，不用 S.classes：旧班/别的班不该出现在筛选里（2026-11-04） */
    classFilter.innerHTML='<option value="">全部班级</option>'+visibleClasses().map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>';}).join('');classFilter.value=savedClass;
    var lessonFilter=$('#logLessonFilter'),savedLesson=lessonFilter.value;
    lessonFilter.innerHTML='<option value="">全部课次</option>'+S.lessons.filter(function(l){return !classFilter.value||l.classId===classFilter.value;}).sort(function(a,b){return b.seq-a.seq;}).map(function(l){var c=getClass(l.classId);return '<option value="'+esc(l.id)+'">'+esc((!classFilter.value&&c?c.name+' · ':'')+'第'+l.seq+'次课 · '+l.date)+'</option>';}).join('');lessonFilter.value=Array.from(lessonFilter.options).some(function(o){return o.value===savedLesson;})?savedLesson:'';
    function matches(op){var lesson=getLesson(op.lessonId);return (!classFilter.value||lesson&&lesson.classId===classFilter.value)&&(!lessonFilter.value||op.lessonId===lessonFilter.value)&&(!search||(undoLabel(op)+' '+JSON.stringify(op.audit||{})).toLowerCase().includes(search));}
    function when(at){return at?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'历史记录';}
    function row(op,index,restored){var lesson=getLesson(op.lessonId),cls=lesson&&getClass(lesson.classId),allowed=restored||canUndoAt(index),meta=Object.assign({},op.audit||{}),label=undoLabel(reverseOp(op)),title=meta.lesson||(cls?cls.name+' · 第'+lesson.seq+'次课 · '+(lesson.date||'')+' · '+(lesson.topic||''):'历史课次');if(!meta.delta&&op.effect&&op.effect.length){var effects=op.effect,pointOnly=effects.every(function(e){return e.path.startsWith('point:');}),single=effects.length===1&&['group','first','phone'].includes(effects[0].path);if((pointOnly&&effects.every(function(e){return e.delta===effects[0].delta;}))||single){var d=effects[0].delta*(effects[0].path==='phone'?-1:1);meta.delta=(d>0?'+':'')+d+((pointOnly&&effects.length>1)||(single&&op.i==null)?'/人':'');}}/* 显示层（2026-11-09）：加减分与操作后总分按完成率口径展示，存储值不动 */var deltaShow=auditDeltaPct(meta.delta),afterShow=meta.afterPct||meta.after||'—';return '<tr class="operation-row"><td title="'+esc(when(op.at))+'">'+esc(when(op.at))+'</td><td>'+esc(meta.source||'课堂记分')+'</td><td title="'+esc(title+'；'+label)+'">'+esc(title)+'</td><td class="log-student" title="'+esc(meta.student||label)+'"><span class="log-no">'+esc(meta.sid||'第'+op.gno+'组')+'</span><b>'+esc(meta.student||op.name||'小组记分')+'</b></td><td class="delta '+(String(meta.delta||'').startsWith('-')?'minus':'plus')+'" title="'+esc(label)+'">'+esc(deltaShow||'—')+'</td><td title="当时的累计完成率；多人操作按成员顺序排列">'+esc(afterShow)+'</td><td><button class="edit-log-btn '+(restored?'log-restore':'log-undo')+'" '+(restored?'data-redo-index':'data-undo-index')+'="'+index+'" '+(!allowed?'disabled':'')+' title="'+esc((meta.sid==='全组操作'?'整笔全组操作：':'')+(restored?'恢复实际效果':'撤销实际效果'))+'">'+(restored?'恢复':'撤销')+'</button></td></tr>';}
    function table(rows,restored){return '<div class="bubble-audit-scroll"><table class="bubble-audit-table"><thead class="log-table-head"><tr><th>北京时间</th><th>来源</th><th>课次</th><th>学生</th><th>加减分</th><th>操作后总分</th><th>操作</th></tr></thead><tbody>'+rows.map(function(r){return row(r.op,r.index,restored);}).join('')+'</tbody></table></div>';}
    var pending=(S.undo||[]).map(function(op,i){return {op:op,index:i};}).filter(function(r){return matches(r.op);}).reverse(),redo=(S.redo||[]).map(function(e,i){return {op:e.op,index:i};}).filter(function(r){return matches(r.op);}).reverse();
    function entryLesson(e){if(e.lessonId)return getLesson(e.lessonId);var detail=e.detail||'',m=detail.match(/第\s*(\d+)\s*次(?:课)?/),c=S.classes.find(function(c){return detail.startsWith(c.name+' ·');});return c&&m?S.lessons.find(function(l){return l.classId===c.id&&l.seq===+m[1];}):null;}
    function auditRow(e){var l=entryLesson(e),c=l&&getClass(l.classId),meta=e.audit||{},detail=e.detail||'',parts=detail.split(' · '),tail=parts.slice(2).join(' · ')||detail;var source=meta.source||e.kind||'历史记录',title=meta.lesson||(l?c.name+' · 第'+l.seq+'次课 · '+l.date+' · '+(l.topic||''):parts.slice(0,2).join(' · '));var deltaShow=meta.delta!=null?auditDeltaPct(meta.delta):'—',afterShow=meta.afterPct||meta.after||'—';return '<tr class="audit-row"><td>'+esc(when(e.at))+'</td><td>'+esc(source)+'</td><td title="'+esc(detail)+'">'+esc(title||'历史记录')+'</td><td class="log-student" title="'+esc(detail)+'"><b>'+esc(meta.student||tail)+'</b></td><td class="delta '+(String(meta.delta||'').startsWith('-')?'minus':'plus')+'">'+esc(deltaShow)+'</td><td>'+esc(afterShow)+'</td><td>'+esc(e.kind==='撤销'?'已撤销':e.kind==='重做'?'已恢复':'核对记录')+'</td></tr>';}
    var entries=(S.operationLog||[]).slice().reverse().filter(function(e){var l=entryLesson(e);return (!classFilter.value||(l?l.classId===classFilter.value:(e.detail||'').startsWith((getClass(classFilter.value)||{}).name+' ·')))&&(!lessonFilter.value||l&&l.id===lessonFilter.value)&&(!search||(e.detail||'').toLowerCase().includes(search));});
    var auditTable=table([],false).replace('<tbody></tbody>','<tbody>'+entries.map(auditRow).join('')+'</tbody>');
    list.innerHTML=(pending.length?table(pending,false):'<div class="log-empty">'+(search||classFilter.value||lessonFilter.value?'没有匹配的记录':'暂无可撤销记分')+'</div>')+'<details class="log-restored"'+(redo.length?' open':'')+'><summary>已撤销，可恢复 <span>'+redo.length+'</span></summary>'+(redo.length?table(redo,true):'<div class="log-empty">暂无已撤销记录</div>')+'</details><details class="log-audit"><summary>完整流水 <span>'+entries.length+'</span></summary>'+auditTable+'</details>';
    var entry=(S.redo || []).slice(-1)[0];
    $('#redoDetail').textContent=entry ? '下一步重做：'+undoLabel(reverseOp(entry.op)) : '暂无可重做操作';
  }

  function fadeLogRow(row) {
    if(!row || window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    var rect=row.getBoundingClientRect(), ghost=row.cloneNode(true);
    ghost.classList.add('log-row-ghost'); ghost.setAttribute('aria-hidden','true');
    ghost.style.cssText='position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;z-index:5;pointer-events:none;';
    $('#dlgOperationLog').appendChild(ghost);
    setTimeout(function(){ghost.remove();},220);
  }

  function renderUndoBtn() {
    /* V10（2026-11-12）：操作日志与撤销 UI 已整体移除，这里不再更新任何按钮。
       数据层 S.undo/S.redo 保留（pushUndo 调用不变，内存栈自然增长，不再有入口读取）。 */
    return;
  }

  /** 撤销一步。返回是否真的撤了 */
  function undo() {
    if (!(S.undo || []).length) return false;
    var op = null, l = null;
    while (S.undo.length) {
      op = S.undo.pop();
      l = getLesson(op.lessonId);
      if (l) break;
      op = null;                        // 课次已被删掉，跳过这条继续往前撤
    }
    renderUndoBtn();
    if (!op) return false;
    if (UI) UI.clear();

    var key = String(op.gno);
    var beforeUndo=JSON.parse(JSON.stringify(l.scores[key]||{}));if(!S.redo)S.redo=[];var actual=applyEffect(op,operationEffect(op),-1);var undoChanged=actual.length>0;S.redo.push({op:JSON.parse(JSON.stringify(op)),redoEffect:actual.map(function(e){return {path:e.path,delta:-e.delta,wasBlank:e.wasBlank};})});

    var cls = getClass(l.classId);
    var sameView = cls && S.ui.classId === l.classId && S.ui.lessonId === l.id;
    if (cls) { S.ui.classId = l.classId; S.ui.lessonId = l.id; }
    addOperationLog('撤销',undoLabel(op));
    save(false);
    renderUndoBtn();

    if(op.projectBatch)renderLeader();
    if (sameView) { refreshCard(cls, l, op.gno); renderMetrics(cls, l); }
    else { renderScore(); }

    flash('已撤销：' + undoLabel(op));
    if (UI && undoChanged) UI.feedback(op.gno, op.reset ? null : op.f, op.i, 0, '已撤销：' + undoLabel(op), true);
    return true;
  }

  /** 顶栏那句小字兼做提示条 */
  function flash(msg, quiet) {
    var el = $('#saveState');
    if (el) {
      el.textContent = msg;
      el.classList.add('flash');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        el.classList.remove('flash');
        var d = new Date();
        el.textContent = '已保存 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
      }, 2600);
    }

    if (!quiet) toast(msg);
  }

  /* ---------------- 保存成功的动效 ---------------- */
  /* 每次动作有结果都蹦一条：勾自己"画"出来 + 一圈光环扩散 + 整条弹上来再飘走。
     全部用 CSS 动画，不碰 JS 动画 API（无头测试里也不会报错）。 */
  var toastTimer = null, toastEl = null;

  function toast(msg) {
    if (!document.body) return;
    if (toastEl) { toastEl.remove(); toastEl = null; }
    clearTimeout(toastTimer);

    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ic">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.6l4.7 4.7L19.5 7"/></svg>' +
      '</span><span class="tx"></span>';
    el.querySelector('.tx').textContent = msg;
    document.body.appendChild(el);
    toastEl = el;

    toastTimer = setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () {
        if (el.parentNode) el.remove();
        if (toastEl === el) toastEl = null;
      }, 280);
    }, 2200);
  }

  /* 记分页布局：表格式（默认，跟纸质表一致）/ 卡片式（手机上更好点） */

  var scoreLayout = 'table';

  function initLayout() {
    var saved = S.ui && S.ui.scoreLayout;
    scoreLayout = (saved === 'table' || saved === 'card')
      ? saved
      : (window.innerWidth && window.innerWidth < 760 ? 'card' : 'table');
    $$('#layoutSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.l === scoreLayout);
    });
    if (UI) UI.pill();
  }

  /* ================= 视图切换 ================= */

  var attendanceContext = null;
  var view = 'score';

  function switchView(v) {
    groupPicking=null;
    if(view==='attendance' && v!=='attendance' && attendanceContext && attendanceContext.isDirty && attendanceContext.isDirty()){flash('请先保存本课考勤，再切换页面。');return;}
    view = v;
    ['score', 'leader', 'rank', 'gradebook', 'attendance', 'pool'].forEach(function (k) {
      var el = $('#view-' + k);
      if (el) el.hidden = (k !== v);
    });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (UI) UI.setView(v);
    if (v === 'rank') renderRank();
    if (v === 'gradebook') renderGradebook();
    if (v === 'pool') { renderPool(); renderTeamCard(); } else { tmStop(); }
    if (v === 'score') { renderScore(); if (window.JFDT_WIRE) window.JFDT_WIRE.maybeSync(curClass()); }
    if (v === 'leader') renderLeader();
    if (v === 'attendance') renderAttendance();
  }
  function renderAttendance() {
    var cls=curClass(); if(!cls || !window.JFDT_ASSESSMENT)return;
    if(!$('#view-attendance')){var section=document.createElement('section');section.id='view-attendance';section.className='view';$('#main').appendChild(section);}
    $('#view-attendance').hidden=false;
    attendanceContext={root:$('#view-attendance'),cls:cls,cloud:(CLOUD_ON&&CLOUD&&typeof CLOUD.rpc==='function'&&CLOUD.profile&&CLOUD.profile())?function(name,args){return CLOUD.rpc(name,args);}:null,classes:visibleClasses(),lessons:lessonsOf(cls.id),lesson:curLesson(cls),raw:memberTotals(cls),save:function(){save();},log:addOperationLog,message:function(text){flash(text);},select:function(classId,lessonId){S.ui.classId=classId;S.ui.lessonId=lessonId;save(false);fillClassSelects();renderAttendance();}};
    window.JFDT_ASSESSMENT.renderAttendance(attendanceContext);
  }

  /* ================= 组内互评（2026-11-04） =================
     老师在「项目评分表」里按本节课开「组长打分」→ 组长给组员打分、组员给组长打分（取平均）
     → **学生提交直接计分**（2026-11-10 用户要求取消教师逐列确认）：拉看板时由
     peer-apply.js 把原始提交归成「落哪一格、落多少分」写回本节 leaderScores。
     要改分走两条老路：① 直接点格子手改（「师」角标）；② 关掉「组长打分」开关再改。
     原始提交仍存在云端 jf_peer_scores，老师「清空本列」才会删掉它。
     数据库脚本：supabase/2026-11-04-组内互评打分.sql。 */
  var peerCache = Object.create(null);      // lessonId -> 最近一次看板

  function peerClassId(cls) { return Number(cls && cls.hxClassId) || 0; }
  function peerLessonKey(lesson) { return String((lesson && lesson.id) || ''); }

  /** 云端能不能用：必须登录了教师账号、这个班绑了首页班级 */
  function peerReady(cls) {
    return !!(CLOUD_ON && CLOUD && typeof CLOUD.rpc === 'function' &&
      CLOUD.profile && CLOUD.profile() && peerClassId(cls));
  }
  function peerReason(cls) {
    if (!CLOUD || typeof CLOUD.rpc !== 'function') return '没加载云端模块，只能本机记分';
    if (!CLOUD.profile || !CLOUD.profile()) return '请先登录教师账号，组长才能用自己账号打分';
    if (!peerClassId(cls)) return '这个班还没绑定首页班级，学生账号找不到它';
    return '';
  }

  /** 本节课「仅教师可评」的列名（收拾板子 / 归位工具这类，用户 2026-11-12 定的规则） */
  function teacherOnlyCols(lesson) {
    var l = lesson && lesson.teacherOnly;
    if (!Array.isArray(l)) return [];
    var out = [];
    l.forEach(function (n) {
      var s = String(n == null ? '' : n).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /** 本节课要发布的项目列（只发有名字的列，col 保持与 leaderScores 下标一致）
      2026-11-12：「仅教师」列**不发给学生** —— 学生端根本看不到这一列，
      自然也就点不了；老师那边照旧可以点格子给分。 */
  function peerProjectList(lesson) {
    var names = (window.JFDT_ASSESSMENT && window.JFDT_ASSESSMENT.projectNames(lesson)) || [];
    var skip = teacherOnlyCols(lesson);
    var out = [];
    names.forEach(function (n, i) {
      var name = String(n == null ? '' : n).trim();
      if (!name) return;
      if (skip.indexOf(name) >= 0) return;
      out.push({ name: name, col: i });
    });
    return out;
  }

  function peerPayload(cls, lesson) {
    return {
      v: 1,
      seq: Number(lesson.seq) || 0,
      date: lesson.date || '',
      topic: lesson.topic || '',
      projects: peerProjectList(lesson),
      /* 名单也一起发下去：学生端拿它做二次过滤（防旧缓存页），peer-apply 拿它做兜底丢弃 */
      teacherOnly: teacherOnlyCols(lesson),
      groups: (cls.groups || []).map(function (g) {
        var members = g.members.filter(function (m) { return !!m.name; })
          .map(function (m) { return { key: memberKey(m), name: m.name }; });
        return { no: g.no, leader: groupLeaderKey(g), members: members };
      }).filter(function (g) { return g.members.length; })
    };
  }

  /** 开 / 关本节课的组长打分。开的时候顺带把最新分组、项目、组长发布上去。
      silent = 老师没动手，是 peerSyncGroups() 在后台补发最新分组：
      这时候不记操作日志（换一次组长就多一条「开放组长打分」会让撤销看不懂），也不整页重绘。 */
  function peerSetGate(cls, lesson, open, silent) {
    if (!peerReady(cls)) return Promise.reject(new Error(peerReason(cls)));
    var args = { p_class: peerClassId(cls), p_lesson: peerLessonKey(lesson), p_open: !!open };
    if (open) args.p_payload = peerPayload(cls, lesson);
    return CLOUD.rpc('jf_peer_gate', args).then(function (res) {
      lesson.peerGate = !!open;
      lesson.peerGateAt = new Date().toISOString();
      delete peerCache[peerLessonKey(lesson)];
      if (!silent) {
        addOperationLog('组内互评', cls.name + ' · 第' + lesson.seq + '次课 · ' +
          (open ? '开放组长打分（仅本节）' : '关闭组长打分'));
        save();
      }
      return res || { open: !!open };
    });
  }

  /* 分组 / 组长 / 名单的指纹。用来判断「服务器上那份 payload 还跟不跟得上本机」 */
  function peerGroupsHash(cls, lesson) {
    try { return JSON.stringify(peerPayload(cls, lesson).groups); } catch (e) { return ''; }
  }

  /* 组长（或名单、分组）在本机变了，就把最新的一份悄悄重发上去。
     2026-11-09 用户报：「更新组长（首页双击）但是小组给组长加分的时候组长名字却还是旧的不会变」。
     根因：payload（含每组 leader 键和成员名）只在「开放组长打分」那一瞬间发到服务器
     （jf_peer_gate 只在 p_open 时写 jf_peer_boards），之后在首页双击换组长，
     服务器上还是开课时那份旧名单 —— 学生端 jf_peer_mine 拿到的 leader 自然还是旧人，
     组员给组长打分就打到旧组长头上了。
     所以：课次开着互评 + 指纹变了，就重发一次。force 用于「刚改完，别管指纹」的场合。
     重发只覆盖分组/项目/组长，不碰 jf_peer_scores，已经打出去的分不会丢。 */
  function peerSyncGroups(cls, force) {
    try {
      if (!cls || !peerReady(cls)) return;
      /* 这里故意不复用 curLesson()：那个函数会顺手改写 S.ui.lessonId，
         而同步可能发生在「不是当前在看的那个班」上，不该动界面状态。 */
      var lesson = getLesson(S.ui.lessonId);
      if (!lesson || lesson.classId !== cls.id) {
        var ls = lessonsOf(cls.id);
        lesson = ls.length ? ls[ls.length - 1] : null;
      }
      if (!lesson || !lesson.peerGate) return;
      var hash = peerGroupsHash(cls, lesson);
      if (!hash) return;
      if (!force && lesson.peerHash === hash) return;
      peerSetGate(cls, lesson, true, true).then(function () {
        lesson.peerHash = hash;
        save(false);
      }).catch(function () { /* 网络抖一下不打扰老师；下次进评分页还会再同步 */ });
    } catch (e) { }
  }

  function peerFetchBoard(cls, lesson) {
    if (!peerReady(cls)) return Promise.reject(new Error(peerReason(cls)));
    return CLOUD.rpc('jf_peer_board', {
      p_class: peerClassId(cls), p_lesson: peerLessonKey(lesson)
    }).then(function (res) {
      var board = res || {};
      board.at = Date.now();
      peerCache[peerLessonKey(lesson)] = board;
      lesson.peerGate = !!board.open;
      /* 拿到看板就直接计分（学生提交不再需要老师逐列确认） */
      peerApplyBoard(cls, lesson, board);
      return board;
    });
  }
  function peerCached(lesson) { return peerCache[peerLessonKey(lesson)] || null; }

  /** 取该组该课的评分记录，缺就补一个空壳（结构和 leader-scoring.js 一致） */
  function peerRecord(lesson, gno) {
    if (!lesson.leaderScores) lesson.leaderScores = {};
    var rec = lesson.leaderScores[String(gno)];
    if (!rec) {
      rec = lesson.leaderScores[String(gno)] = {
        projects: (window.JFDT_ASSESSMENT.projectNames(lesson) || []).slice(),
        members: {}, signedBy: '', note: ''
      };
    }
    if (!Array.isArray(rec.projects)) rec.projects = (window.JFDT_ASSESSMENT.projectNames(lesson) || []).slice();
    if (!rec.members) rec.members = {};
    return rec;
  }

  function peerColumnOf(lesson, project) {
    var hit = peerProjectList(lesson).find(function (p) { return p.name === project; });
    return hit ? hit.col : -1;
  }

  /** 学生提交直接计分：把看板里的原始提交归成「落哪一格、落多少分」，写进本节 leaderScores。
      （真正的归并/平均/时间戳护栏在 peer-apply.js，这里只负责接上 colOf 和保存） */
  function peerApplyBoard(cls, lesson, board) {
    try {
      var A = window.JFDT_PEER_APPLY;
      if (!A || !lesson || !board) return 0;
      var n = A.applyInto(lesson, A.rows(board), function (p) { return peerColumnOf(lesson, p); });
      if (n > 0) save(false);   // 保存但不重绘：调用方拿到 board 之后自己会重画
      return n;
    } catch (e) { return 0; }
  }

  /** 把服务端算好的确认结果写回本节 leaderScores（成员=组长给的原始分，组长=组员平均分） */
  function peerApplyRows(lesson, project, rows) {
    /* 线上排位列：只有真实完成排位才能得分 —— 老数据里若曾有这一列的「已确认」提交，
       也绝不再从互评链路写回来 */
    if (TASK_COL.test(String(project == null ? '' : project).trim())) {
      console.warn('[peer] 拒绝把线上排位列「' + project + '」的互评确认结果写回成绩');
      return 0;
    }
    var col = peerColumnOf(lesson, project);
    if (col < 0) return 0;
    var n = 0;
    (rows || []).forEach(function (r) {
      var gno = Number(r.gno), target = String(r.target || ''), score = Number(r.score);
      if (!gno || !target || !isFinite(score)) return;
      var rec = peerRecord(lesson, gno);
      if (!Array.isArray(rec.members[target])) rec.members[target] = [];
      rec.members[target][col] = Math.round(Math.max(0, Math.min(5, score)) * 10) / 10;
      if (!lesson.peerMeta) lesson.peerMeta = {};
      lesson.peerMeta[gno + '|' + target + '|' + col] = r.kind === 'avg' ? 'avg' : 'leader';
      n++;
    });
    return n;
  }

  /** 老师点「清空本列」：这一列本轮加分全部清掉（含互评标记），学生重新提交才会再计分 */
  function peerClearColumn(cls, lesson, project) {
    /* 线上排位列：分是课堂任务自动入账的，清空本列会把任务分一起抹掉 —— 坚决拒绝 */
    if (TASK_COL.test(String(project == null ? '' : project).trim())) {
      console.warn('[peer] 拒绝清空线上排位列「' + project + '」：这一列的分来自课堂任务，不能清空');
      return 0;
    }
    var col = peerColumnOf(lesson, project);
    if (col < 0) return 0;
    var n = 0;
    (cls.groups || []).forEach(function (g) {
      var rec = lesson.leaderScores && lesson.leaderScores[String(g.no)];
      if (!rec || !rec.members) return;
      Object.keys(rec.members).forEach(function (k) {
        var values = rec.members[k];
        if (Array.isArray(values) && values[col] != null) { values[col] = null; n++; }
        if (lesson.peerMeta) delete lesson.peerMeta[g.no + '|' + k + '|' + col];
        /* 清空后这一格归零，护栏也一起清掉：学生重新提交就该能进分，
           否则老师电脑时钟偏快时，新的提交会被判成「比已记录的旧」而永远进不来 */
        if (lesson.peerSync) delete lesson.peerSync[g.no + '|' + k + '|' + col];
      });
    });
    return n;
  }

  /** 2026-11-09 取消「逐列确认」后，这里只剩「清空本列」一个用途（ok=false）：
      服务器删掉这一列本轮所有原始提交、状态记 rejected，学生要重新打才有分。
      ok=true 这条分支留着是为了兼容老数据（历史已确认的列）。 */
  function peerConfirm(cls, lesson, project, ok) {
    if (!peerReady(cls)) return Promise.reject(new Error(peerReason(cls)));
    return CLOUD.rpc('jf_peer_confirm', {
      p_class: peerClassId(cls), p_lesson: peerLessonKey(lesson),
      p_project: project, p_ok: !!ok
    }).then(function (res) {
      var rows = (res && res.rows) || [];
      var changed = ok ? peerApplyRows(lesson, project, rows) : peerClearColumn(cls, lesson, project);
      delete peerCache[peerLessonKey(lesson)];
      addOperationLog('组内互评', cls.name + ' · 第' + lesson.seq + '次课 · 项目「' + project + '」' +
        (ok ? '采纳这一列提交' + (changed ? '（' + changed + ' 格）' : '（无提交）') : '清空本列，清除本轮加分' + (changed ? '（' + changed + ' 格）' : '')));
      save();
      return { ok: !!ok, changed: changed, rows: rows };
    });
  }

  function renderLeader() {
    if (!$('#view-leader')) {
      var section = document.createElement('section');
      section.id = 'view-leader'; section.className = 'view';
      $('#main').appendChild(section);
    }
    /* 进评分页先兜一次同步：分组/名单/组长在首页改过、指纹对不上就把最新一份重发上去 */
    peerSyncGroups(curClass());
    if (window.JFDT_LEADER_RENDER) window.JFDT_LEADER_RENDER({
      root: $('#view-leader'), state: S,
      /* 2026-11-04 用户报「组内个人评分的班级下拉出现不属于我的班」（26机电11班、26机电15/16/17班 等）：
         这个视图原来直接用 S.classes（本机所有班，含很早以前导入的历史班），没过首页名单这一层，
         所以别的班甚至别的学期的班全冒出来了。这里改成和「上课记分」同一份可见班级。 */
      classes: visibleClasses(),
      save: function () { save(); var cls=curClass(),lesson=curLesson(cls);if(lesson)renderGroups(cls,lesson); },
      log: function(detail) { addOperationLog('个人项目评分',detail); },
      fullMarks:function(lesson,groups,columns,names){var cls=getClass(lesson.classId),changed=0;
      /* 线上排位列（TASK_COL 与 taskScore() 同一个正则）：只有真实完成排位才能得分，
         一键满分绝不能给它填 100%——即使调用方漏过滤，这里再挡一道 */
      columns=(columns||[]).filter(function(i){return !TASK_COL.test(String((names&&names[i])==null?'':names[i]).trim());});
      if(!columns.length){flash('本课的项目列都是线上排位列：只有真实完成排位才能得分，不能一键满分。');return;}
      if(!lesson.leaderScores)lesson.leaderScores={};groups.forEach(function(g){var r=lesson.leaderScores[String(g.no)]||(lesson.leaderScores[String(g.no)]={projects:names.slice(),members:{},signedBy:'',note:''}),effect=[];g.members.filter(function(m){return m.name;}).forEach(function(m){var key=m.sid?'sid:'+m.sid:'id:'+m.id,values=r.members[key]||(r.members[key]=[]);columns.forEach(function(i){var old=values[i];if(old===5)return;effect.push({path:'leader:'+key+'|'+i,delta:5-(Number(old)||0),wasBlank:old==null});values[i]=5;changed++;});});
      /* 一键满分是老师的明确动作：除了清掉「互评」角标，还要把这一格的 peerSync 顶到现在，
         否则 10 秒自动刷新拉回来的旧提交会把 5 分改回去（学生之后重新提交的更新的分照常覆盖） */
      if(!lesson.peerMeta)lesson.peerMeta={};if(!lesson.peerSync)lesson.peerSync={};g.members.filter(function(m){return m.name;}).forEach(function(m){var k=m.sid?'sid:'+m.sid:'id:'+m.id,now=new Date().toISOString();columns.forEach(function(i){delete lesson.peerMeta[g.no+'|'+k+'|'+i];lesson.peerSync[g.no+'|'+k+'|'+i]=now;});});
      if(!effect.length)return;var totals=memberTotals(cls);pushUndo({lessonId:lesson.id,gno:g.no,projectBatch:true,projectNames:names.slice(),effect:effect,audit:{source:'项目批量满分',lesson:cls.name+' · 第'+lesson.seq+'次课 · '+lesson.date+' · '+(lesson.topic||''),student:'第'+g.no+'组全员，'+columns.length+'项各100%',sid:'全组操作',delta:'+'+effect.reduce(function(a,e){return a+e.delta;},0)+'（全组合计）',after:g.members.filter(function(m){return m.name;}).map(function(m){var t=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===g.no&&t.name===m.name;});return t?t.total:'—';}).join(' / ')}});});save();renderGroups(cls,lesson);flash(changed?'已将'+changed+'个项目成绩填为 100%':'所选项目已全部满分，无需修改');},

      select: function (classId, lessonId) {
        S.ui.classId = classId; S.ui.lessonId = lessonId;
        fillClassSelects(); save(false); renderLeader();
      },
      toggleLeader: function (cls, group, member) { return setGroupLeader(cls, group, member); },
      memberEntries: function (group) { return groupMemberEntries(group); },
      isLeader: function (group, member) { return isGroupLeader(group, member); },
      /* 组内互评（2026-11-04）：开关、看板、清空本列都走这里，界面在 leader-scoring.js */
      peer: {
        ready: peerReady,
        reason: peerReason,
        payload: peerPayload,
        projectList: peerProjectList,
        setGate: peerSetGate,
        syncGroups: peerSyncGroups,
        fetchBoard: peerFetchBoard,
        cached: peerCached,
        confirm: peerConfirm,
        memberKey: memberKey,
        leaderKey: groupLeaderKey
      },
      openScore: function () { switchView('score'); }
      ,openGroups: function () { switchView('pool'); }
    });
  }

  /* ================= 上课记分视图 ================= */

  function curClass() {
    var vis = visibleClasses(), c = getClass(S.ui.classId);
    if (!c || vis.indexOf(c) < 0) { c = vis[0]; if (c) S.ui.classId = c.id; }
    return c;
  }

  function curLesson(cls) {
    var ls = lessonsOf(cls.id);
    var l = getLesson(S.ui.lessonId);
    if (!l || l.classId !== cls.id) {
      l = ls.length ? ls[ls.length - 1] : null;
      S.ui.lessonId = l ? l.id : null;
    }
    return l;
  }

  function fillClassSelects() {
    var cur = curClass();
    ['#classSel', '#rankClassSel', '#poolClassSel'].forEach(function (sel) {
      var e = $(sel);
      e.innerHTML = visibleClasses().map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
      }).join('');
      if (cur) e.value = cur.id;
    });
  }

  function renderScore() {
    /* 2026-11-09：接线任务的横幅撤掉了（用户要求：积分直接进总表「课堂任务」列，排名看大屏）。
       入账不靠这个调用，靠 boot 后的 syncAll + 10 秒心跳，所以这里不再画横幅。 */
    var cls = curClass();
    if (!cls) return;
    $('#classSel').value = cls.id;
    $('#rankClassSel').value = cls.id;
    $('#poolClassSel').value = cls.id;
    renderPoolBanner(cls);
    renderGroupSummary();   /* 待分配页顶部那句「N 个组 · 已分 x/y 人」也顺手刷一下 */
    tmMaybePull(cls);   /* 记分页也要知道「谁已经坐在圆桌上」，否则横幅和待分配页是两套数字 */
    updatePoolBadge();
    $('#rosterSetupHint').hidden = !!(rosterOf(cls).length || cls.groups.some(function (g) { return memberCount(g) > 0; }));

    var ls = lessonsOf(cls.id);
    var sel = $('#lessonSel');
    sel.innerHTML = ls.map(function (l) {
      return '<option value="' + l.id + '">第 ' + l.seq + ' 次课 · ' + esc(l.date || '') + '</option>';
    }).join('') || '<option value="">暂无课次</option>';
    var lesson = curLesson(cls);
    if (lesson) sel.value = lesson.id;
    sel.disabled = !ls.length;
    renderUndoBtn();

    $('#noLessonHint').hidden = !!lesson;
    $('#lessonMeta').hidden = !lesson;
    $('#scoreMetrics').hidden = !lesson;
    $('#groupList').hidden = !lesson;

    if (!lesson) { $('#lessonMeta').innerHTML = ''; $('#groupList').innerHTML = ''; return; }

    renderLessonMeta(cls, lesson);
    renderGroups(cls, lesson);
    /* 一个「有人的组」都没有时（新建班只剩模板空组也一样），记分页会只剩空白；
       说清楚下一步该做什么，别让老师以为「没分完不让进」。这里只提示，不拦人。 */
    if (!groupCountOf(cls)) {
      $('#groupList').innerHTML = '<p class="empty-hint">这个班还没有小组（或者组里一个人都没有）。到「待分配名单」点「分组…」，' +
        '按组数或每组人数分一下，分好组就能在这里记分。</p>';
    }
    renderMetrics(cls, lesson);
    if (UI) UI.pill();
  }

  function renderLessonMeta(cls, lesson) {
    /* 2026-11-13 精简：原来这里一排四个文字按钮（课次设置/打印本课/下载Excel/下载PDF），
       又长又挤。改成两个图标按钮，功能文字放到 title 悬浮提示里；打印三合一（本课加分表 / PDF / Excel）
       收进同一个「打印 / 导出」对话框，点开再选。
       2026-11-13 值日组点选：值日组不再只能进课次设置弹窗的多选下拉里改，这里直接摆一排
       组号胶囊，点一下设为值日组、再点取消（可多选），与 lesson.dutyGroups 数组口径一致。 */
    var dutyList = dutyGroups(lesson);
    var picker = '<div class="lesson-duty-picker" role="group" aria-label="值日组选择">' +
      '<span class="lesson-duty-label" title="点选组号设为值日组，再点取消；可多选">值日</span>' +
      visibleGroups(cls).map(function (g) {
        var on = dutyList.indexOf(g.no) >= 0;
        return '<button type="button" class="duty-swatch' + (on ? ' on' : '') + '" data-duty-no="' + g.no + '"' +
          ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
          ' title="' + (on ? '取消第 ' + g.no + ' 组值日' : '设为第 ' + g.no + ' 组值日') + '">' + g.no + '</button>';
      }).join('') +
      (lesson.dutyNote ? '<span class="lesson-duty-note">' + esc(lesson.dutyNote) + '</span>' : '') +
      '</div>';
    $('#lessonMeta').innerHTML =
      '<div class="lesson-topic-summary" title="' + esc(lesson.topic || '未填写任务') + '">' + esc(lesson.topic || '未填写任务') + '</div>' +
      picker +
      '<div class="btnrow lesson-actions">' +
        '<button class="btn icon-btn" id="btnEditLesson" title="课次设置（任务名 / 值日组 / 日期）">⚙</button>' +
        '<button class="btn icon-btn" id="btnPrintLesson" title="打印 / 导出（本课加分表 · 打印版 PDF · Excel）">🖨</button>' +
      '</div>';
    $('#btnEditLesson').addEventListener('click',function(){openLessonEditor(cls,lesson);});
    $('#btnPrintLesson').addEventListener('click', function () { openLessonPrint(cls, lesson); });
    $$('.lesson-duty-picker .duty-swatch', $('#lessonMeta')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var no = Number(btn.dataset.dutyNo);
        var cur = dutyGroups(lesson).slice();
        var i = cur.indexOf(no);
        if (i >= 0) cur.splice(i, 1);
        else { cur.push(no); cur.sort(function (a, b) { return a - b; }); }
        setLessonDuty(cls, lesson, cur);
        addOperationLog('值日组', cls.name + ' · 第' + lesson.seq + '次课值日组 → ' +
          (cur.length ? cur.map(function (n) { return '第' + n + '组'; }).join('、') : '未设'));
        save();
        renderScore();
      });
    });
    /* V10（2026-11-12）：发布线上排位任务按钮移走。排位任务改在「接线仿真」课堂任务那边发布
       （task.html 已支持），小组加分这里不再提供发布入口；接线仿真发布的任务仍会自动在
       本课生成「线上连线排位」项目列（wire-task-link.js 自动入账机制不变）。 */
  }

  /* ---- 发布线上排位任务（2026-11-11）：小组加分 → 接线仿真课堂任务 ----
     电路清单和接线仿真 task-hx.js 的 CIRCUITS 同一套 id（2.1～2.6 / E1 / E2，
     专项 P 不进课堂任务）。列名「线上连线排位 接线X.X」由 wire-task-link.js 的
     taskColumnName() 生成，这里的任务名只是学生端看到的活动名。 */
  var JF_WIRE_CIRCUITS = [
    { id: '2.1', short: '单向起动' }, { id: '2.2', short: '电气互锁正反转' },
    { id: '2.3', short: '双重互锁正反转' }, { id: '2.4', short: '按钮切换星-三角' },
    { id: '2.5', short: '时间继电器星-三角' }, { id: '2.6', short: '双速电动机' },
    { id: 'E1', short: '联锁正反转能耗制动' }, { id: 'E2', short: 'C6140T 卧式车床' }
  ];
  var wirePubDialog=document.createElement('dialog');wirePubDialog.id='dlgWirePub';wirePubDialog.setAttribute('aria-labelledby','wirePubTitle');
  wirePubDialog.innerHTML='<form id="wirePubForm"><h2 id="wirePubTitle">发布线上排位任务</h2>'+
    '<p class="note">给本节课发一个接线仿真的线上排位任务：学生去「接线仿真」点排位、接对并仿真成功就算完成，分数按名次（前 10 名 100%、11–20 名 80%、其余 70%）实时写进本课的「线上连线排位」项目列。</p>'+
    '<label class="field col">电路<select id="wirePubCir">'+JF_WIRE_CIRCUITS.map(function(c){return '<option value="'+c.id+'">'+esc(c.id+' '+c.short)+'</option>';}).join('')+'</select></label>'+
    '<label class="field col">任务名（可改）<input id="wirePubName" maxlength="60"></label>'+
    '<label class="field col">任务说明（可选）<textarea id="wirePubNote" maxlength="200" placeholder="每人接完并仿真成功，按排位用时给分"></textarea></label>'+
    '<p class="note" id="wirePubInfo"></p>'+
    '<p id="wirePubError" role="alert" class="note"></p>'+
    '<div class="btnrow"><button type="button" class="btn" id="cancelWirePub">取消</button><button type="submit" class="btn primary" id="wirePubGo">发布任务</button></div></form>';
  document.body.appendChild(wirePubDialog);wireDialog(wirePubDialog);
  function openWirePublish(cls, lesson) {
    if (!cls || !lesson) return;
    if (!cls.hxClassId) { flash('这个班还没和首页班级对应上（去名单页点「导入/对应班级」），发布不了线上任务'); return; }
    if (!(CLOUD_ON && CLOUD && typeof CLOUD.rpc === 'function' && CLOUD.profile && CLOUD.profile())) {
      flash('请先登录教师账号，才能发布线上排位任务'); return;
    }
    var cir = $('#wirePubCir'), name = $('#wirePubName'), note = $('#wirePubNote');
    var syncName = function () { if (!name.dataset.touched) name.value = '线上连线排位 · ' + cir.value + ' ' + (JF_WIRE_CIRCUITS.find(function (c) { return c.id === cir.value; }) || {}).short; };
    cir.onchange = syncName; name.oninput = function () { name.dataset.touched = '1'; };
    delete name.dataset.touched; syncName(); note.value = '';
    $('#wirePubInfo').innerHTML = '会写进 <b>第 ' + lesson.seq + ' 次课</b>（' + esc(lesson.date || '日期未填') + ' · ' + esc(lesson.topic || '未填主题') +
      '）的「线上连线排位 接线' + esc(cir.value) + '」列，本课总分满分随之 +5。<br>一个班同时只能有一个进行中的任务；学生端任务榜和大屏最多 15 秒就能看到。';
    $('#wirePubError').textContent = '';
    var go = $('#wirePubGo');
    go.disabled = false; go.textContent = '发布任务';
    $('#cancelWirePub').onclick = function () { wirePubDialog.close(); };
    $('#wirePubForm').onsubmit = function (e) {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true; go.textContent = '发布中…';
      CLOUD.rpc('wire_task_open', {
        p_class: Number(cls.hxClassId), p_circuit: cir.value,
        p_title: name.value.trim() || ('线上连线排位 · ' + cir.value),
        p_note: note.value.trim(),
        p_lesson_no: Number(lesson.seq), p_lesson_date: lesson.date || null
      }).then(function (r) {
        wirePubDialog.close();
        var tname = name.value.trim() || ('线上连线排位 · ' + cir.value);
        addOperationLog('发布线上排位任务', cls.name + ' · 第' + lesson.seq + '次课 · ' + tname + '（任务 #' + ((r && r.id) || '—') + '）');
        save();   /* 日志要落盘：maybeSync 没有变化时不会替我们保存 */
        flash('已发布：学生去接线仿真排位就自动记上，完成率会实时更新到第 ' + lesson.seq + ' 次课「线上连线排位 接线' + cir.value + '」列');
        /* 发布即入账：强制拉一次（绕过 45s 节流），列当场建出来，老师不用等心跳 */
        if (window.JFDT_WIRE) window.JFDT_WIRE.maybeSync(cls, true);
      }).catch(function (err) {
        $('#wirePubError').textContent = (err && err.message) || '发布失败，请检查网络';
        go.disabled = false; go.textContent = '发布任务';
      });
    };
    openDlg(wirePubDialog);
  }

  var lessonEditor=document.createElement('dialog');lessonEditor.id='dlgEditLesson';lessonEditor.setAttribute('aria-labelledby','editLessonTitle');
  lessonEditor.innerHTML='<form id="editLessonForm"><h2 id="editLessonTitle">修改课次</h2><p class="note">更正课次资料，保留本课分数、项目评价和考勤。日期不参与计分。</p><label class="field col">课次序号<input id="editLessonSeq" type="number" min="1" step="1" required></label><label class="field col">上课日期<input id="editLessonDate" type="date" required></label><label class="field col">本节任务<input id="editLessonTopic" maxlength="300"></label><label class="field col">值日组<select id="editLessonDuty" multiple size="4"></select></label><label class="field col">值日提醒（学生端会显示自己组本节课要值日）<input id="editLessonDutyNote" maxlength="60" placeholder="留空则用默认提示"></label><p id="editLessonError" role="alert" class="note"></p><div class="btnrow"><button type="button" class="btn" id="cancelEditLesson">取消</button><button type="submit" class="btn primary">保存修改</button></div></form>';
  document.body.appendChild(lessonEditor);wireDialog(lessonEditor);var editingLessonId=null;
  function openLessonEditor(cls,lesson){editingLessonId=lesson.id;$('#editLessonTitle').textContent=cls.name+' · 修改课次';$('#editLessonSeq').value=lesson.seq;$('#editLessonDate').value=lesson.date||'';$('#editLessonTopic').value=lesson.topic||'';$('#editLessonDutyNote').value=lesson.dutyNote||'';$('#editLessonDuty').innerHTML='<option value="">无</option>'+visibleGroups(cls).map(function(g){return '<option value="'+g.no+'"'+(dutyGroups(lesson).includes(g.no)?' selected':'')+'>第'+g.no+'组</option>';}).join('');$('#editLessonError').textContent='';openDlg(lessonEditor);}
  $('#cancelEditLesson').addEventListener('click',function(){lessonEditor.close();});
  $('#editLessonForm').addEventListener('submit',function(e){e.preventDefault();var lesson=getLesson(editingLessonId);if(!lesson)return;var seq=Number($('#editLessonSeq').value),date=$('#editLessonDate').value,topic=$('#editLessonTopic').value.trim(),dutyNote=$('#editLessonDutyNote').value.trim(),duties=Array.from($('#editLessonDuty').selectedOptions).map(function(o){return Number(o.value);}).filter(Boolean);if(!Number.isInteger(seq)||seq<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)){$('#editLessonError').textContent='请填写有效的课次序号和日期。';return;}if(S.lessons.some(function(l){return l.classId===lesson.classId&&l.id!==lesson.id&&l.seq===seq;})){$('#editLessonError').textContent='本班已有第 '+seq+' 次课，请使用其他序号。';return;}var before='第'+lesson.seq+'次 · '+lesson.date+' · '+(lesson.topic||'未填任务');if(lesson.seq===seq&&lesson.date===date&&(lesson.topic||'')===topic&&(lesson.dutyNote||'')===dutyNote&&JSON.stringify(dutyGroups(lesson))===JSON.stringify(duties)){lessonEditor.close();return;}lesson.seq=seq;lesson.date=date;lesson.topic=topic;lesson.dutyNote=dutyNote;var cls=S.classes.find(function(c){return c.id===lesson.classId;});setLessonDuty(cls,lesson,duties);addOperationLog('修改课次',cls.name+' · '+before+' → 第'+seq+'次 · '+date+' · '+(topic||'未填任务'));save();lessonEditor.close();renderScore();flash('课次资料已修改，分数和考勤已保留');});

  /* ---- 记分控件（卡片视图与表格视图共用，保证两边的操作完全一致） ---- */

  /** 某个计分项在本组的上限 */
  function maxOf(f, maxPhone) {
    return f === 'group' ? 5 : f === 'phone' ? maxPhone : 99;
  }

  /** 值日缺勤（2026-11-12 R1 合并口径）：
      这一格就是原来「干净又卫生」那一列改名而来 —— 整学期只有一个 5 分项目（=100%），
      值日组缺勤时点一下「每人 −20%」，全组每人同扣一档（团队绑定），
      扣分按次叠加（第二次轮到值日再缺勤还能再扣），最低 0%（5 档）。
      2026-11-13：显示层只给本节值日组，学期值仍由这里算（登分册、成绩明细、打印都还在用）。 */
  function dutyPctText(lessons, gno) {
    var A = window.JFDT_ASSESSMENT;
    return pctText((A ? A.dutyScore(lessons, gno) : 5) / 5 * 100);
  }
  /* 值日缺勤格子（2026-11-13 三次返修，用户原话：
       「我不需要设置值日组，他们考勤分都是 100% 一学期一次默认……我只需要根据线下清空
        点击扣分还是双击补分即可啊。所以他就是显示 100%，这个分是一学期就给一次的，
        扣到 0 结束，没有负数。」）
     → 上一轮「只有本节值日组才渲染」把非值日组整格留空，整列只剩第一组一句提示，
       看起来就是「未设值日组」的空块 —— 这才是空块的真正来源，现在改回：
       ① 每一组都常驻显示当前值（默认 100%）+ 一个「缺勤」按钮，扣分不依赖值日组标记；
       ② 单击扣一档（−20%）、双击补一档（+20%），上限 100%、下限 0%，不出负数；
       ③ 「值日组」只当标记用：学生端提醒 + 本格一枚「值日」角标（见 .duty-flag）；
       ④ 规则说明写进使用说明与打印背面，title 只留一句操作提示。 */
  function ctlDuty(gno, isDuty) {
    var cls = curClass();
    var ls = lessonsOf(cls.id);
    var pct = dutyPctText(ls, gno);
    var A = window.JFDT_ASSESSMENT;
    var lost = A && A.dutyLoss ? A.dutyLoss(ls, gno) : 0;
    var left = Math.max(0, 5 - lost);
    return '<div class="duty-cell' + (isDuty ? ' is-duty' : '') + '">' +
      (isDuty ? '<i class="duty-flag">值日</i>' : '') +
      '<b class="duty-pct" title="整学期值日完成率：一学期一次，扣到 0% 为止' + (lost ? '（本组已扣 ' + lost + ' 档）' : '') + '">' + pct + '</b>' +
      '<button type="button" class="duty-score' + (isDuty ? ' is-duty' : '') + '" data-duty-deduct="' + gno + '" ' +
      'title="单击：全组每人值日缺勤 −20%（还剩 ' + left + ' 档）；双击：加回一档" ' +
      'aria-label="第' + gno + '组值日缺勤：单击扣一档，双击加回一档">缺勤</button>' +
      '</div>';
  }

  function semesterBadge(cls,gno,index) {
    return '';
  }

  /* 本节合计（2026-11-12 R1）：按完成率百分比显示 =（Σ个人项目分 − 本节扣分）÷（5×已命名项目数）；
     不再有「每节课送 5 分」，值日缺勤是整学期一次的项目，不摊进单节课 */
  function lessonMemberTotals(cls,lesson,g){return '<div data-member-lesson-totals="'+g.no+'">'+g.members.map(function(m,i){if(!m.name)return '';return '<div class="home-grade-person" data-lesson-member="'+i+'" title="'+esc(m.name)+'"><strong>'+memberLessonRateText(lesson,g.no,m,i)+'</strong></div>';}).join('')+'</div>';}
  function ctlSum(gno, total, cumVal) {
    return '<div hidden class="legacy-group-total v '+signClass(total)+'" data-total="'+gno+'">'+fmt(total)+'</div>'+lessonMemberTotals(curClass(),curLesson(curClass()),groupOf(curClass(),gno));

  }

  /* 考勤格显示层（2026-11-09）：8、9 分值改按 (9−累计扣分)/9 完成率百分比显示；存储仍是 9 分制 */
  function attendanceCell(cls,lesson,g,printing){var A=window.JFDT_ASSESSMENT,rows=A.rows(cls,lessonsOf(cls.id),memberTotals(cls));return '<td rowspan="2" class="home-attendance">'+g.members.filter(function(m){return !!m.name;}).map(function(m,i){var k=A.key(m),row=rows.find(function(r){return r.key===k;}),score=row?row.attendance:9;return '<div class="home-attendance-person compact"><span>'+(i+1)+'</span>'+(printing?'<strong>'+attPctText(score)+'</strong>':'<button type="button" class="attendance-score" data-attendance-open="'+esc(k)+'" aria-label="成员'+(i+1)+' '+esc(m.name)+' 考勤完成率 '+attPctText(score)+'，点击修改">'+attPctText(score)+'</button>')+'</div>';}).join('')+'</td>';}
  var attendanceDialog=document.createElement('dialog');attendanceDialog.id='dlgHomeAttendance';attendanceDialog.setAttribute('aria-labelledby','homeAttendanceTitle');attendanceDialog.innerHTML='<form id="homeAttendanceForm"><h2 id="homeAttendanceTitle">考勤</h2><label class="field col">本课状态<select id="homeAttendanceStatus"></select></label><label class="field col">本次扣分<input id="homeAttendanceLoss" type="number" min="0" max="100" step="1" required></label><p class="note">扣分只影响考勤分；迟到早退折算仅用于挂科标记，不再次扣分。</p><button type="button" class="linkbtn" id="homeAttendanceRules">考勤扣分与挂科设置</button><div class="btnrow"><button type="button" class="btn" id="cancelHomeAttendance">取消</button><button class="btn primary" type="submit">保存</button></div></form>';document.body.appendChild(attendanceDialog);wireDialog(attendanceDialog);var attendanceEdit=null;
  $('#groupList').addEventListener('click',function(e){var button=e.target.closest('[data-attendance-open]');if(!button)return;var cls=curClass(),lesson=curLesson(cls),A=window.JFDT_ASSESSMENT;if(!lesson)return;var key=button.dataset.attendanceOpen,member=A.roster(cls,memberTotals(cls)).find(function(m){return m.key===key;}),cfg=A.settings(cls),record=lesson.attendance&&lesson.attendance[key],opts=[['present','到课'],['leave','请假'],['truant','旷课'],['late','迟到'],['early','早退']].concat(cfg.customRules.map(function(r){return [r.id,r.name];}));if(record&&!opts.some(function(o){return o[0]===record.status;}))opts.push([record.status,record.label]);attendanceEdit={key:key,lessonId:lesson.id,classId:cls.id};$('#homeAttendanceTitle').textContent=member.name+' · 第'+lesson.seq+'次课';$('#homeAttendanceStatus').innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'"'+((record?record.status:'present')===o[0]?' selected':'')+'>'+esc(o[1])+'</option>';}).join('');$('#homeAttendanceLoss').value=record?record.loss:0;$('#homeAttendanceLoss').disabled=!record;openDlg(attendanceDialog);});
  $('#homeAttendanceStatus').addEventListener('change',function(){var cls=curClass();$('#homeAttendanceLoss').disabled=!this.value;$('#homeAttendanceLoss').value=this.value?window.JFDT_ASSESSMENT.deduction(this.value,window.JFDT_ASSESSMENT.settings(cls)):0;});
  $('#cancelHomeAttendance').addEventListener('click',function(){attendanceDialog.close();});
  $('#homeAttendanceRules').addEventListener('click',function(){attendanceDialog.close();switchView('attendance');var settings=$('.assessment-settings');if(settings)settings.open=true;});
  $('#homeAttendanceForm').addEventListener('submit',function(e){e.preventDefault();var edit=attendanceEdit,cls=curClass(),lesson=curLesson(cls),A=window.JFDT_ASSESSMENT;if(!edit||!lesson||edit.lessonId!==lesson.id||edit.classId!==cls.id)return;var status=$('#homeAttendanceStatus').value,loss=Number($('#homeAttendanceLoss').value);if(!Number.isInteger(loss)||loss<0||loss>100)return;var old=lesson.attendance&&lesson.attendance[edit.key];if((old?old.status:'present')===status&&(!old?loss===0:old.loss===loss)){attendanceDialog.close();return;}var option=$('#homeAttendanceStatus').selectedOptions[0],member=A.roster(cls,memberTotals(cls)).find(function(m){return m.key===edit.key;});if(!lesson.attendance)lesson.attendance={};if(status)lesson.attendance[edit.key]={status:status,label:option.textContent,loss:loss,updatedAt:new Date().toISOString()};else delete lesson.attendance[edit.key];addOperationLog('考勤',cls.name+' · 第'+lesson.seq+'次 · '+member.name+'：'+(old?old.label+' 扣'+old.loss:'默认到课')+' → '+(status?option.textContent+' 扣'+loss:'默认到课'));save();attendanceDialog.close();renderGroups(cls,lesson);flash('考勤已保存');});
  function lessonsThrough(cls,lesson){return lessonsOf(cls.id).filter(function(item){return item.seq<=lesson.seq;});}
  function attendanceNameClass(cls,m,lesson){var A=window.JFDT_ASSESSMENT,ls=lesson?lessonsThrough(cls,lesson):lessonsOf(cls.id),r=A.rows(cls,ls,memberTotals(cls)).find(function(r){return r.key===A.key(m);});return r&&r.attendanceFailed?' attendance-failed':'';}

  function homeGradeHead(){return '<th rowspan="2" class="home-grade regular">平时分<br>（至今完成率）</th><th rowspan="2" class="home-grade contribution">计入总评<br>/40</th><th rowspan="2" class="home-grade needed">期末至少需考<br>/100</th>';}
  function homeGradeCells(cls,g,lesson){
    var A=window.JFDT_ASSESSMENT;if(!A)return '<td rowspan="2" colspan="3">成绩模块未加载</td>';
    var rows=A.rows(cls,lesson?lessonsThrough(cls,lesson):lessonsOf(cls.id),memberTotals(cls));
    var members=g.members.filter(function(m){return !!m.name;}).map(function(m,i){return {member:m,index:i+1,row:rows.find(function(r){return r.key===A.key(m);})};});
    return ['regular','contribution','needed'].map(function(field){return '<td rowspan="2" class="home-grade '+field+'" data-home-grade="'+field+'">'+members.map(function(item){var m=item.member,r=item.row;if(!r)return '';var value=field==='needed'?(r.attendanceFailed?'不适用':r.needed>100?'无法达到':r.needed):r[field];return '<div class="home-grade-person" data-grade-student="'+esc(r.key)+'" title="'+esc(m.name)+'：'+(r.ready?'记录已齐':'预估，项目或考勤记录未齐')+'"><strong>'+value+(field==='regular'?' <span class="completion-rate">（'+(r.totalMaximum?Math.round(r.performanceRate*1000)/10+'%':'—')+'）</span>':'')+'</strong>'+(r.attendanceFailed?'<small>考勤挂科</small>':'')+'</div>';}).join('')+'</td>';}).join('');
  }

  /** 某成员本节剩余可扣的项目分（5 分制）：5 − 手机未入袋次数 − 本人已扣分。
      底层数据函数：undo/redo（applyEffect 的 point: 分支）、全组扣分（changeMemberPoints）都依赖它。 */
  function remaining(lesson,gno,i){var s=sc(lesson,gno);return Math.max(0,5-(+s.phone||0)-(+s.personal[String(i)]||0));}

  function ctlClear(gno, compact) {
    return '<button class="mini" data-cleargroup="' + gno + '" type="button" title="把本组这节课的分数全部归零">' +
      (compact ? '↺' : '↺ 清零') + '</button>';
  }

  var groupPicking = null;
  function mountGroupPicker(cls,lesson){
    if(groupPicking&&(groupPicking.classId!==cls.id||groupPicking.lessonId!==lesson.id))groupPicking=null;
    cls.groups.forEach(function(g){
      var card=$('[data-card="'+g.no+'"]');if(!card)return;
      var unlocked=groupPicking&&groupPicking.no===g.no;
      var target=scoreLayout==='table'?card.querySelector('.c-no'):card.querySelector('.group-identity');
      target.classList.add('group-pick-toggle');target.title=unlocked?'双击组号结束分组编辑':'双击组号编辑分组';target.tabIndex=0;target.setAttribute('aria-label','第'+g.no+'组，'+target.title);
      function toggleGroup(e){e.preventDefault();e.stopPropagation();groupPicking=unlocked?null:{classId:cls.id,lessonId:lesson.id,no:g.no};renderGroups(cls,lesson);}
      target.ondblclick=toggleGroup;target.onkeydown=function(e){if(e.key==='Enter')toggleGroup(e);};
      if(unlocked){var done=document.createElement('button');done.type='button';done.className='btn tiny';done.textContent='完成';done.onclick=toggleGroup;target.appendChild(done);if(scoreLayout==='table'){var clear=document.createElement('button');clear.type='button';clear.className='btn tiny';clear.textContent='清零本组';clear.dataset.cleargroup=g.no;target.appendChild(clear);}}
      if(!unlocked)return;
      /* 以前这里「满 7 人就整个不挂控件」，老师看到组号双击后什么都没有，只能以为分组坏了。
         现在满员也照常展开：加人/减人是老师的手动决定，只受这个组自己的上限约束（见 groupCap）。 */
      var slot=scoreLayout==='table'?card.querySelector('[data-group-picker-slot]'):card.querySelector('.gnames');
      if(!slot){target.title='这里放不下加人控件，请到「待分配名单」页调整';return;}
      var box=document.createElement('div');box.className='group-pick-box';
      box.innerHTML='<span class="group-pick-count">本组 <b>'+memberCount(g)+'</b>/'+groupCap(g,cls)+' 人'+(Number(g.cap)?'（特许）':'')+'</span>'+
        '<button type="button" class="btn tiny" data-pick-minus aria-label="第'+g.no+'组移出成员">－ 减人</button>'+
        '<div data-pick-editor hidden><input type="search" autocomplete="off" aria-label="第'+g.no+'组检索学号" placeholder="学号或后两位"><div class="group-pick-results" role="list"></div><button type="button" class="btn tiny" data-pick-exit>退出选人</button></div>'+
        '<div data-pick-members hidden></div>';
      slot.appendChild(box);
      var editor=box.querySelector('[data-pick-editor]'),input=box.querySelector('input'),results=box.querySelector('.group-pick-results'),members=box.querySelector('[data-pick-members]');

      async function addMember(r){
        if(!groupPicking||groupPicking.no!==g.no||curClass().id!==cls.id)return;
        if(!pendingList(cls).some(function(p){return p===r;})){matches();return;}
        var capBefore=groupCap(g,cls);
        /* 老师点「＋加人」把人塞进已经满员的组：以前是悄悄把 g.cap 改成实际人数，
           等于替他做了「这组特例」的决定。2026-11-08 起改成先问一句 ——
           用户要求「是否允许该组特殊情况设置7人这样的情况」必须由老师自己确认。 */
        if(memberCount(g)>=capBefore){
          var allowOver = await askConfirm({
            title:'第'+g.no+'组已经满员',
            body:'现在是 '+memberCount(g)+'/'+capBefore+' 人，已经到每组上限。\n'+
              '再放一个就超员了。要把第'+g.no+'组设为例外（'+(memberCount(g)+1)+' 人）吗？',
            note:'确定 = 这一组特例放行，不再标红；取消 = 不放人，先移出一个再放',
            ok:'设为例外'
          });
          if(!allowOver){ matches();return; }
        }
        pushMember(g,{id:uid('m'),name:r.name,sid:r.sid||'',no:studentNo(cls,r.name,r.sid)});
        var reback=repairOrphansAfterAssign(cls);
        var over=memberCount(g)>capBefore;
        if(over)g.cap=memberCount(g);   // 老师刚确认过，这里才写「特许 N 人」
        addOperationLog('分组',cls.name+' · '+r.name+'加入第'+g.no+'组'+(over?'（特许 '+g.cap+' 人）':''));
        save();renderScore();renderPoolBanner(cls);
        flash('已加入第'+g.no+'组'+(over?'，本组特许 '+g.cap+' 人':'')+'，分组已全局同步'+(reback?'，接回他名下历史分 '+reback+' 条':''));
      }

      function dropMember(i){
        var m=g.members[i];if(!m||!m.name)return;
        /* 个人扣分是按「组内位置」存在每课 scores[组].personal 里的，必须走 removeMemberAt
           让它把后面成员的索引左移，自己 splice 会让整组人的扣分错位。 */
        removeMemberAt(cls,g,i);
        addOperationLog('分组',cls.name+' · '+m.name+'移出第'+g.no+'组');
        save();renderScore();renderPoolBanner(cls);
        flash('已把「'+m.name+'」移出第'+g.no+'组，回到待分配名单');
      }

      function matches(){var query=input.value.trim().toLowerCase(),pending=pendingList(cls),list=pending.filter(function(r){return !query||String(r.sid||'').includes(query)||r.name.toLowerCase().includes(query);});results.innerHTML='';if(!list.length){results.textContent='没有匹配的待分配成员';return;}list.forEach(function(r){var button=document.createElement('button');button.type='button';button.className='btn tiny';button.textContent=r.name+' '+(r.sid||'');button.setAttribute('data-pick-sid',r.sid||'');button.onclick=function(e){e.stopPropagation();addMember(r);};results.appendChild(button);});}

      function showRemoval(){
        editor.hidden=true;results.innerHTML='';members.hidden=false;members.innerHTML='';
        var entries=groupMemberEntries(g);
        if(!entries.length){members.textContent='这个组还没有人';return;}
        entries.forEach(function(en){
          var b=document.createElement('button');b.type='button';b.className='btn tiny danger';
          b.setAttribute('data-drop-index',en.i);b.textContent=en.m.name+' ×';
          b.onclick=function(e){e.stopPropagation();dropMember(en.i);};
          members.appendChild(b);
        });
      }

      box.onclick=function(e){e.stopPropagation();};
      box.querySelector('[data-pick-minus]').onclick=function(){showRemoval();};
      input.oninput=matches;
      box.querySelector('[data-pick-exit]').onclick=function(){groupPicking=null;renderGroups(cls,lesson);};
    });
  }
  function renderGroups(cls, lesson) {
    var host = $('#groupList');
    host.innerHTML = scoreLayout === 'table'
      ? groupsTable(cls, lesson)
      : groupsCards(cls, lesson);
    mountGroupPicker(cls,lesson);
    $$('[data-leader-toggle]',host).forEach(function (el) {
      el.ondblclick=function(e){e.preventDefault();e.stopPropagation();var g=groupOf(cls,+el.dataset.g),m=g&&g.members[+el.dataset.memberIndex];if(g&&m)setGroupLeader(cls,g,m);};
    });
    /* 2026-11-13 修「点别的列却弹出成绩明细」：本节完成率那一格（data-home-grade="sum"）
       自己有悬浮明细面板（见 showSumDetail），不能再挂这个「截至第 N 次课完成率明细」弹窗，
       否则两套明细互相抢、还会让人以为点错了列。这里只给后三列成绩挂弹窗。 */
    $$('td.home-grade[data-home-grade]:not([data-home-grade="sum"])',host).forEach(function(cell){var person=$('[data-grade-student]',cell);if(!person)return;cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',(cell.title||'')+'：查看分数明细');cell.onclick=function(){showStudentGrade(cls,person.dataset.gradeStudent,lesson);};cell.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();cell.click();}};});
  }

  function showStudentGrade(cls,key,throughLesson){
    closeSumDetail();   // 悬浮窗互斥（2026-11-13）：先收起「本节详情」浮层，同一时刻只留一个
    var A=window.JFDT_ASSESSMENT,ls=(throughLesson?lessonsThrough(cls,throughLesson):lessonsOf(cls.id)).slice().sort(function(a,b){return a.seq-b.seq;}),student=A.rows(cls,ls,memberTotals(cls)).find(function(m){return m.key===key;});if(!student)return;
    var dialog=$('#studentGradeDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='studentGradeDialog';dialog.className='student-grade-dialog';document.body.appendChild(dialog);}
    var dutyPct=dutyPctText(ls,student.gno);
    var detail=ls.map(function(l){var net=A.lessonNet(l,student.gno,student.memberIndex,key),a=l.attendance&&l.attendance[key],names=A.projectNames(l),record=l.leaderScores&&l.leaderScores[String(student.gno)],values=record&&record.members&&record.members[key],projects=names.map(function(n,i){return String(n||'').trim()?esc(n)+'：'+(values&&values[i]!=null?scorePctText(values[i]):'未填'):'';}).filter(Boolean);
      /* 2026-11-13 用户原话：「满分 300% 本人扣 −0% 实得 100% 谁能看懂 以为是扣分了呢，本节项目与扣分可以删掉」
         → 整列删掉，右端「本节完成率」本来就是最终值；考勤只在真扣了分时才显示扣多少，不再出现「−0%」。 */
      var attLoss=+((a&&Number(a.loss))||0);
      return '<tr><td>第'+l.seq+'次<br>'+esc(l.date||'')+'<br>'+esc(l.topic||'')+'</td><td>'+ (projects.join('<br>')||'无命名项目')+'</td><td>'+esc(a?a.label||a.status:'正常到课')+(attLoss>0?'<br>−'+pctText(attLoss/9*100):'')+'</td><td><b>'+(net.max?pctText(Math.max(0,net.earned)/net.max*100):'—')+'</b></td></tr>';
    }).join('');
    dialog.innerHTML='<div class="student-grade-heading"><h2>'+esc(student.name)+' · 截至第'+throughLesson.seq+'次课完成率明细</h2><button type="button" class="btn" data-close-grade>关闭</button></div><p>'+esc(cls.name)+' · '+esc(student.sid||'')+'</p><p>项目完成率 <b>'+Math.round(student.task.earned*100)/100+' / '+student.task.maximum+'</b>（'+Math.round(student.task.rate*1000)/10+'%）；值日完成率 <b>'+dutyPct+'</b>；考勤完成率 <b>'+attPctText(student.attendance)+'</b>（'+student.attendance+'/9）；平时分 <b>'+student.regular+'</b>/100；计入总评 '+student.contribution+'/40。</p><div class="student-grade-scroll"><table class="data"><thead><tr><th>课次</th><th>个人项目</th><th>考勤</th><th>本节完成率</th></tr></thead><tbody>'+detail+'</tbody></table></div>';
    $('[data-close-grade]',dialog).onclick=function(){dialog.close();};if(!dialog.open)openDlg(dialog);
  }

  function groupsCards(cls, lesson) {
    var gs = visibleGroups(cls);
    if (!gs.length) return '<p class="empty-hint">这个班还没有分好组（或者组里一个人都没有）。到「待分配名单」点「分组…」分一下，分好组这里就能记分了。</p>';
    /* 2026-11-13：值日块只给本节值日组画。整节课一个值日组都没设时，
       只在第一张卡片上留一句提示——否则表格里没有任何可点的地方，老师会以为功能坏了。 */
    var dutyList = dutyGroups(lesson);
    return '<div class="groups">' + gs.map(function (g) {
      var s = sc(lesson, g.no);
      var total = groupTotal(lesson, g.no);
      var duty = dutyList.includes(g.no);
      var cnt = memberCount(g);
      var cap = groupCap(g, cls), over = cnt > cap;   // 超载：人数超过上限，整张卡片标红提示老师去拖动换组
      var maxPhone = 1000000;
      var memberEntries = groupMemberEntries(g);
      var names = cnt
        ? memberEntries.map(function (entry) { var m=entry.m,i=entry.i;return '<span class="member-name'+attendanceNameClass(cls,m,lesson)+(isGroupLeader(g,m)?' group-leader-name':'')+'" data-leader-toggle data-g="'+g.no+'" data-member-index="'+i+'" title="双击设置或退出组长">' + (isGroupLeader(g,m)?'<span class="leader-crown" aria-label="组长">👑</span> ':'') + esc(m.name) + semesterBadge(cls,g.no,i) + '</span>'; }).join('')
        : '<span style="color:var(--muted);font-weight:400">（未录入名单）</span>';

      return '' +
      '<div class="gcard' + (duty ? ' is-duty' : '') + (touched(lesson, g.no) ? ' touched' : '') + (over ? ' is-over' : '') + '" data-card="' + g.no + '">' +
        '<div class="gcard-head">' +
          '<div class="group-identity"><span class="gnum">第 ' + g.no + ' 组</span>' +
            '<span class="gcount' + (over ? ' over' : '') + '" title="' + (over ? '本组 ' + cnt + ' 人，超过上限 ' + cap + ' 人：到「分组」页把超出的 ' + (cnt - cap) + ' 人拖到别的组（不会被自动移出）' : '本组人数 / 上限（双击组号可加人减人）') + '">' + cnt + '/' + cap + '</span>' +
            (duty ? '<span class="dutytag">值日</span>' : '') + '</div>' +
          '<div class="gsum"><span class="k">本节</span>' +
            '<div class="v ' + signClass(total) + '" data-total="' + g.no + '">' + fmt(total) + '</div></div>' +
        '</div>' +
        '<div class="gnames">' + names + '</div>' +
        '<div class="gcard-secondary"><span class="card-feedback-space" aria-hidden="true"></span>' + ctlClear(g.no, false) + '</div>' +
        /* 2026-11-13 三次返修：每一组都常驻这一格（默认 100%），不再按值日组留空 */
        '<div class="gctl"><div><div class="lbl">值日缺勤</div>' + ctlDuty(g.no, duty) + '</div></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /** 表格式（2026-11-12 值日缺勤改革 + V4/V8 列精简）：8 列版式
      组号 + 成员（含个人扣分）+ 值日缺勤（整学期 5 分，原「干净又卫生」并入这里 + 考勤完成率 + 本节完成率 + 三列成绩
      V4：删「课堂任务」列（课堂任务分已包含在「本节完成率」里，用户：课堂任务列和本节完成率列是包含关系）；
      V8：删「全组扣分」列（用户已确认，手机未入袋全组扣分功能整体移除）。 */
  function verticalColumns(cls){
    // CJK text needs one em; Latin letters and digits need roughly half an em.
    function width(text){return Array.from(String(text)).reduce(function(n,ch){return n+(/[^\x00-\xff]/.test(ch)?15:8);},0);}
    /* 2026-11-13 用户：「表格单元格很宽不需要这么宽」。
       表头是允许折行的（th 是 white-space:normal），所以最小列宽应该按「最长的一段」算，
       不能按整串字宽算：原来「期末至少需考 /100」按一行 130px 算，再叠 28px 内边距，
       单这一列就分走 18% 的表格宽度，屏幕上量到 245px。
       现在把「空格 / 斜杠 / 顿号 / 括号」都当折行点，一段一段取最大值，再留 16px 内边距
       （真实 th 内边距 2×3px + 边框 2px，留 16 已经很宽）。 */
    function headWidth(text){
      return String(text).split(/[\s/（）()、，,]+/).reduce(function(n,part){return Math.max(n,width(part));},0);
    }
    var labels=['组号','成员','值日缺勤','考勤完成率','本节完成率','（至今完成率）','计入总评 /40','期末至少需考 /100'];
    /* 列的顺序：组号 / 成员 / 值日缺勤 / 考勤完成率 / 本节完成率 / 平时分 / 计入总评 / 期末至少需考。
       后六列原来各留 94~172 的「保底宽度」，加起来把表格顶到 1400px 以上；
       这里按内容（表头最长一段 + 内边距）重定保底，记分表才收得回来。 */
    var minima=[46,126,72,80,80,84,78,92];
    var widths=labels.map(function(t,i){return Math.max(minima[i],headWidth(t)+16);});
    (cls.groups||[]).forEach(function(g){(g.members||[]).forEach(function(m){if(m.name)widths[1]=Math.max(widths[1],width(m.name+' '+(m.no||''))+36);});});
    var total=widths.reduce(function(a,b){return a+b;},0),names=['no','mem','duty','attendance','sum','grade','grade','grade'];
    return widths.map(function(w,i){return '<col class="w-'+names[i]+'" data-content-width="'+w+'" style="width:'+(100*w/total).toFixed(4)+'%!important">';}).join('');
  }
  /* 表头 title 只留一句操作提示：整段规则说明不挂在表格上反复出现（用户：「无需显示出来 我知道规则」） */
  function verticalHead(){return '<thead><tr><th class="c-no">组号</th><th class="c-mem">成员</th><th class="c-duty" title="每一组都能点：单击全组每人 −20%（一学期 5 档，扣到 0% 为止），双击加回一档；带「值日」角标的是本节值日组">值日缺勤</th><th class="home-attendance" title="每人考勤完成率，点数字可改">考勤完成率</th><th class="c-sum">本节完成率</th><th class="home-grade regular">平时分<br>（至今完成率）</th><th class="home-grade contribution">计入总评 /40</th><th class="home-grade needed">期末至少需考 /100</th></tr></thead>';}
  function verticalGroup(cls,lesson,g,printing){
    var A=window.JFDT_ASSESSMENT,gradeLessons=lessonsThrough(cls,lesson),grades=A.rows(cls,gradeLessons,memberTotals(cls)),dutyList=dutyGroups(lesson),isDuty=dutyList.includes(g.no);
    var entries=groupMemberEntries(g),editing=!printing&&groupPicking&&groupPicking.classId===cls.id&&groupPicking.lessonId===lesson.id&&groupPicking.no===g.no;
    var gcap=groupCap(g,cls),over=entries.length>gcap;   // 超载：人数超过上限，整组标红提示老师去拖动换组
    var display=entries.length?entries:[{m:null,i:-1}],span=display.length+(editing?1:0),rows=display.map(function(x,j){var m=x.m,i=x.i,key=m&&A.key(m),grade=m&&grades.find(function(r){return r.key===key;}),total=m?memberLessonRateText(lesson,g.no,m,i):'';
      var out='<tr class="vertical-member-row"'+(m?' data-member-index="'+i+'" data-member-key="'+esc(key)+'"':'')+'>';
      if(!j)out+='<td class="c-no" rowspan="'+span+'"><span class="gno-swatch" style="'+gbTone(g.no,0)+'">'+g.no+'</span></td>';
      out+='<td class="c-mem member-name-cell'+(m?attendanceNameClass(cls,m,lesson):'')+(m&&isGroupLeader(g,m)?' group-leader-name':'')+'"'+(m?' data-leader-toggle data-g="'+g.no+'" data-member-index="'+i+'"':'')+' title="'+esc(m?(m.name+' '+(m.sid||'')+' · 双击设置或退出组长'):'双击组号添加成员')+'">'+(m?(isGroupLeader(g,m)?'<span class="leader-crown" aria-label="组长">👑</span> ':'')+esc(m.name)+(m.no==null?'':' <small>'+two(m.no)+'</small>'):'未分配成员')+'</td>';
      /* 这一格永远保留 <td>（rowspan 列数不能动）。2026-11-13 三次返修：
         屏幕上每一组都显示当前值 + 扣分按钮（默认 100%，扣到 0% 为止，没有负数）；
         「值日组」只多一枚角标，不影响能不能扣。打印版仍只给当天值日组印学期值，别的组留白。 */
      if(!j){
        var dutyHtml=printing?(isDuty?'<b class="duty-pct">'+dutyPctText(lessonsOf(cls.id),g.no)+'</b>':''):ctlDuty(g.no,isDuty);
        out+='<td class="c-duty'+(isDuty?' is-duty':'')+'" rowspan="'+span+'">'+dutyHtml+'</td>';
      }
      out+='<td class="home-attendance">'+(grade?(printing?'<strong>'+attPctText(grade.attendance)+'</strong>':'<button type="button" class="attendance-score" data-attendance-open="'+esc(key)+'" aria-label="'+esc(m.name)+' 考勤完成率 '+attPctText(grade.attendance)+'，点击修改">'+attPctText(grade.attendance)+'</button>'):'')+'</td>';
      out+='<td class="c-sum" data-home-grade="sum" data-sum-g="'+g.no+'" data-sum-i="'+i+'"'+(m?' data-grade-student="'+esc(key)+'"':'')+' title="'+esc(m?m.name+' · 点击展开本节各项目完成率明细':'')+'"><div class="home-grade-person" data-member-lesson-totals="'+g.no+'" data-lesson-member="'+i+'"><strong>'+total+'</strong><span class="sumd-cue" aria-hidden="true">▾</span></div></td>';
      ['regular','contribution','needed'].forEach(function(field){var value=grade?(field==='needed'?(grade.attendanceFailed?'不适用':grade.needed>100?'无法达到':grade.needed):grade[field]):'';out+='<td class="home-grade '+field+'" data-home-grade="'+field+'" title="'+esc(m?m.name:'')+'">'+(grade?'<div class="home-grade-person" data-grade-student="'+esc(key)+'"><strong>'+value+(field==='regular'?' <span class="completion-rate">（'+(grade.totalMaximum?Math.round(grade.performanceRate*1000)/10+'%':'—')+'）</span>':'')+'</strong>'+(grade.attendanceFailed?'<small>考勤挂科</small>':'')+'</div>':'')+'</td>';});
      return out+'</tr>';
    }).join('');
    if(editing)rows+='<tr class="group-pick-row"><td colspan="2" data-group-picker-slot></td><td colspan="6"></td></tr>';
    return '<tbody '+(printing?'data-pg':'data-card')+'="'+g.no+'" class="'+(dutyGroups(lesson).includes(g.no)?'is-duty ':'')+(touched(lesson,g.no)?'touched ':'')+(over?'is-over':'')+'">'+rows+'</tbody>';
  }
  function groupsTable(cls,lesson){var gs=visibleGroups(cls);if(!gs.length)return '<p class="empty-hint">这个班还没有分好组（或者组里一个人都没有）。到「待分配名单」点「分组…」分一下，分好组这里就有记分表。</p>';return '<div class="sheetwrap"><table class="sheet sheet-vertical"><colgroup>'+verticalColumns(cls)+'</colgroup>'+verticalHead()+gs.map(function(g){return verticalGroup(cls,lesson,g,false);}).join('')+'</table></div>';}

  function renderMetrics(cls, lesson) {
    var ls = lessonsOf(cls.id);
    /* 组数一律用「实际有人的组」（visibleGroups），不然模板残留的空组会把
       「已记分 5 / 13 组」算歪，老师会以为还有 8 组没记。 */
    var gs = visibleGroups(cls);
    var done = 0, best = null;
    gs.forEach(function (g) {
      var t = groupTotal(lesson, g.no);
      if (touched(lesson, g.no)) done++;
      if (best === null || t > best.t) best = { no: g.no, t: t };
    });
    var ranked = gs.map(function (g) { return { no: g.no, t: groupCum(cls, g.no) }; })
      .sort(function (a, b) { return b.t - a.t; });
    var lead = ranked[0] || { no: '-', t: 0 };
    var leaders = ranked.filter(function (r) { return r.t === lead.t; });
    var allZero = ranked.every(function (r) { return r.t === 0; });
    var bestCount = best ? gs.filter(function(g){ return groupTotal(lesson,g.no) === best.t; }).length : 0;
    /* 显示层（2026-11-12）：小组口径按成员项目净分的平均折完成率——本节 ÷5，累计 ÷(5×有项目的课次数) */
    var lessonGroupMax = 5;
    var cumGroupMax = 5 * groupLessonSpan(ls);
    var leadPct = pctText(Math.max(0, lead.t) / cumGroupMax * 100);
    var leadText = allZero ? '暂无领先' : leaders.length > 1
      ? '并列领先 <small>' + (leaders.length <= 3 ? leaders.map(function(r){return '第' + r.no + '组';}).join('、') : leaders.length + '个小组') + ' · ' + leadPct + '</small>'
      : '第 ' + lead.no + ' 组 <small>' + leadPct + '</small>';

    $('#scoreMetrics').innerHTML =
      '<div class="metric"><div class="k">已记分小组</div><div class="v">' + done +
        ' <small>/ ' + gs.length + ' 组</small></div></div>' +
      '<div class="metric"><div class="k">本节最高</div><div class="v ' + signClass(best ? best.t : 0) + '">' +
        (best && done ? pctText(Math.max(0, best.t) / lessonGroupMax * 100) + ' <small>' + (bestCount > 1 ? bestCount + '组并列' : '第 ' + best.no + ' 组') + '</small>' : '—') + '</div></div>' +
      '<div class="metric"><div class="k">累计领先</div><div class="v' + (allZero ? '' : ' good') + '">' + leadText + '</div></div>' +
      '<div class="metric"><div class="k">已记录课次</div><div class="v">' + ls.length + ' <small>次</small></div></div>';
  }

  function refreshCard(cls, lesson, gno) {
    if(scoreLayout==='table'){renderGroups(cls,lesson);return;}
    var card = $('[data-card="' + gno + '"]');
    if (!card) return;
    var s = sc(lesson, gno);
    var t = groupTotal(lesson, gno);
    var v = $('[data-total="' + gno + '"]', card);
    v.textContent = fmt(t);
    v.className = 'legacy-group-total v ' + signClass(t);var memberTotalsEl=$('[data-member-lesson-totals]',card);if(memberTotalsEl)memberTotalsEl.outerHTML=lessonMemberTotals(cls,lesson,groupOf(cls,gno));var gradeCells=$$('[data-home-grade]',card);if(gradeCells.length){var holder=document.createElement('tr');holder.innerHTML=homeGradeCells(cls,groupOf(cls,gno),lesson);gradeCells.forEach(function(cell,i){cell.innerHTML=holder.children[i].innerHTML;});}
    
    var totals=memberTotals(cls);
    $$('[data-semester-group]',card).forEach(function(el){var member=cls.groups.find(function(g){return g.no===gno;}).members[+el.dataset.semesterIndex];var total=totals.find(function(m){return m.gno===gno && m.name===member.name && m.sid===member.sid;});el.querySelector('b').textContent=fmt(total?total.total:0);});
    /* 值日格子随值日组标记一起刷新（ctlDuty 现在每一组都有内容） */
    var dutyCell=$('.duty-cell',card),dutyHtml=ctlDuty(gno,dutyGroups(lesson).includes(gno));if(dutyCell&&dutyHtml)dutyCell.outerHTML=dutyHtml;
    card.classList.toggle('touched', touched(lesson, gno));
    $$('.num', card).forEach(function (inp) {
      var f = inp.dataset.f;
      inp.value = (+s[f] || 0);
      if (f === 'phone') inp.classList.toggle('neg', (+s.phone || 0) > 0);
    });
    var tg = $('[data-act="first"]', card);
    if(tg){tg.classList.toggle('on', !!s.first);tg.textContent='✓';tg.setAttribute('aria-pressed',String(!!s.first));}
  }

  /* 值日缺勤（2026-11-12 R1）：值日组这一格点一下 = 全组每人值日缺勤 −20%（整学期 5 分项目，1 档 = 1 分）。
     记在本课 scores[组].dutyAbsent 上（按次叠加、可撤销、可跨课累计），学期值 = 5 − 累计档数。
     扣分落在个人分数：全组每人同扣（团队绑定，要扣都扣）。 */
  function deductDuty(cls,lesson,gno,dir){
    var s=sc(lesson,gno), old=Number(s.dutyAbsent)||0;
    var A=window.JFDT_ASSESSMENT, ls=lessonsOf(cls.id);
    var lost=A&&A.dutyLoss?A.dutyLoss(ls,gno):0;
    /* 整学期一共 5 档（100% → 0%）：扣到底就停，永远不出现负数/负百分比 */
    if(dir>0 && lost>=5){flash('第'+gno+'组值日缺勤已经是 0%，扣不动了');return;}
    var neu=dir<0?Math.max(0,old-1):old+1;
    if(neu===old){flash('这一组本课没有可加回的值日缺勤了，不用再点');return;}
    s.dutyAbsent=neu;
    pushUndo({lessonId:lesson.id,gno:gno,f:'dutyAbsent',old:old,neu:neu,label:dir<0?'值日缺勤：加回一档（全组每人 +20%）':'值日缺勤：全组每人值日缺勤 −20%'});
    save();refreshCard(cls,lesson,gno);renderMetrics(cls,lesson);
    var pct=pctText((A?A.dutyScore(ls,gno):5)/5*100);
    flash(dir<0?'第'+gno+'组已加回一档：全组每人 +20%，本学期值日缺勤回到 '+pct:'第'+gno+'组已记值日缺勤：全组每人 −20%，本学期值日缺勤剩 '+pct);
  }
  // V4：值日缺勤「单击扣一档、双击加回一档」。
  /* 2026-11-13 修「双击加不了分」：浏览器的一次双击会依次派发 click → click → dblclick，
     旧代码三个事件各干各的，双击的净效果是「扣两档 + 加回一档 = 净扣一档」，老师看到的就是
     「双击没加回来」。现在单击延迟 260ms 再执行（人不会在 260ms 内连点两次单机），
     双击一到就把定时器清掉，只走「加回一档」。 */
  var dutyClickTimer = 0;
  $('#groupList').addEventListener('click', function (e) {
    var button = e.target.closest('[data-duty-deduct]');
    if (!button) return;
    if (dutyClickTimer) return;                     // 双击的第二下 click：交给 dblclick 处理
    var gno = Number(button.dataset.dutyDeduct);
    dutyClickTimer = setTimeout(function () {
      dutyClickTimer = 0;
      var cls = curClass(), lesson = curLesson(cls);
      if (cls && lesson) deductDuty(cls, lesson, gno, 1);
    }, 260);
  });
  $('#groupList').addEventListener('dblclick', function (e) {
    var button = e.target.closest('[data-duty-deduct]');
    if (!button) return;
    e.preventDefault(); e.stopPropagation();
    if (dutyClickTimer) { clearTimeout(dutyClickTimer); dutyClickTimer = 0; }
    var cls = curClass(), lesson = curLesson(cls);
    if (cls && lesson) deductDuty(cls, lesson, Number(button.dataset.dutyDeduct), -1);
  });

  /* ── 本节各项目完成率明细（2026-11-13）────────────────────────────────
     用户原话：「课堂任务列和本节完成率列是包含关系 所以删除课堂任务列 仅保留本节任务完成率
     需要显示完整几个项目 各多少完成率 然后转换成本节完成率 为了防止太多不好显示
     我们把详细完成各个项目完成率做成点击弹悬浮窗的形式，展示小组加分的效果ui」
     「仅展示各自的 不要有遮挡」，最后又补一句
     「还是无法点击显示详情实在不喜欢可以全部展开铺在整个表格显示啊」。
     做法：点「本节完成率」那一格，在记分表格上方展开一条明细面板 —— 表格整体被往下推，
     不会盖住任何一格；面板里按项目逐条列「项目名 · 得分/5 · 完成率」，底部写合计和扣分来源。
     再点同一格、点 ✕、或按 Esc 收起；点别人的格子直接换成那个人的。 */
  function sumDetailHtml(cls, lesson, gno, member, i) {
    var A = window.JFDT_ASSESSMENT;
    var names = (A && A.projectNames && A.projectNames(lesson)) || [];
    var rec = (lesson.leaderScores || {})[String(gno)] || {};
    var key = memberKey(member);
    var values = (rec.members || {})[key] || [];
    var net = (A && A.lessonNet) ? A.lessonNet(lesson, gno, i, key) : { raw: 0, earned: 0, max: 0 };
    var items = [], sumRaw = 0, sumMax = 0;
    names.forEach(function (name, idx) {
      var label = String(name == null ? '' : name).trim();
      if (!label) return;
      var v = values[idx];
      var blank = (v == null || v === '');
      var num = blank ? 0 : (Number(v) || 0);
      sumRaw += num; sumMax += 5;
      var isTask = TASK_COL.test(label);
      items.push('<span class="sumd-item' + (blank ? ' is-blank' : '') + (isTask ? ' is-task' : '') + '">' +
        '<b class="sumd-name">' + esc(label) + '</b>' +
        '<span class="sumd-score">' + (blank ? '—' : fmt(num) + '/5') + '</span>' +
        '<span class="sumd-pct">' + (blank ? '—' : pctText(num / 5 * 100)) + '</span>' +
        '</span>');
    });
    var ded = Math.max(0, Math.round((net.raw - net.earned) * 100) / 100);
    var foot = '合计 ' + fmt(sumRaw) + '/' + fmt(sumMax) + ' · 本节完成率 ' +
      (net.max ? pctText(Math.max(0, net.earned) / net.max * 100) : '—') +
      (ded > 0 ? ' · 实际扣分 ' + fmt(ded) + '（手机未入袋 / 个人扣分，扣完本节为止）' : '');
    return '<div class="sumd-panel" role="region" aria-label="本节各项目完成率明细">' +
      '<div class="sumd-head">' +
        '<b class="sumd-who">第 ' + gno + ' 组 · ' + esc(member.name) + '</b>' +
        '<span class="sumd-lesson">第 ' + lesson.seq + ' 次课 · ' + esc(lesson.date || '') + '</span>' +
        '<span class="sumd-total">本节完成率 <b>' + (net.max ? pctText(Math.max(0, net.earned) / net.max * 100) : '—') + '</b></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="sumd-x" data-sumd-close="1" aria-label="关闭明细">✕</button>' +
      '</div>' +
      (items.length
        ? '<div class="sumd-items">' + items.join('') + '</div>'
        : '<p class="sumd-empty">本课还没有项目列。到「组内个人评分」里加项目，这里就会逐项列出来。</p>') +
      '<div class="sumd-foot">' + foot + '</div>' +
      '</div>';
  }

  function closeSumDetail() {
    var host = $('#sumdHost');
    if (!host) return;
    host.hidden = true;
    host.innerHTML = '';
    host.dataset.open = '';
  }

  /* 悬浮窗定位（2026-11-13 用户：「需要悬浮窗形式 不然下面同学不方便直接看」）：
     原来是「在表格上方插一条面板、表格整体往下推」——投影时表格被挤走，坐在下面的同学就看不到表了。
     现在改成真正浮在页面上的一张小卡片：贴着点中的那一格下方弹出，空间不够就翻到上方，
     并且夹在可视区内。表格一动不动，全班都能同时看到分数和明细。 */
  function placeSumPanel(host, td) {
    var r = td.getBoundingClientRect();
    var w = host.offsetWidth || 380, h = host.offsetHeight || 220;
    var vw = window.innerWidth, vh = window.innerHeight, pad = 10;
    var left = Math.min(Math.max(pad, r.right - w), Math.max(pad, vw - w - pad));
    var top = r.bottom + 8;
    if (top + h > vh - pad) top = r.top - h - 8;       // 下方放不下就翻到上方
    if (top < pad) top = pad;
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(top) + 'px';
  }

  function showSumDetail(td) {
    var gd = $('#studentGradeDialog');   // 悬浮窗互斥（2026-11-13）：先关「平时分详情」弹窗，再弹「本节详情」
    if (gd && typeof gd.close === 'function' && gd.open) gd.close();
    var host = $('#sumdHost');
    if (!host) return;
    var gno = Number(td.dataset.sumG), i = Number(td.dataset.sumI);
    if (!(gno >= 1) || !(i >= 0)) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    var g = groupOf(cls, gno);
    var member = g && g.members && g.members[i];
    if (!member || !member.name) return;
    /* 点同一格 = 收起 */
    var sig = lesson.id + '|' + gno + '|' + i;
    if (host.dataset.open === sig && !host.hidden) { closeSumDetail(); return; }
    host.innerHTML = sumDetailHtml(cls, lesson, gno, member, i);
    host.hidden = false;
    host.dataset.open = sig;
    placeSumPanel(host, td);
    $$('.c-sum.is-sumd-on').forEach(function (el) { el.classList.remove('is-sumd-on'); });
    td.classList.add('is-sumd-on');
  }

  $('#groupList').addEventListener('click', function (e) {
    if (e.target.closest('[data-sumd-close]')) { closeSumDetail(); return; }
    /* 只有「本节完成率」这一列能开明细（2026-11-13 修「点值日缺勤却弹出成绩明细」）：
       值日缺勤 / 考勤完成率 / 三列成绩各有各的处理，先挡掉，别让它们抢这一下点击。 */
    if (e.target.closest('.c-duty, .duty-cell, [data-duty-deduct], .home-attendance, .attendance-score, td.home-grade')) return;
    var td = e.target.closest('td.c-sum[data-home-grade="sum"]');
    if (!td) return;
    /* 不带 data-sum-g 的是空成员占位行，没有明细可看 */
    if (!td.dataset.sumG) return;
    /* 正在选组/拖拽/点加减分时不抢：只处理单元格本体的点击 */
    if (e.target.closest('button, input, select, a')) return;
    showSumDetail(td);
  });
  if ($('#sumdHost')) {
    $('#sumdHost').addEventListener('click', function (e) {
      if (e.target.closest('[data-sumd-close]') || e.target === this) closeSumDetail();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var host = $('#sumdHost');
      if (host && !host.hidden) closeSumDetail();
    }
  });
  /* 悬浮窗是 fixed 定位：页面一滚动 / 窗口一变尺寸，它就和原来那一格错开了。
     与其跟着算，直接收起 —— 老师再点一下就有新的，成本最低。 */
  window.addEventListener('scroll', function () {
    var host = $('#sumdHost');
    if (host && !host.hidden) closeSumDetail();
  }, { passive: true });
  window.addEventListener('resize', function () {
    var host = $('#sumdHost');
    if (host && !host.hidden) closeSumDetail();
  });

  /* ================= 记分交互（事件委托） ================= */

  $('#groupList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +btn.dataset.g;
    var s = sc(lesson, gno);
    var act = btn.dataset.act;
    if (act === 'pr' || act === 'pz') {
      var chip = btn.parentElement.querySelector('.pchip');
      if (act === 'pr') bumpPersonal(cls, lesson, chip, -1);
      else setPersonal(cls, lesson, chip, 0);
      return;
    }

    if (act === 'first') {
      var oldF = s.first ? 1 : 0, newF = oldF ? 0 : 1;
      s.first = newF;
      pushUndo({ lessonId: lesson.id, gno: gno, f: 'first', old: oldF, neu: newF });
    } else if (act === 'i' || act === 'd') {
      var f = btn.dataset.f;
      var max = btn.dataset.max ? +btn.dataset.max : maxOf(f, 99);
      var oldV = +s[f] || 0, newV = oldV > max
        ? (act === 'i' ? oldV : oldV - 1)
        : clamp(oldV + (act === 'i' ? 1 : -1), 0, max);
      if (newV === oldV) { refreshCard(cls, lesson, gno); return; }   // 已经到顶/到底，不必记一笔
      s[f] = newV;
      pushUndo({ lessonId: lesson.id, gno: gno, f: f, old: oldV, neu: newV });
    } else if (act === 'p') {
      if (longPressFired) { longPressFired = false; return; }   // 刚长按减过，别再 +1
      bumpPersonal(cls, lesson, btn, +1);
      return;
    }
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    if (act === 'first') scoreFeedback(gno, 'first', null, newF - oldF);
    else if (act === 'i' || act === 'd') scoreFeedback(gno, f, null, (f === 'phone' ? -1 : 1) * (newV - oldV));
  });

  /** 个人扣分走这里，±1 和归零都记录、都可撤销。
      纸质表上「犯几次写几次」，所以不封 5，只封 99 防手滑。
      label 可由调用方指定（比如「值日缺勤」按钮），只影响撤销/日志的显示文案。 */
  function changeMemberPoints(cls,lesson,gno,index,delta,label){var s=sc(lesson,gno),old=JSON.parse(JSON.stringify(s)),g=groupOf(cls,gno),base=5,values=g.members.map(function(_,i){return remaining(lesson,gno,i);});s.phone=0;g.members.forEach(function(m,i){if(!m.name)return;var value=values[i];if(index===null||String(i)===String(index))value=Math.max(0,Math.min(base,value+delta));s.personal[String(i)]=base-value;});if(JSON.stringify(old)===JSON.stringify(s))return;pushUndo({lessonId:lesson.id,gno:gno,reset:true,old:old,label:label||(index===null?'全组扣分：全组每人本节项目分 −20%':'成员'+(+index+1)+'本节项目分调整')});save();refreshCard(cls,lesson,gno);renderMetrics(cls,lesson);}
  function bumpPersonal(cls, lesson, chip, delta) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    if(+s.phone>0){changeMemberPoints(cls,lesson,gno,i,-delta);return;}
    var old = +s.personal[i] || 0;
    var neu = clamp(old + delta, 0, 5);
    if (neu === old) return;
    s.personal[i] = neu;
    pushUndo({
      lessonId: lesson.id, gno: gno, i: i, old: old, neu: neu,
      name: memberName(cls, gno, +i)
    });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    scoreFeedback(gno, null, i, old - neu);
  }

  /** 直接把某个成员的个人扣分设成指定值（双击归零用） */
  function setPersonal(cls, lesson, chip, val) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    var old = +s.personal[i] || 0;
    if (old === val) return;
    s.personal[i] = val;
    pushUndo({
      lessonId: lesson.id, gno: gno, i: i, old: old, neu: val,
      name: memberName(cls, gno, +i)
    });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    scoreFeedback(gno, null, i, old - val);
  }

  function memberName(cls, gno, i) {
    var g = groupOf(cls, gno);
    var m = g && g.members[i];
    return m ? m.name : '';
  }

  /** 整组清零（含个人扣分），可撤销。异步了：确认走悬浮弹窗 */
  async function clearGroup(cls, lesson, gno) {
    var key = String(gno);
    if (!touched(lesson, gno)) { flash('第 ' + gno + ' 组这节课还没记过分'); return; }
    var ok = await askConfirm({
      title: '把第 ' + gno + ' 组这节课清零？',
      body: '这个组的首个正确 / 小组分 / 手机 / 个人扣分全部归零，其它组不受影响。',
      note: '清错了可以点「撤销」。',
      ok: '清零',
      danger: true
    });
    if (!ok) return;
    var old = JSON.parse(JSON.stringify(lesson.scores[key] ||
      { first: 0, group: 0, phone: 0, personal: {} }));
    lesson.scores[key] = { first: 0, group: lesson.memberProjectBase===5?5:0, phone: 0, personal: {} };
    pushUndo({ lessonId: lesson.id, gno: gno, reset: true, old: old });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    flash('已把第 ' + gno + ' 组本节清零（可撤销）');
  }

  $('#groupList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cleargroup]');
    if (!b) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    clearGroup(cls, lesson, +b.dataset.cleargroup);
  });

  /* 个人扣分：右键 / 长按 = 往回减 1 */
  var longPressFired = false, longPressTimer = null;

  function lpStop() { clearTimeout(longPressTimer); longPressTimer = null; }

  $('#groupList').addEventListener('contextmenu', function (e) {
    var chip = e.target.closest('.pchip');
    if (!chip) return;
    e.preventDefault();
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) return;
    bumpPersonal(cls, lesson, chip, -1);
  });

  $('#groupList').addEventListener('touchstart', function (e) {
    var chip = e.target.closest('.pchip');
    if (!chip) return;
    lpStop();
    longPressFired = false;
    longPressTimer = setTimeout(function () {
      longPressFired = true;
      var cls = curClass(), lesson = curLesson(cls);
      if (cls && lesson) bumpPersonal(cls, lesson, chip, -1);
      /* 长按松手后浏览器还会补一个 click，得吃掉它 */
      setTimeout(function () { longPressFired = false; }, 900);
    }, 550);
  }, { passive: true });

  ['touchend', 'touchmove', 'touchcancel'].forEach(function (t) {
    $('#groupList').addEventListener(t, lpStop, { passive: true });
  });

  /* 清零使用明确按钮，避免连续两次扣分被浏览器dblclick误判为清零。 */

  $('#groupList').addEventListener('change', function (e) {
    var inp = e.target.closest('input.num');
    if (!inp) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +inp.dataset.g, f = inp.dataset.f;
    var max = inp.dataset.max ? +inp.dataset.max : maxOf(f, 99);
    var s = sc(lesson, gno);
    var old = +s[f] || 0;
    var neu = clamp(inp.value, 0, max);
    inp.value = neu;                       // 立刻回显夹取后的值，别让输入框留着非法数字
    if (neu === old) return;
    s[f] = neu;
    pushUndo({ lessonId: lesson.id, gno: gno, f: f, old: old, neu: neu });
    save();
    refreshCard(cls, lesson, gno);
    renderMetrics(cls, lesson);
    scoreFeedback(gno, f, null, (f === 'phone' ? -1 : 1) * (neu - old));
  });

  /* ================= 排行视图 ================= */

  /* 个人详细分排序（2026-11-10 #14）：'group' 按组号、'regular' 按平时分 */
  var rankSort = 'group';

  function renderRank() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    S.ui.classId = cls.id;
    $('#rankClassSel').value = cls.id;

    var ls = lessonsOf(cls.id);

    /* 小组排行（2026-11-12 显示层：成员项目净分平均折完成率，分母 = 5×有命名项目的课次数） */
    var rows = cls.groups.map(function (g) {
      return { no: g.no, t: groupCum(cls, g.no), n: memberCount(g) };
    }).sort(function (a, b) { return b.t - a.t; });
    var maxAbs = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.t); })));
    var groupCumMax = 5 * groupLessonSpan(ls);
    $('#groupRank').innerHTML = rows.length
      ? '<div class="bars">' + rows.map(function (r, i) {
          var w = r.t === 0 ? 0 : Math.max(2, Math.round(Math.abs(r.t) / maxAbs * 100));
          return '<div class="bar-row">' +
            '<div class="who">' + (i + 1) + '. 第 ' + r.no + ' 组</div>' +
            '<div class="bar-track"><div class="bar-fill' + (r.t < 0 ? ' neg' : (i === 0 && r.t > 0 ? ' gold' : '')) + '" style="width:' + w + '%"></div></div>' +
            '<div class="val ' + signClass(r.t) + '">' + pctText(Math.max(0, r.t) / groupCumMax * 100) + '</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<p class="rank-note">共 ' + ls.length + ' 次课记录。柱长为组间相对值，数值为小组累计完成率。</p>'
      : '<p class="rank-note">还没有课次记录。</p>';

    /* 个人详细分（平铺版，2026-11-10 #14）：每个学生一张卡片，往下滑看全部；
       rankSort 控制排序：'group' 按组号升序（组内按平时分）、'regular' 按平时分降序 */
    var ms = memberTotals(cls);
    /* 显示层：全班共用一个分母（Σ每课 5×已命名项目数 + 值日缺勤 5 分，只算一次），学期汇总按完成率口径 */
    var semesterMax = semesterProjectMax(ls);
    /* 顶部统计（2026-11-11 #15）：原来是一整条独立横幅 + 一句「包含当前班全部已录入课次，随记分实时更新」，
       现在缩成一句话跟在班级下拉后面同一行，尾巴压短一点，宽屏一屏能放下不换行 */
    $('#semesterSummary').textContent = cls.name+' · '+ls.length+'次课 · '+ms.length+'名已分组学生 · '+(ms.length&&semesterMax?'全班平均完成率 '+pctNum(ms.reduce(function(a,m){return a+Math.max(0,m.total);},0)/ms.length/semesterMax*100)+'%':'暂无课次')+'。随记分实时更新。';
    if(window.JFDT_ASSESSMENT) window.JFDT_ASSESSMENT.renderDetail({root:$('#memberRank'),cls:cls,lessons:ls,raw:ms,sort:rankSort,save:function(){save();},log:addOperationLog,message:flash,openAttendance:function(){switchView('attendance');},export:function(name,rows){download(name,toCsv(rows),'text/csv');}});

    /* 逐节明细（显示层：每课按「成员平均项目分 ÷ 5」折完成率，累计分母 = 5×有命名项目的课次数） */
    $('#lessonMatrix').innerHTML = ls.length
      ? '<table class="data fit"><thead><tr><th>组号</th>' +
          ls.map(function (l) { return '<th class="n">第' + l.seq + '课</th>'; }).join('') +
          '<th class="n">累计</th></tr></thead><tbody>' +
          cls.groups.map(function (g) {
            return '<tr><td>第 ' + g.no + ' 组</td>' +
              ls.map(function (l) {
                var t = groupTotal(l, g.no);
                return '<td class="n">' + (touched(l, g.no) ? pctText(Math.max(0, t) / 5 * 100) : '') + '</td>';
              }).join('') +
              '<td class="n ' + signClass(groupCum(cls, g.no)) + '"><b>' + pctText(Math.max(0, groupCum(cls, g.no)) / groupCumMax * 100) + '</b></td></tr>';
          }).join('') +
          '</tbody></table>'
      : '<p class="rank-note">暂无记录。</p>';
  }

  /* ================= 成绩登分册 ================= */

  var gbSettings = (function () {
    try { return JSON.parse(localStorage.getItem('jfdt.gb') || '{}') || {}; } catch (e) { return {}; }
  })();

  /** 导出文件名：只勾一个班时照旧写班名；多个班写「N个班」，免得文件名长到被系统截断。 */
  var gbPdfBusy = false;
  function gbFileName(ext) {
    var ids = gbPickIds(), semester = $('#gbSemester').value.trim(), label = '班级';
    if (ids.length === 1) {
      var one = visibleClasses().filter(function (c) { return c.id === ids[0]; })[0];
      if (one) label = one.name;
    } else if (ids.length > 1) {
      label = ids.length + '个班';
    }
    return '成绩登分册_' + label + (semester ? '_' + semester : '') + '.' + ext;
  }

  /** 9 月以后算「当年-次年-1」，否则「上年-当年-2」 */
  function gbDefaultSemester() {
    var d = new Date(), y = d.getFullYear();
    return d.getMonth() + 1 >= 8 ? y + '-' + (y + 1) + '-1' : (y - 1) + '-' + y + '-2';
  }

  function gbSaveSettings() {
    if (!$('#gbClassList')) return;
    gbSettings = {
      classIds: gbPickIds(),
      semester: $('#gbSemester').value.trim(),
      course: $('#gbCourse').value.trim(),
      teacher: $('#gbTeacher').value.trim()
    };
    try { localStorage.setItem('jfdt.gb', JSON.stringify(gbSettings)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /** 勾选框里选中的班级 id，按页面班级顺序返回（导出表顺序才稳定） */
  function gbPickIds() {
    var box = $('#gbClassList');
    if (!box) return [];
    var on = Object.create(null);
    Array.prototype.forEach.call(box.querySelectorAll('input[type="checkbox"]:checked'), function (el) {
      on[el.value] = true;
    });
    return visibleClasses().filter(function (c) { return on[c.id]; }).map(function (c) { return c.id; });
  }

  /** 上次的选择：新版存 classIds（数组，空数组 = 全不选也要记住）；
      老版本存单个 classId 或 '__all'，这里顺手迁移，老师不用重新点一遍。 */
  function gbSavedIds() {
    if (Array.isArray(gbSettings.classIds)) return gbSettings.classIds;
    if (!gbSettings.classId) return null;
    if (gbSettings.classId === '__all') return visibleClasses().map(function (c) { return c.id; });
    return [gbSettings.classId];
  }

  function gbSelectedClasses() {
    var ids = gbPickIds(), vis = visibleClasses();
    return vis.filter(function (c) { return ids.indexOf(c.id) >= 0; });
  }

  /** 按勾选生成全部表，并算好班级数 / 人数。
   *  人数不能取「最多那张表」：一个班超过 11 次课会拆成几张表，多个班还要相加；
   *  同一个班拆几张只算一次人，否则「已选 3 个班 · 152 人」就会虚高。 */
  function gbBuild() {
    var GB = window.JFDT_GRADEBOOK, A = window.JFDT_ASSESSMENT;
    var out = { sheets: [], classCount: 0, people: 0 };
    if (!GB || !A) return out;
    var semester = $('#gbSemester').value.trim(), course = $('#gbCourse').value.trim(), teacher = $('#gbTeacher').value.trim();
    var picked = gbSelectedClasses(), multi = picked.length > 1;
    var perClass = Object.create(null), order = [];
    picked.forEach(function (cls) {
      var ls = lessonsOf(cls.id);
      if (!ls.length) return;
      var made = GB.buildClass({
        cls: cls, lessons: ls,
        students: A.rows(cls, ls, memberTotals(cls)),
        meta: { semester: semester, course: course, teacher: teacher || cls.teacher || '' }
      });
      if (!made.length) return;
      out.classCount++;
      order.push(cls.id);
      perClass[cls.id] = 0;
      made.forEach(function (sheet) {
        /* 多班一起打印时页眉单独写班名；单班不加，输出和以前一字不差 */
        if (multi) sheet.band = cls.name;
        out.sheets.push(sheet);
        perClass[cls.id] = Math.max(perClass[cls.id], sheet.rows.length);
      });
    });
    out.people = order.reduce(function (a, id) { return a + perClass[id]; }, 0);
    return out;
  }

  /** 勾选数量 → 计数文字 + 按钮可用状态。
   *  没勾任何班时必须禁用：老师点了没反应会以为功能坏了。 */
  function gbSyncPick(built) {
    var ids = gbPickIds(), empty = !ids.length;
    ['#gbPrint', '#gbPdf', '#gbExport'].forEach(function (sel) {
      var btn = $(sel);
      if (!btn) return;
      if (sel === '#gbPdf' && gbPdfBusy) return;   // PDF 正在生成，保持置灰
      btn.disabled = empty;
    });
    var meter = $('#gbPickMeter');
    if (meter) meter.textContent = empty ? '还没有班级' : '已选 ' + ids.length + ' 个班 · ' + (built ? built.people : 0) + ' 人';
    var hint = $('#gbPickHint');
    if (hint) hint.textContent = empty ? '至少勾选一个班级才能导出' : '';
  }

  function gbRenderStage() {
    var GB = window.JFDT_GRADEBOOK, stage = $('#gbStage');
    if (!GB || !stage || !S) return;
    var built = gbBuild(), sheets = built.sheets, meter = $('#gbMeter');
    gbSyncPick(built);
    if (!sheets.length) {
      stage.innerHTML = '<p class="empty-hint">' + (gbPickIds().length
        ? '选中的班还没有可导出的分数：先在「上课记分」页新开一课，再回来这里。'
        : '先在页头勾选要导出的班级。') + '</p>';
      if (meter) meter.textContent = '';
      return;
    }
    GB.render(stage, sheets);
    if (meter) meter.textContent = '共 ' + sheets.length + ' 张表 · ' + built.people + ' 名学生 · 每张 ' + GB.DATE_COLS + ' 个日期列';
  }

  /** 把勾选框画出来；默认勾哪些由 renderGradebook 决定 */
  function gbRenderPickers(ids) {
    var box = $('#gbClassList'), vis = visibleClasses();
    if (!box) return;
    box.innerHTML = vis.length ? vis.map(function (c) {
      return '<label class="gb-class"><input type="checkbox" value="' + esc(c.id) + '"' +
        (ids.indexOf(c.id) >= 0 ? ' checked' : '') + '><span>' + esc(c.name) + '</span></label>';
    }).join('') : '<span class="note">还没有班级：先在首页点亮要用加分的班。</span>';
  }

  function renderGradebook() {
    var box = $('#gbClassList');
    if (!box || !S) return;
    var vis = visibleClasses(), saved = gbSavedIds(), ids;
    if (saved === null) {
      var cur = curClass();          // 第一次打开：默认勾当前在教的班
      ids = cur ? [cur.id] : (vis[0] ? [vis[0].id] : []);
    } else {
      ids = saved.filter(function (id) { return vis.some(function (c) { return c.id === id; }); });
    }
    gbRenderPickers(ids);
    if (!$('#gbSemester').value) $('#gbSemester').value = gbSettings.semester || gbDefaultSemester();
    if (!$('#gbCourse').value) $('#gbCourse').value = gbSettings.course || '电气接线原理';
    if (!$('#gbTeacher').value && gbSettings.teacher) $('#gbTeacher').value = gbSettings.teacher;
    gbRenderStage();
  }

  if ($('#gbClassList')) {
    $('#gbClassList').addEventListener('change', function () { gbSaveSettings(); gbRenderStage(); });
    $('#gbPickAll').addEventListener('click', function () {
      Array.prototype.forEach.call($('#gbClassList').querySelectorAll('input[type="checkbox"]'), function (el) { el.checked = true; });
      gbSaveSettings(); gbRenderStage();
    });
    $('#gbPickNone').addEventListener('click', function () {
      Array.prototype.forEach.call($('#gbClassList').querySelectorAll('input[type="checkbox"]'), function (el) { el.checked = false; });
      gbSaveSettings(); gbRenderStage();
    });
    ['#gbSemester', '#gbCourse', '#gbTeacher'].forEach(function (id) {
      $(id).addEventListener('change', function () { gbSaveSettings(); gbRenderStage(); });
    });
    $('#gbSemester').addEventListener('input', function () { gbSaveSettings(); gbRenderStage(); });
    $('#gbCourse').addEventListener('input', function () { gbSaveSettings(); gbRenderStage(); });
    $('#gbTeacher').addEventListener('input', function () { gbSaveSettings(); });
    $('#gbRefresh').addEventListener('click', function () { gbRenderStage(); flash('已按最新分数刷新'); });
    $('#gbPrint').addEventListener('click', function () {
      gbSaveSettings();
      var sheets = gbBuild().sheets;
      if (!sheets.length) { flash('还没有可打印的分数：先在「上课记分」页新开一课。'); return; }
      window.JFDT_GRADEBOOK.print(sheets);
    });
    $('#gbExport').addEventListener('click', function () {
      gbSaveSettings();
      var built = gbBuild(), sheets = built.sheets;
      if (!sheets.length) { flash('还没有可导出的分数：先在「上课记分」页新开一课。'); return; }
      try {
        window.JFDT_GRADEBOOK.download(sheets, gbFileName('xlsx'));
        flash('已导出 ' + sheets.length + ' 张表' + (built.classCount > 1 ? '（' + built.classCount + ' 个班）' : '') + '，可直接打印或继续编辑');
      } catch (e) {
        flash('导出失败：' + e.message);
      }
    });
    if ($('#gbPdf')) $('#gbPdf').addEventListener('click', function () {
      if (gbPdfBusy) return;
      gbSaveSettings();
      var sheets = gbBuild().sheets;
      if (!sheets.length) { flash('还没有可导出的分数：先在「上课记分」页新开一课。'); return; }
      var btn = $('#gbPdf');
      gbPdfBusy = true;
      btn.disabled = true;
      flash('正在生成 PDF…（人多时稍等几秒）');
      window.JFDT_GRADEBOOK.pdf(sheets, gbFileName('pdf')).then(function (n) {
        flash('PDF 已下载：A4 横向共 ' + n + ' 页，可直接打印或发给别人');
      }).catch(function (e) {
        flash('导出 PDF 失败：' + e.message + '。可以先用「打印」再选另存为 PDF。');
      }).then(function () {
        gbPdfBusy = false;
        btn.disabled = !gbPickIds().length;   // 生成期间可能被改成全不选，不能无脑恢复
      });
    });
    var gbResizeTimer = null;
    window.addEventListener('resize', function () {
      if (view !== 'gradebook' || !window.JFDT_GRADEBOOK) return;
      clearTimeout(gbResizeTimer);
      gbResizeTimer = setTimeout(function () { window.JFDT_GRADEBOOK.fit($('#gbStage')); }, 120);
    });
  }

  /* ================= 待分配名单 ================= */

  var poolFilter = 'pending';
  var poolSearch = '';

  /** 上课记分页顶部的跳转提示条（只提示，不拦人：没分完照样能记分） */
  function renderPoolBanner(cls) {
    var el = $('#poolBanner');
    var p = truePendingList(cls), seated = seatedNotGrouped(cls);
    if (!p.length && !seated.length) { el.hidden = true; el.innerHTML = ''; return; }
    var names = p.slice(0, 6).map(function (r) { return r.name; }).join('、');
    if (p.length > 6) names += ' 等';
    var text = p.length
      ? '本班还有 <b>' + p.length + '</b> 人没分到组：' + esc(names) + ' · 不影响现在照常记分'
      : '本班有 <b>' + seated.length + '</b> 人已经坐在圆桌上，但还没确认分组，确认后才写进记分表';
    el.hidden = false;
    el.innerHTML =
      '<span class="dot"></span>' +
      '<span>' + text + (p.length && seated.length ? '（另有 <b>' + seated.length + '</b> 人已选座待确认）' : '') + '</span>' +
      '<button class="btn tiny" id="btnGoPool">' + (seated.length ? '去确认分组 →' : '去分组 →') + '</button>';
    $('#btnGoPool').addEventListener('click', function () {
      $('#poolClassSel').value = cls.id;
      switchView('pool');
      /* 2026-11-10：横幅写着「去确认分组 →」，但点进去折叠区还收着，老师找不到
         「按选座确认分组」按钮。有已选座待确认的人时，直接展开「学生自助选桌」折叠区。 */
      if (seated.length) openTeamMore();
    });
  }

  /** 页签上的待分配总数角标 */
  function updatePoolBadge() {
    var b = $('#tabPoolBadge');
    var n = pendingTotal();
    if (n > 0) { b.hidden = false; b.textContent = '未分组 ' + n + ' 人'; }
    else { b.hidden = true; b.textContent = ''; }
  }

  function renderPool() {
    var cls = getClass($('#poolClassSel').value) || curClass();
    if (!cls) return;
    S.ui.classId = cls.id;
    $('#poolClassSel').value = cls.id;
    $('#classSel').value = cls.id;
    /* 2026-11-09：「分几组 / 每组上限」两个框现在直接填本班真实值（见 renderGroupSetup），
       不再有「默认预设」——组数就是 cls.groups 的长度，上限就是 cls.groupLimit。 */

    var map = placedMap(cls), seat = seatIndex(cls);
    var rows = rosterOf(cls).map(function (r) {
      var g = groupOfStudent(cls, r, map);
      var table = g === null ? seatedTable(cls, r, seat) : 0;
      return { r: r, g: g, table: table };
    });
    var nGrouped = rows.filter(function (x) { return x.g !== null; }).length;
    /* 坐在圆桌上、还没点「按选座确认分组」的人：名单里已经写成「已选座 · 第 N 桌（待确认）」，
       所以这里也必须单列一格，否则同一页上会出现「上面说未分组 7 人、下面 7 个人都写着已选座」
       ——正是 2026-11-08 老师报过的那个自相矛盾。
       口径：已分组 + 已选座待确认 + 未分组 = 全班，三个数永远对得上。 */
    var nSeated = rows.filter(function (x) { return x.g === null && x.table; }).length;
    var nPending = rows.length - nGrouped - nSeated;

    /* 2026-11-13 精简（用户：「这部分太大占位了 可以简约点 缩小点」）：
       原来三个大数字格（全班 / 已分组 / 未分组）改成一行小字，信息不变、高度从 ~150px 降到一行。 */
    $('#poolMetrics').innerHTML =
      '<span>全班 <b>' + rows.length + '</b> 人</span>' +
      '<span>已分组 <b>' + nGrouped + '</b></span>' +
      (nSeated ? '<span>已选座待确认 <b>' + nSeated + '</b></span>' : '') +
      '<span' + (nPending ? ' class="neg"' : '') + '>未分组 <b>' + nPending + '</b></span>';

    gbRows = rows;
    renderGroupBoard(cls);
    loadFaces(cls);    // 学生的头像 + 身份卡背景（拉回来后会自己重画一次看板）
    renderPoolFix(cls);    // 「掉队归位 / 撤回上一次分组」那条（有人掉出原组时才出现）

    updatePoolBadge();
    renderGroupSetup();    // 「分几组 / 每组上限」两个框 + 下面那句说明
    renderGroupSummary();  // 主界面那句「N 个组 · 已分 x/y 人」
  }

  /** 待分配区顶上那条「掉队归位」（2026-11-08 追加）：
      团队在 26工器1 班看到的现场是 49 人的班只剩 5 个组 29 人 —— 20 个人掉进待分配，
      老师既不知道少了谁，也不知道怎么放回去。这条只在「真的有人掉出原组」时出现，
      并且明写「记分表还认得出他们原来的组」，放回去不会清分。 */
  function renderPoolFix(cls) {
    var box = $('#poolFixRow');
    if (!box) return;
    var rows = droppedWithHome(cls);
    var snap = lastGroupSnapshot(cls);
    if (!rows.length && !snap) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var html = '';
    if (rows.length) {
      var names = rows.slice(0, 8).map(function (x) { return x.r.name; }).join('、');
      html += '<span class="gb-badge-bad">掉队</span>' +
        '<span class="pool-fix-text">有 <b>' + rows.length + '</b> 人现在不在任何组里，' +
        '但记分表还认得出他们原来在第几组：' + esc(names) + (rows.length > 8 ? ' 等' : '') +
        '。放回去不会清掉他们的分。</span>' +
        '<button id="btnRestoreDropped" class="btn primary small" type="button">把掉出的人放回原组（' + rows.length + ' 人）</button>';
    }
    if (snap) {
      html += '<button id="btnRollbackGroup" class="btn ghost small" type="button" ' +
        'title="组结构、成员顺序、个人扣分/项目分整份还原到这个动作之前">撤回上一次分组：' +
        esc(snap.label) + '</button>';
    }
    box.innerHTML = html;
  }

  /* ================= 分组看板：所有组都看得见，可拖可点换人 =================
     用户 2026-11-06：「已分组也要在这边显示好 各个组哪些人 方便老师后期换组换人操作；
     这有历史班级已经分好组的，不是用你这个分组功能分的就没有显示，请予以显示和操作能力」。

     原来这一页只有一张「待分配的人」的表，已经分好的几十个人一个都看不到 —— 老师想换组
     只能切到「上课记分」页一个个点。现在把 cls.groups 原样铺成卡片，不管这些组是
     本工具的一键分组、按选座确认，还是更早版本 / 别的工具留下的历史数据，有组就画。

     三条原则（每一条都是踩过的坑）：
     ① 只换人，不动组结构 —— 这里刻意没有「删组 / 改组号 / 重新分组」的入口，
        那些还在「上课记分」页的现有流程里。用户特别交代过别让「开放组队」把组冲掉。
     ② 组号可能重复（历史数据里真出现过两组都叫第 3 组），所以 DOM 上只用数组下标
        data-gi 定位，绝不拿组号当主键。
     ③ 组内成员可能根本不在全班名单里（历史组员从没导进 roster），所以组员直接读
        g.members，不拿 roster 反查 —— 否则历史组的成员会凭空消失，正是用户抱怨的那件事。 */

  var gbPick = null;        // 点选后等落点的来源：{kind:'member',gi,mi} / {kind:'pending',key}
  var gbAddTo = -1;         // 「＋ 加人」模式：接下来点待分配区的人就加进这个下标的组
  var gbRows = null;        // 上一次 renderPool 算出来的名单行（含 g / table），看板直接复用

  /* ===== 学生头像 + 身份卡背景（2026-11-13 第二轮）=====
     用户原话三句：「怎么没有背景？只有头像啊？」「头像被姓氏遮挡」「学生端头像没显示，
     应该统一这个圆圈换成头像」。所以规则改成：
       · 学生设的身份卡背景 = 铺满**整张分组卡片**（上一版错铺在头像圈上，看着像只有头像）
       · 头像圈里显示**学生头像照片**；没传过头像的学生才显示姓氏首字，不再叠在一起
     规则只在 小组加分/faces.js 里定义一份，教师端（这里）和学生端（team.js）共用。
     数据由 security definer 函数 hx_class_faces(p_class) 一次拉回（背景 + 头像 URL），
     老师只放自己的班、学生只放自己所在的班。拉不到就静默降级成首字 + 彩色药丸，不影响分组。 */
  var facesFor = 0;         // 已经为哪个班级拉过（0 = 还没拉）

  /** 拉本班头像/背景（每个班只拉一次；换班自动重拉；回来后重画看板） */
  function loadFaces(cls) {
    var cid = tmClassId(cls);
    if (!cid || !window.HXFaces || facesFor === cid) return;
    facesFor = cid;
    window.HXFaces.load(cid, function (name, params) { return CLOUD.rpc(name, params); })
      .then(function () { if (view === 'pool') renderGroupBoard(curClass()); })
      .catch(function () { facesFor = 0; });   // 没装函数 / 没网：下次再试
  }

  /** 取某个学生的样式（{card, av, hasAv}；都是能直接塞进 style="…" 的串） */
  function faceOf(cls, sid) {
    var cid = tmClassId(cls);
    if (!cid || !window.HXFaces || !sid) return { card: '', av: '', hasAv: false };
    return window.HXFaces.of(cid, sid);
  }

  /** 分组已确认收工（云端房间 status = closed）→ 看板只读。
      用户原话：「老师确认分组也支持显示分组，看看全班分组情况，只是改为只读而已」
      「确认了学生端就是只读状态」。老师想再调整，点「开放组队」重新开一场即可。 */
  function gbReadOnly() {
    return !!(tmRoom && tmRoom.room && tmRoom.status === 'closed');
  }
  var gbDrag = null;        // 当前这一下拖动
  var gbSwallowClick = false;   // 拖完松手浏览器还会补一个 click，别让它被当成「点选」

  /** 名单行 → 稳定键。学号优先，没有学号才用姓名+班内序号；同名学生不会串。 */
  function gbRowKey(r) {
    return r.sid ? 's:' + r.sid : 'n:' + r.name + '#' + (r.no == null ? '' : r.no);
  }

  /** 画整块看板：左边「未分组」、右边各组卡片。
      2026-11-09 重做（用户：「就做一种 先确定分组数量和每组上限（可改）然后教师可以使用拖拽分组」）：
      ① 组数由上面的「分几组」决定，所以**空组也要画**——不画空组就没有落点，新建的组拖不进去；
         空组的样式是虚线，和「满」的组一眼分得开。
      ② 只换人，不动组结构；组号 g.no 是记分表的行号，任何重画都不改它。
      ③ 组内成员可能根本不在全班名单里（历史组员），所以组员直接读 g.members，不拿 roster 反查。 */

  function renderGroupBoard(cls) {
    var box = $('#groupBoard');
    if (!box || !cls) return;
    /* 正在拖的时候别重画：看板每 2 秒会跟一次云端座位，重画会把手里那张卡换掉，拖到一半就断了 */
    if (gbDrag && gbDrag.active) return;
    var q = poolSearch.trim().toLowerCase();
    /* 已确认收工（房间 closed）→ 整块看板只读：能看全班分组，不能拖 / 加人 / 移出 / 改上限。
       用户原话：「老师确认分组也支持显示分组，看看全班分组情况，只是改为只读而已」。 */
    var ro = gbReadOnly();
    function match(name, sid, no) {
      if (!q) return true;
      return String(name || '').toLowerCase().indexOf(q) >= 0 ||
        String(sid || '').indexOf(q) >= 0 ||
        String(no == null ? '' : no) === q;
    }
    var groups = cls.groups || [];
    var order = groups.map(function (g, i) { return i; }).sort(function (a, b) {
      return (Number(groups[a].no) || 0) - (Number(groups[b].no) || 0) || a - b;
    });

    var cards = order.map(function (gi) {
      var g = groups[gi], cap = groupTargetCap(cls, g), n = memberCount(g);
      /* 超员 = 这组的人数超过上面定的「每组上限」（或本组特许）。超出来的人照样在
         g.members 里，这里只按界面顺序给第 cap+1 个往后的人加一个红标 ——
         用户原话：「超出的人标红 但是不移除原来组」，所以这里绝不删人。 */
      var over = Math.max(0, n - cap), full = n > 0 && n >= cap;
      var seen = 0;
      var mem = '';
      g.members.forEach(function (m, mi) {
        if (!m.name) return;                       // 名单页留的空占位格不画出来
        seen++;
        var overLimit = seen > cap;                // 搜索把人滤掉时序号也要照算，标红才不会跳来跳去
        if (!match(m.name, m.sid, m.no)) return;   // 搜索只滤「人」，组卡片本身留着，免得老师找不到组
        var on = gbPick && gbPick.kind === 'member' && gbPick.gi === gi && gbPick.mi === mi;
        var isLead = isGroupLeader(g, m);
        var sub = m.sid ? String(m.sid) : (m.no == null ? '' : String(m.no));
        var tone = gbTone(g.no, seen - 1);   // 同组同色，组内按顺序加深（第1人最浅）
        var face = faceOf(cls, m.sid);       // 学生自己的身份卡背景 + 头像（见 faces.js）
        mem += '<div class="gb-chip' + (on ? ' on' : '') + (overLimit ? ' gb-over-limit' : '') +
          (face.card ? ' has-face' : '') +
          '" role="button" tabindex="0"' +
          ' data-gi="' + gi + '" data-mi="' + mi + '"' +
          ' style="' + tone + face.card + '"' +
          ' title="' + (overLimit ? '超出本组上限 ' + cap + ' 人，但不会被自动移出：拖走 / 留下 / 单独建一组都可以。' : '') +
            '拖到别的组就换组，拖到左边的「未分组」就移出">' +
          '<span class="gb-av' + (face.hasAv ? ' has-img' : '') + '" aria-hidden="true"' +
            (face.av ? ' style="' + face.av + '"' : '') + '>' +
            esc(String(m.name).slice(0, 1)) + '</span>' +
          '<div class="gb-nm"><b>' + esc(m.name) + '</b>' +
            (sub === '' ? '' : '<small>' + esc(sub) + '</small>') +
          '</div>' +
          '<span class="gb-role' + (isLead ? ' lead' : ' member') + '">' + (isLead ? '组长' : '组员') + '</span>' +
          (overLimit ? '<span class="gb-over-tag">超出</span>' : '') +
          (ro ? '' :
            '<button type="button" class="gb-x" data-gi="' + gi + '" data-mi="' + mi + '"' +
              ' title="移出到未分组" aria-label="把' + esc(m.name) + '移出到未分组">×</button>') +
          '</div>';
      });
      if (!mem) {
        mem = '<p class="gb-empty">' + (n ? (q ? '没有匹配的人' : '这一组的人被筛掉了')
          : '还没人，把左边的人拖进来') + '</p>';
      }
      /* 超员时的两条出路：① 设为例外（按现在的人数放行）；② 单独建一组（一个人都不丢）。 */
      var bar = '';
      if (over) {
        bar = '<div class="gb-over-bar">' +
          '<span class="gb-over-tip">超出 ' + over + ' 人（标红，未被移出）</span>' +
          '<button type="button" class="gb-mini" data-exempt="' + gi + '" title="这组按 ' + n + ' 人特例放行，不再标红">设为例外（保留 ' + n + ' 人）</button>' +
          '<button type="button" class="gb-mini" data-split="' + gi + '" title="把超出的 ' + over + ' 人拆到新的一组">把超出的 ' + over + ' 人单独建一组</button>' +
          '</div>';
      } else if (Number(g.cap) > (classGroupLimit(cls) || GROUP_CAP)) {
        bar = '<div class="gb-exempt-row">本组按特例 ' + Number(g.cap) + ' 人放行' +
          '<button type="button" class="gb-mini" data-unexempt="' + gi + '">取消例外</button></div>';
      }
      return '<section class="gb-group' + (n ? '' : ' is-empty') + (full ? ' is-full' : '') +
          (over ? ' is-over' : '') + (gbAddTo === gi ? ' is-target' : '') + '" data-gi="' + gi + '">' +
        '<header class="gb-ghead">' +
          '<span class="gb-gno">第 ' + esc(g.no) + ' 组' +
            (Number(g.cap) ? '<i class="gb-cap-tag" title="本组按特许上限 ' + Number(g.cap) + ' 人放行">特许</i>' : '') +
          '</span>' +
          '<span class="gb-gright">' +
            '<span class="gb-gcnt"><b>' + n + '</b>/' + cap + ' 人' +
              (over ? '<i class="gb-flag gb-flag-over">超 ' + over + '</i>'
                    : (full ? '<i class="gb-flag">满</i>' : '')) + '</span>' +
            /* 单组上限 ±1：只改这一组，不动全班默认，也不删人（超了只标红）
               2026-11-13：已确认只读（ro）时这两颗小按钮不出现，免得老师以为还能改 */
            (ro ? '' :
            '<button type="button" class="gb-cap" data-gcap-down="' + gi + '"' +
              ' title="把第 ' + esc(g.no) + ' 组的上限减 1 人：只改本组，不影响其它组；减回全班默认就取消本组特许。超了只标红不删人" aria-label="第 ' + esc(g.no) + ' 组上限减 1">－</button>' +
            '<button type="button" class="gb-cap" data-gcap-up="' + gi + '"' +
              ' title="把第 ' + esc(g.no) + ' 组的上限加 1 人：只改本组，不影响其它组；超了只标红不删人" aria-label="第 ' + esc(g.no) + ' 组上限加 1">＋</button>'
            ) +
          '</span>' +
        '</header>' +
        bar +
        '<div class="gb-members">' + mem + '</div>' +
        (ro ? '' : '<button type="button" class="gb-add" data-add="' + gi + '">＋ 加人</button>') +
        (n || ro ? '' :
          '<button type="button" class="gb-del" data-gdel="' + gi + '"' +
            ' title="这个组一个人都没有：删掉它，并把剩下的组按组号重排成 1、2、3…">删除本组</button>') +
        '</section>';
    }).join('');

    var pend = (gbRows || []).filter(function (x) { return x.g === null; })
      .filter(function (x) { return match(x.r.name, x.r.sid, x.r.no); });
    var nSeat = pend.filter(function (x) { return !!x.table; }).length;
    var nWait = pend.length - nSeat;
    var pChips = pend.map(function (x) {
      var r = x.r, key = gbRowKey(r);
      var on = gbPick && gbPick.kind === 'pending' && gbPick.key === key;
      var psub = r.sid ? String(r.sid) : (r.no == null ? '' : String(r.no));
      var pface = faceOf(cls, r.sid);
      return '<div class="gb-chip gb-pend-chip' + (on ? ' on' : '') + (pface.card ? ' has-face' : '') +
        '" role="button" tabindex="0"' +
        ' data-pkey="' + esc(key) + '" title="拖到右边任意一组就加进去"' +
        (pface.card ? ' style="' + pface.card + '"' : '') + '>' +
        '<span class="gb-av' + (pface.hasAv ? ' has-img' : '') + '" aria-hidden="true"' +
          (pface.av ? ' style="' + pface.av + '"' : '') + '>' +
          esc(String(r.name || '?').slice(0, 1)) + '</span>' +
        '<div class="gb-nm"><b>' + esc(r.name || '（未命名）') + '</b>' +
          (psub === '' ? '' : '<small>' + esc(psub) + '</small>') +
        '</div>' +
        (x.table ? '<span class="gb-tag">已选座 · 第 ' + x.table + ' 桌</span>' : '') +
        '</div>';
    }).join('');

    /* 撤销条：拖完人以后原地显示「撤销」，不用去操作日志里翻。
       另一条「撤回上一次分组」读跨操作的分组快照，整份还原（连成员顺序一起，
       因为个人扣分是按组内下标存的）。 */
    var undoBar = (!ro && gbUndo && gbUndo.clsId === cls.id)
      ? '<div class="gb-undo"><span>' + esc(gbUndo.label) + '</span>' +
        '<button type="button" class="gb-mini" data-gb-undo="1">撤销</button></div>'
      : '';
    var lastSnap = ro ? null : lastGroupSnapshot(cls);
    if (lastSnap) {
      undoBar += '<div class="gb-undo gb-undo-snap"><span>上一次分组：' + esc(lastSnap.label) +
        '（' + esc(String(lastSnap.at || '').slice(5, 16).replace('T', ' ')) + '）</span>' +
        '<button type="button" class="gb-mini" data-gb-snapundo="1">撤回上一次分组</button></div>';
    }

    /* 2026-11-13 合并（用户原话：「本质上停止组队和结束是冗余吧 还有我点确认分组不也是结束吗
       三冗余 应该就是开始组队和确认两个切换按钮才对吧」「这个按钮功能就是集成到上面我说的
       开始组队后显示的确认分组按钮上就行 他不就是清理空组并递进的功能吗」）：
       看板顶部那颗常驻的「✓ 确认分组」删掉 —— 按钮统一收到上面「学生自助选桌」那一行
       （#btnTeamFinish，文案随状态在「确认分组 / 按选座确认分组」之间切换）。
       这里只留一行状态提示：现在几个组、有没有空组、有没有待确认的座位。 */
    var emptyN = groups.filter(function (g) { return memberCount(g) === 0; }).length;
    var liveN = groups.length - emptyN;          // 有人的组数：压缩以后就剩这么多组
    var confirmBar = ro
      ? '<div class="gb-confirmbar gb-confirmbar-ro">' +
          '<span class="gb-confirmtip">🔒 <b>已确认分组 · 只读</b>：下面是这次确认后的全班分组，学生端也是只读。' +
            '要再调整就点上面的「开放组队」重新开一场。</span>' +
        '</div>'
      : '<div class="gb-confirmbar gb-confirmbar-tip">' +
      '<span class="gb-confirmtip">' +
        (nSeat ? '有 <b>' + nSeat + '</b> 人已选座待确认 · 点上面的「按选座确认分组」按桌号写进记分表'
               : (!groups.length ? '还没有组 · 先在上面「分几组」里填个数字'
                 : (!liveN ? '所有组都还空着 · 先把左边的学生拖进组，再点上面的「确认分组」'
                   : (emptyN ? '有 <b>' + emptyN + '</b> 个空组 · 点上面的「确认分组」清掉，组号排成 1–' + liveN
                             : '现在是连续的 ' + groups.length + ' 组，没有空组')))) +
      '</span>' +
      '</div>';

    box.innerHTML = confirmBar + undoBar +
      '<div class="gb-board">' +
        '<section class="gb-pending" data-drop="pending">' +
          '<header class="gb-phead">' +
            '<span class="gb-ptitle">未分组</span>' +
            '<span class="gb-gcnt"><b>' + nWait + '</b> 人</span>' +
          '</header>' +
          (nSeat ? '<p class="gb-pseat">另有 <b>' + nSeat + '</b> 人已在学生选桌坐好，还没写进分组</p>' : '') +
          '<div class="gb-members">' +
            (pChips || '<p class="gb-empty">' + (q ? '没有匹配的人' : '没有未分组的学生，全班都分好组了。') + '</p>') +
          '</div>' +
        '</section>' +
        '<div class="gb-groups">' +
          (cards || '<p class="gb-empty">这个班还没有组。在上面「分几组」里填个数字，就会出现对应数量的空组。</p>') +
        '</div>' +
      '</div>' +
      (ro
        ? '<p class="gb-hint">现在是只读状态，看的就是这次确认后的全班分组。要调整请点上面的「开放组队」，学生重新选座后再确认一次。</p>'
        : '<p class="gb-hint">拖动就是分组：把左边的学生拖到右边的组卡片上松手就进组；组里的人数满了会拒绝，并提示先移出一个。' +
          '手机上先点一个人再点目标组，效果一样。超员的人会标红但不会被移出，你可以拖走、留着，或给那一组点「设为例外」。</p>');
  }

  /** 重画看板（只刷新卡片，不动整页） */
  function gbRepaint() { renderGroupBoard(curClass()); }

  var gbUndo = null;        // 单步撤销：{clsId,label,groups,lessons}

  /** 动分组之前把「组结构 + 本班所有课次的分数」一起拍张快照。
      用户要求「拖完给撤销」；分数也要拍，是因为换组会把个人扣分跟着人搬走，
      只还原组结构、不还原分数，下一次算分就错位了。
      2026-11-08 追加：同时往 S.groupSnapshots 里存一份（最多留 5 份），
      那条是跨操作、跨页面的「撤回上一次分组」，比这条单步撤销活得久。 */
  function gbSnapshot(cls, label) {
    var data = groupSnapshotData(cls);
    gbUndo = { clsId: cls.id, label: label, groups: data.groups, lessons: data.lessons, limit: data.limit };
    pushGroupSnapshot(cls, label);
  }

  /** 撤销上一次拖拽/例外/拆组：结构和分数一起退回去。 */
  function gbUndoLast() {
    var u = gbUndo, cls = curClass();
    if (!u || !cls || u.clsId !== cls.id) return false;
    cls.groups = JSON.parse(JSON.stringify(u.groups));
    if (u.limit == null) delete cls.groupLimit; else cls.groupLimit = u.limit;
    (u.lessons || []).forEach(function (x) {
      var l = getLesson(x.id);
      if (!l) return;
      l.scores = JSON.parse(JSON.stringify(x.scores || {}));
      l.leaderScores = JSON.parse(JSON.stringify(x.leaderScores || {}));
    });
    gbUndo = null; gbPick = null; gbAddTo = -1;
    addOperationLog('分组', cls.name + ' · 撤销：' + u.label);
    save();
    renderPool(); renderScore();
    flash('已撤销：' + u.label);
    return true;
  }

  /** 改完统一走这里：save() 落到本机 + 云端，然后把看板、统计、记分页一起刷新 */
  function gbCommit(cls, msg) {
    gbPick = null; gbAddTo = -1;
    save();
    renderPool();
    renderScore();
    if (msg) flash(msg);
  }

  /** 换组/加人后的即时反馈：目标组卡片闪一下，让老师看见「落到这一组了」。
      满员拒绝闪红边（gb-rejected），成功闪绿边（gb-just-dropped）。
      注意时序：gbCommit 里会 renderPool → renderGroupBoard 整块重画，DOM 是全新的，
      所以 class 必须在 gbCommit 之后再加（加到新节点上），否则会被重画冲掉。
      1.2 秒后移除；移除前若又发生重画，旧的 el 已脱离文档，remove 也是无害的。 */
  function gbFlashGroup(gi, clsName) {
    var el = $('.gb-group[data-gi="' + gi + '"]');
    if (!el) return;
    el.classList.add(clsName);
    setTimeout(function () { el.classList.remove(clsName); }, 1200);
  }

  /** 待分配的人 → 第 gi 组（gi 是 cls.groups 的下标，不是组号） */
  function gbJoin(cls, r, gi) {
    var g = cls.groups[gi];
    if (!g || !r) return false;
    var cap = groupTargetCap(cls, g);
    /* 满了要说一句，不能静默失败：老师拖过去没反应会以为程序坏了 */
    if (memberCount(g) >= cap) {
      flash('第 ' + g.no + ' 组已经满 ' + cap + ' 人（本班每组上限 ' + cap + ' 人），先移出一个再放进去');
      gbFlashGroup(gi, 'gb-rejected');
      return false;
    }
    gbSnapshot(cls, '把「' + r.name + '」加进第 ' + g.no + ' 组');
    pushMember(g, { id: uid('m'), name: r.name, sid: r.sid || '', no: r.no == null ? null : r.no });
    addOperationLog('分组', cls.name + ' · ' + r.name + ' → 第' + g.no + '组（待分配页拖拽）');
    var reback = repairOrphansAfterAssign(cls);
    gbCommit(cls, '已把「' + r.name + '」加进第 ' + g.no + ' 组' +
      (reback ? '，已接回他名下 ' + reback + ' 条历史分' : ''));
    gbFlashGroup(gi, 'gb-just-dropped');
    return true;
  }

  /** 组员从第 fromGi 组换到第 toGi 组 */
  function gbMoveTo(cls, fromGi, mi, toGi) {
    var from = cls.groups[fromGi], to = cls.groups[toGi];
    if (!from || !to || fromGi === toGi) return false;
    var m = from.members[mi];
    if (!m || !m.name) return false;
    var cap = groupTargetCap(cls, to);
    if (memberCount(to) >= cap) {
      flash('第 ' + to.no + ' 组已经满 ' + cap + ' 人（本班每组上限 ' + cap + ' 人），先移出一个再换过去');
      gbFlashGroup(toGi, 'gb-rejected');
      return false;
    }
    gbSnapshot(cls, '把「' + m.name + '」从第 ' + from.no + ' 组换到第 ' + to.no + ' 组');
    /* 2026-11-08：个人扣分是按「组号 + 组内下标」存的，人换组时必须跟着人搬走，
       否则这笔扣分会留在原组，算到原位置新坐下的同学头上。
       个人项目分（leaderScores）按「组号 + 成员键」存，同一个道理：不搬过去，
       新组按组号找不到这条记录，老师看到的就是「换组以后个人项目分没了」。 */
    var personal = takePersonalOf(cls, from.no, mi);
    var leader = takeLeaderOf(cls, from.no, memberKey(m));
    removeMemberAt(cls, from, mi);   // 顺带把该组历史课次的「个人扣分」索引左移
    pushMember(to, m);               // 成员对象整个搬过去，组长标记 leaderKey 里的 id 不会失联
    putPersonalOf(cls, to.no, to.members.length - 1, personal);
    putLeaderOf(cls, to.no, memberKey(m), leader);
    addOperationLog('分组', cls.name + ' · ' + m.name + '：第' + from.no + '组 → 第' + to.no + '组（待分配页拖拽）');
    gbCommit(cls, '已把「' + m.name + '」从第 ' + from.no + ' 组换到第 ' + to.no + ' 组');
    gbFlashGroup(toGi, 'gb-just-dropped');
    return true;
  }

  /** 组员 → 待分配区 */
  function gbUnassign(cls, gi, mi) {
    var g = cls.groups[gi];
    if (!g) return false;
    var m = g.members[mi];
    if (!m || !m.name) return false;
    gbSnapshot(cls, '把「' + m.name + '」移出第 ' + g.no + ' 组');
    removeMemberAt(cls, g, mi);
    addOperationLog('分组', cls.name + ' · ' + m.name + '：移出第' + g.no + '组（待分配页拖拽）');
    gbCommit(cls, '已把「' + m.name + '」移出第 ' + g.no + ' 组，回到未分组');
    return true;
  }

  /** 「设为例外（保留 N 人）」：这一组按现在的人数放行，不再标红。
      用户原话：「以及是否允许该组特殊情况设置7人这样的情况」。 */
  function gbExempt(cls, gi) {
    var g = cls.groups[gi];
    if (!g) return false;
    var n = memberCount(g);
    if (!n) return false;
    gbSnapshot(cls, '第 ' + g.no + ' 组设为例外（' + n + ' 人）');
    g.cap = n;
    addOperationLog('分组', cls.name + ' · 第' + g.no + '组设为例外：' + n + ' 人（不再标红）');
    gbCommit(cls, '第 ' + g.no + ' 组已设为例外，按 ' + n + ' 人放行');
    return true;
  }

  /** 取消例外：回到老师定的每组上限，超出的人重新标红（人照样不动）。 */
  function gbUnexempt(cls, gi) {
    var g = cls.groups[gi];
    if (!g || !Number(g.cap)) return false;
    gbSnapshot(cls, '第 ' + g.no + ' 组取消例外');
    delete g.cap;
    addOperationLog('分组', cls.name + ' · 第' + g.no + '组取消例外，回到每组 ' + groupTargetCap(cls, g) + ' 人');
    gbCommit(cls, '第 ' + g.no + ' 组已取消例外，超出的 ' + overCountOf(cls, g) + ' 人会重新标红（但不会被移出）');
    return true;
  }

  /** 把超出的 N 人原地拆成新的一组：用户说的「单独建一组」。
      一个人都不丢，个人扣分跟着人走；新组按自己的人数放行，不标红。 */
  function gbSplitOver(cls, gi) {
    var g = cls.groups[gi];
    if (!g) return false;
    var cap = groupTargetCap(cls, g), seen = 0, idx = [];
    g.members.forEach(function (m, i) {
      if (!m.name) return;
      seen++;
      if (seen > cap) idx.push(i);
    });
    if (!idx.length) return false;
    gbSnapshot(cls, '把第 ' + g.no + ' 组超出的 ' + idx.length + ' 人单独建一组');
    var maxNo = cls.groups.reduce(function (a, x) { return Math.max(a, Number(x.no) || 0); }, 0);
    var ng = { id: uid('g'), no: maxNo + 1, members: [] };
    idx.slice().sort(function (a, b) { return b - a; }).forEach(function (i) {
      var m = g.members[i];
      var key = memberKey(m);
      var personal = takePersonalOf(cls, g.no, i);
      var leader = takeLeaderOf(cls, g.no, key);
      removeMemberAt(cls, g, i);
      pushMember(ng, m);
      putPersonalOf(cls, ng.no, ng.members.length - 1, personal);
      putLeaderOf(cls, ng.no, key, leader);
    });
    if (memberCount(ng)) ng.cap = memberCount(ng);
    cls.groups.push(ng);
    addOperationLog('分组', cls.name + ' · 第' + g.no + '组超出的 ' + idx.length + ' 人拆成第' + ng.no + '组');
    gbCommit(cls, '已把第 ' + g.no + ' 组超出的 ' + idx.length + ' 人拆成第 ' + ng.no + ' 组');
    return true;
  }

  /* ================= 分组结构整理：压缩空组 / 删组 / 单组上限 / 锁定（2026-11-11） =================
     老师实测反馈：1–13 组里只有第 9 组有人，10–13 全空占位；改组数后组号不重排，空组赖着不走；
     确认分组后空组也不清理；没法只给某一个组单独加人；担心学生随时能换组没法管理。

     这里补的每个动作都守同一条铁律 —— 动结构必须「① 拍快照 → ② 动结构 → ③ 按身份 realign」，
     顺序颠倒就会把个人扣分 / 个人项目分错记到别人头上（用户原话：「我之前弄的加分全部丢失了」）。

     还有一条容易被忽略的：小组四列分（首个正确 / 小组分 / 手机）是按【组号】存的一整行，
     不按人存。所以组号一重排，这一整行必须跟着组一起搬家（remapScoreRows）；
     否则第 4 组的历史分会挂在第 3 组名下 —— 那也是「错位」，只是更难发现。 */

  /* ================= 统一悬浮确认框（2026-11-13） =================
     用户原话：「这种弹窗我们不是说别用吗 用悬浮弹窗统一」——说的是浏览器原生 confirm()。
     原生 confirm 是系统灰框，跟站内玻璃风格两回事，也没法把「会动到哪几个组、影响几个人」写清楚。

     现在本文件只有一个确认入口 askConfirm()，两种调用法都认：
       askConfirm({ title:'删除这节课？', body:'第一段\n第二段', ok:'删除', cancel:'再想想', danger:true, note:'不可撤销' })
       askConfirm('正文', { title:'标题', okText:'确定', cancelText:'取消' })   ← 兼容旧调用点
     返回 Promise<boolean>：确定 true；取消 / ✕ / Esc / 点旁边空白 一律 false。

     实现要点（三个坑都在这几行里）：
     1) 只造一个 <dialog>（#dlgAskConfirm）挂在 body 上，反复开合，不每次 createElement；
     2) 关窗兜底：Esc / 浏览器 UI / 点空白 都不会走按钮的 onclick，所以统一听 dialog 的 close 事件
        settle 一次 —— 否则弹窗关了、Promise 永远 pending，调用方后面全卡住；
     3) 上一个还开着又被调用：先把旧 Promise 结掉（false）再覆盖内容，绝不留孤儿。
     正文默认「纯文本 + 转义」，只放行 <b>/<strong>/<i>/<em> 四个强调标签；真要插 HTML 传 html:'…'。 */
  var askDlgEl = null, askSettle = null;

  /** 纯文本 → 段落 HTML：空行分段、单换行 <br>，其余全部转义（白名单只留强调标签） */
  function askBodyHTML(text) {
    if (text == null || text === '') return '';
    return String(text).split(/\n{2,}/).map(function (para) {
      var s = esc(para).replace(/&lt;(\/?)(b|strong|i|em)&gt;/g, '<$1$2>');
      return '<p>' + s.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function askDialogEl() {
    if (askDlgEl) return askDlgEl;
    var d = document.createElement('dialog');
    d.id = 'dlgAskConfirm';
    d.className = 'dlg-ask';
    d.setAttribute('aria-labelledby', 'askConfirmTitle');
    d.innerHTML = '<div class="dlg">' +
        '<div class="dlg-head"><h3 id="askConfirmTitle">请确认</h3>' +
          '<button type="button" class="dlg-x" data-ask="0" aria-label="关闭">✕</button></div>' +
        '<div class="dlg-body" id="askConfirmBody"></div>' +
        '<div class="btnrow"><button type="button" class="btn" data-ask="0">取消</button>' +
          '<button type="button" class="btn primary" data-ask="1">确定</button></div>' +
      '</div>';
    document.body.appendChild(d);
    wireDialog(d);                    // 点旁边空白同样关掉（close 事件里会 settle false）
    Array.prototype.forEach.call(d.querySelectorAll('[data-ask]'), function (b) {
      b.onclick = function () { askClose(b.getAttribute('data-ask') === '1'); };
    });
    d.addEventListener('close', function () { askSettleOnce(false); });
    askDlgEl = d;
    return d;
  }

  /** 结掉当前这一次的 Promise（幂等：已经结过就什么也不做） */
  function askSettleOnce(ok) {
    var done = askSettle;
    askSettle = null;
    if (done) done(!!ok);
  }

  function askClose(ok) {
    var d = askDialogEl();
    askSettleOnce(ok);                              // 先结 Promise 再关；关窗还会触发 close，幂等所以无副作用
    if (!d.hasAttribute('open')) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function askConfirm(msg, opts) {
    var o = opts || {};
    if (typeof msg === 'string') {                  // 旧写法：正文在前、选项在后
      o = { title: o.title, body: msg, ok: o.okText, cancel: o.cancelText, danger: o.danger, note: o.note, html: o.html };
    } else {
      o = msg || {};
    }
    var d = askDialogEl();
    askSettleOnce(false);                           // 上一张还没关就被顶掉：先把它的 Promise 结掉，不留孤儿
    d.querySelector('#askConfirmTitle').textContent = o.title || '请确认';
    var body = d.querySelector('#askConfirmBody');
    body.innerHTML = (typeof o.html === 'string') ? o.html : askBodyHTML(o.body);
    if (o.note) {
      var note = document.createElement('p');
      note.className = 'note';
      note.textContent = o.note;
      body.appendChild(note);
    }
    var btnOk = d.querySelector('.btnrow [data-ask="1"]');
    var btnNo = d.querySelector('.btnrow [data-ask="0"]');
    btnOk.textContent = o.ok || '确定';
    btnNo.textContent = o.cancel || '取消';
    btnOk.className = 'btn ' + (o.danger ? 'danger' : 'primary');
    btnNo.className = 'btn';
    var p = new Promise(function (resolve) { askSettle = resolve; });
    if (!d.hasAttribute('open')) openDlg(d);
    /* 焦点：普通确认落在「确定」上（回车即确认）；危险操作落在「取消」上，误按回车也不会删东西 */
    setTimeout(function () { try { (o.danger ? btnNo : btnOk).focus(); } catch (e) {} }, 30);
    return p;
  }

  /* ── 修复排位误加分（2026-11-13）────────────────────────────────────
     用户原话：「这种项目是排位仿真课堂任务生成的项目列 老师无权改为学生打分还是教师自己打分
     是无法编辑的才对 … 修复老师或者学生互评的这一列误加的分 因为这是由课堂任务生成的项目列」。
     判定和清洗全在 score-clean.js（那个模块只算数据、不碰 DOM），这里只负责一条流程：
       扫描 → 把「会清哪些列、各多少格」摆给老师看 → 他确认 → 先下载备份 → 再清 → 落盘重画。
     ⚠ 为什么先把备份做完才清：这一步是真的把分抹成 null，界面级没有撤销，只能拿备份文件恢复。 */
  function wireCleanRun() {
    var M = window.JFDT_SCORECLEAN;
    if (!M) { flash('清洗模块没加载（score-clean.js 缺失），刷新页面再试'); return; }
    var r;
    try { r = M.scan(S); } catch (e) { flash('扫描失败：' + ((e && e.message) || '未知错误')); return; }
    if (!r || !r.total) { flash('没有发现排位项目列上的误加分，不用清洗'); return; }
    var byCol = {}, order = [];
    (r.lessons || []).forEach(function (L) {
      (L.cells || []).forEach(function (c) {
        var k = (L.className || '班级') + ' · 第' + L.seq + ' 次 · ' + (c.colName || '（未命名列）');
        if (!byCol[k]) { byCol[k] = 0; order.push(k); }
        byCol[k]++;
      });
    });
    var lines = order.slice(0, 10).map(function (k) { return '· ' + k + '：' + byCol[k] + ' 格'; });
    if (order.length > 10) lines.push('· …还有 ' + (order.length - 10) + ' 处');
    askConfirm(
      '排位项目列上发现被手填 / 互评混进去的分数，共 ' + r.total + ' 格：\n\n' +
      lines.join('\n') +
      '\n\n排位列只该由接线仿真的排位结果写入。这些格子的来源标记不是「排位」，所以判为误加。\n\n' +
      '会先把整份数据下载成备份文件，再清除。',
      { title: '修复排位误加分', okText: '备份并清洗', cancelText: '取消' }
    ).then(function (ok) {
      if (!ok) return;
      var backed = false;
      try { M.backup(S); backed = true; } catch (e) { flash('备份下载失败，已中止：' + ((e && e.message) || '浏览器拦截了下载')); return; }
      if (!backed) return;
      var out;
      try { out = M.clean(S); } catch (e) { flash('清洗失败：' + ((e && e.message) || '未知错误')); return; }
      save();
      renderScore();
      try { renderRank(); } catch (e) { }
      flash('已清除 ' + out.removed + ' 格误加分；备份文件已下载，要恢复就用它');
    });
  }
  if ($('#btnScoreClean')) $('#btnScoreClean').addEventListener('click', wireCleanRun);

  /** 按旧组号升序排（组号相同就按原来的先后），压缩/重排都用它，保证顺序可预期 */
  function sortGroupsByNo(list) {
    return list.map(function (g, i) { return { g: g, i: i }; })
      .sort(function (a, b) { return (Number(a.g.no) || 0) - (Number(b.g.no) || 0) || a.i - b.i; })
      .map(function (x) { return x.g; });
  }

  /** 组号重排时，把每节课按【组号】存的那几行一起搬到新组号：
      lesson.scores（四个小组列 + personal）/ lesson.leaderScores（个人项目分）/ lesson.peerMeta（元数据键）。
      · 留下来的组：整行跟着组走（map：旧组号 → 新组号）；
      · 空组被删掉了：这一行**一律**改挂到 '~旧组号' 这种非数字键上归档（不管那个号码有没有被别的组占），
        因为「被删的组」在界面上已经不存在了，任何数字键迟早会被以后新建的组读到 ——
        比如删掉第 5 组以后又加组，maxNo+1 正好又排到 5，新组会凭空继承旧组的历史分，
        groupHasHistory 也会把新组判成「有历史分、删不掉」。
        归档后所有算分代码（都按 cls.groups 遍历）看不见它，但数据还在存档/备份里，绝不抹掉。
      返回 { moved, parked } 供操作日志用。 */
  function remapScoreRows(cls, map) {
    var moved = 0, parked = 0;

    /* 旧键 k 该落到哪个新键：留下来的组按 map 搬；其余（被删的组 / 早先归档过的）一律 '~k'。
       已经带 '~' 的键原样保留，避免二次归档成 '~~3'。 */
    function pick(k) {
      if (map[k] != null) return String(map[k]);
      if (k.charAt(0) === '~') return k;
      return '~' + k;
    }

    (S.lessons || []).forEach(function (l) {
      if (l.classId !== cls.id) return;
      ['scores', 'leaderScores'].forEach(function (field) {
        var src = l[field];
        if (!src) return;
        var out = {};
        Object.keys(src).forEach(function (k) {
          var target = pick(k);
          if (out[target] != null) {          // 理论上不会撞（map 一一对应）；真撞了就归档，绝不覆盖
            parked++;
            target = '~' + k + '_' + Object.keys(out).length;
          }
          out[target] = src[k];
          if (target === k) return;
          if (target.charAt(0) === '~') parked++; else moved++;
        });
        l[field] = out;
      });
      /* 组长评分表的元数据键是「组号|成员键|列」，跟着组号一起改前缀 */
      if (l.peerMeta) {
        var pm = {};
        Object.keys(l.peerMeta).forEach(function (mk) {
          var p = mk.split('|');
          pm[pick(p[0]) + '|' + p[1] + '|' + p[2]] = l.peerMeta[mk];
        });
        l.peerMeta = pm;
      }
      /* 值日组同样按组号记：组号重排后要跟着组走，被删掉的空组从值日里去掉 */
      var dgs = Array.isArray(l.dutyGroups) ? l.dutyGroups : (l.dutyGroup ? [Number(l.dutyGroup)] : []);
      if (dgs.length) {
        var nd = [];
        dgs.forEach(function (n) {
          var t = map[String(Number(n) || 0)];
          if (t == null) return;
          if (nd.indexOf(t) < 0) nd.push(t);
        });
        l.dutyGroups = nd;
        l.dutyGroup = nd.length ? nd[0] : null;
      }
    });
    return { moved: moved, parked: parked };
  }

  /** 组号有没有重复（历史数据里真出现过两组都叫第 3 组）。
      有重复就没有唯一的「组号 → 分数行」映射，硬重排只会把分记到别的组名下 —— 所以压缩必须中止。
      list 不传就按「本班有人的组」判断：压缩真正要留下的就是这些（空组本来就要删掉）。 */
  function compressBlockedByDup(cls, list) {
    var gs = list || ((cls.groups || []).filter(function (g) { return memberCount(g) > 0; }));
    var seen = {};
    for (var i = 0; i < gs.length; i++) {
      var k = String(Number(gs[i].no) || 0);
      if (seen[k]) return true;
      seen[k] = 1;
    }
    return false;
  }

  /** 中止时给老师看的那句话（applyCompress 和两处按钮入口共用，别各写一份） */
  function dupCompressMsg() {
    return '这个班有两组组号重复（历史数据问题）：先把重复的组删到不重复（空组上点「删除本组」，或改「分几组」），再来压缩。这次什么都没改。';
  }

  /** 压缩/删除的统一内核：keep 是「要留下的组」（已按旧组号升序），dropCount 是删掉的组数。
      顺序严格固定，一步都不能换：
      ① scoreLayoutSnapshot —— 拍下「旧组号 → 旧组内顺序是谁」，realign 靠它认人；
      ② gbSnapshot + remapScoreRows + 重排组号 —— 动结构，把按组号存的分行一起搬走；
      ③ realignPersonalScores / realignLeaderScores —— 按学生身份把分写回到人现在的位置。
      第 ① 步的表是按旧组号记的，重排后要用 snapNew 翻成「新组号 → 旧组内顺序」再交给 realign，
      否则 realign 会拿新组号去查旧表，一个人都认不出来。
      组号重复时整个动作中止（连快照都不拍），返回 false —— 沿用「false = 一个字都没改」的约定。 */
  function applyCompress(cls, keep, dropCount, label) {
    if (compressBlockedByDup(cls, keep)) {
      flash(dupCompressMsg());
      addOperationLog('分组', cls.name + ' · 压缩取消：存在重复组号，未做任何改动');
      return false;
    }
    var snapOld = scoreLayoutSnapshot(cls);
    var map = {};
    keep.forEach(function (g, i) { map[String(Number(g.no) || 0)] = i + 1; });
    var snapNew = { layout: {}, keys: {} };
    keep.forEach(function (g, i) {
      var k = String(Number(g.no) || 0);
      snapNew.layout[i + 1] = (snapOld.layout || {})[k] || [];
      snapNew.keys[i + 1] = (snapOld.keys || {})[k] || [];
    });

    gbSnapshot(cls, label);                                              // ① 快照（结构 + 全部课次分数）
    var rows = remapScoreRows(cls, map);                                 // ② 行号跟着组走
    cls.groups = keep;
    keep.forEach(function (g, i) { g.no = i + 1; });                     // 组号连续：1,2,…,N
    var unmatched = realignPersonalScores(cls, snapNew);                 // ③ 按身份写回
    var leader = realignLeaderScores(cls, snapNew);
    /* 组号整体变了：正在开放的互评要把新组结构重发一遍，否则学生端还按旧组号收分 */
    peerSyncGroups(cls, true);

    addOperationLog('分组', cls.name + ' · ' + label + '：删掉 ' + dropCount + ' 个空组，剩 ' +
      keep.length + ' 组重排为 1–' + keep.length +
      (rows.moved ? '，' + rows.moved + ' 行小组分跟着组号搬了家' : '') +
      (rows.parked ? '，' + rows.parked + ' 行历史分归档（界面不再显示，数据仍在）' : '') +
      (unmatched ? '；' + unmatched + ' 条个人扣分没对上人，留在原处未清零' : ''));
    return { groups: keep.length, removed: dropCount, unmatched: unmatched, leader: leader, rows: rows };
  }

  /** 清掉所有一个人都没有的组，剩下的组按组号升序重排成 1..N（连续无空号）。
      没有空组就什么都不做：不拍快照、不记日志，直接返回 false。 */
  function compressEmptyGroups(cls, label) {
    if (!cls) return false;
    var gs = cls.groups || [];
    var empties = gs.filter(function (g) { return memberCount(g) === 0; });
    if (!empties.length) return false;
    var keep = sortGroupsByNo(gs.filter(function (g) { return memberCount(g) > 0; }));
    if (!keep.length) return false;      // 一个组都不剩就别动：这种情况留给老师自己看
    return applyCompress(cls, keep, empties.length, label || '压缩空组并重排组号');
  }

  /** 删掉指定的一个空组，剩下的组照常重排 1..N。有人的组一律不删。 */
  function deleteOneGroup(cls, g) {
    if (!cls || !g || memberCount(g) > 0) return false;
    var keep = sortGroupsByNo((cls.groups || []).filter(function (x) { return x !== g; }));
    if (!keep.length) return false;
    return applyCompress(cls, keep, 1, '删除空的第 ' + g.no + ' 组');
  }

  /** 组数改完以后如果冒出一堆空组，提示去压缩（不然首页还是「一堆空占位」） */
  function emptyGroupsHint(cls) {
    var n = (cls.groups || []).filter(function (g) { return memberCount(g) === 0; }).length;
    return n ? '；其中有 ' + n + ' 个空组，点「确认分组」清理' : '';
  }

  /** 单组上限 ±1：只改这一组的特许上限（g.cap），不动全班默认，也不删人。
      用户原话：「没法只给某一个组加人数上限」。 */
  function gbCapStep(cls, gi, dir) {
    var g = (cls.groups || [])[gi];
    if (!g) return false;
    var base = classGroupLimit(cls) || GROUP_CAP;    // 全班默认上限（没定过就是老默认 7）
    var cur = groupTargetCap(cls, g);                // 本组特许优先，没特许用全班默认
    var next = cur + (dir > 0 ? 1 : -1);
    if (next > 40) { flash('每组最多 40 人'); return false; }
    if (next < 2) { flash('每组最少 2 人'); return false; }
    gbSnapshot(cls, '第 ' + g.no + ' 组人数上限改为 ' + next + ' 人');
    /* 2026-11-12 修「改不了 6 人/5 人」：以前 dir<0 且 cur<=base 就直接拦下，
       组的上限永远只能 >= 全班默认，降不到默认以下。现在允许高也允许低：
       回到全班默认就去掉特许，高于或低于默认都记为本组特许（只影响这一组）。 */
    if (next === base) delete g.cap;                 // 减回全班默认：把本组特许去掉
    else g.cap = next;                               // 高于/低于默认都只影响这一组
    var cap = groupTargetCap(cls, g), n = memberCount(g), over = Math.max(0, n - cap);
    addOperationLog('分组', cls.name + ' · 第' + g.no + '组人数上限改为 ' + cap + ' 人（只改本组）' +
      (over ? '，超出 ' + over + ' 人只标红不移出' : ''));
    gbCommit(cls, '第 ' + g.no + ' 组上限改为 ' + cap + ' 人' +
      (over ? '：超出 ' + over + ' 人只标红，不会把人移出' : '') +
      (over ? '（本组现在 ' + n + ' 人，请把超出的 ' + over + ' 人拖到别的组）' : ''));
    return true;
  }

  /** 空组卡片上的「删除本组」：有历史分的先说清归档，删完重排组号、分数跟着人走。 */
  function gbDeleteGroup(cls, gi) {
    var g = (cls.groups || [])[gi];
    if (!g) return false;
    var n = memberCount(g);
    if (n > 0) { flash('第 ' + g.no + ' 组还有 ' + n + ' 人，先把人拖出去再删组'); return false; }
    var hist = groupHasHistory(cls, g.no);
    askConfirm('删除第 ' + g.no + ' 组？\n\n' +
      (hist
        ? '· 这一组在历史课次里留过分数：删除后这些分数随组一起归档（界面不再显示，数据仍留在存档里）\n'
        : '· 这一组现在一个人都没有，删掉不影响任何人\n') +
      '· 剩下的组按组号重排成 1、2、3…（连续没有空号）\n' +
      '· 记过的个人扣分、个人项目分按学生身份跟着人走，不会丢\n\n' +
      '想反悔可以点看板上的「撤回上一次分组」。',
      { title: '删除空组', okText: '删除本组', cancelText: '取消' })
      .then(function (ok) {
        if (!ok) return;
        var info = deleteOneGroup(cls, g);
        if (!info) {
          /* 组号重复时 applyCompress 已经 flash 过原因了，别再用「没能删」把它盖掉 */
          if (!compressBlockedByDup(cls)) flash('没能删：这一组现在还有人，或者只剩这一组了');
          return;
        }
        gbCommit(cls, '已删除第 ' + g.no + ' 组，剩 ' + info.groups + ' 组（组号已重排 1–' + info.groups + '）' +
          (hist ? '；历史分已归档' : ''));
        reportScoreMigration({ personal: info.unmatched, leader: info.leader });
        renderGroupSetup();
        renderPoolBanner(cls);
      });
    return true;
  }

  /** 看板顶部那颗常驻的「✓ 确认分组」：
      有已选座待确认的人 → 走「按选座确认分组」；
      没有 → 压缩空组 + 重排组号 + 把未分组的人平均填进去（2026-11-13 三合一：
      原来的「压缩空组并重排组号」「把未分组的人平均填进去」两个独立按钮删掉，都并进这里）。 */
  function gbConfirmGroups(cls) {
    if (!cls) return;
    var pend = (gbRows || []).filter(function (x) { return x.g === null && !!x.table; });
    if (pend.length) { tmApplySeating(); return; }
    var empties = (cls.groups || []).filter(function (g) { return memberCount(g) === 0; });
    var pending = truePendingList(cls);
    if (!empties.length && !pending.length) {
      flash((cls.groups || []).length
        ? '现在没有空组、也没有未分组的人，组号已经是连续的 1–' + groupCountOf(cls) + '，不用再整理'
        : '这个班还没有组：先在上面「分几组」里填个数字');
      return;
    }
    /* 组号重复：压缩一定中止，别让老师点完确认才被告知，直接说清原因 */
    if (compressBlockedByDup(cls)) { flash(dupCompressMsg()); return; }

    /* 平均填：先算现有组还能塞多少人，塞不下就别让老师白点确认 */
    var fillOk = true, room = null;
    if (pending.length) {
      room = cls.groups.map(function (g) {
        return { g: g, left: groupTargetCap(cls, g) - memberCount(g) };
      });
      var totalRoom = room.reduce(function (a, x) { return a + Math.max(0, x.left); }, 0);
      if (totalRoom < pending.length) {
        flash('现有小组空位不够：空位 ' + totalRoom + ' 个，未分组 ' + pending.length +
          ' 人。请先把每组上限调大，再点「确认分组」。');
        return;
      }
    }

    var limit = classGroupLimit(cls) || GROUP_CAP;
    askConfirm('确认分组？\n\n' +
      (empties.length ? '· 有 ' + empties.length + ' 个组一个人都没有，会先删掉\n' : '') +
      '· 剩下的组按组号重排成 1、2、3…（连续没有空号）\n' +
      (pending.length ? '· ' + pending.length + ' 名未分组的人按班内序号轮流填进各组（每组不超过 ' + limit + ' 人）\n' : '') +
      '· 记过的分按学生身份跟着人走，不会丢；小组四列分跟着它那一组一起搬家\n\n' +
      '想反悔可以点看板上的「撤回上一次分组」。',
      { title: '确认分组', okText: '确认分组', cancelText: '取消' })
      .then(function (ok) {
        if (!ok) return;
        var beforeF = JSON.parse(JSON.stringify(cls.groups));
        pushGroupSnapshot(cls, '确认分组（压缩空组 + 重排 + 平均填）');
        var info = empties.length ? compressEmptyGroups(cls, '手动确认分组') : null;
        if (info === false) { flash('没有可清理的空组'); return; }
        /* 压缩空组之后，把未分组的人平均填进现有组的空位（不新建组） */
        if (pending.length && room) {
          var i = 0, done = 0;
          pending.forEach(function (r) {
            for (var k = 0; k < room.length; k++) {
              var idx = (i + k) % room.length;
              if (room[idx].left > 0) {
                pushMember(room[idx].g, { id: uid('m'), name: r.name, sid: r.sid || '', no: r.no });
                room[idx].left--;
                i = idx + 1;
                done++;
                return;
              }
            }
          });
          var reback = repairOrphansAfterAssign(cls);
          addOperationLog('分组', cls.name + ' · 确认分组：平均填 ' + done + ' 人' + (reback ? '（接回历史分 ' + reback + ' 条）' : ''));
        }
        var removed = info ? info.removed : 0;
        gbCommit(cls, '已确认分组' + (removed ? '：清掉 ' + removed + ' 个空组' : '') +
          (pending.length ? '，平均填 ' + pending.length + ' 人' : '') +
          '，剩 ' + groupCountOf(cls) + ' 组');
        if (info) reportScoreMigration({ personal: info.unmatched, leader: info.leader });
        reportGroupChange(cls, beforeF, '确认分组');
        renderGroupSetup();
        renderPoolBanner(cls);
      });
  }

  function gbRowByKey(key) {
    var rows = gbRows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].g === null && gbRowKey(rows[i].r) === key) return rows[i].r;
    }
    return null;
  }

  /** 卡片上的「起点」：组员看 data-gi/data-mi，待分配的人看 data-pkey */
  function gbChipSource(chip) {
    if (!chip || !chip.dataset) return null;
    if (chip.dataset.gi !== undefined && chip.dataset.mi !== undefined) {
      return { kind: 'member', gi: +chip.dataset.gi, mi: +chip.dataset.mi };
    }
    if (chip.dataset.pkey !== undefined) return { kind: 'pending', key: chip.dataset.pkey };
    return null;
  }

  /** 点一下（没拖动）＝选中；再点一个落点就搬过去。手机上这是最稳的一条路。 */
  function gbTap(src) {
    var cls = curClass();
    if (!cls || !src) return;
    if (gbAddTo >= 0 && src.kind === 'pending') {
      gbJoin(cls, gbRowByKey(src.key), gbAddTo);
      return;
    }
    if (gbPick && gbPick.kind === src.kind && gbPick.gi === src.gi &&
        gbPick.mi === src.mi && gbPick.key === src.key) {
      gbPick = null; gbRepaint();
      return;
    }
    gbPick = src; gbAddTo = -1;
    gbRepaint();
    flash(src.kind === 'member'
      ? '已选中「' + (cls.groups[src.gi].members[src.mi] || {}).name + '」：点另一组就换过去，点左边的「未分组」就移出'
      : '已选中未分组的「' + ((gbRowByKey(src.key) || {}).name || '') + '」：点任意一组就加进去');
  }

  /* ---- 拖动：pointer 事件，鼠标和触摸同一套（HTML5 draggable 在手机上不工作） ----
     2026-11-11 提速（用户：「你这个分组拖动还卡卡的」）。原来每个 pointermove 都当场干三件事：
     写 ghost 的 transform、document.elementFromPoint、$$('.gb-over') 全板扫一遍清高亮。
     鼠标一快，一帧里能触发好几次，主线程被这些同步 DOM 操作塞满，卡片就掉队。
     现在改成「只认最后一帧」：
       · pointermove 只记坐标（px/py），多余的 move 直接被下一帧覆盖，不排队；
       · requestAnimationFrame 里才写一次 transform + 做一次命中检测 + 换高亮；
       · 命中结果连同矩形一起缓存 —— 指针还在上一张卡的范围里，就跳过 elementFromPoint；
       · gb-over 高亮只在落点变了的时候才动 class（gbMark 里比对 gbMarkLast）；
       · ghost 只写 transform（translate3d 走合成层，不重排），起手量一次 getBoundingClientRect 就够；
       · 拖动期间 renderGroupBoard 有 gbDrag.active 早退（见上面），整板不会重画。 */

  var gbRaf = 0;             // 排着的动画帧 id，0 = 当前没有待执行的帧
  var gbMarkLast = null;     // 上一帧高亮的落点元素，用来「没变就不碰 DOM」

  function gbGhostOf(chip, x, y) {
    var r = chip.getBoundingClientRect();      // 整场拖动只量这一次，之后全靠缓存的手心偏移
    var el = chip.cloneNode(true);
    el.classList.add('gb-ghost');
    el.classList.remove('on');
    var xb = el.querySelector('.gb-x');
    if (xb) xb.parentNode.removeChild(xb);
    el.style.width = r.width + 'px';
    /* left/top 由 .gb-ghost 的 CSS 固定在 0,0，这里只写 transform，避免每帧触发布局 */
    el.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0) rotate(-1.5deg) scale(1.03)';
    document.body.appendChild(el);
    return { el: el, ox: x - r.left, oy: y - r.top };
  }

  /* 命中检测（带缓存）：指针还在上一帧命中的那张卡矩形里，就不再调 elementFromPoint。
     缓存矩形向外放 2px —— 命中后 .gb-over 会把整张卡抬起 2px，矩形会有细微位移。 */
  function gbDropOn(x, y) {
    var d = gbDrag, hit = d && d.hit;
    if (hit && hit.el && hit.el.isConnected !== false &&
        x >= hit.left - 2 && x <= hit.right + 2 && y >= hit.top - 2 && y <= hit.bottom + 2) {
      return hit.el;                            // 还在同一张卡上，省掉这次调用
    }
    var el = document.elementFromPoint(x, y);
    var t = el && el.closest ? (el.closest('.gb-group') || el.closest('.gb-pending')) : null;
    if (d) {
      if (t) {
        var r = t.getBoundingClientRect();      // 只在「换了一张卡」时量一次
        d.hit = { el: t, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      } else {
        d.hit = null;
      }
    }
    return t;
  }

  /* 高亮切换：只有落点真的变了才碰 classList（原来每次 move 都全板 querySelectorAll） */
  function gbMark(el) {
    if (el === gbMarkLast) return;
    if (gbMarkLast) gbMarkLast.classList.remove('gb-over');
    gbMarkLast = el;
    if (el) el.classList.add('gb-over');
  }

  /* 一帧只跑一次：先把 ghost 挪到位，再做命中和高亮 */
  function gbFrame() {
    gbRaf = 0;
    var d = gbDrag;
    if (!d || !d.active || !d.ghost) return;
    var x = d.px, y = d.py;
    d.ghost.el.style.transform = 'translate3d(' + (x - d.ghost.ox) + 'px,' + (y - d.ghost.oy) + 'px,0) rotate(-1.5deg) scale(1.03)';
    d.target = gbDropOn(x, y);
    gbMark(d.target);
  }

  (function () {
    var board = $('#groupBoard');
    if (!board) return;

    board.addEventListener('pointerdown', function (e) {
      if (gbReadOnly()) return;                              // 已确认只读：不许拖
      if (e.button) return;                                  // 只认左键 / 触摸
      var chip = e.target.closest ? e.target.closest('.gb-chip') : null;
      if (!chip) return;
      if (e.target.closest('.gb-x')) return;                 // × 有它自己的点击
      var src = gbChipSource(chip);
      if (!src) return;
      gbDrag = { chip: chip, src: src, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false,
                 target: null, ghost: null, px: e.clientX, py: e.clientY, hit: null };
      gbMarkLast = null;                                     // 新的这一下从头开始记高亮
    });

    window.addEventListener('pointermove', function (e) {
      if (!gbDrag || e.pointerId !== gbDrag.id) return;
      var dx = e.clientX - gbDrag.x0, dy = e.clientY - gbDrag.y0;
      if (!gbDrag.active) {
        /* 8px 以内当「点一下」：手机上手指总要抖一两个像素，不能一动就算拖 */
        if (dx * dx + dy * dy < 64) return;
        gbDrag.active = true;
        gbDrag.ghost = gbGhostOf(gbDrag.chip, gbDrag.x0, gbDrag.y0);
        gbDrag.chip.classList.add('gb-lift');
        document.body.classList.add('gb-dragging');
        /* 拖起来就把之前的「点选」样子抹掉（这里不能整块重画，会把手里这张卡换掉） */
        gbPick = null; gbAddTo = -1;
        $$('.gb-chip.on').forEach(function (n) { n.classList.remove('on'); });
        $$('.gb-group.is-target').forEach(function (n) { n.classList.remove('is-target'); });
      }
      if (e.cancelable) e.preventDefault();
      /* 只记最新坐标；同一帧里后续的 move 覆盖它，不再各干一遍 DOM */
      gbDrag.px = e.clientX; gbDrag.py = e.clientY;
      if (!gbRaf) gbRaf = requestAnimationFrame(gbFrame);
    }, { passive: false });

    function endDrag(e, cancelled) {
      if (!gbDrag || e.pointerId !== gbDrag.id) return;
      var d = gbDrag;
      if (gbRaf) { cancelAnimationFrame(gbRaf); gbRaf = 0; }
      /* 抬手这一下还没跑到帧上：用抬起时的坐标补最后一帧，落点才是老师真正松手的位置 */
      if (d.active && d.ghost && !cancelled) {
        d.px = e.clientX; d.py = e.clientY;
        gbFrame();
      }
      gbDrag = null;
      if (d.ghost && d.ghost.el.parentNode) d.ghost.el.parentNode.removeChild(d.ghost.el);
      document.body.classList.remove('gb-dragging');
      d.chip.classList.remove('gb-lift');
      gbMark(null);
      if (!d.active) { gbTap(d.src); return; }
      gbSwallowClick = true;
      setTimeout(function () { gbSwallowClick = false; }, 30);
      if (cancelled) return;
      var cls = curClass();
      if (!cls) return;
      if (d.target && d.target.classList.contains('gb-group')) {
        var gi = +d.target.dataset.gi;
        if (d.src.kind === 'member') gbMoveTo(cls, d.src.gi, d.src.mi, gi);
        else gbJoin(cls, gbRowByKey(d.src.key), gi);
      } else if (d.target) {
        /* 拖回待分配区：只有组员需要处理，待分配的人拖回原处当作没动 */
        if (d.src.kind === 'member') gbUnassign(cls, d.src.gi, d.src.mi);
      }
    }
    window.addEventListener('pointerup', function (e) { endDrag(e, false); });
    window.addEventListener('pointercancel', function (e) { endDrag(e, true); });

    board.addEventListener('click', function (e) {
      if (gbSwallowClick) return;
      var cls = curClass();
      if (!cls) return;
      /* 顶部那颗常驻「✓ 确认分组」2026-11-13 已并入 #btnTeamFinish（在「学生自助选桌」那一行），
         看板上不再有按钮，这里的分支保留成空壳只为兼容旧缓存里的 DOM，不再需要就删。 */
      /* 组卡片头部的单组上限 ±（只改这一组） */
      var capUp = e.target.closest('[data-gcap-up]');
      if (capUp) { gbCapStep(cls, +capUp.dataset.gcapUp, 1); return; }
      var capDown = e.target.closest('[data-gcap-down]');
      if (capDown) { gbCapStep(cls, +capDown.dataset.gcapDown, -1); return; }
      /* 空组卡片上的「删除本组」 */
      var delG = e.target.closest('[data-gdel]');
      if (delG) { gbDeleteGroup(cls, +delG.dataset.gdel); return; }
      /* 看板顶部那条「撤销」：拖完人以后一键退回（结构和分数一起还原） */
      if (e.target.closest('[data-gb-undo]')) { gbUndoLast(); return; }
      /* 「撤回上一次分组」：整份快照还原（连成员顺序和个人扣分下标一起回去） */
      if (e.target.closest('[data-gb-snapundo]')) {
        var snapBack = lastGroupSnapshot(cls);
        if (snapBack) restoreGroupSnapshot(cls, snapBack);
        return;
      }
      var ex = e.target.closest('[data-exempt]');
      if (ex) { gbExempt(cls, +ex.dataset.exempt); return; }
      var ux = e.target.closest('[data-unexempt]');
      if (ux) { gbUnexempt(cls, +ux.dataset.unexempt); return; }
      var sp = e.target.closest('[data-split]');
      if (sp) { gbSplitOver(cls, +sp.dataset.split); return; }
      var xb = e.target.closest ? e.target.closest('.gb-x') : null;
      if (xb) { gbUnassign(cls, +xb.dataset.gi, +xb.dataset.mi); return; }
      if (e.target.closest('.gb-chip')) return;      // 点人已经在 pointerup 里处理过，别算两次
      var add = e.target.closest('.gb-add');
      if (add) {
        var gi = +add.dataset.add;
        var waiting = (gbRows || []).filter(function (x) { return x.g === null; }).length;
        if (!waiting) { flash('未分组区已经没人了：先把组里的人移回来；要添新同学请去首页「班级」面板加'); return; }
        gbAddTo = gbAddTo === gi ? -1 : gi;
        gbPick = null;
        gbRepaint();
        if (gbAddTo >= 0) flash('加人模式：点左边未分组区的同学，就会加进第 ' + cls.groups[gi].no + ' 组（再点一次「＋ 加人」退出）');
        return;
      }
      var card = e.target.closest('.gb-group');
      var pend = e.target.closest('.gb-pending');
      if (card && gbPick) {
        var toGi = +card.dataset.gi;
        if (gbPick.kind === 'member') gbMoveTo(cls, gbPick.gi, gbPick.mi, toGi);
        else gbJoin(cls, gbRowByKey(gbPick.key), toGi);
        return;
      }
      if (pend && gbPick && gbPick.kind === 'member') { gbUnassign(cls, gbPick.gi, gbPick.mi); return; }
      if ((card || pend) && (gbPick || gbAddTo >= 0)) { gbPick = null; gbAddTo = -1; gbRepaint(); }
    });

    /* 键盘也能用：Tab 到人身上，空格/回车选中，再 Tab 到组上回车 */
    board.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var chip = e.target.closest ? e.target.closest('.gb-chip') : null;
      if (!chip) return;
      e.preventDefault();
      var src = gbChipSource(chip);
      if (src) gbTap(src);
    });
  })();

  /* ---- 待分配页的交互 ---- */

  $('#poolClassSel').addEventListener('change', function () {
    S.ui.classId = this.value; S.ui.lessonId = null; save(); renderPool(); renderTeamCard();
  });
  /* 2026-11-13 删除「明细」工具条（仅未分组/全部/仅已分组 + 搜索）与「名单明细」表：
     用户说这两块没用 —— 分组看板已经把人和组都摆齐了，下拉分配/移出/删除都走看板上的按钮。 */

  /* 掉队归位 / 撤回上一次分组（2026-11-08）。容器里的按钮是 renderPoolFix 每次重画的，
     所以用事件委托，不在每次重画后重新绑。 */
  if ($('#poolFixRow')) {
    $('#poolFixRow').addEventListener('click', async function (e) {
      var cls = curClass();
      if (!cls) return;
      if (e.target.closest('#btnRestoreDropped')) {
        var rows = droppedWithHome(cls);
        if (!rows.length) return;
        var back = await askConfirm({
          title: '把这 ' + rows.length + ' 人放回原来的组？',
          body: '按记分表里原来所在的组放回去。\n' +
            '· 一个学生都不会被删；原组号没了的会自动补一个空组，那一组的历史小组分照样挂在原组号上\n' +
            '· 他们的个人扣分、个人项目分原样留着，不会被清掉\n' +
            '· 放回去以后还能照常拖动调整，也可以撤回',
          ok: '放回去'
        });
        if (!back) return;
        var res = restoreDroppedToHome(cls);
        flash('已把 ' + res.moved + ' 人放回原来的组');
        renderPoolBanner(cls);
        if (res.moved) showRestoreDetail(cls, res.rows);
        return;
      }
      if (e.target.closest('#btnRollbackGroup')) {
        var snap = lastGroupSnapshot(cls);
        if (!snap) return;
        var undo = await askConfirm({
          title: '撤回上一次分组？',
          body: '「' + snap.label + '」\n' +
            '组结构、每组顺序、个人扣分和个人项目分都会整份还原到这次分组之前。',
          ok: '撤回'
        });
        if (!undo) return;
        restoreGroupSnapshot(cls, snap);
        renderPoolBanner(cls);
      }
    });
  }

  /** 从全班名单取某人的班内序号 */
  function studentNo(cls, name, sid) {
    var hit = rosterOf(cls).filter(function (r) {
      return r.name === name && (!sid || !r.sid || String(r.sid) === String(sid));
    })[0] || rosterOf(cls).filter(function (r) { return r.name === name; })[0];
    return hit ? hit.no : null;
  }

  /* ================= 学生自助选桌组队（教师端） =================
     老师在库里开一个「组队房间」（桌数 + 每桌人数），学生用学号账号打开
     team.html，点一张圆桌就算加入那个组。教师端每 2 秒拉一次看板，
     随时能看到谁坐哪桌、谁还没选；点「按选座确认分组」把选座结果写回
     本班分组（组号 = 桌号），之后照常加分。

     房间只存在云端两张表里，读写全走 security definer 函数（见
     supabase/2026-11-03-学生选组.sql），所以没登录的人碰不到数据。 */

  var tmRoom = null;      // jf_team_room 的结果
  var tmState = null;     // jf_team_state 的结果
  var tmTimer = null;
  var tmBusy = false;
  var tmSig = '';         // 上次画出来的内容指纹，没变就不重画（免得把老师正在点的下拉框刷掉）

  function tmOn() { return !!(CLOUD_ON && CLOUD && CLOUD.rpc); }

  /** 这套班在云端的班级 id（组队函数都要它；没有就说明还没对应首页班级） */
  function tmClassId(cls) {
    var id = cls && cls.hxClassId;
    return id ? Number(id) : 0;
  }

  function tmStop() { if (tmTimer) { clearInterval(tmTimer); tmTimer = null; } }

  function tmStart() {
    tmStop();
    tmTimer = setInterval(function () {
      if (document.hidden || view !== 'pool' || tmBusy) return;
      tmPull();
    }, 2000);
  }

  /* 2026-11-12 实时性补强：切回标签页 / 窗口重新拿到焦点时立刻拉一次，
     别让老师干等那 2 秒，也别出现「学生明明已经选了、老师这边还停在旧数字」的错觉。
     （浏览器会把后台标签页的 setInterval 节流到 1 分钟以上，回来时的第一次刷新必须主动补。） */
  function tmKick() {
    if (view === 'pool' && tmOn() && tmClassId(curClass())) tmPull();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tmKick(); });
  window.addEventListener('focus', tmKick);
  window.addEventListener('pageshow', function (e) { if (e.persisted) tmKick(); });

  /** 记分页每次加减分都会重画，这里每班只静默拉一次座位：拉到了统计和横幅才和看板同一个口径 */
  function tmMaybePull(cls) {
    if (!cls || !tmOn() || !tmClassId(cls) || tmTried[cls.id]) return;
    tmTried[cls.id] = true;
    tmPull();
  }

  function tmPull() {
    var cls = curClass();
    if (!cls || !tmOn() || !tmClassId(cls)) { tmRoom = null; tmState = null; tmSeatClass = null; tmPaint(); return Promise.resolve(); }
    var cid = tmClassId(cls), r = tmRoom && tmRoom.room ? tmRoom.room : null;
    return CLOUD.rpc('jf_team_room', { p_class: cid }).then(function (room) {
      tmRoom = room || { room: null };
      if (!tmRoom.room) { tmState = null; return null; }
      return CLOUD.rpc('jf_team_state', { p_room: Number(tmRoom.room) }).then(function (st) { tmState = st; });
    }).then(function () {
      tmBusy = false;
      tmSeatClass = tmState ? cls.id : null;
      /* 座位变了要连带重画统计和待分配名单：统计把「坐在桌上的人」算已分配，
         否则看板已经刷新成 59/59，下面还停在旧的 52/7。 */
      var sig = JSON.stringify((tmState && tmState.seats || []).map(function (s) { return [s.no || '', s.name, s.table]; }));
      if (sig !== tmSeatSig) {
        tmSeatSig = sig;
        if (view === 'pool') renderPool();
        else if (view === 'score') renderPoolBanner(curClass());
        updatePoolBadge();   /* 选座数据到位后，页签「未分组 N 人」角标也要重算，否则停在旧数字 */
      }
      tmPaint();
    }).catch(function (e) {
      tmBusy = false;
      var msg = (e && e.message) || '读取失败';
      if (/could not find|does not exist|schema cache/i.test(msg)) {
        msg = '云端还没装组队功能：需要在 Supabase 控制台执行 supabase/2026-11-03-学生选组.sql。';
      }
      tmRoom = null; tmState = null; tmSeatClass = null;
      flash(msg);
      tmButtons(null);
    });
  }

  /** 常驻状态条（#tmStatus）中央写入：分组页标题下面那行「学生自助选桌 · 当前状态」 */
  function tmSt(txt, tone) {
    var el = $('#tmStatus');
    if (!el) return;
    el.textContent = txt;
    el.setAttribute('data-st', tone || 'none');
  }

  /** 两个按钮的显隐与文案跟着房间状态走（2026-11-12 V1：四按钮精简成两按钮） */
  function tmButtons(room) {
    var open = $('#btnTeamOpen'), link = $('#teamLink');
    var st = room ? room.status : 'none';
    /* 2026-11-12 修「确认分组后按钮不消失」：fin（确认分组）只在「有还没确认的选座」时显示。
       确认成功后把当前座位指纹记进 cls.seatAppliedSig，下一轮 tmButtons 一比对，
       发现没有新座位就把按钮藏起来，给老师一个「已经确认过了」的反馈；
       学生之后又改座（指纹变了）按钮会重新出现，提醒老师再确认一次。 */
    var csNow = curClass();
    var seatCnt = tmState && (tmState.seats || []).length;
    var pendingSeats = seatCnt > 0 && tmSeatSig !== (csNow && csNow.seatAppliedSig);

    /* V1 精简：原来「开放组队 / 停止组队 / 继续组队 / 结束」四个按钮，合并成 open 一个切换按钮：
       - 没房间（st=none）或已结束（closed）→ 显示「开放组队」（主按钮，点它开新房间）
       - 组队中（open）→ 显示「停止组队」（点它停止，再点一次「继续组队」恢复）
       - 已停止（locked）→ 显示「继续组队」
       原「结束」动作并进「停止组队」的二次确认（见 btnTeamOpen 的 click 处理）。 */
    /* 2026-11-13（用户：「完全不需要停止组队逻辑 … 开放组队即可以移动 确认分组就是更新计分表」）：
       这颗按钮只剩一个动作 —— 开放组队（开一场新房间，学生就能选座 / 换座）。
       「停止组队 / 继续组队 / 结束」三个状态连同锁定分组一起删掉了；
       确认分组时会把这一场自动收掉，学生就不能再动了，想再动就再点一次开放组队。 */
    /* 2026-11-13 第三轮：两颗按钮合体成一颗（用户原话：「这两个按钮本组合体为一个按钮转换
       比如按下开放后变成确认按钮 颜色区分不一样 然后确认后又变成开放，这样一目了然是开放还是确认了。
       确认了学生端就是只读状态」）。
         · 没开放 / 已确认收工（none / closed）→ 青绿主色「开放组队」
         · 正在组队（open）               → 橙色「✓ 确认分组」
       点确认做的事没变（按桌号写进记分表 + 把这一场收掉），只是不再需要老师分辨该点哪颗。 */
    var canConfirm = st === 'open';
    open.hidden = false;
    open.disabled = false;
    open.classList.toggle('primary', !canConfirm);
    open.classList.toggle('confirm', canConfirm);
    open.textContent = canConfirm ? (pendingSeats ? '✓ 按选座确认分组' : '✓ 确认分组') : '开放组队';
    open.title = canConfirm
      ? (pendingSeats
        ? '把这 ' + (seatCnt || 0) + ' 人的选座按桌号写进记分表；确认后这一场收工、学生端转只读'
        : '清掉空组、把组号重排成 1、2、3…，并把未分组的人平均填进去；确认后学生端转只读')
      : '开放一场新的选座房间，学生用学号账号进来就能选座、换座';

    link.hidden = !room || st === 'closed';
    if (room && room.room) {
      link.href = 'team.html?r=' + room.room;
      link.hidden = false;
    }

    /* 常驻状态条（2026-11-12）：老师最想问的两件事在这里一次说清 —— 现在到底开没开、
       已经坐了几个人。顺带在开房时把折叠的「选座实况」自动展开，免得学生都在选座了，
       老师还盯着一块折叠条以为没反应。 */
    var seatN = (tmState && (tmState.seats || []).length) || 0;
    var rostN = (tmState && (tmState.roster || []).length) || 0;
    var seg = st === 'open' ? '组队中 · 学生可以选座；要收工就点右边那颗橙色的「确认分组」'
      : st === 'closed' ? '已确认 · 学生端只读（想再调整就点「开放组队」重新开一场）' : '未开放';
    var txt = seg;
    if (room && rostN) txt += ' · 已坐 ' + seatN + '/' + rostN + ' 人';
    else if (room) txt += ' · 第 ' + room.room + ' 号房间';
    tmSt(txt, st || 'none');
  }

  /* 2026-11-13：删掉「选座实况」看板（用户：「这里的界面完全冗余 被上面卡片式完全替代了 直接彻底删除」）。
     tmPaint 现在只干两件事：把「开放组队 / 确认分组」两颗按钮的状态刷新出来、
     把状态条那句「组队中 · 已坐 x/y 人」写好。谁坐了哪桌已经由分组卡片本身体现（确认后就进组了）。 */
  function tmPaint() {
    var cls = curClass();
    if (!tmOn()) { tmButtons(null); tmSt('需要登录后才能开放组队', 'warn'); return; }
    if (!tmClassId(cls)) { tmButtons(null); tmSt('本班还没对应首页班级，开放不了', 'warn'); return; }
    tmButtons(tmRoom && tmRoom.room ? tmRoom : null);
  }

  function renderTeamCard() {
    tmSig = '';
    if (!tmOn() || !tmClassId(curClass())) { tmStop(); tmPaint(); return; }
    tmPull();
    tmStart();
  }

  /* ---- 教师端组队按钮 ---- */

  /* 2026-11-13 第三轮：这一颗按钮按房间状态切换两种动作 ——
       组队中(open) 点它 = 确认分组（原来 #btnTeamFinish 的活）；
       其它状态     点它 = 开放组队（下面那段原有逻辑）。
     「停止组队 / 继续组队 / 结束」三个动作已经在第二轮删掉了。 */
  $('#btnTeamOpen').addEventListener('click', function () {
    if (tmBusy) return;
    var cls0 = curClass();
    if (tmRoom && tmRoom.room && tmRoom.status === 'open' && cls0) {
      var seatCnt0 = tmState && (tmState.seats || []).length;
      var pending0 = seatCnt0 > 0 && tmSeatSig !== cls0.seatAppliedSig;
      if (pending0) tmApplySeating();       // 有还没确认的选座 → 按桌号写进记分表
      else gbConfirmGroups(cls0);           // 没选座 → 清空组 + 组号重排 + 平均填人
      return;
    }
    var cls = curClass();
    if (!cls || !tmOn()) { alert('先登录再来开放组队。'); return; }
    if (!tmClassId(cls)) { alert('这个班还没对应首页班级，先在「数据与同步」页对应。'); return; }
    /* 2026-11-08：桌数 / 每桌人数不再偷偷用 10 / 6 兜底。用户说得很清楚：
       「默认好像是10组6人 我一旦不小心点错了 就会抹除我部分同学」——所以没填就是没填，
       这里只把光标推到那两个输入框上，不替老师决定任何数字。
       （2026-11-12：控件已经搬到「开放组队」按钮旁边，不再需要展开折叠区，
        所以从 openTeamMore() 换成直接 focus，少一次滚动。） */
    /* 2026-11-13：桌数 / 每桌人数直接取上面「分几组 / 每组上限」，不再有第二个输入框。 */
    var tables = Math.max(1, Math.min(40, Math.round((cls.groups || []).length || 0)));
    var size = classGroupLimit(cls) || 0;
    if (!tables || !size) {
      flash('先在上面「分几组 / 每组上限」里填好数字，再来开放组队。');
      var miss = $('#groupCount');
      if (miss && miss.focus) miss.focus();
      return;
    }
    cls.teamTables = tables;
    /* 「每桌人数」只是上限：重开房间时，上一场已经选好的座位必须原样搬过来。
       以前 jf_team_open 只新建房间，座位按 room_id 挂在旧房间上，看板只读最新一间，
       于是老师把 6 改成 7 再点「开放组队」，全班座位一夜之间全看不见了（数据还在旧房间里）。
       2026-11-13：用户要「一键开放，保留现有分组」——不弹任何确认，默认沿用上一场座位
       （桌号不变只改上限），不清空任何已分组的学生。 */
    var old = (tmRoom && tmRoom.room && tmState && tmSeatClass === cls.id && (tmState.seats || []).length)
      ? tmState.seats.map(function (s) { return { student: Number(s.student), name: s.name, table: Number(s.table) || 0 }; })
      : [];
    var keep = old;
    cls.groupLimit = size;    // 确认之后才记上限：每桌人数同时作为本班「每组上限」，两处口径一致
    tmBusy = true;
    if (keep.length) flash('正在沿用上一场 ' + keep.length + ' 个座位…');
    CLOUD.rpc('jf_team_open', { p_class: tmClassId(cls), p_tables: tables, p_size: size })
      .then(function (res) {
        var room = (res && res.room) || null;
        return tmCarrySeats(room, keep, room ? Number(res.tables) || tables : tables, room ? Number(res.size) || size : size)
          .then(function (carried) {
            tmBusy = false;
            addOperationLog('组队', cls.name + ' · 开放组队：' + tables + ' 桌 × ' + size + ' 人' +
              (keep.length ? '，沿用上一场 ' + carried.moved + '/' + keep.length + ' 个座位' +
                (carried.lost ? '（' + carried.lost + ' 人放不下，回到待选）' : '') : '') +
              (res && res.accounts != null ? '（本班 ' + res.accounts + ' 人有学号账号）' : ''));
            save(false);
            flash('已开放组队：' + tables + ' 桌 × 每桌最多 ' + size + ' 人' +
              (carried.moved ? '，沿用上一场 ' + carried.moved + ' 个座位' : '') +
              (carried.lost ? '；' + carried.lost + ' 人因为每桌人数变少还没坐下' : '') + '。');
            return tmPull();
          });
      })
      .catch(function (e) { tmBusy = false; alert('没开成：' + ((e && e.message) || '未知错误')); });
  });

  /* 2026-11-13：「圆桌数 / 每桌最多」两个输入框删了（和「分几组 / 每组上限」完全重复），
     它们各自的 change 监听一并删掉；改上面那两个框就会直接生效。 */

  /** 把上一场已选好的座位搬到新房间：桌号不变，桌数/每桌人数不够的人留在待选。
      走的是老师专用的 jf_team_place，所以不必等云端加新函数也能生效。 */
  function tmCarrySeats(room, seats, tables, size) {
    if (!room || !seats.length) return Promise.resolve({ moved: 0, lost: 0 });
    var per = Object.create(null), moved = 0, lost = 0;
    return seats.reduce(function (chain, s) {
      return chain.then(function () {
        var t = s.table > 0 ? Math.min(s.table, tables) : 0;
        if (!t) { lost++; return; }
        per[t] = per[t] || 0;
        if (per[t] >= size) { lost++; return; }
        return CLOUD.rpc('jf_team_place', { p_room: Number(room), p_student: s.student, p_table: t })
          .then(function () { per[t]++; moved++; })
          .catch(function () { lost++; });
      });
    }, Promise.resolve()).then(function () { return { moved: moved, lost: lost }; });
  }

  /* 2026-11-13：停止组队 / 继续组队 / 结束这一轮 三个动作连同它们的对话框全部删除
     （用户：「完全不需要停止组队逻辑 … 教师就算有学生没分组完成 也可以确认分组
       待分组的学生等老师再次点开放组队即可继续移动」）。
     现在只剩下面这个「收工」：**确认分组成功后自动调一次**，把这一场收掉，
     学生端变只读；想再让大家动，就再点一次「开放组队」。 */
  function tmCloseRoom() {
    if (!tmRoom || !tmRoom.room) return Promise.resolve();
    return CLOUD.rpc('jf_team_close', { p_room: Number(tmRoom.room) })
      .then(function () { return tmPull(); })
      .catch(function () { return null; });
  }

  /* 把选座结果写回本班分组：桌号 = 组号，桌上的人 = 这组的人 */
  function tmApplySeating() {
    var cls = curClass();
    var st = tmState;
    /* 2026-11-10 修「按选座确认分组后没反应」：原来这里 alert，iframe 里原生弹窗可能被吞，
       老师点了确认却什么提示都没有。改用 flash（toast）给出页面内可见的原因，并把
       「没对应首页班级」「没开过组队」两种最常踩的坑分开说清。 */
    if (!cls) { flash('先选一个班级。'); return; }
    if (!tmClassId(cls)) { flash('这个班还没对应首页班级：先到「数据与同步」页把本班对应到首页同名的班，学生选座才拉得回来。'); return; }
    if (!st || !(st.seats || []).length) {
      flash('这个班还没有学生选桌（或选座数据没拉回来）：先展开「学生自助选桌」点「开放组队」，把「学生入口」链接发群里让学生选桌。');
      return;
    }
    var seats = st.seats.slice();
    var byTable = {};
    seats.forEach(function (s) {
      var t = Number(s.table);
      if (t) (byTable[t] = byTable[t] || []).push(s);
    });
    var tables = Object.keys(byTable).map(Number).sort(function (a, b) { return a - b; });
    if (!tables.length) { flash('还没有学生选桌（选座数据里没有有效的桌号）。'); return; }

    var seatNo = Object.create(null), seatName = Object.create(null), seatByName = Object.create(null);
    seats.forEach(function (s) {
      if (s.no) seatNo[String(s.no)] = s;
      seatName[s.name] = (seatName[s.name] || 0) + 1;
      seatByName[s.name] = s;
    });
    function isSeated(m) {
      if (!m || !m.name) return false;
      if (m.sid && seatNo[String(m.sid)]) return true;
      if (seatName[m.name] === 1) {
        var hit = seatByName[m.name];
        return !m.sid || !hit.no;    // 只有一方没学号时才靠唯一姓名认
      }
      return false;
    }

    /* 原来这里是原生 confirm，但 iframe 里 confirm 可能被吞（用户报过「按选座确认分组没反应」）。
       改用全站统一弹窗 hxConfirm（ui-dialog.js，可拖拽/缩放，按钮跟主题色走）：把「确认后执行」
       的整段逻辑收进 doSeatApply，点「确认分组」才跑，取消只关窗。整段逻辑原样搬进来，
       snap / beforeSeat / keep / moved 这些变量一个都没动。 */
    function doSeatApply() {
      /* 2026-11-08 分数迁移：拍一张「组号 → 第几个人是谁」的快照，重建完再按身份写回。
         原来这里会把整组 personal 清空（上面那句提示就是证据），用户说的
         「分完组之后我之前弄的加分全部丢失了基本上」有一半是这个操作造成的。 */
      var snap = scoreLayoutSnapshot(cls);
      /* 这个动作最容易「人掉出去」：没来选座的人会回到待分配。所以动手前留一份完整快照，
         动完再拿「分之前几个人/几个组」对一次账，少了人立刻红字拦住（团队在 26工器1 班
         看到的 49 人只剩 29 人，就是从这类操作开始的）。 */
      var beforeSeat = JSON.parse(JSON.stringify(cls.groups));
      pushGroupSnapshot(cls, '按选座确认分组：第 ' + tables.join('、') + ' 桌');

      /* 保住原来的成员对象，好让组长标记（leaderKey）和按 id 记的个人项目分不失联 */
      var keep = Object.create(null), keepByName = Object.create(null);
      cls.groups.forEach(function (g) {
        g.members.forEach(function (m) {
          if (!m.name) return;
          var k = studentKeyOf(m);
          if (!keep[k]) keep[k] = m;
          /* 只有全班唯一同名时才敢用姓名回查（同名学生绝不靠名字配对） */
          keepByName[m.name] = keepByName[m.name] ? 'DUP' : m;
        });
      });

      var moved = 0;
      cls.groups.forEach(function (g) {
        for (var i = g.members.length - 1; i >= 0; i--) {
          if (isSeated(g.members[i])) { removeMemberAt(cls, g, i); moved++; }
        }
      });

      var made = 0, filled = 0, toPending = 0;
      tables.forEach(function (t) {
        var g = groupOf(cls, t);
        if (!g) { g = { id: uid('g'), no: t, members: [] }; cls.groups.push(g); made++; }
        toPending += g.members.filter(function (m) { return !!m.name; }).length;
        while (g.members.length) removeMemberAt(cls, g, g.members.length - 1);
        byTable[t].forEach(function (s) {
          var old = (s.no && keep['s:' + s.no]) || (seatName[s.name] === 1 ? keepByName[s.name] : null);
          if (old === 'DUP') old = null;
          pushMember(g, {
            id: (old && old.id) || uid('m'),
            name: s.name,
            sid: (old && old.sid) || (s.no ? String(s.no) : ''),
            no: old && old.no != null ? old.no : studentNo(cls, s.name, s.no ? String(s.no) : '')
          });
          filled++;
        });
        if (g.leaderKey && !g.members.some(function (m) { return memberKey(m) === g.leaderKey; })) delete g.leaderKey;
      });

      /* 重建完按身份把个人扣分迁回去；对不上的（比如人已经从名单里删掉）会报数，不清零。
         个人项目分（leaderScores）同理，按成员键搬到现在所在的组号下面。 */
      var unmatched = realignPersonalScores(cls, snap);
      var leaderOut = realignLeaderScores(cls, snap);
      var seatSize = Number((tmState && tmState.size) || (tmRoom && tmRoom.room && tmRoom.size) || 0);
      if (seatSize >= 2) cls.groupLimit = Math.min(40, seatSize);

      addOperationLog('分组', cls.name + ' · 按选座确认分组：第 ' + tables.join('、') + ' 桌 ' + filled +
        ' 人写成 ' + tables.length + ' 组' + (made ? '（新建 ' + made + ' 组）' : '') +
        (toPending ? '，' + toPending + ' 人回到未分组' : ''));
      /* 按桌号重建完顺手清掉空组、把组号重排成 1..N —— 否则首页一直挂着「第 10–13 组全空」的占位。
         必须在 save() 之前，不然压缩结果要等下一次手动保存才落地。
         组号重复时压缩会整体中止（见 applyCompress）：这里先看一眼，好在下面那句提示里把原因说清楚 ——
         否则 applyCompress 的 flash 会被这句顶掉，老师只看到「已确认分组」。 */
      var dupNo = compressBlockedByDup(cls);
      var squeezed = dupNo ? false : compressEmptyGroups(cls, '按选座确认分组后清理空组');
      /* 2026-11-12 修「确认分组后按钮不消失」：把这批刚消化掉的座位指纹记下来，
         tmButtons 下次比对发现「没有新座位」，就把「按选座确认分组」按钮藏起来。
         顺手 tmPaint() 一次，让按钮当场消失，不用等下一次 2 秒轮询。 */
      cls.seatAppliedSig = tmSeatSig;
      save(); renderPool(); renderScore(); renderPoolBanner(cls);
      if (typeof tmPaint === 'function') tmPaint();
      /* 2026-11-13：确认分组 = 这一轮收工。座位已经写进记分表了，房间顺手关掉，
         学生端就不能再动了；还有没分完的人，老师再点一次「开放组队」他们就能继续移。 */
      tmCloseRoom();

      var rest = pendingList(cls).length;
      flash('已按选座写成 ' + tables.length + ' 组（' + filled + ' 人）' +
        (squeezed ? '，清掉 ' + squeezed.removed + ' 个空组、组号已重排' : '') +
        (dupNo ? '；这个班有重复组号，空组没自动清理，先到分组页把重复的组删掉' : '') +
        (rest ? '，还剩 ' + rest + ' 人未分组，拖进组就行' : '，全班都分好了'));
      reportScoreMigration({ personal: unmatched, leader: leaderOut });
      reportGroupChange(cls, beforeSeat, '按选座确认分组');
    }

    var dlgTxt =
      '把第 ' + tables.join('、') + ' 桌共 ' + seats.length + ' 人，写成 ' + tables.length + ' 组（组号＝桌号）。\n\n' +
      '· 这几个组会按选座重建：原来在这几个组、但这节课没来选座的人，会回到未分组\n' +
      '· 没坐人的桌（组）一律不动\n' +
      '· 记过的分按学生身份跟着人走（个人扣分不再清空）\n\n' +
      '确认前建议先到华夏工具首页「全站备份」导出一份。';
    askConfirm(dlgTxt, { title: '按选座确认分组', okText: '确认分组', cancelText: '取消' })
      .then(function (ok) { if (ok) doSeatApply(); });
  }

  /* 2026-11-13：这颗按钮现在是「确认分组」的唯一入口（另一颗是上面的「开始组队」），按状态分发：
       · 有还没确认的选座 → tmApplySeating（按桌号写进记分表）
       · 没有 → gbConfirmGroups（清空组 + 组号重排 1..N + 把未分组的人平均填进去）
     判断口径和 tmButtons 里给按钮换文案的那段完全一致，避免「按钮写着按选座确认、
     点下去却在整理空组」这种错位。 */
  /* 2026-11-13 第三轮：#btnTeamFinish 这颗按钮已经并进 #btnTeamOpen（那颗按钮按状态变身），
     HTML 里的节点也删了 —— 所以这里原来那条 addEventListener 必须一起删掉，
     否则 $('#btnTeamFinish') 取到 null、addEventListener 抛异常，整页初始化全废
     （今天已经因为同类问题出过一次线上空白，别再犯）。 */

  /* 2026-11-13：看板（#teamBoard）连同「移出某人 / 帮他放桌」两个操作一起删掉了 ——
     用户说那块「完全冗余 被上面卡片式完全替代」。座位在分组看板上拖一下就行。 */

  /* ---- 分组向导：按组数 / 按每组人数 / 按选座 / 手动拖拽（2026-11-08 重做） ----
     用户原话：「分组不要设默认预设 就点分组弹窗选项卡 让老师先选分几组和一组多少人」
     「如果和旧分组压缩了 也要提示确认 超出的人标红 但是不移除原来组」。
     所以：
     ① 这里一个默认人数都没有（原来 value="10"/"6" 全部拆掉），没填就让按钮是灰的；
     ② 任何会打散现有分组的动作，先算一份「影响清单」再 confirm，确认前一个字都不改；
     ③ 重排只增不删人：计划里的每个学生都会落进某个组，绝不会因为组数变少被抹掉。 */

  /** 这个组在历史课次里有没有记分痕迹（有痕迹的空组不删，免得丢历史） */
  function groupHasHistory(cls, gno) {
    return (S.lessons || []).some(function (l) {
      if (l.classId !== cls.id) return false;
      return !!(l.scores && l.scores[String(gno)]) || !!(l.leaderScores && l.leaderScores[String(gno)]);
    });
  }

  /** 人数夹到 2–40。**没填就返回 0**，绝不偷偷当 6 用 —— 用户说的「默认好像是10组6人」就是这条。 */
  function clampLimit(v) {
    var n = Math.round(Number(v) || 0);
    return n >= 2 ? Math.min(40, n) : 0;
  }

  /** 每组几人 → 每组实际分几人。
      老师选 7 人就是想 7 个人坐一桌，所以按 size 装满，最后剩几个算一组；
      只有「剩下来的人太少」（不到半组）时才回头摊平，免得出现 1–2 人的残组。
      49 人 ÷ 6 → 8 组 6 人 + 剩 1 人（太少）→ 摊平成 4 组 6 人 + 5 组 5 人；
      47 人 ÷ 7 → 6 组 7 人 + 1 组 5 人。 */
  function planSizes(total, size) {
    size = clampLimit(size) || GROUP_CAP;
    if (!total) return [];
    var full = Math.floor(total / size), rem = total % size, out = [], i;
    if (!rem) {
      for (i = 0; i < full; i++) out.push(size);
      return out;
    }
    if (rem < size / 2) {
      var n = full + 1, base = Math.floor(total / n), rest = total % n;
      for (i = 0; i < n; i++) out.push(base + (i < rest ? 1 : 0));
      return out;
    }
    for (i = 0; i < full; i++) out.push(size);
    out.push(rem);
    return out;
  }

  /** 分几组 → 每组几人（尽量平均，前面几组多 1 个）。人数不够时会出现空组，调用方负责提示。 */
  function planByCount(total, groups) {
    groups = Math.max(1, Math.min(40, Math.round(Number(groups) || 0)));
    if (!total) return [];
    var base = Math.floor(total / groups), rest = total % groups, out = [];
    for (var i = 0; i < groups; i++) out.push(base + (i < rest ? 1 : 0));
    return out;
  }

  /** 名单行 → 重排用的人。不做去重之外的花样，sid/no 原样带过去。 */
  function regroupPerson(r) {
    return { name: r.name, sid: r.sid || '', no: r.no == null ? null : r.no };
  }

  /** 「全班重排」用的人 = 全班名单 + 已经在组里但不在名单上的历史组员。
      用户要求「不能被静默抹掉」，所以历史组员也一起参与重排，不会凭空消失。 */
  function regroupPool(cls) {
    var out = [], seen = Object.create(null);
    rosterOf(cls).forEach(function (r) {
      if (!r.name) return;
      var k = r.sid ? 's:' + r.sid : 'n:' + r.name + '#' + (r.no == null ? '' : r.no);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(regroupPerson(r));
    });
    cls.groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        var k = studentKeyOf(m);
        if (seen[k]) return;
        seen[k] = 1;
        out.push(regroupPerson(m));
      });
    });
    out.sort(function (a, b) {
      var x = a.no == null ? 1e9 : a.no, y = b.no == null ? 1e9 : b.no;
      if (x !== y) return x - y;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
    return out;
  }

  /** 打乱（Fisher–Yates）。随机分只是换个顺序，人一个不少。 */
  function shuffleInPlace(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** 人数计划 → 一组一筐人 */
  function bucketsByPlan(pool, plan) {
    var out = [], at = 0;
    plan.forEach(function (n) { out.push(pool.slice(at, at + n)); at += n; });
    return out;
  }

  /** 这次重排会动到哪些组、影响多少人 —— 确认框里的人话全靠它。
      用户要的是「明确写出会动到哪几个组、影响几个人、谁会被移出」。 */
  function regroupImpact(cls, planArr) {
    var cur = cls.groups.filter(function (g) { return memberCount(g) > 0; })
      .sort(function (a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0); });
    return {
      affected: cur.slice(0, planArr.length).map(function (g) { return '第' + g.no + '组'; }),
      emptied: cur.slice(planArr.length).map(function (g) { return '第' + g.no + '组'; }),
      people: planArr.reduce(function (a, b) { return a + b; }, 0),
      groups: planArr.length
    };
  }

  /** 整班重排的二次确认。resolve true 才允许动手，一个字都不改。
      注意（2026-11-13）：改成悬浮确认框后返回的是 Promise<boolean>，调用方要 await / .then，
      不能再当同步 boolean 用。当前本文件已没有调用点（重排改走分组向导）。 */
  function confirmRegroup(cls, planArr) {
    var imp = regroupImpact(cls, planArr), lo = Math.min.apply(null, planArr), hi = Math.max.apply(null, planArr);
    var first = '要把 ' + imp.people + ' 人重新分成 ' + imp.groups + ' 组（每组 ' + (lo === hi ? lo : lo + '–' + hi) + ' 人）。';
    var lines = [];
    if (imp.affected.length) lines.push('· 会重排：' + imp.affected.join('、') + '（组里的人会被打散）');
    if (imp.emptied.length) lines.push('· 会空出来：' + imp.emptied.join('、') + '（有历史记分的组只清空、不删除，分数还挂在原组号上）');
    lines.push('· 一个学生都不会被删掉；记过的分按学生身份跟着人走。');
    return askConfirm({
      title: '重新分成 ' + imp.groups + ' 组？',
      body: first + '\n\n' + lines.join('\n'),
      note: '建议先到华夏工具首页「全站备份」导出一份。',
      ok: '重新分组'
    });
  }

  /* ---- 分组结果核对（2026-11-08 追加） ----
     团队在现场看到的是：49 人的班、4015 分都在，但只剩 5 个组 29 人 —— 20 个人掉进了待分配。
     老师不会去数「组里还有几个人」，只会觉得「我的分没了」。所以每次自动分组/按选座确认/
     删组以后都要当场对账，人头少了就用红字拦住，并给出「放回原组」和「撤回上一次分组」两条后路。 */

  /** 从历史记分倒推谁有原组可回 —— 只用来在报账里写「其中 N 人可以一键放回」。 */
  function restorableCount(cls) {
    try { return droppedWithHome(cls).length; } catch (e) { return 0; }
  }

  /** 弹一张红字对账单。rep 来自 reconcileGroups()。 */
  function showGroupReport(cls, rep) {
    var d = $('#dlgGroupReport');
    if (!d || !rep) return;
    /* 分组向导弹窗还开着的话先关掉：两层模态叠在一起，老师会以为卡住了 */
    var wiz = $('#dlgGroup');
    if (wiz && wiz.open) wiz.close();
    var lost = rep.before.people - rep.after.people;
    var names = rep.dropped.map(function (x) { return x.name; });
    var show = names.slice(0, 12);
    var more = names.length - show.length;
    var canBack = restorableCount(cls);
    var snap = lastGroupSnapshot(cls);
    $('#grTitle').textContent = lost > 0 ? '分组结果：少人了' : '分组结果核对';
    $('#grBody').innerHTML =
      '<p class="gr-flow">分之前：<b>' + rep.before.groups + '</b> 个组 · <b>' + rep.before.people + '</b> 人' +
        '<span class="gr-arrow">→</span>分之后：<b>' + rep.after.groups + '</b> 个组 · <b class="' +
        (lost > 0 ? 'gr-bad' : '') + '">' + rep.after.people + '</b> 人' +
        (lost > 0 ? '（少了 <b class="gr-bad">' + lost + '</b> 人）' : '') + '</p>' +
      (lost > 0
        ? '<div class="gr-warn"><p><b>有 ' + names.length + ' 人掉出了原来的组</b>，现在躺在「未分组」里：</p>' +
          '<p class="gr-names">' + show.map(esc).join('、') + (more > 0 ? ' 等 ' + names.length + ' 人' : '') + '</p>' +
          '<p class="note">记住：他们的分数没有被清掉，只是人不挂在任何一个组下面了。' +
          (canBack ? '其中 <b>' + canBack + '</b> 人能从上过课的记分表里认出原来的组，可以一键放回去。' : '') +
          '</p></div>'
        : '<p class="note">人数对得上：一个学生都没掉。</p>');
    var btns = [];
    /* 撤回优先：整份快照比逐个放回去更彻底（连成员顺序、个人扣分下标一起回到原样） */
    if (snap) btns.push('<button type="button" class="btn" id="grRollback">撤回这一次（' + esc(snap.label) + '）</button>');
    if (canBack) btns.push('<button type="button" class="btn primary" id="grRestore">把掉出的人放回原组（' + canBack + ' 人）</button>');
    btns.push('<button type="button" class="btn ghost" id="grOk">知道了</button>');
    $('#grBtns').innerHTML = btns.join('');
    $('#grOk').addEventListener('click', function () { d.close(); });
    if ($('#grRollback')) $('#grRollback').addEventListener('click', function () {
      d.close();
      if (restoreGroupSnapshot(cls, snap)) renderPoolBanner(cls);
    });
    if ($('#grRestore')) $('#grRestore').addEventListener('click', function () {
      d.close();
      var res = restoreDroppedToHome(cls);
      flash('已把 ' + res.moved + ' 人放回原来的组');
      renderPoolBanner(cls);
      if (res.moved) showRestoreDetail(cls, res.rows);
    });
    if (!d.open) openDlg(d);
  }

  /** 归位明细：逐条写「谁 → 第几组 · 依据是什么 · 命中几条证据」，不搞黑箱。 */
  function showRestoreDetail(cls, rows) {
    var d = $('#dlgGroupReport');
    if (!d || !rows || !rows.length) return;
    var byBasis = {};
    rows.forEach(function (x) { byBasis[x.basis] = (byBasis[x.basis] || 0) + 1; });
    $('#grTitle').textContent = '已放回原组';
    $('#grBody').innerHTML =
      '<p class="gr-flow">一共放回 <b>' + rows.length + '</b> 人。依据：' +
        Object.keys(byBasis).map(function (k) { return '<b>' + esc(k) + '</b> ' + byBasis[k] + ' 人'; }).join(' · ') +
      '</p>' +
      '<div class="gr-list">' + rows.map(function (x) {
        return '<div class="gr-row"><span class="gr-nm">' + esc(x.r.name) + '</span>' +
          '<span class="gr-to">第 ' + x.gno + ' 组</span>' +
          '<span class="gr-why">' + esc(x.basis) + ' · 命中 ' + x.hits + ' 条</span></div>';
      }).join('') + '</div>';
    $('#grBtns').innerHTML = '<button type="button" class="btn primary" id="grOk2">知道了</button>';
    $('#grOk2').addEventListener('click', function () { d.close(); });
  }

  /** 分组动作做完统一报账：先刷界面，少了人就弹红字单子。返回核对结果。 */
  function reportGroupChange(cls, beforeGroups, label) {
    var rep = reconcileGroups(cls, beforeGroups, label);
    if (rep.before.people > rep.after.people) showGroupReport(cls, rep);
    return rep;
  }

  /** 分数搬不动的时候明说，别让老师以为分数悄悄没了。 */
  function reportScoreMigration(out) {
    if (!out) return;
    var p = out.personal || 0, l = (out.leader && out.leader.stranded) || 0;
    if (!p && !l) return;
    alert('有' + (p ? ' ' + p + ' 条个人扣分' : '') + (p && l ? '、' : '') + (l ? ' ' + l + ' 条个人项目分' : '') +
      '找不到对应的人，已留在原来的位置（没有清零），请到「上课记分」页核对。');
  }

  /** 把上限设成 size 以后，哪些组会超员、超的是谁（只标红，不踢人）。
      用户原话：「比如某组原来 7 人、新上限 6 人，不许直接把第 7 个人踢掉」。 */
  function overLimitPreview(cls, size) {
    var rows = [];
    cls.groups.forEach(function (g) {
      var cap = Math.max(size, Number(g.cap) || 0), n = memberCount(g);
      if (n <= cap) return;
      var seen = 0, names = [];
      g.members.forEach(function (m) {
        if (!m.name) return;
        seen++;
        if (seen > cap) names.push(m.name);
      });
      rows.push({ no: g.no, n: n, cap: cap, names: names });
    });
    return rows;
  }

  /** 待分配学生按每组 size 人切组：只用空组，缺组补、多余空组删，返回安排结果 */
  function autoGroupBySize(cls, size, shuffle) {
    size = clampLimit(size);
    if (!size) return { error: '先填每组几人。' };
    var pending = truePendingList(cls).slice();
    if (!pending.length) return { error: '这个班没有未分组的学生，都分好组了。' };
    /* 护栏：全班人都算「没分组」，可班里明明有几组是满的——这不是缺人，是名单和分组对不上
       （学号变了 / 换了首页班级）。这时硬分只会在旧组旁边再叠一套新组，越修越乱，直接停手。 */
    var grouped = cls.groups.filter(function (g) { return memberCount(g) > 0; }).length;
    if (grouped && pending.length >= rosterOf(cls).length) {
      return { error: '全班 ' + pending.length + ' 人都被当成「未分组」，但班里已经有 ' + grouped +
        ' 个组是有人的——分组名单和全班名单的学号对不上。\n先到「数据与同步」页核对这个班对应的首页班级，' +
        '别在这里重新分组，否则会在旧组旁边再叠一套新组。' };
    }
    pending.sort(function (a, b) {
      var x = a.no == null ? 1e9 : a.no, y = b.no == null ? 1e9 : b.no;
      if (x !== y) return x - y;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
    if (shuffle) shuffleInPlace(pending);
    var plan = planSizes(pending.length, size);
    var need = plan.length;
    var empty = cls.groups.filter(function (g) { return memberCount(g) === 0; })
      .sort(function (a, b) { return a.no - b.no; });
    var use = empty.slice(0, need);
    var drop = empty.slice(need).filter(function (g) { return !groupHasHistory(cls, g.no); });
    drop.forEach(function (g) {
      var at = cls.groups.indexOf(g);
      if (at >= 0) cls.groups.splice(at, 1);
    });
    var maxNo = cls.groups.reduce(function (a, g) { return Math.max(a, g.no); }, 0);
    while (use.length < need) {
      var ng = { id: uid('g'), no: ++maxNo, members: [] };
      cls.groups.push(ng);
      use.push(ng);
    }
    var at = 0;
    use.forEach(function (g, gi) {
      for (var k = 0; k < plan[gi]; k++) {
        var r = pending[at++];
        pushMember(g, { id: uid('m'), name: r.name, sid: r.sid || '', no: r.no == null ? null : r.no });
      }
    });
    return {
      groups: need,
      min: Math.min.apply(null, plan), max: Math.max.apply(null, plan),
      people: pending.length, removed: drop.length
    };
  }

  /** 全班重排的唯一写入口：把「一组一筐人」落进 cls.groups。
      三条铁律，每一条都对应一句用户原话：
      ① 只增不删人 —— 计划里每个人都落进某个组，绝不会「抹除我部分同学」；
      ② 组号优先复用 —— 组号不变，那一组的历史小组分就还挂在原来那组上；
         多出来的组只清空、不删除有历史记分的（分数留着，不跟着组一起消失）；
      ③ 动手前拍分数快照，动完按学生身份把个人扣分迁回去（realignPersonalScores）。 */
  function applyRegroup(cls, buckets) {
    var snap = scoreLayoutSnapshot(cls);
    /* 先把现有成员对象按身份存起来：重排时复用同一个对象，成员 id / 组长标记才不会失联
       （个人项目分是按成员 id 记的，id 一换，leaderScores 里那份分就找不到了）。 */
    var keep = Object.create(null);
    cls.groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        var k = studentKeyOf(m);
        if (!keep[k]) keep[k] = m;
      });
    });
    var sorted = cls.groups.slice().sort(function (a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0); });
    var use = sorted.slice(0, buckets.length);
    var extra = sorted.slice(buckets.length);
    extra.forEach(function (g) {
      g.members = [];
      if (groupHasHistory(cls, g.no)) return;      // 有历史记分：留成空组，分数还挂在原组号上
      var at = cls.groups.indexOf(g);
      if (at >= 0) cls.groups.splice(at, 1);
    });
    var maxNo = cls.groups.reduce(function (a, g) { return Math.max(a, Number(g.no) || 0); }, 0);
    while (use.length < buckets.length) {
      var ng = { id: uid('g'), no: ++maxNo, members: [] };
      cls.groups.push(ng);
      use.push(ng);
    }
    use.forEach(function (g, gi) {
      g.members = [];
      buckets[gi].forEach(function (r) {
        var k = r.sid ? 's:' + r.sid : 'n:' + r.name + '#' + (r.no == null ? '' : r.no);
        var src = keep[k];
        delete keep[k];
        pushMember(g, src || { id: uid('m'), name: r.name, sid: r.sid || '', no: r.no == null ? null : r.no });
      });
      /* 人数变了：不再超员的组就别再挂着「特例」标签 */
      if (Number(g.cap) && memberCount(g) <= (classGroupLimit(cls) || GROUP_CAP)) delete g.cap;
      if (g.leaderKey && !g.members.some(function (m) { return memberKey(m) === g.leaderKey; })) delete g.leaderKey;
    });
    var personalUnmatched = realignPersonalScores(cls, snap);
    /* 2026-11-08 追加：个人项目分（leaderScores[组号].members[成员键]）也按成员键整体搬到人现在所在的组号，
       否则换完组 projectScore() 按新组号找不到这条记录，看上去就是「个人项目分全没了」。 */
    var leader = realignLeaderScores(cls, snap);
    return { personal: personalUnmatched, leader: leader };
  }

  function pendingCountOf(cls) { return cls ? truePendingList(cls).length : 0; }

  /** 当前班级一句话现状：几个组、几个人分好了、每组上限多少。
      口径只有一个：已分（按人算，去重）+ 未分组 = 全班（名单 + 历史组员）。
      学生自助选座的「已坐 x/y」不并进这句话，免得又出现两个互相对不上的数字。 */
  function groupSummaryText(cls) {
    if (!cls) return '';
    var groups = cls.groups || [];
    var total = regroupPool(cls).length;
    var seen = Object.create(null), grouped = 0;
    groups.forEach(function (g) {
      g.members.forEach(function (m) {
        if (!m.name) return;
        var k = studentKeyOf(m);
        if (seen[k]) return;
        seen[k] = 1; grouped++;
      });
    });
    var pending = Math.max(0, total - grouped);
    var limit = classGroupLimit(cls);
    var over = groups.reduce(function (a, g) { return a + overCountOf(cls, g); }, 0);
    if (!groups.length && !total) return '这个班还没有学生';
    return groups.length + ' 个组 · 已分 ' + grouped + '/' + total + ' 人' +
      (pending ? ' · 未分组 ' + pending + ' 人' : '') +
      (limit ? ' · 每组上限 ' + limit + ' 人' : '') +
      (over ? ' · 超员 ' + over + ' 人（已标红）' : '');
  }

  function renderGroupSummary() {
    var box = $('#groupSummary');
    if (box) box.textContent = groupSummaryText(curClass());
  }

  /* ================= 分组设置：分几组 / 每组上限（2026-11-09） =================
     用户原话：「就做一种 先确定分组数量和每组上限（可改）然后教师可以使用拖拽分组」。
     所以这一页只剩这一条流程，原来那个四个页签的弹窗整个删掉了。

     两个框填的都是本班真实值，改完立刻生效：
     · 分几组 → 增减 cls.groups 里的空组。只加/删「没人且没有历史分」的组，
       已经在组里的人一个都不动，组号 g.no 也从不重排（它是记分表的行号）。
     · 每组上限 → 写 cls.groupLimit（记分页和看板都读它）。改小只会让超出的组标红，
       绝不删人 —— 用户原话：「我一旦不小心点错了 就会抹除我部分同学」。 */

  function renderGroupSetup() {
    var cls = curClass();
    if (!cls) return;
    var countIn = $('#groupCount'), capIn = $('#groupLimit');
    /* 正在输入的这个框别抢：只有失焦时才用真实值覆盖，否则老师打一半就被改写 */
    if (countIn && document.activeElement !== countIn) {
      countIn.value = (cls.groups && cls.groups.length) ? String(cls.groups.length) : '';
    }
    var cap = classGroupLimit(cls);
    if (capIn && document.activeElement !== capIn) capIn.value = cap ? String(cap) : String(GROUP_CAP);

    var note = $('#groupSetupNote');
    if (note) {
      note.textContent = '改组数只增减空组，不会打散已经分好的人；改上限只影响「满没满」，超了标红但不会把人移出。' +
        (cap ? '' : '还没定过上限，暂按老规则 ' + GROUP_CAP + ' 人。');
    }

    /* 2026-11-13：圆桌数 / 每桌最多 两个输入框删掉了（和上面「分几组 / 每组上限」完全重复）。
       开放组队直接用上面那两个数：8 组 = 8 张圆桌，每组上限 7 人 = 每桌最多 7 人。 */
    var tN = (cls.groups || []).length, tS = classGroupLimit(cls) || GROUP_CAP;
    var openBtn = $('#btnTeamOpen');
    if (openBtn && !(tmRoom && tmRoom.room && tmRoom.status !== 'closed')) {
      openBtn.disabled = false;
      openBtn.title = tN ? '' : '先在上面「分几组」里填个数字，再来开放组队';
    }
    var seatState = $('#gpSeatState');
    if (seatState) {
      seatState.textContent = tN
        ? '将开 ' + tN + ' 张圆桌，每桌最多 ' + tS + ' 人（用上面的「分几组 / 每组上限」）。学生自己选座，你这边每 2 秒自动刷新。'
        : '';
    }
  }

  /** 改组数：多了补空组，少了只删「没人且没有历史分」的组。返回是否真的改了。 */
  function applyGroupCount(cls, raw) {
    var want = Math.round(Number(raw) || 0);
    if (!(want >= 1 && want <= 40)) { flash('组数要填 1–40 之间的整数'); renderGroupSetup(); return false; }
    var gs = cls.groups || (cls.groups = []);
    if (gs.length === want) { renderGroupSetup(); return false; }

    if (gs.length < want) {
      var add = want - gs.length;
      gbSnapshot(cls, '把组数改成 ' + want + ' 组（新增 ' + add + ' 个空组）');
      var maxNo = gs.reduce(function (a, x) { return Math.max(a, Number(x.no) || 0); }, 0);
      for (var i = 0; i < add; i++) {
        maxNo++;
        gs.push({ id: uid('g'), no: maxNo, members: [] });
      }
      addOperationLog('分组', cls.name + ' · 组数改为 ' + want + ' 组（新增 ' + add + ' 个空组）');
      gbCommit(cls, '现在是 ' + want + ' 个组' + emptyGroupsHint(cls));
      return true;
    }

    /* 减组：只动「一个人都没有、也没有历史记分」的组，从组号大的开始删 */
    var need = gs.length - want;
    var cut = gs.filter(function (g) { return memberCount(g) === 0 && !groupHasHistory(cls, g.no); })
      .sort(function (a, b) { return (Number(b.no) || 0) - (Number(a.no) || 0); })
      .slice(0, need);
    if (!cut.length) {
      flash('减不到 ' + want + ' 组：其它组里还有人，先把人拖到「未分组」再减');
      renderGroupSetup();
      return false;
    }
    gbSnapshot(cls, '把组数改成 ' + want + ' 组（删掉 ' + cut.length + ' 个空组）');
    cut.forEach(function (g) {
      var at = cls.groups.indexOf(g);
      if (at >= 0) cls.groups.splice(at, 1);
    });
    addOperationLog('分组', cls.name + ' · 组数改为 ' + (cls.groups.length) + ' 组（删掉 ' + cut.length + ' 个空组）');
    var left = want - cls.groups.length;
    gbCommit(cls, '现在是 ' + cls.groups.length + ' 个组' + emptyGroupsHint(cls) +
      (left ? '：还有 ' + left + ' 个组里有人，减不掉，先把人拖出来' : ''));
    return true;
  }

  /** 改每组上限：只影响「满没满」，不删人。 */
  function applyGroupLimit(cls, raw) {
    var cap = clampLimit(raw);
    if (!cap) { flash('每组上限要填 2–40 之间的整数'); renderGroupSetup(); return false; }
    if (classGroupLimit(cls) === cap) { renderGroupSetup(); return false; }
    gbSnapshot(cls, '每组上限改为 ' + cap + ' 人');
    cls.groupLimit = cap;
    var over = 0;
    (cls.groups || []).forEach(function (g) { over += overCountOf(cls, g); });
    addOperationLog('分组', cls.name + ' · 每组上限改为 ' + cap + ' 人' + (over ? '（' + over + ' 人超出，标红）' : ''));
    gbCommit(cls, '每组上限改为 ' + cap + ' 人' + (over ? '，有 ' + over + ' 人超出（标红，未移出）' : ''));
    return true;
  }

  /* 2026-11-13 删掉的那段「锁定分组」说明：功能已并入「确认分组」，注释一并清掉，
     免得下次看代码的人以为还有 toggleGroupLock 这个函数。 */
  /** 滚到「学生自助选桌」常驻条（并展开选座实况）
      2026-11-12：控件从折叠区搬到了 #tmBar，这里改成把老师带到能点到
      「按选座确认分组」的位置；旧的 openTeamMore 名字保留，调用点一个都没改。 */
  function openTeamMore() {
    renderGroupSetup();
    var bar = $('#tmBar');
    if (bar && bar.scrollIntoView) bar.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---- 分组设置栏的交互（2026-11-09：原来的四页签弹窗已删，控件都在页面上） ---- */
  if ($('#groupCount')) {
    var countIn = $('#groupCount'), capIn = $('#groupLimit');
    /* 组数用 change：输入过程中不要每敲一位就把组重排一遍 */
    countIn.addEventListener('change', function () {
      var cls = curClass();
      var ok = cls && applyGroupCount(cls, this.value);
      renderGroupSetup();
      /* 没改成（减不下去 / 填错）就把框里的数退回真实值，别让老师以为已经生效了 */
      if (!ok && cls) this.value = (cls.groups && cls.groups.length) ? String(cls.groups.length) : '';
    });
    countIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    capIn.addEventListener('change', function () {
      var cls = curClass();
      var ok = cls && applyGroupLimit(cls, this.value);
      renderGroupSetup();
      if (!ok && cls) this.value = String(classGroupLimit(cls) || GROUP_CAP);
    });
    capIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });

    /* 2026-11-13 精简：「把未分组的人平均填进去」「压缩空组并重排组号」两个独立按钮已删，
       功能并进「确认分组」（gbConfirmGroups）；「锁定分组」按钮同日一并删除
       （用户：「完全不需要停止组队逻辑」），现在这一行只剩「开放组队」+「确认分组」。 */

    /* 2026-11-13：「⚙ 设置」面板连同它的「✓ 确认设置」按钮一起删了 ——
       面板里只剩圆桌数/每桌最多两个重复输入框（锁定分组也删了），
       现在改上面的「分几组 / 每组上限」就是改设置，不需要二次确认。 */
  }

  /* 分组结果核对弹窗（2026-11-08）：按钮是 showGroupReport 每次重画的，只绑关闭 */
  if ($('#dlgGroupReport')) {
    $('#grClose').addEventListener('click', function () { $('#dlgGroupReport').close(); });
    $('#dlgGroupReport').addEventListener('close', function () { renderGroupSummary(); });
  }

  /* ================= 数据与同步视图 ================= */

  var rosterClassId = null;

  function renderData() {
    /* 2026-11-12 删「数据与同步」页：renderData 保留作死代码，但页面 DOM 已删。
       renderHxRoster（首页班级对应）已搬到分组页，其余（导出/课次/名单）整页删掉了。
       这里只剩 renderHxRoster 还有真实容器（#hxRosterCard 已搬到 view-pool），
       其余两块 DOM 没了，直接跳过，避免 null.innerHTML 报错。 */
    renderHxRoster();
    if ($('#lessonListCard')) renderLessonList();
    if ($('#rosterCard')) { if (!rosterClassId) rosterClassId = (curClass() || {}).id || null; renderRoster(); }
  }

  /* 班级名单来自首页“班级”（点亮“小组加分”的班），规则见 hx-roster.js：只读首页名单，不删加分里的任何数据 */
  var HXR = window.JFDT_HXROSTER;
  var hxRoster = { classes: null, all: null, students: {}, loading: null, error: '', review: null };
  var hxShown = null; // 上次按首页名单画出来的班级（变了才重画）
  function visibleClasses() { return HXR.visible(S, hxRoster.all); }
  function loadHxRoster(fresh) {
    if (!CLOUD_ON || !CLOUD.rpc) return Promise.resolve();
    if (hxRoster.loading) return hxRoster.loading;
    /* fresh=true（点「刷新」按钮、对应完成后）：跳过 5 分钟缓存，直接读云端真身。
       2026-11-11 修 CI/线上 bug：缓存上线后点刷新不再发请求，老师「取消点亮」后回来
       看到的还是旧名单，点了像没反应。用户主动要新数据时缓存必须让路。 */
    var opt = fresh ? { fresh: true } : null;
    hxRoster.loading = CLOUD.rpc('hx_my_classes', {}, opt).then(function (classes) {
      var mine = (classes || []).filter(HXR.lit);
      return Promise.all((classes || []).map(function (c) { // 没勾的也读：原有班对应时首页全部班都能选
        return CLOUD.rpc('hx_class_students', { p_class: c.id }, opt).then(function (rows) { return [c.id, rows || []]; });
      })).then(function (pairs) {
        hxRoster.students = {}; pairs.forEach(function (p) { hxRoster.students[p[0]] = p[1]; });
        hxRoster.classes = mine; hxRoster.all = classes || []; hxRoster.error = '';
      });
    }).catch(function (e) { hxRoster.error = '首页班级读取失败：' + e.message; })
      .finally(function () { hxRoster.loading = null; hxApply(); });
    return hxRoster.loading;
  }
  /* 读到首页名单后自动跟随（编辑闸门开着时等开了再做），再按需重画 */
  function hxApply() {
    var changed = false;
    if (hxRoster.all && !syncEditBlocked) {
      var p = CLOUD && CLOUD.profile();
      var r = HXR.auto(S, hxRoster.all, function (id) { return hxRoster.students[id] || null; }, p ? p.displayName : '');
      if (r.changes.length) {
        S = r.state; changed = true;
        r.changes.forEach(function (c) {
          addOperationLog('首页班级', c.cls.name + (c.created ? ' 加入加分' : c.linked ? ' 已按同名对应首页班级' : '') + hxCounts(c));
        });
        save(false);
      }
    }
    var now = shownKey();
    if (changed || now !== hxShown) { hxShown = now; hxRedraw(); }
    else if (view === 'pool') renderHxRoster();
  }
  function shownKey() { return visibleClasses().map(function (c) { return c.id; }).join(); }
  function hxRedraw() {
    fillClassSelects();
    if (view === 'attendance' && attendanceContext && attendanceContext.isDirty && attendanceContext.isDirty()) return;
    if (editingGrade()) return;
    switchView(view);
  }
  function hxAfterGate() { if (hxRoster.all) hxApply(); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S && CLOUD_ON) loadHxRoster(); });

  function hxCounts(c) {
    return (c.added ? '，补进 ' + c.added + ' 人' : '') + (c.renamed ? '，改名 ' + c.renamed + ' 人' : '') +
      (c.left ? '，退学隐藏 ' + c.left + ' 人' : '') + (c.back ? '，恢复 ' + c.back + ' 人' : '');
  }
  function hxNames(list, fmt) {
    return list.slice(0, 30).map(fmt).join('、') + (list.length > 30 ? ' 等 ' + list.length + ' 人' : '');
  }
  function hxPreviewHtml(cls, hx) {
    var d = HXR.diff(cls, hxRoster.students[hx.id] || []);
    var line = function (label, items, fmt) { return items.length ? '<li>' + label + ' ' + items.length + ' 人：' + esc(hxNames(items, fmt)) + '</li>' : ''; };
    return '<div class="hx-review"><ul>' +
      '<li>学号一致 ' + d.same + ' 人，分组和分数不变</li>' +
      line('首页新增（加入待分配）', d.added, function (s) { return s.name; }) +
      line('改名', d.renamed, function (r) { return r.from + '→' + r.to; }) +
      line('学号不一致（不动，请核对）', d.conflicts, function (c) { return c.name + ' 加分' + c.sid + ' 首页' + c.homeSid; }) +
      line('首页没有（保留）', d.gone, function (m) { return m.name + ' ' + m.sid; }) +
      line('退学（隐藏，分数保留）', d.leaving, function (x) { return x.name; }) +
      '</ul><div class="btnrow"><button class="btn tiny primary" data-hxlink="' + esc(cls.id) + '">确认对应</button>' +
      '<button class="btn tiny" data-hxcancel="1">取消</button></div></div>';
  }
  function renderHxRoster() {
    var card = $('#hxRosterCard'), box = $('#hxRosterBox');
    if (!card) return;
    card.hidden = !(CLOUD_ON && CLOUD.rpc);
    if (card.hidden) return;
    if (!hxRoster.all) {
      box.innerHTML = '<p class="note">' + esc(hxRoster.error || '正在读取首页班级…') + '</p>';
      if (!hxRoster.error) loadHxRoster();
      return;
    }
    var html = hxRoster.error ? '<p class="note">' + esc(hxRoster.error) + '</p>' : '';
    var pend = HXR.pending(S), taken = {}, rv = hxRoster.review;
    S.classes.forEach(function (c) { if (c.hxClassId) taken[c.hxClassId] = true; });
    if (pend.length) {
      /* 原有的班：老师选对应首页哪个班（首页全部班级都能选），预览后确认 */
      html += '<table class="data"><tbody>' + pend.map(function (c) {
        var mine = rv && rv.classId === c.id ? rv : null;
        var options = hxRoster.all.filter(function (h) { return !taken[h.id]; });
        var pick = mine && mine.hxId ? mine.hxId : (options.filter(function (h) { return h.name === c.name; })[0] || {}).id;
        var hx = mine && mine.hxId && hxRoster.all.filter(function (h) { return h.id === mine.hxId; })[0];
        var extra = '';
        if (mine && mine.local) extra = '<p class="note">不对应：照旧用加分里的名单，不跟首页。</p><div class="btnrow"><button class="btn tiny primary" data-hxlocalok="' + esc(c.id) + '">确定</button><button class="btn tiny" data-hxcancel="1">取消</button></div>';
        else if (mine && mine.msg) extra = '<p class="note">' + esc(mine.msg) + '</p>';
        else if (hx) extra = hxPreviewHtml(c, hx);
        return '<tr><td>' + esc(c.name) + '</td><td><label class="hx-pick">对应首页 <select data-hxpick="' + esc(c.id) + '"><option value="">选择班级</option>' +
          options.map(function (h) { return '<option value="' + h.id + '"' + (h.id === pick ? ' selected' : '') + '>' + esc(h.name) + '</option>'; }).join('') +
          '</select></label></td><td><button class="btn tiny primary" data-hxreview="' + esc(c.id) + '">预览</button> <button class="btn tiny" data-hxlocal="' + esc(c.id) + '">不对应</button> <button class="btn tiny danger" data-hxdel="' + esc(c.id) + '">删除</button></td></tr>' +
          (extra ? '<tr class="hx-extra"><td colspan="3">' + extra + '</td></tr>' : '');
      }).join('') + '</tbody></table>';
    }
    var items = HXR.list(S, hxRoster.all);
    if (pend.length) { // 还有原有班没对应：先只看上面，下面的列表等对应完再出
      if (items.some(function (it) { return !it.cls; })) html += '<p class="note">对应完后，其余首页班级自动加入。</p>';
      items = [];
    }
    html += items.length ? '<table class="data"><tbody>' + items.map(function (it) {
      var studs = hxRoster.students[it.hx.id] || [], state;
      if (!it.cls) state = '<span class="rank-note">' + (pend.length ? '等上面对应完再加入' : '正在加入…') + '</span>';
      else {
        var d = HXR.diff(it.cls, studs);
        var gone = (it.cls.leftStudents || []).length;
        state = '<span class="rank-note">已在加分' + (gone ? ' · 退学 ' + gone + ' 人已隐藏' : '') + '</span>' + (d.conflicts.length ? ' <details class="note"><summary>学号不一致 ' + d.conflicts.length + ' 人</summary>' +
          esc(hxNames(d.conflicts, function (c) { return c.name + ' 加分' + c.sid + ' 首页' + c.homeSid; })) + '</details>' : '');
      }
      return '<tr><td>' + esc(it.hx.name) + '</td><td>' + studs.length + ' 人</td><td>' + state + '</td></tr>';
    }).join('') + '</tbody></table>' : (pend.length ? '' : '<p class="note">在首页“班级”导入考勤表。</p>');
    var hidden = S.classes.filter(function (c) { return c.hxClassId && visibleClasses().indexOf(c) < 0; });
    if (hidden.length) html += '<p class="note">首页没勾“小组加分”，暂不显示（记录都在）：' + esc(hidden.map(function (c) { return c.name; }).join('、')) + '</p>';
    box.innerHTML = html;
  }
  /* 2026-11-13：这块事件委托原本挂在「首页班级」卡（#hxRosterBox）上，卡按用户要求删掉了。
     注意：当时只删了卡、留着这两行 addEventListener，结果 $('#hxRosterBox') 是 null，
     .addEventListener 直接抛 TypeError —— 脚本从这里中断，后面所有初始化（填班级/填课次/画名单）
     全部没执行，整个记分页一片空白（2026-11-13 线上事故）。所以整块一起删干净。
     自动对应仍由 loadHxRoster 在后台维护，只是不再有可见卡片和交互。 */
  /* 2026-11-13：「首页班级」那张卡连同刷新按钮一起删了（用户：这个也没用）。
     自动对应仍由 loadHxRoster 在后台维护，只是不再有可见卡片。 */
  if ($('#btnHxRefresh')) $('#btnHxRefresh').addEventListener('click', function () { renderHxRoster(); loadHxRoster(true); });

  function renderLessonList() {
    var rows = S.lessons.slice().sort(function (a, b) {
      var ca = getClass(a.classId), cb = getClass(b.classId);
      var na = ca ? ca.name : '', nb = cb ? cb.name : '';
      return na.localeCompare(nb, 'zh') || (a.seq - b.seq);
    });
    $('#lessonListCard').innerHTML = rows.length
      ? '<table class="data"><thead><tr><th>班级</th><th>课次</th><th>日期</th><th>本节任务</th>' +
        '<th>值日组</th><th>已记分组</th><th>操作</th></tr></thead><tbody>' +
        rows.map(function (l) {
          var c = getClass(l.classId);
          var n = c ? c.groups.filter(function (g) { return touched(l, g.no); }).length : 0;
          return '<tr>' +
            '<td>' + esc(c ? c.name : '（已删除）') + '</td>' +
            '<td>第 ' + l.seq + ' 次</td>' +
            '<td>' + esc(l.date || '') + '</td>' +
            '<td>' + esc(l.topic || '') + '</td>' +
            '<td>' + (l.dutyGroup ? '第 ' + l.dutyGroup + ' 组' : '—') + '</td>' +
            '<td>' + n + '</td>' +
            '<td><button class="btn tiny" data-lopen="' + l.id + '">打开</button> ' +
                '<button class="btn tiny" data-lclear="' + l.id + '">清零</button> ' +
                '<button class="btn tiny danger" data-ldel="' + l.id + '">删除</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table>'
      : '<p class="rank-note">还没有任何课次记录。</p>';
  }

  function renderRoster() {
    var cls = getClass(rosterClassId);
    if (!cls || visibleClasses().indexOf(cls) < 0) cls = curClass();
    if (!cls) { $('#rosterCard').innerHTML = ''; return; }
    rosterClassId = cls.id;

    var head = '<div class="btnrow">' +
      '<label class="field"><span>班级</span><select id="rosterSel">' +
      visibleClasses().map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === cls.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>教师</span><input type="text" id="rosterTeacher" value="' + esc(cls.teacher || '') + '" style="width:110px"></label>' +
      '<span class="spacer"></span>' +
      '<button class="btn tiny" id="btnAddGroup">＋ 添加一组</button></div>';

    var cols = GROUP_CAP;
    var body = '<table class="data"><thead><tr><th>组号</th>';
    for (var i = 1; i <= cols; i++) body += '<th>成员' + i + '</th>';
    body += '<th>操作</th></tr></thead><tbody>';
    cls.groups.forEach(function (g) {
      body += '<tr><td>第 ' + g.no + ' 组</td>';
      for (var j = 0; j < cols; j++) {
        var m = g.members[j];
        var shown = m ? (m.name + (m.sid ? ' ' + m.sid : (m.no == null ? '' : ' ' + m.no))) : '';
        body += '<td><input type="text" data-rg="' + g.no + '" data-rm="' + j + '" value="' +
          esc(shown) + '" placeholder="姓名"></td>';
      }
      body += '<td><button class="btn tiny danger" data-rgdel="' + g.no + '">删组</button></td></tr>';
    });
    body += '</tbody></table>';
    body += '<p class="rank-note">成员格填「姓名」即可，学号与班内序号会自动按全班名单补齐；' +
      '也可以手写「姓名 学号」。留空表示该位置没人。要批量调整请用「分组」页。</p>';

    $('#rosterCard').innerHTML = head + body;

    $('#rosterSel').addEventListener('change', function () { rosterClassId = this.value; renderRoster(); });
    $('#rosterTeacher').addEventListener('change', function () { cls.teacher = this.value; save(); });
    $('#btnAddGroup').addEventListener('click', function () {
      var maxNo = cls.groups.reduce(function (a, g) { return Math.max(a, g.no); }, 0);
      cls.groups.push({ id: uid('g'), no: maxNo + 1, members: [] });
      save(); renderRoster();
    });
    $$('#rosterCard input[data-rg]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var g = groupOf(cls, +inp.dataset.rg);
        if (!g) return;
        var j = +inp.dataset.rm;
        var raw = inp.value.trim();
        while (g.members.length <= j) g.members.push({ id: uid('m'), name: '', sid: '' });
        var prev = g.members[j];
        if (!raw) {
          g.members[j] = { id: prev.id, name: '', sid: '', no: null };
        } else {
          /* 「姓名 26000000001」或「姓名 05」两种写法都收；
             只写姓名时保留原有的学号 / 序号，避免改个错别字把学号弄丢 */
          var mm = raw.match(/^(.*?)\s*([0-9]{1,20})$/);
          var nm = mm ? mm[1].trim() : raw;
          var tail = mm ? mm[2] : '';
          var hit = rosterOf(cls).filter(function (r) { return r.name === nm; })[0];
          g.members[j] = {
            id: prev.id,
            name: nm,
            sid: (hit && hit.sid) ? hit.sid
              : (tail.length >= 8 ? tail : (prev.sid || '')),
            no: (hit && hit.no != null) ? hit.no
              : (tail && tail.length < 8 ? parseInt(tail, 10) : (prev.no == null ? null : prev.no))
          };
        }
        while (g.members.length && !g.members[g.members.length - 1].name) g.members.pop();
        save(); renderRoster();
      });
    });
    $$('#rosterCard button[data-rgdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var no = +b.dataset.rgdel;
        var dialog=document.createElement('dialog');dialog.id='dlgDeleteGroup';dialog.innerHTML='<form method="dialog"><h2>删除第'+no+'组？</h2><p>该组成员会回到未分组，该组历史记分将删除。要留退路请先到华夏工具首页「全站备份」导出一份。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn danger" value="ok">确认删除</button></div></form>';document.body.appendChild(dialog);dialog.addEventListener('close',function(){var accepted=dialog.returnValue==='ok';dialog.remove();if(!accepted)return;
        cls.groups = cls.groups.filter(function (g) { return g.no !== no; });
        S.lessons.forEach(function (l) { if (l.classId === cls.id) delete l.scores[String(no)]; });
        save(); renderRoster();
        });dialog.showModal();
      });
    });
  }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.lopen) {
      var l = getLesson(b.dataset.lopen);
      if (l) { S.ui.classId = l.classId; S.ui.lessonId = l.id; save(); switchView('score'); }
      return;
    }
    if (b.dataset.lclear) {
      var l2 = getLesson(b.dataset.lclear);
      if (!l2) return;
      var clearOk = await askConfirm({
        title: '第 ' + l2.seq + ' 次课的分数清零？',
        body: '这节课记过的分全部清空（课次本身保留）。',
        note: '可以撤销。',
        ok: '清零',
        danger: true
      });
      if (clearOk) {
        l2.scores = {};
        dropUndoForLesson(l2.id);
        save(); renderData();
      }
      return;
    }
    if (b.dataset.ldel) {
      var l3 = getLesson(b.dataset.ldel);
      if (!l3) return;
      var delOk = await askConfirm({
        title: '删除第 ' + l3.seq + ' 次课？',
        body: '这节课的全部记录都会删除，包括所有小组的分数。',
        note: '此操作不可撤销，要留退路请先到华夏工具首页「全站备份」导出一份。',
        ok: '删除',
        danger: true
      });
      if (delOk) {
        S.lessons = S.lessons.filter(function (x) { return x.id !== l3.id; });
        if (S.ui.lessonId === l3.id) S.ui.lessonId = null;
        dropUndoForLesson(l3.id);
        save(); renderData();
      }
      return;
    }
  });

  /* ================= 导出 ================= */

  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportLesson() {
    var cls = curClass(), lesson = curLesson(cls);
    if (!cls || !lesson) { alert('请先在「上课记分」页选一个课次。'); return; }
    /* 显示层（2026-11-09 完成率改革）：导出 CSV 的数值列同样按百分比口径；存储不动 */
    var rows = [['班级', cls.name, '第 ' + lesson.seq + ' 次课', '日期', lesson.date || '',
                 '本节任务', lesson.topic || '', '值日组', lesson.dutyGroup || '']];
    rows.push([]);
    rows.push(['组号', '成员', '值日缺勤（整学期，每次缺勤 −20%）', '手机未入袋（次数，每次 −20%）', '个人扣分合计（%）', '本节完成率', '小组累计完成率']);
    cls.groups.forEach(function (g) {
      var s = sc(lesson, g.no);
      var ls = lessonsOf(cls.id);
      rows.push([g.no,
        g.members.map(function (m) { return m.name; }).join('、'),
        dutyPctText(ls, g.no), +s.phone || 0,
        '−' + (personalSum(lesson, g.no) * 20) + '%', pctText(Math.max(0, groupTotal(lesson, g.no)) / 5 * 100), pctText(Math.max(0, groupCum(cls, g.no)) / (5 * groupLessonSpan(ls)) * 100)]);
    });
    download(cls.name + '_第' + lesson.seq + '次课_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  function exportCumulative() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ls = lessonsOf(cls.id);
    var rows = [['班级', cls.name, '共 ' + ls.length + ' 次课']];
    rows.push([]);
    rows.push(['组号', '成员'].concat(ls.map(function (l) { return '第' + l.seq + '课'; })).concat(['累计']));
    cls.groups.forEach(function (g) {
      rows.push([g.no, g.members.map(function (m) { return m.name; }).join('、')]
        .concat(ls.map(function (l) { return touched(l, g.no) ? pctText(Math.max(0, groupTotal(l, g.no)) / 5 * 100) : ''; }))
        .concat([pctText(Math.max(0, groupCum(cls, g.no)) / (5 * groupLessonSpan(ls)) * 100)]));
    });
    download(cls.name + '_累计总表_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  function exportMember() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ms = memberTotals(cls);
    var ls = lessonsOf(cls.id);
    /* 显示层：个人总分导出按学期完成率口径；分母同 taskEvidence 的 maximum */
    var semesterMax = semesterProjectMax(ls);
    var rows = [['班级', cls.name], []];
    rows.push(['排名', '姓名', '学号', '小组', '全组加分（%）', '个人项目分（%）', '个人扣分（%）', '完成率']);
    ms.forEach(function (m, i) {
      rows.push([i + 1, m.name, m.sid || (m.no == null ? '' : m.no), '第' + m.gno + '组',
                 semesterMax ? pctText(Math.max(0, m.groupScore) / semesterMax * 100) : '—',
                 semesterMax ? pctText(Math.max(0, m.project) / semesterMax * 100) : '—',
                 semesterMax ? '−' + pctText(Math.max(0, m.personal) / semesterMax * 100) : '—',
                 semesterMax ? pctText(Math.max(0, m.total) / semesterMax * 100) : '—']);
    });
    download(cls.name + '_个人总分_' + stamp() + '.csv', toCsv(rows), 'text/csv');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-export]');
    if (!b) return;
    if (b.dataset.export === 'lesson') exportLesson();
    if (b.dataset.export === 'cumulative') exportCumulative();
    if (b.dataset.export === 'member') exportMember();
  });

  /** 把本机整份存档存成 JSON。只给「两台设备的记录不同」冲突弹窗当保险绳用；
      日常备份统一走华夏工具首页「全站备份」，本工具不再单设备份 / 恢复 / 清空入口。 */
  function downloadLocalSnapshot() {
    download('夜夜小组制加分助手_本机存档_' + stamp() + '.json',
      JSON.stringify(S, null, 2), 'application/json');
  }

  /* 2026-11-12 删「数据与同步」页：「首页班级」入口跳到分组页（首页班级对应已搬到那里） */
  $('#btnRosterSetup').addEventListener('click', function () { switchView('pool'); });
  function rosterDownload(rows, name) {
    var formatEl = $('#rosterFormat');
    var format = formatEl ? formatEl.value : 'xlsx';
    if(format==='csv'){download(name+'.csv',toCsv(rows),'text/csv;charset=utf-8');return;}
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:20},{wch:16},{wch:26},{wch:10},{wch:12}];
    XLSX.utils.book_append_sheet(wb,ws,'名单');
    var bytes=XLSX.write(wb,{bookType:format,type:'array'});
    download(name+'.'+format,bytes,'application/octet-stream');
  }
  if ($('#btnExportRoster')) $('#btnExportRoster').addEventListener('click',function(){
    var rows=[['班级','姓名','学号','小组','班内序号']];
    /* 只导可见班级（首页点亮小组加分的），别把历史旧班一起导出去（2026-11-04） */
    visibleClasses().forEach(function(c){
      (c.roster||[]).forEach(function(m){
        var group=c.groups.find(function(g){return g.members.some(function(p){return p.sid===m.sid;});});
        rows.push([c.name,m.name,String(m.sid),group?group.no:'',m.no==null?'':m.no]);
      });
    });
    rosterDownload(rows,'全部班级名单_'+stamp());
  });

  /* ================= 打印 ================= */

  /** 打印前设好纸张方向：本课记录纵向（和纸质表一样），积分总览横向 */
  function printArea(html, orient) {
    var b = document.body;
    b.classList.remove('print-lesson', 'print-rank');
    b.classList.add(orient === 'rank' ? 'print-rank' : 'print-lesson');
    $('#printArea').innerHTML = html;
    if(lessonExporting)return;
    if(orient!=='lesson'||!html.includes('lesson-duplex')){window.print();return;}
    var old=document.querySelector('#lessonPrintFrame');if(old)old.remove();
    var frame=document.createElement('iframe');frame.id='lessonPrintFrame';frame.title='本课打印文档';frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    var css=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(function(l){return '<link rel="stylesheet" href="'+esc(l.href)+'">';}).join('');
    var pageStyle=$('#lessonPageStyle');
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><title>本课加分表</title>'+css+'<style>'+(pageStyle?pageStyle.textContent:'')+'@media print{html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;display:block!important}body::before,body::after{display:none!important}#printArea{display:block!important;position:static!important;margin:0!important}.lesson-duplex-page:last-child{break-after:auto!important;page-break-after:auto!important}}</style></head><body class="print-lesson"><div id="printArea">'+html+'</div></body></html>';
    frame.onload=function(){frame.contentWindow.focus();frame.contentWindow.print();};document.body.appendChild(frame);
  }

  var XL_RULE = "「值日缺勤」是整学期一个 5 分项目（只算一次，每节课都显示同一个学期值）：一学期没缺勤就是 100%，值日组缺勤时教师点一次「值日缺勤」，全组每人 −20%（团队绑定，要扣都扣），第二次轮到值日再缺勤还能再扣，最低 0%。手机未入袋、个人或全组扣分从本节项目分里扣，每次 −20%，扣完为止（不跨课）。每个命名个人项目满分 100%，按 20%、40%、60%、80%、100% 五档打分（如 4 个项目打 3 个 100%、1 个 0%，项目完成率＝300%÷400%＝75%）。每课完成率＝本节项目净得分÷（5×已命名项目数）。整学期分母＝5（值日缺勤，只算一次）＋Σ每课 5×已命名项目数，项目再多也不会被每课白送的 5 分稀释。考勤是学期固定项目，满分折 100%（9 分制扣分，如扣 1 分 → 约 88.9%）。平时分＝项目完成率×100，计入总评＝平时分×40%，满分40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。";


  /** 班内序号补两位，跟纸质表的「张三 05」一致 */
  function two(n) {
    if (n == null || n === '') return '';
    return n < 10 ? '0' + n : '' + n;
  }

  /** 打印本课：完全照着纸质《课堂分组与加分记录表》的 12 列版式 */
  var lessonPrintOptions={range:'both',orientation:'portrait',scope:'all',pageGroups:null},lessonExporting=false;
  function lessonPrintGroupCandidates(cls){return (cls.groups||[]).slice();}
  function fillLessonPrintRanges(reset){var dlg=$('#dlgLessonPrint');if(!dlg)return;var cls=curClass(),groups=lessonPrintGroupCandidates(cls),scope=$('#lessonPrintScope').value,select=$('#lessonPrintPageCount'),box=$('#lessonPrintRanges');if(scope!=='groups'){select.innerHTML='<option value="1">1页</option>';select.value='1';box.hidden=true;box.innerHTML='';return;}box.hidden=false;if(reset){select.innerHTML=groups.map(function(_,i){return '<option value="'+(i+1)+'">'+(i+1)+'页</option>';}).join('');select.value=String(Math.max(1,Math.min(groups.length,groups.length)));}var n=Math.max(1,Math.min(Number(select.value)||1,groups.length));select.value=String(n);var offset=0;box.innerHTML=Array.from({length:n},function(_,i){var count=Math.floor(groups.length/n)+(i<groups.length%n?1:0),part=groups.slice(offset,offset+count);offset+=count;var nums=part.map(function(g){return g.no;}),contig=nums.every(function(no,j){return !j||no===nums[j-1]+1;}),value=contig&&nums.length>1?nums[0]+'-'+nums[nums.length-1]:nums.join(',');return '<label class="field col">第'+(i+1)+'页组别<input data-lesson-print-page="'+i+'" aria-label="第'+(i+1)+'页组别" value="'+esc(value)+'" placeholder="例如1-6"></label>';}).join('');}
  function parseLessonPageRanges(groups,texts){var seen=new Set();var pages=texts.map(function(text,i){var nums=[];String(text).trim().split(/[,，、\s]+/).forEach(function(token){var m=/^(\d+)(?:[-—–~～至](\d+))?$/.exec(token);if(!m)throw Error('第'+(i+1)+'页请输入组号或范围，如1-6。');var a=Number(m[1]),b=m[2]?Number(m[2]):a;if(a>b||b-a>1000)throw Error('第'+(i+1)+'页组号范围无效。');for(var no=a;no<=b;no++)nums.push(no);});if(nums.length>8)throw Error('第'+(i+1)+'页超过8组，请增加页数。');return nums.map(function(no){var g=groups.find(function(x){return x.no===no;});if(!g)throw Error('第'+no+'组不在本次打印范围内。');if(seen.has(no))throw Error('第'+no+'组重复，请只安排一次。');seen.add(no);return g;});});var missing=groups.filter(function(g){return !seen.has(g.no);});if(missing.length)throw Error('尚未安排：第'+missing.map(function(g){return g.no;}).join('、')+'组。');return pages;}
  function openLessonPrint(cls,lesson,asPdf){
    var dlg=$('#dlgLessonPrint');
    if(!dlg){dlg=document.createElement('dialog');dlg.id='dlgLessonPrint';dlg.innerHTML='<form method="dialog"><h2>打印 / 导出本课</h2><label class="field col">打印范围<select id="lessonPrintRange"><option value="both">加分表＋背面说明</option><option value="front">仅加分表</option><option value="rules">仅规则说明</option></select></label><label class="field col">打印对象<select id="lessonPrintScope"><option value="all">本课全部小组</option><option value="groups">按组切割打印</option></select></label><label class="field col">打印页数<select id="lessonPrintPageCount"></select></label><div id="lessonPrintRanges"></div><label class="field col">纸张方向<select id="lessonPrintOrientation"><option value="portrait">A4 竖向</option><option value="landscape">A4 横向</option></select></label><p class="note">选择“按组切割打印”后，可按每页组别范围安排，例如1-6、7-13；每页最多8组。双面打印选择长边翻转；建议关闭页眉页脚。</p><div class="btnrow"><button class="btn" type="button" id="lessonPrintExcel">下载 Excel</button><span class="spacer"></span><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(dlg);dlg.querySelector('#lessonPrintScope').onchange=function(){fillLessonPrintRanges(true);};dlg.querySelector('#lessonPrintPageCount').onchange=function(){fillLessonPrintRanges(false);};dlg.querySelector('#lessonPrintExcel').onclick=function(){dlg.close();downloadLessonExcel(curClass(),curLesson(curClass()));};}
    dlg.querySelector('h2').textContent=asPdf?'下载打印版 PDF':'打印 / 导出本课';dlg.querySelector('[value="ok"]').textContent=asPdf?'下载 PDF':'开始打印';
    $('#lessonPrintScope').value='all';fillLessonPrintRanges(true);dlg.onclose=function(){if(dlg.returnValue!=='ok')return;var scope=$('#lessonPrintScope').value,pageGroups=null;try{if(scope==='groups')pageGroups=parseLessonPageRanges(lessonPrintGroupCandidates(cls),Array.from(dlg.querySelectorAll('[data-lesson-print-page]')).map(function(el){return el.value;}));}catch(e){dlg.querySelector('#lessonPrintError')?.remove();var err=document.createElement('p');err.id='lessonPrintError';err.className='note';err.textContent=e.message;dlg.querySelector('form').insertBefore(err,dlg.querySelector('.btnrow'));openDlg(dlg);return;}lessonPrintOptions={range:$('#lessonPrintRange').value,orientation:$('#lessonPrintOrientation').value,scope:scope,pageGroups:pageGroups};if(asPdf)downloadLessonPdf(cls,lesson);else printLesson(cls,lesson,pageGroups);};dlg.returnValue='';openDlg(dlg);
  }
  var pdfExportBusy=false;
  async function downloadLessonPdf(cls,lesson){
    if(pdfExportBusy)return;pdfExportBusy=true;
    var frame=null,pdfOrientation=lessonPrintOptions.orientation;
    try{
      flash('正在生成打印版 PDF…');
      lessonExporting=true;try{printLesson(cls,lesson,lessonPrintOptions.pageGroups);}finally{lessonExporting=false;document.body.classList.remove('print-lesson');}
      var html=$('#printArea').innerHTML,pageCss=$('#lessonPageStyle').textContent;
      var css=await (await fetch(new URL('styles.css',location.href))).text();
      css=(css+'\n'+pageCss).replace(/@media screen/g,'@media not all').replace(/@media print/g,'@media all');
      css+='\nhtml,body{margin:0!important;padding:0!important;width:100%!important;height:auto!important;min-height:0!important;background:white!important}#printArea{display:block!important;position:static!important}.lesson-duplex-page{width:100%!important;margin:0!important;border:0!important}';
      var landscape=pdfOrientation==='landscape',widthMm=landscape?277:190,heightMm=landscape?178:264,widthPx=Math.round(widthMm*96/25.4),heightPx=Math.round(heightMm*96/25.4);
      frame=document.createElement('iframe');frame.title='生成打印PDF';frame.style.cssText='position:fixed;left:-20000px;top:0;width:'+widthPx+'px;height:'+heightPx+'px;border:0';
      var loaded=new Promise(function(resolve){frame.onload=resolve;});
      frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css+'</style><body class="print-lesson"><div id="printArea">'+html+'</div></body>';
      document.body.appendChild(frame);await loaded;await frame.contentDocument.fonts.ready;
      var doc=frame.contentDocument,pages=Array.from(doc.querySelectorAll('.lesson-duplex-page'));
      if(!pages.length)throw new Error('没有可导出的页面。');
      var pdf=new window.jspdf.jsPDF({orientation:landscape?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
      for(var i=0;i<pages.length;i++){
        var body=doc.createElement('body');body.className='print-lesson';body.setAttribute('xmlns','http://www.w3.org/1999/xhtml');body.style.cssText='margin:0;width:'+widthPx+'px;height:'+heightPx+'px;background:white';
        var style=doc.createElement('style');style.textContent=css;
        var area=doc.createElement('div');area.id='printArea';area.appendChild(pages[i].cloneNode(true));body.appendChild(style);body.appendChild(area);
        var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+widthPx+'" height="'+heightPx+'"><foreignObject width="100%" height="100%">'+new XMLSerializer().serializeToString(body)+'</foreignObject></svg>';
        var img=new Image();await new Promise(function(resolve,reject){img.onload=resolve;img.onerror=function(){reject(new Error('打印页面渲染失败。'));};img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
        var canvas=document.createElement('canvas');canvas.width=Math.round(widthPx*3.125);canvas.height=Math.round(heightPx*3.125);var context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
        if(i)pdf.addPage('a4',landscape?'landscape':'portrait');pdf.addImage(canvas.toDataURL('image/png'),'PNG',10,10,widthMm,heightMm,undefined,'FAST');canvas.width=canvas.height=1;
      }
      download(cls.name+'_第'+lesson.seq+'次课_打印版.pdf',pdf.output('arraybuffer'),'application/pdf');flash('打印版 PDF 已下载，换电脑可直接打印');
    }catch(e){alert('PDF 下载失败：'+e.message+'。也可使用“打印本课”并选择另存为 PDF。');}
    finally{if(frame)frame.remove();pdfExportBusy=false;}
  }
  function downloadLessonExcel(cls,lesson){
    var box=document.createElement('div'),original=window.print,options=lessonPrintOptions;window.print=function(){};lessonPrintOptions={range:'both',orientation:'portrait'};lessonExporting=true;
    try{printLesson(cls,lesson);box.innerHTML=$('#printArea').innerHTML;}finally{window.print=original;lessonPrintOptions=options;lessonExporting=false;document.body.classList.remove('print-lesson');}
    var table=box.querySelector('.sheet-tb');
    var wb=XLSX.utils.book_new();
    if(table)XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(table,{raw:true}),'本课加分表');
    var A=window.JFDT_ASSESSMENT,rows=[['班级','课次','日期','姓名','学号','平时分','项目完成率','考勤完成率','合并完成率','考勤（9分制折%）','计入总评','期末至少需考']];
    A.rows(cls,lessonsOf(cls.id),memberTotals(cls)).forEach(function(m){rows.push([cls.name,lesson.seq,lesson.date,m.name,String(m.sid||''),m.regular,m.task.maximum?Math.round(m.task.rate*1000)/10+'%':'—',Math.round(m.attendanceRate*1000)/10+'%',m.totalMaximum?Math.round(m.performanceRate*1000)/10+'%':'—',Math.round(m.attendance/9*1000)/10+'%',m.contribution,m.attendanceFailed?'不适用':m.needed>100?'无法达到':m.needed]);});
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'个人成绩');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['加分与换算说明'],[box.querySelector('.lesson-rules-back').textContent]]),'规则说明');
    var rules=Array.from(box.querySelector('.lesson-rules-back').children).map(function(el){return {text:el.textContent,heading:/^H/.test(el.tagName)};});
    var formatted=window.JFDT_PRINT_EXCEL(table,cls.name+' · 第'+lesson.seq+'次 · '+lesson.date+' · '+(lesson.topic||''),rows,rules);
    download(cls.name+'_第'+lesson.seq+'次课_可编辑打印版.xlsx',formatted,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function printLesson(cls, lesson, pageGroups) {
    var dg=lesson.dutyGroup?+lesson.dutyGroup:null;
    var printGroups=pageGroups&&pageGroups.length?pageGroups.reduce(function(all,part){return all.concat(part);},[]):cls.groups,cols=verticalColumns(cls),head=verticalHead();
    /* 备注行：先写待分组名单（纸质表本来就有），再跟一行各组累计 */
    var pend = pendingList(cls);
    var note = '备注·待分组名单（共' + pend.length + '人）：' +
      (pend.length ? pend.map(function (r) {
        return esc(r.name) + '(' + two(r.no) + ')';
      }).join('、') : '无，全班都已分组');
    var foot='<tfoot><tr><td class="c-note" colspan="'+10+'">'+note+'</td></tr><tr><td class="c-note" colspan="'+10+'">右侧三列为本学期当前个人成绩，与排名页相同；按姓名逐行对应。成绩按已登记的项目和考勤计算，考勤挂科时考试目标不适用。打印后不会自动更新。</td></tr></tfoot>';

    var cfg=window.JFDT_ASSESSMENT.settings(cls);
    var reverse='<section class="lesson-duplex-page lesson-rules-back"><h1>小组制课堂 · 加分与成绩换算说明</h1><p>'+esc(cls.name)+' · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><h2>1. 项目与扣分</h2><p>每个命名个人项目满分 100%（20%、40%、60%、80%、100% 五档）。同课任一组修改个人项目名，全班同步。手机未入袋、个人或全组扣分都从本节项目分里扣，每次 −20%，扣完为止；全组扣分从每个人身上扣，个人扣分只扣本人，最低 0%，不跨课。</p><h2>2. 值日与完成率换算</h2><p>「值日缺勤」是整学期一个 5 分项目（只算一次，每节课都显示同一个学期值）：一学期没缺勤就是 100%，值日组缺勤时教师点一下「值日缺勤」，全组每人 −20%（团队绑定，要扣都扣），第二次轮到值日再缺勤还能再扣，最低 0%。每节课的满分只有 5×已命名项目数，本节完成率＝本节项目净得分÷（5×已命名项目数）。整学期分母＝5（值日缺勤，只算一次）＋Σ每课 5×已命名项目数，所以项目再多也不会被每课白送的 5 分稀释。例如 4 个任务打 3 个 100%、1 个 0%：300%÷400%＝75%。考勤是学期固定项目，满分折 100%（9 分制扣分，如扣 1 分 → 约 88.9%）。平时分＝项目完成率×100；计入总评＝平时分×40%，满分40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。</p><h2>3. 考勤与挂科标记</h2><p>本班默认扣分：迟到'+cfg.late+'、早退'+cfg.early+'、旷课'+cfg.truant+'、请假'+cfg.leave+'（9 分制分值，教师可随时更正）；每次可由教师更正。迟到＋早退每'+cfg.lateEarlyConversion+'次折算1次旷课，只用于挂科计数，不重复扣分。实际＋折算旷课合计'+cfg.truantFailure+'次触发标红；当前考勤挂科标记'+(cfg.attendanceFailureEnabled?'开启':'关闭')+'。门槛与开关由教师在二级设置调整，更正后自动重算。</p><h2>4. 期末还需考多少分</h2><p>平时占40%，期末占60%，本班及格线'+cfg.passScore+'。期末需考=max(0,(及格线−平时成绩×0.4)÷0.6)，向上取0.1分。折合列仅显示一位小数，计算使用未提前舍入的数值。超过100表示无法达到；考勤挂科时目标不适用，考试高分不能解除标记。</p><h2>5. 阅读与使用</h2><p>每名学生独占一行，姓名与值日缺勤、课堂任务、考勤完成率及右侧三列直接对应；右侧为打印时本学期当前个人成绩，与排名页相同，不是小组平均分。未编辑考勤默认到课，只登记请假、旷课、迟到或早退等异常。资料未齐时供参考。纸上填写不会自动识别，教师需回网页补录；以网页最新记录为准。</p><p class="duplex-note">双面打印：A4竖向，长边翻转；关闭浏览器页眉页脚。每张加分表正面后紧跟这份规则背面。</p></section>';
    var groupsPerPage=pageGroups&&pageGroups.length?pageGroups:[printGroups],pages=[];
    groupsPerPage.forEach(function(part,pageIndex){var body=part.map(function(g){return verticalGroup(cls,lesson,g,true);}).join('');pages.push('<section class="lesson-duplex-page lesson-duplex-front"><div class="sheet-title">课堂分组与加分记录表</div><div class="sheet-info">'+esc(cls.name)+' · 第'+lesson.seq+'次 · '+esc(lesson.date||'')+' · '+esc(lesson.topic||'')+'</div><div class="sheet-duty">值日：'+(dg?'第'+dg+'组':'未指定')+' · 第'+(pageIndex+1)+'张 · '+(part.length===1?'第'+part[0].no+'组':'第'+part[0].no+'—'+part[part.length-1].no+'组')+'</div><table class="sheet-tb sheet-vertical"><colgroup>'+cols+'</colgroup>'+head+body+foot+'</table></section>');pages.push(reverse);});
    var holder=document.createElement('div');holder.innerHTML=pages.join('');
    if(lessonPrintOptions.range==='front')holder.querySelectorAll('.lesson-rules-back').forEach(function(e){e.remove();});
    if(lessonPrintOptions.range==='rules')holder.querySelectorAll('.lesson-duplex-front').forEach(function(e){e.remove();});
    var style=$('#lessonPageStyle');if(!style){style=document.createElement('style');style.id='lessonPageStyle';document.head.appendChild(style);}
    var landscape=lessonPrintOptions.orientation==='landscape';
    var printSlots=printGroups.reduce(function(n,g){return n+Math.max(1,g.members.filter(function(m){return !!m.name;}).length);},0);
    var printLine=Math.min(4,(landscape?118:200)/Math.max(1,printSlots)),printFont=Math.min(10,printLine*2.5);
    style.textContent='@media print{@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:10mm}@page leaderPaper{size:A4 '+(landscape?'landscape':'portrait')+';margin:10mm}.lesson-duplex-page{height:'+(landscape?'178':'264')+'mm!important}.lesson-duplex-front .sheet-tb{top:'+(landscape?'31':'22')+'mm!important;transform:none!important;zoom:'+(landscape?'.65':'.92')+';width:100%!important}.lesson-rules-back{font-size:'+(landscape?'8':'10')+'pt!important}.lesson-rules-back p{font-size:'+(landscape?'8':'10')+'pt!important}.lesson-rules-back h2{margin:2mm 0 1mm!important}}';
    style.textContent+='@media print{.lesson-duplex-front .sheet-tb{top:20mm!important;transform:none!important;zoom:1!important;width:100%!important;--print-font:'+printFont+'pt;--print-line:'+printLine+'mm}}';
    printArea('<div class="lesson-duplex">'+holder.innerHTML+'</div>','lesson');
  }

  function printRank() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    var ls = lessonsOf(cls.id);
    var gr = cls.groups.map(function (g) { return { no: g.no, t: groupCum(cls, g.no) }; })
      .sort(function (a, b) { return b.t - a.t; });
    var ms = memberTotals(cls);

    var html = '<div class="rp">' +
      '<h2>' + esc(cls.name) + ' · 积分总览（截至第 ' + (ls.length ? ls[ls.length - 1].seq : 0) + ' 次课）</h2>' +
      '<p class="ph">教师：' + esc(cls.teacher || '') + '　共 ' + ls.length + ' 次课记录　打印时间：' +
      new Date().toLocaleString('zh-CN') + '</p>' +
      '<h2>一、小组累计排行</h2><table><thead><tr><th>名次</th><th>组号</th><th>人数</th><th>累计完成率</th></tr></thead><tbody>' +
      gr.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td>第 ' + r.no + ' 组</td><td>' +
          (memberCount(groupOf(cls, r.no)) || '') + '</td><td><b>' + pctText(Math.max(0, r.t) / (5 * groupLessonSpan(ls)) * 100) + '</b></td></tr>';
      }).join('') + '</tbody></table>';

    if (ms.length) {
      var printSemesterMax = semesterProjectMax(ls);
      html += '<h2>二、个人总分排行</h2><table><thead><tr><th>名次</th><th>姓名</th><th>学号</th><th>小组</th>' +
        '<th>组得分</th><th>个人扣分</th><th>完成率</th></tr></thead><tbody>' +
        ms.map(function (m, i) {
          return '<tr' + (i === 0 && m.total > 0 ? ' class="top1"' : '') + '><td>' + (i + 1) + '</td><td>' +
            esc(m.name) + '</td><td>' + esc(m.sid || (m.no == null ? '' : m.no)) +
            '</td><td>第 ' + m.gno + ' 组</td><td>' + pctText(printSemesterMax ? Math.max(0, m.groupScore) / printSemesterMax * 100 : 0) +
            '</td><td>' + (m.personal ? '−' + pctText(printSemesterMax ? m.personal / printSemesterMax * 100 : 0) : '0') + '</td><td><b>' + (printSemesterMax ? pctText(Math.max(0, m.total) / printSemesterMax * 100) : '—') + '</b></td></tr>';
        }).join('') + '</tbody></table>';
    }

    if (ls.length) {
      html += '<div class="pagebreak"></div><h2>三、逐节得分明细</h2><table><thead><tr><th>组号</th>' +
        ls.map(function (l) { return '<th>第' + l.seq + '课</th>'; }).join('') +
        '<th>累计</th></tr></thead><tbody>' +
        cls.groups.map(function (g) {
          return '<tr><td>第 ' + g.no + ' 组</td>' +
            ls.map(function (l) { return '<td>' + (touched(l, g.no) ? pctText(Math.max(0, groupTotal(l, g.no)) / 5 * 100) : '') + '</td>'; }).join('') +
            '<td><b>' + pctText(Math.max(0, groupCum(cls, g.no)) / (5 * groupLessonSpan(ls)) * 100) + '</b></td></tr>';
        }).join('') + '</tbody></table>';
    }

    if(window.JFDT_ASSESSMENT) html+=window.JFDT_ASSESSMENT.printHtml(cls,ls,ms);
    printArea(html + '</div>', 'rank');
  }

  /* ================= 顶部交互 ================= */

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (b) switchView(b.dataset.view);
  });

  $('#classSel').addEventListener('change', function () {
    S.ui.classId = this.value; S.ui.lessonId = null; save(); renderScore();
    /* 切班通知考勤自动同步（2026-11-13）：新班的课次签到要重新拉一遍，
       不能等 5 分钟那一轮定时器。attendance-sync.js 监听这个自定义事件。 */
    try { document.dispatchEvent(new CustomEvent('hx-class-change', { detail: { classId: this.value } })); } catch (e) { }
  });
  $('#lessonSel').addEventListener('change', function () {
    S.ui.lessonId = this.value; save(); renderScore();
  });

  /* ── 考勤自动同步挂载（2026-11-13）──────────────────────────────────
     用户原话：「考勤完成率和考勤工具卡实行同步切记」。
     同步逻辑全在 attendance-sync.js（那个模块不直接访问本文件的闭包），这里把它的依赖按约定传进去：
     当前班级、整份 state、落盘函数 save、云端 rpc、以及「已登录才给 cloud」。
     模块内部：首次 6 秒后跑一次，之后每 5 分钟 / 切回前台（60 秒节流）/ 切班时各跑一次；
     只写「考勤工具明确签到过」且「本工具没被老师手改过」的格子，安静的失败不打扰上课。 */
  if (window.JFDT_ATT_SYNC && typeof window.JFDT_ATT_SYNC.boot === 'function') {
    try {
      window.JFDT_ATT_SYNC.boot(function () {
        return {
          cls: curClass(),
          state: S,
          save: save,
          rpc: function (name, args) { return CLOUD.rpc(name, args); },
          cloud: (CLOUD_ON && CLOUD && CLOUD.profile && CLOUD.profile()) ? CLOUD : null
        };
      });
    } catch (e) { /* 同步是后台功能，挂了也不能影响上课 */ }
  }
  /* 2026-11-11：顶部常驻班级/课次选择器（#topClassSel / #topLessonSel）已并入记分工具条，
     这里对应的两个 change 监听一并删除——顶栏上已经不存在这两个下拉，留着只是死代码。 */
  $('#rankClassSel').addEventListener('change', function () {
    S.ui.classId = this.value; save(); renderRank();
  });
  $('#btnPrintRank').addEventListener('click', printRank);
  /* 个人详细分排序切换（2026-11-10 #14） */
  var rankSortSeg = $('#rankSortSeg');
  if (rankSortSeg) {
    rankSortSeg.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-sort]');
      if (!b || b.dataset.sort === rankSort) return;
      rankSort = b.dataset.sort;
      rankSortSeg.querySelectorAll('[data-sort]').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderRank();
    });
  }

  /* 撤销：按钮 + Ctrl/Cmd+Z */
  function redo(index) {if(typeof index!=='number')index=(S.redo||[]).length-1;var entry=(S.redo||[]).splice(index,1)[0];if(!entry)return false;var l=getLesson(entry.op.lessonId);if(!l)return false;var effect=entry.redoEffect||operationEffect(entry.op),actual=applyEffect(entry.op,effect,1);entry.op.effect=actual;S.undo.push(entry.op);S.ui.classId=l.classId;S.ui.lessonId=l.id;addOperationLog('重做',undoLabel(reverseOp(entry.op)));save(false);renderScore();if(entry.op.projectBatch)renderLeader();renderUndoBtn();flash('已恢复所选操作');return true;}
  /* V10（2026-11-12）：操作日志与撤销已整体移除（用户确认），Ctrl+Z 撤销快捷键一并停用。
     数据层 pushUndo/undo/redo 保留（不暴露 UI），将来若要恢复撤销只需加回入口。 */

  /* 表格式 / 卡片式 切换 */
  $('#layoutSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-l]');
    if (!b || b.dataset.l === scoreLayout) return;
    scoreLayout = b.dataset.l;
    S.ui.scoreLayout = scoreLayout;
    $$('#layoutSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
    save(false);
    if (UI) UI.layout(renderScore);
    else renderScore();
  });

  /* 新开一课 */
  var dlg = $('#dlgLesson');
  $('#btnNewLesson').addEventListener('click', function () {
    var cls = curClass();
    if (!cls) { alert('没有可用班级。'); return; }
    var ls = lessonsOf(cls.id);
    $('#nlClass').value = cls.name;
    $('#nlSeq').value = ls.length ? (ls[ls.length - 1].seq || ls.length) + 1 : 1;
    $('#nlDate').value = today();
    $('#nlTopic').value = '';
    $('#nlDuty').value = '';
    openDlg(dlg);
  });

  dlg.addEventListener('close', function () {
    if (dlg.returnValue !== 'ok') return;
    var cls = curClass();
    var seq = Math.max(1, parseInt($('#nlSeq').value, 10) || 1);
    var duties=$('#nlDuty').value.split(/[、,，\s]+/).map(Number).filter(function(n){return Number.isInteger(n)&&n>0;});var duty=duties[0];
    var l = {
      id: uid('l'),
      classId: cls.id,
      seq: seq,
      date: $('#nlDate').value || today(),
      topic: $('#nlTopic').value.trim(),
      dutyGroup: isNaN(duty) ? null : duty, dutyGroups:Array.from(new Set(duties)),
      scores: {}, memberProjectBase:5
    };
    cls.groups.forEach(function(g){l.scores[String(g.no)]={first:0,group:5,phone:0,personal:{}};});
    S.lessons.push(l);
    S.ui.lessonId = l.id;
    save();
    renderScore();
    flash('第 ' + l.seq + ' 次课已开始记录');
  });

  /* ================= 登录闸门 / 云端同步 ================= */

  var offlineWhy = '';

  /** 没有云端时还能不能干活：本机有存档、或至少带着 data.js 的内置名单 */
  function hasLocalData() {
    try { if (localStorage.getItem(LS_KEY)) return true; } catch (e) { /* 隐私模式 */ }
    return !!(window.SEED_DATA && window.SEED_DATA.classes);
  }

  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* 满了 */ }
    publishStudentFeed();   // 进应用 / 收到云端新数据时也补发一次，学生那边不至于停在旧分数
  }

  function fmtTime(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function gateShow(which, msg, info) {
    /* 登录、注册、找回密码都在华夏工具首页：这里只剩“去首页登录”和加载中（wait） */
    if (which !== 'offline') which = which === 'wait' ? 'wait' : 'home';
    $('#gate').classList.toggle('quiet', which === 'wait');
    document.body.classList.add('gated');
    $('#gate').hidden = false;
    var panels = { login: '#gateLogin', register: '#gateRegister', reset: '#gateReset', newpass: '#gateNewPassword', offline: '#gateOffline', home: '#gateHome' };
    Object.keys(panels).forEach(function (k) { var node = $(panels[k]); if (node) node.hidden = (k !== which); });
    var m = $('#gateMsg');
    m.hidden = !msg;
    /* 加载中（wait）：一排跳动的像素方块 + 文案，和闪屏、各工具里的药丸是同一套。
       2026-11-04 之前这里是一行干文字，属于全站最后一处旧式加载提示。 */
    if (which === 'wait' && msg) {
      m.innerHTML = '';
      var pxw = document.createElement('span');
      pxw.className = 'hx-px';
      pxw.setAttribute('aria-hidden', 'true');
      for (var gi = 0; gi < 7; gi++) { var pi = document.createElement('i'); pi.style.setProperty('--i', String(gi)); pxw.appendChild(pi); }
      var pxt = document.createElement('span');
      pxt.textContent = msg;
      m.appendChild(pxw); m.appendChild(pxt);
      m.classList.add('hx-gatepill');
    } else {
      m.textContent = msg || '';
      m.classList.remove('hx-gatepill');
    }
    m.classList.toggle('info', !!info);
  }

  function gateHide() {
    document.body.classList.remove('gated');
    $('#gate').hidden = true;
  }

  function setGateBusy(busy) {
    ['#btnAccountLogin', '#btnRegisterNow', '#btnSendReset', '#btnSaveRecovered', '#btnGuest', '#btnOAuthGithub', '#btnOAuthGoogle', '#btnLocalOnly'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.disabled = !!busy;
    });
  }

  /* Returning from an OAuth error page may restore disabled controls from bfcache. */
  window.addEventListener('pageshow', function () { setGateBusy(false); });

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }

  /* 教师账号：可以填邮箱，也可以只填数字/短账号。
     没有 @ 的一律补成「账号@accountDomain」，这个地址只当登录身份，不发信。 */
  function accountDomain() {
    var cfg = window.JFDT_CONFIG || {};
    return String(cfg.accountDomain || 'jfdt.app').replace(/^@/, '');
  }
  function resolveAccount(value) {
    var raw = String(value || '').trim().replace(/\s+/g, '');
    if (!raw) return '';
    return raw.indexOf('@') >= 0 ? raw : raw + '@' + accountDomain();
  }
  function accountProblem(value, email) {
    var raw = String(value || '').trim();
    if (!raw) return '请填写教师账号。';
    if (raw.indexOf('@') >= 0) {
      return looksLikeEmail(raw) ? '' : '邮箱格式不对，例如 name@example.com。';
    }
    return /^[0-9A-Za-z._-]{2,32}$/.test(raw) ? '' : '账号用 2–32 位数字、字母、点、下划线或短横线。';
  }
  function registerCode() {
    return String((window.JFDT_CONFIG || {}).registerCode || '');
  }
  /* 华夏工具：新老师用管理员发的教师邀请码（一码一用，由数据库核对） */
  function hxInvite() {
    return !!(window.JFDT_CONFIG || {}).hxTeacherGate;
  }
  function showInviteField() {
    var wrap = $('#regInviteWrap'), hint = $('#accountDomainHint');
    if (hint) hint.textContent = accountDomain();
    if (wrap) wrap.hidden = !registerCode() && !hxInvite();
  }

  function gateError(panel, e, prefix) {
    var text = e && e.message ? e.message : String(e);
    gateShow(panel, (prefix || '') + text);
  }

  function doLogin() {
    var account = $('#loginEmail').value.trim();
    var email = resolveAccount(account);
    var password = $('#loginPassword').value;
    var problem = accountProblem(account, email);
    if (problem) { gateShow('login', problem); return; }
    if (!password) { gateShow('login', '请填写密码。'); return; }
    setGateBusy(true);
    gateShow('login', null);
    CLOUD.login(email, password).then(function () {
      $('#loginPassword').value = '';
      setGateBusy(false);
    }).catch(function (e) {
      setGateBusy(false);
      gateError('login', e);
    });
  }

  function doRegister() {
    var account = $('#regEmail').value.trim();
    var email = resolveAccount(account);
    var password = $('#regPassword').value;
    var confirm = $('#regConfirm').value;
    var problem = accountProblem(account, email);
    if (problem) { gateShow('register', problem); return; }
    var needCode = registerCode();
    var typedCode = $('#regInvite') ? $('#regInvite').value.trim() : '';
    if (hxInvite()) {
      if (!typedCode) { gateShow('register', '请填写管理员给你的教师邀请码。'); return; }
    } else if (needCode) {
      var typed = $('#regInvite') ? $('#regInvite').value.trim() : '';
      if (!typed) { gateShow('register', '请填写管理员给你的邀请码。'); return; }
      if (typed.toUpperCase() !== needCode.toUpperCase()) { gateShow('register', '邀请码不对，请向管理员确认。'); return; }
    }
    if (password.length < 6 || password.length > 128) { gateShow('register', '密码需为 6–128 位。'); return; }
    if (password !== confirm) { gateShow('register', '两次输入的密码不一致。'); return; }
    setGateBusy(true);
    gateShow('register', null);
    CLOUD.register(email, password, $('#regName').value.trim(), hxInvite() ? typedCode : '').then(function (p) {
      setGateBusy(false);
      $('#regPassword').value = ''; $('#regConfirm').value = '';
      if (p && p.displayName) flash('欢迎，' + p.displayName + '。账号已建好。', true);
    }).catch(function (e) {
      setGateBusy(false);
      /* 需要邮箱确认不算失败：把提示留在注册页，方便老师回去点链接 */
      gateError('register', e, e && e.code === 'confirm_email' ? '' : '注册没能完成：');
      if (e && e.code === 'confirm_email') {
        $('#gateMsg').classList.add('info');
        $('#loginEmail').value = account;   // 回到登录页时填的还是他刚敲的账号
      }
    });
  }

  function doSendReset() {
    var account = $('#resetEmail').value.trim();
    var email = resolveAccount(account);
    var problem = accountProblem(account, email);
    if (problem) { gateShow('reset', problem); return; }
    if (account.indexOf('@') < 0 && !/@(qq|163|126|gmail|outlook|foxmail|sina|139|yeah|aliyun)\./i.test('@' + email.split('@')[1] + '.')) {
      /* 数字账号没有真实邮箱，发不了重置信：直接说清楚，别让人干等 */
      gateShow('reset', '这个账号是数字账号，没有绑定邮箱，收不到重置邮件。请让管理员在后台重设密码。');
      return;
    }
    setGateBusy(true);
    gateShow('reset', null);
    CLOUD.resetPasswordFor(email).then(function () {
      setGateBusy(false);
      $('#loginEmail').value = email;
      gateShow('login', '重置邮件已发送到 ' + email + '，点开邮件里的链接就能设置新密码。', true);
    }).catch(function (e) {
      setGateBusy(false);
      gateError('reset', e, '发送失败：');
    });
  }

  function doSaveRecovered() {
    var password = $('#recoverPassword').value;
    if (password.length < 6 || password.length > 128) { gateShow('newpass', '密码需为 6–128 位。'); return; }
    if (password !== $('#recoverConfirm').value) { gateShow('newpass', '两次输入的密码不一致。'); return; }
    setGateBusy(true);
    CLOUD.changePassword(null, password).then(function () {
      setGateBusy(false);
      $('#recoverPassword').value = ''; $('#recoverConfirm').value = '';
      gateShow('login', '新密码已生效，正在进入…', true);
      setTimeout(function () { window.location.replace(window.location.pathname + window.location.search); }, 600);
    }).catch(function (e) {
      setGateBusy(false);
      gateError('newpass', e, '保存失败：');
    });
  }

  function doLoginWithProvider(provider) {
    setGateBusy(true);
    gateShow('login', '正在跳转到 ' + provider + ' 授权页…', true);
    try {
      CLOUD.signInWithProvider(provider);
    } catch (e) {
      setGateBusy(false);
      gateError('login', e);
    }
  }

  async function doGuestLogin() {
    var go = await askConfirm({
      title: '用访客身份进入？',
      body: '访客记录同样保存到云端，但换设备或清缓存后就找不回来了。',
      note: '需要长期使用，请注册邮箱账号。',
      ok: '访客进入'
    });
    if (!go) return;
    setGateBusy(true);
    gateShow('login', null);
    CLOUD.signInAnonymously().then(function () {
      setGateBusy(false);
    }).catch(function (e) {
      setGateBusy(false);
      gateError('login', e, '访客登录没能完成：');
    });
  }

  /* 只显示 Supabase 后台真的开了的登录方式 */
  function loadAuthOptions() {
    if (!CLOUD || !CLOUD.providers) return;
    CLOUD.providers().then(function (o) {
      var box = $('#gateProviders');
      var github = $('#btnOAuthGithub'), google = $('#btnOAuthGoogle'), guest = $('#btnGuest');
      if (github) github.hidden = !o.github;
      if (google) google.hidden = !o.google;
      if (guest) guest.hidden = !o.guest;
      var any = (github && !github.hidden) || (google && !google.hidden) || (guest && !guest.hidden);
      if (box) box.hidden = !any;
      if (o.signup === false) { var reg = $('#btnShowRegister'); if (reg) reg.hidden = true; }
    });
  }

  function renderUserBox(p) {
    var box = $('#userBox');
    box.hidden = true; /* 个人信息、切换账号、改密码只在华夏工具首页 */
    if (!p) return;
    var nm = p.displayName || p.name || '未命名老师';
    $('#userName').textContent = nm;
    var av = $('#userAvatar');
    if (p.avatarUrl) {
      av.innerHTML = '<img alt="" src="' + esc(p.avatarUrl) + '">';
      av.classList.add('has-img');   // 有图 → 圆盘透明（见 styles.css .avatar.has-img）
    } else {
      av.textContent = nm.slice(0, 1);
      av.classList.remove('has-img');
    }
    /* 管理员在名字后面挂一块 VIP 金牌（列表页已随「管理」模块一起删除，只留这枚身份标记） */
    box.classList.toggle('is-admin', !!p.isAdmin);
    var vip = $('#userVip');
    if (vip) vip.hidden = !p.isAdmin;
  }

  /* ---------------- 个人信息 ---------------- */

  var dlgMe = $('#dlgMe');
  var dlgAccountSwitch = $('#dlgAccountSwitch');
  var rememberedAccountsKey = 'jfdt.accounts.v1';
  var meNudged = false;              // 「还没填名字」只提示一次

  function rememberedAccounts() {
    try { var list = JSON.parse(localStorage.getItem(rememberedAccountsKey) || '[]'); return Array.isArray(list) ? list : []; } catch (e) { return []; }
  }
  function rememberAccount(profile) {
    if (!profile || !profile.uid) return;
    var list = rememberedAccounts().filter(function (a) { return a.uid !== profile.uid; });
    list.unshift({ uid: profile.uid, username: profile.username || '', displayName: profile.displayName || profile.name || '未命名老师', realName: profile.realName || '', lastUsed: Date.now() });
    try { localStorage.setItem(rememberedAccountsKey, JSON.stringify(list.slice(0, 8))); } catch (e) {}
  }
  function renderRememberedAccounts() {
    var box = $('#rememberedAccounts'); if (!box) return;
    var current = CLOUD && CLOUD.profile && CLOUD.profile(), list = rememberedAccounts();
    box.innerHTML = list.length ? '<p class="field-label">本机已记住的账号</p>' + list.map(function (a) {
      var currentMark = current && current.uid === a.uid;
      return '<button type="button" class="remembered-account'+(currentMark?' current':'')+'" data-switch-account="'+esc(a.username)+'"'+(currentMark?' disabled':'')+'><span class="avatar mini">'+esc((a.displayName||a.username||'老').slice(0,1))+'</span><span><b>'+esc(a.displayName||a.username)+'</b><small>'+esc(a.username||'未填写账号')+(currentMark?' · 当前账号':'')+'</small></span></button>';
    }).join('') : '<p class="note">还没有其他已记住的账号；输入账号和密码即可加入列表。</p>';
    box.querySelectorAll('[data-switch-account]').forEach(function (button) { button.onclick = function () { $('#switchUsername').value = button.dataset.switchAccount; $('#switchPassword').focus(); }; });
  }
  function openAccountSwitch() { renderRememberedAccounts(); $('#switchUsername').value = ''; $('#switchPassword').value = ''; $('#switchAccountMsg').hidden = true; openDlg(dlgAccountSwitch); }
  function switchAccountNow() {
    var username = $('#switchUsername').value.trim(), password = $('#switchPassword').value, msg = $('#switchAccountMsg'), submit = $('#btnSwitchSubmit');
    if (!username || !password) { msg.textContent = '请选择或填写账号，并输入密码。'; msg.hidden = false; return; }
    submit.disabled = true; msg.hidden = true;
    var ready = CLOUD && CLOUD.flush ? CLOUD.flush() : Promise.resolve();
    ready.then(function () { return CLOUD.login(username, password); }).then(function () { dlgAccountSwitch.close(); flash('已切换到账号：' + username, true); }).catch(function (e) { msg.textContent = '切换失败：' + (e && e.message ? e.message : e); msg.hidden = false; }).finally(function () { submit.disabled = false; });
  }

  /* <dialog> 关掉之后要立刻再撑开（校验没过、保存失败都要留在这一页）。
     showModal 在极少数情况下会抛 InvalidStateError，退一步用 setTimeout 再来一次。 */
  function reopenDlg(d) {
    try { openDlg(d); } catch (e) { setTimeout(function () { openDlg(d); }, 0); }
  }

  function openMe() {
    var p = (CLOUD && CLOUD.profile && CLOUD.profile()) || null;
    if (!p) return;
    $('#meAvatar').textContent = (p.displayName || p.name || '老师').slice(0, 1);
    $('#mePreviewName').textContent = p.displayName || p.name || '未命名老师';
    $('#meRole').textContent = p.isAdmin ? '👑 管理员 VIP' : '教师账号';
    $('#meName').value = p.displayName || p.name || '';
    $('#meReal').value = p.realName || '';
    $('#meMsg').hidden = true;
    $('#btnMeSave').disabled = false;
    openDlg(dlgMe);
  }

  dlgMe.addEventListener('close', function () {
    if (dlgMe.returnValue !== 'ok') return;
    var name = $('#meName').value.trim();
    var real = $('#meReal').value.trim();
    var msg = $('#meMsg');
    if (!name) {
      /* 空名字会让管理员在列表里看到一串「未命名」，所以直接挡住 */
      msg.textContent = '名字不能空着，不然别人分不清你是谁。';
      msg.className = 'gate-msg';
      msg.hidden = false;
      reopenDlg(dlgMe);                     // method="dialog" 已经把窗口关了，再撑开
      return;
    }
    $('#btnMeSave').disabled = true;
    CLOUD.updateProfile(name, real).then(function (p) {
      renderUserBox(p);
      flash('个人信息已保存', true);
      document.querySelectorAll('.profile-save-feedback').forEach(function (old) { old.remove(); });
      var feedback = document.createElement('div');
      feedback.className = 'profile-save-feedback';
      feedback.setAttribute('role', 'status');
      feedback.innerHTML = '<span class="profile-save-check" aria-hidden="true">✓</span><span>个人信息已保存</span>';
      document.body.appendChild(feedback);
      setTimeout(function () { feedback.remove(); }, 1700);
    }).catch(function (e) {
      $('#btnMeSave').disabled = false;
      msg.textContent = '没能保存：' + (e && e.message ? e.message : e);
      msg.className = 'gate-msg';
      msg.hidden = false;
      reopenDlg(dlgMe);
    });
  });
  $('#btnSwitchAccount').onclick = function () { dlgMe.close(); openAccountSwitch(); };
  $('#btnAccountSwitchClose').onclick = function () { dlgAccountSwitch.close(); };
  $('#btnSwitchSubmit').onclick = switchAccountNow;
  $('#btnSwitchOther').onclick = async function () {
    var out = await askConfirm({
      title: '退出当前账号？',
      body: '退出后会打开登录页。当前记录会先尝试同步。',
      ok: '退出',
      danger: true
    });
    if (!out) return;
    var ready = CLOUD && CLOUD.flush ? CLOUD.flush() : Promise.resolve();
    ready.then(function () { return CLOUD.signOut(); });
  };

  var syncEditBlocked=true;
  function setSyncEditGate(blocked,message){syncEditBlocked=blocked;if(!S)return;['#view-score','#view-leader','#view-attendance','#view-pool','#scoreTools','#rosterCard','#lessonListCard','#hxRosterBox'].forEach(function(selector){var el=$(selector);if(el)el.toggleAttribute('inert',blocked);});var gate=$('#syncEditGate');if(!gate){gate=document.createElement('div');gate.id='syncEditGate';gate.className='sync-edit-gate';gate.setAttribute('role','status');$('#main').prepend(gate);}gate.hidden=!blocked;gate.textContent=message||'正在核对云端，确认后开放编辑';if(!blocked)hxAfterGate();}
  var conflictNotice=document.createElement('dialog');conflictNotice.id='dlgSyncConflict';conflictNotice.innerHTML='<div class="dlg"><div class="dlg-head"><h3>两台设备的记录不同</h3><button type="button" class="dlg-x" id="closeSyncConflict" aria-label="关闭同步冲突提示">✕</button></div><div class="dlg-body"><p>系统已暂停上传，请先查看下面的业务数据差异，再选择保留哪一边。</p><p class="note">关闭窗口不会解决冲突；完成一次处理后才会恢复编辑和自动同步。</p><div id="syncConflictDetails" aria-live="polite"></div><div class="btnrow conflict-actions"><button class="btn" id="backupConflictLocal">先下载本机存档</button><button class="btn" id="keepCloudConflict">保留云端记录</button><button class="btn primary" id="keepLocalConflict">保留本机记录</button></div><button class="linkbtn" id="openSyncConflictTools">打开数据与同步页面</button></div></div>';document.body.appendChild(conflictNotice);wireDialog(conflictNotice);var conflictNoticeShown=false;
  $('#closeSyncConflict').onclick=function(){conflictNotice.close();};$('#backupConflictLocal').onclick=function(){downloadLocalSnapshot();};$('#openSyncConflictTools').onclick=function(){conflictNotice.close();flash('同步已经自动进行：数据库自带同步，这里没有单独的同步页了。冲突请用下面「保留云端 / 保留本机」解决。');};$('#keepCloudConflict').onclick=function(){conflictNotice.close();if(!CLOUD_ON||!CLOUD||!CLOUD.profile()){flash('请先登录。');return;}if(CLOUD.cancelPending&&!CLOUD.cancelPending()){flash('正在上传，稍后再试。');return;}var st=S.updatedAt;CLOUD.pull().then(function(rec){if(S.updatedAt!==st){flash('拉取期间记录已变，未覆盖。');return;}if(!rec||!rec.data||!rec.data.classes){flash('云端还没有这个账号的记录。');return;}S=migrate(JSON.parse(JSON.stringify(rec.data)));if(CLOUD.acceptRemote)CLOUD.acceptRemote(rec);if(!S.ui)S.ui={};if(!S.ui.classId&&S.classes[0])S.ui.classId=S.classes[0].id;S.updatedAt=new Date().toISOString();writeLocal();initLayout();fillClassSelects();flash('已用云端记录覆盖本机');}).catch(function(e){flash('拉取失败：'+(e&&e.message?e.message:e));});};$('#keepLocalConflict').onclick=function(){conflictNotice.close();if(!CLOUD_ON||!CLOUD||!CLOUD.profile()){flash('请先登录。');return;}var upload=CLOUD.forcePush?CLOUD.forcePush(function(){return S;}):(CLOUD.touch(function(){return S;}),CLOUD.flush());upload.then(function(){flash('已用本机记录覆盖云端。');}).catch(function(e){flash('上传失败，记录仍保存在当前设备：'+(e&&e.message?e.message:e));});};
  var cloudChip = $('#cloudChip');
  if (cloudChip) {
    cloudChip.onclick = function () { if (CLOUD && CLOUD.status().mode === 'conflict') openDlg(conflictNotice); };
    cloudChip.setAttribute('tabindex', '0'); cloudChip.setAttribute('role', 'button');
    cloudChip.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); } };
  }
  function renderCloudStatus(st) {
    st = st || (CLOUD && CLOUD.status()) || { mode: 'idle', text: '' };
    var map = { checking:'saving',ok: 'ok', saving: 'saving', connecting: 'saving', offline: 'offline', error: 'error', conflict: 'error' };
    var cls = map[st.mode] || '';
    if(st.mode==='conflict'&&S){
      function conflictValue(value){if(value===undefined)return '未设置';if(value===null)return '空值';if(typeof value==='object'){try{return JSON.stringify(value);}catch(e){return '[复杂数据]';}}return String(value);}
      function conflictLabel(path){var raw=String(path||'');if(raw==='/本机记录')return '本机记录概况';if(raw==='/处理范围')return '冲突处理范围';var parts=raw.split('/'),lesson=parts[1]==='lessons'&&getLesson(parts[2]),c=lesson&&getClass(lesson.classId);if(parts[1]==='classes')return '班级与分组';if(!lesson)return parts[1]==='lessons'?'课次记录':'业务数据';var prefix=(c?c.name:'当前班级')+' · 第'+lesson.seq+'次课';if(parts[3]==='scores'){var g=groupOf(c,+parts[4]),m=g&&g.members[+parts[6]],field=parts[5];return prefix+' · 第'+parts[4]+'组 · '+(field==='personal'?(m?m.name:'成员')+'个人扣分':field==='duty'||field==='dutyParticipation'?'值日分（旧制，已废弃）':field==='group'?'值日缺勤（整学期 5 分）':field==='phone'?'手机未入袋扣分':field==='first'?'首次分':'小组记分');}if(parts[3]==='leaderScores')return prefix+' · 第'+parts[4]+'组 · 个人项目评分';if(parts[3]==='attendance')return prefix+' · 考勤';return prefix+' · 课次或项目设置';}
      var rawDetails=Array.isArray(st.conflictDetails)?st.conflictDetails:[],details=rawDetails.filter(function(item,index){return rawDetails.findIndex(function(other){return String(other.path||'')===String(item.path||'')&&String(other.local)===String(item.local)&&String(other.remote)===String(item.remote);})===index;}),shown=details.slice(0,12),conflictCount=details.length||st.conflicts&&st.conflicts.length||0,detailHtml='<div class="sync-conflict-intro"><b>'+(conflictCount?'检测到 '+conflictCount+' 处差异':'检测到云端版本冲突')+'</b>'+(conflictCount?'：下面分别列出本机和云端的值。':'，但当前接口没有返回可展开的字段差异。');
      if(shown.length){detailHtml+='<div class="sync-conflict-table" role="table"><div class="sync-conflict-row sync-conflict-head" role="row"><span>位置</span><span>本机</span><span>云端</span></div>';shown.forEach(function(item){detailHtml+='<div class="sync-conflict-row" role="row"><span class="sync-conflict-path">'+esc(conflictLabel(item.path))+'</span><code>'+esc(conflictValue(item.local))+'</code><code>'+esc(conflictValue(item.remote))+'</code></div>';});detailHtml+='</div>'+(details.length>shown.length?'<p class="note">还有 '+(details.length-shown.length)+' 处差异，请先到首页「全站备份」导出本机存档，再到「数据与同步」继续核对。</p>':'');}else{detailHtml+='<p class="note">当前版本只拿到了差异位置，未能读取两端的具体值。请刷新后重试；系统仍会暂停上传，不会自动覆盖。</p>';}$('#syncConflictDetails').innerHTML=detailHtml;
    }

    if(CLOUD_ON&&S){if(st.mode==='ok')setSyncEditGate(false);else if(['checking','connecting','offline','error','conflict'].includes(st.mode))setSyncEditGate(true,st.mode==='conflict'?'记录存在冲突，请先处理后再编辑':st.mode==='offline'||st.mode==='error'?'同步未完成，已暂停编辑；恢复连接并核对成功后开放':'正在核对云端，确认后开放编辑');}
    var text = st.mode === 'idle' ? '未连接云端' : st.text;
    if(st.mode==='ok')text=st.checkedAt?'云端核对于 '+new Date(st.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'已连接云端，等待核对';

    var chip = $('#cloudChip');
    if (chip) {
      chip.className = 'chip ' + cls;
      chip.textContent = text;chip.title='云端版本：'+(st.cloudVersion==null?'未核对':st.cloudVersion)+'；最近核对：'+(st.checkedAt?new Date(st.checkedAt).toLocaleString():'尚未核对')+'；云端保存：'+(st.serverTime?new Date(st.serverTime).toLocaleString():'未知');
      if(st.mode==='conflict'){chip.textContent='同步冲突 · 点击处理';chip.title=text;chip.classList.add('conflict-action');if(!conflictNoticeShown){conflictNoticeShown=true;setTimeout(function(){if(!document.querySelector('dialog[open]')&&CLOUD.status().mode==='conflict')openDlg(conflictNotice);},0);}}else{chip.classList.remove('conflict-action');if(st.mode==='ok')conflictNoticeShown=false;}
      chip.hidden = false;
    }

    var row = $('.sync-row');
    if (row) {
      row.className = 'sync-row ' + cls;
      $('#syncText').textContent = text+(st.mode!=='ok'&&st.checkedAt?' · 上次核对 '+new Date(st.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'');
    }

    /* 进了应用但云端没连上：在页面顶部挂一条明确的提示，别让人以为已经在同步 */
    var warn = $('#localWarn');
    if (warn) {
      var bad = !!S && (!CLOUD_ON || /^(offline|error|conflict)$/.test(st.mode)) && st.mode !== 'connecting';
      warn.hidden = !bad;
      if (bad) {
        warn.innerHTML = (st.mode === 'conflict' ? '<b>同步冲突，本机记录已保留</b> —— 请先到华夏工具首页「全站备份」导出本机记录，再选择从云端覆盖本机或把本机覆盖云端。' :
          '<b>记录尚未同步</b> —— 这节课的改动保存在当前浏览器；请检查连接与账号状态。') +
          (offlineWhy ? '<span class="why">（' + esc(offlineWhy) + '）</span>' : '') +
          ' <button class="linkbtn" id="btnRetryCloud">重试连接</button>';
        var rb = $('#btnRetryCloud');
        if (rb) rb.addEventListener('click', function () { refreshCloud(); });
      }
    }
    tryAutoUpdateAppVersion(false);
  }

  /** 云端有更新就拉下来覆盖本机（只在本机没更新时） */
  function editingGrade(){var el=document.activeElement;return !!(el&&el.matches('input,textarea,select')&&!el.disabled&&!el.readOnly);}
  function applyCloudState(data){var keep=JSON.parse(JSON.stringify(S.ui||{}));S=migrate(JSON.parse(JSON.stringify(data)));S.ui=Object.assign({},S.ui||{},keep);writeLocal();fillClassSelects();switchView(view);renderUndoBtn();}
  function refreshCloud() {if(!CLOUD_ON||!CLOUD||!CLOUD.profile())return Promise.resolve(false);if(editingGrade())return Promise.resolve(false);return CLOUD.checkLatest(function(){return S;},function(rec){applyCloudState(rec.data);}).then(function(verified){if(verified)renderCloudStatus(CLOUD.status());return verified;});}
  function pauseForDeviceSwitch(){if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();setSyncEditGate(true,'切回页面后先核对云端，再开放编辑');}}
  window.addEventListener('blur',pauseForDeviceSwitch);window.addEventListener('focus',function(){if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();refreshCloud();}if(Date.now()-appVersionLastCheck>30000)checkAppVersion(false);tryAutoUpdateAppVersion(false);});document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')pauseForDeviceSwitch();else{if(S&&CLOUD_ON){if(editingGrade())document.activeElement.blur();refreshCloud();}if(Date.now()-appVersionLastCheck>30000)checkAppVersion(false);tryAutoUpdateAppVersion(false);}});document.addEventListener('focusout',function(){setTimeout(function(){tryAutoUpdateAppVersion(false);},0);});setInterval(function(){if(document.visibilityState!=='hidden'&&S&&CLOUD_ON)refreshCloud();},30000);setInterval(function(){if(document.visibilityState!=='hidden')checkAppVersion(false);},300000);setInterval(function(){if(appVersionUpdatePending)tryAutoUpdateAppVersion(false);},10000);
  var cloudUiBackup = null;

  function renderLocalBanner() {
    renderCloudStatus();
    var b = $('#poolBanner');
    if (!b) return;
    renderPoolBanner(curClass());
  }

  /* ---- 进应用 ---- */

  function startApp(profile, rec) {
    CLOUD_ON = !!(CLOUD && profile);
    cloudRec = rec || null;
    rememberAccount(profile);

    /* Keep the historical data key, but archive it by account before switching teachers. */
    if (profile && profile.uid) {
      try {
        var ownerKey = 'jfdt.owner.v1';
        var owner = localStorage.getItem(ownerKey);
        if (!owner && CLOUD && CLOUD.generation === 2 && localStorage.getItem(LS_KEY)) {
          localStorage.setItem('jfdt.legacy.' + Date.now(), localStorage.getItem(LS_KEY));
          localStorage.removeItem(LS_KEY);
        }
        if (owner && owner !== profile.uid) {
          var previous = localStorage.getItem(LS_KEY);
          if (previous) localStorage.setItem('jfdt.account.' + owner, previous);
          var ownState = localStorage.getItem('jfdt.account.' + profile.uid);
          if (ownState) localStorage.setItem(LS_KEY, ownState);
          else localStorage.removeItem(LS_KEY);
        }
        localStorage.setItem(ownerKey, profile.uid);
      } catch (e) {
        gateShow('login', '无法安全切换账号：浏览器存储不可用，请先到首页「全站备份」导出原账号记录。');
        return;
      }
    }

    var hadLocalState = false;
    try { hadLocalState = !!localStorage.getItem(LS_KEY); } catch (e) {}
    S = load();
    if (!S) {
      document.body.classList.remove('gated');
      $('#gate').hidden = true;
      $('#main').innerHTML = '<div class="card" style="margin:40px auto;max-width:520px">' +
        '<h2>缺少班级数据</h2><p class="note">没找到内置名单文件 data.js，也没找到本机存档。</p></div>';
      return;
    }

    var cloudData = rec && rec.data;
    var localAt = S.updatedAt ? Date.parse(S.updatedAt) : 0;
    var cloudAt = rec && rec.updated_at ? Date.parse(rec.updated_at) : 0;
    var syncConflict = !!(hadLocalState && CLOUD && CLOUD.hasConflict && CLOUD.hasConflict(rec, S));
    var mergedOnStart=false;if(syncConflict&&CLOUD.mergeRecord){var merged=CLOUD.mergeRecord(rec,S);if(merged&&!merged.conflicts.length){var keepUi=S.ui;S=migrate(merged.data);S.ui=keepUi;CLOUD.acceptRemote(rec);syncConflict=false;mergedOnStart=true;}}
    if(CLOUD&&CLOUD.bindState)CLOUD.bindState({get:function(){return S;},apply:applyCloudState,canApply:function(){return !editingGrade();}});

    if (!syncConflict && !mergedOnStart && cloudData && cloudData.classes && (!hadLocalState || cloudAt > localAt)) {
      S = migrate(JSON.parse(JSON.stringify(cloudData)));   // 云端更新 → 以云端为准
      if (CLOUD.acceptRemote) CLOUD.acceptRemote(rec);
      writeLocal();
    }

    if (!S.ui) S.ui = {};
    if (!S.undo) S.undo = [];
    if (!S.ui.classId && S.classes[0]) S.ui.classId = S.classes[0].id;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };
    writeLocal();

    initLayout();
    fillClassSelects();
    renderUndoBtn();
    renderUserBox(profile);

    /* 兼容缺少显示名的旧存档，首次进入时请老师补全姓名。
       只在本次启动提示一次，关掉了就不再烦人。 */
    if (profile && !profile.displayName && !meNudged) {
      meNudged = true;
      openMe();
    }
    gateHide();
    setSyncEditGate(true,'正在核对云端，确认后开放编辑');
    hxRoster = { classes: null, all: null, students: {}, loading: null, error: '', review: null }; hxShown = null;
    loadHxRoster();

    /* 本机比云端新（含"第一次登录，把本机旧记录搬上云"）→ 推上去 */
    if (!syncConflict && CLOUD_ON && (mergedOnStart || !cloudData || (hadLocalState && localAt > cloudAt))) {
      CLOUD.touch(function () { return S; });
    }
    renderCloudStatus();
    if (syncConflict) {
      var startupConflictDetails = CLOUD.getConflictDetails ? CLOUD.getConflictDetails(rec, S) : [];
      if (!Array.isArray(startupConflictDetails)) startupConflictDetails = [];
      if (!startupConflictDetails.length) {
        /* 只有时间/旧指纹不同，业务数据一致：自动收敛到云端版本，不再制造假冲突。 */
        if (cloudData && cloudData.classes) S = migrate(JSON.parse(JSON.stringify(cloudData)));
        if (CLOUD.acceptRemote) CLOUD.acceptRemote(rec);
        writeLocal();
        syncConflict = false;
      } else {
        CLOUD.reportConflict(startupConflictDetails);
      }
    }
    /* 2026-11-09：先把「换组后认不到人」的历史分接回本人，再画第一屏，
       否则老师一进来看到的还是「分全没了」。只搬不删、幂等，跑一百次结果一样。 */
    var repairedScores = repairOrphanScores(true);
    renderPoolBanner(curClass());
    switchView('score');
    if (repairedScores) flash('已把 ' + repairedScores + ' 条「换组后认不到人」的历史分接回本人');
    /* 2026-11-10 接线课堂任务 → 小组加分自动入账（实现见 wire-task-link.js 顶部说明） */
    if (window.JFDT_WIRE) {
      window.JFDT_WIRE.boot({
        getState: function () { return S; },
        save: function () { save(); },
        log: addOperationLog,
        flash: flash,
        rerender: function () { renderScore(); },
        curClass: curClass,
        rpc: function (name, args) { return CLOUD.rpc(name, args); },
        hasRpc: function () { return !!(CLOUD_ON && CLOUD && typeof CLOUD.rpc === 'function' && CLOUD.profile && CLOUD.profile()); }
      });
      window.JFDT_WIRE.syncAll();
      /* 2026-11-09：接线任务结束以后，成绩要自己走进「上课记分」总表的「课堂任务」列。
         这里一个 10 秒心跳，做两件事：
           ① maybeSync() 拉一次只读 RPC，把**已结束**的任务入账；
           ② 当前班当前课开着「组长打分」时，拉一次互评看板 —— 学生提交互评后，
              分要自己走进「上课记分」首页和「个人项目分」，不用老师手动切到评分页才刷新。
              （2026-11-10 用户报「互评完首页分数没实时更新 / 八班孩子个人项目分没分」，
                根因就是心跳只入账接线任务、没拉互评看板，学生提交的分一直躺在云端没下来。）
         刹车：① 页面在后台不拉；② wire-task-link.js 内部 LIVE_THROTTLE=10s 节流；
               ③ 互评看板只在开着 gate 的当前课拉，每课一个 in-flight，不重复拉。 */
      var peerPollInflight = false;
      setInterval(function () {
        try {
          if (document.hidden) return;
          if (!S) return;
          if (window.JFDT_WIRE) window.JFDT_WIRE.maybeSync(curClass());
          /* 互评看板：只拉「当前在看的班 + 当前课 + 开着组长打分」这一份 */
          var cls = curClass();
          var lesson = cls ? curLesson(cls) : null;
          if (!cls || !lesson || !lesson.peerGate || !peerReady(cls) || peerPollInflight) return;
          peerPollInflight = true;
          peerFetchBoard(cls, lesson).then(function () {
            peerPollInflight = false;
            /* 拉回来的新提交已经 peerApplyBoard 计分进 leaderScores 并 save 了；
               这里补一次重画，让首页「个人项目分 / 本节完成率」和评分页立刻跟上。 */
            try {
              if (view === 'score') renderScore();
              else if (view === 'leader') renderLeader();
            } catch (e) { /* 重画失败绝不影响记分 */ }
          }, function () { peerPollInflight = false; });
        } catch (e) { /* 心跳失败绝不影响记分 */ }
      }, 10000);
    }
    if(CLOUD_ON)setTimeout(function(){refreshCloud();},0);
  }

  /* ================= 启动 ================= */

  /* 云端状态 → 顶栏小圆点 + 数据页同步条 */
  if (CLOUD) CLOUD.onStatus(renderCloudStatus);
  if ($('#btnCheckAppVersion')) $('#btnCheckAppVersion').addEventListener('click',function(){checkAppVersion(true);});
  checkAppVersion(false);
  /* 2026-11-12 删「数据与同步」页：同步条上的两个按钮（核对云端/修复历史分）挂载点已删。
     逻辑保留（refreshCloud / repairOrphanScores 仍在），等有新的挂载点再放回来。 */
  if ($('#btnSyncNow')) {
    var checkCloudButton=document.createElement('button');checkCloudButton.id='btnCheckCloudLatest';checkCloudButton.className='btn';checkCloudButton.textContent='核对云端最新版';checkCloudButton.onclick=function(){checkCloudButton.disabled=true;checkCloudButton.setAttribute('aria-busy','true');refreshCloud().then(function(ok){flash(ok?'核对完成：本机已是云端最新版':'核对未完成：请查看同步冲突详情');}).finally(function(){checkCloudButton.disabled=false;checkCloudButton.removeAttribute('aria-busy');});};$('#btnSyncNow').parentElement.appendChild(checkCloudButton);
  }
  if ($('#btnSyncNow')) {
    var repairScoresButton=document.createElement('button');repairScoresButton.id='btnRepairScores';repairScoresButton.className='btn';repairScoresButton.textContent='修复认不到人的历史分';repairScoresButton.onclick=async function(){var R=window.JFDT_SCORE_REPAIR;if(!R){flash('修复模块没加载，请刷新页面');return;}var n=0;visibleClasses().forEach(function(c){n+=R.countOrphans(S,c);});if(!n){flash('没有认不到人的历史分，不用修');return;}var ok=await askConfirm({title:'接回 '+n+' 条历史分？',body:'检测到 '+n+' 条分数「换组后认不到人」：分还在库里，只是显示不出来。',note:'只搬不删，认不出人的原样保留。',ok:'接回'});if(!ok)return;var fixed=repairOrphanScores(false);flash(fixed?'已接回 '+fixed+' 条历史分':'没有可接回的分数');};$('#btnSyncNow').parentElement.appendChild(repairScoresButton);
  }

  /* 闸门上的按钮 */
  $('#btnAccountLogin').addEventListener('click', doLogin);
  ['#loginEmail', '#loginPassword'].forEach(function (sel) {
    $(sel).addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  });
  $('#btnShowRegister').addEventListener('click', function () {
    $('#regEmail').value = $('#loginEmail').value.trim();
    gateShow('register');
  });
  $('#btnShowLogin').addEventListener('click', function () { gateShow('login'); });
  $('#btnBackToLogin') && $('#btnBackToLogin').addEventListener('click', function () { gateShow('login'); });
  $('#btnForgotPassword').addEventListener('click', function () {
    $('#resetEmail').value = $('#loginEmail').value.trim();
    gateShow('reset');
  });
  $('#btnResetBack').addEventListener('click', function () { gateShow('login'); });
  $('#btnSendReset').addEventListener('click', doSendReset);
  $('#resetEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSendReset(); });
  $('#btnRegisterNow').addEventListener('click', doRegister);
  ['#regEmail', '#regName', '#regPassword', '#regConfirm'].forEach(function (sel) {
    $(sel).addEventListener('keydown', function (e) { if (e.key === 'Enter') doRegister(); });
  });
  $('#btnSaveRecovered').addEventListener('click', doSaveRecovered);
  ['#recoverPassword', '#recoverConfirm'].forEach(function (sel) {
    $(sel).addEventListener('keydown', function (e) { if (e.key === 'Enter') doSaveRecovered(); });
  });
  $('#btnOAuthGithub').addEventListener('click', function () { doLoginWithProvider('github'); });
  $('#btnOAuthGoogle').addEventListener('click', function () { doLoginWithProvider('google'); });
  $('#btnGuest').addEventListener('click', doGuestLogin);
  $('#btnLocalOnly').addEventListener('click', function () {
    gateShow('login','请连接云端并核对成功后记分。',true);
  });
  loadAuthOptions();
  showInviteField();

  /* 数据页的同步按钮（2026-11-12 删「数据与同步」页：这些按钮 DOM 已删，逻辑保留作死代码。
     用 if 保护，避免 null.addEventListener 报错；手动同步/覆盖/退出仍由自动同步和 openMe 覆盖。 */
  if ($('#btnSyncNow')) $('#btnSyncNow').addEventListener('click', function () {
    if (!CLOUD || !CLOUD.available()) { alert('云端组件没加载出来，请检查网络后刷新页面。'); return; }
    refreshCloud().then(function (verified) { if(verified)return CLOUD.flush(); }).catch(function (e) {
      alert('同步失败：' + (e && e.message ? e.message : e));
    });
  });
  if ($('#btnPullCloud')) $('#btnPullCloud').addEventListener('click', async function () {
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再拉取。'); return; }
    var cover = await askConfirm({
      title: '用云端记录覆盖这台设备？',
      body: '本机现在的分数会被替换掉（云端记录是同一账号在别的设备上存的那份）。',
      note: '要留退路请先到华夏工具首页「全站备份」导出一份。',
      ok: '用云端覆盖',
      danger: true
    });
    if (!cover) return;
    if (CLOUD.cancelPending && !CLOUD.cancelPending()) {
      alert('正在上传记录，请等待同步结束后再拉取。'); return;
    }
    var pullStartedAt = S.updatedAt;
    cloudUiBackup = { classId: S.ui.classId, lessonId: S.ui.lessonId, scoreLayout: S.ui.scoreLayout };
    CLOUD.pull().then(function (rec) {
      if (S.updatedAt !== pullStartedAt) { alert('拉取期间记录已改变，本次未覆盖，请重试。'); return; }
      if (!rec || !rec.data || !rec.data.classes) { alert('云端还没有这个账号的记录。'); return; }
      S = migrate(JSON.parse(JSON.stringify(rec.data)));
      if (CLOUD.acceptRemote) CLOUD.acceptRemote(rec);
      if (!S.ui) S.ui = {};
      if (cloudUiBackup) { S.ui.classId = cloudUiBackup.classId; S.ui.lessonId = cloudUiBackup.lessonId; S.ui.scoreLayout = cloudUiBackup.scoreLayout; }
      if (!S.ui.classId && S.classes[0]) S.ui.classId = S.classes[0].id;
      S.updatedAt = new Date().toISOString();
      writeLocal();
      initLayout();
      fillClassSelects();
      renderUndoBtn();
      flash('已用云端记录覆盖本机');
    }).catch(function (e) {
      alert('拉取失败：' + (e && e.message ? e.message : e));
    });
  });
  if ($('#btnPushCloud')) $('#btnPushCloud').addEventListener('click', async function () {
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再上传。'); return; }
    var push = await askConfirm({
      title: '把这台设备的记录传到云端？',
      body: '会覆盖云端那一份记录（同一账号在别的设备上看到的就是这一份）。',
      ok: '上传覆盖',
      danger: true
    });
    if (!push) return;
    var upload = CLOUD.forcePush ? CLOUD.forcePush(function () { return S; }) : (CLOUD.touch(function () { return S; }), CLOUD.flush());
    upload.then(function () { alert('已经上传到云端。'); }).catch(function (e) {
      alert('上传失败，记录仍保存在当前设备：' + (e && e.message ? e.message : e));
    });
  });
  if ($('#btnSignOut')) $('#btnSignOut').addEventListener('click', async function () {
    var out = await askConfirm({
      title: '退出登录？',
      body: '未同步的记录仅保存在当前浏览器，下次用同一教师账号登录可以继续。',
      note: '建议先确认同步成功，或在华夏工具首页「全站备份」导出一份。',
      ok: '退出',
      danger: true
    });
    if (!out) return;
    CLOUD.signOut();
  });
  $('#btnMe').addEventListener('click', openMe);
  /* 2026-11-12 删「数据与同步」页：⚙ 不再跳那个页，直接开账号弹窗（openMe 里已有退出登录） */
  $('#btnUserMenu').addEventListener('click', openMe);

  /* 随机抽人（draw-person.js）：本文件闭包里的 S / rosterOf / curClass 拿不出去，
     所以只在这里交一个「读取器」出去，抽人模块每次要数据时现读，不缓存，
     这样切班、导入名单、删人之后打开抽人都拿到最新的名单。 */
  window.JFDT_DRAW_SRC = {
    classes: function () { return visibleClasses(); },
    rosterOf: rosterOf,
    curClass: curClass,
    toast: flash
  };

  /* 自检入口：askConfirm 在闭包里，无头浏览器从外面够不到，交一个只读引用出去，
     供 tools/_check-ask-confirm.mjs 验证「取消 → false / 确定 → true / Esc 也能结掉 Promise」。
     不参与任何业务逻辑。 */
  window.JFDT_ASK_CONFIRM = askConfirm;

  /* 进入应用：有云端就走云端，没有就降级成本机模式（页面顶部会写明） */
  function bootCloud() {
    if (!CLOUD) { gateShow('login','云端组件未加载，暂停编辑，请刷新重试。',true); return; }
    gateShow('wait', '正在载入…', true);
    $('#btnPortalLogin').onclick = function () { if (window.HXTheme) HXTheme.login(); else location.href = '../#jiafen'; };
    CLOUD.boot({
      onReady: function (profile, rec) { renderUserBox(profile); startApp(profile, rec); },
      onNeedLogin: function (msg) {
        document.body.classList.add('gated');
        renderUserBox(null);
        gateShow('home', msg ? ('登录没能完成：' + msg) : '用教师账号登录后使用', !msg);
      },
      /* 从「重置密码」邮件回到站点：先设新密码，再进应用 */
      onRecover: function (profile) {
        document.body.classList.add('gated');
        renderUserBox(null);
        gateShow('home', '请在华夏工具首页修改密码', true);
      },
      onOffline: function (why) {offlineWhy=why;document.body.classList.add('gated');renderUserBox(null);$('#btnLocalOnly').hidden=true;gateShow('home','无法核对云端，暂停编辑。请恢复连接后刷新重试。本机未上传改动仍保留。',true);}

    });
  }
  bootCloud();
})();
