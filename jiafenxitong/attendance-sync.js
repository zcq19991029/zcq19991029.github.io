/* attendance-sync.js —— 考勤工具 → 小组加分 自动同步
   老师说「考勤完成率和考勤工具卡实行同步」，所以这里把原来那颗手的「从考勤工具导入本课」变成后台自动跑：
   打开页面 / 回到前台 / 切班 / 5 分钟心跳时，把考勤工具里**已经签到了**的人写进对应课次的 attendance，
   assessment.js 的 rows() 会照原样实时重算考勤完成率（这边不碰算法）。

   三条铁律：
   1. 只写「明确签到了」的人。importPlan 的 pending（还在进行中没签的）一个都不动，也不删任何已有记录。
   2. 老师在本工具里手填 / 手改的考勤（没有 auto 标记）绝不覆盖，只记进 skipped。
   3. 状态没变化不写，避免每次心跳都 save() 触发云端同步风暴。

   纯 ES5；CLOUD / state / save 全部由调用方注入，不访问 app.js 的闭包。 */
(function (root) {
  'use strict';

  var W = {};

  var FIRST_DELAY = 6000;    // 首屏先渲染完，6 秒后才开始第一次同步
  var HEARTBEAT = 300000;    // 之后每 5 分钟一次
  var HOT_BUCKET = 600000;   // 「今天有课」时 10 分钟一个桶，同一个桶里不重复全量拉
  var VIS_THROTTLE = 60000;  // 回到前台 60 秒内只试一次
  var MIN_GAP = 45000;       // 两次真正跑之间至少隔 45 秒（定时器/可见性/切班撞车时）
  var FREEZE_DAYS = 2;       // 2 天前的课次同步过一次就不再重复拉（考勤工具那边也不会再改）

  var LABELS = { present: '正常出勤', late: '迟到', truant: '旷课', leave: '请假', early: '早退' };

  var A = null;                 // window.JFDT_ASSESSMENT，用的时候再取（脚本顺序不保证）
  var timer = null, firstTimer = null, stopped = true, running = false;
  var lastRunAt = 0, lastVisibleTry = 0, lastKey = {}, bound = null;
  var doneDates = {};           // { classId: { 'YYYY-MM-DD': true } } 冷日期已经同步过，不重复拉

  /* ---------------- 小工具 ---------------- */

  function assessment() {
    if (A && A.importFind) return A;
    A = root.JFDT_ASSESSMENT || null;
    return (A && A.importFind) ? A : null;
  }
  function document_() { return root.document || null; }
  function hidden() {
    var d = document_();
    return !!(d && d.visibilityState === 'hidden');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dateOf(lesson) {
    var d = String((lesson && lesson.date) || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
  }
  function statusLabel(status, cfg) {
    if (LABELS[status]) return LABELS[status];
    var rules = (cfg && cfg.customRules) || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i] && rules[i].id === status) return String(rules[i].name || status);
    }
    return String(status || '');
  }

  /* 云端 rpc：优先用调用方注入的；没注入就退回 window.JFDT_CLOUD，并要求已登录 */
  function pickRpc(opts) {
    opts = opts || {};
    if (typeof opts.rpc === 'function') return opts.rpc;
    if (opts.cloud && typeof opts.cloud.rpc === 'function') {
      return function (name, args) { return opts.cloud.rpc(name, args); };
    }
    if (opts.cloud === null) return null;           // 调用方明确说「没登录」
    var cx = root.JFDT_CLOUD || null;
    if (!cx || typeof cx.rpc !== 'function') return null;
    if (typeof cx.profile === 'function' && cx.profile() == null) return null;
    return function (name, args) { return cx.rpc(name, args); };
  }

  function classLessons(cls, state, given) {
    if (Array.isArray(given)) return given.slice();
    var all = (state && state.lessons) || [], out = [], i;
    for (i = 0; i < all.length; i++) {
      if (all[i] && cls && all[i].classId === cls.id) out.push(all[i]);
    }
    out.sort(function (a, b) { return (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0); });
    return out;
  }

  /* 同一天多次签到：取 session.seq 最大的那次 */
  function bestHit(found) {
    var pick = null, best = -1;
    for (var i = 0; i < found.length; i++) {
      var h = found[i];
      if (!h || !h.session || !h.sheet) continue;
      var seq = Number(h.session.seq);
      if (!isFinite(seq)) seq = 0;
      if (seq > best) { best = seq; pick = h; }
    }
    return pick;
  }

  function findSafe(rpc, hxId, date) {
    var Api = assessment();
    if (!Api) return Promise.reject(new Error('assessment-missing'));
    try {
      return Promise.resolve(Api.importFind(rpc, hxId, date));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /* ---------------- 写回 ---------------- */

  function applyLesson(lesson, hit, students, hxId, cfg, Api, res) {
    var plan;
    try {
      plan = Api.importPlan(students, hit.sheet, hit.session, hxId, cfg);
    } catch (e) {
      return;
    }
    if (!plan || !plan.fill) return;
    res.pending += Number(plan.pending) || 0;
    (plan.unmatched || []).forEach(function (name) {
      if (res.unmatched.indexOf(name) < 0) res.unmatched.push(name);
    });

    var stamp = null;   // 同一次同步里所有写入共用一个时间戳
    for (var i = 0; i < plan.fill.length; i++) {
      var x = plan.fill[i];
      if (!x || !x.key || !x.status) continue;
      var status = x.status;
      var loss = Number(Api.deduction(status, cfg)) || 0;
      var rec = lesson.attendance && lesson.attendance[x.key];

      // 老师手填 / 手动导入过的：一律不碰
      if (rec && rec.auto !== true) { res.skipped++; continue; }
      // 状态、扣分都没变：不写（这条最重要，防止心跳 save 风暴）
      if (rec && rec.status === status && Number(rec.loss) === loss) continue;

      if (!stamp) stamp = new Date().toISOString();
      if (!lesson.attendance) lesson.attendance = {};
      lesson.attendance[x.key] = {
        status: status,
        label: statusLabel(status, cfg),
        loss: loss,
        updatedAt: stamp,
        auto: true
      };
      res.filled++;
      res.changed = true;
    }
  }

  /* ---------------- 对外：同步一个班 ---------------- */

  /**
   * @param {Object} cls   班级对象（要 cls.id / cls.hxClassId / cls.groups / cls.roster）
   * @param {Object} state 整个应用状态（要 state.lessons）
   * @param {Object} opts  { rpc, cloud, raw, lessons, save, cached, force }
   *                       cached=true 时，两天前的旧课次同步过就不再拉（boot 用这个）
   * @returns {Promise<{filled,skipped,lessons,error,changed,dates,hits,pending,unmatched,picks}>}
   *          filled  = 本次新写/更新的考勤条数
   *          skipped = 因为老师手填过而跳过的条数
   *          lessons = 本次去拉的课次数（同一天多次签到算同一课次）
   *          error   = 'no-cloud' / 'no-hx-class' / 'no-class' / 'network' / 'assessment-missing' / null
   */
  W.syncClass = function (cls, state, opts) {
    opts = opts || {};
    var res = {
      filled: 0, skipped: 0, lessons: 0, error: null,
      changed: false, dates: 0, hits: 0, pending: 0, unmatched: [], picks: []
    };
    var Api = assessment();
    if (!Api) { res.error = 'assessment-missing'; return Promise.resolve(res); }
    if (!cls || !cls.id) { res.error = 'no-class'; return Promise.resolve(res); }

    var hxId = Number(cls.hxClassId) || 0;
    if (!hxId) { res.error = 'no-hx-class'; return Promise.resolve(res); }

    var rpc = pickRpc(opts);
    if (!rpc) { res.error = 'no-cloud'; return Promise.resolve(res); }

    var lessons = classLessons(cls, state, opts.lessons);
    var byDate = {}, dates = [], i;
    for (i = 0; i < lessons.length; i++) {
      var d = dateOf(lessons[i]);
      if (!d) continue;
      if (!byDate[d]) { byDate[d] = []; dates.push(d); }
      byDate[d].push(lessons[i]);
    }
    if (!dates.length) return Promise.resolve(res);

    var now = Date.now();
    var cutoff = dayKey(now - FREEZE_DAYS * 86400000);
    var done = doneDates[cls.id] || (doneDates[cls.id] = {});

    var todo = [];
    for (i = 0; i < dates.length; i++) {
      var day = dates[i];
      if (opts.cached && day < cutoff && done[day]) continue;   // 冷日期已经同步过
      todo.push(day);
    }
    if (!todo.length) return Promise.resolve(res);

    var cfg = Api.settings(cls);
    var students = Api.roster(cls, opts.raw || []);

    // lessons = 本次真正去拉的课次数（cached 跳过的旧课次不算）
    todo.forEach(function (day) { res.lessons += byDate[day].length; });

    // 逐天串行拉，避免一次把云端打满
    var chain = Promise.resolve();
    todo.forEach(function (day) {
      chain = chain.then(function () {
        return findSafe(rpc, hxId, day).then(function (found) {
          res.dates++;
          if (!found || !found.length) { done[day] = true; return; }
          var hit = bestHit(found);
          if (!hit) return;
          res.hits++;
          res.picks.push({
            date: day,
            seq: Number(hit.session.seq) || 0,
            course: (hit.course && hit.course.name) || '',
            count: found.length
          });
          byDate[day].forEach(function (lesson) {
            applyLesson(lesson, hit, students, hxId, cfg, Api, res);
          });
          done[day] = true;
        }, function () {
          res.error = 'network';
        });
      });
    });

    return chain.then(function () {
      if (res.changed && typeof opts.save === 'function') {
        try { opts.save(); } catch (e) {}
      }
      return res;
    }, function (e) {
      res.error = 'sync-failed';
      return res;
    });
  };

  /* ---------------- 自动触发 ---------------- */

  /* 指纹：同一个班 + 同一批课次 + 同一个 10 分钟桶 → 跳过，别每次全量拉 */
  function fingerprint(cls, lessons, now) {
    var sig = [], hot = false, today = dayKey(now);
    for (var i = 0; i < lessons.length; i++) {
      var d = dateOf(lessons[i]);
      if (!d) continue;
      sig.push(String(lessons[i].id || i) + '@' + d);
      if (d === today) hot = true;
    }
    sig.sort();
    return String(cls.id) + '|' + (Number(cls.hxClassId) || 0) + '|' + sig.join(',') + '|' +
      (hot ? 'b' + Math.floor(now / HOT_BUCKET) : 'cold');
  }

  function tick(getCtx, force) {
    if (stopped || hidden()) return Promise.resolve(null);
    /* 上一次还没回来就跳过；但超过 3 分钟当它已经卡死（网络挂住），放行下一轮 */
    if (running) {
      if (Date.now() - lastRunAt < 180000) return Promise.resolve(null);
      running = false;
    }

    var ctx = null;
    try { ctx = getCtx(); } catch (e) { ctx = null; }
    if (!ctx || !ctx.cls || !ctx.state) return Promise.resolve(null);

    var now = Date.now();
    if (!force && now - lastRunAt < MIN_GAP) return Promise.resolve(null);

    var cls = ctx.cls;
    var lessons = classLessons(cls, ctx.state, null);
    var key = fingerprint(cls, lessons, now);
    if (!force && lastKey[cls.id] === key) return Promise.resolve(null);

    lastRunAt = now;
    running = true;

    return W.syncClass(cls, ctx.state, {
      rpc: ctx.rpc,
      cloud: ctx.cloud,
      raw: ctx.raw,
      lessons: lessons,
      cached: true
    }).then(function (res) {
      running = false;
      /* 只要有写入就先落盘，哪怕这次有一两天网络失败 —— 已经拉下来的签到不能丢 */
      if (res && res.changed && typeof ctx.save === 'function') {
        try { ctx.save(); } catch (e) {}
      }
      if (!res || res.error) return res;          // 失败不记指纹，下一轮自动重试
      lastKey[cls.id] = key;
      return res;
    }).then(null, function () {
      running = false;
      return { error: 'sync-failed' };
    }).then(null, function () {
      running = false;
      return null;
    });
  }

  /**
   * 挂自动同步。
   * @param {Function} getCtx 返回 { cls, state, save, rpc?, cloud?, raw? }
   * @returns {Boolean}
   */
  W.boot = function (getCtx) {
    if (typeof getCtx !== 'function') return false;
    W.stop();
    stopped = false;
    running = false;

    var listen = document_();
    bound = {
      visible: function () {
        if (stopped || hidden()) return;
        var now = Date.now();
        if (now - lastVisibleTry < VIS_THROTTLE) return;   // 回到前台 60 秒内只试一次
        lastVisibleTry = now;
        tick(getCtx, false);
      },
      classChange: function () {
        if (stopped) return;
        tick(getCtx, true);                                 // 切班：强制跑一次
      }
    };
    if (listen && listen.addEventListener) {
      listen.addEventListener('visibilitychange', bound.visible);
      listen.addEventListener('hx-class-change', bound.classChange);
    }

    firstTimer = setTimeout(function () {
      firstTimer = null;
      tick(getCtx, false);
    }, FIRST_DELAY);
    timer = setInterval(function () { tick(getCtx, false); }, HEARTBEAT);
    return true;
  };

  W.stop = function () {
    stopped = true;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    var listen = document_();
    if (bound && listen && listen.removeEventListener) {
      listen.removeEventListener('visibilitychange', bound.visible);
      listen.removeEventListener('hx-class-change', bound.classChange);
    }
    bound = null;
    return true;
  };

  /* 调试/自检用：清掉「冷日期已同步」和「指纹」，下次强制全量拉一遍 */
  W.reset = function () {
    doneDates = {};
    lastKey = {};
    lastRunAt = 0;
    lastVisibleTry = 0;
    return true;
  };

  root.JFDT_ATT_SYNC = W;
})(typeof window === 'undefined' ? globalThis : window);
