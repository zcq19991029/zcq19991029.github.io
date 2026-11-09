// 扩展练习 题一（电工中级·四级 应会实操）：三相异步电动机双重联锁正反转启动、能耗制动控制线路（图见 电工题库/1.jpg）
// 主电路：QS（实训台用空开代替）→ FU1 → U12/V12/W12；KM1 正转；KM2 反转（U、W 对调）；KM3 能耗制动：N → R → U15 → VD4 → U14 → KM3 第 1 极，
// KM3 第 2、3 极上端并接 U12，下端接 U13/V13/W13：制动时 L1 的半波直流经 KM3 加到电动机两相绕组上。
// 控制电路接 U12、V12 两相（FU2 两只熔断器，1、2 号线，380 V，不用零线）：
// 1→FR常闭→3→KM3常闭→5→SB1常闭→7；7→SB2常开（并 KM1 自锁）→9→SB3常闭→11→KM2常闭→13→KM1线圈→2；
// 7→SB3常开（并 KM2 自锁）→15→SB2常闭→17→KM1常闭→19→KM2线圈→2；
// 3→SB1常开（SB1 复合，并 KM3 自锁）→21→KT 通电延时断开常闭→23→KM1常闭→25→KM2常闭→27→KM3线圈→2；KT 线圈 21→2。
// 制动支路要再用一对 KM1、KM2 常闭，板上给 KM1、KM2 各加一个辅助触头（常闭 21/22，端子记作 .t6/.b6）。

// ---------- 实物板 ----------
const TP = {};
QF_POLES.forEach((p, i) => { TP['QF.t' + i] = [870 + 60 * i, 162]; TP['QF.b' + i] = [870 + 60 * i, 288]; });
for (let i = 0; i < 3; i++) {
  TP['FU1.t' + i] = [1170 + 70 * i, 162]; TP['FU1.b' + i] = [1170 + 70 * i, 288];
  TP['FR.t' + i] = [885 + 40 * i, 812]; TP['FR.b' + i] = [885 + 40 * i, 918];
}
TP['FU2.t'] = [1400, 162]; TP['FU2.b'] = [1400, 288]; TP['FU2b.t'] = [1460, 162]; TP['FU2b.b'] = [1460, 288];
TP['FR.t4'] = [1045, 812]; TP['FR.b4'] = [1045, 918];
const KMX = { KM1: 830, KM2: 1150, KM3: 1470 };
for (const k in KMX) for (let c = 0; c < 6; c++) { TP[k + '.t' + c] = [KMX[k] + 25 + 40 * c, 502]; TP[k + '.b' + c] = [KMX[k] + 25 + 40 * c, 662]; }
for (const k of ['KM1', 'KM2']) { TP[k + '.t6'] = [KMX[k] + 266, 502]; TP[k + '.b6'] = [KMX[k] + 266, 662]; } // 辅助常闭
const BTN = { SB1: [1560, '#ef4444', '停止', true], SB2: [1690, '#22c55e', '正转', true], SB3: [1820, '#22c55e', '反转', true] };
for (const k in BTN) { const x = BTN[k][0]; TP[k + '.ci'] = [x - 45, 270]; TP[k + '.co'] = [x - 15, 270]; TP[k + '.ai'] = [x + 15, 270]; TP[k + '.ao'] = [x + 45, 270]; }
TP['R.t'] = [1150, 842]; TP['R.b'] = [1250, 842]; TP['VD.t'] = [1320, 842]; TP['VD.b'] = [1420, 842]; // 制动电阻 R、二极管 VD4（VD.t 是 U15 端，VD.b 是 U14 端）
const KTX = 1730, KTN = ['ci', 'co', 'a1', 'a2'];
KTN.forEach((n, i) => (TP['KT.' + n] = [KTX + 22 + i * 34, 902]));

function termName(k) {
  const [d, t] = k.split('.'), i = +t.slice(1), top = t[0] === 't';
  if (d === 'QF') return `QF ${top ? '进线' : '出线'} ${QF_POLES[i]}`;
  if (d === 'FU1') return `FU1 ${top ? '进线' : '出线'}`;
  if (d === 'FU2') return `FU2（U相）${top ? '进线' : '出线'}`;
  if (d === 'FU2b') return `FU2（V相）${top ? '进线' : '出线'}`;
  if (d === 'FR') return i === 4 ? `FR 常闭 ${top ? '95' : '96'}` : `FR 进线 ${['1/L1', '3/L2', '5/L3'][i]}`;
  if (d === 'R') return `制动电阻 R ${t === 't' ? '左端' : '右端'}`;
  if (d === 'VD') return `二极管 VD4 ${t === 't' ? 'U15 端' : 'U14 端'}`;
  if (d === 'KT') return { ci: 'KT 延时断开入口', co: 'KT 延时断开出口', a1: 'KT 线圈 A1', a2: 'KT 线圈 A2' }[t];
  if (/^KM/.test(d)) {
    if (i === 6) return `${d} 辅助常闭 ${top ? '21' : '22'}`;
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `${d} ${i < 3 ? (top ? '主触点进线 ' : '主触点出线 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return { ci: `${d} 常闭入口`, co: `${d} 常闭出口`, ai: `${d} 常开入口`, ao: `${d} 常开出口` }[t];
  return k;
}

// 导线（教材顺序：主电路、制动回路、控制电路 1～27 号线、2 号线）。走线由练习页自动生成（pts 为 null），原理图段在后面按点补上
const BW = [];
const bw = (id, net, a, b) => BW.push({ id, net, a, b, pts: null, sch: [] });
bw('U11', 'U11', 'QF.b0', 'FU1.t0'); bw('V11', 'V11', 'QF.b1', 'FU1.t1'); bw('W11', 'W11', 'QF.b2', 'FU1.t2');
bw('U12a', 'U12', 'FU2.t', 'FU1.b0'); bw('U12b', 'U12', 'FU1.b0', 'KM1.t0'); bw('U12c', 'U12', 'KM1.t0', 'KM2.t0'); bw('U12d', 'U12', 'KM2.t0', 'KM3.t1'); bw('U12e', 'U12', 'KM3.t1', 'KM3.t2');
bw('V12a', 'V12', 'FU2b.t', 'FU1.b1'); bw('V12b', 'V12', 'FU1.b1', 'KM1.t1'); bw('V12c', 'V12', 'KM1.t1', 'KM2.t1');
bw('W12a', 'W12', 'FU1.b2', 'KM1.t2'); bw('W12b', 'W12', 'KM1.t2', 'KM2.t2');
bw('U13a', 'U13', 'FR.t0', 'KM1.b0'); bw('U13b', 'U13', 'KM1.b0', 'KM2.b2'); bw('U13c', 'U13', 'KM2.b2', 'KM3.b0');
bw('V13a', 'V13', 'FR.t1', 'KM1.b1'); bw('V13b', 'V13', 'KM1.b1', 'KM2.b1'); bw('V13c', 'V13', 'KM2.b1', 'KM3.b1');
bw('W13a', 'W13', 'FR.t2', 'KM1.b2'); bw('W13b', 'W13', 'KM1.b2', 'KM2.b0'); bw('W13c', 'W13', 'KM2.b0', 'KM3.b2');
bw('cN', 'N', 'QF.b3', 'R.t'); bw('cU15', 'U15', 'R.b', 'VD.t'); bw('cU14', 'U14', 'VD.b', 'KM3.t0');
bw('c1', '1', 'FU2.b', 'FR.t4');
bw('c3a', '3', 'FR.b4', 'KM3.t4'); bw('c3b', '3', 'KM3.t4', 'KM3.t3'); bw('c3c', '3', 'KM3.t3', 'SB1.ai');
bw('c5', '5', 'KM3.b4', 'SB1.ci');
bw('c7a', '7', 'SB1.co', 'SB2.ai'); bw('c7b', '7', 'SB2.ai', 'KM1.t3'); bw('c7c', '7', 'KM1.t3', 'KM2.t3'); bw('c7d', '7', 'KM2.t3', 'SB3.ai');
bw('c9a', '9', 'SB2.ao', 'KM1.b3'); bw('c9b', '9', 'KM1.b3', 'SB3.ci');
bw('c11', '11', 'SB3.co', 'KM2.t4'); bw('c13', '13', 'KM2.b4', 'KM1.t5');
bw('c15a', '15', 'SB3.ao', 'KM2.b3'); bw('c15b', '15', 'KM2.b3', 'SB2.ci');
bw('c17', '17', 'SB2.co', 'KM1.t4'); bw('c19', '19', 'KM1.b4', 'KM2.t5');
bw('c21a', '21', 'SB1.ao', 'KM3.b3'); bw('c21b', '21', 'KM3.b3', 'KT.ci'); bw('c21c', '21', 'KT.ci', 'KT.a1');
bw('c23', '23', 'KT.co', 'KM1.t6'); bw('c25', '25', 'KM1.b6', 'KM2.t6'); bw('c27', '27', 'KM2.b6', 'KM3.t5');
bw('c2a', '2', 'FU2b.b', 'KM1.b5'); bw('c2b', '2', 'KM1.b5', 'KM2.b5'); bw('c2c', '2', 'KM2.b5', 'KM3.b5'); bw('c2d', '2', 'KM3.b5', 'KT.a2');
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) { BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i }, { id: 'FR' + i, a: 'FR.t' + i, b: 'FR.b' + i }); }
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FU2b', a: 'FU2b.t', b: 'FU2b.b' }, { id: 'FRnc', a: 'FR.t4', b: 'FR.b4', on: s => !s.FR });
for (const n of [1, 2, 3]) {
  const k = 'KM' + n, on = s => s['km' + n];
  for (let c = 0; c < 3; c++) BE.push({ id: k + 'm' + c, a: k + '.t' + c, b: k + '.b' + c, on });
  BE.push({ id: k + 'no', a: k + '.t3', b: k + '.b3', on }, { id: k + 'nc', a: k + '.t4', b: k + '.b4', on: s => !on(s) }, { id: k + 'coil', a: k + '.t5', b: k + '.b5', load: true });
  if (n < 3) BE.push({ id: k + 'nc2', a: k + '.t6', b: k + '.b6', on: s => !on(s) });
}
for (const k in BTN) BE.push({ id: k + 'nc', a: k + '.ci', b: k + '.co', on: s => !s[k] }, { id: k + 'no', a: k + '.ai', b: k + '.ao', on: s => s[k] });
BE.push({ id: 'KTnc', a: 'KT.ci', b: 'KT.co', on: s => !s.ktc }, { id: 'KTcoil', a: 'KT.a1', b: 'KT.a2', load: true });
BE.push({ id: 'R', a: 'R.t', b: 'R.b' }, { id: 'VD', a: 'VD.t', b: 'VD.b' });

// ---------- 原理图（按题图版面重画；设计坐标）----------
const SCH = { x: 34, y: 112, s: 0.74 };
const X = [60, 120, 180], KX = [250, 310, 370], K3 = [440, 500, 560], PU = ['U', 'V', 'W'], BUS = [330, 340, 350], J = [215, 225, 235];
const A = 690, A2 = 755, B = 860, B2 = 925, Cc = 1010, C2 = 1075, D = 1140, NB = 660; // 控制电路各列；NB：2 号线（底线）
const SE = [];
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
const MC = [120, 482], MH = [[88, 454], [120, 438], [152, 454]];
for (let i = 0; i < 3; i++) {
  const x = X[i], p = PU[i];
  w('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  el('QF' + i, 'qf', x, 70, 120, 'qa' + i, p + '11', s => s.QF);
  w('w11' + i, p + '11', [[x, 120], [x, 140]], p + '11', 'fa' + i);
  el('FU1' + i, 'fuse', x, 140, 185, 'fa' + i, 'fb' + i);
  el('KM1' + i, 'km', x, 250, 300, 'k1a' + i, 'k1b' + i, s => s.km1);
  w('wk1b' + i, p + '13', [[x, 300], [x, BUS[i]]], 'k1b' + i, 'b13' + i);
  w('wfr' + i, p + '13', [[x, BUS[i]], [x, 372]], 'b13' + i, 'h' + i);
  el('FRh' + i, 'heat', x, 372, 412, 'h' + i, 'hb' + i);
  w('wo' + i, p + '1', [[x, 412], [x, 424], MH[i]], 'hb' + i, 'mh' + i);
  el('KM2' + i, 'km', KX[i], 250, 300, 'k2a' + i, 'k2b' + i, s => s.km2);
  el('KM3' + i, 'km', K3[i], 250, 300, 'k3a' + i, 'k3b' + i, s => s.km3);
}
// U12、V12：FU1 出线先分出控制电源（1、2 号线经 FU2），再往右送到 KM2、KM3
w('w12a0', 'U12', [[60, 185], [60, 203]], 'fb0', 'jc0'); w('w12c0', 'U12', [[60, 203], [60, 215]], 'jc0', 'j0'); w('wk1a0', 'U12', [[60, 215], [60, 250]], 'j0', 'k1a0');
w('w12a1', 'V12', [[120, 185], [120, 196]], 'fb1', 'jc1'); w('w12c1', 'V12', [[120, 196], [120, 225]], 'jc1', 'j1'); w('wk1a1', 'V12', [[120, 225], [120, 250]], 'j1', 'k1a1');
w('w12a2', 'W12', [[180, 185], [180, 235]], 'fb2', 'j2'); w('wk1a2', 'W12', [[180, 235], [180, 250]], 'j2', 'k1a2');
w('wtap0', 'U12', [[60, 215], [250, 215]], 'j0', 'j0b'); w('wk2a0', 'U12', [[250, 215], [250, 250]], 'j0b', 'k2a0');
w('wU3a', 'U12', [[250, 215], [500, 215]], 'j0b', 'j0c'); w('wk3a1', 'U12', [[500, 215], [500, 250]], 'j0c', 'k3a1'); w('wk3a2', 'U12', [[500, 215], [560, 215], [560, 250]], 'j0c', 'k3a2');
w('wtap1', 'V12', [[120, 225], [310, 225], [310, 250]], 'j1', 'k2a1'); w('wtap2', 'W12', [[180, 235], [370, 235], [370, 250]], 'j2', 'k2a2');
// KM2 出线换相（U、W 对调）、KM3 出线接 U13/V13/W13
const BUSN = { U13: 0, V13: 1, W13: 2 };
[[0, 'W13'], [1, 'V13'], [2, 'U13']].forEach(([i, n]) => w('wk2b' + i, n, [[KX[i], 300], [KX[i], BUS[BUSN[n]]]], 'k2b' + i, 'b2' + i));
w('wk3b0', 'U13', [[440, 300], [440, 330]], 'k3b0', 'b30'); w('wk3b1', 'V13', [[500, 300], [500, 340]], 'k3b1', 'b31'); w('wk3b2', 'W13', [[560, 300], [560, 350]], 'k3b2', 'b32');
w('bU1', 'U13', [[60, 330], [370, 330]], 'b130', 'b22'); w('bU2', 'U13', [[370, 330], [440, 330]], 'b22', 'b30');
w('bV1', 'V13', [[120, 340], [310, 340]], 'b131', 'b21'); w('bV2', 'V13', [[310, 340], [500, 340]], 'b21', 'b31');
w('bW1', 'W13', [[180, 350], [250, 350]], 'b132', 'b20'); w('bW2', 'W13', [[250, 350], [560, 350]], 'b20', 'b32');
// 能耗制动：N → R → U15 → VD4 → U14 → KM3 第 1 极
w('wN', 'N', [[440, 38], [440, 60]], 'N', 'ra');
el('R', 'none', 440, 60, 110, 'ra', 'rb');
w('wU15', 'U15', [[440, 110], [440, 140]], 'rb', 'va');
el('VD', 'none', 440, 140, 185, 'va', 'vb');
w('wU14', 'U14', [[440, 185], [440, 250]], 'vb', 'k3a0');
// 电动机三相绕组（看不见的负载，接在首端之间）
[[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => SE.push({ id: 'MW' + a + b, kind: 'none', a: 'mh' + a, b: 'mh' + b, load: true, pts: [MH[a], MH[b]] }));
// 控制电源：U12、V12 经 FU2 两只熔断器 → 1、2 号线
w('wC1', 'U12', [[60, 203], [585, 203], [585, 40], [600, 40]], 'jc0', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 600, x2: 640, y: 40, a: 'f2a', b: 'f2b', pts: [[600, 40], [640, 40]] });
w('wC2', 'V12', [[120, 196], [575, 196], [575, 22], [600, 22]], 'jc1', 'f2c');
SE.push({ id: 'FU2b', kind: 'fuseH', x1: 600, x2: 640, y: 22, a: 'f2c', b: 'f2d', pts: [[600, 22], [640, 22]] });
w('w1', '1', [[640, 40], [A, 40], [A, 70]], 'f2b', 'n1');
el('FR_NC', 'nc', A, 70, 110, 'n1', 'n3a', s => !s.FR);
w('w3a', '3', [[A, 110], [A, 130]], 'n3a', 'j3');
w('w3e', '3', [[A, 130], [A, 150]], 'j3', 'k3ca');
el('KM3_NC', 'nc', A, 150, 195, 'k3ca', 'n5a', s => !s.km3);
w('w5', '5', [[A, 195], [A, 215]], 'n5a', 's1ca');
el('SB1_NC', 'bnc', A, 215, 260, 's1ca', 'n7a', s => !s.SB1);
w('w7', '7', [[A, 260], [A, 280]], 'n7a', 'j7');
// 正转：7 → SB2 常开 ∥ KM1 自锁 → 9 → SB3 常闭 → 11 → KM2 常闭 → 13 → KM1 线圈
w('w7a', '7', [[A, 280], [A, 300]], 'j7', 's2na');
el('SB2_NO', 'bno', A, 300, 345, 's2na', 'n9a', s => s.SB2);
w('w7b1', '7', [[A, 280], [A2, 280]], 'j7', 'j7b'); w('w7b2', '7', [[A2, 280], [A2, 300]], 'j7b', 'k1na');
el('KM1_NO', 'no', A2, 300, 345, 'k1na', 'k1nb', s => s.km1);
w('w9a', '9', [[A, 345], [A, 365]], 'n9a', 'j9'); w('w9b', '9', [[A2, 345], [A2, 365], [A, 365]], 'k1nb', 'j9');
w('w9c', '9', [[A, 365], [A, 385]], 'j9', 's3ca');
el('SB3_NC', 'bnc', A, 385, 430, 's3ca', 'n11', s => !s.SB3);
w('w11', '11', [[A, 430], [A, 450]], 'n11', 'k2ca');
el('KM2_NC', 'nc', A, 450, 495, 'k2ca', 'n13', s => !s.km2);
w('w13', '13', [[A, 495], [A, 560]], 'n13', 'c1a');
el('KM1_coil', 'coil', A, 560, 600, 'c1a', 'c1b', null, { load: true });
w('w2a', '2', [[A, 600], [A, NB]], 'c1b', 'n2a');
// 反转：7 → SB3 常开 ∥ KM2 自锁 → 15 → SB2 常闭 → 17 → KM1 常闭 → 19 → KM2 线圈
w('w7c1', '7', [[A2, 280], [B, 280]], 'j7b', 'j7c'); w('w7c2', '7', [[B, 280], [B, 300]], 'j7c', 's3na'); w('w7d', '7', [[B, 280], [B2, 280], [B2, 300]], 'j7c', 'k2na');
el('SB3_NO', 'bno', B, 300, 345, 's3na', 'n15a', s => s.SB3);
el('KM2_NO', 'no', B2, 300, 345, 'k2na', 'k2nb', s => s.km2);
w('w15a', '15', [[B, 345], [B, 365]], 'n15a', 'j15'); w('w15b', '15', [[B2, 345], [B2, 365], [B, 365]], 'k2nb', 'j15');
w('w15c', '15', [[B, 365], [B, 385]], 'j15', 's2ca');
el('SB2_NC', 'bnc', B, 385, 430, 's2ca', 'n17', s => !s.SB2);
w('w17', '17', [[B, 430], [B, 450]], 'n17', 'k1ca');
el('KM1_NC', 'nc', B, 450, 495, 'k1ca', 'n19', s => !s.km1);
w('w19', '19', [[B, 495], [B, 560]], 'n19', 'c2a');
el('KM2_coil', 'coil', B, 560, 600, 'c2a', 'c2b', null, { load: true });
w('w2b', '2', [[B, 600], [B, NB]], 'c2b', 'n2b');
// 制动：3 → SB1 常开 ∥ KM3 自锁 → 21 → KT 延时断开 → 23 → KM1 常闭 → 25 → KM2 常闭 → 27 → KM3 线圈；KT 线圈 21 → 2
w('w3b', '3', [[A, 130], [Cc, 130]], 'j3', 'j3c'); w('w3c', '3', [[Cc, 130], [Cc, 215]], 'j3c', 's1na'); w('w3d', '3', [[Cc, 130], [C2, 130], [C2, 215]], 'j3c', 'k3na');
el('SB1_NO', 'bno', Cc, 215, 260, 's1na', 's1nb', s => s.SB1);
el('KM3_NO', 'no', C2, 215, 260, 'k3na', 'k3nb', s => s.km3);
w('w21a', '21', [[Cc, 260], [Cc, 280]], 's1nb', 'j21'); w('w21b', '21', [[C2, 260], [C2, 280]], 'k3nb', 'j21b'); w('w21x', '21', [[C2, 280], [Cc, 280]], 'j21b', 'j21');
w('w21c', '21', [[Cc, 280], [Cc, 300]], 'j21', 'ktca');
el('KT_NC', 'tnc', Cc, 300, 345, 'ktca', 'n23', s => !s.ktc);
w('w23', '23', [[Cc, 345], [Cc, 385]], 'n23', 'k1c2a');
el('KM1_NC2', 'nc', Cc, 385, 430, 'k1c2a', 'n25', s => !s.km1);
w('w25', '25', [[Cc, 430], [Cc, 450]], 'n25', 'k2c2a');
el('KM2_NC2', 'nc', Cc, 450, 495, 'k2c2a', 'n27', s => !s.km2);
w('w27', '27', [[Cc, 495], [Cc, 560]], 'n27', 'c3a');
el('KM3_coil', 'coil', Cc, 560, 600, 'c3a', 'c3b', null, { load: true });
w('w2c', '2', [[Cc, 600], [Cc, NB]], 'c3b', 'n2c');
w('w21d', '21', [[C2, 280], [D, 280], [D, 560]], 'j21b', 'kta');
el('KT_coil', 'coil', D, 560, 600, 'kta', 'ktb', null, { load: true });
w('w2d', '2', [[D, 600], [D, NB]], 'ktb', 'n2d');
// 2 号线：FU2（V 相）出来沿最上面走到右边再下来，接到四个线圈（不穿过控制电路）
w('w2up', '2', [[640, 22], [1185, 22], [1185, NB], [D, NB]], 'f2d', 'n2d');
w('w2ab', '2', [[A, NB], [B, NB]], 'n2a', 'n2b'); w('w2bc', '2', [[B, NB], [Cc, NB]], 'n2b', 'n2c'); w('w2cd', '2', [[Cc, NB], [D, NB]], 'n2c', 'n2d');
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
BW.forEach(x => (x.sch = SE.filter(e => e.kind === 'w' && e.net === x.net).map(e => e.id))); // 接通一个点，原理图上这个点的线一起变色
const EDGE_T = {}, EDGE_COL = {};
function schSolve(s) { return solve('schE1', SE, s, ['L1'], ['L2', 'N'], [s.QF, s.SB1, s.SB2, s.SB3, s.FR, s.km1, s.km2, s.km3, s.ktc].join('')); }
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
  // 制动电阻 R、二极管 VD4（导通时发光）
  const rOn = R.cur.has('R'), col = rOn ? C.cur : C.ink;
  g.save(); g.fillStyle = C.paper || '#fff'; g.strokeStyle = col; g.lineWidth = 2.5; if (rOn) { g.shadowColor = C.cur; g.shadowBlur = 14; } g.fillRect(430, 68, 20, 34); g.strokeRect(430, 68, 20, 34); g.restore();
  poly([[440, 60], [440, 68]], col, 3); poly([[440, 102], [440, 110]], col, 3);
  g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.5; if (rOn) { g.shadowColor = C.cur; g.shadowBlur = 14; }
  g.beginPath(); g.moveTo(440, 140); g.lineTo(440, 152); g.moveTo(428, 152); g.lineTo(452, 152); g.moveTo(440, 152); g.lineTo(428, 172); g.lineTo(452, 172); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(440, 172); g.lineTo(440, 185); g.stroke(); g.restore(); // 三角形尖朝上：电流从 U14 流向 U15
  for (let i = 0; i < 3; i++) { dot(X[i], [203, 196, 235][i], 4.5, C.ink); dot(X[i], BUS[i], 4.5, C.ink); }
  [[60, 215], [120, 225], [250, 215], [500, 215], [370, 330], [310, 340], [250, 350], [A, 130], [Cc, 130], [A, 280], [A2, 280], [B, 280], [A, 365], [B, 365], [Cc, 280], [C2, 280], [B, NB], [Cc, NB], [D, NB]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  poly([[X[0] - 8, 95], [X[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  [X, KX, K3].forEach(xs => poly([[xs[0] - 8, 275], [xs[2] + 4, 275]], C.ink, 1.5, [6, 5]));
  poly([[A - 22, 237], [Cc - 22, 237]], C.ink, 1.5, [6, 5]); // SB1 复合：常闭和常开联动
  poly([[A - 22, 322], [B - 22, 407]], C.ink, 1.5, [6, 5]); poly([[A - 22, 407], [B - 22, 322]], C.ink, 1.5, [6, 5]); // SB2、SB3 复合（按钮互锁）
  const run = Math.abs(s.w) > 0.05;
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.arc(MC[0], MC[1], 44, 0, 7); g.fill(); g.stroke(); g.restore();
  text('M', MC[0], MC[1] - 10, 26, C.ink, 'center', 'bold'); text('3~', MC[0], MC[1] + 16, 18);
  for (let i = 0; i < 3; i++) {
    text(PH[i], X[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(X[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
    text(PU[i] + '11', X[i] + 6, 132, 13, C.dim, 'left');
  }
  text('N', 440, 18, 20, C.N, 'center', 'bold'); g.beginPath(); g.arc(440, 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
  text('QS', 196, 95, 18, C.ink, 'left', 'bold'); text('FU1', 196, 162, 18, C.ink, 'left', 'bold');
  text('R', 458, 86, 16, C.ink, 'left', 'bold'); text('U15', 448, 126, 13, C.dim, 'left'); text('VD4', 458, 164, 14, C.ink, 'left', 'bold'); text('U14', 448, 200, 13, C.dim, 'left');
  text('KM1', 196, 268, 16, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('KM2', 386, 268, 16, s.km2 ? C.cur : C.ink, 'left', 'bold'); text('KM3', 576, 268, 16, s.km3 ? C.cur : C.ink, 'left', 'bold');
  text('U12', 66, 208, 12, C.dim, 'left'); text('U13', 66, 322, 12, C.dim, 'left'); text('FR', 196, 392, 18, C.ink, 'left', 'bold');
  text('FU2', 620, 6, 16, C.ink, 'center', 'bold');
  const L = (s2, x, y, on) => text(s2, x, y, 15, on ? C.cur : C.ink, 'right', 'bold');
  L('FR', A - 20, 90); L('KM3', A - 18, 172); L('SB1', A - 40, 237); L('SB2', A - 40, 322); L('SB3', A - 40, 407); L('KM2', A - 18, 472);
  text('KM1', A2 + 8, 356, 14, s.km1 ? C.cur : C.ink, 'left', 'bold');
  L('SB3', B - 40, 322); L('SB2', B - 40, 407); L('KM1', B - 18, 472); text('KM2', B2 + 10, 322, 15, s.km2 ? C.cur : C.ink, 'left', 'bold');
  L('SB1', Cc - 40, 237); text('KM3', C2 + 10, 237, 15, s.km3 ? C.cur : C.ink, 'left', 'bold'); text('KT', Cc + 14, 322, 15, C.ink, 'left', 'bold'); L('KM1', Cc - 18, 407); L('KM2', Cc - 18, 472);
  [['KM1', A, s.km1], ['KM2', B, s.km2], ['KM3', Cc, s.km3], ['KT', D, s._coil.has('KT_coil')]].forEach(([n, x, on]) => text(n, x + 28, 616, 15, on ? C.cur : C.ink, 'center', 'bold'));
  [['1', A, 54], ['3', A, 122], ['5', A, 205], ['7', A, 270], ['9', A, 356], ['11', A, 440], ['13', A, 530], ['15', B, 356], ['17', B, 440], ['19', B, 530], ['21', Cc, 270], ['23', Cc, 365], ['25', Cc, 440], ['27', Cc, 530], ['2', 1185, 300]]
    .forEach(([n, x, y]) => text(n, x + 8, y, 13, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const KT_STEP = { minus: [KTX + 34, 830], plus: [KTX + 116, 830] };
const CIRCUIT = {
  id: 'E1', key: 'zfz-practice-E1', schW: 1200, ext: true,
  title: '电工中级 · 双重联锁正反转能耗制动 · 接线练习',
  kms: ['KM1', 'KM2', 'KM3'], labels: {}, kmX: KMX, noWire: /^QF\.t|^FR\.b[0-2]$/,
  nEnd: [440, 38], motorAt: [MC[0], MC[1], 44],
  srcs: ['QF.t0'], sinks: ['QF.t1', 'QF.t3'], // 控制电路接在 U、V 两相之间（380 V），制动直流回到 N
  phaseSwap: ['KM2'], timer: { delay: 3 },
  roles(role) {
    role('FU2b.t', 'FU2b', 'in', 'FU2(V)'); role('FU2b.b', 'FU2b', 'out', 'FU2(V)');
    role('R.t', 'R', 'in', 'R'); role('R.b', 'R', 'out', 'R'); role('VD.t', 'VD', 'in', 'VD4'); role('VD.b', 'VD', 'out', 'VD4');
    role('KT.ci', 'KT_NC', 'in', 'KT延时断开'); role('KT.co', 'KT_NC', 'out', 'KT延时断开'); role('KT.a1', 'KT_coil', 'in', 'KT线圈'); role('KT.a2', 'KT_coil', 'out', 'KT线圈');
    for (const k of ['KM1', 'KM2']) { role(k + '.t6', k + '_NC2', 'in', k + '辅助常闭'); role(k + '.b6', k + '_NC2', 'out', k + '辅助常闭'); }
  },
  onPointer(p, e) {
    const r = e.pointerType === 'mouse' ? 16 : 24;
    for (const [k, d] of [['minus', -1], ['plus', 1]]) if (Math.hypot(p[0] - KT_STEP[k][0], p[1] - KT_STEP[k][1]) <= r) {
      PS.ktDelay = Math.max(1, Math.min(10, PS.ktDelay + d)); fx('ripple', { x: KT_STEP[k][0], y: KT_STEP[k][1] }); say(`时间继电器 KT 延时调为 ${PS.ktDelay} 秒`, C.dim, 3); return true;
    }
    return false;
  },
  drawExtra(t) {
    partFuse(1460, 150, '');
    // KM1、KM2 的辅助触头（常闭 21/22）：画法在 devices.js 的 DEV.kmaux
    for (const k of ['KM1', 'KM2']) DEV.kmaux(KMX[k] + 248, 488, DEV.take(TP, k + '.', ['t6', 'b6']));
    // 制动电阻 R、二极管 VD4：画法在 devices.js 的 DEV.r / DEV.vd
    DEV.r(1126, 800, DEV.take(TP, 'R.', ['t', 'b']));
    DEV.vd(1296, 800, DEV.take(TP, 'VD.', ['t', 'b']));
    // 时间继电器 KT（通电延时，用延时断开常闭和线圈）：画法在 devices.js 的 DEV.kt4
    DEV.kt4(KTX, 760, DEV.take(TP, 'KT.', KTN), {
      delay: PS.ktDelay, on: PS.ktOn ? 1 : 0, done: PS.ktc ? 1 : 0, e: PS.ktE,
      k: PS.ktc ? 1 : PS.ktOn ? Math.min(1, PS.ktE / PS.ktDelay) : 0
    });
  },
  // 电动机：三相电源相序决定转向；一相接 N 的直流、另一相接 L1 时是能耗制动（很快停下）
  motorEval(reach) {
    const fr = [0, 1, 2].map(k => [0, 1, 2, 3].filter(p => reach[p].has('FR.b' + k)));
    if (fr.every(x => x.length === 1 && x[0] < 3) && new Set(fr.map(x => x[0])).size === 3) {
      const seq = fr.map(x => x[0]), even = [[0, 1, 2], [1, 2, 0], [2, 0, 1]].some(q => q.join() === seq.join());
      return { state: even ? '正转' : '反转', dir: even ? 1 : -1, seq };
    }
    if (fr.some(x => x.includes(3)) && fr.some(x => x.includes(0))) return { state: '能耗制动', dir: 0, seq: null, rate: 9 };
    return fr.some(x => x.length) ? { state: '缺相', dir: 0, seq: null } : { state: '停止', dir: 0, seq: null };
  },
  lesson: {
    name: '安装和调试三相异步电动机双重联锁正反转启动能耗制动控制线路（电工中级 应会实操）',
    goals: ['识读双重联锁正反转启动、能耗制动控制线路原理图', '理解能耗制动：停机时切断交流电源，给定子绕组通入直流电，使电动机迅速停转', '完成电路的安装、接线与调试'],
    tools: ['螺钉旋具', '试电笔', '剥线钳', '尖嘴钳', '钢丝钳', '万用表', '绝缘电阻表'],
    steps: ['识读电路图', '检测元器件（含二极管、电阻）', '安装元器件', '接线', '通电调试'],
    note: '实训台用空开 QF 代替题图中的刀开关 QS；控制电路接在 U、V 两相之间（380 V），线圈选 380 V；KM1、KM2 各加一个辅助常闭触头；KT 用通电延时型的延时断开常闭；每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上 QF，按 SB2 正转、SB3 直接反转；按下 SB1：KM1/KM2 释放、KM3 吸合能耗制动，KT 到时后 KM3 释放。',
  runMsg: '已合闸：SB2 正转、SB3 反转（可直接互换）；按 SB1 能耗制动，KT 到时自动结束',
  answers: [
    { name: '教材接法', desc: 'FU1 出线 U 相依次接 FU2、KM1、KM2、KM3 两极；KM3 第 1 极经 VD4、R 接 N；控制电路按 1～27 号线顺序', chains: {} },
    { name: '入口出口法', desc: '7号线：SB1常闭 出 → KM1自锁 入 → SB2常开 入 → SB3常开 入 → KM2自锁 入；21号线：SB1常开 出 → KM3自锁 出 → KT线圈 → KT延时断开',
      chains: { 7: ['SB1.co', 'KM1.t3', 'SB2.ai', 'SB3.ai', 'KM2.t3'], 21: ['SB1.ao', 'KM3.b3', 'KT.a1', 'KT.ci'] } },
  ],
  groups: [
    { name: '主电路 · U12（6 个端子）', nets: ['U12'], why: 'FU1 出线 U 相 = FU2（U 相）入 = KM1、KM2 主触点 1/L1 = KM3 第 2、3 极：U 相同时给控制电路、正反转和制动供电。' },
    { name: '主电路 · V12、W12', nets: ['V12', 'W12'], why: 'V12 还要接 FU2（V 相），给控制电路做 2 号线的电源。' },
    { name: '主电路 · 换相与制动出线', nets: ['U13', 'V13', 'W13'], why: 'KM1 出线、KM2 出线（任意两相对调）、KM3 出线、FR 进线是同一组点：KM2 吸合反转，KM3 吸合时直流加在电动机绕组上制动。' },
    { name: '制动回路', nets: ['N', 'U15', 'U14'], why: 'N → R → U15 → VD4 → U14 → KM3 第 1 极：半波整流得到制动用的直流。' },
    { name: '控制电路 · 3号线、7号线', nets: ['3', '7'], why: '3号线 = FR常闭 出 + KM3常闭 入 + KM3自锁 入 + SB1常开 入；7号线 = SB1常闭 出 + SB2常开 入 + KM1自锁 入 + SB3常开 入 + KM2自锁 入。' },
    { name: '控制电路 · 9、15、21号线', nets: ['9', '15', '21'], why: '9号线 = SB2常开 出 + KM1自锁 出 + SB3常闭 入；15号线 = SB3常开 出 + KM2自锁 出 + SB2常闭 入；21号线 = SB1常开 出 + KM3自锁 出 + KT延时断开 入 + KT线圈 A1。' },
    { name: '控制电路 · 2号线', nets: ['2'], why: 'FU2（V 相）出 + 四个线圈的 A2（KM1、KM2、KM3、KT），五个端子任意串接。' },
  ],
};
