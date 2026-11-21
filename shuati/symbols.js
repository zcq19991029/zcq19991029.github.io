// 华夏工具 · 刷题：电气图形符号（按 GB/T 4728 画法，代码绘制）。题目里用 fig: '名字' 引用（题干 q.fig、选项 o.fig），只认这里有的名字，不接收外部 SVG。
// 竖直画法：上端接静触点，下端是动触点支点；动合触点刀片向左斜，动断触点刀片向右斜搭在静触点的横线上。
const L = (x1, y1, x2, y2, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${dash ? ' stroke-dasharray="4 3"' : ''}/>`;
const P = d => `<path d="${d}"/>`;
// 单极触点，x 是导线位置；返回刀片中点（接操作件的连杆）
const no = x => L(x, 0, x, 26) + L(x, 54, x, 80) + L(x, 54, x - 12, 24);
const nc = x => L(x, 0, x, 26) + L(x, 26, x + 13, 26) + L(x, 54, x, 80) + L(x, 54, x + 14, 22);
const push = (x, y) => P(`M${x + 4} ${y - 6} H${x} V${y + 6} H${x + 4}`); // 按钮操作件（E 形）
const hand = (x, y) => L(x, y - 7, x, y + 7); // 一般手动操作
const heat = (x, y) => P(`M${x} ${y} H${x - 4} V${y - 6} H${x - 10} V${y} H${x - 14}`); // 热执行器
const roller = x => `<polygon points="${x - 2},49 ${x - 5},41 ${x - 10},47"/>`; // 位置开关标记：刀片下段的空心三角（同教材图 1-26）
const breaker = x => L(x - 3, 23, x + 3, 29) + L(x - 3, 29, x + 3, 23);
const cup = x => P(`M${x} 20 A3 3 0 0 0 ${x} 26`); // 接触器功能：静触点下端靠刀片一侧的半圆（同教材图 1-19b）
const rotary = (x, y) => P(`M${x + 4} ${y - 6} H${x} V${y + 6} H${x - 4}`); // 旋转操作（Ƒ 形），组合开关用
// 延时符号：刀片中点向左两条平行线 + 圆弧。通电延时圆弧向左凸，断电延时向右凸（教材图 1-22，方向不能改）
const delay = (bx, y, on, e = on ? 15 : 10) => L(bx, y - 2, bx - e, y - 2) + L(bx, y + 2, bx - e, y + 2)
  + (on ? P(`M${bx - 10} ${y - 6} A6 6 0 0 0 ${bx - 10} ${y + 6}`) : P(`M${bx - 16} ${y - 6} A6 6 0 0 1 ${bx - 16} ${y + 6}`));
const speed = (x, y) => `<rect x="${x - 12}" y="${y - 6}" width="12" height="12"/><text x="${x - 6}" y="${y + 4}" font-size="11" font-style="italic" text-anchor="middle" fill="currentColor" stroke="none" font-family="Times New Roman,serif">n</text>`;
const txt = (x, y, s, size = 14) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial,sans-serif">${s}</text>`;
const three = (fn, extra = '') => [20, 50, 80].map(x => fn(x)).join('') + extra;

const SYM = {
  fu: ['0 0 40 80', L(20, 0, 20, 80) + '<rect x="13" y="24" width="14" height="32"/>', '熔断器'],
  coil: ['0 0 40 80', L(20, 0, 20, 26) + L(20, 54, 20, 80) + '<rect x="4" y="26" width="32" height="28"/>', '线圈'],
  no: ['0 0 40 80', no(24), '动合（常开）触点'],
  nc: ['0 0 40 80', nc(16), '动断（常闭）触点'],
  km3: ['0 0 100 80', three(x => no(x) + cup(x)), '接触器主触点'],
  qs3: ['-20 0 120 80', three(no, L(-10, 39, 74, 39, 1) + hand(-10, 39)), '三极刀开关'],
  qf3: ['-20 0 120 80', three(x => no(x) + breaker(x), L(-10, 39, 74, 39, 1) + hand(-10, 39)), '三极低压断路器'],
  frh: ['0 0 40 80', '<rect x="4" y="24" width="32" height="32"/>' + P('M20 0 V32 H12 V48 H20 V80'), '热继电器热元件'],
  frnc: ['-24 0 64 80', nc(16) + L(23, 38, -4, 38, 1) + heat(-4, 38), '热继电器动断（常闭）触点'],
  sbno: ['-20 0 60 80', no(24) + L(18, 39, -8, 39, 1) + push(-12, 39), '按钮动合（常开）触点'],
  sbnc: ['-20 0 60 80', nc(16) + L(23, 38, -8, 38, 1) + push(-12, 38), '按钮动断（常闭）触点'],
  sb2: ['-20 0 100 80', no(24) + nc(52) + L(59, 38, -8, 38, 1) + push(-12, 38), '复合按钮'],
  sqno: ['0 0 40 80', no(24) + roller(24), '行程开关动合（常开）触点'],
  sqnc: ['0 0 40 80', nc(14) + '<polygon points="16,49 19.5,41 16,41"/>', '行程开关动断（常闭）触点'],
  qs3r: ['-20 0 120 80', three(no, L(-10, 39, 74, 39, 1) + rotary(-10, 39)), '三极组合开关'],
  kton_coil: ['0 0 40 80', L(20, 0, 20, 26) + L(20, 54, 20, 80) + '<rect x="4" y="26" width="32" height="28"/><rect x="4" y="26" width="9" height="28"/>' + L(4, 26, 13, 54) + L(13, 26, 4, 54), '通电延时型时间继电器线圈'],
  ktoff_coil: ['0 0 40 80', L(20, 0, 20, 26) + L(20, 54, 20, 80) + '<rect x="4" y="26" width="32" height="28"/><rect x="4" y="26" width="9" height="28" fill="currentColor"/>', '断电延时型时间继电器线圈'],
  kton_no: ['-4 0 44 80', no(28) + delay(22, 39, 1), '时间继电器通电延时动合（常开）触点'],
  kton_nc: ['-4 0 44 80', nc(20) + delay(27, 38, 1), '时间继电器通电延时动断（常闭）触点'],
  ktoff_no: ['-4 0 44 80', no(28) + delay(22, 39, 0), '时间继电器断电延时动合（常开）触点'],
  ktoff_nc: ['-4 0 44 80', nc(20) + delay(27, 38, 0), '时间继电器断电延时动断（常闭）触点'],
  ks_no: ['-20 0 60 80', no(24) + L(18, 39, -6, 39, 1) + speed(-6, 39), '速度继电器动合（常开）触点'],
  ks_nc: ['-20 0 60 80', nc(16) + L(23, 38, -6, 38, 1) + speed(-6, 38), '速度继电器动断（常闭）触点'],
  m3: ['0 0 100 100', L(34, 0, 38, 29) + L(50, 0, 50, 26) + L(66, 0, 62, 29) + '<circle cx="50" cy="56" r="30"/>' + txt(50, 56, 'M', 20) + txt(50, 76, '3～', 13), '三相异步电动机'],
};

// 控制电路小图（教材图 2-3 自锁接法）：主线在 x=40 从上往下排元件，每个高 40；并联支路画在 x=85，from/to 是主线上的节点序号
const UNIT = {
  no: no(20), nc: nc(20), coil: SYM.coil[1].replace('x="4"', 'x="8"').replace('width="32"', 'width="24"'),
  sbno: no(20) + L(14, 39, -6, 39, 1) + push(-10, 39), sbnc: nc(20) + L(27, 38, -6, 38, 1) + push(-10, 38), w: L(20, 0, 20, 80),
};
const unit = (t, x, y, label, right) => `<g transform="translate(${x - 10} ${y}) scale(.5)" stroke-width="4">${UNIT[t]}</g>`
  + (label ? `<text x="${right ? x + 11 : x - (t === 'coil' ? 10 : 18)}" y="${y + 24}" font-size="11" text-anchor="${right ? 'start' : 'end'}" fill="currentColor" stroke="none" font-family="Arial,sans-serif">${label}</text>` : '');
function circuit(main, branch) {
  const Y = i => 12 + 40 * i, end = Y(main.length);
  let out = `<circle cx="40" cy="8" r="3"/>${L(40, 11, 40, 12)}<circle cx="40" cy="${end + 4}" r="3"/>${L(40, end, 40, end + 1)}`;
  main.forEach(([t, lb], i) => { out += unit(t, 40, Y(i), lb); });
  if (branch) {
    const [from, to, items] = branch, top = Y(from), bot = Y(to), y0 = (top + bot) / 2 - items.length * 20;
    out += L(40, top, 85, top) + L(85, top, 85, y0) + L(85, y0 + items.length * 40, 85, bot) + L(85, bot, 40, bot);
    items.forEach(([t, lb], i) => { out += unit(t, 85, y0 + 40 * i, lb, true); });
  }
  return [`0 0 115 ${end + 10}`, out, '', [250, 150]];
}
const SB = [['sbnc', 'SB1'], ['sbno', 'SB2']], KM = t => [t, 'KM'], COIL = ['coil', 'KM'];
Object.assign(SYM, {
  c23a: circuit([...SB, KM('no'), COIL]), c23b: circuit([...SB, KM('nc'), COIL]),
  c23c: circuit([...SB, COIL], [0, 2, [KM('no')]]), c23d: circuit([...SB, COIL], [0, 1, [KM('no')]]),
  c23e: circuit([...SB, COIL], [1, 2, [KM('nc')]]), c23f: circuit([...SB, COIL], [1, 3, [KM('no')]]),
  c23h: circuit([...SB, ['w'], COIL], [1, 3, [KM('no'), KM('nc')]]), c23ok: circuit([...SB, COIL], [1, 2, [KM('no')]]),
});
UNIT.frnc = nc(20) + L(27, 38, 4, 38, 1) + heat(4, 38);
function reversing() {
  const A = 40, B = 160, lab = (x, y, t, right) => `<text x="${right ? x + 11 : x - 18}" y="${y + 24}" font-size="11" text-anchor="${right ? 'start' : 'end'}" fill="currentColor" stroke="none" font-family="Arial,sans-serif">${t}</text>`;
  let o = `<circle cx="${A}" cy="8" r="3"/>${L(A, 11, A, 12)}` + unit('frnc', A, 12) + lab(A, 12, 'FR') + unit('sbnc', A, 52, 'SB1') + L(A, 92, B, 92);
  for (const [x, sb, me, other] of [[A, 'SB2', 'KM1', 'KM2'], [B, 'SB3', 'KM2', 'KM1']]) {
    o += unit('sbno', x, 92, sb) + L(x, 92, x + 40, 92) + unit('no', x + 40, 92, me, true) + L(x + 40, 132, x, 132)
      + unit('nc', x, 132, other) + unit('coil', x, 172, me);
  }
  return ['0 0 240 230', o + L(A, 212, B, 212) + L(A, 212, A, 218) + `<circle cx="${A}" cy="221" r="3"/>`, '正反转控制电路（教材图 2-4 控制部分）', [300, 180]];
}
SYM.zf = reversing();
for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'h']) SYM['c23' + k][2] = `控制电路（教材图 2-3${k}）`;
SYM.c23ok[2] = '控制电路：KM 常开触点与 SB2 并联';

// ===================== 完整电路原理图（主电路 + 控制电路）=====================
// 元件沿用上面的 no/nc/push/breaker/cup/heat/delay；统一竖向 0..80、导线在局部 x=20，
// ckPut 平移到任意 (x,y)（y 为元件顶边，导线贯穿 y..y+80*s），s 缩放、线宽自动补偿。
const ckS = 0.6, ckH = 48;
const ckPut = (x, y, body, wx = 20, s = ckS) => `<g transform="translate(${x - wx * s} ${y}) scale(${s})" stroke-width="${(2 / s).toFixed(3)}">${body}</g>`;
/* 标签：end 对齐的一律再左移 7px（2026-11-20 实测发现）——
   按钮/热继电器这类符号的 push()/heat() 操作件会往左伸出约 7px（scale 0.6 后），
   原来 x-17 放标签、文字右端正好压在操作件上（截图里「SB1」「KM2」糊在符号上）。
   统一在这里补偿，调用处不用每个都改。 */
const ckLab = (x, y, t, s = 11, a = 'start') => {
  const xx = a === 'end' ? x - 7 : x;
  return `<text x="${xx}" y="${y}" font-size="${s}" text-anchor="${a}" fill="currentColor" stroke="none" font-family="Arial,sans-serif">${t}</text>`;
};
const ckDot = (x, y, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const ckMtr = (x, cy, r) => `<circle cx="${x}" cy="${cy}" r="${r}"/>` + txt(x, cy - 3, 'M', 22) + txt(x, cy + 19, '3～', 12);
const ckWind = (x, y1, y2) => L(x, y1, x, y2) + `<rect x="${x - 12}" y="${y1 + 8}" width="24" height="${y2 - y1 - 16}"/>`;
const CB = {
  no: w => no(w), nc: w => nc(w), km: w => no(w) + cup(w), qf: w => no(w) + breaker(w),
  fu: () => L(20, 0, 20, 80) + '<rect x="13" y="24" width="14" height="32"/>',
  frh: () => '<rect x="4" y="24" width="32" height="32"/>' + P('M20 0 V32 H12 V48 H20 V80'),
  coil: () => L(20, 0, 20, 26) + L(20, 54, 20, 80) + '<rect x="4" y="26" width="32" height="28"/>',
  sbno: () => no(20) + L(14, 39, -8, 39, 1) + push(-12, 39),
  sbnc: () => nc(20) + L(27, 38, -8, 38, 1) + push(-12, 38),
  frnc: () => nc(20) + L(27, 38, 4, 38, 1) + heat(4, 38),
  ktno: () => no(20) + delay(14, 39, 1),
  ktnc: () => nc(20) + delay(27, 38, 1),
  ktc: () => L(20, 0, 20, 26) + L(20, 54, 20, 80) + '<rect x="4" y="26" width="32" height="28"/><rect x="4" y="26" width="9" height="28"/>' + L(4, 26, 13, 54) + L(13, 26, 4, 54),
};
// 主电路顶部：三相端子 + QF + FU1（L1/L2/L3 标签在上）
function ckFeed(xs, qfy, fuy) {
  const [x1, , x3] = xs;
  let o = xs.map((x, i) => ckLab(x, 9, 'L' + (i + 1), 11, 'middle')).join('');
  o += xs.map(x => ckDot(x, 14, 3) + L(x, 14, x, qfy)).join('');
  o += xs.map(x => ckPut(x, qfy, CB.qf(20))).join('');
  o += L(x1 - 6, qfy + 24, x3 + 6, qfy + 24, 1);
  o += ckLab(x1 - 13, qfy + 28, 'QF', 11, 'end');
  o += xs.map(x => ckPut(x, fuy, CB.fu())).join('');
  o += ckLab(x1 - 13, fuy + 28, 'FU1', 11, 'end');
  return o;
}
// 三相并联支路（如自锁触点）：主线 x 在 [y1,y2] 区间并一条 x2 支路，两头加结点
function ckBranch(x, x2, y1, y2) {
  return L(x, y1, x2, y1) + L(x, y2, x2, y2) + ckDot(x, y1) + ckDot(x, y2);
}

// 1）单向起动电路（教材图 2-1）
function ckSingle() {
  const X = [40, 90, 140], cx = 250, bx = 300;
  let o = ckFeed(X, 16, 64);
  o += X.map(x => ckPut(x, 112, CB.km(20))).join('') + ckLab(X[0] - 13, 140, 'KM', 11, 'end');
  o += X.map(x => ckPut(x, 160, CB.frh())).join('') + ckLab(X[0] - 13, 188, 'FR', 11, 'end');
  o += ckMtr(90, 252, 38);
  o += L(40, 208, 40, 214) + L(40, 214, 63, 225) + L(90, 208, 90, 214) + L(140, 208, 140, 214) + L(140, 214, 117, 225);
  // 控制电路（自锁）
  o += ckDot(cx, 14, 3) + L(cx, 14, cx, 16);
  o += ckPut(cx, 16, CB.fu()) + ckLab(cx + 13, 44, 'FU2');
  o += ckPut(cx, 64, CB.frnc()) + ckLab(cx + 16, 92, 'FR');
  o += ckPut(cx, 112, CB.sbnc()) + ckLab(cx + 16, 140, 'SB1');
  o += ckPut(cx, 160, CB.sbno()) + ckLab(cx + 16, 188, 'SB2');
  o += ckPut(bx, 160, CB.no(20)) + ckLab(bx + 15, 188, 'KM');
  o += ckBranch(cx, bx, 160, 208);
  o += ckPut(cx, 208, CB.coil()) + ckLab(cx + 16, 236, 'KM');
  o += L(cx, 256, cx, 264) + ckDot(cx, 264, 3) + ckLab(cx + 10, 268, 'N');
  return ['-14 -8 354 308', o];
}

// 2）电气互锁正反转（教材图 2-4）
function ckRev() {
  const X = [40, 90, 140], KX = [180, 230, 280];
  let o = ckFeed(X, 16, 64);
  // KM1（正转）在 X 列，KM2（反转，换相）在 KX 列
  o += X.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(X[0] - 13, 156, 'KM1', 11, 'end');
  o += KX.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(KX[2] + 13, 156, 'KM2');
  // KM2 进线交叉（L1→280、L2→230、L3→180）
  o += L(40, 112, 40, 128) + L(90, 112, 90, 128) + L(140, 112, 140, 128);
  o += L(40, 116, 280, 116) + L(280, 116, 280, 128) + ckDot(40, 116);
  o += L(90, 120, 230, 120) + L(230, 120, 230, 128) + ckDot(90, 120);
  o += L(140, 124, 180, 124) + L(180, 124, 180, 128) + ckDot(140, 124);
  // KM2 出线合并（280→W、230→V、180→U）
  o += L(40, 176, 40, 192) + L(90, 176, 90, 192) + L(140, 176, 140, 192);
  o += L(280, 176, 280, 180) + L(280, 180, 140, 180) + L(140, 180, 140, 192);
  o += L(230, 176, 230, 184) + L(230, 184, 90, 184) + L(90, 184, 90, 192);
  o += L(180, 176, 180, 188) + L(180, 188, 40, 188) + L(40, 188, 40, 192);
  o += ckDot(40, 192) + ckDot(90, 192) + ckDot(140, 192);
  // FR + 电机
  o += X.map(x => ckPut(x, 192, CB.frh())).join('') + ckLab(X[0] - 13, 220, 'FR', 11, 'end');
  o += ckMtr(90, 284, 38);
  o += L(40, 240, 40, 246) + L(40, 246, 63, 257) + L(90, 240, 90, 246) + L(140, 240, 140, 246) + L(140, 246, 117, 257);
  // 控制电路（电气互锁，A 正向兼公共、B 反向）
  const A = 330, A2 = 380, B = 440, B2 = 490;
  o += ckDot(A, 14, 3) + L(A, 14, A, 16);
  o += ckPut(A, 16, CB.fu()) + ckLab(A + 13, 44, 'FU2');
  o += ckPut(A, 64, CB.frnc()) + ckLab(A + 16, 92, 'FR');
  o += ckPut(A, 112, CB.sbnc()) + ckLab(A + 16, 140, 'SB1');
  o += L(A, 160, B, 160);
  // 正向支路
  o += ckPut(A, 160, CB.sbno()) + ckLab(A - 17, 188, 'SB2', 11, 'end');
  o += ckPut(A2, 160, CB.no(20)) + ckLab(A2 + 15, 188, 'KM1');
  o += ckBranch(A, A2, 160, 208);
  o += ckPut(A, 208, CB.nc(20)) + ckLab(A - 17, 236, 'KM2', 11, 'end');
  o += ckPut(A, 256, CB.coil()) + ckLab(A + 16, 284, 'KM1');
  // 反向支路
  o += ckPut(B, 160, CB.sbno()) + ckLab(B + 16, 188, 'SB3');
  o += ckPut(B2, 160, CB.no(20)) + ckLab(B2 + 15, 188, 'KM2');
  o += ckBranch(B, B2, 160, 208);
  o += ckPut(B, 208, CB.nc(20)) + ckLab(B + 16, 236, 'KM1');
  o += ckPut(B, 256, CB.coil()) + ckLab(B + 16, 284, 'KM2');
  // 汇合到 N
  o += L(A, 304, B, 304) + L(385, 304, 385, 312) + ckDot(385, 304) + ckDot(385, 312, 3) + ckLab(395, 316, 'N');
  return ['-14 -8 554 338', o];
}

// 3）双重互锁正反转（教材图 2-6）：在电气互锁上再串按钮互锁常闭
function ckRev2() {
  const X = [40, 90, 140], KX = [180, 230, 280];
  let o = ckFeed(X, 16, 64);
  o += X.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(X[0] - 13, 156, 'KM1', 11, 'end');
  o += KX.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(KX[2] + 13, 156, 'KM2');
  o += L(40, 112, 40, 128) + L(90, 112, 90, 128) + L(140, 112, 140, 128);
  o += L(40, 116, 280, 116) + L(280, 116, 280, 128) + ckDot(40, 116);
  o += L(90, 120, 230, 120) + L(230, 120, 230, 128) + ckDot(90, 120);
  o += L(140, 124, 180, 124) + L(180, 124, 180, 128) + ckDot(140, 124);
  o += L(40, 176, 40, 192) + L(90, 176, 90, 192) + L(140, 176, 140, 192);
  o += L(280, 176, 280, 180) + L(280, 180, 140, 180) + L(140, 180, 140, 192);
  o += L(230, 176, 230, 184) + L(230, 184, 90, 184) + L(90, 184, 90, 192);
  o += L(180, 176, 180, 188) + L(180, 188, 40, 188) + L(40, 188, 40, 192);
  o += ckDot(40, 192) + ckDot(90, 192) + ckDot(140, 192);
  o += X.map(x => ckPut(x, 192, CB.frh())).join('') + ckLab(X[0] - 13, 220, 'FR', 11, 'end');
  o += ckMtr(90, 284, 38);
  o += L(40, 240, 40, 246) + L(40, 246, 63, 257) + L(90, 240, 90, 246) + L(140, 240, 140, 246) + L(140, 246, 117, 257);
  // 控制电路（双重互锁）
  const A = 330, A2 = 380, B = 440, B2 = 490;
  o += ckDot(A, 14, 3) + L(A, 14, A, 16);
  o += ckPut(A, 16, CB.fu()) + ckLab(A + 13, 44, 'FU2');
  o += ckPut(A, 64, CB.frnc()) + ckLab(A + 16, 92, 'FR');
  o += ckPut(A, 112, CB.sbnc()) + ckLab(A + 16, 140, 'SB1');
  o += L(A, 160, B, 160);
  // 正向：SB2(NO)+自锁 → SB3常闭(按钮互锁) → KM2常闭(电气互锁) → KM1线圈
  o += ckPut(A, 160, CB.sbno()) + ckLab(A - 17, 188, 'SB2', 11, 'end');
  o += ckPut(A2, 160, CB.no(20)) + ckLab(A2 + 15, 188, 'KM1');
  o += ckBranch(A, A2, 160, 208);
  o += ckPut(A, 208, CB.sbnc()) + ckLab(A - 17, 236, 'SB3', 11, 'end');
  o += ckPut(A, 256, CB.nc(20)) + ckLab(A - 17, 284, 'KM2', 11, 'end');
  o += ckPut(A, 304, CB.coil()) + ckLab(A + 16, 332, 'KM1');
  // 反向：SB3(NO)+自锁 → SB2常闭(按钮互锁) → KM1常闭(电气互锁) → KM2线圈
  o += ckPut(B, 160, CB.sbno()) + ckLab(B + 16, 188, 'SB3');
  o += ckPut(B2, 160, CB.no(20)) + ckLab(B2 + 15, 188, 'KM2');
  o += ckBranch(B, B2, 160, 208);
  o += ckPut(B, 208, CB.sbnc()) + ckLab(B + 16, 236, 'SB2');
  o += ckPut(B, 256, CB.nc(20)) + ckLab(B + 16, 284, 'KM1');
  o += ckPut(B, 304, CB.coil()) + ckLab(B + 16, 332, 'KM2');
  o += L(A, 352, B, 352) + L(395, 352, 395, 360) + ckDot(395, 352) + ckDot(395, 360, 3) + ckLab(405, 364, 'N');
  return ['-14 -8 554 378', o];
}

// 4）按钮切换星三角降压起动（教材图 2-8）
function ckStar() {
  const X = [40, 90, 140], KX = [180, 230, 280];
  let o = ckFeed(X, 16, 64);
  // KM1（电源）在 X 列，KM2（三角形）在 KX 列
  o += X.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(X[0] - 13, 156, 'KM1', 11, 'end');
  o += KX.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(KX[2] + 13, 156, 'KM2');
  o += L(40, 112, 40, 128) + L(90, 112, 90, 128) + L(140, 112, 140, 128);
  o += L(40, 116, 180, 116) + L(180, 116, 180, 128) + ckDot(40, 116);
  o += L(90, 120, 230, 120) + L(230, 120, 230, 128) + ckDot(90, 120);
  o += L(140, 124, 280, 124) + L(280, 124, 280, 128) + ckDot(140, 124);
  // FR + 电机（圆形 M 3~：首端 U1/V1/W1 上进、末端 U2/V2/W2 下出）
  o += X.map(x => ckPut(x, 176, CB.frh())).join('') + ckLab(X[0] - 13, 204, 'FR', 11, 'end');
  o += ckMtr(90, 280, 46);
  o += L(40, 224, 40, 232) + L(90, 224, 90, 232) + L(140, 224, 140, 232);
  o += L(40, 232, 60, 245) + L(90, 232, 90, 234) + L(140, 232, 120, 245);
  o += [['U1', 40], ['V1', 90], ['W1', 140]].map(([t, x]) => ckLab(x - 14, 230, t, 11, 'end')).join('');
  o += L(60, 315, 40, 332) + L(90, 326, 90, 332) + L(120, 315, 140, 332);
  o += L(40, 332, 40, 368) + L(90, 332, 90, 368) + L(140, 332, 140, 368);
  o += [['U2', 40], ['V2', 90], ['W2', 140]].map(([t, x]) => ckLab(x - 14, 336, t, 11, 'end')).join('');
  // KM2 三角交叉（U 相→W2、V 相→U2、W 相→V2，三层错开、交越处不结点）
  o += L(180, 176, 180, 344) + L(180, 344, 140, 344) + ckDot(140, 344);
  o += L(230, 176, 230, 352) + L(230, 352, 40, 352) + ckDot(40, 352);
  o += L(280, 176, 280, 360) + L(280, 360, 90, 360) + ckDot(90, 360);
  // KM3 星形（短接末端）
  o += X.map(x => ckPut(x, 368, CB.km(20))).join('') + ckLab(X[0] - 13, 396, 'KM3', 11, 'end');
  o += L(40, 416, 140, 416);
  // 控制电路（按钮切换）
  const C = 340, L1c = 300, R = 440, R2 = 490;
  o += ckDot(C, 14, 3) + L(C, 14, C, 16);
  o += ckPut(C, 16, CB.fu()) + ckLab(C + 13, 44, 'FU2');
  o += ckPut(C, 64, CB.frnc()) + ckLab(C + 16, 92, 'FR');
  o += ckPut(C, 112, CB.sbnc()) + ckLab(C + 16, 140, 'SB1');
  o += ckPut(C, 160, CB.sbno()) + ckLab(C + 16, 188, 'SB2');
  // KM1 自锁（与 SB2 并联）
  o += ckPut(L1c, 160, CB.no(20)) + ckLab(L1c - 17, 188, 'KM1', 11, 'end');
  o += ckBranch(C, L1c, 160, 208);
  // node4（SB2 下）：左接 KM1 线圈、下接 KM3 支路
  o += L(C, 208, L1c, 208);
  o += ckPut(L1c, 208, CB.coil()) + ckLab(L1c - 17, 236, 'KM1', 11, 'end');
  // KM3 支路：KM2 常闭 → KM3 线圈
  o += ckPut(C, 208, CB.nc(20)) + ckLab(C + 16, 236, 'KM2');
  o += ckPut(C, 256, CB.coil()) + ckLab(C + 16, 284, 'KM3');
  // KM2 支路：SB3 → KM3 常闭 → KM2 线圈（自锁）
  o += L(C, 160, R, 160);
  o += ckPut(R, 160, CB.sbno()) + ckLab(R + 16, 188, 'SB3');
  o += ckPut(R2, 160, CB.no(20)) + ckLab(R2 + 15, 188, 'KM2');
  o += ckBranch(R, R2, 160, 208);
  o += ckPut(R, 208, CB.nc(20)) + ckLab(R + 16, 236, 'KM3');
  o += ckPut(R, 256, CB.coil()) + ckLab(R + 16, 284, 'KM2');
  // N 母线（各线圈下端汇合）
  o += L(L1c, 256, L1c, 304);
  o += L(L1c, 304, R, 304) + ckDot(L1c, 304) + ckDot(C, 304) + ckDot(R, 304);
  o += L(370, 304, 370, 312) + ckDot(370, 312, 3) + ckLab(380, 316, 'N');
  return ['-14 -8 554 436', o];
}

// 5）时间继电器星三角降压起动（教材图 2-11）
function ckStarT() {
  const X = [40, 90, 140], KX = [180, 230, 280];
  let o = ckFeed(X, 16, 64);
  o += X.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(X[0] - 13, 156, 'KM1', 11, 'end');
  o += KX.map(x => ckPut(x, 128, CB.km(20))).join('') + ckLab(KX[2] + 13, 156, 'KM2');
  o += L(40, 112, 40, 128) + L(90, 112, 90, 128) + L(140, 112, 140, 128);
  o += L(40, 116, 180, 116) + L(180, 116, 180, 128) + ckDot(40, 116);
  o += L(90, 120, 230, 120) + L(230, 120, 230, 128) + ckDot(90, 120);
  o += L(140, 124, 280, 124) + L(280, 124, 280, 128) + ckDot(140, 124);
  o += X.map(x => ckPut(x, 176, CB.frh())).join('') + ckLab(X[0] - 13, 204, 'FR', 11, 'end');
  o += ckMtr(90, 280, 46);
  o += L(40, 224, 40, 232) + L(90, 224, 90, 232) + L(140, 224, 140, 232);
  o += L(40, 232, 60, 245) + L(90, 232, 90, 234) + L(140, 232, 120, 245);
  o += [['U1', 40], ['V1', 90], ['W1', 140]].map(([t, x]) => ckLab(x - 14, 230, t, 11, 'end')).join('');
  o += L(60, 315, 40, 332) + L(90, 326, 90, 332) + L(120, 315, 140, 332);
  o += L(40, 332, 40, 368) + L(90, 332, 90, 368) + L(140, 332, 140, 368);
  o += [['U2', 40], ['V2', 90], ['W2', 140]].map(([t, x]) => ckLab(x - 14, 336, t, 11, 'end')).join('');
  o += L(180, 176, 180, 344) + L(180, 344, 140, 344) + ckDot(140, 344);
  o += L(230, 176, 230, 352) + L(230, 352, 40, 352) + ckDot(40, 352);
  o += L(280, 176, 280, 360) + L(280, 360, 90, 360) + ckDot(90, 360);
  o += X.map(x => ckPut(x, 368, CB.km(20))).join('') + ckLab(X[0] - 13, 396, 'KM3', 11, 'end');
  o += L(40, 416, 140, 416);
  // 控制电路（时间继电器自动切换）
  const A = 340, A2 = 390, B = 450, B2 = 500, Cc = 560, C2 = 610;
  o += ckDot(A, 14, 3) + L(A, 14, A, 16);
  o += ckPut(A, 16, CB.fu()) + ckLab(A + 13, 44, 'FU2');
  o += ckPut(A, 64, CB.frnc()) + ckLab(A + 16, 92, 'FR');
  o += ckPut(A, 112, CB.sbnc()) + ckLab(A + 16, 140, 'SB1');
  o += ckPut(A, 160, CB.sbno()) + ckLab(A + 16, 188, 'SB2');
  o += ckPut(A2, 160, CB.no(20)) + ckLab(A2 + 15, 188, 'KM1');
  o += ckBranch(A, A2, 160, 208);
  // node4 母线（SB2 下，向右送到各支路）
  o += L(A, 208, Cc, 208) + ckDot(A2, 208) + ckDot(B2, 208);
  // KM1 线圈（自锁）
  o += L(A, 208, A, 304) + ckPut(A, 304, CB.coil()) + ckLab(A + 16, 332, 'KM1');
  // 三角形支路：KT延时闭合 ∥ KM2自锁 → KM3常闭 → KM2线圈
  o += ckPut(B, 208, CB.ktno()) + ckLab(B - 17, 236, 'KT', 11, 'end');
  o += ckPut(B2, 208, CB.no(20)) + ckLab(B2 + 15, 236, 'KM2');
  o += ckBranch(B, B2, 208, 256);
  o += ckPut(B, 256, CB.nc(20)) + ckLab(B - 17, 284, 'KM3', 11, 'end');
  o += ckPut(B, 304, CB.coil()) + ckLab(B + 16, 332, 'KM2');
  // 星形支路：KM2常闭 → KT线圈；→ KT延时断开 → KM3线圈
  o += ckPut(Cc, 208, CB.nc(20)) + ckLab(Cc + 16, 236, 'KM2');
  o += L(Cc, 256, C2, 256) + ckDot(Cc, 256) + L(Cc, 256, Cc, 304);
  o += ckPut(Cc, 304, CB.ktc()) + ckLab(Cc + 16, 332, 'KT');
  o += ckPut(C2, 256, CB.ktnc()) + ckLab(C2 + 16, 284, 'KT');
  o += ckPut(C2, 304, CB.coil()) + ckLab(C2 + 16, 332, 'KM3');
  // N 母线
  o += L(A, 352, C2, 352) + L(475, 352, 475, 360) + ckDot(475, 352) + ckDot(475, 360, 3) + ckLab(485, 364, 'N');
  return ['-14 -8 674 436', o];
}

// 6）双速电动机控制（教材图 2-13）
function ckDual() {
  const X = [40, 90, 140], KX = [180, 230, 280];
  let o = ckFeed(X, 16, 64);
  // FR（接触器前）在 X 列
  o += X.map(x => ckPut(x, 112, CB.frh())).join('') + ckLab(X[0] - 13, 140, 'FR', 11, 'end');
  // KM1（低速）在 X 列，KM2（高速换相）在 KX 列
  o += X.map(x => ckPut(x, 176, CB.km(20))).join('') + ckLab(X[0] - 13, 204, 'KM1', 11, 'end');
  o += KX.map(x => ckPut(x, 176, CB.km(20))).join('') + ckLab(KX[2] + 13, 204, 'KM2');
  o += L(40, 160, 40, 176) + L(90, 160, 90, 176) + L(140, 160, 140, 176);
  // KM2 进线换相（L1→180、L3→230、L2→280，相序对调保转向）
  o += L(40, 164, 180, 164) + L(180, 164, 180, 176) + ckDot(40, 164);
  o += L(140, 168, 230, 168) + L(230, 168, 230, 176) + ckDot(140, 168);
  o += L(90, 172, 280, 172) + L(280, 172, 280, 176) + ckDot(90, 172);
  // 绕组（首端 U1/V1/W1，末端 U2/V2/W2）
  o += X.map(x => ckWind(x, 232, 280)).join('');
  o += [['U1', 40, 232], ['V1', 90, 232], ['W1', 140, 232]].map(([t, x, y]) => ckLab(x - 14, y + 4, t, 11, 'end')).join('');
  o += [['U2', 40, 280], ['V2', 90, 280], ['W2', 140, 280]].map(([t, x, y]) => ckLab(x - 14, y + 4, t, 11, 'end')).join('');
  // KM1 出线到首端
  o += L(40, 224, 40, 232) + L(90, 224, 90, 232) + L(140, 224, 140, 232);
  // KM3（短接首端成星点）：首端经间隙引到下方触点，下端汇成星点
  o += L(40, 232, 65, 232) + L(65, 232, 65, 240) + ckDot(40, 232);
  o += L(90, 232, 115, 232) + L(115, 232, 115, 240) + ckDot(90, 232);
  o += L(140, 232, 165, 232) + L(165, 232, 165, 240) + ckDot(140, 232);
  o += ckPut(65, 240, CB.km(20)) + ckPut(115, 240, CB.km(20)) + ckPut(165, 240, CB.km(20));
  o += L(65, 288, 165, 288) + ckDot(65, 288) + ckDot(115, 288) + ckDot(165, 288);
  o += ckLab(165 + 13, 268, 'KM3');
  // KM2 出线到末端（换相：180→U2、230→V2、280→W2）
  o += L(180, 224, 180, 296) + L(180, 296, 40, 296) + L(40, 296, 40, 280) + ckDot(40, 280);
  o += L(230, 224, 230, 304) + L(230, 304, 90, 304) + L(90, 304, 90, 280) + ckDot(90, 280);
  o += L(280, 224, 280, 312) + L(280, 312, 140, 312) + L(140, 312, 140, 280) + ckDot(140, 280);
  // 电机符号（圆形 M 3~，画在底部；星点经 KM3 短接条引下）
  o += L(115, 288, 115, 330) + L(115, 330, 90, 330) + ckMtr(90, 356, 26);
  // 控制电路（双速：SB2 低速、SB3 高速）
  const A = 340, A2 = 390, B = 450, B2 = 500, C = 560;
  o += ckDot(A, 14, 3) + L(A, 14, A, 16);
  o += ckPut(A, 16, CB.fu()) + ckLab(A + 13, 44, 'FU2');
  o += ckPut(A, 64, CB.frnc()) + ckLab(A + 16, 92, 'FR');
  o += ckPut(A, 112, CB.sbnc()) + ckLab(A + 16, 140, 'SB1');
  o += L(A, 160, B, 160);
  // 低速支路：SB2(NO)+自锁 → KM2常闭 → KM3常闭 → KM1线圈
  o += ckPut(A, 160, CB.sbno()) + ckLab(A - 17, 188, 'SB2', 11, 'end');
  o += ckPut(A2, 160, CB.no(20)) + ckLab(A2 + 15, 188, 'KM1');
  o += ckBranch(A, A2, 160, 208);
  o += ckPut(A, 208, CB.nc(20)) + ckLab(A - 17, 236, 'KM2', 11, 'end');
  o += ckPut(A, 256, CB.nc(20)) + ckLab(A - 17, 284, 'KM3', 11, 'end');
  o += ckPut(A, 304, CB.coil()) + ckLab(A + 16, 332, 'KM1');
  // 高速支路：SB3(NO)+自锁 → KM1常闭 → KM2线圈 ∥ KM3线圈
  o += ckPut(B, 160, CB.sbno()) + ckLab(B + 16, 188, 'SB3');
  o += ckPut(B2, 160, CB.no(20)) + ckLab(B2 + 15, 188, 'KM2');
  o += ckBranch(B, B2, 160, 208);
  o += ckPut(B, 208, CB.nc(20)) + ckLab(B + 16, 236, 'KM1');
  o += ckPut(B, 256, CB.coil()) + ckLab(B + 16, 284, 'KM2');
  o += L(B, 256, C, 256) + ckDot(B, 256);
  o += ckPut(C, 256, CB.coil()) + ckLab(C + 16, 284, 'KM3');
  // N 母线（A 的线圈下端在 352，B/C 的线圈下端在 304 —— 必须各补一根竖线接到母线，
  // 原来只画了横线，B、C 两路线圈下端悬空、不接地，图上看着 N 母线右边孤零零一条）
  o += L(B, 304, B, 352) + L(C, 304, C, 352);
  o += L(A, 352, C, 352) + ckDot(A, 352) + ckDot(B, 352) + ckDot(C, 352);
  o += L(450, 352, 450, 360) + ckDot(450, 360, 3) + ckLab(460, 364, 'N');
  return ['-14 -8 634 400', o];
}

Object.assign(SYM, {
  ckt_single: [...ckSingle(), '单向起动电路原理图', [520, 300]],
  ckt_rev: [...ckRev(), '电气互锁正反转电路原理图', [520, 300]],
  ckt_rev2: [...ckRev2(), '双重互锁正反转电路原理图', [520, 300]],
  ckt_star: [...ckStar(), '按钮切换星三角降压起动电路原理图', [520, 300]],
  ckt_star_t: [...ckStarT(), '时间继电器星三角降压起动电路原理图', [520, 300]],
  ckt_dual: [...ckDual(), '双速电动机控制电路原理图', [520, 300]],
});

export const hasFig = name => Object.hasOwn(SYM, name);
export const figName = name => hasFig(name) ? SYM[name][2] : '';
// big：题干里的大图；否则是选项里的小图
export function figSvg(name, big) {
  if (!hasFig(name)) return '';
  const [vb, body, , size] = SYM[name], [, , w, h] = vb.split(' ').map(Number), H = size ? size[big ? 0 : 1] : big ? Math.min(150, h * 1.6) : 64;
  return `<svg viewBox="${vb}" width="${Math.round(H * w / h)}" height="${H}" role="img" aria-label="图" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:block;max-width:100%;height:auto">${body}</svg>`;
}
