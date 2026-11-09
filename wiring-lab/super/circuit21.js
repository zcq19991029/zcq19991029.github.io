// 项目 2.1 三相笼型异步电动机单向起动电路：接线练习页用的实物板、原理图和答案（按教材图 2-1、图 2-2）
// 实训室做法和 2.2 一样：三相四线空开 QF（3P+N）进线端由实训台供电，不接线；主电路接到 FR 进线端为止，不接电动机；
// 按钮装在板上直接接线，不经端子排；KM 线圈 A2 从 QF 下端的 N 取零线。元件位置和 2.2 相同（少了 KM2 和 SB3）。

// ---------- 实物板 ----------
const TP = {}; // 端子坐标
QF_POLES.forEach((p, i) => { TP['QF.t' + i] = [870 + 60 * i, 162]; TP['QF.b' + i] = [870 + 60 * i, 288]; });
for (let i = 0; i < 3; i++) {
  TP['FU1.t' + i] = [1170 + 70 * i, 162]; TP['FU1.b' + i] = [1170 + 70 * i, 288];
  TP['FR.t' + i] = [885 + 40 * i, 812]; TP['FR.b' + i] = [885 + 40 * i, 918];
}
TP['FU2.t'] = [1400, 162]; TP['FU2.b'] = [1400, 288];
TP['FR.t4'] = [1045, 812]; TP['FR.b4'] = [1045, 918];
for (let c = 0; c < 6; c++) { TP['KM1.t' + c] = [885 + 40 * c, 502]; TP['KM1.b' + c] = [885 + 40 * c, 662]; }
const BTN = { SB1: [1560, '#ef4444', '停止'], SB2: [1700, '#22c55e', '起动'] };
for (const k in BTN) { TP[k + '.i'] = [BTN[k][0] - 26, 270]; TP[k + '.o'] = [BTN[k][0] + 26, 270]; }

// 端子的说法（状态栏用）。教材 2.1 只有一个接触器，叫 KM（程序里仍按 KM1 处理）
function termName(k) {
  const [d, t] = k.split('.'), i = +t.slice(1), top = t[0] === 't';
  if (d === 'QF') return `QF ${top ? '进线' : '出线'} ${QF_POLES[i]}`;
  if (d === 'FU1') return `FU1 ${top ? '进线' : '出线'}`;
  if (d === 'FU2') return `FU2 ${top ? '进线' : '出线'}`;
  if (d === 'FR') return i === 4 ? `FR 常闭 ${top ? '95' : '96'}` : `FR 进线 ${['1/L1', '3/L2', '5/L3'][i]}`;
  if (d === 'KM1') {
    const lab = (top ? KM_TOP : KM_BOT)[i];
    return `KM ${i < 3 ? (top ? '主触点进线 ' : '主触点出线 ') + lab : i === 3 ? '常开 ' + lab : i === 4 ? '常闭 ' + lab : '线圈 ' + lab}`;
  }
  if (/^SB/.test(d)) return `${d} ${t === 'i' ? '入口' : '出口'}`;
  return k;
}

// 导线（教材顺序）：id、线号、起点、终点、走线、对应原理图的边。共 17 根
const BW = [];
const bw = (id, net, a, b, pts, sch) => BW.push({ id, net, a, b, pts, sch });
bw('U11', 'U11', 'QF.b0', 'FU1.t0', [[870, 288], [870, 340], [1146, 340], [1146, 134], [1170, 134], [1170, 162]], ['w110']);
bw('V11', 'V11', 'QF.b1', 'FU1.t1', [[930, 288], [930, 330], [1138, 330], [1138, 126], [1240, 126], [1240, 162]], ['w111']);
bw('W11', 'W11', 'QF.b2', 'FU1.t2', [[990, 288], [990, 320], [1130, 320], [1130, 118], [1310, 118], [1310, 162]], ['w112']);
bw('W11c', 'W11', 'FU1.t2', 'FU2.t', [[1316, 162], [1316, 144], [1400, 144], [1400, 162]], ['wW11']);
bw('U12', 'U12', 'FU1.b0', 'KM1.t0', [[1170, 288], [1170, 370], [885, 370], [885, 502]], ['w120']);
bw('V12', 'V12', 'FU1.b1', 'KM1.t1', [[1240, 288], [1240, 380], [925, 380], [925, 502]], ['w121']);
bw('W12', 'W12', 'FU1.b2', 'KM1.t2', [[1310, 288], [1310, 390], [965, 390], [965, 502]], ['w122']);
bw('U13', 'U13', 'KM1.b0', 'FR.t0', [[885, 662], [885, 812]], ['wk1b0']);
bw('V13', 'V13', 'KM1.b1', 'FR.t1', [[925, 662], [925, 812]], ['wk1b1']);
bw('W13', 'W13', 'KM1.b2', 'FR.t2', [[965, 662], [965, 812]], ['wk1b2']);
bw('c1', '1', 'FU2.b', 'FR.t4', [[1400, 288], [1400, 310], [1600, 310], [1600, 790], [1045, 790], [1045, 812]], ['w1']);
bw('c2', '2', 'FR.b4', 'SB1.i', [[1045, 918], [1045, 945], [1640, 945], [1640, 300], [1534, 300], [1534, 270]], ['w2']);
bw('b3', '3', 'SB1.o', 'SB2.i', [[1586, 270], [1586, 286], [1674, 286], [1674, 270]], ['w3', 'w3s2']);
bw('c3', '3', 'SB2.i', 'KM1.t3', [[1680, 270], [1680, 446], [1011, 446], [1011, 502]], ['w3b1', 'w3k1']);
bw('c4', '4', 'SB2.o', 'KM1.b3', [[1726, 270], [1726, 706], [1005, 706], [1005, 662]], ['w4s2', 'w4k1']);
bw('c4b', '4', 'KM1.b3', 'KM1.t5', [[1011, 662], [1011, 694], [1130, 694], [1130, 476], [1085, 476], [1085, 502]], ['w4']);
bw('cN', 'N', 'QF.b3', 'KM1.b5', [[1050, 288], [1050, 302], [824, 302], [824, 726], [1091, 726], [1091, 662]], ['wNA', 'wN']);
const BW_NET = Object.fromEntries(BW.map(x => [x.id, x.net]));
const BWID = Object.fromEntries(BW.map(x => [x.id, x]));

// 板上电路：导线 + 元件内部的通断。仿真电源：三相四线接在 QF 进线端；FR 出线后面接一台虚拟电动机
const BE = BW.map(x => ({ id: x.id, a: x.a, b: x.b }));
QF_POLES.forEach((p, i) => BE.push({ id: 'QF' + i, a: 'QF.t' + i, b: 'QF.b' + i, on: s => s.QF }));
for (let i = 0; i < 3; i++) {
  BE.push({ id: 'FU1' + i, a: 'FU1.t' + i, b: 'FU1.b' + i });
  BE.push({ id: 'FR' + i, a: 'FR.t' + i, b: 'FR.b' + i });
  BE.push({ id: 'M' + i, a: 'FR.b' + i, b: 'S', load: true });
}
BE.push({ id: 'FU2', a: 'FU2.t', b: 'FU2.b' }, { id: 'FRnc', a: 'FR.t4', b: 'FR.b4', on: s => !s.FR });
{ const on = s => s.km1;
  for (let c = 0; c < 3; c++) BE.push({ id: 'KM1m' + c, a: 'KM1.t' + c, b: 'KM1.b' + c, on });
  BE.push({ id: 'KM1no', a: 'KM1.t3', b: 'KM1.b3', on }, { id: 'KM1nc', a: 'KM1.t4', b: 'KM1.b4', on: s => !on(s) });
  BE.push({ id: 'KM1coil', a: 'KM1.t5', b: 'KM1.b5', load: true }); }
BE.push({ id: 'SB1', a: 'SB1.i', b: 'SB1.o', on: s => !s.SB1 }, { id: 'SB2', a: 'SB2.i', b: 'SB2.o', on: s => s.SB2 });

// ---------- 原理图（按教材图 2-1 版面重画；设计坐标 1000×720，画时整体缩放）----------
const SCH = { x: 34, y: 112, s: 0.74 };
const SX = [70, 140, 210], CA = 660, CA2 = 760; // 主电路三相的 x；控制电路主干和自锁触点的 x
const SE = [];
const sw = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const sel = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });
for (let i = 0; i < 3; i++) {
  const x = SX[i], p = 'UVW'[i];
  sw('wL' + i, PH[i], [[x, 38], [x, 70]], PH[i], 'qa' + i);
  sel('QF' + i, 'qf', x, 70, 120, 'qa' + i, p + '11', s => s.QF);
  sw('w11' + i, p + '11', [[x, 120], [x, 160]], p + '11', 'fa' + i);
  sel('FU1' + i, 'fuse', x, 160, 215, 'fa' + i, 'fb' + i);
  sw('w12' + i, p + '12', [[x, 215], [x, 330]], 'fb' + i, 'k1a' + i);
  sel('KM1' + i, 'km', x, 330, 385, 'k1a' + i, 'k1b' + i, s => s.km1);
  sw('wk1b' + i, p + '13', [[x, 385], [x, 520]], 'k1b' + i, 'h' + i);
  sel('FRh' + i, 'heat', x, 520, 565, 'h' + i, 'hb' + i);
  const mt = [[110, 626], [140, 618], [170, 626]][i];
  sw('wo' + i, p, [[x, 565], [x, 595], mt], 'hb' + i, 'mt' + i);
  SE.push({ id: 'MW' + i, kind: 'none', a: 'mt' + i, b: 'S', load: true, pts: [mt, [140, 670]] });
}
sw('wW11', 'W11', [[580, 40], [600, 40]], 'W11', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 600, x2: 650, y: 40, a: 'f2a', b: 'f2b', pts: [[600, 40], [650, 40]] });
sw('w1', '1', [[650, 40], [CA, 40], [CA, 80]], 'f2b', 'n1');
sel('FR_NC', 'nc', CA, 80, 125, 'n1', 'n2', s => !s.FR);
sw('w2', '2', [[CA, 125], [CA, 165]], 'n2', 's1a');
sel('SB1', 'bnc', CA, 165, 210, 's1a', 'n3', s => !s.SB1);
sw('w3', '3', [[CA, 210], [CA, 250]], 'n3', 'b3A');
sw('w3s2', '3', [[CA, 250], [CA, 290]], 'b3A', 'sb2a');
sel('SB2', 'bno', CA, 290, 335, 'sb2a', 'sb2b', s => s.SB2);
sw('w4s2', '4', [[CA, 335], [CA, 375]], 'sb2b', 'j4A');
sw('w3b1', '3', [[CA, 250], [CA2, 250]], 'b3A', 'b3B');
sw('w3k1', '3', [[CA2, 250], [CA2, 290]], 'b3B', 'k1na');
sel('KM1_NO', 'no', CA2, 290, 335, 'k1na', 'k1nb', s => s.km1);
sw('w4k1', '4', [[CA2, 335], [CA2, 375], [CA, 375]], 'k1nb', 'j4A');
sw('w4', '4', [[CA, 375], [CA, 520]], 'j4A', 'c1a');
sel('KM1_coil', 'coil', CA, 520, 560, 'c1a', 'c1b', null, { load: true });
sw('wNA', 'N', [[CA, 560], [CA, 620]], 'c1b', 'nA');
sw('wN', 'N', [[CA, 620], [590, 620]], 'nA', 'N');
const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
const EDGE_T = {}, EDGE_COL = {}; // 练习页每帧按学生接的线重算
function schSolve(s) {
  return solve('sch21', SE, s, s.QF ? ['L1', 'L2', 'L3', 'W11'] : ['L1', 'L2', 'L3'], ['S', 'N'], [s.QF, s.SB1, s.SB2, s.FR, s.km1].join(''));
}
function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil'].filter(id => R.cur.has(id)));
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
  [[CA, 250], [CA, 375], [CA, 620]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  poly([[SX[0] - 8, 95], [SX[2] + 4, 95]], C.ink, 1.5, [6, 5]);
  poly([[SX[0] - 8, 360], [SX[2] + 4, 360]], C.ink, 1.5, [6, 5]);
  const run = Math.abs(s.w) > 0.05;
  g.save(); g.fillStyle = run ? (C.paperRun || '#fff7ed') : (C.paper || '#fff'); g.strokeStyle = run ? C.cur : C.ink; g.lineWidth = 3; g.beginPath(); g.arc(140, 670, 52, 0, 7); g.fill(); g.stroke(); g.restore();
  text('M', 140, 656, 28, C.ink, 'center', 'bold'); text('3~', 140, 688, 20);
  poly([[188, 690], [240, 690], [240, 705]], C.ink, 2); poly([[226, 705], [254, 705]], C.ink, 2); poly([[231, 711], [249, 711]], C.ink, 2); poly([[236, 717], [244, 717]], C.ink, 2); text('PE', 262, 700, 18, C.ink, 'left');
  for (let i = 0; i < 3; i++) {
    const p = 'UVW'[i];
    text(PH[i], SX[i], 18, 20, C.ink, 'center', 'bold'); g.beginPath(); g.arc(SX[i], 38, 5, 0, 7); g.strokeStyle = C.ink; g.lineWidth = 2; g.fillStyle = '#fff'; g.fill(); g.stroke();
    text(p + '11', SX[i] + 6, 140, 15, C.dim, 'left'); text(p + '12', SX[i] + 6, 236, 15, C.dim, 'left');
    text(p + '13', SX[i] + 6, 450, 15, C.dim, 'left'); text(p, SX[i] + 10, 582, 18, C.ink, 'left', 'bold');
  }
  text('QF', 245, 95, 20, C.ink, 'left', 'bold'); text('FU1', 245, 188, 20, C.ink, 'left', 'bold');
  text('KM', 245, 357, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('FR', 245, 542, 20, C.ink, 'left', 'bold');
  text('W11', 575, 40, 20, C.ink, 'right', 'bold'); text('FU2', 625, 16, 18, C.ink, 'center', 'bold');
  text('FR', CA - 22, 100, 18, C.ink, 'right', 'bold'); text('SB1', CA - 48, 186, 18, C.ink, 'right', 'bold');
  text('SB2', CA - 48, 310, 18, C.ink, 'right', 'bold'); text('KM', CA2 + 12, 312, 17, s.km1 ? C.cur : C.ink, 'left', 'bold');
  text('KM', CA + 34, 540, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('N', 578, 620, 22, C.ink, 'right', 'bold');
  [['1', CA, 62], ['2', CA, 146], ['3', CA, 232], ['4', CA, 450]].forEach(([n, x, y]) => text(n, x + 10, y, 16, C.dim, 'left'));
  g.restore();
}
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };

// ---------- 练习页的电路信息 ----------
const CIRCUIT = {
  id: '2.1', key: 'zfz-practice-2.1', schW: 820, // 原理图设计宽度（练习页按它自动缩放）
  title: '三相异步电动机 单向起动 · 接线练习',
  kms: ['KM1'], labels: { KM1: 'KM' },
  nEnd: [598, 620],
  // 本节内容（按教师备课 2.1 第一页）
  lesson: {
    name: '三相笼型异步电动机单向起动电路的安装、接线与调试',
    goals: ['识读三相笼型异步电动机单向起动电路工作原理图', '完成电路安装接线与调试', '掌握识别元器件，用万用表测量元器件好坏与通断'],
    tools: ['螺丝刀', '剥线钳', '压线钳', '万用表', '端子'],
    steps: ['识读电路图', '检测元器件', '安装元器件', '接线', '验收加分'],
    note: '实训室做法：空开进线由实训台供电，不接电动机和端子排；每个端子最多接两根线。',
  },
  okMsg: '接线全部正确！合上空开 QF，按 SB2 起动（松手后靠自锁继续运转），按 SB1 停止。',
  runMsg: '空开已合闸，按 SB2 起动、SB1 停止（原理图同步发光）',
  answers: [
    { name: '教材图 2-2 接法', desc: 'QF→FU1→FU2；3号线 SB1→SB2→KM自锁；4号线 SB2→KM自锁→KM线圈', chains: {} },
    { name: '入口出口法', desc: 'KM自锁 入 接 SB1 出（上一个元件的出口），KM自锁 出 接 KM线圈 入（下一个元件的入口）',
      chains: { W11: ['QF.b2', 'FU2.t', 'FU1.t2'], 3: ['SB1.o', 'KM1.t3', 'SB2.i'], 4: ['SB2.o', 'KM1.t5', 'KM1.b3'] } },
  ],
  groups: [
    { name: '主电路 · 电源分配', nets: ['W11'], why: 'QF 出线 L3（W11）要同时接 FU1 和控制熔断器 FU2：QF 出、FU1 入、FU2 入是同一个点，三个端子任意串接都对。' },
    { name: '控制电路 · 自锁并联起点（3号线）', nets: ['3'], why: 'SB1 出口 = SB2 入口 = KM自锁触点入口，三个端子是同一个点，任意串接都对（入口出口法）。' },
    { name: '控制电路 · 自锁并联终点（4号线）', nets: ['4'], why: 'SB2 出口 = KM自锁触点出口 = KM线圈入口（A1），三个端子是同一个点，任意串接都对。' },
  ],
};
