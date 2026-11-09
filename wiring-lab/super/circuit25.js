// 项目 2.5 时间继电器控制的星-三角减压起动电路：接线练习页用的实物板、原理图和答案（按教材图 2-11、图 2-12）
// 按 SB2：KM1、KM3 吸合星形起动，同时时间继电器 KT 线圈通电计时；到时 KT 延时断开触点断开 KM3，延时闭合触点接通 KM2，
// 自动换成三角形运行；KM2 吸合后它的常闭触点切断 KT 和 KM3 支路。KM2、KM3 互锁。按 SB1 停止。
// 端子分配按图 2-12：SB1 常闭 2-3；SB2 常开 3-4；KM1 自锁 3-4、线圈 4-N；
// 接触器一律上端入、下端出（常闭 21 入、22 出）：KM2 主触点上端接 U12/V12/W12（和 KM1 并联）、下端接 W2/U2/V2，自锁 4-5、常闭 4-7、线圈 6-N；
// KM3 主触点上端接 W2/U2/V2、下端短接成星点，常闭 5-6、线圈 8-N；KT 延时闭合 4-5、延时断开 7-8、线圈 7-N。
// 实训室做法同 2.4：不接端子排，按钮直接接线；电动机接线盒 6 个出线端（拆开连接片）。

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
const MOT = ['U1', 'V1', 'W1', 'W2', 'U2', 'V2'];
[1270, 1320, 1370, 1440, 1490, 1540].forEach((x, i) => (TP['M.t' + i] = [x, 842]));
const BTN = { SB1: [1540, '#ef4444', '停止'], SB2: [1670, '#22c55e', '起动'] };
for (const k in BTN) { TP[k + '.i'] = [BTN[k][0] - 26, 270]; TP[k + '.o'] = [BTN[k][0] + 26, 270]; }
// 时间继电器 KT（通电延时）：端子座一排 6 个，向下出线：延时闭合（常开）一对、延时断开（常闭）一对、线圈 A1/A2
const KTX = 1736, KTN = ['ni', 'no', 'ci', 'co', 'a1', 'a2'];
KTN.forEach((n, i) => (TP['KT.' + n] = [KTX + 16 + i * 24, 288]));

function termName(k) {
  const [d, t] = k.split('.'), i = +t.slice(1), top = t[0] === 't';
  if (d === 'QF') return `QF ${top ? '进线' : '出线'} ${QF_POLES[i]}`;
  if (d === 'FU1') return `FU1 ${top ? '进线' : '出线'}`;
  if (d === 'FU2') return `FU2 ${top ? '进线' : '出线'}`;
  if (d === 'FR') return i === 4 ? `FR 常闭 ${top ? '95' : '96'}` : `FR ${top ? '进线 ' + ['1/L1', '3/L2', '5/L3'][i] : '出线 ' + ['2/T1', '4/T2', '6/T3'][i]}`;
  if (d === 'M') return `电动机 ${MOT[i]}`;
  if (d === 'KT') return { ni: 'KT 延时闭合入口', no: 'KT 延时闭合出口', ci: 'KT 延时断开入口', co: 'KT 延时断开出口', a1: 'KT 线圈 A1', a2: 'KT 线圈 A2' }[t];
  if (/^KM/.test(d)) {
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `${d} ${i < 3 ? (top ? '主触点上端 ' : '主触点下端 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return `${d} ${t === 'i' ? '入口' : '出口'}`;
  return k;
}

// 导线（教材顺序：主电路、电动机、控制电路 1～8 号线、零线）。共 43 根
const BW = [];
const bw = (id, net, a, b, pts, sch) => BW.push({ id, net, a, b, pts, sch });
bw('U11', 'U11', 'QF.b0', 'FU1.t0', [[870, 288], [870, 340], [1146, 340], [1146, 134], [1170, 134], [1170, 162]], ['w110']);
bw('V11', 'V11', 'QF.b1', 'FU1.t1', [[930, 288], [930, 330], [1138, 330], [1138, 126], [1240, 126], [1240, 162]], ['w111']);
bw('W11', 'W11', 'QF.b2', 'FU1.t2', [[990, 288], [990, 320], [1130, 320], [1130, 118], [1310, 118], [1310, 162]], ['w112']);
bw('W11c', 'W11', 'FU1.t2', 'FU2.t', [[1316, 162], [1316, 144], [1400, 144], [1400, 162]], ['wW11']);
bw('U12a', 'U12', 'FU1.b0', 'KM1.t0', [[1170, 288], [1170, 370], [865, 370], [865, 502]], ['w12a0', 'w12b0']);
bw('V12a', 'V12', 'FU1.b1', 'KM1.t1', [[1240, 288], [1240, 380], [905, 380], [905, 502]], ['w12a1', 'w12b1']);
bw('W12a', 'W12', 'FU1.b2', 'KM1.t2', [[1310, 288], [1310, 390], [945, 390], [945, 502]], ['w12a2', 'w12b2']);
bw('U12b', 'U12', 'KM1.t0', 'KM2.t0', [[871, 502], [871, 410], [1175, 410], [1175, 502]], ['wtap0']);
bw('V12b', 'V12', 'KM1.t1', 'KM2.t1', [[911, 502], [911, 418], [1215, 418], [1215, 502]], ['wtap1']);
bw('W12b', 'W12', 'KM1.t2', 'KM2.t2', [[951, 502], [951, 426], [1255, 426], [1255, 502]], ['wtap2']);
bw('U13', 'U13', 'KM1.b0', 'FR.t0', [[865, 662], [865, 780], [885, 780], [885, 812]], ['w13' + 0]);
bw('V13', 'V13', 'KM1.b1', 'FR.t1', [[905, 662], [905, 772], [925, 772], [925, 812]], ['w131']);
bw('W13', 'W13', 'KM1.b2', 'FR.t2', [[945, 662], [945, 764], [965, 764], [965, 812]], ['w132']);
bw('U1', 'U1', 'FR.b0', 'M.t0', [[885, 918], [885, 950], [1230, 950], [1230, 820], [1270, 820], [1270, 842]], ['wo0']);
bw('V1', 'V1', 'FR.b1', 'M.t1', [[925, 918], [925, 942], [1222, 942], [1222, 812], [1320, 812], [1320, 842]], ['wo1']);
bw('W1', 'W1', 'FR.b2', 'M.t2', [[965, 918], [965, 934], [1214, 934], [1214, 804], [1370, 804], [1370, 842]], ['wo2']);
bw('W2a', 'W2', 'KM2.b0', 'KM3.t0', [[1175, 662], [1175, 678], [1409, 678], [1409, 486], [1485, 486], [1485, 502]], ['wd0', 'wk30']);
bw('U2a', 'U2', 'KM2.b1', 'KM3.t1', [[1215, 662], [1215, 697], [1418, 697], [1418, 467], [1525, 467], [1525, 502]], ['wd1', 'wk31']);
bw('V2a', 'V2', 'KM2.b2', 'KM3.t2', [[1255, 662], [1255, 716], [1427, 716], [1427, 424], [1565, 424], [1565, 502]], ['wd2', 'wk32']);
bw('W2b', 'W2', 'KM3.t0', 'M.t3', [[1485, 502], [1485, 465], [1485, 405], [1440, 405], [1440, 805], [1440, 842]], ['wt0']);
bw('U2b', 'U2', 'KM3.t1', 'M.t4', [[1525, 502], [1525, 458], [1525, 386], [1490, 386], [1490, 798], [1490, 842]], ['wt1']);
bw('V2b', 'V2', 'KM3.t2', 'M.t5', [[1565, 502], [1565, 486], [1540, 486], [1540, 826], [1540, 842]], ['wt2']);
bw('Ya', 'Y', 'KM3.b0', 'KM3.b1', [[1485, 662], [1485, 685], [1525, 685], [1525, 662]], ['wy0', 'wyA', 'wy1']);
bw('Yb', 'Y', 'KM3.b1', 'KM3.b2', [[1525, 662], [1525, 692], [1525, 704], [1565, 704], [1565, 692], [1565, 662]], ['wyB', 'wy2']);
bw('c1', '1', 'FU2.b', 'FR.t4', [[1400, 288], [1400, 310], [1435, 310], [1435, 790], [1045, 790], [1045, 812]], ['w1']);
bw('c2', '2', 'FR.b4', 'SB1.i', [[1045, 918], [1045, 958], [1128, 958], [1128, 300], [1514, 300], [1514, 270]], ['w2']);
bw('b3', '3', 'SB1.o', 'SB2.i', [[1566, 270], [1566, 286], [1644, 286], [1644, 270]], ['w3', 'w3s2']);
bw('c3', '3', 'SB2.i', 'KM1.t3', [[1650, 270], [1650, 438], [985, 438], [985, 502]], ['w3b', 'w3k']);
bw('b4a', '4', 'SB2.o', 'KT.ni', [[1696, 270], [1696, 302], [1752, 302], [1752, 288]], ['w4s', 'w4b', 'w4t']);
bw('c4a', '4', 'KT.ni', 'KM2.t3', [[1758, 288], [1758, 446], [1295, 446], [1295, 502]], ['w4c', 'w4k2']);
bw('c4b', '4', 'KM2.t3', 'KM1.t5', [[1301, 502], [1301, 454], [1065, 454], [1065, 502]], ['w4']);
bw('c4c', '4', 'KM1.t5', 'KM1.b3', [[1071, 502], [1071, 462], [1112, 462], [1112, 686], [985, 686], [985, 662]], ['w4k']);
bw('c4d', '4', 'KM1.b3', 'KM2.t4', [[985, 662], [985, 699], [1099, 699], [1099, 465], [1335, 465], [1335, 502]], ['w4d', 'w4n']);
bw('c5a', '5', 'KT.no', 'KM3.t4', [[1776, 288], [1776, 332], [1776, 395], [1645, 395], [1645, 458], [1645, 502]], ['w5t', 'w5']);
bw('c5b', '5', 'KM3.t4', 'KM2.b3', [[1645, 502], [1645, 486], [1454, 486], [1454, 678], [1295, 678], [1295, 662]], ['w5k']);
bw('c6', '6', 'KM3.b4', 'KM2.t5', [[1645, 662], [1645, 685], [1719, 685], [1719, 479], [1375, 479], [1375, 502]], ['w6']);
bw('b7', '7', 'KT.ci', 'KT.a1', [[1800, 288], [1800, 304], [1848, 304], [1848, 288]], ['w7a', 'w7b']);
bw('c7', '7', 'KT.ci', 'KM2.b4', [[1800, 288], [1800, 318], [1800, 728], [1335, 728], [1335, 692], [1335, 662]], ['w7']);
bw('c8', '8', 'KT.co', 'KM3.t5', [[1824, 288], [1824, 478], [1685, 478], [1685, 502]], ['w8']);
bw('cNa', 'N', 'QF.b3', 'KM1.b5', [[1050, 288], [1050, 302], [824, 302], [824, 740], [1071, 740], [1071, 662]], ['wN', 'wNA']);
bw('cNb', 'N', 'KM1.b5', 'KM2.b5', [[1059, 662], [1059, 748], [1381, 748], [1381, 662]], ['wNB']);
bw('cNc', 'N', 'KM2.b5', 'KM3.b5', [[1369, 662], [1369, 756], [1691, 756], [1691, 662]], ['wNC', 'wND']);
bw('cNd', 'N', 'KM3.b5', 'KT.a2', [[1679, 662], [1679, 764], [1872, 764], [1872, 288]], ['wNT']);
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) {
  BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i });
  BE.push({ id: 'FR' + i, a: 'FR.t' + i, b: 'FR.b' + i });
}
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FRnc', a: 'FR.t4', b: 'FR.b4', on: s => !s.FR });
[['U', 'M.t0', 'M.t4'], ['V', 'M.t1', 'M.t5'], ['W', 'M.t2', 'M.t3']].forEach(([n, h, tl]) => BE.push(
  { id: 'MW' + n + 'a', a: h, b: 'MM' + n, load: true }, { id: 'MW' + n + 'b', a: 'MM' + n, b: tl, load: true }, { id: 'MW' + n + 's', a: 'MM' + n, b: 'S', load: true }));
for (const n of [1, 2, 3]) {
  const k = 'KM' + n, on = s => s['km' + n];
  for (let c = 0; c < 3; c++) BE.push({ id: k + 'm' + c, a: k + '.t' + c, b: k + '.b' + c, on });
  BE.push({ id: k + 'no', a: k + '.t3', b: k + '.b3', on }, { id: k + 'nc', a: k + '.t4', b: k + '.b4', on: s => !on(s) });
  BE.push({ id: k + 'coil', a: k + '.t5', b: k + '.b5', load: true });
}
BE.push({ id: 'SB1', a: 'SB1.i', b: 'SB1.o', on: s => !s.SB1 }, { id: 'SB2', a: 'SB2.i', b: 'SB2.o', on: s => s.SB2 });
BE.push({ id: 'KTno', a: 'KT.ni', b: 'KT.no', on: s => s.ktc }, { id: 'KTnc', a: 'KT.ci', b: 'KT.co', on: s => !s.ktc }, { id: 'KTcoil', a: 'KT.a1', b: 'KT.a2', load: true });

// ---------- 原理图（按教材图 2-11 版面重画；设计坐标）----------
const SCH = { x: 34, y: 112, s: 0.74 };
const X = [70, 140, 210], KX = [330, 390, 450], J12 = [215, 225, 235], DY = [548, 556, 564];
const A = 640, A2 = 715, B = 775, B2 = 845, Cc = 905, C2 = 975;
const PU = ['U', 'V', 'W'], TAIL = ['W2', 'U2', 'V2'];
const SE = [];
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
const MH = [[112, 434], [140, 426], [168, 434]], MT = [[112, 510], [140, 518], [168, 510]];
for (let i = 0; i < 3; i++) {
  const x = X[i], p = PU[i];
  w('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  el('QF' + i, 'qf', x, 70, 120, 'qa' + i, p + '11', s => s.QF);
  w('w11' + i, p + '11', [[x, 120], [x, 150]], p + '11', 'fa' + i);
  el('FU1' + i, 'fuse', x, 150, 200, 'fa' + i, 'fb' + i);
  // KM1、KM2 都从 FU1 出线（U12/V12/W12）取电
  w('w12a' + i, p + '12', [[x, 200], [x, J12[i]]], 'fb' + i, 'j' + i);
  w('w12b' + i, p + '12', [[x, J12[i]], [x, 250]], 'j' + i, 'k1a' + i);
  el('KM1' + i, 'km', x, 250, 300, 'k1a' + i, 'k1b' + i, s => s.km1);
  w('w13' + i, p + '13', [[x, 300], [x, 352]], 'k1b' + i, 'h' + i);
  el('FRh' + i, 'heat', x, 352, 392, 'h' + i, 'hb' + i);
  w('wo' + i, p + '1', [[x, 392], [x, 404], MH[i]], 'hb' + i, 'mh' + i);
  w('wtap' + i, p + '12', [[x, J12[i]], [KX[i], J12[i]], [KX[i], 400]], 'j' + i, 'k2a' + i);
  el('KM2' + i, 'km', KX[i], 400, 445, 'k2a' + i, 'k2b' + i, s => s.km2);
  w('wd' + i, TAIL[i], [[KX[i], 445], [KX[i], DY[i]], [X[i], DY[i]]], 'k2b' + i, 'td' + i);
  w('wt' + i, TAIL[i], [MT[i], [X[i], 530], [X[i], DY[i]]], 'mt' + i, 'td' + i);
  w('wk3' + i, TAIL[i], [[X[i], DY[i]], [X[i], 580]], 'td' + i, 'k3a' + i);
  el('KM3' + i, 'km', X[i], 580, 625, 'k3a' + i, 'k3b' + i, s => s.km3);
  w('wy' + i, 'Y', [[X[i], 625], [X[i], 645]], 'k3b' + i, 'sp' + i);
}
w('wyA', 'Y', [[X[0], 645], [X[1], 645]], 'sp0', 'sp1');
w('wyB', 'Y', [[X[1], 645], [X[2], 645]], 'sp1', 'sp2');
[['U', 0, 1], ['V', 1, 2], ['W', 2, 0]].forEach(([n, h, t]) => SE.push(
  { id: 'MW' + n + 'a', kind: 'none', a: 'mh' + h, b: 'mm' + n, load: true, pts: [MH[h], [140, 472]] },
  { id: 'MW' + n + 'b', kind: 'none', a: 'mm' + n, b: 'mt' + t, load: true, pts: [[140, 472], MT[t]] },
  { id: 'MW' + n + 's', kind: 'none', a: 'mm' + n, b: 'S', load: true, pts: [[140, 472], [140, 472]] }));
// 控制电路
w('wW11', 'W11', [[560, 40], [580, 40]], 'W11', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 580, x2: 630, y: 40, a: 'f2a', b: 'f2b', pts: [[580, 40], [630, 40]] });
w('w1', '1', [[630, 40], [A, 40], [A, 80]], 'f2b', 'n1');
el('FR_NC', 'nc', A, 80, 125, 'n1', 'n2', s => !s.FR);
w('w2', '2', [[A, 125], [A, 165]], 'n2', 's1a');
el('SB1', 'bnc', A, 165, 210, 's1a', 'n3', s => !s.SB1);
w('w3', '3', [[A, 210], [A, 250]], 'n3', 'j3');
w('w3s2', '3', [[A, 250], [A, 260]], 'j3', 'sb2a');
el('SB2', 'bno', A, 260, 305, 'sb2a', 'sb2b', s => s.SB2);
w('w4s', '4', [[A, 305], [A, 330]], 'sb2b', 'j4');
w('w3b', '3', [[A, 250], [A2, 250]], 'j3', 'j3b');
w('w3k', '3', [[A2, 250], [A2, 260]], 'j3b', 'k1na');
el('KM1_NO', 'no', A2, 260, 305, 'k1na', 'k1nb', s => s.km1);
w('w4k', '4', [[A2, 305], [A2, 330], [A, 330]], 'k1nb', 'j4');
w('w4', '4', [[A, 330], [A, 520]], 'j4', 'c1a');
el('KM1_coil', 'coil', A, 520, 560, 'c1a', 'c1b', null, { load: true });
w('wNA', 'N', [[A, 560], [A, 620]], 'c1b', 'nA');
// 三角形支路：4 → (KT 延时闭合 ∥ KM2 自锁) → 5 → KM3 常闭 → 6 → KM2 线圈
w('w4b', '4', [[A, 330], [B, 330]], 'j4', 'j4B');
w('w4t', '4', [[B, 330], [B, 370]], 'j4B', 'tna');
el('KT_NO', 'tno', B, 370, 415, 'tna', 'tnb', s => s.ktc);
w('w5t', '5', [[B, 415], [B, 432]], 'tnb', 'j5');
w('w4c', '4', [[B, 330], [B2, 330]], 'j4B', 'j4C');
w('w4k2', '4', [[B2, 330], [B2, 370]], 'j4C', 'k2na');
el('KM2_NO', 'no', B2, 370, 415, 'k2na', 'k2nb', s => s.km2);
w('w5k', '5', [[B2, 415], [B2, 432], [B, 432]], 'k2nb', 'j5');
w('w5', '5', [[B, 432], [B, 445]], 'j5', 'nc3a');
el('KM3_NC', 'nc', B, 445, 490, 'nc3a', 'nc3b', s => !s.km3);
w('w6', '6', [[B, 490], [B, 520]], 'nc3b', 'c2a');
el('KM2_coil', 'coil', B, 520, 560, 'c2a', 'c2b', null, { load: true });
w('wNB', 'N', [[B, 560], [B, 620], [A, 620]], 'c2b', 'nA');
// 星形支路：4 → KM2 常闭 → 7 → KT 线圈；7 → KT 延时断开 → 8 → KM3 线圈
w('w4d', '4', [[B2, 330], [Cc, 330]], 'j4C', 'j4D');
w('w4n', '4', [[Cc, 330], [Cc, 370]], 'j4D', 'nc2a');
el('KM2_NC', 'nc', Cc, 370, 415, 'nc2a', 'nc2b', s => !s.km2);
w('w7', '7', [[Cc, 415], [Cc, 440]], 'nc2b', 'j7');
w('w7a', '7', [[Cc, 440], [Cc, 520]], 'j7', 'kta');
el('KT_coil', 'coil', Cc, 520, 560, 'kta', 'ktb', null, { load: true });
w('wNC', 'N', [[Cc, 560], [Cc, 620], [B, 620]], 'ktb', 'nA');
w('w7b', '7', [[Cc, 440], [C2, 440], [C2, 455]], 'j7', 'tca');
el('KT_NC', 'tnc', C2, 455, 500, 'tca', 'tcb', s => !s.ktc);
w('w8', '8', [[C2, 500], [C2, 520]], 'tcb', 'c3a');
el('KM3_coil', 'coil', C2, 520, 560, 'c3a', 'c3b', null, { load: true });
w('wND', 'N', [[C2, 560], [C2, 620], [Cc, 620]], 'c3b', 'nA');
w('wN', 'N', [[A, 620], [570, 620]], 'nA', 'N');
SE.push({ id: 'wNT', kind: 'none', net: 'N', a: 'nA', b: 'nA', pts: [[C2, 620], [C2, 620]] }); // KT 线圈零线（板上单独一根线，原理图上和其他零线画在一起）
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
const EDGE_T = {}, EDGE_COL = {};
function schSolve(s) {
  return solve('sch25', SE, s, s.QF ? ['L1', 'L2', 'L3', 'W11'] : ['L1', 'L2', 'L3'], ['S', 'N'], [s.QF, s.SB1, s.SB2, s.FR, s.km1, s.km2, s.km3, s.ktc].join(''));
}
function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil', 'KM2_coil', 'KM3_coil', 'KT_coil'].filter(id => R.cur.has(id)));
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
  for (let i = 0; i < 3; i++) { dot(X[i], J12[i], 4.5, C.ink); dot(X[i], DY[i], 4.5, C.ink); }
  dot(X[1], 645, 4.5, C.ink);
  [[A, 250], [A, 330], [B, 330], [B2, 330], [B, 432], [Cc, 440], [A, 620], [B, 620], [Cc, 620]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  poly([[X[0] - 8, 95], [X[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  poly([[X[0] - 8, 280], [X[2] + 4, 280]], C.ink, 1.5, [6, 5]);
  poly([[KX[0] - 8, 425], [KX[2] + 4, 425]], C.ink, 1.5, [6, 5]);
  poly([[X[0] - 8, 605], [X[2] + 4, 605]], C.ink, 1.5, [6, 5]);
  const run = Math.abs(s.w) > 0.05;
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.arc(140, 472, 46, 0, 7); g.fill(); g.stroke(); g.restore();
  text('M', 140, 460, 26, C.ink, 'center', 'bold'); text('3~', 140, 488, 18);
  poly([[186, 472], [236, 472], [236, 486]], C.ink, 2); poly([[222, 486], [250, 486]], C.ink, 2); poly([[227, 492], [245, 492]], C.ink, 2); poly([[232, 498], [240, 498]], C.ink, 2); text('PE', 256, 482, 16, C.ink, 'left');
  for (let i = 0; i < 3; i++) {
    text(PH[i], X[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(X[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
    text(PU[i] + '11', X[i] + 6, 136, 14, C.dim, 'left'); text(PU[i] + '12', X[i] + 6, 210 + i * 0, 14, C.dim, 'left'); text(PU[i] + '13', X[i] + 6, 326, 14, C.dim, 'left');
    text(PU[i] + '1', X[i] + 6, 404, 15, C.ink, 'left', 'bold'); text(TAIL[i], X[i] + 6, 540, 15, C.ink, 'left', 'bold');
  }
  text('QF', 245, 95, 20, C.ink, 'left', 'bold'); text('FU1', 245, 176, 20, C.ink, 'left', 'bold');
  text('KM1', 245, 276, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('FR', 245, 374, 20, C.ink, 'left', 'bold');
  text('KM2', 480, 422, 20, s.km2 ? C.cur : C.ink, 'left', 'bold'); text('KM3', 245, 602, 20, s.km3 ? C.cur : C.ink, 'left', 'bold');
  text('W11', 555, 40, 20, C.ink, 'right', 'bold'); text('FU2', 605, 16, 18, C.ink, 'center', 'bold');
  text('FR', A - 22, 100, 18, C.ink, 'right', 'bold'); text('SB1', A - 48, 186, 18, C.ink, 'right', 'bold');
  text('SB2', A - 48, 282, 18, C.ink, 'right', 'bold'); text('KM1', A2 + 10, 282, 16, s.km1 ? C.cur : C.ink, 'left', 'bold');
  text('KT', B - 28, 366, 16, C.ink, 'right', 'bold'); text('KM2', B2 + 8, 398, 16, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('KM2', Cc + 20, 396, 16, C.ink, 'left', 'bold'); text('KT', C2 - 28, 452, 16, C.ink, 'right', 'bold'); // KM2 常闭的名字标在右边，不和左边自锁触点的名字挤在一起
  text('KM3', B - 22, 468, 16, C.ink, 'right', 'bold');
  text('KM1', A + 30, 576, 16, s.km1 ? C.cur : C.ink, 'center', 'bold'); text('KM2', B + 30, 576, 16, s.km2 ? C.cur : C.ink, 'center', 'bold');
  text('KT', Cc + 28, 576, 16, s._coil.has('KT_coil') ? C.cur : C.ink, 'center', 'bold'); text('KM3', C2 + 30, 576, 16, s.km3 ? C.cur : C.ink, 'center', 'bold');
  text('N', 558, 620, 22, C.ink, 'right', 'bold');
  [['1', A, 62], ['2', A, 146], ['3', A, 232], ['4', A, 318], ['5', B, 426], ['6', B, 506], ['7', Cc, 432], ['8', C2, 512]].forEach(([n, x, y]) => text(n, x + 10, y, 15, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const KT_STEP = { minus: [KTX + 34, 236], plus: [KTX + 116, 236] }; // 调延时的 − / + 按钮（实物板坐标）
const CIRCUIT = {
  id: '2.5', key: 'zfz-practice-2.5', schW: 1025, // 原理图设计宽度（练习页按它自动缩放）
  title: '时间继电器控制的星-三角减压起动 · 接线练习',
  kms: ['KM1', 'KM2', 'KM3'], labels: {}, kmX: KMX, noWire: /^QF\.t/,
  nEnd: [578, 620], motorAt: [140, 472, 46],
  timer: { delay: 3 }, // 通电延时 3 秒（可在 KT 上按 − / + 调 1～10 秒）
  roles(role) {
    role('KT.ni', 'KT_NO', 'in', 'KT延时闭合'); role('KT.no', 'KT_NO', 'out', 'KT延时闭合');
    role('KT.ci', 'KT_NC', 'in', 'KT延时断开'); role('KT.co', 'KT_NC', 'out', 'KT延时断开');
    role('KT.a1', 'KT_coil', 'in', 'KT线圈'); role('KT.a2', 'KT_coil', 'out', 'KT线圈');
  },
  onPointer(p, e) {
    const r = e.pointerType === 'mouse' ? 16 : 24;
    for (const [k, d] of [['minus', -1], ['plus', 1]]) if (Math.hypot(p[0] - KT_STEP[k][0], p[1] - KT_STEP[k][1]) <= r) {
      PS.ktDelay = Math.max(1, Math.min(10, PS.ktDelay + d)); fx('ripple', { x: KT_STEP[k][0], y: KT_STEP[k][1] }); say(`时间继电器 KT 延时调为 ${PS.ktDelay} 秒`, C.dim, 3); return true;
    }
    return false;
  },
  drawExtra(t) {
    // 电动机接线盒（同 2.4；画法在 devices.js 的 DEV.m6）
    const run = Math.abs(PS.w) > 0.05, lb = motor.conn === 'Y' ? '星形 Y（降压起动）' : motor.conn === 'D' ? '三角形 △（全压运行）' : '电动机接线盒（6 个出线端，已拆连接片）';
    DEV.m6(1240, 826, DEV.take(TP, 'M.', ['t0', 't1', 't2', 't3', 't4', 't5']), MOT,
      { label: lb, col: run ? (motor.conn === 'Y' ? C.gold : C.ok) : C.dim });
    // 时间继电器 KT：表盘显示倒计时，− / + 调延时，下面一排 6 个端子（画法在 devices.js 的 DEV.kt6）
    DEV.kt6(KTX, 140, DEV.take(TP, 'KT.', KTN), {
      delay: PS.ktDelay, on: PS.ktOn ? 1 : 0, done: PS.ktc ? 1 : 0, e: PS.ktE,
      k: PS.ktc ? 1 : PS.ktOn ? Math.min(1, PS.ktE / PS.ktDelay) : 0
    });
  },
  // 电动机：同 2.4
  motorEval(reach, adj) {
    const ph = k => [0, 1, 2].filter(p => reach[p].has(k));
    const linked = (a, b) => { const seen = new Set([a]), q = [a]; while (q.length) { const n = q.pop(); if (n === b) return true; for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); q.push(m); } } return false; };
    const hp = ['M.t0', 'M.t1', 'M.t2'].map(ph), tl = ['M.t4', 'M.t5', 'M.t3'].map(ph);
    if (hp.every(x => x.length === 1) && new Set(hp.map(x => x[0])).size === 3) {
      const seq = hp.map(x => x[0]), dir = [[0, 1, 2], [1, 2, 0], [2, 0, 1]].some(q => q.join() === seq.join()) ? 1 : -1;
      if (tl.every(x => !x.length) && linked('M.t3', 'M.t4') && linked('M.t4', 'M.t5')) return { state: '星形起动', label: '星形 Y', dir, k: 0.55, seq, conn: 'Y' };
      if (tl.every((x, i) => x.length === 1 && x[0] !== seq[i])) return { state: '三角形运行', label: '三角形 △', dir, k: 1, seq, conn: 'D' };
      if (tl.every(x => x.length === 1)) return { state: '三角形接错', dir: 0, seq: null };
      return { state: '绕组开路', dir: 0, seq: null };
    }
    return hp.some(x => x.length) ? { state: '缺相', dir: 0, seq: null } : { state: '停止', dir: 0, seq: null };
  },
  lesson: {
    name: '时间继电器控制的星-三角减压起动电路的安装、接线与调试',
    goals: ['理解减压起动的原理和电动机绕组星形、三角形联结方式', '识读三相笼型异步电动机时间继电器控制的星-三角减压起动电路的工作原理图', '完成其电路的安装、接线与调试'],
    tools: ['螺钉旋具', '试电笔', '剥线钳', '尖嘴钳', '钢丝钳', '万用表', '绝缘电阻表'],
    steps: ['识读电路图', '检测元器件', '安装元器件', '接线', '验收加分'],
    note: '实训室做法：不接端子排，按钮直接接线；电动机要拆开接线盒内的连接片（6 个出线端）；KM2 闭合时 U1–W2、V1–U2、W1–V2；KM3 进线必须从绕组末端引入；时间继电器用通电延时型，延时闭合（常开）和延时断开（常闭）触点不能接反；每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上 QF，按 SB2：KM1、KM3 吸合星形起动，KT 计时到后自动换成三角形（KM3 释放、KM2 吸合）；按 SB1 停止。',
  runMsg: '空开已合闸，按 SB2 星形起动，KT 到时自动换三角形；SB1 停止（原理图同步发光）',
  answers: [
    { name: '教材图 2-12 接法', desc: '4号线 SB2→KT延时闭合→KM2自锁→KM1线圈→KM1自锁→KM2常闭；7号线 KT延时断开入口和线圈 A1 短接', chains: {} },
    { name: '就近并接', desc: '电动机末端先接 KM3 再接 KM2；FU1 出线先接 KM2 再接 KM1；零线依次 KT→KM3→KM2→KM1',
      chains: {
        W11: ['QF.b2', 'FU2.t', 'FU1.t2'],
        U12: ['FU1.b0', 'KM2.t0', 'KM1.t0'], V12: ['FU1.b1', 'KM2.t1', 'KM1.t1'], W12: ['FU1.b2', 'KM2.t2', 'KM1.t2'],
        W2: ['M.t3', 'KM3.t0', 'KM2.b0'], U2: ['M.t4', 'KM3.t1', 'KM2.b1'], V2: ['M.t5', 'KM3.t2', 'KM2.b2'],
        Y: ['KM3.b0', 'KM3.b2', 'KM3.b1'], N: ['QF.b3', 'KT.a2', 'KM3.b5', 'KM2.b5', 'KM1.b5'],
      } },
    { name: '入口出口法', desc: '4号线从 SB2 出依次接 KM1自锁 出、KM1 线圈、KT 延时闭合入口、KM2 自锁和常闭入口；5、7号线按入口出口顺序串接',
      chains: { 4: ['SB2.o', 'KM1.b3', 'KM1.t5', 'KT.ni', 'KM2.t3', 'KM2.t4'], 5: ['KT.no', 'KM2.b3', 'KM3.t4'], 7: ['KM2.b4', 'KT.ci', 'KT.a1'] } },
  ],
  groups: [
    { name: '主电路 · 电源分配', nets: ['W11'], why: 'QF 出线 L3（W11）要同时接 FU1 和控制熔断器 FU2：QF 出、FU1 入、FU2 入是同一个点。' },
    { name: '主电路 · KM1 和 KM2 进线并接', nets: ['U12', 'V12', 'W12'], why: 'FU1 出线同时送到 KM1、KM2 的主触点上端：FU1 出、KM1 入、KM2 入是同一个点。' },
    { name: '主电路 · 绕组末端（三角形 / 星形）', nets: ['W2', 'U2', 'V2'], why: 'KM2 下端、KM3 下端、电动机末端是同一个点。KM2 闭合：U1–W2、V1–U2、W1–V2 接成三角形；KM3 闭合：三个末端经 KM3 上端的星点短接成星形。KM3 必须接末端，接首端会三相短路。' },
    { name: '主电路 · 星点', nets: ['Y'], why: 'KM3 上端三个端子短接在一起就是星点。' },
    { name: '控制电路 · 自锁起点（3号线）', nets: ['3'], why: 'SB1 出口 = SB2 入口 = KM1 自锁入口。' },
    { name: '控制电路 · 4号线（6 个端子）', nets: ['4'], why: 'SB2 出 = KM1自锁 出 = KM1线圈 入 = KT延时闭合 入 = KM2自锁 入 = KM2常闭 入：KM1 吸合后给三角形和星形两条支路供电，6!/2 = 360 种串法。' },
    { name: '控制电路 · 5号线、7号线', nets: ['5', '7'], why: '5号线 = KT延时闭合 出 + KM2自锁 出 + KM3常闭 入（三角形支路的并联终点）；7号线 = KM2常闭 出 + KT线圈 入 + KT延时断开 入（KT 线圈和延时断开触点从同一点取电）。' },
    { name: '零线', nets: ['N'], why: '从 QF 的 N 接到 KM1、KM2、KM3、KT 四个线圈的 A2，五个端子任意串接，共 60 种。' },
  ],
};
