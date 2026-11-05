/* 小组加分载入动画（像素动效）。
 *
 * 打开页面 → 数据载入完成（进应用或登录闸门出现）这段时间，全屏显示一个
 * 随机挑的 pixelfx loop 特效 + 标题；就绪后淡出并把 canvas 从 DOM 里移除。
 * 动效体系复用总入口的 pixelfx（fx/pixelfx-loader.js，只打包 6 个特效，
 * 构建见 tools/build-loader-fx.mjs），渲染写法对照 总入口/fx/hx-critters.js。
 *
 * 教室一体机性能红线（同 hx-critters.js）：
 *   1) 全局只有一个 requestAnimationFrame 循环；动画结束 cancelAnimationFrame
 *      并把 overlay 连同 canvas 一起 remove。
 *   2) 帧率封顶：触屏 / hx-lite 18fps，桌面 30fps（特效 meta 本来就是 30）。
 *   3) hx-lite（省电）或 prefers-reduced-motion 下只画静态一帧，永不跑循环。
 *   4) 页签切后台浏览器自动停 rAF，回来 dt 已钳制，不会跳帧爆走。
 *
 * 就绪判定（不碰 app.js，靠观察 DOM 状态机）：
 *   app.js 的 bootCloud 会先 gateShow('wait')（body.gated + #gate.quiet），
 *   结束时要么 startApp 移除 gated，要么 gateShow('home')（闸门可见且非 quiet）。
 *   所以「见过 gated 之后 gated 消失」或「闸门可见且非 quiet」都算就绪。
 *   另设兜底：万一哪条路径都没走到，最多等 6s 也强制收场，页面绝不被盖死。
 */
(function () {
  var splash = document.getElementById('hxSplash');
  var cv = document.getElementById('hxSplashCv');
  if (!splash || !cv) return;

  // 供自查脚本断言的状态（正式功能不读它）
  var dbg = window.__hxJfLoad = { fx: '', frames: 0, stopped: false, done: false };

  var P = window.PixelFX;
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  var t0 = performance.now();
  var raf = 0, lastPaint = 0;
  var MIN_SHOW = 400;   // 秒开时也至少看 0.4s，不闪一下
  var FADE = 260;       // 卡片内容淡出（与 styles.css .hx-splash-card 的 transition 一致）
  var GONE = 200;       // 第二步：整层连底色淡出（与 #hxSplash 自己的 transition 一致）
  var MAX_WAIT = 6000;  // 就绪判定失灵的兜底

  function finish() {
    if (dbg.done) return;
    dbg.done = true;
    var elapsed = performance.now() - t0;
    setTimeout(function () {
      // 2026-11-06 分两步淡出（原因见 styles.css #hxSplash 注释）：
      //   ① 底色保持不透明，只淡卡片内容 —— 屏幕上从来看不到「闪屏」和「登录门」两层同框；
      //   ② 内容淡完（FADE）再把整层连底色一起淡（GONE），最后 remove。
      splash.classList.add('hx-splash-out');
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      dbg.stopped = true;
      setTimeout(function () { splash.classList.add('hx-splash-gone'); }, FADE - 100);
      setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash); // canvas 一并移除
      }, FADE + GONE + 80);
    }, Math.max(0, MIN_SHOW - elapsed));
  }

  if (splash.dataset.armed) return; // 防御性：脚本意外被引两次
  splash.dataset.armed = '1';

  // canvas 按 3～4 倍整数放大（像素画非整数缩放会糊），随视口自适应
  // 2026-11-06 用户：「像素动效和文字匹配总体看起来太小 网页太大 应该需要自适应网页大小和手机端大小」，
  // 之后又追加「我要保留的是像素动效那一个版本啊」「抽奖卡片太小了不够震撼」——方向已经很清楚：
  // 像素动效是这块屏幕的主体，必须**大**，不能再是中间一个小方块。
  // 原来上限是 4 倍、宽度顶到 560：128px 的特效最多 512px，在 1440 宽的屏幕中央只占三分之一。
  // 现在按「短边的 42%」定目标尺寸，倍数上限放到 8，并保证至少 3 倍（小屏也要看清像素块）。
  function sizeCanvas() {
    var m = mod && mod.meta; if (!m) return;
    var vw = (window.innerWidth || 960) * 0.92;
    var vh = (window.innerHeight || 640) * 0.42;
    var k = Math.max(3, Math.min(Math.floor(vw / m.size[0]), Math.floor(vh / m.size[1]), 8));
    cv.style.width = (m.size[0] * k) + 'px';
    cv.style.height = (m.size[1] * k) + 'px';
  }

  if (!P || !P.effects || !P.ids || !P.ids.length) { finish(); return; } // 包没加载出来：直接放行，别把页面盖死
  var id = P.ids[Math.floor(Math.random() * P.ids.length)];
  var mod = P.effects[id];
  if (!mod || !mod.meta) { finish(); return; }
  dbg.fx = id;
  cv.setAttribute('data-fx', id);

  var m = mod.meta, W = m.size[0], H = m.size[1], O = m.origin || [W / 2, H / 2];
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  if (!ctx) { finish(); return; }
  var img = ctx.createImageData(W, H);
  var fr = P.createFrame(W, H);
  var fx = P.createFx(mod, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) });
  sizeCanvas();
  addEventListener('resize', sizeCanvas);

  function touch() { return window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false; }
  var GAP = (touch() || lite()) ? 1000 / 18 : 1000 / 30;

  function paint(dt) {
    if (dt) fx.update(dt);
    P.clearFrame(fr);
    fx.draw(fr, 'back');
    fx.draw(fr, 'front');
    P.composite(fr, img.data, null);   // 透明底，透出卡片的浅色底
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(img, 0, 0);
    dbg.frames++;
  }

  function step(now) {
    raf = 0;
    if (dbg.done) return;
    if (lastPaint && now - lastPaint < GAP - 1) { raf = requestAnimationFrame(step); return; } // 帧率封顶
    var dt = lastPaint ? Math.min((now - lastPaint) / 1000, 0.12) : 0;
    lastPaint = now;
    paint(dt);
    raf = requestAnimationFrame(step);
  }

  if (still()) paint(0);            // 省电 / 关动画：只画一帧
  else raf = requestAnimationFrame(step);

  // ── 就绪判定 ──────────────────────────────────────────────────────────
  // 轻量轮询（80ms）而不是 MutationObserver：本脚本在 <body> 开头执行时
  // #gate 还没解析出来，观察器要反复重挂；80ms 轮询整个生命周期只有几秒，开销可忽略。
  var seenGated = false;
  var timer = setInterval(function () {
    if (dbg.done) { clearInterval(timer); return; }
    var gated = document.body.classList.contains('gated');
    if (gated) seenGated = true;
    var gate = document.getElementById('gate');
    var gateReady = gate && !gate.hidden && !gate.classList.contains('quiet');
    if ((seenGated && !gated) || gateReady) { clearInterval(timer); finish(); }
  }, 80);
  setTimeout(function () { clearInterval(timer); finish(); }, MAX_WAIT);
})();
