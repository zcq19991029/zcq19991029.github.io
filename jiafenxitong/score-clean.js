/* ============================================================================
   清洗「排位项目列」上被老师 / 学生互评误加的分
   ----------------------------------------------------------------------------
   用户原话（2026-11-13）：
     「这种项目是排位仿真课堂任务生成的项目列 老师无权改为学生打分还是教师自己打分
       是无法编辑的才对 就排第一列即可 **修复老师或者学生互评的这一列误加的分**
       因为这是由课堂任务生成的项目列」

   排位列 = 接线仿真课堂任务自动生成、只读的记分列，列名形如
     · 「线上接线仿真 接线2.3」   ← 现在的正式名（wire-task-link.js 的 NAME_PREFIX）
     · 「线上连线排位 接线2.3」   ← 2026-11-11 那一版前缀
     · 「接线2.3」                ← 最早没有前缀的那一版
   三种都算排位列（同一个正则，见下）。

   ----------------------------------------------------------------------------
   判据：为什么「peerMeta 不是 wire」就一定不是排位分
   ----------------------------------------------------------------------------
   wire-task-link.js 把接线任务成绩写进某一格时，**每一格都会打标记**（第 399–400 行）：
       var metaKey = g.no + '|' + mk + '|' + col;
       if (lesson.peerMeta[metaKey] !== 'wire') { lesson.peerMeta[metaKey] = 'wire'; out.changed = true; }
   也就是说：这一格的分是谁写进来的，peerMeta 里就记着谁 ——
       'wire'    = 接线任务（真实排名/完成率 → 分），这是排位列唯一合法的来源；
       'teacher' = 老师点格子手填（leader-scoring.js setCell 写的）；
       'leader'  = 学生互评（peer-apply.js 写的）；
       'avg'     = 互评算出来的平均分（peer-apply.js 写的）；
       undefined = 更早的数据，或者直接改了库，总之没人认领。
   排位列的分只可能来自接线任务，所以：
       **排位列 + peerMeta === 'wire'  → 真实排位分，保留**
       **排位列 + peerMeta !== 'wire'  → 手填 / 互评来的误加分，清成 null**
   反过来不成立也不行：'wire' 标记不会出现在非排位列上（wire 只写自己那一列），
   所以这个判据不会误伤别的手工项目列。

   mode 说明：本模块只操作传进来的 state 对象，不 save()、不碰 CLOUD、不建 DOM。
   落盘 / 上云由调用方决定；清之前先用 backup() 让老师存一份 JSON。
   ========================================================================== */
(function (root) {
  'use strict';

  var W = {};

  /* 必须和 app.js taskScore() 的 TASK_COL、leader-scoring.js isTaskCol() 一字不差：
     app.js:1085        var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真)/;
     leader-scoring:25  var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真)/;
     改这里 = 改那两处，否则「哪些列是排位列」三个地方会打架。 */
  var TASK_COL = /^(?:接线|线上连线排位|线上接线仿真)/;

  /* 必须和 app.js:419 一字不差：leaderScores[组号].members 的键、peerMeta 键里那段都是它。
     app.js:419  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); } */
  function memberKey(m) { return m && (m.sid ? 'sid:' + m.sid : 'id:' + m.id); }

  function str(v) { return v == null ? '' : String(v); }
  function isTaskCol(name) { return TASK_COL.test(str(name).trim()); }
  function isEmpty(v) { return v == null || v === ''; }
  function pad2(n) { return ('0' + n).slice(-2); }
  function deepCopy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /* 来源说人话：给老师看的「这一格是谁加的」 */
  function srcText(meta) {
    if (!meta) return '无来源标记（老数据 / 丢标记）';
    if (meta === 'wire') return '接线任务';
    if (meta === 'teacher') return '老师手填';
    if (meta === 'leader') return '学生互评';
    if (meta === 'avg') return '互评平均分';
    return '来源标记「' + meta + '」';
  }

  /* 一节课每组的列名。leaderProjectNames 是全班共用的权威副本（wire-task-link.js 写回时
     两处同步），但它可能是空数组（老课次 / 只落了 rec.projects）；
     所以逐列取「共用名优先，空了用组长记录里的副本兜底」。 */
  function namesFor(lesson, rec) {
    var shared = Array.isArray(lesson.leaderProjectNames) ? lesson.leaderProjectNames : [];
    var own = rec && Array.isArray(rec.projects) ? rec.projects : [];
    var len = Math.max(shared.length, own.length), out = [], i;
    for (i = 0; i < len; i++) out[i] = str(shared[i]).trim() || str(own[i]).trim();
    return out;
  }

  /* 班里「成员键 → 姓名」，用来把孤儿记录也报出人名。分组里的人优先，名单补齐的其次。 */
  function nameMap(cls) {
    var map = Object.create(null);
    function put(m) {
      if (!m || !m.name) return;
      var k = memberKey(m);
      if (k && !map[k]) map[k] = m.name;
    }
    (cls && cls.groups || []).forEach(function (g) { (g && g.members || []).forEach(put); });
    (cls && cls.roster || []).forEach(put);
    return map;
  }

  /* 扫出所有「会被清掉」的格子。返回内部结构（带 lesson / 数组引用），scan 与 clean 共用。 */
  function collect(state) {
    var items = [];
    if (!state || !Array.isArray(state.classes) || !Array.isArray(state.lessons)) return items;

    var clsById = Object.create(null), clsOrder = Object.create(null), i;
    for (i = 0; i < state.classes.length; i++) {
      var c = state.classes[i];
      if (!c || c.id == null) continue;
      clsById[str(c.id)] = c;
      clsOrder[str(c.id)] = i;
    }
    /* 课次排序：先按班级顺序，再按第几次课（seq），最后按日期 —— 报告才像课表 */
    var lessons = state.lessons.slice().sort(function (a, b) {
      if (!a || !b) return 0;
      var oa = clsOrder[str(a.classId)], ob = clsOrder[str(b.classId)];
      oa = oa == null ? 9999 : oa; ob = ob == null ? 9999 : ob;
      if (oa !== ob) return oa - ob;
      var sa = Number(a.seq) || 0, sb = Number(b.seq) || 0;
      if (sa !== sb) return sa - sb;
      return str(a.date) < str(b.date) ? -1 : (str(a.date) > str(b.date) ? 1 : 0);
    });

    for (var li = 0; li < lessons.length; li++) {
      var lesson = lessons[li];
      if (!lesson || !lesson.leaderScores) continue;
      var cls = clsById[str(lesson.classId)] || null;
      var names = nameMap(cls);
      var meta = lesson.peerMeta || {};

      var gnos = Object.keys(lesson.leaderScores);
      for (var gi = 0; gi < gnos.length; gi++) {
        var gnoKey = gnos[gi];
        var rec = lesson.leaderScores[gnoKey];
        if (!rec || !rec.members) continue;
        var cols = namesFor(lesson, rec);

        var keys = Object.keys(rec.members);
        for (var ki = 0; ki < keys.length; ki++) {
          var key = keys[ki], arr = rec.members[key];
          if (!Array.isArray(arr)) continue;
          for (var col = 0; col < arr.length; col++) {
            if (!isTaskCol(cols[col])) continue;      // 不是排位列，不归本模块管
            var value = arr[col];
            if (isEmpty(value)) continue;             // 空格子没分可清（残留的 meta 也不用管）
            var metaKey = gnoKey + '|' + key + '|' + col;
            var m = Object.prototype.hasOwnProperty.call(meta, metaKey) ? meta[metaKey] : '';
            if (m === 'wire') continue;               // 接线任务写的真分，保留
            items.push({
              lesson: lesson, cls: cls,
              gnoKey: gnoKey,
              gno: isFinite(Number(gnoKey)) ? Number(gnoKey) : gnoKey,
              key: key,
              memberName: names[key] || '(已不在名单)',
              col: col,
              colName: cols[col],
              value: value,
              meta: m ? str(m) : '',
              arr: arr,
              metaKey: metaKey
            });
          }
        }
      }
    }
    return items;
  }

  /* 把内部结构摊成对外的 scan/clean 报告形状 */
  function report(items) {
    var byLesson = Object.create(null), list = [], byMeta = Object.create(null), k;
    for (k = 0; k < items.length; k++) {
      var it = items[k], id = str(it.lesson.id);
      var bucket = byLesson[id];
      if (!bucket) {
        bucket = byLesson[id] = {
          lessonId: it.lesson.id,
          className: it.cls ? (it.cls.name || it.cls.id) : '(班级已删)',
          seq: it.lesson.seq == null ? 0 : it.lesson.seq,
          date: str(it.lesson.date),
          cells: []
        };
        list.push(bucket);
      }
      bucket.cells.push({
        gno: it.gno,
        memberName: it.memberName,
        col: it.col,
        colName: it.colName,
        value: it.value,
        meta: it.meta,
        reason: '「' + it.colName + '」是接线任务自动生成的排位列（只读），这一格的来源是'
          + srcText(it.meta) + '而不是接线任务（peerMeta≠wire），属于误加的分'
      });
      var tag = it.meta || 'none';
      byMeta[tag] = (byMeta[tag] || 0) + 1;
    }
    return { lessons: list, byMeta: byMeta, total: items.length };
  }

  /* 报告里那行中文摘要 */
  function summarize(rep) {
    if (!rep.total) return '排位列上没有误加的分，不用清。';
    var parts = [], order = ['teacher', 'leader', 'avg', 'none'];
    for (var i = 0; i < order.length; i++) {
      var n = rep.byMeta[order[i]];
      if (!n) continue;
      parts.push((order[i] === 'none' ? '无来源标记' : srcText(order[i])) + ' ' + n + ' 格');
    }
    Object.keys(rep.byMeta).forEach(function (t) {
      if (order.indexOf(t) >= 0) return;
      parts.push('标记「' + t + '」' + rep.byMeta[t] + ' 格');
    });
    return '共 ' + rep.lessons.length + ' 次课、' + rep.total + ' 格会被清掉（'
      + parts.join('，') + '）。接线任务写入的分（标记 wire）一格不动。';
  }

  /**
   * 只读清点：列出所有会被清掉的格子，不改数据。
   * @param {object} state 小组加分整份数据
   * @returns {{total:number, lessons:Array, summary:string, byMeta:object}}
   */
  W.scan = function (state) {
    var rep = report(collect(state));
    return {
      total: rep.total,
      lessons: rep.lessons,
      summary: summarize(rep),
      byMeta: rep.byMeta
    };
  };

  /** 备份文件名：小组加分-排位误加分备份-20261113-1530.json */
  function backupName(d) {
    return '小组加分-排位误加分备份-'
      + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
  }

  /**
   * 下载一份清洗前的原始数据备份（浏览器环境）。只读写传入的 state，不碰 localStorage。
   * @returns {string|null} 下载的文件名；非浏览器环境返回 null
   */
  W.backup = function (state) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined'
      || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    var now = new Date();
    var payload = {
      at: now.toISOString(),
      note: '清洗排位误加分前的原始数据',
      classes: deepCopy((state && state.classes) || []),
      lessons: deepCopy((state && state.lessons) || [])
    };
    var name = backupName(now);
    var url = null, a = null;
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
      url = URL.createObjectURL(blob);
      a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      if (a && a.parentNode) a.parentNode.removeChild(a);
      if (url) { try { URL.revokeObjectURL(url); } catch (e2) { /* 忽略 */ } }
      return null;
    }
    if (url) {
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 4000);
    }
    return name;
  };

  /**
   * 执行清洗：命中的格子置 null 并删掉它的 peerMeta 标记。
   * @returns {{removed:number, lessons:Array, snapshot:object, summary:string}}
   *          snapshot 可直接传回 W.undo(state, snapshot) 撤销。
   */
  W.clean = function (state) {
    var items = collect(state), cells = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      /* 先记原值再动手 —— 顺序反过来就撤不回去了 */
      cells.push({
        lessonId: it.lesson.id,
        gno: it.gnoKey,
        key: it.key,
        col: it.col,
        value: it.value,
        meta: it.meta,
        hadMeta: Object.prototype.hasOwnProperty.call(it.lesson.peerMeta || {}, it.metaKey)
      });
      it.arr[it.col] = null;
      if (it.lesson.peerMeta) delete it.lesson.peerMeta[it.metaKey];
    }
    var rep = report(items);
    var snapshot = {
      at: new Date().toISOString(),
      note: '清洗掉的排位误加分原值（撤销用）',
      cells: cells
    };
    return {
      removed: cells.length,
      lessons: rep.lessons,
      snapshot: snapshot,
      summary: summarize(rep)
    };
  };

  /**
   * 撤销清洗：把 snapshot 里的原值写回去。
   * 只往「现在还是空」的格子里恢复 —— 清洗之后又有人给这一格打了分的话，
   * 宁可跳过也不覆盖，避免撤销把新分吃掉。
   * @returns {{restored:number, skipped:number}}
   */
  W.undo = function (state, snapshot) {
    var out = { restored: 0, skipped: 0 };
    if (!state || !Array.isArray(state.lessons) || !snapshot || !Array.isArray(snapshot.cells)) return out;

    var byId = Object.create(null);
    for (var i = 0; i < state.lessons.length; i++) {
      var l = state.lessons[i];
      if (l && l.id != null) byId[str(l.id)] = l;
    }

    for (var c = 0; c < snapshot.cells.length; c++) {
      var cell = snapshot.cells[c];
      if (!cell) continue;
      var lesson = byId[str(cell.lessonId)];
      if (!lesson) { out.skipped++; continue; }        // 课次被删了，没法还原
      if (!lesson.leaderScores) lesson.leaderScores = {};
      var rec = lesson.leaderScores[str(cell.gno)];
      if (!rec) { out.skipped++; continue; }
      if (!rec.members) rec.members = {};
      var arr = rec.members[cell.key];
      if (!Array.isArray(arr)) { arr = rec.members[cell.key] = []; }
      while (arr.length <= cell.col) arr.push(null);
      if (!isEmpty(arr[cell.col])) { out.skipped++; continue; }  // 已经被重新打分，不覆盖
      arr[cell.col] = cell.value;
      if (cell.hadMeta) {
        if (!lesson.peerMeta) lesson.peerMeta = {};
        lesson.peerMeta[str(cell.gno) + '|' + cell.key + '|' + cell.col] = cell.meta;
      }
      out.restored++;
    }
    return out;
  };

  /* 给调用方判断「要不要显示清洗入口」用：有可清的格子吗 */
  W.hasWork = function (state) {
    return collect(state).length > 0;
  };

  root.JFDT_SCORECLEAN = W;
})(typeof window === 'undefined' ? globalThis : window);
