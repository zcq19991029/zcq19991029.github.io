// 华夏工具外观（网站根目录 /hx-theme.js + /hx-theme.css）。全部工具在 <head> 里同步引用，打开就是选好的外观、不闪。
// 外观只在总入口右上角改：主题色（沿用旧刷题站的 7 套）、浅色 / 深色 / 自动、背景图（推荐几张或自己上传）、界面透明度。
// 存在 localStorage hx-theme（JSON），自己上传的背景图压缩后存 hx-theme-img；同一网站的页面（包括嵌在总入口里的工具）通过 storage 事件一起变。
// 子工具只适配：<html data-theme="light|dark">（排课、单片机上机原有的深浅色写法）+ 行内 CSS 变量 --acc 等；接线仿真、排课、单片机的旧主题键顺带改好。
// <script src="../hx-theme.js" data-tool="paike">：子工具在网站上被单独打开（不在总入口框里）时，跳回总入口的对应工具，登录、账号只在总入口。
(function () {
  var ACC = {
    green: { name: '默认绿', l: '#2f845a', d: '#3ec383', l2: '#5aa77c', d2: '#7fd8a6' },
    blue: { name: '静谧蓝', l: '#0071e3', d: '#2997ff', l2: '#3d8fe0', d2: '#6cb6ff' },
    purple: { name: '暮紫', l: '#7a5ba7', d: '#b293ea', l2: '#9a7cc8', d2: '#cdb6f5' },
    warm: { name: '暖杏', l: '#b86f3e', d: '#ec9d62', l2: '#d08d5c', d2: '#f6bd8e' },
    pink: { name: '樱粉', l: '#c65b87', d: '#f08bb3', l2: '#d97ea3', d2: '#f7b3cf' },
    red: { name: '朱红', l: '#c23b3b', d: '#ff6961', l2: '#d66a6a', d2: '#ff9a94' },
    mono: { name: '黑白', l: '#1d1d1f', d: '#f5f5f7', l2: '#55555a', d2: '#c7c7cc' }
  };
  // 推荐背景：旧站的猫耳学习图（dev：开发者专属，只有开发者账号看得到、用得上）+ 几张渐变（不占流量）；op 是选它时的推荐透明度
  var BG = {
    none: { name: '无' },
    bear: { name: '小熊', img: 'bg/bear.jpg', op: 88 }, // 全站默认背景：不设 dev，教师、学生、外人都能选、默认就是它。op 是卡片透明度，小熊这张图很亮很花，72 时卡片太透、字压在花底上读不清，提到 88
    cat: { name: '猫耳学习', img: 'bg/cat-study.jpg', op: 70, dev: true },
    mist: { name: '晨雾', op: 72, css: 'radial-gradient(60% 50% at 15% 10%, #ffd6e7 0, transparent 70%), radial-gradient(55% 55% at 90% 20%, #cfe3ff 0, transparent 70%), radial-gradient(60% 60% at 50% 100%, #d9f5e5 0, transparent 70%), #f5f5f7' },
    bay: { name: '海湾', op: 70, css: 'radial-gradient(70% 60% at 0% 0%, #a8e6ff 0, transparent 65%), radial-gradient(60% 70% at 100% 30%, #8fb8ff 0, transparent 70%), radial-gradient(70% 60% at 40% 110%, #b6f0d8 0, transparent 70%), #eef6fb' },
    dusk: { name: '暮光', op: 68, css: 'radial-gradient(60% 60% at 10% 90%, #ffb38a 0, transparent 70%), radial-gradient(60% 60% at 90% 80%, #ff8fb7 0, transparent 70%), radial-gradient(80% 60% at 50% -10%, #c7b8ff 0, transparent 70%), #fbf1ee' },
    aurora: { name: '极光', op: 62, css: 'radial-gradient(60% 50% at 20% 20%, #1f6f5c 0, transparent 70%), radial-gradient(55% 60% at 85% 30%, #3b2f8f 0, transparent 70%), radial-gradient(70% 60% at 50% 110%, #0f4f7a 0, transparent 70%), #05070d' },
    custom: { name: '自己的图', op: 70 }
  };
  var KEY = 'hx-theme', IMG = 'hx-theme-img', DEV = 'hx-dev', VER = 2, DEF = { acc: 'green', mode: 'auto', bg: 'bear', op: 90, wx: 'none' };
  // 背景动效（2026-11-03）：和背景主题平行的「动效模块」，由 fx/hx-weather.js 渲染在背景层。
  // 白名单写死在这里（而不是由渲染器自己认）：将来下架某个特效，老存档里选着它也会安全回落到「无」。
  var WX = {
    none: { name: '无' },
    aurora: { name: '极光' }, fireflies: { name: '萤火虫' }, 'shooting-stars': { name: '流星' },
    snow: { name: '雪' }, rain: { name: '雨' }, storm: { name: '雷雨' }, blizzard: { name: '暴风雪' },
    clouds: { name: '云' }, fog: { name: '雾' }, 'god-rays': { name: '神光' },
    'cherry-blossoms': { name: '樱花' }, 'falling-leaves': { name: '落叶' }
  };
  // VER：外观配置版本。加了全局默认背景后，老存档里没有 ver 字段 = 还没主动挑过背景，
  // 补成新默认（小熊）；自己上传过图的（custom）与显式选过「无」的不覆盖。
  var OLD = { day: { acc: 'blue', mode: 'light' }, sea: { acc: 'green', mode: 'light' }, sakura: { acc: 'pink', mode: 'light' }, night: { acc: 'purple', mode: 'dark' }, forest: { acc: 'green', mode: 'dark' }, mist: { acc: 'mono', mode: 'dark' } };
  var me = document.currentScript, root = me ? new URL('.', me.src).href : location.origin + '/';
  var tool = me && me.getAttribute('data-tool'), subs = [], dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  // 在网站上被单独打开的子工具：回到总入口（登录、账号、外观都在那里）。离线单文件不跳；地址加 ?solo 也不跳（调试用）。
  if (tool && window.top === window && /^https?:$/.test(location.protocol) && !/[?&]solo\b/.test(location.search)) { location.replace(root + '#' + tool); return; }

  // 嵌在总入口里的子工具：选了背景图时页面底色透明，透出首页的背景图（以前单片机、考试、排课、加分是整页纯色铺满）
  if (tool && window.top !== window) { var st = document.createElement('style'); st.textContent = 'html.hx-bg,html.hx-bg body{background-color:transparent!important}'; (document.head || document.documentElement).appendChild(st); }

  // ── 顶部加载进度条（2026-11-03）──
  // 用户原话「刷新加载动画缺一个　包括其他界面」：首页已经有 #boot，
  // 但各子工具刷新时是「顶栏先出来、中间内容空着」的一段白，没有任何过渡。
  //
  // 为什么样式写在这里注入、而不是放进 hx-theme.css：全站只有总入口和刷题真的引了那份 CSS，
  // 接线仿真、排课、单片机、考试、小组加分、课程进度都只引 hx-theme.js（它们各自带自己的样式表，
  // 只从这边取颜色变量）。放 CSS 里等于只覆盖 2/8 个页面，必须跟着 JS 走才全覆盖。
  //
  // 只在**顶层页面**挂（window.top === window）：嵌在首页 iframe 里的工具由首页那个
  // 「正在加载 · 接线仿真」药丸负责提示，两条同时出现反而啰嗦，而且 iframe 顶部那条线
  // 正好压在主页面的顶栏下沿，看着像顶栏掉漆。
  if (window.top === window) {
    var barCSS = ''
      // 进度用 scaleX 而不是 width：transform 走合成线程、不触发重排，希沃那种老机器上也不拖慢首屏。
      // 渐变末端留一段近白：乘上 scaleX 之后它始终贴在条的右端，像一颗光点在前面拉着走，不用第二个元素。
      + '@keyframes hxLoadBar{0%{transform:scaleX(0)}12%{transform:scaleX(.34)}45%{transform:scaleX(.62)}100%{transform:scaleX(.88)}}'
      + 'html.hx-loading::before{content:"";position:fixed;top:0;left:0;right:0;height:2.5px;z-index:2147483000;'
      + 'transform:scaleX(0);transform-origin:0 50%;pointer-events:none;'
      + 'background:linear-gradient(90deg,var(--acc2) 0%,var(--acc) 55%,#fff 96%);'
      + 'box-shadow:0 0 10px -2px var(--acc);animation:hxLoadBar 1.7s var(--hx-ease) forwards}'
      // 到位：从 .88 补到 1、停一瞬、再淡出。必须 animation:none 让开上一条的 forwards 帧，
      // 否则 transform 会被动画锁死在 .88。0.88→1 只差 12%，叠在弹簧曲线上看不出来是「跳」的。
      + 'html.hx-done::before{animation:none;transform:scaleX(1);opacity:0;'
      + 'transition:transform .22s var(--hx-spring),opacity .3s var(--hx-ease) .24s}'
      // 希沃一体机：条还在（让学生知道在加载），去掉发光少一层合成
      + 'html.hx-lite.hx-loading::before{box-shadow:none;animation-duration:2.4s}'
      // 关掉动画偏好：不跑，给一条静态半透明示意条
      + '@media (prefers-reduced-motion:reduce){html.hx-loading::before{animation:none;transform:scaleX(.72);opacity:.75}'
      + 'html.hx-done::before{transition:opacity .3s var(--hx-ease)}}';
    var barSt = document.createElement('style');
    barSt.id = 'hx-loadbar';
    barSt.textContent = barCSS;
    (document.head || document.documentElement).appendChild(barSt);

    var de = document.documentElement, barOff = false;
    de.classList.add('hx-loading');
    var barDone = function () {
      if (barOff) return; barOff = true;
      de.classList.add('hx-done');
      setTimeout(function () { de.classList.remove('hx-loading', 'hx-done'); }, 700);
    };
    if (document.readyState === 'complete') barDone();
    else addEventListener('load', barDone);
    // 兜底：某张图卡住时 load 可能好几秒才来，不能让它一直挂在顶上
    setTimeout(barDone, 8000);
  }

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { if (v !== undefined && v !== null) throw e; } return null; }
  function get() {
    var raw = ls(KEY), v = null;
    if (raw && OLD[raw]) v = OLD[raw]; else try { v = JSON.parse(raw); } catch (e) { }
    v = v && typeof v === 'object' ? v : {};
    // 老存档（没有 ver）＝ 上这一版之前就存过外观的。统一换成新默认（小熊），做到「全体人员默认」；
    // 只有自己上传过图的例外——那是明确主动的行为，别覆盖掉。想关掉背景在外观面板点「无」即可。
    if (raw && !v.ver && v.bg !== 'custom') v.bg = DEF.bg;
    // op 允许 0～100（2026-11-03 用户要求「要 0 到 100 可调节」）。
    // ⚠️ 不能写 `+v.op || DEF.op`：0 是 falsy，会把「完全透明」静默变回默认 90。
    var opN = +v.op, bgoN = +v.bgo;
    // bgo = 背景浓度（2026-11-03 用户报「透明度完全不会让背景透明」——原来的 op 滑杆只管卡片透明度，
    // 背景纹丝不动。现在加一根独立的「背景浓度」滑杆：100 = 现状，0 = 背景完全消失只剩底色）
    var s = { acc: ACC[v.acc] ? v.acc : DEF.acc, mode: /^(light|dark|auto)$/.test(v.mode) ? v.mode : DEF.mode, bg: BG[v.bg] ? v.bg : DEF.bg, op: Math.min(100, Math.max(0, isFinite(opN) ? opN : DEF.op)), bgo: Math.min(100, Math.max(0, isFinite(bgoN) ? bgoN : 100)), wx: WX[v.wx] ? v.wx : DEF.wx };
    if (s.bg === 'custom' && !ls(IMG)) s.bg = 'none';
    if (BG[s.bg].dev && !isDev()) s.bg = 'none'; // 开发者专属背景：别的账号（或没登录）回落到无背景
    return s;
  }
  function isDev() { return ls(DEV) === '1'; } // 总入口查到 hx_me().dev 后记下（见 setDev），各工具打开时据此决定能不能用专属背景
  function setDev(on) { if (isDev() === !!on) return; ls(DEV, on ? '1' : null); apply(); }
  function modeOf(s) { return s.mode === 'auto' ? (dark && dark.matches ? 'dark' : 'light') : s.mode; }
  // ── 省电模式（hx-lite）─────────────────────────────────────────────────────
  // 2026-11-02：教室里的希沃一体机点工具会弹「重新加载站点」。查下来是渲染进程崩了：
  // 首页十几张卡 + 刷题一屏五六张卡，每张各自 backdrop-filter: blur(26px)，外加背景图，
  // 一体机的 GPU 撑不住。现在背景图已改成统一糊一次（见 hx-theme.css），这里再把老设备上的
  // 其余实时模糊全关掉兜底。判据故意宽一点：误判的代价只是少一层模糊（视觉几乎没差），
  // 不误判的代价是整页崩掉。也可以手动加 ?lite / ?full 覆盖，调试用。
  function liteOn() {
    var q = location.search;
    if (/[?&]full\b/.test(q)) return false;
    if (/[?&]lite\b/.test(q)) return true;
    try { if (ls('hx-lite') === '1') return true; if (ls('hx-lite') === '0') return false; } catch (e) { }
    var ua = navigator.userAgent || '';
    if (/seewo|hisense|cvte|amlogic|rk3\d{3}|allwinner/i.test(ua)) return true; // 一体机 / 会议大屏 / 国产盒子主板
    var hc = navigator.hardwareConcurrency || 8, dm = navigator.deviceMemory || 8;
    return hc <= 4 || dm <= 4;
  }
  try { document.documentElement.classList.toggle('hx-lite', liteOn()); } catch (e) { }
  // ── 背景图预模糊（2026-11-03）────────────────────────────────────────────
  // 为什么要自己糊：背景的磨砂感原来靠 CSS `filter: blur(8px)`（hx-theme.css body::before）。
  // 用户发现「缩小页面会从模糊变透明」——实测（puppeteer 视口 5120×3200 @dpr 0.25，即浏览器
  // Ctrl+- 到 25%）复现：视口 CSS 尺寸一大，Chromium 直接把这个超大 fixed 图层上的 filter
  // 整个丢掉，原图直出。blur 写多大都没用，这是渲染器的行为，CSS 层面绕不过。
  //
  // 所以改成**把图预先糊好**：两级降采样到长边 480px、canvas 上再 blur(2.5px) 后导出 JPEG，
  // 浏览器 cover 拉伸回全屏时自然就是糊的 —— 零 GPU 成本、任何缩放都稳定，
  // 希沃一体机那种跑不动的设备也少一笔开销（hx-lite 的背景降档分支随之删除）。
  // 2026-11-03 用户报「背景变成马赛克画质」：初版缩到 96px，拉伸 20 倍像素块太明显。
  // 480px 拉到 1080p 是 4.5 倍、4K 是 9 倍，糊图本来就是要糊的，放大痕迹已不可见。
  // 生成失败（离线首屏、图挂了）就回落到 CSS blur 兜底，行为和以前一样。
  var blurCache = {}; // key: 图片 url，value: 480px JPEG dataURL。只存内存（每张几十 KB）
  var blurToken = 0;
  function blurImg(src, cb) {
    if (blurCache[src]) return cb(blurCache[src]);
    var im = new Image();
    im.onload = function () {
      try {
        // 两级降采样：先缩到中间尺寸（一半）再缩到目标，比一步到位少锯齿；
        // blur(2.5px) 是按 480px 尺度给的，等效原图上约 8px 的磨砂感（和旧 CSS blur(8px) 一致）
        var target = 480, k0 = target / Math.max(im.width, im.height);
        var mid = document.createElement('canvas');
        mid.width = Math.max(1, Math.round(im.width * k0 * 2)); mid.height = Math.max(1, Math.round(im.height * k0 * 2));
        var mctx = mid.getContext('2d');
        mctx.drawImage(im, 0, 0, mid.width, mid.height);
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(im.width * k0)); cv.height = Math.max(1, Math.round(im.height * k0));
        var ctx = cv.getContext('2d');
        try { ctx.filter = 'blur(2.5px) saturate(1.28)'; } catch (e) { } // 顶掉原来 CSS 里的 saturate(128%)；不支持就没这层，视觉差一点
        ctx.drawImage(mid, 0, 0, cv.width, cv.height);
        blurCache[src] = cv.toDataURL('image/jpeg', .85);
        cb(blurCache[src]);
      } catch (e) { cb(null); } // 画布被污染等异常：回落 CSS blur
    };
    im.onerror = function () { cb(null); };
    im.src = src;
  }
  function apply() {
    var s = get(), m = modeOf(s), a = ACC[s.acc], r = document.documentElement, b = BG[s.bg];
    var c = m === 'dark' ? a.d : a.l, c2 = m === 'dark' ? a.d2 : a.l2;
    r.setAttribute('data-hx-mode', m); r.setAttribute('data-theme', m); r.setAttribute('data-hx-acc', s.acc);
    r.classList.toggle('hx-bg', s.bg !== 'none');
    var img = s.bg === 'custom' ? 'url("' + ls(IMG) + '")' : b.img ? 'url("' + root + b.img + '")' : b.css || 'none';
    var vars = { '--acc': c, '--acc2': c2, '--acc3': c2, '--acc-h': c2, '--on-acc': s.acc === 'mono' && m === 'dark' ? '#1d1d1f' : '#fff',
      '--accbg': 'color-mix(in srgb, ' + c + ' 14%, transparent)', '--ring': 'color-mix(in srgb, ' + c + ' 40%, transparent)',
      '--hov': 'color-mix(in srgb, ' + c + ' 10%, transparent)', '--hx-a': s.bg === 'none' ? 1 : s.op / 100, '--hx-img': img, '--hx-bgo': s.bgo / 100 };
    for (var k in vars) r.style.setProperty(k, vars[k]);
    // 图片背景：先按原图 + CSS blur 显示（兜底），糊图生成好了换上去并挂 .hx-bgblur 撤掉 filter。
    // 渐变背景（mist/bay/dusk/aurora）本身就是色块，不需要糊，也不挂类。
    r.classList.remove('hx-bgblur');
    if (img.indexOf('url(') === 0) {
      var src = img.slice(5, -2).replace(/"/g, ''); // url("...") → ...（custom 存的是 dataURL，同样适用）
      var my = ++blurToken; // 竞态防护：连续换背景时，迟到的旧回调不许覆盖新设置
      blurImg(src, function (data) {
        if (data && my === blurToken && document.documentElement.classList.contains('hx-bg')) {
          r.classList.add('hx-bgblur');
          r.style.setProperty('--hx-img', 'url("' + data + '")');
        }
      });
    }
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', m === 'dark' ? '#000000' : '#f5f5f7');
    try { ls('zfz-practice-theme', m); ls('wanxiu-paike-theme', m); ls('ui.theme', JSON.stringify(m)); } catch (e) { }
    for (var i = 0; i < subs.length; i++) try { subs[i](s, m); } catch (e) { }
  }
  function set(patch) {
    var s = get(); for (var k in patch) s[k] = patch[k];
    if (patch.bg && patch.op === undefined && BG[patch.bg].op) s.op = BG[patch.bg].op; // 换背景时用推荐透明度
    s.ver = VER; // 记下版本：以后再加默认值就不会把用户已选过的背景顶掉
    ls(KEY, JSON.stringify(s)); apply();
  }
  // 自己上传的图：缩到长边 1920、转 JPEG，免得撑爆浏览器存储（旧站是原图、限 3MB）
  function upload(file) {
    return new Promise(function (ok, no) {
      if (!/^image\//.test(file.type)) return no(new Error('请选一张图片'));
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 1920 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        var q = .82, data = cv.toDataURL('image/jpeg', q);
        while (data.length > 1600000 && q > .4) { q -= .12; data = cv.toDataURL('image/jpeg', q); }
        try { ls(IMG, data); } catch (e) { return no(new Error('图片太大，浏览器存不下，换一张小一点的')); }
        set({ bg: 'custom' }); ok();
      };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('这张图片打不开')); };
      im.src = url;
    });
  }
  function reset() { ls(KEY, null); ls(IMG, null); apply(); }
  addEventListener('storage', function (e) { if (e.key === KEY || e.key === IMG || e.key === DEV || e.key === null) apply(); });
  if (dark) (dark.addEventListener ? dark.addEventListener('change', apply) : dark.addListener(apply));
  // 总入口（同源的上层页面）：子工具要登录时请它弹登录窗口；不在框里就跳回首页
  function portal() { try { return window.top !== window && window.top.HXPortal ? window.top.HXPortal : null; } catch (e) { return null; } }
  window.HXTheme = { acc: ACC, bg: BG, wx: WX, root: root, get: get, mode: function () { return modeOf(get()); }, set: set, upload: upload, reset: reset, isDev: isDev, setDev: setDev, onChange: function (fn) { subs.push(fn); },
    portal: portal, login: function () { var p = portal(); if (p) p.login(); else location.href = root + (tool ? '#' + tool : ''); } };
  // ---------- 导航栏交互动效：滑块跟着当前项走（不用每项自己高亮） ----------
  // 用法：HXNav.slide(容器) —— 容器里放 [data-v] 或 [aria-current] 的按钮，当前项加 aria-current="true"。
  // 滑块自己量位置，所以文字长短不同也对得准；换项时用弹簧曲线滑过去，不是闪一下。
  // 首帧不滑（直接落位），避免打开页面看到滑块从左上角飞过来。
  (function () {
    function slide(box, opts) {
      if (!box) return null;
      opts = opts || {};
      var cur = null, ready = false;
      box.setAttribute('data-hx-slide', '');
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      function make() {
        cur = box.querySelector(':scope > .hx-nav-cur');
        if (cur) return cur;
        cur = document.createElement('i');
        cur.className = 'hx-nav-cur';
        cur.setAttribute('aria-hidden', 'true');
        box.insertBefore(cur, box.firstChild);
        return cur;
      }
      function place(anim) {
        var b = box.querySelector('[aria-current="true"]');
        if (!b) { make().style.opacity = 0; return; }
        make();
        var br = b.getBoundingClientRect(), pr = box.getBoundingClientRect();
        if (!br.width) return; // 隐藏时不能量
        cur.style.opacity = 1;
        cur.style.width = br.width + 'px';
        cur.style.height = br.height + 'px';
        cur.style.transform = 'translate(' + (br.left - pr.left - box.clientLeft) + 'px,' + (br.top - pr.top - box.clientTop) + 'px)';
        if (!anim) { cur.style.transition = 'none'; void cur.offsetWidth; cur.style.transition = ''; }
      }
      place(false);
      ready = true;
      var t = null;
      function later() { clearTimeout(t); t = setTimeout(function () { place(false); }, 220); } // 字体/字体图标晚到时再对一次位
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(false); });
      addEventListener('resize', function () { place(false); });
      // 观察当前项变化（各工具用 aria-current 标当前项，改属性就会触发）
      new MutationObserver(function () { place(ready); }).observe(box, { subtree: true, attributes: true, attributeFilter: ['aria-current', 'data-v'], childList: true });
      later();
      return { refresh: function () { place(false); } };
    }
    window.HXNav = { slide: slide };
  })();
  // ---------- 按钮按下的像素碎屑：自动给全站按钮挂 .hx-crumb ----------
  // 样式在 hx-theme.css 的 hxCrumbs。这里只负责找元素挂类，不写任何帧循环。
  // 为什么放这里而不是每个工具各自写：hx-theme.js 全站都引了，一处改完全站生效（首页、刷题、单片、排课、考试、加分都算）。
  // 用 MutationObserver 盯着后续动态生成的按钮（排课表格、刷题题卡这类是 JS 现插的），插进来就挂上。
  (function () {
    if (window.HXCrumbs) return;
    // 这些不挂：只读的小标签、已经很花的图标按钮、以及自己就有按下动效的大按钮（.rk-go 那类会冲突）
    var SKIP = '.hx-crumb, .hx-crumb-in, [data-hx-nocrumb], .x, .close-x, .rk-go, .no-crumb';
    function ok(el) {
      if (!el || el.nodeType !== 1) return false;
      if (!el.matches('button, .tile, .btn, [role="button"], input[type="button"], input[type="submit"]')) return false;
      if (el.closest(SKIP)) return false;
      if (el.disabled) return false;
      // 太大的不挂：首页工具卡（>150px）上端已经配了像素小生物，再炸一圈碎屑会打架，
      // 而且卡片宽到 300px 时，碎屑得飞出屏幕才有“迸出来”的感觉。
      // 量不到尺寸（元素还没显示、在隐藏面板里）就先不判尺寸，照挂——量不出来不等于它小。
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return true;
      return !(r.width > 150 || r.height > 150 || r.width < 24);
    }
    // 2026-11-02 修坑：挂类前先看真实计算样式，别拿 CSS 硬改按钮原有写法。
    // ① 已经自己定位（absolute / fixed / sticky）的按钮：不动它，直接跳过。
    //    碎屑层要靠 relative 托住，但把 absolute 按钮改成 relative 会让它掉回文档流、整块布局塌掉。
    // ② 自己带 overflow:hidden 的按钮：碎屑会被裁成一圈贴边的点。不改它的 overflow（改了里面
    //    圆角裁剪的图会溢出来），改用「内爆版」.hx-crumb-in，碎屑贴着按钮内边炸。
    // getComputedStyle 每个元素算一次，只在挂类那一下做，不进帧循环。
    function mark(el) {
      if (!ok(el)) return;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return; }
      var pos = cs.position;
      if (pos !== 'static' && pos !== 'relative') return; // absolute / fixed / sticky：别碰
      var clip = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
      el.classList.add(clip ? 'hx-crumb-in' : 'hx-crumb');
    }
    function sweep(root) {
      var list = (root || document).querySelectorAll('button, .tile, .btn, [role="button"], input[type="button"], input[type="submit"]');
      for (var i = 0; i < list.length; i++) mark(list[i]);
    }
    function boot() {
      sweep(document);
      // 后续插入的按钮：只处理新增子树里的，不整页重扫（首页十几张卡，重扫没必要）
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var added = ms[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j]; if (n.nodeType !== 1) continue;
            mark(n); sweep(n);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    window.HXCrumbs = { sweep: sweep };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
  })();
  apply();
})();
