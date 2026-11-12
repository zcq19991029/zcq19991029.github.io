/* 华夏工具 · 音乐播放器（2026-11-09 初稿）
   ── 为什么单独一个文件放站点根 ──
   总入口、/music/ 独立页都要用同一份逻辑：歌单、当前曲、音量只能有一份状态，
   否则首页调了音量、换个页面又变回去。所以和 hx-theme.js / hx-ai.js 一样放站点根，谁需要谁引。
   ── 音频挂在哪（这是整个设计的支点）──
   总入口切工具是 iframe 显示/隐藏，不是整页跳转，所以 <audio> 放在 **top window** 就不会断：
   从单片机切到考试、从考试切到刷题，音乐一直放着，顶部那条控制条跟着走。
   工具页被 iframe 嵌着时（window.top !== window）**不渲染任何 UI** —— 顶部那条由总入口负责，
   否则每个 iframe 里各长一条，页面上会出现两三条一样的控制条。
   ── 歌单存哪 ──
   IndexedDB（库 'hx-music'）：meta 只存元信息、blob 存音频本体，分两个 store。
   列出歌单时不去碰 blob —— 20 首 5MB 的歌不会一次性读进内存（那是 100MB）。
   当前曲 / 进度 / 音量存 localStorage，换页面回来能接着放（浏览器不允许无手势自动播，见 resume()）。
   ── 支持什么格式 ──
   只认浏览器自己能解的：**mp3 最稳**（全平台、老 Safari 也行）；m4a/aac 次之；ogg/opus 在 Safari 不保险；
   wav/flac 体积太大、解码吃内存。导入时按扩展名+type 挡一道，真正能不能放以 <audio> 的 error 为准。
   ── 对外接口（给总入口卡片、/music/ 页面用）──
   HXPlayer.list() / add(files) / remove(id) / clear()
   HXPlayer.play(i) / toggle() / next() / prev() / seek(秒) / volume(0~1) / mute(bool)
   HXPlayer.state() / on(fn)
   HXPlayer.bar(el)     往 el 里渲染一条紧凑控制条（首页卡、顶部条）
   HXPlayer.panel(el)   往 el 里渲染完整面板（封面 + 进度 + 歌单）
   HXPlayer.topBar()    工具页顶部那条（自己挂到 body，可重复调用）
*/
(function (W, D) {
  'use strict';
  if (W.HXPlayer) return;                       // 重复引入只认第一份

  var DB = 'hx-music', META = 'meta', BLOB = 'blob', VER = 2;
  var LSS = 'hx-music-state';                   // {id, t, vol, muted, mode}
  var EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;

  /* ---------------- 云端（Supabase 音乐云歌库，2026-11-09）----------------
     换电脑歌跟着走：登录后歌单从云上拉（表 hx_music_track 只存元信息 + path，音频本体在 Storage 桶
     hx-music 公开可读）。身份、权限、学生 1 首限额全部在数据库函数里挡（hx_music_list/save/del/
     publish_default/quota），前端只负责「拉歌单 → 拼公开 URL 播放 → 上传登记」。
     未登录时整段退化为纯本地 IndexedDB（现有行为一字不改）。 */
  var SUPA = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co',
    SKEY_PUB = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd',
    SKEY_SESS = 'paike-session';

  var A = null;                                 // 唯一的 <audio>
  /* mode：'list' 列表循环（默认，播完自动下一首、到底回开头）/ 'one' 单曲循环 / 'shuffle' 随机 */
  var S = { list: [], i: -1, playing: false, cur: 0, dur: 0, vol: 0.8, muted: false, mode: 'list', ready: false, err: '', exited: false };
  var subs = [], hosts = [], curURL = '', wantResume = false, dbp = null;

  /* ---------------- 存储 ---------------- */
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(BLOB)) d.createObjectStore(BLOB, { keyPath: 'id' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  /* 把整个事务交给 fn（fn 里自己 t.objectStore('meta')），等事务真正提交后再把 fn 的返回值交出去。
     注意 fn 可能返回 Promise（读 blob 的 get 要等 onsuccess），所以这里要等它落定 ——
     直接 resolve 原 Promise 的话调用方拿到的是 Promise 不是数据。 */
  function tx(db, stores, mode, fn) {
    return new Promise(function (res, rej) {
      var t = db.transaction(stores, mode), ret;
      var settled = false, failed = null;
      t.oncomplete = function () {
        if (failed) return;
        if (ret && typeof ret.then === 'function') {
          ret.then(function (v) { res(v); }, function (e) { rej(e); });
        } else { res(ret); }
      };
      t.onerror = function () { if (!settled) { settled = true; rej(t.error); } };
      t.onabort = function () { if (!settled) { settled = true; rej(failed || t.error); } };
      try { ret = fn(t); } catch (e) { failed = e; try { t.abort(); } catch (x) { } if (!settled) { settled = true; rej(e); } }
    });
  }
  function wrap(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function lsGet() {
    try { return JSON.parse(localStorage.getItem(LSS) || 'null') || {}; } catch (e) { return {}; }
  }
  function lsSet(o) {
    try { localStorage.setItem(LSS, JSON.stringify(o)); } catch (e) { }
  }
  function saveState() {
    lsSet({ id: curId(), t: Math.round(S.cur * 10) / 10, vol: S.vol, muted: S.muted, mode: S.mode });
  }
  function curId() { var t = S.list[S.i]; return t ? t.id : null; }

  /* ---------------- 云端 API ---------------- */
  function tok() {
    try { var s = JSON.parse(localStorage.getItem(SKEY_SESS) || 'null'); return (s && s.access_token) || ''; } catch (e) { return ''; }
  }
  function cloudOn() { return !!tok(); }
  /* 云端曲目公开 URL：Storage 桶 hx-music 是 public，直接拼公开地址，不用签名 */
  function cloudURL(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return SUPA + '/storage/v1/object/public/hx-music/' + encodeURI(path);
  }
  function rpc(name, body) {
    var t = tok(); if (!t) return Promise.reject(new Error('没登录'));
    return fetch(SUPA + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: SKEY_PUB, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (x) {
        var j = null; try { j = x ? JSON.parse(x) : null; } catch (e) { j = x; }
        if (!r.ok) {
          var m = String(j && (j.message || j.msg) || ('HTTP ' + r.status)).replace(/JWT expired/i, '登录过期了');
          throw new Error(m);
        }
        return j;
      });
    });
  }
  /* 拉云端歌单：返回数组，每项 {id,title,artist,cover,duration,scope,group_name,path,owner,created_at} */
  function cloudList() {
    if (!cloudOn()) return Promise.resolve([]);
    return rpc('hx_music_list').then(function (rows) {
      if (!rows || !rows.length) return [];
      return rows.map(function (r) {
        return {
          id: 'c' + r.id,                       // 云端 id 前缀 c，和本地 't...' 区分，绝不撞
          cid: r.id,
          name: r.title || '未命名',
          artist: r.artist || '',
          cover: r.cover || '',
          dur: Math.round((+r.duration || 0) * 10) / 10,
          scope: r.scope,
          group: r.group_name || '',
          path: r.path,
          url: cloudURL(r.path),
          owner: r.owner,
          addedAt: Date.parse(r.created_at) || Date.now(),
          cloud: true
        };
      });
    }).catch(function () { return []; });        // 拉不到就退回本地歌单，不报错
  }
  /* 我能不能传歌 / 还剩几首额度：学生限 1 首，教师/管理员不限 */
  function cloudQuota() {
    if (!cloudOn()) return Promise.resolve(null);
    return rpc('hx_music_quota').catch(function () { return null; });
  }
  /* 我是谁（teacher/admin/dev）：发布 / 撤回按钮据此显示 */
  var whoCache = null;
  /* 2026-11-11：缓存「是不是管理员/开发者」。歌单里的删除按钮只对这两种身份渲染，
     renderList 是同步的，拿不到 Promise，所以身份回来时顺手记一份。 */
  var permAdmin = false;
  function cloudWho() {
    if (!cloudOn()) return Promise.resolve(null);
    if (whoCache) return Promise.resolve(whoCache);
    return rpc('hx_me').then(function (m) {
      whoCache = m || {};
      permAdmin = isAdmin(whoCache);
      return whoCache;
    }).catch(function () { return null; });
  }
  function isStaff(m) { return !!(m && (m.teacher || m.admin || m.dev)); }
  function isAdmin(m) { return !!(m && m.dev); } // 2026-11-11 收紧：只认 is_dev，管理员也不再放行（与 hx_is_dev 同口径）
  /* 2026-11-11 音乐工具权限收敛：只对管理员 / 开发者开放。
     为什么：音频存 Supabase Storage，免费版 5GB/月出口流量，默认 BGM 一首 40MB，
     每播一次就要从 Storage 拉一整份 —— 全班一起听会把额度吃光、连带整站 API 异常。
     入口在总入口首页卡和 /音乐/ 页都关了，服务端写操作与读取全部锁成 hx_is_dev()（见
     音乐/supabase/2026-11-11-音乐只给开发者.sql）。这里只提供判定，不改任何播放行为。 */
  function allowed() { return cloudWho().then(function (m) { return isAdmin(m); }); }
  /* 我名下的班级（教师发布到班级时选） */
  function cloudClasses() {
    if (!cloudOn()) return Promise.resolve([]);
    return rpc('hx_my_classes').then(function (r) { return r || []; }).catch(function () { return []; });
  }

  /* ---------------- audio ---------------- */
  function audio() {
    if (A) return A;
    A = new Audio();
    A.preload = 'metadata';
    A.volume = S.vol;
    /* 挂进 DOM（但不显示）：没挂上去的 <audio> 在部分浏览器/无音频设备的机器上会被当成「不可见媒体」，
       时间不推进、timeupdate 也不来 —— 挂在 body 里行为最确定，也省得被 GC 收走。 */
    A.setAttribute('playsinline', '');
    A.style.display = 'none';
    if (D.body) D.body.appendChild(A);
    A.addEventListener('timeupdate', function () {
      S.cur = A.currentTime || 0;
      if (A.duration && isFinite(A.duration)) S.dur = A.duration;
      paint();
      if (Math.floor(S.cur) % 5 === 0) saveState();   // 别每帧都写 localStorage
    });
    A.addEventListener('loadedmetadata', function () {
      if (A.duration && isFinite(A.duration)) {
        S.dur = A.duration;
        var rec = S.list[S.i];
        if (rec && Math.abs((rec.dur || 0) - S.dur) > 0.5) { rec.dur = S.dur; patchDur(rec); }
      }
      S.err = ''; paint();
    });
    A.addEventListener('play', function () { S.playing = true; paint(); });
    A.addEventListener('pause', function () { S.playing = false; paint(); saveState(); });
    A.addEventListener('ended', function () { onEnded(); });
    A.addEventListener('error', function () {
      S.playing = false; S.err = '这个文件浏览器放不了（换 mp3 试试）'; paint();
    });
    return A;
  }

  /* ---------------- 歌单 ---------------- */
  function loadList() {
    /* 本地（IndexedDB）那份永远先读出来当底子 */
    var localP = openDB().then(function (db) {
      return tx(db, [META], 'readonly', function (t) { return wrap(t.objectStore(META).getAll()); });
    }).then(function (out) { return out || []; }).catch(function () { return []; });

    return localP.then(function (local) {
      /* 登录了就把云端歌单并进来（默认 BGM / 全员 / 班级 / 群体 / 自己的 mine）。
         云端曲目走公开 URL 播放，不进 IndexedDB（没必要把 111MB 再下到本地存一份）。 */
      var cloudP = cloudList();
      return cloudP.then(function (cloud) {
        var rows = local.concat(cloud);
        rows.sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
        S.list = rows;
        var st = lsGet(), i = -1;
        if (st.id) { for (var k = 0; k < rows.length; k++) if (rows[k].id === st.id) { i = k; break; } }
        if (i < 0 && rows.length) i = 0;
        S.i = i;
        if (st.vol != null) S.vol = st.vol;
        if (st.muted != null) S.muted = st.muted;
        if (st.mode) S.mode = st.mode;
        paint();
        /* 歌单结构变了（导入 / 删除 / 换账号）必须强制重建列表 DOM：
           repaint 只在「当前曲目 or 播放态」变化时才重建，删掉一首后索引没变就会留着旧行（2026-11-11 修）。 */
        hosts.forEach(function (r) { if (r && r.list) { r._li = -9; r._lp = null; renderList(r); } });
        return rows;
      });
    }).catch(function () { S.list = []; paint(); return []; });
  }

  function probe(file) {
    return new Promise(function (res) {
      var a = new Audio(), u = URL.createObjectURL(file);
      /* 和主播放器同一个坑：没挂进 DOM 的 <audio> 在部分环境里不触发 loadedmetadata，
         那样探出来的时长永远是 0，歌单里全是 0:00、进度条也永远 0%。挂上再拆。 */
      a.preload = 'metadata';
      a.style.display = 'none';
      if (D.body) D.body.appendChild(a);
      var done = function (v) { URL.revokeObjectURL(u); try { a.remove(); } catch (e) { } res(v); };
      a.onloadedmetadata = function () { done(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { done(0); };
      a.src = u;
      setTimeout(function () { done(0); }, 8000);   // 卡住就别等了，先按未知时长存进去
    });
  }

  /* 时长补写：probe 拿不到就等真播一次，从 <audio>.duration 补回来并存进 meta，
     下次进歌单就显示正确时长了（不靠一次就猜准）。 */
  function patchDur(rec) {
    if (!rec) return;
    openDB().then(function (db) {
      return tx(db, [META], 'readwrite', function (t) { t.objectStore(META).put(rec); });
    }).catch(function () { });
  }

  function cleanName(n) {
    return String(n || '').replace(EXT, '').replace(/^\d{1,3}[\s._-]+/, '').trim().slice(0, 120) || '未命名';
  }

  /* 上传一个文件到 Storage 桶 hx-music，返回桶内 path。文件名用随机 id 避免中文/特殊字符撞 URL。 */
  function uploadCloud(file) {
    var t = tok(); if (!t) return Promise.reject(new Error('没登录'));
    var ext = (file.name.match(/\.([a-z0-9]+)$/i) || [0, 'mp3'])[1].toLowerCase();
    var path = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return fetch(SUPA + '/storage/v1/object/hx-music/' + path, {
      method: 'POST',
      headers: { apikey: SKEY_PUB, Authorization: 'Bearer ' + t, 'Content-Type': file.type || 'audio/mpeg' },
      body: file
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (x) { throw new Error((x || '').slice(0, 140) || ('HTTP ' + r.status)); });
      return path;
    });
  }

  /* 登录：传云端（Storage 上传 → hx_music_save 登记）；未登录：传本地 IndexedDB。 */
  function add(files) {
    var arr = Array.prototype.slice.call(files || []);
    var ok = arr.filter(function (f) { return EXT.test(f.name) || /^audio\//.test(f.type || ''); });
    if (!ok.length) return Promise.resolve(0);

    if (cloudOn()) {
      return cloudQuota().then(function (q) {
        /* 学生限 1 首：额度用完了直接挡，一句说清，不静默失败 */
        if (q && q.can_upload === false) {
          /* limit 0 = 这个账号压根没有上传权限（2026-11-11 起只有开发者有）；否则是学生 1 首额度用完 */
          S.err = (q.limit === 0)
            ? '当前账号没有上传权限（音乐工具仅开发者可用）'
            : '学生账号只能上传一首歌（' + (q.used || 0) + '/' + (q.limit || 1) + '）';
          paint();
          return 0;
        }
        var n = 0;
        return ok.reduce(function (p, f) {
          return p.then(function () {
            return probe(f).then(function (dur) {
              return uploadCloud(f).then(function (path) {
                return rpc('hx_music_save', {
                  p_title: cleanName(f.name), p_artist: '', p_path: path, p_cover: '',
                  p_duration: Math.round(dur * 10) / 10, p_scope: 'mine'
                }).then(function () { n++; });
              });
            });
          });
        }, Promise.resolve()).then(function () {
          S.err = n ? '' : S.err;
          return loadList().then(function () { return n; });
        });
      }).catch(function (e) {
        S.err = e.message || '上传失败';
        paint();
        return 0;
      });
    }

    /* 未登录：本地 IndexedDB（现有行为） */
    return openDB().then(function (db) {
      var n = 0;
      return ok.reduce(function (p, f) {
        return p.then(function () {
          return probe(f).then(function (dur) {
            var id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            return tx(db, [META, BLOB], 'readwrite', function (t) {
              t.objectStore(BLOB).put({ id: id, data: f });
              return t.objectStore(META).put({ id: id, name: cleanName(f.name), dur: dur, size: f.size || 0, addedAt: Date.now() });
            }).then(function () { n++; });
          });
        });
      }, Promise.resolve()).then(function () { return loadList().then(function () { return n; }); });
    });
  }

  function remove(id) {
    if (!id) return Promise.resolve();
    var tr = null;
    for (var k = 0; k < S.list.length; k++) if (S.list[k].id === id) { tr = S.list[k]; break; }
    var wasCur = id === curId();
    if (wasCur) { try { audio().pause(); } catch (e) { } }
    /* 云端曲目：调 hx_music_del（owner 或管理员能删），并删 Storage 里的对象 */
    if (tr && tr.cloud) {
      return rpc('hx_music_del', { p_id: tr.cid }).then(function () {
        if (wasCur) { S.playing = false; curURL = ''; A && (A.removeAttribute('src')); }
        return loadList();
      }).catch(function (e) { S.err = e.message || '删除失败'; paint(); return loadList(); });
    }
    return openDB().then(function (db) {
      return tx(db, [META, BLOB], 'readwrite', function (t) {
        t.objectStore(META).delete(id);
        t.objectStore(BLOB).delete(id);
      });
    }).then(function () {
      if (wasCur) { S.playing = false; curURL = ''; A && (A.removeAttribute('src')); }
      return loadList();
    });
  }

  function clear() {
    try { audio().pause(); } catch (e) { }
    S.playing = false; S.i = -1; curURL = '';
    /* 只清本地的（IndexedDB）。云端歌单（默认 BGM / 班级 / 群体 / 自己发布的）不能从这里清掉，
       它们归数据库管，要删走「删除」按钮（hx_music_del）。 */
    return openDB().then(function (db) {
      return tx(db, [META, BLOB], 'readwrite', function (t) {
        t.objectStore(META).clear(); t.objectStore(BLOB).clear();
      });
    }).then(function () { lsSet({}); return loadList(); });
  }

  /* ---------------- 播放控制 ---------------- */
  function load(i, seekTo) {
    var tr = S.list[i];                       /* 别用 t：下面事务回调的参数也叫 t，内层会把它盖掉 */
    if (!tr) return Promise.resolve(false);
    S.i = i; S.err = ''; S.cur = seekTo || 0; S.dur = tr.dur || 0;
    paint();
    /* 云端曲目：直接用公开 URL，不碰 IndexedDB */
    if (tr.cloud && tr.url) {
      var a0 = audio();
      if (curURL) { URL.revokeObjectURL(curURL); curURL = ''; }
      curURL = tr.url;
      a0.src = tr.url;
      if (seekTo) { try { a0.currentTime = seekTo; } catch (e) { } }
      a0.volume = S.muted ? 0 : S.vol;
      return Promise.resolve(true);
    }
    /* 本地曲目：从 IndexedDB 读 blob */
    return openDB().then(function (db) {
      return tx(db, [BLOB], 'readonly', function (t) { return wrap(t.objectStore(BLOB).get(tr.id)); });
    }).then(function (out) {
      var rec = out;
      if (!rec || !rec.data) { S.err = '这个文件不见了（可能被清过缓存）'; paint(); return false; }
      var a = audio();
      if (curURL) { URL.revokeObjectURL(curURL); curURL = ''; }
      curURL = URL.createObjectURL(rec.data);
      a.src = curURL;
      if (seekTo) { try { a.currentTime = seekTo; } catch (e) { } }
      a.volume = S.muted ? 0 : S.vol;
      return true;
    });
  }

  function play(i) {
    /* 三种情况都要先装 src：换了一首、还没造过 <audio>、或者 <audio> 上根本没有源。
       第三种最隐蔽 —— 刷新后歌单还在，但没走过 load()，点播放会「静悄悄地什么都不响」。 */
    var need = (i != null && i !== S.i) || !A || !A.getAttribute('src');
    var go = need ? load(i == null ? S.i : i) : Promise.resolve(true);
    return go.then(function (ok) {
      if (!ok) return false;
      var a = audio();
      return a.play().then(function () { S.playing = true; S.exited = false; paint(); saveState(); return true; })
        .catch(function () { S.playing = false; paint(); return false; });
    });
  }
  function pause() { if (A) { A.pause(); saveState(); } }
  /* 退出（2026-11-10）：点顶部条的 × 后，真正停掉播放并标记「本次已退出」，
     顶部条不再显示（哪怕歌单还在），直到用户再去首页点音乐重新打开才恢复。 */
  function stop() {
    if (A) { try { A.pause(); } catch (e) { } }
    S.playing = false; S.exited = true; S.cur = 0;
    paint(); saveState();
  }
  function toggle() { S.exited = false; return S.playing ? (pause(), Promise.resolve(false)) : play(); }
  /* 一首放完：按 mode 决定下一步。one 单曲循环 = 回开头重放；shuffle 随机 = 抽一首不同的；
     list 列表循环（默认）= 下一首，到底回开头。 */
  function onEnded() {
    if (!S.list.length) return;
    if (S.mode === 'one') { seek(0); play(S.i); return; }
    if (S.mode === 'shuffle') {
      if (S.list.length === 1) { seek(0); play(S.i); return; }
      var i = S.i;
      while (i === S.i) i = Math.floor(Math.random() * S.list.length);
      play(i); return;
    }
    next(true);
  }
  function setMode(m) {
    if (m !== 'list' && m !== 'one' && m !== 'shuffle') return;
    S.mode = m; saveState(); paint();
  }
  /* 点一下模式按钮：list → one → shuffle → list 循环切换 */
  function cycleMode() {
    setMode(S.mode === 'list' ? 'one' : S.mode === 'one' ? 'shuffle' : 'list');
  }
  function next(auto) {
    if (!S.list.length) return Promise.resolve(false);
    var i = S.i + 1;
    if (i >= S.list.length) i = 0;
    if (!auto && i === S.i) return Promise.resolve(false);
    return play(i);
  }
  function prev() {
    if (!S.list.length) return Promise.resolve(false);
    if (S.cur > 3) { seek(0); return Promise.resolve(true); }   // 放过 3 秒的，「上一首」先回开头
    var i = S.i - 1; if (i < 0) i = S.list.length - 1;
    return play(i);
  }
  function seek(sec) {
    if (!A || !isFinite(sec)) return;
    try { A.currentTime = Math.max(0, Math.min(sec, S.dur || sec)); } catch (e) { }
    S.cur = A.currentTime; paint(); saveState();
  }
  function volume(v) {
    S.vol = Math.max(0, Math.min(1, v));
    S.muted = S.vol === 0;
    if (A) { A.volume = S.muted ? 0 : S.vol; }
    paint(); saveState();
  }
  function mute(on) {
    S.muted = on == null ? !S.muted : !!on;
    if (A) A.volume = S.muted ? 0 : S.vol;
    paint(); saveState();
  }

  /* 换页面回来：浏览器不允许没有用户手势就 autoPlay，所以只把 src 和时间装好，等用户点一下。
     这里刻意**不**自动 play() —— 用户明确说「默认不播放」。 */
  function resume() {
    var st = lsGet();
    if (!st.id || !S.list.length) return;
    var i = -1;
    for (var k = 0; k < S.list.length; k++) if (S.list[k].id === st.id) { i = k; break; }
    if (i < 0) return;
    S.i = i; wantResume = true;
    load(i, st.t || 0).then(function () { S.ready = true; paint(); });
  }

  /* ---------------- 状态广播 ---------------- */
  function on(fn) { subs.push(fn); return function () { var k = subs.indexOf(fn); if (k >= 0) subs.splice(k, 1); }; }
  function paint() {
    for (var k = 0; k < subs.length; k++) { try { subs[k](S); } catch (e) { } }
  }

  function fmt(s) {
    if (!s || !isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function cur() { return S.list[S.i] || null; }

  /* ---------------- UI ---------------- */
  var CSS = [
    '.hxp{--hxpa:var(--acc, #2f845a);font:inherit;color:var(--ink);-webkit-tap-highlight-color:transparent}',
    '.hxp *{box-sizing:border-box}',
    '.hxp-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:14px;background:var(--card-solid);border:1px solid var(--edge);min-width:0}',
    '.hxp-cover{width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;background:var(--fill);overflow:hidden}',
    '.hxp-cover img{width:100%;height:100%;object-fit:cover}',
    '.hxp-info{min-width:0;flex:1;line-height:1.25}',
    '.hxp-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hxp-sub{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hxp-line{height:4px;border-radius:99px;background:var(--fill);overflow:hidden;cursor:pointer;position:relative}',
    '.hxp-line>i{display:block;height:100%;width:0;background:currentColor;border-radius:99px;transition:width .15s linear}',
    '.hxp-btn{appearance:none;border:0;background:transparent;color:inherit;padding:0;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:none;transition:background .15s}',
    '.hxp-btn:hover{background:var(--fill)}',
    '.hxp-btn:active{transform:scale(.94)}',
    '.hxp-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.hxp-btn.main{width:46px;height:46px;background:var(--ink);color:var(--bg)}',
    '.hxp-btn.main:hover{opacity:.88;background:var(--ink)}',
    '.hxp-btn.main svg{fill:currentColor;stroke:none;width:20px;height:20px}',
    '.hxp-vol{display:flex;align-items:center;gap:6px;flex:none}',
    '.hxp-vol input{width:76px;accent-color:var(--ink)}',
    '.hxp-panel{display:grid;gap:18px;padding:22px;border-radius:24px;background:var(--card-solid);border:1px solid var(--edge)}',
    '.hxp-hero{display:flex;gap:20px;align-items:center}',
    '.hxp-art{width:132px;height:132px;border-radius:20px;flex:none;background:var(--fill);display:grid;place-items:center;overflow:hidden;box-shadow:0 8px 28px -14px rgba(0,0,0,.5)}',
    '.hxp-art svg{width:44px;height:44px;stroke:var(--faint);fill:none;stroke-width:1.5}',
    '.hxp-h1{font-size:20px;font-weight:500;margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hxp-h2{font-size:13px;color:var(--dim);margin:0}',
    '.hxp-time{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:6px}',
    '.hxp-rows{display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap}',
    '.hxp-list{display:grid;gap:2px;max-height:340px;overflow:auto}',
    '.hxp-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;cursor:pointer;border:0;background:transparent;color:inherit;text-align:left;width:100%;font:inherit}',
    '.hxp-row:hover{background:var(--fill)}',
    '.hxp-row.on{background:var(--fill)}',
    '.hxp-row.on .hxp-name{font-weight:500}',
    '.hxp-n{width:20px;flex:none;font-size:11px;color:var(--faint);text-align:right}',
    '.hxp-dur{font-size:11px;color:var(--faint);flex:none}',
    '.hxp-x{appearance:none;border:0;background:transparent;color:var(--faint);cursor:pointer;padding:2px 6px;border-radius:6px;flex:none;font-size:15px;line-height:1}',
    '.hxp-x:hover{background:var(--fill);color:var(--ink)}',
    /* 歌单删除按钮（2026-11-11）：管理员/开发者才渲染的明确文字按钮，替掉原来那个不起眼的 × */
    '.hxp-del{appearance:none;border:1px solid var(--edge);background:transparent;color:var(--dim);cursor:pointer;padding:4px 11px;border-radius:8px;flex:none;font:inherit;font-size:12px;line-height:1.4}',
    '.hxp-del:hover{border-color:var(--edge);background:color-mix(in srgb,#e5484d 14%,transparent);color:#e5484d}',
    /* 轻提示（删除成功后给个反馈，不弹窗打断） */
    '.hxp-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);z-index:2147483000;padding:10px 20px;border-radius:99px;background:var(--ink);color:var(--bg);font-size:13px;box-shadow:0 10px 28px -10px rgba(0,0,0,.5);animation:hxp-toast-in .18s ease}',
    '@keyframes hxp-toast-in{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}',
    '.hxp-empty{padding:26px 10px;text-align:center;font-size:13px;color:var(--dim)}',
    '.hxp-top{position:fixed;z-index:2147483000;display:flex;pointer-events:none}',
    '.hxp-top>.hxp-bar{pointer-events:auto;max-width:min(720px,calc(100vw - 24px));width:auto;box-shadow:0 6px 24px -12px rgba(0,0,0,.45);backdrop-filter:blur(14px);background:var(--card);position:relative}',
    /* 2026-11-10 播放器悬浮窗：可拖拽、可缩小。拖拽手柄（⋮⋮）按住拖动整条；「收起」按钮缩成小圆钮，点开恢复。
       默认停右上角、不横跨全屏，避开工具页顶栏左侧的返回/首页按钮，不再遮挡。 */
    '.hxp-top .hxp-grip{flex:none;width:22px;align-self:stretch;display:grid;place-items:center;cursor:grab;color:var(--faint);margin-left:-4px;border-radius:10px 0 0 10px;user-select:none;touch-action:none}',
    '.hxp-top .hxp-grip:hover{background:var(--fill);color:var(--ink)}',
    '.hxp-top .hxp-grip svg{width:14px;height:14px;fill:currentColor;stroke:none}',
    '.hxp-top .hxp-mini{flex:none;width:30px;align-self:stretch;display:grid;place-items:center;cursor:pointer;color:var(--faint);margin-right:-4px;border-radius:0 10px 10px 0;user-select:none}',
    '.hxp-top .hxp-mini:hover{background:var(--fill);color:var(--ink)}',
    '.hxp-top .hxp-mini svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}',
    /* 退出按钮（2026-11-10）：点 × 停播放并隐藏顶部条，本次不再占用 */
    '.hxp-exit{appearance:none;border:0;background:transparent;color:var(--faint);padding:0;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;cursor:pointer;flex:none;transition:background .15s}',
    '.hxp-exit:hover{background:var(--fill);color:var(--ink)}',
    '.hxp-exit svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}',
    /* 嵌入顶栏（#hxpSlot）时的紧凑形态：去阴影、去圆角背景，融进 header，别像一块悬浮卡片 */
    '#hxpSlot .hxp-top{display:flex}',
    '#hxpSlot .hxp-top>.hxp-bar{max-width:none;box-shadow:none;backdrop-filter:none;background:transparent;border:0;padding:4px 6px;gap:6px;border-radius:12px}',
    '#hxpSlot .hxp-bar .hxp-info{max-width:150px}',
    '#hxpSlot .hxp-bar .hxp-name{font-size:13px}',
    '#hxpSlot .hxp-bar .hxp-sub{display:none}',
    '#hxpSlot .hxp-bar .hxp-btn{width:32px;height:32px}',
    '#hxpSlot .hxp-bar .hxp-btn.main{width:36px;height:36px}',
    '#hxpSlot .hxp-bar .hxp-vol input{width:56px}',
    /* 收起后的小圆钮：一个可拖动的音符球 */
    '.hxp-top.hxp-min .hxp-bar{display:none}',
    '.hxp-orb{pointer-events:auto;width:44px;height:44px;border-radius:50%;display:none;place-items:center;background:var(--card);border:1px solid var(--edge);box-shadow:0 6px 20px -10px rgba(0,0,0,.5);cursor:grab;color:var(--ink);touch-action:none;user-select:none}',
    '.hxp-top.hxp-min .hxp-orb{display:grid}',
    '.hxp-orb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}',
    '.hxp-orb.on{color:var(--acc,#2f845a)}',
    '@media(max-width:560px){.hxp-hero{flex-direction:column;text-align:center}.hxp-vol input{width:60px}}',
    /* 顶部条竖屏适配（2026-11-09）：手机 390px 宽放不下「封面+歌名+四键+音量滑杆」七样，
       会挤爆/换行。竖屏下顶部条只留最核心的：歌名（flex 占满）+ 上一首 + 播放 + 下一首 + 静音，
       音量和封面藏起来（封面本来没图，音量进歌单面板还能调）。 */
    '@media(max-width:560px){.hxp-top>.hxp-bar{gap:6px;padding:6px 8px;border-radius:12px}.hxp-top>.hxp-bar .hxp-cover,.hxp-top>.hxp-bar .hxp-vol input{display:none}.hxp-top>.hxp-bar .hxp-info{min-width:0}.hxp-top>.hxp-bar .hxp-btn{width:34px;height:34px}.hxp-top>.hxp-bar .hxp-btn.main{width:40px;height:40px}}',
    '@media(prefers-reduced-motion:reduce){.hxp *{transition:none!important}}'
  ].join('\n');

  function injectCSS() {
    if (D.getElementById('hxp-css')) return;
    var s = D.createElement('style'); s.id = 'hxp-css'; s.textContent = CSS;
    D.head.appendChild(s);
  }

  var IC = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="7" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.2"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M18 6v12L9 12z" fill="currentColor" stroke="none"/><path d="M6 5v14"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 6v12l9-6z" fill="currentColor" stroke="none"/><path d="M18 5v14"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    /* 三种播放模式图标：列表循环 / 单曲循环 / 随机 */
    mlist: '<svg viewBox="0 0 24 24"><path d="M4 6h11M4 12h11M4 18h8"/><path d="M17 4l3 2-3 2V4zM17 15l3 2-3 2v-4z"/></svg>',
    mone: '<svg viewBox="0 0 24 24"><path d="M4 6h11M4 12h11M4 18h8"/><path d="M17 15l3 2-3 2v-4z"/><path d="M16 4l1.2 1.2L16 6.4V4z"/></svg>',
    mshuffle: '<svg viewBox="0 0 24 24"><path d="M4 6h3l3 6-3 6H4"/><path d="M20 6h-3l-2 4M20 18h-3l-2-4M16 6l2-2 2 2M16 18l2 2 2-2"/></svg>'
  };

  function el(tag, cls, html) {
    var e = D.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* 投影片：拖进度条 / 点进度条都能跳 */
  function bindSeek(line) {
    var drag = false;
    var at = function (e) {
      var r = line.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var ratio = Math.max(0, Math.min(1, x / Math.max(1, r.width)));
      seek(ratio * (S.dur || 0));
    };
    line.addEventListener('pointerdown', function (e) { drag = true; line.setPointerCapture && line.setPointerCapture(e.pointerId); at(e); });
    line.addEventListener('pointermove', function (e) { if (drag) at(e); });
    line.addEventListener('pointerup', function () { drag = false; });
    line.addEventListener('pointercancel', function () { drag = false; });
  }

  /* 紧凑条：首页卡片、顶部条都用它 */
  function bar(host, opt) {
    if (!host) return null;
    opt = opt || {};
    injectCSS();
    host.classList.add('hxp');
    host.innerHTML = '';
    var wrap = el('div', 'hxp-bar');
    wrap.innerHTML =
      '<div class="hxp-cover">' + IC.note + '</div>' +
      '<div class="hxp-info"><div class="hxp-name">还没选歌</div><div class="hxp-sub">导入音乐开始</div></div>' +
      '<button class="hxp-btn" data-a="prev" aria-label="上一首">' + IC.prev + '</button>' +
      '<button class="hxp-btn main" data-a="toggle" aria-label="播放">' + IC.play + '</button>' +
      '<button class="hxp-btn" data-a="next" aria-label="下一首">' + IC.next + '</button>' +
      '<div class="hxp-vol"><button class="hxp-btn" data-a="mute" aria-label="静音">' + IC.vol + '</button>' +
      '<input type="range" min="0" max="100" value="' + Math.round(S.vol * 100) + '" aria-label="音量"></div>';
    if (opt.cover === false) wrap.querySelector('.hxp-cover').style.display = 'none';
    host.appendChild(wrap);
    if (opt.progress !== false) {
      var line = el('div', 'hxp-line', '<i></i>');
      line.style.marginTop = '8px';
      host.appendChild(line);
      bindSeek(line);
      wrap._line = line;
    }
    wrap.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'toggle') toggle();
        else if (a === 'next') next();
        else if (a === 'prev') prev();
        else if (a === 'mute') mute();
      };
    });
    var rng = wrap.querySelector('input[type=range]');
    rng.oninput = function () { volume(+rng.value / 100); };
    var row = { host: host, wrap: wrap };
    hosts.push(row);
    paint();
    return row;
  }

  /* 完整面板：/music/ 页面和首页弹层用 */
  function panel(host) {
    if (!host) return null;
    injectCSS();
    host.classList.add('hxp');
    host.innerHTML = '';
    var card = el('div', 'hxp-panel');
    card.innerHTML =
      '<div class="hxp-hero">' +
        '<div class="hxp-art">' + IC.note + '</div>' +
        '<div style="min-width:0;flex:1">' +
          '<h1 class="hxp-h1">还没选歌</h1><p class="hxp-h2">导入 mp3 就能开始</p>' +
          '<div class="hxp-time"><span data-t="cur">0:00</span><span data-t="dur">0:00</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="hxp-line" style="height:6px"><i></i></div>' +
      '<div class="hxp-rows">' +
        '<button class="hxp-btn" data-a="prev" aria-label="上一首">' + IC.prev + '</button>' +
        '<button class="hxp-btn main" data-a="toggle" aria-label="播放">' + IC.play + '</button>' +
        '<button class="hxp-btn" data-a="next" aria-label="下一首">' + IC.next + '</button>' +
        '<button class="hxp-btn" data-a="mode" aria-label="播放模式">' + IC.mlist + '</button>' +
        '<div class="hxp-vol"><button class="hxp-btn" data-a="mute" aria-label="静音">' + IC.vol + '</button>' +
        '<input type="range" min="0" max="100" value="' + Math.round(S.vol * 100) + '" aria-label="音量"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<button class="hxp-btn" data-a="import" style="display:inline-flex;align-items:center;gap:6px;width:auto;padding:0 14px;height:36px;border-radius:99px;border:1px solid var(--edge);font-size:13px">' +
          '<span style="display:inline-flex">' + IC.note + '</span><span>导入音乐</span></button>' +
        '<button class="hxp-btn" data-a="publish" style="display:none;align-items:center;gap:6px;width:auto;padding:0 14px;height:36px;border-radius:99px;border:1px solid var(--edge);font-size:13px">' +
          '<span style="display:inline-flex">' + IC.note + '</span><span>发布</span></button>' +
        '<span class="hxp-sub" data-t="count" style="font-size:12px;color:var(--dim)">0 首</span>' +
        '<span style="flex:1"></span>' +
        '<button class="hxp-x" data-a="clearlist" title="清空本地歌单">清空</button>' +
      '</div>' +
      '<div data-t="publish" style="display:none"></div>' +
      '<div class="hxp-list" data-t="list"></div>';
    host.appendChild(card);

    var fileIn = el('input'); fileIn.type = 'file'; fileIn.accept = 'audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac'; fileIn.multiple = true;
    fileIn.style.display = 'none'; card.appendChild(fileIn);

    card.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'toggle') toggle();
        else if (a === 'next') next();
        else if (a === 'prev') prev();
        else if (a === 'mute') mute();
        else if (a === 'mode') cycleMode();
        else if (a === 'import') fileIn.click();
        else if (a === 'publish') openPublish(card);
        else if (a === 'clearlist') { var _m = '清空本地歌单？云端发布的歌不受影响，本机导入的音频会删掉。'; if (window.hxConfirm) { hxConfirm(_m).then(function (ok) { if (ok) clear(); }); } else if (confirm(_m)) clear(); }
      };
    });
    fileIn.onchange = function () { add(fileIn.files).then(function (n) { if (n) resumeIfIdle(); fileIn.value = ''; }); };
    var rng = card.querySelector('input[type=range]');
    rng.oninput = function () { volume(+rng.value / 100); };
    bindSeek(card.querySelector('.hxp-line'));

    /* 拖一堆文件进来也能导入（桌面上比点按钮快） */
    card.addEventListener('dragover', function (e) { e.preventDefault(); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files).then(function (n) { if (n) resumeIfIdle(); });
    });

    /* 教师/管理员：显示「发布」按钮（学生看不到） */
    /* 身份回来后再刷一遍歌单：行里的「删除」按钮只对管理员/开发者渲染（2026-11-11） */
    var row = { host: host, wrap: card, list: card.querySelector('[data-t="list"]') };
    hosts.push(row);
    renderList(row);
    paint();
    cloudWho().then(function (m) {
      if (isStaff(m)) {
        var pb = card.querySelector('[data-a="publish"]');
        if (pb) pb.style.display = 'inline-flex';
      }
      renderList(row);
    });
    return row;
  }

  /* 刚导入第一批歌时，把第一首装进 <audio>（不 autoplay），这样点播放就有声 */
  function resumeIfIdle() {
    if (!S.list.length || A) return;
    load(S.i < 0 ? 0 : S.i, 0).then(function () { S.ready = true; paint(); });
  }

  /* ---------------- 发布表单（教师/管理员）----------------
     教师能发：全员（all）+ 自己名下的班级（class）
     管理员额外能发：群体（group，指定 member_ids）+ 默认 BGM（default）
     学生/第三方看不到「发布」按钮，走不到这里。 */
  function openPublish(card) {
    var box = card.querySelector('[data-t="publish"]');
    if (!box) return;
    if (box.style.display !== 'none') { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="hxp-empty">正在加载发布选项…</div>';
    box.style.display = 'block';
    Promise.all([cloudWho(), cloudClasses()]).then(function (r) {
      var me = r[0], cls = r[1];
      var admin = isAdmin(me), staff = isStaff(me);
      if (!staff) { box.innerHTML = '<div class="hxp-empty">只有老师或管理员能发布。</div>'; return; }
      var scopeOpts =
        '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px"><input type="radio" name="pscope" value="all" checked> 全员可见（所有登录用户）</label>' +
        '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px"><input type="radio" name="pscope" value="class"> 发布到我的班级</label>' +
        (admin ? '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px"><input type="radio" name="pscope" value="group"> 发布到群体（指定人）</label>' +
                 '<label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px"><input type="radio" name="pscope" value="default"> 设为默认背景音乐（所有人）</label>' : '');
      var clsBox = cls.length
        ? '<div data-pcls style="display:none;margin:6px 0 4px">' + cls.map(function (c) {
            return '<label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px"><input type="checkbox" name="pcls" value="' + c.id + '"> ' + esc(c.name || ('班级' + c.id)) + '</label>';
          }).join('') + '</div>'
        : '<div data-pcls style="display:none;margin:6px 0 4px;font-size:12px;color:var(--dim)">还没有班级，先去首页「班级」建一个。</div>';
      var groupBox = admin
        ? '<div data-pgroup style="display:none;margin:6px 0 4px"><input type="text" name="pgroup" placeholder="群体名（备注用，不参与过滤）" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--edge);background:var(--bg);color:var(--ink);font-size:13px"></div>'
        : '';
      box.innerHTML =
        '<div style="padding:12px;border:1px solid var(--edge);border-radius:14px;background:var(--fill)">' +
          '<div style="font-size:13px;font-weight:500;margin-bottom:4px">发布一首歌</div>' +
          '<input type="file" name="pfile" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" style="font-size:12px;margin:6px 0">' +
          '<div>' + scopeOpts + '</div>' + clsBox + groupBox +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button data-ppub style="flex:1;padding:9px;border:0;border-radius:10px;background:var(--ink);color:var(--bg);font-size:13px;cursor:pointer">发布</button>' +
            '<button data-pcancel style="padding:9px 16px;border:1px solid var(--edge);border-radius:10px;background:transparent;color:var(--ink);font-size:13px;cursor:pointer">取消</button>' +
          '</div>' +
          '<div data-pmsg style="font-size:12px;color:var(--dim);margin-top:8px"></div>' +
        '</div>';
      var scopes = box.querySelectorAll('[name="pscope"]');
      var pcls = box.querySelector('[data-pcls]'), pgroup = box.querySelector('[data-pgroup]');
      function syncScope() {
        var v = box.querySelector('[name="pscope"]:checked').value;
        if (pcls) pcls.style.display = v === 'class' ? 'block' : 'none';
        if (pgroup) pgroup.style.display = v === 'group' ? 'block' : 'none';
      }
      scopes.forEach(function (s) { s.onchange = syncScope; });
      syncScope();
      box.querySelector('[data-pcancel]').onclick = function () { box.style.display = 'none'; box.innerHTML = ''; };
      box.querySelector('[data-ppub]').onclick = function () {
        var msg = box.querySelector('[data-pmsg]');
        var f = box.querySelector('[name="pfile"]').files[0];
        var scope = box.querySelector('[name="pscope"]:checked').value;
        if (!f) { msg.textContent = '先选一个音频文件'; return; }
        msg.textContent = '正在上传…';
        var class_ids = [], group_name = '', member_ids = [];
        if (scope === 'class') {
          box.querySelectorAll('[name="pcls"]:checked').forEach(function (c) { class_ids.push(+c.value); });
          if (!class_ids.length) { msg.textContent = '至少选一个班级'; return; }
        }
        if (scope === 'group') { group_name = (box.querySelector('[name="pgroup"]') || {}).value || ''; }
        var doSave = function (path, dur) {
          var body = { p_title: cleanName(f.name), p_artist: '', p_path: path, p_cover: '', p_duration: Math.round(dur * 10) / 10, p_scope: scope, p_class_ids: class_ids, p_member_ids: member_ids, p_group: group_name };
          var p = scope === 'default' ? rpc('hx_music_publish_default', { p_title: body.p_title, p_artist: '', p_path: path, p_cover: '', p_duration: body.p_duration }) : rpc('hx_music_save', body);
          return p;
        };
        probe(f).then(function (dur) {
          return uploadCloud(f).then(function (path) { return doSave(path, dur); });
        }).then(function () {
          msg.textContent = '已发布'; box.style.display = 'none'; box.innerHTML = '';
          loadList();
        }).catch(function (e) { msg.textContent = '发布失败：' + (e.message || '未知错误'); });
      };
    });
  }

  /* scope → 歌单里的小标签（云端曲目显示来源，本地不显示） */
  var SCOPE_TAG = {
    'default': ['默认', '--acc'],
    'all': ['全员', 'var(--ok)'],
    'class': ['班级', 'var(--ok)'],
    'group': ['群体', 'var(--ok)'],
    'mine': ['我的', 'var(--dim)']
  };
  function scopeTag(t) {
    if (!t || !t.cloud) return '';
    var st = SCOPE_TAG[t.scope] || ['', 'var(--dim)'];
    return '<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:color-mix(in srgb,' + st[1] + ' 18%,transparent);color:' + st[1] + ';flex:none">' + st[0] + '</span>';
  }

  function renderList(row) {
    if (!row || !row.list) return;
    var L = S.list;
    if (!L.length) {
      row.list.innerHTML = '<div class="hxp-empty">歌单是空的。点上面「导入音乐」，选 mp3 文件（可以多选，也可以直接拖进来）。</div>';
      return;
    }
    row.list.innerHTML = L.map(function (t, i) {
      /* 云端曲目：显示 scope 标签 +（有封面就显示封面）；本地曲目：显示文件大小 */
      var sub = t.cloud
        ? (scopeTag(t) + (t.artist ? '<span class="hxp-sub" style="display:block">' + esc(t.artist) + '</span>' : ''))
        : '<span class="hxp-sub" style="display:block">' + (t.size ? (t.size < 1048576 ? Math.max(1, Math.round(t.size / 1024)) + ' KB' : (t.size / 1048576).toFixed(1) + ' MB') : '') + '</span>';
      var cover = t.cloud && t.cover
        ? '<span class="hxp-cover" style="flex:none"><img src="' + esc(cloudURL(t.cover)) + '" alt=""></span>'
        : '';
      /* 删除按钮：只有管理员 / 开发者渲染（2026-11-11，用户反馈「找不到在哪删」）。
         走的还是 remove() → hx_music_del，没新开接口。 */
      var del = permAdmin
        ? '<button class="hxp-del" data-del="' + esc(t.id) + '" data-name="' + esc(t.name) + '" title="删除这首歌">删除</button>'
        : '';
      return '<div class="hxp-row' + (i === S.i ? ' on' : '') + '" data-i="' + i + '">' +
        '<span class="hxp-n">' + (i === S.i && S.playing ? '▶' : (i + 1)) + '</span>' +
        cover +
        '<span class="hxp-info"><span class="hxp-name" style="display:block">' + esc(t.name) + '</span>' + sub + '</span>' +
        '<span class="hxp-dur">' + fmt(t.dur) + '</span>' +
        del + '</div>';
    }).join('');
    row.list.querySelectorAll('.hxp-row').forEach(function (r) {
      r.onclick = function (e) {
        if (e.target.closest('[data-del]')) return;
        var i = +r.dataset.i;
        if (i === S.i) toggle(); else play(i);
      };
    });
    row.list.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var id = b.dataset.del;
        var nm = b.getAttribute('data-name') || '';
        var msg = '删除《' + nm + '》？';
        var go = function (yes) {
          if (!yes) return;
          remove(id).then(function () { toast('已删除'); });
        };
        /* 和「清空」同一个套路：有统一弹窗就用它，没有就退回浏览器原生 confirm */
        if (W.hxConfirm) W.hxConfirm(msg, { okText: '删除' }).then(go);
        else go(W.confirm(msg));
      };
    });
  }

  /* 轻提示：删除后的反馈（2 秒自己消失，不拦操作） */
  function toast(msg) {
    if (!D.body) return;
    var t = el('div', 'hxp-toast');
    t.textContent = msg;
    D.body.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) { } }, 2000);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 每次状态变化，把所有已挂载的 UI 刷一遍（不重建 DOM，免得拖进度条时节点被换掉） */
  function repaint() {
    var t = cur();
    hosts.forEach(function (r) {
      var w = r.wrap;
      if (!w || !w.parentNode) return;
      var nm = w.querySelector('.hxp-name');
      var sub = w.querySelector('.hxp-sub');
      if (nm) nm.textContent = t ? t.name : '还没选歌';
      if (sub && !r.list) sub.textContent = t ? (S.playing ? '正在播放' : '已暂停') : '导入音乐开始';
      var tg = w.querySelector('[data-a="toggle"]');
      if (tg) tg.innerHTML = S.playing ? IC.pause : IC.play;
      var mu = w.querySelector('[data-a="mute"]');
      if (mu) mu.innerHTML = S.muted ? IC.mute : IC.vol;
      var md = w.querySelector('[data-a="mode"]');
      if (md) {
        md.innerHTML = S.mode === 'one' ? IC.mone : S.mode === 'shuffle' ? IC.mshuffle : IC.mlist;
        md.setAttribute('title', S.mode === 'one' ? '单曲循环' : S.mode === 'shuffle' ? '随机播放' : '列表循环');
      }
      var ln = w.querySelector('.hxp-line>i') || (w._line && w._line.querySelector('i'));
      if (ln) ln.style.width = (S.dur ? (S.cur / S.dur * 100) : 0).toFixed(2) + '%';
      var cue = w.querySelector('[data-t="cur"]'), due = w.querySelector('[data-t="dur"]');
      if (cue) cue.textContent = fmt(S.cur);
      if (due) due.textContent = fmt(S.dur || (t && t.dur) || 0);
      var h1 = w.querySelector('.hxp-h1'), h2 = w.querySelector('.hxp-h2');
      if (h1) h1.textContent = t ? t.name : '还没选歌';
      if (h2) h2.textContent = S.err ? S.err : (t ? (S.playing ? '正在播放' : (wantResume && !S.playing ? '点播放继续' : '已暂停')) : '导入 mp3 就能开始');
      /* 封面：当前曲是云端且有 cover 时显示图，否则回音符图标（hero 大封面 + bar 小封面都刷） */
      var coverURL = (t && t.cloud && t.cover) ? cloudURL(t.cover) : '';
      var art = w.querySelector('.hxp-art');
      if (art) {
        if (coverURL) { art.innerHTML = '<img src="' + esc(coverURL) + '" alt="" style="width:100%;height:100%;object-fit:cover">'; }
        else { art.innerHTML = IC.note; }
      }
      var cv = w.querySelector('.hxp-cover');
      if (cv && !r.list) {
        if (coverURL) { cv.innerHTML = '<img src="' + esc(coverURL) + '" alt="">'; }
        else { cv.innerHTML = IC.note; }
      }
      var cnt = w.querySelector('[data-t="count"]');
      if (cnt) cnt.textContent = S.list.length + ' 首' + (S.err ? '　' + S.err : '');
      /* 2026-11-10 性能：原来每次 timeupdate 都 renderList(r) 整单重建 DOM（歌单越长越卡，手机尤其明显）。
         改成只在「当前曲目」或「播放/暂停状态」变化时才重建列表；纯进度走动只轻量更新 ▶ 高亮，
         不再整单 innerHTML 重写。 */
      if (r.list) {
        if (r._li !== S.i || r._lp !== S.playing) {
          r._li = S.i; r._lp = S.playing;
          renderList(r);
        } else {
          var rows = r.list.querySelectorAll('.hxp-row');
          rows.forEach(function (rowEl) {
            var i = +rowEl.dataset.i;
            var n = rowEl.querySelector('.hxp-n');
            if (n) n.textContent = (i === S.i && S.playing ? '▶' : (i + 1));
            rowEl.classList.toggle('on', i === S.i);
          });
        }
      }
    });
  }
  var _paint = paint;
  paint = function () { _paint(); try { repaint(); } catch (e) { } };

  /* ---------------- 工具页顶部那条 ---------------- */
  /* force=true 给总入口用：总入口自己有 #tiles（首页有音乐卡），但工具是 iframe 全屏盖上去的，
     首页那张卡就看不见了 —— 所以工具打开时要在 top 层再挂一条，浮在 iframe 上方。 */
  function topBar(force) {
    if (!W.top || W.top !== W) return null;                      // 在 iframe 里：交给父页
    if (D.body && D.body.dataset.hxpPage) return null;            // /music/ 整页已经是播放器，不用再挂一条
    if (!force && D.getElementById('tiles')) return null;
    if (D.getElementById('hxp-top')) return null;
    injectCSS();
    var inHome = !!D.getElementById('tiles');
    /* 2026-11-10 播放器嵌入顶栏：总入口在 header 里预留了 #hxpSlot（「扫一扫」左边），
       优先挂到那里面、变成顶栏里的普通元素，不再 fixed 悬浮遮挡文字。
       没有 #hxpSlot（比如 /music/ 之外的其它页面）才退回挂 body 悬浮。 */
    var slot = D.getElementById('hxpSlot');
    var host = el('div', 'hxp-top'); host.id = 'hxp-top';
    (slot || D.body).appendChild(host);
    var row = bar(host);
    /* 2026-11-10 用户报「播放器对别的界面有遮挡」：
       原来 .hxp-top 是 left:0;right:0 横跨整屏、居中一条 bar，会盖住工具页顶栏的返回/首页按钮。
       改成右上角悬浮的小条：默认贴右上角，可按住左侧 ⋮⋮ 手柄拖动到任意位置，
       点右侧「收起」缩成一颗音符圆钮（也能拖），点圆钮再展开 —— 不挡内容，随用随收。
       （若已嵌入 #hxpSlot 则不再可拖、不再收起成圆钮，就是顶栏里一条常驻条。） */
    var grip = el('div', 'hxp-grip'); grip.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>';
    grip.title = '拖动播放条';
    grip.setAttribute('aria-label', '拖动播放条');
    var mini = el('div', 'hxp-mini'); mini.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>';
    mini.title = '收起成小圆钮';
    mini.setAttribute('aria-label', '收起播放条');
    row.wrap.insertBefore(grip, row.wrap.firstChild);
    row.wrap.appendChild(mini);
    /* 退出按钮（2026-11-10）：点 × 停掉播放并隐藏顶部条，本次不再占用，除非再回首页点音乐。 */
    var exit = el('button', 'hxp-exit'); exit.type = 'button'; exit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    exit.title = '退出音乐';
    exit.setAttribute('aria-label', '退出音乐');
    row.wrap.appendChild(exit);
    exit.onclick = function () { stop(); };
    /* 收起后的小圆钮 */
    var orb = el('div', 'hxp-orb'); orb.innerHTML = IC.note;
    orb.title = '播放器（点开展开）';
    orb.setAttribute('aria-label', '展开播放器');
    host.appendChild(orb);

    /* 位置记忆：拖到哪、收不收，刷新后还在（嵌入 #hxpSlot 时不可拖，这段不会用到） */
    var POS_KEY = 'hxp-top-pos';
    var pos = null; try { pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { }
    var applyPos = function () {
      if (slot) { /* 嵌入顶栏：清掉定位，交给 header flex 布局 */
        host.style.left = 'auto'; host.style.right = 'auto'; host.style.top = 'auto'; host.style.bottom = 'auto';
        return;
      }
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        host.style.left = pos.x + 'px'; host.style.top = pos.y + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      } else {
        host.style.left = 'auto'; host.style.right = '10px'; host.style.top = '10px';
      }
      if (pos && pos.min) setMin(true, true);
    };
    var savePos = function () {
      if (slot) return;
      var r = host.getBoundingClientRect();
      pos = { x: r.left, y: r.top, min: !!host.classList.contains('hxp-min') };
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) { }
    };

    /* 拖拽：手柄拖 bar，圆钮拖 orb，都按 pointer 事件（鼠标+触屏通用）。
       用位移判断是「点击」还是「拖拽」：动超过 4px 算拖，否则算点（点圆钮才展开）。 */
    function bindDrag(target, onTap) {
      if (slot) return;                                       // 嵌入顶栏不可拖
      var sx = 0, sy = 0, moved = false, r = null, dx = 0, dy = 0;
      target.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        r = host.getBoundingClientRect();
        dx = e.clientX - r.left; dy = e.clientY - r.top;
        sx = e.clientX; sy = e.clientY; moved = false;
        W.addEventListener('pointermove', onMove);
        W.addEventListener('pointerup', onUp);
      });
      function onMove(ev) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) moved = true;
        if (!moved) return;
        var x = ev.clientX - dx, y = ev.clientY - dy;
        x = Math.max(-r.width + 40, Math.min(x, innerWidth - 40));
        y = Math.max(0, Math.min(y, innerHeight - 40));
        host.style.left = x + 'px'; host.style.top = y + 'px';
        host.style.right = 'auto'; host.style.bottom = 'auto';
      }
      function onUp() {
        W.removeEventListener('pointermove', onMove);
        W.removeEventListener('pointerup', onUp);
        savePos();
        if (!moved && onTap) onTap();
      }
    }
    bindDrag(grip);
    bindDrag(orb, function () { setMin(false); });

    /* 收起/展开 */
    function setMin(m, silent) {
      host.classList.toggle('hxp-min', m);
      if (!silent) savePos();
      paint();
    }
    mini.onclick = function () { setMin(true); };
    if (slot) { mini.style.display = 'none'; grip.style.display = 'none'; }
    applyPos();   // 恢复上次的位置和收起状态

    var sync = function () {
      /* 2026-11-10：嵌入顶栏后，只在「真的在放歌」（playing）时显示；
         暂停/退出/没歌单都不占顶栏位置。 */
      var has = !!(S.playing && !S.exited);
      var inTool = !inHome || D.body.classList.contains('tool');   // 总入口里只在工具全屏时出现
      host.style.display = (has && inTool) ? 'flex' : 'none';
      host.style.visibility = (has && inTool) ? 'visible' : 'hidden';
    };
    on(sync);
    /* body 的 class 由总入口的 show() 切换，不在播放器状态里，所以盯一眼 class 变化 */
    try { new MutationObserver(sync).observe(D.body, { attributes: true, attributeFilter: ['class'] }); } catch (e) { }
    sync();
    return row;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    /* 2026-11-11：/音乐/ 页要先验明身份再决定要不要加载歌单（非管理员整页空白、零请求），
       由页面在引脚本前设 window.HX_PLAYER_NO_BOOT=1 自己接管启动。
       这里直接 return：不自动拉歌单（否则未通过闸门也会打一次 hx_music_list）、不挂顶部条。 */
    if (W.HX_PLAYER_NO_BOOT) return;
    loadList().then(function () {
      if (lsGet().id) resume();
      // 已在总入口（top）且不是首页 → 挂顶部条
      topBar();
    });
    // 别的标签页改了歌单/音量，这边跟上（同一浏览器多窗口时别打架）
    W.addEventListener('storage', function (e) {
      if (e.key === LSS && e.newValue) {
        var st = {}; try { st = JSON.parse(e.newValue) || {}; } catch (x) { }
        if (st.vol != null && st.vol !== S.vol) { S.vol = st.vol; if (A) A.volume = S.muted ? 0 : S.vol; }
      }
      /* 登录 / 登出（paike-session 变了）→ 重拉歌单：登录后要把云端默认 BGM / 全员 / 班级 / 群体并进来，
         登出后要把它们撤掉（只留本地）。跨标签页登录在这页也能跟上。 */
      if (e.key === SKEY_SESS) { loadList(); }
    });
    /* 同页登录/登出（不跨标签页时 storage 事件不触发）：盯 paike-session 的变化 */
    var lastTok = tok();
    setInterval(function () {
      var now = tok();
      if (now !== lastTok) { lastTok = now; loadList(); }
    }, 2000);
  }

  W.HXPlayer = {
    list: function () { return S.list.slice(); },
    state: function () { return S; },
    add: add, remove: remove, clear: clear,
    play: play, toggle: toggle, next: next, prev: prev, pause: pause, stop: stop,
    seek: seek, volume: volume, mute: mute,
    setMode: setMode, cycleMode: cycleMode,
    on: on, bar: bar, panel: panel, topBar: topBar,
    /* 重新打开音乐（点首页音乐卡）：清除「已退出」标记，让顶部条重新可见 */
    unexit: function () { S.exited = false; paint(); },
    fmt: fmt, ready: function () { return loadList(); },
    /* 云（2026-11-09）：登录后重拉歌单（默认 BGM/全员/班级/群体/自己的），换设备登进来就能看到 */
    cloud: cloudOn,
    cloudQuota: cloudQuota,
    /* 2026-11-11 权限：who() 返回 hx_me，allowed() 返回「是不是管理员/开发者」（入口闸门用） */
    who: cloudWho, allowed: allowed,
    refresh: function () { return loadList(); },
    /* 发布 / 撤回 / 默认 BGM（教师/管理员专用，见 hx_music_save/publish_default/del） */
    publish: function (o) { return rpc('hx_music_save', o); },
    publishDefault: function (o) { return rpc('hx_music_publish_default', o); },
    delCloud: function (cid) { return rpc('hx_music_del', { p_id: cid }); }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
