/* 华夏工具 · 课程进度云端适配层（GitHub Pages 静态托管，直连 Supabase）
 *
 * 原来这一层对的是 Cloudflare Worker 的 /api/workspace：Worker 用 Cookie 会话认老师，用 D1 里 workspaces.revision 做 CAS。
 * 并入华夏工具后改成本文件：
 *   - 身份：读四件工具共用的登录 localStorage['paike-session']，再问数据库 hx_me() 是不是老师（学生账号挡在门口）；
 *   - 数据：public.kc_workspaces 一行（owner_id = auth.uid()），换电脑登录同一账号就是同一份数据；
 *   - 保存：走 security definer 函数 kc_save(data, 旧 revision)，revision 对不上就报错。不在客户端用「先读再写」两条
 *     SQL 假装原子——那中间会被另一台设备插进来；
 *   - 只用公开密钥（publishable key），没有 service_role，也没有任何服务端密钥。
 *
 * 启动为什么要多刷一次：这些脚本是同步执行的，页面下面那些业务脚本一上来就读 localStorage；而云端数据是网络请求。
 * 所以第一步先取数据写进 sessionStorage 再 location.reload()；第二步（同一个标签页）同步把数据接管给 localStorage。
 * 业务代码一行都不用改，也不会出现「先显示空课表、再跳成真课程」。
 *
 * 本文件提供 window.CourseCloud，形状与 Worker 版一致（flush / refresh / snapshot / preview / commit / nativeSnapshot /
 * migrate / api），上层业务代码基本不用改；原来的 /api/xxx 由下面的 api() 按路径分发到本地实现。
 */
(function (global) {
  'use strict';

  var BASE = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co';           // 华夏工具 Supabase 项目
  var KEY = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd';      // 公开密钥，权限全靠 RLS
  var AUTH = BASE + '/auth/v1', REST = BASE + '/rest/v1';
  var SESSION_KEY = 'paike-session';        // 和排课、接线仿真、总入口共用一份登录
  var CACHE_KEY = 'kc.boot.v1';             // sessionStorage：第一步取到的数据，给第二步用
  var GUARD_KEY = 'kc.boot.guard';          // sessionStorage：防止反复刷新
  var WS = 'kc_workspaces', DRAFT = 'kc_import_drafts';
  var DEFAULT_MCU = { id: 'mcu', name: '单片机技术及应用', classes: {}, progress: [], scheduleSource: 'unified-import', progressSource: 'unified-import' };

  var native = global.localStorage;         // 真正的浏览器 localStorage（备份/迁移要用）
  var session = null, teacher = null;
  var values = {}, revision = 0, stale = false;
  var timer = null, writing = null, dirty = false, blocked = false;
  var statusEl = null, gateState = null;
  var ready = [];                           // DOM 就绪后要做的事（本文件在 <head> 里执行，那时还没有 body）

  function byId(id) { return document.getElementById(id); }
  function onReady(fn) {
    if (document.readyState === 'loading') {
      if (!ready.length) document.addEventListener('DOMContentLoaded', flushReady);
      ready.push(fn);
    } else fn();
  }
  function flushReady() { var list = ready; ready = []; list.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  /* ---------------- 网络 ---------------- */

  function readShared() {
    try { var s = JSON.parse(native.getItem(SESSION_KEY) || 'null'); return s && s.access_token ? s : null; } catch (e) { return null; }
  }
  /* 只覆盖三项凭证，其他字段（尤其排课要用的 user）原样保留 */
  function remember(s) {
    if (!s || !s.access_token) return null;
    var expires = Number(s.expires_at || 0) || (Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600));
    var base = readShared() || session || {};
    session = Object.assign({}, base, {
      access_token: s.access_token,
      refresh_token: s.refresh_token || base.refresh_token || null,
      expires_at: expires,
      user: s.user || base.user || null
    });
    try { native.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }
  function expired(s) { return !!(s.refresh_token && !(s.expires_at && s.expires_at - 60 > Date.now() / 1000)); }

  function request(url, options) {
    options = options || {};
    var headers = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, options.headers || {});
    if (options.token !== false && session && session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
    return fetch(url, { method: options.method || 'GET', headers: headers, body: options.body, cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          if (text) { try { body = JSON.parse(text); } catch (e) { body = { raw: text }; } }
          if (!res.ok) {
            var code = (body && (body.error_code || body.code)) || '';
            var msg = (body && (body.message || body.msg || body.error_description)) || ('请求失败（HTTP ' + res.status + '）');
            var err = new Error(typeof msg === 'string' ? msg : '数据库返回了错误（HTTP ' + res.status + '）');
            err.status = res.status;
            /* P0409 是 kc_save 里版本对不上时抛的自定义码；42501 是权限不足（没登录 / 不是老师 / RLS 拦住） */
            err.code = code === 'P0409' ? 'version_conflict' : code === '42501' ? 'not_allowed' : code;
            err.body = body;
            throw err;
          }
          return body;
        });
      }, function () {
        var err = new Error('连不上网络，请检查网络后重试。'); err.code = 'network'; throw err;
      });
  }

  function ensureFresh() {
    if (!session) { var e = new Error('请先在华夏工具登录。'); e.code = 'no_session'; return Promise.reject(e); }
    /* 续期前先重读共用登录：别的工具可能刚续过（续期后旧 refresh token 作废，拿旧的再续会把整组一起踢下线） */
    var shared = readShared();
    if (shared && shared.access_token !== session.access_token) session = shared;
    if (!expired(session)) return Promise.resolve(session);
    var used = session.refresh_token;
    return request(AUTH + '/token?grant_type=refresh_token', {
      method: 'POST', token: false, body: JSON.stringify({ refresh_token: used })
    }).then(function (s) { remember(s); return session; }, function (err) {
      var now = readShared();
      if (now && now.refresh_token !== used && !expired(now)) { session = now; return session; }
      throw err;
    });
  }

  function rpc(name, args) {
    return ensureFresh().then(function () {
      return request(REST + '/rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
    });
  }

  /* ---------------- 门禁（没登录 / 不是老师 / 正在读云端） ---------------- */

  function paintGate() {
    var box = byId('kcGate');
    if (!box || !gateState) return;
    box.hidden = false;
    byId('kcGateTitle').textContent = gateState.title;
    byId('kcGateText').textContent = gateState.text;
    byId('kcGateActions').hidden = !gateState.actions;
    document.documentElement.setAttribute('data-kc', 'wait');
  }
  function showGate(title, text, actions) {
    gateState = { title: title, text: text, actions: !!actions };
    document.documentElement.setAttribute('data-kc', 'wait');
    onReady(paintGate);
  }
  /* 回总入口：嵌在总入口的框里就整页跳（同源），单独打开就跳本站首页 */
  function portalUrl() {
    try { return new URL('../#course', location.href).href; } catch (e) { return '../#course'; }
  }
  function goPortal() {
    var target = portalUrl();
    try { if (global.top && global.top !== global) { top.location.href = target; return; } } catch (e) {}
    location.href = target;
  }
  onReady(function () {
    var go = byId('kcGateGo'), retry = byId('kcGateRetry');
    if (go) go.onclick = function () {
      if (global.HXTheme && global.HXTheme.login) { try { global.HXTheme.login(); return; } catch (e) {} }
      goPortal();
    };
    if (retry) retry.onclick = function () { location.reload(); };
    if (gateState) paintGate();
  });

  /* ---------------- 状态提示 ---------------- */

  function status(text, warn) {
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'cloudSaveState';
      statusEl.setAttribute('role', 'status');
      statusEl.style.cssText = 'position:fixed;right:16px;bottom:14px;z-index:9998;border-radius:12px;padding:9px 13px;background:#f5edff;color:#755797;font-size:12px;max-width:calc(100% - 32px)';
      onReady(function () { if (document.body) document.body.append(statusEl); });
    }
    statusEl.style.background = warn ? '#fff0e8' : '#f5edff';
    statusEl.textContent = text;
  }

  /* 保存失败：把当前数据存成文件，别让老师的改动丢在内存里 */
  function offerDraft() {
    if (!statusEl) return;
    statusEl.style.cursor = 'pointer';
    statusEl.onclick = function () {
      var blob = new Blob([JSON.stringify({ version: 3, values: values, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '未保存课程草稿.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }

  function fail(e) {
    blocked = true;
    status((e && e.message ? e.message : '保存失败') + ' · 点击下载草稿', true);
    offerDraft();
  }

  /* ---------------- 数据 ---------------- */

  function normalize(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) v = {};
    if (!v.mcu_multi_courses_v1) v.mcu_multi_courses_v1 = JSON.stringify(DEFAULT_MCU);
    return v;
  }

  function clone(v) {
    var out = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k];
    return out;
  }

  /* 和原来 Worker 的 validateStores / courseRows 对齐的关键部分：字段只能是 mcu_ 开头的字符串、课程结构合法、课次不超过 20000 */
  function validate(next) {
    if (JSON.stringify(next).length > 4400000) throw new Error('数据超过单次保存上限，请下载草稿后分批整理');
    var courses = null;
    for (var k in next) {
      if (!Object.prototype.hasOwnProperty.call(next, k)) continue;
      if (!/^mcu_[a-zA-Z0-9_]+$/.test(k) || typeof next[k] !== 'string') throw new Error('未知存储字段：' + k);
      if (next[k].length > 2000000) throw new Error('「' + k + '」这一项太大');
      if (!/active_course/.test(k)) {
        var parsed;
        try { parsed = JSON.parse(next[k]); } catch (e) { throw new Error('「' + k + '」不是有效 JSON'); }
        if (!parsed || typeof parsed !== 'object') throw new Error('「' + k + '」应为对象');
        if (k === 'mcu_multi_courses_v1') courses = parsed;
      }
    }
    if (!courses) return next;
    var I = global.CourseImport;
    if (I) courses = I.stabilize(courses);   // 课次身份唯一；重复会直接报错
    var count = 0;
    Object.keys(courses).forEach(function (id) {
      var c = courses[id];
      if (!c || !c.name || !c.classes || typeof c.classes !== 'object') throw new Error('课程结构无效');
      Object.keys(c.classes).forEach(function (cls) {
        var d = c.classes[cls];
        if (!Array.isArray(d.schedule) || !d.records || typeof d.records !== 'object') throw new Error('班级结构无效');
        count += d.schedule.length;
      });
    });
    if (count > 20000) throw new Error('课次超过单次保存限额，请拆分课程');
    next.mcu_multi_courses_v1 = JSON.stringify(courses);   // 存稳定后的课次身份
    return next;
  }

  function counts() {
    try {
      var courses = JSON.parse(values.mcu_multi_courses_v1 || '{}'), out = { courses: 0, classes: 0, lessons: 0, records: 0 };
      Object.keys(courses).forEach(function (id) {
        var c = courses[id]; out.courses++;
        Object.keys(c.classes || {}).forEach(function (cls) {
          var d = c.classes[cls]; out.classes++;
          out.lessons += (d.schedule || []).length;
          out.records += Object.keys(d.records || {}).length;
        });
      });
      return out;
    } catch (e) { return { courses: 0, classes: 0, lessons: 0, records: 0 }; }
  }

  function conflictError(message) {
    var e = new Error(message || '云端数据已被其他设备更新，请刷新页面后再改');
    e.status = 409; e.code = 'version_conflict';
    return e;
  }

  /* CAS 保存：整份 values 交给 kc_save，函数里比对 revision */
  function save(next) {
    if (stale) return Promise.reject(conflictError('云端已经有更新的版本，请刷新页面后再改'));
    var payload;
    try { payload = validate(clone(next)); } catch (e) { return Promise.reject(e); }
    return rpc('kc_save', { p_data: payload, p_rev: revision }).then(function (rev) {
      revision = Number(rev) || revision + 1;
      return revision;
    });
  }

  function flush() {
    clearTimeout(timer);
    if (blocked) return Promise.reject(new Error('云端保存已暂停，请先点右下角下载草稿，再刷新页面'));
    if (writing) return writing.then(function () { return dirty ? flush() : undefined; });
    if (!dirty) return Promise.resolve();
    var submitted = clone(values);
    dirty = false;
    status('正在保存到华夏云端…');
    writing = ensureFresh()
      .then(function () { return save(submitted); })
      .then(function () { status('已保存到华夏云端'); }, function (e) { dirty = true; fail(e); throw e; })
      .then(function () { writing = null; }, function (e) { writing = null; throw e; });
    return writing.then(function () { return dirty ? flush() : undefined; });
  }

  function rowsUrl(select) {
    return REST + '/' + WS + '?owner_id=eq.' + encodeURIComponent(teacher.id) + '&select=' + (select || 'data,revision,updated_at');
  }

  function pull() {
    return ensureFresh().then(function () { return request(rowsUrl('data,revision,updated_at')); }).then(function (rows) {
      var row = (rows && rows[0]) || null;
      return { row: row, revision: Number((row && row.revision) || 0), updated_at: (row && row.updated_at) || null };
    });
  }

  function refresh() {
    return flush().then(pull).then(function (state) {
      values = normalize((state.row && state.row.data) || {});
      revision = state.revision;
      stale = false;
      dirty = false;
      status('已保存到华夏云端');
      return { values: clone(values), revision: revision };
    });
  }

  /* ---------------- localStorage 接管 ---------------- */

  function installStore() {
    var store = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null; },
      setItem: function (k, v) {
        if (!/^mcu_/.test(String(k))) { native.setItem(k, v); return; }
        if (blocked) throw new Error('保存冲突，请先保留草稿');
        if (values[k] === String(v)) return;
        values[k] = String(v);
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(function () { flush().catch(function () {}); }, 600);
      },
      removeItem: function (k) {
        if (!/^mcu_/.test(String(k))) { native.removeItem(k); return; }
        delete values[k];
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(function () { flush().catch(function () {}); }, 600);
      },
      clear: function () { values = {}; dirty = true; },
      key: function (i) { return Object.keys(values)[i] || null; },
      get length() { return Object.keys(values).length; }
    };
    Object.defineProperty(global, 'localStorage', { value: store, configurable: true });
  }

  /* ---------------- 导入草稿（kc_import_drafts） ---------------- */

  function draftUrl() { return REST + '/' + DRAFT + '?owner_id=eq.' + encodeURIComponent(teacher.id); }

  function cleanDraft(body) {
    /* 密钥、图片、原始全文不进数据库（和原来 Worker 一样的清理） */
    var safe = JSON.parse(JSON.stringify(body, function (k, v) {
      return ['images', 'documents', 'key', 'apiKey', 'encrypted_key'].indexOf(k) >= 0 ? undefined : v;
    }));
    return {
      draft: safe.draft,
      selected: Array.isArray(body.selected) ? body.selected : [],
      step: Math.min(4, Math.max(1, Number(body.step) || 1)),
      replace: !!body.replace,
      state: body.state || '待核对'
    };
  }

  function loadDraft() {
    return ensureFresh().then(function () { return request(draftUrl() + '&select=data,updated_at'); }).then(function (rows) {
      var row = (rows && rows[0]) || null;
      return { draft: row ? row.data : null, updatedAt: (row && row.updated_at) || null };
    });
  }

  function saveDraft(body) {
    if (body && body.clear) {
      return ensureFresh()
        .then(function () { return request(draftUrl(), { method: 'DELETE' }); })
        .then(function () { return { ok: true }; });
    }
    if (!body || !body.draft || !Array.isArray(body.draft.groups) || !Array.isArray(body.draft.rules)) {
      return Promise.reject(new Error('草稿结构无效'));
    }
    var safe = cleanDraft(body);
    return ensureFresh().then(function () {
      return request(REST + '/' + DRAFT, {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({ owner_id: teacher.id, data: safe, updated_at: new Date().toISOString() })
      });
    }).then(function () { return { ok: true }; });
  }

  /* ---------------- 导入预览 / 提交（原来是服务端算，现在用页面上的 import-core.js 算） ---------------- */

  function merged(draft, replace) {
    var I = global.CourseImport;
    if (!I) throw new Error('导入模块还没加载，请刷新页面');
    var courses;
    try { courses = JSON.parse(values.mcu_multi_courses_v1 || '{}'); } catch (e) { courses = {}; }
    var result = I.merge(courses, draft, !!replace);
    if (result.report.conflicts) throw conflictError('课次时间冲突，须先核对并解决');
    return result;
  }

  function preview(draft, replace) {
    return flush().then(function () {
      var result = merged(draft, replace);
      return { revision: revision, report: result.report, changes: result.changes, conflicts: result.conflictDetails, courses: result.courses };
    });
  }

  function commit(draft, replace) {
    return flush().then(function () {
      var result = merged(draft, replace);
      var next = clone(values);
      next.mcu_multi_courses_v1 = JSON.stringify(result.courses);
      /* 校历规则并进去重（旧的在前，和原来 Worker 一致） */
      var old = [];
      try { old = JSON.parse(values.mcu_calendar_rules_v1 || '[]'); } catch (e) { old = []; }
      var map = new Map();
      old.concat(result.rules || []).forEach(function (r) { map.set(JSON.stringify(r), r); });
      next.mcu_calendar_rules_v1 = JSON.stringify(Array.from(map.values()));
      values = next;
      dirty = true;
      return flush().then(function () { return { revision: revision, counts: counts(), report: result.report }; });
    });
  }

  /* ---------------- 进度纠正（原来 /api/progress/adjust：读→算→CAS 写） ---------------- */

  function adjust(body) {
    body = body || {};
    return flush().then(function () {
      if (body.revision !== undefined && Number(body.revision) !== revision) throw conflictError('其他设备已更新进度，请重新加载');
      var courses;
      try { courses = JSON.parse(values.mcu_multi_courses_v1 || '{}'); } catch (e) { courses = {}; }
      if (body.tracking) {
        var d = courses[body.courseId] && courses[body.courseId].classes && courses[body.courseId].classes[body.className];
        var anchor = d && (d.schedule || []).filter(function (s) { return s.lessonId === body.tracking.lessonId; })[0];
        var today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
        if (!anchor || anchor.date > today) throw new Error('请选择今天或之前的有效课次作为纠正位置');
      }
      var P = global.CourseProgress;
      if (!P || !P.adjust) throw new Error('进度模块还没加载，请刷新页面');
      var adjusted = P.adjust(courses, body.courseId, body.className, body.tracking === null ? null : Object.assign({}, body.tracking, { updatedAt: new Date().toISOString() }));
      values = clone(values);
      values.mcu_multi_courses_v1 = JSON.stringify(adjusted);
      dirty = true;
      return flush().then(function () { return { revision: revision, counts: counts() }; });
    });
  }

  /* ---------------- 旧接口兼容层（原来的 Worker 路径 → 上面的本地实现） ---------------- */

  function api(path, data, method) {
    method = method || 'POST';
    switch (path) {
      case '/api/workspace':
        if (method === 'GET') {
          return pull().then(function (state) {
            if (state.row && state.revision !== revision) { values = normalize(state.row.data || {}); revision = state.revision; }
            return { values: clone(values), revision: revision, teacher: teacher };
          });
        }
        /* 整体覆盖保存（导入本地备份、移除内置示例用） */
        return flush().then(function () {
          if (data && data.revision !== undefined && Number(data.revision) !== revision) throw conflictError();
          values = normalize(data && data.values ? clone(data.values) : {});
          dirty = true;
          return flush().then(function () { return { revision: revision, counts: counts() }; });
        });
      case '/api/import/preview': return preview(data && data.draft, !!(data && data.replace));
      case '/api/import/commit': return commit(data && data.draft, !!(data && data.replace));
      case '/api/import/draft': return method === 'GET' ? loadDraft() : saveDraft(data);
      case '/api/progress/adjust': return adjust(data);
      case '/api/auth/logout':
        /* 退出只在总入口做，这样四个工具一起退出（这里只清本页，不再跳 login.html） */
        try { native.removeItem(SESSION_KEY); } catch (e) {}
        return Promise.resolve({ ok: true });
      case '/api/invites':
      case '/api/invites/revoke':
        return Promise.reject(new Error('教师邀请码在华夏工具总入口发，这个工具不再自己发码'));
      case '/api/ai/parse':
      case '/api/ai/test':
      case '/api/ai/models':
      case '/api/ai/settings':
      case '/api/ai/transcribe':
        var ai = new Error('这一版没有开启 AI 识别：静态网页没有服务端加密老师的密钥，等做了 Supabase Edge Function 再恢复');
        ai.code = 'ai_disabled';
        return Promise.reject(ai);
      default:
        return Promise.reject(new Error('接口不存在：' + path));
    }
  }

  /* ---------------- 启动 ---------------- */

  function nameOf(u, vals) {
    var own = null;
    try { own = JSON.parse(vals.mcu_teacher_profile_v1 || 'null'); } catch (e) { own = null; }
    if (own && own.name) return own.name;
    var meta = (u && u.user_metadata) || {};
    var email = (u && u.email) || '';
    return meta.display_name || meta.full_name || meta.name || (email ? email.split('@')[0] : '老师');
  }

  function writeCache(row) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(row)); sessionStorage.setItem(GUARD_KEY, String(Date.now())); } catch (e) {}
  }
  /* 只认刚才自己写的那份（30 秒内），免得过一会儿刷新还拿旧数据 */
  function readCache() {
    var raw, guard;
    try { raw = sessionStorage.getItem(CACHE_KEY); guard = Number(sessionStorage.getItem(GUARD_KEY) || 0); } catch (e) { return null; }
    try { sessionStorage.removeItem(CACHE_KEY); sessionStorage.removeItem(GUARD_KEY); } catch (e) {}
    if (!raw || !guard || Date.now() - guard > 30000) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function resolveAccount() {
    return ensureFresh()
      .then(function () { return request(AUTH + '/user'); })
      .then(function (u) {
        session.user = u;
        return rpc('hx_me').then(function (who) {
          if (!who || !who.teacher) {
            var e = new Error((who && who.student)
              ? '这是学生账号。课程进度只给老师用。'
              : '这个华夏工具账号还没开通教师身份，请到总入口用教师邀请码开通后再来。');
            e.code = 'not_teacher';
            throw e;
          }
          return { user: u, admin: !!(who.admin || who.dev) };
        });
      })
      .then(function (ctx) {
        teacher = { id: ctx.user.id, name: '', email: ctx.user.email || '', admin: ctx.admin };
        return request(rowsUrl()).then(function (rows) {
          var row = (rows && rows[0]) || null;
          var vals = normalize((row && row.data) || {});
          teacher.name = nameOf(ctx.user, vals);
          return { uid: ctx.user.id, values: vals, revision: Number((row && row.revision) || 0), name: teacher.name, admin: ctx.admin, email: teacher.email, at: Date.now() };
        });
      });
  }

  function start(cached) {
    values = normalize(cached.values || {});
    revision = Number(cached.revision || 0);
    teacher = { id: cached.uid, name: cached.name || '老师', email: cached.email || '', admin: !!cached.admin };
    installStore();
    onReady(function () {
      status('华夏云端 · ' + teacher.name);
      /* 缓存是十几秒前取的：再核对一次版本，云端更新过就只提示刷新，绝不拿旧数据盖新数据 */
      pull().then(function (state) {
        if (state.revision !== revision) {
          stale = true;
          status('云端有更新的版本 v' + state.revision + '，请刷新页面', true);
        }
      }).catch(function () {});
    });
  }

  function boot() {
    var s = readShared();
    if (!s) {
      showGate('请先在华夏工具登录', '课程进度只给老师用，账号和登录都在华夏工具总入口。登录后回到这里就能看到自己的课表。', true);
      return;
    }
    session = s;
    var cached = readCache();
    /* 缓存里的账号和当前登录不是一个人（中途换过账号）就不用，重新取 */
    if (cached && cached.uid && s.user && s.user.id && cached.uid !== s.user.id) cached = null;
    if (cached) { start(cached); return; }

    showGate('正在读取云端课程数据…', '正在用华夏工具账号读取你的课程工作区。', false);
    resolveAccount()
      .then(function (row) { writeCache(row); location.reload(); })
      .catch(function (e) {
        var why = e && e.message ? e.message : '无法连接华夏工具账号服务';
        if (e && (e.status === 401 || e.code === 'no_session')) {
          try { native.removeItem(SESSION_KEY); } catch (x) {}
          showGate('登录已过期，请重新登录', '请到华夏工具总入口重新登录，再回到课程进度。', true);
        } else if (e && e.code === 'not_teacher') {
          showGate('这个账号不能用课程进度', why, true);
        } else {
          showGate('读不到云端课程数据', why + '。可以点下面重试，或回总入口检查登录。', true);
        }
      });
  }

  global.CourseCloud = {
    api: api,
    flush: flush,
    refresh: refresh,
    snapshot: function () { return { values: clone(values), revision: revision }; },
    preview: preview,
    commit: commit,
    nativeSnapshot: function () {
      var out = {};
      Object.keys(native).forEach(function (k) { if (/^mcu_/.test(k)) out[k] = native.getItem(k); });
      return out;
    },
    migrate: function (v) { return flush().then(function () { return api('/api/workspace', { values: v, revision: revision, kind: 'migration' }); }); },
    status: function () { return { revision: revision, dirty: dirty, blocked: blocked, stale: stale }; }
  };
  /* 登录成功后才有人；上层一直用 CourseCloud.teacher.name / .admin / .id。没登录时给个占位，免得上层取 .name 就崩 */
  var ANON = { id: '', name: '老师', email: '', admin: false };
  Object.defineProperty(global.CourseCloud, 'teacher', { get: function () { return teacher || ANON; }, enumerable: true, configurable: true });

  global.addEventListener('beforeunload', function (e) {
    if (dirty || writing) { e.preventDefault(); e.returnValue = '尚有课程数据未保存'; }
  });

  boot();
})(window);
