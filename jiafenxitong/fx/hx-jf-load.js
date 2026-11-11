/* 小组加分载入动画（像素动效）。
 *
 * 打开页面 → 数据载入完成（进应用或登录闸门出现）这段时间，全屏显示一个
 * 随机挑的 pixelfx loop 特效 + 标题；就绪后淡出并把 canvas 从 DOM 里移除。
 * 动效体系复用总入口的 pixelfx（fx/pixelfx-loader.js，只打包 6 个特效，
 * 构建见 tools/build-loader-fx.mjs），渲染写法对照 总入口/fx/hx-critters.js。
 *
 * 2026-11-05 返修（用户：「点击接线仿真永远是一个像素动效的加载画面且不会动」「需要随机加载动效」）：
 *   1) 抽签从「同一会话内固定」改成**每次打开重新随机**：只把上一次用过的 id 记在
 *      sessionStorage（hx-loadfx-last-jiafen）做排除，连开两次一定不一样；
 *   2) MIN_SHOW 400 → 640ms，别让就绪太快把动效抽走；
 *   3) 首帧策略按 meta 区分：loop 特效预跑 0.35 秒再上屏；one-shot（meta.loop === false）
 *      从 0 帧开播并在 meta.duration 到期后重开，别把动画提前放完/停在空画布。
 *   面板小号引擎（mini）同样适用这三条。
 *
 * 教室一体机性能红线（同 hx-critters.js）：
 *   1) 全局只有一个 requestAnimationFrame 循环；动画结束 cancelAnimationFrame
 *      并把 overlay 连同 canvas 一起 remove。
 *   2) 帧率封顶：触屏 / hx-lite 18fps，桌面 30fps（特效 meta 本来就是 30）。
 *   3) hx-lite（省电）或 prefers-reduced-motion 下不跑循环，也不再画静帧——
 *      2026-11-04 全站统一规则：藏掉 canvas，回落到闪屏里的像素方块药丸（见下方 noFx）。
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
  // 2026-11-05 五修：循环的退出条件从「就绪(done)」改成「整层已移除(removed)」。
  // 原来 step() 里写的是 if (dbg.done) return;，而 done 在数据一就绪就置 true（常常只过 0.3~0.6 秒），
  // 于是引擎只画了第一帧（实测 puts=1 / frames=1），剩下大半秒用户看的是一张冻图。
  var removed = false;
  var MIN_SHOW = 640;   // 2026-11-05：400 → 640ms，秒开时也能看清像素在动，不闪一下
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
      // 2026-11-05 五修：**停 rAF 挪到整层移除之后**。原来在这里就 cancelAnimationFrame，
      // 于是淡出那 260+200ms 全是同一张静止帧；数据一就绪（常常只过 0.3~0.6s）就开始淡，
      // 用户看到的正是「一个像素动效的画面且不会动」。动效必须活到遮罩消失那一刻。
      setTimeout(function () { splash.classList.add('hx-splash-gone'); }, FADE - 100);
      setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash); // canvas 一并移除
        removed = true;                     // 到这里才允许循环退出（淡出全程仍在动）
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        dbg.stopped = true;
      }, FADE + GONE + 80);
    }, Math.max(0, MIN_SHOW - elapsed));
  }

  if (splash.dataset.armed) return; // 防御性：脚本意外被引两次
  splash.dataset.armed = '1';

  // ── 回落（2026-11-04 全站统一规则）──────────────────────────────────────
  // canvas 动效播不起来（特效包没加载出来 / canvas 建不出来 / hx-lite 省电 / prefers-reduced-motion）
  // 时，藏掉 canvas、**保留下面的像素方块药丸和标题**等到数据就绪再收场——
  // 用户要的是「动效 + 原来的加载样式结合」，回落也不许空屏、不许只剩裸文字。
  function noFx(why) {
    dbg.fx = 'fallback:' + why;
    cv.style.display = 'none';
  }

  // canvas 按整数倍放大（像素画非整数缩放会糊），随视口自适应
  // 2026-11-06 用户：「像素动效和文字匹配总体看起来太小 网页太大 应该需要自适应网页大小和手机端大小」，
  // 之后又追加「我要保留的是像素动效那一个版本啊」「抽奖卡片太小了不够震撼」——方向已经很清楚：
  // 像素动效是这块屏幕的主体，必须**大**，不能再是中间一个小方块。
  // 2026-11-06 再次返修（用户：「加载动效普遍太小 紧急修复」）：原来上限 4 倍、按短边 42% 定目标，
  // 1080p 下 128px 的篝火最多只有 384px，投在教室大屏上确实偏小。
  // 现在按**短边的 70%** 定目标尺寸（2026-11-07 用户「再放大点」，62% → 70%），倍数上限 12、下限 3：
  // 1920×1080 下 128px 特效放大 6 倍（768px），56～64px 的小特效放到 11～12 倍（620～768px），
  // 不同特效的视觉体量接近，都是第一眼就能看见的主体。
  function sizeCanvas() {
    var m = mod && mod.meta; if (!m) return;
    var vw = (window.innerWidth || 960) * 0.9;
    var vh = (window.innerHeight || 640) * 0.70;
    var k = Math.max(3, Math.min(Math.floor(vw / m.size[0]), Math.floor(vh / m.size[1]), 12));
    cv.style.width = (m.size[0] * k) + 'px';
    cv.style.height = (m.size[1] * k) + 'px';
  }

  // 特效选择（2026-11-04 与 刷题/考试 统一，2026-11-05 返修）：**每次打开重新随机**，
  // 只排除「上一次用过的 id」（sessionStorage hx-loadfx-last-jiafen），连开两次一定不一样。
  // 旧版「同一会话内固定」已废弃——用户明确要求「需要随机加载动效」，不再照顾「每次都换会眼晕」。
  function pickJf() {
    var ids = P && P.ids;
    if (!ids || !ids.length) return '';
    var K = 'hx-loadfx-last-jiafen', prev = '', pool = ids, i, cand = [];
    try { prev = sessionStorage.getItem(K) || ''; } catch (e) { }
    if (prev) {
      for (i = 0; i < ids.length; i++) if (ids[i] !== prev) cand.push(ids[i]);
      if (cand.length) pool = cand;               // 只有 1 个特效时只能重复，不硬造空池
    }
    var eid = pool[Math.floor(Math.random() * pool.length)] || '';
    try { if (eid) sessionStorage.setItem(K, eid); } catch (e) { }
    return eid;
  }
  var id = '';
  if (!P || !P.effects || !P.ids || !P.ids.length) { noFx('pack'); } // 包没加载出来：回落药丸，别把页面盖死
  else {
    id = pickJf();
    var mod = P.effects[id];
    if (!mod || !mod.meta) noFx('meta');
  }
  var m = mod && mod.meta;
  if (m) {
    dbg.fx = id;
    cv.setAttribute('data-fx', id);
    var W = m.size[0], H = m.size[1], O = m.origin || [W / 2, H / 2];
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (!ctx) { noFx('ctx'); } else {
      var img = ctx.createImageData(W, H);
      var fr = P.createFrame(W, H);
      // one-shot 特效（meta.loop === false）播完 meta.duration 就重开一个，闪屏期间一直有动作
      var oneShot = m.loop === false, life = +m.duration || 0, age = 0;
      function spawn() {
        age = 0;
        return P.createFx(mod, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) });
      }
      var fx = spawn();
      sizeCanvas();
      addEventListener('resize', sizeCanvas);

      function touch() { return window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false; }
      var GAP = (touch() || lite()) ? 1000 / 18 : 1000 / 30;

      function paint(dt) {
        if (dt) {
          fx.update(dt);
          if (oneShot && life) { age += dt; if (age >= life) fx = spawn(); }
        }
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
        if (removed) return;   // 只在整层移除之后停，见上面 removed 那段注释
        if (lastPaint && now - lastPaint < GAP - 1) { raf = requestAnimationFrame(step); return; } // 帧率封顶
        var dt = lastPaint ? Math.min((now - lastPaint) / 1000, 0.12) : 0;
        lastPaint = now;
        paint(dt);
        raf = requestAnimationFrame(step);
      }

      // 省电 / 关动画：不再画静帧（2026-11-04 统一规则）——回落到药丸，canvas 藏掉
      if (still()) noFx('still');
      else {
        // 首帧（2026-11-05）：loop 特效先在内存里按 1/60 步长预跑 0.35 秒再一次性上屏，
        // 第一眼就有主体；one-shot 的 t=0 就是峰值，预跑等于把动画提前放完，所以直接开播。
        if (!oneShot) for (var t = 0; t < 0.35; t += 1 / 60) fx.update(1 / 60);
        paint(0);
        lastPaint = performance.now();
        raf = requestAnimationFrame(step);
      }
    }
  }

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

  // ── 内部面板的加载态（2026-11-06 用户：「覆盖各个子模块……不许有子模块还是裸文字或没动效」）
  // 业务代码在等数据时只写一行占位 <p class="note">正在加载…</p>。这里不改业务代码，
  // 用 MutationObserver 把这类**只在加载中**的占位就地升级成同一套「canvas 像素动效 + 药丸」：
  //   · 只认文本以「正在加载」开头且没有任何子元素的 .note —— 正常文案、加载失败提示都不动；
  //   · 面板拿到数据后 innerHTML 被整体替换，canvas 一并移除，循环下一帧发现脱离文档就自停；
  //   · 特效包缺失 / 省电 / 关动画：不建 canvas，只补一条像素方块药丸（回落不空屏）。
  // 注：2026-11-11 删掉「管理」模块后，现有页面暂时没有「正在加载…」占位，这段留着给以后新面板用。
  (function panelFx() {
    var st = document.createElement('style');
    st.id = 'hx-jf-panelfx-style';
    st.textContent =
      '.hx-fxpanel{display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'gap:clamp(10px,1.4vh,18px);padding:clamp(14px,2vh,26px) 8px}'
      + '.hx-fxpanel canvas{image-rendering:pixelated;display:block}'
      // 字号一处 clamp、内部方块/文字全 em（全站规矩）；面板里比首屏闪屏克制一档
      + '.hx-fxpanel .hx-loadpill{font-size:clamp(13px,.8vw + 7px,20px);box-shadow:none}';
    (document.head || document.documentElement).appendChild(st);

    // 小号引擎：和首屏闪屏同一套特效包、同一套「每次随机 + 避开上一次」抽签（2026-11-05）
    function mini(cv) {
      var P = window.PixelFX;
      if (!P || !P.effects || !P.ids || !P.ids.length) return null;
      var eid = pickJf();
      var mm = P.effects[eid];
      if (!mm || !mm.meta) return null;
      var m = mm.meta, W = m.size[0], H = m.size[1], O = m.origin || [W / 2, H / 2];
      cv.width = W; cv.height = H;
      var k = Math.max(2, Math.min(3, Math.floor(Math.min(190 / W, 160 / H)) || 2));
      cv.style.width = (W * k) + 'px';
      cv.style.height = (H * k) + 'px';
      var ctx = cv.getContext('2d');
      if (!ctx) return null;
      var img = ctx.createImageData(W, H), fr = P.createFrame(W, H);
      var oneShot = m.loop === false, life = +m.duration || 0, age = 0;
      function spawn() {
        age = 0;
        return P.createFx(mm, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) });
      }
      var fx = spawn();
      var touch = window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false;
      var GAP = (touch || lite()) ? 1000 / 18 : 1000 / 30;
      var raf = 0, last = 0, stopped = false;
      function draw() {
        P.clearFrame(fr); fx.draw(fr, 'back'); fx.draw(fr, 'front');
        P.composite(fr, img.data, null);
        ctx.clearRect(0, 0, W, H); ctx.putImageData(img, 0, 0);
      }
      function step(now) {
        raf = 0; if (stopped) return;
        if (!cv.isConnected) { stopped = true; return; }  // 面板被结果替换：自停，不在后台空转
        if (last && now - last < GAP - 1) { raf = requestAnimationFrame(step); return; }
        var dt = last ? Math.min((now - last) / 1000, 0.12) : 0;
        last = now;
        if (dt) {
          fx.update(dt);
          if (oneShot && life) { age += dt; if (age >= life) fx = spawn(); }
        }
        draw();
        raf = requestAnimationFrame(step);
      }
      // 首帧（2026-11-05）：loop 特效预跑 0.35 秒再上屏，one-shot 从 0 帧直接播
      if (!oneShot) for (var t = 0; t < 0.35; t += 1 / 60) fx.update(1 / 60);
      draw();
      last = performance.now();
      raf = requestAnimationFrame(step);
      return { stop: function () { stopped = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } } };
    }

    function pill(text) {
      var p = document.createElement('div');
      p.className = 'hx-loadpill sm';
      p.setAttribute('role', 'status');
      var s = '<span class="hx-px" aria-hidden="true">', i;
      for (i = 0; i < 7; i++) s += '<i style="--i:' + i + '"></i>';
      p.innerHTML = s + '</span><b></b>';
      p.querySelector('b').textContent = text || '正在加载…';
      return p;
    }

    function upgrade(el) {
      if (!el || el.dataset.hxfx || el.children.length) return;
      var text = (el.textContent || '').trim();
      if (!/^正在加载/.test(text)) return;
      el.dataset.hxfx = '1';
      el.classList.add('hx-fxpanel');
      el.setAttribute('aria-busy', 'true');
      var cv = document.createElement('canvas');
      var ok = !still() && mini(cv);
      el.textContent = '';
      if (ok) el.appendChild(cv);
      el.appendChild(pill(text));
    }

    function scan(root) {
      if (!root) return;
      if (root.nodeType === 1 && root.classList && root.classList.contains('note')) upgrade(root);
      if (root.querySelectorAll) {
        var list = root.querySelectorAll('.note');
        for (var i = 0; i < list.length; i++) upgrade(list[i]);
      }
    }

    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var add = muts[i].addedNodes;
        for (var j = 0; j < add.length; j++) scan(add[j]);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scan(document.body);
  })();
})();
