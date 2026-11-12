/* ============================================================================
   组内互评 → 直接计分　2026-11-10
   ----------------------------------------------------------------------------
   用户原话：「取消教师确认环节 反正教师可以关闭开放加分按钮再去修改更方便」

   以前：学生在 scores.js 打分 → jf_peer_submit 写云端 → 老师在评分表里逐列点「确认」，
   jf_peer_confirm 才把这列算成成绩。现在：**学生提交就直接计分**，老师要改分只走两条老路——
   ① 直接点格子手改（「师」角标那套）；② 关掉「组长打分」开关再慢慢改。

   ── 这个文件干什么 ──
   把 jf_peer_board 返回的「原始提交」（board.cells）归成「落哪一格、落多少分」，
   再写进本机 lesson.leaderScores —— 那才是成绩的口径（总分 / 排名 / 登分册 / 打印 /
   学生快照全读它，云端只是提交通道）。

   ── 两条规矩（改之前先读）──
   ① **组员给组长的分取平均**，至少 2 个人打过才算（2026-11-09 用户要求「组长必须最低两个人打分」），
      打几次除几次（不除组员总数）；而且 target 必须等于当前这一组的组长 ——
      组长换人以后，旧组长名下的「平均」行不能再落到被降级的人头上。
   ② **时间戳护栏**：lesson.peerSync[组号|成员|列] 记住已经落过的最新 at。
      比它旧的提交一律跳过，这样「旧提交冲掉新分」「自动刷新冲掉老师手改」都不会发生。

   纯函数、不碰 DOM、不碰 localStorage，能被 node:vm 单测（tools/test-peer-apply.mjs）。
   ========================================================================== */
(function (root) {
  'use strict';

  var W = {};

  /* 线上排位列（2026-11-11 修互评刷分漏洞）：列名带「接线 / 线上连线排位」前缀的列是
     课堂任务（wire-task-link.js）自动入账的成绩，只有学生真实完成线上排位才能得分。
     互评提交（jf_peer_scores 的 board.cells）里出现这一列的分数一律**丢弃** ——
     前端按钮不渲染只是第一道锁；这里是兜底：旧缓存页 / 控制台直接调 jf_peer_submit
     刷上来的分，到不了 leaderScores（成绩的唯一口径）。
     ⚠ 前缀口径与 app.js 的 taskScore()、wire-task-link.js 的 NAME_PREFIX 保持一致，
       三处必须一起改，否则老数据的旧列名「接线2.3」会漏判。 */
  var TASK_COL = /^(?:接线|线上连线排位)/;
  function isTaskCol(name) { return TASK_COL.test(String(name == null ? '' : name).trim()); }

  /* 逐列「仅教师可评」（2026-11-12 用户规则：收拾板子 / 归位工具的分只能老师给）。
     老师锁列的名单随 payload 一起发下去（payload.teacherOnly 是**列名**数组）。
     这里是最后一道锁：就算旧缓存页 / 控制台直接调 jf_peer_submit 给这一列刷了分，
     到不了 leaderScores（成绩的唯一口径）。前端不渲染按钮只是第一道。 */
  function teacherList(board) {
    var out = [];
    try {
      var l = board && board.payload && board.payload.teacherOnly;
      if (!Array.isArray(l)) return out;
      l.forEach(function (n) { var s = clean(n); if (s && out.indexOf(s) < 0) out.push(s); });
    } catch (e) { return []; }
    return out;
  }
  function isTeacherOnly(name, list) {
    var n = clean(name);
    return !!n && Array.isArray(list) && list.indexOf(n) >= 0;
  }

  /* 分数夹到 0–5，保留 1 位小数（平均分要 4.5 这种，不能取整） */
  function clamp5(v) {
    var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10;
    return Math.max(0, Math.min(5, n));
  }
  function atOf(v) { return v == null ? '' : String(v); }
  /* 时间比较：数据库给的是 "…+00:00"（带微秒），老师手改写的是 "…Z"（带毫秒），
     直接比字符串在「同一秒」上会打架，所以能解析就比毫秒数，解析不了才退回比字符串。 */
  function timeOf(v) {
    var s = atOf(v);
    if (!s) return NaN;
    var t = Date.parse(s);
    return isFinite(t) ? t : NaN;
  }
  function isNewer(a, b) {
    var ta = timeOf(a), tb = timeOf(b);
    if (isFinite(ta) && isFinite(tb)) return ta >= tb;
    return atOf(a) >= atOf(b);
  }
  function isOlderOrSame(a, b) {
    var ta = timeOf(a), tb = timeOf(b);
    if (isFinite(ta) && isFinite(tb)) return ta <= tb;
    return atOf(a) <= atOf(b);
  }
  /* 组号 / 成员键 / 项目名都必须是实打实的东西，缺一个就跳过 */
  function clean(v) { return v == null ? '' : String(v).trim(); }
  /* 分数字段：null / 空串不算 0，算「没填」——Number(null) 是 0，不挡就会凭空写 0 分 */
  function scoreOf(v) {
    if (v == null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* 已发布的分组里「当前每组组长」：{ 组号: 成员键 } */
  function leaderMap(board) {
    var map = Object.create(null);
    try {
      var groups = board && board.payload && board.payload.groups;
      if (!Array.isArray(groups)) return map;
      groups.forEach(function (g) {
        if (!g) return;
        var no = Number(g.no);
        var lead = clean(g.leader);
        if (!no || !lead) return;
        map[String(no)] = lead;
      });
    } catch (e) { return Object.create(null); }
    return map;
  }

  /**
   * board.cells → [{gno, target, project, score, kind, at}]
   *   role='leader' → 组长给组员的原始分（kind='leader'）
   *   role='member' → 组员给组长的分，同一格取平均、1 位小数（kind='avg'）
   * 脏数据一律跳过，绝不抛错。
   */
  W.rows = function (board) {
    var out = [];
    try {
      var cells = board && board.cells;
      if (!Array.isArray(cells)) return out;
      var leads = leaderMap(board);
      var tOnly = teacherList(board);
      var leaderPick = Object.create(null);   // 组号|成员|项目 → 最新组长原始分
      var memberAcc = Object.create(null);    // 组号|成员|项目 → 累加求平均

      cells.forEach(function (c) {
        if (!c) return;
        var gno = Number(c.gno);
        var project = clean(c.project);
        var target = clean(c.target);
        if (!gno || !project || !target) return;
        /* 排位列的互评分：丢弃并 console.warn（界面早就不渲染按钮，这里防的是
           旧缓存页 / 控制台直调 jf_peer_submit 的脏数据） */
        if (isTaskCol(project)) {
          try { console.warn('[peer-apply] 丢弃线上排位列「' + project + '」的互评分：这一列只有真实完成排位才能得分'); } catch (e0) {}
          return;
        }
        /* 仅教师列（收拾板子 / 归位工具）：老师锁成只有自己能给分，学生提交一律丢弃 */
        if (isTeacherOnly(project, tOnly)) {
          try { console.warn('[peer-apply] 丢弃仅教师列「' + project + '」的互评分：这一列只有老师能给分'); } catch (e0) {}
          return;
        }
        var score = scoreOf(c.score);
        if (score == null) return;
        var at = atOf(c.at);
        var key = gno + '|' + target + '|' + project;

        if (c.role === 'leader') {
          /* 组长换过人时，同一格可能留着旧组长和新组长两条原始分：只认最新的那条 */
          var cur = leaderPick[key];
          if (!cur || isNewer(at, cur.at)) leaderPick[key] = { at: at, score: score, gno: gno, target: target, project: project };
        } else if (c.role === 'member') {
          /* 组长换人：旧组长名下的「平均」行直接丢掉（被降级的人不该再收到组员给他的分） */
          if (leads[String(gno)] !== target) return;
          var acc = memberAcc[key];
          if (!acc) acc = memberAcc[key] = { sum: 0, n: 0, at: '', gno: gno, target: target, project: project };
          acc.sum += score;
          acc.n++;
          if (isNewer(at, acc.at)) acc.at = at;
        }
      });

      Object.keys(leaderPick).forEach(function (k) {
        var x = leaderPick[k];
        out.push({ gno: x.gno, target: x.target, project: x.project, score: clamp5(x.score), kind: 'leader', at: x.at });
      });
      Object.keys(memberAcc).forEach(function (k) {
        var a = memberAcc[k];
        /* 组长分：**至少 2 个人打分才算**（2026-11-09 用户要求）。
           只有 1 个人打就取平均，等于一个人说了算，容易被打招呼/赌气分左右；
           凑够 2 人再平均，才叫「组员评价」。
           不够 2 人时也发一条 clear 行：万一先前已经凑够 2 人落了格、后来又撤掉一个，
           那一格必须跟着撤回，不能留个旧平均分在成绩里。 */
        if (a.n < 2) {
          out.push({ gno: a.gno, target: a.target, project: a.project, score: null, kind: 'avg', at: a.at, count: a.n, clear: true });
          return;
        }
        out.push({ gno: a.gno, target: a.target, project: a.project, score: clamp5(a.sum / a.n), kind: 'avg', at: a.at, count: a.n });
      });
    } catch (e) {
      return [];
    }
    return out;
  };

  /**
   * 把 rows 写进本机 lesson，返回改动格数。
   * @param {object}   lesson  本节课（就地改 leaderScores / peerMeta / peerSync）
   * @param {array}    list    W.rows() 的结果
   * @param {function} colOf   project → 列号，返回 -1 表示这一列在本课不存在
   */
  W.applyInto = function (lesson, list, colOf) {
    var n = 0;
    try {
      if (!lesson || typeof lesson !== 'object') return 0;
      if (!Array.isArray(list) || typeof colOf !== 'function') return 0;
      if (!lesson.leaderScores || typeof lesson.leaderScores !== 'object') lesson.leaderScores = {};
      if (!lesson.peerMeta || typeof lesson.peerMeta !== 'object') lesson.peerMeta = {};
      if (!lesson.peerSync || typeof lesson.peerSync !== 'object') lesson.peerSync = {};
      var sharedNames = Array.isArray(lesson.leaderProjectNames) ? lesson.leaderProjectNames.slice() : null;

      list.forEach(function (r) {
        try {
          if (!r) return;
          var gno = Number(r.gno);
          var target = clean(r.target);
          var project = clean(r.project);
          if (!gno || !target || !project) return;
          /* 排位列兜底的第二层：rows() 已丢弃，这里挡的是绕过 rows 直接调 applyInto 的调用方 */
          if (isTaskCol(project)) {
            try { console.warn('[peer-apply] applyInto 拒绝写入线上排位列「' + project + '」的互评分'); } catch (e0) {}
            return;
          }
          var col = Number(colOf(project));
          if (!isFinite(col) || col < 0) return;

          var key = gno + '|' + target + '|' + col;
          var at = atOf(r.at);
          var prev = lesson.peerSync[key];
          if (prev != null && String(prev) !== '') {
            /* 不知道新旧（没有 at）就别动：宁可少写一格，也不能冲掉老师手改 */
            if (!at) return;
            if (isOlderOrSame(at, prev)) return;
          }

          /* 撤销行：组员撤分后不够 2 人 → 把先前算出来的平均分收回去。
             只撤「互评算出来的」那一格（peerMeta === 'avg'），老师手改过的（'teacher'）绝不动。 */
          if (r.clear) {
            var rec0 = lesson.leaderScores[String(gno)];
            var vals0 = rec0 && rec0.members && rec0.members[target];
            if (!Array.isArray(vals0) || vals0[col] == null || vals0[col] === '' || lesson.peerMeta[key] !== 'avg') {
              lesson.peerSync[key] = at;
              return;
            }
            vals0[col] = null;
            delete lesson.peerMeta[key];
            lesson.peerSync[key] = at;
            n++;
            return;
          }

          var score = scoreOf(r.score);
          if (score == null) return;

          var rec = lesson.leaderScores[String(gno)];
          if (!rec || typeof rec !== 'object') {
            rec = lesson.leaderScores[String(gno)] = {
              projects: sharedNames ? sharedNames.slice() : [],
              members: {}, signedBy: '', note: ''
            };
          }
          if (!Array.isArray(rec.projects)) rec.projects = sharedNames ? sharedNames.slice() : [];
          if (!rec.members || typeof rec.members !== 'object') rec.members = {};
          if (!Array.isArray(rec.members[target])) rec.members[target] = [];
          var values = rec.members[target];

          var next = clamp5(score);
          var old = values[col];
          var sameValue = old != null && old !== '' && Number(old) === next;
          var kind = r.kind === 'avg' ? 'avg' : 'leader';

          values[col] = next;
          var changed = !sameValue || lesson.peerMeta[key] !== kind || String(prev == null ? '' : prev) !== at;
          lesson.peerMeta[key] = kind;
          lesson.peerSync[key] = at;
          if (changed) n++;
        } catch (eCell) { /* 单条脏数据不影响其它格 */ }
      });
    } catch (e) { return n; }
    return n;
  };

  root.JFDT_PEER_APPLY = W;
})(typeof window === 'undefined' ? globalThis : window);
