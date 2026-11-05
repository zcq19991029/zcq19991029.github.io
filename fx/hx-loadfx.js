/* 华夏工具 · 统一「像素加载动效」胶水（共享版，2026-11-07）。
 *
 * 这是全站唯一权威实现，发布在站点根 /fx/hx-loadfx.js（publish.cjs walk(总入口/fx)）：
 *   · 静态工具页在 head 里先后引 /fx/pixelfx-loader.js 与 /fx/hx-loadfx.js 两个阻塞脚本
 *     （进制转换 /base/、课程进度 /course/、反馈 /feedback/、教室快捷方式 /class/）；
 *   · 单文件构建工具（单片机、排课）在 build.js 里把本文件连同特效包一起内联进产物；
 *   · 特效包同目录 /fx/pixelfx-loader.js（拷自 小组加分/fx/pixelfx-loader.js，MIT，见仓库根 NOTICE-pixelfx.md）。
 *   · 刷题/loadfx.js 与 考试/src/loadfx.js 是本文件的同步拷贝（那两处要随页面一起走相对路径），
 *     小组加分/fx/hx-jf-load.js 是同规则的重量级变体——改规则时四处对齐。
 *
 * 规则（用户 2026-11-04 定，2026-11-06 / 2026-11-07 返修）：
 *   1. **第一帧就是动效**：页面的首屏等待必须由「canvas 像素动效 + 药丸」组成，不允许先出现
 *      一条光秃秃的文字药丸、等内容渲染完再补一层像素闪屏盖上去。首屏用 boot()：标记先写进 HTML，
 *      boot() 在解析到它时立刻画第一帧，内容就绪后整层淡出。
 *   2. 首选：从特效包里**随机**挑一个 loop 特效画在 canvas 上；「正在载入…」文字以药丸
 *      （方块 + 文字）形式跟在动效下方——文字是状态说明，要的是「结合」，不是二选一。
 *   3. 随机但**同一会话内固定**：选择记在 sessionStorage（键 hx-loadfx-<tool>）。
 *   4. 播不了就回落：prefers-reduced-motion、hx-lite（省电一体机）、特效包没加载出来、
 *      canvas 建不出来时回落到像素方块药丸——绝不允许什么都不显示、也不许把页面盖死（8 秒兜底）。
 *   5. 尺寸按视口自适应（2026-11-06「加载动效普遍太小 紧急修复」；2026-11-07 用户「再放大点」：
 *      短边 62% → 70%）：像素主体按短边最大 70% 定尺寸、整数倍放大。
 *
 * 性能红线（同 小组加分/fx/hx-jf-load.js）：全局唯一 requestAnimationFrame 循环、
 * 帧率封顶（触屏 18fps / 桌面 30fps）、done() 后 cancel；canvas 被换掉时循环自己停。
 */
(function () {
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  // 布局样式只注入一次：.hx-fxwrap 是「canvas + 药丸」的容器（页面内嵌版铺在 host 里，
  // full 版铺满整页给首屏闪屏用）。药丸本体样式沿用 hx-theme.js 注入的 #hx-pill-style。
  var css = ''
    + '.hx-fxwrap{display:grid;place-items:center;gap:clamp(12px,1.6vh,26px);padding:clamp(24px,4vw,56px) 12px;box-sizing:border-box}'
    + '.hx-fxwrap.full{position:fixed;inset:0;z-index:2147482000;background:var(--card-solid,#f6f6f4)}'
    + '.hx-fxcv{image-rendering:pixelated;display:block;max-width:100%}'
    // 药丸在动效下面当状态说明。字号一处 clamp、内部方块/文字全 em（全站规矩），
    // 2026-11-06 整体抬一档：1080p 上 24px 左右，不再是「动效很大、字很小」的失衡感。
    + '.hx-fxwrap .hx-loadpill{font-size:clamp(15px,1vw + 8px,28px)}'
    + '.hx-fxwrap.panel{padding:clamp(14px,2vh,28px) 12px}'
    + '.hx-fxwrap.panel .hx-loadpill{font-size:clamp(13px,.8vw + 7px,22px)}'
    + '.hx-fxwrap.out .hx-fxcv,.hx-fxwrap.out .hx-loadpill{opacity:0;transition:opacity .25s ease}'
    // 首屏闪屏（考试 / 刷题共用）：#hxBoot 是写在 HTML 里的那一层，boot() 接管 canvas。
    // 底色和页面同色，淡出时只淡整层，不会露出半成品页面再闪一下。
    + '.hx-boot{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;'
    + 'background:var(--card-solid,#f6f6f4);transition:opacity .26s ease,visibility 0s linear .26s}'
    + '.hx-boot.out{opacity:0;visibility:hidden;pointer-events:none}'
    + '.hx-boot-card{display:grid;place-items:center;gap:clamp(14px,2vh,30px);padding:24px;text-align:center}'
    + '.hx-boot-card .hx-loadpill{font-size:clamp(16px,1.1vw + 9px,30px);box-shadow:none}'
    + '.hx-boot-title{font:600 clamp(19px,1.5vw + 8px,36px)/1.25 var(--hx-font,-apple-system,"PingFang SC","Microsoft YaHei UI",sans-serif);'
    + 'color:var(--ink,#0b1220);letter-spacing:.02em;margin:0}'
    + 'html.hx-lite .hx-boot-card canvas{display:none}'
    + '@media (prefers-reduced-motion:reduce){.hx-boot-card canvas{display:none}}'
    // 药丸基础样式（2026-11-07 共享版自带）：进制转换 / 反馈 / 教室快捷方式这几页没引 hx-theme.js，
    // .hx-loadpill/.hx-px 在那里没人定义——这里把 hx-theme.js 里同一套规则原样带上。
    // 引了 hx-theme.js 的页面两边规则一致，重复注入不打架。
    + '.hx-px{display:inline-flex;align-items:flex-end;gap:.28em;height:2.2em}'
    + '.hx-px i{width:1em;height:1em;border-radius:.16em;display:block;'
    + 'background:linear-gradient(180deg,var(--acc,#2f845a),var(--acc2,#5aa77c));'
    + 'box-shadow:0 .5em 1.2em -.6em var(--acc,#2f845a);'
    + 'animation:hxPx 1.15s var(--hx-ease,cubic-bezier(.32,.72,0,1)) infinite;animation-delay:calc(var(--i) * 90ms)}'
    + '.hx-px i:nth-child(2n){background:linear-gradient(180deg,var(--acc2,#5aa77c),var(--acc3,#5aa77c))}'
    + '@keyframes hxPx{0%,100%{transform:translateY(0);opacity:.55}35%{transform:translateY(-110%);opacity:1}60%{transform:translateY(0);opacity:.7}}'
    + '.hx-loadpill{display:inline-flex;align-items:center;gap:.7em;padding:.75em 1.15em;border-radius:99px;'
    + 'background:var(--card-solid,rgba(255,255,255,.86));color:var(--ink,#1d1d1f);'
    + 'font-size:clamp(15px,.85vw + 6px,30px);line-height:1;'
    + 'border:1px solid var(--edge,rgba(0,0,0,.07));box-shadow:0 18px 40px -18px rgba(0,0,0,.35)}'
    + '.hx-loadpill .hx-px{font-size:.54em}'
    + '.hx-loadpill b{font-weight:600;white-space:nowrap}'
    + 'html.hx-lite .hx-px i{animation:none;opacity:.85}'
    + '@media (prefers-reduced-motion:reduce){.hx-px i{animation:none;opacity:.85;transform:none}.hx-loadpill{animation:none}}';
  (function () {
    var st = document.createElement('style');
    st.id = 'hx-loadfx-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  })();

  // 按视口算整数放大倍数（像素画非整数缩放会糊）。
  // 首屏：短边 70% 定上限（2026-11-07 用户「再放大点」，62% → 70%），3～8 倍；
  // 面板内嵌：上限收紧，2～4 倍，放进卡片不撑爆。
  function fit(cv, m, compact) {
    var vw = window.innerWidth || 960, vh = window.innerHeight || 640;
    var maxW = compact ? Math.min(vw * 0.72, 340) : vw * 0.72;
    var maxH = compact ? Math.min(vh * 0.3, 260) : vh * 0.70;
    var k = Math.floor(Math.min(maxW / m.size[0], maxH / m.size[1]));
    // 上限 12：56px 的小特效在 1080p 也能放大到 ~620px，和 128px 大特效（5 倍 640px）
    // 视觉体量接近——不然随机抽到小特效那几把，「动效明显小一圈」。
    k = Math.max(compact ? 2 : 3, Math.min(compact ? 4 : 12, k || 0));
    cv.style.width = (m.size[0] * k) + 'px';
    cv.style.height = (m.size[1] * k) + 'px';
  }

  // 在指定 canvas 上起一个特效引擎；起不来返回 null（调用方决定回落）
  function start(cv, tool, compact) {
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
    if (!cv.className) cv.className = 'hx-fxcv';
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    fit(cv, m, compact);
    addEventListener('resize', function () { fit(cv, m, compact); });
    var img = ctx.createImageData(W, H), fr = P.createFrame(W, H);
    var fx = P.createFx(mod, { x: O[0], y: O[1], seed: Math.floor(Math.random() * 997) });
    var touch = window.matchMedia ? matchMedia('(hover: none), (pointer: coarse)').matches : false;
    var GAP = (touch || lite()) ? 1000 / 18 : 1000 / 30;
    var raf = 0, last = 0, stopped = false;
    function paint(dt) {
      if (dt) fx.update(dt);
      P.clearFrame(fr); fx.draw(fr, 'back'); fx.draw(fr, 'front');
      P.composite(fr, img.data, null);
      ctx.clearRect(0, 0, W, H); ctx.putImageData(img, 0, 0);
    }
    function step(now) {
      raf = 0; if (stopped) return;
      // 面板重新渲染（innerHTML 换掉）后 canvas 已脱离文档：停循环，别在后台白烧 GPU
      if (!cv.isConnected) { stopped = true; return; }
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

  // 造一条「方块 + 文字」药丸（回落时也用这一条，保证屏幕上永远只有一套加载语言）
  function pillEl(text) {
    var pill = document.createElement('div');
    pill.className = 'hx-loadpill sm';
    pill.setAttribute('role', 'status');
    var px = '<span class="hx-px" aria-hidden="true">', i;
    for (i = 0; i < 7; i++) px += '<i style="--i:' + i + '"></i>';
    pill.innerHTML = px + '</span><b></b>';
    pill.querySelector('b').textContent = text || '正在载入…';
    return pill;
  }

  // 页面内嵌版：往 host 里画「canvas + 药丸(方块+文字)」，返回 { el, done() }；播不了返回 null
  // opts.compact：面板/表格里的小号（2～4 倍、留白收紧）
  function mount(host, tool, text, full, opts) {
    var compact = !!(opts && opts.compact);
    if (!host || still()) return null;                 // 关动画 / 省电：回落，由调用方画药丸
    var cv = document.createElement('canvas');
    cv.className = 'hx-fxcv';
    var eng = start(cv, tool, compact);
    if (!eng) return null;                             // 包没出来 / canvas 建不出来：回落
    var pill = pillEl(text);
    var wrap = document.createElement('div');
    wrap.className = 'hx-fxwrap' + (full ? ' full' : '') + (compact ? ' panel' : '');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.appendChild(cv); wrap.appendChild(pill);
    host.appendChild(wrap);
    // 最少停留：本地题库 30ms 就回来了，秒闪一下反而像故障；不足 420ms 的补到 420ms 再淡出
    var at = performance.now(), MIN_SHOW = 420, out = false;
    return {
      el: wrap,
      fx: eng.fx,
      done: function () {                              // 淡出并整体移除，停 rAF
        if (out) return; out = true;
        setTimeout(function () {
          eng.stop();
          wrap.classList.add('out');
          setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 240);
        }, Math.max(0, MIN_SHOW - (performance.now() - at)));
      }
    };
  }

  // 首屏闪屏版（刷题 / 考试共用）：页面里先写好
  //   <div class="hx-boot" id="hxBoot"><div class="hx-boot-card"><canvas></canvas><div class="hx-loadpill sm">…</div></div></div>
  // 解析到它时（body 开头）就调 boot()：**第一帧就是 canvas 动效 + 药丸**，不会再出现裸文字阶段。
  // canvas 播不起来就把 canvas 藏掉，只留药丸（fallback 不空屏）。
  // finishBoot() 由工具在数据就绪后调：先保底 MIN_SHOW 再整层淡出移除。
  var bootH = null;
  var MIN_SHOW = 520;
  function boot(tool, overlayId) {
    var ov = document.getElementById(overlayId || 'hxBoot');
    if (!ov || ov.dataset.armed) return null;
    ov.dataset.armed = '1';
    var cv = ov.querySelector('canvas');
    var eng = still() ? null : start(cv, tool, false);
    if (!eng && cv) cv.style.display = 'none';
    bootH = { ov: ov, eng: eng, at: performance.now() };
    // 兜底：任何异常路径（网络卡死 / boot 抛错没走到 finishBoot）都不许把页面盖死，
    // 最多 8 秒强制收场，和 小组加分/fx/hx-jf-load.js 的 MAX_WAIT 同一思路。
    setTimeout(function () {
      if (bootH && bootH.ov === ov) finishBoot();
    }, 8000);
    return bootH;
  }
  function finishBoot() {
    if (!bootH) return;
    var b = bootH; bootH = null;
    if (b.eng) b.eng.stop();
    setTimeout(function () {
      b.ov.classList.add('out');                       // .hx-boot.out 淡出整层
      setTimeout(function () { if (b.ov.parentNode) b.ov.parentNode.removeChild(b.ov); }, 300);
    }, Math.max(0, MIN_SHOW - (performance.now() - b.at)));
  }
  function booting() { return !!bootH; }

  // 面板加载占位：把 <div data-fxload="正在加载排行…"> 就地升级成 canvas+药丸；
  // 播不了（省电 / 包没出来）就填回回落药丸。面板重新渲染时占位节点被换掉，canvas 随之回收。
  function auto(root) {
    root = root || document;
    var list = root.querySelectorAll('[data-fxload]'), i;
    for (i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.dataset.fxdone) continue;
      el.dataset.fxdone = '1';
      var text = el.getAttribute('data-fxload') || '正在载入…';
      el.classList.add('hx-loadwrap', 'sm');
      var h = mount(el, el.getAttribute('data-fxtool') || 'panel', text, false, { compact: true });
      if (!h) el.appendChild(pillEl(text));
    }
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
    finishBoot: finishBoot,
    booting: booting,
    auto: auto
  };
})();
