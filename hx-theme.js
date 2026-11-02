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
  var KEY = 'hx-theme', IMG = 'hx-theme-img', DEV = 'hx-dev', VER = 2, DEF = { acc: 'green', mode: 'auto', bg: 'bear', op: 90 };
  // VER：外观配置版本。加了全局默认背景后，老存档里没有 ver 字段 = 还没主动挑过背景，
  // 补成新默认（小熊）；自己上传过图的（custom）与显式选过「无」的不覆盖。
  var OLD = { day: { acc: 'blue', mode: 'light' }, sea: { acc: 'green', mode: 'light' }, sakura: { acc: 'pink', mode: 'light' }, night: { acc: 'purple', mode: 'dark' }, forest: { acc: 'green', mode: 'dark' }, mist: { acc: 'mono', mode: 'dark' } };
  var me = document.currentScript, root = me ? new URL('.', me.src).href : location.origin + '/';
  var tool = me && me.getAttribute('data-tool'), subs = [], dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  // 在网站上被单独打开的子工具：回到总入口（登录、账号、外观都在那里）。离线单文件不跳；地址加 ?solo 也不跳（调试用）。
  if (tool && window.top === window && /^https?:$/.test(location.protocol) && !/[?&]solo\b/.test(location.search)) { location.replace(root + '#' + tool); return; }

  // 嵌在总入口里的子工具：选了背景图时页面底色透明，透出首页的背景图（以前单片机、考试、排课、加分是整页纯色铺满）
  if (tool && window.top !== window) { var st = document.createElement('style'); st.textContent = 'html.hx-bg,html.hx-bg body{background-color:transparent!important}'; (document.head || document.documentElement).appendChild(st); }

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { if (v !== undefined && v !== null) throw e; } return null; }
  function get() {
    var raw = ls(KEY), v = null;
    if (raw && OLD[raw]) v = OLD[raw]; else try { v = JSON.parse(raw); } catch (e) { }
    v = v && typeof v === 'object' ? v : {};
    // 老存档（没有 ver）＝ 上这一版之前就存过外观的。统一换成新默认（小熊），做到「全体人员默认」；
    // 只有自己上传过图的例外——那是明确主动的行为，别覆盖掉。想关掉背景在外观面板点「无」即可。
    if (raw && !v.ver && v.bg !== 'custom') v.bg = DEF.bg;
    var s = { acc: ACC[v.acc] ? v.acc : DEF.acc, mode: /^(light|dark|auto)$/.test(v.mode) ? v.mode : DEF.mode, bg: BG[v.bg] ? v.bg : DEF.bg, op: Math.min(100, Math.max(15, +v.op || DEF.op)) };
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
  function apply() {
    var s = get(), m = modeOf(s), a = ACC[s.acc], r = document.documentElement, b = BG[s.bg];
    var c = m === 'dark' ? a.d : a.l, c2 = m === 'dark' ? a.d2 : a.l2;
    r.setAttribute('data-hx-mode', m); r.setAttribute('data-theme', m); r.setAttribute('data-hx-acc', s.acc);
    r.classList.toggle('hx-bg', s.bg !== 'none');
    var img = s.bg === 'custom' ? 'url("' + ls(IMG) + '")' : b.img ? 'url("' + root + b.img + '")' : b.css || 'none';
    var vars = { '--acc': c, '--acc2': c2, '--acc3': c2, '--acc-h': c2, '--on-acc': s.acc === 'mono' && m === 'dark' ? '#1d1d1f' : '#fff',
      '--accbg': 'color-mix(in srgb, ' + c + ' 14%, transparent)', '--ring': 'color-mix(in srgb, ' + c + ' 40%, transparent)',
      '--hov': 'color-mix(in srgb, ' + c + ' 10%, transparent)', '--hx-a': s.bg === 'none' ? 1 : s.op / 100, '--hx-img': img };
    for (var k in vars) r.style.setProperty(k, vars[k]);
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
  window.HXTheme = { acc: ACC, bg: BG, root: root, get: get, mode: function () { return modeOf(get()); }, set: set, upload: upload, reset: reset, isDev: isDev, setDev: setDev, onChange: function (fn) { subs.push(fn); },
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
  apply();
})();
