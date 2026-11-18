/* ============================================================================
   电子试卷 → 「小组加分」自动入账　2026-11-17
   ----------------------------------------------------------------------------
   用户原话：
     「得分除总分就是完成率 放到小组加分项目列 自动给完成率 不可人为更改 和接线课堂任务一样」
     「那如果我删除了一个大题 那总分也会变 完成率也会变」

   ── 怎么进分的（一句话）──
   老师在「记分」页点「电子试卷…」把一场考试记到某节课 → 服务端记下「哪场试 → 哪个班 → 哪节课」
   （public.hx_exam_link）→ 本文件每个学生算一格：得分 ÷ 满分 × 5，写成这一节的一个
   **5 分项目列**（列名「电子考试 <试卷标题>」）。走的是原本就有的「命名个人项目」机制：
   assessment.js 的 taskEvidence() 会给每个有名字、且已有分的项目列加 5 分满分并把得分计入
   earned，所以本节完成率自动跟着动，不需要任何二次核算。

   ── 为什么在前端写、不在数据库写 ──
   和 wire-task-link.js 一字不差的理由：全部成绩是 jf_score_states 里的**一个 jsonb blob**，
   前端用 revision 做 CAS。服务端偷改它 → 老师下次打开就是「同步冲突」。所以数据库只提供
   只读函数 hx_exam_links()，写 blob 的事全走前端自己的保存链路（本机缓存/云端/冲突检测都不绕开）。

   ── 四条设计约定（改动前先读）──
   ① **满分每次现算**：hx_exam_links 里的 full 是当场按 paper 算的，不缓存。老师删掉一道大题，
      full 变小，下一次同步（45 秒 / 正在考试 10 秒）这一列的分立刻按新满分算。
   ② **收敛式合并**：每轮都把整列的「目标矩阵」重算一遍再逐格比对，不靠签名跳过。
      换组后学生整条记录搬到新组号下，新进组的人那格是空的 —— 只做一次性写入的话永远是空。
   ③ **老师删掉/改名这一列就不再塞回去**：任务是分数的来源，但不能跟老师抢方向盘，只记一条日志。
   ④ **关联没了 = 整列删掉**：考试被删、老师点「解除」、改记到别的课次，都按「老师手动删列」
      的同一套动作删（列名 + 各组这一格 + 互评标记），不留下 5 分的空列。
      考试删掉时 hx_exam_link 那行**还在**（deleted=true），所以换台电脑也知道该删哪一列；
      本文件删完列后会调 hx_exam_link_del 收尾。

   ── 未发布 / 未批的口径 ──
   · 考试没发布（released=false）：这一列全员写 0 —— 学生看不到自己的分，加分这边也不该留着。
   · 某个学生一题都没批（total=null）：这一格写 null（空格），不是 0；整列都没人批时
     assessment.js 的 countedIndexes() 会把这一列当「还没成为一项任务」，不进分母，不会拉低完成率。
   · 学生根本没交卷：同样 total=null → 空格（不冤枉人，也不白送分）。
   ========================================================================== */
(function (root) {
  'use strict';

  var W = {};
  var hooks = null;          // app.js 启动时注入（和 JFDT_WIRE 同一套 hook）
  var cache = [];            // 最近一次 RPC 拿到的关联数组
  var lastAt = 0;            // 上次拉取时间（节流）
  var inflight = null;       // 正在拉的 promise
  var lastError = '';        // 拉取失败原因（要如实说出来，别装作没关联）
  var lastWhy = '';          // 上一轮「为什么没入账」的指纹（只在变化时记一次日志）
  var THROTTLE = 45000;      // 45 秒内不重复拉
  var LIVE_THROTTLE = 10000; // 有「正在考试」的场次时用短的：分数随时会变
  var NAME_PREFIX = '电子考试';
  var TITLE_MAX = 12;        // 标题超 12 字截断加 …（窄表头放得下）

  /* ---------------- 小工具 ---------------- */

  /* 必须和 app.js 的 memberKey() 一字不差：leaderScores[组号].members 的键就是它 */
  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }
  function score1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
  function num1(v) { var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10; return n % 1 === 0 ? String(n) : n.toFixed(1); }
  function chars(s) { return Array.from(String(s == null ? '' : s)); }
  function clipTitle(t) {
    var s = String(t == null ? '' : t).trim() || '未命名试卷';
    var a = chars(s);
    return a.length > TITLE_MAX ? a.slice(0, TITLE_MAX).join('') + '…' : s;
  }

  /* 列名 = 「电子考试 <试卷标题>」。数据库里存的是确立关联那一刻的名字（老师后来重命名就按老师的走，
     本文件绝不改名 —— 改名会让老师排好的列、已填的分、互评里的同名项全对不上）。 */
  function columnName(link) {
    var db = String(link && link.column_name != null ? link.column_name : '').trim();
    if (db) return db;
    return NAME_PREFIX + ' ' + clipTitle(link && link.title);
  }

  /* 当前这一次「全班共用」的项目列名。projectNames() 返回的是副本（可能是空占位列），
     所以永远拿副本去改、再整体写回 lesson.leaderProjectNames（和 wire-task-link.js 同一段）。 */
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
  /* 删掉某一列（列名 + 每组成员这一格 + 互评标记），后面的列整体左移。
     必须和 leader-scoring.js 的 removeProject 同一套动作，否则列名和分数会错列。 */
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

  /* ---------------- 定位这一列 ---------------- */

  function columnFor(lesson, link, out) {
    var names = currentNames(lesson);
    if (!lesson.examLinks) lesson.examLinks = {};
    var key = String(link.exam_id);
    var entry = lesson.examLinks[key];
    var want = columnName(link);

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
          out.notes.push({ kind: 'dismissed', examId: link.exam_id, text: '「' + entry.name + '」这一列被删掉或改名了，这场电子试卷不再写它（要恢复：到「组内个人评分」里把列名改回去，或先解除关联再重新记入）' });
        }
        return -1;
      }
    }

    /* 表里已经有同名的一列（换了电脑 / 本机记录丢了）→ 认领它，绝不重复建列：
       同一场试多一列 = 项目满分多 5 分，等于给全班送分。 */
    var takenByOther = function (nm) {
      return Object.keys(lesson.examLinks).some(function (k) {
        var e = lesson.examLinks[k];
        return k !== key && e && e.name === nm && !e.dismissed;
      });
    };
    var adopt = names.indexOf(want);
    if (adopt >= 0 && !takenByOther(want)) {
      lesson.examLinks[key] = {
        name: want, col: adopt, applied: true,
        examId: Number(link.exam_id), at: new Date().toISOString()
      };
      out.notes.push({ kind: 'adopt', examId: link.exam_id, text: '这节课已经有「' + want + '」这一列，直接沿用（没有重复建列）' });
      return adopt;
    }

    /* 新加一列，排第一（和接线任务列同一个位置习惯），同名被占了就加 #考试号 */
    var name = want;
    if (names.indexOf(name) >= 0 || takenByOther(name)) name = want + '#' + link.exam_id;
    names.unshift(name);
    shiftColsRight(lesson, names);
    applyNames(lesson, names);
    lesson.examLinks[key] = {
      name: name, col: 0, applied: true,
      examId: Number(link.exam_id), at: new Date().toISOString()
    };
    out.added.push({ examId: link.exam_id, lessonSeq: lesson.seq, name: name });
    return 0;
  }

  /* 删掉某场考试留下的列。只按**列名**删：
     名字找不到时（老师改过名）绝不按旧列号乱删，宁可这一列留给老师。 */
  function dropExamColumn(lesson, examId, out, why) {
    if (!lesson.examLinks || !lesson.examLinks[examId]) return false;
    var entry = lesson.examLinks[examId];
    var names = currentNames(lesson);
    var at = entry.name ? names.indexOf(entry.name) : -1;
    if (at >= 0) {
      var removed = removeColAt(lesson, at);
      out.removed.push({ examId: Number(examId), lessonSeq: lesson.seq, name: removed, why: why });
    }
    delete lesson.examLinks[examId];
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
  function lessonById(state, cls, id) {
    var hit = null;
    (state.lessons || []).forEach(function (l) {
      if (l && l.id === id && l.classId === cls.id) hit = l;
    });
    return hit;
  }

  /* ---------------- 核心：把「得分 ÷ 满分」摊成每一格 ---------------- */

  /**
   * 纯函数、就地改 state（和 wire-task-link.js 的 plan 同构，node 单测直接用）。
   * @param {object} state  小组加分的整份数据
   * @param {array}  links  hx_exam_links() 的返回
   * @returns {{changed:boolean, added:array, removed:array, notes:array, logs:array, unmatched:array, live:array}}
   */
  W.plan = function (state, links, opts) {
    opts = opts || {};
    var out = { changed: false, added: [], removed: [], notes: [], logs: [], unmatched: [], live: [] };
    if (!state || !Array.isArray(state.classes) || !Array.isArray(links)) return out;
    if (!Array.isArray(state.lessons)) state.lessons = [];

    var live = {};       // 这一轮还在的考试号
    var dead = {};       // 考试已被删（关联行还在、deleted=true）
    var lessonOf = {};   // 考试号 → 应该记在哪节课的 id

    links.forEach(function (link) {
      if (!link) return;
      var examId = String(link.exam_id);
      live[examId] = true;
      lessonOf[examId] = String(link.lesson_id || '');

      /* 考试已被删（hx_exam_link 那行还在，deleted=true）→ 整列删掉，这一轮不用再算分。
         删完由 maybeSync 调 hx_exam_link_del 把关联行收掉。 */
      if (link.deleted) { dead[examId] = true; return; }

      var cls = classOf(state, link.class_id);
      if (!cls) {
        out.notes.push({ kind: 'noclass', examId: link.exam_id, text: '「' + (link.title || '电子试卷') + '」：这个班还没和「小组加分」里的班对应上（去名单页点「导入/对应班级」），分数暂时进不来' });
        return;
      }
      var lesson = lessonById(state, cls, link.lesson_id);
      if (!lesson) {
        out.notes.push({ kind: 'nocourse', examId: link.exam_id, text: '「' + (link.title || '电子试卷') + '」：记的那节课已经不在了（课次被删了？），到「电子试卷…」里重新记到本课' });
        return;
      }

      var col = columnFor(lesson, link, out);
      if (col < 0) return;

      var names = lesson.leaderProjectNames;
      if (!lesson.leaderScores) lesson.leaderScores = {};
      if (!lesson.peerMeta) lesson.peerMeta = {};

      /* 学号 → 行；姓名 → 行（只有全班唯一时才算数，避免同名张冠李戴） */
      var byNo = Object.create(null), byName = Object.create(null), nameCount = Object.create(null);
      (link.rows || []).forEach(function (r) {
        if (!r) return;
        if (r.no != null && String(r.no) !== '') byNo[String(r.no)] = r;
        var nm = String(r.name || '').trim();
        if (nm) { byName[nm] = r; nameCount[nm] = (nameCount[nm] || 0) + 1; }
      });

      var released = link.released !== false;
      if (link.exam_open) out.live.push(link);

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

          /* 目标值：未发布 = 0（学生看不到分，这边也不留）；没交/没批 = null（空格）；
             有分 = 得分 ÷ 满分 × 5，一位小数。 */
          var value;
          if (!released) value = 0;
          else if (row && row.rate != null && isFinite(Number(row.rate))) {
            value = score1(Math.max(0, Math.min(1, Number(row.rate))) * 5);
          } else value = null;

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
            /* 老师手改过的格子会被改回试卷算出来的分：这是对的（试卷是权威来源），
               但要让老师知道，别让他以为「我填的分自己跳回去了」。 */
            if (old != null && value != null && opts.log) {
              out.logs.push(cls.name + ' · 第' + lesson.seq + '次课 · ' + m.name + '「' + names[col] + '」' +
                num1(old) + ' → ' + num1(value) + '（按电子试卷得分率改回）');
            }
          }

          var metaKey = g.no + '|' + mk + '|' + col;
          if (value == null) {
            if (lesson.peerMeta[metaKey] !== undefined) { delete lesson.peerMeta[metaKey]; out.changed = true; }
          } else if (lesson.peerMeta[metaKey] !== 'exam') {
            lesson.peerMeta[metaKey] = 'exam';
            out.changed = true;
          }
        });
      });
    });

    /* ── 收尾：本地记着、这一轮却「没有这场试」的列，全部删掉 ──
       三种来源都走这里：老师解除关联、考试被删、改记到别的课次。
       列名找不到（老师改过名）时 dropExamColumn 只忘掉记录、不删列，绝不误伤别的列。 */
    (state.lessons || []).forEach(function (lesson) {
      if (!lesson || !lesson.examLinks) return;
      Object.keys(lesson.examLinks).forEach(function (examId) {
        var entry = lesson.examLinks[examId];
        if (!entry) return;
        if (!live[examId]) { dropExamColumn(lesson, examId, out, 'unlinked'); return; }
        if (dead[examId]) { dropExamColumn(lesson, examId, out, 'deleted'); return; }
        /* 这场试改成记到别的课次了：这一列也要撤，新的一节会重新建一列 */
        if (String(lessonOf[examId] || '') !== String(lesson.id)) dropExamColumn(lesson, examId, out, 'moved');
      });
    });

    return out;
  };

  /* 把 plan 的结果落盘：走 hooks.save()（本机缓存 + 云端 CAS + 冲突检测一条都不绕）。
     和 wire-task-link.js 一样，plan 已经就地改完 state，这里只管保存 / 安排重画。 */
  W.apply = function (out) {
    if (!out) return out;
    if (out.changed && hooks && hooks.save) { try { hooks.save(); } catch (e) { } }
    if (out.changed) needsRender = true;
    return out;
  };

  /* ---------------- 拉取 ---------------- */

  W.syncAll = function () {
    /* 启动时调一次：异常绝不能冒到 app.js 的启动流程里 */
    try { return W.maybeSync(null, true); } catch (e) { return Promise.resolve(null); }
  };

  function hasLive(cls) {
    if (!cls || !cls.hxClassId) return false;
    return cache.some(function (l) {
      return l && !l.deleted && l.exam_open && Number(l.class_id) === Number(cls.hxClassId);
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

  W.maybeSync = function (cls, force) {
    if (!hooks || !hooks.hasRpc || !hooks.hasRpc()) return Promise.resolve(null);
    var now = Date.now();
    var wait = hasLive(cls) ? LIVE_THROTTLE : THROTTLE;
    if (!force && now - lastAt < wait) { flushRender(); return Promise.resolve(null); }
    if (inflight) return inflight;
    lastAt = now;
    var pClass = cls && cls.hxClassId ? Number(cls.hxClassId) : null;
    var ask;
    try { ask = hooks.rpc('hx_exam_links', { p_class: pClass }); }
    catch (e) {
      lastError = (e && e.message) || '读不到电子试卷入账';
      return Promise.resolve(null);
    }
    inflight = Promise.resolve(ask).then(function (list) {
      lastError = '';
      cache = Array.isArray(list) ? list : [];
      try {
        var st = hooks.getState();
        var res = W.plan(st, cache, { log: true });
        W.apply(res);
        if (res.added.length) {
          hooks.log('电子试卷入账', res.added.map(function (x) {
            return '第 ' + x.lessonSeq + ' 次课新增项目列「' + x.name + '」（完成率 = 得分 ÷ 满分）';
          }).join('；'));
        }
        if (res.removed.length) {
          hooks.log('电子试卷入账', res.removed.map(function (x) {
            return '第 ' + x.lessonSeq + ' 次课「' + x.name + '」这一列连同分数一起删掉了（' +
              (x.why === 'moved' ? '改记到别的课次了' : x.why === 'deleted' ? '这场考试已删除' : '已解除关联') + '）';
          }).join('；'));
        }
        if (res.logs.length) hooks.log('电子试卷入账', res.logs.join('；'));
        var why = (res.notes || []).map(function (n) { return n.text; });
        (res.unmatched || []).forEach(function (u) {
          why.push('第 ' + u.gno + ' 组「' + u.name + '」认不出是哪位同学（名单里没有这个学号/姓名）');
        });
        var whyKey = why.join('｜');
        if (whyKey && whyKey !== lastWhy) { lastWhy = whyKey; hooks.log('电子试卷入账', why.join('；')); }
        else if (!whyKey) lastWhy = '';
        flushRender();
        /* 考试被删 / 关联已经不存在了：把 hx_exam_link 那行收掉（否则每轮同步都会再报一次） */
        if (res.removed.length) {
          res.removed.forEach(function (x) {
            if (x.why === 'unlinked') return;      // 关联行本来就已经没了（老师点的解除），不用再删
            var stillLive = cache.some(function (l) { return String(l.exam_id) === String(x.examId) && !l.deleted; });
            if (stillLive) return;
            try { Promise.resolve(hooks.rpc('hx_exam_link_del', { p_exam: Number(x.examId) })).catch(function () { }); }
            catch (e) { }
          });
        }
        return res;
      } catch (e2) {
        lastError = '入账出错：' + ((e2 && e2.message) || '未知错误');
        return null;
      }
    }).catch(function (e) {
      lastError = (e && e.message) || '读不到电子试卷入账';
      return null;
    }).then(function (r) { inflight = null; return r; });
    return inflight;
  };

  /* ---------------- 启动注入 ---------------- */

  /**
   * app.js 启动时调用一次（和 JFDT_WIRE 共用同一组 hook）：
   *   JFDT_EXAM.boot({ getState, save, log, flash, rerender, curClass, rpc, hasRpc })
   */
  W.boot = function (h) { hooks = h || null; };
  W.links = function () { return cache.slice(); };
  W.error = function () { return lastError; };
  /* 给 UI 用：某节课上是不是已经有这场试的列 */
  W.columnOf = function (lesson, examId) {
    var e = lesson && lesson.examLinks && lesson.examLinks[String(examId)];
    return e && e.applied ? String(e.name || '') : '';
  };

  root.JFDT_EXAM = W;
})(typeof window === 'undefined' ? globalThis : window);
