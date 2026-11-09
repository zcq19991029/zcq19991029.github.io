// 项目 2.6 按钮切换的双速电动机电路：接线练习页用的实物板、原理图和答案（按教材图 2-13、图 2-16）
// 4/2 极 △/YY 双速电动机：KM1 闭合，电源接 U1、V1、W1，绕组接成三角形，低速（4 极）；
// KM2、KM3 闭合，电源接 U2、W2、V2（相序对调，保证转向不变），KM3 把 U1、V1、W1 短接成一点，绕组接成双星形，高速（2 极）。
// 端子分配按图 2-16：FR 在接触器前（U12→U13）；KM1 上端 U13/V13/W13、下端 U1/V1/W1，自锁 3-4、常闭 10-11、线圈 7-N；
// KM2 上端 U13/W13/V13、下端 U2/V2/W2，常闭 5-6、常开 8-9、线圈 11-N；KM3 两极上端都接 V1、下端接 U1/W1，常闭 6-7、常开 9-10、线圈 11-N；
// SB1 常闭 2-3；SB2 复合（常闭 3-8、常开 3-4）；SB3 复合（常闭 4-5、常开 8-10）。
// 实训室做法：不接端子排，按钮直接接线；电动机接线盒 6 个出线端。

// ---------- 实物板 ----------
const TP = {};
QF_POLES.forEach((p, i) => { TP['QF.t' + i] = [870 + 60 * i, 162]; TP['QF.b' + i] = [870 + 60 * i, 288]; });
for (let i = 0; i < 3; i++) {
  TP['FU1.t' + i] = [1170 + 70 * i, 162]; TP['FU1.b' + i] = [1170 + 70 * i, 288];
  TP['FR.t' + i] = [885 + 40 * i, 812]; TP['FR.b' + i] = [885 + 40 * i, 918];
}
TP['FU2.t'] = [1400, 162]; TP['FU2.b'] = [1400, 288];
TP['FR.t4'] = [1045, 812]; TP['FR.b4'] = [1045, 918];
const KMX = { KM1: 840, KM2: 1150, KM3: 1460 };
for (const k in KMX) for (let c = 0; c < 6; c++) { TP[k + '.t' + c] = [KMX[k] + 25 + 40 * c, 502]; TP[k + '.b' + c] = [KMX[k] + 25 + 40 * c, 662]; }
// 电动机接线盒：U1 V1 W1 | U2 V2 W2（一排，向上出线）
const MOT = ['U1', 'V1', 'W1', 'U2', 'V2', 'W2'];
[1190, 1228, 1266, 1314, 1352, 1390].forEach((x, i) => (TP['M.t' + i] = [x, 842]));
const BTN = { SB1: [1540, '#ef4444', '停止'], SB2: [1670, '#22c55e', '低速', true], SB3: [1800, '#f59e0b', '高速', true] };
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
  if (d === 'FR') return i === 4 ? `FR 常闭 ${top ? '95' : '96'}` : `FR ${top ? '进线 ' + ['1/L1', '3/L2', '5/L3'][i] : '出线 ' + ['2/T1', '4/T2', '6/T3'][i]}`;
  if (d === 'M') return `电动机 ${MOT[i]}`;
  if (/^KM/.test(d)) {
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `${d} ${i < 3 ? (top ? '主触点上端 ' : '主触点下端 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return { i: `${d} 入口`, o: `${d} 出口`, ci: `${d} 常闭入口`, co: `${d} 常闭出口`, ai: `${d} 常开入口`, ao: `${d} 常开出口` }[t];
  return k;
}

// 导线（教材顺序：主电路、电动机、控制电路 1～11 号线、零线）
const BW = [];
const bw = (id, net, a, b, pts, sch) => BW.push({ id, net, a, b, pts, sch });
bw('U11', 'U11', 'QF.b0', 'FU1.t0', [[870, 288], [870, 340], [1146, 340], [1146, 134], [1170, 134], [1170, 162]], ['w110']);
bw('V11', 'V11', 'QF.b1', 'FU1.t1', [[930, 288], [930, 330], [1138, 330], [1138, 126], [1240, 126], [1240, 162]], ['w111']);
bw('W11', 'W11', 'QF.b2', 'FU1.t2', [[990, 288], [990, 320], [1130, 320], [1130, 118], [1310, 118], [1310, 162]], ['w112']);
bw('W11c', 'W11', 'FU1.t2', 'FU2.t', [[1316, 162], [1316, 144], [1400, 144], [1400, 162]], ['wW11']);
bw('U12', 'U12', 'FU1.b0', 'FR.t0', [[1170, 288], [1170, 352], [1112, 352], [1112, 772], [885, 772], [885, 812]], ['w120']);
bw('V12', 'V12', 'FU1.b1', 'FR.t1', [[1240, 288], [1240, 360], [1124, 360], [1124, 780], [925, 780], [925, 812]], ['w121']);
bw('W12', 'W12', 'FU1.b2', 'FR.t2', [[1310, 288], [1310, 368], [1136, 368], [1136, 788], [965, 788], [965, 812]], ['w122']);
bw('U13a', 'U13', 'FR.b0', 'KM1.t0', [[885, 918], [885, 950], [816, 950], [816, 446], [865, 446], [865, 502]], ['w130', 'w13b0']);
bw('V13a', 'V13', 'FR.b1', 'KM1.t1', [[925, 918], [925, 942], [824, 942], [824, 454], [905, 454], [905, 502]], ['w131', 'w13b1']);
bw('W13a', 'W13', 'FR.b2', 'KM1.t2', [[965, 918], [965, 934], [832, 934], [832, 462], [945, 462], [945, 502]], ['w132', 'w13b2']);
bw('U13b', 'U13', 'KM1.t0', 'KM2.t0', [[871, 502], [871, 410], [1175, 410], [1175, 502]], ['wtap0']);
bw('V13b', 'V13', 'KM1.t1', 'KM2.t2', [[911, 502], [911, 418], [1255, 418], [1255, 502]], ['wtap1']);
bw('W13b', 'W13', 'KM1.t2', 'KM2.t1', [[951, 502], [951, 426], [1215, 426], [1215, 502]], ['wtap2']);
bw('U1a', 'U1', 'KM1.b0', 'M.t0', [[865, 662], [865, 706], [1190, 706], [1190, 842]], ['whA0', 'whB0']);
bw('V1a', 'V1', 'KM1.b1', 'M.t1', [[905, 662], [905, 698], [1228, 698], [1228, 842]], ['whA1', 'whB1']);
bw('W1a', 'W1', 'KM1.b2', 'M.t2', [[945, 662], [945, 690], [1266, 690], [1266, 842]], ['whA2', 'whB2']);
bw('U1b', 'U1', 'M.t0', 'KM3.b0', [[1196, 842], [1196, 738], [1485, 738], [1485, 662]], ['wk3u']);
bw('W1b', 'W1', 'M.t2', 'KM3.b1', [[1272, 842], [1272, 746], [1525, 746], [1525, 662]], ['wk3w']);
bw('V1b', 'V1', 'M.t1', 'KM3.t0', [[1234, 842], [1234, 754], [1452, 754], [1452, 470], [1485, 470], [1485, 502]], ['wk3v', 'wk3vA']);
bw('V1c', 'V1', 'KM3.t0', 'KM3.t1', [[1491, 502], [1491, 482], [1525, 482], [1525, 502]], ['wk3v2']);
bw('U2', 'U2', 'KM2.b0', 'M.t3', [[1175, 662], [1175, 770], [1314, 770], [1314, 842]], ['wd0']);
bw('V2', 'V2', 'KM2.b1', 'M.t4', [[1215, 662], [1215, 778], [1352, 778], [1352, 842]], ['wd1']);
bw('W2', 'W2', 'KM2.b2', 'M.t5', [[1255, 662], [1255, 786], [1390, 786], [1390, 842]], ['wd2']);
bw('c1', '1', 'FU2.b', 'FR.t4', [[1400, 288], [1400, 310], [1436, 310], [1436, 796], [1045, 796], [1045, 812]], ['w1']);
bw('c2', '2', 'FR.b4', 'SB1.i', [[1045, 918], [1045, 958], [1420, 958], [1420, 300], [1514, 300], [1514, 270]], ['w2']);
bw('b3a', '3', 'SB1.o', 'SB2.ci', [[1566, 270], [1566, 286], [1625, 286], [1625, 270]], ['w3', 'w3b', 'w3B']);
bw('b3b', '3', 'SB2.ci', 'SB2.ai', [[1631, 270], [1631, 294], [1685, 294], [1685, 270]], ['w3A']);
bw('c3', '3', 'SB2.ai', 'KM1.t3', [[1691, 270], [1691, 398], [985, 398], [985, 502]], ['w3k']);
bw('b4', '4', 'SB2.ao', 'SB3.ci', [[1715, 270], [1715, 302], [1755, 302], [1755, 270]], ['w4s', 'w4']);
bw('c4', '4', 'SB2.ao', 'KM1.b3', [[1721, 270], [1721, 434], [1740, 434], [1740, 714], [985, 714], [985, 662]], ['w4k']);
bw('c5', '5', 'SB3.co', 'KM2.t4', [[1785, 270], [1785, 286], [1785, 386], [1335, 386], [1335, 486], [1335, 502]], ['w5']);
bw('c6', '6', 'KM2.b4', 'KM3.t4', [[1335, 662], [1335, 685], [1409, 685], [1409, 431], [1645, 431], [1645, 502]], ['w6']);
bw('c7', '7', 'KM3.b4', 'KM1.t5', [[1645, 662], [1645, 692], [1144, 692], [1144, 472], [1065, 472], [1065, 502]], ['w7']);
bw('b8', '8', 'SB2.co', 'SB3.ai', [[1655, 270], [1655, 310], [1815, 310], [1815, 270]], ['w8', 'w8s']);
bw('c8', '8', 'SB3.ai', 'KM2.t3', [[1821, 270], [1821, 446], [1295, 446], [1295, 502]], ['w8b', 'w8k']);
bw('c9', '9', 'KM2.b3', 'KM3.t3', [[1295, 662], [1295, 706], [1756, 706], [1756, 454], [1605, 454], [1605, 502]], ['w9']);
bw('c10', '10', 'SB3.ao', 'KM3.b3', [[1845, 270], [1845, 722], [1605, 722], [1605, 662]], ['w10s', 'w10k']);
bw('c10b', '10', 'KM3.b3', 'KM1.t4', [[1605, 662], [1605, 735], [1719, 735], [1719, 465], [1025, 465], [1025, 502]], ['w10']);
bw('c11', '11', 'KM1.b4', 'KM2.t5', [[1025, 662], [1025, 730], [804, 730], [804, 458], [1375, 458], [1375, 502]], ['w11a', 'w11c']);
bw('c11b', '11', 'KM2.t5', 'KM3.t5', [[1381, 502], [1381, 494], [1685, 494], [1685, 502]], ['w11b']);
bw('cNa', 'N', 'QF.b3', 'KM1.b5', [[1050, 288], [1050, 304], [1102, 304], [1102, 722], [1071, 722], [1071, 662]], ['wN', 'wNA']);
bw('cNb', 'N', 'KM1.b5', 'KM2.b5', [[1059, 662], [1059, 762], [1381, 762], [1381, 662]], ['wNB']);
bw('cNc', 'N', 'KM2.b5', 'KM3.b5', [[1369, 662], [1369, 682], [1691, 682], [1691, 662]], ['wNC']);
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路。电动机：每相两个半绕组，6 个半绕组首尾相接成一圈 U1–U2–V1–V2–W1–W2–U1（图 2-14），每个半绕组中点接仿真零点 S
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) { BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i }); BE.push({ id: 'FR' + i, a: 'FR.t' + i, b: 'FR.b' + i }); }
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FRnc', a: 'FR.t4', b: 'FR.b4', on: s => !s.FR });
const RING = ['M.t0', 'M.t3', 'M.t1', 'M.t4', 'M.t2', 'M.t5'];
RING.forEach((a, i) => { const b = RING[(i + 1) % 6], m = 'MH' + i; BE.push({ id: m + 'a', a, b: m, load: true }, { id: m + 'b', a: m, b, load: true }, { id: m + 's', a: m, b: 'S', load: true }); });
for (const n of [1, 2, 3]) {
  const k = 'KM' + n, on = s => s['km' + n];
  for (let c = 0; c < 3; c++) BE.push({ id: k + 'm' + c, a: k + '.t' + c, b: k + '.b' + c, on });
  BE.push({ id: k + 'no', a: k + '.t3', b: k + '.b3', on }, { id: k + 'nc', a: k + '.t4', b: k + '.b4', on: s => !on(s) });
  BE.push({ id: k + 'coil', a: k + '.t5', b: k + '.b5', load: true });
}
BE.push({ id: 'SB1', a: 'SB1.i', b: 'SB1.o', on: s => !s.SB1 });
for (const k of ['SB2', 'SB3']) BE.push({ id: k + 'nc', a: k + '.ci', b: k + '.co', on: s => !s[k] }, { id: k + 'no', a: k + '.ai', b: k + '.ao', on: s => s[k] });

// ---------- 原理图（按教材图 2-13 重画；设计坐标）----------
const SCH = { x: 34, y: 112, s: 0.74 };
const X = [70, 140, 210], KX = [370, 420, 470], J13 = [295, 305, 315];
const A = 620, A2 = 700, B = 800, B2 = 880, Cc = 960;
const PU = ['U', 'V', 'W'], TAIL = ['U2', 'V2', 'W2'];
const SE = [];
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
const KM2SRC = [0, 2, 1]; // KM2 第 c 个触点接哪一相：U13、W13、V13（相序对调）
const TAPY = [500, 420, 520]; // KM3 在三根首端线上的取线点
for (let i = 0; i < 3; i++) {
  const x = X[i], p = PU[i];
  w('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  el('QF' + i, 'qf', x, 70, 120, 'qa' + i, p + '11', s => s.QF);
  w('w11' + i, p + '11', [[x, 120], [x, 150]], p + '11', 'fa' + i);
  el('FU1' + i, 'fuse', x, 150, 200, 'fa' + i, 'fb' + i);
  w('w12' + i, p + '12', [[x, 200], [x, 235]], 'fb' + i, 'h' + i);
  el('FRh' + i, 'heat', x, 235, 275, 'h' + i, 'hb' + i);
  w('w13' + i, p + '13', [[x, 275], [x, J13[i]]], 'hb' + i, 'j' + i);
  w('w13b' + i, p + '13', [[x, J13[i]], [x, 340]], 'j' + i, 'k1a' + i);
  el('KM1' + i, 'km', x, 340, 385, 'k1a' + i, 'k1b' + i, s => s.km1);
  w('whA' + i, p + '1', [[x, 385], [x, TAPY[i]]], 'k1b' + i, 't' + i);
  w('whB' + i, p + '1', [[x, TAPY[i]], [x, 560]], 't' + i, 'mh' + i);
}
for (let c = 0; c < 3; c++) {
  const src = KM2SRC[c];
  w('wtap' + [0, 2, 1][c], PU[src] + '13', [[X[src], J13[src]], [KX[c], J13[src]], [KX[c], 340]], 'j' + src, 'k2a' + c);
  el('KM2' + c, 'km', KX[c], 340, 385, 'k2a' + c, 'k2b' + c, s => s.km2);
  const y = 680 + 12 * c;
  w('wd' + c, TAIL[c], [[KX[c], 385], [KX[c], y], [X[c], y], [X[c], 660]], 'k2b' + c, 'mt' + c);
}
// KM3：两个触点上端都接 V1，下端分别接 U1、W1，闭合时把三个首端短接成一点（双星形的中点）
w('wk3v', 'V1', [[X[1], TAPY[1]], [270, TAPY[1]]], 't1', 'k3j');
w('wk3vA', 'V1', [[270, 420], [270, 440]], 'k3j', 'k3a0');
w('wk3v2', 'V1', [[270, 420], [310, 420], [310, 440]], 'k3j', 'k3a1');
el('KM30', 'km', 270, 440, 485, 'k3a0', 'k3b0', s => s.km3);
el('KM31', 'km', 310, 440, 485, 'k3a1', 'k3b1', s => s.km3);
w('wk3u', 'U1', [[270, 485], [270, 500], [X[0], 500]], 'k3b0', 't0');
w('wk3w', 'W1', [[310, 485], [310, 520], [X[2], 520]], 'k3b1', 't2');
// 绕组：U1–U2–V1–V2–W1–W2–U1 一圈 6 个半绕组（图 2-14），每个中点接仿真零点
const RN = ['mh0', 'mt0', 'mh1', 'mt1', 'mh2', 'mt2'];
RN.forEach((a, i) => { const b = RN[(i + 1) % 6], m = 'mm' + i; SE.push({ id: 'MH' + i + 'a', kind: 'none', a, b: m, load: true, pts: [[140, 610], [140, 610]] }, { id: 'MH' + i + 'b', kind: 'none', a: m, b, load: true, pts: [[140, 610], [140, 610]] }, { id: 'MH' + i + 's', kind: 'none', a: m, b: 'S', load: true, pts: [[140, 610], [140, 610]] }); });
// 控制电路
w('wW11', 'W11', [[540, 40], [560, 40]], 'W11', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 560, x2: 610, y: 40, a: 'f2a', b: 'f2b', pts: [[560, 40], [610, 40]] });
w('w1', '1', [[610, 40], [A, 40], [A, 80]], 'f2b', 'n1');
el('FR_NC', 'nc', A, 80, 125, 'n1', 'n2', s => !s.FR);
w('w2', '2', [[A, 125], [A, 165]], 'n2', 's1a');
el('SB1', 'bnc', A, 165, 210, 's1a', 'n3', s => !s.SB1);
w('w3', '3', [[A, 210], [A, 250]], 'n3', 'j3');
// 低速支路：3 → (SB2 常开 ∥ KM1 自锁) → 4 → SB3 常闭 → 5 → KM2 常闭 → 6 → KM3 常闭 → 7 → KM1 线圈
w('w3A', '3', [[A, 250], [A, 260]], 'j3', 'sb2a');
el('SB2_NO', 'bno', A, 260, 305, 'sb2a', 'sb2b', s => s.SB2);
w('w4s', '4', [[A, 305], [A, 330]], 'sb2b', 'j4');
w('w3k', '3', [[A, 250], [A2, 250], [A2, 260]], 'j3', 'k1na');
el('KM1_NO', 'no', A2, 260, 305, 'k1na', 'k1nb', s => s.km1);
w('w4k', '4', [[A2, 305], [A2, 330], [A, 330]], 'k1nb', 'j4');
w('w4', '4', [[A, 330], [A, 345]], 'j4', 'sb3c');
el('SB3_NC', 'bnc', A, 345, 390, 'sb3c', 'n5', s => !s.SB3);
w('w5', '5', [[A, 390], [A, 405]], 'n5', 'nc2a');
el('KM2_NC', 'nc', A, 405, 450, 'nc2a', 'nc2b', s => !s.km2);
w('w6', '6', [[A, 450], [A, 465]], 'nc2b', 'nc3a');
el('KM3_NC', 'nc', A, 465, 510, 'nc3a', 'nc3b', s => !s.km3);
w('w7', '7', [[A, 510], [A, 545]], 'nc3b', 'c1a');
el('KM1_coil', 'coil', A, 545, 585, 'c1a', 'c1b', null, { load: true });
w('wNA', 'N', [[A, 585], [A, 640]], 'c1b', 'nA');
// 高速支路：3 → SB2 常闭 → 8 → (SB3 常开 ∥ KM2 常开 + KM3 常开) → 10 → KM1 常闭 → 11 → KM2、KM3 线圈
w('w3b', '3', [[A, 250], [B, 250]], 'j3', 'j3B');
w('w3B', '3', [[B, 250], [B, 260]], 'j3B', 'sb2c');
el('SB2_NC', 'bnc', B, 260, 305, 'sb2c', 'n8', s => !s.SB2);
w('w8', '8', [[B, 305], [B, 330]], 'n8', 'j8');
w('w8s', '8', [[B, 330], [B, 345]], 'j8', 'sb3a');
el('SB3_NO', 'bno', B, 345, 390, 'sb3a', 'sb3b', s => s.SB3);
w('w10s', '10', [[B, 390], [B, 470]], 'sb3b', 'j10');
w('w8b', '8', [[B, 330], [B2, 330]], 'j8', 'j8b');
w('w8k', '8', [[B2, 330], [B2, 345]], 'j8b', 'k2na');
el('KM2_NO', 'no', B2, 345, 390, 'k2na', 'k2nb', s => s.km2);
w('w9', '9', [[B2, 390], [B2, 405]], 'k2nb', 'k3na');
el('KM3_NO', 'no', B2, 405, 450, 'k3na', 'k3nb', s => s.km3);
w('w10k', '10', [[B2, 450], [B2, 470], [B, 470]], 'k3nb', 'j10');
w('w10', '10', [[B, 470], [B, 480]], 'j10', 'nc1a');
el('KM1_NC', 'nc', B, 480, 525, 'nc1a', 'nc1b', s => !s.km1);
w('w11a', '11', [[B, 525], [B, 535]], 'nc1b', 'j11');
w('w11c', '11', [[B, 535], [B, 545]], 'j11', 'c2a');
w('w11b', '11', [[B, 535], [Cc, 535], [Cc, 545]], 'j11', 'c3a');
el('KM2_coil', 'coil', B, 545, 585, 'c2a', 'c2b', null, { load: true });
el('KM3_coil', 'coil', Cc, 545, 585, 'c3a', 'c3b', null, { load: true });
w('wNB', 'N', [[B, 585], [B, 640], [A, 640]], 'c2b', 'nA');
w('wNC', 'N', [[Cc, 585], [Cc, 640], [B, 640]], 'c3b', 'nA');
w('wN', 'N', [[A, 640], [560, 640]], 'nA', 'N');
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
const EDGE_T = {}, EDGE_COL = {};
function schSolve(s) {
  return solve('sch26', SE, s, s.QF ? ['L1', 'L2', 'L3', 'W11'] : ['L1', 'L2', 'L3'], ['S', 'N'], [s.QF, s.SB1, s.SB2, s.SB3, s.FR, s.km1, s.km2, s.km3].join(''));
}
function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil', 'KM2_coil', 'KM3_coil'].filter(id => R.cur.has(id)));
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
  for (let i = 0; i < 3; i++) { dot(X[i], J13[i], 4.5, C.ink); dot(X[i], TAPY[i], 4.5, C.ink); }
  dot(270, 420, 4.5, C.ink);
  [[A, 250], [A, 330], [B, 330], [B, 470], [B, 535], [A, 640], [B, 640]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  poly([[X[0] - 8, 95], [X[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  poly([[X[0] - 8, 365], [X[2] + 4, 365]], C.ink, 1.5, [6, 5]);
  poly([[KX[0] - 8, 365], [KX[2] + 4, 365]], C.ink, 1.5, [6, 5]);
  poly([[262, 465], [314, 465]], C.ink, 1.5, [6, 5]);
  poly([[A - 37 + (s.SB2 ? 7 : 0), 284], [B - 37 + (s.SB2 ? 7 : 0), 284]], C.ink, 1.5, [6, 5]); // SB2 常开、常闭联动
  poly([[A - 37 + (s.SB3 ? 7 : 0), 369], [B - 37 + (s.SB3 ? 7 : 0), 369]], C.ink, 1.5, [6, 5]); // SB3 常闭、常开联动
  // 电动机：方框表示接线盒，上面首端 U1 V1 W1，下面中点抽头 U2 V2 W2
  const run = Math.abs(s.w) > 0.05;
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.roundRect(40, 560, 200, 100, 14); g.fill(); g.stroke(); g.restore();
  text('M  3~', 140, 600, 24, C.ink, 'center', 'bold'); text('4/2 极 △/YY', 140, 628, 15, C.dim, 'center', 'bold');
  for (let i = 0; i < 3; i++) {
    text(PH[i], X[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(X[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
    text(PU[i] + '11', X[i] + 6, 136, 14, C.dim, 'left'); text(PU[i] + '12', X[i] + 6, 218, 14, C.dim, 'left'); text(PU[i] + '13', X[i] + 6, 328, 14, C.dim, 'left');
    text(PU[i] + '1', X[i] + 6, 548, 15, C.ink, 'left', 'bold'); text(TAIL[i], X[i] + 6, 672, 15, C.ink, 'left', 'bold');
  }
  text('QF', 245, 95, 20, C.ink, 'left', 'bold'); text('FU1', 245, 176, 20, C.ink, 'left', 'bold'); text('FR', 245, 258, 20, C.ink, 'left', 'bold');
  text('KM1', 245, 362, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('KM2', KX[1], 410, 20, s.km2 ? C.cur : C.ink, 'center', 'bold'); text('KM3', 324, 468, 18, s.km3 ? C.cur : C.ink, 'left', 'bold');
  text('W11', 535, 40, 20, C.ink, 'right', 'bold'); text('FU2', 585, 16, 18, C.ink, 'center', 'bold');
  text('FR', A - 22, 100, 18, C.ink, 'right', 'bold'); text('SB1', A - 48, 186, 18, C.ink, 'right', 'bold');
  text('SB2', A - 48, 282, 17, C.ink, 'right', 'bold'); text('KM1', A2 + 8, 320, 16, s.km1 ? C.cur : C.ink, 'left', 'bold');
  text('SB3', A - 48, 367, 17, C.ink, 'right', 'bold'); text('KM2', A + 20, 430, 16, C.ink, 'left', 'bold'); text('KM3', A + 20, 490, 16, C.ink, 'left', 'bold');
  text('SB2', B - 48, 282, 17, C.ink, 'right', 'bold'); text('SB3', B - 48, 367, 17, C.ink, 'right', 'bold');
  text('KM2', B2 + 10, 368, 16, s.km2 ? C.cur : C.ink, 'left', 'bold'); text('KM3', B2 + 10, 428, 16, s.km3 ? C.cur : C.ink, 'left', 'bold'); text('KM1', B + 20, 505, 16, C.ink, 'left', 'bold');
  text('KM1', A + 30, 600, 16, s.km1 ? C.cur : C.ink, 'center', 'bold'); text('KM2', B + 30, 600, 16, s.km2 ? C.cur : C.ink, 'center', 'bold'); text('KM3', Cc + 30, 600, 16, s.km3 ? C.cur : C.ink, 'center', 'bold');
  text('N', 555, 640, 22, C.ink, 'right', 'bold');
  [['1', A, 62], ['2', A, 146], ['3', A, 232], ['4', A, 320], ['5', A, 400], ['6', A, 460], ['7', A, 530], ['8', B, 320], ['9', B2, 400], ['10', B, 462], ['11', B, 532]].forEach(([n, x, y]) => text(n, x + 10, y, 15, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const CIRCUIT = {
  id: '2.6', key: 'zfz-practice-2.6', schW: 1010, // 原理图设计宽度（练习页按它自动缩放）
  title: '按钮切换的双速电动机 · 接线练习',
  kms: ['KM1', 'KM2', 'KM3'], labels: {}, kmX: KMX, noWire: /^QF\.t/, phaseSwap: ['KM2'], // 高速 KM2 任意两相对调都算对
  nEnd: [578, 640], motorAt: [140, 610, 62],
  drawExtra(t) {
    const run = Math.abs(PS.w) > 0.05, lb = motor.conn === 'D' ? '低速 △（4 极）' : motor.conn === 'YY' ? '高速 YY（2 极）' : '双速电动机接线盒（6 个出线端）';
    DEV.m6b(1166, 826, DEV.take(TP, 'M.', ['t0', 't1', 't2', 't3', 't4', 't5']), MOT,
      { label: lb, col: run ? (motor.conn === 'D' ? C.gold : C.ok) : C.dim });
  },
  // 双速电动机：首端 U1/V1/W1 三相各不同、中点 U2/V2/W2 悬空 = 三角形低速；中点三相各不同、首端短接在一起 = 双星形高速。
  // 高速时电源要按 U2、W2、V2 的顺序接 L1、L2、L3（相序对调），转向才和低速一致
  motorEval(reach, adj) {
    const ph = k => [0, 1, 2].filter(p => reach[p].has(k));
    const linked = (a, b) => { const seen = new Set([a]), q = [a]; while (q.length) { const n = q.pop(); if (n === b) return true; for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); q.push(m); } } return false; };
    const one = xs => xs.every(x => x.length === 1) && new Set(xs.map(x => x[0])).size === 3;
    const dirOf3 = seq => [[0, 1, 2], [1, 2, 0], [2, 0, 1]].some(q => q.join() === seq.join()) ? 1 : -1;
    const hp = ['M.t0', 'M.t1', 'M.t2'].map(ph), tp = ['M.t3', 'M.t4', 'M.t5'].map(ph);
    if (one(hp) && tp.every(x => !x.length)) { const seq = hp.map(x => x[0]); return { state: '低速运行', label: '低速 △', dir: dirOf3(seq), k: 0.5, seq, conn: 'D' }; }
    if (one(tp) && hp.every(x => !x.length) && linked('M.t0', 'M.t1') && linked('M.t1', 'M.t2')) {
      const seq = [tp[0][0], tp[2][0], tp[1][0]], dir = dirOf3(seq); // 按 U2、W2、V2 的顺序看相序
      return { state: dir > 0 ? '高速运行' : '高速反转', label: dir > 0 ? '高速 YY' : '高速反转！', dir, k: 1, seq, conn: 'YY' };
    }
    if (one(tp) && hp.every(x => !x.length)) return { state: '接法错误', dir: 0, seq: null }; // 电源接到了中点抽头，但首端没有短接
    return hp.some(x => x.length) || tp.some(x => x.length) ? { state: '缺相', dir: 0, seq: null } : { state: '停止', dir: 0, seq: null };
  },
  lesson: {
    name: '双速电动机电路的安装、接线与调试',
    goals: ['理解变极调速的原理和电动机高、低速时绕组的联结方式（△/YY）', '识读按钮切换的双速电动机电路的工作原理图', '完成其电路的安装、接线与调试'],
    tools: ['螺钉旋具', '试电笔', '剥线钳', '尖嘴钳', '钢丝钳', '万用表', '绝缘电阻表'],
    steps: ['识读电路图', '检测元器件', '安装元器件', '接线', '验收加分'],
    note: '实训室做法：不接端子排，按钮直接接线；低速 KM1 接 U1、V1、W1，高速 KM2 接 U2、W2、V2（相序对调，转向才不变），KM3 把 U1、V1、W1 短接；KM1 和 KM2 接电动机的线不能对换，否则高速时短路；每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上 QF：按 SB2 低速运行（KM1 吸合，△），按 SB3 直接换高速（KM2、KM3 吸合，YY），再按 SB2 回低速，按 SB1 停止。',
  runMsg: '空开已合闸，按 SB2 低速、SB3 高速、SB1 停止（原理图同步发光）',
  answers: [
    { name: '教材图 2-16 接法', desc: 'FR 出线先接 KM1 再接 KM2；首端 V1 先接 KM3 两个上端；3号线 SB1→SB2常闭→SB2常开→KM1自锁', chains: {} },
    { name: '就近并接', desc: 'KM3 的 U1、W1 直接从 KM1 出线取；零线 KM3→KM2→KM1',
      chains: { W11: ['QF.b2', 'FU2.t', 'FU1.t2'], U1: ['M.t0', 'KM1.b0', 'KM3.b0'], W1: ['M.t2', 'KM1.b2', 'KM3.b1'], N: ['QF.b3', 'KM3.b5', 'KM2.b5', 'KM1.b5'] } },
    { name: '入口出口法', desc: '3号线 SB1出 → KM1自锁入 → SB2常开入 → SB2常闭入；8、10号线按入口出口顺序串接',
      chains: { 3: ['SB1.o', 'KM1.t3', 'SB2.ai', 'SB2.ci'], 8: ['SB2.co', 'KM2.t3', 'SB3.ai'], 10: ['SB3.ao', 'KM1.t4', 'KM3.b3'] } },
  ],
  groups: [
    { name: '主电路 · 电源分配', nets: ['W11'], why: 'QF 出线 L3（W11）要同时接 FU1 和控制熔断器 FU2。' },
    { name: '主电路 · FR 出线 = KM1、KM2 进线', nets: ['U13', 'V13', 'W13'], why: 'FR 出线同时送到 KM1、KM2 上端。注意 KM2 上端的顺序是 U13、W13、V13（相序对调），这是“哪个端子接哪一相”，和串接顺序无关。' },
    { name: '主电路 · 首端（KM1 出线、KM3）', nets: ['U1', 'V1', 'W1'], why: '低速时 KM1 把电源送到 U1、V1、W1；高速时 KM3 把它们短接成一点：V1 接 KM3 两个上端，U1、W1 分别接 KM3 两个下端。' },
    { name: '控制电路 · 起点（3号线）', nets: ['3'], why: 'SB1 出口 = SB2常闭 入 = SB2常开 入 = KM1自锁 入：低速、高速两条支路从这里分出，4 个端子 12 种串法。' },
    { name: '控制电路 · 低速支路（4号线）', nets: ['4'], why: '4号线 = SB2常开 出 + KM1自锁 出 + SB3常闭 入。' },
    { name: '控制电路 · 高速支路（8、10、11号线）', nets: ['8', '10', '11'], why: '8号线 = SB2常闭 出 + SB3常开 入 + KM2常开 入；10号线 = SB3常开 出 + KM3常开 出 + KM1常闭 入；11号线 = KM1常闭 出 + KM2、KM3 两个线圈。' },
    { name: '零线', nets: ['N'], why: '从 QF 的 N 接到三个线圈的 A2，四个端子 12 种串法。' },
  ],
};
