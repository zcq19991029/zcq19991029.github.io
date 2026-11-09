// 原理图：按教材图 2-4 的版面重画。每段导线、每个触点都是电路图里的一条边，
// 由 solve() 算出哪里有电流，所以画面上的通断一定和电路逻辑一致。
// 坐标是 1000×720 的设计坐标，画的时候整体缩放到屏幕上半部分。
const SCH = { x: 34, y: 112, s: 0.74 };
const X = [70, 140, 210], KX = [320, 390, 460], JY = [255, 275, 295], MY = [440, 460, 480];
const A = 660, A2 = 740, B = 880, B2 = 960;
const P = i => 'UVW'[i];
const SE = [];   // 原理图的边
const w = (id, net, pts, a, b) => SE.push({ id, kind: 'w', net, pts, a, b });
const el = (id, kind, x, y1, y2, a, b, on, extra = {}) => SE.push({ id, kind, x, y1, y2, a, b, on, pts: [[x, y1], [x, y2]], ...extra });

// ---------- 主电路 ----------
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
  // KM2 第 i 列的出线接到第 2-i 相：L1↔L3 对调
  w('wk2b' + i, P(j) + '13', [[kx, 385], [kx, MY[i]], [X[j], MY[i]]], 'k2b' + i, 'm' + j);
  w('wm' + i, p + '13', [[x, MY[j]], [x, 520]], 'm' + i, 'h' + i);
  el('FRh' + i, 'heat', x, 520, 565, 'h' + i, 'hb' + i);
  const mt = [[110, 626], [140, 618], [170, 626]][i];
  w('wo' + i, p, [[x, 565], [x, 595], mt], 'hb' + i, 'mt' + i);
  SE.push({ id: 'MW' + i, kind: 'none', a: 'mt' + i, b: 'S', load: true, pts: [mt, [140, 670]] });
}
// ---------- 控制电路 ----------
w('wW11', 'W11', [[580, 40], [600, 40]], 'W11', 'f2a');
SE.push({ id: 'FU2', kind: 'fuseH', x1: 600, x2: 650, y: 40, a: 'f2a', b: 'f2b', pts: [[600, 40], [650, 40]] });
w('w1', '1', [[650, 40], [A, 40], [A, 80]], 'f2b', 'n1');
el('FR_NC', 'nc', A, 80, 125, 'n1', 'n2', s => !s.FR);
w('w2', '2', [[A, 125], [A, 165]], 'n2', 's1a');
el('SB1', 'bnc', A, 165, 210, 's1a', 'n3', s => !s.SB1);
w('w3', '3', [[A, 210], [A, 250]], 'n3', 'b3A');
w('w3b1', '3', [[A, 250], [A2, 250]], 'b3A', 'b3A2');
w('w3b2', '3', [[A2, 250], [B, 250]], 'b3A2', 'b3B');
w('w3b3', '3', [[B, 250], [B2, 250]], 'b3B', 'b3B2');
w('w3s2', '3', [[A, 250], [A, 290]], 'b3A', 'sb2a');
el('SB2', 'bno', A, 290, 335, 'sb2a', 'sb2b', s => s.SB2);
w('w4s2', '4', [[A, 335], [A, 375]], 'sb2b', 'j4A');
w('w3k1', '3', [[A2, 250], [A2, 290]], 'b3A2', 'k1na');
el('KM1_NO', 'no', A2, 290, 335, 'k1na', 'k1nb', s => s.km1);
w('w4k1', '4', [[A2, 335], [A2, 375], [A, 375]], 'k1nb', 'j4A');
w('w4', '4', [[A, 375], [A, 415]], 'j4A', 'nc2a');
el('KM2_NC', 'nc', A, 415, 460, 'nc2a', 'nc2b', s => !s.km2);
w('w5', '5', [[A, 460], [A, 520]], 'nc2b', 'c1a');
el('KM1_coil', 'coil', A, 520, 560, 'c1a', 'c1b', null, { load: true });
w('wNA', 'N', [[A, 560], [A, 620]], 'c1b', 'nA');
w('w3s3', '3', [[B, 250], [B, 290]], 'b3B', 'sb3a');
el('SB3', 'bno', B, 290, 335, 'sb3a', 'sb3b', s => s.SB3);
w('w6s3', '6', [[B, 335], [B, 375]], 'sb3b', 'j6B');
w('w3k2', '3', [[B2, 250], [B2, 290]], 'b3B2', 'k2na');
el('KM2_NO', 'no', B2, 290, 335, 'k2na', 'k2nb', s => s.km2);
w('w6k2', '6', [[B2, 335], [B2, 375], [B, 375]], 'k2nb', 'j6B');
w('w6', '6', [[B, 375], [B, 415]], 'j6B', 'nc1a');
el('KM1_NC', 'nc', B, 415, 460, 'nc1a', 'nc1b', s => !s.km1);
w('w7', '7', [[B, 460], [B, 520]], 'nc1b', 'c2a');
el('KM2_coil', 'coil', B, 520, 560, 'c2a', 'c2b', null, { load: true });
w('wNB', 'N', [[B, 560], [B, 620], [A, 620]], 'c2b', 'nA');
w('wN', 'N', [[A, 620], [590, 620]], 'nA', 'N');

const SEID = Object.fromEntries(SE.map(e => [e.id, e]));
// 讲解用的路径（按电流方向排序）
const PATHS = {
  fwd: ['wW11', 'FU2', 'w1', 'FR_NC', 'w2', 'SB1', 'w3', 'w3s2', 'SB2', 'w4s2', 'w4', 'KM2_NC', 'w5', 'KM1_coil', 'wNA', 'wN'],
  KM1: [0, 1, 2].flatMap(i => ['wL' + i, 'QF' + i, 'w11' + i, 'FU1' + i, 'w12' + i, 'wk1' + i, 'KM1' + i, 'wk1b' + i, 'wm' + i, 'FRh' + i, 'wo' + i]),
  KM2: [0, 1, 2].flatMap(i => ['wL' + i, 'QF' + i, 'w11' + i, 'FU1' + i, 'w12' + i, 'wtap' + i, 'KM2' + i, 'wk2b' + i, 'wm' + (2 - i), 'FRh' + (2 - i), 'wo' + (2 - i)]),
  short: ['wL0', 'QF0', 'w110', 'FU10', 'w120', 'wk10', 'KM10', 'wk1b0', 'wk2b2', 'KM22', 'wtap2', 'w122', 'FU12', 'w112', 'QF2', 'wL2'],
};
// 原理图每一段在对应的导线接好后变色
const EDGE_T = {};
const EDGE_COL = {}; // 练习页用：原理图这一段按学生实际接的线的颜色画（不设就按相色）
BW.forEach(x => { const w = WIRE_T[x.id]; if (w) x.sch.forEach(id => { if (EDGE_T[id] === undefined || w[1] < EDGE_T[id]) EDGE_T[id] = w[1]; }); });

function schSolve(s) {
  const srcs = s.QF ? ['L1', 'L2', 'L3', 'W11'] : ['L1', 'L2', 'L3'];
  return solve('sch', SE, s, srcs, ['S', 'N'], [s.QF, s.SB1, s.SB2, s.SB3, s.FR, s.km1, s.km2].join(''));
}

function drawSchematic(t, s, st) {
  const R = schSolve(s); s._coil = new Set(['KM1_coil', 'KM2_coil'].filter(id => R.cur.has(id)));
  g.save(); g.translate(SCH.x, SCH.y); g.scale(SCH.s, SCH.s);
  const colorOf = e => EDGE_T[e.id] !== undefined && t >= EDGE_T[e.id] ? (EDGE_COL[e.id] || netColor(e.net)) : C.ink;
  const reveal = st.reveal ? PATHS[st.reveal] : null, rp = st.reveal ? (t - st.t0) / st.d / 0.9 : 1;
  // 带电但没有电流的线：浅橙色底，表示“电到这里被挡住了”
  for (const e of SE) if (e.kind !== 'none' && R.act.has(e.id) && R.pot.has(e.a) && R.pot.has(e.b) && !R.cur.has(e.id) && !e.load) poly(e.pts, '#fdba74', 9);
  for (const e of SE) {
    if (e.kind === 'none') continue;
    if (e.kind === 'w') { if (C.wireEdge && colorOf(e) !== C.ink) poly(e.pts, C.wireEdge, 5.5); poly(e.pts, colorOf(e), 3); } else symbol(e, C.ink, s); // 练习页深色主题：接好的线加浅色描边，黑色控制线也看得见
    const k = reveal ? reveal.indexOf(e.id) : -2;
    const on = R.cur.has(e.id) && (k === -2 || (k >= 0 && k / reveal.length <= rp));
    if (on && e.kind === 'w') flow(e.pts, 3, t);
    if (on && e.kind !== 'w') { g.save(); g.globalAlpha = 0.85; g.shadowColor = C.cur; g.shadowBlur = 18; symbol(e, C.cur, s); g.restore(); }
  }
  for (const e of SE) if (e.kind === 'w' && e.pts.length > 2 && /^(wtap|wk2b|w4k1|w6k2|wNB)/.test(e.id)) dot(e.pts[0][0], e.pts[0][1], 4.5, C.ink);
  [[X[0], JY[0]], [X[1], JY[1]], [X[2], JY[2]], [X[2], MY[0]], [X[1], MY[1]], [X[0], MY[2]], [A2, 250], [B, 250], [A, 375], [B, 375], [A, 620]].forEach(([x, y]) => dot(x, y, 4.5, C.ink));
  // 联动虚线、电动机、文字
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
  text('SB2', A - 48, 310, 18, C.ink, 'right', 'bold'); text('KM1', A2 + 12, 328, 17, s.km1 ? C.cur : C.ink, 'left', 'bold');
  text('SB3', B - 48, 296, 18, C.ink, 'right', 'bold'); text('KM2', B2 + 12, 328, 17, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('KM2', A - 22, 436, 17, C.ink, 'right', 'bold'); text('KM1', B - 22, 436, 17, C.ink, 'right', 'bold');
  text('KM1', A + 34, 540, 20, s.km1 ? C.cur : C.ink, 'left', 'bold'); text('KM2', B + 34, 540, 20, s.km2 ? C.cur : C.ink, 'left', 'bold');
  text('N', 578, 620, 22, C.ink, 'right', 'bold');
  [['1', A, 62], ['2', A, 146], ['3', A, 232], ['4', A, 394], ['5', A, 490], ['6', B, 394], ['7', B, 490]].forEach(([n, x, y]) => text(n, x + 10, y, 16, C.dim, 'left'));
  g.restore();
}
// 设计坐标 → 屏幕坐标
const schPt = (x, y) => [SCH.x + x * SCH.s, SCH.y + y * SCH.s];
const elCenter = id => { const e = SEID[id]; return e.kind === 'fuseH' ? schPt((e.x1 + e.x2) / 2, e.y) : schPt(e.x, (e.y1 + e.y2) / 2); };
