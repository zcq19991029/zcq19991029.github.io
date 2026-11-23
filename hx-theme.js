// 华夏工具外观（网站根目录 /hx-theme.js + /hx-theme.css）。全部工具在 <head> 里同步引用，打开就是选好的外观、不闪。
// ⚠️ 这份 hx-theme.js 在根目录和 总入口/ 各有一份，publish.cjs 每次发布都会用根目录那份覆盖 总入口/，
//    改必须两边一起改（改完 diff 两处应为空），否则下次发布就把 总入口/ 的改动丢掉。
// ── 分层（2026-11-13 定稿 VER 8：**全站只有一份外观**）──
//   · 全部页面共用同一把键 hx-theme：主题色 / 深色浅色 / 卡片通透度 / 背景清晰度 / 背景 / 校徽水印
//     全存在这里。在哪个页面改，首页、总入口顶栏、每个工具页、嵌在总入口里的工具**一起变**。
//   · 为什么从「按界面分键」改回全局唯一：用户原话「各个工具分开打开再点主题是否各管各的而不是统一调配？
//     按理说我们现在要求只存在一个主题控制 全局控制」。VER 5/6 那套 hx-theme:s:<tool> 已下线：
//     只保留「迁移时读一次」，不再写新值（合并规则见下面 VER 8 迁移那段）。
//   · hx-lite（极简 / 标准）本来就是全局键，仍单独存；它管的是「要不要特效」，不是外观长相。
//   · 三个例外仍不进这把键，因为它们不是「外观长相」：上传的背景图本体（hx-theme-img / hx-theme-imgs）、
//     开发者身份（hx-dev，服务端算出来的）、极简开关（hx-lite）。
// 外观只在总入口右上角改：主题色（沿用旧刷题站的 7 套）、深色 / 浅色 / 自动、背景图、通透度两根滑杆。
// 自己上传的背景图压缩后存 hx-theme-img；同一网站的页面（包括嵌在总入口里的工具）通过 storage 事件一起变。
// 子工具只适配：<html data-theme="light|dark">（排课、单片机上机原有的深浅色写法）+ 行内 CSS 变量 --acc 等；接线仿真、排课、单片机的旧主题键顺带改好。
// <script src="../hx-theme.js" data-tool="paike">：子工具在网站上被单独打开（不在总入口框里）时，跳回总入口的对应工具，登录、账号只在总入口。
//   2026-11-19 补充：只有「首次单独打开」才跳；在工具页上**刷新不跳**（用户原话「在哪刷新就刷新完还要在哪」），带 ?solo 也不跳。
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
    /* 2026-11-17：**极光壁纸彻底删除**（用户原话「极光壁纸彻底清除」）。
       删掉的是：BG.aurora 这一档、bg/aurora.jpg 这个图、外观面板里的「极光」按钮、
       「静态壁纸缓慢呼吸」那整套（bgMotion + .hx-bgmo 两团柔光 + body::before 的 ken burns，
       它只服务极光这一档，没有别的预设带 motion 标记，留着就是一段永不执行的死代码）。
       为什么删：它是全站唯一的「非用户自己素材」的背景预设 —— 一张固定的图，教室里每个班看都一样，
       占 30 KB，还要为它养一层动效；用户要的是「干净底」或者「自己的图」，中间这档没意义。
       老存档里的 bg:'aurora' 由 migrateGlobal() 就地改写成 'none'（见那边），不会白屏、不会报错。
       背景现在只有两档：无 / 自己的图。 */
    custom: { name: '自己的图', op: 70 }
  };
  // VER 4（2026-11-04 深夜）：背景项合并成上面三档，默认改成极光视频。
  // 老存档里凡是选了已下架背景（bear/chiikawa/cat/mist/bay/dusk/旧极光渐变）的，统一迁到新默认；
  // 自己上传过图的（custom 且本地还有图）保留不动 —— 那是用户自己的东西，不能因为改默认就没了。
  // VER 5（2026-11-05）：主题色、深浅模式、卡片通透度、背景清晰度曾改成按界面分键。
  // VER 6（2026-11-08）：背景图 / 校徽水印也曾按界面分键（当时的原话是「各个工具下主题独立控制」）。
  // VER 8（2026-11-13）：**分键整个收回全局一把**（用户原话「只存在一个主题控制 全局控制」）。
  //   这两个版本留下的 hx-theme:s:<界面> 存档只用于一次性迁移，之后不再读、也不再写。
  // 滑杆语义 2026-11-05 翻转：原来的 op「卡片透明度」100 = 最实；现在叫 clr「卡片通透度」，100 = 最透
  // （也就是用户定下的默认观感：深色玻璃底、背景透出来），往下调卡片变实、文字更清楚。
  // 老存档里的 op 不再折算：旧 100 = 新 100（同一观感），旧值更小的本意是「更透」——新体系 100 已经是最透，
  // 一律落回默认 100，保证老用户刷新后看到的就是这版定稿的玻璃观感。
  var KEY = 'hx-theme', SKEY = 'hx-theme:s:', IMG = 'hx-theme-img', DEV = 'hx-dev', VER = 8,
    // 2026-11-05 用户定：默认进来 = 深色主题 + 两个滑杆都 100%（通透度 100 = 深色清透玻璃，背景最透出）。
    // 之前默认 mode:'auto'，Mac 浅色系统打开就是浅色 + 旧白玻璃配方，用户原话「玻璃质感不高级 仅仅只是白色雾蒙蒙」。
    // 2026-11-11 用户定（第二次）：「主题自动…不需要给用户切换，默认深色主题」。深浅**不再有 auto 档**，
    //   只留 浅色 / 深色 两个按钮，默认深色；老存档里 mode:'auto' 的按当时实际显示落成 light/dark（见 get()）。
    // 2026-11-13 用户定（VER 8）：「默认背景给全部用户使用深色主题 白色主题色 通透度和清晰度都是拉满
    //   校徽水印显示 模式极简」。所以主题色默认从 'green' 换成 'mono'（色板里叫「黑白」，深色下
    //   d 色 = #f5f5f7，就是用户要的白），水印默认从「首页开 / 工具页关」统一成「全站开」。
    //   迁移只把**值还等于旧默认**的字段换成新默认，用户显式选过的颜色一律保留（见 migrateGlobal）。
    // glass：毛玻璃开关（2026-11-19 第七轮 T7④ 新增）。0 = 关闭（默认，卡片底板全透明、
    //   无背景模糊，只留文字和描边，壁纸整张透出来——用户原话「全透明很好看，要它当默认」）；
    //   1 = 开启（现在的毛玻璃：半透明底 + backdrop-filter 模糊，保文字可读性）。
    DEF = { acc: 'mono', mode: 'dark', bg: 'none', clr: 100, bgo: 100, wm: 1, glass: 0 };
  // 2026-11-11 用户定（第二次改默认背景）：「极光背景改 … 使用默认静态背景？比如就用深色总默认 无背景
  //   可以选极光 加入选择不强制」。所以全站默认背景从 `aurora`（动态视频壁纸）改成 `none`
  //   （纯深色底，最省电、最不抢内容）；想要极光的人在外观面板里自己点，不再是默认。
  //   迁移见下面 VER 7 段：老存档里「从没主动挑过背景」的一律落到 none；
  //   自己上传过图（custom）或显式选过别的背景的，保留不动。
  // 2026-11-12：像素氛围动效（原 wx 字段 + 旧的独立渲染器）整个功能删除。
  //   老存档里残留的 wx 字段不再读取，留着无害、忽略即可（get() 返回的对象里没有 wx）。
  // VER：外观配置版本。加了全局默认背景后，老存档里没有 ver 字段 = 还没主动挑过背景，
  // 补成新默认（小熊）；自己上传过图的（custom）与显式选过「无」的不覆盖。
  var OLD = { day: { acc: 'blue', mode: 'light' }, sea: { acc: 'green', mode: 'light' }, sakura: { acc: 'pink', mode: 'light' }, night: { acc: 'purple', mode: 'dark' }, forest: { acc: 'green', mode: 'dark' }, mist: { acc: 'mono', mode: 'dark' } };
  var me = document.currentScript, root = me ? new URL('.', me.src).href : location.origin + '/';
  var tool = me && me.getAttribute('data-tool'), subs = [], dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

  /* ── 工具页被单独打开时回总入口外壳（2026-11-19 用户纠错：刷新不能回首页）──
     原话：「只有首次从首页进入接线仿真才弹窗开发人员窗口 在哪刷新就刷新完还要在哪 不能刷新一下回到首页了」
     这段原来的作用：工具页不在总入口的 iframe 里、而是被单独打开（直接敲地址、从收藏夹进），
     就把地址整个换成「总入口 + 对应工具」，因为登录、账号、外观面板都长在总入口外壳上，单独的工具页没有。
     问题：它是**无条件**执行的，所以老师在 /wiring-lab/ 看完一题按 F5 重新加载时也会被换地址 ——
     视觉上就是「刷新一下回到首页」，原来在看的那道题、滚到的位置全丢了。用户为此纠错。
     现在的三种情况（以后动这段先看这三条）：
       ① 首次单独打开（地址栏直接敲、从外站/收藏夹点进来）→ **仍然跳**总入口外壳，原设计不变；
       ② 刷新（F5 / Ctrl+R）→ **不跳**，原地重新加载，题目和位置都留住；
       ③ 地址带 ?solo → **不跳**（离线调试、验收脚本都靠它，一直如此）。
     怎么认出「刷新」——两层，任意一层成立就算：
       · performance.getEntriesByType('navigation')[0].type === 'reload'（Chrome/Safari/Firefox 都支持；
         老浏览器或取不到这一项时当「不是刷新」，退回原来的跳转，行为与改前一致，不会变坏）；
       · document.referrer 和当前页是**同一个页面**（同源、同路径，index.html 与目录结尾视为同一页）。
         有的浏览器在刷新时拿不到 navigation 条目，这一层兜底；只认「同一个页面」，
         所以从总入口「/」点链接进 /wiring-lab/ 时 referrer 是「/」、不算同页，①的跳转照样生效。 */
  function hxIsReloadOrSelfNav() {
    try {
      var navs = performance.getEntriesByType && performance.getEntriesByType('navigation');
      if (navs && navs[0] && navs[0].type === 'reload') return true;
    } catch (e) { }
    try {
      if (document.referrer) {
        var ref = new URL(document.referrer);
        var strip = function (p) { return p.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '/'); };
        if (ref.origin === location.origin && strip(ref.pathname) === strip(location.pathname)) return true;
      }
    } catch (e) { }
    return false;
  }
  if (tool && window.top === window && /^https?:$/.test(location.protocol) && !/[?&]solo\b/.test(location.search) && !hxIsReloadOrSelfNav()) { location.replace(root + '#' + tool); return; }

  /* ── 全站滚动条：统一成「滚动才浮现的毛玻璃滑轨」（2026-11-17 用户定，第二版）──
     用户原话：「这种下拉滑轨都要改成无感的 所有工具所有页面都是如此 …… 很丑」
     「我不需要一直在 就是触发滚动 就微微显示即可 透明毛玻璃状态」
     （配图是刷题科目药板右侧那根带上下箭头的系统灰条）。
     专业词汇（用户问过，记这儿省得再查）：整条叫 **滚动条 scrollbar**；底槽叫 **轨道 track**；
     能拖的那块叫 **滑块 thumb**；滚动条占掉的那条缝叫 **gutter**。对应伪元素：
     ::-webkit-scrollbar / -track / -thumb / -button / -corner。
     现状为什么乱：以前每个工具各写各的 —— 小组加分给 .assessment-scroll 做了 13px 粗轨
     加 3px 白边、.nm-stage 10px 深蓝，其余工具（刷题、资料库、课程进度、排课、考试……）
     全用系统默认，Windows Chrome 那根带箭头的灰条压在铝箔药板、深色卡片上特别出戏。
     为什么放在这个 JS 里而不是 hx-theme.css：**全站只有总入口和刷题真的引了那份 CSS**，
     其余工具只引这个 JS（下面「动态背景那一层」「页面层基础样式」两段开头的注释说的是同一件事）。
     统一口径（一处改、全站生效，以后别再往各工具 CSS 里单写滚动条）：
       · 粗细 6px（横竖一样），圆头，**没有轨道底色、没有两端箭头**；
       · **静止时滑块完全透明 = 看不见**；只有这个容器真的在滚的那一下才浮出来，停手 900ms 褪回去
         —— 这就是「触发滚动才微微显示」，不是「极淡但一直在」；
       · 浮现态 = 半透明毛玻璃：浅色黑 32% / 深色白 36%，再加 1px 内白边模拟磨砂高光；
       · 为什么用 scroll 事件而不是 :hover —— 自检页实测 `matches(':hover')` 恒 false，
         一体机触摸板更触发不到；而滚轮 / 触摸 / 拖滑块 / JS 滚动**一定会发 scroll 事件**；
       · 副作用要认：滚动条伪元素**不支持 transition / opacity 过渡**，所以出现和消失是硬切，
         做不到渐隐（Chromium 的限制，不是没写）；
       · !important 是故意的：各工具自带的 ::-webkit-scrollbar 规则加载在本文件之后，
         不加就能把粗轨又写回来。这条规矩已写进 claude项目/CLAUDE.md。
     真要彻底不要滚动条（横滑 chip 条那种），在自己那条规则里写 display:none 即可，
     优先级更高，不受这里影响。 */
  (function () {
    var sb = document.createElement('style');
    sb.id = 'hx-scrollbar-style';
    sb.textContent =
      // Firefox 用标准属性（Chrome 121+ 只要写了 scrollbar-color 就会**整段忽略** ::-webkit-scrollbar，
      // 所以这几条必须锁在 @supports 里只给火狐，别让 Chromium 吃到；这个坑 2026-11-17 实测踩过）
      '@supports (-moz-appearance:none){'
      + '*{scrollbar-width:thin;scrollbar-color:transparent transparent}'
      + '.hx-rolling{scrollbar-color:rgba(0,0,0,.32) transparent}'
      + 'html[data-hx-mode="dark"] .hx-rolling,html[data-hx-mode="dark"].hx-rolling{scrollbar-color:rgba(255,255,255,.36) transparent}'
      + '}'
      // WebKit / Blink（Chrome、Edge、QQ、360 —— 教室里全是这一族）
      + '::-webkit-scrollbar{width:6px!important;height:6px!important;background:transparent!important}'
      + '::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent!important;border:0!important}'
      + '::-webkit-scrollbar-button{display:none!important;width:0!important;height:0!important}'
      /* 滑块：**默认全透明**。颜色只能写死 rgba —— 滚动条伪元素里取不到 var(--xxx)，
         写成变量会让整条声明作废、滑块彻底消失（2026-11-17 实测，别再「优化」成 var）。
         只有容器带上 .hx-rolling（下面 scroll 监听挂的那个 class）的那 0.9 秒才有颜色。 */
      + '::-webkit-scrollbar-thumb{background:transparent!important;border:0!important;border-radius:99px!important;min-height:32px}'
      + '.hx-rolling::-webkit-scrollbar-thumb{background:rgba(0,0,0,.32)!important;'
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.55),0 0 6px rgba(0,0,0,.18)!important}'
      /* 深色那几条要多带 `.hx-rolling` 的兄弟形态：页面级滚动条挂在 <html> 上，
         `html[data-hx-mode="dark"] .hx-rolling` 是后代选择器，匹配不到 html 自己。 */
      + 'html[data-hx-mode="dark"] .hx-rolling::-webkit-scrollbar-thumb,'
      + 'html[data-hx-mode="dark"].hx-rolling::-webkit-scrollbar-thumb{background:rgba(255,255,255,.36)!important;'
      + 'box-shadow:inset 0 0 0 1px rgba(255,255,255,.6),0 0 6px rgba(0,0,0,.35)!important}'
      /* 悬停 / 拖动再深一点。**必须带 html 前缀**：上面的基础色特异性是 (0,1,2)，
         裸的 `::-webkit-scrollbar-thumb:hover` 只有 (0,0,2)，加 !important 也压不过（顺序不重要）。 */
      + '::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.42)!important}'
      + '::-webkit-scrollbar-thumb:active{background:rgba(0,0,0,.5)!important}'
      + 'html[data-hx-mode="dark"] ::-webkit-scrollbar-thumb:hover,html[data-hx-mode="dark"]::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.46)!important}'
      + 'html[data-hx-mode="dark"] ::-webkit-scrollbar-thumb:active,html[data-hx-mode="dark"]::-webkit-scrollbar-thumb:active{background:rgba(255,255,255,.54)!important}'
      // 需求里点名的两处老粗轨（小组加分考核表横滚 / 名单竖滚），留着它们自己的尺寸会跟上面打架
      + '.assessment-scroll::-webkit-scrollbar,.nm-stage::-webkit-scrollbar{width:6px!important;height:6px!important}';
    (document.head || document.documentElement).appendChild(sb);

    /* 滚动中才显示：scroll 不冒泡，必须用 capture 才收得到所有滚动容器；
       e.target 是 document / body 时归一到 <html>（页面级滚动条挂在根上，不是 body）。
       停手 900ms 摘掉 class。计时器存 WeakMap：容器销毁不漏定时器，同一容器连续滚也不会越叠越多。 */
    var CLS = 'hx-rolling', DELAY = 900, timers = new WeakMap();
    addEventListener('scroll', function (e) {
      var t = e.target;
      if (!t || t === document || t === document.body || t.nodeType !== 1) t = document.documentElement;
      try {
        t.classList.add(CLS);
        var old = timers.get(t);
        if (old) clearTimeout(old);
        timers.set(t, setTimeout(function () {
          try { t.classList.remove(CLS); } catch (e2) { }
          timers.delete(t);
        }, DELAY));
      } catch (e3) { }
    }, { capture: true, passive: true });
  })();

  // 嵌在总入口里的子工具：背景层自己铺一遍（以前是「透明让首页壁纸透上来」，2026-11-09 证明
  // Chrome 会把显式透明的根背景画成白画布，深色工具页整片发白 —— 详见下面那段注释）
  // hx-embedded：告诉工具「你被嵌在框里了」。自带校徽水印的工具（目前只有排课 .wm）见到它就收起自己那一份，
  // 由总入口统一画一层，免得同一个校徽画两遍还错位。
  // 2026-11-06 修「点浅色页面还是深色」：透明只给深色用。浅色时让工具页铺自己的浅色底
  // （各工具的 :root 默认就是浅色底），否则首页那张深海蓝壁纸从 iframe 下面透上来，
  // 卡片和侧栏都变浅了、整页还是看着深深一片 —— 用户说的「深浅都不变化」有一半是这一条。
  if (tool && window.top !== window) {
    document.documentElement.classList.add('hx-embedded');
    var st = document.createElement('style');
    // 2026-11-09 修用户报障「选极光背景后工具页整体发灰、题目文字发白看不清、画布一整块灰白」。
    // 原因查清了，不是配色也不是壁纸丢了：
    //   原来这里把 html（根元素）的底色**显式**设成 transparent，想让总入口壁纸从 iframe 底下透上来。
    //   但 Chrome 对「显式 transparent 的根背景」不会去透父页面，而是退回 iframe 自己的**白色画布**；
    //   #hx-layer-style 里那些铺壁纸的规则又都挂在 .hx-layer 上，而嵌入时故意不挂 .hx-layer
    //   （见 apply 里那段注释），视频层也被下面这条 display:none 关掉 —— 于是工具页里没有任何一层
    //   在画背景，白色画布就直接露出来了。接线仿真的画布/卡片是半透明的（深色 .56），压在这层白上
    //   就成了灰色，而深色主题的字是浅色，浅字压灰底 = 看不清。实测把根底色刷成不透明色，灰底立刻消失。
    // 现在改成：根元素铺主题底色（--hx-page，深色 = #000，不是白），body 保持透明，
    //   壁纸由 body::before 自己铺一遍（嵌入时不建视频层，用海报帧；总入口开着工具时那边视频本来就
    //   暂停了，观感一致）。代价是「壁纸在 iframe 里又画了一遍」，但这幅画和总入口是同一张、同位置，
    //   肉眼看不出来；不这么做的话深色工具页就只有一片白。
    // 浅色仍铺自己的浅色底（见下面注释），所以只对深色生效。
    st.textContent =
      /* ① 深浅通用：嵌入页**只要有壁纸**，就让 body 透明、把 --hx-img 铺到 body::before 上。
         2026-11-17 修用户报的「很多工具浅色主题没背景」：原来下面这段只有
         `[data-hx-mode="dark"]` 一个分支，而工具页（刷题/考勤/排课/单片机/接线仿真……）
         绝大多数**不引 hx-theme.css**（那条 html.hx-bg body::before 在 CSS 里），
         所以浅色下整个 iframe 里没有任何一层在画壁纸 —— 白底一片，壁纸凭空消失。
         深色之所以正常，纯粹是因为这里给它补了一份。现在把壁纸这部分从深浅分支里提出来，
         用 .hx-bg 当闸门（选了壁纸才铺，没选壁纸的页面行为完全不变）。 */
      'html.hx-embedded.hx-bg body{background-color:transparent!important;background-image:none!important}'
      /* 每个属性都带 !important，因为好几个工具页自己就占着 body::before：
         · 排课 `body::before{inset:-20%;z-index:0;radial-gradient;background-repeat:repeat}` —— 不压它，壁纸会被瓦片平铺；
         · 小组加分 `body::before{display:none}` —— 只改 background-image 是不够的，伪元素根本不渲染
           （2026-11-17 差点又踩一次：测试只查 backgroundImage 会假绿，必须同时查 content 和 display）；
         · 课程进度 `body.teacher-ui::before` —— 特异性要够高才盖得住。
         所以这里给全套：content / display / position / inset / z-index / background 简写 / opacity。 */
      + 'html.hx-embedded.hx-bg body::before{content:""!important;display:block!important;'
      + 'position:fixed!important;inset:0!important;z-index:-1!important;pointer-events:none!important;'
      + 'background:var(--hx-img) center / cover no-repeat!important;background-image:var(--hx-img)!important;'
      + 'opacity:var(--hx-bgo,1)!important}'
      /* ② 深色兜底：**没有壁纸时**也要把白底刷成 --hx-page(#000)。
         工具页自带的白底 + 深色主题的浅色文字 = 看不清，这条是那次事故的修法，别动。 */
      + 'html.hx-embedded[data-hx-mode="dark"]{background-color:var(--hx-page,#000)!important;background-image:none!important}'
      + 'html.hx-embedded[data-hx-mode="dark"] body{background-color:transparent!important;background-image:none!important}'
      /* ③ 浅色也要刷底色（2026-11-17 修「使用说明页浅色下有两层背景、深色正常」）。
         根因不在页内，而在**跨 iframe**：总入口在 html.hx-bg 下把 iframe 元素设成 background:transparent，
         于是「iframe 文档的根背景是不是透明」决定了总入口那层壁纸能不能从它后面透上来。
         深色原本就刷了不透明 --hx-page(#000)，所以只有一层；浅色此前故意不刷（想让工具页自己的浅灰透出来），
         结果 iframe 根透明 → 总入口的壁纸（cover，按**总入口视口**缩放）从 iframe 底下透上来，
         和 iframe 自己 body::before 的壁纸（cover，按 **iframe** 视口缩放）叠成**两张不同大小的同一张图**，
         浅色下看得一清二楚（深色被 #000 挡住，所以「深色正常」）。
         修法：浅色也把根底色刷成 --hx-page(#f5f5f7) —— iframe 变成不透明，父页面壁纸不再透上来；
         同时「壁纸 opacity<100」时透出的底色也统一成全站标准底色，和 B3 的口径一致。
         只给 background-color，不给 background-image：接线仿真外壳会把壁纸用**行内** background 写在 html 上，
         这里再用 background-image:none 会把它那一层砍掉。 */
      + 'html.hx-embedded.hx-bg{background-color:var(--hx-page,#f5f5f7)!important}';
    (document.head || document.documentElement).appendChild(st);

    // （2026-11-17：这里原来还有一份 hx-bgmo-style，给「极光壁纸的柔光呼吸」在 iframe 里补样式。
    //   极光壁纸整体删除时一起删了 —— 没有预设带 motion 标记，那层元素再也不会被创建。）

    // 脚本在 <head> 里跑，此刻 <body> 还没解析出来，有些要往 body 里插东西的初始化做不了。
    // 不补这一下也能成（后面 load + 空闲还会再 apply 一次），但那之前首屏几秒是旧外观 ——
    // 干脆 body 一出来就补，用户几乎看不到那一段。
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', function () { try { apply(); } catch (e) { } });
  }

  // （2026-11-17：这里原来还注入了一份 .hx-bgvid-wrap 样式给视频壁纸用 ——
  //   视频壁纸功能删除后它没有任何元素可挂，一并清掉。背景现在只有「无 / 自己的图」两档，
  //   一律走 body::before 的 --hx-img 静态图。）

  // ── 页面层基础样式（2026-11-08 修「工具页选背景没东西」）──────────────────
  // 背景图要看得见，前提是页面自己别先铺一层不透明底色把它全盖住。
  // 这几条规则原来写在 hx-theme.css 里，但全站只有总入口和刷题引了那份 CSS ——
  // 接线仿真、排课、单片机、考试、加分、课程进度都只引 hx-theme.js，
  // 于是背景层（body::before）根本没铺、视频层（z-index:-2）又被工具页 body 的底色压住，
  // 用户选什么都看不见（「点了没反应」）。所以跟着 JS 注入，全站每个页面都生效。
  //
  // 只在「有东西可看」时才挂（apply() 会按 bg 给 <html> 加 .hx-layer）：
  //   · 背景 = 无 → 不挂，页面保持自己原来的底色（用户要的「干净纯色背景」）；
  //   · 挂上之后：html 铺一层纯色底（--hx-page，跟深浅主题走），body 放透明，
  //     body::before 铺背景图（--hx-img，透明度跟 --hx-bgo）。
  // !important 是必须的：接线仿真外壳会用行内 style 给 body 写背景图，只有 !important 压得住行内样式。
  (function () {
    var ls2 = document.createElement('style');
    ls2.id = 'hx-layer-style';
    ls2.textContent =
      'html.hx-layer{background:var(--hx-page,#f5f5f7)}'
      + 'html.hx-layer body{background:transparent!important}'
      // 背景图层：fixed 铺满视口、垫在内容下面（z-index:-1），浓度跟「背景清晰度」滑杆（--hx-bgo）
      + 'html.hx-layer body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;'
      + 'background:var(--hx-img) center / cover no-repeat;opacity:var(--hx-bgo,1)}'
      // 深色模式压暗：和 hx-theme.css 里同一条 scrim，壁纸太亮时把整页压回来。
      // 浓度跟 --hx-scrim 走（apply 里按 bgo 算）：bgo=100 时 = 0，背景原图直出、不再蒙灰。
      + ':root[data-hx-mode="dark"].hx-layer body::before{background-image:linear-gradient(rgba(8,8,10,var(--hx-scrim,.38)),rgba(8,8,10,var(--hx-scrim,.38))),var(--hx-img)}';
    (document.head || document.documentElement).appendChild(ls2);
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
    + 'background:var(--acc,#2f845a);'
    + 'box-shadow:0 .5em 1.2em -.6em var(--acc,#2f845a);'
    + 'animation:hxPx 1.15s var(--hx-ease,cubic-bezier(.32,.72,0,1)) infinite;animation-delay:calc(var(--i) * 90ms)}'
    // 2026-11-14 用户「统一颜色」：原 .hx-px i:nth-child(2n) 用 --acc2 让偶数方块比奇数更浅，
    // 一排方块明暗交替，深色下被看成「颜色不一致」。这里去掉，全排方块统一用主题色 --acc，
    // 深浅/明暗只由动画的 opacity（0.55~1）驱动，是同一色的呼吸，不再有色相/明度跳变。
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
    // 药丸本体（2026-11-14 用户「去掉外围封闭椭圆方框」：不再画胶囊底/描边/圆角/阴影，
    // 只留方块 + 文字裸排在背景上，和期望图一致。文字色用 --hx-ink 跟深浅主题走，深色下浅字、
    // 浅色下深字，不再出现「深色模式还顶着黑字」或各工具 --ink 各写各的色差）。
    + '.hx-loadpill{display:inline-flex;align-items:center;gap:.7em;'
    + 'color:var(--hx-ink,#1d1d1f);'
    + 'font-size:clamp(15px,.85vw + 6px,30px);line-height:1;'
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
  // 滑杆区间（2026-11-13 用户拍板「两端各扩 50%」）：两根滑杆都从 0~100 扩到 -50~150。
  // 所以取值钳制范围同步扩到 -50~150；原来钳 0~100 会把 -50 和 150 都拍回 0/100，
  // 用户拖到 120% / -30% 写进去又被读回来钳掉，表现为「上下限不够、拖了没反应」。
  // 滑杆区间（2026-11-13 用户拍板「两端各扩 50%」）：两根滑杆都从 0~100 扩到 -50~150。
  // 2026-11-17 用户要求「对全站卡片通透度上限增加 100%」：clr 的上限再放到 250
  //   （150 → 250，正好是「比原来最透再透一倍」：hx_a 0.5 → 0）。bgo 不动 ——
  //   它上游是 Math.min(1, bgo/100)，超过 100 本来就没有更多可放的东西，放宽只会让滑杆骗人。
  // 所以钳制范围分档：给 hi 参数，不传就是老口径。
  function clampRange(n, d, hi) { return Math.min(hi === undefined ? 150 : hi, Math.max(-50, isFinite(n) ? n : d)); }
  // 当前界面的名字。VER 8 之后它只是对外的标识（HXTheme.surface / 日志用），
  // 读设置时不再区分界面 —— 全站就一份外观（见下面 migrateGlobal）。
  var SURF = tool || 'home';
  // ── 有哪些字段属于「外观」──────────────────────────────────────────────
  // 只列这六个：acc 主题色 / mode 深浅 / bg 背景 / clr 卡片通透度 / bgo 背景清晰度 / wm 校徽水印。
  // 为什么要有这么一张表：迁移和写入都只认这六个，老存档里的 wx（已删的像素动效）、op（旧滑杆语义）
  // 之类不会再被抄进新存档，以后也不会因为「顺手 for in」把不相干的字段带进云端快照。
  var GKEYS = ['acc', 'mode', 'bg', 'clr', 'bgo', 'wm', 'glass'];

  // ── VER 8 全局化迁移（2026-11-13）────────────────────────────────────
  // 背景：VER 5/6 把外观拆成了「首页一把（hx-theme）+ 每个工具一把（hx-theme:s:<tool>）」，
  // 用户现在要求「只存在一个主题控制 全局控制」，所以这六个字段全部收回 hx-theme 一把键。
  // 于是升级时要做的唯一一件事：把散在各处的老存档合成一份。合并规则（顺序 = 优先级）：
  //
  //   ① 基准 = 旧全局键 hx-theme（首页那份）。字段最全，也最可能是用户最近一次动过的地方。
  //   ② 基准里**没有**的字段，才去各 hx-theme:s:* 里补，取第一个有这个字段的值；
  //      home 的界面键（hx-theme:s:home）排在最前 —— 那是外观面板在首页改出来的那一份，
  //      比某个工具页的存档更接近「用户总的口味」，顺序也就固定下来（不随浏览器存储顺序漂）。
  //      为什么一定要补：老首页存档里可能根本没有 clr / bgo（这两项一直只存在界面键里），
  //      不补的话用户调过的通透度会在升级那一瞬间跳回默认，「他的设置被我弄丢了」。
  //   ③ 水印 wm 是例外，**不从工具键继承**：工具页的 wm 旧默认就是 0（隐藏），
  //      继承过来等于把「当年没开过」当成用户主动选了「关」，正好和这一版「水印默认显示」相反。
  //      所以 wm 只认首页那份，首页没写过就落新默认 1。
  //   ④ 「值还等于旧默认」的字段换成新默认（用户要「默认给全部用户使用」）：
  //        acc 'green'（旧默认绿）→ 'mono'（用户要的白色主题色，深色下就是 #f5f5f7）
  //      只迁这一条，而且**只在值等于旧默认时**迁。用户显式选过别颜色的原样保留 ——
  //      无差别覆盖会把老师辛苦挑的配色和背景一起冲掉，那比「默认不统一」糟得多。
  //   ⑤ 写回 hx-theme 并标 ver = 8。旧的 hx-theme:s:* **不删**（万一要回滚），但此后不再读。
  //
  // 幂等：迁完 ver = 8；下次进来在预检那一步就返回存档，不再合并、不再改值、也不再写盘。
  // 内存缓存 migDone 在 prefApplyData（云端快照铺下来）和 storage 事件之后清掉 ——
  // 云端存的可能是旧结构（hx-theme + hx-theme:s:* + hx-lite），不清缓存就吃不到那份合并。
  var migDone = false, migVal = null;
  function resetMig() { migDone = false; migVal = null; }
  // 收集所有旧界面键（hx-theme:s:*），home 排最前，见规则 ②
  function toolSnaps() {
    var home = null, out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(SKEY) !== 0) continue;
        var v = jparse(localStorage.getItem(k));
        if (!v) continue;
        if (k === SKEY + 'home') home = v; else out.push(v);
      }
    } catch (e) { }
    if (home) out.unshift(home);
    return out;
  }
  // 只补「基准没有的」字段：不能覆盖基准已有的值，否则基准就白当了
  function fill(dst, src, skipWm) {
    for (var i = 0; i < GKEYS.length; i++) {
      var k = GKEYS[i];
      if (skipWm && k === 'wm') continue;
      if (dst[k] === undefined && src[k] !== undefined) dst[k] = src[k];
    }
    return dst;
  }
  function migrateGlobal() {
    if (migDone) return migVal;
    migDone = true; migVal = null;
    var raw = ls(KEY), base = null, snaps = toolSnaps();
    // 极老的存档是 'day' / 'night' 这样的主题名（见 OLD 表），不是 JSON
    if (raw && OLD[raw]) base = { acc: OLD[raw].acc, mode: OLD[raw].mode };
    else if (raw) base = jparse(raw);
    // 2026-11-17：极光壁纸彻底删除。老存档（不管 ver 是几）里残留的 'aurora' 就地改写成「无」，
    // 顺带写回盘 —— 否则 ver 已经是 8 的存档会走下面那条「原样返回」，字符串一直留着，
    // 将来某次读不到 BG 表就会落成空白背景（get() 现在能兜到 none，但存档该干净就干净）。
    if (base && base.bg === 'aurora') {
      base.bg = 'none';
      try { ls(KEY, JSON.stringify(base)); } catch (e) { }
    }
    // 已经是 VER 8 的结构：原样用，一个字节都不改（这就是幂等的落点）
    if (base && (+base.ver || 0) >= VER) { pruneOldSnaps(); migVal = base; return base; }
    // 全新用户（既没有全局键也没有任何界面键）：什么都不写，get() 直接落默认值。
    // 不写盘的好处是「没动过外观的人」localStorage 里干干净净，以后改默认也不会被旧快照挡住。
    if (!base && !snaps.length) return null;
    if (!base) base = {};
    // 下面这条是 VER 7 之前写在 get() 里的老迁移，现在一次性落进存档，省得每次读都算
    if (raw && !base.ver && base.bg !== 'custom') base.bg = DEF.bg;
    if (!BG[base.bg]) delete base.bg;          // 已下架的背景（aurora / bear / cat / …）：让工具键有机会补一个合法值
    for (var i = 0; i < snaps.length; i++) fill(base, snaps[i], true);
    if (base.acc === 'green') base.acc = DEF.acc; // 规则 ④：只迁「还是旧默认绿」的
    if (base.wm === undefined) base.wm = DEF.wm;  // 规则 ③：没关过 = 显示
    var out = { ver: VER }, j;
    for (j = 0; j < GKEYS.length; j++) if (base[GKEYS[j]] !== undefined) out[GKEYS[j]] = base[GKEYS[j]];
    try { ls(KEY, JSON.stringify(out)); } catch (e) { }   // 无痕模式 / 配额满：迁不动也不该让页面崩
    // 迁移定稿（ver=8）后，旧分键 hx-theme:s:* 不再被读取，就地清除 —— 否则它们会一直残留在本机，
    // 在后续任何「主键短暂缺失」的竞态窗口里把旧默认色（mono/green）污染回主键（2026-11-14 根治）。
    pruneOldSnaps();
    migVal = out;
    return out;
  }
  // 外观就一份：get() 不再分界面，谁调、在哪个页面调，拿到的都是同一套。
  function get() {
    var g = migrateGlobal() || {};
    var s = {
      bg: BG[g.bg] ? g.bg : DEF.bg,
      // 校徽水印：只认显式写过的「关」，其余一律开（本版默认显示，用户要水印显示）。
      wm: (g.wm === 0 || g.wm === '0' || g.wm === false) ? 0 : 1,
      acc: ACC[g.acc] ? g.acc : DEF.acc,
      // 深浅（2026-11-11 起没有 auto 档）：老存档里存的 'auto' 不再跟系统跑，一律落成默认深色
      //   （用户原话「主题自动…不需要给用户切换，默认深色主题」）；非法值同样落默认。
      mode: /^(light|dark)$/.test(g.mode) ? g.mode : DEF.mode,
      // 卡片通透度（2026-11-05 翻转语义）：100 = 默认的清透玻璃，越大越透，0 = 实色卡。
      // 上限 250（2026-11-17 用户要「上限增加 100%」）—— 那一点上 hx_a 正好降到 0，卡片完全透明。
      clr: clampRange(+g.clr, DEF.clr, 250),
      // 背景清晰度：100 = 原样显示（最清楚），0 = 背景几乎看不见、只剩页面底色。
      bgo: clampRange(+g.bgo, DEF.bgo),
      // 毛玻璃开关（2026-11-19 T7④）：只认显式写过的「开」，其余一律关（默认全透明）。
      glass: (g.glass === 1 || g.glass === '1' || g.glass === true) ? 1 : 0
    };
    if (s.bg === 'custom' && !ls(IMG)) s.bg = DEF.bg;
    if (BG[s.bg].dev && !isDev()) s.bg = 'none'; // 开发者专属背景：别的账号（或没登录）回落到无背景
    return s;
  }
  function isDev() { return ls(DEV) === '1'; } // 总入口查到 hx_me().dev 后记下（见 setDev），各工具打开时据此决定能不能用专属背景
  function setDev(on) { if (isDev() === !!on) return; ls(DEV, on ? '1' : null); apply(); }
  // 深浅：2026-11-11 起没有 auto 档，get() 已经保证只可能是 light / dark，这里只做兜底透传。
  function modeOf(s) { return s.mode === 'light' ? 'light' : 'dark'; }
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
    /* 2026-11-11 用户定：**极简模式是默认**。
       原话「省电模式改名叫极简模式并作为默认，然后想看特效就选择隔壁的标准模式」。
       所以读不到偏好时不再按机器猜、也不再把 4 核机误伤成省电 —— 一律先给极简（稳、不烫），
       谁想要特效去外观面板点「标准模式」，那台机器就记住 '0'，以后每次打开都是标准。 */
    try { if (ls('hx-lite') === '1') return true; if (ls('hx-lite') === '0') return false; } catch (e) { }
    return true;   // ← 默认极简（2026-11-11）
  }
  /* 按当前 localStorage 重新切一次档（类 + 通知）。
     为什么需要它：上面这一行在**模块加载那一刻**就定档了，而账号偏好（hx_pref 云端快照）
     往往比它晚到 —— 首帧读不到就落默认极简。快照铺下来之后如果不重切，
     账号明明是「标准模式」，这一页仍按极简渲染，非得刷新一次才对。
     2026-11-17 用户报「我账号用的是标准模式，怎么部分工具全是极简」就是这么来的：
     总入口先开→铺快照→只写了 localStorage 没重切；后加载的 iframe 反而读到 '0' 是标准 → 两处不一致。 */
  function syncLite() {
    try {
      var on = liteOn();
      document.documentElement.classList.toggle('hx-lite', on);
      dispatchEvent(new CustomEvent('hx-lite-change', { detail: { lite: on } }));
      return on;
    } catch (e) { return false; }
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
  // ── 背景层（2026-11-04 建视频壁纸 → 2026-11-17 整体改成静态图 → 同日连极光一起删）──────
  // 现在只剩一条链路：`--hx-img` 交给 body::before 铺（cover + --hx-bgo 透明度）。
  // 背景只有两档：**无 / 自己的图**（用户原话「极光壁纸彻底清除」）。
  //
  /* ── 2026-11-17：视频壁纸功能整体删除（用户原话「视频背景功能删除」「死代码也删除」）──
     删掉的东西：双 <video> 交叉淡入（bgMake / bgSwap / bgStep / bgRun / bgStopAll / bgDrop）、
     620 KB mp4 的延后加载（bgVidReady）、820px 断点降级、自动播放被拒的降级、
     总入口开工具时的 bgPause / bgHold，以及配套的 .hx-bgvid-wrap 样式注入。
     为什么删：它是全站唯一「能不能出画面看运气」的东西 —— 解码失败、自动播放被拦、
     网络没下完都会变成一块黑（2026-11-16 那次「标准模式没背景」正是这么来的）；
     还要 620 KB 流量加一路持续解码。而用户自己用的是上传的静态图，这条路径根本用不到。

     ── 同一份文件里，极光那套「静态壁纸缓慢呼吸」也一起删了 ──
     它原本是给 BG.aurora 那一档挂 .hx-bgmo 两团柔光 + body::before 的 ken burns（34s 缩放）。
     BG.aurora 删除后没有任何预设带 motion 标记，bgMotion() 永远不会被打开，
     留在代码里只会让人以为「还有动态壁纸这回事」。整套（函数 / 调用 / 样式 / CSS 那一段）全部移除。 */

  /* lastLook：apply() 每次算完顺手存一份「机器可读的外观」，供 hxLookNow() 交给子页面。
     为什么不在 hxLookNow() 里重算一遍：公式（--hx-a 的线性式、bgo 的 clamp、img 三种来源）
     只能有一处，重算就是迟早不一致。这里只做搬运。 */
  var lastLook = null;
  function apply() {
    // get() 现在读的是全站唯一一份外观（VER 8）：顶栏、首页、工具页、工具 iframe 天生同一套，
    // 不会再有「上面深色条、下面浅色页」或者「首页换了颜色、工具里还是老的」这种拼接感。
    var s = get(), m = modeOf(s), a = ACC[s.acc], r = document.documentElement, b = BG[s.bg];
    // 嵌在总入口 iframe 里的工具：不建视频层（见下面分支），背景靠 body::before 自己铺一遍。
    var embedded = !!(tool && window.top !== window);
    var c = m === 'dark' ? a.d : a.l, c2 = m === 'dark' ? a.d2 : a.l2;
    r.setAttribute('data-hx-mode', m); r.setAttribute('data-theme', m); r.setAttribute('data-hx-acc', s.acc);
    r.classList.toggle('hx-bg', s.bg !== 'none');
    r.classList.toggle('hx-wm-off', !s.wm);   // 校徽水印开关（VER 8：全站一份，默认显示）
    // 毛玻璃开关（2026-11-19 T7④）：写 data-hx-glass，CSS 侧据此决定卡片底板透明/模糊。
    //   关闭（glass=0，默认）→ data-hx-glass="off"，卡片底板全透明、无 backdrop-filter、只留文字和描边；
    //   开启（glass=1）→ 无该属性，走现有毛玻璃配方（--card / --glass-wash + backdrop-filter）。
    r.setAttribute('data-hx-glass', s.glass ? 'on' : 'off');
    // 页面层开关：有背景可看时才把 body 放透明、铺页面底色；
    // 背景是「无」时不挂 —— 页面保持自己原来的底色，就是用户要的干净纯色背景。
    // 嵌入时不挂：iframe 里的背景由 hx-embedded 那套规则自己铺（见文件上方），
    // 两边都铺就是双背景，而且 .hx-layer 的 scrim 会和嵌入那条叠成两层灰。
    r.classList.toggle('hx-layer', !embedded && s.bg !== 'none');
    // 2026-11-17 视频壁纸删除后，--hx-img 就是那张静态图本身。
    // 注意 --hx-img 必须给真地址、不能给 'none'：接线仿真这类「画布不透明的工具」靠读
    // --hx-img 拿到背景图地址（theme.js 的 hxLook 通道），给 none 它背景就永远是纯色。
    var img = s.bg === 'custom' ? 'url("' + ls(IMG) + '")' : b.img ? 'url("' + root + b.img + '")' : b.css || 'none';
    // --hx-a：玻璃浓度乘数（各条玻璃配方的 alpha 都乘它）。
    // 2026-11-05 随通透度滑杆翻转语义：100（最透）= 1，正好是 2026-11-04 定稿的那套清透玻璃；
    // 往下调卡片变实：0 = 2，各配方 alpha × 2 后被浏览器钳到 1，整卡变成实色（保可读的兜底端）。
    // 2026-11-13 滑杆扩到 -50~150：这个线性式自然覆盖两端 —— 150 → 0.5（更透）、-50 → 2.5（更实）。
    // 不必再单独钳 hx_a：极透端 alpha 变小本就无害，极实端被浏览器钳到 1 正是「实色卡」兜底。
    // 2026-11-15 用户定（原话「对 与壁纸无关」）：拆掉 "没壁纸就锁 1" 这条门槛。
    //   卡片通透度管的是**卡片玻璃本身**（全站每张卡，含接线仿真画布上画的卡），背后有没有壁纸
    //   跟它无关；外观面板也已同步改成**始终显示**这根滑杆（总入口/index.html「卡片通透度」那节）。
    //   两处必须一起改：只放开这里不改面板 → 有壁纸时调很透、再切回「无背景」，滑杆消失却仍是半透明，
    //   用户没入口改回来（死锁）；只改面板不改这里 → 没壁纸时拖滑杆毫无反应（正是用户报的「只动顶栏」）。
    //   没壁纸时变透，透出来的是页面底色（浅色下还有 body::after 那三团淡彩光），观感成立。
    /* 2026-11-17：上限放到 250 之后，这个线性式会算出负数（250 → -0.5）。
       负值一旦进了 `rgb(… / calc(.7 * var(--hx-a)))`，整条声明就作废，卡片背景直接没了
       —— 不是「更透」，是变成完全没上色的元素，边框阴影还在，看着像坏图。
       所以钳到 0：250 = 卡片真的全透明（只剩文字和边框），这正是「上限再透一倍」的意思。 */
    var hx_a = Math.max(0, 1 + (100 - s.clr) / 100);
    // ── 背景清晰度（bgo）滑杆：直映到背景层不透明度 ──
    // 2026-11-08 修用户报障「拉满还是浅浅雾蒙蒙 / 透明度没有真实到 0-100」：
    // 原来浅色整体压到 14%，滑杆拉满也只有 14% —— 现在两个模式都是 100% = 原样、0% = 几乎全无。
    // 2026-11-13 滑杆扩到 -50~150：150% 再往上没有意义（「原样」就是 1.0，封顶），
    // 所以这里 clamp 到 0~1，别让 150% 变成 1.5 的不透明度。清晰度往右到 150 只是「把 scrim 压到 0 之外
    // 还稍微提亮」，观感靠 scrim 那支体现（见下），bgo 本体封顶 1.0。
    var bgo = Math.min(1, Math.max(0, s.bgo / 100));
    // 深色 scrim（壁纸太亮时压暗）随 bgo 一起收：bgo=100 时 scrim=0，背景原图直出、不再蒙灰。
    // 150% 时 (1-bgo) 已经是负值，clamp 到 0 —— 清晰度拉满就是「一点灰都不蒙」，不会出现负 scrim 反白。
    var scrim = m === 'dark' ? Math.max(0, (1 - bgo) * 0.38) : 0;
    var vars = { '--acc': c, '--acc2': c2, '--acc3': c2, '--acc-h': c2, '--on-acc': s.acc === 'mono' && m === 'dark' ? '#1d1d1f' : '#fff',
      '--accbg': 'color-mix(in srgb, ' + c + ' 14%, transparent)', '--ring': 'color-mix(in srgb, ' + c + ' 40%, transparent)',
      '--hov': 'color-mix(in srgb, ' + c + ' 10%, transparent)', '--hx-a': hx_a, '--hx-img': img, '--hx-bgo': bgo, '--hx-scrim': scrim,
      // --hx-page：挂 .hx-layer 时 html 铺的纯色底（跟深浅主题走）。工具页各有各的底色调子，
      // 这里统一成主题的标准底色 —— 只在「有背景/动效可看」时才露出来，无 + 无 时页面还是自己的底色。
      '--hx-page': m === 'dark' ? '#000' : '#f5f5f7',
      // --hx-ink：全站统一正文色（跟深浅主题走）。加载药丸等跨页元素用它做文字色，
      // 不再依赖各工具页自己定义的 --ink/--text（有的深色有的浅色，导致「深色下颜色不一致」）。
      '--hx-ink': m === 'dark' ? '#f5f5f7' : '#1d1d1f' };
    for (var k in vars) r.style.setProperty(k, vars[k]);
    // 机器可读的那一份（见上面 lastLook 的注释）。img 给的是完整的 `url("…")`，
    // 因为下游（接线仿真 theme.js）直接拿它拼 CSS 简写：`HXL.img + ' center / cover no-repeat'`。
    lastLook = { acc: c, acc2: c2, a: hx_a, bgo: bgo, img: img, mode: m };
    r.classList.remove('hx-bgblur'); // 旧版挂的「预糊图」标记，现在没有任何样式依赖它，清掉防止老缓存残留
    r.classList.remove('hx-bg-mo');  // 极光删除后不再有动态壁纸；清掉旧页面可能残留的呼吸类，别让它挂着空转
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', m === 'dark' ? '#000000' : '#f5f5f7');
    try { ls('zfz-practice-theme', m); ls('wanxiu-paike-theme', m); ls('ui.theme', JSON.stringify(m)); } catch (e) { }
    for (var i = 0; i < subs.length; i++) try { subs[i](s, m); } catch (e) { }
  }
  // set(patch)：改外观 = 改**那唯一一份**全局设置（VER 8）。
  // 起点必须是「迁移之后的当前值」而不是原始存档：用户第一次改设置的这一下，顺手就把散在
  // hx-theme:s:* 里的老设置合并进来了，不会出现「在首页改了个主题色，工具页里那份又被丢下没迁」。
  // 换背景时不再自动改卡片通透度（老版会把 op 拉到该背景的「推荐值」）：通透度是用户自己的设置。
  function set(patch) {
    var g = migrateGlobal() || {}, n = {}, i, k;
    for (i = 0; i < GKEYS.length; i++) { k = GKEYS[i]; if (g[k] !== undefined) n[k] = g[k]; }
    // 只收 GKEYS 里的字段：老调用点万一还传了 wx / op 这类字段，别让它们再进存档
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k) && GKEYS.indexOf(k) >= 0) n[k] = patch[k];
    n.ver = VER;
    try { ls(KEY, JSON.stringify(n)); } catch (e) { }
    // 缓存必须作废：下一次 get() 要读刚写下去的这份（否则同一次会话里读到的是改之前的值）
    resetMig();
    apply();
    prefPush();   // 外观改了 → 防抖推一份到账号（没登录时它是空操作）
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
    cloudDel(id);              // 云端那一行也删掉，否则换台设备又冒出来
    return list;
  }
  function useImg(id) {
    var list = imgs(), hit = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) hit = list[i];
    if (!hit) return false;
    ls(IMG, hit.data);
    set({ bg: 'custom' });
    cloudPick(id);
    return true;
  }
  /* ── 上传背景的云端同步（2026-11-09 用户要求「上传的背景需要支持跨设备通用」）──────────
     原来相册只住在 localStorage（hx-theme-imgs / hx-theme-img），换设备、换浏览器、清一次缓存就全没了。
     现在登录后云端也存一份（表 public.hx_bg，RLS 只认本人，一人最多 6 张）：
       · 传新图 → 立刻插一行；插完把本地那条的 id 换成云端 id（以后删除/切换才认得上）；
       · 删一张 → 删云端那一行；
       · 换当前 → 把 cur 标到那一行（先把别人的 cur 清掉），新设备一登进来就是这张；
       · 打开页面（idle 后）、打开外观面板 → 拉一次目录（只取 id/cur/时间，几十字节），
         和本地指纹对不上才去下载图片本体，正常情况一个请求都不多。
     本地那份不删：离线、慢网、没登录时照旧能用，它降级成「缓存」。
     失败一律安静（.catch 吞掉）：这是锦上添花的功能，不该因为它让上传/切背景失败。 */
  var SUPA = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co',
    SKEY_PUB = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd',
    BG_TBL = '/rest/v1/hx_bg', BG_SIG = 'hx-bg-sig', cloudRun = null;
  function bgTok() { try { var s = JSON.parse(ls(SKEY_SESS) || 'null'); return (s && s.access_token) || ''; } catch (e) { return ''; } }
  function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
  function bgApi(path, o) {
    o = o || {};
    var t = bgTok(); if (!t) return Promise.reject(new Error('没登录'));
    var h = { apikey: SKEY_PUB, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
    if (o.prefer) h.Prefer = o.prefer;
    return fetch(SUPA + BG_TBL + path, { method: o.method || 'GET', headers: h, cache: 'no-store', body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (x) { throw new Error((x || '').slice(0, 140) || ('HTTP ' + r.status)); });
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
  }
  // 拉云端目录 → 只补本地缺的那几张 → 清掉别处删过的 → 重画一次（面板靠 onChange 自己刷新）
  // 增量而不是「整本重下」：相册最多 6 张、每张几十万字符，全量拉一次就是好几 MB，
  // 每次切个背景都重下完全没必要（2026-11-09 第一版就是这么亏的，实测同一页发了 3 次全量 GET）。
  var BG_SEED = 'hx-bg-seed';
  function cloudSync() {
    if (!bgTok()) return Promise.resolve(false);
    if (cloudRun) return cloudRun;            // 同一时刻只跑一趟，排队的一起等它
    cloudRun = bgApi('?select=id,cur,created_at&order=created_at.desc&limit=6')
      .then(function (rows) {
        rows = rows || [];
        var local = imgs(), have = {}, keep = {}, ord = {}, curId = '';
        for (var i = 0; i < local.length; i++) have[local[i].id] = 1;
        for (var j = 0; j < rows.length; j++) {
          keep[rows[j].id] = 1; ord[rows[j].id] = j;
          if (rows[j].cur) curId = rows[j].id;
        }
        // 云端一张都没有，本地却有旧图（这版之前传的）：先把本地的推上去，老用户换设备也能看到。
        // 只做一次（BG_SEED 记住），失败下次进来再试。
        if (!rows.length && local.length && !ls(BG_SEED)) {
          return seedLocal(local).then(function () { cloudRun = null; return cloudSync(); });
        }
        var sig = rows.map(function (x) { return x.id + (x.cur ? '*' : ''); }).join('|');
        if (sig === ls(BG_SIG)) return false;
        // 本地清单：云端没有的（在别的设备删了）去掉；id 还是 m... 的（没同步过的）留着
        var list = local.filter(function (x) { return !isUuid(x.id) || keep[x.id]; });
        var miss = [];
        for (var k = 0; k < rows.length; k++) if (!have[rows[k].id]) miss.push(rows[k].id);
        var done = function () {
          saveImgs(list);
          ls(BG_SIG, sig);
          // 云端标记的「当前这张」：本地有就铺上 —— 换设备第一次登录就是同一张背景
          for (var n = 0; n < list.length; n++) if (curId && list[n].id === curId) { try { ls(IMG, list[n].data); } catch (e) { } }
          try { apply(); } catch (e) { }
          return true;
        };
        if (!miss.length) return done();
        return bgApi('?select=id,data,created_at&id=in.(' + miss.join(',') + ')').then(function (full) {
          (full || []).forEach(function (x) { if (x && x.data) list.push({ id: x.id, data: x.data, at: Date.parse(x.created_at) || Date.now() }); });
          list.sort(function (a, b) { return (ord[a.id] == null ? 99 : ord[a.id]) - (ord[b.id] == null ? 99 : ord[b.id]); });
          return done();
        });
      })
      .catch(function () { return false; })
      .then(function (v) { cloudRun = null; return v; });
    return cloudRun;
  }
  // 把本地以前传的图逐张推上云（这版之前只有一个本地格子，用户手里可能已经攒了几张）
  function seedLocal(local) {
    var q = Promise.resolve();
    for (var i = 0; i < local.length; i++) {
      (function (it, idx) {
        if (isUuid(it.id)) return;
        q = q.then(function () {
          return bgApi('', { method: 'POST', prefer: 'return=representation', body: [{ data: it.data, cur: idx === 0 }] })
            .then(function (r) {
              var row = r && r[0];
              if (!row || !row.id) return null;
              var list = imgs();
              for (var j = 0; j < list.length; j++) if (list[j].data === it.data) list[j].id = row.id;
              saveImgs(list);
              return null;
            }).catch(function () { return null; });
        });
      })(local[i], i);
    }
    return q.then(function () { try { ls(BG_SEED, '1'); } catch (e) { } return true; });
  }
  function cloudAdd(data) {
    if (!bgTok()) return;
    // cur 直接给 true：新传的图一定是要用的那张
    bgApi('', { method: 'POST', prefer: 'return=representation', body: [{ data: data, cur: true }] })
      .then(function (r) {
        var row = r && r[0]; if (!row || !row.id) return;
        var list = imgs(), hit = null;
        for (var i = 0; i < list.length; i++) if (list[i].data === data) hit = list[i];
        if (hit && hit.id !== row.id) { hit.id = row.id; saveImgs(list); }
        cloudPick(row.id);       // 先清掉别人的 cur，再置这张
      })
      .catch(function () { });
  }
  // PostgREST 的 PATCH 走 URL 过滤：先把所有 cur=true 的清掉，再置这一张
  function cloudPick(id) {
    if (!bgTok() || !isUuid(id)) return;
    bgApi('?cur=is.true', { method: 'PATCH', body: { cur: false } })
      .then(function () { return bgApi('?id=eq.' + id, { method: 'PATCH', body: { cur: true } }); })
      .then(function () { setTimeout(cloudSync, 400); })
      .catch(function () { });
  }
  function cloudDel(id) {
    if (!bgTok() || !isUuid(id)) return;
    bgApi('?id=eq.' + id, { method: 'DELETE' })
      .then(function () { setTimeout(cloudSync, 400); })
      .catch(function () { });
  }
  /* ── 外观设置跟账号走（2026-11-11 用户要求）─────────────────────────────────
     用户原话：「用户更改设置一定是跟着用户账号绑定到带走的，包括主题背景，不能被别人账号覆盖」。
     要做到三件事：
       ① 换设备 / 换浏览器，只要登同一个账号，外观（主题色 / 深浅 / 背景 / 水印 /
          两根滑杆 / 极简-标准模式）都得跟着回来。VER 8 起外观只有一份，所以这里存的
          就是那一份；老的「每个工具页各自一份」只在铺下来时被迁移读一次（见 prefApplyData）；
       ② 同一台机器上换个人登录，看到的必须是**他自己**的外观，不能是上一个人改的；
       ③ 谁的设置都改不到别人头上 —— 这条由数据库兜底（表 public.hx_pref 的 RLS 只认本人，
          行主键 owner = auth.uid()，A 在物理上就写不到 B 那一行）。

     云端存什么：**只存设置快照**（键值对，几百字节 ~ 几 KB），键名就是 localStorage 的键名。
     背景图片本体**不进快照**（一张几 MB，进 jsonb 会把行撑爆）：图仍由 public.hx_bg 按张存，
     快照里只留 bg:'custom' 这个指向，cloudSync 会按 cur 把图补下来（上面那段逻辑）。

     本地怎么隔离两个账号：另外记一个「这套外观现在属于谁」的记号 hx-pref-owner（存 user id）。
     记号一变（登录 / 换人 / 退出）就先把本地这份归档到 hx-pref-bak:<旧owner>，再换上新的那份：
       · 新账号在本机有归档 → 先铺上归档，随后云端那份会覆盖它（云端才是权威）；
       · 新账号本机从没登录过 → 先清成默认，随后云端那份覆盖它（没有云端行就把默认推上去当初始）；
       · 退出登录 → 回到本机「匿名」那份（没有就默认），登录页不残留上一个人的样子。 */
  /* ── 账号云端（2026-11-19 用户要求「换电脑就看不到的东西，包括 api key，都跟账号走」）──
     hx-cloud.js（根目录，挂 window.HXC）是这一轮的地基：同一个 public.hx_pref.data 里除了外观，
     还住着 AI 配置 / 每把 Key / 回收站清单。以前这里只会「整行 upsert 一份外观快照」，
     只要别人往同一行写过键，外观一改就把人家整行盖掉 —— 所以推送改走 HXC.prefMerge（读-合并-写）。
     这里同时是**降级点**：hx-cloud.js 没加载出来（离线单文件、老缓存混搭、网络挂了、被 CSP 拦）
     就一律退回原来的老路（整行 upsert / 只铺外观），外观功能绝不能因为云端那一层而坏掉。

     下面两张表决定「谁跟账号走」，键名只在这里写一遍，别处一律调 isExtraKey()：
       · 外观键（KEY / hx-lite / 老的 hx-theme:s:*）—— 由 prefKeys() 收，还是老逻辑；
       · 额外键 —— 不参与外观判断，只跟着账号铺 / 清：
           hx-ai-v1        AI 配置（平台 + 模型 + 工具指向）
           hx-ai-key:*     AI 的 Key（只有勾了「记住」的才会落进 localStorage，才会被这里看到）
           hx-recycle-v1   首页回收站里「试卷库 / 教材」两类的清单（读写由回收站页做）
     同一台机器上换个人登录，这批键必须跟着外观一起清掉 —— 否则上一个人的 Key 会留在本机，
     正是用户这次要消灭的东西。 */
  var CLOUD_EXTRA_KEYS = ['hx-ai-v1', 'hx-recycle-v1'],
    CLOUD_EXTRA_PREFIX = ['hx-ai-key:'];
  function isExtraKey(k) {
    if (!k) return false;
    if (CLOUD_EXTRA_KEYS.indexOf(k) >= 0) return true;
    for (var i = 0; i < CLOUD_EXTRA_PREFIX.length; i++) if (k.indexOf(CLOUD_EXTRA_PREFIX[i]) === 0) return true;
    return false;
  }
  function extraKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (isExtraKey(k)) out.push(k); }
    } catch (e) { }
    return out;
  }
  function extraSnapData() {
    var d = {};
    try { extraKeys().forEach(function (k) { var v = localStorage.getItem(k); if (v != null) d[k] = v; }); } catch (e) { }
    return d;
  }
  /* 把 hx-cloud.js 拉进来（和本文件同目录的经典脚本）。
     为什么要在这里拉：首页和各工具页只引了 hx-theme.js，没人为 hx-cloud.js 加 <script>
     （index.html 不归这次改，7 个工具页更不该一家一家去改）。等价于「谁引了外观，就自动带上云端那一层」。

     约束（2026-11-19 定的，别改）：
       · 幂等：window.__HXC_P 是「本次注入」的共享 promise，hx-ai.js 看到它就直接复用，不会注两遍；
         window.__hxcLoad = 'loading' / true / false 是状态标记。
       · 可重试但不无限重试：失败时把 __HXC_P 清掉、__hxcLoad 置 false，下一次调用可以再来一次；
         但每页最多 2 次（__hxcTry），防止脚本真的 404 时被几十次写操作反复注入。
       · 不阻塞：任何调用方都不会被它 await 住（最坏 4 秒后一定 resolve）。
       · 路径只用「本脚本自己的 src」（document.currentScript）推导；**拿不到 src 就直接不加载**，
         绝不拿 location 去猜 —— 内联 / data: 离线单文件本来也没有同目录可拼。
     cloudReady 一定会 resolve（成功 true / 失败 false），失败就当没这回事走老路。 */
  var CLOUD_SRC = '';
  try { CLOUD_SRC = (document.currentScript && document.currentScript.src) || ''; } catch (e) { CLOUD_SRC = ''; }
  function cloudLoad() {
    if (window.HXC) return Promise.resolve(true);
    if (window.__HXC_P) return window.__HXC_P;                  // 正在注入：共用同一个 promise
    if (!CLOUD_SRC) return Promise.resolve(false);              // 拿不到 src（内联 / 离线单文件）：不加载
    var base = String(CLOUD_SRC).replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    if (!/^https?:/i.test(base)) return Promise.resolve(false);
    window.__hxcTry = (window.__hxcTry || 0) + 1;
    if (window.__hxcTry > 2) return Promise.resolve(false);     // 每页最多试 2 次，404 时别被写操作反复注入
    var el = document.createElement('script'), done = false;
    window.__hxcLoad = 'loading';
    var p = new Promise(function (ok) {
      function fin(v) { if (done) return; done = true; ok(v); }
      el.onload = function () { window.__hxcLoad = !!window.HXC; window.__HXC_P = null; fin(!!window.HXC); };
      el.onerror = function () { window.__hxcLoad = false; window.__HXC_P = null; fin(false); };  // 404 / 断网：走老路
      // 超时只 resolve(false)，**不解除占用**、也不判定失败：脚本可能只是慢，
      // 解除了会让下一次调用再注一遍，等于把 hx-cloud.js 跑两遍。真要失效，等它 error 或下次刷新。
      setTimeout(function () { fin(false); }, 4000);
    });
    el.src = base + 'hx-cloud.js';
    window.__HXC_P = p;
    (document.head || document.documentElement).appendChild(el);
    return p;
  }
  var cloudReady = cloudLoad();
  var PREF_TBL = '/rest/v1/hx_pref', POWN = 'hx-pref-owner', PBAK = 'hx-pref-bak:', PDIRTY = 'hx-pref-dirty';
  function prefApi(path, o) {
    o = o || {};
    var t = bgTok(); if (!t) return Promise.reject(new Error('没登录'));
    var h = { apikey: SKEY_PUB, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
    if (o.prefer) h.Prefer = o.prefer;
    return fetch(SUPA + PREF_TBL + path, { method: o.method || 'GET', headers: h, cache: 'no-store', body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        if (!r.ok) return r.text().then(function (x) { throw new Error((x || '').slice(0, 140) || ('HTTP ' + r.status)); });
        return r.status === 204 ? null : r.json().catch(function () { return null; });
      });
  }
  // 从登录态里取 user id：优先 user.id；续期回来的会话通常只有 access_token，那就解 JWT 的 sub
  function jwtSub(t) {
    try {
      var p = String(t).split('.')[1]; if (!p) return '';
      p = p.replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '=';
      return JSON.parse(decodeURIComponent(escape(atob(p)))).sub || '';
    } catch (e) { return ''; }
  }
  function prefUid() {
    try {
      var s = JSON.parse(ls(SKEY_SESS) || 'null'); if (!s) return '';
      if (s.user && s.user.id) return String(s.user.id);
      return s.access_token ? String(jwtSub(s.access_token) || '') : '';
    } catch (e) { return ''; }
  }
  // 快照要收哪些键：全局外观键 hx-theme、极简模式开关 hx-lite。
  // 还收旧的 hx-theme:s:* —— 两个原因：
  //   ① 云端老用户的快照里存的就是那套结构，铺下来之后要能被 VER 8 的迁移吃一遍（见下面 prefApplyData）；
  //   ② 铺快照前要把这些旧键清干净，不然「换个账号」时上一个人的分键存档会留在机器上，
  //      被迁移当成基准去补字段。
  // 不收 hx-theme-img / hx-theme-imgs（图片本体走 hx_bg）、不收 hx-dev（服务端算出来的身份）。
  function prefKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k === KEY || k === 'hx-lite' || k.indexOf(SKEY) === 0) out.push(k);
      }
    } catch (e) { }
    return out;
  }
  function prefSnapData() {
    var d = {};
    try { prefKeys().forEach(function (k) { var v = localStorage.getItem(k); if (v != null) d[k] = v; }); } catch (e) { }
    return d;
  }
  function prefApplyData(d) {
    try { prefKeys().forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { }
    if (d) for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) {
      /* 外观键照旧铺；「跟账号走」的额外键（hx-ai-v1 / hx-ai-key:* / hx-recycle-v1）也铺 ——
         换电脑、清缓存之后，AI 配置和 Key 就是靠这一步回来的。
         其余键一律不往本机搬：云端那一行以后可能被别的功能扩进来，本机不该无脑吃下所有东西。
         注意这里**只铺不清**：额外键的清除放在 prefSync 的「换账号」分支里做。
         每次打开页面都先把 AI 的键删一遍太危险 —— 有一次上传失败（断网 / 401），
         下次打开就会把本机唯一那份 Key 清掉，而云端恰好没有。 */
      if (!(k === KEY || k === 'hx-lite' || k.indexOf(SKEY) === 0 || isExtraKey(k))) continue;
      try { localStorage.setItem(k, d[k]); } catch (e) { }
    }
    // 云端存的可能是**旧结构**（hx-theme + hx-theme:s:* + hx-lite，VER 7 及以前推上去的）。
    // 铺下来之后必须让迁移重跑一遍：否则老用户一登录，hx-theme 里还是分键时代的残缺存档
    // （常常只有 bg / wm / ver），主题色和两根滑杆会当场落回默认 —— 用户看到的就是「一登录外观全没了」。
    // 迁移是幂等的，这里多调一次没有任何副作用；新结构的快照（ver=8）进迁移会直接原样返回。
    resetMig();
    // 2026-11-14 修「主题色刷新变白」根治：主键 hx-theme 一旦是 ver=8 的完整结构，旧分键
    // hx-theme:s:* 就完成了历史使命（一次性迁移），必须**当场清除**。否则它们会一直残留在本机，
    // 在「主键短暂缺失 / 换账号清空 / 云端快照恰好缺主键」的任何一个竞态窗口里，被 migrateGlobal
    // 当成迁移基准 —— toolSnaps() 里 hx-theme:s:home（acc 还是旧默认 mono/green）排最前，
    // 会把用户辛苦挑的主题色（blue 等）顶掉，写回 mono 主键。用户看到的就是「选了蓝色、刷新变白」。
    migrateGlobal();   // 触发迁移：主键 ver8 会原样返回；残缺主键会就地合并成 ver8 并写回
    pruneOldSnaps();   // 迁移定稿后清掉旧分键，杜绝后续污染
    // 快照里的 hx-lite 已经写进本机了，**这里必须当场重切一次档** —— 否则这一页还挂着
    // 加载那一刻定下的「默认极简」，账号明明是标准模式也得刷新才生效（2026-11-17 用户报的「部分工具全是极简」）。
    syncLite();
  }
  // 清除所有旧界面分键 hx-theme:s:*（迁移定稿后它们不再被读取，留着只会埋竞态地雷）。
  function pruneOldSnaps() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(SKEY) === 0) localStorage.removeItem(k);
      }
    } catch (e) { }
  }
  function prefOwner() { try { return localStorage.getItem(POWN) || ''; } catch (e) { return ''; } }
  function setPrefOwner(u) { try { if (u) localStorage.setItem(POWN, u); else localStorage.removeItem(POWN); } catch (e) { } }
  function saveBak(u, data) { try { if (u) localStorage.setItem(PBAK + u, JSON.stringify(data)); } catch (e) { } }
  function loadBak(u) { try { var r = u ? localStorage.getItem(PBAK + u) : null; return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function markDirty() { try { localStorage.setItem(PDIRTY, '1'); } catch (e) { } }
  function clearDirty() { try { localStorage.removeItem(PDIRTY); } catch (e) { } }
  /* 推一份外观快照到账号。
     2026-11-19：同一个 data 里住着 AI 配置 / Key / 回收站清单，整行 upsert 会把它们盖掉，
     所以有 window.HXC 时走「读-合并-写」（只 patch 外观那几个键）。
     seed=true：云端连行都没有（这台机器第一次登录），顺手把本机已有的「跟账号走」的键一起送上去 ——
     用户先用了网站、后登录的场景，不至于让他到设置页把 Key 再填一遍。 */
  function prefPushNow(uid, seed) {
    uid = uid || prefUid(); if (!uid) return Promise.resolve(false);
    var snap = prefSnapData();
    if (seed) { var ex = extraSnapData(); for (var k in ex) if (Object.prototype.hasOwnProperty.call(ex, k)) snap[k] = ex[k]; }
    if (window.HXC && window.HXC.prefMerge) {
      return window.HXC.prefMerge(snap).then(function (r) {
        if (!r) return false;                 // 云端故障：不打 dirty，下次再说
        clearDirty(); return true;
      }, function () { return false; });      // 契约上不 reject，这里仍然兜一层
    }
    /* 兜底（hx-cloud.js 没加载出来：404 / CSP / 离线单文件）：也**不能整行盖**。
       同一个 data 里躺着 AI 配置、每把 Key、回收站清单，整行 upsert 会把它们一起冲掉 ——
       「云端那一层没到位」不等于「用户的 Key 可以丢」，这条降级路径同样得是合并写。
       所以：先 GET 当前行 → {...当前, ...外观快照} → upsert，只 patch 外观那几个键。
       只有连当前行都读不出来（404 / 断网 / 401）才退回改前的整行 upsert：
       那种情况下至少外观还能存上，而云端本来也读不到、谈不上「覆盖别人的键」。 */
    return prefApi('?select=data&owner=eq.' + uid + '&limit=1')
      .then(function (rows) {
        var cur = rows && rows[0] && rows[0].data;
        if (!cur || typeof cur !== 'object') return snap;        // 云端还没有这一行 → 直接写外观
        var next = {}, k;
        for (k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
        for (k in snap) if (Object.prototype.hasOwnProperty.call(snap, k)) next[k] = snap[k];
        return next;
      }, function () { return snap; })                            // 读失败 → 老行为：整行 upsert 外观
      .then(function (data) {
        return prefApi('?on_conflict=owner', {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: [{ owner: uid, data: data }]
        });
      })
      .then(function () { clearDirty(); return true; }).catch(function () { return false; });
  }
  var prefT = 0, prefRun = null;
  // 改设置后调用：防抖 1.5 秒推一次（滑杆拖动会连着调几十次，不能每一下都发请求）。
  // 同时打一个「有没推上去的改动」标记：下次打开页面若还带着它，就以本地为准补推，别被云端旧值盖掉。
  function prefPush() { markDirty(); if (prefT) clearTimeout(prefT); prefT = setTimeout(function () { prefT = 0; prefPushNow(); }, 1500); }
  /* 打开页面 / 登录 / 换账号时调一次：先按 owner 隔离本地，再和云端对齐。 */
  var prefWaited = false;
  function prefSync() {
    /* 2026-11-19：hx-cloud.js 是异步拉进来的，外观同步（idle 后跑）可能比它先到。
       第一次：等它一把（cloudReady 最多 4 秒、失败也会 resolve）再决定走合并写还是老路；
       已经等过（prefWaited）：不再等，这一趟先走老路，顺手在后台再试一次加载（cloudLoad 自己限 2 次）。
       绝不能在这儿递归地等下去。 */
    if (!window.HXC) {
      if (!prefWaited) { prefWaited = true; return cloudReady.then(function () { return prefSync(); }); }
      cloudLoad();   // 不 await：失败最多再试这一次，网络不该卡住登录 / 换账号这条路径
    }
    var uid = prefUid(), own = prefOwner();
    if (uid !== own) {
      /* 账号变了。这里有两种情况，处理**必须分开**（2026-11-11 修用户报的「首次登录后背景没了」）：
         · own 有值 = 从某个账号换到另一个账号（或退出登录）→ 本地这份属于旧 owner：
           先归档给他，再清干净 —— 绝不能把上一个人的外观留给下一个人；
         · own 为空 = 这台设备还没归属过任何账号（第一次登录，或一直是未登录状态）→
           本机这份就是这个人自己之前调好的（他先用了网站，后来才登录），**必须先留着**，
           等下面第③步问过云端再说：云端有 → 以云端为准铺下来；云端是空的 → 拿本地这份当初始快照推上去。
         上一版在这里一律 prefApplyData(null)，把「首次登录」也当成「换账号」清了一遍 ——
         于是老用户新登录的那一下，他挑好的背景/主题色当场消失，还被当成空快照推上云端（云端也一起空了）。 */
      var hadOwner = !!own;
      if (hadOwner) saveBak(own, prefSnapData());
      /* 2026-11-19 用户要求「api key 跟账号走、不留在本机」：
         换账号 / 退出登录时，上一个人的 AI 配置、Key、回收站清单必须从本机清掉 ——
         只清外观是不够的，Key 才是真正不能留的那份东西。新账号的那份随后从云端铺回来
         （见下面第③步 prefApplyData）；云端没有、他自己也没存过，就该是空的，这正确。
         注意**不归档**到 hx-pref-bak：那会把别人的 Key 落在本机磁盘上，正是要消灭的形态。 */
      if (hadOwner) { try { extraKeys().forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { } }
      var next = uid ? loadBak(uid) : null;
      if (next) prefApplyData(next);              // 本机有他这份归档 → 铺回来
      else if (hadOwner) prefApplyData(null);     // 换账号/退出：清成默认，不留上一个人的
      // hadOwner === false 且没有归档：**什么都不清**，保留本机这份，交给第③步定夺
      setPrefOwner(uid); clearDirty();
      try { apply(); } catch (e) { }
    }
    if (!uid) return Promise.resolve(false);
    // ② 本地还有没推上去的改动 → 以本地为准补推（刚改完就刷新，别把改动丢了）
    if (ls(PDIRTY) === '1') return prefPushNow(uid);
    // ③ 正常：拉云端那份下来铺上
    if (prefRun) return prefRun;
    prefRun = prefApi('?select=data&owner=eq.' + uid + '&limit=1')
      .then(function (rows) {
        var row = rows && rows[0], d = row && row.data;
        // 2026-11-14 修「主题色刷新变白」：prefSync 是异步的，云端响应回来之前用户可能已经
        // 改过外观（set() 会 markDirty）。此刻若还带着未推送的改动，绝不能拿云端旧值去覆盖本地新值，
        // 否则用户刚点的主题色被反向冲掉、又被 prefPush 推回云端，本地+云端一起锁死成旧值。
        // 见到 dirty 就以本地为准补推，跳过覆盖。
        if (ls(PDIRTY) === '1') return prefPushNow(uid);
        if (d && typeof d === 'object' && Object.keys(d).length) prefApplyData(d);
        // 云端还没有：把这台机器上这份当成初始快照推上去；seed=true 顺带把本机已有的 AI 配置/Key 一起带上
        //（用户「先用了网站、后登录」的场景，不必再到设置页把 Key 重填一遍）
        else return prefPushNow(uid, true);     // 云端还没有：把这台机器上这份当成初始快照推上去
        return false;
      })
      .then(function (seeded) {
        if (seeded) { try { apply(); } catch (e) { } return true; }
        try { apply(); } catch (e) { }
        return true;
      })
      .catch(function () { return false; })
      .then(function (v) { prefRun = null; return v; });
    return prefRun;
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
        cloudAdd(data);          // 云端存一份（没登录/断网就安静跳过，本地照样可用）
      };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('这张图片打不开')); };
      im.src = url;
    });
  }
  // 恢复默认：外观是全站一份（VER 8），所以「恢复默认」= 把这一份写成出厂值，全站一起回到默认。
  // 为什么不直接删 hx-theme：删掉之后迁移会认为「这把键从没存在过」，转头又把旧的 hx-theme:s:*
  // 合并进来 —— 用户会看到「点了恢复默认，过了一会儿又是原来那套」。写一份 ver=VER 的完整出厂值，
  // 迁移就地认为「已经迁过」，旧界面键再也进不来。
  // 相册（hx-theme-imgs）和当前这张（hx-theme-img）都不动：用户攒的/传的背景图是资产，不是设置；
  // 要删去相册里点 ×。2026-11-13 用户拍板「恢复默认不能删上传的背景图」—— 所以这里只把 bg 置回
  // none（DEF.bg），绝不清 IMG / IMGS，恢复默认后想切回来，图还在。
  function reset() {
    var d = { ver: VER, acc: DEF.acc, mode: DEF.mode, bg: DEF.bg, clr: DEF.clr, bgo: DEF.bgo, wm: DEF.wm, glass: DEF.glass };
    try { ls(KEY, JSON.stringify(d)); } catch (e) { }
    resetMig();
    apply();
  }
  // storage 事件（VER 8）：外观只剩一把键 hx-theme，谁改了都刷 —— 包括嵌在总入口 iframe 里的工具，
  // 于是「在总入口改主题，工具里当场跟着变」，这才是用户要的「全局控制」。
  // 还听三类：上传的图（IMG）、开发者标（DEV）、以及 clear()（key === null，迁移动缓存要作废）；
  // 外加旧的 hx-theme:s:* —— 同网站还开着别的标签页跑旧版脚本、或者云端把老快照铺下来时，
  // 这里要跟着重新迁一次，不能让老键悄悄失效。
  addEventListener('storage', function (e) {
    // 极简 / 标准开关（hx-lite）在别的页面被改：本页（含 iframe）必须当场换档。
    // 不换的话总入口点了「标准模式」，iframe 里还挂着 html.hx-lite，背景动效被一票否决 ——
    // 用户看到的就是「我开了标准模式，子工具里背景还是不动」。
    if (e.key === 'hx-lite') {
      syncLite();
      apply(); return;
    }
    if (e.key === KEY || e.key === IMG || e.key === DEV || e.key === null
        || (e.key && e.key.indexOf(SKEY) === 0)) { resetMig(); apply(); }
  });
  // 换工具（#jiafen ↔ 首页）时不用再重算了：外观是全局一份，顶栏和 iframe 本来就同一套颜色。
  // 保留 apply() 这两条监听只是为了让「地址栏变化后重新量一次」这种幂等动作有个落点，不会改观感。
  addEventListener('hashchange', function () { apply(); }); addEventListener('popstate', function () { apply(); });
  if (dark) (dark.addEventListener ? dark.addEventListener('change', apply) : dark.addListener(apply));
  // 总入口（同源的上层页面）：子工具要登录时请它弹登录窗口；不在框里就跳回首页
  function portal() { try { return window.top !== window && window.top.HXPortal ? window.top.HXPortal : null; } catch (e) { return null; } }
  /* ---------- hxLookNow()：把外观交给「自己画背景」的子页面（2026-11-17 补齐） ----------
     接线仿真（/wiring-lab/）和它的练习页不是纯 HTML 页面，底色/卡片/CSS 全在 canvas 上画，
     读不到 CSS 的 --hx-img / --hx-a / --hx-bgo。它们从 2026-11-08 起就在等一个通道：
       practice.js:163 / parallel.js:1064 →
         window.parent.hxLookNow && window.parent.hxLookNow()
       拿到 {acc, acc2, a, bgo, img} 就：html 铺背景图、body 和画布底色变半透明、
       卡片玻璃 alpha 乘 a —— 壁纸才透得出来。
     **但这个函数此前在整仓一次都没定义过**，`window.parent.hxLookNow` 恒为 undefined（带守卫，
     所以不报错，只是静默不生效）。结果就是接线仿真深浅两种模式都只显示纯色底，
     用户报的「浅色主题背景丢失」里最难解释的一页（截图里整块灰底）就是它。
     现在放在这里：hx-theme.js 既是总入口也装在工具页，谁当父页面谁就把自己这份交出去，
     子 iframe 一次调用拿到的是**同一套**值（都是 apply() 算的，不会和 CSS 变量打架）。 */
  window.hxLookNow = function () {
    try {
      if (!lastLook) apply();          // 还没跑过 apply()（脚本在 <head> 里求值阶段就被调用）
      return lastLook;
    } catch (e) { return null; }
  };
  /* ---------- 未登录不许用工具（2026-11-08 用户定，补回上次的临时放开） ----------
     用户原话：「没登录的人不允许使用任何工具 现在我发现不登录都能有好多工具 这是不对的 上次临时放开没有关闭上你」。
     2026-11-01 为了修注册，曾经在总入口和各工具页放开过免登录；注册早修好了，总入口那边已经收，
     但**工具页自己没收到通知**——直接把 /shuati/ 这类地址打开，照样能刷题、能做题。
     所以闸门放在这里：凡是引用本脚本的工具页（刷题、接线仿真、单片机、考试、排课、小组加分、课程进度、
     进制转换、反馈，含各工具打包后的线上产物）都过这一道，一处改、全部生效。

     判定只看「有没有 access_token」，不做网络请求、不续期（续期是各工具自己的 hx.js 的事）。
     没登录时：
       · 在总入口里（iframe）→ 不自己画东西，请总入口弹登录（login()）；总入口已经把整块 iframe 挡住了。
       · 单独打开 → 跳回总入口对应工具（hx-theme.js 开头本来就这么做）。
     总入口首页（没有 data-tool）不走这里 —— 它自己要显示「登录 / 注册」那一格。
     调试例外：地址带 ?solo 不做闸门（离线单文件、本地预览、自动化测试都用它）。 */
  var SKEY_SESS = 'paike-session';
  function signedIn() {
    try { var s = JSON.parse(localStorage.getItem(SKEY_SESS) || 'null'); return !!(s && s.access_token); } catch (e) { return false; }
  }
  function gate() {
    if (!tool) return false;                                        // 总入口自己不管
    if (/[?&]solo\b/.test(location.search)) return false;           // 调试例外
    // 离线单文件（file:// / 打包成 data:）没有总入口可跳，也就不该拦 —— 那是机房无网时的用法
    if (!/^https?:$/.test(location.protocol)) return false;
    if (signedIn()) return false;
    var p = portal();
    if (p) return false;   // 在总入口里：整块 iframe 由总入口遮住，这里不用再画
    location.replace(root + '#' + tool);                            // 单独打开：回总入口登录
    return true;
  }
  var gated = gate();
  /* ---------- 服务器过期遮罩（2026-11-22）：工具页兜底 ----------
     用户原话（第一轮）：「被限制的账户 … 登录提示统一改为服务器过期 等待管理员续费」；
     第二轮又收紧：「不要提示和解释 只需要写服务器过期 等管理员续费即可 不要提示我们现在收费会员制」。
     → 所以这层遮罩上**只有一句标题 + 一个退出登录**，不写账号、身份、班级、所属老师、到期日，
       也不出现「会员 / 收费 / 续费流程」这类解释。改文案只改那一句。
     总入口自己会画整页的过期页；但工具页可以**直连打开**（/shuati/、/exam/…），
     所以这里补一道：登录了就问一次 hx_me，expired 就盖一层，把工具整个挡住。
     为什么放在主题脚本里：所有工具页都引用它，一处改、全部生效，不用去十个工具里各写一遍。
     例外：**不**豁免 ?solo。上面 gate() 豁免 ?solo 是因为它要「跳回总入口」，而离线单文件没有总入口可跳；
     这层遮罩只是盖住页面、不涉及跳转，没有豁免的理由 —— 而且本地验收 / 离线包正是带 ?solo 打开的，
     豁免了就测不到、线上也就不知道好坏。连不上服务器时下面有 catch 放行，不会把人锁在门外。
     代价说明：只挡 UI，不挡接口。真要硬拦，得在关键 RPC 里判 hx_expired()（数据库里已有这个函数）。

     注意文件版本：根目录 hx-theme.js 是**唯一源**，publish.cjs 每次都会用它覆盖 总入口/ 的副本。
     第一版写进了 总入口/hx-theme.js，本地打 /shuati/ 实测覆盖层不出现（刷题页引的是 ../hx-theme.js
     → 根目录那份，压根没有这段），差点变成「代码写了、验收形态也对、线上却没有」。改在这里才对。 */
  (function () {
    if (!tool) return;                                        // 总入口：不用我管
    if (!signedIn()) return;                                  // 没登录走上面那道闸
    var sess = null;
    try { sess = JSON.parse(localStorage.getItem(SKEY_SESS) || 'null'); } catch (e) { }
    var tok = (sess && sess.access_token) || '';
    if (!tok) return;
    var SUPA = 'https://eiqgyrjrwdaunhxjmdyr.supabase.co', KEY = 'sb_publishable_FcVnLx3TNrj6HnbgarYnRw_DW4-yFzd';
    fetch(SUPA + '/rest/v1/rpc/hx_me', {
      method: 'POST', cache: 'no-store',
      headers: { apikey: KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me || !me.expired) return;
        /* 只说一句话。老师明确要求：「不要提示和解释 只需要写服务器过期 等管理员续费即可
           不要提示我们现在收费会员制」—— 所以这里不写账号、身份、所属老师、到期日，
           也不出现「会员」两个字。要改文案就改这一句，并同步 总入口/index.html 的 renderExpired()。 */
        var d = document.createElement('div');
        d.id = 'hxExpired';
        d.setAttribute('role', 'alert');
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:18px;' +
          'background:var(--card,#fff);color:var(--ink,#1d1d1f);font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';
        d.innerHTML = '<div style="max-width:520px;width:100%;text-align:left">' +
          '<div style="font-size:19px;font-weight:700;margin-bottom:16px">服务器过期，等待管理员续费</div>' +
          '<button id="hxExOut" type="button" style="padding:9px 18px;border-radius:999px;border:1px solid var(--edge,#d2d2d7);background:transparent;color:inherit;font:inherit;cursor:pointer">退出登录</button>' +
          '</div>';
        document.body.appendChild(d);
        try { document.documentElement.style.overflow = 'hidden'; } catch (e) { }
        var btn = d.querySelector('#hxExOut');
        if (btn) btn.onclick = function () {
          try { localStorage.removeItem(SKEY_SESS); } catch (e) { }
          location.replace(root);
        };
      })
      .catch(function () { /* 连不上不挡人：宁可放行，也别让网络抖动把人锁在门外 */ });
  })();
  // 云端相册：登录了就在页面空下来之后拉一次（别和首屏抢带宽）。
  // 换了台设备（选了自定义背景、本地却没这张图）时它会顺手把图和「当前这张」补回来。
  (function () {
    if (!signedIn()) return;
    function go() { try { cloudSync(); } catch (e) { } }
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 2500);
  })();
  // 外观设置跟账号走（2026-11-11）：
  //   · 打开页面（idle 后）→ 按 owner 隔离本地 + 和云端对齐一次；
  //   · 之后盯着 paike-session 变化（登录 / 换账号 / 退出）→ 再对齐一次，把账号那份换上来。
  // 顺序上放在 cloudSync 之后：prefSync 会 apply()，而 apply() 里若 bg='custom' 要靠 cloudSync 补图，
  // 两个都在 idle 里跑，谁先谁后都行 —— 它们各自 apply 一次，最终态一致。
  (function () {
    function go() { try { prefSync(); } catch (e) { } }
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 2600);
    addEventListener('storage', function (e) {
      // 同一网站的别的页面登录 / 换账号 / 退出 → 本页跟着换外观（SKEY_SESS 在 hx-theme.js 里叫 SKEY_SESS）
      if (e.key === SKEY_SESS || e.key === null) { try { prefSync(); } catch (er) { } }
    });
  })();
  window.HXTheme = { acc: ACC, bg: BG, root: root, surface: SURF, get: get, mode: function () { return modeOf(get()); }, set: set, upload: upload, reset: reset, isDev: isDev, setDev: setDev, onChange: function (fn) { subs.push(fn); },
    portal: portal, login: function () { var p = portal(); if (p) p.login(); else location.href = root + (tool ? '#' + tool : ''); },
    // 未登录闸门结果：工具页拿到 true 就该立刻停下（别先画界面再被跳走）
    gated: gated, signedIn: signedIn,
    // 上传过的背景相册（2026-11-04）：imgs() 取列表、useImg(id) 切回、delImg(id) 删一张
    imgs: imgs, useImg: useImg, delImg: delImg,
    // 云端同步（2026-11-09）：打开外观面板时调一次，把别的设备上传的图拉下来。
    // 先发一个只取目录的小请求，指纹一样就到此为止；不一致才按 id 补下载缺的那几张。
    sync: cloudSync,
    // 外观设置跟账号（2026-11-11）：登录后调一次，把账号里存的外观拉下来铺上；
    // 换账号 / 退出登录也调它（内部按 owner 隔离，绝不把上一个人的设置留给下一个人）。
    prefSync: prefSync,
    // 像素方块「正在载入」药丸（2026-11-04）：见文件上方 loadPill 那段注释。
    // HXTheme.loadPill(host, '正在载入…') / loadPill('正在载入…')（铺满整页）；返回 { el, text(), done() }
    loadPill: loadPill,
    // 2026-11-17：bgPause 随视频壁纸一起删了。总入口那句 `if (HXTheme.bgPause) …` 带守卫，
    // 取到 undefined 就是空操作，不会报错（也让旧缓存的 index.html 混搭新脚本时不炸）。
    // 极简 / 标准开关（2026-11-09 用户要的按钮，2026-11-11 改名 + 定默认）：
    // 不传参 = 读当前是不是极简；传 '1' / '0' = 标准模式 / 极简模式（写进本地，这台机器记住）。
    // 2026-11-11 用户定：「模式自动不需要给用户切换，默认极简」——不再有 'auto' 档，
    //   传 'auto' 当没传处理（只读）。历史上 'auto' 是「清掉手工选择回到按机器猜」，
    //   现在默认就是极简、也不必猜机器，那条分支去掉了。
    // 设置完**当场生效**：html.hx-lite 一变，像素小生物 / 头像 / 天气动效的动画循环下一帧就停
    // （它们每一帧都查这个类，不是只在加载时查一次），再跑一次 apply() 把壁纸层重新算一遍。
    lite: function (v) {
      if (v === undefined || v === 'auto') return liteOn();
      try { localStorage.setItem('hx-lite', v === '1' ? '1' : '0'); } catch (e) { }
      var on = liteOn();
      document.documentElement.classList.toggle('hx-lite', on);
      try { apply(); } catch (e) { }
      /* 2026-11-11：把「现在是极简还是标准」广播出去，让同页面的 canvas 工具（接线仿真等）
         当场换档，不用刷新。用 storage 事件够不到同页面，所以两条腿都走：
         ① 立刻派发自定义事件（同页监听）；② 写 localStorage 让别的标签页/iframe 收到 storage 事件。 */
      try { dispatchEvent(new CustomEvent('hx-lite-change', { detail: { lite: on } })); } catch (e) { }
      prefPush();   // 模式也是外观的一部分 → 一起存进账号
      return on;
    },
    /* 2026-11-11：给接线仿真这类 canvas 页读「现在是不是极简」。不传参 = 读；
       独立打开工具页（没有总入口 iframe）时也能用：读 localStorage + html.hx-lite 类，两条任一命中即极简。 */
    isLite: function () {
      try { if (document.documentElement.classList.contains('hx-lite')) return true; } catch (e) { }
      return liteOn();
    },
    /* 身份卡背景设置入口（2026-11-12 U3）：多工具共享的 id 卡背景，入口放在总入口「外观」面板。
       数据层仍是 public.hx_rank_bg（hx_rank_bg_get / hx_rank_bg_put），预设复用接线仿真 rank-bg.js
       的 RANK_BG_PRESETS —— 真正的设置窗在接线仿真 rank.js 的 rkCardWin 里，这里只负责把入口指过去：
         · 总入口（顶层）→ window.HXPortal.rankCard（打开接线仿真并唤起 rkCardWin）；
         · 工具 iframe（被外壳嵌着）→ window.top.HXPortal.rankCard（同一件事）；
         · 单独打开接线仿真（没有外壳）→ 它自己暴露的 window.hxOpenRankCard。 */
    rankCard: function () {
      var p = portal();
      if (p && p.rankCard) { p.rankCard(); return; }
      try { if (window.HXPortal && window.HXPortal.rankCard) { window.HXPortal.rankCard(); return; } } catch (e) { }
      if (window.hxOpenRankCard) { window.hxOpenRankCard(); }
    } };

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

  // ── 按钮按下「压下去 + 变暗」（2026-11-19）────────────────────────────
  // 用户反馈「按钮按下动效也不做，我哪知道按下去了没有」。原来只有像素碎屑（炸一圈），
  // 而且碎屑只挂在 24~150px 宽的中小按钮上——文字一长的操作按钮（如「让 AI 识别全部平台的模型能力」
  // 宽 215px）被「太大不挂」跳过，按下时按钮本体纹丝不动，触摸/鼠标点下去完全没手感。
  // 这里补一段**全站所有可点按钮**都有的按下反馈：往下压 1px + 微收 + 变暗一档。
  // 为什么放 JS 里注入 style 而不是写进 hx-theme.css：全站只有总入口、刷题、ai、help、音乐、
  // 回收站真的引了那份 CSS，其余工具（考试/接线仿真/考勤/单片机/资料库/排课/课程进度/进制/备份）
  // 只引这份 JS —— 写 CSS 它们吃不到，写这里才谈得上「全站统一」（和滚动条同一套道理）。
  // 变暗用 filter 而不是改 background：按钮底色千差万别（渐变/透明描边/纯色），filter 一套通用。
  // 不写 transition：各工具按钮自带的 transition（border/color/background）会被覆盖；按下要「跟手」，
  // 瞬时切换最灵敏，松开由按钮自己的 transition 或默认瞬间回位。
  // 排除项：已经自己带按下动效的（.rk-go）、以及任何被标了 data-hx-nocrumb 的（和碎屑同款跳过口径）。
  // 不碰 .tile：首页工具卡有自己一套「悬停上浮 + 按下上移」的动效，这里把它压下去会反转手感。
  (function () {
    var st = document.createElement('style');
    st.id = 'hx-press-style';
    st.textContent =
      'button:not([disabled]):active,'
      + '[role="button"]:not([disabled]):active,'
      + '.btn:not([disabled]):active{'
      + 'transform:translateY(1px) scale(.985);filter:brightness(.92)}'
      // 极简 / 关动画：只保留下压位移，去掉 scale 和变暗（极简不该再有滤镜开销）
      + 'html.hx-lite button:active,html.hx-lite [role="button"]:active,html.hx-lite .btn:active{'
      + 'transform:translateY(1px);filter:none}'
      + '@media (prefers-reduced-motion:reduce){button:active,[role="button"]:active,.btn:active{'
      + 'transform:none;filter:none}}';
    (document.head || document.documentElement).appendChild(st);
  })();
  /* 2026-11-09 音乐播放器：全站只用站点根的一份 /hx-player.js（歌单、当前曲、音量只能有一份状态）。
     只在 top window 引 —— 工具页被 iframe 嵌着时，顶部那条由总入口统一挂；
     每个 iframe 各挂一条的话，页面上会同时出现三四个一模一样的控制条。 */
  (function () {
    try {
      if (window.top !== window) return;
      if (document.getElementById('hxp-js')) return;
      var s = document.createElement('script');
      s.id = 'hxp-js'; s.async = true; s.src = root + 'hx-player.js';
      document.head.appendChild(s);
    } catch (e) { }
  })();
  apply();
})();

/* ==================== 全站统一的「按钮进行中」反馈（HXBusy） ====================
   2026-11-15 用户报：「按钮点了没反馈，不知道啥时候会给我跳出处理结果」「点了删除没反应
   就跟卡了一样，不知道是处理到哪儿了还是真卡住了」「类似按钮问题很多个，需要严格自查」。

   病根：几乎所有异步按钮都是 onclick = async () => { ... } 里裸 await，
   点下去既不 disable、也不换字，请求慢的时候界面和没点一模一样；失败了只有 toast
   一闪而过，用户根本没看见。删一条记录时更是连转圈的地方都没有。

   这一份做成**全站唯一实现**，放在 hx-theme.js 里（每个工具页都引了它，不用改任何
   build 白名单）。各工具只需要在 async 处理器外面包一层：

     const tok = HXBusy.begin(btn, '正在出题…');      // 立刻：转圈 + 灰掉 + 计时
     try { ...await 真活... }
     finally { HXBusy.end(tok); }                     // 一定恢复，不管成败

   或者用简写（不关心异常时）：

     const ok = await HXBusy.run(btn, '正在删除…', () => doDelete(id));

   约定（别改，各工具都按这个用）：
     · begin 之后按钮**不能再点**（disabled），并且宽度锁死，换字不会让工具栏跳位；
     · 每 400ms 把「已等 N 秒」写进按钮，超过 20 秒变暖色 —— 让用户看见「系统活着」；
     · end 会把 innerHTML / disabled / minWidth / title 全部还原，按钮被重新渲染过
       （isConnected = false）就跳过还原，不碰已脱离文档的节点；
     · 出错不要吞：把原因交给调用方 toast / 写在行内 .rmsg 里，HXBusy 只负责「在忙」这件事。
   ======================================================================= */
(function () {
  'use strict';
  if (window.HXBusy) return;

  // 样式只注入一次。用 .hx-busy 前缀，别撞各工具自己的 .btn 规则。
  var CSS =
    '.hx-busy{position:relative;cursor:progress!important;opacity:.92}' +
    '.hx-busy[disabled]{pointer-events:none}' +
    '.hx-busy .hx-spin{display:inline-block;width:.92em;height:.92em;margin-right:.5em;vertical-align:-.08em;' +
    'border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:hx-spin .7s linear infinite}' +
    '.hx-busy .hx-el{opacity:.72;font-variant-numeric:tabular-nums;font-weight:600;margin-left:.5em}' +
    '.hx-busy.hx-busy-warn{color:#b45309;border-color:#f0b429}' +
    '.hx-busy.hx-busy-warn .hx-el{opacity:1}' +
    /* 极简 / 减少动效：不转圈，改成三点闪烁（仍然是「在动」但不会晃眼） */
    'html.hx-lite .hx-busy .hx-spin,.hx-busy.hx-busy-still .hx-spin{animation:hx-blink 1.1s steps(2,end) infinite;' +
    'border:0;width:auto;height:auto;border-radius:0}' +
    'html.hx-lite .hx-busy .hx-spin:before,.hx-busy.hx-busy-still .hx-spin:before{content:"●"}' +
    '@keyframes hx-spin{to{transform:rotate(360deg)}}' +
    '@keyframes hx-blink{50%{opacity:.25}}';
  function inject() {
    if (document.getElementById('hx-busy-css')) return;
    var s = document.createElement('style');
    s.id = 'hx-busy-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', inject); else inject();

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var tickers = [];

  /* begin(btn, label, opts)
       btn   HTMLElement | string(id)   —— 找不到就直接返回一个空 token，调用方照常 await
       label 字符串，显示在按钮上（如「正在出题…」）
       opts  {warn:20, 单位秒；min:最短显示毫秒，默认 320（太快一闪反而像没点）} */
  function begin(btn, label, opts) {
    if (typeof btn === 'string') btn = document.getElementById(btn);
    inject();
    if (!btn || btn.nodeType !== 1) return { btn: null, skip: true };
    // 同一个按钮已经在忙：不叠加，直接把已有 token 还回去（防连点起两份请求）
    if (btn.__hxBusy) return btn.__hxBusy;

    opts = opts || {};
    var warnMs = (opts.warn == null ? 20 : +opts.warn) * 1000;
    var tok = {
      btn: btn,
      html: btn.innerHTML,
      dis: !!btn.disabled,
      title: btn.getAttribute('title'),
      minW: btn.style.minWidth,
      t0: Date.now(),
      label: label || '处理中…',
      warnMs: warnMs,
      minMs: opts.min == null ? 320 : +opts.min,
      timer: 0,
      done: false
    };
    // 锁宽：换字以后按钮不许变胖变瘦，否则一整排工具按钮会跟着跳
    var w = btn.offsetWidth;
    if (w > 0) btn.style.minWidth = w + 'px';
    btn.classList.add('hx-busy');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<i class="hx-spin" aria-hidden="true"></i>' + esc(tok.label) + '<em class="hx-el">0s</em>';
    btn.__hxBusy = tok;

    function tick() {
      if (tok.done || !tok.btn.isConnected) return;
      var sec = Math.round((Date.now() - tok.t0) / 1000);
      var el = tok.btn.querySelector('.hx-el');
      if (el) el.textContent = sec + 's';
      if (Date.now() - tok.t0 >= warnMs) tok.btn.classList.add('hx-busy-warn');
    }
    tok.timer = setInterval(tick, 400);
    tickers.push(tok);
    return tok;
  }

  /* end(tok, errMsg)
       还原按钮；给了 errMsg 就挂到 title 上（鼠标悬停能看到失败原因），
       同时把按钮标成 warn 300ms 让用户瞄到一眼「这次没成」。 */
  function end(tok, errMsg) {
    if (!tok || tok.skip || tok.done) return;
    tok.done = true;
    clearInterval(tok.timer);
    var i = tickers.indexOf(tok); if (i >= 0) tickers.splice(i, 1);
    var btn = tok.btn;
    if (!btn || !btn.isConnected) return;          // 已被重新渲染掉：没有可还原的东西
    // 太快就闪一下不算「点了」：至少让转圈留 320ms，用户才看得出发生过什么
    var wait = Math.max(0, tok.minMs - (Date.now() - tok.t0));
    var reallyRestore = function () {
      if (!btn.isConnected) return;
      btn.innerHTML = tok.html;
      btn.disabled = tok.dis;
      btn.style.minWidth = tok.minW || '';
      btn.classList.remove('hx-busy');
      btn.removeAttribute('aria-busy');
      if (tok.title == null) btn.removeAttribute('title'); else btn.setAttribute('title', tok.title);
      delete btn.__hxBusy;
      if (errMsg) {
        btn.classList.add('hx-busy-warn');
        btn.setAttribute('title', String(errMsg));
        setTimeout(function () { if (btn.isConnected) btn.classList.remove('hx-busy-warn'); }, 400);
      }
    };
    if (wait > 0) setTimeout(reallyRestore, wait); else reallyRestore();
  }

  /* run(btn, label, fn) —— 简写。fn 抛异常照常往外抛（调用方自己 catch 后 toast），
     但按钮一定会还原。返回 fn 的返回值。 */
  function run(btn, label, fn, opts) {
    var tok = begin(btn, label, opts);
    var p;
    try { p = fn(); } catch (e) { end(tok); throw e; }
    return Promise.resolve(p).then(
      function (v) { end(tok); return v; },
      function (e) { end(tok, e && e.message ? e.message : String(e)); throw e; }
    );
  }

  // 行内「处理中」小标签：给没有按钮的地方用（比如整行删除、批量任务的状态行）
  function tag(host, text) {
    if (typeof host === 'string') host = document.getElementById(host);
    if (!host) return { done: function () { } };
    inject();
    var el = document.createElement('span');
    el.className = 'hx-busy-tag';
    el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:inherit;opacity:.8';
    el.innerHTML = '<i class="hx-spin" aria-hidden="true"></i>' + esc(text || '处理中…');
    host.appendChild(el);
    return {
      text: function (t) { el.innerHTML = '<i class="hx-spin" aria-hidden="true"></i>' + esc(t); },
      done: function () { if (el.isConnected) el.remove(); }
    };
  }

  window.HXBusy = { begin: begin, end: end, run: run, tag: tag, count: function () { return tickers.length; } };
  /* ── 药丸下拉：原生 <select> 的可视替身（2026-11-17 用户定）────────────────────
     用户原话：「还有很多下拉选项卡没做成药丸那种风格 刷题那边是正常的 ……
     请他就出现在下拉那边衔接上 然后也不用现在这么大比例」
     为什么做成「一个增强器」而不是挨个改 95 处：95 个 select 分散在 13 个工具，
     很多是 JS 动态生成的（attendance.js、ui-builder.js、排课 .room-sel），
     逐个手写弹层 = 95 套定位/关闭/键盘逻辑，必然歪成 95 种样子 —— 这正是要防的。
     三条铁律：
       1. **原生 select 留在 DOM 里**（`visibility:hidden` 盖在按钮下面），只负责值。
          用户点的是我们画的按钮，选中后 `sel.selectedIndex = i` + 派发 input/change，
          所以各工具现有的 onchange / addEventListener('change') / sel.value 读**一行都不用改**。
          用 visibility 而不是 opacity：opacity 会让 Tab 停在一个看不见的控件上，
          而且 select 还在 flowed 里、正好用它自己的盒子撑出包装层的尺寸（不用 JS 量宽高）。
       2. **按钮外观从原生 select 的 computed style 现场抄**（字体/颜色/背景/边框/圆角/内边距/对齐），
          所以 95 个长相各不相同的下拉不用改任何工具 CSS，自动跟原样一致。
          隐藏着的 select（还没显示出来的对话框里那些）先不抄 —— 那时候 computed style 是默认值，
          抄了就是错的；等它第一次露出来（open / pointerdown / focus）再抄，见 skin()。
       3. **贴着触发器左对齐往下展开**（下方 6px 缝），优先往下、下方太矮先压高度，实在到底才翻到上方、再夹进视口，**不做全屏遮罩**。
     开启方式（一页一行，这就是「一个一个做」）：`<html data-hx-peanut>` 或脚本里 `HXPeanut.init()`。
     排除：单个 select 加 `data-hx-plain`；multiple / size>1 自动跳过。
     刷题 `#subjBtn` 那套是自绘的药板胶囊（.bsc-*），不归这里管，别让这里接管它。 */
  (function () {
    if (window.HXPeanut) return;

    var STID = 'hx-peanut-style', sheet = null, clip = null, fx = null, hideT = 0, pickT = 0;
    var OPEN = null, all = [], inited = false, queued = false, ro = null;
    var wrapOf = new WeakMap(), instOf = new WeakMap();

    function inject() {
      if (document.getElementById(STID)) return;
      var s = document.createElement('style');
      s.id = STID;
      s.textContent =
        // min-width:0（2026-11-18）：包装层当 flex 子项时，默认的 min-width:auto 会把它顶在内容宽度上，
        // 父容器再宽也不长 —— 长课次名于是被切在「2026-…」，右边却空着一大片。
        '.hx-pn{position:relative;display:inline-block;vertical-align:middle;max-width:100%;min-width:0;box-sizing:border-box}'
        // 原生 select 只留位置，别让它再被点到（visibility 而不是 opacity，见上面注释）
        + '.hx-pn-src{visibility:hidden!important}'
        // ── 触发器 = 一块铝箔卡（2026-11-18 用户：「选项卡本身是药丸胶囊包装样子」）──
        // 材质逐条照抄 _tmp/blister-demo.html 的 `.foil`：320px 跟鼠标走的反光 + ±45° 压纹 +
        // 2px 拉丝 + 165° 银灰底 + 同款内外阴影。铝箔是实物色（浅银），所以文字固定 #20242a，
        // 不跟深浅主题走 —— 深色页面上它也该是一块亮银色药板。
        // 布局 [药槽][文字 1fr][折角]：列宽 = --pn-pw，行高 = --pn-ph，都由 JS 按实测高度写，
        // 因为原生 select 高度从 26px 到 44px 都有，写死像素会撑破行高。
        // padding-left 不再抄原生 select（药槽自己占一列），文字左边距 = 药槽宽 + 6px 的列间距。
        + '.hx-pn-btn{position:absolute;inset:0;box-sizing:border-box;display:grid;align-items:center;'
        // 2026-11-18 用户「右边遮挡不完整」：折角列 12→10、列间距 8→6、左右内边距各收一点
        // （默认值也跟着收），一行文字能多出 10~12px —— 宿主给多宽改不了，只能把自己消耗的压到最小。
        + 'grid-template-columns:var(--pn-pw,30px) minmax(0,1fr) 10px;column-gap:6px;'
        + 'width:100%;height:100%;overflow:hidden;cursor:pointer;margin:0;'
        + 'padding:0 var(--pn-padr,6px) 0 var(--pn-padl,4px);'
        + 'font:inherit;line-height:1.2;color:#20242a;text-align:left;'
        + 'border:1px solid rgba(255,255,255,.41);border-radius:var(--pn-r,8px);'
        + '--sheen-x:38%;--sheen-y:28%;'
        + 'background:'
        + 'radial-gradient(320px circle at var(--sheen-x) var(--sheen-y),rgba(255,255,255,.52) 0,rgba(255,255,255,.14) 38%,transparent 72%),'
        + 'repeating-linear-gradient(45deg,rgba(255,255,255,.23) 0 1px,transparent 1px 3.5px),'
        + 'repeating-linear-gradient(-45deg,rgba(55,60,70,.12) 0 1px,transparent 1px 3.5px),'
        + 'repeating-linear-gradient(0deg,rgba(255,255,255,.145) 0,rgba(0,0,0,.04) 1px,rgba(255,255,255,.11) 2px),'
        + 'linear-gradient(165deg,#eceef1,#d8dade 36%,#c5c9d0 74%,#d4d7dc);'
        + 'box-shadow:inset 0 1.5px 1px rgba(255,255,255,.91),inset 1px 0 1px rgba(255,255,255,.65),'
        + 'inset 0 -2px 3px rgba(72,76,86,.55),inset -1px 0 2px rgba(82,86,96,.38),'
        + '0 3px 7px -2px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.28);'
        + 'transition:transform 180ms cubic-bezier(.22,1,.36,1)}'
        + '.hx-pn-btn:active{transform:translateY(1px) scale(.995)}'
        + '.hx-pn-btn[disabled]{cursor:not-allowed;opacity:.55}'
        + '.hx-pn-btn:focus-visible{outline:2px solid var(--acc,#0a84ff);outline-offset:2px}'
        + '.hx-pn-txt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
        + 'text-shadow:0 1px rgba(255,255,255,.66)}'
        + '.hx-pn-car{justify-self:center;width:6px;height:6px;border-right:1.7px solid currentColor;'
        + 'border-bottom:1.7px solid currentColor;transform:translateY(-2px) rotate(45deg);opacity:.55;'
        + 'transition:transform 300ms cubic-bezier(.22,1,.36,1)}'
        + '.hx-pn-btn[aria-expanded="true"] .hx-pn-car{transform:translateY(1px) rotate(-135deg)}'
        // 面板 = 一块铝箔药板。配方**直接从 刷题/style.css 的 .bsc-foil / .bsc-rim / .bsc-pill 抄过来**：
        // 用户要的就是「跟刷题那边一样」，别再自己发明第二种长相（第一版做成白底圆角条，被问「药丸在哪儿」）。
        // 铝箔是实物色（浅银），所以既不跟主题也不跟触发器底色走 —— 深色页面上它也是一块亮银色药板，
        // 这正是刷题里那块药板的样子。因此原来那套 --pn-bg/--pn-fg 的 tint() 机制整个删掉了。
        // 药板外面套一层「裁剪盒」（同刷题 .bsc-clip）：没有这一层，收起时能看到药板整块飘在触发器上方，
        // 有了它就是「从触发器背后滑出来 / 滑回去」。上下留 6px / 30px 内边距，是给药板阴影留的呼吸位。
        + '.hx-pn-clip{position:fixed;z-index:2147482000;display:none;box-sizing:border-box;'
        + 'padding:6px 0 30px;overflow:hidden;pointer-events:none}'
        // 460ms 回弹曲线滑出 + 320ms 淡入，跟刷题 .bsc-panel 逐条一致（用户要的就是「一样」）
        + '.hx-pn-sheet{position:relative;box-sizing:border-box;width:100%;overflow:auto;pointer-events:auto;'
        // 药板里的每一格都是「压缩版」比例（样张 .sm 段）：药槽 46×26、胶囊 33×14。
        // 药槽内部所有 inset 都用 --pn-pw/--pn-ph 的百分比算，所以触发器里那圈更小的槽
        // 用的是同一套配方，只是尺寸不同（见 .hx-pn-pk）。
        // 2026-11-18 用户「可以适当缩小文字和ui尺寸适配」：整板按 0.82 档收（46×26 → 38×21.5，
        // 配 38px 行高 / 11px 字），药槽、胶囊、行距同步缩，不会变成「大字小药丸」。
        + '--pn-pw:38px;--pn-ph:21.5px;'
        + 'transition:transform 460ms cubic-bezier(.22,1.06,.36,1),opacity 320ms cubic-bezier(.22,1.06,.36,1);'
        + 'padding:6px;border-radius:14px;color:#20242a;border:1px solid rgba(255,255,255,.41);'
        + 'background:'
        + 'radial-gradient(300px circle at 38% 28%,rgba(255,255,255,.52) 0,rgba(255,255,255,.14) 38%,transparent 72%),'
        + 'repeating-linear-gradient(45deg,rgba(255,255,255,.23) 0 1px,transparent 1px 3.5px),'
        + 'repeating-linear-gradient(-45deg,rgba(55,60,70,.12) 0 1px,transparent 1px 3.5px),'
        + 'repeating-linear-gradient(0deg,rgba(255,255,255,.145) 0,rgba(0,0,0,.04) 1px,rgba(255,255,255,.11) 2px),'
        + 'linear-gradient(165deg,#eceef1,#d8dade 36%,#c5c9d0 74%,#d4d7dc);'
        + 'box-shadow:inset 0 1.5px 1px rgba(255,255,255,.91),inset 1px 0 1px rgba(255,255,255,.65),'
        + 'inset 0 -2px 3px rgba(72,76,86,.55),inset -1px 0 2px rgba(82,86,96,.38),'
        + '0 14px 30px -8px rgba(0,0,0,.6),0 4px 10px rgba(0,0,0,.31);'
        + '-webkit-overflow-scrolling:touch}'
        // 一行 = 药板上的一格：左边一颗胶囊（药槽 38×21.5），右边名字；行与行之间是点线（同 .bsc-row）
        // 2026-11-18 用户「可以适当缩小文字和ui尺寸适配」：46/13.5/46 高 一起收 → 38/12/38 高，
        // 行内边距与列间距同步收，手机上同样内容能少滚一屏。
        // ⚠️ 字号只收到 12px（第一版按 0.82 收到 11px 太小了）——药槽可以小，文字要留得住。
        + '.hx-pn-opt{display:grid;grid-template-columns:38px minmax(0,1fr);gap:8px;align-items:center;'
        + 'width:100%;box-sizing:border-box;min-height:38px;padding:0 10px 0 8px;margin:0;border:0;border-radius:0;'
        + 'background:transparent;color:#20242a;font:inherit;font-size:12px;font-weight:600;'
        + 'text-align:left;cursor:pointer;overflow:hidden}'
        + '.hx-pn-opt+.hx-pn-opt{border-top:1px dotted rgba(84,89,100,.53)}'
        + '.hx-pn-opt:hover{background:rgba(255,255,255,.24)}'
        + '.hx-pn-opt:active{background:rgba(0,0,0,.05)}'
        + '.hx-pn-opt:focus-visible{outline:2px solid #1a56ff;outline-offset:-3px}'
        + '.hx-pn-opt.dis{opacity:.42;cursor:not-allowed}'
        // ── 药槽 = 金属圈 + 压痕 + 玻璃罩 + 胶囊（样张 `.pocket/.rim/.dome/.pill`）──
        // 尺寸全部由 --pn-pw / --pn-ph 驱动：面板里是 46×26（样张 `.sm` 段的压缩比例），
        // 触发器里是 JS 按按钮实测高度算出来的（14~54）。所有 inset、环宽、阴影偏移都写成
        // --pn-ph / --pn-pw 的百分比，同一套配方在两种尺寸下比例一致，不会出现「小槽配粗金属圈」。
        + '.hx-pn-pk{position:relative;display:grid;place-items:center;isolation:isolate;pointer-events:none;'
        + 'width:var(--pn-pw,38px);height:var(--pn-ph,21.5px)}'
        // 2026-11-18 二次修正：药槽 / 空槽**回到参考原型的 CSS 配方**，删掉那两张 data-URI 素材图。
        //   ├ 上一版我以为参考里的 pocket-rim / popped-cavity 是渲染图，于是从别处找了张实拍素材内嵌进来，
        //   │  结果喂回参考截图对比时肉眼就能看出两处不像：外圈是暗灰扁环（参考是明暗交替的亮银圈）、
        //   │  碎箔是密集小卷（参考是左下一整片锐利折面）。判据只有一条 —— 和参考 1:1，不是「像锡箔就行」。
        //   └ 事实：参考原型 blister-demo.html 里 0 个 url()，全部是渐变 + clip-path 画的。
        //     它的 `.sm` 段（药槽 46×27 / 胶囊 33×14）就是我们面板在用的压缩尺寸，
        //     所以下面这些 px 直接按 46×26 基准换算成 --pn-pw/--pn-ph 的比例，忠实度最高。
        //     顺带省掉约 50 KB base64（两份副本 + 刷题离线包三处都要吃这份体积）。
        // 药槽 = 一圈斜向反光（162deg 的明暗交替）+ 3 层 inset 环（白边 / 灰环 / 亮灰环）+ 内凹压痕
        + '.hx-pn-rim{position:absolute;border-radius:999px;'
        + 'inset:calc(var(--pn-ph,26px)*.038) calc(var(--pn-pw,46px)*.033);'
        + 'background:linear-gradient(162deg,rgba(251,252,255,.61) 2%,rgba(115,121,134,.47) 24%,'
        + 'rgba(244,245,248,.32) 49%,rgba(76,82,94,.33) 66%,#fff 96%);'
        + 'box-shadow:0 calc(var(--pn-ph,26px)*.038) calc(var(--pn-ph,26px)*.077) rgba(0,0,0,.27),'
        + 'inset 0 0 0 1px rgba(250,252,255,.67),inset 0 0 0 calc(var(--pn-ph,26px)*.077) rgba(130,136,149,.55),'
        + 'inset 0 0 0 calc(var(--pn-ph,26px)*.115) rgba(233,237,242,.6),'
        + 'inset 0 calc(var(--pn-ph,26px)*.038) calc(var(--pn-ph,26px)*.154) rgba(51,57,70,.69)}'
        // 槽底：比外圈暗一档的凹陷面 + 上方压影 + 下方回光（缺了这层，胶囊像浮在铝箔上而不是嵌在槽里）
        + '.hx-pn-rim::after{content:"";position:absolute;border-radius:inherit;'
        + 'inset:calc(var(--pn-ph,26px)*.154);background:rgba(184,187,198,.36);'
        + 'box-shadow:inset 0 calc(var(--pn-ph,26px)*.077) calc(var(--pn-ph,26px)*.154) rgba(52,56,66,.33),'
        + 'inset 0 -1px 1px #fff}'
        + '.hx-pn-dome{position:absolute;z-index:2;border-radius:999px;'
        + 'inset:calc(var(--pn-ph,26px)*.115) calc(var(--pn-pw,46px)*.109);'
        + 'background:linear-gradient(145deg,rgba(255,255,255,.33),rgba(255,255,255,.07) 32%,'
        + 'transparent 56%,rgba(255,255,255,.13));box-shadow:inset 0 1px 1px rgba(255,255,255,.6)}'
        // ── 三种胶囊：0 蓝白 / 1 琥珀 / 2 鼠尾草，按「选项下标 % 3」分配（buildSheet）；
        // 触发器里显示当前选中项那一颗（refresh）。飞行胶囊共用同一套材质（:is 一起选），
        // 否则飞出去是蓝的、落下来变成琥珀，中间有一道断层（样张特意修过这处）。
        + ':is(.hx-pn-pill,.hx-pn-flight){position:relative;border-radius:999px;'
        + 'width:calc(var(--pn-pw,46px)*.717);height:calc(var(--pn-ph,26px)*.538);'
        + 'background:linear-gradient(90deg,#0645c5 0 49%,#e8e8e8 50%);'
        + 'box-shadow:0 calc(var(--pn-ph,26px)*.05) calc(var(--pn-ph,26px)*.09) rgba(17,24,34,.4),'
        + 'inset 0 1px 1px rgba(0,0,0,.4)}'
        + ':is(.hx-pn-pill,.hx-pn-flight)::before{content:"";position:absolute;'
        + 'inset:calc(var(--pn-ph,26px)*.054) 50% calc(var(--pn-ph,26px)*.077) calc(var(--pn-pw,46px)*.043);'
        + 'border:1px solid rgba(96,153,252,.33);border-right:0;border-radius:999px 0 0 999px}'
        + ':is(.hx-pn-pill,.hx-pn-flight)::after{content:"";position:absolute;inset:0;border-radius:inherit;'
        + 'background:linear-gradient(180deg,rgba(0,0,0,.47),transparent 33%,rgba(255,255,255,.33) 68%,rgba(0,0,0,.27));'
        + 'box-shadow:inset 0 -.7px .7px rgba(0,0,0,.33)}'
        // 琥珀（样张 `.pill[data-value=open]` 那串 radial + linear）
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="1"]{'
        + 'background:radial-gradient(ellipse at 46% 51%,#63320c 0 25%,#ac570c 40%,transparent 65%),'
        + 'linear-gradient(156deg,#783a09 12%,#ffa226 28%,#d07516 44%,#4c200a 68%,#ffc25b 83%,#7e4109 94%);'
        + 'box-shadow:0 calc(var(--pn-ph,26px)*.06) calc(var(--pn-ph,26px)*.1) rgba(29,12,1,.38),'
        + 'inset 0 0 0 1px #6d300a,inset 0 0 calc(var(--pn-ph,26px)*.15) #ee9f40}'
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="1"]::before{display:none}'
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="1"]::after{'
        + 'inset:calc(var(--pn-ph,26px)*.077) calc(var(--pn-pw,46px)*.098);'
        + 'background:linear-gradient(178deg,#ffe6ad 0,transparent 25%,rgba(51,19,5,.55) 53%,#ffd486 92%);'
        + 'box-shadow:calc(var(--pn-pw,46px)*-.087) calc(var(--pn-ph,26px)*.077) 0 calc(var(--pn-pw,46px)*-.043) #fff5dc,'
        + 'inset 0 0 1px #fff3cf}'
        // 鼠尾草（样张 `.pill[data-value=closed]`）
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="2"]{'
        + 'background:linear-gradient(90deg,#778b70 0 51%,#58674f 52%,#83927a 55%,#65785e 96%);'
        + 'box-shadow:0 calc(var(--pn-ph,26px)*.06) calc(var(--pn-ph,26px)*.1) rgba(17,29,20,.47),'
        + 'inset 0 1px 1px rgba(37,44,34,.43)}'
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="2"]::before{display:none}'
        + ':is(.hx-pn-pill,.hx-pn-flight)[data-mat="2"]::after{'
        + 'background:radial-gradient(ellipse at 23% 74%,rgba(230,235,212,.55),transparent 45%),'
        + 'linear-gradient(180deg,rgba(34,44,33,.66),transparent 32%,rgba(206,212,190,.36) 70%,rgba(48,60,46,.44))}'
        // 选中 = 这颗药被抠走了：露出撕开的空槽。照参考 `.cavity` 三层原样搬 ——
        //   ① 本体 conic-gradient 12 段明暗交替 = 被撕开一圈的金属箔断面（这一层最要紧：
        //      它和隔壁完整药槽的银圈必须亮得一样，否则选中行看起来像「矮了一截」）；
        //   ② ::before 16 个点的锯齿 clip-path + 椭圆深洞 = 撕口的毛边；
        //   ③ ::after 左下 37%×61% 的折面 = 折起来的碎箔，一层银白三角足够，不要做成密集卷边。
        + '.hx-pn-cav{position:absolute;display:none;border-radius:999px;'
        + 'inset:calc(var(--pn-ph,26px)*.038) calc(var(--pn-pw,46px)*.033);'
        + 'background:conic-gradient(from 12deg,#f5f5f5,#666970 10%,#e4e6e8 17%,#b8bbc2 29%,#f5f5f5 37%,'
        + '#484b50 48%,#d6d8db 59%,#878b91 66%,#f6f6f6 78%,#4a4c50 89%,#efeff0);'
        + 'box-shadow:inset 0 0 0 1px #fff,inset 0 0 0 calc(var(--pn-ph,26px)*.077) #7a7d82,'
        + 'inset 0 0 0 calc(var(--pn-ph,26px)*.115) #e4e6ea,'
        + '0 calc(var(--pn-ph,26px)*.038) calc(var(--pn-ph,26px)*.077) rgba(0,0,0,.27)}'
        + '.hx-pn-cav::before,.hx-pn-cav::after{content:"";position:absolute}'
        + '.hx-pn-cav::before{inset:calc(var(--pn-ph,26px)*.115) calc(var(--pn-pw,46px)*.087);'
        + 'clip-path:polygon(0 34%,9% 10%,25% 18%,38% 0,52% 14%,72% 0,89% 15%,100% 36%,'
        + '97% 77%,87% 95%,69% 86%,56% 100%,38% 82%,24% 92%,20% 64%,4% 63%);'
        + 'background:repeating-linear-gradient(4deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px),'
        + 'radial-gradient(ellipse at 50% 78%,#4d4f51,#252729 62%,#111214 83%);'
        + 'box-shadow:inset 0 4px 12px #000}'
        + '.hx-pn-cav::after{width:37%;height:61%;left:8%;bottom:9%;'
        + 'clip-path:polygon(0 3%,38% 14%,52% 30%,85% 42%,74% 64%,99% 90%,51% 100%,11% 75%);'
        + 'background:conic-gradient(from 31deg at 46% 49%,#fffb,#8c8f95,#fff,#53565e,#f9fafc,#bcbec3,#fffb)}'
        + '.hx-pn-opt.on .hx-pn-cav{display:block}'
        + '.hx-pn-opt.on :is(.hx-pn-rim,.hx-pn-dome,.hx-pn-pill){visibility:hidden}'
        + '.hx-pn-opt.on .hx-pn-txt{font-weight:800}'
        + '.hx-pn-grp{padding:7px 10px 2px;font-size:9px;font-weight:700;letter-spacing:.08em;color:#5c626b}'
        + '.hx-pn-empty{padding:8px 10px;font-size:11px;color:#4a4f57}'
        // 收起位：藏到触发器背后（--pn-hide 由 JS 按实测高度写，上方弹出时取正值反向滑出）
        + '.hx-pn-sheet[inert]{transform:translateY(var(--pn-hide,-160px));opacity:0;pointer-events:none}'
        // ── 动效层：一颗会飞的胶囊 + 铝箔碎屑 ───────────────────────────────
        // 飞行的胶囊不能放在 .hx-pn-clip 里 —— 裁剪盒只罩住药板，触发器在它外面，飞行路径会被裁掉。
        // 所以单独开一层铺满视口、不吃事件的 fx 层，坐标就是视口坐标（省掉刷题那边 wrap 相对换算）。
        + '.hx-pn-fx{position:fixed;inset:0;z-index:2147482001;display:none;pointer-events:none;overflow:hidden}'
        // 飞行胶囊只负责「定位 + 帧动画」，材质/尺寸规则由上面的 :is(.hx-pn-pill,.hx-pn-flight) 提供；
        // 实际宽高由 JS 按「被点那一格」的胶囊实测值写进 style，所以这里给的只是兜底。
        + '.hx-pn-flight{position:absolute;top:0;left:0;width:27px;height:11.5px;will-change:transform}'
        + '.hx-pn-burst{position:absolute;pointer-events:none}'
        + '.hx-pn-burst>span{position:absolute;background:#f4f6f9;box-shadow:0 0 1px #51535f}'
        + '.hx-pn-burst>.hx-pn-ring{width:18px;height:10px;margin:-5px -9px;background:transparent;'
        + 'border:1px solid #1a56ff;border-radius:50%;box-shadow:none}'
        // 极简外观：只收阴影，药板本体不动（刷题那边极简也还是这块铝箔）
        + 'html.hx-lite .hx-pn-sheet{box-shadow:0 6px 16px rgba(0,0,0,.4)}'
        // 极简档 / 系统「减少动态效果」：药板不滑、胶囊不飞，只淡入淡出（JS 侧同样跳过 burst 和飞行帧）
        + 'html.hx-lite .hx-pn-sheet{transition:opacity .16s linear}'
        + 'html.hx-lite .hx-pn-sheet[inert]{transform:none}'
        + '@media (prefers-reduced-motion:reduce){.hx-pn-sheet{transition:opacity .16s linear}'
        + '.hx-pn-sheet[inert]{transform:none}}';
      (document.head || document.documentElement).appendChild(s);
    }


    function labelOf(sel) {
      var o = sel.options[sel.selectedIndex];
      var t = o ? String(o.text || o.label || '') : '';
      t = t.replace(/\s+/g, ' ').trim();
      return t || '请选择';
    }

    /* ── 以下两个曾经用来把原生 select 的底色/箭头背景抄到按钮上 ──
       2026-11-18 触发器改成铝箔卡之后不再需要（见 skin 顶部注释），整段删除；
       纯渐变 / url() 箭头那些坑一并消失，按钮的材质由 CSS 全权负责。 */

    /* 包装层的宽度/排布策略。**必须能在「后来才露出来」的时候重跑一次**：
       课程进度那种页面整块在登录墙后面，59 个 select 初始化时全在隐藏容器里，
       parentNode.clientWidth 是 0、offsetWidth 也是 0 —— 那一刻判出来的 inline-block 是错的，
       等用户登录后控件露出来，按钮就永远窄成内容宽度（2026-11-17 用户报的就是这类）。
       所以拆成独立函数：首次能看见时（skin 里）再量一次。 */
    function fit(inst) {
      var sel = inst.sel, wrap = inst.wrap;
      if (!sel.getClientRects().length) return false;
      var cs = null;
      try { cs = getComputedStyle(sel); } catch (e) { }
      /* 必须在「块级、占满父宽」的上下文里量，不能拿当前的 inline-block 包装层量：
         包装层是 shrink-to-fit，里面的 width:100% 会退化成内容宽度（420 的容器量出 181），
         判据于是自己把自己锁死 —— 后露出来的那批控件永远窄成内容宽度（2026-11-17 实测）。
         临时改成 block/100% 量一次：CSS 给的是 width:100% 就会量出父宽，width:auto 则量出内容宽度。 */
      wrap.style.display = 'block';
      wrap.style.width = '100%';
      var avail = wrap.clientWidth;
      if (!avail) {                       // 父容器还是 0 宽（藏在登录墙后面），留着下次再量
        wrap.style.display = 'inline-block';
        wrap.style.width = '';
        return false;
      }
      var natural = sel.offsetWidth;
      var disp = cs ? cs.display : '';
      var full = disp === 'block' || disp === 'flex' || disp === 'grid' || natural >= avail - 2;
      wrap.style.display = full ? 'block' : 'inline-block';
      wrap.style.width = full ? '100%' : '';
      // 父容器是 flex 行时（总入口密码框那颗 #pwCls 就是 style="flex:1"），flex / 宽度约束长在 select 身上，
      // 换成 inline-block 包装层就全丢了 → 按钮缩回内容宽度、旁边那颗按钮跟着挪位。
      // 所以把 flex、align-self、min/max-width、order 原样搬到包装层上，让它顶替 select 当 flex 子项。
      try {
        var pcs = getComputedStyle(sel.parentNode);
        if (/flex/.test(pcs.display)) {
          wrap.style.flex = cs.flex || '0 1 auto';
          wrap.style.alignSelf = (cs.alignSelf && cs.alignSelf !== 'auto') ? cs.alignSelf : '';
          wrap.style.minWidth = (cs.minWidth && cs.minWidth !== 'auto' && cs.minWidth !== '0px') ? cs.minWidth : '';
          wrap.style.maxWidth = (cs.maxWidth && cs.maxWidth !== 'none') ? cs.maxWidth : '';
          wrap.style.order = (cs.order && cs.order !== '0') ? cs.order : '';
        }
      } catch (e) { }
      inst.fitted = true;
    }

    /* 触发器药槽的自适应尺寸（2026-11-18）。
       原生 select 的实测高度 26~44px 都有，药槽写死像素会撑破行高，所以：
         药槽高 = clamp(14, (按钮高 − 10) × 0.82, 54)px，药槽宽 = 药槽高 × 1.75
         （36px 高的表单行 → 21.3 × 37.3，正好是样张 `.sm` 段 46×26 的 0.82 档）
       宽度再夹一道按钮自身的 42%：窄下拉（一百来像素）里一颗药吃掉近半条会把文字挤成省略号。
       CSS 侧所有药槽内部尺寸（金属圈环宽、压痕、玻璃罩、胶囊）都用 calc(--pn-ph/--pn-pw * 系数)，
       所以这里只写两个变量，整套材质跟着缩放。 */
    function sizeBtn(inst) {
      var btn = inst.btn;
      var w = btn.offsetWidth || 0, h = btn.offsetHeight || 0;
      if (!w || !h) return;
      // 2026-11-18 用户「可以适当缩小文字和ui尺寸适配」：触发器里的药槽也收 0.82 档
      // （36px 的行 → 药槽 21.3×37.3，和面板里的 38×21.5 同一比例），药槽上限 64→54、下限 16→14。
      // 窄下拉的占比上限 45%→42%，省下来的宽度全给文字 —— 长课次名能多露两个字。
      var ph = Math.max(14, Math.min(54, (h - 10) * .82));
      var pw = ph * 1.75;
      if (pw > w * .42) pw = Math.max(20, w * .42);
      btn.style.setProperty('--pn-ph', Math.round(ph * 10) / 10 + 'px');
      btn.style.setProperty('--pn-pw', Math.round(pw * 10) / 10 + 'px');
    }

    /* 从原生 select 现场抄外观。注意：**只抄能抄的**（字体/行高/对齐/圆角/内边距），
       不抄 width/height —— 那两条由「select 撑包装层、按钮铺满」这个结构负责，抄成 px 反而不能自适应。
       2026-11-18 起**不再抄** backgroundColor / backgroundImage / border* / boxShadow / color：
       触发器现在是一块铝箔卡（实物色，见 inject 里的 .hx-pn-btn），抄过来就又变回普通表单框了。 */
    function skin(inst) {
      var sel = inst.sel, btn = inst.btn, st = btn.style;
      if (!sel.getClientRects().length) return; // 还没露出来，量不到，等下次
      // 第一次真正露出来：量一次宽度策略（隐藏时量出来的结论不可信，见 fit 注释）
      if (!inst.fitted) { try { fit(inst); } catch (e) { } }
      var cs = getComputedStyle(sel);
      var fill = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textAlign'];
      for (var i = 0; i < fill.length; i++) {
        var v = cs[fill[i]];
        if (v) st[fill[i]] = v;
      }
      // 2026-11-18 用户「可以适当缩小文字和ui尺寸适配」：字号跟药槽一起收 0.88 档。
      // 只缩字号不缩药槽会变成「大字小药丸」，所以上面 sizeBtn 同步按 0.82 缩了药槽；
      // 0.88 略大于 0.82 是为了让触发器文字（原生 select 的字号，14~15px）别小到看不清。
      // 同时这也是 ②「文字被截断」的一半解药：12.5px 的「第 13 次课 · 2026-…」比 14px 多露两个字。
      var fs = parseFloat(cs.fontSize);
      if (isFinite(fs) && fs > 0) st.fontSize = (fs * .88).toFixed(1) + 'px';
      // 药槽尺寸先算出来 —— 下面的左右内边距要拿它当基准
      try { sizeBtn(inst); } catch (e) { }
      // 圆角跟随原生 select，最小 6px（26px 高的行再小就成直角了，跟铝箔不搭）
      var br = parseFloat(cs.borderTopLeftRadius);
      st.setProperty('--pn-r', (isFinite(br) ? Math.max(6, Math.min(br, 18)) : 8) + 'px');
      // 左右内边距：左边只留一点点（药槽自己占第一列，文字左边距 = 药槽宽 + 列间距 6px），
      // 右边要补出折角的位置（原生 select 的 paddingRight 常常是给它的 background 箭头留的）。
      // 2026-11-18 用户「右边遮挡不完整」：以前右最多让到 20px，可我们已经有独立的折角列（10px + 6px 间距），
      // 那 20px 是白扔的；左 10 / 右 20 → 左 8 / 右 14，一行文字多出 8px 左右。
      var pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
      st.setProperty('--pn-padl', Math.max(2, Math.min(isFinite(pl) ? pl : 6, 8)) + 'px');
      st.setProperty('--pn-padr', Math.max(5, Math.min((isFinite(pr) ? pr : 6) + 2, 14)) + 'px');
      inst.skinned = true;
    }

    function refresh(el) {
      var inst = wrapOf.get(el);
      if (!inst) return;
      var t = labelOf(el);
      inst.txt.textContent = t;
      inst.btn.disabled = !!el.disabled;
      inst.btn.title = t;
      // 触发器药槽里那颗 = 当前选中项的材质（选项下标 % 3，跟面板里的分配一致）
      if (inst.hero) inst.hero.setAttribute('data-mat', String(Math.max(0, el.selectedIndex) % 3));
      if (!inst.skinned) skin(inst);
    }

    function buildSheet(inst) {
      var sel = inst.sel, cur = sel.selectedIndex, lastGrp = null, i, o;
      sheet.innerHTML = '';
      if (!sel.options.length) {
        sheet.innerHTML = '<div class="hx-pn-empty">没有可选项</div>';
        return;
      }
      for (i = 0; i < sel.options.length; i++) {
        o = sel.options[i];
        var grp = (o.parentNode && o.parentNode.tagName === 'OPTGROUP') ? (o.parentNode.label || '') : '';
        if (grp && grp !== lastGrp) {
          var h = document.createElement('div');
          h.className = 'hx-pn-grp';
          h.textContent = grp;
          sheet.appendChild(h);
        }
        lastGrp = grp;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'hx-pn-opt' + (i === cur ? ' on' : '') + (o.disabled ? ' dis' : '');
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', i === cur ? 'true' : 'false');
        b.setAttribute('data-i', i);
        if (o.disabled) b.disabled = true;
        // 左边那颗胶囊（选中行由 CSS 换成空药槽）+ 右边名字
        // 材质按选项下标 % 3 轮换（0 蓝白 / 1 琥珀 / 2 鼠尾草），三格一排正好三种颜色 ——
        // 样张里就是「一板三种药」，不是同一颗复制三遍。
        b.innerHTML = '<span class="hx-pn-pk"><i class="hx-pn-rim"></i>'
          + '<i class="hx-pn-pill" data-mat="' + (i % 3) + '"></i>'
          + '<i class="hx-pn-dome"></i><i class="hx-pn-cav"></i></span><span class="hx-pn-txt"></span>';
        b.querySelector('.hx-pn-txt').textContent = String(o.text || '').replace(/\s+/g, ' ').trim() || '（空）';
        sheet.appendChild(b);
      }
    }

    /* 摆位。药板本体不再自己 fixed，改由裁剪盒定位置：
         · **优先往下**：药板上沿 = 触发器下沿 + 6px（正好是 clip 的 6px 上内边距），从这里往下滑；
         · 下方矮到连 2 行都放不下、而上方放得下 → 才翻到上方，药板下沿 = 触发器上沿 − 6px，
           此时滑出方向反转为「从下往上」；
         · 两边都放不下 → 夹进视口。
       --pn-hide 就是「藏起来时该偏移多少」：放在触发器下面时往上藏（负值），
       放在上面时往下藏（正值），两边都能完全藏进裁剪盒外面，动画起手才不露边。

       2026-11-18 用户：「这个怎么是往上弹窗 默认肯定往下啊」。
       以前只问「整块药板放不放得下」——放不下就整块翻上去。课次下拉正好在页面下半部分，
       列表一翻就把上面的内容全盖住，看着就是弹错了方向。
       现在改成**优先往下 + 先压缩高度、实在不行才翻**：
         · 下方净空压完还剩 ≥ 88px（2 行）→ 永远往下，maxHeight 夹到「下方净空 − 12px」，内部滚动；
         · 下方真到底了、上方能放下 2 行 → 才翻上去；
         · 两边都不到 2 行 → 取空间大的一边并夹进视口（仍按往下处理，动画方向不变）。
       常见的「页面下半部分」场景（下方 150~400px）从此都是往下弹，只是矮一点、能滚。 */
    function place(inst) {
      var r = inst.wrap.getBoundingClientRect();
      /* 2026-11-18 用户「右边遮挡不完整」：不能只信 documentElement.clientWidth ——
         clip 是 position:fixed，量的是布局视口；页面有竖向滚动条、或宿主用 zoom / transform 缩放过时，
         clientWidth 和真正的可视宽度会差十几像素，右边缘就被裁掉一截。
         先取 clientWidth / innerWidth 的较小值，摆好之后再用 clip.getBoundingClientRect() 复核真实右边缘。 */
      var docW = document.documentElement.clientWidth || 0, winW = innerWidth || 0;
      var vw = (docW && winW) ? Math.min(docW, winW) : (docW || winW);
      var docH = document.documentElement.clientHeight || 0, winH = innerHeight || 0;
      var vh = (docH && winH) ? Math.min(docH, winH) : (docH || winH);
      var pw = Math.round(r.width) + 20;
      if (pw < 168) pw = 168;
      if (pw > 340) pw = 340;
      if (pw > vw - 16) pw = Math.max(120, vw - 16);
      clip.style.width = pw + 'px';
      var capBase = Math.max(120, Math.min(320, vh - 24));
      var roomBelow = Math.round(vh - 8 - r.bottom);   // 触发器下沿到视口底的净空
      var roomAbove = Math.round(r.top - 14);          // 触发器上沿到视口顶（扣 8 边距 + 6 缝）
      var MIN2 = 88;                                   // 2 行保底（行高 38 + 药板上下内边距）
      var below = true, cap;
      if (roomBelow - 12 >= MIN2) {                    // 下方还放得下 2 行：压高度，保持往下
        cap = Math.min(capBase, roomBelow - 12);
      } else if (roomAbove - 12 >= MIN2) {             // 下方真到底了，上方放得下 2 行：翻上去
        below = false;
        cap = Math.min(capBase, roomAbove - 12);
      } else {                                         // 两边都不够 2 行：夹进视口，仍按往下滑
        cap = Math.min(capBase, Math.max(MIN2, Math.max(roomBelow, roomAbove) - 12));
      }
      sheet.style.maxHeight = cap + 'px';
      // 先挪出屏幕量真实高度（transform 不影响 offsetHeight，所以藏着也能量）
      clip.style.left = '-9999px';
      clip.style.top = '0px';
      var sh = sheet.offsetHeight;
      var left = Math.max(8, Math.min(Math.round(r.left), vw - 8 - pw));
      var top;
      if (!below) {
        top = Math.round(r.top) - sh - 12;             // 药板下沿 = r.top − 6，再减上内边距
        if (top < 8) top = 8;
      } else {
        top = Math.round(r.bottom);                    // 下沿对齐：药板上沿 = r.bottom + 6
        // 只夹「药板本身」的越界，**不能拿 sh+36 当判据**：clip 下方那 30px 是给药板阴影留的呼吸位，
        // 压缩后药板正好填满下方时它本来就会溢出视口（看不见也不该看见），按它夹会把药板从触发器上挪开。
        var overY = top + 6 + sh - (vh - 8);
        if (overY > 0) top = Math.max(8, top - overY);
      }
      sheet.style.setProperty('--pn-hide', (below ? -1 : 1) * (sh + 16) + 'px');
      clip.style.left = left + 'px';
      clip.style.top = top + 'px';
      // 摆好之后复核真实右边缘（原因见上面 vw 那段）：超了就把整块往左回退，宁可左边留白也不裁掉字
      try {
        var cr = clip.getBoundingClientRect();
        var overX = Math.ceil(cr.right - (vw - 8));
        if (overX > 0) {
          left = Math.max(8, left - overX);
          clip.style.left = left + 'px';
        }
      } catch (e) { }
    }

    /* 极简档 / 系统「减少动态效果」：胶囊不飞、药板不滑，只淡入淡出。
       判据同时看 html.hx-lite（全站唯一档位开关）和 matchMedia，跟刷题 bscLite() 一致。 */
    function isLite() {
      try { if (document.documentElement.classList.contains('hx-lite')) return true; } catch (e) { }
      try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }

    // 刷题那两条曲线：胶囊从槽里「弹」出来用回弹，后半程飞向触发器用缓入缓出
    function back(t) { return 1 + 2.70158 * (t - 1) * (t - 1) * (t - 1) + 1.70158 * (t - 1) * (t - 1); }
    function cubic(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    function fxOn() { if (fx) fx.style.display = 'block'; }
    function fxOff() {
      if (!fx) return;
      // 还有没播完的碎屑就再等等，别把正在飞的胶囊一起摘掉
      for (var i = 0; i < fx.children.length; i++) if (fx.children[i].getAttribute('data-busy') === '1') return;
      fx.style.display = 'none';
    }

    /* 撕开药槽那一下：一圈细环 + N 片锡纸（照刷题 burst()，尺寸按 ×0.7 的药槽缩小）。
       cx / cy 是视口坐标；fx 层铺满视口且 inset:0，所以坐标可以直接用。 */
    function burstAt(cx, cy, shards) {
      if (!fx) return;
      var g = document.createElement('span');
      g.className = 'hx-pn-burst';
      g.setAttribute('aria-hidden', 'true');
      g.setAttribute('data-busy', '1');
      g.style.left = cx + 'px';
      g.style.top = cy + 'px';
      fx.appendChild(g);
      var ring = document.createElement('span');
      ring.className = 'hx-pn-ring';
      g.appendChild(ring);
      var left = shards ? shards + 1 : 1, done = 0;
      function tick() { if (++done >= left) { g.remove(); fxOff(); } }
      /* 2026-11-18：`finished` 不是保票 —— 页面被判定 hidden（后台标签、投屏切走、CDP 冷启动）
         时这个 Promise 可能一直不 settle，实测过点选 1.8 秒后碎屑组还挂着 data-busy='1'，
         把 fxOff() 顶住、整层永远不熄灯。所以每段动画都配一个定时兜底：到点没回调就自己交卷。 */
      function run(el, frames, opt) {
        var fired = false;
        function once() { if (fired) return; fired = true; tick(); }
        setTimeout(once, ((opt && opt.duration) || 300) + 200);
        try { el.animate(frames, opt).finished.then(once, once); } catch (e) { once(); }
      }
      run(ring, [{ opacity: .7, transform: 'scale(.8)' }, { opacity: 0, transform: 'scale(3.2)' }],
        { duration: 280, easing: 'ease-out', fill: 'forwards' });
      for (var i = 0; i < (shards || 0); i++) {
        var f = document.createElement('span');
        var a = i / shards * Math.PI * 2 + (Math.random() - .5) * .3;
        var d = 18 + Math.random() * 24;
        var x = Math.cos(a) * d, y = Math.sin(a) * d;
        f.style.width = (2.5 + i % 3) + 'px';
        f.style.height = (1.2 + i % 2) + 'px';
        g.appendChild(f);
        run(f, [
          { opacity: .92, transform: 'translate(' + (x * .16) + 'px,' + (y * .12) + 'px) rotate(' + (i * 26) + 'deg)' },
          { opacity: .48, transform: 'translate(' + (x * .66) + 'px,' + (y * .72 - 9) + 'px) rotate(' + (i * 34 + 45) + 'deg)', offset: .56 },
          { opacity: 0, transform: 'translate(' + x + 'px,' + (y + 12) + 'px) rotate(' + (i * 40 + 95) + 'deg)' }
        ], { duration: 290 + i % 4 * 32, fill: 'forwards' });
      }
    }

    /* 胶囊从被点的那一格里飞出来，划一道弧线扎进**触发器左端药槽的中心**（23 帧，与样张同一条曲线）。
       用 translate3d 拼帧而不是改 left/top：不触发重排，95 个下拉扎堆的页面上也不掉帧。
       src = 被点那一格的药槽 rect（碎屑从这里炸开）
       dst = 触发器药槽的 rect（不是整颗按钮 —— 落点必须是槽心，否则胶囊会停在按钮左边凭空一点）
       mat / size = 被点那一格胶囊的材质与实测尺寸，飞出去和落下去必须是同一颗药。 */
    function fly(src, dst, btn, mat, size) {
      if (!fx || !src || !dst || !src.width) return;
      fxOn();
      var W = (size && size.w) || 33, H = (size && size.h) || 14;
      var hero = btn ? btn.querySelector('.hx-pn-pill') : null;
      var txt = btn ? btn.querySelector('.hx-pn-txt') : null;
      var cx = src.left + src.width / 2, cy = src.top + src.height / 2;
      burstAt(cx, cy, 14);
      var pill = document.createElement('span');
      pill.className = 'hx-pn-flight';
      pill.setAttribute('aria-hidden', 'true');
      pill.setAttribute('data-mat', String(mat || 0));
      pill.style.width = W + 'px';
      pill.style.height = H + 'px';
      fx.appendChild(pill);
      // 飞的是「这一颗」的替身，触发器里那颗先藏起来，落点再弹回来（同样张 paintHeader 的时机）
      if (hero) hero.style.visibility = 'hidden';
      var hw = W / 2, hh = H / 2;
      var sx = cx - hw, sy = cy - hh;
      var dx = dst.left + dst.width / 2 - hw, dy = dst.top + dst.height / 2 - hh;
      var lift = 6, N = 23, frames = [];
      for (var i = 0; i < N; i++) {
        var t = i / (N - 1), pop = t <= .36;
        var p = pop ? back(t / .36) : cubic((t - .36) / .64);
        var arc = pop ? 0 : Math.sin(Math.PI * p);
        var x = pop ? sx : sx + (dx - sx) * p - 6 * arc;
        var y = pop ? sy - lift * p : sy - lift + (dy - sy + lift) * p;
        var sc = pop ? 1 + .3 * p : 1.3 + (.34 - 1.3) * p + .06 * arc;
        var tilt = -5.5 * (pop ? p : 1 - p);
        // 不淡出：样张里这颗药是「一路亮到槽心」再被落点那颗顶替的，
        // 提前淡掉会在最后 70ms 留下一个空槽（原来的写法就是这么露的）。
        frames.push({
          transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotate(' + tilt + 'deg) scale(' + sc + ')'
        });
      }
      var anim;
      try { anim = pill.animate(frames, { duration: 430, fill: 'forwards' }); } catch (e) {
        pill.remove();
        if (hero) hero.style.visibility = '';
        return;
      }
      function restore() { if (hero) hero.style.visibility = ''; }
      function land() {
        pill.remove();
        // 落点 = 槽心：再闪一圈，触发器里那颗药弹回来（340ms 回弹），文字跟着淡入（160ms）
        burstAt(dst.left + dst.width / 2, dst.top + dst.height / 2, 0);
        restore();
        if (hero) {
          try {
            hero.animate([{ transform: 'translateY(-3px) scale(1.24)' },
            { transform: 'translateY(1px) scale(.92)', offset: .55 },
            { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' });
          } catch (e) { }
        }
        if (txt) {
          try { txt.animate([{ opacity: .15, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160 }); } catch (e) { }
        }
        try {
          btn.animate([{ transform: 'scale(1.03)' }, { transform: 'scale(.990)', offset: .55 }, { transform: 'none' }],
            { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
        } catch (e) { }
        fxOff();
      }
      /* 收尾必须幂等 + 必须有兜底，原因见上面 run() 那段注释。
         这里比碎屑更要紧：land() 里那句 restore() 是**把触发器那颗胶囊从 visibility:hidden 放回来**，
         它要是没跑，那颗下拉从此就是一个空槽、没有胶囊 —— 用户会当成「坏了」。 */
      var landed = false;
      function landOnce(fell) {
        if (landed) return; landed = true;
        if (fell) { try { land(); } catch (e) { pill.remove(); restore(); fxOff(); } return; }
        pill.remove(); restore(); fxOff();
      }
      anim.finished.then(function () { landOnce(true); }, function () { landOnce(false); });
      setTimeout(function () { landOnce(true); }, 430 + 140);
    }

    /* instant=true：立刻收（不播滑回动画）。换触发器 / 页面滚动 / Esc 走这里，
       因为那时候触发器可能已经不在原位，让药板「滑回某个已经移走的位置」反而像卡住。 */
    function close(instant) {
      clearTimeout(hideT);
      clearTimeout(pickT);
      if (!OPEN) {
        if (instant && clip) clip.style.display = 'none';
        return;
      }
      var inst = OPEN;
      OPEN = null;
      try { inst.btn.setAttribute('aria-expanded', 'false'); } catch (e) { }
      if (!clip) return;
      if (instant) { clip.style.display = 'none'; return; }
      sheet.inert = true;                     // 药板滑回触发器背后
      hideT = setTimeout(function () { if (!OPEN && clip) clip.style.display = 'none'; }, 480);
    }

    function pick(inst, i, row) {
      var sel = inst.sel;
      if (sel.selectedIndex === i) { refresh(sel); close(); return; }
      var lite = isLite();
      // 起点/落点必须在收起之前量 —— 药板一开始滑，行就不在原位了。
      // src = 被点那一格的药槽（碎屑中心）；dst = **触发器自己的药槽**（不是整颗按钮），
      // 落点取槽心，胶囊才落在槽里而不是停在按钮左边凭空一点。
      // mat/size 跟着被点那格走：飞出去和落下去必须是同一颗药。
      var src = null, dst = null, mat = 0, size = null;
      if (!lite && row && row.querySelector && inst.btn.getClientRects().length) {
        var pk = row.querySelector('.hx-pn-pk');
        var pillel = row.querySelector('.hx-pn-pill');
        var heroPk = inst.btn.querySelector('.hx-pn-pk');
        if (pk && heroPk) {
          src = pk.getBoundingClientRect();
          dst = heroPk.getBoundingClientRect();
          if (pillel) {
            mat = +(pillel.getAttribute('data-mat') || 0);
            var pr = pillel.getBoundingClientRect();
            if (pr.width) size = { w: pr.width, h: pr.height };
          }
        }
      }
      sel.selectedIndex = i;
      refresh(sel);
      /* 点中的那格当场变成空药槽（同刷题 choose()：换的是壳不是数据）——
         胶囊就是从这一格里飞走的，若等下一 次 buildSheet 才换，飞行起点会对着另一格。 */
      if (!lite && row && sheet) {
        var opts = sheet.querySelectorAll('.hx-pn-opt');
        for (var k = 0; k < opts.length; k++) {
          var isOn = opts[k] === row;
          opts[k].classList.toggle('on', isOn);
          opts[k].setAttribute('aria-selected', isOn ? 'true' : 'false');
        }
      }
      // 顺序跟原生一致：先 input 再 change。写请求类的监听方（如果这个 select 触发了存盘）不受影响 ——
      // 这里只是把「用户选了一下」这件事补上，不做任何重试（全站写请求都不许重试）。
      try { sel.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
      try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
      try { inst.btn.focus({ preventScroll: true }); } catch (e2) { }
      if (!src || !dst) { close(); return; }
      /* 动效放在派发之后：change 的监听方常常就地重画页面（甚至开对话框），
         先把数据这一趟走完，再纯粹放烟花，出问题也只是少一个动画，不会挡住功能。 */
      var cav = row.querySelector('.hx-pn-cav');   // 被撕开的那格先亮一下
      if (cav) {
        try {
          cav.animate([{ transform: 'scale(.84)', filter: 'brightness(1.35)' },
          { transform: 'scale(1.05)', filter: 'brightness(.92)', offset: .45 },
          { transform: 'none', filter: 'none' }], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
        } catch (e) { }
      }
      try { fly(src, dst, inst.btn, mat, size); } catch (e) { }
      /* 收板子晚 165ms：胶囊飞出槽的那一段（0~36% / 430ms ≈ 155ms）得在板子上演完，
         否则药板一眨眼就滑走，只剩一颗胶囊在半空飘，看不出「从这一格里取走」。
         数据早就在上面派发完了，这 165ms 只是画面，不影响任何工具。 */
      clearTimeout(pickT);
      pickT = setTimeout(function () { close(); }, 165);
    }

    function onSheetClick(e) {
      var b = e.target && e.target.closest ? e.target.closest('.hx-pn-opt') : null;
      if (!b || !OPEN || b.disabled) return;
      pick(OPEN, +b.getAttribute('data-i'), b);
    }

    function open(inst) {
      // 双击（或合成点击连发两次 click）时别把刚开出来的面板又收起来 —— 260ms 内的第二下直接忽略。
      // 原生 select 双击也是「开着」，这里对齐它。
      var now = +new Date();
      if (OPEN === inst && now - (inst.t || 0) < 260) return;
      inst.t = now;
      if (OPEN === inst) { close(); return; }
      close(true);
      inject();
      if (!clip) {
        clip = document.createElement('div');
        clip.className = 'hx-pn-clip';
        sheet = document.createElement('div');
        sheet.className = 'hx-pn-sheet';
        sheet.setAttribute('role', 'listbox');
        sheet.addEventListener('click', onSheetClick);
        clip.appendChild(sheet);
      }
      if (clip.parentNode !== document.body) document.body.appendChild(clip);
      if (!fx) {
        fx = document.createElement('div');
        fx.className = 'hx-pn-fx';
      }
      if (fx.parentNode !== document.body) document.body.appendChild(fx);
      skin(inst);
      buildSheet(inst);
      sheet.style.display = '';       // 兼容上一版：药板本身不再控制显隐，交回 CSS
      clip.style.display = 'block';
      sheet.inert = true;             // 先摆成「藏在触发器背后」，下一帧再放行
      OPEN = inst;
      place(inst);
      try { inst.btn.setAttribute('aria-expanded', 'true'); } catch (e) { }
      var on = sheet.querySelector('.hx-pn-opt.on');
      if (on) sheet.scrollTop = Math.max(0, on.offsetTop - sheet.clientHeight / 2 + on.offsetHeight / 2);
      var lite = isLite();
      // 两个 rAF 再放行：CSS 过渡把药板从触发器背后滑下来（跟刷题一模一样的起手）
      (window.requestAnimationFrame || setTimeout)(function () {
        if (OPEN !== inst) return;
        sheet.inert = false;
        if (lite) return;
        // 每颗胶囊从槽里逐个弹起，delay 按行号递增 —— 药板滑下来的同时药粒「醒过来」
        var pills = sheet.querySelectorAll('.hx-pn-opt:not(.on) .hx-pn-pill');
        for (var i = 0; i < pills.length; i++) {
          try {
            pills[i].animate([{ transform: 'translateY(-4px) scale(.82)' },
            { transform: 'translateY(1px) scale(1.06)', offset: .65 },
            { transform: 'none' }],
              { duration: 380, delay: i * 45, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
          } catch (e) { }
        }
      });
    }

    function enhance(sel) {
      if (wrapOf.has(sel) || sel.multiple || sel.size > 1) return;
      if (sel.hasAttribute('data-hx-plain')) return;
      if (!sel.parentNode) return;
      inject();
      var wrap = document.createElement('span');
      wrap.className = 'hx-pn';
      sel.parentNode.insertBefore(wrap, sel);
      sel.classList.add('hx-pn-src');
      wrap.appendChild(sel);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hx-pn-btn';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      // 结构 = [药槽(含一颗胶囊)] [文字 flex:1] [折角]，跟触发器那块的布局一一对应。
      // 药槽里的胶囊 data-mat 由 refresh() 按当前选中项 % 3 写（三种材质）。
      btn.innerHTML = '<span class="hx-pn-pk"><i class="hx-pn-rim"></i>'
        + '<i class="hx-pn-pill" data-mat="0"></i><i class="hx-pn-dome"></i></span>'
        + '<span class="hx-pn-txt"></span><i class="hx-pn-car" aria-hidden="true"></i>';
      wrap.appendChild(btn);
      var inst = {
        sel: sel, wrap: wrap, btn: btn, txt: btn.querySelector('.hx-pn-txt'),
        hero: btn.querySelector('.hx-pn-pill'), skinned: false, fitted: false
      };
      wrapOf.set(sel, inst);
      all.push(inst);
      try { fit(inst); } catch (e) { }
      watchSize(inst);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (sel.disabled) return;
        open(inst);
      });
      // 铝箔上的那团反光跟着鼠标走（样张 pointermove）。只在标准模式生效 ——
      // 极简档连这个都要省，所以判据放在事件里而不是绑定时（运行中切档也能立刻停掉）。
      btn.addEventListener('pointermove', function (e) {
        if (isLite()) return;
        var r = btn.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = Math.max(-20, Math.min(120, (e.clientX - r.left) / r.width * 100));
        var y = Math.max(-20, Math.min(120, (e.clientY - r.top) / r.height * 100));
        btn.style.setProperty('--sheen-x', x + '%');
        btn.style.setProperty('--sheen-y', y + '%');
      });
      btn.addEventListener('pointerdown', function () { skin(inst); });
      sel.addEventListener('change', function () { refresh(sel); });
      sel.addEventListener('focus', function () { skin(inst); });
      // 选项被 JS 重画（attendance.js 的「请选择科目」、ui-builder.js 那些）时，按钮文字要跟着对
      try {
        new MutationObserver(function () { refresh(sel); })
          .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
      } catch (e) { }
      refresh(sel);
    }

    function scan(root) {
      var list = [];
      if (root && root.nodeType === 1 && root.tagName === 'SELECT') list.push(root);
      if (root && root.querySelectorAll) list = list.concat([].slice.call(root.querySelectorAll('select')));
      for (var i = 0; i < list.length; i++) { try { enhance(list[i]); } catch (e) { } }
    }

    function reskin() { for (var i = 0; i < all.length; i++) { all[i].skinned = false; skin(all[i]); } }

    /* 还没量过宽度的实例：等它露出来补一次（登录墙后面那些 select 属于这一类）。
       只对「未量过」的动手，全部量完之后这个循环只剩几十次布尔判断，可以挂在扫描节流里跑。 */
    function fitPending() {
      for (var i = 0; i < all.length; i++) {
        if (all[i].fitted) continue;
        try { skin(all[i]); } catch (e) { }
      }
    }

    /* 「露出来」的正确触发点是 ResizeObserver，不是 MutationObserver：
       登录墙撤掉只是改了一个 class / style，DOM 结构一点没动，childList 观察者根本收不到消息；
       而元素从 0×0 变成有尺寸，一定是尺寸变化 —— 这正是 ResizeObserver 管的事（2026-11-17 实测）。 */
    function watchSize(inst) {
      if (!window.ResizeObserver) return;
      if (!ro) {
        ro = new ResizeObserver(function (list) {
          for (var i = 0; i < list.length; i++) {
            var it = instOf.get(list[i].target);
            if (!it) continue;
            if (!it.fitted) { try { skin(it); } catch (e) { } continue; }
            // 已经量过宽度的：容器一改高（响应式断点、字体放大、flex 拉伸），药槽跟着重算，
            // 否则会出现「26px 的按钮里塞着一颗 46px 的药槽」。
            try { sizeBtn(it); } catch (e) { }
          }
        });
      }
      instOf.set(inst.wrap, inst);
      try { ro.observe(inst.wrap); } catch (e) { }
    }

    function globals() {
      if (globals.on) return;
      globals.on = true;
      addEventListener('pointerdown', function (e) {
        if (!OPEN) return;
        if (sheet && sheet.contains(e.target)) return;
        if (OPEN.wrap.contains(e.target)) return;
        close();
      }, true);
      addEventListener('keydown', function (e) {
        if (!OPEN) return;
        if (e.key === 'Escape' || e.key === 'Esc') close();
      }, true);
      // 页面一滚就收（面板是 fixed，位置会飘）；面板自己内部的滚动不算
      addEventListener('scroll', function (e) {
        if (!OPEN) return;
        if (e.target && e.target.nodeType === 1 && sheet && sheet.contains(e.target)) return;
        close();
      }, { capture: true, passive: true });
      addEventListener('resize', function () { if (OPEN) place(OPEN); });
      addEventListener('orientationchange', function () { if (OPEN) place(OPEN); });
      try { if (window.HXTheme && HXTheme.onChange) HXTheme.onChange(reskin); } catch (e) { }
    }

    function init() {
      if (inited) { scan(document); return; }
      inited = true;
      globals();
      inject();
      scan(document);
      // 页面后续动态插入的 select（对话框、动态表格行）也要接管；节流到一帧一次，别在 busy 页面上狂扫
      try {
        new MutationObserver(function () {
          if (queued) return;
          queued = true;
          (window.requestAnimationFrame || setTimeout)(function () { queued = false; scan(document); fitPending(); }, 16);
        }).observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) { }
    }

    /* 代码用 JS 改值（`sel.value = x` / `sel.selectedIndex = i`）不会发事件，
       按钮文字就会停在旧值上 —— 这是这种「可视替身」最容易漏的一处，所以在原型 setter 上挂个钩子。
       只做「改完刷新文字」这一件事，取值/赋值原样转发，不改变任何行为。 */
    (function hookValue() {
      try {
        var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        if (!d || !d.set || d.set.__hxPeanut) return;
        var set = function (v) { d.set.call(this, v); try { refresh(this); } catch (e) { } };
        set.__hxPeanut = true;
        Object.defineProperty(HTMLSelectElement.prototype, 'value', { configurable: true, enumerable: d.enumerable, get: d.get, set: set });
        var di = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
        if (di && di.set && !di.set.__hxPeanut) {
          var seti = function (v) { di.set.call(this, v); try { refresh(this); } catch (e) { } };
          seti.__hxPeanut = true;
          Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', { configurable: true, enumerable: di.enumerable, get: di.get, set: seti });
        }
      } catch (e) { }
    })();

    window.HXPeanut = {
      init: init, scan: scan, open: open, close: close, refresh: function (el) { el ? refresh(el) : reskin(); },
      count: function () { return all.length; }
    };

    if (document.documentElement.hasAttribute('data-hx-peanut')) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
      else init();
    }
  })();

})();
