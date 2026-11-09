// 双指放大（手机屏幕小、触点点不准）：各电路练习页（practice.js）和并联专项（parallel.js）共用。
// 双指捏合放大（最多 4 倍）并平移，电脑上滚轮缩放；一根手指照常接线。第二根手指按下就进入缩放，先取消第一根手指正在做的事（拖线、按按钮），两根都松开前不再当成接线操作。
// 用 CSS transform 放大整块画布，点击坐标由 getBoundingClientRect 自动换算；放大时右下角出现复原按钮（样式 .zoom-reset 写在页面里）。
// 页面要在自己的 pointerdown 之前调用它（缩放时用 stopImmediatePropagation 拦住后面的处理）。
// o.size()：画布没放大时的 CSS 宽、高；o.cancel()：第二根手指按下时取消正在做的事；o.settle()：缩放停下（松手、滚轮停 0.2 秒、复原）后调用，用来调画布分辨率
function makeZoom(cv, o) {
  const VIEW = { k: 1, x: 0, y: 0 }; let btn = null;
  /* 2026-11-06 修重叠：并联专项「收起工具栏」后会有一颗可拖动的工具圆钮（#tbOrb，fixed z=22，
     默认停在右下角往上一截）。以前复原按钮用固定 bottom 偏移，竖屏/横屏都会和圆钮压在一起
     （实测竖屏圆钮 [315,670,46,46] vs 复原 [317,690,44,44]，命中 zoom-reset，工具栏点不开）。
     固定偏移在 375 高的横屏下永远猜不准 —— 改成按圆钮的**实际矩形**避让：默认放右下角，
     与圆钮相交就往上挪，挪出屏幕再翻到左边。没有圆钮（练习页）就保持原来的位置。 */
  function placeBtn() {
    if (!btn) return;
    const R = 14, W = innerWidth, H = innerHeight, S = 44;
    const orb = document.getElementById('tbOrb');
    let orbRect = null;
    if (orb) { const cs = getComputedStyle(orb); if (cs.display !== 'none' && cs.visibility !== 'hidden') { const r = orb.getBoundingClientRect(); if (r.width) orbRect = r; } }
    /* 起始落点：优先贴着工具圆钮的上方（这样两颗圆钮排成一列、都在右下角拇指够得着的地方），
       没有圆钮才用页面 CSS 的固定偏移（练习页那种 right/bottom 写法）。 */
    let x, y;
    if (orbRect) { x = orbRect.left + (orbRect.width - S) / 2; y = orbRect.top - S - 10; }
    else { let bottom = R; const cs = getComputedStyle(btn); if (cs.bottom && cs.bottom !== 'auto') { const n = parseFloat(cs.bottom); if (isFinite(n)) bottom = n; } x = W - S - R; y = H - S - bottom; }
    const hit = (a, b) => a && b && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    if (orbRect) {
      const orc = [orbRect.left, orbRect.top, orbRect.width, orbRect.height];
      let tries = 0;
      while (tries < 6 && hit([x, y, S, S], orc)) { y -= S + 8; tries++; }   // 还撞就继续往上让
      if (y < R) y = R;                                                       // 顶到边：贴顶（此时一定在圆钮上方）
      if (hit([x, y, S, S], orc)) { x = R; y = R; }                           // 极端情况：贴左上角
    }
    Object.assign(btn.style, { right: 'auto', bottom: 'auto', left: Math.max(R, x) + 'px', top: Math.max(R, y) + 'px' });
  }
  function applyView() {
    const [bw, bh] = o.size();
    VIEW.k = clamp(VIEW.k, 1, 4); VIEW.x = clamp(VIEW.x, bw * (1 - VIEW.k), 0); VIEW.y = clamp(VIEW.y, bh * (1 - VIEW.k), 0);
    cv.style.transformOrigin = '0 0'; cv.style.transform = VIEW.k > 1.001 ? `translate(${VIEW.x}px, ${VIEW.y}px) scale(${VIEW.k})` : '';
    if (!btn) { btn = document.createElement('button'); btn.className = 'zoom-reset'; btn.title = '复原缩放'; btn.setAttribute('aria-label', '复原缩放');
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      btn.onclick = () => { VIEW.k = 1; VIEW.x = VIEW.y = 0; applyView(); o.settle(); }; document.body.appendChild(btn);
      addEventListener('resize', placeBtn); }
    btn.classList.toggle('show', VIEW.k > 1.01);
    placeBtn();
  }
  function zoomAt(cx, cy, k, base) { // 以屏幕点 (cx, cy) 为中心缩放到 k 倍：这个点下面的画面不动
    const b = base || (() => { const r = cv.getBoundingClientRect(); return { l: r.left - VIEW.x, t: r.top - VIEW.y, x: VIEW.x, y: VIEW.y, k: VIEW.k, cx, cy }; })();
    const px = (b.cx - b.l - b.x) / b.k, py = (b.cy - b.t - b.y) / b.k;
    VIEW.k = clamp(k, 1, 4); VIEW.x = cx - b.l - px * VIEW.k; VIEW.y = cy - b.t - py * VIEW.k; applyView();
  }
  const TOUCH = new Map(); let pinch = null;
  const pinchInfo = () => { const [a, b] = [...TOUCH.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 }; };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    if (e.isPrimary) { TOUCH.clear(); pinch = null; } // 新的一次触摸从第一根手指开始：清掉上一次可能没收到抬起事件的手指
    TOUCH.set(e.pointerId, [e.clientX, e.clientY]);
    if (TOUCH.size === 2) {
      o.cancel();
      const r = cv.getBoundingClientRect(), p = pinchInfo(); pinch = { d0: p.d, base: { l: r.left - VIEW.x, t: r.top - VIEW.y, x: VIEW.x, y: VIEW.y, k: VIEW.k, cx: p.cx, cy: p.cy } };
    }
    if (pinch) e.stopImmediatePropagation();
  });
  cv.addEventListener('pointermove', e => {
    if (!TOUCH.has(e.pointerId)) return; TOUCH.set(e.pointerId, [e.clientX, e.clientY]);
    if (!pinch) return; e.stopImmediatePropagation();
    if (TOUCH.size >= 2 && pinch.base) { const p = pinchInfo(); zoomAt(p.cx, p.cy, pinch.base.k * p.d / pinch.d0, pinch.base); }
  });
  const touchEnd = e => {
    if (!TOUCH.has(e.pointerId)) return; TOUCH.delete(e.pointerId);
    if (!pinch) return; e.stopImmediatePropagation();
    if (TOUCH.size < 2) pinch.base = null; if (!TOUCH.size) { pinch = null; o.settle(); }
  };
  cv.addEventListener('pointerup', touchEnd); cv.addEventListener('pointercancel', touchEnd);
  let wheelT = 0;
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, VIEW.k * Math.exp(-e.deltaY * 0.0015)); clearTimeout(wheelT); wheelT = setTimeout(o.settle, 200); }, { passive: false });
  return { VIEW, applyView, zoomAt };
}
