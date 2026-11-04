// 像素动效头像：渲染器 + 选择面板（依赖同目录 pixelfx-avatars.js）。
//
// 为什么要单独写这一层，而不是每个头像一个 requestAnimationFrame：
// 2026-11-02 教室希沃一体机崩渲染进程的根因就是「每张卡各自跑一个循环」。这个面板一屏能摆
// 一百多个格子，如果每个格子一个 rAF，页面直接躺平。所以：
//   1) 全页只有一个 rAF（模块级 ticker），所有格子 / 挂载点共用；
//   2) 格子默认是**死的静图**：进场时算一帧画上去，鼠标移上去（或触屏点选）才接管动画，
//      同一时刻最多一个格子是活的 —— 这一个格子独占整个面板唯一的一份重量级缓冲；
//   3) 只有 IntersectionObserver 认为「在视口里」的格子才存在、才画；
//   4) 页签切后台、hx-lite（省电模式）、prefers-reduced-motion 一律停循环，只留静帧。
//
// 为什么「一个格子一份重量级缓冲」很贵：特效是 ImageData 级别的（320×180 就是 230KB），
// 再算上 Frame 的 color+light 两块 Uint32 和一张原生 canvas，一个天气类格子接近 1MB。
// 208 个格子全开就是 200MB，一体机必崩。所以静图用完就把引擎丢掉，只留 64×64 的小 canvas。
//
// 对外只有 window.HXAvatar 一个全局（红线：不污染全局）。
//   HXAvatar.list()                  → [{ id:'critters/ghost', cat:'critters', name:'ghost' }, …]
//   HXAvatar.panel(container, opts)  → 画可选网格，返回 { destroy() }
//   HXAvatar.mount(el, id, size)     → 在 el 里挂一个会动的 <canvas>，返回 { stop() }
//   HXAvatar.frame(id, size)         → dataURL(PNG)，同步取一帧（默认 96px）
(function () {
  var P = window.PixelFXAvatar;
  if (!P || !P.effects || !P.meta) return;

  // ── 分类中文名 + 展示顺序 ──
  // 顺序按「当头像好不好看」排：小生物 / 自然 / 奥术最讨喜，爆炸、转场这类放最后。
  var CAT = {
    critters: '小生物', nature: '自然', arcane: '奥术', holy: '神圣', shadow: '暗影',
    fire: '火焰', ice: '寒冰', lightning: '闪电', water: '水', weather: '天气',
    status: '状态', pickups: '拾取', melee: '近战', spawn: '出场', scifi: '科幻',
    ui: '界面', transitions: '转场', explosions: '爆炸'
  };
  var ORDER = ['critters', 'nature', 'arcane', 'holy', 'shadow', 'fire', 'ice', 'lightning',
    'water', 'weather', 'status', 'pickups', 'melee', 'spawn', 'scifi', 'ui', 'transitions', 'explosions'];

  // ── 全局状态 ──
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var LIV = [];            // 活着的视图 { mode, el, cvs, ctx, eng, hot, vis, live, S }
  var raf = 0, lastPaint = 0;
  var DBG = { heat: 0, cool: 0 };   // 只在 _debug() 里露出来的计数，排查「格子不动」用
  var GAP = 1000 / 24;     // 帧率封顶 24fps：像素画本来 8～12fps 的观感，再高纯属烧电
  var io = null;           // 全页共用一个 IntersectionObserver

  function still() {
    return document.documentElement.classList.contains('hx-lite') || !!(reduced && reduced.matches);
  }

  // 数一下有多少不透明像素：判断「这一帧是不是空白」，别把空框当头图
  function coverage(data) {
    var n = 0;
    for (var i = 3; i < data.length; i += 4) if (data[i] > 8) n++;
    return n;
  }

  // 量一张画面的「有效像素边界」，用于自动裁边。
  // 为什么要裁：特效画布是按「特效需要多大空间」定的，比如蛇是 136×56 但身体只占中间一条，
  // 小鸟 112×80 但鸟只占中间一小块。整张等比例塞进 64px 头像框，主体只剩一半大小，看着很小气。
  // 裁到实际有像素的范围（再留 12% 余量）主体就能顶满框。只裁一次、按 id 缓存：
  // 每帧都重新裁会导致画面自己抽动，那不是「贴紧」是「发抖」。
  var crops = {};
  function bbox(data, W, H) {
    var x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0 || y1 < y0) return null;
    var pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.12) + 1;   // 留余量，别把飞出去的粒子裁断
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ── 静图排队 ──
  // 为什么不让 IntersectionObserver 回调直接算：一屏几十个格子，每个静图要模拟零点几秒特效，
  // 同步算完就是几百毫秒的主线程卡死（滚动、点击全都没反应）。这里一次只算一个，
  // 中间让出一个宏任务，页面就能喘气。不用 rAF 是因为「全页只许一条 rAF」是红线。
  var stillQ = [], pumpT = 0;
  function enqueue(fn) { stillQ.push(fn); pump(); }
  function pump() {
    if (pumpT || !stillQ.length) return;
    pumpT = setTimeout(function () {
      pumpT = 0;
      var fn = stillQ.shift();
      try { fn(); } catch (e) { /* 单个特效出错不能连坐整个面板 */ }
      pump();
    }, 0);
  }

  // ── 渲染引擎：一个特效 + 一份原生缓冲。createFx 是有状态的（粒子、相位），所以每个画面一份 ──
  // 为什么要把特效先画到「原生尺寸」的离屏 canvas 再 drawImage 到方框里：
  // 特效输出的是 Uint32 帧缓冲 → composite 成 ImageData → putImageData。putImageData 不吃缩放、
  // 不吃 transform，只能先落到原生尺寸，再用 drawImage 缩放到目标方框。drawImage 走 GPU，很便宜。
  function Engine(id, S) {
    var m = P.meta[id], mod = P.effects[id];
    if (!m || !mod) return null;
    var W = m.size[0], H = m.size[1];
    var nat = document.createElement('canvas');
    nat.width = W; nat.height = H;
    var nctx = nat.getContext('2d');
    if (!nctx) return null;
    var img = nctx.createImageData(W, H);
    var frame = P.createFrame(W, H);
    var opt = { x: m.origin[0], y: m.origin[1], seed: 7 };

    // 是不是「整幅画面」类的特效（天气、转场：320×180 铺满整个画布）。
    // 注意不能用 meta.bg 判断 —— 208 个特效里 208 个都有 bg（那只是官方画廊的预览底色建议），
    // 真按 bg 裁满，会把小鸟、幽灵这种小巧的精灵放大到出血。
    var full = m.cat === 'weather' || m.cat === 'transitions';

    // 天气类是照着「一整幅夜景」画的：不给它垫底色的话，雨、雪、雾只是透明底上几点白，
    // 当头像看几乎是空的。所以只对这 12 个，用 pixelfx 自带的 backdrop 生成一张同尺寸夜色垫上
    // （一次算好后面每帧复用，230KB，同一时刻最多一个格子热着，能接受）。
    var bgPlate = (m.cat === 'weather' && m.bg && P.backdrop) ? P.backdrop(m.bg, W, H, H) : null;

    // 缩放策略：
    //   整幅画面类 → cover 铺满（16:9 塞进方框必然裁掉两侧，裁边总比上下留黑好）；
    //   其余是透明底上的一只东西 → 先按自动裁边收紧缩放范围，再 contain 装进框里。
    var box = { sx: 0, sy: 0, sw: W, sh: H, dx: 0, dy: 0, dw: 0, dh: 0, smooth: true };
    function fit() {
      var cr = full ? null : crops[id];
      var sw = cr ? cr.w : W, sh = cr ? cr.h : H;
      var k = full ? Math.max(S / sw, S / sh) : Math.min(S / sw, S / sh) * 0.96;
      box.sx = cr ? cr.x : 0; box.sy = cr ? cr.y : 0; box.sw = sw; box.sh = sh;
      box.dw = sw * k; box.dh = sh * k;
      box.dx = (S - box.dw) / 2; box.dy = (S - box.dh) / 2;
      box.smooth = k < 1;    // 缩小用平滑（不然像素闪烁），放大用最近邻（保住像素块）
    }
    fit();

    var e = {
      id: id, m: m, S: S, t: 0,
      fx: P.createFx(mod, opt),
      // 一次性特效播完就重建：头像要一直动，不能定格在最后一帧。
      // 循环特效内部自己取模，连续 update 就行。
      reset: function () { e.t = 0; e.fx = P.createFx(mod, opt); },
      paint: function (ctx, dt) {
        if (dt) {
          e.t += dt;
          if (!m.loop && e.t >= m.duration) e.reset();
          else e.fx.update(dt);
        }
        P.clearFrame(frame);
        e.fx.draw(frame, 'back');
        e.fx.draw(frame, 'front');
        // bgPlate 只有天气类有；其余传 null = 透明底，让头像框自己的背景透出来
        P.composite(frame, img.data, bgPlate);
        nctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = box.smooth;
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(nat, box.sx, box.sy, box.sw, box.sh, box.dx, box.dy, box.dw, box.dh);
      },
      // 快进到某个相位并画一帧。frame() / 格子静图都用它。
      seek: function (ctx) {
        // 相位取「时长的 35%」，但给个上限：12 秒的天气特效不能真模拟 4 秒才出图，
        // 一屏 12 个天气格子那样要卡死。上限 2.5 秒，既躲开空白首帧也够展示动作。
        // 35% 不够看（画面里只有零星几个像素）就多试几个相位，取最饱满的那帧 —— 否则
        // 有些特效会停在一段「刚要开始」的淡画面，格子里像空的，用户根本不会去点它。
        var phases = [0.35, 0.5, 0.25, 0.65], best = 0, bestN = -1, last = 0;
        for (var i = 0; i < phases.length; i++) {
          gotoPhase(phases[i]);
          e.paint(ctx, 0);
          last = i;
          var n = coverage(img.data);
          if (n > bestN) { bestN = n; best = i; }
          if (n >= W * H * 0.02 || n >= 600) break;   // 2% 的像素有颜色就算「一眼看得见」
        }
        if (last !== best) { gotoPhase(phases[best]); e.paint(ctx, 0); }
        // 第一次画完顺手量一下实体边界，按 id 记住，之后所有尺寸都按它裁
        if (!full && !crops[id]) {
          var r = bbox(img.data, W, H);
          if (r) { crops[id] = r; fit(); e.paint(ctx, 0); }
        }
        return bestN;
      }
    };

    function gotoPhase(ph) {
      e.reset();
      var target = Math.min(m.duration * ph, 2.5), step = 1 / 60;
      while (e.t < target) { var dt = Math.min(step, target - e.t); e.fx.update(dt); e.t += dt; }
    }
    return e;
  }

  // ── 唯一的一条 rAF ──
  function want(v) { return v.vis && !!v.eng && (v.mode === 'mount' || v.hot); }

  function kick() {
    if (still() || document.hidden || raf) return;
    for (var i = 0; i < LIV.length; i++) if (want(LIV[i])) { lastPaint = 0; raf = requestAnimationFrame(step); return; }
  }

  function step(now) {
    raf = 0;
    if (document.hidden) return;
    if (still()) { lastPaint = 0; return; }        // 运行中被切到省电模式：这一帧收工，不再续
    if (lastPaint && now - lastPaint < GAP - 1) { raf = requestAnimationFrame(step); return; }
    var dt = lastPaint ? Math.min((now - lastPaint) / 1000, 0.12) : 0;
    lastPaint = now;
    var busy = false;
    for (var i = 0; i < LIV.length; i++) {
      var v = LIV[i];
      if (!v.live || !want(v)) continue;
      if (!v.cvs.isConnected) { v.live = false; continue; }
      v.eng.paint(v.ctx, dt);
      busy = true;
    }
    if (busy) raf = requestAnimationFrame(step);
    else lastPaint = 0;
  }

  function watch(v) {
    if (typeof IntersectionObserver !== 'function') { v.vis = true; return; }
    if (!io) io = new IntersectionObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var v = list[i].target.__hxa;
        if (!v) continue;
        v.vis = list[i].isIntersecting;
        if (v.vis && v.onEnter) { var f = v.onEnter; v.onEnter = null; f(); }
      }
      kick();
    }, { rootMargin: '160px' });  // 提前 160px 算「要露头了」，滚到时候不会先空一下
    v.el.__hxa = v;
    io.observe(v.el);
  }

  function unregister(v) {
    v.live = false; v.eng = null; v.hot = false;
    if (io && v.el && v.el.__hxa === v) { try { io.unobserve(v.el); } catch (e) { } delete v.el.__hxa; }
    var i = LIV.indexOf(v);
    if (i >= 0) LIV.splice(i, 1);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } lastPaint = 0; }
    else kick();
  });

  // ── 样式：一次性注入，id 保护，不碰 index.html ──
  function css() {
    if (document.getElementById('hxa-css')) return;
    var s = document.createElement('style');
    s.id = 'hxa-css';
    s.textContent =
      '.hxa{--hxa-acc:var(--acc,#6cb6ff);--hxa-line:rgba(140,160,200,.22);font:inherit;color:inherit}' +
      '.hxa-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 12px}' +
      '.hxa-chip{appearance:none;font:inherit;font-size:13px;line-height:1;padding:6px 10px;border-radius:999px;' +
      'border:1px solid var(--hxa-line);background:transparent;color:inherit;cursor:pointer;opacity:.72}' +
      '.hxa-chip:hover{opacity:1;border-color:var(--hxa-acc)}' +
      '.hxa-chip[aria-pressed="true"]{background:var(--hxa-acc);border-color:var(--hxa-acc);color:#0a1220;opacity:1;font-weight:600}' +
      '.hxa-q{flex:1 1 150px;min-width:120px;font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;' +
      'border:1px solid var(--hxa-line);background:rgba(0,0,0,.16);color:inherit;outline:none}' +
      '.hxa-q:focus{border-color:var(--hxa-acc)}' +
      '.hxa-n{font-size:12px;opacity:.5;white-space:nowrap}' +
      '.hxa-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(var(--hxa-cell,80px),1fr))}' +
      '.hxa-cell{position:relative;display:grid;place-items:center;aspect-ratio:1;padding:0;border-radius:10px;' +
      'border:1px solid var(--hxa-line);background:rgba(10,16,28,.35);cursor:pointer;overflow:hidden;' +
      'transition:border-color .12s,transform .12s}' +
      '.hxa-cell:hover{transform:translateY(-1px);border-color:var(--hxa-acc)}' +
      '.hxa-cell[aria-pressed="true"]{border-color:var(--hxa-acc);box-shadow:inset 0 0 0 1px var(--hxa-acc)}' +
      '.hxa-cell:focus-visible{outline:2px solid var(--hxa-acc);outline-offset:2px}' +
      '.hxa-cell canvas{display:block;image-rendering:pixelated;image-rendering:crisp-edges}' +
      '.hxa-cell i{position:absolute;left:0;right:0;bottom:0;font-size:10px;line-height:1.5;padding:0 3px;' +
      'text-align:center;font-style:normal;opacity:0;background:linear-gradient(transparent,rgba(0,0,0,.72));' +
      'transition:opacity .12s;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.hxa-cell:hover i,.hxa-cell:focus-visible i{opacity:.9}' +
      '.hxa-empty{grid-column:1/-1;padding:24px;text-align:center;opacity:.45;font-size:13px}';
    document.head.appendChild(s);
  }

  // ── frame()：同步取一张方形 PNG。缓存一份，因为 PNG 编码一次几十毫秒 ──
  var fcache = {}, fkeys = [];
  function frame(id, size) {
    size = Math.max(16, Math.min(256, Math.round(size || 96)));
    var key = id + '@' + size;
    if (fcache[key]) return fcache[key];
    var e = Engine(id, size);
    if (!e) return '';
    var c = document.createElement('canvas');
    c.width = size; c.height = size;
    var ctx = c.getContext('2d');
    if (!ctx) return '';
    e.seek(ctx);
    var url = '';
    try { url = c.toDataURL('image/png'); } catch (err) { url = ''; }  // 理论上不会污染画布，兜个底
    if (url) {
      fcache[key] = url; fkeys.push(key);
      if (fkeys.length > 160) delete fcache[fkeys.shift()];   // 简单上限，别把内存吃穿
    }
    return url;
  }

  // ── mount：页面上一个持续动的小头像 ──
  function mount(el, id, size) {
    size = Math.round(size || 72);
    if (!el || !P.meta[id]) return { stop: function () { } };
    var dpr = Math.min(window.devicePixelRatio || 1, 2);   // 头像只有一两个，按 2 倍渲染才不糊
    var S = Math.round(size * dpr);
    var cvs = document.createElement('canvas');
    cvs.width = S; cvs.height = S;
    cvs.style.width = size + 'px';
    cvs.style.height = size + 'px';
    cvs.style.display = 'block';
    cvs.style.imageRendering = 'pixelated';
    el.appendChild(cvs);
    var ctx = cvs.getContext('2d');
    var eng = Engine(id, S);
    if (!eng || !ctx) { if (cvs.parentNode) cvs.parentNode.removeChild(cvs); return { stop: function () { } }; }

    var v = { mode: 'mount', el: cvs, cvs: cvs, ctx: ctx, eng: eng, vis: true, live: true, hot: true, S: S };
    LIV.push(v);
    watch(v);
    eng.seek(ctx);       // 先给一帧，避免开头空白
    kick();              // 省电模式下 kick 会自己退出，画面就停在刚画的那帧
    return {
      stop: function () {
        unregister(v);
        if (cvs.parentNode) cvs.parentNode.removeChild(cvs);
      }
    };
  }

  // ── panel：可选网格 + 分类筛选 + 搜索 ──
  function panel(container, opts) {
    opts = opts || {};
    if (!container) return { destroy: function () { } };
    css();
    var size = Math.round(opts.size || 64);
    var onPick = typeof opts.onPick === 'function' ? opts.onPick : null;
    var value = opts.value && P.meta[opts.value] ? opts.value : null;
    var curCat = 'all', q = '';

    // 排序：先按分类顺序，类内按名字，避免每次刷新顺序乱跳
    var all = P.ids.slice().sort(function (a, b) {
      var ia = ORDER.indexOf(P.meta[a].cat), ib = ORDER.indexOf(P.meta[b].cat);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a < b ? -1 : 1;
    });

    var root = document.createElement('div');
    root.className = 'hxa';
    root.style.setProperty('--hxa-cell', (size + 16) + 'px');

    var bar = document.createElement('div');
    bar.className = 'hxa-bar';
    root.appendChild(bar);

    // 分类条：只列出真的收了特效的分类
    var cats = ['all'].concat(ORDER.filter(function (c) {
      return P.ids.some(function (id) { return P.meta[id].cat === c; });
    }));
    var chips = {};
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hxa-chip';
      b.textContent = c === 'all' ? '全部' : (CAT[c] || c);
      b.setAttribute('aria-pressed', c === curCat ? 'true' : 'false');
      b.onclick = function () { curCat = c; syncChips(); render(); };
      chips[c] = b;
      bar.appendChild(b);
    });
    function syncChips() { for (var k in chips) chips[k].setAttribute('aria-pressed', k === curCat ? 'true' : 'false'); }

    var search = document.createElement('input');
    search.className = 'hxa-q';
    search.type = 'search';
    search.placeholder = '搜索：ghost / 暗影 / orb…';
    search.oninput = function () { q = search.value.trim().toLowerCase(); render(); };
    bar.appendChild(search);

    var count = document.createElement('span');
    count.className = 'hxa-n';
    bar.appendChild(count);

    var grid = document.createElement('div');
    grid.className = 'hxa-grid';
    root.appendChild(grid);

    // 本面板建过的所有格子视图：切分类 / 销毁时整批回收，不能只清 DOM 不清记录
    var views = [];
    var hot = null;   // 当前唯一「活着」的格子（面板级共享一份引擎，见文件头注释）

    function cool() {
      DBG.cool++;
      if (!hot) return;
      var v = hot.v;
      v.hot = false;
      v.eng = null;                    // 释放 ImageData / Frame，静图稍后补回
      restore(v);
      hot = null;
    }
    // 离开时晚 150ms 再停：触屏滑动、布局回流（静图陆续补上会让格子挪位置）都会甩出一堆
    // 假的 pointerleave，立刻停会导致「刚移上去动了一下就定住」。真离开也就多算 150ms。
    var coolT = 0;
    function coolSoon() {
      if (coolT) clearTimeout(coolT);
      coolT = setTimeout(function () { coolT = 0; cool(); }, 150);
    }
    function noCool() { if (coolT) { clearTimeout(coolT); coolT = 0; } }
    function heat(cell) {
      DBG.heat++;
      if (still()) return;             // 省电模式 / 用户关了动画：保持静图，不接管循环
      noCool();
      if (hot && hot.cell === cell) return;
      cool();
      var v = cellState(cell);
      if (!v) return;
      v.eng = Engine(cell.dataset.id, v.S);
      if (!v.eng) return;
      v.hot = true;
      hot = { cell: cell, v: v };
      // 从「静图那一帧」接着往下放，而不是从头放：一次性特效的 t=0 往往是空的，
      // 鼠标移上去先闪一下空白再接动画，观感很差。
      v.eng.seek(v.ctx);
      kick();
    }

    var states = new WeakMap();
    function cellState(cell) {
      var v = states.get(cell);
      if (v) return v;
      var id = cell.dataset.id;
      if (!P.meta[id]) return null;
      var cvs = document.createElement('canvas');
      // 格子用 1:1、不乘 devicePixelRatio：208 个格子 × 2 倍像素 = 多 3 倍内存，划不来；
      // CSS 那边 image-rendering:pixelated 会保住硬边，看起来还是像素画。
      cvs.width = size; cvs.height = size;
      cvs.style.width = cvs.style.height = size + 'px';
      cvs.setAttribute('aria-hidden', 'true');
      cell.appendChild(cvs);
      var ctx = cvs.getContext('2d');
      v = { mode: 'cell', el: cell, cvs: cvs, ctx: ctx, eng: null, vis: true, hot: false, live: true, S: size, still: '' };
      states.set(cell, v);
      views.push(v);
      LIV.push(v);
      watch(v);
      return v;
    }

    // 静图分两步：canvas 先建出来（很便宜，立刻生效），真正耗时的渲染丢进队列
    function paintStill(cell) {
      if (!cell.isConnected) return;             // 排队期间面板被销毁 / 切了分类，跳过
      var v = states.get(cell);
      if (!v || v.still) return;
      var e = Engine(cell.dataset.id, v.S);
      if (!e) return;
      e.seek(v.ctx);
      try { v.still = v.cvs.toDataURL('image/png'); } catch (err) { v.still = ''; }  // 存一张小图，动画停下时贴回去
      if (hot && hot.cell === cell) v.eng = e;   // 正好热着的话，引擎接上继续跑
    }
    // 动画停下后把静图贴回格子：否则格子会停在动画中间那一帧，一片格子看起来「花」
    function restore(v) {
      if (!v.still) return;
      var im = new Image();
      im.onload = function () {
        if (v.hot || !v.cvs.isConnected) return;
        v.ctx.imageSmoothingEnabled = false;
        v.ctx.clearRect(0, 0, v.S, v.S);
        v.ctx.drawImage(im, 0, 0, v.S, v.S);
      };
      im.src = v.still;
    }

    var stillIO = null;
    function observeStill(cell) {
      cellState(cell);
      if (typeof IntersectionObserver !== 'function') {
        enqueue(function () { paintStill(cell); });
        return;
      }
      if (!stillIO) stillIO = new IntersectionObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          if (!list[i].isIntersecting) continue;
          stillIO.unobserve(list[i].target);
          enqueue((function (c) { return function () { paintStill(c); }; })(list[i].target));
        }
      }, { rootMargin: '200px' });
      stillIO.observe(cell);
    }

    var cells = [];
    function render() {
      cool();
      // 上一批格子整批回收：DOM 清掉但 LIV / 观察器里还留着的话，越切分类攒得越多
      for (var k = 0; k < views.length; k++) unregister(views[k]);
      views = [];
      if (stillIO) { stillIO.disconnect(); stillIO = null; }
      grid.textContent = '';
      cells = [];
      var n = 0;
      for (var i = 0; i < all.length; i++) {
        var id = all[i], m = P.meta[id];
        if (curCat !== 'all' && m.cat !== curCat) continue;
        if (q && (id + ' ' + CAT[m.cat]).toLowerCase().indexOf(q) < 0) continue;
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'hxa-cell';
        cell.dataset.id = id;
        cell.title = id;
        cell.setAttribute('aria-label', CAT[m.cat] + '：' + m.name);
        cell.setAttribute('aria-pressed', id === value ? 'true' : 'false');
        var lab = document.createElement('i');
        lab.textContent = m.name;
        cell.appendChild(lab);

        // 鼠标 / 键盘 / 触屏：
        //   桌面 hover 就动（离开就停），点一下 = 选中并回调；
        //   触屏没有 hover，点一下既选中也「热」起来继续动，符合「点选中才动」。
        cell.addEventListener('pointerenter', function () { heat(this); });
        cell.addEventListener('pointerleave', function () { if (hot && hot.cell === this) coolSoon(); });
        cell.addEventListener('focus', function () { heat(this); });
        cell.addEventListener('blur', function () { if (hot && hot.cell === this) coolSoon(); });
        cell.addEventListener('click', pick);

        grid.appendChild(cell);
        cells.push(cell);
        n++;
      }
      count.textContent = n + ' / ' + all.length + ' 个';
      if (!n) {
        var em = document.createElement('div');
        em.className = 'hxa-empty';
        em.textContent = '没有匹配的头像，换个词试试';
        grid.appendChild(em);
      }
      for (var j = 0; j < cells.length; j++) observeStill(cells[j]);
    }

    function pick(ev) {
      ev.preventDefault();
      var id = this.dataset.id;
      value = id;
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('aria-pressed', cells[i] === this ? 'true' : 'false');
      // 触屏点选后保持「热」，让它继续动；点别的格子会自动接管（一份引擎在手）
      heat(this);
      if (onPick) onPick(id);
    }

    container.appendChild(root);
    render();

    return {
      destroy: function () {
        noCool();
        cool();
        for (var i = 0; i < views.length; i++) unregister(views[i]);
        views = [];
        if (stillIO) { stillIO.disconnect(); stillIO = null; }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.HXAvatar = {
    list: function () { return P.list(); },
    panel: panel,
    mount: mount,
    frame: frame,
    // 自查用：当前挂着几个视图、循环在不在跑、是不是省电模式（只看控制台）
    _debug: function () { return { views: LIV.length, raf: !!raf, still: still(), heat: DBG.heat, cool: DBG.cool }; }
  };
})();
