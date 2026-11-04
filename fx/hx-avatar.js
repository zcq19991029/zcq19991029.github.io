// 像素动效头像：渲染器 + 选择面板（依赖同目录 pixelfx-avatars.js）。
//
// 2026-11-04 改版：用户原话「像素特效头像需要可以动啊 不要静态的」。
// 原来为了不把教室希沃一体机搞崩（2026-11-02 渲崩过一次），格子默认是死静图，鼠标移上去才动，
// 同一时刻只有 1 个格子活着 —— 结果学生看到 200 多张不动的图，以为头像素材本身就是静态的。
// 现在默认就动，但用「视口 + 并发上限 + 降级」三件套把开销钉死：
//   1) 视口：IntersectionObserver 先粗筛（rootMargin 160px），再用 getBoundingClientRect 精筛，
//      只给**真正落在视口里**的格子名额；视口外一律静帧。
//   2) 并发上限：同时活跃 ≤ 12 个（低配机 6 个、极低配 4 个），按「离视口中心最近」优先分配，
//      超出的显示静帧。实测一帧总成本超过 15ms 就自动砍 25% 名额（自适应降级），
//      连续便宜（<6ms）再慢慢放回来 —— 一体机上不会因为 12 个格子一起画就掉帧。
//   3) 降级：页面切后台 / html.hx-lite（省电模式）/ prefers-reduced-motion → 名额清零，
//      引擎全部释放，一条不留，只剩静帧。
// 滚动、翻页、窗口缩放只在 160ms 防抖后重新分配名额，不做逐帧重算（一帧 200 次 rect 读取会抖）。
//
// 内存账（为什么上限 12 是安全的）：
//   一个活跃格子的重量级缓冲 = 原生 canvas(W×H) + ImageData(W×H×4) + Frame.color(W×H×4)
//   + Frame.light(W×H×4) ≈ W×H×16 字节。全库平均 25k 像素 → ≈0.39MB/个；最大的
//   explosions/nuke（400×320）≈2MB；天气类还要多一张 320×180 的底色板，≈1.1MB/个。所以峰值：
//     常见 12 × 0.39MB ≈ 4.7MB；全屏都是天气 ≈ 12 × 1.1MB ≈ 13MB；理论最坏 12 × 2MB ≈ 24MB。
//   对比「208 个全开」≈ 200MB（就是那次一体机渲崩的元凶）。格子一旦掉出名额立刻 eng=null，
//   只留 64×64 的小 canvas（16KB）和一张 ~2KB 的 PNG 静帧。
//
// 全页仍然只有一条 rAF（模块级 ticker），所有格子 / 挂载点 / 头像共用；一格一条 rAF 是红线。
//
// 已选头像「持续在动」：index.html 把头像画成 .av 的 background-image(data URL)，本文件不碰它，
//   只在 frame() 输出时往 PNG 里塞一张 tEXt 纸片（关键字 hxa，值是特效 id），扫描到 .av 就叠一块
//   canvas 接着动，元素离开 DOM / 切到静帧就还原成背景图。所以换设备、刷新页面后头像照样会动。
//
// 对外只有 window.HXAvatar 一个全局（红线：不污染全局）。
//   HXAvatar.list()                  → [{ id:'critters/ghost', cat:'critters', name:'ghost' }, …]
//   HXAvatar.panel(container, opts)  → 画可选网格，返回 { destroy() }
//   HXAvatar.mount(el, id, size)     → 在 el 里挂一个会动的 <canvas>，返回 { stop() }
//   HXAvatar.frame(id, size)         → dataURL(PNG)，同步取一帧（默认 96px）
//   HXAvatar._debug()                → { views, live, cap, raf, still, … }，排查「格子不动」用
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
  var LIV = [];            // 活着的视图 { mode:'cell'|'mount', el, cvs, ctx, eng, hot, vis, live, S }
  var raf = 0, lastPaint = 0;
  var DBG = { heat: 0, cool: 0 };    // 只在 _debug() 里露出来的计数，排查「格子不动」用
  var GAP = 1000 / 24;     // 帧率封顶 24fps：像素画本来 8～12fps 的观感，再高纯属烧电
  var io = null;           // 全页共用一个 IntersectionObserver

  function still() {
    return document.documentElement.classList.contains('hx-lite') || !!(reduced && reduced.matches);
  }
  function clock() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  // ── 名额：同时最多几个格子是活的 ──
  // BASE 按机器档次定一次：deviceMemory / hardwareConcurrency 能听出来是一体机还是老师的新笔记本。
  // 一体机（4G 内存 / 4 核）给 6 个已经够看了 —— 矮屏加上窄弹层，视口里本来也就十几个格子。
  var BASE = 12;
  try {
    var dm = (navigator && navigator.deviceMemory) || 8;
    var hc = (navigator && navigator.hardwareConcurrency) || 8;
    if (dm <= 4 || hc <= 4) BASE = 6;
    if (dm <= 2 || hc <= 2) BASE = 4;
  } catch (e) { }
  var PRF = { ema: 0, k: 1, good: 0 };   // ema=一帧总成本的滑动平均；k=自适应系数
  var CAP = 0;                           // 当前生效名额（_debug 用）
  var rebT = 0;

  function capNow() {
    if (still() || document.hidden) return 0;
    return Math.max(2, Math.round(BASE * PRF.k));
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
  // 分名额（给格子建引擎）也走这条队列：一次建十几个引擎同样会卡一下，摊开就没事。
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
    // （一次算好后面每帧复用，230KB；天气格子最多同时几个，算在名额账里）。
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
      // 快进到某个相位并画一帧。frame() / 格子静图 / 刚接管的动画都用它。
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

  // ── 名额分配：谁该动、谁该静 ──
  // 只有「在视口里 + 离中心最近」的前 CAP 个格子拿到引擎；其余 release 掉（只留静帧）。
  // 为什么按「离中心最近」而不是「从上到下」：学生在弹层里滚动时，眼睛盯着屏幕中间，
  // 中间那几格动了他就觉得「会动」，边上几格是静的反而不容易注意到。
  function activate(v) {
    if (v.hot && v.eng) return;
    v.hot = true;
    if (v.eng || v.pend) return;
    v.pend = true;
    DBG.heat++;
    enqueue(function () {
      v.pend = false;
      if (!v.hot || !v.live || !v.cvs || !v.cvs.isConnected) return;
      var e = null;
      try { e = Engine(v.id, v.S); } catch (err) { e = null; }
      if (!e) { v.hot = false; return; }
      v.eng = e;
      // 从「静图那一帧」接着往下放，而不是从头放：一次性特效的 t=0 往往是空的，
      // 接管的瞬间先闪一下空白再接动画，观感很差。
      try { e.seek(v.ctx); } catch (err2) { }
      kick();
    });
  }

  function release(v) {
    if (!v.hot && !v.eng && !v.pend) return;
    v.hot = false; v.eng = null; v.pend = false;
    DBG.cool++;
    restore(v);     // 把静图贴回去，否则格子停在动画中间那一帧
  }

  function rebalance() {
    rebT = 0;
    var cap = capNow();
    CAP = cap;
    if (!LIV.length) return;
    if (cap <= 0) {
      for (var z = 0; z < LIV.length; z++) if (LIV[z].mode === 'cell') release(LIV[z]);
      return;
    }
    var vh = window.innerHeight || 800, vw = window.innerWidth || 1200;
    var now = clock(), list = [];
    for (var i = 0; i < LIV.length; i++) {
      var v = LIV[i];
      if (v.mode !== 'cell' || !v.vis) continue;
      if (!v.cvs || !v.cvs.isConnected) continue;
      var r;
      try { r = v.el.getBoundingClientRect(); } catch (e) { continue; }
      if (!r || r.bottom < -4 || r.top > vh + 4) continue;          // 只认真正在视口里的
      list.push({
        v: v,
        b: (v.boost && v.boost > now) ? 0 : 1,                       // 刚被指到 / 刚点选的排前面
        d: Math.abs((r.top + r.bottom) / 2 - vh / 2) + Math.abs((r.left + r.right) / 2 - vw / 2) * 0.35
      });
    }
    list.sort(function (a, b) { return a.b - b.b || a.d - b.d; });
    for (var k = 0; k < list.length && k < cap; k++) { activate(list[k].v); list[k].v.kp = 1; }
    // 没拿到名额的（包括滚出视口的）全部释放，不能攒着
    for (var j = 0; j < LIV.length; j++) {
      var w = LIV[j];
      if (w.mode !== 'cell') continue;
      if (!w.kp) release(w);
      w.kp = 0;
    }
  }

  // 滚动 / 缩放 / 切分类只触发防抖，160ms 内多次滚动只算一次
  function scheduleRebalance(ms) {
    if (rebT) return;
    rebT = setTimeout(function () { rebT = 0; rebalance(); }, ms === undefined ? 160 : ms);
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
    var busy = false, t0 = clock();
    for (var i = 0; i < LIV.length; i++) {
      var v = LIV[i];
      if (!v.live || !want(v)) continue;
      if (!v.cvs.isConnected) { v.live = false; continue; }
      try { v.eng.paint(v.ctx, dt); } catch (e) { v.hot = false; v.eng = null; continue; }
      busy = true;
    }
    if (busy) {
      trim(t0);                                  // 自适应降级：这一帧太贵就砍名额
      raf = requestAnimationFrame(step);
    } else lastPaint = 0;
  }

  // 一帧总成本的滑动平均：>15ms 说明这批格子已经画不动了，砍 25% 名额；<6ms 稳住 90 帧再放回来。
  // 为什么用成本而不是 fps：fps 被 GAP 封在 24，看不出「一帧里 12 个格子算了 30ms」这种事。
  function trim(t0) {
    var cost = clock() - t0;
    if (!(cost >= 0)) return;
    PRF.ema = PRF.ema ? PRF.ema * 0.82 + cost * 0.18 : cost;
    if (PRF.ema > 15 && PRF.k > 0.34) {
      PRF.k = Math.max(0.34, PRF.k * 0.75); PRF.good = 0; scheduleRebalance(300);
    } else if (PRF.ema < 6 && PRF.k < 1 && ++PRF.good > 90) {
      PRF.k = Math.min(1, PRF.k * 1.2); PRF.good = 0; scheduleRebalance(300);
    }
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
      scheduleRebalance(80);       // 有格子进出视口 = 名额该重排了（防抖，不会每帧算）
      kick();
    }, { rootMargin: '160px' });  // 提前 160px 算「要露头了」，滚到时候不会先空一下
    v.el.__hxa = v;
    io.observe(v.el);
  }

  function unregister(v) {
    v.live = false; v.eng = null; v.hot = false; v.pend = false;
    if (io && v.el && v.el.__hxa === v) { try { io.unobserve(v.el); } catch (e) { } delete v.el.__hxa; }
    var i = LIV.indexOf(v);
    if (i >= 0) LIV.splice(i, 1);
  }

  // 全部回到静帧：切后台 / 省电模式 / reduced-motion 走这里。格子引擎一个不留。
  function pauseAll() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastPaint = 0;
    for (var i = 0; i < LIV.length; i++) if (LIV[i].mode === 'cell') release(LIV[i]);
    CAP = 0;
    avScan();     // still() 成立时它会把已接管的头像也还原成背景图
  }

  // 状态一变（省电模式开关 / 切前台）就重新判断：该停的停，该恢复的恢复
  function resumeAll() {
    if (still() || document.hidden) { pauseAll(); return; }
    avScan();
    scheduleRebalance(0);
    kick();
  }

  var listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    if (window.addEventListener) {
      // 捕获阶段监听：面板自己的滚动容器（#pop 是 overflow:auto）也能收到，scroll 本身不冒泡
      window.addEventListener('scroll', function () { scheduleRebalance(160); }, true);
      window.addEventListener('resize', function () { scheduleRebalance(200); scanSoon(300); }, false);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseAll();
      else resumeAll();
    });
    // html.hx-lite 一开就立刻停：不能等下一次滚动才发现
    if (typeof MutationObserver === 'function' && document.documentElement) {
      new MutationObserver(function () { resumeAll(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    if (reduced) {
      if (reduced.addEventListener) reduced.addEventListener('change', function () { resumeAll(); });
      else if (reduced.addListener) reduced.addListener(function () { resumeAll(); });
    }
    scanSoon(600);      // 首屏也可能已经有头像了（比如刷新后直接进首页）
  }

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

  // ── PNG 里夹一张「这是什么特效」的纸片 ──
  // 为什么非要把 id 写进图片本身：头像存的是 avatar_url（一段 PNG data URL），刷新、换设备之后
  // 光看图片谁也不知道它对应哪个特效。tEXt 是 PNG 标准的附属块，浏览器照常解码、只是忽略它，
  // 所以对「当图片用」零影响，同时我们又能把 id 读回来接着放动画。
  var CRCT = null;
  function crc32(s) {
    if (!CRCT) {
      CRCT = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRCT[n] = c >>> 0;
      }
    }
    var x = 0xFFFFFFFF;
    for (var i = 0; i < s.length; i++) x = CRCT[(x ^ s.charCodeAt(i)) & 0xFF] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function be32(n) {
    return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }
  var HEAD = 'data:image/png;base64,';
  function stamp(url, id) {
    if (typeof atob !== 'function' || typeof btoa !== 'function') return url;
    if (url.slice(0, HEAD.length) !== HEAD) return url;
    try {
      var bin = atob(url.slice(HEAD.length));
      if (bin.slice(1, 4) !== 'PNG') return url;
      var out = bin.slice(0, 8), i = 8, tail = null;
      while (i + 8 <= bin.length) {
        var len = ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) |
          (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0;
        var type = bin.slice(i + 4, i + 8);
        if (type === 'tEXt' || type === 'IEND') { tail = type; break; }
        out += bin.slice(i, i + len + 12);
        i += len + 12;
      }
      if (tail !== 'IEND') return url;      // 已经有纸片 / 结构不认识，原样返回
      var body = 'hxa\0' + id;
      out += be32(body.length) + 'tEXt' + body + be32(crc32('tEXt' + body));
      out += bin.slice(i);
      return HEAD + btoa(out);
    } catch (e) { return url; }
  }
  function readStamp(bin) {
    if (bin.slice(1, 4) !== 'PNG') return null;
    var i = 8;
    while (i + 8 <= bin.length) {
      var len = ((bin.charCodeAt(i) << 24) | (bin.charCodeAt(i + 1) << 16) |
        (bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3)) >>> 0;
      var type = bin.slice(i + 4, i + 8);
      if (type === 'tEXt') {
        var d = bin.slice(i + 8, i + 8 + len);
        if (d.slice(0, 4) === 'hxa\0') return d.slice(4);
      }
      if (type === 'IEND' || len > bin.length) break;
      i += len + 12;
    }
    return null;
  }
  var uph = {}, upn = 0;       // url → id 的反查缓存（只留最近 40 条，别拿它当内存大户）
  function idOfUrl(url) {
    if (!url || url.slice(0, HEAD.length) !== HEAD) return null;
    if (uph[url] !== undefined) return uph[url];
    var id = null;
    if (typeof atob === 'function') { try { id = readStamp(atob(url.slice(HEAD.length))); } catch (e) { id = null; } }
    if (upn > 40) { uph = {}; upn = 0; }
    uph[url] = id; upn++;
    return id;
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
      url = stamp(url, id);      // 把 id 缝进 PNG，刷新后头像才知道该放哪个特效
      fcache[key] = url; fkeys.push(key);
      if (fkeys.length > 160) delete fcache[fkeys.shift()];   // 简单上限，别把内存吃穿
    }
    return url;
  }

  // ── mount：页面上一个持续动的小头像 ──
  function mount(el, id, size) {
    size = Math.round(size || 72);
    if (!el || !P.meta[id]) return { stop: function () { } };
    listen();
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

  // ── 已选头像「跟着动」──
  // index.html 把头像画成 <span class="av" style="background-image:url(data:…)">，这里不改它，
  // 只在 span 里叠一块 canvas（100% 大小、圆角），把背景图临时收起来，元素被重建/移除时还原。
  // 认不出 id 的（比如学生上传的照片）一律不碰，保持原样。
  var AVB = [], avT = 0;
  function avFind(el) {
    for (var i = 0; i < AVB.length; i++) if (AVB[i].el === el) return AVB[i];
    return null;
  }
  function avDrop(b) {
    unregister(b.v);
    if (b.cvs && b.cvs.parentNode) b.cvs.parentNode.removeChild(b.cvs);
    if (b.el) {
      try {
        if (b.style == null) b.el.removeAttribute('style');
        else b.el.setAttribute('style', b.style);     // 还原成原来的背景图（静帧）
      } catch (e) { }
    }
    var i = AVB.indexOf(b);
    if (i >= 0) AVB.splice(i, 1);
  }
  function avBind(el, id, url) {
    var b = avFind(el);
    if (b) { if (b.id === id) return; avDrop(b); }
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var side = Math.round((r && r.width) || el.clientWidth || 30);
    if (!side) side = 30;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var S = Math.max(24, Math.round(side * dpr));
    var cvs = document.createElement('canvas');
    cvs.width = S; cvs.height = S;
    cvs.style.cssText = 'width:100%;height:100%;display:block;border-radius:50%;' +
      'image-rendering:pixelated;pointer-events:none';
    var ctx = cvs.getContext('2d');
    var eng = null;
    if (ctx) { try { eng = Engine(id, S); } catch (e) { eng = null; } }
    if (!ctx || !eng) return;
    var keep = el.getAttribute ? el.getAttribute('style') : null;
    try { el.style.backgroundImage = 'none'; } catch (e2) { }   // 底下留 var(--acc) 当圆底
    el.appendChild(cvs);
    var v = { mode: 'mount', el: cvs, cvs: cvs, ctx: ctx, eng: eng, vis: true, live: true, hot: true, S: S };
    LIV.push(v);
    watch(v);
    try { eng.seek(ctx); } catch (e3) { }
    kick();
    AVB.push({ el: el, cvs: cvs, v: v, id: id, style: keep });
  }
  function avScan() {
    avT = 0;
    if (!document.body || !document.body.querySelectorAll) return;
    for (var i = AVB.length - 1; i >= 0; i--) {
      var b = AVB[i];
      if (!b.el || !document.body.contains(b.el)) avDrop(b);
    }
    if (still() || document.hidden) {    // 静帧模式：头像也交回给 CSS 背景图
      for (i = AVB.length - 1; i >= 0; i--) avDrop(AVB[i]);
      return;
    }
    var nodes = document.body.querySelectorAll('.av');
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (avFind(el)) continue;
      var st = el.getAttribute ? (el.getAttribute('style') || '') : '';
      var m = /url\((['"]?)([^'")]+)\1\)/.exec(st);
      if (!m) continue;
      var id = idOfUrl(m[2]);
      if (!id || !P.meta[id]) continue;
      avBind(el, id, m[2]);
    }
  }
  function scanSoon(ms) {
    if (avT) return;
    avT = setTimeout(avScan, ms === undefined ? 120 : ms);
  }
  function watchAvatars() {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    // render() 每次都是整块 innerHTML 重建，所以子节点变化就够了；style 变化兜住「同一节点换头像」
    try {
      new MutationObserver(function () { scanSoon(120); })
        .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    } catch (e) { }
  }

  // ── panel：可选网格 + 分类筛选 + 搜索 ──
  function panel(container, opts) {
    opts = opts || {};
    if (!container) return { destroy: function () { } };
    css();
    listen();
    watchAvatars();
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
      v = { mode: 'cell', id: id, el: cell, cvs: cvs, ctx: ctx, eng: null, vis: true, hot: false, live: true, S: size, still: '', pend: false, kp: 0, boost: 0 };
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
      if (v.hot) return;                         // 已经在动的格子不用再算静图，省一次引擎
      var e = Engine(cell.dataset.id, v.S);
      if (!e) return;
      e.seek(v.ctx);
      try { v.still = v.cvs.toDataURL('image/png'); } catch (err) { v.still = ''; }  // 存一张小图，动画停下时贴回去
    }
    // 动画停下后把静图贴回格子：否则格子会停在动画中间那一帧，一片格子看起来「花」
    function restore(v) {
      if (!v.still || !v.cvs || !v.cvs.isConnected) return;
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

        // 鼠标划过 / 键盘聚焦 / 触屏点选都给这一格「保底名额」：视口里格子比名额多的时
        // （矮屏 + 小格子一屏能摆二十多个），指到哪一格哪一格立刻动，不然用户会以为坏了。
        cell.addEventListener('pointerenter', function () { boost(this); });
        cell.addEventListener('focus', function () { boost(this); });
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
      scheduleRebalance(30);      // 名额分配：等静图先贴上一轮，再让中间那几格动起来
    }

    // 指到哪一格，哪一格先动（4 秒内它排在名额队首，之后交回「离中心最近」的规则）
    function boost(cell) {
      var v = cellState(cell);
      if (!v) return;
      v.boost = clock() + 4000;
      activate(v);
    }

    function pick(ev) {
      ev.preventDefault();
      var id = this.dataset.id;
      value = id;
      for (var i = 0; i < cells.length; i++) cells[i].setAttribute('aria-pressed', cells[i] === this ? 'true' : 'false');
      boost(this);                  // 选中的那格保持动，看着才有「这就是我的头像」的感觉
      if (onPick) onPick(id);
    }

    container.appendChild(root);
    render();

    return {
      destroy: function () {
        for (var i = 0; i < views.length; i++) unregister(views[i]);
        views = [];
        if (stillIO) { stillIO.disconnect(); stillIO = null; }
        if (root.parentNode) root.parentNode.removeChild(root);
        scheduleRebalance(0);        // 回收完立刻重排，别让名额停在已销毁的格子上
      }
    };
  }

  window.HXAvatar = {
    list: function () { return P.list(); },
    panel: panel,
    mount: mount,
    frame: frame,
    // 自查用：当前挂着几个视图、几个格子真的在动、名额多少、循环在不在跑、是不是省电模式
    _debug: function () {
      var live = 0, cells = 0, mounts = 0;
      for (var i = 0; i < LIV.length; i++) {
        var v = LIV[i];
        if (v.mode === 'cell') { cells++; if (v.eng && v.hot) live++; } else mounts++;
      }
      return {
        views: LIV.length, cells: cells, mounts: mounts, live: live, cap: CAP,
        base: BASE, k: Math.round(PRF.k * 100) / 100, ema: Math.round(PRF.ema * 10) / 10,
        raf: !!raf, still: still(), heat: DBG.heat, cool: DBG.cool, avatars: AVB.length
      };
    }
  };
})();
