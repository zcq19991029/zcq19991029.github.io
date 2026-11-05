/* 随机抽人 —— 无畏契约「夜市」抽卡版（2026-11-06 夜市版）
 *
 * 流程：老师先选这一组翻几张（1~6）→ 舞台横排 n 张牌背 → 点「开始翻牌」
 *       → 依次错峰 3D 翻面（每张间隔 120ms）→ 每张牌正面是【学号 + 姓名】，
 *         左上角一个随机像素动效，右上角「点券」角标挂该同学的头像，稀有度决定边框与光晕。
 *       → 「刷新卡组」清空本轮、重新发一组背面牌（数量不变），可以接着翻下一组。
 *
 * 稀有度（复刻夜市金 / 紫 / 绿 / 蓝）：蓝 45%、绿 32%、紫 18%、金 5%，每张牌独立摇。
 *
 * 抽取逻辑：结果在翻牌前先算好（动画只负责演），同一轮内不重复；
 *   DRW.drawn 记住本窗口已经翻出来过的人，下一组会先绕开他们，整班发完再从头轮。
 *   busy + 按钮禁用双保险防连点。
 *
 * 性能红线（教室一体机 4G/4核）：
 *   ① 翻牌是纯 CSS transform（rotateY），JS 只在错峰调度时 setTimeout；
 *   ② 像素动效全页只有一条 rAF，帧率封顶 12fps，动画结束 / 刷新 / 关窗立刻 cancel；
 *   ③ is-lite、prefers-reduced-motion 下不演过程：直接摆好翻开的牌、像素动效只画静态一帧。
 *
 * 头像：小组加分页面没有引 总入口/fx/hx-avatar.js（那个包太重，不为了一个角标去引），
 *   所以按约定退回首字圆形头像；万一将来页面引了 HXAvatar，frame() 会自动接管。
 *
 * 数据源由 app.js 通过 JFDrawPerson.bind({ classes, rosterOf, curClass, toast }) 注入。
 * 对外接口只有 JFDrawPerson.open() / JFDrawPerson.ready。
 *
 * ⚠ 接线仿真 src/rank.js 里还有一份老的抽人实现，两边已经分叉，不要互相覆盖。
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
     refreshing 是刷新卡组的那 220ms 洗牌过渡；error 只在被打断时短暂出现。 */
  var DRW = {
    cls: null, count: 6, busy: false, phase: 'idle',
    pool: [], box: null, round: [], drawn: [], gen: 0, timers: [], cw: 0
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

  /* 当前班的名单快照：小组加分的 roster 条目是 { name, sid, no }（sid = 学号，no = 班内序号），
     统一映射成抽人模块认的 { id, name, sid, seq, cls, group } */
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

  /* 这个人在当前班分到第几组（没分组就返回空串）。抽到人之后老师要立刻知道给哪一组加分。 */
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

  /* ── 稀有度：复刻夜市金 / 紫 / 绿 / 蓝 ── */
  var RAR = [
    { k: 'blue', t: '精良', w: 45, vp: [120, 320] },
    { k: 'green', t: '稀有', w: 32, vp: [280, 620] },
    { k: 'purple', t: '史诗', w: 18, vp: [560, 1000] },
    { k: 'gold', t: '传说', w: 5, vp: [900, 1600] }
  ];
  function rollRarity() {
    var r = Math.random() * 100, acc = 0;
    for (var i = 0; i < RAR.length; i++) { acc += RAR[i].w; if (r < acc) return RAR[i]; }
    return RAR[0];
  }

  /* 名字 / 学号 → 稳定的色相，做首字头像的底色（同一个人每次都一样，不是随机闪色） */
  function hueOf(p) {
    var d = 0, s = String(p.id) + String(p.name);
    for (var i = 0; i < s.length; i++) d = (d * 33 + s.charCodeAt(i)) % 360;
    return d;
  }
  /* 点券数字只是装饰，但同一个人同一稀有度要稳定（不闪），所以用 id 做种子 */
  function vpOf(p, r) {
    var d = 0, s = String(p.id);
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i) - 48; if (c >= 0 && c <= 9) d = (d * 31 + c) % 997; }
    var span = r.vp[1] - r.vp[0] + 1;
    return r.vp[0] + (d % span);
  }
  /* 头像：有 HXAvatar 就用像素头像（页面目前没引，自动跳过），否则首字 */
  function avatarHTML(p, size) {
    var HX = window.HXAvatar;
    if (HX && typeof HX.frame === 'function' && p.pix) {
      try {
        var u = HX.frame(p.pix, size || 96);
        if (u) return '<b class="drw-av has-img"><img alt="" src="' + esc(u) + '"></b>';
      } catch (e) { }
    }
    return '<b class="drw-av" style="--h:' + hueOf(p) + '">' + esc(String(p.name || '?').slice(0, 1)) + '</b>';
  }

  /* ══════════ 像素动效：全页一条 rAF，帧率封顶 12fps ══════════ */
  var FX = { raf: 0, last: 0, items: [], gap: 1000 / 12 };

  function fxPack() { var P = window.PixelFX; return (P && P.effects && P.ids && P.createFx && P.createFrame) ? P : null; }

  /* 造一块像素画布（尺寸按特效 meta.size，CSS 上等比缩到 cssSize 宽） */
  function fxMake(id, cssSize) {
    var P = fxPack(); if (!P) return null;
    var mod = P.effects[id] || P.effects[P.ids[0]]; if (!mod || !mod.meta || !mod.meta.size) return null;
    var W = mod.meta.size[0], H = mod.meta.size[1];
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.style.width = cssSize + 'px';
    cv.style.height = Math.round(cssSize * H / W) + 'px';
    cv.setAttribute('aria-hidden', 'true');
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx || typeof ctx.createImageData !== 'function') return null;   // 无 canvas 环境（jsdom）：静默降级
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
    else if (now - FX.last < FX.gap - 1) { FX.raf = rafFn(fxTick); return; }   // 帧率封顶
    else { dt = Math.min((now - FX.last) / 1000, .12); FX.last = now; }
    for (var i = 0; i < FX.items.length; i++) {
      try { fxPaint(FX.items[i], dt); } catch (e) { /* 单个坏掉不影响别的 */ }
    }
    FX.raf = rafFn(fxTick);
  }

  function fxRun() {
    if (!FX.items.length) return;
    if (drwNoAnim()) { FX.items.forEach(function (it) { fxPaint(it, 0); }); return; }  // 省电 / 关动画：只画一帧
    if (!FX.raf) { FX.last = 0; FX.raf = rafFn(fxTick); }
  }

  /* 停循环 + 清空所有画布引用（刷新卡组、关窗、重新抽都要调） */
  function fxStop() {
    if (FX.raf) { cafFn(FX.raf); FX.raf = 0; }
    FX.last = 0;
    FX.items.length = 0;
  }

  /* 往一个容器里挂一个会动的像素动效（id 为空就随机挑）。
     挂之前先清空容器：刷新 / 落定时会重复调用，不清就会叠出一摞 canvas。 */
  function fxMount(holder, id, cssSize, startAt) {
    if (!holder) return null;
    var P = fxPack(); if (!P) return null;
    var it = fxMake(id || P.ids[(Math.random() * P.ids.length) | 0], cssSize);
    if (!it) return null;
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    holder.appendChild(it.cv);
    /* 错开相位：6 张牌同一秒起步会像广播体操，先空推一个随机时长 */
    if (startAt) { try { it.fx.update(startAt); } catch (e) { } }
    FX.items.push(it);
    return it;
  }

  /* 卡片左上角那颗：落定后一起跑（共享同一条 rAF，不多开循环）。
     尺寸按卡片实际宽度算（.drw-fx 占卡宽 26%），jsdom 量不到就用 30px 兜底。 */
  function fxOnCard(holder, cardW) {
    if (!holder) return null;
    var px = Math.max(20, Math.min(72, Math.round((cardW || 115) * .3)));
    return fxMount(holder, '', px, .2 + Math.random() * 1.4);
  }

  /* ══════════ 渲染 ══════════ */

  function cntOf(c) { return rosterOf(c).filter(function (r) { return r && r.name; }).length; }

  function drwBarHTML() {
    var list = classes(), cur = drwCls();
    /* 只有一个班就不摆 tabs（一次课就一个班），直接把班名和人数写在标题区；
       有多个班才摆 tab 供切换 —— 不管几个班都不会出现「全部班级」这种混抽选项。 */
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

  /* 右上角那颗头像 = 华夏工具当前登录老师（顶栏 #userAvatar 已经画好了，直接借过来用）。
     没有就退回一个「华」字圆盘 —— 绝不空着。 */
  function teacherAvatar() {
    var av = document.getElementById('userAvatar');
    var img = av && av.querySelector('img');
    if (img && img.getAttribute('src')) return '<b class="drw-av has-img"><img alt="" src="' + esc(img.getAttribute('src')) + '"></b>';
    var ch = (av && (av.textContent || '').trim()).slice(0, 1) || '华';
    return '<b class="drw-av" style="--h:268">' + esc(ch) + '</b>';
  }

  /* 底部工具条：数量 1~6 / 开始翻牌 / 刷新卡组 */
  function drwFootHTML() {
    var btns = '';
    for (var i = 1; i <= MAX_CARDS; i++) {
      btns += '<button type="button" data-k="' + i + '"' + (i === DRW.count ? ' class="on"' : '') + '>' + i + '</button>';
    }
    var label = DRW.busy ? '翻牌中…' : (DRW.phase === 'revealed' ? '再翻一组 ▶' : '开始翻牌 ▶');
    var tip = DRW.busy ? '正在翻牌…'
      : DRW.phase === 'revealed'
        ? '本轮已翻 ' + DRW.round.length + ' 人 · 可点「刷新卡组」换一组'
        : '每轮最多 6 人 · 本轮不重复';
    return '<div class="drw-count"><span>本轮抽取</span><div class="drw-cbtns">' + btns + '</div></div>' +
      '<button type="button" class="drw-go" id="drwGo"' + (DRW.busy ? ' disabled' : '') + '>' + label + '</button>' +
      '<button type="button" class="drw-refresh" id="drwRefresh"' + (DRW.busy ? ' disabled' : '') + '>↻ 刷新卡组</button>' +
      '<span class="drw-tip" id="drwTip">' + tip + '</span>';
  }

  /* 牌背：深紫黑底 + 霓虹边框 + 中央菱形几何花纹 + 底下一行品牌字 */
  function backHTML() {
    return '<div class="drw-cback"><i class="nm-dia d1"></i><i class="nm-dia d2"></i>' +
      '<b class="nm-sig" aria-hidden="true">◇</b><small>华夏 · NIGHT MARKET</small></div>';
  }

  /* 发一组牌：effCount 张真卡 + (6-effCount) 个暗掉的空位。
     空位用 .drw-slot（不是 .drw-card），所以「.drw-card 数量 = 这一组翻几张」永远成立；
     班里的学生比选的张数还少时（5 人班选 6 张），以人数为准，不摆空白牌。 */
  function effCount() {
    var cap = DRW.pool.length || 0;
    if (!cap) return DRW.count;
    return Math.max(1, Math.min(DRW.count, cap));
  }

  function drwGrid(box) {
    var g = box.querySelector('#drwGrid'); if (!g) return g;
    var n = effCount(), html = '';
    for (var i = 0; i < MAX_CARDS; i++) {
      if (i < n) {
        html += '<div class="drw-card" data-i="' + i + '" style="--i:' + i + '">' +
          '<div class="drw-cardin"><div class="drw-cback-wrap">' + backHTML() + '</div>' +
          '<div class="drw-cface"></div></div></div>';
      } else {
        html += '<div class="drw-slot" style="--i:' + i + '" aria-hidden="true"></div>';
      }
    }
    g.innerHTML = html;
    return g;
  }

  function faceHTML(p, r) {
    return '<div class="drw-cn">' +
        '<i class="drw-fx" data-fx aria-hidden="true"></i>' +
        '<span class="drw-vp" title="课堂点券（装饰）">' + avatarHTML(p, 96) + '<b>✦' + vpOf(p, r) + '</b></span>' +
      '</div>' +
      '<div class="drw-mid"><b class="drw-no">' + esc(noOf(p)) + '</b>' +
        '<span class="drw-nm">' + esc(p.name) + '</span></div>' +
      '<div class="drw-tag"><em class="drw-rar">' + esc(r.t) + '</em>' +
        (p.group ? '<span>' + esc(p.group) + '</span>' : '') + '</div>';
  }

  function drwRender(box) {
    DRW.box = box; DRW.pool = drwPool();
    fxStop();
    box.innerHTML = drwTopHTML() +
      '<div class="drw-tabrow">' + drwBarHTML() + '</div>' +
      '<div class="drw-stage" id="drwStage" data-phase="idle" role="region" aria-label="抽人夜市卡组">' +
        '<div class="drw-grid" id="drwGrid"></div>' +
        '<p class="drw-live" id="drwLive" role="status" aria-live="polite"></p>' +
      '</div>' +
      '<footer class="drw-foot" id="drwFoot">' + drwFootHTML() + '</footer>';

    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () {
        if (DRW.busy) return;               // 翻牌中途不许换班：换班要重画卡组，动画会被打断
        drwSwitch(b.getAttribute('data-c'), box);
      };
    });
    var x = box.querySelector('#drwCloseX'); if (x) x.onclick = function () { drwHalt(); closeDlg(); };

    drwGrid(box);
    drwFit(box);
    drwBindFoot(box);

    /* 左上角那颗常驻像素动效：随机挑一个，只在窗口开着的时候跑 */
    fxMount(box.querySelector('#drwFxl'), '', 46);
    fxRun();
  }

  /* 切班：换班等于换这节课的班，名单全部重来（busy 一并归零，重画之后是新舞台） */
  function drwSwitch(id, box) {
    var list = classes(), hit = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) hit = list[i];
    if (!hit) return;
    DRW.cls = hit.id; DRW.round = []; DRW.drawn = []; DRW.phase = 'idle'; DRW.busy = false;
    drwClearTimers();
    try { localStorage.setItem(CLS_KEY, String(hit.id)); } catch (e) { }
    drwRender(box);
  }

  /* 状态机推进：DRW.phase + 舞台 data-phase（CSS 动画都挂在 data-phase 上） */
  function drwPhase(box, p) {
    DRW.phase = p;
    var s = box.querySelector('#drwStage'); if (s) s.setAttribute('data-phase', p);
    var f = box.querySelector('#drwFoot'); if (f) { f.innerHTML = drwFootHTML(); drwBindFoot(box); }
  }

  function drwGo(box, label, dis) {
    var g = box.querySelector('#drwGo'); if (g) { g.textContent = label; g.disabled = !!dis; }
    var r = box.querySelector('#drwRefresh'); if (r) r.disabled = !!dis;
  }

  /* 按舞台实际尺寸算卡片宽高（纯 CSS 的 min()/calc 在老 Chromium 上不稳，这里算一次写变量）。
     两个约束同时咬：① 6 张必须并排塞进舞台宽度；② 卡片高度不超过舞台的 96%。
     比例 0.42（宽/高）是夜市长卡的手感，比 0.62 的方卡更接近参考网页。 */
  var CARD_RATIO = 0.40;
  function drwFit(box) {
    var stage = box.querySelector('#drwStage'); if (!stage) return;
    var g = box.querySelector('#drwGrid'); if (!g) return;
    var W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;                 // jsdom / 还没布局：交给 CSS 里的默认值
    var gap = Math.max(6, Math.round(W * 0.012));
    var cw = Math.floor(Math.min((W * 0.98 - gap * 5) / MAX_CARDS, H * 0.96 * CARD_RATIO));
    cw = Math.max(60, cw);
    var ch = Math.round(cw / CARD_RATIO);
    DRW.cw = cw;
    g.style.setProperty('--gap', gap + 'px');
    g.style.setProperty('--cw', cw + 'px');
    g.style.setProperty('--ch', ch + 'px');
  }

  var fitTimer = 0;
  window.addEventListener('resize', function () {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      if (DRW.box && DRW.box.isConnected) drwFit(DRW.box);
    }, 160);
  });

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
    DRW.round = []; DRW.phase = 'idle'; DRW.busy = false;
    drwClearTimers(); fxStop();
    drwGrid(box); drwFit(box);
    box.querySelector('#drwStage').setAttribute('data-phase', 'idle');
    var f = box.querySelector('#drwFoot'); if (f) { f.innerHTML = drwFootHTML(); drwBindFoot(box); }
    var live = box.querySelector('#drwLive'); if (live) live.textContent = '本轮翻 ' + n + ' 张';
  }

  function closeDlg() {
    var d = document.getElementById('dlgDraw');
    if (d && typeof d.close === 'function') d.close();
  }

  var drwSleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* 关动画偏好 / 低端设备（hx-theme 的 is-lite）走 fast 路径，直接出结果 */
  function drwNoAnim() {
    var lite = document.documentElement.classList.contains('is-lite') || document.documentElement.classList.contains('hx-lite');
    var rm = false;
    try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    return lite || rm;
  }

  function drwClearTimers() {
    for (var i = 0; i < DRW.timers.length; i++) clearTimeout(DRW.timers[i]);
    DRW.timers.length = 0;
  }
  function drwLater(fn, ms) { DRW.timers.push(setTimeout(fn, ms)); }

  /* 打断（关窗 / 换班 / 重新发牌）：停掉所有定时器和像素循环，别再往新舞台上写 */
  function drwHalt() {
    drwClearTimers();
    fxStop();
    DRW.busy = false;
  }

  /* ── 抽人：从全班的名单里去掉已经翻过的，洗一洗，取前 n 个 ──
     整班都翻完了就自动从头轮（不然人少的班第二组就没牌了）。 */
  function pickStudents(pool, n) {
    var used = {};
    DRW.drawn.forEach(function (id) { used[id] = true; });
    var avail = pool.filter(function (p) { return !used[p.id]; });
    if (avail.length < n) { DRW.drawn = []; avail = pool.slice(); }
    var list = avail.slice();
    for (var i = list.length - 1; i > 0; i--) {               // Fisher-Yates，比 sort(random) 稳
      var j = (Math.random() * (i + 1)) | 0, t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list.slice(0, Math.min(n, list.length));
  }

  /* ── 一轮翻牌 ──
     时序（和 draw-person.css 的时长一一对应，改一边记得改另一边）：
       dealing .42s（每张错 45ms）→ flipping 每张错 120ms、单片翻面 .66s → revealed
     6 张合计约 2.1 秒。 */
  var T_DEAL = 420, T_FLIP = 660, ST_FLIP = 120, ST_DEAL = 45;

  function drwFlip(box) {
    if (DRW.busy) return;                                   // 状态机没走完之前，连点进不来
    if (!box || !box.isConnected) return;
    var pool = DRW.pool.length ? DRW.pool : (DRW.pool = drwPool());
    if (!pool.length) { toast('这个班还没有学生：先在「待分配名单」里导入全班名单'); return; }

    var picks = pickStudents(pool, effCount());
    if (!picks.length) { toast('这个班还没有学生：先在「待分配名单」里导入全班名单'); return; }

    /* 稀有度 + 点券先算好（结果先定，动画只负责演） */
    DRW.round = picks.map(function (p) {
      var r = rollRarity();
      return { p: p, r: r };
    });
    DRW.drawn = DRW.drawn.concat(picks.map(function (p) { return p.id; }));

    var gen = DRW.gen;
    function alive() { return box.isConnected && DRW.gen === gen; }

    DRW.busy = true;
    drwClearTimers();
    fxStop();                                                // 上一轮的卡片动效先停
    var grid = drwGrid(box);
    drwFit(box);
    drwFillFaces(grid);                                      // 正面先写好（背面朝上，看不见）
    drwPhase(box, 'dealing');
    drwGo(box, '翻牌中…', true);

    var lastFlip = (DRW.round.length - 1) * ST_FLIP;

    if (drwNoAnim()) {
      drwRevealAll(grid, box, gen);
      return;
    }

    drwLater(function () {
      if (!alive()) return;
      drwPhase(box, 'flipping');
      DRW.round.forEach(function (it, i) {
        drwLater(function () {
          if (!alive()) return;
          var card = grid.querySelector('.drw-card[data-i="' + i + '"]');
          if (card) card.classList.add('is-flip');
        }, i * ST_FLIP);
      });
      drwLater(function () {
        if (!alive()) return;
        drwSettle(box, gen);
      }, lastFlip + T_FLIP + 60);
    }, T_DEAL + (DRW.round.length - 1) * ST_DEAL + 40);
  }

  /* 把这一轮的学生写进每张卡的正面（只在背面朝上时调用，不泄漏结果） */
  function drwFillFaces(grid) {
    if (!grid) return;
    DRW.round.forEach(function (it, i) {
      var card = grid.querySelector('.drw-card[data-i="' + i + '"]');
      if (!card) return;
      card.setAttribute('data-r', it.r.k);
      var face = card.querySelector('.drw-cface');
      if (face) face.innerHTML = faceHTML(it.p, it.r);
    });
  }

  /* 落定：全部翻好、卡片静止，这时候才允许像素动效跑起来 */
  function drwSettle(box, gen) {
    if (!box.isConnected || DRW.gen !== gen) return;
    DRW.busy = false;
    drwPhase(box, 'revealed');           // 底栏按「已落定」重画：按钮解禁、文案换成「再翻一组」

    var names = DRW.round.map(function (it) { return it.p.name; });
    var live = box.querySelector('#drwLive');
    if (live) live.textContent = '本轮翻出 ' + names.length + ' 人：' + names.join('、');

    /* 每张翻开的牌左上角都有一个随机像素动效（用户原话要的就是这个）。
       6 张小图 + 左上角大图共用同一条 rAF、帧率封顶 12fps，一体机扛得住；
       缓存一份画布列表，fxStop 之后卡片翻过去就不再画。 */
    fxStop();
    var grid = box.querySelector('#drwGrid');
    if (grid) {
      var cw = DRW.cw || 115;
      grid.querySelectorAll('.drw-card[data-r] .drw-fx').forEach(function (h) {
        fxOnCard(h, cw);
      });
    }
    fxMount(box.querySelector('#drwFxl'), '', 46);
    fxRun();
  }

  /* 降级路径：不演过程，牌直接翻好、动效只画一帧 */
  function drwRevealAll(grid, box, gen) {
    if (grid) grid.querySelectorAll('.drw-card').forEach(function (c) { c.classList.add('is-flip'); });
    drwSettle(box, gen);
  }

  /* ── 刷新卡组：清空本轮结果、重新发一组背面牌（数量不变） ── */
  function drwRefresh(box) {
    if (DRW.busy) return;
    if (!box || !box.isConnected) return;
    DRW.round = []; DRW.phase = 'refreshing';
    drwClearTimers(); fxStop();
    var stage = box.querySelector('#drwStage'); if (stage) stage.setAttribute('data-phase', 'refreshing');
    var grid = box.querySelector('#drwGrid');
    if (grid) grid.classList.add('is-washing');              // 200ms 洗牌过渡（纯 CSS）
    var live = box.querySelector('#drwLive'); if (live) live.textContent = '';

    drwLater(function () {
      if (!box.isConnected) return;
      if (grid) grid.classList.remove('is-washing');
      DRW.phase = 'idle';
      drwGrid(box); drwFit(box);
      if (stage) stage.setAttribute('data-phase', 'idle');
      var f = box.querySelector('#drwFoot'); if (f) { f.innerHTML = drwFootHTML(); drwBindFoot(box); }
      /* 刷新后左上角那颗还在，重新挂一次（fxStop 已经把画布引用清掉了） */
      fxMount(box.querySelector('#drwFxl'), '', 46);
      fxRun();
    }, 220);
  }

  /* 轻提示：小组加分顶栏的 #saveState 就是提示条，直接复用它，别另造一个 */
  function toast(msg) {
    if (SRC && SRC.toast) { SRC.toast(msg); return; }
    var el = document.getElementById('saveState');
    if (el) el.textContent = msg;
  }

  /* ── 打开抽人窗口 ── */
  function open() {
    if (!SRC) return toast('抽人还没准备好，请刷新页面重试');
    var list = classes();
    if (!list.length) return toast('还没有班级：先在「数据与备份」里导入班级和名单');

    DRW.cls = pickCls();
    /* 换代：上一次打开时还没演完的状态机（窗口被关掉、setTimeout 还在等）
       靠这个代数认出自己过期，不会再往新舞台上写东西 */
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
      d.addEventListener('close', function () { drwHalt(); });   // 关窗（含 Esc）一定停掉循环
    }

    var box = d.querySelector('#drw');
    if (box) drwRender(box);
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute('open', '');
    }
    if (box) drwFit(box);          // showModal 之后才有真实尺寸
  }

  function bind(src) { SRC = src || null; }

  window.JFDrawPerson = { open: open, bind: bind, ready: function () { return !!SRC; } };

  /* ── 接线 ──
     app.js 在自身脚本末尾已经把数据源挂到 window.JFDT_DRAW_SRC（本文件在它后面加载），
     所以这里直接取；万一以后加载顺序变了，点按钮时会再取一次兜底。 */
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
