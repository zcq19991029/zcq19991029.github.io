// 电气原理图预览：加载指定电路的脚本 → 调它自己的 drawSchematic 画一遍。
// 画法一个像素都不改：线宽、字号、线号位置、触点符号全部来自 circuitXX.js。
// 主题也来自 theme.js（和练习页同一个 localStorage 键），所以换主题这里跟着换。
(function () {
  const FILES = {
    '2.1': ['circuit21.js'],
    '2.2': ['board.js', 'schematic.js', 'circuit22.js'],
    '2.3': ['circuit23.js'],
    '2.4': ['circuit24.js'],
    '2.5': ['circuit25.js'],
    '2.6': ['circuit26.js'],
    'E1': ['circuitE1.js'],
    'E2': ['circuitE2.js']
  };
  const id = (new URLSearchParams(location.search).get('id') || '2.1').trim();
  const files = FILES[id];
  document.title = '原理图 ' + id;

  // 电路脚本里只有 drawSchematic 会被调用，但它可能顺手读练习页的运行状态（E2 的 M2/M3）
  // → 给一份「全部静止」的最小状态，画出来就是练习页刚打开时的样子。
  var PS = {
    sw: {}, wires: [], w: 0, ktOn: 0, ktc: 0, ktE: 0, ktDelay: 3, ext: {}, hover: null, sel: null,
    m2: { state: '停止', dir: 0 }, m3: { state: '停止', dir: 0 }, drag: null, checked: null
  };
  window.PS = PS;
  var motor = { state: '停止', dir: 0, conn: null };
  window.motor = motor;

  // 主题：和练习页同一个键，同一个 applyTheme
  let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (e) { }
  applyTheme(saved || 'dark');

  function paint() {
    const vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, vw, vh);
    glass(0, 0, vw, vh, 22);                       // 和练习页左栏同一张玻璃卡片
    if (typeof CIRCUIT === 'undefined' || typeof drawSchematic !== 'function') return;
    // 缩放规则照抄 practice.js 的 layoutAll：按「设计宽度 CIRCUIT.schW × 730」等比放进卡片，居中
    const dw = CIRCUIT.schW || 1015, dh = 730;
    const s = Math.min((vw - 16) / dw, (vh - 16) / dh);
    SCH.s = s; SCH.x = (vw - dw * s) / 2; SCH.y = (vh - dh * s) / 2;
    SCHK.on = true;                                 // 原理图上的线粗、字粗按练习页那套
    try { drawSchematic(0, Object.assign({ w: 0, QF: 0 }, PS.sw), {}); } catch (e) {
      if (window.console && console.warn) console.warn('[原理图预览] drawSchematic 出错', e);
    }
    SCHK.on = false;
    // 给外层（super.html 的测试钩子）一个「我画好了」的信号
    window.__schReady = { id: id, w: vw, h: vh };
  }

  /* 什么时候重画：这块面板的尺寸不是一次就定下来的 —— 外层 .sch-card 的高度依赖外层 flex 排版，
     iframe 首帧常常只有几十像素高（这时 s = min(宽比, 高比) 会被高度卡住，图缩成一小块），
     排版定下来以后才变成真正的 44vh。所以不能只画一次：
       · resize（窗口/iframe 尺寸变化）→ 重画；
       · ResizeObserver 盯住 <html>（iframe 自己的视口变化不一定会触发 resize）→ 重画。
     两路都只是「按当前尺寸再画一遍」，不改任何画法，所以画出来的还是同一个函数、同一套缩放规则。 */
  function watch() {
    addEventListener('resize', paint);
    if (window.ResizeObserver) {
      let last = '';
      new ResizeObserver(() => {
        const k = innerWidth + 'x' + innerHeight;
        if (k === last) return;
        last = k; paint();
      }).observe(document.documentElement);
    }
  }
  function load(list, i) {
    if (i >= list.length) { paint(); watch(); return; }
    const sc = document.createElement('script');
    sc.src = list[i];
    sc.onload = () => load(list, i + 1);
    sc.onerror = () => { if (window.console && console.warn) console.warn('[原理图预览] 脚本没取到：' + list[i]); load(list, i + 1); };
    document.head.appendChild(sc);
  }
  window.__schPaint = paint;
  if (!files) { document.title = '原理图（没有这道题）'; return; }
  load(files, 0);
})();
