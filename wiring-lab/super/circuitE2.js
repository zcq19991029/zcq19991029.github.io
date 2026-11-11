// 扩展练习 题二（电工中级·四级 应会实操）：C6140T 型卧式车床电气控制线路（教材 p85～90，图 3-6～3-8；PDF 在 电工题库/C6140T-教材p85-90.pdf）
// 主电路：QF1（实训台空开）→ U11/V11/W11。KM1 → M1 主轴电动机（U12/V12/W12）；KM2（接在 KM1 出线上）→ QF2 → M2 冷却泵；
// FU1 → U21/V21/W21 → KM3 → M3 快速移动电动机；U21、W21 同时接控制变压器 TC 原边（380 V）。
// 能耗制动：V11 → FU2 → 201 → KM4 → 202 → VD → 203 → KM4 → W12；U11 → KM4 → U12；KM4 的常开（13/14）当第 4 极把 V12、W12 短接，
// 直流加在 M1 两相绕组上。控制电源 TC 127 V：001 → FU5 → 002，回 000。
// 002 → SQ1 常闭 ∥ KT 常闭（断电延时型，瞬时断开、延时闭合）→ 003 → SB1 → 004 → SB2（并 KM1 自锁）→ 005 → KM4 常闭 → 006 → KM1、KM2 线圈；
// 003 → SB3（点动）→ 007 → KM3 线圈；
// 002 → SQ1 常开 → 012 → KM1 常开（辅助）→ 013 → KM1 常闭 → 014 → KM2 常闭 → 015 → KM4 线圈；002 → KT 常开（瞬时闭合、延时断开）→ 013；
// 013 → KM4 常闭（辅助）→ 016 → KT 线圈。
// 停车：运行中压下 SQ1 → KT 得电，KT、SQ1 两个常闭都断开 → KM1、KM2 释放 → KM4 吸合制动 → KM4 常闭断开 KT → 延时到，KT 常开断开 → KM4 释放。
// 本题不接：电流表 TA、照明和信号（FU3/FU4、S、EL、HL1～HL3）。

// ---------- 实物板 ----------
const TP = {};
QF_POLES.forEach((p, i) => { TP['QF.t' + i] = [870 + 60 * i, 162]; TP['QF.b' + i] = [870 + 60 * i, 288]; });
for (let i = 0; i < 3; i++) { TP['FU1.t' + i] = [1170 + 70 * i, 162]; TP['FU1.b' + i] = [1170 + 70 * i, 288]; }
TP['FU2.t'] = [1400, 162]; TP['FU2.b'] = [1400, 288]; TP['FU5.t'] = [1460, 162]; TP['FU5.b'] = [1460, 288];
const BTN = { SB1: [1560, '#ef4444', '停止'], SB2: [1690, '#22c55e', '起动'], SB3: [1820, '#f59e0b', '快移'] };
for (const k in BTN) { const x = BTN[k][0]; TP[k + '.i'] = [x - 26, 270]; TP[k + '.o'] = [x + 26, 270]; }
const KMX = { KM1: 830, KM2: 1090, KM3: 1350, KM4: 1610 };
for (const k in KMX) for (let c = 0; c < 6; c++) { TP[k + '.t' + c] = [KMX[k] + 25 + 40 * c, 502]; TP[k + '.b' + c] = [KMX[k] + 25 + 40 * c, 662]; }
// 第三排：KM1 辅助常开、KM4 辅助常闭、SQ1、KT、VD、TC、QF2（上排端子 y 772，下排 y 872）
const R3 = [772, 872];
TP['KM1.t6'] = [855, R3[0]]; TP['KM1.b6'] = [855, R3[1]]; TP['KM4.t6'] = [925, R3[0]]; TP['KM4.b6'] = [925, R3[1]];
[995, 1035].forEach((x, i) => { TP['SQ1.t' + i] = [x, R3[0]]; TP['SQ1.b' + i] = [x, R3[1]]; }); // 0 常闭、1 常开
const SQ_LEVER = [1078, 822];
[1148, 1188, 1228].forEach((x, i) => { TP['KT.t' + i] = [x, R3[0]]; TP['KT.b' + i] = [x, R3[1]]; }); // 0 常闭、1 常开、2 线圈
TP['VD.t0'] = [1371, R3[0]]; TP['VD.b0'] = [1371, R3[1]]; // 上端阳极（202）、下端阴极（203）
TP['TC.t0'] = [1444, R3[0]]; TP['TC.t1'] = [1530, R3[0]]; TP['TC.b0'] = [1444, R3[1]]; TP['TC.b1'] = [1530, R3[1]]; // 原边 380 V；副边 127 V（001）、0（000）
[1606, 1646, 1686].forEach((x, i) => { TP['QF2.t' + i] = [x, R3[0]]; TP['QF2.b' + i] = [x, R3[1]]; });
const QF2_LEVER = [1738, 822];
// 第四排：三台电动机接线盒
const MOT = { M1: [840, '主轴电动机'], M2: [1180, '冷却泵电动机'], M3: [1520, '快速移动电动机'] };
for (const m in MOT) for (let i = 0; i < 3; i++) TP[m + '.t' + i] = [MOT[m][0] + 60 + 50 * i, 962];

function termName(k) {
  const [d, t] = k.split('.'), i = +t.slice(1), top = t[0] === 't';
  if (d === 'QF') return `QF1 ${top ? '进线' : '出线'} ${QF_POLES[i]}`;
  if (d === 'FU1') return `FU1 ${top ? '进线' : '出线'}`;
  if (d === 'FU2') return `FU2 ${top ? '进线' : '出线'}`;
  if (d === 'FU5') return `FU5 ${top ? '进线' : '出线'}`;
  if (d === 'QF2') return `QF2 ${top ? '进线' : '出线'} ${'UVW'[i]}`;
  if (d === 'SQ1') return `SQ1 ${i ? '常开' : '常闭'}${top ? '上端' : '下端'}`;
  if (d === 'KT') return `KT ${['延时闭合常闭', '延时断开常开', '线圈'][i]}${i === 2 ? (top ? ' A1' : ' A2') : top ? '上端' : '下端'}`;
  if (d === 'VD') return `二极管 VD ${top ? '阳极' : '阴极'}`;
  if (d === 'TC') return top ? `TC 原边 ${i ? '380V' : '0'}` : `TC 副边 ${i ? '0（000）' : '127V（001）'}`;
  if (MOT[d]) return `${d} 接线盒 ${'UVW'[i]}`;
  if (/^KM/.test(d)) {
    if (i === 6) return d === 'KM1' ? `KM1 辅助常开 ${top ? '43' : '44'}` : `KM4 辅助常闭 ${top ? '31' : '32'}`;
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `${d} ${i < 3 ? (top ? '主触点进线 ' : '主触点出线 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return `${d} ${t === 'i' ? '入口' : '出口'}`;
  return k;
}

// 导线（教材顺序：主电路、制动、控制电路 001～016、000）。走线由练习页自动生成
const BW = [];
const bw = (id, net, a, b) => BW.push({ id, net, a, b, pts: null, sch: [] });
bw('U11a', 'U11', 'QF.b0', 'FU1.t0'); bw('U11b', 'U11', 'FU1.t0', 'KM1.t0'); bw('U11c', 'U11', 'KM1.t0', 'KM4.t0');
bw('V11a', 'V11', 'QF.b1', 'FU1.t1'); bw('V11b', 'V11', 'FU1.t1', 'KM1.t1'); bw('V11c', 'V11', 'KM1.t1', 'FU2.t');
bw('W11a', 'W11', 'QF.b2', 'FU1.t2'); bw('W11b', 'W11', 'FU1.t2', 'KM1.t2');
bw('U12a', 'U12', 'KM1.b0', 'M1.t0'); bw('U12b', 'U12', 'KM1.b0', 'KM2.t0'); bw('U12c', 'U12', 'KM2.t0', 'KM4.b0');
bw('V12a', 'V12', 'KM1.b1', 'M1.t1'); bw('V12b', 'V12', 'KM1.b1', 'KM2.t1'); bw('V12c', 'V12', 'KM2.t1', 'KM4.t3');
bw('W12a', 'W12', 'KM1.b2', 'M1.t2'); bw('W12b', 'W12', 'KM1.b2', 'KM2.t2'); bw('W12c', 'W12', 'KM2.t2', 'KM4.b3'); bw('W12d', 'W12', 'KM4.b3', 'KM4.b2');
bw('U13', 'U13', 'KM2.b0', 'QF2.t0'); bw('V13', 'V13', 'KM2.b1', 'QF2.t1'); bw('W13', 'W13', 'KM2.b2', 'QF2.t2');
bw('U14', 'U14', 'QF2.b0', 'M2.t0'); bw('V14', 'V14', 'QF2.b1', 'M2.t1'); bw('W14', 'W14', 'QF2.b2', 'M2.t2');
bw('U21a', 'U21', 'FU1.b0', 'KM3.t0'); bw('U21b', 'U21', 'KM3.t0', 'TC.t0');
bw('V21', 'V21', 'FU1.b1', 'KM3.t1');
bw('W21a', 'W21', 'FU1.b2', 'KM3.t2'); bw('W21b', 'W21', 'KM3.t2', 'TC.t1');
bw('U22', 'U22', 'KM3.b0', 'M3.t0'); bw('V22', 'V22', 'KM3.b1', 'M3.t1'); bw('W22', 'W22', 'KM3.b2', 'M3.t2');
bw('c201', '201', 'FU2.b', 'KM4.t1'); bw('c202', '202', 'KM4.b1', 'VD.t0'); bw('c203', '203', 'VD.b0', 'KM4.t2');
bw('c001', '001', 'TC.b0', 'FU5.t');
bw('c002a', '002', 'FU5.b', 'SQ1.t0'); bw('c002b', '002', 'SQ1.t0', 'SQ1.t1'); bw('c002c', '002', 'SQ1.t1', 'KT.t0'); bw('c002d', '002', 'KT.t0', 'KT.t1');
bw('c003a', '003', 'SQ1.b0', 'KT.b0'); bw('c003b', '003', 'KT.b0', 'SB1.i'); bw('c003c', '003', 'SB1.i', 'SB3.i');
bw('c004a', '004', 'SB1.o', 'SB2.i'); bw('c004b', '004', 'SB2.i', 'KM1.t3');
bw('c005a', '005', 'SB2.o', 'KM1.b3'); bw('c005b', '005', 'KM1.b3', 'KM4.t4');
bw('c006a', '006', 'KM4.b4', 'KM1.t5'); bw('c006b', '006', 'KM1.t5', 'KM2.t5');
bw('c007', '007', 'SB3.o', 'KM3.t5');
bw('c012', '012', 'SQ1.b1', 'KM1.t6');
bw('c013a', '013', 'KM1.b6', 'KT.b1'); bw('c013b', '013', 'KM1.b6', 'KM1.t4'); bw('c013c', '013', 'KM1.t4', 'KM4.t6');
bw('c014', '014', 'KM1.b4', 'KM2.t4'); bw('c015', '015', 'KM2.b4', 'KM4.t5'); bw('c016', '016', 'KM4.b6', 'KT.t2');
bw('c000a', '000', 'TC.b1', 'KT.b2'); bw('c000b', '000', 'KM1.b5', 'KM2.b5'); bw('c000c', '000', 'KM2.b5', 'KM3.b5'); bw('c000d', '000', 'KM3.b5', 'KM4.b5'); bw('c000e', '000', 'KM4.b5', 'KT.b2');
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路。控制电源用两条假想的边接到 TC 副边：原边接上两相电（derive 算出 tc）时才有 127 V
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i }, { id: 'QF2' + i, a: 'QF2.t' + i, b: 'QF2.b' + i, on: s => s.QF2 });
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FU5', a: 'FU5.t', b: 'FU5.b' });
for (const n of [1, 2, 3, 4]) {
  const k = 'KM' + n, on = s => s['km' + n];
  for (let c = 0; c < 3; c++) BE.push({ id: k + 'm' + c, a: k + '.t' + c, b: k + '.b' + c, on });
  BE.push({ id: k + 'no', a: k + '.t3', b: k + '.b3', on }, { id: k + 'nc', a: k + '.t4', b: k + '.b4', on: s => !on(s) }, { id: k + 'coil', a: k + '.t5', b: k + '.b5', load: true });
}
BE.push({ id: 'KM1no2', a: 'KM1.t6', b: 'KM1.b6', on: s => s.km1 }, { id: 'KM4nc2', a: 'KM4.t6', b: 'KM4.b6', on: s => !s.km4 });
BE.push({ id: 'SB1', a: 'SB1.i', b: 'SB1.o', on: s => !s.SB1 }, { id: 'SB2', a: 'SB2.i', b: 'SB2.o', on: s => s.SB2 }, { id: 'SB3', a: 'SB3.i', b: 'SB3.o', on: s => s.SB3 });
BE.push({ id: 'SQ1nc', a: 'SQ1.t0', b: 'SQ1.b0', on: s => !s.SQ1 }, { id: 'SQ1no', a: 'SQ1.t1', b: 'SQ1.b1', on: s => s.SQ1 });
BE.push({ id: 'KTnc', a: 'KT.t0', b: 'KT.b0', on: s => !s.ktc }, { id: 'KTno', a: 'KT.t1', b: 'KT.b1', on: s => s.ktc }, { id: 'KTcoil', a: 'KT.t2', b: 'KT.b2', load: true });
BE.push({ id: 'VD', a: 'VD.t0', b: 'VD.b0' }, { id: 'TCp', a: 'TC.t0', b: 'TC.t1', load: true });
BE.push({ id: 'TCs', a: 'TC.src', b: 'TC.b0', on: s => s.tc }, { id: 'TCz', a: 'TC.zero', b: 'TC.b1', on: s => s.tc });

// ---------- 原理图（设计坐标）----------
const SCH = { x: 34, y: 112, s: 0.66 };
const X = [60, 120, 180], X2 = [450, 510, 570], X3 = [640, 700, 760], PU = ['U', 'V', 'W'], BY = [380, 400, 460];
const A = 930, A2 = 995, B = 1060, Cc = 1125, D = 1190, D2 = 1255, E = 1320, NB = 680; // 控制电路各列；NB：000 号线（底线）
const SE = [];
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
const M1C = [120, 540, 44], M2C = [510, 655, 36], M3C = [700, 380, 40];
const MH1 = [[88, 512], [120, 496], [152, 512]], MH2 = [[482, 637], [510, 619], [538, 637]], MH3 = [[671, 352], [700, 340], [729, 352]];
for (let i = 0; i < 3; i++) {
  const x = X[i], p = PU[i];
  w('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  el('QF' + i, 'qf', x, 70, 120, 'qa' + i, 'q' + i, s => s.QF);
  w('w11a' + i, p + '11', [[x, 120], [x, 140 + 10 * i]], 'q' + i, 'j11' + i);
  w('w11b' + i, p + '11', [[x, 140 + 10 * i], [x, 250]], 'j11' + i, 'k1a' + i);
  el('KM1' + i, 'km', x, 250, 300, 'k1a' + i, 'k1b' + i, s => s.km1);
  w('wk1b' + i, p + '12', [[x, 300], [x, BY[i]]], 'k1b' + i, 'b12' + i);
  w('wm1' + i, p + '12', [[[60, 380], [60, 490], MH1[0]], [[120, 400], MH1[1]], [[180, 460], [180, 490], MH1[2]]][i], 'b12' + i, 'm1h' + i);
  el('FU1' + i, 'fuse', X3[i], 175, 220, 'fa' + i, 'fb' + i);
  // M2：KM2 接在 KM1 出线上 → QF2 → M2
  el('KM2' + i, 'km', X2[i], 480, 525, 'k2a' + i, 'k2b' + i, s => s.km2);
  w('wk2b' + i, p + '13', [[X2[i], 525], [X2[i], 550]], 'k2b' + i, 'q2a' + i);
  el('QF2_' + i, 'qf', X2[i], 550, 595, 'q2a' + i, 'q2b' + i, s => s.QF2);
  w('wm2' + i, p + '14', [[[450, 595], [450, 610], MH2[0]], [[510, 595], MH2[1]], [[570, 595], [570, 610], MH2[2]]][i], 'q2b' + i, 'm2h' + i);
  // M3：FU1 → KM3 → M3
  el('KM3' + i, 'km', X3[i], 250, 300, 'k3a' + i, 'k3b' + i, s => s.km3);
  w('wm3' + i, p + '22', [[[640, 300], [640, 330], MH3[0]], [[700, 300], MH3[1]], [[760, 300], [760, 330], MH3[2]]][i], 'k3b' + i, 'm3h' + i);
}
// U11、V11、W11 向右分出：KM4 制动和 FU1
w('t11u1', 'U11', [[60, 140], [250, 140]], 'j110', 'tu1'); w('t11u2', 'U11', [[250, 140], [250, 250]], 'tu1', 'k4a0'); w('t11u3', 'U11', [[250, 140], [640, 140], [640, 175]], 'tu1', 'fa0');
w('t11v1', 'V11', [[120, 150], [310, 150]], 'j111', 'tv1'); w('t11v2', 'V11', [[310, 150], [310, 165]], 'tv1', 'f2a'); w('t11v3', 'V11', [[310, 150], [700, 150], [700, 175]], 'tv1', 'fa1');
w('t11w1', 'W11', [[180, 160], [760, 160], [760, 175]], 'j112', 'fa2');
// 能耗制动：U11 → KM4 → U12；V11 → FU2 → 201 → KM4 → 202 → VD → 203 → KM4 → W12；KM4 常开把 V12、W12 短接
el('KM40', 'km', 250, 250, 300, 'k4a0', 'k4b0', s => s.km4);
w('wk4b0', 'U12', [[250, 300], [250, 380]], 'k4b0', 'bu2');
el('FU2', 'fuse', 310, 165, 205, 'f2a', 'f2b');
w('w201', '201', [[310, 205], [310, 215]], 'f2b', 'k4a1');
el('KM41', 'km', 310, 215, 260, 'k4a1', 'k4b1', s => s.km4);
w('w202', '202', [[310, 260], [310, 268]], 'k4b1', 'vda');
el('VD', 'none', 310, 268, 300, 'vda', 'vdb');
w('w203', '203', [[310, 300], [310, 310]], 'vdb', 'k4a2');
el('KM42', 'km', 310, 310, 355, 'k4a2', 'k4b2', s => s.km4);
w('wk4b2', 'W12', [[310, 355], [310, 460]], 'k4b2', 'bw2');
el('KM4_NO', 'km', 370, 400, 460, 'bv3', 'bw3', s => s.km4);
// U12、V12、W12 横线：接 KM4 和 KM2
w('bu1', 'U12', [[60, 380], [250, 380]], 'b120', 'bu2'); w('bu2s', 'U12', [[250, 380], [450, 380], [450, 480]], 'bu2', 'k2a0');
w('bv1', 'V12', [[120, 400], [370, 400]], 'b121', 'bv3'); w('bv2', 'V12', [[370, 400], [510, 400], [510, 480]], 'bv3', 'k2a1');
w('bw1', 'W12', [[180, 460], [310, 460]], 'b122', 'bw2'); w('bw1b', 'W12', [[310, 460], [370, 460]], 'bw2', 'bw3'); w('bw2s', 'W12', [[370, 460], [570, 460], [570, 480]], 'bw3', 'k2a2');
// FU1 出线 U21/V21/W21：KM3，U21、W21 接 TC 原边
w('w21a', 'U21', [[640, 220], [640, 232]], 'fb0', 'ju21'); w('w21b', 'U21', [[640, 232], [640, 250]], 'ju21', 'k3a0');
w('w21v', 'V21', [[700, 220], [700, 250]], 'fb1', 'k3a1');
w('w21c', 'W21', [[760, 220], [760, 240]], 'fb2', 'jw21'); w('w21d', 'W21', [[760, 240], [760, 250]], 'jw21', 'k3a2');
w('w21t', 'U21', [[640, 232], [790, 232], [790, 48], [810, 48], [810, 60]], 'ju21', 'tp1');
w('w21u', 'W21', [[760, 240], [810, 240], [810, 120]], 'jw21', 'tp2');
SE.push({ id: 'TC_P', kind: 'none', x: 810, y1: 60, y2: 120, a: 'tp1', b: 'tp2', load: true, pts: [[810, 60], [810, 120]] });
SE.push({ id: 'TC_S', kind: 'none', x: 840, y1: 60, y2: 120, a: 'ts1', b: 'ts0', on: () => false, pts: [[840, 60], [840, 120]] }); // 副边不是导线：只画出来
SE.push({ id: 'TCsrc', kind: 'none', a: 'TCsrc', b: 'ts1', on: s => s.tc, pts: [[840, 60], [840, 60]] }, { id: 'TCzero', kind: 'none', a: 'TCzero', b: 'ts0', on: s => s.tc, pts: [[840, 120], [840, 120]] });
// 电动机绕组（看不见的负载）
[[MH1, 'm1h'], [MH2, 'm2h'], [MH3, 'm3h']].forEach(([MH, h], m) => [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => SE.push({ id: 'MW' + m + a + b, kind: 'none', a: h + a, b: h + b, load: true, pts: [MH[a], MH[b]] })));
// 控制电路：TC 127 V → 001 → FU5 → 002
w('w001', '001', [[840, 60], [840, 40], [860, 40]], 'ts1', 'f5a');
SE.push({ id: 'FU5', kind: 'fuseH', x1: 860, x2: 900, y: 40, a: 'f5a', b: 'f5b', pts: [[860, 40], [900, 40]] });
w('w2a', '002', [[900, 40], [A, 40]], 'f5b', 'j2a'); w('w2b', '002', [[A, 40], [A2, 40]], 'j2a', 'j2b'); w('w2c', '002', [[A2, 40], [D, 40]], 'j2b', 'j2c'); w('w2d', '002', [[D, 40], [D2, 40]], 'j2c', 'j2d');
// 002 → SQ1 常闭 ∥ KT 常闭 → 003
w('w2A', '002', [[A, 40], [A, 70]], 'j2a', 'sq1a'); el('SQ1_NC', 'sqnc', A, 70, 115, 'sq1a', 'sq1b', s => !s.SQ1); w('w3A', '003', [[A, 115], [A, 135]], 'sq1b', 'j3a');
w('w2A2', '002', [[A2, 40], [A2, 70]], 'j2b', 'ktna'); el('KT_NC', 'onc', A2, 70, 115, 'ktna', 'ktnb', s => !s.ktc);
w('w3A2', '003', [[A2, 115], [A2, 135]], 'ktnb', 'j3b'); w('w3x', '003', [[A2, 135], [A, 135]], 'j3b', 'j3a');
// 003 → SB1 → 004 → SB2 ∥ KM1 自锁 → 005 → KM4 常闭 → 006 → KM1、KM2 线圈
w('w3b', '003', [[A, 135], [A, 155]], 'j3a', 'sb1a'); el('SB1', 'bnc', A, 155, 200, 'sb1a', 'sb1b', s => !s.SB1);
w('w4a', '004', [[A, 200], [A, 220]], 'sb1b', 'j4'); w('w4b', '004', [[A, 220], [A, 240]], 'j4', 'sb2a'); el('SB2', 'bno', A, 240, 285, 'sb2a', 'sb2b', s => s.SB2);
w('w4c', '004', [[A, 220], [A2, 220], [A2, 240]], 'j4', 'k1na'); el('KM1_NO', 'no', A2, 240, 285, 'k1na', 'k1nb', s => s.km1);
w('w5a', '005', [[A, 285], [A, 305]], 'sb2b', 'j5'); w('w5b', '005', [[A2, 285], [A2, 305], [A, 305]], 'k1nb', 'j5');
w('w5c', '005', [[A, 305], [A, 325]], 'j5', 'k4ca'); el('KM4_NC', 'nc', A, 325, 370, 'k4ca', 'k4cb', s => !s.km4);
w('w6a', '006', [[A, 370], [A, 390]], 'k4cb', 'j6'); w('w6b', '006', [[A, 390], [A, 560]], 'j6', 'c1a'); w('w6c', '006', [[A, 390], [B, 390], [B, 560]], 'j6', 'c2a');
el('KM1_coil', 'coil', A, 560, 600, 'c1a', 'c1b', null, { load: true }); el('KM2_coil', 'coil', B, 560, 600, 'c2a', 'c2b', null, { load: true });
// 003 → SB3（点动）→ 007 → KM3 线圈
w('w3c', '003', [[A2, 135], [Cc, 135], [Cc, 240]], 'j3b', 'sb3a'); el('SB3', 'bno', Cc, 240, 285, 'sb3a', 'sb3b', s => s.SB3);
w('w7', '007', [[Cc, 285], [Cc, 560]], 'sb3b', 'c3a'); el('KM3_coil', 'coil', Cc, 560, 600, 'c3a', 'c3b', null, { load: true });
// 制动：002 → SQ1 常开 → 012 → KM1 常开 → 013（KT 常开并联）→ KM1 常闭 → 014 → KM2 常闭 → 015 → KM4 线圈；013 → KM4 常闭 → 016 → KT 线圈
w('w2D', '002', [[D, 40], [D, 70]], 'j2c', 'sq2a'); el('SQ1_NO', 'sqno', D, 70, 115, 'sq2a', 'sq2b', s => s.SQ1);
w('w12', '012', [[D, 115], [D, 155]], 'sq2b', 'k1n2a'); el('KM1_NO2', 'no', D, 155, 200, 'k1n2a', 'k1n2b', s => s.km1);
w('w13a', '013', [[D, 200], [D, 220]], 'k1n2b', 'j13a');
w('w2D2', '002', [[D2, 40], [D2, 120]], 'j2d', 'ktoa'); el('KT_NO', 'ono', D2, 120, 165, 'ktoa', 'ktob', s => s.ktc);
w('w13b', '013', [[D2, 165], [D2, 220]], 'ktob', 'j13b'); w('w13c', '013', [[D2, 220], [D, 220]], 'j13b', 'j13a');
w('w13d', '013', [[D, 220], [D, 260]], 'j13a', 'k1ca'); el('KM1_NC', 'nc', D, 260, 305, 'k1ca', 'k1cb', s => !s.km1);
w('w14', '014', [[D, 305], [D, 325]], 'k1cb', 'k2ca'); el('KM2_NC', 'nc', D, 325, 370, 'k2ca', 'k2cb', s => !s.km2);
w('w15', '015', [[D, 370], [D, 560]], 'k2cb', 'c4a'); el('KM4_coil', 'coil', D, 560, 600, 'c4a', 'c4b', null, { load: true });
w('w13e', '013', [[D2, 220], [E, 220], [E, 260]], 'j13b', 'k4c2a'); el('KM4_NC2', 'nc', E, 260, 305, 'k4c2a', 'k4c2b', s => !s.km4);
w('w16', '016', [[E, 305], [E, 560]], 'k4c2b', 'kta'); el('KT_coil', 'coil', E, 560, 600, 'kta', 'ktb', null, { load: true });
// 000：TC 副边下端沿底线接到五个线圈
w('w0up', '000', [[840, 120], [840, NB], [A, NB]], 'ts0', 'n0a');
[[A, 'c1b', 'n0a'], [B, 'c2b', 'n0b'], [Cc, 'c3b', 'n0c'], [D, 'c4b', 'n0d'], [E, 'ktb', 'n0e']].forEach(([x, a, b], i, arr) => {
  w('w0c' + i, '000', [[x, 600], [x, NB]], a, b);
  if (i) w('w0b' + i, '000', [[arr[i - 1][0], NB], [x, NB]], arr[i - 1][2], b);
});
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
// 电动机接线盒端子在原理图上的位置（只给提示用，不参与计算）
[[MH1, 'M1'], [MH2, 'M2'], [MH3, 'M3']].forEach(([MH, m]) => MH.forEach(([x, y], i) => (SEID[m + 'h' + i] = { kind: 'none', x, y1: y, y2: y })));
BW.forEach(x => (x.sch = SE.filter(e => e.kind === 'w' && e.net === x.net).map(e => e.id)));
const EDGE_T = {}, EDGE_COL = {};
function schSolve(s) { return solve('schE2', SE, s, ['L1', 'TCsrc'], ['L2', 'L3', 'TCzero'], [s.QF, s.QF2, s.SQ1, s.SB1, s.SB2, s.SB3, s.km1, s.km2, s.km3, s.km4, s.ktc, s.tc].join('')); }
function schMotor(c, label, run, sub) {
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); g.stroke(); g.restore();
  text('M', c[0], c[1] - 9, 24, C.ink, 'center', 'bold'); text('3~', c[0], c[1] + 14, 16);
  text(label, c[0] + c[2] + 8, c[1] - 8, 16, run ? C.cur : C.ink, 'left', 'bold'); text(sub, c[0] + c[2] + 8, c[1] + 12, 12, C.dim, 'left');
}
function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil', 'KM2_coil', 'KM3_coil', 'KM4_coil', 'KT_coil'].filter(id => R.cur.has(id)));
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
  // 二极管 VD（三角形尖朝下：电流从 202 流向 203）
  const vOn = R.cur.has('VD'), vc = vOn ? C.cur : C.ink;
  g.save(); g.strokeStyle = vc; g.fillStyle = vc; g.lineWidth = 2.5; if (vOn) { g.shadowColor = C.cur; g.shadowBlur = 14; }
  g.beginPath(); g.moveTo(310, 268); g.lineTo(310, 276); g.moveTo(298, 276); g.lineTo(322, 276); g.lineTo(310, 292); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(298, 292); g.lineTo(322, 292); g.moveTo(310, 292); g.lineTo(310, 300); g.stroke(); g.restore();
  // 控制变压器 TC：原边、副边两个线圈
  const tOn = R.cur.has('TC_P'), tcCol = tOn ? C.cur : C.ink;
  g.save(); g.strokeStyle = tcCol; g.lineWidth = 2.5; if (tOn) { g.shadowColor = C.cur; g.shadowBlur = 12; }
  for (const [x, sg] of [[810, 1], [840, -1]]) { g.beginPath(); for (let k = 0; k < 4; k++) g.arc(x, 67.5 + 15 * k, 7.5, -Math.PI / 2, Math.PI / 2, sg < 0); g.stroke(); }
  poly([[825, 58], [825, 122]], tcCol, 2); g.restore();
  for (let i = 0; i < 3; i++) { dot(X[i], 140 + 10 * i, 4.5, C.ink); dot(X[i], BY[i], 4.5, C.ink); }
  [[250, 140], [310, 150], [250, 380], [310, 460], [370, 400], [370, 460], [640, 232], [760, 240], [A, 40], [A2, 40], [D, 40], [A, 135], [A2, 135], [A, 220], [A, 305], [A, 390], [D, 220], [D2, 220], [A, NB], [B, NB], [Cc, NB], [D, NB]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  poly([[X[0] - 8, 95], [X[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  [X, X3].forEach(xs => poly([[xs[0] - 8, 275], [xs[2] + 4, 275]], C.ink, 1.5, [6, 5]));
  poly([[X2[0] - 8, 502], [X2[2] + 4, 502]], C.ink, 1.5, [6, 5]); poly([[X2[0] - 8, 572], [X2[2] + 4, 572]], C.ink, 1.5, [6, 5]);
  poly([[242, 275], [302, 237]], C.ink, 1.5, [6, 5]); poly([[302, 237], [302, 332]], C.ink, 1.5, [6, 5]); poly([[302, 332], [362, 430]], C.ink, 1.5, [6, 5]); // KM4 四个触点联动
  schMotor(M1C, 'M1', Math.abs(s.w) > 0.05, '主轴'); schMotor(M2C, 'M2', !!(s.QF && PS.m2 && PS.m2.dir), '冷却泵'); schMotor(M3C, 'M3', !!(s.QF && PS.m3 && PS.m3.dir), '快移');
  for (let i = 0; i < 3; i++) {
    text(PH[i], X[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(X[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
  }
  text('QF1', 196, 95, 18, C.ink, 'left', 'bold'); text('FU1', 776, 198, 16, C.ink, 'left', 'bold'); text('FU2', 322, 186, 14, C.ink, 'left', 'bold'); text('VD', 322, 284, 14, C.ink, 'left', 'bold');
  text('U11', 66, 132, 12, C.dim, 'left'); text('U12', 66, 372, 12, C.dim, 'left'); text('U21', 646, 244, 12, C.dim, 'left'); text('201', 316, 210, 11, C.dim, 'left'); text('202', 316, 264, 11, C.dim, 'left'); text('203', 316, 305, 11, C.dim, 'left');
  text('KM1', 196, 268, 16, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('KM4', 212, 236, 15, s.km4 ? C.cur : C.ink, 'left', 'bold'); text('KM4', 382, 430, 14, s.km4 ? C.cur : C.ink, 'left', 'bold');
  text('KM3', 776, 268, 16, s.km3 ? C.cur : C.ink, 'left', 'bold'); text('KM2', 586, 502, 16, s.km2 ? C.cur : C.ink, 'left', 'bold'); text('QF2', 586, 572, 16, s.QF2 ? C.ok : C.ink, 'left', 'bold');
  text('TC', 825, 140, 16, C.ink, 'center', 'bold'); text('FU5', 880, 20, 15, C.ink, 'center', 'bold'); text('127V', 846, 86, 11, C.dim, 'left');
  const L = (s2, x, y, on) => text(s2, x, y, 14, on ? C.cur : C.ink, 'right', 'bold');
  L('SQ1', A - 18, 92); L('SB1', A - 40, 177); L('SB2', A - 40, 262); L('KM4', A - 18, 347);
  text('KT', A2 + 10, 92, 14, C.ink, 'left', 'bold'); text('KM1', A2 + 8, 262, 14, s.km1 ? C.cur : C.ink, 'left', 'bold'); L('SB3', Cc - 40, 262);
  L('SQ1', D - 18, 92); L('KM1', D - 18, 177); text('KT', D2 + 10, 142, 14, C.ink, 'left', 'bold'); L('KM1', D - 18, 282); L('KM2', D - 18, 347); text('KM4', E + 12, 282, 14, C.ink, 'left', 'bold');
  [['KM1', A, s.km1], ['KM2', B, s.km2], ['KM3', Cc, s.km3], ['KM4', D, s.km4], ['KT', E, s._coil.has('KT_coil')]].forEach(([n, x, on]) => text(n, x, 616, 14, on ? C.cur : C.ink, 'center', 'bold'));
  [['001', 842, 30], ['002', 908, 30], ['003', A, 146], ['004', A, 210], ['005', A, 316], ['006', A, 470], ['007', Cc, 470], ['012', D, 136], ['013', D, 240], ['014', D, 316], ['015', D, 470], ['016', E, 470], ['000', 848, 400]]
    .forEach(([n, x, y]) => text(n, x + 6, y, 12, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const KT_DIAL = [1282, 808], KT_STEP = { minus: [1260, 860], plus: [1304, 860] };
const MV = { m2: 0, m3: 0, a1: 0, a2: 0, a3: 0, t: 0 }; // 实物板上 M2、M3 风扇转速和角度（M1 用 PS.w）
// 拨杆开关、接线盒的画法都在 devices.js 里（DEV.lever / DEV.m3），练习页和超级排位共用一份
const CIRCUIT = {
  id: 'E2', key: 'zfz-practice-E2', schW: 1370, ext: true,
  title: '电工中级 · C6140T 卧式车床 · 接线练习',
  kms: ['KM1', 'KM2', 'KM3', 'KM4'], labels: {}, kmX: KMX, noWire: /^QF\.t|^QF\.b3$/,
  boardBox: [806, 100, 1088, 1000], rails: [225, 580, 822], noFR: true,
  ctrlTerm: /^(FU5|SB|KT|SQ1|TC\.b)|^KM\d\.[tb][4-6]$|^KM[1-3]\.[tb]3$/,
  switches: { SQ1: 0, QF2: 0 },
  nEnd: null, motorAt: M1C,
  srcs: ['QF.t0', 'TC.src'], sinks: ['QF.t1', 'QF.t2', 'TC.zero'], // 主电路 + TC 副边 127 V 控制电路
  timer: { delay: 3, off: true },
  parts: [['QF', '空开（QF1 3P+N、QF2 3P）', 2], ['FU', '熔断器（FU1×3、FU2、FU5）', 5], ['KM', '交流接触器', 4], ['SB', '按钮', 3], ['SQ', '位置开关 SQ1', 1], ['KT', '断电延时时间继电器', 1], ['TC', '控制变压器 380/127 V', 1], ['VD', '整流二极管', 1], ['M', '三相异步电动机', 3]],
  // 控制变压器原边接上两相电，副边才有 127 V
  derive(reach) {
    if (!reach) return { tc: 0 };
    const a = [0, 1, 2].filter(p => reach[p].has('TC.t0')), b = [0, 1, 2].filter(p => reach[p].has('TC.t1'));
    return { tc: a.some(i => b.some(j => j !== i)) ? 1 : 0 };
  },
  roles(role) {
    role('FU5.t', 'FU5', 'in', 'FU5'); role('FU5.b', 'FU5', 'out', 'FU5');
    // 2026-11-04 修：电机 t* 原来写成 'out' —— 三相电源是从 QF2 / KM2 / KM4 下来**进**电机接线盒上端的，
    // 所以 t* 必须是 in。审计脚本 test/_audit-io.cjs 报的「M1.t0=out（应为 in）」就是这一行。
    // 注意：电机接线盒只有上端 t*（TP 里没有 M.b*），所以这里不补 b*，别凭空造不存在的端子。
    for (let i = 0; i < 3; i++) { role('QF2.t' + i, 'QF2_' + i, 'in', 'QF2'); role('QF2.b' + i, 'QF2_' + i, 'out', 'QF2'); for (const m of ['M1', 'M2', 'M3']) role(m + '.t' + i, m + 'h' + i, 'in', m); }
    role('KM4.t3', 'KM4_NO', 'in', 'KM4常开(第4极)'); role('KM4.b3', 'KM4_NO', 'out', 'KM4常开(第4极)');
    role('KM1.t6', 'KM1_NO2', 'in', 'KM1辅助常开'); role('KM1.b6', 'KM1_NO2', 'out', 'KM1辅助常开');
    role('KM4.t6', 'KM4_NC2', 'in', 'KM4辅助常闭'); role('KM4.b6', 'KM4_NC2', 'out', 'KM4辅助常闭');
    role('SQ1.t0', 'SQ1_NC', 'in', 'SQ1常闭'); role('SQ1.b0', 'SQ1_NC', 'out', 'SQ1常闭'); role('SQ1.t1', 'SQ1_NO', 'in', 'SQ1常开'); role('SQ1.b1', 'SQ1_NO', 'out', 'SQ1常开');
    role('KT.t0', 'KT_NC', 'in', 'KT常闭'); role('KT.b0', 'KT_NC', 'out', 'KT常闭'); role('KT.t1', 'KT_NO', 'in', 'KT常开'); role('KT.b1', 'KT_NO', 'out', 'KT常开');
    role('KT.t2', 'KT_coil', 'in', 'KT线圈'); role('KT.b2', 'KT_coil', 'out', 'KT线圈');
    role('VD.t0', 'VD', 'in', 'VD'); role('VD.b0', 'VD', 'out', 'VD');
    // 2026-11-04 修：变压器是**横向**画的两个绕组，同一绕组两端谁进谁出取决于学生怎么接，
    // 不能固定成「上端入、下端出」。原来 TC.t1 写 out、TC.b0 写 in，审计报「方向反了」。
    // 现在四颗都按对称端子登记（第 5 个参数 true）→ 永远标「入/出」，跟按钮 OPEN 那套一个道理。
    role('TC.t0', 'TC_P', 'in', 'TC原边', true); role('TC.t1', 'TC_P', 'out', 'TC原边', true);
    role('TC.b0', 'TC_S', 'in', 'TC副边', true); role('TC.b1', 'TC_S', 'out', 'TC副边', true);
  },
  onPointer(p, e) {
    const r = e.pointerType === 'mouse' ? 16 : 24;
    for (const [k, d] of [['minus', -1], ['plus', 1]]) if (Math.hypot(p[0] - KT_STEP[k][0], p[1] - KT_STEP[k][1]) <= r) {
      PS.ktDelay = Math.max(1, Math.min(10, PS.ktDelay + d)); fx('ripple', { x: KT_STEP[k][0], y: KT_STEP[k][1] }); say(`时间继电器 KT 延时调为 ${PS.ktDelay} 秒`, C.dim, 3); return true;
    }
    if (Math.hypot(p[0] - SQ_LEVER[0], p[1] - SQ_LEVER[1]) <= r + 12) {
      PS.sw.SQ1 = PS.sw.SQ1 ? 0 : 1; fx('ripple', { x: SQ_LEVER[0], y: SQ_LEVER[1] });
      say(PS.sw.SQ1 ? 'SQ1 压下：常闭断开、常开闭合（停车制动）' : 'SQ1 复位：常闭闭合、常开断开', C.dim, 4); return true;
    }
    if (Math.hypot(p[0] - QF2_LEVER[0], p[1] - QF2_LEVER[1]) <= r + 12) {
      PS.sw.QF2 = PS.sw.QF2 ? 0 : 1; fx('ripple', { x: QF2_LEVER[0], y: QF2_LEVER[1], col: PS.sw.QF2 ? C.ok : C.dim });
      say(PS.sw.QF2 ? 'QF2 合上：KM2 吸合时冷却泵 M2 运转' : 'QF2 断开：冷却泵 M2 停', C.dim, 3); return true;
    }
    return false;
  },
  drawExtra(t) {
    const dt = Math.min(0.05, Math.max(0, t - MV.t)); MV.t = t;
    const live = !!PS.sw.QF, run2 = live && PS.m2 && PS.m2.dir, run3 = live && PS.m3 && PS.m3.dir;
    MV.m2 += ((run2 ? 1 : 0) - MV.m2) * Math.min(1, dt * 1.8); MV.m3 += ((run3 ? 1 : 0) - MV.m3) * Math.min(1, dt * 1.8);
    MV.a1 += PS.w * dt * 9; MV.a2 += MV.m2 * dt * 9; MV.a3 += MV.m3 * dt * 9;
    partFuse(1460, 150, 'FU5');
    // KM1 辅助常开（43/44）、KM4 辅助常闭（31/32）：画法在 devices.js 的 DEV.kmauxb
    [['KM1', 830, 'NO', '43', '44', DEV.NO_COL], ['KM4', 900, 'NC', '31', '32', DEV.NC_COL]].forEach(([k, x, kind, a, b, col]) => {
      DEV.kmauxb(x, 752, DEV.take(TP, k + '.', ['t6', 'b6']), kind, a, b, col, k + ' 辅助');
    });
    // SQ1 位置开关：画法在 devices.js 的 DEV.sq
    DEV.sq(972, 752, DEV.take(TP, 'SQ1.', ['t0', 't1', 'b0', 'b1']), PS.sw.SQ1);
    // KT 断电延时时间继电器：画法在 devices.js 的 DEV.kt2r
    const on = !!PS.ktOn, k = PS.ktc && !on ? 1 - Math.min(1, PS.ktE / PS.ktDelay) : PS.ktc ? 1 : 0;
    DEV.kt2r(1124, 752, DEV.take(TP, 'KT.', ['t0', 't1', 't2', 'b0', 'b1', 'b2']), {
      delay: PS.ktDelay, on: on ? 1 : 0, done: PS.ktc ? 1 : 0, e: PS.ktE, k: k
    });
    // 整流二极管 VD：画法在 devices.js 的 DEV.vd2
    DEV.vd2(1346, 752, DEV.take(TP, 'VD.', ['t0', 'b0']));
    // 控制变压器 TC：画法在 devices.js 的 DEV.tc
    DEV.tc(1414, 752, DEV.take(TP, 'TC.', ['t0', 't1', 'b0', 'b1']), PS.ext && PS.ext.tc);
    // QF2（冷却泵开关，3P）：画法在 devices.js 的 DEV.qf3
    DEV.qf3(1578, 752, DEV.take(TP, 'QF2.', ['t0', 't1', 't2', 'b0', 'b1', 'b2']), PS.sw.QF2);
    // 电动机：画法在 devices.js 的 DEV.m3
    const m1 = Math.abs(PS.w) > 0.05;
    const mPins = m => DEV.take(TP, m + '.', ['t0', 't1', 't2']);
    DEV.m3(MOT.M1[0], 935, mPins('M1'), 'M1', MOT.M1[1], m1,
      live ? (motor.state === '能耗制动' ? '能耗制动' : m1 ? (PS.w > 0 ? '运转' : '反转') : motor.state) : '停止', MV.a1);
    DEV.m3(MOT.M2[0], 935, mPins('M2'), 'M2', MOT.M2[1], run2, live && PS.m2 ? PS.m2.state : '停止', MV.a2);
    DEV.m3(MOT.M3[0], 935, mPins('M3'), 'M3', MOT.M3[1], run3, live && PS.m3 ? PS.m3.state : '停止', MV.a3);
    text('点 SQ1、QF2 拨杆切换；KT 用 −/+ 调延时', 1850, 1000, 13, C.dim, 'right');
  },
  // M1：三相齐全就转（正转）；两相是 L2 经 VD 来的半波直流、另一相是 L1 时为能耗制动。M2、M3 同时算好放到 PS.m2、PS.m3
  motorEval(reach) {
    const phs = m => [0, 1, 2].map(k => [0, 1, 2].filter(p => reach[p].has(m + '.t' + k)));
    const three = f => f.every(x => x.length === 1) && new Set(f.map(x => x[0])).size === 3;
    const sense = f => [[0, 1, 2], [1, 2, 0], [2, 0, 1]].some(q => q.join() === f.map(x => x[0]).join()) ? 1 : -1;
    const sub = m => { const f = phs(m); return three(f) ? { state: sense(f) > 0 ? '运转' : '反转', dir: sense(f) } : f.some(x => x.length) ? { state: '缺相', dir: 0 } : { state: '停止', dir: 0 }; };
    PS.m2 = sub('M2'); PS.m3 = sub('M3');
    const f = phs('M1');
    if (three(f)) { const d = sense(f); return { state: d > 0 ? '正转' : '反转', dir: d, seq: f.map(x => x[0]) }; }
    const ps = [...new Set(f.flat())];
    if (f.every(x => x.length === 1) && ps.length === 2 && ps.some(p => reach[p].has('VD.t0') && reach[p].has('VD.b0'))) return { state: '能耗制动', dir: 0, seq: null, rate: 9 };
    return f.some(x => x.length) ? { state: '缺相', dir: 0, seq: null } : { state: '停止', dir: 0, seq: null };
  },
  lesson: {
    name: '安装和调试 C6140T 型卧式车床电气控制线路（电工中级 应会实操）',
    goals: ['识读 C6140T 型卧式车床电气原理图（主电路、控制电路）', '理解主轴电动机起动、停车能耗制动（SQ1、断电延时 KT、KM4、VD）和快速移动点动、冷却泵控制', '完成电路的安装、接线与调试'],
    tools: ['螺钉旋具', '试电笔', '剥线钳', '尖嘴钳', '钢丝钳', '万用表', '绝缘电阻表'],
    steps: ['识读电路图', '检测元器件（含二极管、控制变压器）', '安装元器件', '接线', '通电调试'],
    note: '实训台空开 QF 当 QF1；TC 只接 380 V 原边和 127 V 控制绕组（001、000）；KM4 用 3 个主触点加 1 个常开当第 4 极（V12、W12 短接）；KM1 加一个辅助常开、KM4 加一个辅助常闭；KT 用断电延时型。本题不接电流表 TA、照明和信号电路（FU3/FU4、S、EL、HL1～HL3）。每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上 QF：按 SB2 主轴 M1 起动（合上 QF2 冷却泵 M2 同时运转）；压下 SQ1 停车：KM1/KM2 释放、KM4 能耗制动，KT 延时到后 KM4 释放；按住 SB3 快移 M3 点动。',
  runMsg: '已合闸：SB2 起动主轴，QF2 控制冷却泵；压下 SQ1 停车制动（制动完再复位 SQ1）；按住 SB3 快移点动',
  answers: [
    { name: '教材接法', desc: '主电路 U11 依次接 FU1、KM1、KM4；V11 经 FU2、KM4、VD 制动；控制电路按 001～016、000 顺序', chains: {} },
    { name: '入口出口法', desc: '002：FU5 出 → KT 常闭 入 → KT 常开 入 → SQ1 常闭 入 → SQ1 常开 入；000：TC 副边 0 → KM4 → KM3 → KM2 → KM1 → KT 线圈',
      chains: { '002': ['FU5.b', 'KT.t0', 'KT.t1', 'SQ1.t0', 'SQ1.t1'], '000': ['TC.b1', 'KM4.b5', 'KM3.b5', 'KM2.b5', 'KM1.b5', 'KT.b2'] } },
  ],
  // 「一键套用主电路」时按主电路处理的额外线号（practice.js 的 isMainNet）：
  // 本电路的能耗制动支路 201～203（FU2 出 → KM4 → VD → KM4 → W12）是主回路的电，只是没按 U/V/W 编号，
  // 不在这里登记的话，一键套用主电路会把它留在板上。详见下面 groups 里的「制动回路 · 201、202、203」。
  mainExtra: ['201', '202', '203'],
  groups: [
    { name: '主电路 · U11、V11、W11', nets: ['U11', 'V11', 'W11'], why: 'QF1 出线 = FU1 进线 = KM1 主触点进线；U11 还接 KM4 第 1 极，V11 还接 FU2（制动电源）。' },
    { name: '主电路 · U12、V12、W12', nets: ['U12', 'V12', 'W12'], why: 'KM1 出线 = M1 接线盒 = KM2 进线；U12 接 KM4 第 1 极出线；V12、W12 接 KM4 常开（第 4 极）两端，W12 还接 KM4 第 3 极出线。' },
    { name: '制动回路 · 201、202、203', nets: ['201', '202', '203'], why: 'FU2 出 → KM4 第 2 极 → VD 阳极；VD 阴极 → KM4 第 3 极：KM4 吸合时 L2 经 VD 半波整流加到 M1 两相绕组上。' },
    { name: '控制电源 · U21、W21、001', nets: ['U21', 'W21', '001'], why: 'FU1 出线 U21、W21 同时接 KM3 和 TC 原边；TC 副边 127 V（001）经 FU5 变成 002。' },
    { name: '控制电路 · 002、003', nets: ['002', '003'], why: '002 = FU5 出 + SQ1 常闭、常开 入 + KT 常闭、常开 入；003 = SQ1 常闭 出 + KT 常闭 出 + SB1 入 + SB3 入（SQ1 常闭和 KT 常闭并联）。' },
    { name: '控制电路 · 013', nets: ['013'], why: '013 = KM1 辅助常开 出 + KT 常开 出 + KM1 常闭 入 + KM4 辅助常闭 入：KT 常开把制动支路保持住。' },
    { name: '控制电路 · 000', nets: ['000'], why: 'TC 副边 0 + 五个线圈的 A2（KM1～KM4、KT），任意串接。' },
  ],
};
