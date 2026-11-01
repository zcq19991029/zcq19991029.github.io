/* 班级名单只有一个来源：首页“班级”。点亮“小组加分”的班自动出现在加分里，名单跟着首页补人、改名。
   从不删除、不覆盖加分里已有的学生、分组、课次和分数：首页删人、取消点亮、删班，加分这边只是不显示或原样保留。
   加分班级用 hxClassId 记住对应的首页班；原有的（2026-10-31 以前自己导入的）班要老师看过对照、确认后才对应。 */
(function (global) {
  'use strict';
  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  /* 首页班级给不给加分用：没勾任何工具 = 都用（和接线仿真、考试一致），勾了就看有没有“小组加分” */
  function lit(hx) { var t = hx.tools || []; return !t.length || t.indexOf('jiafen') >= 0; }
  function byId(state, id) { return (state.classes || []).filter(function (c) { return c.id === id; })[0] || null; }

  /* 空白模板班（新老师的“我的班级”）：没名单、没分组成员、没课次 */
  function blank(state, cls) {
    return !(cls.roster || []).length && !(cls.groups || []).some(function (g) { return (g.members || []).length; }) &&
      !(state.lessons || []).some(function (l) { return l.classId === cls.id; });
  }
  /* 原有的、还没对应到首页的班（等老师确认）；老师选了“保留为旧班”的不算 */
  function pending(state) {
    return (state.classes || []).filter(function (c) { return !c.hxClassId && !c.hxLocal && !blank(state, c); });
  }

  /* 首页班级在加分里对应哪个班：先按 hxClassId，再按同名且关联的首页班已删掉重导的班。
     还没对应过的原有班不在这里自动认，要老师确认（见 link）。 */
  function match(state, hx, hxAll) {
    var classes = state.classes || [], alive = {};
    (hxAll || []).forEach(function (c) { alive[c.id] = true; });
    return classes.filter(function (c) { return c.hxClassId === hx.id; })[0] ||
      classes.filter(function (c) { return c.hxClassId && hxAll && !alive[c.hxClassId] && c.name === hx.name; })[0] || null;
  }

  /* 首页点亮了“小组加分”的班，以及它在加分里对应的班（没有为 null） */
  function list(state, hxAll) {
    return (hxAll || []).filter(lit).map(function (hx) { return { hx: hx, cls: match(state, hx, hxAll) }; });
  }

  function clean(students) {
    return (students || []).map(function (s) {
      return { sid: String(s.student_no || '').trim(), name: String(s.name || '').trim(), seq: +s.seq || 0, left: !!s.left_school };
    }).filter(function (s) { return /^\d{1,24}$/.test(s.sid) && s.name; });
  }

  /* 加分名单和首页名单按学号对照：
     same 学号对上；added 首页新增；renamed 学号对上但名字不同；
     conflicts 同名但学号不同（不自动补，列出来问老师）；gone 加分里有、首页没有（保留）；
     leaving 首页标了退学、加分里还显示着（要隐藏）；back 加分里隐藏着、首页恢复了（要放回） */
  function diff(cls, students) {
    var roster = cls.roster || [], bySid = {}, byName = {}, home = {}, homeNames = {}, hidden = {};
    roster.forEach(function (m) { if (m.sid) bySid[m.sid] = m; if (m.name) byName[m.name] = m; });
    (cls.leftStudents || []).forEach(function (x) { hidden[x.sid] = x; });
    var list = clean(students), same = 0, added = [], renamed = [], conflicts = [], leaving = [], back = [];
    list.forEach(function (s) { home[s.sid] = true; homeNames[s.name] = s; });
    list.forEach(function (s) {
      var h = hidden[s.sid];
      if (h) {
        if (!s.left) back.push({ sid: s.sid, name: s.name });
        if (h.name !== s.name) renamed.push({ sid: s.sid, from: h.name, to: s.name });
        return;
      }
      var m = bySid[s.sid];
      if (m) {
        same++;
        if (m.name !== s.name) renamed.push({ sid: s.sid, from: m.name, to: s.name });
        if (s.left) leaving.push({ sid: s.sid, name: s.name });
        return;
      }
      if (s.left) return; // 首页标了退学、加分里本来没有的，不补
      var old = byName[s.name];
      if (old && !old.sid) return; // 没学号的老成员按姓名认
      if (old && !home[old.sid]) conflicts.push({ name: s.name, sid: old.sid, homeSid: s.sid });
      else added.push(s);
    });
    var conflictSids = {};
    conflicts.forEach(function (c) { conflictSids[c.sid] = true; });
    var gone = roster.filter(function (m) { return m.sid && !home[m.sid] && !conflictSids[m.sid]; })
      .map(function (m) { return { name: m.name, sid: m.sid }; });
    return { same: same, added: added, renamed: renamed, conflicts: conflicts, gone: gone, leaving: leaving, back: back };
  }

  function appendTo(cls, items) {
    cls.roster = cls.roster || [];
    var used = {}, max = 0;
    cls.roster.forEach(function (m) { used[m.no] = true; if (m.no > max) max = m.no; });
    (cls.groups || []).forEach(function (g) { (g.members || []).forEach(function (m) { if (m.no) { used[m.no] = true; if (m.no > max) max = m.no; } }); });
    (cls.leftStudents || []).forEach(function (x) { var no = x.roster && x.roster.no; if (no) { used[no] = true; if (no > max) max = no; } });
    items.forEach(function (s) {
      var no = s.seq >= 1 && s.seq <= 10000 && !used[s.seq] ? s.seq : ++max;
      used[no] = true; if (no > max) max = no;
      cls.roster.push({ name: s.name, sid: s.sid, no: no }); // 只进全班名单，待分配，不动已有分组
    });
    return items.length;
  }
  function renameIn(cls, renamed) {
    var to = {}, n = 0;
    renamed.forEach(function (r) { to[r.sid] = r.to; });
    (cls.roster || []).forEach(function (m) { if (m.sid && to[m.sid]) { m.name = to[m.sid]; n++; } });
    (cls.groups || []).forEach(function (g) { (g.members || []).forEach(function (m) { if (m.sid && to[m.sid]) m.name = to[m.sid]; }); });
    (cls.leftStudents || []).forEach(function (x) {
      if (!to[x.sid]) return;
      x.name = to[x.sid]; n++;
      if (x.roster) x.roster.name = to[x.sid];
      if (x.member) x.member.name = to[x.sid];
    });
    return n;
  }

  /* 退学：从全班名单和分组里挪进 cls.leftStudents，名单、分组、记分、打印都不再出现。
     个人扣分按“组内位置”存在每课的 personal 里，挪走时按课次存下来，其余成员照 removeMemberAt 的办法往前对齐；
     考勤、项目评价、组长评分按学号存，原样留在课次里。操作日志不动。 */
  function hide(state, cls, sid) {
    var rec = { sid: sid, name: '', roster: null, gno: null, member: null, leader: false, personal: {}, at: new Date().toISOString() };
    var ri = -1;
    (cls.roster || []).forEach(function (m, i) { if (ri < 0 && m.sid === sid) ri = i; });
    if (ri >= 0) { rec.roster = cls.roster.splice(ri, 1)[0]; rec.name = rec.roster.name; }
    (cls.groups || []).forEach(function (g) {
      if (rec.member) return;
      var j = -1;
      g.members.forEach(function (m, i) { if (j < 0 && m.sid === sid) j = i; });
      if (j < 0) return;
      rec.member = g.members.splice(j, 1)[0]; rec.gno = g.no; rec.name = rec.member.name;
      if (g.leaderKey === 'sid:' + sid) { rec.leader = true; delete g.leaderKey; }
      (state.lessons || []).forEach(function (l) {
        if (l.classId !== cls.id) return;
        var s = l.scores && l.scores[String(g.no)];
        if (!s || !s.personal) return;
        var np = {};
        Object.keys(s.personal).forEach(function (k) {
          var i = +k;
          if (i === j) { rec.personal[l.id] = s.personal[k]; return; }
          np[String(i > j ? i - 1 : i)] = s.personal[k];
        });
        s.personal = np;
      });
      dropUndo(state, cls); // 撤销记录按组内位置记的，位置变了就不能再撤
    });
    (cls.leftStudents = cls.leftStudents || []).push(rec);
  }
  /* 恢复：放回原组末尾（原组没了或不在组里的回待分配），个人扣分按课次接回 */
  function unhide(state, cls, sid) {
    var list = cls.leftStudents || [], k = -1;
    list.forEach(function (x, i) { if (k < 0 && x.sid === sid) k = i; });
    if (k < 0) return;
    var rec = list.splice(k, 1)[0];
    if (!list.length) delete cls.leftStudents;
    if (rec.roster) (cls.roster = cls.roster || []).push(rec.roster);
    var g = rec.member && (cls.groups || []).filter(function (x) { return x.no === rec.gno; })[0];
    if (!g) return;
    while (g.members.length && !g.members[g.members.length - 1].name) g.members.pop();
    var at = g.members.length;
    g.members.push(rec.member);
    if (rec.leader && !g.leaderKey) g.leaderKey = 'sid:' + sid;
    (state.lessons || []).forEach(function (l) {
      if (l.classId !== cls.id) return;
      var s = l.scores && l.scores[String(g.no)];
      if (!s) return;
      s.personal = s.personal || {};
      delete s.personal[String(at)];
      if (Object.prototype.hasOwnProperty.call(rec.personal, l.id)) s.personal[String(at)] = rec.personal[l.id];
    });
    dropUndo(state, cls);
  }
  function dropUndo(state, cls) {
    var mine = {};
    (state.lessons || []).forEach(function (l) { if (l.classId === cls.id) mine[l.id] = true; });
    var hit = function (op) { return op && mine[op.lessonId]; }; // 批量操作跨组，整班的都清
    if (state.undo) state.undo = state.undo.filter(function (op) { return !hit(op); });
    if (state.redo) state.redo = state.redo.filter(function (e) { return !hit(e && e.op); });
  }

  /* 跟着首页名单：补新学生、按学号改名、退学的隐藏、恢复的放回；首页没有的人不删，学号对不上的不补 */
  function follow(state, cls, students) {
    var d = diff(cls, students);
    var renamed = renameIn(cls, d.renamed);
    d.leaving.forEach(function (x) { hide(state, cls, x.sid); });
    d.back.forEach(function (x) { unhide(state, cls, x.sid); });
    return { added: appendTo(cls, d.added), renamed: renamed, left: d.leaving.length, back: d.back.length };
  }

  /* 原有的班对应到首页班（老师看过对照后确认） */
  function link(state, classId, hx, students) {
    var next = copy(state), cls = byId(next, classId);
    if (!cls) throw new Error('加分里没有这个班。');
    if ((next.classes || []).some(function (c) { return c !== cls && c.hxClassId === hx.id; })) throw new Error(hx.name + ' 已经对应了加分里的另一个班。');
    cls.hxClassId = hx.id; delete cls.hxLocal;
    var r = follow(next, cls, students);
    return { state: next, cls: cls, added: r.added, renamed: r.renamed, left: r.left, back: r.back };
  }
  /* 原有的班不对应首页（比如往届），保留并照常显示 */
  function keepLocal(state, classId) {
    var next = copy(state), cls = byId(next, classId);
    if (cls) cls.hxLocal = true;
    return next;
  }

  /* 自动跟随首页：已对应的班补人、改名；首页删班重导的按名字接回；
     还有原有班没对应时不自动建新班（免得和要对应的班重复），对应完再建。 */
  function auto(state, hxAll, studentsOf, teacher) {
    var next = copy(state), changes = [], wait = pending(next).length > 0;
    list(next, hxAll).forEach(function (it) {
      var studs = studentsOf(it.hx.id);
      if (!studs) return;
      var cls = it.cls;
      if (!cls) {
        if (wait) return;
        cls = { id: uid('c'), name: it.hx.name, teacher: teacher || '', hxClassId: it.hx.id, roster: [], groups: [] };
        for (var n = 1; n <= 13; n++) cls.groups.push({ id: uid('g'), no: n, members: [] });
        appendTo(cls, clean(studs).filter(function (s) { return !s.left; }));
        next.classes.push(cls);
        changes.push({ cls: cls, created: true, added: cls.roster.length, renamed: 0 });
        return;
      }
      var relinked = cls.hxClassId !== it.hx.id;
      cls.hxClassId = it.hx.id;
      var r = follow(next, cls, studs);
      if (relinked || r.added || r.renamed || r.left || r.back) changes.push({ cls: cls, created: false, relinked: relinked, added: r.added, renamed: r.renamed, left: r.left, back: r.back });
    });
    return { state: changes.length ? next : state, changes: changes, waiting: wait };
  }

  /* 加分里显示哪些班：对应的首页班点亮了的、原有的（没对应或保留为旧班）；
     首页取消点亮或删掉的班只是不显示，数据还在。空白模板在有别的班时不显示。 */
  function visible(state, hxAll) {
    if (!hxAll) return state.classes || [];
    var on = {};
    hxAll.filter(lit).forEach(function (h) { on[h.id] = true; });
    var shown = (state.classes || []).filter(function (c) { return c.hxClassId ? on[c.hxClassId] : !blank(state, c); });
    if (shown.length) return shown;
    /* 一个都不显示时页面没法用：先给空白模板，没有模板就全显示 */
    var tmpl = (state.classes || []).filter(function (c) { return !c.hxClassId; }).slice(0, 1);
    return tmpl.length ? tmpl : (state.classes || []);
  }

  global.JFDT_HXROSTER = { lit: lit, blank: blank, pending: pending, match: match, list: list, diff: diff,
    link: link, keepLocal: keepLocal, auto: auto, visible: visible };
})(typeof window !== 'undefined' ? window : this);
