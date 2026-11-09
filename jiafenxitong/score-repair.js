/* ============================================================================
   把「认不到人」的历史分接回本人　2026-11-09
   ----------------------------------------------------------------------------
   用户报的现象：「历史加分都没了呀 虽然分组变了 但是加在每个人身上的小组加分怎么会丢失呢
                  项目记录也没了」

   真实原因（线上数据实测，26工器1 班）：**分数一条都没删**。
   组长打分的存法是  lesson.leaderScores[组号].members[成员键] = [列0分, 列1分, …]，
   成员键是 `sid:学号` / `id:成员ID`。换组时组号会变（人从第 5 组换到第 2 组），
   记录还挂在第 5 组名下，而取分（projectScore / taskEvidence）是按「人现在所在的组号」
   去查的 —— 于是 289 格分变成孤儿：还在库里，但谁也读不到，界面上就是 0。

   这个模块只做一件事：**如果这条记录的学号/成员ID能找到本班某个人，就把这条记录搬到
   那个人现在的组号下面去**。找不到人（退学、转班、名单里已删）就原样留着并计入 stranded，
   绝不删。

   三条铁律：
   1) 只搬，不删；搬不动的留在原处。
   2) 同一个人同一项目两边都有值时**逐列取较大值**（同一个人两段历史，取高的不亏），
      不是覆盖也不是相加。
   3) 幂等：连跑十次结果一样，第二次起 moved/merged 都是 0。
   ========================================================================== */
(function (root) {
  'use strict';

  var R = {};

  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }
  function num(v) { return v == null || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null); }

  /* 本班现在「谁在哪一组」：学号 / 成员 ID 两条路都能认人 */
  function indexOfClass(cls) {
    var bySid = Object.create(null), byId = Object.create(null), byGno = Object.create(null);
    (cls.groups || []).forEach(function (g) {
      if (!g || !g.no) return;
      byGno[String(g.no)] = g;
      (g.members || []).forEach(function (m) {
        if (!m || !m.name) return;
        if (m.sid) bySid[String(m.sid)] = { gno: g.no, key: memberKey(m) };
        if (m.id != null) byId[String(m.id)] = { gno: g.no, key: memberKey(m) };
      });
    });
    return { bySid: bySid, byId: byId, byGno: byGno };
  }

  /* 这条记录的主人现在在哪：先按学号，再按成员 ID；都没有就是 null */
  function resolveKey(key, idx) {
    if (!key) return null;
    if (key.indexOf('sid:') === 0) return idx.bySid[key.slice(4)] || null;
    if (key.indexOf('id:') === 0) return idx.byId[key.slice(3)] || null;
    return null;
  }

  /* 逐列取较大值：null 不压别人，两边都有值取高的 */
  function mergeCells(a, b) {
    var len = Math.max(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0), out = [];
    for (var i = 0; i < len; i++) {
      var x = Array.isArray(a) ? num(a[i]) : null;
      var y = Array.isArray(b) ? num(b[i]) : null;
      out[i] = (x == null) ? (y == null ? null : y) : (y == null ? x : Math.max(x, y));
    }
    return out;
  }

  /**
   * 修一个班。就地改 state，返回计数。
   * @param {object} state 小组加分整份数据
   * @param {object} cls   要修的班（必须是 state.classes 里的那个对象）
   */
  R.repairClass = function (state, cls) {
    var out = { moved: 0, merged: 0, stranded: 0, lessons: 0 };
    if (!state || !cls || !Array.isArray(state.lessons)) return out;
    var idx = indexOfClass(cls);

    state.lessons.forEach(function (l) {
      if (!l || l.classId !== cls.id || !l.leaderScores) return;
      var names = Array.isArray(l.leaderProjectNames) ? l.leaderProjectNames
        : (root.JFDT_ASSESSMENT && root.JFDT_ASSESSMENT.projectNames ? root.JFDT_ASSESSMENT.projectNames(l) : []);
      var touched = false;

      Object.keys(l.leaderScores).forEach(function (gno) {
        var rec = l.leaderScores[gno];
        if (!rec || !rec.members) return;
        var here = idx.byGno[String(gno)];
        var pending = [];

        Object.keys(rec.members).forEach(function (key) {
          /* 已经对得上本人（就在这个组）→ 不动 */
          var ok = here && (here.members || []).some(function (m) { return m && m.name && memberKey(m) === key; });
          if (ok) return;
          var hit = resolveKey(key, idx);
          if (!hit) { out.stranded++; return; }          // 找不到人：原样留着，绝不删
          if (String(hit.gno) === String(gno) && hit.key === key) return;
          pending.push({ key: key, hit: hit, values: rec.members[key] });
        });

        pending.forEach(function (x) {
          var dst = l.leaderScores[String(x.hit.gno)];
          if (!dst) {
            dst = l.leaderScores[String(x.hit.gno)] = {
              projects: (names || []).slice(), members: {}, signedBy: '', note: ''
            };
          }
          if (!dst.members) dst.members = {};
          var before = dst.members[x.hit.key];
          if (!Array.isArray(before) || !before.some(function (v) { return num(v) != null; })) {
            dst.members[x.hit.key] = x.values;
            out.moved++;
          } else {
            dst.members[x.hit.key] = mergeCells(before, x.values);
            out.merged++;
          }
          delete rec.members[x.key];
          touched = true;
          /* 「互评 / 平均 / 师 / 接」角标的键是「组号|成员键|列号」，跟着人一起搬，否则会错位 */
          if (l.peerMeta) {
            Object.keys(l.peerMeta).forEach(function (mk) {
              var p = mk.split('|');
              if (p.length !== 3 || p[0] !== String(gno) || p[1] !== x.key) return;
              l.peerMeta[String(x.hit.gno) + '|' + x.hit.key + '|' + p[2]] = l.peerMeta[mk];
              delete l.peerMeta[mk];
            });
          }
        });

        if (rec.projects && names && rec.projects.length !== names.length) rec.projects = names.slice();
      });

      if (touched) out.lessons++;
    });
    return out;
  };

  /** 全部班都修一遍。返回合计（含按班明细，方便日志写清楚） */
  R.repairAll = function (state) {
    var all = { moved: 0, merged: 0, stranded: 0, lessons: 0, byClass: [] };
    if (!state || !Array.isArray(state.classes)) return all;
    state.classes.forEach(function (cls) {
      var r = R.repairClass(state, cls);
      if (!r.moved && !r.merged && !r.stranded) return;
      all.moved += r.moved; all.merged += r.merged;
      all.stranded += r.stranded; all.lessons += r.lessons;
      all.byClass.push({ name: cls.name || cls.id, moved: r.moved, merged: r.merged, stranded: r.stranded });
    });
    return all;
  };

  /** 只数不改：给「检测到 N 条认不到人的历史分」这种提示用 */
  R.countOrphans = function (state, cls) {
    if (!state || !cls) return 0;
    var idx = indexOfClass(cls), n = 0;
    (state.lessons || []).forEach(function (l) {
      if (!l || l.classId !== cls.id || !l.leaderScores) return;
      Object.keys(l.leaderScores).forEach(function (gno) {
        var rec = l.leaderScores[gno];
        if (!rec || !rec.members) return;
        var here = idx.byGno[String(gno)];
        Object.keys(rec.members).forEach(function (key) {
          var ok = here && (here.members || []).some(function (m) { return m && m.name && memberKey(m) === key; });
          if (!ok) n++;
        });
      });
    });
    return n;
  };

  root.JFDT_SCORE_REPAIR = R;
})(typeof window === 'undefined' ? globalThis : window);
