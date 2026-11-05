/* 华夏工具 · 统一「像素加载动效」胶水（2026-11-04）。
 *
 * 全站加载提示的统一规则（刷题 / 考试 / 小组加分三处共用同一份实现，各自目录放一份拷贝——
 * 各工具是独立页面、发布路径互不相邻（/shuati/ /exam/ /jiafenxitong/），没有能同时被三个
 * 页面引用的公共目录，所以用「同一份源码拷三份」而不是抽包；改这里时同步另外两份：
 *   · 刷题/loadfx.js（本文件）
 *   · 考试/src/loadfx.js（build.js 打进单文件产物）
 *   · 小组加分/fx/hx-jf-load.js（那边逻辑更重，只对齐「随机 + 会话内固定 + 回落」三条规则）
 *
 * 规则（用户 2026-11-04 定）：
 *   1. 首选：从特效包（pixelfx，MIT，见仓库根 NOTICE-pixelfx.md）里**随机**挑一个 loop 特效，
 *      画在 canvas 上；「正在加载…」文字以药丸（方块 + 文字）形式跟在动效下方 —— 文字是状态说明，
 *      要的是「结合」，不是二选一。
 *   2. 随机但**同一会话内固定**：选择记在 sessionStorage（键 hx-loadfx-<tool>）。
 *      取舍：6 个特效每次洗牌会显得乱，用户要的是「随机用起来」；同一会话内保持固定，
 *      关掉标签页 / 换会话重新随机。小组加分原先「每次进页随机」的做法就此统一。
 *   3. 播不了就回落：prefers-reduced-motion、hx-lite（省电一体机）、特效包没加载出来、
 *      canvas 建不出来时 mount() 返回 null，由调用方回落到原来的像素方块药丸——
 *      绝不允许什么都不显示，也绝不允许两套加载提示同框（那是调用方职责，见各自接入处）。
 *
 * 性能红线（同 小组加分/fx/hx-jf-load.js）：全局唯一 requestAnimationFrame 循环、
 * 帧率封顶（触屏 18fps / 桌面 30fps）、done() 后 cancel 并把 DOM 整体移除。
 */
(function () {
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  // 布局样式只注入一次：.hx-fxwrap 是「canvas + 药丸」的容器（页面内嵌版铺在 host 里，
  // full 版铺满整页给首屏闪屏用）。药丸本体样式沿用 hx-theme.js 注入的 #hx-pill-style。
  var css = ''
    + '.hx-fxwrap{display:grid;place-items:center;gap:16px;padding:clamp(28px,4vw,56px) 12px;box-sizing:border-box}'
    + '.hx-fxwrap.full{position:fixed;inset:0;z-index:2147482000;background:var(--card-solid,#f6f6f4)}'
    + '.hx-fxcv{image-rendering:pixelated}'
    // 药丸在动效下面当状态说明，字号比 hx-theme.js 那版克制一档，别抢 canvas 的戏
    + '.hx-fxwrap .hx-loadpill{font-size:clamp(13px,.7vw + 7px,20px)}'
    + '.hx-fxwrap.out .hx-fxcv,.hx-fxwrap.out .hx-loadpill{opacity:0;transition:opacity .25s ease}';
  (function () {
    var st = document.createElement('style');
    st.id = 'hx-loadfx-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  })();

  // 在指定 canvas 上起一个特效引擎；起不来返回 null（调用方决定回落）
  function start(cv, tool) {
    var P = window.PixelFX;
    if (!cv || !cv.getContext || !P || !P.effects || !P.ids || !P.ids.length) return null;
    var K = 'hx-loadfx-' + tool, id = '';
    try { id = sessionStorage.getItem(K) || ''; } catch (e) { }
    if (!id || !P.effects[id]) id = P.ids[Math.floor(Math.random() * P.ids.length)];
    try { if (id) sessionStorage.setItem(K, id); } catch (e) { }
    var mod = P.effects[id];
    if (!mod || !mod.meta) return null;
    var m = mod.meta, W = m.size[0], H = m.size[1], O = m.origin || [W / 2, H / 2];
    cv.width = W; cv.height = H;
    cv.setAttribute('data-fx', id);
    cv.className = cv.className || 'hx-fxcv';
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    // 整数倍放大（像素画非整数缩放会糊）：目标短边 ~200px，2～6 倍之间
    var k = Math.max(2, Math.min(6, Math.floor(200 / Math.max(W, H)) || 2));
    cv.style.width = (W * k) + 'px';
    cv.style.height = (H * k) + 'px';
    var img = ctx.createImageData(W, H), fr = P.createFrame(W, H);
    var fx = P.createFx(mod, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) });
    var touch = window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false;
    var GAP = touch ? 1000 / 18 : 1000 / 30;
    var raf = 0, last = 0, stopped = false;
    function paint(dt) {
      if (dt) fx.update(dt);
      P.clearFrame(fr); fx.draw(fr, 'back'); fx.draw(fr, 'front');
      P.composite(fr, img.data, null);
      ctx.clearRect(0, 0, W, H); ctx.putImageData(img, 0, 0);
    }
    function step(now) {
      raf = 0; if (stopped) return;
      if (last && now - last < GAP - 1) { raf = requestAnimationFrame(step); return; } // 帧率封顶
      var dt = last ? Math.min((now - last) / 1000, 0.12) : 0;
      last = now; paint(dt);
      raf = requestAnimationFrame(step);
    }
    paint(0);
    raf = requestAnimationFrame(step);
    return {
      stop: function () { stopped = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } },
      fx: id
    };
  }

  // 页面内嵌版：往 host 里画「canvas + 药丸(方块+文字)」，返回 { el, done() }；播不了返回 null
  function mount(host, tool, text, full) {
    if (!host || still()) return null;                 // 关动画 / 省电：回落，由调用方画药丸
    var cv = document.createElement('canvas');
    cv.className = 'hx-fxcv';
    var eng = start(cv, tool);
    if (!eng) return null;                             // 包没出来 / canvas 建不出来：回落
    var pill = document.createElement('div');
    pill.className = 'hx-loadpill sm';
    pill.setAttribute('role', 'status');
    var px = '<span class="hx-px" aria-hidden="true">', i;
    for (i = 0; i < 7; i++) px += '<i style="--i:' + i + '"></i>';
    pill.innerHTML = px + '</span><b></b>';
    pill.querySelector('b').textContent = text || '正在载入…';
    var wrap = document.createElement('div');
    wrap.className = 'hx-fxwrap' + (full ? ' full' : '');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.appendChild(cv); wrap.appendChild(pill);
    host.appendChild(wrap);
    var out = false;
    return {
      el: wrap,
      fx: eng.fx,
      done: function () {                              // 淡出并整体移除，停 rAF
        if (out) return; out = true;
        eng.stop();
        wrap.classList.add('out');
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 260);
      }
    };
  }

  // 首屏闪屏版（考试用）：页面里先写好 <div id="hxBoot"><canvas>…</canvas><div class="hx-loadpill sm">…</div></div>，
  // 这里接管：canvas 播得起来就播；播不起来把 canvas 藏掉，只留药丸（fallback 不空屏）。
  // finishBoot() 由工具在数据就绪后调：先保底 MIN_SHOW 再整层淡出移除。
  var bootH = null;
  function boot(tool, overlayId) {
    var ov = document.getElementById(overlayId);
    if (!ov || ov.dataset.armed) return;
    ov.dataset.armed = '1';
    var cv = ov.querySelector('canvas');
    var eng = still() ? null : start(cv, tool);
    if (!eng && cv) cv.style.display = 'none';
    bootH = { ov: ov, eng: eng, at: performance.now() };
  }
  var MIN_SHOW = 400;                                  // 秒开时也至少看 0.4s，不闪一下
  function finishBoot() {
    if (!bootH) return;
    var b = bootH; bootH = null;
    if (b.eng) b.eng.stop();
    setTimeout(function () {
      b.ov.classList.add('out');                       // app.css：#hxBoot.out 淡出整层
      setTimeout(function () { if (b.ov.parentNode) b.ov.parentNode.removeChild(b.ov); }, 280);
    }, Math.max(0, MIN_SHOW - (performance.now() - b.at)));
  }

  window.HXLoadFx = {
    pick: function (tool) {                            // 供调试 / 自查：看本会话选中了哪个特效
      var P = window.PixelFX, K = 'hx-loadfx-' + tool, id = '';
      try { id = sessionStorage.getItem(K) || ''; } catch (e) { }
      if (!id && P && P.ids && P.ids.length) id = P.ids[Math.floor(Math.random() * P.ids.length)];
      return id;
    },
    mount: mount,
    boot: boot,
    finishBoot: finishBoot
  };
})();
