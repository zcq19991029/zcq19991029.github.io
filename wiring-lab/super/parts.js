// 实物元件（俯视图）：断路器、熔断器、按钮、接触器、热继电器、端子排、电动机
function screw(x, y, r = 8) {
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  gr.addColorStop(0, '#f8fafc'); gr.addColorStop(0.6, '#cbd5e1'); gr.addColorStop(1, '#64748b');
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = gr; g.fill(); g.strokeStyle = '#475569'; g.lineWidth = 1; g.stroke();
  poly([[x - r * 0.55, y], [x + r * 0.55, y]], '#475569', 1.6); poly([[x, y - r * 0.55], [x, y + r * 0.55]], '#475569', 1.6);
}
function lin(x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([k, c]) => gr.addColorStop(k, c)); return gr; }
function shadowBox(x, y, w, h, r, fill, stroke = '#94a3b8') {
  g.save(); if (!hxIsLite()) { g.shadowColor = 'rgba(15,23,42,.25)'; g.shadowBlur = 10; g.shadowOffsetY = 4; } rrect(x, y, w, h, r, fill); g.restore();
  rrect(x, y, w, h, r, null, stroke, 1.5);
}
function plate(name, x, y, sub) { // 元件铭牌
  g.save(); g.font = `bold 20px ${FONT}`; const w = Math.max(g.measureText(name).width, sub ? 40 : 0) + 14; g.restore();
  rrect(x - w / 2, y - 13, w, 26, 6, '#fef08a', '#ca8a04', 1.2); text(name, x, y + 1, 20, '#713f12', 'center', 'bold');
}

// 断路器 QF：三相四线（3P+N），和实物一样从左到右 L1、L2、L3、N，中间拨杆联动
const QF_POLES = ['L1', 'L2', 'L3', 'N'];
function partQF(x, y, on, hi, pos) {
  const hp = pos === undefined ? (on ? 1 : 0) : pos; // 拨杆位置 0～1（练习页做弹簧动画用；视频直接按开关状态）
  const w = 60 * QF_POLES.length;
  shadowBox(x, y, w, 150, 10, lin(x, y, x + w, y, [[0, '#f8fafc'], [0.5, '#e2e8f0'], [1, '#f1f5f9']]), hi ? C.trace : '#94a3b8');
  QF_POLES.forEach((p, i) => {
    const cx = x + 30 + 60 * i;
    rrect(cx - 18, y + 2, 36, 22, 4, '#334155'); rrect(cx - 18, y + 126, 36, 22, 4, '#334155');
    screw(cx, y + 12); screw(cx, y + 138);
    rrect(cx - 12, y + 44, 24, 62, 5, '#1e293b');
    rrect(cx - 9, y + 76 - 28 * hp, 18, 26, 4, on ? '#2563eb' : '#64748b');
    if (i < QF_POLES.length - 1) poly([[cx + 12, y + 89 - 28 * hp], [cx + 48, y + 89 - 28 * hp]], on ? '#2563eb' : '#64748b', 5);
    text(p, cx, y + 116, 13, p === 'N' ? '#2563eb' : '#1f2937', 'center', 'bold'); // 印在白色外壳上，固定深色
  });
  rrect(x + 2, y + 28, w - 4, 12, 3, '#1d4ed8'); text('3P+N  C16', x + w - 40, y + 34, 10, '#fff', 'center', 'bold');
  plate('QF', x + w / 2, y - 16); text(on ? 'ON' : 'OFF', x + w / 2 + 44, y - 16, 15, on ? '#16a34a' : C.bad, 'left', 'bold');
}
// 熔断器座（单个）
function partFuse(cx, y, name) {
  shadowBox(cx - 23, y, 46, 150, 6, lin(cx - 23, y, cx + 23, y, [[0, '#e2e8f0'], [0.5, '#f8fafc'], [1, '#cbd5e1']]));
  rrect(cx - 16, y + 30, 32, 90, 6, 'rgba(148,163,184,.35)', '#94a3b8', 1);
  rrect(cx - 10, y + 40, 20, 70, 8, lin(cx - 10, 0, cx + 10, 0, [[0, '#d6c7a1'], [0.5, '#f5ecd2'], [1, '#c2b280']]));
  rrect(cx - 10, y + 40, 20, 10, 4, '#a8a29e'); rrect(cx - 10, y + 100, 20, 10, 4, '#a8a29e');
  screw(cx, y + 12); screw(cx, y + 138);
  if (name) text(name, cx, y + 162, 16, C.ink, 'center', 'bold');
}
// 按钮：黑色底座 + 彩色按钮帽，下方两个接线端子（左入口、右出口）
// quad：复合按钮（一对常闭 + 一对常开，机械联动），端子座 4 个端子：左两个 NC、右两个 NO
function partButton(cx, y, color, pressed, name, desc, hi, quad) {
  if (hi) { g.save(); if (!hxIsLite()) { g.shadowColor = C.trace; g.shadowBlur = 22; } rrect(cx - 54, y - 6, 108, 146, 14, null, C.trace, 4); g.restore(); }
  shadowBox(cx - 48, y, 96, 96, 12, lin(cx, y, cx, y + 96, [[0, '#374151'], [1, '#111827']]), '#0f172a');
  const r = pressed ? 27 : 31;
  g.beginPath(); g.arc(cx, y + 48, 38, 0, 7); g.fillStyle = lin(cx, y + 10, cx, y + 86, [[0, '#f1f5f9'], [1, '#94a3b8']]); g.fill();
  g.beginPath(); g.arc(cx, y + 48 + (pressed ? 2 : 0), r, 0, 7);
  g.fillStyle = g.createRadialGradient(cx - 9, y + 38, 3, cx, y + 48, r); g.fillStyle.addColorStop(0, '#fff'); g.fillStyle.addColorStop(0.25, color); g.fillStyle.addColorStop(1, shade(color));
  g.fill();
  if (quad) {
    rrect(cx - 60, y + 102, 120, 34, 6, '#4b5563'); [-45, -15, 15, 45].forEach(d => screw(cx + d, y + 120, 8));
    text('NC', cx - 30, y + 146, 11, '#f59e0b', 'center', 'bold'); text('NO', cx + 30, y + 146, 11, '#22c55e', 'center', 'bold');
    poly([[cx, y + 106], [cx, y + 132]], '#9ca3af', 1);
  } else { rrect(cx - 44, y + 102, 88, 34, 6, '#4b5563'); screw(cx - 26, y + 120, 9); screw(cx + 26, y + 120, 9); }
  text(name, cx, y - 14, 20, C.ink, 'center', 'bold'); if (desc) text(desc, cx + 62, y + 48, 16, C.dim, 'left');
  if (pressed) tag('按下', cx, y + 48, C.bad, 16);
}
function shade(hex) { const n = parseInt(hex.slice(1), 16); const f = v => Math.round(v * 0.55); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
// 交流接触器：上排 6 个端子、下排 6 个端子
const KM_TOP = ['1/L1', '3/L2', '5/L3', '13', '21', 'A1'], KM_BOT = ['2/T1', '4/T2', '6/T3', '14', '22', 'A2'];
function partKM(x, y, arm, name, hi) {
  shadowBox(x, y, 260, 184, 12, lin(x, y, x, y + 184, [[0, '#1f2937'], [1, '#0b1220']]), hi ? C.trace : '#0f172a');
  rrect(x + 6, y + 2, 248, 24, 5, '#111827'); rrect(x + 6, y + 158, 248, 24, 5, '#111827');
  for (let c = 0; c < 6; c++) {
    const cx = x + 25 + 40 * c; screw(cx, y + 12); screw(cx, y + 172);
    // 辅助触点标明常开 NO（绿）/ 常闭 NC（橙），主触点和线圈照原样
    const aux = c === 3 ? ['NO', '#4ade80'] : c === 4 ? ['NC', '#fb923c'] : null;
    text(KM_TOP[c] + (aux ? ' ' + aux[0] : ''), cx, y + 34, 11, aux ? aux[1] : '#cbd5e1', 'center', aux ? 'bold' : 'normal');
    text(KM_BOT[c] + (aux ? ' ' + aux[0] : ''), cx, y + 150, 11, aux ? aux[1] : '#cbd5e1', 'center', aux ? 'bold' : 'normal');
  }
  rrect(x + 22, y + 46, 216, 92, 10, lin(x, y + 46, x, y + 138, [[0, '#2563eb'], [1, '#1e3a8a']]));
  rrect(x + 78, y + 58, 104, 50, 6, '#0f172a');
  rrect(x + 86, y + 64 + arm * 22, 88, 16, 3, arm > 0.5 ? '#f8fafc' : '#94a3b8'); // 衔铁指示：吸合时下移
  text(name, x + 50, y + 122, 20, '#fff', 'center', 'bold'); text('CJX2', x + 200, y + 122, 13, '#bfdbfe', 'center', 'bold');
  if (arm > 0.5) { g.save(); if (!hxIsLite()) { g.shadowColor = C.bad; g.shadowBlur = 14; } tag('吸合', x + 210, y + 80, C.bad, 20); g.restore(); }
}
// 热继电器
function partFR(x, y, trip, hi) {
  shadowBox(x, y, 260, 130, 10, lin(x, y, x, y + 130, [[0, '#292524'], [1, '#0c0a09']]), hi ? C.trace : '#0f172a');
  rrect(x + 6, y + 2, 248, 22, 5, '#111827'); rrect(x + 6, y + 106, 248, 22, 5, '#111827');
  [0, 1, 2].forEach(c => { screw(x + 25 + 40 * c, y + 12); screw(x + 25 + 40 * c, y + 118); });
  screw(x + 185, y + 12); screw(x + 185, y + 118); text('95', x + 210, y + 12, 12, '#e7e5e4'); text('96', x + 210, y + 118, 12, '#e7e5e4');
  g.beginPath(); g.arc(x + 70, y + 64, 22, 0, 7); g.fillStyle = '#ea580c'; g.fill(); poly([[x + 70, y + 64], [x + 84, y + 50]], '#fff', 3);
  g.beginPath(); g.arc(x + 130, y + 64, 12, 0, 7); g.fillStyle = trip ? '#ef4444' : '#3b82f6'; g.fill();
  text('复位', x + 130, y + 90, 12, '#e7e5e4'); text('FR', x + 225, y + 64, 22, '#fff', 'center', 'bold');
  if (trip) tag('脱扣', x + 180, y + 64, C.bad, 18);
}
// 端子排
function partXT(x, y, cells) {
  shadowBox(x, y, cells.length * 58, 90, 6, '#e5e7eb');
  cells.forEach((c, i) => {
    const cx = x + 29 + 58 * i;
    if (!c) { rrect(cx - 27, y + 4, 54, 82, 4, '#cbd5e1'); return; }
    rrect(cx - 27, y + 4, 54, 82, 4, lin(cx - 27, 0, cx + 27, 0, [[0, '#9ca3af'], [0.5, '#e5e7eb'], [1, '#9ca3af']]));
    screw(cx, y + 15); screw(cx, y + 75); rrect(cx - 18, y + 34, 36, 22, 3, '#fff'); text(c, cx, y + 45, 15, C.ink, 'center', 'bold');
  });
  text('XT', x - 14, y + 45, 20, C.ink, 'right', 'bold');
}
// 电动机：侧视，左端轴上的转盘显示转向；接线盒在机座下前方，三个端子 U V W
// 只在状态栏里示意转向（实物板上这次不接电动机）
function partMotor(x, y, ang, w, hi) {
  rrect(x + 50, y + 168, 40, 14, 3, '#475569'); rrect(x + 180, y + 168, 40, 14, 3, '#475569');
  shadowBox(x + 206, y + 34, 46, 120, 14, lin(0, y + 34, 0, y + 154, [[0, '#cbd5e1'], [0.5, '#f1f5f9'], [1, '#94a3b8']]));
  for (let k = 0; k < 5; k++) poly([[x + 214 + k * 8, y + 48], [x + 214 + k * 8, y + 140]], '#94a3b8', 2);
  shadowBox(x + 60, y + 20, 150, 150, 18, lin(0, y + 20, 0, y + 170, [[0, '#64748b'], [0.35, '#cbd5e1'], [0.6, '#94a3b8'], [1, '#334155']]), hi ? C.trace : '#334155');
  for (let k = 0; k < 9; k++) poly([[x + 72, y + 36 + k * 15], [x + 198, y + 36 + k * 15]], 'rgba(30,41,59,.35)', 2);
  rrect(x + 38, y + 50, 26, 88, 8, '#94a3b8', '#475569', 1.5);
  rrect(x + 8, y + 86, 32, 16, 3, lin(0, y + 86, 0, y + 102, [[0, '#e2e8f0'], [1, '#64748b']]));
  const cx = x + 6, cy = y + 94;
  g.beginPath(); g.ellipse(cx, cy, 14, 40, 0, 0, 7); g.fillStyle = '#e2e8f0'; g.fill(); g.strokeStyle = '#475569'; g.lineWidth = 2; g.stroke();
  for (let k = 0; k < 3; k++) { const a = ang + k * 2.094; dot(cx + Math.cos(a) * 9, cy + Math.sin(a) * 30, 6, k ? '#64748b' : '#dc2626'); }
  shadowBox(x + 72, y + 140, 90, 42, 6, '#475569', '#1e293b');
  for (let i = 0; i < 3; i++) { const tx = x + 87 + 24 * i, ty = y + 166; screw(tx, ty, 8); text('UVW'[i], tx, ty - 17, 12, '#fff', 'center', 'bold'); }
  text('M', x + 135, y + 80, 34, '#0f172a', 'center', 'bold'); text('3~', x + 135, y + 112, 20, '#0f172a', 'center', 'bold');
  if (Math.abs(w) > 0.08) {
    const dir = Math.sign(w), col = dir > 0 ? '#0284c7' : '#9333ea';
    g.save(); g.globalAlpha = clamp(Math.abs(w) * 1.6); g.strokeStyle = col; g.lineWidth = 6;
    g.beginPath(); g.ellipse(cx, cy, 28, 60, 0, dir > 0 ? -2.4 : -0.7, dir > 0 ? -0.7 : -2.4, dir < 0); g.stroke(); g.restore();
    tag(dir > 0 ? '正转 ↻' : '反转 ↺', x + 135, y - 10, col, 26);
  } else text('电动机 停止', x + 135, y - 10, 20, C.dim, 'center', 'bold');
}

// ---------- 以下为各电路共用：原理图元件符号、实物板导线 ----------
// ---------- 画元件符号 ----------
function symbol(e, col, s) {
  const lw = 3, x = e.x, y1 = e.y1, y2 = e.y2;
  const closed = e.on ? e.on(s) : true;
  if (e.kind === 'tno' || e.kind === 'tnc') { // 通电延时触点：常开（延时闭合）/ 常闭（延时断开），画成普通触点再加一个半圆
    symbol({ ...e, kind: e.kind === 'tno' ? 'no' : 'nc' }, col, s);
    g.save(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x - 16, (y1 + y2) / 2, 7, e.kind === 'tno' ? Math.PI * 0.5 : -Math.PI * 0.5, e.kind === 'tno' ? Math.PI * 1.5 : Math.PI * 0.5); g.stroke();
    poly([[x - 9, (y1 + y2) / 2], [x - 4, (y1 + y2) / 2]], col, 2); g.restore(); return;
  }
  if (e.kind === 'ono' || e.kind === 'onc') { // 断电延时触点：常开（延时断开）/ 常闭（延时闭合），半圆开口方向和通电延时相反
    symbol({ ...e, kind: e.kind === 'ono' ? 'no' : 'nc' }, col, s);
    g.save(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x - 9, (y1 + y2) / 2, 7, e.kind === 'ono' ? -Math.PI * 0.5 : Math.PI * 0.5, e.kind === 'ono' ? Math.PI * 0.5 : Math.PI * 1.5); g.stroke();
    poly([[x - 9, (y1 + y2) / 2], [x - 4, (y1 + y2) / 2]], col, 2); g.restore(); return;
  }
  if (e.kind === 'sqno' || e.kind === 'sqnc') { // 位置开关：触点加一个三角形的“被压”标记
    symbol({ ...e, kind: e.kind === 'sqno' ? 'no' : 'nc' }, col, s);
    const my = (y1 + y2) / 2; poly([[x - 6, my - 6], [x - 14, my + 2], [x - 6, my + 8]], col, 2); return;
  }
  if (e.kind === 'qf' || e.kind === 'km' || e.kind === 'no' || e.kind === 'bno') {
    poly([[x, y1], [x, y1 + 10]], col, lw); poly([[x, y2 - 10], [x, y2]], col, lw);
    poly([[x, y2 - 10], closed ? [x + 1, y1 + 10] : [x - 17, y1 + 14]], col, lw);
    if (e.kind === 'qf') { poly([[x - 5, y1 + 5], [x + 5, y1 + 15]], col, 2); poly([[x + 5, y1 + 5], [x - 5, y1 + 15]], col, 2); }
    if (e.kind === 'km') { g.save(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y1 + 14, 5, Math.PI * 1.5, Math.PI * 0.5); g.stroke(); g.restore(); }
  } else if (e.kind === 'nc' || e.kind === 'bnc') {
    poly([[x, y1], [x, y1 + 10], [x + 13, y1 + 10]], col, lw); poly([[x, y2 - 10], [x, y2]], col, lw);
    poly([[x, y2 - 10], closed ? [x + 15, y1 + 7] : [x - 15, y1 + 13]], col, lw);
  }
  if (e.kind === 'bno' || e.kind === 'bnc') { // 按钮：E 形按键 + 虚线联动
    const pressed = !(e.kind === 'bno' ? !closed : closed), my = (y1 + y2) / 2 + 2, dx = pressed ? 7 : 0;
    poly([[x - 6 + dx, my], [x - 34 + dx, my]], col, 2, [5, 4]);
    poly([[x - 34 + dx, my - 9], [x - 40 + dx, my - 9], [x - 40 + dx, my + 9], [x - 34 + dx, my + 9]], col, 2.5);
  }
  if (e.kind === 'fuse') { poly([[x, y1], [x, y2]], col, lw); g.save(); g.fillStyle = (C.paper || '#fff'); g.strokeStyle = col; g.lineWidth = 2.5; g.fillRect(x - 7, y1 + 8, 14, y2 - y1 - 16); g.strokeRect(x - 7, y1 + 8, 14, y2 - y1 - 16); g.restore(); poly([[x, y1], [x, y2]], col, 1.5); }
  if (e.kind === 'fuseH') { poly([[e.x1, e.y], [e.x2, e.y]], col, lw); g.save(); g.fillStyle = (C.paper || '#fff'); g.strokeStyle = col; g.lineWidth = 2.5; g.fillRect(e.x1 + 8, e.y - 7, e.x2 - e.x1 - 16, 14); g.strokeRect(e.x1 + 8, e.y - 7, e.x2 - e.x1 - 16, 14); g.restore(); poly([[e.x1, e.y], [e.x2, e.y]], col, 1.5); }
  if (e.kind === 'coil') { poly([[x, y1], [x, y1 + 2]], col, lw); g.save(); g.fillStyle = s._coil && s._coil.has(e.id) ? '#fed7aa' : (C.paper || '#fff'); g.strokeStyle = col; g.lineWidth = 3; g.fillRect(x - 26, y1, 52, y2 - y1); g.strokeRect(x - 26, y1, 52, y2 - y1); g.restore(); }
  if (e.kind === 'heat') { poly([[x, y1], [x, y2]], col, lw); g.save(); g.fillStyle = (C.paper || '#fff'); g.strokeStyle = col; g.lineWidth = 2.5; g.fillRect(x - 10, y1 + 6, 20, y2 - y1 - 12); g.strokeRect(x - 10, y1 + 6, 20, y2 - y1 - 12); g.restore(); poly([[x, y1 + 6], [x, y1 + 14], [x + 6, y1 + 14], [x + 6, y2 - 14], [x, y2 - 14], [x, y2 - 6]], col, 2); }
}

// 线号：标在这根线最长的一段中间（套管是白底，字固定用深色：深色主题下 C.ink 是浅色，写在白底上就看不见了）
function sleeve(pts, label) {
  let best = 0, bi = 1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d > best) { best = d; bi = i; } }
  const x = (pts[bi][0] + pts[bi - 1][0]) / 2, y = (pts[bi][1] + pts[bi - 1][1]) / 2;
  g.save(); g.font = 'bold 13px ' + FONT; const w = g.measureText(label).width + 10; g.restore();
  rrect(x - w / 2, y - 9, w, 18, 4, '#fff', '#64748b', 1); text(label, x, y + 0.5, 13, '#0f172a', 'center', 'bold');
}
// 画导线；active 表示“正在接的这一根”，外面加一圈发光
function drawWire(x, prog, active, t) {
  const pts = partial(x.pts, prog), col = netColor(x.net), lw = C.wireW || 5; // 线宽：视频固定 5，练习页可调
  if (active) { g.save(); if (!hxIsLite()) { g.shadowColor = C.trace; g.shadowBlur = 24; } poly(pts, 'rgba(14,165,233,.55)', lw + 11); g.restore(); }
  poly(pts, C.wireEdge || 'rgba(15,23,42,.35)', lw + 2); // 导线描边：深色底上用浅色描边，黑色线也看得见
  poly(pts, col, lw);
  if (prog < 1) { const e = pts[pts.length - 1]; g.save(); if (!hxIsLite()) { g.shadowColor = C.trace; g.shadowBlur = 18; } dot(e[0], e[1], 8, C.trace); g.restore(); }
}
