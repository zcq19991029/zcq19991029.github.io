// 华夏工具外观（网站根目录 /hx-theme.js + /hx-theme.css）。全部工具在 <head> 里同步引用，打开就是选好的外观、不闪。
// ── 分层（2026-11-05 定稿）──
//   · 全局层（键 hx-theme）：背景图/视频、背景动效、校徽水印 —— 全站通用，只在总入口右上角改；
//   · 界面层（键 hx-theme:s:home / hx-theme:s:<tool>）：主题色、深色/浅色/自动、卡片通透度、背景清晰度
//     —— 每个页面（首页和每个工具）各自一份、互不干扰；总入口外观面板改的是它自己（home）那份。
// 外观只在总入口右上角改：主题色（沿用旧刷题站的 7 套）、深色 / 浅色 / 自动、背景图、通透度两根滑杆。
// 自己上传的背景图压缩后存 hx-theme-img；同一网站的页面（包括嵌在总入口里的工具）通过 storage 事件一起变。
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
  // 推荐背景：旧站的猫耳学习图（dev：开发者专属，只有开发者账号看得到、用得上）+ 几张渐变（不占流量）。
  // （op 字段是旧版「选背景时顺手改卡片透明度」的推荐值，VER 5 起不再使用：通透度归界面层管，换背景不动它。）
  var BG = {
    none: { name: '无' },
    // 2026-11-04 深夜用户定：背景只留三档 —— 无 / 极光动态（新的全站默认）/ 自己上传。
    // 原来的小熊、吉伊卡哇、猫耳、晨雾、海湾、暮光、极光渐变**全部下架**（原话「其他的背景删除」）。
    //
    // 极光是**视频**壁纸（用户给的哲风壁纸 4K 绿色极光，雪山星空）：
    //   · 站上只拿得到 960×540 的预览版（4K 原片要登录），所以用它；
    //   · 用「正放 + 倒放」拼成 10s 无缝循环（620KB），首尾帧完全相同，看不出接缝；
    //   · `bg/aurora.jpg` 是海报帧，视频解码好之前先把这一帧铺上，避免黑屏闪一下；
    //   · 省电模式（hx-lite）和系统「减少动态效果」只显示海报帧，不播视频（一体机省 GPU）。
    // mirror：这条片子是「正放 5 秒 + 倒放 5 秒」拼的（ffprobe 抽帧验证过：第 f 帧与第 299-f 帧
    // 几乎完全相同，平均差 1.30，而相邻帧平均差 3.10）。倒放那半段就是用户说的「播放完再倒放一遍」，
    // 所以播放层只取前一半（0～5s）当循环周期，靠交叉淡入接回开头 —— 见 bgTick()。
    aurora: { name: '极光 · 动态', video: 'bg/aurora.mp4', poster: 'bg/aurora.jpg', op: 100, mirror: 1 },
    custom: { name: '自己的图', op: 70 }
  };
  // VER 4（2026-11-04 深夜）：背景项合并成上面三档，默认改成极光视频。
  // 老存档里凡是选了已下架背景（bear/chiikawa/cat/mist/bay/dusk/旧极光渐变）的，统一迁到新默认；
  // 自己上传过图的（custom 且本地还有图）保留不动 —— 那是用户自己的东西，不能因为改默认就没了。
  // VER 5（2026-11-05）：主题体系分层。全局键 hx-theme 只管「背景 / 动效 / 校徽水印」（全站通用，总入口统一换）；
  // 主题色、深浅模式、卡片通透度、背景清晰度改成**按界面分键**（hx-theme:s:home = 总入口首页，
  // hx-theme:s:<tool> = 各工具页），互不干扰：首页改浅色不会带着工具一起变。
  // 滑杆语义 2026-11-05 翻转：原来的 op「卡片透明度」100 = 最实；现在叫 clr「卡片通透度」，100 = 最透
  // （也就是用户定下的默认观感：深色玻璃底、背景透出来），往下调卡片变实、文字更清楚。
  // 老存档里的 op 不再折算：旧 100 = 新 100（同一观感），旧值更小的本意是「更透」——新体系 100 已经是最透，
  // 一律落回默认 100，保证老用户刷新后看到的就是这版定稿的玻璃观感。
  var KEY = 'hx-theme', SKEY = 'hx-theme:s:', IMG = 'hx-theme-img', DEV = 'hx-dev', VER = 5,
    // 2026-11-05 用户定：默认进来 = 深色主题 + 两个滑杆都 100%（通透度 100 = 深色清透玻璃，背景最透出）。
    // 之前默认 mode:'auto'，Mac 浅色系统打开就是浅色 + 旧白玻璃配方，用户原话「玻璃质感不高级 仅仅只是白色雾蒙蒙」。
    DEF = { acc: 'green', mode: 'dark', bg: 'aurora', clr: 100, bgo: 100, wx: 'none' };
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
  // hx-embedded：告诉工具「你被嵌在框里了」。自带校徽水印的工具（目前只有排课 .wm）见到它就收起自己那一份，
  // 由总入口统一画一层，免得同一个校徽画两遍还错位。
  if (tool && window.top !== window) {
    document.documentElement.classList.add('hx-embedded');
    var st = document.createElement('style');
    st.textContent = 'html.hx-bg,html.hx-bg body{background-color:transparent!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // 动态背景（视频壁纸）那一层：样式必须全局注入 —— 全站只有总入口和刷题引了 hx-theme.css，
  // 其余工具只引这个 JS，写进 CSS 文件等于对它们无效。
  // z-index:-2 排在 body::before（-1，负责深色模式压暗）下面，也排在 .hx-wm（0）和所有内容下面。
  // opacity 跟 --hx-bgo 走，所以外观面板那根「背景透明度」对视频一样有效。
  (function () {
    var vs = document.createElement('style');
    vs.id = 'hx-bgvid-style';
    // 2026-11-04 深夜（bug：手机打开首页变成全屏视频播放器）：
    //  · pointer-events:none —— 之前只写了 z-index，没写这条。手机上手指点/长按/滑过视频元素，
    //    Safari 与部分国产内核会把它当成「用户点了媒体」，弹出原生播放器控件、甚至整页接管播放。
    //    背景壁纸必须是**画**：点不到、选不中、拖不动。
    //  · z-index:-2 —— 一直写在注释里，样式串里其实也有；这里保留并叠在 body::before(-1) 之下。
    //  · touch-action:none / user-select:none —— 双保险，禁止滑动/长按选中触发媒体手势。
    //  · -webkit-user-drag:none —— 桌面端也顺手禁止拖拽成独立窗口。
    //  · opacity 拆成两层：外层 .hx-bgvid-wrap 吃 --hx-bgo（背景浓度滑杆），
    //    内层两路只吃 --hx-fade（交叉淡入）。为什么不把 bgo 乘进每一路：
    //    两路同时半透明时叠加的合成 alpha = o1+o2-o1·o2，比单路更大，整块背景会在淡入中点亮一下。
    //    把 bgo 提到外层之后，内层永远只有一路"满不透明 + 一路淡出"，合成结果严格等于 bgo。
    vs.textContent = '.hx-bgvid-wrap{position:fixed;inset:0;z-index:-2;pointer-events:none;'
      + 'opacity:var(--hx-bgo,1);background:transparent}'
      + '.hx-bgvid{position:absolute;inset:0;width:100%;height:100%;'
      + 'object-fit:cover;object-position:center;background:transparent;pointer-events:none;'
      + 'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;'
      + 'opacity:var(--hx-fade,1);'
      + 'transition:opacity .7s var(--hx-ease,ease);will-change:opacity}'
      // 屏宽 ≤820px 时一律不挂视频（JS 侧已提前拦掉，这条防「旧缓存 JS + 新 CSS」这种混搭）
      + '@media (max-width:820px){.hx-bgvid-wrap{display:none!important}}';
    (document.head || document.documentElement).appendChild(vs);
  })();

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

  // ── 像素方块「正在载入」药丸（2026-11-04）──
  // 用户原话：「这种旧版本加载动画全部换成像素动效的加载等待效果　旧版还有更旧的没改　
  //   可以融合　把后者加在这像素动效版本的下面　替换干枯乏味的加载文字」。
  // 指的就是排课「正在载入…」、小组加分 logo+三个点、考试「正在载入…」这些各写各的旧样式。
  //
  // 方块那套动画原本只长在总入口的 #boot 和 .loadtip 里（写在 index.html 的内联样式里），
  // 子工具根本引不到。这里把它连同样的 keyframes 一起搬进 hx-theme.js —— 全站唯一每个页面都引的脚本，
  // 搬过来才谈得上「全部换成」。
  //
  // 用法（子工具里）：
  //   var tip = HXTheme.loadPill(document.getElementById('main'), '正在载入…');
  //   tip.text('正在读成绩…');  tip.done();
  // 第二个参数是 host：给了就画在它里面居中（host 太矮时自动留 40px 上下空），
  // 不给就铺满整页当全屏等待层。两个都返回同一个句柄，text() 换字、done() 淡出移除。
  var pillSt = document.createElement('style');
  pillSt.id = 'hx-pill-style';
  pillSt.textContent =
    // 方块尺寸用 em 跟着字号走：全屏那版字号大、药丸里那版字号小，一套规则两个尺寸
    '.hx-px{display:inline-flex;align-items:flex-end;gap:.28em;height:2.2em}'
    + '.hx-px i{width:1em;height:1em;border-radius:.16em;display:block;'
    + 'background:linear-gradient(180deg,var(--acc,#2f845a),var(--acc2,#5aa77c));'
    + 'box-shadow:0 .5em 1.2em -.6em var(--acc,#2f845a);'
    + 'animation:hxPx 1.15s var(--hx-ease,cubic-bezier(.32,.72,0,1)) infinite;animation-delay:calc(var(--i) * 90ms)}'
    + '.hx-px i:nth-child(2n){background:linear-gradient(180deg,var(--acc2,#5aa77c),var(--acc3,#5aa77c))}'
    // 起始透明度 .55：太淡在浅灰底上会糊成一片（总入口那边踩过），位移用百分比，大小方块通用
    + '@keyframes hxPx{0%,100%{transform:translateY(0);opacity:.55}35%{transform:translateY(-110%);opacity:1}60%{transform:translateY(0);opacity:.7}}'
    // 药丸本体
    // 字号自适应（2026-11-04 用户：「像素动效和文字匹配总体看起来太小 网页太大 应该需要自适应网页大小和手机端大小」）：
    // 原来写死 15px + 方块 8px，1080p 一体机上投出来只有指甲盖大。改成跟视口宽度走：
    //   · 手机 375 → 15px（下限，再小看不清）
    //   · 笔记本 1280 → 16.9px
    //   · 一体机 1920 → 22.3px
    //   · 4K 屏开了 100% 缩放（CSS 宽 3840）→ 封顶 30px，不会退化成一条细线
    // 方块和文字都用 em 挂在药丸字号上，所以一处改动整条药丸等比放大，不会出现「字大了方块没大」。
    + '.hx-loadpill{display:inline-flex;align-items:center;gap:.7em;padding:.75em 1.15em;border-radius:99px;'
    + 'background:var(--card-solid,rgba(255,255,255,.86));color:var(--ink,#1d1d1f);'
    + 'font-size:clamp(15px,.85vw + 6px,30px);line-height:1;'
    + 'border:1px solid var(--edge,rgba(0,0,0,.07));box-shadow:0 18px 40px -18px rgba(0,0,0,.35);'
    + 'animation:hxPillIn .28s var(--hx-ease,cubic-bezier(.32,.72,0,1)) both}'
    // 方块 = 药丸字号的 54%（原来是写死的 8px / 15px ≈ .53，比例不变，但从此跟着字号一起长）
    + '.hx-loadpill .hx-px{font-size:.54em}'
    + '.hx-loadpill b{font-weight:600;white-space:nowrap}'
    + '@keyframes hxPillIn{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}'
    // 铺在 host 里那版：居中，且至少给一段上下空，避免卡片很矮时药丸贴边（留白也跟视口走，大屏不再贴边）
    + '.hx-loadwrap{display:grid;place-items:center;padding:clamp(28px,4vw,56px) 12px;box-sizing:border-box}'
    // 铺满整页那版
    + '.hx-loadwrap.full{position:fixed;inset:0;z-index:2147482000;background:transparent}'
    + '.hx-loadpill.out{opacity:0;transform:translateY(-4px);transition:opacity .25s var(--hx-ease,ease),transform .25s}'
    // 一体机 / 省电 / 关掉动画：方块不跳，给药丸一点静态存在感
    + 'html.hx-lite .hx-px i{animation:none;opacity:.85}'
    + '@media (prefers-reduced-motion:reduce){.hx-px i{animation:none;opacity:.85;transform:none}.hx-loadpill{animation:none}}';
  (document.head || document.documentElement).appendChild(pillSt);

  var PILL_N = 7;
  // 2026-11-06 用户：「这个加载重叠了 请清理多余的 很多工具都要查」。
  // 全站同一个时刻只允许存在**一条**「正在载入」药丸。原来没有任何互斥：闪屏里的像素动效、
  // 闪屏标题、闪屏里的方块＋文案、登录门的 gatepill、页面级的药丸，各写各的，弱网下就叠成一坨。
  // 现在 loadPill 一进来先把还在的旧药丸 fade 掉（旧句柄的 done() 之后变成空操作，不会误删新的）。
  var LIVE_PILLS = [];
  function killPills(except) {
    for (var i = LIVE_PILLS.length - 1; i >= 0; i--) {
      var p = LIVE_PILLS[i];
      if (p === except) continue;
      try { p._kill(); } catch (e) { }
      LIVE_PILLS.splice(i, 1);
    }
  }  function loadPill(host, text) {
    if (typeof host === 'string' && text === undefined) { text = host; host = null; }
    killPills(null);                       // 互斥：新的上来，旧的必须先退场
    var wrap = document.createElement('div');
    wrap.className = 'hx-loadwrap' + (host ? '' : ' full');
    var pill = document.createElement('div');
    pill.className = 'hx-loadpill';
    pill.setAttribute('role', 'status');
    var px = '<span class="hx-px" aria-hidden="true">', i;
    for (i = 0; i < PILL_N; i++) px += '<i style="--i:' + i + '"></i>';
    pill.innerHTML = px + '</span><b></b>';
    var b = pill.querySelector('b');
    b.textContent = text || '正在载入…';
    wrap.appendChild(pill);
    var done = false;
    var api = {
      el: wrap,
      text: function (t) { b.textContent = t; return api; },
      // done() 可以重复调：先淡出再摘掉，反正外层可能整块被清空
      done: function () {
        if (done) return; done = true;
        pill.classList.add('out');
        setTimeout(function () { wrap.remove(); }, 260);
        var k = LIVE_PILLS.indexOf(api); if (k >= 0) LIVE_PILLS.splice(k, 1);
      },
      // 互斥淘汰用：不排队、**立刻摘掉**（不留淡出），旧句柄再调 done()/text() 都不会碰到新药丸。
      //
      // 为什么不沿用 done() 那套 260ms 淡出：实测连开三个药丸时，DOM 里会同时挂着 2～3 个
      // （`n1=1, n2=2, n3=3`）—— 淡出期间旧的还在画面上，正好就是用户抱怨的「加载重叠」。
      // 换药丸=换一句话，不该两个同时渐变；直接 remove，屏幕上永远只有一条。
      _kill: function () {
        if (done) return; done = true;
        wrap.remove();
      }
    };
    LIVE_PILLS.push(api);
    (host || document.body).appendChild(wrap);
    return api;
  }

  // ── 华夏校徽水印（2026-11-04）──
  // 用户原话「排课的背景有个华夏校徽　这个效果帮我加到全部 ui 卡片背景界面上」。
  // 做法和排课一模一样：一张铺满视口的固定层，垫在内容下面（z-index:0）。
  // 卡片本身是半透明的，校徽就从卡片里透出来 —— 不是给每张卡贴图，滚动时也不会跟着跑。
  //
  // 为什么样式写在 JS 里而不是 hx-theme.css：全站只有总入口和刷题引了那份 CSS，
  // 接线仿真、排课、单片机、考试、小组加分、课程进度、进制转换都只引 hx-theme.js
  // （和上面的加载进度条同一个原因，放 CSS 里等于只覆盖 2/8 个页面）。
  //
  // 只在**顶层页面**挂：嵌在总入口框里的工具不画自己那一份，由总入口这一层统一透上去。
  // 否则同一个校徽会被画两遍，还会因为 iframe 的中心偏了 52px 顶栏而错开成两个。
  // （排课自带 .wm，被嵌时由 html.hx-embedded 关掉，见排课 app.css）
  (function () {
    if (window.top !== window) return;
    var wmSt = document.createElement('style');
    wmSt.id = 'hx-wm-style';
    wmSt.textContent =
      // z-index 用 0、不能用 -1：-1 会掉到 body 底色后面，整张被盖住（子工具页面各自带 body 底色）。
      // 0 是「定位元素、没抬层级」的位置，按 DOM 顺序和 main / 卡片这些同层元素排队 ——
      // 所以下面把它插成 body 的第一个孩子：排在 main（iframe 就住在里面）和各张卡片前面，
      // 于是压在它们下面，卡片半透明时从卡片里透出来。这和排课 .wm 的处境完全一样
      // （排课 .wm 也是 body 第一个孩子），两边观感才对得上。
      // 水印图是 RGBA、四周透明，pointer-events:none 也不挡点击。
      // 密度就照排课原样：单层、不叠不混合。2026-11-04 用户看过之后明确
      // 「不需要能看清　就这样挺好的」—— 校徽是氛围，不是要人读的图案，
      // 别为了「看得见」加层数或 blend，压过卡片上的字就本末倒置了。
      '.hx-wm{position:fixed;inset:0;z-index:0;pointer-events:none;margin:4vmin;'
      + 'background:url("' + root + 'hx-seal.png") center/contain no-repeat;opacity:1}'
      // 深色底上淡粉会发白刺眼，压到 35%（和排课的深色处理一致）
      + ':root[data-hx-mode="dark"] .hx-wm{opacity:.35}'
      // 外观面板里可以关掉（hx-theme 的 wm:0）
      + 'html.hx-wm-off .hx-wm{display:none}'
      // 工具要了全屏（总入口给 main 挂 z-index:50）时，校徽得跟着抬到 49：
      // 还是垫在工具下面（iframe 透明，透得上来），不至于一进全屏就整层没了。
      + 'body.hxfull .hx-wm{z-index:49}'
      // 打印时不印校徽
      + '@media print{.hx-wm{display:none}}';
    (document.head || document.documentElement).appendChild(wmSt);
    function mountWm() {
      if (document.querySelector('.hx-wm')) return;
      var d = document.createElement('div'), body = document.body || document.documentElement;
      d.className = 'hx-wm';
      d.setAttribute('aria-hidden', 'true');
      body.insertBefore(d, body.firstChild);   // 必须是第一个孩子，见上面 z-index 那段
      // 告诉页面「这一层已经有人画了」：自带校徽的工具（排课 .wm）见到就收起来。
      // 和 hx-embedded 是两条路 —— hx-embedded 管「嵌在总入口框里」，这条管「自己就是顶层页」，
      // 合起来才是「任何情况下同一个校徽只画一遍」。
      document.documentElement.classList.add('hx-has-wm');
    }
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mountWm); else mountWm();
  })();

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { if (v !== undefined && v !== null) throw e; } return null; }
  function jparse(raw) { try { var v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function clamp01(n, d) { return Math.min(100, Math.max(0, isFinite(n) ? n : d)); }
  // 当前界面的名字：总入口（没有 data-tool）= home，各工具 = data-tool 的值。
  // 界面层设置（主题色 / 深浅 / 卡片通透度 / 背景清晰度）都存自己的键，互不干扰。
  var SURF = tool || 'home';
  function get() {
    // ── 全局层（hx-theme）：背景 / 动效 / 水印，全站一份，总入口统一管 ──
    var raw = ls(KEY), v = raw && OLD[raw] ? OLD[raw] : jparse(raw);
    v = v || {};
    // 老存档（没有 ver）＝ 上这一版之前就存过外观的。统一换成新默认（极光），做到「全体人员默认」；
    // 只有自己上传过图的例外——那是明确主动的行为，别覆盖掉。想关掉背景在外观面板点「无」即可。
    if (raw && !v.ver && v.bg !== 'custom') v.bg = DEF.bg;
    // VER 4 迁移（2026-11-04 深夜）：背景项只剩 无/极光动态/自己的图。
    if (!BG[v.bg]) v.bg = DEF.bg;
    // ── 界面层（hx-theme:s:<界面>）：主题色 / 深浅 / 卡片通透度 / 背景清晰度 ──
    // 键存在即权威：缺了的字段回到 DEF，不再翻老存档（从改第一项起这个界面就走自己的设置）。
    // 键不存在（从没在这个界面上改过外观）→ 沿用全局老存档里的 acc / mode / bgo（老用户观感不变），
    //   都没有就落 DEF。老 op 滑杆不再折算，见 VER 5 注释。
    var sv = jparse(ls(SKEY + SURF)), own = !!sv;
    if (!own) sv = {};
    var s = {
      bg: BG[v.bg] ? v.bg : DEF.bg,
      wx: WX[v.wx] ? v.wx : DEF.wx,
      // 校徽水印：默认开。只认显式关掉的 0 / false / '0'——老存档里根本没有这个字段，不能把 undefined 当关。
      wm: (v.wm === 0 || v.wm === '0' || v.wm === false) ? 0 : 1,
      acc: own ? (ACC[sv.acc] ? sv.acc : DEF.acc) : (ACC[v.acc] ? v.acc : DEF.acc),
      mode: own ? (/^(light|dark|auto)$/.test(sv.mode) ? sv.mode : DEF.mode) : (/^(light|dark|auto)$/.test(v.mode) ? v.mode : DEF.mode),
      // 卡片通透度（2026-11-05 翻转语义）：100 = 最透（清透玻璃、背景透出来，默认），0 = 最实。
      clr: own ? clamp01(+sv.clr, DEF.clr) : DEF.clr,
      // 背景清晰度：100 = 原样显示（最清楚），0 = 背景几乎看不见、只剩页面底色。
      bgo: own ? clamp01(+sv.bgo, 100) : clamp01(+v.bgo, 100)
    };
    if (s.bg === 'custom' && !ls(IMG)) s.bg = DEF.bg;
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
    // ── 2026-11-04 改：判定收紧，别再误伤机房电脑 ──
    // 用户报「我机房的浏览器打开画面不会动像素特效」。查下来是这里把 4 核机也算成省电模式：
    // 机房那批机器 hardwareConcurrency 正好 4，命中 hc <= 4 → hx-lite → hx-critters.js 的 still()
    // 只画第一帧、永远不动，看起来就像「特效坏了」。而这批机器其实跑得动（真正的开销是当年的
    // 每卡 backdrop-filter blur(26px)，2026-11-02 已经改成全局只糊一次了，现在没有任何实时模糊）。
    // 所以：只有明确的一体机 / 国产盒子主板才进省电模式；核心数只认 ≤2（真的老掉牙那种），
    // deviceMemory 只认 ≤2。4 核 / 4G 的机房机正常跑动效。
    if (/seewo|hisense|cvte|amlogic|rk3\d{3}|allwinner/i.test(ua)) return true; // 一体机 / 会议大屏 / 国产盒子主板
    var hc = navigator.hardwareConcurrency || 8, dm = navigator.deviceMemory || 8;
    return hc <= 2 || dm <= 2;
  }
  try { document.documentElement.classList.toggle('hx-lite', liteOn()); } catch (e) { }
  // ── 背景图：原图直出，不再预模糊（2026-11-04 用户要求）──────────────────
  // 历史：2026-11-02 为了性能把「每张卡各自 backdrop-filter」改成「背景层统一糊一次」；
  // 2026-11-03 又发现视口一大（Ctrl+- 缩小页面）Chromium 会把超大 fixed 图层上的 filter 整个丢掉，
  // 于是改成把图先缩到 480px、canvas 上再 blur(2.5px) 导出 JPEG，彻底不依赖 filter。
  //
  // 2026-11-04 用户：「背景始终模糊啊 … 你给我换成调节背景透明度的」。**磨砂不是需求，是上一个
  // 修法的副作用**：480px 的图拉到 1080p 是 4.5 倍，怎么都糊。现在改为原图直出：
  //   · 上传的图在 upload() 里已经缩到长边 ≤1920 并压成 JPEG（.82 起步），体积可控；
  //   · 预设背景本身就是 1080p 级 JPEG，直接用；
  //   · 不再有任何 blur，`--hx-img` 指向真图，缩小/放大都不会出现「糊→清」的跳变。
  // 想要背景淡一点，用外观面板的「背景透明度」（--hx-bgo），那才是用户要的那根滑杆。
  // ── 动态背景（视频壁纸，2026-11-04 深夜）──────────────────────────────
  // 用户：「所有账号背景默认改为这个动态背景」。三条硬规矩：
  //   ① 省电模式（hx-lite）或系统「减少动态效果」→ 只留海报帧，不播视频（一体机省 GPU）；
  //   ② 切到后台标签页 → 暂停；回到前台 → 续播（教室里同时开十几个标签页很常见）；
  //   ③ 打开工具（body.tool，背景被 iframe 完全盖住）→ 暂停，由 index.html 的 show() 调 bgPause 控制。
  // 元素插成 body 第一个孩子、z-index:-2：永远在内容、水印、深色 scrim 的下面。
  //
  // ── 2026-11-04 深夜重写（两个用户报障）──────────────────────────────────
  // 【报障 A：手机上打开首页直接变成全屏视频播放器，退不掉】
  //   根因不是 controls（本来就没设），是**背景层太"真"**：
  //     ① #hx-bgvid 没有 pointer-events:none（样式串里只有 z-index），手机上手指点在/长按在
  //        这块铺满视口的 video 上，Safari 与部分国产内核当成"用户点了媒体"，弹原生控件、进而接管整页；
  //     ② 没有 disablepictureinpicture / controlslist / x5-* 属性，微信、QQ 浏览器的 X5 内核会自作主张
  //        把 <video> 提升成原生播放器（顶部标题栏 + 中间 16:9 + 底部进度条，正是用户截图那个样子）。
  //   修法两条并行：
  //     · 样式补 pointer-events:none / z-index:-2 / touch-action:none / user-select:none；
  //       元素补齐 controls=false、disablePictureInPicture、controlslist、x5-video-player-type=h5-page 等；
  //     · **移动端根本不建 <video>**（见 bgNoVideo()）—— 没有元素就没有控件可接管，这是治本的那条。
  //       手机只剩海报帧 bg/aurora.jpg（31KB）铺满，视觉几乎一样，还省掉 634KB 的 h264 和一路解码。
  // 【报障 B：「播放完 再倒放一遍 不丝滑 没有无缝衔接」】
  //   ffprobe/ffmpeg 逐帧验证过：aurora.mp4 是「正放 150 帧 + 倒放 150 帧」拼的
  //   （第 f 帧与第 299-f 帧的平均灰度差 1.30，相邻帧却是 3.10；f149 与 f150 差 0.11 = 同一帧），
  //   所以那半段倒放是**素材里就有的**，用户看到的就是这个"来回摆"。
  //   播放层不再整段放 10 秒：只取前一半（0～5s，即 mirror 标志 → loopEnd = duration/2），
  //   到 4.2s 开始双 video 交叉淡入，接回**开头**，于是永远朝同一个方向流动。
  //   顺带解决原生 loop 的接缝（同一帧被重复/跳过，会看到一顿）：淡入的 0.7s 里两路叠着，
  //   接缝被渐变彻底盖掉。
  //   两路复用同一个 src（浏览器共享缓存，不会多下一次）。
  var BG_FADE = 700, BG_LEAD = 0.8;         // 淡入时长（和 CSS transition 对齐）/ 提前多少秒换路
  var bgVids = [], bgCur = 0, bgWant = false, bgTick = null, bgFading = false, bgFadeAt = 0;
  var bgLoopEnd = 0, bgHalf = false, bgPosterUrl = '';
  // bgHold：外面（总入口 show()）要求的「背景先别播」。2026-11-06 修 bug：这个状态原来不存在，
  // bgPause(true) 只是把 bgTick 清掉，于是之后**任何一次 apply()**（改主题、storage 事件、
  // 系统深浅色切换、跨 820 断点）走到 bgVideo() 的「同 src」分支时看到 !bgTick，就又把视频
  // 恢复播放了；visibilitychange 回来更是无条件 bgPause(false)。表现：打开工具后，父页面（总入口）
  // 那层背景视频被反复唤醒/暂停/回卷 —— 它正好垫在总入口 52px 顶栏后面（--bar 85% 白 + 15% 透出），
  // 顶栏亮度就跟着一明一暗地跳，用户看到的就是「刷题页顶部导航条狂闪」（iframe 里的内容其实是稳的）。
  var bgHold = false;

  // 移动端 / 触屏 / 省电 / 减少动效 → 一个 video 都不建。
  // 判据（无 hover 的粗指针 + 常见移动 UA）：故意不用「有粗指针就关」，
  // 因为带触摸屏的笔记本、教室一体机也有 (pointer:coarse)，那些机器该正常播；
  // 加上 (hover:none) 才能把「真的只能摸」的设备和「能摸也能用鼠标」的设备分开。
  // 2026-11-06：**820px 断点从这条里拿掉了**。原来它和 bgNarrow() 混在一起，
  // 跨一次断点就 bgDrop()（销毁两路 video）再跨回来 bgMake()（重建 + 重新解码），
  // 窗口宽度正好卡在 806~820（滚动条出现/消失就差 15px）时，翻一页题就来回跨 → 背景层反复重建。
  // 现在窄屏只「暂停 + 靠 CSS display:none 藏起来」（样式里本来就有这条），元素留着，回宽屏接着播，不跳。
  function bgNoVideo() {
    if (liteOn() || document.documentElement.classList.contains('hx-lite')) return true;
    if (!window.matchMedia) return false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    if (matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches) return true;
    var ua = navigator.userAgent || '';
    if (/iPhone|iPod|Windows Phone|Android.+Mobile|IEMobile/i.test(ua)) return true;
    // iPad 走「桌面版网站」时 UA 是 Macintosh，只能靠触摸点数认出来
    if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return true;
    return false;
  }
  // 窄屏（≤820px）：不建新元素、但已有的元素只暂停不销毁 —— CSS 那边 .hx-bgvid-wrap 会 display:none。
  function bgNarrow() { return !!(window.matchMedia && matchMedia('(max-width: 820px)').matches); }

  // ── 2026-11-05 六修：手机（及窄屏）背景「不会动」──
  // 移动端不建 video（bgNoVideo，为了根治 Safari 弹原生播放器），只剩 --hx-img 一张静态海报帧，
  // 用户反馈「手机上首页背景不会动」。这里补一层**纯 CSS 合成动画**（见 hx-theme.css 的 hx-bgmo-*）：
  //   · html.hx-bg-mo body::before 自己做缓慢推近（ken burns）；
  //   · body 里插一个 .hx-bgmo，两团极光柔光反向漂移。
  // 只在「视频壁纸被降级成海报帧」时挂；省电一体机 / 系统减少动态效果 一律不挂（保持静态，也不白烧合成）。
  // 全程零 video、零 rAF、零 blur、零 blend-mode：只有 transform / opacity 两个合成器属性在动。
  var bgMo = null;
  function bgMotion(on) {
    var r = document.documentElement;
    var need = !!on && !liteOn() && !r.classList.contains('hx-lite')
      && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    r.classList.toggle('hx-bg-mo', need);
    if (!need) {
      if (bgMo && bgMo.parentNode) bgMo.parentNode.removeChild(bgMo);
      bgMo = null;
      return;
    }
    if (bgMo) return;
    if (!document.body) return;               // 脚本在 <head> 里跑，body 还没出来：下次 apply() 再补
    bgMo = document.createElement('div');
    bgMo.className = 'hx-bgmo';
    bgMo.setAttribute('aria-hidden', 'true');
    bgMo.appendChild(document.createElement('i'));
    bgMo.appendChild(document.createElement('i'));
    document.body.insertBefore(bgMo, document.body.firstChild);
  }

  function bgSetFade(v, k) {
    if (!v) return;
    v.style.setProperty('--hx-fade', k ? '1' : '0');
  }
  // 两路的上下关系用 z-index 显式定死（不能只靠 DOM 顺序：insertBefore 会让先插的那路反而在上面）。
  // 都在 -1 以下：-2 = 正在淡入的那路（上），-3 = 垫在下面一直全不透明的那路（下）。
  // 为什么不让两路同时半透明交叉：0.5 + 0.5 叠起来，合成后的不透明度只有 0.75，
  // 中间那 0.35 秒整块背景会往页面底色沉一下 —— 每 5 秒一次的亮度脉冲，比接缝还显眼。
  // 改成「新的从 0 淡上来、旧的始终满不透明垫底」，全程没有亮度凹谷，只有两帧叠影的柔化。
  function bgSetZ(v, onTop) {
    if (!v) return;
    v.style.zIndex = onTop ? '-2' : '-3';
  }
  function bgStopAll() {
    for (var i = 0; i < bgVids.length; i++) { try { bgVids[i].pause(); } catch (e) { } }
  }
  function bgDrop() {
    bgStopAll();
    if (bgTick) { clearInterval(bgTick); bgTick = null; }
    for (var i = 0; i < bgVids.length; i++) if (bgVids[i].parentNode) bgVids[i].parentNode.removeChild(bgVids[i]);
    // 2026-11-06 修 bug：原来只摘 video、不摘外层 wrap。跨 820 断点（或切背景）走到这里时，
    // body 里那个 position:fixed inset:0 的空 wrap 会留下来；再跨回来 bgMake() 又插一个新的，
    // 每切一次攒一层全屏 fixed 图层（实测拖 8 次窗口宽 821↔819 → 8 个空 wrap 堆着）。
    // 老机器上这些层会拖慢合成；更重要的是它们让「背景层到底有没有」变得不可判定。
    if (bgWrap && bgWrap.parentNode) bgWrap.parentNode.removeChild(bgWrap);
    bgWrap = null;
    bgVids = []; bgCur = 0; bgFading = false; bgLoopEnd = 0;
  }
  var bgWrap = null;
  function bgMake() {
    // 防御：万一还有旧的空 wrap（bgDrop 之前的代码路径），先摘掉再建
    if (bgWrap && bgWrap.parentNode) bgWrap.parentNode.removeChild(bgWrap);
    // 两路共用一个定位父层：--hx-bgo 挂在外层，交叉淡入只在内层动。见上面 style 那段注释。
    bgWrap = document.createElement('div');
    bgWrap.className = 'hx-bgvid-wrap';
    bgWrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 2; i++) {
      var v = document.createElement('video');
      // 第一路保留 #hx-bgvid 这个 id：外部（验收脚本、旧样式缓存）可能按它找元素
      if (!i) v.id = 'hx-bgvid';
      v.className = 'hx-bgvid';
      v.setAttribute('aria-hidden', 'true');
      // muted 必须在插入 DOM **之前**写好，否则移动端自动播放策略直接拒
      v.muted = true; v.defaultMuted = true;
      v.setAttribute('muted', '');
      v.playsInline = true;
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      // 不让任何内核把这块背景画当成"可播放的媒体"（X5 / 部分国产内核的接管开关）
      v.controls = false;
      v.disablePictureInPicture = true;
      v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('controlslist', 'nodownload nofullscreen noplaybackrate noremoteplayback');
      v.setAttribute('x5-video-player-type', 'h5-page');
      v.setAttribute('x5-video-player-fullscreen', 'false');
      v.setAttribute('x5-playsinline', 'true');
      v.setAttribute('tabindex', '-1');
      // loop 交给 bgStep() 手动管：要在片尾之前换路，原生 loop 会先跳到 0 再淡，闪一帧
      v.loop = false;
      v.preload = 'auto';
      bgSetFade(v, i === 0);
      bgSetZ(v, i === 0);
      bgWrap.appendChild(v);
      bgVids.push(v);
    }
    document.body.insertBefore(bgWrap, document.body.firstChild);
  }
  // 换路：旧那一路保持满不透明垫在下面，新那一路叠在上面从 0 淡到 1。
  // 淡到 1 之后旧的被完全盖住，这时再把它停下、透明度归零 —— 这一步在屏幕上不可见，
  // 所以全程整块背景的合成 alpha 恒等于 1，既没有接缝一帧，也没有"亮度凹一次"的闪烁。
  function bgSwap() {
    var cur = bgVids[bgCur], nxt = bgVids[1 - bgCur];
    if (!cur || !nxt) return;
    bgSetZ(cur, false); bgSetZ(nxt, true);
    // 2026-11-06 修 bug：待命那一路在上一轮收尾时已经 currentTime = 0 过了（见 bgStep），
    // 这里再赋一次 0 会**再触发一次 seek**（Chrome 对相同值赋值也发 seeking），把已解码的帧
    // 缓冲丢掉、等新帧（实测每轮换路都有一次 seeking + waiting）。弱网 / 老一体机上就是
    // 每 4.3 秒一次的卡帧或黑帧，正好发生在它往上淡入的时候。没必要就别 seek。
    try { if (nxt.currentTime > 0.05) nxt.currentTime = 0; } catch (e) { }
    var p = nxt.play(); if (p && p.catch) p.catch(function () { });
    bgSetFade(nxt, 1);
    bgFading = true; bgFadeAt = Date.now();
  }
  function bgStep() {
    if (!bgVids.length || document.hidden || bgWant === false) return;
    var cur = bgVids[bgCur], nxt = bgVids[1 - bgCur];
    if (!cur || !nxt) return;
    if (!bgLoopEnd) {
      var d = cur.duration;
      if (!isFinite(d) || !d) return;          // 元数据还没到
      bgLoopEnd = bgHalf ? d / 2 : d;
    }
    if (bgFading) {
      if (Date.now() - bgFadeAt >= BG_FADE + 80) {
        // 新的那一路已经满不透明、把旧的完全盖住了：这时停掉旧的、把它透明度归零并送回下层待命。
        // 顺序很重要 —— 先归零再抬 z 会露出下一个下层，所以必须「旧的先降 opacity（已被盖住看不见）
        // → 旧的挪到下层 → 新的升到上层」。
        try { cur.pause(); cur.currentTime = 0; } catch (e) { }
        bgSetFade(cur, 0); bgSetZ(cur, false); bgSetZ(nxt, true);
        bgCur = 1 - bgCur; bgFading = false;
      }
      return;
    }
    if (cur.paused) return;
    // 定时器被节流时可能一次跨过整段：直接强制换路，别让旧那一路自己撞到 duration 卡住
    if (cur.currentTime >= bgLoopEnd - BG_LEAD || cur.currentTime >= bgLoopEnd) bgSwap();
  }
  function bgRun(on) {
    if (!bgVids.length) return;
    if (bgTick) { clearInterval(bgTick); bgTick = null; }
    if (!on) { bgStopAll(); return; }
    // 从暂停里回来时，主那一路可能正停在换路窗口边缘（甚至已经滑进片尾）。
    // 先把时间拨回开头再起播：否则恢复的那一瞬间会先闪一次"倒放段"。
    var curV = bgVids[bgCur];
    if (curV && bgLoopEnd && curV.currentTime >= bgLoopEnd - BG_LEAD) { try { curV.currentTime = 0; } catch (e) { } }
    for (var i = 0; i < bgVids.length; i++) {
      // 换路窗口里被 bgPause 停过的话，两路都还在淡入淡出中间态，续播必须两路一起起 ——
      // 只起主那一路会让另一路卡在中间的不透明度上，画面变成两层半透明叠着
      if (i !== bgCur && !bgFading) continue;
      var p = bgVids[i].play(); if (p && p.catch) p.catch(function () { }); // 自动播放被拦时不报错，海报帧兜底
    }
    // 不用 rAF：每帧读 currentTime 纯白烧 CPU。150ms 一次足够（换路窗口 0.8s ≈ 5 次采样）
    bgTick = setInterval(bgStep, 150);
  }
  function bgVideo(src, poster, half) {
    var wasSrc = bgVids.length ? bgVids[0].getAttribute('data-src') : '';
    bgWant = !!src;
    if (!src) { bgPosterUrl = ''; bgDrop(); return; }
    if (!document.body) { // 脚本在 <head> 里执行：等 body 出来再插，插完重跑一次 apply
      addEventListener('DOMContentLoaded', function () { apply(); });
      return;
    }
    bgPosterUrl = poster ? root + poster : '';
    bgHalf = !!half;
    if (bgNoVideo()) { bgDrop(); return; }   // 移动端：--hx-img 由 apply() 设成海报帧
    // 窄屏且还没建过：先不建（省一次 620KB 下载），等窗口放宽了再建。
    // 已经建好的绝不销毁 —— 见 bgNarrow() 上面那段：销毁/重建正是跨断点时背景跳变的来源。
    if (!bgVids.length) {
      if (bgNarrow()) { bgDrop(); return; }
      bgMake();
    }
    if (wasSrc === src) {
      // 同一张片子：只在被降级掉/暂停掉之后重新起播，不重置淡入状态 ——
      // apply() 会因为改主题色、改透明度被反复调用，每调一次就 reset 会让背景一直闪
      // 2026-11-06：bgHold（外面要求暂停，比如总入口开着工具）时绝不能自己起来，见 bgHold 那段注释。
      // 窄屏同理：元素留着（CSS 已经 display:none），只把解码停掉，跨断点回来就能接着播。
      if (bgHold || bgNarrow()) { bgStopAll(); if (bgTick) { clearInterval(bgTick); bgTick = null; } return; }
      if (!bgTick) bgRun(true);
      return;
    }
    for (var i = 0; i < 2; i++) {
      var v = bgVids[i];
      v.setAttribute('data-src', src);
      v.poster = bgPosterUrl;
      v.src = root + src;
    }
    bgLoopEnd = 0;
    bgCur = 0; bgFading = false;
    bgSetFade(bgVids[0], 1); bgSetFade(bgVids[1], 0);
    // 暂停态（工具开着）或窄屏：元素照样备好，等条件满足再起播
    if (bgHold || bgNarrow()) { bgStopAll(); return; }
    bgRun(true);
  }
  function bgPause(on) { // index.html 打开工具时调用：背景被 iframe 盖住就别再解码了
    // 状态必须先记下来 —— 即使此刻视频还没建（bgVids 为空），后面 apply() 建出来也不能自己播。
    bgHold = !!on;
    if (!bgVids.length) return;
    // 两路都要停：只停主那一路的话，交叉淡入窗口里正好被调到的那条会继续解
    if (on) bgRun(false);
    else if (bgWant && !bgNoVideo() && !bgNarrow()) bgRun(true);
  }
  addEventListener('visibilitychange', function () {
    if (!bgVids.length) return;
    // 2026-11-06：原来回来那句是无条件 bgPause(false)，把 show() 之前设的暂停也一起解掉了，
    // 于是工具还开着、父页面背景视频却在 iframe 背后恢复播放（白烧一路 4K 解码，还顶着顶栏）。
    if (document.hidden) bgStopAll(); else if (!bgHold) bgPause(false);
  });
  // 视口跨过 820px（手机横竖屏切换、开发者拖窄窗口）时重新判一次：该降级的降级成海报帧、
  // 该恢复的恢复成视频。只挂在那一根断点上，不会因为普通 resize 反复跑 apply。
  (function () {
    if (!window.matchMedia) return;
    var mq = matchMedia('(max-width:820px)'), last = mq.matches;
    var on = function () { if (mq.matches !== last) { last = mq.matches; apply(); } };
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
  })();

  function apply() {
    var s = get(), m = modeOf(s), a = ACC[s.acc], r = document.documentElement, b = BG[s.bg];
    var c = m === 'dark' ? a.d : a.l, c2 = m === 'dark' ? a.d2 : a.l2;
    r.setAttribute('data-hx-mode', m); r.setAttribute('data-theme', m); r.setAttribute('data-hx-acc', s.acc);
    r.classList.toggle('hx-bg', s.bg !== 'none');
    r.classList.toggle('hx-wm-off', !s.wm);   // 校徽水印开关（外观面板里可切，默认开）
    // 视频壁纸：图层面自己播，--hx-img 置空，body::before 只留深色模式那层压暗 scrim
    var isVid = !!(b && b.video) && s.bg !== 'none';
    var img = s.bg === 'custom' ? 'url("' + ls(IMG) + '")' : b.img ? 'url("' + root + b.img + '")' : b.css || 'none';
    // 移动端 / 省电 / 减少动效：不播视频，但**背景照样得有** —— 把海报帧交给 --hx-img，
    // 走 body::before 那条现成的「铺满 cover + --hx-bgo 透明度」链路，观感和视频帧一模一样，
    // 且手机不需要下载 634KB 的 mp4。这条是「手机跳成播放器」的治本修法。
    // 窄屏（≤820）也要给海报：视频元素此时被 CSS display:none 藏了，不给海报就只剩页底色。
    var vidStill = isVid && (bgNoVideo() || bgNarrow());
    if (vidStill && b.poster) img = 'url("' + root + b.poster + '")';
    // --hx-a：玻璃浓度乘数（各条玻璃配方的 alpha 都乘它）。
    // 2026-11-05 随通透度滑杆翻转语义：100（最透）= 1，正好是 2026-11-04 定稿的那套清透玻璃；
    // 往下调卡片变实：0 = 2，各配方 alpha × 2 后被浏览器钳到 1，整卡变成实色（保可读的兜底端）。
    var hx_a = s.bg === 'none' ? 1 : 1 + (100 - s.clr) / 100;
    var vars = { '--acc': c, '--acc2': c2, '--acc3': c2, '--acc-h': c2, '--on-acc': s.acc === 'mono' && m === 'dark' ? '#1d1d1f' : '#fff',
      '--accbg': 'color-mix(in srgb, ' + c + ' 14%, transparent)', '--ring': 'color-mix(in srgb, ' + c + ' 40%, transparent)',
      '--hov': 'color-mix(in srgb, ' + c + ' 10%, transparent)', '--hx-a': hx_a, '--hx-img': isVid && !vidStill ? 'none' : img, '--hx-bgo': s.bgo / 100 };
    for (var k in vars) r.style.setProperty(k, vars[k]);
    r.classList.remove('hx-bgblur'); // 旧版挂的「预糊图」标记，现在没有任何样式依赖它，清掉防止老缓存残留
    bgVideo(isVid ? b.video : null, isVid ? b.poster : null, isVid && b.mirror);
    // 海报帧兜底时（手机 / 窄屏）补一层 CSS 合成动画，不然手机上的背景是一张不动的静图。
    // 只认「视频壁纸被降级」这一种：普通图片壁纸、纯色背景保持原样，不动用户选好的画面。
    bgMotion(vidStill && !!b.video);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', m === 'dark' ? '#000000' : '#f5f5f7');
    try { ls('zfz-practice-theme', m); ls('wanxiu-paike-theme', m); ls('ui.theme', JSON.stringify(m)); } catch (e) { }
    for (var i = 0; i < subs.length; i++) try { subs[i](s, m); } catch (e) { }
  }
  // set(patch)：按字段落键。bg / wx / wm → 全局键 hx-theme（全站一份）；
  // acc / mode / clr / bgo → 当前界面键 hx-theme:s:<界面>（首页是 home，工具是 data-tool，互不干扰）。
  // 换背景时不再自动改卡片透明度（老版会把 op 拉到该背景的「推荐值」）：通透度是界面自己的设置，不该被背景顺手改掉。
  function set(patch) {
    var g = jparse(ls(KEY)) || {}, o = jparse(ls(SKEY + SURF)) || {}, hitG = false, hitO = false;
    for (var k in patch) {
      if (k === 'bg' || k === 'wx' || k === 'wm') { g[k] = patch[k]; hitG = true; }
      else if (k === 'acc' || k === 'mode' || k === 'clr' || k === 'bgo') { o[k] = patch[k]; hitO = true; }
    }
    if (hitG) { g.ver = VER; try { ls(KEY, JSON.stringify(g)); } catch (e) { } }
    if (hitO) { try { ls(SKEY + SURF, JSON.stringify(o)); } catch (e) { } }
    apply();
  }
  // 自己上传的图：缩到长边 1920、转 JPEG，免得撑爆浏览器存储（旧站是原图、限 3MB）
  // ── 上传过的背景：留一本历史（2026-11-04）──
  // 用户原话：「我上传了一个背景　但是切成别的　我之前上传的记录就没了　我没办法快速切回来　还需要重新上传　这不对」。
  // 原来只有 hx-theme-img 一个格子，换一张就把上一张冲掉了。
  // 现在另开 hx-theme-imgs 存一本相册（最多 6 张，新的在前），hx-theme-img 只表示「当前这张」。
  // 为什么不把当前图也从相册里取：老存档里 hx-theme-img 早就有值了、相册是空的，
  // 两个键各管各的，迁移路径最短——老用户第一次上传时才把新图补进相册。
  var IMGS = 'hx-theme-imgs', IMGS_MAX = 6;
  function imgs() {
    try { var a = JSON.parse(ls(IMGS) || '[]'); return Object.prototype.toString.call(a) === '[object Array]' ? a : []; } catch (e) { return []; }
  }
  // 写相册：浏览器存储就 5MB，几张 1080p 的图很容易顶到配额。
  // 顶到了不留半截相册（JSON 被截断会整本读不出来），而是从最老的开始丢，丢到写得进去为止。
  function saveImgs(list) {
    list = list.slice(0, IMGS_MAX);
    for (var n = list.length; n >= 0; n--) {
      try { ls(IMGS, JSON.stringify(list.slice(0, n))); return list.slice(0, n); } catch (e) { }
    }
    return [];
  }
  function addImg(data) {
    var list = imgs().filter(function (x) { return x && x.data !== data; });
    list.unshift({ id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1000), data: data, at: Date.now() });
    return saveImgs(list);
  }
  function delImg(id) {
    var list = imgs(), gone = null;
    list = list.filter(function (x) { if (x.id === id) { gone = x; return false; } return true; });
    saveImgs(list);
    // 删掉的正好是当前这张：别留一个指向不存在图片的 custom，回落到默认背景
    if (gone && ls(IMG) === gone.data) { ls(IMG, null); set({ bg: DEF.bg }); }
    return list;
  }
  function useImg(id) {
    var list = imgs(), hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) hit = list[i];
    if (!hit) return false;
    ls(IMG, hit.data);
    set({ bg: 'custom' });
    return true;
  }
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
        // 先存当前、再进相册：相册写失败（配额满）不该让这次上传本身失败
        try { addImg(data); } catch (e) { }
        set({ bg: 'custom' }); ok();
      };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('这张图片打不开')); };
      im.src = url;
    });
  }
  // 恢复默认：清全局设置、清当前图、清**本界面**的设置，但**不动相册** —— 用户点「恢复默认」是想回到出厂样子，
  // 不是想把辛苦攒的几张背景一起删了。要删单张去相册里点 ×。
  function reset() { ls(KEY, null); ls(IMG, null); ls(SKEY + SURF, null); apply(); }
  // storage 事件：全局键（背景 / 动效 / 水印 / 图 / 开发者标）变了全站跟着刷；
  // 界面键只有「自己的那一份」变了才刷——别的工具改深浅色不该惊动这一页（分层隔离的意义就在这）。
  addEventListener('storage', function (e) { if (e.key === KEY || e.key === IMG || e.key === DEV || e.key === SKEY + SURF || e.key === null) apply(); });
  if (dark) (dark.addEventListener ? dark.addEventListener('change', apply) : dark.addListener(apply));
  // 总入口（同源的上层页面）：子工具要登录时请它弹登录窗口；不在框里就跳回首页
  function portal() { try { return window.top !== window && window.top.HXPortal ? window.top.HXPortal : null; } catch (e) { return null; } }
  window.HXTheme = { acc: ACC, bg: BG, wx: WX, root: root, surface: SURF, get: get, mode: function () { return modeOf(get()); }, set: set, upload: upload, reset: reset, isDev: isDev, setDev: setDev, onChange: function (fn) { subs.push(fn); },
    portal: portal, login: function () { var p = portal(); if (p) p.login(); else location.href = root + (tool ? '#' + tool : ''); },
    // 上传过的背景相册（2026-11-04）：imgs() 取列表、useImg(id) 切回、delImg(id) 删一张
    imgs: imgs, useImg: useImg, delImg: delImg,
    // 像素方块「正在载入」药丸（2026-11-04）：见文件上方 loadPill 那段注释。
    // HXTheme.loadPill(host, '正在载入…') / loadPill('正在载入…')（铺满整页）；返回 { el, text(), done() }
    loadPill: loadPill, bgPause: bgPause };
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
