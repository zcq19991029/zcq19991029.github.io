/* UI 设计 · 组件数据（2026-11-17 建立）
   ─────────────────────────────────────────────────────────────────────────
   这份文件就是整个工具的唯一数据源：目录、详情页、搜索、复制按钮全部从 items 里长出来。
   加一个组件 = 往 items 里 push 一个对象 + 在 demo/ 里放一个能独立运行的预览页。
   字段含义：
     id      路由用（#/c/<id>），一旦发布别再改，外部可能已经引用
     name    标题（用户口中的叫法，不是学名）
     sub     一句话说清它解决什么问题
     tags    搜索关键词（中英文都写，方便以后接 AI 检索）
     intro   正文段落数组，第一段讲「为什么」，第二段讲「坑在哪」
     source  来源与署名（开源学习用途，务必写清）
     demo    demo/ 下的预览页文件名；demoH 是预览区高度
     params  可调参数表（k / def / d）
     deps    依赖与前置条件（代码块 + 说明）
     code    源码分栏（lang + label + code）
     usage   最小可用示例（代码 + 说明）
     prompt  复刻提示词：可以直接粘给 AI 让它重做一遍
     api     API 参考表（k / t / def / d）
   ───────────────────────────────────────────────────────────────────────── */
window.UIKIT = {
  version: '0.3',
  updated: '2026-11-17',
  items: [

    /* ═══════════════════════════════════════════════════════════════════
       1. 药丸下拉选项卡
       ═══════════════════════════════════════════════════════════════════ */
    {
      id: 'peanut',
      name: '药丸下拉选项卡',
      sub: '把原生 <select> 换成一块铝箔药板：每行一颗胶囊，选中的那颗被取走了',
      tags: ['下拉', 'select', '药丸', '胶囊', '药板', '铝箔', '表单', 'dropdown', 'pill', 'blister'],
      date: '2026-11-17',
      intro: [
        '原生下拉在教室里有两个致命问题：一是样式跟着操作系统跑（希沃一体机上是一坨灰色系统控件），二是选项列表又窄又丑，投屏时后排根本看不清。所以做成「原生 select 的可视替身」——select 还留在 DOM 里负责值，屏幕上看到的是这块药板。',
        '关键决策：做成一个**增强器**，而不是挨个手写弹层。项目里有九十多个 select，分散在十几个工具，很多还是 JS 动态生成的；逐个手写等于九十几套定位/关闭/键盘逻辑，最后必然歪成九十几种样子。',
        '面板长相照抄「科目药板」那套：铝箔拉丝底 + 金属圈凹槽 + 蓝白两截胶囊，选中行把胶囊取走、露出撕开的空药槽。铝箔是实物色，深色页面上它也是一块亮银药板，不跟主题走。',
        '**只像不动 = 白做**。第一版把外观抄全了，用户一眼就看出来「跟刷题那个只是长得一样」—— 真正的药丸感全在动效里：药板从触发器背后 460ms 弹出来、每颗胶囊错开 45ms 逐个醒过来；点中某一格时那格当场被撕成空槽，一颗**放大的胶囊从槽里弹起、划一道弧线扎进触发器左端缩没**，落点再炸一圈冲击环和 14 片锡纸。这些全部用 WAAPI 逐帧 `translate3d` 驱动（不改 left/top，不触发重排），极简档和系统「减少动态效果」下自动降级成纯淡入淡出。'
      ],
      source: {
        name: '华夏工具 · 刷题「科目药板」',
        note: '本项目原创，从刷题页的 .bsc-foil / .bsc-rim / .bsc-pill / 飞行胶囊与碎屑动效 提炼成通用组件。仅供学习使用。'
      },
      demo: 'peanut.html',
      demoH: 430,
      params: [
        { k: 'data-hx-peanut', def: '—', d: '加在 <html> 上，整页的 <select> 全部接管。' },
        { k: 'data-hx-plain', def: '—', d: '加在某个 <select> 上，跳过它（比如打印页、需要原生的地方）。' },
        { k: 'multiple / size>1', def: '自动跳过', d: '多选和列表式 select 形状完全不同，组件不接管。' },
        { k: '胶囊尺寸', def: '药槽 38×21 / 胶囊 28×11', d: '刷题原版是 54×30 / 40×16，这里乘 0.7 —— 原生 select 常常只有一百来像素宽，一颗药吃掉 54px 会把选项名挤成省略号。' },
        { k: '展开曲线', def: '460ms cubic-bezier(.22,1.06,.36,1)', d: '药板上滑出/滑回的时间与曲线，和 opacity 320ms 并行。这条曲线起手极快、尾巴带一点过冲，就是「弹出来」的手感；换成 ease 会软塌塌。' },
        { k: '胶囊起飞', def: '430ms / 23 帧', d: '前 36% 在药槽里弹起放大（回弹曲线），后 64% 沿抛物线飞向触发器并缩到 0.34 倍、末段淡出。帧数是硬编码的数组，改曲线只改这一处。' },
        { k: '收板延迟', def: '165ms', d: '点中之后不是立刻收板，而是等「胶囊弹出槽」这一段演完（36% × 430ms ≈ 155ms）再收 —— 否则药板一眨眼就没，只剩一颗胶囊在半空飘，看不出是从哪一格取走的。数据（input/change）仍然在点击当下就派发完。' },
        { k: '面板最大高度', def: '跟随 .hx-pn-sheet 的 overflow', d: '选项超过容器高度时面板自己滚，并且打开时自动把选中项滚到中间。' }
      ],
      deps: {
        code: '不需要任何依赖、框架、构建工具。\n只有一条前置：给 <html> 加 data-hx-peanut（或用 HXPeanut.scan(root) 手动挂）。',
        note: '本站版本在 hx-theme.js 末尾，随全站主题脚本加载，各工具零成本接入。'
      },
      code: [
        {
          lang: 'html', label: 'HTML',
          code: `<html lang="zh-CN" data-hx-peanut>
...
<label>
  科目
  <select id="subj">
    <option>单片机技术及应用</option>
    <option>电气理论</option>
  </select>
</label>

<!-- 就这样。不用写按钮、不用写弹层、不用改 onchange。
     选完之后组件会写 selectedIndex 并派发 input / change，
     你原来那句 onchange="start()" 照常跑。 -->`
        },
        {
          lang: 'css', label: 'CSS',
          code: `/* 面板 = 一块铝箔药板。下面这一段是配方本体，尺寸按 0.7 缩过。 */

/* ① 裁剪盒：药板住在它里面，overflow:hidden 让「滑进滑出」有遮挡可依。
      没有这一层，收起时会看到药板整块飘在触发器上方。
      上下留 6px / 30px 内边距，是给药板那圈大阴影留呼吸位。 */
.hx-pn-clip{
  position:fixed; z-index:2147482000; display:none; box-sizing:border-box;
  padding:6px 0 30px; overflow:hidden; pointer-events:none;
}

/* ② 药板本体。transition 就是「弹出来」的来源，时长别省。 */
.hx-pn-sheet{
  position:relative; box-sizing:border-box; width:100%; overflow:auto; pointer-events:auto;
  transition:transform 460ms cubic-bezier(.22,1.06,.36,1), opacity 320ms cubic-bezier(.22,1.06,.36,1);
  padding:6px; border-radius:14px; color:#20242a; border:1px solid rgba(255,255,255,.41);
  background:
    radial-gradient(300px circle at 38% 28%,rgba(255,255,255,.52) 0,rgba(255,255,255,.14) 38%,transparent 72%),
    repeating-linear-gradient(45deg,rgba(255,255,255,.23) 0 1px,transparent 1px 3.5px),
    repeating-linear-gradient(-45deg,rgba(55,60,70,.12) 0 1px,transparent 1px 3.5px),
    repeating-linear-gradient(0deg,rgba(255,255,255,.145) 0,rgba(0,0,0,.04) 1px,rgba(255,255,255,.11) 2px),
    linear-gradient(165deg,#eceef1,#d8dade 36%,#c5c9d0 74%,#d4d7dc);
  box-shadow:
    inset 0 1.5px 1px rgba(255,255,255,.91), inset 1px 0 1px rgba(255,255,255,.65),
    inset 0 -2px 3px rgba(72,76,86,.55), inset -1px 0 2px rgba(82,86,96,.38),
    0 14px 30px -8px rgba(0,0,0,.6), 0 4px 10px rgba(0,0,0,.31);
}

/* ③ 收起位：藏到触发器背后。--pn-hide 由 JS 按实测高度写（向上展开时取正值反向藏），
      写死 -100% 只能应付「向下展开」那一种情况。 */
.hx-pn-sheet[inert]{ transform:translateY(var(--pn-hide,-160px)); opacity:0; pointer-events:none; }

/* 一行 = 药板上的一格：左边一颗药，右边名字 */
.hx-pn-opt{
  display:grid; grid-template-columns:38px minmax(0,1fr); gap:9px; align-items:center;
  width:100%; box-sizing:border-box; min-height:42px; padding:0 11px;
  border:0; border-radius:0; background:transparent; color:#20242a;
  font:inherit; font-size:13.5px; font-weight:600; text-align:left; cursor:pointer; overflow:hidden;
}
.hx-pn-opt + .hx-pn-opt{ border-top:1px dotted rgba(84,89,100,.53); }
.hx-pn-opt:hover{ background:rgba(255,255,255,.24); }
.hx-pn-opt.dis{ opacity:.42; cursor:not-allowed; }

/* 药槽：四层叠出来 —— 金属圈(含压痕) → 胶囊 → 玻璃罩 → 撕开的空槽 */
.hx-pn-pk{ position:relative; display:grid; place-items:center; width:38px; height:21px; isolation:isolate; }
.hx-pn-rim{
  position:absolute; inset:1px 1.5px; border-radius:999px;
  background:linear-gradient(162deg,rgba(251,252,255,.61) 2%,rgba(115,121,134,.47) 24%,
    rgba(244,245,248,.32) 49%,rgba(76,82,94,.33) 66%,#fff 96%);
  box-shadow:0 1px 1.4px rgba(0,0,0,.27),
    inset 0 0 0 1px rgba(250,252,255,.75), inset 0 0 0 1.5px rgba(130,136,149,.55),
    inset 0 0 0 2.5px rgba(233,237,242,.61), inset 0 .7px 3.5px rgba(51,57,70,.77);
}
.hx-pn-rim::after{
  content:""; position:absolute; inset:3.5px; border-radius:inherit;
  background:rgba(184,187,198,.36);
  box-shadow:inset 0 1.4px 2px rgba(52,56,66,.33), inset 0 -.7px .7px #fff;
}
.hx-pn-dome{
  position:absolute; z-index:2; inset:3px 4px; border-radius:999px;
  background:linear-gradient(145deg,rgba(255,255,255,.33),rgba(255,255,255,.07) 32%,
    transparent 56%,rgba(255,255,255,.13));
  box-shadow:inset 0 1px 1px rgba(255,255,255,.6);
}
.hx-pn-pill{
  position:relative; width:28px; height:11px; border-radius:999px;
  background:linear-gradient(90deg,#0645c5 0 49%,#e8e8e8 50%);
  box-shadow:0 1px 2px rgba(17,24,34,.4), inset 0 1px 1px rgba(0,0,0,.4);
}
.hx-pn-pill::before{
  content:""; position:absolute; inset:1.4px 50% 1.8px 1.8px;
  border:1px solid rgba(96,153,252,.33); border-right:0; border-radius:999px 0 0 999px;
}
.hx-pn-pill::after{
  content:""; position:absolute; inset:0; border-radius:inherit;
  background:linear-gradient(180deg,rgba(0,0,0,.47),transparent 33%,rgba(255,255,255,.33) 68%,rgba(0,0,0,.27));
  box-shadow:inset 0 -.7px .7px rgba(0,0,0,.33);
}
/* 选中的那一格：胶囊被取走，露出撕开的空槽（毛边用 clip-path 切） */
.hx-pn-cav{
  position:absolute; inset:1px 1.5px; display:none; border-radius:999px;
  background:conic-gradient(from 12deg,#f5f5f5,#666970 10%,#e4e6e8 17%,#b8bbc2 29%,
    #f5f5f5 37%,#484b50 48%,#d6d8db 59%,#878b91 66%,#f6f6f6 78%,#4a4c50 89%,#efeff0);
  box-shadow:inset 0 0 0 1px #fff, inset 0 0 0 1.5px #7a7d82,
    inset 0 0 0 2.5px #e4e6ea, 0 1.4px 2.8px rgba(0,0,0,.31);
}
.hx-pn-cav::before, .hx-pn-cav::after{ content:""; position:absolute; }
.hx-pn-cav::before{
  inset:3px 4px;
  clip-path:polygon(0 34%,9% 10%,25% 18%,38% 0,52% 14%,72% 0,89% 15%,100% 36%,
    97% 77%,87% 95%,69% 86%,56% 100%,38% 82%,24% 92%,20% 64%,4% 63%);
  background:repeating-linear-gradient(4deg,rgba(255,255,255,.06) 0 1px,transparent 1px 3px),
    radial-gradient(ellipse at 50% 78%,#4d4f51,#252729 62%,#111214 83%);
  box-shadow:inset 0 3px 8px #000;
}
.hx-pn-cav::after{
  width:37%; height:61%; left:8%; bottom:9%;
  clip-path:polygon(0 3%,38% 14%,52% 30%,85% 42%,74% 64%,99% 90%,51% 100%,11% 75%);
  background:conic-gradient(from 31deg at 46% 49%,rgba(255,255,255,.73),#8c8f95,#fff,
    #53565e,#f9fafc,#bcbec3,rgba(255,255,255,.73));
}
.hx-pn-opt.on .hx-pn-cav{ display:block; }
.hx-pn-opt.on :is(.hx-pn-rim,.hx-pn-dome,.hx-pn-pill){ visibility:hidden; }
.hx-pn-opt.on .hx-pn-txt{ font-weight:800; }

/* ── 动效层：一颗会飞的胶囊 + 铝箔碎屑 ─────────────────────────────
   飞行的胶囊不能放在 .hx-pn-clip 里 —— 裁剪盒只罩住药板，触发器在它外面，
   飞行路径会被裁掉。所以单独开一层铺满视口、不吃事件的层，坐标就是视口坐标。 */
.hx-pn-fx{ position:fixed; inset:0; z-index:2147482001; display:none; pointer-events:none; overflow:hidden; }

/* 飞行中的那颗：和药槽里的胶囊同一套渐变 + 两道高光，尺寸也一样（爬起来才不像换了个东西） */
.hx-pn-flight{
  position:absolute; top:0; left:0; width:28px; height:11px; border-radius:999px;
  background:linear-gradient(90deg,#0645c5 0 49%,#e8e8e8 50%);
  box-shadow:0 1px 2px rgba(17,24,34,.4), inset 0 1px 1px rgba(0,0,0,.4);
  will-change:transform;
}
.hx-pn-flight::before{
  content:""; position:absolute; inset:1.4px 50% 1.8px 1.8px;
  border:1px solid rgba(96,153,252,.33); border-right:0; border-radius:999px 0 0 999px;
}
.hx-pn-flight::after{
  content:""; position:absolute; inset:0; border-radius:inherit;
  background:linear-gradient(180deg,rgba(0,0,0,.47),transparent 33%,rgba(255,255,255,.33) 68%,rgba(0,0,0,.27));
  box-shadow:inset 0 -.7px .7px rgba(0,0,0,.33);
}

/* 碎屑组：一圈冲击环 + 若干片锡纸，位置由 JS 写 left/top，每片自己一条 WAAPI 轨迹 */
.hx-pn-burst{ position:absolute; pointer-events:none; }
.hx-pn-burst > span{ position:absolute; background:#f4f6f9; box-shadow:0 0 1px #51535f; }
.hx-pn-burst > .hx-pn-ring{
  width:18px; height:10px; margin:-5px -9px; background:transparent;
  border:1px solid #1a56ff; border-radius:50%; box-shadow:none;
}

/* 极简档 / 系统「减少动态效果」：药板不滑、胶囊不飞，只淡入淡出 */
html.hx-lite .hx-pn-sheet{ transition:opacity .16s linear; }
html.hx-lite .hx-pn-sheet[inert]{ transform:none; }
@media (prefers-reduced-motion:reduce){
  .hx-pn-sheet{ transition:opacity .16s linear; }
  .hx-pn-sheet[inert]{ transform:none; }
}`
        },
        {
          lang: 'js', label: 'JS',
          code: `/* 药丸下拉增强器（精简版，去掉本站的忙碌提示与主题令牌依赖）
   三条铁律：
   1) 原生 select 留在 DOM 里（visibility:hidden），只负责值 —— 用 visibility 而不是 opacity，
      否则 Tab 会停在一个看不见的控件上；两者都在流里，包装层尺寸自动跟着 select 走。
   2) 选中后写 selectedIndex 并派发 input / change，页面原有逻辑一行都不用改。
   3) 代码里 sel.value = x 不会触发事件 —— 所以在 select 的 value / selectedIndex setter 上挂钩子刷新按钮文字。
   外加一条动效铁律：**数据先走、动画后放**。input/change 同步派发完再飞胶囊，
   监听方就地重画页面也不受影响，最坏情况只是少演一个动画。 */
(function () {
  if (window.HXPeanut) return;
  var STYLE_ID = 'hx-peanut-style', sheet = null, clip = null, fx = null;
  var OPEN = null, all = [], inited = false, queued = false, hideT = 0, pickT = 0;
  var wrapOf = new WeakMap();

  function inject() { /* 把上面那段 CSS 塞进 <style id="hx-peanut-style">，略，见 CSS 分栏 */ }

  function labelOf(sel) {
    var o = sel.options[sel.selectedIndex];
    return o ? String(o.text || '').replace(/\\s+/g, ' ').trim() : '';
  }

  /* 按钮外观从 select 的 computed style 现场抄；但 url() 图层要丢掉 ——
     原生 select 常挂一个箭头图标，不搬 repeat/position 就会平铺满整条按钮。 */
  function stripIconLayers(bg) {
    if (!bg || bg.indexOf('url(') === -1) return bg;
    var parts = [], depth = 0, cur = '';
    for (var i = 0; i < bg.length; i++) {
      var ch = bg.charAt(i);
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    var keep = [];
    for (var j = 0; j < parts.length; j++) if (parts[j].indexOf('url(') === -1) keep.push(parts[j]);
    return keep.join(',') || 'none';
  }

  function skin(inst) {
    if (!inst.sel.getClientRects().length) return;
    var cs = getComputedStyle(inst.sel), st = inst.btn.style;
    ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'borderRadius',
      'paddingLeft', 'paddingRight'].forEach(function (k) { if (cs[k]) st[k] = cs[k]; });
    st.backgroundImage = stripIconLayers(cs.backgroundImage);
  }

  function refresh(sel) {
    var inst = wrapOf.get(sel); if (!inst) return;
    var t = labelOf(sel);
    inst.txt.textContent = t;
    inst.btn.disabled = !!sel.disabled;
    inst.btn.title = t;
    skin(inst);
  }

  function buildSheet(inst) {
    var sel = inst.sel, cur = sel.selectedIndex;
    sheet.innerHTML = '';
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'hx-pn-opt' + (i === cur ? ' on' : '') + (o.disabled ? ' dis' : '');
      b.dataset.i = i;
      b.innerHTML = '<span class="hx-pn-pk"><i class="hx-pn-rim"></i><i class="hx-pn-pill"></i>'
        + '<i class="hx-pn-dome"></i><i class="hx-pn-cav"></i></span><span class="hx-pn-txt"></span>';
      b.querySelector('.hx-pn-txt').textContent = String(o.text || '').replace(/\\s+/g, ' ').trim() || '（空）';
      sheet.appendChild(b);
    }
  }

  /* 极简档 / 系统「减少动态效果」：药板不滑、胶囊不飞，只淡入淡出 */
  function isLite() {
    if (document.documentElement.classList.contains('hx-lite')) return true;
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function back(t) { return 1 + 2.70158 * (t - 1) * (t - 1) * (t - 1) + 1.70158 * (t - 1) * (t - 1); }
  function cubic(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* 摆位。药板本体不自己 fixed，由裁剪盒定位置：
     下面放得下 → 药板上沿 = 触发器下沿 + 6px（正好是裁剪盒的 6px 上内边距）；
     放不下 → 翻到上方，滑出方向反转为「从下往上」。
     --pn-hide = 藏起来时该偏移多少：放在下面往上藏（负值）、放在上面往下藏（正值），
     两边都能完全藏到裁剪盒外面，动画起手才不露边。写死 -100% 只能应付向下展开那一种。 */
  function place(inst) {
    var r = inst.wrap.getBoundingClientRect();
    var pw = Math.min(340, Math.max(168, Math.round(r.width) + 20));
    clip.style.width = pw + 'px';
    sheet.style.maxHeight = Math.min(320, innerHeight - 24) + 'px';
    clip.style.left = '-9999px'; clip.style.top = '0px';      // 先挪出屏幕量真实高度
    var sh = sheet.offsetHeight, h = sh + 36;                 // + 裁剪盒上下内边距 6 + 30
    var left = Math.max(8, Math.min(r.left, innerWidth - 8 - pw));
    var top = r.bottom, below = true;
    if (top + h > innerHeight - 8) {
      var up = r.top - sh - 12;
      if (up >= 8) { top = up; below = false; } else top = Math.max(8, innerHeight - 8 - h);
    }
    sheet.style.setProperty('--pn-hide', (below ? -1 : 1) * (sh + 16) + 'px');
    clip.style.left = left + 'px'; clip.style.top = top + 'px';
  }

  function open(inst) {
    if (OPEN === inst) return close();
    close(true);                       // 换触发器时上一次的板子立刻收掉，不播动画
    inject();
    if (!clip) {
      clip = document.createElement('div'); clip.className = 'hx-pn-clip';
      sheet = document.createElement('div'); sheet.className = 'hx-pn-sheet';
      sheet.setAttribute('role', 'listbox');
      sheet.addEventListener('click', onPick);
      clip.appendChild(sheet);
    }
    if (clip.parentNode !== document.body) document.body.appendChild(clip);
    if (!fx) fx = document.createElement('div');
    fx.className = 'hx-pn-fx';
    if (fx.parentNode !== document.body) document.body.appendChild(fx);

    buildSheet(inst);
    clip.style.display = 'block';
    sheet.inert = true;                // 先摆成「藏在触发器背后」
    OPEN = inst;
    place(inst);
    var on = sheet.querySelector('.hx-pn-opt.on');
    if (on) sheet.scrollTop = Math.max(0, on.offsetTop - sheet.clientHeight / 2 + on.offsetHeight / 2);
    var lite = isLite();
    /* 两个 rAF 再放行：元素的 display 和 transform 在同一帧里一起变，浏览器不会起过渡；
       下一帧去掉 inert，CSS 过渡才把药板从触发器背后滑下来。 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (OPEN !== inst) return;
        sheet.inert = false;
        if (lite) return;
        // 每颗胶囊从槽里逐个弹起，delay 按行号递增 —— 药板滑下来的同时药粒「醒过来」
        var pills = sheet.querySelectorAll('.hx-pn-opt:not(.on) .hx-pn-pill');
        for (var i = 0; i < pills.length; i++) {
          pills[i].animate([{ transform: 'translateY(-4px) scale(.82)' },
          { transform: 'translateY(1px) scale(1.06)', offset: .65 },
          { transform: 'none' }],
            { duration: 380, delay: i * 45, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        }
      });
    });
  }

  /* 撕开药槽那一下：一圈细环 + N 片锡纸。cx/cy 是视口坐标（fx 层铺满视口，可直接用） */
  function burstAt(cx, cy, shards) {
    var g = document.createElement('span');
    g.className = 'hx-pn-burst';
    g.style.left = cx + 'px'; g.style.top = cy + 'px';
    fx.appendChild(g);
    var ring = document.createElement('span');
    ring.className = 'hx-pn-ring';
    g.appendChild(ring);
    var left = (shards || 0) + 1, done = 0;
    function tick() { if (++done >= left) g.remove(); }
    function run(el, frames, opt) { el.animate(frames, opt).finished.then(tick, tick); }
    run(ring, [{ opacity: .7, transform: 'scale(.8)' }, { opacity: 0, transform: 'scale(3.2)' }],
      { duration: 280, easing: 'ease-out', fill: 'forwards' });
    for (var i = 0; i < (shards || 0); i++) {
      var f = document.createElement('span');
      var a = i / shards * Math.PI * 2 + (Math.random() - .5) * .3;
      var d = 18 + Math.random() * 24, x = Math.cos(a) * d, y = Math.sin(a) * d;
      f.style.width = (2.5 + i % 3) + 'px'; f.style.height = (1.2 + i % 2) + 'px';
      g.appendChild(f);
      run(f, [
        { opacity: .92, transform: 'translate(' + (x * .16) + 'px,' + (y * .12) + 'px) rotate(' + (i * 26) + 'deg)' },
        { opacity: .48, offset: .56,
          transform: 'translate(' + (x * .66) + 'px,' + (y * .72 - 9) + 'px) rotate(' + (i * 34 + 45) + 'deg)' },
        { opacity: 0, transform: 'translate(' + x + 'px,' + (y + 12) + 'px) rotate(' + (i * 40 + 95) + 'deg)' }
      ], { duration: 290 + i % 4 * 32, fill: 'forwards' });
    }
  }

  /* 胶囊从被点的那一格飞出来，划一道弧线扎进触发器左端缩没（23 帧，430ms）。
     用 translate3d 逐帧拼而不是改 left/top：不触发重排，下拉扎堆的页面上也不掉帧。 */
  function fly(src, dst, btn) {
    fx.style.display = 'block';
    var cx = src.left + src.width / 2, cy = src.top + src.height / 2;
    burstAt(cx, cy, 14);
    var pill = document.createElement('span');
    pill.className = 'hx-pn-flight';
    fx.appendChild(pill);
    var hw = pill.offsetWidth / 2, hh = pill.offsetHeight / 2;
    var sx = cx - hw, sy = cy - hh;                       // 起点 = 药槽中心
    var dx = dst.left + 13 - hw, dy = dst.top + dst.height / 2 - hh;   // 落点 = 触发器左端
    var lift = 5, N = 23, frames = [];
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1), pop = t <= .36;                // 前 36% 在槽里弹起，后面飞行
      var p = pop ? back(t / .36) : cubic((t - .36) / .64);
      var arc = pop ? 0 : Math.sin(Math.PI * p);
      var x = pop ? sx : sx + (dx - sx) * p - 4 * arc;
      var y = pop ? sy - lift * p : sy - lift + (dy - sy + lift) * p;
      var sc = pop ? 1 + .3 * p : 1.3 + (.34 - 1.3) * p + .06 * arc;   // 起飞放大到 1.3，落地缩到 .34
      var fade = pop ? 1 : 1 - Math.max(0, (p - .84) / .16);
      var tilt = -5.5 * (pop ? p : 1 - p);
      frames.push({
        transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotate(' + tilt + 'deg) scale(' + sc + ')',
        opacity: fade
      });
    }
    var anim = pill.animate(frames, { duration: 430, fill: 'forwards' });
    anim.finished.then(function () {
      pill.remove();
      burstAt(dst.left + 13, dst.top + dst.height / 2, 0);    // 落点再闪一圈
      btn.animate([{ transform: 'scale(1.05)' }, { transform: 'scale(.985)', offset: .55 }, { transform: 'none' }],
        { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
    }, function () { pill.remove(); });
  }

  function onPick(e) {
    var b = e.target.closest('.hx-pn-opt');
    if (!b || !OPEN || b.classList.contains('dis')) return;
    var inst = OPEN, sel = inst.sel, i = +b.dataset.i;
    if (sel.selectedIndex === i) return close();
    var lite = isLite();
    // 起点/落点必须在收起之前量 —— 药板一开始滑，行就不在原位了
    var src = b.querySelector('.hx-pn-pk').getBoundingClientRect();
    var dst = inst.btn.getBoundingClientRect();
    sel.selectedIndex = i;
    refresh(sel);
    // 点中的那格当场变成空槽：胶囊就是从这一格飞走的
    var opts = sheet.querySelectorAll('.hx-pn-opt');
    for (var k = 0; k < opts.length; k++) opts[k].classList.toggle('on', opts[k] === b);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));   // 数据立刻走，动效纯属画面
    inst.btn.focus({ preventScroll: true });
    if (lite) return close();
    fly(src, dst, inst.btn);
    // 收板子晚 165ms：胶囊飞出槽那一段（0~36% × 430ms ≈ 155ms）得在板子上演完
    clearTimeout(pickT);
    pickT = setTimeout(close, 165);
  }

  /* instant=true：立刻收，不播滑回动画（换触发器 / 页面滚动时用：触发器可能已经不在原位，
     让药板「滑回一个已经移走的位置」反而像卡住）。 */
  function close(instant) {
    clearTimeout(hideT);
    if (!OPEN) { if (instant && clip) clip.style.display = 'none'; return; }
    OPEN = null;
    if (instant) { clip.style.display = 'none'; return; }
    sheet.inert = true;                                     // 药板滑回触发器背后
    hideT = setTimeout(function () { if (!OPEN) clip.style.display = 'none'; }, 480);
  }

  function enhance(sel) {
    if (wrapOf.has(sel) || sel.multiple || sel.size > 1) return;
    if (sel.hasAttribute('data-hx-plain') || !sel.parentNode) return;
    inject();
    var cs = getComputedStyle(sel);
    var wrap = document.createElement('span');
    wrap.className = 'hx-pn';
    var pw = sel.parentNode.clientWidth || 0;
    var full = (cs.display === 'block' || cs.display === 'flex' || cs.display === 'grid')
      || (pw > 0 && sel.offsetWidth >= pw - 2);
    wrap.style.display = full ? 'block' : 'inline-block';
    if (full) wrap.style.width = '100%';
    /* 父容器是 flex 行时（flex:1 的长在 select 身上），要把 flex 搬到包装层，
       否则按钮缩回内容宽度、旁边那颗按钮跟着挪位。 */
    var pcs = getComputedStyle(sel.parentNode);
    if (/flex/.test(pcs.display)) {
      wrap.style.flex = cs.flex || '0 1 auto';
      if (cs.minWidth !== 'auto' && cs.minWidth !== '0px') wrap.style.minWidth = cs.minWidth;
    }
    sel.parentNode.insertBefore(wrap, sel);
    sel.classList.add('hx-pn-src');
    wrap.appendChild(sel);

    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hx-pn-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.innerHTML = '<span class="hx-pn-txt"></span><i class="hx-pn-car"></i>';
    wrap.appendChild(btn);

    var inst = { sel: sel, wrap: wrap, btn: btn, txt: btn.querySelector('.hx-pn-txt') };
    wrapOf.set(sel, inst); all.push(inst);
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (!sel.disabled) open(inst); });
    sel.addEventListener('change', function () { refresh(sel); });
    new MutationObserver(function () { refresh(sel); })
      .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    refresh(sel);
  }

  function scan(root) {
    var list = [];
    if (root && root.nodeType === 1 && root.tagName === 'SELECT') list.push(root);
    if (root && root.querySelectorAll) list = list.concat([].slice.call(root.querySelectorAll('select')));
    for (var i = 0; i < list.length; i++) { try { enhance(list[i]); } catch (e) { } }
  }

  function init() {
    if (inited) { scan(document); return; }
    inited = true;
    addEventListener('pointerdown', function (e) {
      if (!OPEN) return;
      if (sheet.contains(e.target) || OPEN.wrap.contains(e.target)) return;
      close();
    }, true);
    addEventListener('keydown', function (e) { if (OPEN && (e.key === 'Escape' || e.key === 'Esc')) close(); }, true);
    addEventListener('scroll', function (e) {
      if (!OPEN) return;
      if (e.target && e.target.nodeType === 1 && sheet.contains(e.target)) return;
      close();
    }, { capture: true, passive: true });
    addEventListener('resize', function () { if (OPEN) place(OPEN); });
    scan(document);
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      (window.requestAnimationFrame || setTimeout)(function () { queued = false; scan(document); }, 16);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* 代码改值不发事件 → 在原型 setter 上挂钩子，只做「改完刷新文字」这一件事 */
  ['value', 'selectedIndex'].forEach(function (name) {
    var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
    if (!d || !d.set || d.set.__hxPn) return;
    var set = function (v) { d.set.call(this, v); try { refresh(this); } catch (e) { } };
    set.__hxPn = true;
    Object.defineProperty(HTMLSelectElement.prototype, name,
      { configurable: true, enumerable: d.enumerable, get: d.get, set: set });
  });

  window.HXPeanut = {
    init: init, scan: scan, open: open, close: close,
    refresh: function (el) { el ? refresh(el) : all.forEach(refresh); },
    count: function () { return all.length; }
  };

  if (document.documentElement.hasAttribute('data-hx-peanut')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();`
        }
      ],
      usage: {
        code: `<!-- 最小可用：一行属性 + 一个原生 select -->
<html data-hx-peanut>
  <select onchange="start(this.value)">
    <option value="a">选项 A</option>
    <option value="b">选项 B</option>
  </select>

<script>
  // 动态插入的 select 会自动被接管（document 级 MutationObserver）
  document.getElementById('box').innerHTML = '<select>...</select>';
  // 想手动补扫：
  HXPeanut.scan(document.getElementById('box'));
<\/script>`,
        note: 'onchange 照常写，不需要改成 addEventListener，也不需要知道组件的存在。'
      },
      api: [
        { k: 'data-hx-peanut', t: 'HTML 属性', def: '—', d: '加在 <html> 上，页面里所有 <select> 被接管（DOMContentLoaded 后自动初始化）。' },
        { k: 'data-hx-plain', t: 'HTML 属性', def: '—', d: '加在某个 <select> 上，跳过它。' },
        { k: 'HXPeanut.init()', t: '() => void', def: '自动', d: '初始化。已初始化过则只重新扫描一遍。' },
        { k: 'HXPeanut.scan(root)', t: '(Element) => void', def: 'document', d: '补扫。异步插入的 select 一般不用管（组件有 document 级 MutationObserver），手动渲染后想立刻接上可以调它。' },
        { k: 'HXPeanut.open(el)', t: '(HTMLSelectElement) => void', def: '—', d: '用代码展开某个下拉。' },
        { k: 'HXPeanut.close()', t: '() => void', def: '—', d: '收起当前面板。' },
        { k: 'HXPeanut.refresh(el?)', t: '(HTMLSelectElement?) => void', def: '全部', d: '选项被改过之后刷新按钮文字；不传参数刷新全部。' },
        { k: 'HXPeanut.count()', t: '() => number', def: '—', d: '已接管的 select 数量，排查「怎么没生效」时先看这个数。' },
        { k: 'change / input', t: '原生事件', def: '—', d: '选中后由组件派发，页面原有 onchange 照常触发。' }
      ],
      prompt: `帮我把页面里所有原生 <select> 改成「铝箔药板」样式的下拉。

要求：
1. 做成一个增强器，不要逐个写弹层。用 <html data-hx-peanut> 开启，页面上所有 select 自动接管。
2. 原生 select 必须保留在 DOM 里，用 visibility:hidden 盖住（不要用 opacity:0，否则 Tab 会停在看不见的控件上），
   只负责取值；选中后写 selectedIndex 并派发 input / change，原有 onchange 不用改。
3. 按钮外观从 select 的 computed style 现场抄（color / backgroundColor / font / borderRadius / padding），
   不抄宽高 —— 靠 select 自己的盒子撑包装层，响应式自动跟。抄 backgroundImage 时要把含 url() 的层丢掉，
   否则原生箭头图标会被平铺满整条按钮。
4. 面板是一块铝箔药板，视觉四层：
   · 金属圈：linear-gradient(162deg, 五个色标) + 4 层 inset 阴影（0 0 0 1px 白 / 1.5px 灰 / 2.5px 浅 / 0 .7px 3.5px 深）
   · 压痕：金属圈的 ::after，inset 3.5px，浅灰半透明 + 两道 inset 阴影
   · 胶囊：28×11 圆角，linear-gradient(90deg,#0645c5 0 49%,#e8e8e8 50%)，再加 ::before 左侧高光圈和 ::after 上下明暗
   · 玻璃罩：inset 3px 4px 的半透明白渐变，盖在胶囊上
   选中行：前三层 visibility:hidden，露出「撕开的空槽」—— conic-gradient 金属边 + clip-path 多边形毛边 + 里面一个径向渐变黑洞 + 一片反光锡纸。
5. 药板本身：多层背景叠出来（径向高光 + ±45° 1px 斜纹 + 水平拉丝 + 银灰渐变），五层阴影，
   圆角 14px。注意它是实物色，深色页面上也保持亮银，不跟主题变色。
6. 一行 = grid-template-columns: 38px minmax(0,1fr)，min-height 42px，行间 1px 点线。
7. 定位用一个 fixed 面板：打开时量触发器 rect，宽度不小于触发器，下面放不下就翻到上面；
   页面滚动、按 Esc、点面板外都收起；选项多时面板自己滚并自动把选中项滚到中间。
8. 代码改值（sel.value = x）不会触发事件，所以在 HTMLSelectElement.prototype 的
   value / selectedIndex setter 上挂钩子，改完刷新按钮文字（不要改取值行为）。
9. 父容器是 flex 行且 select 带 flex:1 时，要把 flex 抄到包装层上，否则按钮会缩回内容宽度。
10. multiple 和 size>1 的 select 直接跳过；带 data-hx-plain 的也跳过。

动效部分（这才是「药丸感」的本体，只做外观会一眼被看出来是假货）：
11. 药板外面套一层 fixed 裁剪盒 .hx-pn-clip（overflow:hidden，padding:6px 0 30px 给阴影留位置），
    药板本体改成 position:relative、width:100%。收起态写成 .hx-pn-sheet[inert]{ translateY(var(--pn-hide)); opacity:0 }，
    过渡 transform 460ms cubic-bezier(.22,1.06,.36,1) + opacity 320ms。
    打开时：先 sheet.inert = true，同一帧里 clip.display='block'，再等两个 rAF 去掉 inert —— 
    显示和位移在同一帧里一起变，浏览器不起过渡，下一帧才播，所以每次都能看到「从触发器背后滑出来」。
12. --pn-hide 不能用 -100%：向上展开时药板要往下藏。由 JS 按实测高度写 px（下面展开取 -(h+16)、上面展开取 +(h+16)）。
13. 选中时先量好两个矩形（被点那格的 .hx-pn-pk、触发器 .hx-pn-btn），再关板子。
    然后一颗 28×11 的同款胶囊从药槽中心起飞，430ms / 23 帧用 translate3d 拼：
    前 36% 用回弹曲线 back(t)=1+2.70158(t-1)³+1.70158(t-1)² 在槽里弹起（scale 1→1.3，同时上抬 5px），
    后 64% 用缓入缓出沿抛物线飞向触发器左端（x = dst.left + 13、y = 触发器垂直居中），
    scale 收到 .34、最后 16% 淡出。起点同时炸一圈 scale 到 3.2 的蓝色细环 + 14 片锡纸碎屑（随机角度、290~386ms）；
    落地时再闪一圈，并让触发器 scale 弹一下（1.05 → .985 → 1）。
    这颗胶囊必须放在独立的、position:fixed inset:0 的 fx 层里 —— 放进裁剪盒会被裁掉，因为触发器在盒子外面。
14. 收板子要延迟 165ms（≈ 36% × 430ms），让「胶囊弹出槽」那一段在板子上演完；
    但 input/change 必须在点击当下就同步派发，不能跟着动画一起晚。
15. html.hx-lite 或 prefers-reduced-motion: reduce 时：不飞行、不放碎屑、药板不滑，只保留 opacity .16s 的淡入淡出。`
    },

    /* ═══════════════════════════════════════════════════════════════════
       2. 卡片通透度（毛玻璃卡片）
       ═══════════════════════════════════════════════════════════════════ */
    {
      id: 'card-alpha',
      name: '卡片通透度（毛玻璃卡片）',
      sub: '卡片底色接一个全站额度，壁纸能透上来，又不会把字糊掉',
      tags: ['卡片', '毛玻璃', '通透度', '壁纸', 'backdrop-filter', 'card', 'blur', 'glass'],
      date: '2026-11-17',
      intro: [
        '全站的卡片不再写死 #fff，而是吃一个额度：`--hx-a` 1 = 最透、2 = 最实，卡片本身 = 白 × `calc(--hx-a * .62)`。这样「外观 → 卡片通透度」拖一下，所有接了这个变量的卡片一起变。',
        '踩过的坑：只做透明不做模糊，数字直接压在人物照片上根本读不清；所以必须配 `backdrop-filter: blur(9px)`。另一个坑是 `--hx-a` 是**数字**不是颜色，塞进 `color-mix()` 会让整条声明作废。',
        '还有一处容易漏：卡片里的**子卡片**（浅绿结果框、浅粉提示框）如果还是写死的 rgba，父卡片透了它不透，看上去像贴了一块不透明胶布。'
      ],
      source: { name: '华夏工具 · 进制转换 / 小组加分', note: '本项目原创，2026-11-17 统一到全站外观面板。仅供学习使用。' },
      demo: 'card-alpha.html',
      demoH: 340,
      params: [
        { k: '--hx-a', def: '1', d: '通透度额度。1 = 最透（卡片 .62），2 = 最实（1.0）。由「外观 → 卡片通透度」写入 <html>。' },
        { k: '--card-a', def: 'calc(var(--hx-a,1) * .62)', d: '卡片实际用的白度。只想让某一块慢一点/快一点变实，就在那个容器上覆写它。' },
        { k: 'backdrop-filter', def: 'blur(9px) saturate(1.06)', d: '毛玻璃。低于 6px 文字会和壁纸纹理打架；高于 12px 在小卡片上看不出差别，只是更费 GPU。' }
      ],
      deps: { code: '无依赖。纯 CSS 变量 + backdrop-filter（Chromium / Safari 都支持，记得同时写 -webkit- 前缀）。', note: '要让壁纸真的透上来，body 背景必须是透明的或被主题接管 —— 卡片自己是半透明，但父级若还铺着不透明的米白底，就白改了。' },
      code: [
        {
          lang: 'css', label: 'CSS',
          code: `/* 配方本体：三行 */
.card{
  --card-a: calc(var(--hx-a, 1) * .62);              /* 1 → .62，2 → 1.0 */
  background-color: rgba(255, 255, 255, var(--card-a));
  backdrop-filter: blur(9px) saturate(1.06);
  -webkit-backdrop-filter: blur(9px) saturate(1.06);
}

/* 卡片里的子卡片要一起接，否则父卡片透了、它不透，像贴了块胶布 */
.card .sub{ background-color: rgba(233, 250, 242, var(--card-a)); }
.card .tip{ background-color: rgba(255, 249, 249, var(--card-a)); }

/* 边框跟着透一点，别用纯 #fff 实线，否则卡片边缘会像贴纸 */
.card{ border:1px solid rgba(255,255,255,.55); }`
        },
        {
          lang: 'js', label: 'JS',
          code: `/* 全站只有一个地方写 --hx-a：外观面板。工具页只读，不自己算。 */
document.documentElement.style.setProperty('--hx-a', value);  // 1 ~ 2

/* 如果工具页有自己的壁纸/背景图，记得确认 body 没被写死成不透明：
   body{ background:#f7f4ef } 会把主题壁纸整个盖掉，改成 transparent 或交给主题。 */`
        }
      ],
      usage: {
        code: `<div class="card">
  <h3>十进制 ↔ 十六进制对照表</h3>
  <p>卡片底色跟着全站「卡片通透度」走。</p>
</div>

<style>
  .card{
    padding:16px 18px; border-radius:16px;
    background-color:rgba(255,255,255,calc(var(--hx-a,1) * .62));
    backdrop-filter:blur(9px) saturate(1.06);
  }
</style>`,
        note: '一整页几十个卡片类批量接的时候，写在 <style id="hx-card-alpha"> 里统一覆盖，别逐个改原样式表 —— 原样式表里那些 #fff 还要给打印和导出用。'
      },
      api: [
        { k: '--hx-a', t: 'CSS 变量（数字）', def: '1', d: '通透度额度，1~2。由全站外观面板写进 <html>，工具页只读。' },
        { k: '--card-a', t: 'CSS 变量（数字）', def: '1 × .62', d: '卡片实际白度。想给某一块单独调，就在那层的容器上覆写它。' },
        { k: 'backdrop-filter', t: 'CSS 属性', def: 'blur(9px) saturate(1.06)', d: '毛玻璃。要同时写 -webkit- 前缀。' }
      ],
      prompt: `把这一页的卡片改成「可调通透度」的毛玻璃卡片。

1. 卡片底色不要写死 #fff，改吃一个全站额度：--card-a: calc(var(--hx-a, 1) * .62)，背景用 rgba(255,255,255,var(--card-a))。
2. 同时加 backdrop-filter: blur(9px) saturate(1.06)（含 -webkit- 前缀）。只透不糊会让文字压在照片上读不清。
3. 页面里所有卡片类都要接上，包括子卡片（浅色结果框、提示框）和边框 —— 边框用 rgba(255,255,255,.55)，纯白实线会像贴纸。
4. 原样式表里的 #fff 不要动（打印、导出还在用），新建一个 <style id="hx-card-alpha"> 用 !important 统一覆盖。
5. --hx-a 是数字（1~2），不是颜色。不要拿它去 color-mix()，否则整条声明会作废。
6. 顺便检查 body / 页面容器有没有写死的浅色底，有的话壁纸根本透不上来，卡片改了也白改。`
    },

    /* ═══════════════════════════════════════════════════════════════════
       3. 无感滚动条
       ═══════════════════════════════════════════════════════════════════ */
    {
      id: 'scrollbar',
      name: '无感滚动条（滚动才浮现）',
      sub: '静止时完全透明，一滚动才浮出来，停手 0.9 秒自己褪回去',
      tags: ['滚动条', '滑轨', 'scrollbar', 'thumb', 'track', '毛玻璃', '无感'],
      date: '2026-11-17',
      intro: [
        '第一版做的是「极淡但一直在」，用户不满意：「我不需要一直在 就是触发滚动 就微微显示即可 透明毛玻璃状态」。于是改成静止全透明、滚动才浮现。',
        '四个实测坑，每个都能让整条规则静默失效：① 滚动条伪元素里**取不到 `var(--xxx)`**，颜色只能写死 rgba；② 滚动条**不支持 transition / opacity**，浮现和褪回都是硬切，只能靠延时统一；③ Chromium 一旦看到标准属性 `scrollbar-color`（非 auto）就**整段忽略** `::-webkit-scrollbar`；④ 悬停色覆盖必须带 `html` 前缀，否则特异性不够。',
        '还有一个行为细节：`scroll` 事件不冒泡，必须 `capture`；`e.target` 是 `document`/`body` 时要归一到 `documentElement`，否则页面级滚动条拿不到 class。'
      ],
      source: { name: '华夏工具 · 全站', note: '本项目原创。仅供学习使用。' },
      demo: 'scrollbar.html',
      demoH: 330,
      params: [
        { k: '滑块宽度', def: '10px', d: '再细就不好拖；希沃触屏建议 10~12px。' },
        { k: '滑块最小高度', def: '32px', d: '`min-height`，长列表里不会缩成一根针。' },
        { k: '浮现色（浅色）', def: 'rgba(0,0,0,.32)', d: '写死 rgba —— 伪元素里 var() 不生效。' },
        { k: '浮现色（深色）', def: 'rgba(255,255,255,.36)', d: '深色页要把规则同时写在 `html[data-x] .rolling` 和 `html[data-x].rolling` 上（页面级滚动条挂在 html 上）。' },
        { k: '褪回延时', def: '900ms', d: '太短会一闪一闪；太长像是「留在那了」。' }
      ],
      deps: { code: '无依赖。伪元素 + 一个 capture scroll 监听。', note: '滚动条只在「确实能滚」的容器上有意义 —— 内容一屏就看完的容器别开，它反而让人以为还能滚。' },
      code: [
        {
          lang: 'css', label: 'CSS',
          code: `/* 底槽永远透明，避免在页面右侧切出一条浅色带 */
.sc::-webkit-scrollbar{ width:10px; height:10px; }
.sc::-webkit-scrollbar-track{ background:transparent; border:0; }
/* 静止：全透明（不是极淡） */
.sc::-webkit-scrollbar-thumb{
  background:transparent; border:0; border-radius:99px; min-height:32px;
}
/* 滚动中：浮现（颜色写死 rgba，伪元素里 var() 取不到） */
.sc.rolling::-webkit-scrollbar-thumb{
  background:rgba(0,0,0,.32);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.55), 0 0 6px rgba(0,0,0,.18);
}
/* 深色：页面级滚动条挂在 <html> 上，两条都要写 */
html[data-x="dark"] .sc.rolling::-webkit-scrollbar-thumb,
html[data-x="dark"].sc.rolling::-webkit-scrollbar-thumb{
  background:rgba(255,255,255,.36);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.35), 0 0 6px rgba(0,0,0,.28);
}
/* 标准属性只给火狐：Chromium 看到 scrollbar-color 会整段忽略 ::-webkit-scrollbar */
@supports (-moz-appearance: none){
  .sc{ scrollbar-width:thin; scrollbar-color:rgba(0,0,0,.32) transparent; }
}`
        },
        {
          lang: 'js', label: 'JS',
          code: `(function () {
  var CLS = 'rolling', DELAY = 900, timers = new WeakMap();
  addEventListener('scroll', function (e) {
    var el = e.target;
    /* scroll 不冒泡 —— 必须 capture；目标是 document/body 时归一到 documentElement，
       否则页面级滚动条永远拿不到 class（这条最隐蔽）。 */
    if (el === document || el === document.body) el = document.documentElement;
    if (!el || el.nodeType !== 1) return;
    el.classList.add(CLS);
    var t = timers.get(el);
    if (t) clearTimeout(t);
    timers.set(el, setTimeout(function () { el.classList.remove(CLS); timers.delete(el); }, DELAY));
  }, { capture: true, passive: true });
})();`
        }
      ],
      usage: {
        code: `<div class="sc" style="height:220px;overflow:auto">…长内容…</div>
<!-- 页面级滚动条：class 加在 <html> 上 -->
<html class="sc">`,
        note: '容器滚动条只需 `.sc` 一个类；页面级要加在 `<html>` 上，并且深色规则两条选择器都要写。'
      },
      api: [
        { k: '.rolling', t: 'class', def: '—', d: '滚动时加在滚动容器上（页面级加在 <html> 上），900ms 后自动摘掉。' },
        { k: 'CLS', t: '常量', def: "'rolling'", d: '脚本顶部的类名常量，改这里等于换一套选择器。' },
        { k: 'DELAY', t: '常量（ms）', def: '900', d: '停手多久褪回全透明。' }
      ],
      prompt: `把站内的滚动条改成「静止全透明、滚动才浮现」的无感样式。

1. ::-webkit-scrollbar 宽 10px；track 永远透明；thumb 静止时 background:transparent、border-radius 99px、min-height 32px。
2. 给容器加 class="rolling" 时 thumb 才显形：浅色 rgba(0,0,0,.32)，深色 rgba(255,255,255,.36)，各带一道 inset 高光。
3. 注意 4 个坑：
   · 滚动条伪元素里取不到 var(--xxx)，颜色一律写死 rgba。
   · 滚动条不支持 transition / opacity，浮现与褪回是硬切，靠 900ms 延时统一。
   · Chromium 一旦看到标准属性 scrollbar-color（非 auto）就整段忽略 ::-webkit-scrollbar
     —— 所以 scrollbar-color / scrollbar-width 必须锁进 @supports (-moz-appearance:none) 只给火狐。
   · 深色覆盖要带 html 前缀，而且页面级滚动条挂在 <html> 上，
     要同时写 html[data-dark] .rolling 和 html[data-dark].rolling 两条。
4. JS 只有一个 capture 的 scroll 监听：滚动时加 .rolling，900ms 后摘掉；
   e.target 为 document / body 时归一到 documentElement（scroll 不冒泡，不 capture 收不到）。`
    }
  ]
};
