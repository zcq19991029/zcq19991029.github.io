// 练习页和教学视频共用的外观：四套主题配色、玻璃卡片、点阵背景、状态胶囊、仿真电动机。
// （2026-11-08 用户要求：不再画校徽 + zcq 水印，brand() 只保留空壳给调用方。）
// 视频必须用这里的画法（深色主题），不要另画一套，这样视频和练习页长得一模一样。加载顺序：core.js、parts.js 之后。
// ---------- 主题：四套配色，适应不同光线（标题栏右上角切换，选择记在浏览器里）----------
// 深色适合拉窗帘的教室；明亮适合白天屏幕反光重；高对比适合投影发白、后排看不清；低反光灰用深灰代替纯黑，减少屏幕上的倒影。
// dark 表示深色底（文字和光效用浅色）；dot、spot 是点阵和光斑颜色的 RGB；glow 是发光强度（0～1）。
const THEMES = {
  dark: { name: '科技深色', dark: true,
    C: { wireEdge: 'rgba(255,255,255,.30)', ink: '#e8ecff', dim: '#8e97bd', paper: '#0d1324', paperRun: 'rgba(251,146,60,.18)', trace: '#7dd3fc', ok: '#34d399', bad: '#fb7185', gold: '#fbbf24', cur: '#f97316', ctrl: '#f472b6', N: '#60a5fa', L1: '#eab308', L2: '#22c55e', L3: '#ef4444' },
    TH: { bg: '#03050b', acc: '#7c9cff', acc2: '#b18cff', edge: 'rgba(170,190,255,.16)', io: '#34d399', out: '#60a5fa', dot: '175,190,255', dotA: 0.045, spot: '110,130,255', glow: 1,
      cardTop: 'rgba(26,32,56,.82)', cardBot: 'rgba(9,12,24,.88)', hi: 'rgba(255,255,255,.07)', shadow: 'rgba(90,120,255,.20)', btn: 'rgba(255,255,255,.045)', btnHov: 'rgba(124,156,255,.16)',
      rail: ['#151b2e', '#2b3452', '#111727'], disc: 'rgba(14,20,40,.95)', title: ['#ffffff', '#a5b4fc'], sub: 'rgba(165,180,252,.75)', sweep: '#ffffff', wm: 'rgba(255,255,255,.55)', logo: 'grayscale(1) brightness(5)', logoA: 0.32, veil: 'rgba(0,0,0,.62)' } },
  light: { name: '明亮', dark: false,
    C: { wireEdge: 'rgba(15,23,42,.35)', ink: '#0f172a', dim: '#475569', paper: '#ffffff', paperRun: '#fff7ed', trace: '#0284c7', ok: '#059669', bad: '#e11d48', gold: '#d97706', cur: '#ea580c', ctrl: '#be123c', N: '#1d4ed8', L1: '#ca8a04', L2: '#16a34a', L3: '#dc2626' },
    TH: { bg: '#e9eef6', acc: '#4f46e5', acc2: '#7c3aed', edge: 'rgba(71,85,105,.22)', io: '#059669', out: '#2563eb', dot: '71,85,105', dotA: 0.06, spot: '99,102,241', glow: 0.45,
      cardTop: 'rgba(255,255,255,.96)', cardBot: 'rgba(246,248,252,.96)', hi: 'rgba(255,255,255,.6)', shadow: 'rgba(30,41,59,.12)', btn: 'rgba(15,23,42,.04)', btnHov: 'rgba(79,70,229,.10)',
      rail: ['#d1d5db', '#f3f4f6', '#c7ccd4'], disc: '#f1f5f9', title: ['#0f172a', '#4f46e5'], sub: 'rgba(79,70,229,.75)', sweep: '#4f46e5', wm: 'rgba(15,23,42,.35)', logo: 'none', logoA: 0.7, veil: 'rgba(15,23,42,.35)' } },
  contrast: { name: '高对比', dark: false,
    C: { wireEdge: 'rgba(0,0,0,.45)', ink: '#000000', dim: '#1f2937', paper: '#ffffff', paperRun: '#ffedd5', trace: '#0369a1', ok: '#047857', bad: '#be123c', gold: '#b45309', cur: '#c2410c', ctrl: '#9f1239', N: '#1e40af', L1: '#a16207', L2: '#15803d', L3: '#b91c1c' },
    TH: { bg: '#ffffff', acc: '#1d4ed8', acc2: '#1d4ed8', edge: '#111827', io: '#047857', out: '#1d4ed8', dot: '0,0,0', dotA: 0, spot: '0,0,0', glow: 0.15,
      cardTop: '#ffffff', cardBot: '#ffffff', hi: 'rgba(255,255,255,0)', shadow: 'rgba(0,0,0,0)', btn: '#ffffff', btnHov: 'rgba(29,78,216,.10)',
      rail: ['#9ca3af', '#e5e7eb', '#9ca3af'], disc: '#ffffff', title: ['#000000', '#1d4ed8'], sub: '#1d4ed8', sweep: '#1d4ed8', wm: 'rgba(0,0,0,.35)', logo: 'none', logoA: 0.7, veil: 'rgba(0,0,0,.4)' } },
  gray: { name: '低反光灰', dark: true,
    C: { wireEdge: 'rgba(255,255,255,.28)', ink: '#e5e7eb', dim: '#a3a9b5', paper: '#2b313b', paperRun: 'rgba(251,146,60,.22)', trace: '#7dd3fc', ok: '#4ade80', bad: '#fb7185', gold: '#fcd34d', cur: '#fb923c', ctrl: '#f472b6', N: '#93c5fd', L1: '#facc15', L2: '#4ade80', L3: '#f87171' },
    TH: { bg: '#262b33', acc: '#93a8ff', acc2: '#c4b5fd', edge: 'rgba(229,231,235,.14)', io: '#4ade80', out: '#93c5fd', dot: '229,231,235', dotA: 0.035, spot: '147,168,255', glow: 0.5,
      cardTop: 'rgba(50,56,68,.95)', cardBot: 'rgba(40,45,55,.95)', hi: 'rgba(255,255,255,.04)', shadow: 'rgba(0,0,0,.25)', btn: 'rgba(255,255,255,.05)', btnHov: 'rgba(147,168,255,.16)',
      rail: ['#3a404b', '#4b5260', '#353a44'], disc: '#2f353f', title: ['#f3f4f6', '#c4b5fd'], sub: 'rgba(196,181,253,.8)', sweep: '#ffffff', wm: 'rgba(255,255,255,.4)', logo: 'grayscale(1) brightness(4)', logoA: 0.28, veil: 'rgba(0,0,0,.5)' } },
};
const TH = {};
let themeName = 'dark';
// 主题存在哪个键：练习页、原理图预览、超级排位都读同一个 —— 换主题三处一起换，不会有一页还停在旧配色
const THEME_KEY = 'zfz-practice-theme', CTRL_KEY = 'zfz-practice-ctrl';
// 华夏工具网站版：外壳把首页“外观”的主色、背景图、透明度传进来（hxLook）。选了背景图时画布底色变半透明，背景图从页面底下透出来
let HXL = null;
const hxRgba = (hex, a) => { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
// ── 2026-11-08 修「背景/动效点了没反应」的根：练习画布逐帧叠加把透明底越涂越实 ──
// 练习页每帧开头 fillRect(0,0,W,H) 铺一次半透明底色（TH.bg 带 alpha 时），且从不 clearRect ——
// source-over 反复叠加，N 帧后画布 alpha 收敛到 1（实测约半秒），壁纸和动效层只在头几帧闪一下
// 就被盖死，肉眼看就是「选了没反应」。这里把 2d 上下文的 fillRect 包一层：**全画布大小的底色填充
// 之前先 clearRect**。每帧的绘制顺序是 step()（纯状态计算，不画）→ 底色 fillRect → 卡片/电路，
// 所以清掉的是上一帧的残影，不会误伤本帧内容；条件卡得很死（宽高都盖满画布才触发），
// 局部 fillRect（卡片压暗那类）不受影响。开关跟 HXL 走：没选背景时关闭，行为和原来一模一样。
let hxBgClear = false;
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.__hxBgClear) {
  CanvasRenderingContext2D.prototype.__hxBgClear = true;
  const rawFill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
    if (hxBgClear && this.canvas && w >= this.canvas.width && h >= this.canvas.height) {
      this.save(); this.setTransform(1, 0, 0, 1, 0, 0); this.clearRect(0, 0, this.canvas.width, this.canvas.height); this.restore();
    }
    rawFill.call(this, x, y, w, h);
  };
}
// 换主题：四套配色一次性换掉 C（画布上的墨色）和 TH（卡片、按钮、发光）。视频不受影响（视频页自己不调它）
function applyTheme(n) {
  if (!THEMES[n]) n = 'dark';
  themeName = n; Object.assign(C, THEMES[n].C); Object.assign(TH, THEMES[n].TH, { dark: THEMES[n].dark });
  // 控制线的显示颜色可以自定义（讲解用；实训中控制线一般用黑色），没设就用主题默认的粉色
  let cc = null; try { cc = localStorage.getItem(CTRL_KEY); } catch (e) { } if (cc) C.ctrl = cc;
  // 华夏工具外观（2026-11-08 修「选了背景没东西」）：hx-theme 那边给了背景图地址（--hx-img，含视频壁纸的海报帧）时，
  // 画布底色变半透明，壁纸从画布和 body 底下透出来 —— 外壳 documentElement 由练习页铺同一场壁纸，
  // 画布和 body 各留一档透明度，壁纸的净透过率约 20%～25%（深色），够看出「有背景」又不抢接线正文。
  // 深色透得多（壁纸本身压暗过）、浅色透得少（白纸上花壁纸会干扰读图）。没选背景（无）时保持全不透明 = 干净纯色。
  if (HXL) {
    if (HXL.acc) TH.acc = HXL.acc;
    if (HXL.acc2) TH.acc2 = HXL.acc2;
    // 有背景（真图或 hx-theme 的透明哨兵图 = 只开动效）才把底色调成半透明，并打开上面的「填充前先清屏」：
    // 清屏让画布 alpha 稳定在 .56/.82 不再叠加收敛，壁纸和外壳的动效层才真的透得出来。无背景 = 全不透明 = 干净纯色。
    const hasBg = !!(HXL.img && HXL.img !== 'none');
    if (hasBg) TH.bg = hxRgba(TH.bg, THEMES[n].dark ? .56 : .82);
    hxBgClear = hasBg;
  } else hxBgClear = false;
  try { localStorage.setItem(THEME_KEY, n); } catch (e) { }
}
// 深色玻璃卡片：渐变底 + 细亮边 + 顶部高光 + 淡淡的蓝色外发光
function glass(x, y, w, h, r = 22, glow) {
  g.save(); g.shadowColor = glow || TH.shadow; g.shadowBlur = 34 * Math.max(TH.glow, 0.4);
  rrect(x, y, w, h, r, lin(0, y, 0, y + h, [[0, TH.cardTop], [1, TH.cardBot]])); g.restore();
  g.save(); g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  g.fillStyle = lin(0, y, 0, y + 70, [[0, TH.hi], [1, 'rgba(255,255,255,0)']]); g.fillRect(x, y, w, 70); g.restore();
  rrect(x + .5, y + .5, w - 1, h - 1, r, null, glow ? glow : TH.edge, themeName === 'contrast' ? 2 : 1);
}
// 点阵背景已移除（2026-11-02）：原来每帧要画 2331 个小方块算 2331 次 hypot，
// 60fps 就是每秒 14 万次填充，而透明度只有 0.045，肉眼几乎看不出。整块砍掉，换成纯背景色。
// 版权标识：2026-11-08 用户要求去除（实物板右下角的校徽 + 半透明“zcq”水印）。
// 函数壳保留，练习页 / 教学视频里的调用点不用改（都还调 brand()，只是不再画任何东西）。
// 2026-11-08 同日：brand() 已经不画了，这里再 new Image() 就只是白拉一张图 ——
// 超级排位页（/wiring-lab/super/）没有 assets/ 目录，控制台因此一直 404 校徽。
// 改成只有显式给了 LOGO_SRC（打包时注入的 base64）才加载，开发/线上都不再多一次无用请求。
const LOGO = new Image(); if (window.LOGO_SRC) LOGO.src = window.LOGO_SRC;
function brand() {
  /* 2026-11-08 用户要求去除水印：原来在这里画校徽 + “zcq”，现已停用，函数保留给调用方。 */
}

// 左下状态条：开关和接触器状态（小胶囊）、已接线数（数字滚动）、仿真电动机；检查出错时列出问题
// k：整体放大倍数（手机竖屏画布按 1920 宽设计、缩到 390 只剩 0.2 倍，状态胶囊上的 15 号字落到屏幕上只有 3px，
//    竖屏传 2 才看得见）。默认 1，桌面和教学视频不受影响。
function chip(x, y, w, k, v, on, col, sm, k2) { // sm：排三列时字小一点
  const K = k2 || 1, h = 38 * K;
  g.save(); g.shadowColor = col; g.shadowBlur = on ? 14 * TH.glow : 0;
  rrect(x, y, w, h, h / 2, on ? TH.btnHov : TH.btn, on ? col : TH.edge, on ? 1.8 : 1); g.restore();
  g.save(); if (on) { g.shadowColor = col; g.shadowBlur = 10; } dot(x + 18 * K, y + h / 2, 5 * K, on ? col : 'rgba(' + TH.dot + ',.35)'); g.restore();
  text(k, x + (sm ? 28 : 32) * K, y + h / 2 + K, (sm ? 13 : 15) * K, C.dim, 'left', 'bold'); text(v, x + w - (sm ? 10 : 14) * K, y + h / 2 + K, (sm ? 15 : 17) * K, on ? col : C.ink, 'right', 'bold');
}
// 仿真电动机（正视图）：外壳一圈散热筋，里面的扇叶跟着转，转快了有拖影；外圈的箭头指出旋转方向；右边大字写正转/反转
function motorView(t, cx, cy, motor) { // motor：{ w 转速(-1～1，正数正转), a 转角, state 状态文字, seq 相序 }
  const run = Math.abs(motor.w) > 0.05, sp = Math.min(1, Math.abs(motor.w)), sgn = motor.w >= 0 ? 1 : -1;
  const mc = motor.state === '缺相' ? C.bad : run ? (sgn > 0 ? '#38bdf8' : '#c084fc') : C.dim;
  g.save(); g.shadowColor = mc; g.shadowBlur = run ? 26 * TH.glow : 0;
  for (let j = 0; j < 28; j++) { const a = j / 28 * 6.283; poly([[cx + Math.cos(a) * 47, cy + Math.sin(a) * 47], [cx + Math.cos(a) * 56, cy + Math.sin(a) * 56]], run ? mc : TH.edge, 3); }
  g.beginPath(); g.arc(cx, cy, 47, 0, 7); g.fillStyle = TH.disc; g.fill(); g.strokeStyle = run ? mc : TH.edge; g.lineWidth = 2.5; g.stroke(); g.restore();
  // 扇叶：转起来时画几道渐淡的残影
  const blade = (a, alpha) => { g.save(); g.globalAlpha = alpha; g.translate(cx, cy); g.rotate(a); g.fillStyle = run ? mc : 'rgba(' + TH.dot + ',.45)';
    for (let b = 0; b < 3; b++) { g.rotate(6.283 / 3); g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(26, -16, 38, -4); g.quadraticCurveTo(24, 6, 0, 0); g.fill(); } g.restore(); };
  if (run) for (let k = 4; k >= 1; k--) blade(motor.a - sgn * k * 0.14 * sp, 0.12 * (5 - k) * sp);
  blade(motor.a, 1);
  g.save(); g.shadowColor = mc; g.shadowBlur = 10; dot(cx, cy, 8, run ? '#fff' : TH.acc); g.restore();
  // 方向箭头：两段弧沿旋转方向绕着走
  if (run) for (const off of [0, Math.PI]) {
    const a0 = t * 1.6 * sgn + off, a1 = a0 + sgn * 1.4, r = 66;
    g.save(); g.strokeStyle = mc; g.lineWidth = 3; g.lineCap = 'round'; g.shadowColor = mc; g.shadowBlur = 12 * TH.glow;
    g.beginPath(); g.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
    const hx = cx + Math.cos(a1) * r, hy = cy + Math.sin(a1) * r, ta = a1 + sgn * Math.PI / 2; // 箭头尖朝切线方向
    g.beginPath(); g.moveTo(hx + Math.cos(ta) * 9, hy + Math.sin(ta) * 9); g.lineTo(hx + Math.cos(ta + 2.5) * 9, hy + Math.sin(ta + 2.5) * 9); g.lineTo(hx + Math.cos(ta - 2.5) * 9, hy + Math.sin(ta - 2.5) * 9); g.closePath(); g.fillStyle = mc; g.fill(); g.restore();
  }
  // 文字：状态、方向、相序、转速条
  const tx = cx + 86;
  text(motor.state === '停止' && run ? '减速' : motor.state, tx, cy - 34, 30, mc, 'left', 'bold');
  text(run ? (sgn > 0 ? '顺时针 ↻' : '逆时针 ↺') : motor.state === '缺相' ? '缺一相，电动机不能正常起动' : '电动机（仿真）', tx, cy - 2, 15, run ? mc : C.dim, 'left', 'bold');
  if (motor.seq) ['U', 'V', 'W'].forEach((u, i) => { const x = tx + i * 58; rrect(x, cy + 16, 52, 26, 8, TH.btn, C[PH[motor.seq[i]]], 1.5); text(u + '←' + PH[motor.seq[i]], x + 26, cy + 29.5, 13, C[PH[motor.seq[i]]], 'center', 'bold'); });
  rrect(tx, cy + 50, 172, 6, 3, TH.btn); if (sp > 0.02) rrect(tx, cy + 50, 172 * sp, 6, 3, mc);
}
