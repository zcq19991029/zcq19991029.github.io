/* Supabase 账号与云同步适配层（GitHub Pages 静态托管专用）
 *
 * 只依赖 Supabase 的公开 publishable key（浏览器端匿名 key）：
 *   - 登录 / 注册 / 找回密码 / 第三方登录 / 访客登录 都走 Supabase Auth
 *   - 成绩状态存 public.score_states，按 owner_id 隔离，受 RLS 保护
 * 不使用 service_role，仓库里也没有任何密钥可以绕过 RLS。
 */
(function (global) {
  'use strict';

  var cfg = global.JFDT_CONFIG || {};
  var base = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var key = String(cfg.supabasePublishableKey || '');
  if (!base || !key) {
    try { console.warn('[JFDT] 没有配置 Supabase，登录功能已关闭。'); } catch (e) {}
    return;
  }

  var AUTH = base + '/auth/v1';
  var REST = base + '/rest/v1';
  /* 和排课、接线仿真、华夏工具总入口共用一份登录（同一网站 localStorage），一起登录、一起退出 */
  var SESSION_KEY = 'paike-session';
  var OLD_SESSION_KEY = 'jfdt.supabase.session.v1';
  var SYNC_KEY = 'jfdt.supabase.sync.v1';
  var INVITE_KEY = 'jfdt.hx.invite.v1';
  /* 并入华夏工具项目后表名带 jf_ 前缀，且只有华夏工具教师能用（学生账号挡在登录这一步） */
  var T = String(cfg.tablePrefix || '');
  var HX = !!cfg.hxTeacherGate;

  var session = null;      // { access_token, refresh_token, expires_at, user }
  var user = null;         // Supabase Auth user
  var me = null;           // 应用内使用的 profile
  var binding = null;      // { get, apply, canApply }
  var revision = 0;        // 本机已知的云端版本号
  var pending = null;      // { get } —— 有未上传改动时非空
  var inflight = null, refreshing = null, checking = null, timer = null;
  var listeners = [];
  var state = { mode: 'idle', text: '' };
  var conflictDetails = [];
  var checkedAt = 0, serverTime = null;
  var providersCache = null;
  var bootHandlers = null;   // boot() 传进来的回调：登录成功后用它把界面切进应用

  /* ---------------- 基础工具 ---------------- */

  var MESSAGES = {
    invalid_credentials: '邮箱或密码不对，请再试一次。',
    email_not_confirmed: '这个邮箱还没确认，请先点开注册邮件里的确认链接。',
    email_exists: '这个邮箱已经注册过了，直接登录就行。',
    user_already_exists: '这个邮箱已经注册过了，直接登录就行。',
    weak_password: '密码太短或太常见，请换一个至少 6 位的密码。',
    over_email_send_rate_limit: '确认邮件发得太频繁（Supabase 免费发信有上限）。请等一会儿再试；如果站点用数字账号、不需要邮箱确认，请管理员在 Supabase 后台关掉 Confirm email。',
    over_request_rate_limit: '操作太频繁，请稍等一下再试。',
    signup_disabled: '站点暂时关闭了新用户注册。',
    anonymous_provider_disabled: '访客登录还没在 Supabase 后台开启。',
    validation_failed: '请检查填写的内容是否完整、格式是否正确。',
    same_password: '新密码不能和原来的密码相同。',
    session_not_found: '登录已过期，请重新登录。',
    reauthentication_needed: '为了安全，请重新登录后再试。'
  };

  function emit(mode, text) {
    state = {
      mode: mode, text: text || '', at: Date.now(),
      cloudVersion: revision, checkedAt: checkedAt, serverTime: serverTime,
      pending: !!pending, conflicts: conflictDetails.slice(), conflictDetails: conflictDetails.slice()
    };
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function request(url, options) {
    options = options || {};
    var headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, options.headers || {});
    if (options.token !== false && session && session.access_token) {
      headers.Authorization = 'Bearer ' + session.access_token;
    }
    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body,
      cache: 'no-store',
      credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (text) {
        var body = null;
        if (text) { try { body = JSON.parse(text); } catch (e) { body = { raw: text }; } }
        if (!res.ok) {
          var code = (body && (body.error_code || body.code || body.error)) || '';
          var raw = (body && (body.msg || body.message || body.error_description)) || ('请求失败（HTTP ' + res.status + '）');
          var err = new Error(MESSAGES[code] || raw);
          err.status = res.status;
          err.code = code;
          err.body = body;
          throw err;
        }
        return body;
      });
    }, function () {
      var err = new Error('连不上网络，请检查网络后重试。');
      err.code = 'network';
      throw err;
    });
  }

  /* ---------------- 会话 ---------------- */

  function readShared() {
    try {
      var saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return saved && saved.access_token ? saved : null;
    } catch (e) { return null; }
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
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
    return session;
  }

  /* shared=true 才清共用登录（退出、登录真的失效）；学生被拒、断网只丢本页内存，不把其他工具踢下线 */
  function forget(shared) {
    session = null; user = null; me = null; revision = 0; pending = null;
    if (shared) try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function restore() {
    try {
      if (!readShared()) {
        var old = JSON.parse(localStorage.getItem(OLD_SESSION_KEY) || 'null');
        if (old && old.access_token) localStorage.setItem(SESSION_KEY, JSON.stringify(old));
      }
      localStorage.removeItem(OLD_SESSION_KEY);
    } catch (e) {}
    var saved = readShared();
    if (saved) { session = saved; return true; }
    return false;
  }

  function expired(s) {
    return !!(s.refresh_token && !(s.expires_at && s.expires_at - 60 > Date.now() / 1000));
  }

  function ensureFresh() {
    if (!session) {
      var err = new Error('请先登录。'); err.code = 'no_session';
      return Promise.reject(err);
    }
    if (refreshing) return refreshing;
    /* 续期前先重读共用登录：别的工具可能刚续过（续期后旧 refresh token 作废，拿旧的再续整组会被踢下线） */
    var shared = readShared();
    if (shared && shared.access_token !== session.access_token) session = shared;
    if (!expired(session)) return Promise.resolve(session);
    var used = session.refresh_token;
    refreshing = request(AUTH + '/token?grant_type=refresh_token', {
      method: 'POST', token: false,
      body: JSON.stringify({ refresh_token: used })
    }).then(function (s) {
      remember(s);
      return session;
    }).catch(function (e) {
      /* 同一时刻别的页面抢先续上了：用它的 */
      var now = readShared();
      if (now && now.refresh_token !== used && !expired(now)) { session = now; return session; }
      forget(e.code !== 'network');
      throw e;
    }).finally(function () { refreshing = null; });
    return refreshing;
  }

  /* OAuth / 邮件链接回跳：token 在 #hash 里，读完立刻从地址栏抹掉 */
  function adoptUrlSession() {
    var hash = String((global.location && global.location.hash) || '').replace(/^#/, '');
    if (!hash) return null;
    var params = {};
    hash.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      try { params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {}
    });
    var clean = function () {
      try { history.replaceState(null, '', global.location.pathname + global.location.search); } catch (e) {}
    };
    if (params.error || params.error_description) {
      clean();
      return { error: MESSAGES[params.error_code] || params.error_description || '登录没有完成，请重试。' };
    }
    if (!params.access_token) return null;
    remember(params);
    clean();
    return { type: params.type || 'oauth' };
  }

  /* ---------------- 账号资料 ---------------- */

  function toProfile(u, row) {
    var meta = u.user_metadata || {};
    var email = u.email || '';
    var anonymous = !!u.is_anonymous || (!email && !meta.provider_id && !meta.full_name);
    var fallbackName = meta.display_name || meta.full_name || meta.name || (email ? email.split('@')[0] : '老师');
    return {
      uid: u.id,
      email: email,
      anonymous: anonymous,
      username: (row && row.username) || meta.username || (email ? email.split('@')[0] : 'guest'),
      displayName: (row && row.display_name) || fallbackName,
      realName: (row && row.real_name) || meta.real_name || '',
      role: (row && row.role) || 'teacher',
      isAdmin: !!(row && row.role === 'admin'),
      avatarUrl: meta.avatar_url || ''
    };
  }

  /* 华夏工具身份：已是教师直接放行；不是的话用注册时填的教师邀请码开通，没有码就拒绝登录 */
  function ensureTeacher() {
    if (!HX) return Promise.resolve();
    return request(REST + '/rpc/hx_me', { method: 'POST', body: '{}' }).then(function (who) {
      if (who && who.teacher) return;
      var code = '';
      try { code = localStorage.getItem(INVITE_KEY) || ''; } catch (e) {}
      if (!code) {
        var err = new Error(who && who.student
          ? '这是学生账号，夜夜加分助手只给老师用。'
          : '这个账号还没开通华夏工具教师身份：请用管理员发的教师邀请码注册，或请管理员开通。');
        err.code = 'not_teacher';
        throw err;
      }
      return request(REST + '/rpc/hx_redeem', { method: 'POST', body: JSON.stringify({ p_code: code }) }).then(function (role) {
        try { localStorage.removeItem(INVITE_KEY); } catch (e) {}
        if (role !== 'teacher') {
          var err = new Error('这个邀请码不是教师邀请码。');
          err.code = 'not_teacher';
          throw err;
        }
      }, function (e) {
        try { localStorage.removeItem(INVITE_KEY); } catch (x) {}
        e.code = e.code || 'not_teacher';
        throw e;
      });
    });
  }

  function loadProfile() {
    return request(REST + '/' + T + 'profiles?id=eq.' + encodeURIComponent(user.id) + '&select=id,username,display_name,real_name,role')
      .then(function (rows) {
        if ((rows && rows[0]) || !HX) return toProfile(user, rows && rows[0]);
        /* 新项目没有注册触发器：第一次登录时补建资料行（成绩行由首次同步补建） */
        var meta = user.user_metadata || {};
        var email = user.email || '';
        return request(REST + '/' + T + 'profiles', {
          method: 'POST',
          headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
          body: JSON.stringify({
            id: user.id,
            username: null, // 账号名唯一，和迁入的老账号撞名会建不成行；界面改用 Auth 里的账号名
            display_name: meta.display_name || meta.full_name || meta.name || '',
            real_name: meta.real_name || ''
          })
        }).then(function (out) { return toProfile(user, out && out[0]); });
      })
      .catch(function (e) {
        /* 资料行还没建好也不能挡住上课，退化为只用 Auth 里的资料 */
        if (e.status === 401) throw e;
        return toProfile(user, null);
      });
  }

  /* ---------------- 成绩状态 ---------------- */

  function payloadOf(s) {
    return {
      version: 1,
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || null,
      classes: s.classes || [],
      lessons: s.lessons || [],
      undo: s.undo || [],
      redo: s.redo || [],
      operationLog: s.operationLog || []
    };
  }

  function hashOf(value) {
    var text;
    try { text = JSON.stringify(value); } catch (e) { text = ''; }
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(16) + ':' + text.length;
  }

  function comparePayload(value) {
    var copy;
    try { copy = JSON.parse(JSON.stringify(value || {})); } catch (e) { return value; }
    if (copy && typeof copy === 'object') { delete copy.updatedAt; delete copy.createdAt; }
    return copy;
  }

  /* 生成可读的字段级冲突清单，避免只显示版本不同却无法定位。 */
  function diffValues(local, remote, path, limit, out) {
    limit = Number(limit) || 80;
    out = out || [];
    if (out.length >= limit) return out;
    if (hashOf(local) === hashOf(remote)) return out;
    var lo = local && typeof local === 'object' ? local : null;
    var ro = remote && typeof remote === 'object' ? remote : null;
    if (Array.isArray(lo) || Array.isArray(ro)) {
      var max = Math.max(lo ? lo.length : 0, ro ? ro.length : 0);
      for (var i = 0; i < max && out.length < limit; i++) diffValues(lo && lo[i], ro && ro[i], (path || '') + '/' + i, limit, out);
      if (!out.length) out.push({ path: path || '/', local: local, remote: remote });
      return out;
    }
    if (lo && ro) {
      var keys = Object.keys(lo).concat(Object.keys(ro)).filter(function (k, i, a) { return a.indexOf(k) === i; });
      keys.forEach(function (k) { if (out.length < limit) diffValues(lo[k], ro[k], (path || '') + '/' + k, limit, out); });
      return out;
    }
    out.push({ path: path || '/', local: local, remote: remote });
    return out;
  }

  function readSyncStamp() {
    try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { return null; }
  }

  function writeSyncStamp(data) {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify({ hash: hashOf(comparePayload(payloadOf(data))), at: Date.now(), revision: revision })); } catch (e) {}
  }

  function rowsFor(extra) {
    return REST + '/' + T + 'score_states?owner_id=eq.' + encodeURIComponent(user.id) + '&select=data,revision,updated_at' + (extra || '');
  }

  function pull() {
    if (!user) return Promise.reject(new Error('请先登录。'));
    return ensureFresh().then(function () {
      return request(rowsFor());
    }).then(function (rows) {
      var row = (rows && rows[0]) || { data: null, revision: 0, updated_at: null };
      revision = Number(row.revision || 0);
      serverTime = row.updated_at || null;
      return row;
    });
  }

  function currentBind() {
    if (pending && pending.get) return pending;
    if (binding && binding.get) return binding;
    return null;
  }

  function flush() {
    if (inflight) return inflight;
    var bind = currentBind();
    if (!bind || !user) return Promise.resolve({ ok: true, unchanged: true });
    var snapshot = payloadOf(bind.get() || {});

    inflight = ensureFresh()
      .then(function () {
        return request(REST + '/' + T + 'score_states?owner_id=eq.' + encodeURIComponent(user.id) + '&select=revision,updated_at,data');
      })
      .then(function (rows) {
        var row = (rows && rows[0]) || null;
        var remote = row ? Number(row.revision || 0) : 0;
        if (row && remote !== revision) {
          conflictDetails = diffValues(comparePayload(snapshot), comparePayload(row.data), '', 80);
          if (!conflictDetails.length) conflictDetails = [
            { path: '/版本', local: '本机未上传改动', remote: '云端 v' + remote },
            { path: '/本机概况', local: '班级 ' + ((snapshot.classes || []).length) + ' 个，课次 ' + ((snapshot.lessons || []).length) + ' 个', remote: row.data ? '云端数据已返回但无可展开字段' : '云端数据未返回（请点击核对重试）' }
          ];
          emit('conflict', '同步冲突：云端已被另一台设备更新');
          var err = new Error('云端有更新的版本（v' + remote + '），已暂停上传以免覆盖。请到「数据与同步」核对。');
          err.code = 'version_conflict';
          throw err;
        }
        var body = {
          owner_id: user.id, data: snapshot, revision: revision + 1,
          updated_at: new Date().toISOString()
        };
        var url = row ? REST + '/' + T + 'score_states?owner_id=eq.' + encodeURIComponent(user.id) : REST + '/' + T + 'score_states';
        return request(url, {
          method: row ? 'PATCH' : 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(body)
        }).then(function (out) {
          /* 资料行存在但记录还没建（例如注册触发器没装）：补一条 */
          if (row && Array.isArray(out) && !out.length) {
            return request(REST + '/' + T + 'score_states', {
              method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body)
            });
          }
          return out;
        });
      })
      .then(function () {
        revision += 1;
        pending = null;
        serverTime = new Date().toISOString();
        writeSyncStamp(snapshot);
        emit('ok', '已同步到 Supabase · v' + revision);
        return { ok: true, revision: revision };
      })
      .catch(function (e) {
        if (e.code !== 'version_conflict') emit('error', e.message || '同步失败');
        throw e;
      })
      .finally(function () { inflight = null; });

    return inflight;
  }

  function touch(getter) {
    pending = { get: getter || (binding && binding.get) };
    clearTimeout(timer);
    emit('saving', '正在同步…');
    timer = setTimeout(function () { flush().catch(function () {}); }, 300);
  }

  function checkLatest(getter, apply) {
    if (!user) return Promise.resolve(false);
    if (checking) return checking;
    checking = ensureFresh()
      .then(function () { return request(rowsFor()); })
      .then(function (rows) {
        var row = (rows && rows[0]) || null;
        var remote = row ? Number(row.revision || 0) : 0;
        checkedAt = Date.now();
        if (!row || remote === revision) {
          emit('ok', '云端已是最新 · v' + revision);
          return true;
        }
        if (pending || inflight) {
          var local = getter ? payloadOf(getter() || {}) : null;
          conflictDetails = diffValues(comparePayload(local), comparePayload(row.data), '', 80);
          if (!conflictDetails.length) conflictDetails = [{ path: '/版本', local: '本机还有未上传改动', remote: '云端 v' + remote }];
          emit('conflict', '同步冲突：请先查看本机和云端差异');
          return false;
        }
        revision = remote;
        serverTime = row.updated_at || null;
        writeSyncStamp(row.data);
        if (apply && row.data) apply(row);
        emit('ok', '已同步云端最新版 · v' + revision);
        return true;
      })
      .catch(function (e) {
        emit('error', e.message || '核对云端失败');
        return false;
      })
      .finally(function () { checking = null; });
    return checking;
  }

  function hasConflict(record, local) {
    if (!record || !record.data || !local) return false;
    var stamp = readSyncStamp();
    if (!stamp || !stamp.hash) return false;
    var remoteHash = hashOf(comparePayload(record.data)), localHash = hashOf(comparePayload(local));
    var stampMatches = stamp.hash === remoteHash || stamp.hash === localHash || stamp.hash === hashOf(record.data) || stamp.hash === hashOf(local);
    return remoteHash !== localHash && !stampMatches;
  }

  function acceptRemote(record) {
    revision = Number((record && record.revision) || revision || 0);
    serverTime = (record && record.updated_at) || serverTime;
    if (record && record.data) writeSyncStamp(record.data);
    return revision;
  }

  /* ---------------- 登录动作 ---------------- */

  function startSession() {
    return request(AUTH + '/user').then(function (u) {
      user = u;
      return ensureTeacher().then(loadProfile);
    }).then(function (p) {
      me = p;
      return pull().then(function (record) {
        return { profile: p, record: record };
      }, function () {
        return { profile: p, record: { data: null, revision: 0, updated_at: null } };
      });
    }).catch(function (e) {
      forget(e.status === 401 || e.code === 'session_not_found');
      throw e;
    });
  }

  /* 登录/注册/访客成功后的统一收尾：把界面切进应用，而不是停在登录页 */
  function afterLogin(result, message) {
    emit('ok', message || '已连接 Supabase');
    if (bootHandlers && bootHandlers.onReady) bootHandlers.onReady(result.profile, result.record);
    return result.profile;
  }

  /* 华夏工具的账号名（排课里设的，例如 11445）优先：查到就用那个账号的登录邮箱；查不到再按 账号@jfdt.app */
  function loginEmail(email) {
    var address = String(email || '').trim();
    var domain = '@' + String(cfg.accountDomain || '').replace(/^@/, '').toLowerCase();
    if (!HX || domain === '@' || address.toLowerCase().slice(-domain.length) !== domain) return Promise.resolve(address);
    var name = address.slice(0, -domain.length);
    return request(REST + '/rpc/paike_login_email', { method: 'POST', token: false, body: JSON.stringify({ p_name: name }) })
      .then(function (found) { return found || address; }, function () { return address; });
  }

  function login(email, password) {
    return loginEmail(email).then(function (address) {
      return request(AUTH + '/token?grant_type=password', {
        method: 'POST', token: false,
        body: JSON.stringify({ email: address, password: String(password || '') })
      });
    }).then(function (s) {
      remember(s);
      return startSession();
    }).then(function (result) { return afterLogin(result); });
  }

  function register(email, password, name, inviteCode) {
    var address = String(email || '').trim();
    /* 教师邀请码先存本机：注册后立即兑换；要邮箱确认的，确认后第一次登录时兑换 */
    if (HX && inviteCode) { try { localStorage.setItem(INVITE_KEY, String(inviteCode).trim().toUpperCase()); } catch (e) {} }
    var options = { data: { username: address.split('@')[0], display_name: String(name || '').trim() } };
    if (global.location && /^https?:$/.test(global.location.protocol)) {
      options.email_redirect_to = global.location.origin + global.location.pathname;
    }
    return request(AUTH + '/signup', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: address, password: String(password || ''), data: options.data, options: options })
    }).catch(function (e) {
      /* 华夏工具里已有账号（比如注册过但邀请码填错了）：用这组账号密码登录，顺便兑换邀请码 */
      if (HX && inviteCode && (e.code === 'user_already_exists' || e.code === 'email_exists')) return { relogin: true };
      throw e;
    }).then(function (res) {
      if (res && res.relogin) return login(address, password);
      if (res && res.access_token) {
        remember(res);
        return startSession().then(function (result) { return afterLogin(result, '账号已建好，已连接 Supabase'); });
      }
      var fake = cfg.accountDomain && /@/.test(address) && address.split('@')[1].toLowerCase() === String(cfg.accountDomain).replace(/^@/, '').toLowerCase();
      var err = new Error(fake
        ? '后台要求邮箱确认，数字账号收不到确认邮件。请改用自己的真实邮箱注册。'
        : '注册信息已提交。若后台要求邮箱确认，请点开邮件里的确认链接，然后回来登录。');
      err.code = 'confirm_email';
      throw err;
    });
  }

  function resetPasswordFor(email) {
    var options = {};
    if (global.location && /^https?:$/.test(global.location.protocol)) {
      options.redirect_to = global.location.origin + global.location.pathname;
    }
    return request(AUTH + '/recover', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: String(email || '').trim(), ...options })
    }).then(function () { return true; }, function (e) {
      /* 不向外暴露"这个邮箱有没有注册过"：没注册也照常提示已发送 */
      if (e && (e.code === 'user_not_found' || e.status === 404)) return true;
      throw e;
    });
  }

  function signInWithProvider(provider) {
    if (!global.location) throw new Error('当前环境无法跳转第三方登录。');
    var target = global.location;
    var redirect = global.location.origin + global.location.pathname;
    /* 嵌在总入口的 iframe 里时，GitHub 登录页不让在框里打开：整页跳转，同源的话登完回到总入口（它收下凭证写进 paike-session） */
    try {
      if (global.top && global.top !== global) {
        target = global.top.location;
        if (target.origin === global.location.origin) redirect = target.origin + target.pathname;
      }
    } catch (e) {}
    var url = AUTH + '/authorize?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(redirect);
    target.assign(url);
  }

  function signInAnonymously() {
    return request(AUTH + '/signup', { method: 'POST', token: false, body: '{}' }).then(function (res) {
      if (!res || !res.access_token) {
        var err = new Error('访客登录没有拿到会话，请在 Supabase 后台开启匿名登录。');
        err.code = 'anonymous_provider_disabled';
        throw err;
      }
      remember(res);
      return startSession();
    }).then(function (result) { return afterLogin(result, '已用访客身份进入（记录同样保存到云端）'); });
  }

  function updateProfile(name, realName) {
    var display = String(name || '').trim();
    var real = String(realName || '').trim();
    return ensureFresh().then(function () {
      return request(REST + '/' + T + 'profiles?id=eq.' + encodeURIComponent(user.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ display_name: display, real_name: real, last_seen_at: new Date().toISOString() })
      });
    }).then(function (rows) {
      me = toProfile(user, (rows && rows[0]) || null);
      if (!rows || !rows.length) { me.displayName = display; me.realName = real; }
      return me;
    });
  }

  function changePassword(oldPassword, newPassword) {
    return ensureFresh().then(function () {
      return request(AUTH + '/user', { method: 'PUT', body: JSON.stringify({ password: String(newPassword || '') }) });
    });
  }

  /* 修改密码前先确认原密码：重新登录一次，失败就不放行 */
  function verifyPassword(password) {
    if (!me || !me.email) return Promise.resolve(true);
    return request(AUTH + '/token?grant_type=password', {
      method: 'POST', token: false,
      body: JSON.stringify({ email: me.email, password: String(password || '') })
    }).then(function (s) { remember(s); return true; });
  }

  function signOut() {
    var done = function () { forget(true); global.location.reload(); };
    if (!session) { done(); return; }
    request(AUTH + '/logout', { method: 'POST' }).then(done, done);
  }

  function providers() {
    if (providersCache) return providersCache;
    providersCache = request(AUTH + '/settings', { token: false }).then(function (s) {
      var ext = (s && s.external) || {};
      return {
        email: !!ext.email,
        github: !!ext.github,
        google: !!ext.google,
        guest: !!ext.anonymous_users,
        signup: !(s && s.disable_signup)
      };
    }).catch(function () {
      return { email: true, github: false, google: false, guest: false, signup: true };
    });
    return providersCache;
  }

  /* ---------------- 管理员 ---------------- */

  var admin = {
    canInvite: false,
    listInvites: function () { return Promise.resolve([]); },
    createInvites: function () {
      return Promise.reject(new Error('现在老师用邮箱自助注册，不需要邀请码。'));
    },
    listTeachers: function () {
      return ensureFresh().then(function () {
        return Promise.all([
          request(REST + '/' + T + 'profiles?select=id,username,display_name,real_name,role,last_seen_at&order=created_at.asc'),
          request(REST + '/' + T + 'score_states?select=owner_id,data,updated_at')
        ]);
      }).then(function (out) {
        var profiles = out[0] || [], states = out[1] || [];
        var byOwner = {};
        states.forEach(function (r) { byOwner[r.owner_id] = r; });
        return profiles.map(function (p) {
          var row = byOwner[p.id] || null;
          var data = (row && row.data) || null;
          var lessons = (data && data.lessons) || [];
          return {
            uid: p.id,
            username: p.username || '',
            display_name: p.display_name || p.real_name || p.username || '未命名老师',
            real_name: p.real_name || '',
            is_admin: p.role === 'admin',
            class_count: ((data && data.classes) || []).length,
            lesson_count: lessons.length,
            synced_at: (row && row.updated_at) || null,
            last_seen_at: p.last_seen_at || null
          };
        });
      });
    },
    getState: function (uid) {
      return ensureFresh().then(function () {
        return request(REST + '/' + T + 'score_states?owner_id=eq.' + encodeURIComponent(uid) + '&select=data,revision,updated_at');
      }).then(function (rows) {
        var row = (rows && rows[0]) || null;
        return { ok: !!row, data: row && row.data, revision: row && row.revision, updated_at: row && row.updated_at };
      });
    }
  };

  /* ---------------- 启动 ---------------- */

  /* 只读调用华夏工具的数据库函数（首页班级名单 hx_my_classes / hx_class_students）
     ---------- 班级名单短缓存（2026-11-11 降载） ----------
     每次页面切回前台都会重读一遍「首页班级 + 每个班的名单」，是 N+1 次请求（8 个班 = 9 次）；
     而这两样东西只有老师在首页偶尔改一次 → 5 分钟内直接吃缓存，命中时 0 请求。
     · key 带 userId：同一台电脑换账号绝不串号；带版本号：结构变了把 RC_V 升一位整体作废；
     · 只缓存这两个只读函数（白名单）。成绩 / 课次 / 快照 / 互评一律不缓存 —— 那些随时在变；
     · 总入口改名单（加人 / 删人 / 导入 / 改班级工具）会写一个 hx-roster-bust 时间戳，
       这里比缓存时间新就整份作废，老师改完回加分立刻能看到；
     · 任何异常一律当未命中，直接走网络；读失败也不写缓存（别把「空名单」钉 5 分钟）。 */
  var RC_V = 'v1', RC_TTL = 300000;
  var RC_NAMES = { hx_my_classes: 1, hx_class_students: 1 };
  var RC_BUST = 'hx-roster-bust';
  function rcUid() {
    try { return (session && session.user && session.user.id) || 'anon'; } catch (e) { return 'anon'; }
  }
  function rcKey(name, args) {
    var k = (args && args.p_class != null) ? String(args.p_class) : 'all';
    return 'hx-cache-' + RC_V + '-jf-' + name + '-' + rcUid() + '-' + k;
  }
  function rcGet(key) {
    try {
      var o = JSON.parse(localStorage.getItem(key));
      if (!o || !o.t || Date.now() - o.t >= RC_TTL) return null;
      var bust = +(localStorage.getItem(RC_BUST) || 0);   // 总入口刚改过名单 → 整份作废
      if (bust && bust > o.t) return null;
      return o.v;
    } catch (e) { return null; }
  }
  function rcSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v })); } catch (e) { }
  }
  function rpc(name, args, opts) {
    /* 先 ensureFresh 再查缓存：它会重读共用登录（别的工具刚切过账号 / 续过期），
       缓存 key 里的 userId 必须按「现在是谁」算，否则刚切账号的第一次读会拿到上一个人的名单。
       会话有效时这一步不发请求，命中缓存仍然 0 请求。
       opts.fresh = true → 跳过缓存直接打网络（2026-11-11 修：老师点「刷新」按钮必须看到云端真身，
       否则点了没反应；缓存只服务于「没在操作时的自动读取」，绝不能挡用户主动要新数据）。 */
    var fresh = !!(opts && opts.fresh);
    return ensureFresh().then(function () {
      var ck = (RC_NAMES[name] && !fresh) ? rcKey(name, args) : null;
      if (ck) {
        var hit = rcGet(ck);
        if (hit !== null) return hit;
      }
      return request(REST + '/rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) }).then(function (v) {
        /* fresh 读回来的也要写缓存：老师刷新一次，接下来 5 分钟的自动读就能省掉 */
        if (v != null && (!Array.isArray(v) || v.length)) {
          var wk = RC_NAMES[name] ? rcKey(name, args) : null;
          if (wk) rcSet(wk, v);
        }
        return v;
      });
    });
  }

  function boot(handlers) {
    handlers = handlers || {};
    bootHandlers = handlers;
    var fromUrl = adoptUrlSession();
    if (fromUrl && fromUrl.error) {
      emit('error', fromUrl.error);
      if (handlers.onNeedLogin) handlers.onNeedLogin(fromUrl.error);
      return;
    }
    var recovered = !!(fromUrl && fromUrl.type === 'recovery');
    if (!session && !restore()) {
      emit('idle', '');
      if (handlers.onNeedLogin) handlers.onNeedLogin('');
      return;
    }
    ensureFresh()
      .then(function () { return request(AUTH + '/user'); })
      .then(function (u) { user = u; return ensureTeacher().then(loadProfile); })
      .then(function (p) {
        me = p;
        return pull().then(function (record) {
          if (recovered && handlers.onRecover) {
            emit('ok', '请设置新密码');
            handlers.onRecover(me);
            return;
          }
          emit('ok', '已连接 Supabase');
          if (handlers.onReady) handlers.onReady(me, record);
        });
      })
      .catch(function (e) {
        var why = (e && (e.status === 401 || e.code === 'session_not_found'))
          ? '登录已过期，请重新登录。'
          : (e && e.message ? e.message : '无法连接账号服务');
        forget(!!(e && (e.status === 401 || e.code === 'session_not_found')));
        emit('error', why);
        if (handlers.onNeedLogin) handlers.onNeedLogin(why);
      });
  }

  global.JFDT_CLOUD = {
    generation: 4,
    provider: 'supabase',
    available: function () { return true; },
    boot: boot,
    login: login,
    register: register,
    resetPasswordFor: resetPasswordFor,
    signInWithProvider: signInWithProvider,
    signInAnonymously: signInAnonymously,
    providers: providers,
    signOut: signOut,
    changePassword: changePassword,
    verifyPassword: verifyPassword,
    updateProfile: updateProfile,
    profile: function () { return me; },
    bindState: function (b) { binding = b; },
    touch: touch,
    flush: flush,
    forcePush: function (getter) { pending = { get: getter || (binding && binding.get) }; return flush(); },
    cancelPending: function () {
      if (inflight) return false;
      pending = null; clearTimeout(timer); return true;
    },
    isDirty: function () { return !!(pending || inflight); },
    pull: pull,
    rpc: rpc,
    checkLatest: checkLatest,
    acceptRemote: acceptRemote,
    hasConflict: hasConflict,
    reportConflict: function (list) {
      if (Array.isArray(list)) conflictDetails = list;
      emit('conflict', '同步冲突：请先备份并处理');
    },
    getConflictDetails: function (record, local) {
      try { return diffValues(comparePayload(local), comparePayload(record && record.data), '', 80) || []; } catch (e) { return []; }
    },
    status: function () { return state; },
    onStatus: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
    },
    onStatusChange: function (fn) { listeners.push(fn); },
    version: function () { return revision; },
    admin: admin
  };
})(window);
