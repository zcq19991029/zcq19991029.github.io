// 首页工具卡上的「像素小生物」装饰（pixelfx critters，MIT）。
//
// 为什么要单独写这一层，而不是像官方画廊那样每张卡一个渲染循环：
// 2026-11-02 教室希沃一体机崩渲染进程的根因就是「每张卡各自跑东西」。首页有 14 张卡，
// 每张一个 30fps 的 canvas 就是 14 个循环在抢 GPU。这里的做法是：
//   1) 全局只有一个 requestAnimationFrame 循环，而且只在「有鼠标停在某张卡上」时才跑；
//      没有 hover 就整条循环停掉，静止时零开销。
//   2) 静止时画面上留的是最后一帧（第一次进场先画一帧静态图，不是空白）。
//   3) hx-lite（教室一体机 / 省电）和 prefers-reduced-motion 下只画静态一帧，永远不跑循环。
//   4) 标签页切到后台（document.hidden）立刻停。
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
  var entries = [];          // { cvs, ctx, fx, id, W, H, img, active, drawn }
  var raf = 0, last = 0;

  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  // 这个工具配哪只生物。要求是「每次随机匹配」，但不能真平均随机——
  // 12 只里随机分给 14 张卡，纯随机会出现「四张卡都是蝙蝠」这种撞车（实测截图上就有）。
  // 做法：先洗牌一副牌，按卡序依次发；发完再洗一副，所以短时间内不会重复，
  // 但每次进首页（新会话）牌序都不同，满足「每次随机」。
  // 顺序固定的卡（工具 id 固定）用 sessionStorage 记住这一副牌的分配，刷新不跳变。
  function pickFor(toolId) {
    var map = {};
    try { map = JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { map = {}; }
    if (map[toolId] && IDS.indexOf(map[toolId]) >= 0) return map[toolId];

    var used = {};
    for (var k in map) used[map[k]] = 1;
    var deck = IDS.filter(function (x) { return !used[x]; });
    if (!deck.length) deck = IDS.slice(); // 牌发完了：重新洗一副（12 只生物 / 14 张卡，最多撞 2 只）
    for (var i = deck.length - 1; i > 0; i--) { // Fisher-Yates
      var j = Math.floor(Math.random() * (i + 1)), tmp = deck[i];
      deck[i] = deck[j]; deck[j] = tmp;
    }
    var order = Object.keys(map).length;
    map[toolId] = deck[order % deck.length];
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

  function step(now) {
    raf = 0;
    if (document.hidden) return;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    var busy = false;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.active) continue;
      if (!e.cvs.isConnected) continue;
      paint(e, dt);
      busy = true;
    }
    if (busy) raf = requestAnimationFrame(step);
  }

  function start(e) {
    if (still()) { if (!e.drawn) paint(e, 0); return; }
    e.active = true;
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
  }
  function stop(e) {
    e.active = false;
    if (!entries.some(function (x) { return x.active; }) && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // 给一张卡挂上生物。tile 是 .tile 按钮，id 是工具 id（决定配哪只）
  function attach(tile, toolId) {
    if (!tile || tile.querySelector('.fxc')) return;
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
    entries.push(e);
    paint(e, 0); // 先出一帧静态画面，不要空白
    tile.addEventListener('pointerenter', function () { start(e); });
    tile.addEventListener('pointerleave', function () { stop(e); });
    tile.addEventListener('focus', function () { start(e); });
    tile.addEventListener('blur', function () { stop(e); });
  }

  // 工具切换 / 重新登录会重建卡片：清掉已经不在文档里的
  function sweep() {
    entries = entries.filter(function (e) { return e.cvs.isConnected; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; entries.forEach(function (e) { e.active = false; }); }
  });

  window.HXCritters = { attach: attach, sweep: sweep, ids: IDS };
})();
