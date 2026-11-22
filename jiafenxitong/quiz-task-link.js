/* ============================================================================
   刷题课堂任务 → 「小组加分」自动入账　2026-11-22
   ----------------------------------------------------------------------------
   用户原话：
     「我希望刷题也做成课堂任务 对某个班级发布后 按所选题目完成的准确率给完成率分数
       同样跟仿真一样出现在小组加分的地方（不可手动修改分数）」

   ── 怎么进分的（一句话）──
   老师在「刷题 → 课堂任务」给某个班发布一份题单（选章节/题型/手动勾），学生在手机上做完，
   服务端按「答对 ÷ 题数」算出准确率（hx_quiz_task_run.rate）→ 本文件把每个学生的
   准确率 × 5 写成「小组加分」里**对应课次的一个 5 分项目列**（列名「线上刷题 <任务标题>」），
   走的是原本就有的「命名个人项目」机制：assessment.js 的 taskEvidence() 会给每个有名字、
   已有分的项目列加 5 分满分并把得分计入 earned，所以总分自动 +5，不需要任何二次核算。

   ── 为什么在前端写、不在数据库写 ──
   和 wire-task-link.js / exam-link.js 一字不差的理由：全部成绩是 jf_score_states 里的
   **一个 jsonb blob**，前端用 revision 做 CAS。服务端偷改它 → 老师下次打开就是「同步冲突」。
   所以数据库只提供只读函数 hx_quiz_task_scores(p_class)，写 blob 的事全走前端自己的保存链路。

   ── 四条设计约定（和接线任务/电子试卷同一套，改动前先读）──
   ① **进行中也入账**：open 和 closed 走同一段代码，rate × 5 直接落进这一列，没做的写 0。
      学生一边做，这一列的分数一边涨（用户要的「实时动态」）；结束那一刻用冻结值覆盖同一格，
      口径完全一样，不会出现「进行中的分被冲掉」或「两套算法打架」。
   ② **收敛式合并**：每轮重算整张目标矩阵再逐格比对，不靠签名跳过 —— 换组后学生的记录
      会被搬到新组号下，只做一次性写入的话那些格子永远是空的（本节一直显示「N 项待批改」）。
   ③ **老师删掉/改名这一列就不再塞回去**：只记一条日志，不跟老师抢方向盘。
   ④ **任务被删除 = 那一列分数一起删掉**（和接线任务同一条规矩：不然先做完的人白拿 5 分）。
      hx_quiz_task_scores 会给已删除的任务带 deleted=true，plan 看到就整列删（列名+各组分数+互评标记）；
      老师撤销删除后 deleted 变回 false，下一轮同步把列和分数重新建回来（完成记录还在库里）。
   ⑤ **【不可手改】** 这一列和排位列同等待遇：TASK_COL 正则命中即只读，
      app.js / leader-scoring.js / peer-apply.js / scores.js / score-clean.js 五处同一口径。
   ========================================================================== */
(function (root) {
  'use strict';

  var Q = {};
  var hooks = null;          // app.js 启动时注入（和 JFDT_WIRE / JFDT_EXAM 同一组 hook）
  var cache = [];            // 最近一次 RPC 拿到的任务数组
  var lastAt = 0;            // 上次拉取时间（节流）
  var inflight = null;       // 正在拉的 promise
  var lastError = '';        // 拉取失败原因（要如实说出来，别装作没任务）
  var lastWhy = '';          // 上一轮「为什么没入账」的指纹（只在变化时记一次日志）
  var THROTTLE = 45000;      // 45 秒内不重复拉
  var LIVE_THROTTLE = 10000; // 当前班有「进行中」任务时用这个：准确率随时会变
  var NAME_PREFIX = '线上刷题';
  var TITLE_MAX = 14;        // 标题超 14 字截断加 …（窄表头放得下）

  /* ---------------- 小工具 ---------------- */

  /* 必须和 app.js 的 memberKey() 一字不差：leaderScores[组号].members 的键就是它 */
  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }
  function score1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
  function num1(v) { var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10; return n % 1 === 0 ? String(n) : n.toFixed(1); }
  function dayOf(v) { return v == null ? '' : String(v).slice(0, 10); }
  /* 和 app.js 的 uid() 同一个配方，保证课次 id 格式一致 */
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function chars(s) { return Array.from(String(s == null ? '' : s)); }
  function clipTitle(t) {
    var s = String(t == null ? '' : t).trim() || '课堂任务';
    var a = chars(s);
    return a.length > TITLE_MAX ? a.slice(0, TITLE_MAX).join('') + '…' : s;
  }
  /* 列名 = 「线上刷题 11-22 第3次课」。标题里自带的「课堂任务」前缀去掉（前缀已经说了），
     窄表头少两个字符就能少折一行；超长再截断。 */
  function columnName(task) {
    var t = String((task && task.title) || '').replace(/^课堂任务[·:：\s]*/, '').trim() || ('任务' + (task && task.task_id));
    return NAME_PREFIX + ' ' + clipTitle(t);
  }

  /* 当前这一次「全班共用」的项目列名。projectNames() 返回的是副本（可能是空占位列），
     所以永远拿副本去改、再整体写回 lesson.leaderProjectNames。 */
  function currentNames(lesson) {
    if (Array.isArray(lesson.leaderProjectNames)) return lesson.leaderProjectNames.slice();
    var A = root.JFDT_ASSESSMENT;
    var names = A && A.projectNames ? A.projectNames(lesson).slice() : [];
    var hasNamed = Object.keys(lesson.leaderScores || {}).some(function (k) {
      var r = lesson.leaderScores[k];
      return r && Array.isArray(r.projects) && r.projects.some(function (n) { return String(n || '').trim(); });
    });
    if (!hasNamed && names.every(function (n) { return !String(n || '').trim(); })) return [];
    return names;
  }
  /* 写回列名：每组的 rec.projects 必须跟着同步，否则列名和分数会错列 */
  function applyNames(lesson, names) {
    lesson.leaderProjectNames = names.slice();
    lesson.leaderProjectCount = names.length;
    Object.keys(lesson.leaderScores || {}).forEach(function (k) {
      var r = lesson.leaderScores[k];
      if (!r) return;
      if (!Array.isArray(r.projects) || r.projects.length !== names.length) r.projects = names.slice();
    });
  }
  /* 新列排第一列：分数数组与 peerMeta 键里的列号一起 +1（照抄 wire-task-link.js 的 shiftColsRight） */
  function shiftColsRight(lesson, names) {
    Object.keys(lesson.leaderScores || {}).forEach(function (k) {
      var r = lesson.leaderScores[k];
      if (!r) return;
      var members = r.members;
      if (!members || typeof members !== 'object' || Array.isArray(members)) return;
      Object.keys(members).forEach(function (mk) {
        var arr = members[mk];
        if (!Array.isArray(arr)) return;
        while (arr.length < names.length - 1) arr.push(null);
        arr.unshift(null);
      });
    });
    if (lesson.peerMeta) {
      var next = {};
      Object.keys(lesson.peerMeta).forEach(function (mk) {
        var parts = mk.split('|');
        if (parts.length !== 3) { next[mk] = lesson.peerMeta[mk]; return; }
        var c = Number(parts[2]);
        if (!isFinite(c)) { next[mk] = lesson.peerMeta[mk]; return; }
        next[parts[0] + '|' + parts[1] + '|' + (c + 1)] = lesson.peerMeta[mk];
      });
      lesson.peerMeta = next;
    }
  }
  /* 删掉某一列（列名 + 每组成员这一格的分数 + 互评标记），后面的列整体左移一位。
     动作必须和 leader-scoring.js 的 removeProject 一致，否则列名和分数会错列。 */
  function removeColAt(lesson, index) {
    var names = currentNames(lesson);
    var removed = String(names[index] == null ? '' : names[index]).trim();
    names.splice(index, 1);
    lesson.leaderProjectNames = names.slice();
    lesson.leaderProjectCount = names.length;
    if (Array.isArray(lesson.teacherOnly) && removed) {
      var di = lesson.teacherOnly.indexOf(removed);
      if (di >= 0) lesson.teacherOnly.splice(di, 1);
    }
    Object.keys(lesson.leaderScores || {}).forEach(function (k) {
      var r = lesson.leaderScores[k];
      if (!r) return;
      r.projects = names.slice();
      Object.keys(r.members || {}).forEach(function (mk) {
        var arr = r.members[mk];
        if (Array.isArray(arr)) arr.splice(index, 1);
      });
    });
    if (lesson.peerMeta) {
      var next = {};
      Object.keys(lesson.peerMeta).forEach(function (k) {
        var parts = k.split('|');
        if (parts.length !== 3) return;
        var c = Number(parts[2]);
        if (!isFinite(c) || c === index) return;
        next[parts[0] + '|' + parts[1] + '|' + (c > index ? c - 1 : c)] = lesson.peerMeta[k];
      });
      lesson.peerMeta = next;
    }
    return removed;
  }

  /* ---------------- 找课次（没有就建）---------------- */

  /* 课次口径（按优先级，改动前先想清楚为什么这样排）：
       ① **有日期就以日期为准**：这个班那天有课次 → 记在那一节；没有 → 给那天新开一节。
          日期是唯一不会串的东西。任务发布时默认带「今天」，所以最常见的路径就是这一条：
          今天这节课本来就记过分 → 多一列；今天还没建课次 → 顺手建今天的课次。
       ② 没填日期才看课次号：这个班有这么一节 → 用它；没有 → 也新开一节。
       ⚠ **绝不能「日期对不上就退回课次号」**：刷题任务的课次号是「刷题任务第几次」自动递增来的
         （task.js 的 nextLessonNo），和「小组加分」里的课次序号根本不是一套编号。
         拿它对课，11-22 发布的第 1 个任务会一头撞进 11-04 那节课（实测过），
         等于把今天的准确率记到三周前的课上 —— 分数看着有，位置全错，比不入账更难查。 */
  function lessonFor(state, cls, task, out) {
    var d = dayOf(task.lesson_date);
    var seq = Number(task.lesson_no);
    var hit = null;
    if (d) {
      (state.lessons || []).forEach(function (l) {
        if (l && l.classId === cls.id && dayOf(l.date) === d) hit = l;
      });
      if (hit) return hit;
    } else if (isFinite(seq) && seq > 0) {
      (state.lessons || []).forEach(function (l) {
        if (l && l.classId === cls.id && Number(l.seq) === seq) hit = l;
      });
      if (hit) return hit;
    }
    /* 都对不上（或者有日期但那天没有课次）：新开一节。seq = 本班最大课次 + 1，
       一个课次都没有时才是第 1 次课（从 1 起算会让空课表凭空多出「第 2 次课」）。 */
    seq = 0;
    (state.lessons || []).forEach(function (l) { if (l && l.classId === cls.id) seq = Math.max(seq, Number(l.seq) || 0); });
    seq += 1;
    var l2 = {
      id: uid('l'), classId: cls.id, seq: seq,
      date: d || '',
      topic: task.title || '刷题课堂任务',
      dutyGroup: null, dutyGroups: [],
      scores: {}, memberProjectBase: 5,
      leaderScores: {}, leaderProjectNames: [], leaderProjectCount: 0, peerMeta: {},
      autoCreatedBy: 'quiz-task'   // 留个记号：这节是刷题任务自动建的，不是老师手建的
    };
    (cls.groups || []).forEach(function (g) {
      if (g && g.no) l2.scores[String(g.no)] = { first: 0, group: 5, phone: 0, personal: {} };
    });
    state.lessons.push(l2);
    out.created.push({ classId: cls.id, seq: seq, date: l2.date, topic: l2.topic });
    return l2;
  }

  /* 只找不建：删列的路径绝不允许顺手给这门课凭空建出一个空课次。
     口径必须和 lessonFor 完全一致（有日期只按日期找），否则「建在第 4 次课、删的时候找第 1 次课」。 */
  function findLesson(state, cls, task) {
    var d = dayOf(task.lesson_date), seq = Number(task.lesson_no);
    var hit = null;
    if (d) {
      (state.lessons || []).forEach(function (l) { if (l && l.classId === cls.id && dayOf(l.date) === d) hit = l; });
      return hit;
    }
    if (isFinite(seq) && seq > 0) (state.lessons || []).forEach(function (l) { if (l && l.classId === cls.id && Number(l.seq) === seq) hit = l; });
    return hit;
  }

  /* ---------------- 定位这一列 ---------------- */

  function columnFor(lesson, task, out) {
    var names = currentNames(lesson);
    if (!lesson.quizTasks) lesson.quizTasks = {};
    var key = String(task.task_id);
    var entry = lesson.quizTasks[key];
    var want = columnName(task);

    if (entry && entry.name) {
      var at = names.indexOf(entry.name);
      if (at >= 0) {                       // 列还在（顺序被老师挪过也没关系，按名字找）
        entry.col = at;
        entry.applied = true;
        delete entry.dismissed;
        return at;
      }
      if (entry.applied) {
        /* 之前确实写进去过、现在这列没了 → 老师删的或改了名。这一列归老师管，不抢回来。 */
        if (!entry.dismissed) {
          entry.dismissed = true;
          out.notes.push({ kind: 'dismissed', taskId: task.task_id, text: '「' + entry.name + '」这一列被删掉或改名了，这个任务不再写它（要恢复：把列名改回去，或先删掉任务再撤销删除重发一次）' });
        }
        return -1;
      }
    }

    /* 表里已经有同名的一列（换电脑 / 本机记录丢了）→ 认领它，绝不重复建列：
       同一个任务多一列 = 项目满分多 5 分，等于给全班送分。 */
    var takenByOther = function (nm) {
      return Object.keys(lesson.quizTasks).some(function (k) {
        var e = lesson.quizTasks[k];
        return k !== key && e && e.name === nm && !e.dismissed;
      });
    };
    var adopt = names.indexOf(want);
    if (adopt >= 0 && !takenByOther(want)) {
      lesson.quizTasks[key] = {
        name: want, col: adopt, applied: true,
        taskId: Number(task.task_id), at: new Date().toISOString()
      };
      out.notes.push({ kind: 'adopt', taskId: task.task_id, text: '这节课已经有「' + want + '」这一列，直接沿用（没有重复建列）' });
      return adopt;
    }

    /* 新加一列，排第一（和接线任务列同一个位置习惯），同名被占了就加 #任务号 */
    var name = want;
    if (names.indexOf(name) >= 0 || takenByOther(name)) name = want + '#' + task.task_id;
    names.unshift(name);
    shiftColsRight(lesson, names);
    applyNames(lesson, names);
    lesson.quizTasks[key] = {
      name: name, col: 0, applied: true,
      taskId: Number(task.task_id), at: new Date().toISOString()
    };
    out.added.push({ taskId: task.task_id, lessonSeq: lesson.seq, name: name });
    return 0;
  }

  /* 删掉某个任务留下的列（只按列名删；名字找不到就只忘掉记录，绝不按旧列号乱删） */
  function dropTaskColumn(lesson, taskId, out, why) {
    if (!lesson.quizTasks || !lesson.quizTasks[taskId]) return false;
    var entry = lesson.quizTasks[taskId];
    var names = currentNames(lesson);
    var at = entry.name ? names.indexOf(entry.name) : -1;
    if (at >= 0) {
      var removed = removeColAt(lesson, at);
      out.removed.push({ taskId: Number(taskId), lessonSeq: lesson.seq, name: removed, why: why });
    }
    delete lesson.quizTasks[taskId];
    out.changed = true;
    return true;
  }

  function classOf(state, hxClassId) {
    var hit = null;
    (state.classes || []).forEach(function (c) {
      if (c && Number(c.hxClassId) === Number(hxClassId)) hit = c;
    });
    return hit;
  }

  /* ---------------- 核心：把「准确率」摊成每一格 ---------------- */

  /**
   * 纯函数、就地改 state（和 wire-task-link.js 的 plan 同构，node 单测直接用）。
   * @param {object} state  小组加分的整份数据（S）
   * @param {array}  tasks  hx_quiz_task_scores(p_class) 的返回
   * @returns {{changed:boolean, added:array, created:array, removed:array, notes:array, logs:array, unmatched:array, live:array}}
   */
  Q.plan = function (state, tasks, opts) {
    opts = opts || {};
    var out = { changed: false, added: [], created: [], removed: [], notes: [], logs: [], unmatched: [], live: [] };
    if (!state || !Array.isArray(state.classes) || !Array.isArray(tasks)) return out;
    if (!Array.isArray(state.lessons)) state.lessons = [];

    var liveIds = {};    // 这一轮还在的任务号
    var deadIds = {};    // 任务被删了（行还在、deleted=true）

    tasks.forEach(function (task) {
      if (!task) return;
      var key = String(task.task_id);
      liveIds[key] = true;
      /* 老师删掉的任务 → 整列连分数一起删，然后跳过。
         必须放最前面：删掉的 open 任务 status 还是 'open'，不先拦就会被下面当成「进行中」继续写分。 */
      if (task.deleted) { deadIds[key] = true; return; }
      /* 进行中也入账（口径和已结束完全一致，未完成写 0），
         这样学生一边做，这一列就实时是多少，结束那一刻用冻结值覆盖同一格。 */
      if (task.status === 'open') out.live.push(task);
      else if (task.status !== 'closed') return;   // 其它状态（作废等）一分不写

      var cls = classOf(state, task.class_id);
      if (!cls) {
        out.notes.push({ kind: 'noclass', taskId: task.task_id, text: '「' + columnName(task) + '」：这个班还没和「小组加分」里的班对应上（去名单页点「导入/对应班级」），分数暂时进不来' });
        return;
      }

      var lesson = lessonFor(state, cls, task, out);
      if (!lesson) {
        out.notes.push({ kind: 'nocourse', taskId: task.task_id, text: '「' + columnName(task) + '」：找不到对应的课次，分数没法定位（任务里补上课次或日期即可）' });
        return;
      }
      var col = columnFor(lesson, task, out);
      if (col < 0) return;

      var names = lesson.leaderProjectNames;
      if (!lesson.leaderScores) lesson.leaderScores = {};
      if (!lesson.peerMeta) lesson.peerMeta = {};

      /* 学号 → 行；姓名 → 行（只有全班唯一时才算数，避免同名同姓张冠李戴） */
      var byNo = Object.create(null), byName = Object.create(null), nameCount = Object.create(null);
      (task.rows || []).forEach(function (r) {
        if (!r) return;
        if (r.no != null && String(r.no) !== '') byNo[String(r.no)] = r;
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
          if (m.sid != null && byNo[String(m.sid)]) row = byNo[String(m.sid)];
          else if (m.no != null && byNo[String(m.no)]) row = byNo[String(m.no)];
          else {
            var nm = String(m.name).trim();
            if (nameCount[nm] === 1) row = byName[nm];
          }

          /* 目标值：准确率 × 5（一位小数）；没做 = 0。
             ⚠ 一律按 5 分满分折算，不跟任务自己的「满分」字段走 ——
             这一列是「5 分项目列」，用别的满分会让本节完成率超过 100%。
             任务自己的满分只影响它在刷题成绩页里的显示。 */
          var value;
          if (row && row.rate != null && isFinite(Number(row.rate))) {
            value = score1(Math.max(0, Math.min(100, Number(row.rate))) / 100 * 5);
          } else if (!row && m.sid) value = 0;      // 名单上有学号、这个任务里没做 → 0
          else if (!row) {
            out.unmatched.push({ gno: g.no, name: m.name, taskId: task.task_id });
            return;
          } else value = 0;

          var arr = rec.members[mk];
          if (!Array.isArray(arr)) { arr = rec.members[mk] = []; out.changed = true; }
          var grew = false;
          while (arr.length < names.length) { arr.push(null); grew = true; }
          if (grew) out.changed = true;

          var old = arr[col];
          var same = (old == null && value == null) ||
                     (old != null && value != null && Number(old) === Number(value));
          if (!same) {
            arr[col] = value;
            out.changed = true;
            /* 老师手改过的格子会被改回任务给的分：这是对的（任务是权威来源），
               但要让老师知道，别让他以为「我填的分自己跳回去了」。
               进行中的格子本来就在变，不写日志（一节 45 人能把日志刷爆）。 */
            if (old != null && value != null && opts.log && task.status !== 'open') {
              out.logs.push(cls.name + ' · 第' + lesson.seq + '次课 · ' + m.name + '「' + names[col] + '」' +
                num1(old) + ' → ' + num1(value) + '（按刷题准确率改回，不可手改）');
            }
          }

          var metaKey = g.no + '|' + mk + '|' + col;
          if (lesson.peerMeta[metaKey] !== 'quiz') { lesson.peerMeta[metaKey] = 'quiz'; out.changed = true; }
        });
      });
    });

    /* ── 收尾：本地记着、这一轮却「没有这个任务」的列，全部删掉 ──
       两种来源：任务被老师删了（deleted=true）、或者任务已经不存在了（彻底清掉）。
       列名找不到（老师改过名）时 dropTaskColumn 只忘掉记录、不删列，绝不误伤别的列。 */
    (state.lessons || []).forEach(function (lesson) {
      if (!lesson || !lesson.quizTasks) return;
      Object.keys(lesson.quizTasks).forEach(function (taskId) {
        if (!lesson.quizTasks[taskId]) return;
        if (!liveIds[taskId]) { dropTaskColumn(lesson, taskId, out, 'unlinked'); return; }
        if (deadIds[taskId]) { dropTaskColumn(lesson, taskId, out, 'deleted'); return; }
      });
    });

    return out;
  };

  /* 把 plan 的结果落盘：走 hooks.save()（本机缓存 + 云端 CAS + 冲突检测一条都不绕） */
  Q.apply = function (out) {
    if (!out) return out;
    if (out.changed && hooks && hooks.save) { try { hooks.save(); } catch (e) { } }
    if (out.changed) needsRender = true;
    return out;
  };

  /* ---------------- 拉取 ---------------- */

  Q.syncAll = function () {
    /* 启动时调一次：异常绝不能冒到 app.js 的启动流程里 */
    try { return Q.maybeSync(null, true); } catch (e) { return Promise.resolve(null); }
  };

  function hasLive(cls) {
    if (!cls || !cls.hxClassId) return false;
    return cache.some(function (t) {
      return t && t.status === 'open' && !t.deleted && Number(t.class_id) === Number(cls.hxClassId);
    });
  }

  /* 自动重画：老师在输入框里打字 / 正开着课次下拉时先不整块重画，下一轮补上（分已经落盘）。 */
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
    if (editableFocused()) return;
    needsRender = false;
    try { hooks.rerender(); } catch (e) { }
  }

  Q.maybeSync = function (cls, force) {
    if (!hooks || !hooks.hasRpc || !hooks.hasRpc()) return Promise.resolve(null);
    var now = Date.now();
    var wait = hasLive(cls) ? LIVE_THROTTLE : THROTTLE;
    if (!force && now - lastAt < wait) { flushRender(); return Promise.resolve(null); }
    if (inflight) return inflight;
    lastAt = now;
    var pClass = cls && cls.hxClassId ? Number(cls.hxClassId) : null;
    var ask;
    try { ask = hooks.rpc('hx_quiz_task_scores', { p_class: pClass }); }
    catch (e) {
      lastError = (e && e.message) || '读不到刷题课堂任务';
      return Promise.resolve(null);
    }
    inflight = Promise.resolve(ask).then(function (list) {
      lastError = '';
      cache = Array.isArray(list) ? list : [];
      try {
        var st = hooks.getState();
        var res = Q.plan(st, cache, { log: true });
        Q.apply(res);
        if (res.created.length) {
          hooks.log('刷题任务入账', res.created.map(function (x) {
            return '自动建了第 ' + x.seq + ' 次课（' + [x.date, x.topic].filter(Boolean).join(' · ') + '），刷题准确率记进去了';
          }).join('；'));
        }
        if (res.added.length) {
          hooks.log('刷题任务入账', res.added.map(function (x) {
            return '第 ' + x.lessonSeq + ' 次课新增项目列「' + x.name + '」（准确率 × 5，学生不可手改）';
          }).join('；'));
        }
        if (res.removed.length) {
          hooks.log('删除刷题任务', res.removed.map(function (x) {
            return '任务 #' + x.taskId + ' 已删除，第 ' + x.lessonSeq + ' 次课「' + x.name + '」这一列连同分数一起删掉了（撤销删除后会自动写回来）';
          }).join('；'));
        }
        if (res.logs.length) hooks.log('刷题任务入账', res.logs.join('；'));
        var why = (res.notes || []).map(function (n) { return n.text; });
        (res.unmatched || []).forEach(function (u) {
          why.push('第 ' + u.gno + ' 组「' + u.name + '」认不出是哪位同学（名单里没有这个学号/姓名，刷题成绩记不进来）');
        });
        var whyKey = why.join('｜');
        if (whyKey && whyKey !== lastWhy) { lastWhy = whyKey; hooks.log('刷题任务入账', why.join('；')); }
        else if (!whyKey) lastWhy = '';
        flushRender();
        return res;
      } catch (e2) {
        lastError = '入账出错：' + ((e2 && e2.message) || '未知错误');
        return null;
      }
    }).catch(function (e) {
      lastError = (e && e.message) || '读不到刷题课堂任务';
      return null;
    }).then(function (r) { inflight = null; return r; });
    return inflight;
  };

  /* ---------------- 启动注入 ---------------- */

  /**
   * app.js 启动时调用一次（和 JFDT_WIRE / JFDT_EXAM 共用同一组 hook）：
   *   JFDT_QUIZ.boot({ getState, save, log, flash, rerender, curClass, rpc, hasRpc })
   */
  Q.boot = function (h) { hooks = h || null; };
  Q.tasks = function () { return cache.slice(); };
  Q.error = function () { return lastError; };
  /* 给 UI 用：某节课上是不是已经有这个任务的列 */
  Q.columnOf = function (lesson, taskId) {
    var e = lesson && lesson.quizTasks && lesson.quizTasks[String(taskId)];
    return e && e.applied ? String(e.name || '') : '';
  };

  root.JFDT_QUIZ = Q;
})(typeof window === 'undefined' ? globalThis : window);
