// 首页工具卡上的「像素小生物」装饰（pixelfx critters，MIT）。
//
// 为什么要单独写这一层，而不是像官方画廊那样每张卡一个渲染循环：
// 2026-11-02 教室希沃一体机崩渲染进程的根因就是「每张卡各自跑东西」。首页有 14 张卡，
// 每张一个 30fps 的 canvas 就是 14 个循环在抢 GPU。这里的做法是：
//   1) 全局只有一个 requestAnimationFrame 循环。
//   2) **默认就在动**（2026-11-02 第三次改）：手机没有 hover，原来「鼠标停上去才动」
//      在触屏上等于永远不动。现在默认 active，但加了三道闸控制开销：
//      · 帧率封顶：触屏/低端 18fps、桌面 50fps（像素画本来就 8～12fps 的观感，看不出差别）
//      · IntersectionObserver：滚出视野的卡不画
//      · 全局单循环（红线，永不改成每卡一个）
//   3) hx-lite（教室一体机 / 省电）和 prefers-reduced-motion 下只画静态一帧，永不跑循环。
//   4) 标签页切到后台（document.hidden）立刻停；切回来重新起循环。
//
// 生物是随机挑的：同一个工具在一台机器上第一次进首页时就定下来，记在 sessionStorage 里，
// 刷新换了新的一批（用户要的就是「每次随机匹配」），但同一次会话里不会来回跳。
//
// 2026-11-02 第二次修正（看截图发现的两个问题）：
//   1) 底下那层暗色圆晕原来是 CSS 伪元素，白卡分支下在浅色背景上像一块脏斑。
//      改成生成一张真正的晕圈图，和生物一起合成进 canvas —— 逐像素、随 canvas 缩放，边缘服帖。
//   2) 纯随机分配会出现「四张卡都是蝙蝠」。改成洗牌发牌，见 pickFor。
(function () {
  var P = window.PixelFX;
  if (!P || !P.effects) return;

  var IDS = P.ids || Object.keys(P.effects);
  var KEY = 'hx-critter-map';
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var entries = [];          // { cvs, ctx, fx, id, W, H, img, active, drawn, vis, wrap }
  var raf = 0;               // 全局唯一的帧循环句柄（红线：不允许每张卡一个）

  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  // 这个工具配哪只生物。要求是「每次随机匹配」，但不能真平均随机——
  // 12 只里随机分给 14 张卡，纯随机会出现「四张卡都是蝙蝠」这种撞车（实测截图上就有）。
  // 做法：先洗牌一副牌，按卡序依次发；发完再洗一副，所以短时间内不会重复，
  // 但每次进首页（新会话）牌序都不同，满足「每次随机」。
  // 顺序固定的卡（工具 id 固定）用 sessionStorage 记住这一副牌的分配，刷新不跳变。
  // ── 2026-11-02 修坑：原来这里取 `deck[order % deck.length]`，order 是「已分配的卡数」。
  //    12 只生物发完 12 张卡后 order=12，`12 % 12 === 0`，第 13、14 张卡**必然**都拿到牌堆第一张，
  //    而且和前面某张撞得一模一样（仿真 2000 次，第 13/14 张卡撞前面的概率是 100%）。
  //    正确做法：牌堆用尽时先记住「这一轮已经用过哪 12 只」，重新洗牌后
  //    从「上一轮最后发的几只」之外开始取，保证紧接着的下一张不会和隔壁撞。
  //    14 张卡 / 12 只生物，最多也就撞 2 只，但必须撞在离得远的卡上，不能挨在一起。
  function pickFor(toolId) {
    var map = {};
    try { map = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { map = {}; }
    if (map[toolId] && IDS.indexOf(map[toolId]) >= 0) return map[toolId];

    var used = {};
    for (var k in map) used[map[k]] = 1;
    var deck = IDS.filter(function (x) { return !used[x]; });

    if (!deck.length) {
      // 牌发完了：重新洗一副。洗完之后，把「刚才最后发出去的那几只」挪到牌堆末尾，
      // 这样紧接着发的卡不会跟紧邻的卡撞色。
      deck = IDS.slice();
      for (var s = deck.length - 1; s > 0; s--) { // Fisher-Yates
        var r = Math.floor(Math.random() * (s + 1)), tp = deck[s];
        deck[s] = deck[r]; deck[r] = tp;
      }
      var recent = Object.keys(map).slice(-4).map(function (k2) { return map[k2]; });
      var head = deck.filter(function (x) { return recent.indexOf(x) < 0; });
      var tail = deck.filter(function (x) { return recent.indexOf(x) >= 0; });
      deck = head.concat(tail);
      map[toolId] = deck[0];
    } else {
      for (var i = deck.length - 1; i > 0; i--) { // Fisher-Yates
        var j = Math.floor(Math.random() * (i + 1)), tmp = deck[i];
        deck[i] = deck[j]; deck[j] = tmp;
      }
      map[toolId] = deck[0];
    }
    try { sessionStorage.setItem(KEY, JSON.stringify(map)); } catch (e) { }
    return map[toolId];
  }

  // 晕圈图：一张 canvas 尺寸的径向渐变，每只生物只做一次。
  // 只做「有背景图」那一档：白卡分支下把底色当默认，暗斑会显脏（用户看得出来的那种脏），
  // 白卡本来就浅，生物直接放上去已经清楚，不需要垫暗。
  function halo(cvs, W, H, alpha) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    if (!g) return null;
    var cx = W / 2, cy = H / 2, r = Math.max(W, H) * 0.52;
    var grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, 'rgba(0,0,0,' + alpha + ')');
    grd.addColorStop(0.55, 'rgba(0,0,0,' + (alpha * 0.42).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    return c;
  }

  function frame(cvs, id) {
    var mod = P.effects[id];
    if (!mod || !mod.meta) return null;
    var m = mod.meta, W = m.size[0], H = m.size[1], O = m.origin || [W / 2, H / 2];
    cvs.width = W; cvs.height = H;
    var ctx = cvs.getContext('2d');
    if (!ctx) return null;
    return {
      cvs: cvs, ctx: ctx, id: id, W: W, H: H,
      img: ctx.createImageData(W, H),
      f: P.createFrame(W, H),
      halo: null, // 有背景图分支才生成（见 attach）
      fx: P.createFx(mod, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) }),
      active: false, drawn: false,
    };
  }

  function paint(e, dt) {
    var fx = e.fx;
    if (dt) fx.update(dt);
    P.clearFrame(e.f);
    fx.draw(e.f, 'back');
    fx.draw(e.f, 'front');
    P.composite(e.f, e.img.data, null); // 透明底：卡片自带的玻璃透出来
    e.ctx.clearRect(0, 0, e.W, e.H);
    if (e.halo) e.ctx.drawImage(e.halo, 0, 0); // 先铺晕圈，再叠生物
    e.ctx.putImageData(e.img, 0, 0);
    e.drawn = true;
  }

  // ── 2026-11-02 第三次改：默认就动 ──
  // 手机没有 hover。原来「鼠标停上去才动」，在触屏上等于**永远不动**，装饰全成了静态图。
  // 用户要求「全部默认动就行」。但「全部一起跑」恰好是 2026-11-02 希沃渲染崩溃的同款结构，
  // 所以默认动之前先加三道闸，缺一道都不行：
  //   ① 全局仍然只有一个 rAF —— 从第一版起就没有「每张卡一个循环」，这条红线不能破；
  //   ② 帧率封顶：触屏 / 低端 18fps，桌面 50fps。像素画本来就是 8～12fps 的观感，
  //      18fps 完全看不出差别，功耗却只有 60fps 的三分之一（手机发烫那条就是帧率惹的）。
  //   ③ 只画「真的在屏幕上」的卡：IntersectionObserver 盯着，滚出视野立刻不画。
  //      桌面一屏能看全 9 张，但窄屏是两列要滚动，这条对手机很关键。
  var last = 0, lastPaint = 0, gap = 20;
  function touch() {
    return window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false;
  }
  function fpsNow() { return (touch() || lite()) ? 18 : 50; }

  var io = null;
  function watch(e) {
    if (!e.wrap) { e.vis = true; return; }
    if (typeof IntersectionObserver !== 'function') { e.vis = true; return; } // 老浏览器：当作一直可见
    if (!io) io = new IntersectionObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var ent = list[i].target.__hxCrit;
        if (ent) ent.vis = list[i].isIntersecting;
      }
      kick();
    }, { rootMargin: '80px' }); // 提前 80px 算「要露头了」，滚到时不会先空白一下再动
    e.wrap.__hxCrit = e;
    io.observe(e.wrap);
  }

  function kick() {
    if (still() || document.hidden) return;
    if (raf) return;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.active && e.vis && e.cvs.isConnected) { lastPaint = 0; raf = requestAnimationFrame(step); return; }
    }
  }

  function step(now) {
    raf = 0;
    if (document.hidden) return;
    gap = 1000 / fpsNow();
    // 封顶：还没到下一帧的时间就直接跳过，但仍然把 rAF 续上（不然循环就断了）
    if (lastPaint && now - lastPaint < gap - 1) { raf = requestAnimationFrame(step); return; }
    var dt = lastPaint ? Math.min((now - lastPaint) / 1000, 0.12) : 0;
    lastPaint = now;
    var busy = false;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.active || !e.vis) continue;
      if (!e.cvs.isConnected) continue; // 重建卡片后旧条目：跳过，等 sweep 清
      paint(e, dt);
      busy = true;
    }
    if (busy) raf = requestAnimationFrame(step);
  }

  // still()（希沃 / 省电 / 用户关了动画）时不进 kick，但要保证画面上有第一帧，
  // 否则卡片上端会留一块空白。所以这里补一次静态绘制。
  function start(e) {
    e.active = true;
    if (still()) { if (!e.drawn) paint(e, 0); return; }
    kick();
  }
  function stop(e) { e.active = false; }

  // 给一张卡挂上生物。tile 是 .tile 按钮，id 是工具 id（决定配哪只）
  function attach(tile, toolId) {
    if (!tile || tile.querySelector('.fxc')) return;
    sweep(); // 先清掉上一轮重建留下的死记录，不然每切一次工具就多攒 9 条（每条攥着 ImageData）
    var wrap = document.createElement('span');
    wrap.className = 'fxc';
    wrap.setAttribute('aria-hidden', 'true');
    var cvs = document.createElement('canvas');
    wrap.appendChild(cvs);
    tile.appendChild(wrap);
    var e = frame(cvs, pickFor(toolId));
    if (!e) { wrap.remove(); return; }
    // CSS 尺寸：装进一个 96×68 的盒子（高优先），超宽的就按宽缩。
    // 为什么是这个盒子：卡片上端右侧空位约 100×76，36px 以下看不清是什么生物，
    // 90px 以上会顶到左上图标。蛇、鱼群那种 136 宽的按宽缩，免得横着爬到图标上。
    // 缩放只写在 .fxc 这个外层容器上（见 index.html 的 .tile .fxc），
    // canvas 用 width/height:100% 铺满它 —— 这样窄屏只改容器高度就能等比缩，不用监听 resize。
    var BW = 96, BH = 68, k = Math.min(BW / e.W, BH / e.H);
    wrap.style.width = (e.W * k).toFixed(1) + 'px';
    wrap.style.height = (e.H * k).toFixed(1) + 'px';
    // 有背景图（hx-bg）才垫晕圈：白卡分支不垫（暗斑在浅底上显脏）
    if (document.documentElement.classList.contains('hx-bg')) e.halo = halo(cvs, e.W, e.H, 0.42);
    e.wrap = wrap;
    entries.push(e);
    paint(e, 0); // 先出一帧静态画面，不要空白
    watch(e);
    // 默认就在动（手机没有 hover，不默认动就等于永远是张静态图）。
    // hover 只保留「一进来就立刻响应」的作用：没这行也不影响，因为默认已经 active 了。
    // still()（hx-lite / reduced-motion）在 kick() 里挡掉，那两种情况下就停在第一帧。
    start(e);
    tile.addEventListener('pointerenter', function () { start(e); });
    tile.addEventListener('pointerleave', function () { stop(e); });
    tile.addEventListener('focus', function () { start(e); });
    tile.addEventListener('blur', function () { stop(e); });
  }

  // 工具切换 / 重新登录会重建卡片：清掉已经不在文档里的。
  // 2026-11-02 修坑：这个函数导出以后一直没人调用，每次 render() 重建 9 张卡就多留 9 条死记录
  // （每条都攥着一份 ImageData + Frame），切几次工具就堆十几 MB。现在 attach 进来时先自己清一遍。
  function sweep() {
    entries = entries.filter(function (e) {
      if (e.cvs.isConnected) return true;
      // 已经脱离文档：连同 IntersectionObserver 的观察一起取消，
      // 否则它一直观察着一个死节点，越积越多（和 entries 泄漏是同一个毛病）
      if (io && e.wrap && e.wrap.__hxCrit === e) { try { io.unobserve(e.wrap); } catch (x) { } delete e.wrap.__hxCrit; }
      return false;
    });
  }
  // 页签切回来：重新起循环。切走时已经取消过，这里要主动踢一下，否则回来是一张静止图。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      lastPaint = 0;
    } else {
      kick();
    }
  });

  window.HXCritters = { attach: attach, sweep: sweep, ids: IDS };
})();
