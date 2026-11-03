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
// 2026-11-03 起改成「按排位发牌 + 色相变体」，保证 15 张卡里最多 3 只重样且长得不一样，
// 详见 pickFor / hueOf 上面的长注释。
//
// 2026-11-02 第二次修正（看截图发现的两个问题）：
//   1) 底下那层暗色圆晕原来是 CSS 伪元素，白卡分支下在浅色背景上像一块脏斑。
//      改成生成一张真正的晕圈图，和生物一起合成进 canvas —— 逐像素、随 canvas 缩放，边缘服帖。
//   2) 纯随机分配会出现「四张卡都是蝙蝠」。改成洗牌发牌，见 pickFor。
(function () {
  var P = window.PixelFX;
  if (!P || !P.effects) return;

  var IDS = P.ids || Object.keys(P.effects);
  // ── 2026-11-03 第二次扩充：池子 = 12 只小生物 + 17 个循环特效，共 29 个 ──
  // 用户要求「别弄一样的」：首页 15 张卡，池子 ≥ 15 就能张张不同（排位发牌 rank 0..14 全唯一），
  // 色相变体成了纯兜底（卡片数超过池子才会触发）。挑的全是 loop 型、≤152px、无辉光合成下
  // 也有实心像素的特效（Node 逐帧测过可见像素占比），教室机跑得动。
  // 宽高比仍限 0.6～2.5（sqrt(面积) 归一化兜「显小」，太极端的比例塞进卡片盒子难看）。
  var POOL = IDS.filter(function (id) {
    var m = P.effects[id] && P.effects[id].meta;
    if (!m || !m.size) return false;
    var r = m.size[0] / m.size[1];
    return r >= 0.6 && r <= 2.5;
  });
  if (!POOL.length) POOL = IDS; // 兜底：万一素材全被剔光了，退回全部
  var KEY = 'hx-critter-v2';
  var reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var entries = [];          // { cvs, ctx, fx, id, W, H, img, active, drawn, vis, wrap }
  var raf = 0;               // 全局唯一的帧循环句柄（红线：不允许每张卡一个）

  function lite() { return document.documentElement.classList.contains('hx-lite'); }
  function still() { return lite() || (reduced && reduced.matches); }

  // ── 2026-11-03 第二次改：从「按牌堆去重」升级到「按排位去重 + 色相变体」 ──
  // 上一版是「洗一副牌按顺序发，发完再洗」。它只保证**同一副牌内**不重复：
  // 首页 15 张卡、池子 12 只，第二轮的前 3 张必然和第二轮之外的某张撞（数学上跑不掉），
  // 而且撞的是哪 3 只完全随机 —— 用户截图里「好几个重复的」就是这些。
  //
  // 现在把「卡序 → 生物」改成确定的排位映射，sessionStorage 只存「每张卡排第几」：
  //   rank  →  round = floor(rank / 12), pos = rank % 12
  //   decks[round][pos]  ← 第 round 副牌（一副 = 12 只生物的一次独立洗牌）
  // 于是 rank 0–11 落在第 0 副牌里、rank 12–23 落在第 1 副牌里 —— **每一轮内部必然全唯一**。
  // 15 张卡就是「12 张全不同 + 3 张各撞一只」，不可能再多。
  // 剩下这 3 只靠色相偏移区分（见 hueOf）：hue-rotate 140°/280°/60° 之后颜色完全不同，
  // 肉眼看上去就是三只不同的生物，而不再是「一模一样的复制品」。
  //
  // 每次进首页（新会话）排位和牌序都是新的，满足用户要的「每次随机匹配」；
  // 同一次会话里刷新/切工具不跳变（排位存在 sessionStorage）。
  var state = null;
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function stateOf() {
    if (state) return state;
    var st = null;
    try { st = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { st = null; }
    // stamp 里存着池子的成员表：素材增删过（POOL 变了）就整份作废重发，
    // 否则装的是上一版池子里的 id，取出来可能是 undefined，卡片会直接空白。
    var stamp = POOL.join(',');
    if (!st || typeof st !== 'object' || st.p !== stamp || !st.n || !Array.isArray(st.decks)) {
      st = { p: stamp, n: {}, decks: [] };
    }
    state = st;
    return st;
  }
  function saveState() {
    if (!state) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
  }
  // 排位 ≥ 池子大小 = 抢不到独一份，只能当「变体」：按 140°/280°/60°… 依次错开色相，
  // 用 140 是因为它在色轮上不落在任何原色的邻近位置，一眼就能看出是另一只。
  function hueOf(rank) { return rank >= POOL.length ? ((rank - POOL.length + 1) * 140) % 360 : 0; }

  // 这张卡配哪只生物。返回 { id, rank, hue }
  function pickFor(toolId) {
    var st = stateOf();
    var rank = st.n[toolId];
    if (typeof rank !== 'number') {
      // 分配下一个空位。取「已用排位的最大值 +1」而不是 key 的数量，
      // 免得将来删掉某张卡后新旧排位算重、两张卡落到同一格。
      var max = -1;
      for (var k in st.n) if (st.n[k] > max) max = st.n[k];
      rank = max + 1;
      st.n[toolId] = rank;
      saveState();
    }
    var N = POOL.length;
    var round = Math.floor(rank / N), pos = rank % N;
    while (st.decks.length <= round) {
      var deck = shuffle(POOL.slice());
      // 新一轮的第一张别和上一轮最后一张撞：这两张卡在 DOM 里通常挨得最近，
      // 挨着的两只一模一样最容易被看出「重复」。换到第二位去。
      if (st.decks.length) {
        var prev = st.decks[st.decks.length - 1];
        if (deck[0] === prev[prev.length - 1] && deck.length > 1) {
          var t = deck[0]; deck[0] = deck[1]; deck[1] = t;
        }
      }
      st.decks.push(deck);
      saveState();
    }
    return { id: st.decks[round][pos], rank: rank, hue: hueOf(rank) };
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
    if (e.hue) {
      // ── 2026-11-03：重复生物的色相变体 ──
      // 15 张卡 12 只生物，洗牌也免不了 3 张重复；同一只生物 hue 偏移 140°/280° 后
      // 颜色完全不同，看上去就是不同的生物。putImageData 不吃 filter，所以先把合好
      // 的帧放进离屏 canvas，再用带 hue-rotate 的 drawImage 合成到目标（alpha 正常叠加）。
      if (!e.off) {
        e.off = document.createElement('canvas');
        e.off.width = e.W; e.off.height = e.H;
        e.offCtx = e.off.getContext('2d');
      }
      e.offCtx.putImageData(e.img, 0, 0);
      e.ctx.filter = 'hue-rotate(' + e.hue + 'deg) saturate(1.3)';
      e.ctx.drawImage(e.off, 0, 0);
      e.ctx.filter = 'none';
    } else {
      e.ctx.putImageData(e.img, 0, 0);
    }
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
  // 只在 attach 里调用一次；没有 stop() 了 —— 卡片一旦挂上就一直动，
  // 停止的唯一途径是 still()（hx-lite / reduced-motion）、滚出视野、或页签切后台。
  function start(e) {
    e.active = true;
    if (still()) { if (!e.drawn) paint(e, 0); return; }
    kick();
  }

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
    var pick = pickFor(toolId);
    var e = frame(cvs, pick.id);
    if (!e) { wrap.remove(); return; }
    // 色相变体（只在抢不到独一份时非 0，见 hueOf）：赋值给 e.hue，paint() 里走 hue-rotate 分支。
    e.hue = pick.hue;
    e.rank = pick.rank;
    // 排位和变体号记在 DOM 上，方便核对「15 张卡到底有没有重样」（见文件末尾 HXCritters.info）
    cvs.setAttribute('data-critter', pick.id + (pick.hue ? '@' + pick.hue : ''));
    // ── 2026-11-03：按「视觉质量」统一缩放 ──
    // 原来这里算「装进 96×68 的盒子」（k = min(BW/W, BH/H)），再把容器设成缩放后的尺寸贴右上。
    // 两个毛病，用户截图里都能看见：细长的（水母只剩 54px 宽）被挤到右边缘像缩在角落，
    // 宽的（96px）往左顶到左上图标上 —— 实测 8 张卡有 4 张和图标重叠；而且大小参差。
    //
    // 现在两步：
    //   ① 位置：容器是 CSS 里的固定盒子（--fxc-w × --fxc-h），flex 居中 —— 所有生物都待在同一块地方；
    //   ② 大小：不按「填满盒子」缩，按 **sqrt(宽×高)** 归一化到同一个目标视觉尺寸 --fxc-g。
    //      为什么用 sqrt(面积)：12 只生物原始比例差太远（蛇 136×56、飞骷髅 96×132、水母 96×120）。
    //      「填满盒子」会让高的撑满、扁的很小，实测面积差 2.3 倍；按 sqrt(面积) 拉平后差 1.18 倍，
    //      看上去才是「一样大」—— 这正是用户说的「缩放要一致」。
    //   最后再 clamp 进盒子，保证绝不越界压到图标或标题。
    var cs = getComputedStyle(wrap);
    var BW = parseFloat(cs.getPropertyValue('--fxc-w')) || 84;
    var BH = parseFloat(cs.getPropertyValue('--fxc-h')) || 96;
    var G = parseFloat(cs.getPropertyValue('--fxc-g')) || 70; // 目标视觉质量（sqrt(宽×高)）
    var k = G / Math.sqrt(e.W * e.H);
    k = Math.min(k, BW / e.W, BH / e.H); // 不超出盒子
    cvs.style.width = (e.W * k).toFixed(1) + 'px';
    cvs.style.height = (e.H * k).toFixed(1) + 'px';
    // canvas 的 width/height 属性仍是生物的原始像素尺寸，CSS 尺寸负责缩放；
    // 窗口变窄时 CSS 里的 --fxc-w/h/g 会变（见窄屏 media query），resize 时由 layoutAll 重算。
    // 有背景图（hx-bg）才垫晕圈：白卡分支不垫（暗斑在浅底上显脏）
    if (document.documentElement.classList.contains('hx-bg')) e.halo = halo(cvs, e.W, e.H, 0.42);
    e.wrap = wrap;
    entries.push(e);
    paint(e, 0); // 先出一帧静态画面，不要空白
    watch(e);
    // 默认就在动（手机没有 hover，不默认动就等于永远是张静态图）。
    // still()（hx-lite / reduced-motion）在 kick() 里挡掉，那两种情况下就停在第一帧。
    start(e);
    // ── 2026-11-03 删除四个悬停监听（用户报的 bug）──
    // 原来这里挂着 pointerenter→start、pointerleave→stop、focus→start、blur→stop。
    // 那是「第一次改」的遗留：当时的设计是「只有鼠标停上去才动」，后来改成默认全动，
    // start() 留了下来、stop() 忘了删。结果就是鼠标划过一张卡再移开，那张卡被 stop()
    // 把 active 置成 false，**从此再也不动**（唯一的补偿是再 hover 一次），和其它卡形成
    // 「有的动有的不动」的错觉。用户原话：「鼠标经过在拿走后就停止了 这是不对的」。
    // 现在什么都不绑：卡片挂上就一直是 active，靠 fpsNow() 封顶 + IntersectionObserver
    // 控制开销，不需要用 hover 当开关。CSS 里 .tile:hover .fxc 那个放大/位移是纯视觉反馈，
    // 和动画状态无关，保留。
  }

  // 窗口尺寸变了（转屏、拖窗口、桌面→窄屏档），CSS 里的 --fxc-w/h/g 跟着变，
  // canvas 的行内像素尺寸得重算一次，否则还是按旧盒子的大小显示。
  // 只做尺寸计算，不碰动画状态；用 rAF 合并连续的 resize 事件。
  function relayout() {
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.cvs.isConnected || !e.wrap) continue;
      var cs = getComputedStyle(e.wrap);
      var BW = parseFloat(cs.getPropertyValue('--fxc-w')) || 84;
      var BH = parseFloat(cs.getPropertyValue('--fxc-h')) || 96;
      var G = parseFloat(cs.getPropertyValue('--fxc-g')) || 70;
      var k = Math.min(G / Math.sqrt(e.W * e.H), BW / e.W, BH / e.H);
      e.cvs.style.width = (e.W * k).toFixed(1) + 'px';
      e.cvs.style.height = (e.H * k).toFixed(1) + 'px';
    }
  }
  var rzT = 0;
  addEventListener('resize', function () {
    if (rzT) return;
    rzT = setTimeout(function () { rzT = 0; relayout(); }, 180);
  });

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

  // info() 只给自查用：把页面上所有生物卡的 (id, hue) 列出来，便于确认有没有重样。
  // _pick 同理，是给离线脚本抽查发牌算法用的（见项目交接.md 里的自检命令）。
  window.HXCritters = {
    attach: attach, sweep: sweep, ids: IDS, pool: POOL,
    _pick: pickFor,
    info: function () {
      var out = [];
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].cvs.isConnected) continue;
        out.push({ id: entries[i].id, hue: entries[i].hue || 0, rank: entries[i].rank });
      }
      return out;
    }
  };
})();
