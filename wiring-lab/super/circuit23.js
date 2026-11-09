// 项目 2.3 三相笼型异步电动机双重互锁正反转控制电路：接线练习页用的实物板、原理图和答案（按教材图 2-6、图 2-7）
// 主电路和 2.2 相同（KM2 出线换相）。控制电路在电气互锁之外加了按钮互锁：SB2、SB3 是复合按钮（常闭 + 常开机械联动），
// 正转时直接按 SB3，SB3 常闭先断开 KM1 支路，常开再接通 KM2 支路，不用先按停止。
// 端子分配按图 2-7：SB1 常闭 2-3；SB2 常闭 3-7、常开 4-5；SB3 常闭 3-4、常开 7-8；
// KM1 自锁常开 4-5、互锁常闭 8-9、线圈 6-N；KM2 自锁常开 7-8、互锁常闭 5-6、线圈 9-N。
// 实训室做法同 2.2：空开进线由实训台供电不接线；主电路接到 FR 进线端为止；按钮直接接线，不经端子排；线圈零线从 QF 的 N 取。

// ---------- 实物板 ----------
const TP = {};
QF_POLES.forEach((p, i) => { TP['QF.t' + i] = [870 + 60 * i, 162]; TP['QF.b' + i] = [870 + 60 * i, 288]; });
for (let i = 0; i < 3; i++) {
  TP['FU1.t' + i] = [1170 + 70 * i, 162]; TP['FU1.b' + i] = [1170 + 70 * i, 288];
  TP['FR.t' + i] = [885 + 40 * i, 812]; TP['FR.b' + i] = [885 + 40 * i, 918];
}
TP['FU2.t'] = [1400, 162]; TP['FU2.b'] = [1400, 288];
TP['FR.t4'] = [1045, 812]; TP['FR.b4'] = [1045, 918];
for (let c = 0; c < 6; c++) {
  TP['KM1.t' + c] = [885 + 40 * c, 502]; TP['KM1.b' + c] = [885 + 40 * c, 662];
  TP['KM2.t' + c] = [1325 + 40 * c, 502]; TP['KM2.b' + c] = [1325 + 40 * c, 662];
}
// 按钮：x、颜色、名称、是否复合按钮。SB1 只用常闭（2 个端子）；SB2、SB3 复合（4 个端子：常闭入/出、常开入/出）
const BTN = { SB1: [1540, '#ef4444', '停止'], SB2: [1670, '#22c55e', '正转', true], SB3: [1800, '#22c55e', '反转', true] };
for (const k in BTN) {
  const x = BTN[k][0];
  if (BTN[k][3]) { TP[k + '.ci'] = [x - 45, 270]; TP[k + '.co'] = [x - 15, 270]; TP[k + '.ai'] = [x + 15, 270]; TP[k + '.ao'] = [x + 45, 270]; }
  else { TP[k + '.i'] = [x - 26, 270]; TP[k + '.o'] = [x + 26, 270]; }
}

function termName(k) {
  const [d, t] = k.split('.'), i = +t.slice(1), top = t[0] === 't';
  if (d === 'QF') return `QF ${top ? '进线' : '出线'} ${QF_POLES[i]}`;
  if (d === 'FU1') return `FU1 ${top ? '进线' : '出线'}`;
  if (d === 'FU2') return `FU2 ${top ? '进线' : '出线'}`;
  if (d === 'FR') return i === 4 ? `FR 常闭 ${top ? '95' : '96'}` : `FR 进线 ${['1/L1', '3/L2', '5/L3'][i]}`;
  if (/^KM/.test(d)) {
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `${d} ${i < 3 ? (top ? '主触点进线 ' : '主触点出线 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return { i: `${d} 入口`, o: `${d} 出口`, ci: `${d} 常闭入口`, co: `${d} 常闭出口`, ai: `${d} 常开入口`, ao: `${d} 常开出口` }[t];
  return k;
}

// 导线（教材顺序：先主电路，再控制电路 1～9 号线，最后零线）。共 32 根
const BW = [];
const bw = (id, net, a, b, pts, sch) => BW.push({ id, net, a, b, pts, sch });
bw('U11', 'U11', 'QF.b0', 'FU1.t0', [[870, 288], [870, 340], [1146, 340], [1146, 134], [1170, 134], [1170, 162]], ['w110']);
bw('V11', 'V11', 'QF.b1', 'FU1.t1', [[930, 288], [930, 330], [1138, 330], [1138, 126], [1240, 126], [1240, 162]], ['w111']);
bw('W11', 'W11', 'QF.b2', 'FU1.t2', [[990, 288], [990, 320], [1130, 320], [1130, 118], [1310, 118], [1310, 162]], ['w112']);
bw('W11c', 'W11', 'FU1.t2', 'FU2.t', [[1316, 162], [1316, 144], [1400, 144], [1400, 162]], ['wW11']);
bw('U12a', 'U12', 'FU1.b0', 'KM1.t0', [[1170, 288], [1170, 370], [885, 370], [885, 502]], ['w120', 'wk10']);
bw('V12a', 'V12', 'FU1.b1', 'KM1.t1', [[1240, 288], [1240, 380], [925, 380], [925, 502]], ['w121', 'wk11']);
bw('W12a', 'W12', 'FU1.b2', 'KM1.t2', [[1310, 288], [1310, 390], [965, 390], [965, 502]], ['w122', 'wk12']);
bw('U12b', 'U12', 'KM1.t0', 'KM2.t0', [[891, 502], [891, 410], [1325, 410], [1325, 502]], ['wtap0']);
bw('V12b', 'V12', 'KM1.t1', 'KM2.t1', [[931, 502], [931, 418], [1365, 418], [1365, 502]], ['wtap1']);
bw('W12b', 'W12', 'KM1.t2', 'KM2.t2', [[971, 502], [971, 426], [1405, 426], [1405, 502]], ['wtap2']);
bw('U13a', 'U13', 'KM1.b0', 'FR.t0', [[885, 662], [885, 812]], ['wk1b0', 'wm0']);
bw('V13a', 'V13', 'KM1.b1', 'FR.t1', [[925, 662], [925, 812]], ['wk1b1', 'wm1']);
bw('W13a', 'W13', 'KM1.b2', 'FR.t2', [[965, 662], [965, 812]], ['wk1b2', 'wm2']);
bw('W13b', 'W13', 'KM2.b0', 'FR.t2', [[1325, 662], [1325, 770], [971, 770], [971, 812]], ['wk2b0', 'wm2']);
bw('V13b', 'V13', 'KM2.b1', 'FR.t1', [[1365, 662], [1365, 762], [931, 762], [931, 812]], ['wk2b1', 'wm1']);
bw('U13b', 'U13', 'KM2.b2', 'FR.t0', [[1405, 662], [1405, 754], [891, 754], [891, 812]], ['wk2b2', 'wm0']);
bw('c1', '1', 'FU2.b', 'FR.t4', [[1400, 288], [1400, 310], [1600, 310], [1600, 790], [1045, 790], [1045, 812]], ['w1']);
bw('c2', '2', 'FR.b4', 'SB1.i', [[1045, 918], [1045, 945], [1580, 945], [1580, 300], [1514, 300], [1514, 270]], ['w2']);
bw('b3a', '3', 'SB1.o', 'SB2.ci', [[1566, 270], [1566, 286], [1625, 286], [1625, 270]], ['w3', 'w3b', 'w3s2']);
bw('b3b', '3', 'SB2.ci', 'SB3.ci', [[1631, 270], [1631, 294], [1755, 294], [1755, 270]], ['w3s3']);
bw('b4a', '4', 'SB3.co', 'SB2.ai', [[1785, 270], [1785, 302], [1685, 302], [1685, 270]], ['w4', 'w4s2']);
bw('c4', '4', 'SB2.ai', 'KM1.t3', [[1691, 270], [1691, 446], [1005, 446], [1005, 502]], ['w4b', 'w4k1']);
bw('c5', '5', 'SB2.ao', 'KM2.t4', [[1715, 270], [1715, 286], [1715, 386], [1485, 386], [1485, 486], [1485, 502]], ['w5s2', 'w5']);
bw('c5b', '5', 'KM2.t4', 'KM1.b3', [[1485, 502], [1485, 479], [1119, 479], [1119, 685], [1005, 685], [1005, 662]], ['w5k1']);
bw('c6', '6', 'KM2.b4', 'KM1.t5', [[1485, 662], [1485, 692], [1128, 692], [1128, 460], [1085, 460], [1085, 502]], ['w6']);
bw('b7a', '7', 'SB2.co', 'SB3.ai', [[1655, 270], [1655, 310], [1815, 310], [1815, 270]], ['w7', 'w7s3']);
bw('c7', '7', 'SB3.ai', 'KM2.t3', [[1821, 270], [1821, 456], [1445, 456], [1445, 502]], ['w7b', 'w7k2']);
bw('c8', '8', 'SB3.ao', 'KM2.b3', [[1845, 270], [1845, 716], [1445, 716], [1445, 662]], ['w8s3', 'w8k2']);
bw('c8b', '8', 'KM2.b3', 'KM1.t4', [[1445, 662], [1445, 699], [1137, 699], [1137, 465], [1045, 465], [1045, 502]], ['w8']);
bw('c9', '9', 'KM1.b4', 'KM2.t5', [[1045, 662], [1045, 706], [1146, 706], [1146, 458], [1525, 458], [1525, 502]], ['w9']);
bw('cNa', 'N', 'QF.b3', 'KM1.b5', [[1050, 288], [1050, 302], [824, 302], [824, 726], [1091, 726], [1091, 662]], ['wN', 'wNA']);
bw('cNb', 'N', 'KM1.b5', 'KM2.b5', [[1079, 662], [1079, 734], [1525, 734], [1525, 662]], ['wNB']);
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路：导线 + 元件内部的通断
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) {
  BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i });
  BE.push({ id: 'FR' + i, a: 'FR.t' + i, b: 'FR.b' + i });
  BE.push({ id: 'M' + i, a: 'FR.b' + i, b: 'S', load: true });
}
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FRnc', a: 'FR.t4', b: 'FR.b4', on: s => !s.FR });
for (const n of [1, 2]) {
  const k = 'KM' + n, on = s => s['km' + n];
  for (let c = 0; c < 3; c++) BE.push({ id: k + 'm' + c, a: k + '.t' + c, b: k + '.b' + c, on });
  BE.push({ id: k + 'no', a: k + '.t3', b: k + '.b3', on }, { id: k + 'nc', a: k + '.t4', b: k + '.b4', on: s => !on(s) });
  BE.push({ id: k + 'coil', a: k + '.t5', b: k + '.b5', load: true });
}
BE.push({ id: 'SB1', a: 'SB1.i', b: 'SB1.o', on: s => !s.SB1 });
for (const k of ['SB2', 'SB3']) BE.push({ id: k + 'nc', a: k + '.ci', b: k + '.co', on: s => !s[k] }, { id: k + 'no', a: k + '.ai', b: k + '.ao', on: s => s[k] });

// ---------- 原理图（按教材图 2-6 版面重画；设计坐标 1000×720）----------
const SCH = { x: 34, y: 112, s: 0.74 };
const X = [70, 140, 210], KX = [320, 390, 460], JY = [255, 275, 295], MY = [440, 460, 480];
const A = 660, A2 = 740, B = 880, B2 = 960;
const P = i => 'UVW'[i];
const SE = [];
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
// 主电路（同 2.2）
for (let i = 0; i < 3; i++) {
  const x = X[i], kx = KX[i], p = P(i), j = 2 - i;
  w('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  el('QF' + i, 'qf', x, 70, 120, 'qa' + i, p + '11', s => s.QF);
  w('w11' + i, p + '11', [[x, 120], [x, 160]], p + '11', 'fa' + i);
  el('FU1' + i, 'fuse', x, 160, 215, 'fa' + i, 'fb' + i);
  w('w12' + i, p + '12', [[x, 215], [x, JY[i]]], 'fb' + i, 'j' + i);
  w('wk1' + i, p + '12', [[x, JY[i]], [x, 330]], 'j' + i, 'k1a' + i);
  w('wtap' + i, p + '12', [[x, JY[i]], [kx, JY[i]], [kx, 330]], 'j' + i, 'k2a' + i);
  el('KM1' + i, 'km', x, 330, 385, 'k1a' + i, 'k1b' + i, s => s.km1);
  el('KM2' + i, 'km', kx, 330, 385, 'k2a' + i, 'k2b' + i, s => s.km2);
  w('wk1b' + i, p + '13', [[x, 385], [x, MY[j]]], 'k1b' + i, 'm' + i);
  w('wk2b' + i, P(j) + '13', [[kx, 385], [kx, MY[i]], [X[j], MY[i]]], 'k2b' + i, 'm' + j);
  w('wm' + i, p + '13', [[x, MY[j]], [x, 520]], 'm' + i, 'h' + i);
  el('FRh' + i, 'heat', x, 520, 565, 'h' + i, 'hb' + i);
  const mt = [[110, 626], [140, 618], [170, 626]][i];
  w('wo' + i, p, [[x, 565], [x, 595], mt], 'hb' + i, 'mt' + i);
  SE.push({ id: 'MW' + i, kind: 'none', a: 'mt' + i, b: 'S', load: true, pts: [mt, [140, 670]] });
}
// 控制电路
w('wW11', 'W11', [[580, 40], [600, 40]], 'W11', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 600, x2: 650, y: 40, a: 'f2a', b: 'f2b', pts: [[600, 40], [650, 40]] });
w('w1', '1', [[650, 40], [A, 40], [A, 80]], 'f2b', 'n1');
el('FR_NC', 'nc', A, 80, 125, 'n1', 'n2', s => !s.FR);
w('w2', '2', [[A, 125], [A, 165]], 'n2', 's1a');
el('SB1', 'bnc', A, 165, 210, 's1a', 'n3', s => !s.SB1);
w('w3', '3', [[A, 210], [A, 250]], 'n3', 'b3A');
w('w3b', '3', [[A, 250], [B, 250]], 'b3A', 'b3B');
// 正转支路：3 → SB3 常闭 → 4 → (SB2 常开 ∥ KM1 自锁) → 5 → KM2 常闭 → 6 → KM1 线圈
w('w3s3', '3', [[A, 250], [A, 270]], 'b3A', 'sb3c');
el('SB3_NC', 'bnc', A, 270, 315, 'sb3c', 'n4', s => !s.SB3);
w('w4', '4', [[A, 315], [A, 340]], 'n4', 'j4');
w('w4s2', '4', [[A, 340], [A, 350]], 'j4', 'sb2a');
el('SB2_NO', 'bno', A, 350, 395, 'sb2a', 'sb2b', s => s.SB2);
w('w5s2', '5', [[A, 395], [A, 420]], 'sb2b', 'j5');
w('w4b', '4', [[A, 340], [A2, 340]], 'j4', 'j4b');
w('w4k1', '4', [[A2, 340], [A2, 350]], 'j4b', 'k1na');
el('KM1_NO', 'no', A2, 350, 395, 'k1na', 'k1nb', s => s.km1);
w('w5k1', '5', [[A2, 395], [A2, 420], [A, 420]], 'k1nb', 'j5');
w('w5', '5', [[A, 420], [A, 440]], 'j5', 'nc2a');
el('KM2_NC', 'nc', A, 440, 485, 'nc2a', 'nc2b', s => !s.km2);
w('w6', '6', [[A, 485], [A, 520]], 'nc2b', 'c1a');
el('KM1_coil', 'coil', A, 520, 560, 'c1a', 'c1b', null, { load: true });
w('wNA', 'N', [[A, 560], [A, 620]], 'c1b', 'nA');
// 反转支路：3 → SB2 常闭 → 7 → (SB3 常开 ∥ KM2 自锁) → 8 → KM1 常闭 → 9 → KM2 线圈
w('w3s2', '3', [[B, 250], [B, 270]], 'b3B', 'sb2c');
el('SB2_NC', 'bnc', B, 270, 315, 'sb2c', 'n7', s => !s.SB2);
w('w7', '7', [[B, 315], [B, 340]], 'n7', 'j7');
w('w7s3', '7', [[B, 340], [B, 350]], 'j7', 'sb3a');
el('SB3_NO', 'bno', B, 350, 395, 'sb3a', 'sb3b', s => s.SB3);
w('w8s3', '8', [[B, 395], [B, 420]], 'sb3b', 'j8');
w('w7b', '7', [[B, 340], [B2, 340]], 'j7', 'j7b');
w('w7k2', '7', [[B2, 340], [B2, 350]], 'j7b', 'k2na');
el('KM2_NO', 'no', B2, 350, 395, 'k2na', 'k2nb', s => s.km2);
w('w8k2', '8', [[B2, 395], [B2, 420], [B, 420]], 'k2nb', 'j8');
w('w8', '8', [[B, 420], [B, 440]], 'j8', 'nc1a');
el('KM1_NC', 'nc', B, 440, 485, 'nc1a', 'nc1b', s => !s.km1);
w('w9', '9', [[B, 485], [B, 520]], 'nc1b', 'c2a');
el('KM2_coil', 'coil', B, 520, 560, 'c2a', 'c2b', null, { load: true });
w('wNB', 'N', [[B, 560], [B, 620], [A, 620]], 'c2b', 'nA');
w('wN', 'N', [[A, 620], [590, 620]], 'nA', 'N');
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
const EDGE_T = {}, EDGE_COL = {};
function schSolve(s) {
  return solve('sch23', SE, s, s.QF ? ['L1', 'L2', 'L3', 'W11'] : ['L1', 'L2', 'L3'], ['S', 'N'], [s.QF, s.SB1, s.SB2, s.SB3, s.FR, s.km1, s.km2].join(''));
}
function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil', 'KM2_coil'].filter(id => R.cur.has(id)));
  g.save(); g.translate(SCH.x, SCH.y); g.scale(SCH.s, SCH.s);
  const colorOf = e => EDGE_T[e.id] !== undefined && t >= EDGE_T[e.id] ? (EDGE_COL[e.id] || netColor(e.net)) : C.ink;
  for (const e of SE) if (e.kind !== 'none' && R.act.has(e.id) && R.pot.has(e.a) && R.pot.has(e.b) && !R.cur.has(e.id) && !e.load) poly(e.pts, '#fdba74', 9);
  for (const e of SE) {
    if (e.kind === 'none') continue;
    if (e.kind === 'w') { if (C.wireEdge && colorOf(e) !== C.ink) poly(e.pts, C.wireEdge, 5.5); poly(e.pts, colorOf(e), 3); } else symbol(e, C.ink, s);
    const on = R.cur.has(e.id);
    if (on && e.kind === 'w') flow(e.pts, 3, t);
    if (on && e.kind !== 'w') { g.save(); g.globalAlpha = 0.85; g.shadowColor = C.cur; g.shadowBlur = 18; symbol(e, C.cur, s); g.restore(); }
  }
  for (const e of SE) if (e.kind === 'w' && e.pts.length > 2 && /^(wtap|wk2b)/.test(e.id)) dot(e.pts[0][0], e.pts[0][1], 4.5, C.ink);
  [[X[0], JY[0]], [X[1], JY[1]], [X[2], JY[2]], [X[2], MY[0]], [X[1], MY[1]], [X[0], MY[2]], [A, 250], [A, 340], [A, 420], [B, 340], [B, 420], [A, 620]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  // 复合按钮的机械联动：同一个按钮的常闭和常开用虚线连起来（SB2：右上常闭 ↔ 左下常开；SB3：左上常闭 ↔ 右下常开）
  const bx = (x, sw) => x - 37 + (sw ? 7 : 0);
  poly([[bx(B, s.SB2), 294], [bx(A, s.SB2) + 4, 374]], C.ink, 1.5, [6, 5]);
  poly([[bx(A, s.SB3), 294], [bx(B, s.SB3) + 4, 374]], C.ink, 1.5, [6, 5]);
  poly([[X[0] - 8, 95], [X[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  poly([[X[0] - 8, 360], [X[2] + 4, 360]], C.ink, 1.5, [6, 5]);
  poly([[KX[0] - 8, 360], [KX[2] + 4, 360]], C.ink, 1.5, [6, 5]);
  const run = Math.abs(s.w) > 0.05;
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.arc(140, 670, 52, 0, 7); g.fill(); g.stroke(); g.restore();
  text('M', 140, 656, 28, C.ink, 'center', 'bold'); text('3~', 140, 688, 20);
  poly([[188, 690], [240, 690], [240, 705]], C.ink, 2); poly([[226, 705], [254, 705]], C.ink, 2); poly([[231, 711], [249, 711]], C.ink, 2); poly([[236, 717], [244, 717]], C.ink, 2); text('PE', 262, 700, 18, C.ink, 'left');
  for (let i = 0; i < 3; i++) {
    text(PH[i], X[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(X[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
    text(P(i) + '11', X[i] + 6, 140, 15, C.dim, 'left'); text(P(i) + '12', X[i] + 6, 236, 15, C.dim, 'left');
    text(P(i) + '13', X[i] + 6, 502, 15, C.dim, 'left'); text(P(i), X[i] + 10, 582, 18, C.ink, 'left', 'bold');
  }
  text('QF', 245, 95, 20, C.ink, 'left', 'bold'); text('FU1', 245, 188, 20, C.ink, 'left', 'bold');
  text('KM1', 40, 357, 20, s.km1 ? C.cur : C.ink, 'right', 'bold'); text('KM2', 480, 357, 20, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('FR', 245, 542, 20, C.ink, 'left', 'bold');
  text('W11', 575, 40, 20, C.ink, 'right', 'bold'); text('FU2', 625, 16, 18, C.ink, 'center', 'bold');
  text('FR', A - 22, 100, 18, C.ink, 'right', 'bold'); text('SB1', A - 48, 186, 18, C.ink, 'right', 'bold');
  // 自锁触点的名字标在触点右下方，不和右边支路按钮的名字挤在一起
  text('SB3', A - 48, 292, 18, C.ink, 'right', 'bold'); text('SB2', A - 48, 372, 18, C.ink, 'right', 'bold'); text('KM1', A2 + 10, 408, 17, s.km1 ? C.cur : C.ink, 'left', 'bold');
  text('SB2', B - 48, 292, 18, C.ink, 'right', 'bold'); text('SB3', B - 48, 372, 18, C.ink, 'right', 'bold'); text('KM2', B2 + 10, 408, 17, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('KM2', A - 22, 462, 17, C.ink, 'right', 'bold'); text('KM1', B - 22, 462, 17, C.ink, 'right', 'bold');
  text('KM1', A + 34, 540, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('KM2', B + 34, 540, 20, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('N', 578, 620, 22, C.ink, 'right', 'bold');
  [['1', A, 62], ['2', A, 146], ['3', A, 232], ['4', A, 328], ['5', A, 430], ['6', A, 503], ['7', B, 328], ['8', B, 430], ['9', B, 503]].forEach(([n, x, y]) => text(n, x + 10, y, 16, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const CIRCUIT = {
  id: '2.3', key: 'zfz-practice-2.3', schW: 1015, // 原理图设计宽度（练习页按它自动缩放）
  title: '三相异步电动机 双重互锁正反转 · 接线练习',
  kms: ['KM1', 'KM2'], labels: {}, phaseSwap: ['KM2'], // KM2 任意两相对调都算对
  nEnd: [598, 620],
  lesson: {
    name: '三相笼型异步电动机双重互锁正反转控制电路的安装、接线与调试',
    goals: ['理解互锁的作用和实现方法（电气互锁 + 按钮互锁）', '识读三相笼型异步电动机双重互锁正反转控制电路的工作原理图', '完成其电路的安装、接线与调试'],
    tools: ['螺钉旋具', '试电笔', '剥线钳', '尖嘴钳', '钢丝钳', '万用表'],
    steps: ['识读电路图', '检测元器件', '安装元器件', '接线', '验收加分'],
    note: '实训室做法：空开进线由实训台供电，不接电动机和端子排；SB2、SB3 是复合按钮，起动必须接常开触点、互锁接常闭触点（可用万用表电阻档判别）；KM2 出线换相；每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上 QF：按 SB2 正转，不用停止直接按 SB3 换反转，按 SB1 停止；同时按 SB2 和 SB3 两个都不吸合。',
  runMsg: '空开已合闸，按 SB2 正转、直接按 SB3 换反转、SB1 停止（原理图同步发光）',
  answers: [
    { name: '教材图 2-7 接法', desc: '3号线 SB1→SB2常闭→SB3常闭；4号线 SB3常闭→SB2常开→KM1自锁；7号线 SB2常闭→SB3常开→KM2自锁', chains: {} },
    { name: '就近并接', desc: '主电路 KM2 出线换相后并到 KM1 出线；FU1 先接 KM2 再接 KM1；3号线 SB1 先接 SB3',
      chains: {
        W11: ['QF.b2', 'FU2.t', 'FU1.t2'],
        U12: ['FU1.b0', 'KM2.t0', 'KM1.t0'], V12: ['FU1.b1', 'KM2.t1', 'KM1.t1'], W12: ['FU1.b2', 'KM2.t2', 'KM1.t2'],
        U13: ['FR.t0', 'KM1.b0', 'KM2.b2'], V13: ['FR.t1', 'KM1.b1', 'KM2.b1'], W13: ['FR.t2', 'KM1.b2', 'KM2.b0'],
        3: ['SB1.o', 'SB3.ci', 'SB2.ci'], N: ['QF.b3', 'KM2.b5', 'KM1.b5'],
      } },
    { name: '入口出口法', desc: '自锁触点入口接上一个元件（按钮常闭）的出口，出口接下一个元件（对方常闭）的入口',
      chains: { 4: ['SB2.ai', 'SB3.co', 'KM1.t3'], 5: ['KM1.b3', 'KM2.t4', 'SB2.ao'], 7: ['SB3.ai', 'SB2.co', 'KM2.t3'], 8: ['KM2.b3', 'KM1.t4', 'SB3.ao'] } },
  ],
  groups: [
    { name: '主电路 · 电源分配', nets: ['W11'], why: 'QF 出线 L3（W11）要同时接 FU1 和控制熔断器 FU2：QF 出、FU1 入、FU2 入是同一个点，三个端子任意串接都对。' },
    { name: '主电路 · 进线并接', nets: ['U12', 'V12', 'W12'], why: 'FU1 出线同时送到 KM1、KM2 的主触点进线：FU1 出、KM1 入、KM2 入是同一个点。' },
    { name: '主电路 · 出线汇合（含换相）', nets: ['U13', 'V13', 'W13'], why: 'KM1 出线、KM2 出线和 FR 进线是同一个点。换相由 KM2 的哪个出线端子接到哪一相决定，和串接顺序无关。' },
    { name: '控制电路 · 按钮互锁起点（3号线）', nets: ['3'], why: 'SB1 出口 = SB3 常闭入口 = SB2 常闭入口：正、反两条支路都从这里分出，三个端子任意串接都对。' },
    { name: '控制电路 · 正转支路（4、5号线）', nets: ['4', '5'], why: '4号线 = SB3常闭 出 + SB2常开 入 + KM1自锁 入（并联起点）；5号线 = SB2常开 出 + KM1自锁 出 + KM2常闭 入（并联终点）。' },
    { name: '控制电路 · 反转支路（7、8号线）', nets: ['7', '8'], why: '7号线 = SB2常闭 出 + SB3常开 入 + KM2自锁 入；8号线 = SB3常开 出 + KM2自锁 出 + KM1常闭 入。' },
    { name: '零线', nets: ['N'], why: '从 QF 的 N 接到两个线圈的 A2，三个端子任意串接。' },
  ],
};
