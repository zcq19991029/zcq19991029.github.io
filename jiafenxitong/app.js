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

  /* ================= 完成率百分比显示（2026-11-09 显示层改革） =================
     硬约束：内部存储与计算公式一个字都不动——scores 的 group/phone/personal 仍是 5 分制、
     leaderScores 项目分仍是 1–5、考勤仍是 9 分制。下面这组工具只负责「显示的时候」换算：
       · 5 分制单位 → 百分比：值 ÷ 5 × 100（项目分 1–5 → 20%~100%；干净又卫生送分 5→0 → 100%~0%）
       · 每课总完成率 = (remaining + Σ个人项目分) ÷ (5 + 5×已命名项目数)，可达 100%
       · 考勤 → (9 − 累计扣分)/9 百分比，保留 1 位小数（照 performanceRate 的 round(x×1000)/10 口径）
     数值口径保持不变的位置（用户明确只要这些保持数值）：平时分三列、实际期末/综合、考试分数输入框。 */
  function pctNum(v) {           // 入参已经是百分数（80 表示 80%），保留 1 位小数
    return Math.round((Number(v) + Number.EPSILON) * 10) / 10;
  }
  function pctText(v) {          // '80%' / '88.9%'：整数不带小数点
    var n = pctNum(v);
    return (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1)) + '%';
  }
  /** 5 分制单位 → 百分比文本（干净又卫生送分、个人项目分共用） */
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
  /** 每课完成率分母 = 5（干净又卫生送分）+ 5 × 已命名项目数 */
  function lessonMaxOf(lesson) {
    return 5 + 5 * namedProjectCount(lesson);
  }
  /** 某成员某课的总完成率文本：(remaining + Σ个人项目分) ÷ (5 + 5×已命名项目数) */
  function memberLessonRateText(lesson, gno, member, i) {
    var val = remaining(lesson, gno, i) + projectScore(lesson, gno, member);
    return pctText(Math.max(0, val) / lessonMaxOf(lesson) * 100);
  }
  /** 学期层面的完成率分母（与 assessment.js taskEvidence 的 maximum 同口径）：
      每课 5 + 5×该课已命名项目数，逐课累加；再算上考勤 9 分由调用方自行决定加不加。 */
  function semesterProjectMax(lessons) {
    return (lessons || []).reduce(function (a, l) { return a + lessonMaxOf(l); }, 0);
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

  /* ================= 侧栏抽屉（窄屏 <1100px） =================
     纯 UI：☰ 打开、点遮罩或选中任一菜单收起；宽屏侧栏常驻时这条逻辑不生效。 */
  (function () {
    var body = document.body;
    var toggle = document.getElementById('navToggle');
    var scrim = document.getElementById('navScrim');
    function setNav(open) {
      body.classList.toggle('nav-open', open);
      if (scrim) scrim.hidden = !open;
      if (toggle) toggle.setAttribute('aria-expanded', String(open));
    }
    if (toggle) toggle.addEventListener('click', function () { setNav(!body.classList.contains('nav-open')); });
    if (scrim) scrim.addEventListener('click', function () { setNav(false); });
    var tabs = document.getElementById('tabs');
    if (tabs) tabs.addEventListener('click', function (e) { if (e.target.closest('button[data-view]')) setNav(false); });
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
     新制：值日改扣分——不值日少一人，教师点一下「值日缺勤」，全组每人本节参与分 −1；
           特殊表现功能整体删除。旧分值一律作废，所有人重新规划。
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

/** 某个组实际适用的上限 = 班级上限 与本组特许（g.cap）取大。
    老版本把 memberCount(g) 也塞进 max() 里，于是 7 人组的上限永远显示 7、永远看不出超员，
    正是用户说的「老师完全无法恢复正确」。现在人数只用来判断超没超，不参与算上限。 */
function groupTargetCap(cls, g) {
  var limit = classGroupLimit(cls), own = Number(g && g.cap) || 0;
  /* 老师还没在向导里定过人数：完全沿用旧行为（上限 = max(7, 本组特许, 现有人数)），
     老班级里那些 8 人组不会被升级后突然标红。一旦定过，就按定的数严格算。 */
  if (!limit) return Math.max(GROUP_CAP, own, memberCount(g));
  return Math.max(limit, own);
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

  /** 单个小组某节课的「本节合计」：首个正确 + 小组分 − 手机未入袋人数
      （个人扣分不计入小组，单独记在个人头上；值日缺勤的扣分也落在个人参与分里） */
  function dutyGroups(lesson){return Array.isArray(lesson.dutyGroups)?lesson.dutyGroups:(lesson.dutyGroup?[Number(lesson.dutyGroup)]:[]);}
  function groupTotal(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return 0;
    return Math.round(window.JFDT_ASSESSMENT.groupNet(lesson,gno,lessonsOf(lesson.classId))*100)/100;
  }

  /** 小组累计（该班全部课次） */
  function groupCum(cls, gno) {
    return Math.round(lessonsOf(cls.id).reduce(function (a, l) { return a + groupTotal(l, gno); }, 0)*100)/100;
  }

  function groupCumThrough(cls,gno,lesson) { return Math.round(lessonsOf(cls.id).filter(function(l){return Number(l.seq)<=Number(lesson.seq);}).reduce(function(total,l){return total+groupTotal(l,gno);},0)*100)/100; }

  /** 某节课是否给该组记过任何东西 */
  function touched(lesson, gno) {
    var s = lesson.scores[String(gno)];
    if (!s) return false;
    if (s.first || s.group || s.phone) return true;
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

  /* 本节「课堂任务」分：只数「接线2.x」这类列（接线课堂任务自动入账的列），
     手工项目列（协作 / 安全 / 5S…）不算在内。
     2026-11-09 用户要求「课堂任务积分直接丢进上课计分首页总表内」——
     以前这部分只在侧栏「组内个人评分」里看得到，总表只体现成一个变大的「本节合计」，
     老师上课时看不出这分是哪来的。null = 本节这个人没有课堂任务分。 */
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
      if (!/^接线/.test(String(n == null ? '' : n).trim())) return;
      var v = values[i];
      if (v == null || v === '') return;
      hit++; sum += Number(v) || 0;
    });
    return hit ? Math.round(sum * 100) / 100 : null;
  }

  function memberTotals(cls) {
    var ls = lessonsOf(cls.id);
    var out = [];
    cls.groups.forEach(function (g) {
      var gs = groupCum(cls,g.no);
      g.members.forEach(function (m, idx) {
        if (!m.name) return;
        var p = ls.reduce(function (a, l) {
          var s = l.scores[String(g.no)];
          return a + (s ? Math.min(Math.max(0,Math.min(5,(+s.group||0)+(s.first?1:0))-(+s.phone||0)),+(s.personal||{})[String(idx)]||0) : 0);
        }, 0);
        out.push({
          name: m.name, sid: m.sid, no: m.no, gno: g.no,
          groupScore: gs, project: ls.reduce(function(a,l){return a+projectScore(l,g.no,m);},0), personal: p, total: Math.round((gs + ls.reduce(function(a,l){return a+projectScore(l,g.no,m);},0) - p)*100)/100
        });
      });
    });
    out.sort(function (a, b) { return b.total - a.total || a.gno - b.gno; });
    return out;
  }

  /* ================= 撤销 ================= */

  var UNDO_MAX = 60;
  /* 显示口径 2026-11-09：group 那格是「干净又卫生」送分；文案改口径，字段名/存储不动 */
  var FIELD_NAME = { first: '首个正确', group: '干净又卫生送分', phone: '全组扣分' };

  /** 记一笔可撤销的改动。只存"反做"需要的信息，很轻。
      op 三种形态：
        {lessonId, gno, f, old, neu}          标量（first / group / phone）
        {lessonId, gno, i, old, neu, name}    个人扣分（第 i 个成员）
        {lessonId, gno, reset:true, old}      整组清零（old 是该组原 scores 的副本） */
  function operationEffect(op){if(op.effect)return op.effect;var l=getLesson(op.lessonId),cls=l&&getClass(l.classId),g=cls&&groupOf(cls,op.gno),now=l&&l.scores[String(op.gno)];if(op.reset&&op.old&&now&&g){function points(sc,i){return Math.max(0,Math.min(5,(+sc.group||0)+(sc.first?1:0))-(+sc.phone||0)-(+((sc.personal||{})[String(i)])||0));}var patch=g.members.map(function(m,i){return {path:'point:'+i,delta:points(now,i)-points(op.old,i)};}).filter(function(x){return x.delta;});return patch;}return [{path:op.i!=null?'point:'+op.i:op.f,delta:op.i!=null?(+op.old||0)-(+op.neu||0):(+op.neu||0)-(+op.old||0)}].filter(function(x){return x.delta;});}
  function inverseEffects(a,b){return a.length===b.length&&a.every(function(x){return b.some(function(y){return x.path===y.path&&Math.abs(x.delta+y.delta)<1e-8;});});}
  function applyEffect(op,effect,direction){var l=getLesson(op.lessonId),cls=getClass(l.classId),g=groupOf(cls,op.gno),scored=sc(l,op.gno),actual=[];effect.forEach(function(e){var old,next;if(e.path.startsWith('leader:')){var token=e.path.slice(7),cut=token.lastIndexOf('|'),mk=token.slice(0,cut),col=+token.slice(cut+1),r=l.leaderScores&&l.leaderScores[String(op.gno)];if(!r)return;var values=r.members[mk]||(r.members[mk]=[]);old=Number(values[col])||0;next=Math.max(0,Math.min(5,old+direction*e.delta));values[col]=next===0&&direction<0&&e.wasBlank?null:next;}else if(e.path.startsWith('point:')){var i=e.path.slice(6),values=g.members.map(function(_,j){return remaining(l,g.no,j);});var base=Math.min(5,(+scored.group||0)+(scored.first?1:0));old=values[+i];next=Math.max(0,Math.min(base,old+direction*e.delta));scored.phone=0;scored.group=base;scored.first=0;g.members.forEach(function(_,j){scored.personal[String(j)]=base-(String(j)===i?next:values[j]);});}else if(e.path.startsWith('personal:')){var i=e.path.slice(9);old=+scored.personal[i]||0;next=Math.max(0,Math.min(5,old+direction*e.delta));scored.personal[i]=next;}else{old=+scored[e.path]||0;next=Math.max(0,Math.min(e.path==='phone'?1000000:5,old+direction*e.delta));scored[e.path]=next;}if(next!==old)actual.push({path:e.path,delta:next-old,wasBlank:e.wasBlank});});return actual;}
  function pushUndo(op) {
    if (!S.undo) S.undo = [];
    op.id=op.id||uid('op');
    op.effect=operationEffect(op);
    var auditLesson=getLesson(op.lessonId),auditClass=auditLesson&&getClass(auditLesson.classId),auditGroup=auditClass&&groupOf(auditClass,op.gno);
    if(auditGroup&&!op.audit){var totals=memberTotals(auditClass),effects=op.effect,points=effects.filter(function(e){return /^(point:|personal:)/.test(e.path);}),targets=(points.length?points.map(function(e){return +e.path.split(':')[1];}):auditGroup.members.map(function(_,i){return i;})).filter(function(i,p,a){return a.indexOf(i)===p&&auditGroup.members[i]&&auditGroup.members[i].name;});var deltas=targets.map(function(i){return effects.reduce(function(sum,e){return sum+(e.path==='point:'+i?e.delta:e.path==='personal:'+i?-e.delta:['group','first'].includes(e.path)?e.delta:e.path==='phone'?-e.delta:0);},0);});op.audit={source:(op.label&&String(op.label).indexOf('值日缺勤')===0)?'值日缺勤':'上课记分',lesson:auditClass.name+' · 第'+auditLesson.seq+'次课 · '+auditLesson.date+' · '+(auditLesson.topic||''),student:targets.length===1?auditGroup.members[targets[0]].name:'第'+op.gno+'组 · '+targets.map(function(i){return auditGroup.members[i].name;}).join('、'),sid:targets.length===1?auditGroup.members[targets[0]].sid||'':'全组操作',delta:deltas.length&&deltas.every(function(d){return d===deltas[0];})?(deltas[0]>0?'+':'')+deltas[0]+(targets.length>1?'/人':''):'—',after:targets.map(function(i){var m=auditGroup.members[i],row=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===op.gno&&t.name===m.name;});return row?row.total:'—';}).join(' / '),afterPct:targets.map(function(i){var m=auditGroup.members[i],row=totals.find(function(t){return m.sid?t.sid===m.sid:t.gno===op.gno&&t.name===m.name;});if(!row)return '—';var semesterMax=semesterProjectMax(lessonsOf(auditClass.id));if(!semesterMax)return '0%';return pctText(Math.max(0,row.total)/semesterMax*100);}).join(' / ')};}

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
      return g + ' ' + (op.name || '成员') + ' 干净又卫生扣分 ' + scorePctText(op.neu) + ' → ' + scorePctText(op.old);
    }
    return g + ' ' + (FIELD_NAME[op.f] || op.f) + ' ' + showVal(op.f, op.neu) +
      ' → ' + showVal(op.f, op.old);
  }

  function reverseOp(op){return Object.assign({},op,{old:op.neu,neu:op.old});}

  function showVal(f, v) {
    if (f === 'first') return v ? '已加' : '未加';
    /* 干净又卫生送分按百分比显示；全组扣分存的是「次数」，保持计数 */
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
    var b = $('#btnUndo');
    if (!b) return;
    var n = (S.undo || []).length;
    b.disabled = !n;
    b.textContent = n ? '↶ 撤销' + (n > 1 ? '（' + n + '）' : '') : '↶ 撤销';
    var lastLesson = n && getLesson(S.undo[n - 1].lessonId);
    var lastClass = lastLesson && getClass(lastLesson.classId);
    if (lastClass && lastClass.id !== S.ui.classId) b.textContent = '↶ 撤销其他班操作';
    var detail = $('#undoDetail');
    if (detail) detail.textContent = n ? '下一步撤销：' + undoLabel(S.undo[n-1]) : '暂无可撤销操作';
    var rb = $('#btnRedo'); if(rb) rb.disabled = !(S.redo || []).length;
    renderOperationLog();
    b.title = n
      ? '撤销：' + undoLabel(S.undo[n - 1]) + '　（快捷键 Ctrl+Z）'
      : '还没有可撤销的改动';
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
        el.textContent = '已自动保存到本机 ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
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
    if (v === 'admin' && !(CLOUD && CLOUD.profile() && CLOUD.profile().isAdmin)) v = 'score';
    view = v;
    ['score', 'leader', 'rank', 'gradebook', 'attendance', 'pool', 'data', 'admin'].forEach(function (k) {
      var el = $('#view-' + k);
      if (el) el.hidden = (k !== v);
    });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
    if (UI) UI.setView(v);
    if (v === 'rank') renderRank();
    if (v === 'gradebook') renderGradebook();
    if (v === 'pool') { renderPool(); renderTeamCard(); } else { tmStop(); }
    if (v === 'data') renderData();
    if (v === 'admin') renderAdmin();
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

  /** 本节课要发布的项目列（只发有名字的列，col 保持与 leaderScores 下标一致） */
  function peerProjectList(lesson) {
    var names = (window.JFDT_ASSESSMENT && window.JFDT_ASSESSMENT.projectNames(lesson)) || [];
    var out = [];
    names.forEach(function (n, i) {
      var name = String(n == null ? '' : n).trim();
      if (name) out.push({ name: name, col: i });
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
      fullMarks:function(lesson,groups,columns,names){var cls=getClass(lesson.classId),changed=0;if(!lesson.leaderScores)lesson.leaderScores={};groups.forEach(function(g){var r=lesson.leaderScores[String(g.no)]||(lesson.leaderScores[String(g.no)]={projects:names.slice(),members:{},signedBy:'',note:''}),effect=[];g.members.filter(function(m){return m.name;}).forEach(function(m){var key=m.sid?'sid:'+m.sid:'id:'+m.id,values=r.members[key]||(r.members[key]=[]);columns.forEach(function(i){var old=values[i];if(old===5)return;effect.push({path:'leader:'+key+'|'+i,delta:5-(Number(old)||0),wasBlank:old==null});values[i]=5;changed++;});});
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
    $('#scoreHint').hidden = !lesson;
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
    var dutyOpts = '<option value="">无</option>' + visibleGroups(cls).map(function (g) {
      return '<option value="' + g.no + '"' + (+lesson.dutyGroup === g.no ? ' selected' : '') +
        '>第 ' + g.no + ' 组</option>';
    }).join('');
    $('#lessonMeta').innerHTML='<div class="lesson-topic-summary" title="'+esc(lesson.topic||'未填写任务')+'">'+esc(lesson.topic||'未填写任务')+'</div>'+(dutyGroups(lesson).length?'<small class="lesson-duty-summary">值日：'+dutyGroups(lesson).map(function(n){return '第'+n+'组';}).join('、')+'</small>':'')+'<div class="btnrow"><button class="btn" id="btnEditLesson">课次设置</button><button class="btn" id="btnPrintLesson">打印本课</button></div>';
    $('#btnEditLesson').addEventListener('click',function(){openLessonEditor(cls,lesson);});
    $('#btnPrintLesson').addEventListener('click', function () { openLessonPrint(cls, lesson); });
    var excelButton=document.createElement('button');excelButton.className='btn';excelButton.textContent='下载本课Excel';excelButton.onclick=function(){downloadLessonExcel(cls,lesson);};$('#lessonMeta .btnrow').appendChild(excelButton);
    var pdfButton=document.createElement('button');pdfButton.className='btn';pdfButton.textContent='下载打印版PDF';pdfButton.onclick=function(){openLessonPrint(cls,lesson,true);};$('#lessonMeta .btnrow').prepend(pdfButton);
  }

  var lessonEditor=document.createElement('dialog');lessonEditor.id='dlgEditLesson';lessonEditor.setAttribute('aria-labelledby','editLessonTitle');
  lessonEditor.innerHTML='<form id="editLessonForm"><h2 id="editLessonTitle">修改课次</h2><p class="note">更正课次资料，保留本课分数、项目评价和考勤。日期不参与计分。</p><label class="field col">课次序号<input id="editLessonSeq" type="number" min="1" step="1" required></label><label class="field col">上课日期<input id="editLessonDate" type="date" required></label><label class="field col">本节任务<input id="editLessonTopic" maxlength="300"></label><label class="field col">值日组<select id="editLessonDuty" multiple size="4"></select></label><p id="editLessonError" role="alert" class="note"></p><div class="btnrow"><button type="button" class="btn" id="cancelEditLesson">取消</button><button type="submit" class="btn primary">保存修改</button></div></form>';
  document.body.appendChild(lessonEditor);wireDialog(lessonEditor);var editingLessonId=null;
  function openLessonEditor(cls,lesson){editingLessonId=lesson.id;$('#editLessonTitle').textContent=cls.name+' · 修改课次';$('#editLessonSeq').value=lesson.seq;$('#editLessonDate').value=lesson.date||'';$('#editLessonTopic').value=lesson.topic||'';$('#editLessonDuty').innerHTML='<option value="">无</option>'+visibleGroups(cls).map(function(g){return '<option value="'+g.no+'"'+(dutyGroups(lesson).includes(g.no)?' selected':'')+'>第'+g.no+'组</option>';}).join('');$('#editLessonError').textContent='';openDlg(lessonEditor);}
  $('#cancelEditLesson').addEventListener('click',function(){lessonEditor.close();});
  $('#editLessonForm').addEventListener('submit',function(e){e.preventDefault();var lesson=getLesson(editingLessonId);if(!lesson)return;var seq=Number($('#editLessonSeq').value),date=$('#editLessonDate').value,topic=$('#editLessonTopic').value.trim(),duties=Array.from($('#editLessonDuty').selectedOptions).map(function(o){return Number(o.value);}).filter(Boolean),duty=duties[0]||null;if(!Number.isInteger(seq)||seq<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)){$('#editLessonError').textContent='请填写有效的课次序号和日期。';return;}if(S.lessons.some(function(l){return l.classId===lesson.classId&&l.id!==lesson.id&&l.seq===seq;})){$('#editLessonError').textContent='本班已有第 '+seq+' 次课，请使用其他序号。';return;}var before='第'+lesson.seq+'次 · '+lesson.date+' · '+(lesson.topic||'未填任务');if(lesson.seq===seq&&lesson.date===date&&(lesson.topic||'')===topic&&JSON.stringify(dutyGroups(lesson))===JSON.stringify(duties)){lessonEditor.close();return;}lesson.seq=seq;lesson.date=date;lesson.topic=topic;lesson.dutyGroup=duty;lesson.dutyGroups=duties;var cls=S.classes.find(function(c){return c.id===lesson.classId;});addOperationLog('修改课次',cls.name+' · '+before+' → 第'+seq+'次 · '+date+' · '+(topic||'未填任务'));save();lessonEditor.close();renderScore();flash('课次资料已修改，分数和考勤已保留');});

  /* ---- 记分控件（卡片视图与表格视图共用，保证两边的操作完全一致） ---- */

  /** 某个计分项在本组的上限 */
  function maxOf(f, maxPhone) {
    return f === 'group' ? 5 : f === 'phone' ? maxPhone : 99;
  }

  function ctlFirst(gno, s) {
    return '<button class="toggle' + (s.first ? ' on' : '') + '" data-g="' + gno + '" data-act="first" aria-label="第'+gno+'组首个正确，干净又卫生送分 +20%" aria-pressed="'+!!s.first+'">' +
      '✓</button>';
  }

  /** ± 步进 + 可直接输入的数字框 */
  function ctlStep(gno, f, s, max, hint) {
    var v = +s[f] || 0;
    var neg = (f === 'phone' || f === 'personal') && v > 0;
    return '<div class="step">' +
      '<button data-g="' + gno + '" data-act="d" data-f="' + f + '" data-max="' + max + '" title="' + (f === 'phone' ? '减少扣分次数，返还 20%' : '减 1') + '">−</button>' +
      '<input class="num' + (neg ? ' neg' : '') + '" data-g="' + gno + '" data-f="' + f + '" data-max="' + max +
        '" size="1" inputmode="numeric" value="' + v + '" title="' + hint + '：可以直接点进来输数字（0-' + max + '）">' +
      '<button data-g="' + gno + '" data-act="i" data-f="' + f + '" data-max="' + max + '" title="' + (f === 'phone' ? '增加扣分次数，扣 20%' : '加 1') + '">+</button>' +
    '</div>';
  }

  /** 值日缺勤（2026-11-09 改制）：值日组这一格放一个按钮，点一下 = 全组每人本节参与分 −1
      （走 changeMemberPoints，自带撤销/审计/封顶/反馈）。非值日组显示 '—'。
      2026-11-09 显示层改革：文案改成完成率口径（−1 分 = −20%），内部仍扣 1 分。 */
  function ctlDuty(gno, isDuty) {
    if (!isDuty) return '<span class="note" title="本组本节不值日">—</span>';
    return '<button type="button" class="duty-score" data-duty-deduct="'+gno+'" '+
      'title="不值日少一人点一下：全组每人干净又卫生送分 −20%；来了就不点。误点多了用「撤销」退回" '+
      'aria-label="第'+gno+'组值日缺勤：每点一次全组每人干净又卫生送分减20%">每人 −20%</button>';
  }

  function semesterBadge(cls,gno,index) {
    return '';
  }

  /* 本节合计（2026-11-09 显示层改革）：改按完成率百分比显示 = (remaining + Σ个人项目分) ÷ (5 + 5×已命名项目数)；
     存储与计算仍走原来的 remaining/projectScore，一格不动 */
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

  /** 个人扣分格（2026-11-09 显示层改革）：芯片显示 remaining 的百分比（100%、80%…0%），
      点击仍扣 1 分（= 20%）；hit 判定、存储逻辑不动 */
  function remaining(lesson,gno,i){var s=sc(lesson,gno);return Math.max(0,Math.min(5,(+s.group||0)+(s.first?1:0))-(+s.phone||0)-(+s.personal[String(i)]||0));}
  function ctlBatch(gno){return '<button class="btn" data-g="'+gno+'" data-act="batch-deduct">全组 −20%</button>';}
  function ctlPersonal(gno, m, i, n, fullName) {
    n=remaining(curLesson(curClass()),gno,i);
    var attrs = ' data-g="' + gno + '" data-i="' + i + '"';
    return '<span class="personal-control"><button class="pchip' + (n<5 ? ' hit' : '') + '"' + attrs + ' data-act="p" title="' + esc(m.name) + '：点击扣 20%">' +
      (fullName ? '<span class="pname">' + esc(m.name) + '</span>' : '') + '<span class="n">' + scorePctText(n) + '</span><span class="deduct-action" aria-hidden="true">−</span></button>' +
      '<button class="personal-refund"' + attrs + ' data-act="pr" title="' + esc(m.name) + '：返还 20%">' +
      '+</button>' +
      '<button class="personal-reset"' + attrs + ' data-act="pz" title="' + esc(m.name) + '：清空个人扣分">清零</button></span>';
  }

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
        '<button type="button" class="btn tiny" data-pick-add aria-label="第'+g.no+'组新增成员">＋ 加人</button>'+
        '<button type="button" class="btn tiny" data-pick-minus aria-label="第'+g.no+'组移出成员">－ 减人</button>'+
        '<div data-pick-editor hidden><input type="search" autocomplete="off" aria-label="第'+g.no+'组检索学号" placeholder="学号或后两位"><div class="group-pick-results" role="list"></div><button type="button" class="btn tiny" data-pick-exit>退出选人</button></div>'+
        '<div data-pick-members hidden></div>';
      slot.appendChild(box);
      var editor=box.querySelector('[data-pick-editor]'),input=box.querySelector('input'),results=box.querySelector('.group-pick-results'),members=box.querySelector('[data-pick-members]');

      function addMember(r){
        if(!groupPicking||groupPicking.no!==g.no||curClass().id!==cls.id)return;
        if(!pendingList(cls).some(function(p){return p===r;})){matches();return;}
        var capBefore=groupCap(g,cls);
        /* 老师点「＋加人」把人塞进已经满员的组：以前是悄悄把 g.cap 改成实际人数，
           等于替他做了「这组特例」的决定。2026-11-08 起改成先问一句 ——
           用户要求「是否允许该组特殊情况设置7人这样的情况」必须由老师自己确认。 */
        if(memberCount(g)>=capBefore&&!confirm('第'+g.no+'组现在是 '+memberCount(g)+'/'+capBefore+' 人，已经到每组上限。\n\n'+
          '再放一个就超员了。要把第'+g.no+'组设为例外（'+(memberCount(g)+1)+' 人）吗？\\n'+
          '· 确定 = 这一组特例放行，不再标红\\n· 取消 = 不放人，先移出一个再放')){
          matches();return;
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
      box.querySelector('[data-pick-add]').onclick=function(){members.hidden=true;editor.hidden=false;this.hidden=true;matches();input.focus();};
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
    $$('td.regular[data-home-grade]',host).forEach(function(cell){var person=$('[data-grade-student]',cell);if(!person)return;cell.tabIndex=0;cell.setAttribute('role','button');cell.setAttribute('aria-label',cell.title+'：查看截至第'+lesson.seq+'次课的分数明细');cell.onclick=function(){showStudentGrade(cls,person.dataset.gradeStudent,lesson);};cell.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();cell.click();}};});
  }

  function showStudentGrade(cls,key,throughLesson){
    var A=window.JFDT_ASSESSMENT,ls=(throughLesson?lessonsThrough(cls,throughLesson):lessonsOf(cls.id)).slice().sort(function(a,b){return a.seq-b.seq;}),student=A.rows(cls,ls,memberTotals(cls)).find(function(m){return m.key===key;});if(!student)return;
    var dialog=$('#studentGradeDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='studentGradeDialog';dialog.className='student-grade-dialog';document.body.appendChild(dialog);}
    var detail=ls.map(function(l){var s=sc(l,student.gno),personal=remaining(l,student.gno,student.memberIndex),myLoss=+((s.personal||{})[String(student.memberIndex)])||0,a=l.attendance&&l.attendance[key],names=A.projectNames(l),record=l.leaderScores&&l.leaderScores[String(student.gno)],values=record&&record.members&&record.members[key],projects=names.map(function(n,i){return String(n||'').trim()?esc(n)+'：'+(values&&values[i]!=null?scorePctText(values[i]):'未填'):'';}).filter(Boolean),earned=personal+projectScore(l,student.gno,student);
      return '<tr><td>第'+l.seq+'次<br>'+esc(l.date||'')+'<br>'+esc(l.topic||'')+'</td><td>初始100%<br>全组扣 −'+(Number(s.phone||0)*20)+'%<br>本人扣 −'+(myLoss*20)+'%<br><b>剩余 '+scorePctText(personal)+'</b></td><td>'+ (projects.join('<br>')||'无命名项目')+'</td><td>'+esc(a?a.label||a.status:'正常到课')+'<br>−'+pctText((a?Number(a.loss)||0:0)/9*100)+'%</td><td><b>'+pctText(Math.max(0,earned)/lessonMaxOf(l)*100)+'</b></td></tr>';
    }).join('');
    dialog.innerHTML='<div class="student-grade-heading"><h2>'+esc(student.name)+' · 截至第'+throughLesson.seq+'次课分数由来</h2><button type="button" class="btn" data-close-grade>关闭</button></div><p>'+esc(cls.name)+' · '+esc(student.sid||'')+'</p><p>项目完成率 <b>'+Math.round(student.task.earned*100)/100+' / '+student.task.maximum+'</b>（'+Math.round(student.task.rate*1000)/10+'%）；考勤完成率 <b>'+attPctText(student.attendance)+'</b>（'+student.attendance+'/9）；合计 <b>'+student.totalEarned+'</b> / '+student.totalMaximum+'，合并完成率 '+Math.round(student.performanceRate*1000)/10+'%；平时分 <b>'+student.regular+'</b>/100；计入总评 '+student.contribution+'/40。</p><p class="note">每课默认 100%（干净又卫生送分）不是加分日志。下表仅显示截至当前课次的记录；扣分最多扣完本课送分，不跨课。值日是扣分制：不值日每少一人，老师点一次「值日缺勤」，全组每人干净又卫生送分 −20%；正常值日不扣不加。可拖动右下角调整窗口大小。</p><div class="student-grade-scroll"><table class="data"><thead><tr><th>课次</th><th>干净又卫生送分</th><th>个人项目（每项 100%）</th><th>考勤</th><th>本节净得分（完成率）</th></tr></thead><tbody>'+detail+'</tbody></table></div>';
    $('[data-close-grade]',dialog).onclick=function(){dialog.close();};if(!dialog.open)openDlg(dialog);
  }

  function groupsCards(cls, lesson) {
    var gs = visibleGroups(cls);
    if (!gs.length) return '<p class="empty-hint">这个班还没有分好组（或者组里一个人都没有）。到「待分配名单」点「分组…」分一下，分好组这里就能记分了。</p>';
    return '<div class="groups">' + gs.map(function (g) {
      var s = sc(lesson, g.no);
      var total = groupTotal(lesson, g.no);
      var duty = dutyGroups(lesson).includes(g.no);
      var cnt = memberCount(g);
      var maxPhone = 1000000;
      var memberEntries = groupMemberEntries(g);
      var names = cnt
        ? memberEntries.map(function (entry) { var m=entry.m,i=entry.i;return '<span class="member-name'+attendanceNameClass(cls,m,lesson)+(isGroupLeader(g,m)?' group-leader-name':'')+'" data-leader-toggle data-g="'+g.no+'" data-member-index="'+i+'" title="双击设置或退出组长">' + (isGroupLeader(g,m)?'<span class="leader-crown" aria-label="组长">👑</span> ':'') + esc(m.name) + semesterBadge(cls,g.no,i) + '</span>'; }).join('')
        : '<span style="color:var(--muted);font-weight:400">（未录入名单）</span>';

      var personal = cnt
        ? '<div class="personals"><span class="plabel">干净又卫生 <small>0–100%</small></span>' +
          memberEntries.map(function (entry) {
            var m=entry.m,i=entry.i;
            return ctlPersonal(g.no, m, i, +s.personal[String(i)] || 0, true);
          }).join('') + '</div>'
        : '';

      return '' +
      '<div class="gcard' + (duty ? ' is-duty' : '') + (touched(lesson, g.no) ? ' touched' : '') + '" data-card="' + g.no + '">' +
        '<div class="gcard-head">' +
          '<div class="group-identity"><span class="gnum">第 ' + g.no + ' 组</span>' +
            '<span class="gcount" title="本组人数 / 上限（双击组号可加人减人）">' + cnt + '/' + groupCap(g,cls) + '</span>' +
            (duty ? '<span class="dutytag">值日</span>' : '') + '</div>' +
          '<div class="gsum"><span class="k">本节</span>' +
            '<div class="v ' + signClass(total) + '" data-total="' + g.no + '">' + fmt(total) + '</div></div>' +
        '</div>' +
        '<div class="gnames">' + names + '</div>' +
        '<div class="gcard-secondary"><span class="card-feedback-space" aria-hidden="true"></span>' + ctlClear(g.no, false) + '</div>' +
        '<div class="gctl">' +
          '<div>' +
            '<div class="lbl legacy-group-control">干净又卫生送分</div>' +
            ctlStep(g.no, 'group', s, maxOf('group', maxPhone), '干净又卫生送分') +
          '</div>' +
          '<div>' +
            '<div class="lbl" title="手机未入袋：增加次数即扣分，每次扣 20%">全组扣分</div><div class="deduction-note">每次 −20%</div>' +
            ctlBatch(g.no) +
          '</div>' +
          '<div>' +
            '<div class="lbl" title="不值日少一人点一下：全组每人干净又卫生送分 −20%；来了就不点">值日缺勤</div>' +
            ctlDuty(g.no, duty) +
          '</div>' +
        '</div>' +
        personal +
      '</div>';
    }).join('') + '</div>';
  }

  /** 表格式：照着纸质记录表的 11 列版式（组号 + 成员 + 干净又卫生 + 课堂任务 + 考勤完成率 + 全组扣分 + 值日缺勤 + 本节完成率 + 三列成绩） */
  function verticalColumns(cls){
    // CJK text needs one em; Latin letters and digits need roughly half an em.
    function width(text){return Array.from(String(text)).reduce(function(n,ch){return n+(/[^\x00-\xff]/.test(ch)?15:8);},0);}
    var labels=['组号','成员','干净又卫生','课堂任务','考勤完成率','全组扣分','值日缺勤','本节完成率','（至今完成率）','计入总评 /40','期末至少需考 /100'];
    var minima=[52,124,124,76,94,100,80,100,164,132,172];
    var widths=labels.map(function(t,i){return Math.max(minima[i],width(t)+28);});
    (cls.groups||[]).forEach(function(g){(g.members||[]).forEach(function(m){if(m.name)widths[1]=Math.max(widths[1],width(m.name+' '+(m.no||''))+36);});});
    var total=widths.reduce(function(a,b){return a+b;},0),names=['no','mem','project','attendance','phone','duty','sum','grade','grade','grade'];
    return widths.map(function(w,i){return '<col class="w-'+names[i]+'" data-content-width="'+w+'" style="width:'+(100*w/total).toFixed(4)+'%!important">';}).join('');
  }
  function verticalHead(){return '<thead><tr><th class="c-no">组号</th><th class="c-mem">成员</th><th class="c-ded" title="保持整洁的送分：默认 100%；不值日缺勤、手机未入袋、个人/全组扣分从这里扣，扣完为止">干净又卫生</th><th class="c-task" title="本节接线课堂任务（排位用时）折算的完成率；名次到大屏看">课堂任务</th><th class="home-attendance">考勤完成率</th><th class="c-phone">全组扣分</th><th class="c-duty" title="不值日少一人点一下：全组每人干净又卫生送分 −20%；来了就不点">值日缺勤</th><th class="c-sum">本节完成率</th><th class="home-grade regular">平时分<br>（至今完成率）</th><th class="home-grade contribution">计入总评 /40</th><th class="home-grade needed">期末至少需考 /100</th></tr></thead>';}
  function verticalGroup(cls,lesson,g,printing){
    var A=window.JFDT_ASSESSMENT,gradeLessons=lessonsThrough(cls,lesson),grades=A.rows(cls,gradeLessons,memberTotals(cls)),isDuty=dutyGroups(lesson).includes(g.no);
    var entries=groupMemberEntries(g),editing=!printing&&groupPicking&&groupPicking.classId===cls.id&&groupPicking.lessonId===lesson.id&&groupPicking.no===g.no;
    var display=entries.length?entries:[{m:null,i:-1}],span=display.length+(editing?1:0),rows=display.map(function(x,j){var m=x.m,i=x.i,key=m&&A.key(m),grade=m&&grades.find(function(r){return r.key===key;}),total=m?memberLessonRateText(lesson,g.no,m,i):'';
      var out='<tr class="vertical-member-row"'+(m?' data-member-index="'+i+'" data-member-key="'+esc(key)+'"':'')+'>';
      if(!j)out+='<td class="c-no" rowspan="'+span+'">'+g.no+' <small class="gcount" title="本组人数 / 上限（双击组号可加人减人）">'+entries.length+'/'+groupCap(g,cls)+'</small></td>';
      out+='<td class="c-mem member-name-cell'+(m?attendanceNameClass(cls,m,lesson):'')+(m&&isGroupLeader(g,m)?' group-leader-name':'')+'"'+(m?' data-leader-toggle data-g="'+g.no+'" data-member-index="'+i+'"':'')+' title="'+esc(m?(m.name+' '+(m.sid||'')+' · 双击设置或退出组长'):'双击组号添加成员')+'">'+(m?(isGroupLeader(g,m)?'<span class="leader-crown" aria-label="组长">👑</span> ':'')+esc(m.name)+(m.no==null?'':' <small>'+two(m.no)+'</small>'):'未分配成员')+'</td>';
      out+='<td class="c-ded">'+(m?(printing?scorePctText(remaining(lesson,g.no,i)):ctlPersonal(g.no,m,i,0)):'')+'</td>';
      var task=m?taskScore(lesson,g.no,m):null;
      out+='<td class="c-task"'+(task!=null?' title="'+esc(m.name)+' 本节课堂任务 '+pctText(Math.max(0,task)/5*100)+'（已包含在「本节完成率」里）"':'')+'>'+(task!=null?'<b>'+pctText(Math.max(0,task)/5*100)+'</b>':'<span class="c-task-none">—</span>')+'</td>';
      out+='<td class="home-attendance">'+(grade?(printing?'<strong>'+attPctText(grade.attendance)+'</strong>':'<button type="button" class="attendance-score" data-attendance-open="'+esc(key)+'" aria-label="'+esc(m.name)+' 考勤完成率 '+attPctText(grade.attendance)+'，点击修改">'+attPctText(grade.attendance)+'</button>'):'')+'</td>';
      if(!j)out+='<td class="c-phone" rowspan="'+span+'">'+(printing?'':ctlBatch(g.no))+'</td><td class="c-duty" rowspan="'+span+'">'+(printing?'—':ctlDuty(g.no,isDuty))+'</td>';
      out+='<td class="c-sum" title="'+esc(m?m.name:'')+'"><div class="home-grade-person" data-member-lesson-totals="'+g.no+'" data-lesson-member="'+i+'"><strong>'+total+'</strong></div></td>';
      ['regular','contribution','needed'].forEach(function(field){var value=grade?(field==='needed'?(grade.attendanceFailed?'不适用':grade.needed>100?'无法达到':grade.needed):grade[field]):'';out+='<td class="home-grade '+field+'" data-home-grade="'+field+'" title="'+esc(m?m.name:'')+'">'+(grade?'<div class="home-grade-person" data-grade-student="'+esc(key)+'"><strong>'+value+(field==='regular'?' <span class="completion-rate">（'+(grade.totalMaximum?Math.round(grade.performanceRate*1000)/10+'%':'—')+'）</span>':'')+'</strong>'+(grade.attendanceFailed?'<small>考勤挂科</small>':'')+'</div>':'')+'</td>';});
      return out+'</tr>';
    }).join('');
    if(editing)rows+='<tr class="group-pick-row"><td colspan="4" data-group-picker-slot></td><td colspan="4"></td></tr>';
    return '<tbody '+(printing?'data-pg':'data-card')+'="'+g.no+'" class="'+(dutyGroups(lesson).includes(g.no)?'is-duty ':'')+(touched(lesson,g.no)?'touched':'')+'">'+rows+'</tbody>';
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
    /* 显示层（2026-11-09）：小组口径按送分净值折完成率——本节 ÷5，累计 ÷(5×课次数) */
    var lessonGroupMax = 5;
    var cumGroupMax = 5 * (ls.length || 1);
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
    var dutyBtn=$('[data-duty-deduct]',card);if(dutyBtn)dutyBtn.outerHTML=ctlDuty(gno,dutyGroups(lesson).includes(gno));
    card.classList.toggle('touched', touched(lesson, gno));
    $$('.num', card).forEach(function (inp) {
      var f = inp.dataset.f;
      inp.value = (+s[f] || 0);
      if (f === 'phone') inp.classList.toggle('neg', (+s.phone || 0) > 0);
    });
    var tg = $('[data-act="first"]', card);
    if(tg){tg.classList.toggle('on', !!s.first);tg.textContent='✓';tg.setAttribute('aria-pressed',String(!!s.first));}
    $$('.pchip', card).forEach(function (c) {
      var n = remaining(lesson,gno,c.dataset.i);
      c.classList.toggle('hit', n<5);
      $('.n', c).textContent = scorePctText(n);
    });
  }

  /* 值日缺勤：值日组点一下 = 全组每人本节参与分 −1（2026-11-09 改制，旧「值日人数」弹窗已删）。
     走 changeMemberPoints：可撤销、进操作日志、按剩余分封顶（扣到 0 为止）。 */
  $('#groupList').addEventListener('click',function(e){var button=e.target.closest('[data-duty-deduct]');if(!button)return;var cls=curClass(),lesson=curLesson(cls);if(!lesson)return;var gno=Number(button.dataset.dutyDeduct);changeMemberPoints(cls,lesson,gno,null,-1,'值日缺勤：全组每人干净又卫生送分 −20%');});

  /* ================= 记分交互（事件委托） ================= */

  $('#groupList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var cls = curClass(), lesson = curLesson(cls);
    if (!lesson) return;
    var gno = +btn.dataset.g;
    var s = sc(lesson, gno);
    var act = btn.dataset.act;
    if(act==='batch-deduct'){changeMemberPoints(cls,lesson,gno,null,-1);return;}
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
  function changeMemberPoints(cls,lesson,gno,index,delta,label){var s=sc(lesson,gno),old=JSON.parse(JSON.stringify(s)),g=groupOf(cls,gno),base=Math.min(5,(+s.group||0)+(s.first?1:0)),values=g.members.map(function(_,i){return remaining(lesson,gno,i);});s.phone=0;g.members.forEach(function(m,i){if(!m.name)return;var value=values[i];if(index===null||String(i)===String(index))value=Math.max(0,Math.min(base,value+delta));s.personal[String(i)]=base-value;});if(JSON.stringify(old)===JSON.stringify(s))return;pushUndo({lessonId:lesson.id,gno:gno,reset:true,old:old,label:label||(index===null?'全组干净又卫生送分各扣 20%':'成员'+(+index+1)+'干净又卫生送分调整')});save();refreshCard(cls,lesson,gno);renderMetrics(cls,lesson);}
  function bumpPersonal(cls, lesson, chip, delta) {
    var gno = +chip.dataset.g, i = String(chip.dataset.i);
    var s = sc(lesson, gno);
    if(+s.phone>0){changeMemberPoints(cls,lesson,gno,i,-delta);return;}
    var old = +s.personal[i] || 0;
    var neu = clamp(old + delta, 0, Math.min(5,(+s.group||0)+(s.first?1:0)));
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

  /** 整组清零（含个人扣分），可撤销 */
  function clearGroup(cls, lesson, gno) {
    var key = String(gno);
    if (!touched(lesson, gno)) { flash('第 ' + gno + ' 组这节课还没记过分'); return; }
    if (!confirm('把第 ' + gno + ' 组这节课的分数全部归零？（其它组不受影响，清错了可以撤销）')) return;
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

  function renderRank() {
    var cls = getClass($('#rankClassSel').value) || curClass();
    if (!cls) return;
    S.ui.classId = cls.id;
    $('#rankClassSel').value = cls.id;

    var ls = lessonsOf(cls.id);

    /* 小组排行（2026-11-09 显示层：送分净值折完成率，分母 = 5×课次数） */
    var rows = cls.groups.map(function (g) {
      return { no: g.no, t: groupCum(cls, g.no), n: memberCount(g) };
    }).sort(function (a, b) { return b.t - a.t; });
    var maxAbs = Math.max(1, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.t); })));
    var groupCumMax = 5 * (ls.length || 1);
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

    /* 个人排行 */
    var ms = memberTotals(cls);
    /* 显示层：全班共用一个分母（每课 5 + 5×已命名项目数，逐课累加），学期汇总按完成率口径 */
    var semesterMax = semesterProjectMax(ls);
    $('#semesterSummary').textContent = cls.name+' · '+ls.length+'次课 · '+ms.length+'名已分组学生 · '+(ms.length&&semesterMax?'全班平均完成率 '+pctNum(ms.reduce(function(a,m){return a+Math.max(0,m.total);},0)/ms.length/semesterMax*100)+'%':'暂无课次')+'。包含当前班全部已录入课次，随记分实时更新。';
    if(window.JFDT_ASSESSMENT) window.JFDT_ASSESSMENT.renderRank({root:$('#memberRank'),cls:cls,lessons:ls,raw:ms,save:function(){save();},log:addOperationLog,message:flash,openAttendance:function(){switchView('attendance');},export:function(name,rows){download(name,toCsv(rows),'text/csv');}});

    /* 逐节明细（显示层：每课 ÷5、累计 ÷(5×课次数)，折完成率） */
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

    $('#poolMetrics').innerHTML =
      '<div class="metric"><div class="k">全班人数</div><div class="v">' + rows.length +
        ' <small>人</small></div></div>' +
      '<div class="metric"><div class="k">已分组</div><div class="v good">' + nGrouped +
        ' <small>人</small></div></div>' +
      (nSeated
        ? '<div class="metric"><div class="k">已选座 · 待确认</div><div class="v">' + nSeated +
          ' <small>人</small></div></div>'
        : '') +
      '<div class="metric"><div class="k">未分组</div><div class="v ' + (nPending ? 'neg' : '') + '">' +
        nPending + ' <small>人</small></div></div>';

    /* 筛选：圆桌上的人还没写进分组，仍然归在「待分配」这一栏里等人点确认。
       状态列里如实写「已选座 · 第 N 桌（待确认）」，和顶部「已选座待确认」那一栏对得上；
       顶部「未分组」只数「没进组也没坐桌」的人，所以「未分组 0」和列表里挂着「已选座待确认」
       的几行不矛盾——前者是统计口径，后者是等人点确认的待办。 */
    var list = rows;
    if (poolFilter === 'pending') list = rows.filter(function (x) { return x.g === null; });
    else if (poolFilter === 'assigned') list = rows.filter(function (x) { return x.g !== null; });
    var q = poolSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(function (x) {
        return String(x.r.name).toLowerCase().indexOf(q) >= 0 ||
          String(x.r.sid || '').indexOf(q) >= 0 ||
          String(x.r.no == null ? '' : x.r.no) === q;
      });
    }
    list = list.slice().sort(function (a, b) {
      return (a.r.no == null ? 9999 : a.r.no) - (b.r.no == null ? 9999 : b.r.no);
    });

    /* 可分配的目标组（上限读该组自己的 groupCap，老师特许过的组还能继续放人） */
    var groupOpts = cls.groups.map(function (g) {
      var cap = groupCap(g, cls), left = cap - memberCount(g);
      return '<option value="' + g.no + '"' + (left <= 0 ? ' disabled' : '') + '>' +
        '第 ' + g.no + ' 组（' + memberCount(g) + '/' + cap + '）</option>';
    }).join('');

    $('#poolList').innerHTML = list.length
      ? '<table class="data fit"><thead><tr>' +
        '<th>序号</th><th>姓名</th><th>学号</th><th>状态</th><th>操作</th>' +
        '</tr></thead><tbody>' +
        list.map(function (x) {
          var r = x.r;
          /* 坐在圆桌上的人还没写进分组：这里如实写「已选座」，但状态仍归「未分组」，
             因为他确实不在任何组里，拖进组才是给他分组。 */
          var status = x.g !== null
            ? '<span class="pill done">第 ' + x.g + ' 组</span>'
            : x.table
              ? '<span class="pill pending" title="学生自助选桌时坐了第 ' + x.table + ' 桌，但还没写进分组；拖进组或点「按选座确认分组」才进记分表">已选座 · 第 ' + x.table + ' 桌（待确认）</span>'
              : '<span class="pill pending">未分组</span>';
          return '<tr' + (x.g === null ? ' class="row-pending"' : '') + '>' +
            '<td>' + (r.no == null ? '' : r.no) + '</td>' +
            '<td>' + esc(r.name || '（未命名）') + '</td>' +
            '<td>' + esc(r.sid || '') + '</td>' +
            '<td>' + status + '</td>' +
            '<td>' + (x.g === null
              ? '<select class="assign" data-name="' + esc(r.name) + '" data-sid="' + esc(r.sid || '') + '">' +
                  '<option value="">分配到…</option>' + groupOpts + '</select>'
              : '<button class="btn tiny" data-unassign="' + x.g + '" data-name="' + esc(r.name) +
                '" data-sid="' + esc(r.sid || '') + '">移出小组</button>') +
              ' <button class="btn tiny danger" data-delstudent="' + esc(r.name) + '" data-name="' + esc(r.name) +
                '" data-sid="' + esc(r.sid || '') + '">删除</button>' +
            '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="rank-note">当前显示 ' + list.length + ' 条' +
          (poolFilter === 'pending' ? '（仅未分组）' : poolFilter === 'assigned' ? '（仅已分组）' : '（全部）') +
          (q ? '，搜索「' + esc(poolSearch) + '」' : '') + '。</p>'
      : '<p class="rank-note">' + (poolFilter === 'pending' ? '没有未分组的学生，全班都分好组了。' : '没有记录。') + '</p>';

    gbRows = rows;
    renderGroupBoard(cls);
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
        mem += '<div class="gb-chip' + (on ? ' on' : '') + (overLimit ? ' gb-over-limit' : '') +
          '" role="button" tabindex="0"' +
          ' data-gi="' + gi + '" data-mi="' + mi + '"' +
          ' title="' + (overLimit ? '超出本组上限 ' + cap + ' 人，但不会被自动移出：拖走 / 留下 / 单独建一组都可以。' : '') +
            '拖到别的组就换组，拖到左边的「未分组」就移出">' +
          '<span class="gb-av" aria-hidden="true">' + esc(String(m.name).slice(0, 1)) + '</span>' +
          '<span class="gb-nm">' + esc(m.name) + '</span>' +
          (m.no == null || m.no === '' ? '' : '<span class="gb-no">' + esc(m.no) + '</span>') +
          (overLimit ? '<span class="gb-over-tag">超出</span>' : '') +
          '<button type="button" class="gb-x" data-gi="' + gi + '" data-mi="' + mi + '"' +
            ' title="移出到未分组" aria-label="把' + esc(m.name) + '移出到未分组">×</button>' +
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
          '<span class="gb-gno">第 ' + esc(g.no) + ' 组</span>' +
          '<span class="gb-gcnt"><b>' + n + '</b>/' + cap + ' 人' +
            (over ? '<i class="gb-flag gb-flag-over">超 ' + over + '</i>'
                  : (full ? '<i class="gb-flag">满</i>' : '')) + '</span>' +
        '</header>' +
        bar +
        '<div class="gb-members">' + mem + '</div>' +
        '<button type="button" class="gb-add" data-add="' + gi + '">＋ 加人</button>' +
        '</section>';
    }).join('');

    var pend = (gbRows || []).filter(function (x) { return x.g === null; })
      .filter(function (x) { return match(x.r.name, x.r.sid, x.r.no); });
    var nSeat = pend.filter(function (x) { return !!x.table; }).length;
    var nWait = pend.length - nSeat;
    var pChips = pend.map(function (x) {
      var r = x.r, key = gbRowKey(r);
      var on = gbPick && gbPick.kind === 'pending' && gbPick.key === key;
      return '<div class="gb-chip gb-pend-chip' + (on ? ' on' : '') + '" role="button" tabindex="0"' +
        ' data-pkey="' + esc(key) + '" title="拖到右边任意一组就加进去">' +
        '<span class="gb-av" aria-hidden="true">' + esc(String(r.name || '?').slice(0, 1)) + '</span>' +
        '<span class="gb-nm">' + esc(r.name || '（未命名）') + '</span>' +
        (r.no == null || r.no === '' ? '' : '<span class="gb-no">' + esc(r.no) + '</span>') +
        (x.table ? '<span class="gb-tag">已选座 · 第 ' + x.table + ' 桌</span>' : '') +
        '</div>';
    }).join('');

    /* 撤销条：拖完人以后原地显示「撤销」，不用去操作日志里翻。
       另一条「撤回上一次分组」读跨操作的分组快照，整份还原（连成员顺序一起，
       因为个人扣分是按组内下标存的）。 */
    var undoBar = (gbUndo && gbUndo.clsId === cls.id)
      ? '<div class="gb-undo"><span>' + esc(gbUndo.label) + '</span>' +
        '<button type="button" class="gb-mini" data-gb-undo="1">撤销</button></div>'
      : '';
    var lastSnap = lastGroupSnapshot(cls);
    if (lastSnap) {
      undoBar += '<div class="gb-undo gb-undo-snap"><span>上一次分组：' + esc(lastSnap.label) +
        '（' + esc(String(lastSnap.at || '').slice(5, 16).replace('T', ' ')) + '）</span>' +
        '<button type="button" class="gb-mini" data-gb-snapundo="1">撤回上一次分组</button></div>';
    }

    box.innerHTML = undoBar +
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
      '<p class="gb-hint">拖动就是分组：把左边的学生拖到右边的组卡片上松手就进组；组里的人数满了会拒绝，并提示先移出一个。' +
        '手机上先点一个人再点目标组，效果一样。超员的人会标红但不会被移出，你可以拖走、留着，或给那一组点「设为例外」。</p>';
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

  /** 待分配的人 → 第 gi 组（gi 是 cls.groups 的下标，不是组号） */
  function gbJoin(cls, r, gi) {
    var g = cls.groups[gi];
    if (!g || !r) return false;
    var cap = groupTargetCap(cls, g);
    /* 满了要说一句，不能静默失败：老师拖过去没反应会以为程序坏了 */
    if (memberCount(g) >= cap) {
      flash('第 ' + g.no + ' 组已经满 ' + cap + ' 人（本班每组上限 ' + cap + ' 人），先移出一个再放进去');
      return false;
    }
    gbSnapshot(cls, '把「' + r.name + '」加进第 ' + g.no + ' 组');
    pushMember(g, { id: uid('m'), name: r.name, sid: r.sid || '', no: r.no == null ? null : r.no });
    addOperationLog('分组', cls.name + ' · ' + r.name + ' → 第' + g.no + '组（待分配页拖拽）');
    var reback = repairOrphansAfterAssign(cls);
    gbCommit(cls, '已把「' + r.name + '」加进第 ' + g.no + ' 组' +
      (reback ? '，已接回他名下 ' + reback + ' 条历史分' : ''));
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

  /* ---- 拖动：pointer 事件，鼠标和触摸同一套（HTML5 draggable 在手机上不工作） ---- */

  function gbGhostOf(chip, x, y) {
    var r = chip.getBoundingClientRect();
    var el = chip.cloneNode(true);
    el.classList.add('gb-ghost');
    el.classList.remove('on');
    var xb = el.querySelector('.gb-x');
    if (xb) xb.parentNode.removeChild(xb);
    el.style.width = r.width + 'px';
    el.style.left = '0px'; el.style.top = '0px';
    el.style.transform = 'translate3d(' + r.left + 'px,' + r.top + 'px,0) rotate(-1.5deg) scale(1.03)';
    document.body.appendChild(el);
    return { el: el, ox: x - r.left, oy: y - r.top };
  }

  function gbDropOn(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    return el.closest('.gb-group') || el.closest('.gb-pending');
  }

  function gbMark(el) {
    $$('.gb-over').forEach(function (n) { n.classList.remove('gb-over'); });
    if (el) el.classList.add('gb-over');
  }

  (function () {
    var board = $('#groupBoard');
    if (!board) return;

    board.addEventListener('pointerdown', function (e) {
      if (e.button) return;                                  // 只认左键 / 触摸
      var chip = e.target.closest ? e.target.closest('.gb-chip') : null;
      if (!chip) return;
      if (e.target.closest('.gb-x')) return;                 // × 有它自己的点击
      var src = gbChipSource(chip);
      if (!src) return;
      gbDrag = { chip: chip, src: src, x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false, target: null, ghost: null };
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
      var g = gbDrag.ghost;
      g.el.style.transform = 'translate3d(' + (e.clientX - g.ox) + 'px,' + (e.clientY - g.oy) + 'px,0) rotate(-1.5deg) scale(1.03)';
      gbDrag.target = gbDropOn(e.clientX, e.clientY);
      gbMark(gbDrag.target);
    }, { passive: false });

    function endDrag(e, cancelled) {
      if (!gbDrag || e.pointerId !== gbDrag.id) return;
      var d = gbDrag; gbDrag = null;
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
        if (!waiting) { flash('未分组区已经没人了：先把人从组里移出来，或者点「＋ 添加学生」'); return; }
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
  $('#poolFilter').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]');
    if (!b) return;
    poolFilter = b.dataset.f;
    $$('#poolFilter button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderPool();
  });
  $('#poolSearch').addEventListener('input', function () {
    poolSearch = this.value; renderPool();
  });

  /* 掉队归位 / 撤回上一次分组（2026-11-08）。容器里的按钮是 renderPoolFix 每次重画的，
     所以用事件委托，不在每次重画后重新绑。 */
  if ($('#poolFixRow')) {
    $('#poolFixRow').addEventListener('click', function (e) {
      var cls = curClass();
      if (!cls) return;
      if (e.target.closest('#btnRestoreDropped')) {
        var rows = droppedWithHome(cls);
        if (!rows.length) return;
        if (!confirm('把这 ' + rows.length + ' 人按记分表里原来所在的组放回去？\n\n' +
          '· 一个学生都不会被删；原组号没了的会自动补一个空组，那一组的历史小组分照样挂在原组号上\n' +
          '· 他们的个人扣分、个人项目分原样留着，不会被清掉\n' +
          '· 放回去以后还能照常拖动调整，也可以撤回')) return;
        var res = restoreDroppedToHome(cls);
        flash('已把 ' + res.moved + ' 人放回原来的组');
        renderPoolBanner(cls);
        if (res.moved) showRestoreDetail(cls, res.rows);
        return;
      }
      if (e.target.closest('#btnRollbackGroup')) {
        var snap = lastGroupSnapshot(cls);
        if (!snap) return;
        if (!confirm('撤回上一次分组？\n\n「' + snap.label + '」\n\n' +
          '组结构、每组顺序、个人扣分和个人项目分都会整份还原到这次分组之前。')) return;
        restoreGroupSnapshot(cls, snap);
        renderPoolBanner(cls);
      }
    });
  }

  $('#poolList').addEventListener('change', function (e) {
    var sel = e.target.closest('select.assign');
    if (!sel || !sel.value) return;
    var cls = curClass();
    var g = groupOf(cls, +sel.value);
    if (!g) return;
    if (memberCount(g) >= groupCap(g, cls)) {
      alert('第 ' + g.no + ' 组已满 ' + groupCap(g, cls) + ' 人。请先移出或选别的组。');
      renderPool();
      return;
    }
    pushGroupSnapshot(cls, '把「' + sel.dataset.name + '」分到第 ' + g.no + ' 组（名单页下拉）');
    pushMember(g, {
      id: uid('m'), name: sel.dataset.name,
      sid: sel.dataset.sid || '', no: studentNo(cls, sel.dataset.name, sel.dataset.sid)
    });
    var reback = repairOrphansAfterAssign(cls);
    save(); renderPool(); renderScore();
    flash('已把「' + sel.dataset.name + '」分到第 ' + g.no + ' 组' +
      (reback ? '，已接回他名下 ' + reback + ' 条历史分' : ''));
  });

  $('#poolList').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var cls = curClass();

    if (b.dataset.unassign) {
      var g = groupOf(cls, +b.dataset.unassign);
      if (!g) return;
      var nm = b.dataset.name, sd = b.dataset.sid || '';
      var j = -1;
      for (var i = 0; i < g.members.length; i++) {
        var m = g.members[i];
        if (m.name === nm && (!sd || !m.sid || String(m.sid) === sd)) { j = i; break; }
      }
      if (j < 0) return;
      if (!confirm('把「' + nm + '」移出第 ' + g.no + ' 组？他/她会回到未分组。\n' +
                   '（该组已记录的个人扣分会自动对齐，不会算到别人头上）')) return;
      pushGroupSnapshot(cls, '把「' + nm + '」移出第 ' + g.no + ' 组（名单页）');
      /* 人回到待分配，但他在这组的个人项目分（leaderScores[组号].members[成员键]）原样留着 ——
         这既是他的分，也是「他原来在第几组」的证据，之后「把掉出的人放回原组」就靠它认人。 */
      removeMemberAt(cls, g, j);
      save(); renderPool(); renderScore();
      flash('已把「' + nm + '」移出第 ' + g.no + ' 组，回到未分组');
      return;
    }
    if (b.dataset.delstudent) {
      if (!confirm('把「' + b.dataset.name + '」从全班名单里删除？（已记的分不受影响）')) return;
      cls.roster = rosterOf(cls).filter(function (r) {
        return !(r.name === b.dataset.name && String(r.sid || '') === String(b.dataset.sid || ''));
      });
      save(); renderPool();
      flash('已从全班名单删除「' + b.dataset.name + '」');
    }
  });

  /** 从全班名单取某人的班内序号 */
  function studentNo(cls, name, sid) {
    var hit = rosterOf(cls).filter(function (r) {
      return r.name === name && (!sid || !r.sid || String(r.sid) === String(sid));
    })[0] || rosterOf(cls).filter(function (r) { return r.name === name; })[0];
    return hit ? hit.no : null;
  }

  /* 添加学生 */
  var dlgStu = $('#dlgStudent');
  $('#btnPoolAdd').addEventListener('click', function () {
    $('#stName').value = ''; $('#stNo').value = ''; $('#stSid').value = '';
    openDlg(dlgStu);
  });
  dlgStu.addEventListener('close', function () {
    if (dlgStu.returnValue !== 'ok') return;
    var name = $('#stName').value.trim();
    if (!name) { alert('请填写姓名。'); return; }
    var cls = curClass();
    var r = rosterOf(cls);
    if (r.some(function (x) { return x.name === name; })) {
      if (!confirm('全班名单里已经有「' + name + '」了，仍要再加一条吗？')) return;
    }
    r.push({
      name: name,
      no: $('#stNo').value.trim() === '' ? null : parseInt($('#stNo').value, 10),
      sid: $('#stSid').value.trim()
    });
    save(); renderPool(); renderScore();
    /* 2026-11-09：学号留空时历史分接不上——个人项目分按「sid:学号」认人（见 memberKey），
       没学号就成了另一个「id:内部ID」的新人，以前那条分变成认不到人的孤儿。
       这里把话说在前面，免得老师补完名单以为分丢了。 */
    flash('已把「' + name + '」加入全班名单，排在未分组里' + ($('#stSid').value.trim() ? '' :
      '。注意：没填完整学号——如果这位学生以前在本班记过个人项目分，那些分不会自动接上；请先移出小组并删除本条，再重新添加并填对完整学号，分即可自动接回'));
  });

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
      var box = $('#teamBoard');
      if (box) box.innerHTML = '<p class="note">' + esc(msg) + '</p>';
      tmButtons(null);
    });
  }

  /** 四个按钮的显隐与文案跟着房间状态走 */
  function tmButtons(room) {
    var open = $('#btnTeamOpen'), lock = $('#btnTeamLock'),
        fin = $('#btnTeamFinish'), close = $('#btnTeamClose'), link = $('#teamLink');
    var st = room ? room.status : 'none';
    /* 云端 jf_team_room 只按 created_at 取最新一间，房间「结束」后也照样返回它。
       所以这里不能只判断「有没有房间」：不然老师点一次「结束」，这个班四个按钮全被藏光，
       再也点不到「开放组队」，表现为「确认分组后就打不开分组了」。房间结束=这一轮收工，
       把「开放组队」放回来，老师随时能再开一轮（jf_team_open 会先把旧房间作废）。 */
    open.hidden = !!room && st !== 'closed';
    lock.hidden = !room || st === 'closed';
    fin.hidden = !room || st === 'closed';
    close.hidden = !room || st === 'closed';
    link.hidden = !room || st === 'closed';
    lock.textContent = st === 'locked' ? '继续组队' : '停止组队';
    fin.disabled = !room || !tmState || !(tmState.seats || []).length;
    if (room && room.room) {
      link.href = 'team.html?r=' + room.room;
      link.hidden = false;
    }
  }

  function tmPaint() {
    var box = $('#teamBoard');
    if (!box) return;
    var cls = curClass();

    if (!tmOn()) {
      box.innerHTML = '<p class="note">登录后（右上角账号）才能用学生选桌组队：房间和选座结果都存在云端，' +
        '学生用自己的学号账号打开「学生入口」就能连上。</p>';
      tmButtons(null);
      return;
    }
    if (!tmClassId(cls)) {
      box.innerHTML = '<p class="note">这个班还没对应首页班级，组队用不了。先到「数据与备份」页把本班对应到' +
        '首页同名的班 —— 学生账号就是从那份名单来的。</p>';
      tmButtons(null);
      return;
    }

    var room = tmRoom && tmRoom.room ? tmRoom : null;
    tmButtons(room);

    if (!room) {
      box.innerHTML = '<p class="note">还没开放组队。先设好<b>圆桌数</b>和<b>每桌几人</b>，点「开放组队」，' +
        '再把「学生入口」链接发到班级群；学生点一张圆桌就坐下了，你这边实时能看到。</p>';
      return;
    }

    var st = tmState || {};
    var roster = st.roster || [], seats = st.seats || [];
    var size = Number(st.size || room.size || 6), tables = Number(st.tables || room.tables || 10);
    var byTable = {}, seatNo = {};
    seats.forEach(function (s) {
      var t = Number(s.table);
      (byTable[t] = byTable[t] || []).push(s);
      if (s.no) seatNo[String(s.no)] = true;
    });
    var joined = roster.filter(function (x) { return x.joined; }).length;
    var left = roster.filter(function (x) { return !seatNo[String(x.no)]; });
    var statusText = st.status === 'open' ? '组队中' : st.status === 'locked' ? '已停止（锁定）' : '已结束';
    var statusCls = st.status === 'open' ? 'done' : st.status === 'locked' ? 'pending' : '';

    var html = '<div class="tm-bar">' +
      '<span class="pill ' + statusCls + '">' + statusText + '</span>' +
      '<span>第 <b>' + (room.room) + '</b> 号房间 · ' + tables + ' 桌 · 每桌 ' + size + ' 人</span>' +
      '<span class="tm-stat">已坐 <b>' + seats.length + '</b>/' + roster.length + ' 人</span>' +
      '<span class="tm-stat">有账号 <b>' + joined + '</b>/' + roster.length + ' 人</span>' +
      (joined < roster.length
        ? '<span class="tm-warn">' + (roster.length - joined) + ' 人还没有学号账号，只能你代点</span>' : '') +
      '</div>';

    html += '<div class="tm-desks">';
    for (var n = 1; n <= tables; n++) {
      var list = byTable[n] || [];
      var full = list.length >= size;
      html += '<div class="tm-desk' + (full ? ' full' : '') + '">' +
        '<div class="tm-desk-h">第 ' + n + ' 桌<small>' + list.length + '/' + size + '</small></div>' +
        '<div class="tm-names">' + (list.length
          ? list.map(function (s) {
              return '<span class="tm-name">' + esc(s.name) +
                (st.status === 'closed' ? '' :
                  '<button class="tm-x" data-unseat="' + s.student + '" title="移出">×</button>') +
                '</span>';
            }).join('')
          : '<span class="tm-empty">空</span>') +
        '</div></div>';
    }
    html += '</div>';

    if (left.length) {
      var opts = '';
      for (var k = 1; k <= tables; k++) {
        var cnt = (byTable[k] || []).length;
        opts += '<option value="' + k + '"' + (cnt >= size ? ' disabled' : '') + '>' + k + ' 桌' +
          (cnt >= size ? '（满）' : '') + '</option>';
      }
      html += '<div class="tm-pend">' +
        '<div class="tm-pend-h">还没选桌 <b>' + left.length + '</b> 人' +
        '<small>名字后面带「未绑」的是还没有学号账号的，直接在下拉框里帮他放桌</small></div>' +
        '<div class="tm-pend-list">' + left.map(function (s) {
          return '<span class="tm-chip' + (s.joined ? '' : ' nobind') + '">' + esc(s.name) +
            (s.joined ? '' : '<i>未绑</i>') +
            '<select data-seat="' + s.id + '"><option value="">放桌…</option>' + opts + '</select></span>';
        }).join('') + '</div></div>';
    } else {
      html += '<p class="tm-allin">全班 ' + roster.length + ' 人都选好桌了，可以点「停止组队」再「按选座确认分组」。</p>';
    }

    if (st.status === 'closed') {
      html += '<p class="note">这次组队已结束，学生端只能看不能改。想重新来过就再点一次「开放组队」。</p>';
    }

    var sig = JSON.stringify([room.room, st.status, tables, size, seats, left.length, joined]);
    if (sig === tmSig) return;   // 内容没变就别重画，省得打断老师正在点的下拉框
    tmSig = sig;
    box.innerHTML = html;
  }

  function renderTeamCard() {
    if (!$('#teamBoard')) return;
    tmSig = '';
    if (!tmOn() || !tmClassId(curClass())) { tmStop(); tmPaint(); return; }
    tmPull();
    tmStart();
  }

  /* ---- 教师端组队按钮 ---- */

  $('#btnTeamOpen').addEventListener('click', function () {
    if (tmBusy) return;
    var cls = curClass();
    if (!cls || !tmOn()) { alert('先登录再来开放组队。'); return; }
    if (!tmClassId(cls)) { alert('这个班还没对应首页班级，先在「数据与备份」页对应。'); return; }
    /* 2026-11-08：桌数 / 每桌人数不再偷偷用 10 / 6 兜底。用户说得很清楚：
       「默认好像是10组6人 我一旦不小心点错了 就会抹除我部分同学」——所以没填就是没填，
       这里直接把老师拉回「更多 · 学生自助选桌」去填，而不是替他决定一个数字。 */
    var tRaw = String($('#teamTables').value).trim(), sRaw = String($('#teamSize').value).trim();
    if (!tRaw || !sRaw) {
      openTeamMore();
      alert('先在「学生自助选桌」里填圆桌数和每桌人数。\n（这两项故意不预填，避免手一滑就按默认值分掉全班。）');
      return;
    }
    var tables = Math.max(1, Math.min(40, Math.round(Number(tRaw) || 0)));
    var size = clampLimit(sRaw);
    if (!tables || !size) {
      openTeamMore();
      alert('圆桌数要是 1–40，每桌人数要是 2–40。');
      return;
    }
    cls.teamTables = tables;
    var pending = truePendingList(cls).length;
    /* 「每桌人数」只是上限：重开房间时，上一场已经选好的座位必须原样搬过来。
       以前 jf_team_open 只新建房间，座位按 room_id 挂在旧房间上，看板只读最新一间，
       于是老师把 6 改成 7 再点「开放组队」，全班座位一夜之间全看不见了（数据还在旧房间里）。 */
    var old = (tmRoom && tmRoom.room && tmState && tmSeatClass === cls.id && (tmState.seats || []).length)
      ? tmState.seats.map(function (s) { return { student: Number(s.student), name: s.name, table: Number(s.table) || 0 }; })
      : [];
    var keep = old;
    if (old.length && tmRoom.status === 'closed') {
      keep = confirm('上一场（已结束）还留着 ' + old.length + ' 个座位。\n\n要沿用到这次的圆桌上吗？\n' +
        '· 确定 = 沿用（桌号不变，只改每桌上限）\n· 取消 = 从空桌子重新选座') ? old : [];
    }
    if (!confirm('开放组队：' + tables + ' 张圆桌，每桌最多 ' + size + ' 人。\n\n' +
      '学生用学号账号打开「学生入口」，点一张圆桌就坐下，可以自己换桌。\n' +
      '本班现在还有 ' + pending + ' 人没分组。\n\n' +
      (keep.length ? '已经选好的 ' + keep.length + ' 个座位会原样保留（改每桌人数只改上限，不会重新分座）。\n\n' : '') +
      (tmRoom && tmRoom.room && tmRoom.status !== 'closed'
        ? '注意：本班上一次的组队房间会被作废，没确认的座位靠这里搬过来。\n\n' : '') + '确定开放？')) return;
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

  $('#btnTeamLock').addEventListener('click', function () {
    if (!tmRoom || !tmRoom.room) return;
    var lock = tmRoom.status === 'open';
    tmBusy = true;
    CLOUD.rpc('jf_team_lock', { p_room: Number(tmRoom.room), p_locked: lock })
      .then(function () {
        tmBusy = false;
        flash(lock ? '已停止组队：学生现在只能看，不能再换桌' : '已恢复组队：学生可以继续选桌');
        return tmPull();
      })
      .catch(function (e) { tmBusy = false; alert('操作失败：' + ((e && e.message) || '未知错误')); });
  });

  $('#btnTeamClose').addEventListener('click', function () {
    if (!tmRoom || !tmRoom.room) return;
    /* 结束只改房间状态，座位原样留着——那是学生自己商量出来的结果，不能替他们抹掉。
       所以文案要说清「座位还在、等你确认」；再开一场时看板只显示最新房间的座位，
       上一场没确认的就看不到了（不是被删，是跟着旧房间一起归档）。 */
    if (!confirm('结束这次组队？学生端变成只读。\n\n' +
      '结束只是停止学生改座，已选的座位会留着，等你点「按选座确认分组」才写进记分表。\n' +
      '想整班重来就再开一次组队——上一场还没确认的座位会被新房间顶掉，看板上就看不到了。')) return;
    tmBusy = true;
    CLOUD.rpc('jf_team_close', { p_room: Number(tmRoom.room) })
      .then(function () { tmBusy = false; flash('这次组队已结束，座位保留着，确认分组后才会写进记分表'); return tmPull(); })
      .catch(function (e) { tmBusy = false; alert('操作失败：' + ((e && e.message) || '未知错误')); });
  });

  /* 把选座结果写回本班分组：桌号 = 组号，桌上的人 = 这组的人 */
  function tmApplySeating() {
    var cls = curClass();
    var st = tmState;
    if (!cls || !st || !(st.seats || []).length) { alert('还没有学生选桌，先把「学生入口」链接发到班级群。'); return; }
    var seats = st.seats.slice();
    var byTable = {};
    seats.forEach(function (s) {
      var t = Number(s.table);
      if (t) (byTable[t] = byTable[t] || []).push(s);
    });
    var tables = Object.keys(byTable).map(Number).sort(function (a, b) { return a - b; });
    if (!tables.length) { alert('还没有学生选桌。'); return; }

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

    if (!confirm('按选座确认分组？\n\n' +
      '· 第 ' + tables.join('、') + ' 桌共 ' + seats.length + ' 人，写成 ' + tables.length + ' 组（组号＝桌号）\n' +
      '· 这几个组会按选座重建：原来在这几个组、但这节课没来选座的人，会回到未分组\n' +
      '· 没坐人的桌（组）一律不动\n' +
      '· 记过的分按学生身份跟着人走（个人扣分不再清空）\n' +
      '\n确认前建议先到「数据与备份」下载一份备份。继续？')) return;

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
    save(); renderPool(); renderScore(); renderPoolBanner(cls);

    var rest = pendingList(cls).length;
    flash('已按选座写成 ' + tables.length + ' 组（' + filled + ' 人）' +
      (rest ? '，还剩 ' + rest + ' 人未分组，拖进组就行' : '，全班都分好了'));
    reportScoreMigration({ personal: unmatched, leader: leaderOut });
    reportGroupChange(cls, beforeSeat, '按选座确认分组');
  }

  $('#btnTeamFinish').addEventListener('click', tmApplySeating);

  /* 看板上的两个小操作：移出某人 / 把没账号的人放到某桌 */
  $('#teamBoard').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-unseat]') : null;
    if (!b || !tmRoom || !tmRoom.room || tmBusy) return;
    var sid = Number(b.dataset.unseat);
    if (!sid) return;
    tmBusy = true;
    CLOUD.rpc('jf_team_place', { p_room: Number(tmRoom.room), p_student: sid, p_table: 0 })
      .then(function () { tmBusy = false; return tmPull(); })
      .catch(function (err) { tmBusy = false; alert('没移出来：' + ((err && err.message) || '未知错误')); });
  });

  $('#teamBoard').addEventListener('change', function (e) {
    var sel = e.target.closest ? e.target.closest('select[data-seat]') : null;
    if (!sel || !sel.value || !tmRoom || !tmRoom.room || tmBusy) return;
    var sid = Number(sel.dataset.seat), table = Number(sel.value);
    if (!sid || !table) return;
    tmBusy = true;
    CLOUD.rpc('jf_team_place', { p_room: Number(tmRoom.room), p_student: sid, p_table: table })
      .then(function () { tmBusy = false; flash('已把学生放到第 ' + table + ' 桌'); return tmPull(); })
      .catch(function (err) { tmBusy = false; alert('没放成：' + ((err && err.message) || '未知错误')); return tmPull(); });
  });

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

  /** 整班重排的二次确认。返回 true 才允许动手，一个字都不改。 */
  function confirmRegroup(cls, planArr) {
    var imp = regroupImpact(cls, planArr), lo = Math.min.apply(null, planArr), hi = Math.max.apply(null, planArr);
    var lines = [];
    lines.push('要把 ' + imp.people + ' 人重新分成 ' + imp.groups + ' 组（每组 ' + (lo === hi ? lo : lo + '–' + hi) + ' 人）。');
    if (imp.affected.length) lines.push('· 会重排：' + imp.affected.join('、') + '（组里的人会被打散）');
    if (imp.emptied.length) lines.push('· 会空出来：' + imp.emptied.join('、') + '（有历史记分的组只清空、不删除，分数还挂在原组号上）');
    lines.push('· 一个学生都不会被删掉；记过的分按学生身份跟着人走。');
    lines.push('');
    lines.push('建议先到「数据与备份」页下载一份备份。继续吗？');
    return confirm(lines.join('\n'));
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
        ' 个组是有人的——分组名单和全班名单的学号对不上。\n先到「数据与备份」页核对这个班对应的首页班级，' +
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

    /* 「学生自助选桌」里的两个框：同一套 placeholder 提示，不预填数字 */
    var lastTables = Number(cls.teamTables) || 0;
    var tIn = $('#teamTables'), sIn = $('#teamSize');
    if (tIn) tIn.placeholder = lastTables ? '上次 ' + lastTables + ' 桌' : '先填桌数，例如 8';
    if (sIn) sIn.placeholder = cap ? '上次每桌 ' + cap + ' 人' : '先填人数，例如 6';

    /* 圆桌数和每桌人数都填了才让点「开放组队」（房间已经开着时由 tmButtons 管） */
    var openBtn = $('#btnTeamOpen');
    if (openBtn && !(tmRoom && tmRoom.room && tmRoom.status !== 'closed')) {
      openBtn.disabled = !(Number(tIn && tIn.value) >= 1 && clampLimit(sIn && sIn.value));
    }
    var seatState = $('#gpSeatState');
    if (seatState) {
      var tN = Math.round(Number(tIn && tIn.value) || 0), tS = clampLimit(sIn && sIn.value);
      seatState.textContent = (tN >= 1 && tS)
        ? '将开 ' + tN + ' 张圆桌，每桌最多 ' + tS + ' 人。学生自己选座，你这边每 2 秒自动刷新。'
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
      gbCommit(cls, '现在是 ' + want + ' 个组');
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
    gbCommit(cls, '现在是 ' + cls.groups.length + ' 个组' +
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

  /** 展开最底下「学生自助选桌」那一块（原来弹窗里「③ 按选座确认」的位置） */
  function openTeamMore() {
    var d = $('#teamMore');
    if (!d) return;
    d.open = true;
    renderGroupSetup();
    if (d.scrollIntoView) d.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** 均匀分配：把待分配的人轮流塞进现有组，填到该组上限为止（不新建组） */
  function runFillExisting() {
    var cls = curClass();
    if (!cls) return;
    var pending = truePendingList(cls);
    if (!pending.length) { alert('这个班没有未分组的学生。'); return; }
    var room = cls.groups.map(function (g) {
      return { g: g, left: groupTargetCap(cls, g) - memberCount(g) };
    });
    var totalRoom = room.reduce(function (a, x) { return a + Math.max(0, x.left); }, 0);
    if (totalRoom < pending.length) {
      alert('现有小组空位不够：空位 ' + totalRoom + ' 个，未分组 ' + pending.length + ' 人。\n' +
            '请先把每组人数调大，或用 ① 按组数重新分。');
      return;
    }
    var limit = classGroupLimit(cls) || GROUP_CAP;
    if (!confirm('把 ' + pending.length + ' 名待分配学生，按班内序号顺序轮流填进现有各组（每组不超过 ' + limit + ' 人）。\n\n' +
      '不新建组、不挪动已经在组里的人。继续吗？')) return;
    var beforeF = JSON.parse(JSON.stringify(cls.groups));
    pushGroupSnapshot(cls, '均匀填充：待分配 ' + pending.length + ' 人填进现有组');
    var i = 0, done = 0;
    pending.forEach(function (r) {
      for (var k = 0; k < room.length; k++) {
        var idx = (i + k) % room.length;
        if (room[idx].left > 0) {
          pushMember(room[idx].g, {
            id: uid('m'), name: r.name, sid: r.sid || '', no: r.no
          });
          room[idx].left--;
          i = idx + 1;
          done++;
          return;
        }
      }
    });
    var reback = repairOrphansAfterAssign(cls);
    addOperationLog('分组', cls.name + ' · 均匀填充：待分配 ' + done + ' 人填进现有组');
    save(); renderPool(); renderScore(); renderPoolBanner(cls);
    flash('已均匀分配 ' + done + ' 人，可到「上课记分」页核对' +
      (reback ? '（接回历史分 ' + reback + ' 条）' : ''));
    reportGroupChange(cls, beforeF, '均匀填充');
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
    $('#btnGroupFill').addEventListener('click', runFillExisting);
    ['#teamTables', '#teamSize'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener('input', renderGroupSetup);
    });
    /* 「更多 · 学生自助选桌」展开时也把两个框的提示刷一遍 */
    if ($('#teamMore')) $('#teamMore').addEventListener('toggle', renderGroupSetup);
  }

  /* 分组结果核对弹窗（2026-11-08）：按钮是 showGroupReport 每次重画的，只绑关闭 */
  if ($('#dlgGroupReport')) {
    $('#grClose').addEventListener('click', function () { $('#dlgGroupReport').close(); });
    $('#dlgGroupReport').addEventListener('close', function () { renderGroupSummary(); });
  }

  /* ================= 数据与备份视图 ================= */

  var rosterClassId = null;

  function renderData() {
    renderHxRoster();
    renderLessonList();
    if (!rosterClassId) rosterClassId = (curClass() || {}).id || null;
    renderRoster();
  }

  /* 班级名单来自首页“班级”（点亮“小组加分”的班），规则见 hx-roster.js：只读首页名单，不删加分里的任何数据 */
  var HXR = window.JFDT_HXROSTER;
  var hxRoster = { classes: null, all: null, students: {}, loading: null, error: '', review: null };
  var hxShown = null; // 上次按首页名单画出来的班级（变了才重画）
  function visibleClasses() { return HXR.visible(S, hxRoster.all); }
  function loadHxRoster() {
    if (!CLOUD_ON || !CLOUD.rpc) return Promise.resolve();
    if (hxRoster.loading) return hxRoster.loading;
    hxRoster.loading = CLOUD.rpc('hx_my_classes').then(function (classes) {
      var mine = (classes || []).filter(HXR.lit);
      return Promise.all((classes || []).map(function (c) { // 没勾的也读：原有班对应时首页全部班都能选
        return CLOUD.rpc('hx_class_students', { p_class: c.id }).then(function (rows) { return [c.id, rows || []]; });
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
    else if (view === 'data') renderHxRoster();
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
  $('#hxRosterBox').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-hxpick]');
    if (sel && hxRoster.review && hxRoster.review.classId === sel.dataset.hxpick) { hxRoster.review = null; renderHxRoster(); }
  });
  $('#hxRosterBox').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.hxreview) {
        var id = $('[data-hxpick="' + b.dataset.hxreview + '"]').value;
        hxRoster.review = id ? { classId: b.dataset.hxreview, hxId: +id } : { classId: b.dataset.hxreview, msg: '先选对应首页的哪个班。' };
      } else if (b.dataset.hxlocal) {
        hxRoster.review = { classId: b.dataset.hxlocal, local: true };
      } else if (b.dataset.hxcancel) {
        hxRoster.review = null;
      } else if (b.dataset.hxdel) {
        /* 删除待对应班：权限放宽窗口期误导入的他人班用这个清掉。
           已录课次的班不许删（先删课次），确认后才动 S.classes。 */
        var dc = S.classes.filter(function (x) { return x.id === b.dataset.hxdel; })[0];
        if (!dc) return;
        var nL = S.lessons.filter(function (l) { return l.classId === dc.id; }).length;
        if (nL) { hxRoster.review = { classId: dc.id, msg: '「' + dc.name + '」已录 ' + nL + ' 次课，先删掉对应课次再删班。' }; }
        else if (!confirm('删除「' + dc.name + '」？这是清掉一条待对应记录，该班没有对应过首页名单。')) {
          return;
        } else {
          S.classes = S.classes.filter(function (x) { return x.id !== dc.id; });
          if (hxRoster.review && hxRoster.review.classId === dc.id) hxRoster.review = null;
          addOperationLog('首页班级', '删除待对应班 ' + dc.name);
          save(); flash('已删除 ' + dc.name);
        }
      } else if (b.dataset.hxlink) {
        var rv = hxRoster.review, hx = rv && rv.hxId && hxRoster.all.filter(function (h) { return h.id === rv.hxId; })[0];
        if (!hx) return;
        var r = HXR.link(S, rv.classId, hx, hxRoster.students[hx.id] || []);
        S = r.state; hxRoster.review = null;
        addOperationLog('首页班级', r.cls.name + ' 对应首页 ' + hx.name + hxCounts(r));
        save(); flash(r.cls.name + ' 已对应首页名单');
        hxApply(); hxRedraw();
        return;
      } else if (b.dataset.hxlocalok) {
        S = HXR.keepLocal(S, b.dataset.hxlocalok); hxRoster.review = null;
        save(); hxApply(); hxRedraw();
        return;
      } else return;
      renderHxRoster();
    } catch (er) { hxRoster.review = { classId: (hxRoster.review || {}).classId, msg: '没做成：' + er.message }; renderHxRoster(); }
  });
  $('#btnHxRefresh').addEventListener('click', function () { renderHxRoster(); loadHxRoster(); });

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
        var dialog=document.createElement('dialog');dialog.id='dlgDeleteGroup';dialog.innerHTML='<form method="dialog"><h2>删除第'+no+'组？</h2><p>该组成员会回到未分组，该组历史记分将删除。请先保留完整备份。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn danger" value="ok">确认删除</button></div></form>';document.body.appendChild(dialog);dialog.addEventListener('close',function(){var accepted=dialog.returnValue==='ok';dialog.remove();if(!accepted)return;
        cls.groups = cls.groups.filter(function (g) { return g.no !== no; });
        S.lessons.forEach(function (l) { if (l.classId === cls.id) delete l.scores[String(no)]; });
        save(); renderRoster();
        });dialog.showModal();
      });
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.lopen) {
      var l = getLesson(b.dataset.lopen);
      if (l) { S.ui.classId = l.classId; S.ui.lessonId = l.id; save(); switchView('score'); }
      return;
    }
    if (b.dataset.lclear) {
      var l2 = getLesson(b.dataset.lclear);
      if (l2 && confirm('把第 ' + l2.seq + ' 次课的分数全部清零？（课次本身保留）')) {
        l2.scores = {};
        dropUndoForLesson(l2.id);
        save(); renderData();
      }
      return;
    }
    if (b.dataset.ldel) {
      var l3 = getLesson(b.dataset.ldel);
      if (l3 && confirm('删除第 ' + l3.seq + ' 次课的全部记录？此操作不可撤销。')) {
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
    rows.push(['组号', '成员', '干净又卫生送分', '手机未入袋（次数，每次 −20%）', '个人扣分合计（%）', '本节完成率', '小组累计完成率']);
    cls.groups.forEach(function (g) {
      var s = sc(lesson, g.no);
      var ls = lessonsOf(cls.id);
      rows.push([g.no,
        g.members.map(function (m) { return m.name; }).join('、'),
        scorePctText(Math.min(5,(+s.group||0)+(s.first?1:0))), +s.phone || 0,
        '−' + (personalSum(lesson, g.no) * 20) + '%', pctText(Math.max(0, groupTotal(lesson, g.no)) / 5 * 100), pctText(Math.max(0, groupCum(cls, g.no)) / (5 * (ls.length || 1)) * 100)]);
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
        .concat([pctText(Math.max(0, groupCum(cls, g.no)) / (5 * (ls.length || 1)) * 100)]));
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

  $('#btnBackup').addEventListener('click', function () {
    download('夜夜小组制加分助手_备份_' + stamp() + '.json',
      JSON.stringify(S, null, 2), 'application/json');
  });

  $('#btnRestore').addEventListener('click', function () { $('#fileRestore').click(); });
  $('#btnRosterSetup').addEventListener('click', function () { switchView('data'); });
  $('#btnRosterGroups').addEventListener('click',function(){switchView('pool');});
  function rosterDownload(rows, name) {
    var format = $('#rosterFormat').value;
    if(format==='csv'){download(name+'.csv',toCsv(rows),'text/csv;charset=utf-8');return;}
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:20},{wch:16},{wch:26},{wch:10},{wch:12}];
    XLSX.utils.book_append_sheet(wb,ws,'名单');
    var bytes=XLSX.write(wb,{bookType:format,type:'array'});
    download(name+'.'+format,bytes,'application/octet-stream');
  }
  $('#btnExportRoster').addEventListener('click',function(){
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

  $('#fileRestore').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(fr.result);
        if (!data.classes || !data.lessons) throw new Error('格式不对');
        if (!confirm('导入将覆盖本机现有数据（' + S.lessons.length + ' 条课次记录）。继续？')) return;
        S = migrate(data);
        if (!S.ui) S.ui = {};
        if (!S.undo) S.undo = [];
        save(); fillClassSelects(); initLayout(); renderUndoBtn(); switchView('score'); renderScore();
        alert('导入完成。');
      } catch (err) {
        alert('导入失败：' + err.message);
      }
    };
    fr.readAsText(f);
    this.value = '';
  });

  $('#btnWipe').addEventListener('click', function () {
    if (!confirm('清空全部数据，恢复成初始名单？所有课次记录都会消失。')) return;
    if (!confirm('再确认一次：此操作不可撤销，建议先下载备份 JSON。')) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    S = defaultState();
    save(); fillClassSelects(); initLayout(); renderUndoBtn(); switchView('score'); renderScore();
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

  var XL_RULE = "每课「干净又卫生」送分默认 100%：不值日缺勤、手机未入袋、个人或全组扣分都从这里扣，每次 −20%，扣完为止（不跨课）。每个命名个人项目满分 100%，按 20%、40%、60%、80%、100% 五档打分（如 4 个项目打 3 个 100%、1 个 0%，项目完成率＝300%÷400%＝75%）。每课总完成率＝（剩余送分＋Σ个人项目分）÷（5＋5×已命名项目数），可达 100%。考勤是学期固定项目，满分折 100%（9 分制扣分，如扣 1 分 → 约 88.9%）。合并完成率＝（项目净得分＋考勤分）÷（项目满分＋9），内部计算口径不变，界面与导出一律按百分比显示。平时分＝合并完成率×100，计入总评＝平时分×40%，满分40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。";


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
    if(!dlg){dlg=document.createElement('dialog');dlg.id='dlgLessonPrint';dlg.innerHTML='<form method="dialog"><h2>打印本课</h2><label class="field col">打印范围<select id="lessonPrintRange"><option value="both">加分表＋背面说明</option><option value="front">仅加分表</option><option value="rules">仅规则说明</option></select></label><label class="field col">打印对象<select id="lessonPrintScope"><option value="all">本课全部小组</option><option value="groups">按组切割打印</option></select></label><label class="field col">打印页数<select id="lessonPrintPageCount"></select></label><div id="lessonPrintRanges"></div><label class="field col">纸张方向<select id="lessonPrintOrientation"><option value="portrait">A4 竖向</option><option value="landscape">A4 横向</option></select></label><p class="note">选择“按组切割打印”后，可按每页组别范围安排，例如1-6、7-13；每页最多8组。双面打印选择长边翻转；建议关闭页眉页脚。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(dlg);dlg.querySelector('#lessonPrintScope').onchange=function(){fillLessonPrintRanges(true);};dlg.querySelector('#lessonPrintPageCount').onchange=function(){fillLessonPrintRanges(false);};}
    dlg.querySelector('h2').textContent=asPdf?'下载打印版 PDF':'打印本课';dlg.querySelector('[value="ok"]').textContent=asPdf?'下载 PDF':'开始打印';
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
    var reverse='<section class="lesson-duplex-page lesson-rules-back"><h1>小组制课堂 · 加分与成绩换算说明</h1><p>'+esc(cls.name)+' · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><h2>1. 项目与扣分</h2><p>每新开一课，「干净又卫生」送分默认 100%；每个命名个人项目满分 100%（20%、40%、60%、80%、100% 五档）。同课任一组修改个人项目名，全班同步。不值日缺勤、手机未入袋、个人或全组扣分都从送分里扣，每次 −20%，扣完为止；全组扣分从每个人身上扣，个人扣分只扣本人，合计仅扣本课送分，最低 0%，不跨课。</p><h2>2. 值日与完成率换算</h2><p>值日是扣分制：不值日每少一人，教师点一下「值日缺勤」，全组每人干净又卫生送分 −20%；正常值日不扣不加，不占项目分母。每课总完成率＝（剩余送分＋Σ个人项目分）÷（5＋5×已命名项目数），可达 100%。例如 4 个任务打 3 个 100%、1 个 0%：300%÷400%＝75%。考勤是学期固定项目，满分折 100%（9 分制扣分，如扣 1 分 → 约 88.9%）。合并完成率＝（项目净得分＋考勤分）÷（项目满分＋9），内部计算口径不变，界面与打印一律按百分比显示；平时分＝合并完成率×100；计入总评＝平时分×40%，满分40。迟到早退每3次折1次旷课，不重复扣分；考勤归零或旷课达到门槛时按教师设置标红挂科。</p><h2>3. 考勤与挂科标记</h2><p>本班默认扣分：迟到'+cfg.late+'、早退'+cfg.early+'、旷课'+cfg.truant+'、请假'+cfg.leave+'（9 分制分值，教师可随时更正）；每次可由教师更正。迟到＋早退每'+cfg.lateEarlyConversion+'次折算1次旷课，只用于挂科计数，不重复扣分。实际＋折算旷课合计'+cfg.truantFailure+'次触发标红；当前考勤挂科标记'+(cfg.attendanceFailureEnabled?'开启':'关闭')+'。门槛与开关由教师在二级设置调整，更正后自动重算。</p><h2>4. 期末还需考多少分</h2><p>平时占40%，期末占60%，本班及格线'+cfg.passScore+'。期末需考=max(0,(及格线−平时成绩×0.4)÷0.6)，向上取0.1分。折合列仅显示一位小数，计算使用未提前舍入的数值。超过100表示无法达到；考勤挂科时目标不适用，考试高分不能解除标记。</p><h2>5. 阅读与使用</h2><p>每名学生独占一行，姓名与干净又卫生送分、课堂任务、考勤完成率及右侧三列直接对应；右侧为打印时本学期当前个人成绩，与排名页相同，不是小组平均分。未编辑考勤默认到课，只登记请假、旷课、迟到或早退等异常。资料未齐时供参考。纸上填写不会自动识别，教师需回网页补录；以网页最新记录为准。</p><p class="duplex-note">双面打印：A4竖向，长边翻转；关闭浏览器页眉页脚。每张加分表正面后紧跟这份规则背面。</p></section>';
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
          (memberCount(groupOf(cls, r.no)) || '') + '</td><td><b>' + pctText(Math.max(0, r.t) / (5 * (ls.length || 1)) * 100) + '</b></td></tr>';
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
            '<td><b>' + pctText(Math.max(0, groupCum(cls, g.no)) / (5 * ls.length) * 100) + '</b></td></tr>';
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
  });
  $('#lessonSel').addEventListener('change', function () {
    S.ui.lessonId = this.value; save(); renderScore();
  });
  $('#rankClassSel').addEventListener('change', function () {
    S.ui.classId = this.value; save(); renderRank();
  });
  $('#btnPrintRank').addEventListener('click', printRank);

  /* 撤销：按钮 + Ctrl/Cmd+Z */
  $('#btnUndo').addEventListener('click', function () {
    undo();
  });
  function redo(index) {if(typeof index!=='number')index=(S.redo||[]).length-1;var entry=(S.redo||[]).splice(index,1)[0];if(!entry)return false;var l=getLesson(entry.op.lessonId);if(!l)return false;var effect=entry.redoEffect||operationEffect(entry.op),actual=applyEffect(entry.op,effect,1);entry.op.effect=actual;S.undo.push(entry.op);S.ui.classId=l.classId;S.ui.lessonId=l.id;addOperationLog('重做',undoLabel(reverseOp(entry.op)));save(false);renderScore();if(entry.op.projectBatch)renderLeader();renderUndoBtn();flash('已恢复所选操作');return true;}
  $('#btnRedo').addEventListener('click', redo);
  var restoreFiveDialog=document.createElement('dialog');restoreFiveDialog.id='dlgRestoreFive';restoreFiveDialog.innerHTML='<form method="dialog"><h2>恢复干净又卫生送分 100%</h2><label class="field col">恢复范围<select id="restoreFiveScope"><option value="lesson">当前课次</option><option value="class">当前班级全部课次</option><option value="all">所有班级全部课次</option></select></label><p class="note">直接恢复每人的干净又卫生送分 100%，不生成逐人加分日志。相关扣分及撤销项移入备份归档，避免再次撤掉默认送分。个人评分表项目和考勤保留。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">恢复 100%</button></div></form>';document.body.appendChild(restoreFiveDialog);wireDialog(restoreFiveDialog);
  $('#btnRestoreFive').onclick=function(){openDlg(restoreFiveDialog);};restoreFiveDialog.addEventListener('close',function(){if(restoreFiveDialog.returnValue!=='ok')return;var cls=curClass(),current=curLesson(cls),scope=$('#restoreFiveScope').value,lessons=S.lessons.filter(function(l){return scope==='all'||scope==='class'&&l.classId===cls.id||scope==='lesson'&&current&&l.id===current.id;}),ids=new Set(lessons.map(function(l){return l.id;}));if(!lessons.length){flash('所选范围没有课次');return;}var archived={at:new Date().toISOString(),scope:scope,records:[],undo:[],redo:[],logs:[]};lessons.forEach(function(l){var c=getClass(l.classId);if(!c)return;l.memberProjectBase=5;c.groups.forEach(function(g){var old=sc(l,g.no);archived.records.push({lessonId:l.id,gno:g.no,group:old.group,first:old.first,phone:old.phone,personal:JSON.parse(JSON.stringify(old.personal||{}))});old.group=5;old.first=0;old.phone=0;old.personal={};});});function projectOp(op){return ids.has(op.lessonId)&&(op.i!=null||op.reset||['group','first','phone'].includes(op.f));}S.undo=(S.undo||[]).filter(function(op){if(projectOp(op)){archived.undo.push(op);return false;}return true;});S.redo=(S.redo||[]).filter(function(e){if(projectOp(e.op)){archived.redo.push(e);return false;}return true;});var classNames=new Set(lessons.map(function(l){return getClass(l.classId).name;}));S.operationLog=(S.operationLog||[]).filter(function(e){if(/个人扣分|项目分调整|全组项目|小组分|首个正确|全组扣分/.test(e.detail||'')&&(scope==='all'||Array.from(classNames).some(function(name){return (e.detail||'').includes(name);} ))){archived.logs.push(e);return false;}return true;});S.baselineRecoveryArchive=(S.baselineRecoveryArchive||[]).concat([archived]).slice(-3);save();renderScore();renderUndoBtn();flash('已直接恢复'+lessons.length+'课干净又卫生送分 100%，无逐人加分日志');});
  $('#logClassFilter').addEventListener('change',function(){$('#logLessonFilter').value='';renderOperationLog();});$('#logLessonFilter').addEventListener('change',renderOperationLog);$('#logSearch').addEventListener('input',renderOperationLog);
  $('#btnOperationLog').addEventListener('click',function(){renderUndoBtn();openDlg($('#dlgOperationLog'));});
  $('#closeOperationLog').addEventListener('click',function(){$('#dlgOperationLog').close();});
  (function wireLogSwipe(){
    var list=$('#operationLogList'), gesture=null, suppressClick=false;
    list.addEventListener('pointerdown',function(e){
      if(e.pointerType!=='touch' && e.pointerType!=='pen')return;
      if(e.target.closest('button'))return;
      var row=e.target.closest('.operation-row'), button=row&&row.querySelector('[data-undo-index]:not([disabled])');
      if(!button)return;
      gesture={row:row,button:button,id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,locked:false};
    });
    list.addEventListener('pointermove',function(e){
      if(!gesture || gesture.id!==e.pointerId)return;
      var dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
      if(!gesture.locked && Math.abs(dy)>10 && Math.abs(dy)>Math.abs(dx)){gesture=null;return;}
      if(!gesture.locked && dx < -10 && Math.abs(dx)>Math.abs(dy)*1.2){
        gesture.locked=true;gesture.row.setPointerCapture(e.pointerId);gesture.row.classList.add('log-swiping');
      }
      if(!gesture.locked)return;
      gesture.dx=Math.max(-150,Math.min(0,dx));
      gesture.row.style.transform='translateX('+gesture.dx+'px)';
      gesture.row.classList.toggle('swipe-ready',gesture.dx<=-96);
    });
    function finish(e,cancel){
      if(!gesture || gesture.id!==e.pointerId)return;
      var g=gesture;gesture=null;
      g.row.classList.remove('log-swiping','swipe-ready');g.row.style.transform='';
      if(!cancel && g.locked && g.dx<=-96){suppressClick=true;g.button.click();setTimeout(function(){suppressClick=false;},350);}
    }
    list.addEventListener('pointerup',function(e){finish(e,false);});
    list.addEventListener('pointercancel',function(e){finish(e,true);});
    list.addEventListener('click',function(e){if(suppressClick && e.isTrusted){e.preventDefault();e.stopPropagation();}},true);
  })();
  $('#operationLogList').addEventListener('click',function(event){
    var button=event.target.closest('button[data-undo-index],button[data-redo-index]');
    if(!button || button.disabled)return;
    if(button.dataset.undoIndex!=null){
      var index=+button.dataset.undoIndex; if(!canUndoAt(index))return;
      fadeLogRow(button.closest('.operation-row'));
      var op=S.undo.splice(index,1)[0]; S.undo.push(op); undo();
    } else {fadeLogRow(button.closest('.operation-row'));redo(+button.dataset.redoIndex);}
  });


  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k !== 'z') return;
    var ae = document.activeElement;
    var tag = ae ? ae.tagName : '';
    /* 在输入框里按 Ctrl+Z 交给浏览器自己的文本撤销，别抢 */
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.shiftKey ? redo() : undo()) e.preventDefault();
  });

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

  function doGuestLogin() {
    if (!confirm('用访客身份进入？\n\n访客记录同样保存到云端，但换设备或清缓存后就找不回来了。需要长期使用请注册邮箱账号。')) return;
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
    if (!p) { $('#tabAdmin').hidden = true; return; }
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
    /* 管理员在名字后面挂一块 VIP 金牌 —— 和「管理」页一致的身份提示 */
    box.classList.toggle('is-admin', !!p.isAdmin);
    var vip = $('#userVip');
    if (vip) vip.hidden = !p.isAdmin;
    $('#tabAdmin').hidden = !p.isAdmin;
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
  $('#btnSwitchOther').onclick = function () {
    if (!confirm('退出当前账号并打开登录页？当前记录会先尝试同步。')) return;
    var ready = CLOUD && CLOUD.flush ? CLOUD.flush() : Promise.resolve();
    ready.then(function () { return CLOUD.signOut(); });
  };

  var syncEditBlocked=true;
  function setSyncEditGate(blocked,message){syncEditBlocked=blocked;if(!S)return;['#view-score','#view-leader','#view-attendance','#view-pool','#scoreTools','#rosterCard','#lessonListCard','#hxRosterBox'].forEach(function(selector){var el=$(selector);if(el)el.toggleAttribute('inert',blocked);});['#btnRestore','#btnWipe'].forEach(function(selector){var b=$(selector);if(b)b.disabled=blocked;});var gate=$('#syncEditGate');if(!gate){gate=document.createElement('div');gate.id='syncEditGate';gate.className='sync-edit-gate';gate.setAttribute('role','status');$('#main').prepend(gate);}gate.hidden=!blocked;gate.textContent=message||'正在核对云端，确认后开放编辑';if(!blocked)hxAfterGate();}
  var conflictNotice=document.createElement('dialog');conflictNotice.id='dlgSyncConflict';conflictNotice.innerHTML='<div class="dlg"><div class="dlg-head"><h3>两台设备的记录不同</h3><button type="button" class="dlg-x" id="closeSyncConflict" aria-label="关闭同步冲突提示">✕</button></div><div class="dlg-body"><p>系统已暂停上传，请先查看下面的业务数据差异，再选择保留哪一边。</p><p class="note">关闭窗口不会解决冲突；完成一次处理后才会恢复编辑和自动同步。</p><div id="syncConflictDetails" aria-live="polite"></div><div class="btnrow conflict-actions"><button class="btn" id="backupConflictLocal">先下载本机备份</button><button class="btn" id="keepCloudConflict">保留云端记录</button><button class="btn primary" id="keepLocalConflict">保留本机记录</button></div><button class="linkbtn" id="openSyncConflictTools">打开数据与备份页面</button></div></div>';document.body.appendChild(conflictNotice);wireDialog(conflictNotice);var conflictNoticeShown=false;
  $('#closeSyncConflict').onclick=function(){conflictNotice.close();};$('#backupConflictLocal').onclick=function(){$('#btnBackup').click();};$('#openSyncConflictTools').onclick=function(){conflictNotice.close();switchView('data');$('.sync-row').scrollIntoView({block:'center',behavior:'smooth'});};$('#keepCloudConflict').onclick=function(){conflictNotice.close();$('#btnPullCloud').click();};$('#keepLocalConflict').onclick=function(){conflictNotice.close();$('#btnPushCloud').click();};
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
      function conflictLabel(path){var raw=String(path||'');if(raw==='/本机记录')return '本机记录概况';if(raw==='/处理范围')return '冲突处理范围';var parts=raw.split('/'),lesson=parts[1]==='lessons'&&getLesson(parts[2]),c=lesson&&getClass(lesson.classId);if(parts[1]==='classes')return '班级与分组';if(!lesson)return parts[1]==='lessons'?'课次记录':'业务数据';var prefix=(c?c.name:'当前班级')+' · 第'+lesson.seq+'次课';if(parts[3]==='scores'){var g=groupOf(c,+parts[4]),m=g&&g.members[+parts[6]],field=parts[5];return prefix+' · 第'+parts[4]+'组 · '+(field==='personal'?(m?m.name:'成员')+'干净又卫生个人扣分':field==='duty'||field==='dutyParticipation'?'值日分（旧制，已废弃）':field==='group'?'干净又卫生送分（默认 100%）':field==='phone'?'手机未入袋扣分':field==='first'?'首次分':'小组记分');}if(parts[3]==='leaderScores')return prefix+' · 第'+parts[4]+'组 · 个人项目评分';if(parts[3]==='attendance')return prefix+' · 考勤';return prefix+' · 课次或项目设置';}
      var rawDetails=Array.isArray(st.conflictDetails)?st.conflictDetails:[],details=rawDetails.filter(function(item,index){return rawDetails.findIndex(function(other){return String(other.path||'')===String(item.path||'')&&String(other.local)===String(item.local)&&String(other.remote)===String(item.remote);})===index;}),shown=details.slice(0,12),conflictCount=details.length||st.conflicts&&st.conflicts.length||0,detailHtml='<div class="sync-conflict-intro"><b>'+(conflictCount?'检测到 '+conflictCount+' 处差异':'检测到云端版本冲突')+'</b>'+(conflictCount?'：下面分别列出本机和云端的值。':'，但当前接口没有返回可展开的字段差异。');
      if(shown.length){detailHtml+='<div class="sync-conflict-table" role="table"><div class="sync-conflict-row sync-conflict-head" role="row"><span>位置</span><span>本机</span><span>云端</span></div>';shown.forEach(function(item){detailHtml+='<div class="sync-conflict-row" role="row"><span class="sync-conflict-path">'+esc(conflictLabel(item.path))+'</span><code>'+esc(conflictValue(item.local))+'</code><code>'+esc(conflictValue(item.remote))+'</code></div>';});detailHtml+='</div>'+(details.length>shown.length?'<p class="note">还有 '+(details.length-shown.length)+' 处差异，请先下载备份后到“数据与备份”继续核对。</p>':'');}else{detailHtml+='<p class="note">当前版本只拿到了差异位置，未能读取两端的具体值。请刷新后重试；系统仍会暂停上传，不会自动覆盖。</p>';}$('#syncConflictDetails').innerHTML=detailHtml;
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
        warn.innerHTML = (st.mode === 'conflict' ? '<b>同步冲突，本机记录已保留</b> —— 请先下载备份，再选择从云端覆盖本机或把本机覆盖云端。' :
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

  /* ---- 管理页 ---- */

  function renderAdmin() {
    var p = CLOUD && CLOUD.profile();
    if (!CLOUD_ON || !p || !p.isAdmin) return;

    var tl = $('#teacherList');
    tl.innerHTML = '<p class="note">正在加载…</p>';
    CLOUD.admin.listTeachers().then(function (rows) {
      rows = rows || [];
      if (!rows.length) { tl.innerHTML = '<p class="note">还没有老师激活过账号。</p>'; return; }
      tl.innerHTML = '<table class="data"><thead><tr><th>老师</th><th>角色</th><th>班级</th>' +
        '<th>课次</th><th>最近同步</th><th></th></tr></thead><tbody>' +
        rows.map(function (t) {
          return '<tr><td>' + esc(t.display_name || t.real_name || '未命名老师') +
            '</td><td>' + (t.is_admin ? '管理员' : '老师') +
            '</td><td>' + (t.class_count || 0) + '</td><td>' + (t.lesson_count || 0) +
            '</td><td>' + fmtTime(t.synced_at) + '</td>' +
            '<td><button class="btn tiny" data-look="' + esc(t.uid) + '" data-name="' +
            esc(t.display_name || t.real_name || '未命名老师') + '">查看数据</button></td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (e) {
      tl.innerHTML = '<p class="note">加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
    });
  }

  function showTeacherData(uid, name) {
    $('#dtTitle').textContent = name + ' 的数据';
    $('#dtBody').innerHTML = '<p class="note">正在加载…</p>';
    openDlg($('#dlgTeacher'));
    CLOUD.admin.getState(uid).then(function (r) {
      if (!r || r.ok === false) { $('#dtBody').innerHTML = '<p class="note">没有权限查看，或该老师还没同步过数据。</p>'; return; }
      var d = r.data;
      if (!d || !d.classes || !d.classes.length) {
        $('#dtBody').innerHTML = '<p class="note">这位老师还没有班级数据。</p>';
        return;
      }
      var rows = d.classes.map(function (c) {
        var mem = 0;
        (c.groups || []).forEach(function (g) { mem += memberCount(g); });
        var ls = (d.lessons || []).filter(function (l) { return l.classId === c.id; });
        var top = 0, topNo = 0;
        (c.groups || []).forEach(function (g) {
          var v = 0;
          ls.forEach(function (l) { v += groupTotal(l, g.no); });
          if (v > top) { top = v; topNo = g.no; }
        });
        return '<tr><td>' + esc(c.name) + '</td><td class="n">' + (c.groups || []).length +
          '</td><td class="n">' + mem + '</td><td class="n">' + ls.length +
          '</td><td class="n">' + (topNo ? ('第 ' + topNo + ' 组 ' + fmt(top)) : '—') + '</td></tr>';
      }).join('');
      $('#dtBody').innerHTML =
        '<p class="note dt-meta">最近同步：' + fmtTime(r.updated_at) +
        '　共 ' + d.classes.length + ' 个班、' + (d.lessons || []).length + ' 节课</p>' +
        '<table><thead><tr><th>班级</th><th class="n">小组</th><th class="n">学生</th>' +
        '<th class="n">课次</th><th class="n">累计最高</th></tr></thead><tbody>' +
        rows + '</tbody></table>' +
        '<div class="btnrow dt-foot"><button class="btn tiny" id="btnDlTeacher">' +
        '下载这位老师的完整数据 JSON</button></div>';
      var dl = $('#btnDlTeacher');
      if (dl) dl.addEventListener('click', function () {
        download('夜夜小组制加分助手_' + name + '_' + stamp() + '.json',
          JSON.stringify({ source: 'admin-export', name: name, uid: uid, data: d }, null, 2),
          'application/json');
      });
    }).catch(function (e) {
      $('#dtBody').innerHTML = '<p class="note">加载失败：' + esc(e && e.message ? e.message : e) + '</p>';
    });
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
        gateShow('login', '无法安全切换账号：浏览器存储不可用，请先备份原账号记录。');
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
  var checkCloudButton=document.createElement('button');checkCloudButton.id='btnCheckCloudLatest';checkCloudButton.className='btn';checkCloudButton.textContent='核对云端最新版';checkCloudButton.onclick=function(){checkCloudButton.disabled=true;checkCloudButton.setAttribute('aria-busy','true');refreshCloud().then(function(ok){flash(ok?'核对完成：本机已是云端最新版':'核对未完成：请查看同步冲突详情');}).finally(function(){checkCloudButton.disabled=false;checkCloudButton.removeAttribute('aria-busy');});};$('#btnSyncNow').parentElement.appendChild(checkCloudButton);
  /* 2026-11-09：手动修「换组后认不到人的历史分」。启动时会自动修一次，这里给老师一个可重复执行的入口。 */
  var repairScoresButton=document.createElement('button');repairScoresButton.id='btnRepairScores';repairScoresButton.className='btn';repairScoresButton.textContent='修复认不到人的历史分';repairScoresButton.onclick=function(){var R=window.JFDT_SCORE_REPAIR;if(!R){flash('修复模块没加载，请刷新页面');return;}var n=0;visibleClasses().forEach(function(c){n+=R.countOrphans(S,c);});if(!n){flash('没有认不到人的历史分，不用修');return;}var ok=window.confirm('检测到 '+n+' 条分数「换组后认不到人」：分还在库里，只是显示不出来。\n\n现在把它们接回本人？只搬不删，认不出人的原样保留。');if(!ok)return;var fixed=repairOrphanScores(false);flash(fixed?'已接回 '+fixed+' 条历史分':'没有可接回的分数');};$('#btnSyncNow').parentElement.appendChild(repairScoresButton);

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

  /* 数据页的同步按钮 */
  $('#btnSyncNow').addEventListener('click', function () {
    if (!CLOUD || !CLOUD.available()) { alert('云端组件没加载出来，请检查网络后刷新页面。'); return; }
    refreshCloud().then(function (verified) { if(verified)return CLOUD.flush(); }).catch(function (e) {
      alert('同步失败：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnPullCloud').addEventListener('click', function () {
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再拉取。'); return; }
    if (!confirm('用云端的记录覆盖这台设备上的记录？\n\n本机现在的分数会被替换掉（云端记录是同一账号在别的设备上存的那份）。')) return;
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
      renderData();
      flash('已用云端记录覆盖本机');
    }).catch(function (e) {
      alert('拉取失败：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnPushCloud').addEventListener('click', function () {
    if (!CLOUD_ON || !CLOUD || !CLOUD.profile()) { alert('请先登录后再上传。'); return; }
    if (!confirm('把这台设备上的记录传到云端，覆盖云端那一份？')) return;
    var upload = CLOUD.forcePush ? CLOUD.forcePush(function () { return S; }) : (CLOUD.touch(function () { return S; }), CLOUD.flush());
    upload.then(function () { alert('已经上传到云端。'); }).catch(function (e) {
      alert('上传失败，记录仍保存在当前设备：' + (e && e.message ? e.message : e));
    });
  });
  $('#btnSignOut').addEventListener('click', function () {
    if (!confirm('退出登录？\n\n未同步的记录仅保存在当前浏览器，建议先确认同步成功或下载备份。下次用同一教师账号登录可继续。')) return;
    CLOUD.signOut();
  });
  $('#btnMe').addEventListener('click', openMe);
  $('#btnUserMenu').addEventListener('click', function () { switchView('data'); });

  /* 随机抽人（draw-person.js）：本文件闭包里的 S / rosterOf / curClass 拿不出去，
     所以只在这里交一个「读取器」出去，抽人模块每次要数据时现读，不缓存，
     这样切班、导入名单、删人之后打开抽人都拿到最新的名单。 */
  window.JFDT_DRAW_SRC = {
    classes: function () { return visibleClasses(); },
    rosterOf: rosterOf,
    curClass: curClass,
    toast: flash
  };

  /* 管理页 */
  $('#teacherList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-look]');
    if (b) showTeacherData(b.dataset.look, b.dataset.name);
  });

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
