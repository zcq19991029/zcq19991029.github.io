/* 老师端：把「每个学生自己的分数」发布到云端，供学生页只读查看。
 *
 * 为什么要多这一步：分数全在老师浏览器的 state 里算（assessment.js），数据库只存一个整块
 * JSON。学生要看到自己的分，要么把整班数据下发（同学的分也一起泄露），要么在 SQL 里重算
 * （等于把 assessment.js 抄一份到 plpgsql，两份口径早晚会不一样）。所以走第三条：
 *   → 老师这边算好「每人一份」的瘦身快照，写进 jf_student_feed，一行一个学生；
 *   → 学生调 jf_my_scores()，SQL 层只返回他自己那一行，同学的分不下发到任何学生的浏览器。
 *
 * 触发：app.js 每次 save() 调 JFDT_FEED.touch(S, memberTotals)，这里做 4 秒防抖，
 *       只有数字真的变了才发（按 hash 比对），所以课堂上连续改分不会把请求打爆。
 *       学生页每 4 秒轮询一次，因此「老师一存，学生几秒后看到」。
 *
 * 一份快照里放什么（四个模块全靠它，学生页不再做任何分数计算）：
 *   上课记分   每课：小组分、首答、全组扣分、我的个人扣分、净得分（值日缺勤的扣分已并入个人扣分）
 *   组内个人评分 每课：每个命名项目我的得分（没录是 null）、组内累计排名
 *   本学期总分  项目/考勤完成率、平时分、折合、期末需考、实际期末、综合、班级名次
 *   成绩登分册  每课完成率％ + 学号/姓名/班级 + 平时/考勤/考试/总评（就自己那一行）
 *
 * 这个文件不碰界面、不改 state，只读。
 */
(function (global) {
  'use strict';

  var DEBOUNCE = 4000;       // 老师连续改分时的合并窗口
  var lastHash = Object.create(null);   // classId -> 上次发布内容的 hash
  var timer = null;
  var busy = false;
  var queued = null;         // 发送中被叫醒：留最后一次要发的

  function hashOf(text) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(16) + ':' + text.length;
  }

  function round(n) { return Math.round((Number(n) + Number.EPSILON) * 10) / 10; }
  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); }

  /** 一个学生在一节课里的全部数字。没有记分记录的课也保留（seq/date 要显示），用 recorded 标记 */
  function lessonRow(A, l, m) {
    var sc = (l.scores || {})[String(m.gno)] || {};
    var base = Math.min(5, clampNum(sc.group, 0, 5) + (sc.first ? 1 : 0));
    var phone = Number(sc.phone) || 0;
    var mineLoss = Number((sc.personal || {})[String(m.memberIndex)]) || 0;
    var net = Math.max(0, base - phone - mineLoss);

    var rec = (l.leaderScores || {})[String(m.gno)] || {};
    var mine = (rec.members || {})[m.key];
    var max = 5, earned = 0;
    var projects = [];
    A.projectNames(l).forEach(function (name, i) {
      if (!String(name || '').trim()) return;
      max += 5;
      var v = mine ? mine[i] : null;
      var score = (v === null || v === undefined) ? null : clampNum(v, 0, 5);
      if (score !== null) earned += score;
      projects.push({ n: name, s: score });
    });

    var recorded = !!(Object.keys(l.scores || {}).length || Object.keys(l.leaderScores || {}).length);
    return {
      seq: Number(l.seq) || 0,
      date: l.date || '',
      gno: Number(m.gno) || 0,
      group: round(base),
      phone: round(phone),
      personal: round(mineLoss),
      net: round(net),
      projects: projects,
      earned: round(earned),
      max: max,
      pct: recorded ? round(Math.max(0, Math.min(100, (net + earned) / max * 100))) : null,
      recorded: recorded
    };
  }

  /** 一个学生的完整快照（不含 at，便于比 hash） */
  function payloadOf(cls, lessons, m, ranked) {
    var A = global.JFDT_ASSESSMENT;
    var mates = ranked.filter(function (x) { return x.gno === m.gno; });
    var gRank = 1 + mates.filter(function (x) { return x.total > m.total; }).length;
    var cfg = A.settings ? A.settings(cls) : { passScore: 60 };

    /* 2026-11-10（用户拍板 B 方案）：学生端开放「本组组员名单 + 各自项目分」，但看不到别组。
       mates 已经是 filter(x.gno === m.gno) 的结果，天然只含本组；每个组员只带姓名、学号、
       个人项目累计、平时分四项，不下发别组的任何数据，也不带考勤/期末等更敏感字段。 */
    var groupMembers = mates.map(function (x) {
      return {
        name: x.name,
        sid: x.sid || '',
        no: x.no == null ? '' : String(x.no),
        project: round(x.project),
        regular: round(x.regular)
      };
    });

    return {
      v: 1,
      cls: { name: cls.name },
      me: {
        name: m.name,
        sid: m.sid || '',
        no: m.no == null ? '' : String(m.no),
        gno: Number(m.gno) || 0,
        gname: m.gno ? '第 ' + m.gno + ' 组' : '待分配'
      },
      passScore: Number(cfg.passScore) || 60,
      lessons: lessons.map(function (l) { return lessonRow(A, l, m); }),
      total: {
        total: round(m.total),
        groupScore: round(m.groupScore),
        project: round(m.project),
        personal: round(m.personal),
        regular: round(m.regular),
        contribution: round(m.contribution),
        needed: m.needed == null ? null : round(m.needed),
        exam: m.exam === '' || m.exam == null ? null : round(m.exam),
        final: m.final == null ? null : round(m.final),
        rank: m.rank,
        count: ranked.length,
        att: round(m.attendance),
        attMax: m.attendanceMaximum,
        attRate: round(m.attendanceRate * 100),
        taskEarned: round(m.task.earned),
        taskMax: m.task.maximum,
        taskRate: round(m.task.rate * 100),
        pending: m.task.pending,
        late: m.lateCount,
        early: m.earlyCount,
        truant: m.truantCount,
        converted: m.convertedTruants,
        effective: m.effectiveTruants,
        failed: !!m.attendanceFailed,
        ready: !!m.ready,
        recorded: m.recorded,
        lessonCount: lessons.length
      },
      group: { size: mates.length, rank: gRank, members: groupMembers }
    };
  }

  /** 整班：返回 [{ key, payload }]，key 优先学号，没学号按姓名 */
  function build(S, cls, memberTotals) {
    var A = global.JFDT_ASSESSMENT;
    if (!A || !cls || !Array.isArray(cls.groups)) return null;
    var lessons = (S.lessons || []).filter(function (l) { return l.classId === cls.id; })
      .slice().sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
    var ranked = A.rows(cls, lessons, memberTotals(cls));
    var out = [];
    ranked.forEach(function (m) {
      if (!m.name) return;
      var key = m.sid ? 'sid:' + String(m.sid).trim() : 'name:' + m.name;
      out.push({ key: key, payload: payloadOf(cls, lessons, m, ranked) });
    });
    return out;
  }

  function send(list) {
    var C = global.JFDT_CLOUD;
    if (!C || typeof C.rpc !== 'function') return Promise.resolve();
    return list.reduce(function (p, item) {
      return p.then(function () {
        return C.rpc('jf_feed_publish', { p_class: item.classId, p_rows: item.rows });
      });
    }, Promise.resolve());
  }

  function flush(S, memberTotals) {
    if (busy) { queued = [S, memberTotals]; return; }
    var list = [];
    (S.classes || []).forEach(function (cls) {
      if (!cls.hxClassId) return;             // 没绑首页班级的班，学生根本找不到，不发布
      var rows;
      try { rows = build(S, cls, memberTotals); } catch (e) { return; }
      if (!rows || !rows.length) return;
      var hash = hashOf(JSON.stringify(rows));
      if (hash === lastHash[cls.id]) return;
      var at = new Date().toISOString();
      rows.forEach(function (r) { r.payload.at = at; });
      list.push({ classId: Number(cls.hxClassId), rows: rows, hash: hash, localId: cls.id });
    });
    if (!list.length) return;

    busy = true;
    send(list).then(function () {
      list.forEach(function (x) { lastHash[x.localId] = x.hash; });
    }).catch(function () {
      /* 发布失败就烂在本地，下一轮 save 会重试。不要弹窗打断上课。 */
    }).then(function () {
      busy = false;
      if (queued) { var q = queued; queued = null; flush(q[0], q[1]); }
    });
  }

  /** app.js 每次 save() 调一次：4 秒内的连续改动合并成一次发布 */
  function touch(S, memberTotals) {
    if (!S || typeof memberTotals !== 'function') return;
    var C = global.JFDT_CLOUD;
    if (!C || typeof C.rpc !== 'function') return;
    clearTimeout(timer);
    timer = setTimeout(function () { flush(S, memberTotals); }, DEBOUNCE);
  }

  /** 退出登录 / 切账号时清掉，免得把上一个班的 hash 当自己的 */
  function reset() { lastHash = Object.create(null); clearTimeout(timer); }

  global.JFDT_FEED = { touch: touch, reset: reset, build: build, payloadOf: payloadOf, lessonRow: lessonRow, FLUSH_MS: DEBOUNCE };
})(typeof window === 'undefined' ? globalThis : window);
