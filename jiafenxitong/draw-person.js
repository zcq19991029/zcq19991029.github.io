/* 随机抽人 —— 夜市翻牌（2026-11-06，完整迁移自 .tmp-ref/night-market-draw-prototype.html）
 *
 * 交互（和原型一致）：
 *   进入 → 按当前班发一组牌（最多 6 张，牌背朝上）
 *        → 可点任意一张自己翻，也可以点「开始翻牌 ▶」按 120ms 错峰自动翻
 *        → 本轮翻到设定的张数为止（1~6，默认 6）
 *        → 「↻ 刷新下一组」重新洗一组牌，接着抽下一组
 *
 * 呈现：顶栏（像素动效 / NIGHT MARKET / 点券 + 老师头像 + ✕）→ 工具条（班级 / 数量 /
 *   开始翻牌 / 刷新）→ 状态行 → 卡组 → 底部说明。牌面：稀有度、像素动效、姓名、学号、
 *   课堂幸运卡 + 点券，金卡落定后会呼吸发光。
 *
 * 业务逻辑（原样保留）：
 *   · 名单来源 app.js 注入的 JFDT_DRAW_SRC（当前班 / 可见班 / 名单），每次现读不缓存；
 *   · 同一轮内不重复；跨轮 DRW.drawn 记住本轮窗口翻过的人，整班翻完再从头轮；
 *   · 老师选的张数记在 localStorage（下次打开沿用）；
 *   · 切班 / 改张数 / 刷新 / 关窗都会停掉动画与像素循环，不把定时器写到新舞台上。
 *
 * 性能：翻牌纯 transform；像素动效全页一条 rAF，12fps 封顶；is-lite / 关动画偏好直接出结果。
 *
 * 对外接口：JFDrawPerson.open() / bind(src) / ready()
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* app.js 注入的数据源。没注入就什么都不做（open() 会提示未就绪） */
  var SRC = null;

  var MAX_CARDS = 6;
  var CNT_KEY = 'jfdt-draw-count';   // 记住老师上次选的数量
  var CLS_KEY = 'jfdt-draw-cls';     // 记住选的班（一次课一个班）

  /* 状态机：idle → dealing（发牌）→ flipping（错峰翻面）→ revealed（静止在结果上）
     refreshing 是刷新卡组时的 220ms 洗牌过渡。 */
  var DRW = {
    cls: null, count: 6, busy: false, phase: 'idle',
    pool: [], box: null, round: [], drawn: [], gen: 0, timers: [], dealt: []
  };

  function classes() { return (SRC && SRC.classes && SRC.classes()) || []; }
  function rosterOf(cls) { return (SRC && SRC.rosterOf && SRC.rosterOf(cls)) || []; }
  function curClassNow() { return (SRC && SRC.curClass && SRC.curClass()) || classes()[0] || null; }

  /* 选哪个班：localStorage 上次选过的（失效就回落）→ 当前正在看的班 → 第一个班 */
  function pickCls() {
    var list = classes();
    if (!list.length) return null;
    var ok = function (id) {
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i].id;
      return null;
    };
    var mem = null;
    try { mem = ok(localStorage.getItem(CLS_KEY)); } catch (e) { }
    var cur = curClassNow();
    return ok(mem) || ok(cur && cur.id) || list[0].id;
  }

  function drwCls() {
    var list = classes();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(DRW.cls)) return list[i];
    return list[0] || null;
  }

  /* 当前班的名单快照：{ name, sid, no } → { id, name, sid, seq, cls, group } */
  function drwPool() {
    var c = drwCls(); if (!c) return [];
    return rosterOf(c).filter(function (r) {
      return r && r.name;
    }).map(function (r) {
      return {
        id: r.sid || r.id || r.name,
        name: r.name,
        sid: (r.sid == null || r.sid === '' ? '' : String(r.sid)),
        seq: (r.no == null ? null : r.no),
        cls: c.name,
        group: groupLabel(c, r)
      };
    });
  }

  /* 这个人在当前班分到第几组（没分组就返回空串） */
  function groupLabel(cls, r) {
    var gs = (cls && cls.groups) || [];
    for (var i = 0; i < gs.length; i++) {
      var ms = gs[i].members || [];
      for (var j = 0; j < ms.length; j++) {
        var m = ms[j];
        if (!m || !m.name) continue;
        if (r.sid && m.sid && String(m.sid) === String(r.sid)) return '第 ' + gs[i].no + ' 组';
        if (!r.sid && m.name === r.name) return '第 ' + gs[i].no + ' 组';
      }
    }
    return '';
  }

  /* 学号：优先真实学号，没有就退班内序号（都没有显示占位符，绝不空着） */
  function noOf(p) {
    if (p.sid) return p.sid;
    if (p.seq != null && p.seq !== '') return String(p.seq);
    return '——';
  }

  /* ── 稀有度：夜市 4 档（蓝 / 绿 / 紫 / 金）── */
  var RAR = [
    { k: 'blue', t: '精良', w: 45 },
    { k: 'green', t: '稀有', w: 32 },
    { k: 'purple', t: '史诗', w: 18 },
    { k: 'gold', t: '传说', w: 5 }
  ];
  function rollRarity() {
    var r = Math.random() * 100, acc = 0;
    for (var i = 0; i < RAR.length; i++) { acc += RAR[i].w; if (r < acc) return RAR[i]; }
    return RAR[0];
  }

  function hashOf(s) {
    var d = 0; s = String(s);
    for (var i = 0; i < s.length; i++) d = (d * 33 + s.charCodeAt(i)) % 360;
    return d;
  }
  function hueOf(p) { return hashOf(String(p.id) + String(p.name)); }
  /* 票据上的点券数字（装饰），同一个人每次一样，不闪 */
  function scoreOf(p) {
    var d = 0, s = String(p.id);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i) - 48; if (c >= 0 && c <= 9) d = (d * 31 + c) % 997; }
    return 5 + (d % 7);
  }

  function avatarHTML(p) {
    var HX = window.HXAvatar;
    if (HX && typeof HX.frame === 'function' && p.pix) {
      try {
        var u = HX.frame(p.pix, 96);
        if (u) return '<b class="drw-av has-img"><img alt="" src="' + esc(u) + '"></b>';
      } catch (e) { }
    }
    return '<b class="drw-av" style="--h:' + hueOf(p) + '">' + esc(String(p.name || '?').slice(0, 1)) + '</b>';
  }

  /* ══════════ 像素动效：全页一条 rAF，帧率封顶 12fps ══════════ */
  var FX = { raf: 0, last: 0, items: [], gap: 1000 / 12 };

  function fxPack() { var P = window.PixelFX; return (P && P.effects && P.ids && P.createFx && P.createFrame) ? P : null; }

  function fxMake(id, cssSize) {
    var P = fxPack(); if (!P) return null;
    var mod = P.effects[id] || P.effects[P.ids[0]]; if (!mod || !mod.meta || !mod.meta.size) return null;
    var W = mod.meta.size[0], H = mod.meta.size[1];
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.width = '100%';
    cv.style.height = 'auto';
    cv.setAttribute('aria-hidden', 'true');
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx || typeof ctx.createImageData !== 'function') return null;
    var O = mod.meta.origin || [W / 2, H / 2];
    return {
      cv: cv, ctx: ctx, W: W, H: H,
      img: ctx.createImageData(W, H),
      fr: P.createFrame(W, H),
      fx: P.createFx(mod, { x: O[0], y: O[1], seed: (Math.random() * 997) | 0 })
    };
  }

  function fxPaint(it, dt) {
    var P = fxPack(); if (!P) return;
    if (dt) it.fx.update(dt);
    P.clearFrame(it.fr);
    it.fx.draw(it.fr, 'back');
    it.fx.draw(it.fr, 'front');
    P.composite(it.fr, it.img.data, null);
    it.ctx.putImageData(it.img, 0, 0);
  }

  var rafFn = window.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(performance.now ? performance.now() : Date.now()); }, 16); };
  var cafFn = window.cancelAnimationFrame || function (id) { clearTimeout(id); };

  function fxTick(now) {
    FX.raf = 0;
    if (!FX.items.length) { FX.last = 0; return; }
    var dt = 0;
    if (!FX.last) { FX.last = now; dt = 0; }
    else if (now - FX.last < FX.gap - 1) { FX.raf = rafFn(fxTick); return; }
    else { dt = Math.min((now - FX.last) / 1000, .12); FX.last = now; }
    for (var i = 0; i < FX.items.length; i++) {
      try { fxPaint(FX.items[i], dt); } catch (e) { }
    }
    FX.raf = rafFn(fxTick);
  }

  function fxRun() {
    if (!FX.items.length) return;
    if (drwNoAnim()) { FX.items.forEach(function (it) { fxPaint(it, 0); }); return; }
    if (!FX.raf) { FX.last = 0; FX.raf = rafFn(fxTick); }
  }

  function fxStop() {
    if (FX.raf) { cafFn(FX.raf); FX.raf = 0; }
    FX.last = 0;
    FX.items.length = 0;
  }

  function fxMount(holder, id, startAt) {
    if (!holder) return null;
    var P = fxPack(); if (!P) return null;
    var it = fxMake(id || P.ids[(Math.random() * P.ids.length) | 0], 0);
    if (!it) return null;
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    holder.appendChild(it.cv);
    if (startAt) { try { it.fx.update(startAt); } catch (e) { } }
    FX.items.push(it);
    return it;
  }

  /* ══════════ 渲染 ══════════ */
  function cntOf(c) { return rosterOf(c).filter(function (r) { return r && r.name; }).length; }

  function drwBarHTML() {
    var list = classes(), cur = drwCls();
    if (list.length > 1) {
      return '<div class="drw-tabs">' + list.map(function (c) {
        return '<button type="button" data-c="' + esc(c.id) + '"' + (String(c.id) === String(DRW.cls) ? ' class="on"' : '') + '>' +
          esc(c.name) + '<em>' + cntOf(c) + '</em></button>';
      }).join('') + '</div>';
    }
    return '<div class="drw-clsname">' + esc(cur ? cur.name : '') + ' · ' + cntOf(cur || {}) + ' 人</div>';
  }

  /* 顶栏：左上像素动效 / 中间 NIGHT MARKET 标题 / 右上点券 + 老师头像 + 关闭 */
  function drwTopHTML() {
    var who = teacherAvatar();
    return '<header class="nm-top">' +
      '<div class="nm-fxl" id="drwFxl"></div>' +
      '<div class="nm-brand"><b>NIGHT MARKET</b><span>抽人夜市</span></div>' +
      '<div class="nm-right">' +
        '<span class="nm-vp" title="课堂点券（装饰）"><i aria-hidden="true">✦</i><b>1280</b><em>点券</em></span>' +
        '<span class="nm-me" title="当前账号">' + who + '</span>' +
        '<button type="button" class="nm-x" id="drwCloseX" aria-label="关闭">✕</button>' +
      '</div>' +
    '</header>';
  }

  function teacherAvatar() {
    var av = document.getElementById('userAvatar');
    var img = av && av.querySelector('img');
    if (img && img.getAttribute('src')) return '<b class="drw-av has-img"><img alt="" src="' + esc(img.getAttribute('src')) + '"></b>';
    var ch = (av && (av.textContent || '').trim()).slice(0, 1) || '华';
    return '<b class="drw-av" style="--h:268">' + esc(ch) + '</b>';
  }

  function drwFootHTML() {
    if (DRW.busy) return '<span class="drw-tip">正在翻牌…</span>';
    if (DRW.phase === 'revealed') {
      var names = DRW.round.map(function (it) { return it.p.name; });
      return '<span class="drw-tip">本轮翻出 <b>' + names.length + '</b> 人' +
        (names.length ? '：' + esc(names.join('、')) : '') + '</span><span class="nm-note">点「刷新下一组」继续</span>';
    }
    var n = effCount();
    return '<span class="drw-tip">每轮最多 ' + n + ' 人 · 翻开后本轮不重复</span><span class="nm-note">刷新后继续抽下一组卡牌</span>';
  }

  function drwGoLabel() {
    if (DRW.busy) return '翻牌中…';
    if (DRW.phase === 'revealed') return '再翻一组 ▶';
    return '开始翻牌 ▶';
  }

  function drwToolHTML() {
    var btns = '';
    for (var i = 1; i <= MAX_CARDS; i++) {
      btns += '<button type="button" data-k="' + i + '"' + (i === DRW.count ? ' class="on"' : '') + '>' + i + '</button>';
    }
    var dis = DRW.busy ? ' disabled' : '';
    return drwBarHTML() +
      '<div class="drw-count"><span>本轮抽取</span><div class="drw-cbtns">' + btns + '</div></div>' +
      '<button type="button" class="drw-go" id="drwGo"' + dis + '>' + drwGoLabel() + '</button>' +
      '<button type="button" class="drw-refresh" id="drwRefresh"' + dis + '>↻ 刷新下一组</button>';
  }

  function drwSelHTML() {
    var c = drwCls();
    if (DRW.busy) return '正在翻牌…';
    if (DRW.phase === 'revealed') return '本轮已翻出 ' + DRW.round.length + ' 人 · 刷新下一组接着抽';
    return '可自选翻开 1～' + effCount() + ' 张卡牌 · 当前班级：' + esc(c ? c.name : '—') + ' · 共 ' + cntOf(c || {}) + ' 人';
  }

  /* 牌背：霓虹底面 + 菱形套菱形 + 中央 ◇ + 品牌字（原型 .back） */
  function backHTML() {
    return '<div class="drw-cback"><i class="nm-dia d1"></i><i class="nm-dia d2"></i>' +
      '<b class="nm-sig" aria-hidden="true">◇</b><small>华夏 · NIGHT MARKET</small></div>';
  }

  /* 牌面：稀有度 / 像素动效 / 姓名 + 学号 / 第 N 组 / 课堂幸运卡（原型 .front） */
  function faceHTML(p, r) {
    return '<div class="drw-cn"><em class="drw-rar">' + esc(r.t) + ' · 小组加分</em></div>' +
      '<div class="drw-mid">' +
        '<i class="drw-fx" data-fx aria-hidden="true"></i>' +
        '<strong class="drw-nm">' + esc(p.name) + '</strong>' +
        '<span class="drw-no">' + esc(noOf(p)) + '</span>' +
      '</div>' +
      '<div class="drw-tag">' + (p.group ? '<span>' + esc(p.group) + '</span>' : '') + '</div>' +
      '<div class="nm-ticket"><span>课堂幸运卡</span>' +
        '<span class="drw-vp">' + avatarHTML(p) + '<b>✦' + scoreOf(p) + '</b><em>分</em></span>' +
      '</div>';
  }

  function effCount() {
    var cap = DRW.pool.length || 0;
    if (!cap) return DRW.count;
    return Math.max(1, Math.min(DRW.count, cap));
  }

  function drwRender(box) {
    DRW.box = box; DRW.pool = drwPool();
    fxStop();
    box.innerHTML = drwTopHTML() +
      '<div class="nm-tool" id="drwTool">' + drwToolHTML() + '</div>' +
      '<div class="nm-sel" id="drwSel">' + drwSelHTML() + '</div>' +
      '<div class="nm-stage" id="drwStage" data-phase="idle" role="region" aria-label="抽人夜市卡组">' +
        '<div class="nm-grid" id="drwGrid"></div>' +
        '<p class="drw-live" id="drwLive" role="status" aria-live="polite"></p>' +
      '</div>' +
      '<footer class="drw-foot" id="drwFoot">' + drwFootHTML() + '</footer>';

    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () {
        if (DRW.busy) return;
        drwSwitch(b.getAttribute('data-c'), box);
      };
    });
    var x = box.querySelector('#drwCloseX'); if (x) x.onclick = function () { drwHalt(); closeDlg(); };

    drwDeal(box);
    drwBindFoot(box);

    fxMount(box.querySelector('#drwFxl'), '', .2);
    fxRun();
  }

  /* 发一组牌：effCount 张真卡 + (MAX_CARDS - effCount) 个暗掉的空位。
     空位用 .drw-slot，所以「.drw-card 数量 = 这一组翻几张」永远成立。 */
  function drwDeal(box) {
    DRW.pool = drwPool();
    var g = box.querySelector('#drwGrid'); if (!g) return;
    var n = effCount();
    var picks = sampleForDeal(n);
    DRW.dealt = picks.map(function (p) { return { p: p, r: rollRarity() }; });
    DRW.round = [];
    DRW.phase = 'idle'; DRW.busy = false;
    var html = '';
    for (var i = 0; i < MAX_CARDS; i++) {
      if (i < n) {
        var it = DRW.dealt[i] || { p: { name: '—', sid: '', group: '' }, r: RAR[0] };
        html += '<article class="drw-card" data-i="' + i + '" data-r="' + it.r.k + '" style="--i:' + i + '">' +
          '<div class="drw-cardin"><div class="drw-cback-wrap">' + backHTML() + '</div>' +
          '<div class="drw-cface">' + faceHTML(it.p, it.r) + '</div></div></article>';
      } else {
        html += '<div class="drw-slot" style="--i:' + i + '" aria-hidden="true"></div>';
      }
    }
    g.innerHTML = html;
    g.classList.remove('is-washing');
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', 'idle');
    var live = box.querySelector('#drwLive'); if (live) live.textContent = '';
    drwRefreshChrome(box);
    g.querySelectorAll('.drw-card').forEach(function (el) {
      el.onclick = function () { drwManualFlip(el, box); };
    });
  }

  /* 从名单里取 n 个：避开本轮窗口翻过的人；整班不够就从头轮 */
  function sampleForDeal(n) {
    var pool = DRW.pool.slice();
    if (!pool.length) return [];
    var used = {};
    DRW.drawn.forEach(function (id) { used[id] = true; });
    var avail = pool.filter(function (p) { return !used[p.id]; });
    if (avail.length < n) { DRW.drawn = []; avail = pool.slice(); }
    for (var i = avail.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = avail[i]; avail[i] = avail[j]; avail[j] = t;
    }
    return avail.slice(0, Math.min(n, avail.length));
  }

  function drwRefreshChrome(box) {
    var t = box.querySelector('#drwTool'); if (t) t.innerHTML = drwToolHTML();
    var s = box.querySelector('#drwSel'); if (s) s.textContent = drwSelHTML();
    var f = box.querySelector('#drwFoot'); if (f) f.innerHTML = drwFootHTML();
    /* 工具条是整块重画的，班级 tab 的点击要跟着重新绑（否则刷新一次就点不动了） */
    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () {
        if (DRW.busy) return;
        drwSwitch(b.getAttribute('data-c'), box);
      };
    });
    var g = box.querySelector('#drwGrid'); if (g) g.querySelectorAll('.drw-card').forEach(function (el) {
      el.onclick = function () { drwManualFlip(el, box); };
    });
    drwBindFoot(box);
  }

  /* 手动翻一张（原型：点牌就翻） */
  function drwManualFlip(card, box) {
    if (DRW.busy || !card || card.classList.contains('is-flip')) return;
    var i = parseInt(card.getAttribute('data-i'), 10);
    var it = DRW.dealt[i]; if (!it) return;
    if (DRW.round.length >= effCount()) return;
    card.classList.add('is-flip');
    DRW.round.push(it);
    if (DRW.drawn.indexOf(it.p.id) < 0) DRW.drawn.push(it.p.id);
    drwAfterFlip(box);
  }

  function drwAfterFlip(box) {
    var all = box.querySelectorAll('.drw-card.is-flip').length;
    var live = box.querySelector('#drwLive');
    var names = DRW.round.map(function (it) { return it.p.name; });
    if (live) live.textContent = '本轮已翻开 ' + all + ' 人' + (names.length ? '：' + names.join('、') : '');
    DRW.phase = all >= effCount() ? 'revealed' : 'idle';
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', DRW.phase);
    drwRefreshChrome(box);
    if (DRW.phase === 'revealed') drwSettle(box, all);
  }

  /* 落定：全部翻好，像素动效这时候才跑（原型也是翻完才亮） */
  function drwSettle(box, n) {
    DRW.busy = false;
    DRW.phase = 'revealed';
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', 'revealed');
    drwRefreshChrome(box);
    var names = DRW.round.map(function (it) { return it.p.name; });
    var live = box.querySelector('#drwLive');
    if (live) live.textContent = '本轮翻出 ' + names.length + ' 人：' + names.join('、');
    fxStop();
    var grid = box.querySelector('#drwGrid');
    if (grid) grid.querySelectorAll('.drw-card.is-flip .drw-fx').forEach(function (h) { fxMount(h, '', .2 + Math.random() * 1.4); });
    fxMount(box.querySelector('#drwFxl'), '', .2);
    fxRun();
    if (!DRW.round.length || n == null) return;
  }

  function drwBindFoot(box) {
    box.querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () {
        if (DRW.busy) return;
        drwSetCount(parseInt(b.getAttribute('data-k'), 10) || 1, box);
      };
    });
    var go = box.querySelector('#drwGo'); if (go) go.onclick = function () { drwFlip(box); };
    var rf = box.querySelector('#drwRefresh'); if (rf) rf.onclick = function () { drwRefresh(box); };
  }

  /* 改数量：只换牌（不抽），老师随时能改成本组翻 1~6 张 */
  function drwSetCount(n, box) {
    n = Math.max(1, Math.min(MAX_CARDS, n || 1));
    if (n === DRW.count && DRW.phase !== 'revealed') return;
    DRW.count = n;
    try { localStorage.setItem(CNT_KEY, String(n)); } catch (e) { }
    drwClearTimers(); fxStop();
    drwDeal(box);
    fxMount(box.querySelector('#drwFxl'), '', .2);
    fxRun();
    var live = box.querySelector('#drwLive'); if (live) live.textContent = '本轮翻 ' + n + ' 张';
  }

  /* 切班：换班等于换这节课的班，名单全部重来 */
  function drwSwitch(id, box) {
    var list = classes(), hit = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) hit = list[i];
    if (!hit) return;
    DRW.cls = hit.id; DRW.round = []; DRW.drawn = []; DRW.phase = 'idle'; DRW.busy = false;
    drwClearTimers(); fxStop();
    try { localStorage.setItem(CLS_KEY, String(hit.id)); } catch (e) { }
    drwDeal(box);
    fxMount(box.querySelector('#drwFxl'), '', .2);
    fxRun();
  }

  function closeDlg() {
    var d = document.getElementById('dlgDraw');
    if (d && typeof d.close === 'function') d.close();
  }

  function drwNoAnim() {
    var de = document.documentElement;
    var lite = de.classList.contains('is-lite') || de.classList.contains('hx-lite');
    var rm = false;
    try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    return lite || rm;
  }

  function drwClearTimers() {
    for (var i = 0; i < DRW.timers.length; i++) clearTimeout(DRW.timers[i]);
    DRW.timers.length = 0;
  }
  function drwLater(fn, ms) { DRW.timers.push(setTimeout(fn, ms)); }

  function drwHalt() {
    drwClearTimers();
    fxStop();
    DRW.busy = false;
    DRW.gen += 1;
  }

  /* ── 一轮翻牌 ──
     时序：dealing .42s（发牌）→ flipping 每张错 120+i*190+0~180ms，单片 .72s → revealed。
     和 draw-person.css 的 nmDeal / .drw-cardin 时长对应。 */
  var T_DEAL = 420, T_FLIP = 720, ST_FLIP = 190, ST_DEAL = 55;

  function drwFlip(box) {
    if (DRW.busy) return;
    if (!box || !box.isConnected) return;
    if (!DRW.pool.length) { toast('这个班还没有学生：先在「待分配名单」里导入全班名单'); return; }
    if (DRW.phase === 'revealed') {           // 「再翻一组」：重发一组新牌，立刻开翻
      drwClearTimers(); fxStop();
      drwDeal(box);
      drwAutoFlip(box);
      return;
    }
    drwAutoFlip(box);
  }

  function drwAutoFlip(box) {
    var left = effCount() - box.querySelectorAll('.drw-card.is-flip').length;
    if (left <= 0) return;
    if (!DRW.pool.length) { toast('这个班还没有学生：先在「待分配名单」里导入全班名单'); return; }
    DRW.busy = true;
    DRW.gen += 1;
    var gen = DRW.gen;
    drwClearTimers();
    fxStop();
    DRW.phase = 'dealing';
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', 'dealing');
    drwRefreshChrome(box);
    var pending = [];
    box.querySelectorAll('.drw-card:not(.is-flip)').forEach(function (el) { pending.push(el); });
    if (!pending.length) { DRW.busy = false; return; }

    if (drwNoAnim()) {
      pending.forEach(function (el) { drwDoFlip(el, box); });
      drwSettle(box);
      return;
    }

    drwLater(function () {
      if (!box.isConnected || DRW.gen !== gen) return;
      DRW.phase = 'flipping';
      var st = box.querySelector('#drwStage'); if (st) st.setAttribute('data-phase', 'flipping');
      pending.forEach(function (el, i) {
        drwLater(function () {
          if (!box.isConnected || DRW.gen !== gen) return;
          drwDoFlip(el, box);
        }, 120 + i * ST_FLIP + Math.random() * 180);
      });
      var last = 120 + (pending.length - 1) * ST_FLIP + 180 + T_FLIP + 40;
      drwLater(function () {
        if (!box.isConnected || DRW.gen !== gen) return;
        drwSettle(box);
      }, last);
    }, T_DEAL);
  }

  function drwDoFlip(el, box) {
    if (!el || el.classList.contains('is-flip')) return;
    var i = parseInt(el.getAttribute('data-i'), 10);
    var it = DRW.dealt[i]; if (!it) return;
    el.classList.add('is-flip');
    DRW.round.push(it);
    if (DRW.drawn.indexOf(it.p.id) < 0) DRW.drawn.push(it.p.id);
    var names = DRW.round.map(function (x) { return x.p.name; });
    var live = box.querySelector('#drwLive');
    if (live) live.textContent = '本轮已翻开 ' + DRW.round.length + ' 人' + (names.length ? '：' + names.join('、') : '');
  }

  /* ── 刷新下一组：清空本轮结果、重新发一组牌（数量不变） ── */
  function drwRefresh(box) {
    if (DRW.busy) return;
    if (!box || !box.isConnected) return;
    drwClearTimers(); fxStop();
    DRW.busy = true; DRW.phase = 'refreshing';
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', 'refreshing');
    var grid = box.querySelector('#drwGrid'); if (grid) grid.classList.add('is-washing');
    var live = box.querySelector('#drwLive'); if (live) live.textContent = '';
    drwLater(function () {
      if (!box.isConnected) return;
      DRW.busy = false;
      if (grid) grid.classList.remove('is-washing');
      drwDeal(box);
      fxMount(box.querySelector('#drwFxl'), '', .2);
      fxRun();
    }, 220);
  }

  /* 轻提示：小组加分顶栏的 #saveState 就是提示条 */
  function toast(msg) {
    if (SRC && SRC.toast) { SRC.toast(msg); return; }
    var el = document.getElementById('saveState');
    if (el) el.textContent = msg;
  }

  function open() {
    if (!SRC) return toast('抽人还没准备好，请刷新页面重试');
    var list = classes();
    if (!list.length) return toast('还没有班级：先在「数据与备份」里导入班级和名单');

    DRW.cls = pickCls();
    DRW.gen += 1;
    DRW.round = []; DRW.drawn = []; DRW.busy = false; DRW.phase = 'idle';
    drwClearTimers(); fxStop();

    var n = 6;
    try { n = parseInt(localStorage.getItem(CNT_KEY), 10) || 6; } catch (e) { }
    DRW.count = Math.max(1, Math.min(MAX_CARDS, n));

    var d = document.getElementById('dlgDraw');
    if (!d) return toast('抽人窗口没加载出来，请刷新页面');
    if (!d.__drwBound) {
      d.__drwBound = true;
      d.addEventListener('close', function () { drwHalt(); });
    }

    var box = d.querySelector('#drw');
    if (box) drwRender(box);
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute('open', '');
    }
  }

  function bind(src) { SRC = src || null; }

  window.JFDrawPerson = { open: open, bind: bind, ready: function () { return !!SRC; } };

  function autoBind() {
    if (!SRC && window.JFDT_DRAW_SRC) bind(window.JFDT_DRAW_SRC);
    return SRC;
  }
  autoBind();

  var entry = document.getElementById('btnDrawPerson');
  if (entry) entry.addEventListener('click', function () { autoBind(); open(); });

  var closeBtn = document.getElementById('btnDrawClose');
  if (closeBtn) closeBtn.addEventListener('click', function () { drwHalt(); closeDlg(); });
})();
