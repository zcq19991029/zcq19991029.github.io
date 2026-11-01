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
      return { sid: String(s.student_no || '').trim(), name: String(s.name || '').trim(), seq: +s.seq || 0 };
    }).filter(function (s) { return /^\d{1,24}$/.test(s.sid) && s.name; });
  }

  /* 加分名单和首页名单按学号对照：
     same 学号对上；added 首页新增；renamed 学号对上但名字不同；
     conflicts 同名但学号不同（不自动补，列出来问老师）；gone 加分里有、首页没有（保留） */
  function diff(cls, students) {
    var roster = cls.roster || [], bySid = {}, byName = {}, home = {}, homeNames = {};
    roster.forEach(function (m) { if (m.sid) bySid[m.sid] = m; if (m.name) byName[m.name] = m; });
    var list = clean(students), same = 0, added = [], renamed = [], conflicts = [];
    list.forEach(function (s) { home[s.sid] = true; homeNames[s.name] = s; });
    list.forEach(function (s) {
      var m = bySid[s.sid];
      if (m) { same++; if (m.name !== s.name) renamed.push({ sid: s.sid, from: m.name, to: s.name }); return; }
      var old = byName[s.name];
      if (old && !old.sid) return; // 没学号的老成员按姓名认
      if (old && !home[old.sid]) conflicts.push({ name: s.name, sid: old.sid, homeSid: s.sid });
      else added.push(s);
    });
    var conflictSids = {};
    conflicts.forEach(function (c) { conflictSids[c.sid] = true; });
    var gone = roster.filter(function (m) { return m.sid && !home[m.sid] && !conflictSids[m.sid]; })
      .map(function (m) { return { name: m.name, sid: m.sid }; });
    return { same: same, added: added, renamed: renamed, conflicts: conflicts, gone: gone };
  }

  function appendTo(cls, items) {
    cls.roster = cls.roster || [];
    var used = {}, max = 0;
    cls.roster.forEach(function (m) { used[m.no] = true; if (m.no > max) max = m.no; });
    (cls.groups || []).forEach(function (g) { (g.members || []).forEach(function (m) { if (m.no) { used[m.no] = true; if (m.no > max) max = m.no; } }); });
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
    return n;
  }
  /* 跟着首页名单：补新学生、按学号改名；首页没有的人不删，学号对不上的不补 */
  function follow(cls, students) {
    var d = diff(cls, students);
    return { added: appendTo(cls, d.added), renamed: renameIn(cls, d.renamed) };
  }

  /* 原有的班对应到首页班（老师看过对照后确认） */
  function link(state, classId, hx, students) {
    var next = copy(state), cls = byId(next, classId);
    if (!cls) throw new Error('加分里没有这个班。');
    if ((next.classes || []).some(function (c) { return c !== cls && c.hxClassId === hx.id; })) throw new Error(hx.name + ' 已经对应了加分里的另一个班。');
    cls.hxClassId = hx.id; delete cls.hxLocal;
    var r = follow(cls, students);
    return { state: next, cls: cls, added: r.added, renamed: r.renamed };
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
        appendTo(cls, clean(studs));
        next.classes.push(cls);
        changes.push({ cls: cls, created: true, added: cls.roster.length, renamed: 0 });
        return;
      }
      var relinked = cls.hxClassId !== it.hx.id;
      cls.hxClassId = it.hx.id;
      var r = follow(cls, studs);
      if (relinked || r.added || r.renamed) changes.push({ cls: cls, created: false, relinked: relinked, added: r.added, renamed: r.renamed });
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
