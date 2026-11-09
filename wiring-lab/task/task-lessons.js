/* ============================================================================
   课堂任务 · 本班已有课次（2026-11-09）
   ----------------------------------------------------------------------------
   用户原话：「课堂任务那个可以选择第几节课 并实时计算同步」

   发布表单原来只有一个裸数字课次框，老师得自己记住「第几次课是哪天、什么主题」，
   填错就把分数记到别的课上。这里把「小组加分」里**本班已有的课次**读出来给他选。

   数据从哪来：「小组加分」和课堂任务在同一个源下（zcq19991029.github.io），
   localStorage 共享，键 jfdt.v1（见 小组加分/app.js 的 LS_KEY）。形状：
     { classes: [{ id, name, hxClassId, groups: […] }],
       lessons: [{ id, classId, seq, date, topic, leaderProjectNames: […] }] }
   对应关系：cls.hxClassId ↔ hx_classes.id（课堂任务那边 ST.classes[].id）。

   为什么写成纯函数：除了 read() 这个故意的薄封装，本文件不碰 localStorage，
   store 由调用方传进来，node:vm 里能直接单测（见 test/test-task-lessons.mjs）。
   ========================================================================== */
(function (root) {
  'use strict';

  var KEY = 'jfdt.v1';

  /* 数字对齐：数据库给的是 bigint，前端存进去可能是字符串 —— '7' 和 7 都要认。
     空串 / null / 非数字一律给 null（交给调用方跳过，不抛错）。 */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function text(v) { return v == null ? '' : String(v).trim(); }

  /* 「接线2.3」是课堂任务写的列；「2.3 双重互锁」这种老师手写的普通列不算，
     否则会把「这一课已经有接线列了」误报给老师。 */
  var WIRE_COL = /^接线/;

  function wireColsOf(lesson) {
    var names = lesson && lesson.leaderProjectNames;
    if (!Array.isArray(names)) return [];
    var out = [];
    names.forEach(function (n) {
      var s = text(n);
      if (s && WIRE_COL.test(s) && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /* 一节课 → 下拉要用的一行。seq 不合法（缺、0、负数、小数）就返回 null = 跳过。 */
  function one(lesson) {
    var seq = num(lesson.seq);
    if (seq === null || seq <= 0 || Math.floor(seq) !== seq) return null;
    return {
      id: text(lesson.id),
      seq: seq,
      date: text(lesson.date).slice(0, 10),   // 老数据可能带时间，只要日期
      topic: text(lesson.topic),
      wireCols: wireColsOf(lesson)
    };
  }

  /**
   * 本班已有课次，按 seq 升序。
   * 任何脏数据（store 为空、classes 不是数组、lesson 缺 seq、classId 类型不一致…）
   * 都跳过，绝不抛错 —— 这是发布表单要用的，崩了老师就发不出任务。
   */
  function list(store, hxClassId) {
    try {
      if (!store || !Array.isArray(store.classes) || !Array.isArray(store.lessons)) return [];
      var want = num(hxClassId);
      if (want === null) return [];

      var cls = null;
      for (var i = 0; i < store.classes.length; i++) {
        var c = store.classes[i];
        if (c && num(c.hxClassId) === want) { cls = c; break; }
      }
      if (!cls) return [];

      var rows = [], clsId = text(cls.id);
      store.lessons.forEach(function (l) {
        if (!l || text(l.classId) !== clsId) return;
        var x = one(l);
        if (x) rows.push(x);
      });

      rows.sort(function (a, b) { return a.seq - b.seq; });
      /* 同一个 seq 有两条（历史脏数据）：后出现的为准 —— 和入账那边
         wire-task-link.js 的 lessonFor()「同 seq 取最后一个」保持同一个口径。 */
      var out = [];
      rows.forEach(function (x) {
        var prev = out[out.length - 1];
        if (prev && prev.seq === x.seq) out[out.length - 1] = x;
        else out.push(x);
      });
      return out;
    } catch (e) { return []; }
  }

  /** 读「小组加分」的本机数据。读不到（没打开过 / 被清 / 隐私模式 / 坏 JSON）返回 null。 */
  function read(storage) {
    var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s || typeof s.getItem !== 'function') return null;
    try {
      var raw = s.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }

  root.HX_LESSONS = { KEY: KEY, read: read, list: list, wireColsOf: wireColsOf };
})(typeof window === 'undefined' ? globalThis : window);
