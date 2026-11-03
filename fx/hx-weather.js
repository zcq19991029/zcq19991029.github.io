// 首页「背景动效」：把 pixelfx 的天气类氛围特效（极光 / 萤火虫 / 雨 / 雪 / 流星…）铺在背景层。
// 2026-11-03 用户要求：「可以在主题上选择作为首页背景额外装饰动效 可选可不选 和背景主题等不重叠 属于动效模块」。
//
// 设计（对照 fx/hx-critters.js 的三条红线，这里是第四个消费者，规矩一致）：
//   1) 全局只有一个 rAF 循环，一整页就一张画布（320×180 的像素帧整数倍放大铺满，不是每特效一个循环）；
//   2) 帧率封顶 24fps（氛围动画，30 和 24 看不出差别，省下三分之一的合成开销）；
//   3) hx-lite（希沃一体机 / 省电）和 prefers-reduced-motion 下只画静态一帧，永不跑循环；
//      页签切到后台立刻停。
// 和背景主题的关系：画布 z-index:-1、插在 body 最后 —— 画在背景层 body::before 之上、
// 所有卡片之下，卡片玻璃本来就是半透明的，动效透出来正好；两层互不覆盖（一个选背景、一个选动效）。
// 默认「无」：不选就一个字节都不画，和以前完全一样。
(function () {
  var P = window.PixelFXWeather;
  if (!P || !P.effects) return;

  var KEY = 'hx-theme'; // 和 hx-theme.js 共用一份设置（wx 字段）
  function wxOf() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); return v && P.effects[v.wx] ? v.wx : null; } catch (e) { return null; }
  }
  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }

  var cvs = null, g = null, img = null, frame = null, fx = null, mod = null, W = 0, H = 0;
  var raf = 0, lastPaint = 0, cur = null;

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    lastPaint = 0;
  }
  function remove() {
    stop(); fx = null; mod = null; img = null; frame = null;
    if (cvs) { cvs.remove(); cvs = null; g = null; }
  }
  function mount(id) {
    remove();
    var m = P.effects[id] && P.effects[id].meta;
    if (!m || !m.size) return;
    mod = P.effects[id]; W = m.size[0]; H = m.size[1];
    cvs = document.createElement('canvas');
    cvs.id = 'hxWx';
    cvs.setAttribute('aria-hidden', 'true');
    cvs.width = W; cvs.height = H;
    // z-index:-1 且放在 body 最后：负层里排在 body::before（背景图，也是 -1、更早）之后，
    // 所以「背景图之上、一切卡片之下」。卡片玻璃半透明，动效正好透出来。
    cvs.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:-1;pointer-events:none;'
      + 'image-rendering:pixelated;image-rendering:crisp-edges;opacity:.9';
    document.body.appendChild(cvs);
    g = cvs.getContext('2d');
    if (!g) return remove(); // 拿不到 2d（老浏览器 / 参数异常）：安静放弃，别把首页搞挂
    img = g.createImageData(W, H);
    frame = P.createFrame(W, H);
    var o = m.origin || [W / 2, H / 2];
    fx = P.createFx(mod, { x: o[0], y: o[1], seed: Math.floor(Math.random() * 997) });
    size();
    draw(0); // 先出一帧，别空白等下一帧
    if (!still()) kick();
  }
  // 320×180 的像素帧整数倍放大、居中 cover：刚好铺满屏幕不出黑边，像素块保持硬边
  function size() {
    if (!cvs) return;
    var s = Math.max(1, Math.ceil(Math.max(innerWidth / W, innerHeight / H)));
    cvs.style.width = W * s + 'px';
    cvs.style.height = H * s + 'px';
  }
  function draw(dt) {
    if (!fx || !g) return;
    if (dt) fx.update(dt);
    P.clearFrame(frame);
    fx.draw(frame, 'back');
    fx.draw(frame, 'front');
    P.composite(frame, img.data, null);
    g.clearRect(0, 0, W, H);
    g.putImageData(img, 0, 0);
  }
  function fpsCap() { return lite() ? 18 : 24; }
  function kick() {
    if (still() || document.hidden || !fx || raf) return;
    raf = requestAnimationFrame(step);
  }
  function step(now) {
    raf = 0;
    if (document.hidden || !fx) return;
    var gap = 1000 / fpsCap();
    if (lastPaint && now - lastPaint < gap - 1) { raf = requestAnimationFrame(step); return; }
    var dt = lastPaint ? Math.min((now - lastPaint) / 1000, 0.12) : 0;
    lastPaint = now;
    // 打开全屏工具页（body.tool / body.zen）时背景根本看不见，这一帧直接跳过，整张画布的开销都省下
    if (!document.body.classList.contains('tool') && !document.body.classList.contains('zen')) draw(dt);
    raf = requestAnimationFrame(step);
  }

  // ── 接线：跟随外观设置（wx 字段），换选项即时生效；storage 事件让同站其它页一起变 ──
  function sync() {
    var wx = wxOf();
    if (wx === cur) return;
    cur = wx;
    if (!wx) return remove();
    mount(wx);
  }
  addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) sync(); });
  if (window.HXTheme && HXTheme.onChange) HXTheme.onChange(sync);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else kick();
  });
  var rzT = 0;
  addEventListener('resize', function () {
    if (!cvs || rzT) return;
    rzT = setTimeout(function () { rzT = 0; size(); }, 180);
  });
  sync();
})();
