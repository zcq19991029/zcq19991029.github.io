/* ============================================================================
   接线课堂任务 → 「小组加分」自动入账　2026-11-10
   ----------------------------------------------------------------------------
   用户原话：「课堂任务与「小组加分」的分数必须直连互通 不然还需要二次核算 我们要的就是一体化」

   ── 怎么进分的（一句话）──
   老师点「结束任务」→ 服务端把名次/完成率/得分冻结 → 这个文件把每个学生的得分
   写成「小组加分」里**对应课次的一个 5 分项目列**（列名「线上连线排位 接线2.3」，
   2026-11-11 起带「线上连线排位」前缀，用来和线下连线任务区分），
   走的是原本就有的「命名个人项目」机制：assessment.js 的 taskEvidence() 会给每个
   有名字的项目列加 5 分满分并把学生得分计入 earned，所以总分自动 +5，不需要任何二次核算。

   ── 为什么在前端写、不在数据库写 ──
   全部成绩是 jf_score_states 里的**一个 jsonb blob**，前端用 revision 做 CAS。
   服务端偷偷改它 → 老师下次打开就是「同步冲突」。所以数据库只提供只读函数
   wire_task_scores()，写 blob 的事全走前端自己的保存链路（本机缓存/云端/冲突检测都不绕开）。

   ── 三条设计约定（改动前先读）──
   ① **进行中也入账（2026-11-11 用户拍板改的，原先是「只入账已结束」）**。
      用户原话：「按理说应该显示 20% 为什么课堂加分任务没被拿过来同步计算呢 没结束不算？
      我必须展示实时动态 给学生及时反馈」。
      现在 open（进行中）和 closed（已结束）走**同一段入账代码**：rate × 100% 直接落进这一列，
      未完成写 0，所以结束那一刻用冻结值覆盖同一格时口径完全一样 —— 进行中期间入的账不会被冲掉，
      也不会出现「结束前后两套算法」。任务进行中名次被人挤掉 → 完成率 100%→80% 当场跟着降，
      这正是用户要的「动态变化」。
      —— 已结束必须用冻结值（hx_wire_task_run 里落库的 place/rate/score）：给出去的平时分
         不能因为以后有人刷新纪录又变。冻结那一句在 wire_task_close 里，别删。
   ② **收敛式合并**：每次 sync 都重算整张目标矩阵再逐格比对，不靠「签名没变就跳过」。
      因为换组逻辑（takeLeaderOf / putLeaderOf / realignLeaderScores）会把学生整条记录
      搬到新组号下、新进组的学生那格是空的；只做一次性写入的话，这些格子永远是 null，
      全班就会一直显示「N 项待批改」。
   ③ **老师删掉这一列就不再塞回去**。列名被改掉也视为「这一列归老师管」，
      只记一条提示，不抢回来。任务是分数的来源，但不能跟老师抢方向盘。

   ── 2026-11-09 追加：进行中的任务要「实时榜」──
   用户原话：「课堂任务完成名单应该也有在旁边 而且实时显示获得的完成率是多少 会变化才对」
             「课堂任务实时计分 被别人超了就会变 这是很正常的竞争学习 我们鼓励动态变化」
   ① 进行中的任务，横幅里铺一排完成 chip（名次+姓名+用时+当前完成率），按名次排，最多 20 个，
      多的收成「还有 N 人」；没完成的人只报人数+前 8 个名字，不铺满。
      rate 直接用服务端算的（前 10 名 100%、11–20 名 80%、其余 70%），不在这里自己算。
   ② 有 open 任务时拉取节流 45s → 10s（LIVE_THROTTLE），靠 app.js 切到「记分」时调 maybeSync 来触发，
      不另开 setInterval。
   ③ 记上一轮的 rate，本轮变小 = 被超了，变大 = 反超，各说一句话（第一次拉取不报）。
   ========================================================================== */
(function (root) {
  'use strict';

  var W = {};
  var hooks = null;          // app.js 启动时注入（见文件末尾 boot 的说明）
  var cache = [];            // 最近一次 RPC 拿到的任务数组
  var lastAt = 0;            // 上次拉取时间（节流用）
  var inflight = null;       // 正在拉的 promise
  var lastError = '';        // 拉取失败原因（横幅要如实显示，别装作没任务）
  var lastWhy = '';          // 上一轮「为什么没入账」的提示指纹（只在变化时记一次日志，见 maybeSync）
  var THROTTLE = 45000;      // 45 秒内不重复拉，切页面/切班都不会打爆接口
  var LIVE_THROTTLE = 10000; // 当前班有「进行中」任务时用这个：完成率和名次随时会变，要跟得上
  var prevRates = null;      // 上一轮进行中任务的 { 任务号: { 学生键: {name, rate} } }，用来比「被超了/反超」
  var moves = {};            // 本轮比出来的变化 { 任务号: {down:[], up:[]} }，只由 fetch 时算一次
  var BOARD_MAX = 20;        // 横幅上最多铺多少个完成 chip（一个班 49 人，全铺会撑爆）
  /* 列名前缀（2026-11-11 用户要求）：「课堂任务生成后项目名要加上标识 比如叫线上连线排位xxxx
     用来区分线下连线任务」。线上接线任务生成的记分列一律叫「线上连线排位 接线2.3」，
     记分表列头、互评列头、学生端项目名看到的是同一个名字。
     ⚠ 改这里必须同步两处，否则「课堂任务」列会变成「—」（分还在，只是不再汇总）：
       ① app.js 的 taskScore()（约 1051 行）用正则 /^(?:接线|线上连线排位)/ 认这一列；
       ② 本文件 columnFor() 的**旧列兼容**：加前缀之前建的「接线2.3」不迁移、不重命名，
          照旧认、照旧写（改名会让老师已经排好的列/分数对不上，等于丢分）。 */
  var NAME_PREFIX = '线上连线排位';

  /* ---------------- 小工具 ---------------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 和 app.js 的 uid() 同一个配方，保证课次 id 格式一致（l + base36 时间 + 5 位随机） */
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  /* 必须和 app.js 的 memberKey() 一字不差：leaderScores[组号].members 的键就是它 */
  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function dayOf(v) { return v == null ? '' : String(v).slice(0, 10); }
  function num1(v) { var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10; return n % 1 === 0 ? String(n) : n.toFixed(1); }
  function score1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
  /* 当前这一次「全班共用」的项目列名。projectNames() 返回的是副本（可能是 4 个空占位列），
     所以永远拿副本去改、再整体写回 lesson.leaderProjectNames。 */
  function currentNames(lesson) {
    if (Array.isArray(lesson.leaderProjectNames)) return lesson.leaderProjectNames.slice();
    var A = root.JFDT_ASSESSMENT;
    var names = A && A.projectNames ? A.projectNames(lesson).slice() : [];
    /* 没有 leaderProjectNames 的老课次，projectNames() 会给出 4 个空占位列（留给组长手写）。
       如果这一课压根没有一条组长记录带过列名，就把占位列丢掉，别让「线上连线排位 接线2.3」排到第 5 格去。
       老师真的写了列名（哪怕只是留下了数组）就不动它。 */
    var hasNamed = Object.keys(lesson.leaderScores || {}).some(function (k) {
      var r = lesson.leaderScores[k];
      return r && Array.isArray(r.projects) && r.projects.some(function (n) { return String(n || '').trim(); });
    });
    if (!hasNamed && names.every(function (n) { return !String(n || '').trim(); })) return [];
    return names;
  }
  /* 写回列名：每组的 rec.projects 必须跟着同步，否则列名和分数会错列（见 leader-scoring.js 的 addProject） */
  function applyNames(lesson, names) {
    lesson.leaderProjectNames = names.slice();
    lesson.leaderProjectCount = names.length;
    Object.keys(lesson.leaderScores || {}).forEach(function (k) {
      var r = lesson.leaderScores[k];
      if (!r) return;
      if (!Array.isArray(r.projects) || r.projects.length !== names.length) r.projects = names.slice();
    });
  }

  /* 列名 = 前缀 + 原名：「线上连线排位 接线2.3」。
     前缀和原名之间留一个空格，是为了让列头在窄表头里还能折行，也方便一眼分辨
     「线上连线排位」是标识、「接线2.3」是题目。重名时的 #任务号 后缀加在最后（见 columnFor）。 */
  function taskColumnName(circuit) { return NAME_PREFIX + ' 接线' + circuit; }

  /* ---------------- 找课次（没有就建）---------------- */

  function lessonFor(state, cls, task, out) {
    var seq = Number(task.lesson_no);
    var hit = null;
    if (isFinite(seq) && seq > 0) {
      (state.lessons || []).forEach(function (l) {
        if (l && l.classId === cls.id && Number(l.seq) === seq) hit = l;
      });
      if (hit) return hit;
    } else {
      /* 没填课次（2026-11-09 用户报「课堂任务的分为什么没加到上课计分」）：
         原来这里直接拒绝 + 一条没人看得见的 notes，等于分数静悄悄没了。
         现在按任务日期兜底 —— 这个班同一天已经有课次就落在那节课上（最常见的情形：
         这节课本来就在记分表里，只是发布任务时忘了选课次）；同一天没有课次，就按
         「本班最大课次 + 1」补一节。用户要的是「发布即自动多一列 5 分」，
         不该因为漏填一个下拉就让整条链断掉。 */
      var d = dayOf(task.lesson_date);
      if (!d) return null;
      var byDate = null;
      (state.lessons || []).forEach(function (l) {
        if (l && l.classId === cls.id && dayOf(l.date) === d) byDate = l;
      });
      if (byDate) { out.notes.push({ kind: 'byDate', taskId: task.task_id, text: '接线' + task.circuit + '：任务没填课次，已按日期 ' + d + ' 记到第 ' + byDate.seq + ' 次课' }); return byDate; }
      seq = 1;
      (state.lessons || []).forEach(function (l) { if (l && l.classId === cls.id) seq = Math.max(seq, Number(l.seq) || 0); });
      seq += 1;
      out.notes.push({ kind: 'byDate', taskId: task.task_id, text: '接线' + task.circuit + '：任务没填课次，已按日期 ' + d + ' 新开第 ' + seq + ' 次课记账' });
    }
    /* 课次不存在就自动建一个：用户要的是「每节课发布即新增 5 分项目」，
       课次不存在 → 分数无处可去 → 等于又要老师手工补一节课，那就白做了。 */
    var l = {
      id: uid('l'), classId: cls.id, seq: seq,
      date: dayOf(task.lesson_date) || todayStr(),
      topic: task.title || ('接线' + task.circuit),
      dutyGroup: null, dutyGroups: [],
      scores: {}, memberProjectBase: 5,
      leaderScores: {}, leaderProjectNames: [], leaderProjectCount: 0, peerMeta: {},
      autoCreatedBy: 'wire-task'   // 留个记号：这节是接线任务自动建的，不是老师手建的
    };
    (cls.groups || []).forEach(function (g) {
      if (g && g.no) l.scores[String(g.no)] = { first: 0, group: 5, phone: 0, personal: {} };
    });
    state.lessons.push(l);
    out.created.push({ classId: cls.id, seq: seq, date: l.date, topic: l.topic });
    return l;
  }

  /* ---------------- 定位/新增这一列 ---------------- */

  function columnFor(lesson, task, out) {
    var names = currentNames(lesson);
    if (!lesson.wireTasks) lesson.wireTasks = {};
    var key = String(task.task_id);
    var entry = lesson.wireTasks[key];
    var want = taskColumnName(task.circuit);   // 新列名：「线上连线排位 接线2.3」
    var legacy = '接线' + task.circuit;        // 加前缀之前的旧列名：「接线2.3」

    if (entry && entry.name) {
      var at = names.indexOf(entry.name);
      if (at >= 0) {                       // 列还在（顺序可能被老师挪过，按名字找就不会错）
        entry.col = at;
        entry.applied = true;
        delete entry.dismissed;
        return at;
      }
      if (entry.applied) {
        /* 之前确实写进去过，现在这列没了 → 老师手动删的，尊重他，不再塞回来 */
        if (!entry.dismissed) {
          entry.dismissed = true;
          out.notes.push({ kind: 'dismissed', taskId: task.task_id, text: '「' + entry.name + '」这一列被删掉了，这个任务不再入账（要恢复：到「上课记分」里删掉那一课的记录后重新发布/重跑）' });
        }
        return -1;
      }
    }

    /* ── 旧列兼容（2026-11-11 加前缀时补的，别删）──
       wireTasks 里记着名字的正常情况走上面那个分支，到不了这里。这里兜两种「这一列其实已经在表里」的情况：
         ① 老数据：加前缀之前建的列叫「接线2.3」，没有前缀 —— **不改名、不迁移**，
            直接沿用（列名一改，老师排好的列、已填的分、互评里的同名项就全对不上了）；
         ② wireTasks 丢了/被清过，但列还在 —— 按新名字、再按老名字各找一次，认领回来。
       两种情况都绝不新建列：同一道题多一列 = 项目满分多 5 分，直接给全班送分。
       别人（同一课另一个任务）已经占了这一列就不认领，避免两个任务抢同一格分数。 */
    var takenByOther = function (nm) {
      return Object.keys(lesson.wireTasks).some(function (k) {
        var e = lesson.wireTasks[k];
        return k !== key && e && e.name === nm && !e.dismissed;
      });
    };
    var adopt = -1;
    if (names.indexOf(want) >= 0 && !takenByOther(want)) adopt = names.indexOf(want);
    else if (names.indexOf(legacy) >= 0 && !takenByOther(legacy)) adopt = names.indexOf(legacy);
    if (adopt >= 0) {
      lesson.wireTasks[key] = {
        name: names[adopt], col: adopt, applied: true,
        circuit: task.circuit || '', title: task.title || '',
        at: new Date().toISOString()
      };
      out.notes.push({ kind: 'adopt', taskId: task.task_id, text: '接线' + task.circuit + '：这节课已经有「' + names[adopt] + '」这一列，沿用旧列记账（没有重复建列）' });
      return adopt;
    }

    /* 新加一列。同名已经被别的任务占了就加 #任务号 区分 */
    var name = want;
    Object.keys(lesson.wireTasks).forEach(function (k) {
      var e = lesson.wireTasks[k];
      if (k !== key && e && e.name === name && !e.dismissed) name = want + '#' + task.task_id;
    });
    if (names.indexOf(name) >= 0) name = want + '#' + task.task_id;

    names.push(name);
    applyNames(lesson, names);
    lesson.wireTasks[key] = {
      name: name, col: names.length - 1, applied: true,
      circuit: task.circuit || '', title: task.title || '',
      at: new Date().toISOString()
    };
    out.added.push({ taskId: task.task_id, lessonSeq: lesson.seq, name: name });
    return names.length - 1;
  }

  /* ---------------- 核心：把任务成绩摊成「组号 → 成员键 → 分数」 ---------------- */

  /**
   * 纯函数、就地改 state。给 node 单测直接用（不碰 DOM）。
   * @param {object} state  小组加分的整份数据（S）
   * @param {array}  tasks  wire_task_scores() 的返回
   * @param {object} opts   {log:true} 时把「被改回去的格子」也记进 logs
   * @returns {{changed:boolean, added:array, created:array, notes:array, unmatched:array, logs:array, live:array}}
   */
  W.plan = function (state, tasks, opts) {
    opts = opts || {};
    var out = { changed: false, added: [], created: [], notes: [], unmatched: [], logs: [], live: [] };
    if (!state || !Array.isArray(state.classes) || !Array.isArray(tasks)) return out;
    if (!Array.isArray(state.lessons)) state.lessons = [];

    tasks.forEach(function (task) {
      if (!task) return;
      /* 2026-11-11：进行中（open）也入账，不再等结束。
         用户原话「我没结束不算？我必须展示实时动态 给学生及时反馈」——学生做到哪，
         这一列就实时是多少（rate × 100%），本节完成率和平时分跟着一起动。
         口径和 closed 完全一致（未完成 = 0），所以结束时 plan 用冻结值覆盖同一格，不会出现
         「进行中的分被冲掉」或「两套算法打架」。void（作废）= 一分不写，也一条不显示。 */
      var live = task.status === 'open';
      if (!live && task.status !== 'closed') return;
      if (live) out.live.push(task);
      /* 进行中的格子是任务自己在变（被超了 100%→80%），不是老师手改的，
         所以**不写「5 → 4」这种审计日志**，否则一节 45 人课能把操作日志刷爆。 */
      var keepLog = !!opts.log && !live;
      /* 班级：接线任务挂在 hx_classes 上，小组加分这边靠 cls.hxClassId 认亲 */
      var cls = null;
      state.classes.forEach(function (c) {
        if (c && Number(c.hxClassId) === Number(task.class_id)) cls = c;
      });
      if (!cls) {
        out.notes.push({ kind: 'noclass', taskId: task.task_id, text: '接线' + task.circuit + '：这个班还没和「小组加分」里的班对应上（去名单页点「导入/对应班级」），分数暂时进不来' });
        return;
      }
      if (!task.lesson_no && !task.lesson_date) {
        out.notes.push({ kind: 'nocourse', taskId: task.task_id, text: '接线' + task.circuit + '：任务没填课次、也没有日期，分数没法定位到哪一节课（下次发布记得选课次）' });
        return;
      }

      var lesson = lessonFor(state, cls, task, out);
      if (!lesson) {
        out.notes.push({ kind: 'nocourse', taskId: task.task_id, text: '接线' + task.circuit + '：任务没有课次，也没法按日期定位（任务记录里没有日期）' });
        return;
      }
      var col = columnFor(lesson, task, out);
      if (col < 0) return;

      var names = lesson.leaderProjectNames;
      if (!lesson.leaderScores) lesson.leaderScores = {};
      if (!lesson.peerMeta) lesson.peerMeta = {};

      /* 学号 → 行；姓名 → 行（只有全组唯一时才算数，避免同名同姓张冠李戴） */
      var byNo = Object.create(null), byName = Object.create(null), nameCount = Object.create(null);
      (task.rows || []).forEach(function (r) {
        if (!r) return;
        if (r.no) byNo[String(r.no)] = r;
        var nm = String(r.name || '').trim();
        if (nm) { byName[nm] = r; nameCount[nm] = (nameCount[nm] || 0) + 1; }
      });

      (cls.groups || []).forEach(function (g) {
        if (!g || !g.no) return;
        var members = (g.members || []).filter(function (m) { return m && m.name; });
        if (!members.length) return;
        var rec = lesson.leaderScores[String(g.no)];
        if (!rec) {
          rec = lesson.leaderScores[String(g.no)] = { projects: names.slice(), members: {}, signedBy: '', note: '' };
          out.changed = true;
        }
        if (!rec.members) rec.members = {};
        if (!Array.isArray(rec.projects) || rec.projects.length !== names.length) {
          rec.projects = names.slice();
          out.changed = true;
        }

        members.forEach(function (m) {
          var mk = memberKey(m);
          if (!mk) return;
          var row = null;
          if (m.sid && byNo[String(m.sid)]) row = byNo[String(m.sid)];
          else {
            var nm = String(m.name).trim();
            if (nameCount[nm] === 1) row = byName[nm];
          }

          var value;
          if (row) value = score1(row.score);
          else if (m.sid) value = 0;             // 用户定的规则：未完成 = 0%
          else {
            /* 没学号、名字也对不上（多半是还没分组 / 名单里是拼音占位）：
               不猜、不写 0，列出来让老师去核对学号 */
            out.unmatched.push({ gno: g.no, name: m.name, taskId: task.task_id, circuit: task.circuit });
            return;
          }

          var arr = rec.members[mk];
          if (!Array.isArray(arr)) { arr = rec.members[mk] = []; out.changed = true; }
          var grew = false;
          while (arr.length < names.length) { arr.push(null); grew = true; }
          if (grew) out.changed = true;

          var old = arr[col];
          var diff = (old == null) ? true : (Number(old) !== Number(value));
          if (diff) {
            arr[col] = value;
            out.changed = true;
            /* 老师手改过的格子会被改回任务给的分：这是对的（任务是权威来源），
               但要让老师知道，别让他以为自己填的分「自己跳回去了」 */
            if (old != null && Number(old) !== Number(value) && keepLog) {
              out.logs.push(cls.name + ' · 第' + lesson.seq + '次课 · ' + m.name + '「' + names[col] + '」' + num1(old) + ' → ' + num1(value));
            }
          }

          var metaKey = g.no + '|' + mk + '|' + col;
          if (lesson.peerMeta[metaKey] !== 'wire') { lesson.peerMeta[metaKey] = 'wire'; out.changed = true; }
        });
      });
    });
    return out;
  };

  /* ---------------- 拉取 + 保存 + 重画 ---------------- */

  W.syncAll = function () {
    /* 启动时调一次：任何异常都不能冒到 app.js 的启动流程里（会把后面的 hook 全打断） */
    try { return W.maybeSync(null, true); } catch (e) { return Promise.resolve(null); }
  };

  /* 当前班有没有进行中的任务？有就说明名次/完成率在实时变，要用短节流 */
  function hasLive(cls) {
    if (!cls || !cls.hxClassId) return false;
    return cache.some(function (t) {
      return t && t.status === 'open' && Number(t.class_id) === Number(cls.hxClassId);
    });
  }

  /* 自动重画：进行中的任务现在会真改分数（以前只读），可能每 10 秒就有一格变化。
     老师此刻也许正在输入框里填东西、或者刚点开课次下拉 —— 整块重画会把焦点/输入打断。
     所以焦点在可编辑控件上时先记一笔，下一轮心跳（10 秒）再补画：
     分已经写进数据并 save 了，只是界面晚一两秒变，绝不会丢分。 */
  var needsRender = false;
  function editableFocused() {
    if (typeof document === 'undefined' || !document.activeElement) return false;
    var el = document.activeElement;
    var tag = String(el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }
  function flushRender() {
    if (!needsRender) return;
    if (!hooks || !hooks.rerender) { needsRender = false; return; }
    if (editableFocused()) return;         // 老师在操作，下一轮再来
    needsRender = false;
    try { hooks.rerender(); } catch (e) { /* 重画失败不影响已经写好的分 */ }
  }

  W.maybeSync = function (cls, force) {
    if (!hooks || !hooks.hasRpc || !hooks.hasRpc()) return Promise.resolve(null);
    var now = Date.now();
    var wait = hasLive(cls) ? LIVE_THROTTLE : THROTTLE;
    if (!force && now - lastAt < wait) { flushRender(); W.renderBanner(cls); return Promise.resolve(null); }
    if (inflight) return inflight;
    lastAt = now;
    /* 只拉当前班（省流量）；没有 hxClassId 的本地班拉全部，plan 里会按班各自归位 */
    var pClass = cls && cls.hxClassId ? Number(cls.hxClassId) : null;
    var ask;
    try { ask = hooks.rpc('wire_task_scores', { p_class: pClass }); }
    catch (e) { lastError = (e && e.message) || '读不到接线任务'; W.renderBanner(hooks.curClass ? hooks.curClass() : cls); return Promise.resolve(null); }
    inflight = Promise.resolve(ask).then(function (list) {
      lastError = '';
      cache = Array.isArray(list) ? list : [];
      /* 拿到新数据先比「被超了/反超」，再画横幅：只比进行中的任务，第一次拉取没有上一轮就不报 */
      try { diffRates(cache); } catch (e0) { moves = {}; }
      /* 网络这一段和「写进本地数据」这一段分开兜：写数据失败不该被说成「读不到任务」，
         也绝不能让一次多余的异常把记分页整块打崩。 */
      try {
        var st = hooks.getState();
        var res = W.plan(st, cache, { log: true });
        if (res.created.length) {
          hooks.log('接线任务入账', res.created.map(function (x) {
            return '自动建了第 ' + x.seq + ' 次课（' + x.date + ' · ' + x.topic + '），接线成绩记进去了';
          }).join('；'));
        }
        if (res.added.length) {
          hooks.log('接线任务入账', res.added.map(function (x) {
            return '第 ' + x.lessonSeq + ' 次课新增项目列「' + x.name + '」（满分 100% 的任务列）';
          }).join('；'));
        }
        if (res.logs.length) hooks.log('接线任务入账', res.logs.join('；'));
        /* 2026-11-09：把「为什么没入账」说出来。
           以前 notes（班级没对应 / 没填课次 / 列被删过）和 unmatched（认不出的人）只写进返回值，
           谁都不显示 —— 用户看到的就是「课堂任务的分没加到上课计分」，而且完全无从下手。
           现在拼成一条顶到操作日志里；同一批提示只在**变化时**记一次，
           免得 10 秒一次的心跳把日志刷成一片。 */
        var why = [];
        (res.notes || []).forEach(function (n) { if (n && n.text) why.push(n.text); });
        (res.unmatched || []).forEach(function (u) {
          why.push('第 ' + u.gno + ' 组「' + u.name + '」认不出是哪位同学（名单里没有这个学号/姓名，接线成绩记不进来）');
        });
        var whyKey = why.join('｜');
        if (whyKey && whyKey !== lastWhy) { lastWhy = whyKey; hooks.log('接线任务入账', why.join('；')); }
        else if (!whyKey) lastWhy = '';
        if (res.changed) {
          hooks.save();
          needsRender = true;            // 真正变了才重画（稳态下 10 秒心跳一次都不会重画）
        }
        flushRender();
        W.renderBanner(hooks.curClass ? hooks.curClass() : cls);
        return res;
      } catch (e2) {
        lastError = '入账出错：' + ((e2 && e2.message) || '未知错误');
        try { W.renderBanner(hooks.curClass ? hooks.curClass() : cls); } catch (e3) { }
        return null;
      }
    }).catch(function (e) {
      /* 读失败要说出来，别静默当「没有任务」——老师会以为没发布成功 */
      lastError = (e && e.message) || '读不到接线任务';
      W.renderBanner(hooks.curClass ? hooks.curClass() : cls);
      return null;
    }).then(function (r) { inflight = null; return r; });
    return inflight;
  };

  /* ---------------- 横幅 ---------------- */

  function rateNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pct(v) { return num1(v) + '%'; }
  function rateCls(n) { return n >= 100 ? 'r100' : (n >= 80 ? 'r80' : 'r70'); }
  /* 学生键：优先学号（和 member.sid 同源），没学号退化成姓名 */
  function rowKey(r) {
    if (r && r.no != null && String(r.no) !== '') return 'no:' + String(r.no);
    var nm = r ? String(r.name || '').trim() : '';
    return nm ? 'nm:' + nm : '';
  }
  function rowName(r) { return String((r && (r.name || r.no)) || ''); }

  /* 一轮完成率快照 → 和上一轮比：rate 变小 = 被超，变大 = 反超 */
  function diffRates(list) {
    var next = {}, out = {};
    (list || []).forEach(function (t) {
      if (!t || t.status !== 'open') return;      // 只有进行中才比：已结束的名次是冻结的
      var id = String(t.task_id);
      var snap = {};
      (t.rows || []).forEach(function (r) {
        if (!r) return;
        var k = rowKey(r);
        if (!k) return;
        snap[k] = { name: rowName(r), rate: rateNum(r.rate) };
      });
      next[id] = snap;
      var old = prevRates && prevRates[id];
      if (!old) return;                            // 第一次拉取：没有上一轮，不报变化
      var down = [], up = [];
      Object.keys(snap).forEach(function (k) {
        var a = old[k], b = snap[k];
        if (!a || a.rate == null || b.rate == null || a.rate === b.rate) return;
        (b.rate < a.rate ? down : up).push({ name: b.name, from: a.rate, to: b.rate });
      });
      if (down.length || up.length) {
        down.sort(function (x, y) { return (y.from - y.to) - (x.from - x.to); });
        up.sort(function (x, y) { return (y.to - y.from) - (x.to - x.from); });
        out[id] = { down: down, up: up };
      }
    });
    prevRates = next;
    moves = out;
  }

  /* 进行中的完成榜：名次 + 姓名 + 用时 + 当前完成率（服务端算的 rate，不自己算） */
  function leaderBoard(task) {
    var rows = (task.rows || []).filter(function (r) { return r && (r.name || r.no); });
    if (!rows.length) return '';
    rows.sort(function (a, b) {
      var pa = Number(a.place), pb = Number(b.place);
      var fa = isFinite(pa) && pa > 0, fb = isFinite(pb) && pb > 0;
      if (fa && fb && pa !== pb) return pa - pb;
      if (fa !== fb) return fa ? -1 : 1;
      return (Number(a.ms) || Number(a.sec) * 1000 || 1e15) - (Number(b.ms) || Number(b.sec) * 1000 || 1e15);
    });
    var chips = rows.slice(0, BOARD_MAX).map(function (r) {
      var rt = rateNum(r.rate);                 // rate 为空（作废）时不显示百分比
      var place = Number(r.place), sec = Number(r.sec);
      return '<span class="wire-chip' + (rt == null ? '' : ' wire-rate ' + rateCls(rt)) + '">' +
        (isFinite(place) && place > 0 ? '<b>#' + place + '</b>' : '') +
        '<span class="wire-name">' + esc(rowName(r)) + '</span>' +
        (isFinite(sec) && sec > 0 ? '<span class="wire-sec">' + num1(sec) + 's</span>' : '') +
        (rt == null ? '' : '<em>' + pct(rt) + '</em>') +
        '</span>';
    }).join('');
    if (rows.length > BOARD_MAX) {
      chips += '<span class="wire-chip wire-more">还有 ' + (rows.length - BOARD_MAX) + ' 人</span>';
    }
    return '<div class="wire-line wire-board">' + chips + '</div>';
  }

  /* 还没完成的人：只报人数 + 前 8 个名字（49 个名字全铺会把横幅撑爆） */
  function pendingLine(task, cls) {
    var done = (task.rows || []).length;
    var total = Number(task.total) || 0;
    var miss = total > 0 ? Math.max(0, total - done) : 0;
    if (!miss) return '';
    var doneNo = Object.create(null), doneName = Object.create(null), seen = Object.create(null), names = [];
    (task.rows || []).forEach(function (r) {
      if (!r) return;
      if (r.no != null && String(r.no) !== '') doneNo[String(r.no)] = 1;
      var nm = String(r.name || '').trim();
      if (nm) doneName[nm] = 1;
    });
    (cls.groups || []).forEach(function (g) {
      (g && g.members || []).forEach(function (m) {
        if (!m || !m.name) return;
        var nm = String(m.name).trim();
        if (m.sid && doneNo[String(m.sid)]) return;
        if (doneName[nm]) return;
        var k = m.sid ? 'no:' + String(m.sid) : 'nm:' + nm;
        if (seen[k]) return;
        seen[k] = 1;
        names.push(nm);
      });
    });
    var txt = '还没完成 ' + miss + ' 人';
    if (names.length) txt += '：' + names.slice(0, 8).map(function (n) { return esc(n); }).join('、') + (names.length > 8 ? ' 等' : '');
    return '<div class="wire-line wire-pend">' + txt + '</div>';
  }

  /* 被超了 / 反超成功：只在本轮比出变化时出现 */
  function moveLine(mv) {
    if (!mv) return '';
    var parts = [];
    (mv.down || []).slice(0, 3).forEach(function (x) {
      parts.push('<span class="down">⚡ ' + esc(x.name) + ' 被超了 ' + pct(x.from) + ' → ' + pct(x.to) + '，再刷一次就能超回来</span>');
    });
    (mv.up || []).slice(0, 3).forEach(function (x) {
      parts.push('<span class="up">🚀 ' + esc(x.name) + ' 反超成功 ' + pct(x.from) + ' → ' + pct(x.to) + '</span>');
    });
    if (!parts.length) return '';
    return '<div class="wire-line wire-move">' + parts.join('') + '</div>';
  }

  function scoreSplit(task) {
    var map = Object.create(null), done = 0;
    (task.rows || []).forEach(function (r) {
      var v = Number(r && r.score);
      if (!isFinite(v)) return;
      done++;
      var k = num1(v);
      map[k] = (map[k] || 0) + 1;
    });
    var keys = Object.keys(map).sort(function (a, b) { return Number(b) - Number(a); });
    var parts = keys.map(function (k) { return k + '分 ' + map[k] + '人'; });
    var miss = Math.max(0, (Number(task.total) || 0) - done);
    if (miss) parts.push('未完成 ' + miss + '人');
    return parts.join(' · ');
  }

  /* 横幅渲染（2026-11-09 用户要求撤掉：「课堂任务积分直接丢进上课计分总表，排名到投屏看」）。
     index.html 里的 #wireBanner 已经删除，所以这个函数现在拿到 null 会立刻 return —— 等于 no-op。
     留着它的原因：① 入账走的是 maybeSync，和这里无关，删不删都不影响分数；
     ② 「被超了/反超了」那套 diffRates 逻辑还在这条链路上（老师以后想恢复随时把 div 放回去）。 */
  W.renderBanner = function (cls) {
    var box = document.getElementById('wireBanner');
    if (!box) return;
    try {
      if (!hooks || !hooks.hasRpc || !hooks.hasRpc()) { box.hidden = true; box.innerHTML = ''; return; }
      cls = cls && cls.id ? cls : (hooks.curClass ? hooks.curClass() : null);
      if (!cls || !cls.hxClassId) { box.hidden = true; box.innerHTML = ''; return; }
      var mine = cache.filter(function (t) { return t && Number(t.class_id) === Number(cls.hxClassId); });
      if (!mine.length && !lastError) { box.hidden = true; box.innerHTML = ''; return; }

      var open = null, closed = [];
      mine.forEach(function (t) {
        if (t.status === 'open') open = t;
        else if (t.status === 'closed') closed.push(t);
      });
      closed.sort(function (a, b) { return String(b.closed_at || b.opened_at || '').localeCompare(String(a.closed_at || a.opened_at || '')); });

      var lines = [];
      if (lastError) {
        lines.push('<div class="wire-line wire-err">接线任务读取失败：' + esc(lastError) + '（会自动重试）</div>');
      }

      if (open) {
        var done = (open.rows || []).length, total = Number(open.total) || 0;
        lines.push('<div class="wire-line">' +
          '<span class="wire-tag">进行中</span>' +
          '接线' + esc(open.circuit) + (open.title ? '「' + esc(open.title) + '」' : '') +
          ' · 已 ' + done + '/' + total + ' 人 · <b>结束才计分</b>' +
          '<button type="button" class="btn tiny primary" data-wire-close="' + Number(open.task_id) + '">结束并计分</button>' +
          '</div>');
        /* 完成名单 + 每人当前完成率（服务端实时算的，随时会被人挤下去）。
           单独兜一层：榜画不出来也不能把「进行中 + 结束并计分」那行一起吞掉。 */
        try {
          var board = leaderBoard(open);
          if (board) lines.push(board);
          var mv = moveLine(moves[String(open.task_id)]);
          if (mv) lines.push(mv);
          var pend = pendingLine(open, cls);
          if (pend) lines.push(pend);
        } catch (eLive) { /* 忽略：横幅主体照常显示 */ }
      }

      closed.slice(0, 2).forEach(function (t, i) {
        var split = scoreSplit(t);
        var at = '';
        if (t.lesson_no) {
          var lesson = null;
          (hooks.getState().lessons || []).forEach(function (l) {
            if (l.classId === cls.id && Number(l.seq) === Number(t.lesson_no)) lesson = l;
          });
          at = ' → 第' + t.lesson_no + '次课' + (lesson ? '（' + esc(lesson.date || '') + '）' : '');
          /* 课次对上了但日期不一样：多半是两边课次号错位，分数记进了别的课，必须提醒 */
          if (lesson && dayOf(t.lesson_date) && dayOf(lesson.date) && dayOf(t.lesson_date) !== dayOf(lesson.date)) {
            at += '<span class="wire-warn">⚠ 任务日期 ' + esc(dayOf(t.lesson_date)) + ' 和这节课的日期 ' + esc(dayOf(lesson.date)) + ' 不一致，可能记错了课次，请核对</span>';
          }
        } else {
          at = '<span class="wire-warn">没有课次，分数进不来</span>';
        }
        lines.push('<div class="wire-line">' +
          '<span class="wire-tag ok">已入账</span>' +
          '接线' + esc(t.circuit) + at +
          (split ? '<small>' + esc(split) + '</small>' : '') +
          '</div>');
      });
      if (closed.length > 2) {
        lines.push('<div class="wire-line wire-more">这个班还有 ' + (closed.length - 2) + ' 个接线任务已入账，分数都在对应课次里</div>');
      }

      /* 没法入账的人：不猜、不静默，列出来让老师去核对 */
      var unmatched = [];
      var st = hooks.getState();
      var clsTasks = closed;
      clsTasks.forEach(function (t) {
        var entry = null;
        var lesson = null;
        (st.lessons || []).forEach(function (l) {
          if (l.classId === cls.id && Number(l.seq) === Number(t.lesson_no)) { lesson = l; entry = l; }
        });
        var wt = lesson && lesson.wireTasks && lesson.wireTasks[String(t.task_id)];
        if (wt && wt.dismissed) lines.push('<div class="wire-line wire-warn">「' + esc(wt.name) + '」这一列被删掉了，这个任务不再入账</div>');
      });
      (cls.groups || []).forEach(function (g) {
        (g.members || []).forEach(function (m) {
          if (m && m.name && !m.sid) unmatched.push(m.name);
        });
      });
      if (unmatched.length) {
        var show = unmatched.slice(0, 5).join('、') + (unmatched.length > 5 ? ' 等' : '');
        lines.push('<div class="wire-line wire-warn">' + unmatched.length + ' 人没填学号，接线分数记不上：' + esc(show) + '（去名单页补学号）</div>');
      }

      if (!lines.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = '<span class="dot"></span><div class="wire-body">' + lines.join('') + '</div>';

      var btn = box.querySelector('[data-wire-close]');
      if (btn) btn.onclick = function () {
        var id = Number(btn.dataset.wireClose);
        btn.disabled = true;
        var old = btn.textContent;
        btn.textContent = '结束中…';
        hooks.rpc('wire_task_close', { p_task: id }).then(function () {
          if (hooks.flash) hooks.flash('任务已结束，分数冻结并计入这节课的项目分');
          return W.maybeSync(cls, true);
        }).catch(function (e) {
          btn.disabled = false;
          btn.textContent = old;
          if (hooks.flash) hooks.flash('结束失败：' + ((e && e.message) || '请检查网络'));
        });
      };
    } catch (e) {
      /* 横幅是附属功能，绝不能因为它的异常把整个记分页搞白 */
      box.hidden = true;
      box.innerHTML = '';
    }
  };

  /* ---------------- 启动注入 ---------------- */

  /**
   * app.js 启动时调用一次：
   *   JFDT_WIRE.boot({ getState, save, log, flash, rerender, curClass, rpc, hasRpc })
   * 这样本文件不依赖 app.js 内部函数（它是个 IIFE，外面拿不到），也不用把 app.js 拆开。
   */
  W.boot = function (h) { hooks = h || null; };
  W.tasks = function () { return cache.slice(); };
  W.error = function () { return lastError; };

  root.JFDT_WIRE = W;
})(typeof window === 'undefined' ? globalThis : window);
