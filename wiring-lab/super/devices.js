// 实物板上「零件多、又没有 parts.js 现成函数」的那几种元件：时间继电器三种、电动机接线盒三种、
// 制动电阻、整流二极管两种、位置开关、控制变压器、三极空开、接触器的辅助触头。
//
// ★ 这份文件是**搬运**，不是重画：每一段都是从 circuit24 / circuit25 / circuit26 / circuitE1 / circuitE2
//   的 drawExtra 里原样摘出来的（坐标按原件左上角平移，其它一个数字没动），
//   练习页（drawExtra）和超级排位（super.js 的 KINDS）都调这里 —— 一处实现、两处调用，
//   所以两边的元件长得一模一样，不会再出现「超级排位里 KT 是自己另画的一只」。
//
// 约定：
//   · ox, oy = 元件外框（shadowBox）左上角，和 SUPER_PARTS 的「元件原点」同一个口径；
//   · pins   = { 端子名: [x, y] } 的**绝对坐标**表（练习页传 TP，超级排位传实例算出来的端子），
//              螺丝就画在这些点上 —— 「看到的螺丝 = 能点的端子」这条不变；
//   · st     = 元件状态（延时、进度、接法…），全都有默认值，静态页面不传也画得出来。
// 加载顺序：parts.js 之后（用到 shadowBox / lin / screw / rrect / text）。
(function () {
  const D = {};
  /* 元件自身的固有颜色（不是主题色，是「这颗零件长这样」的一部分）：
     按钮帽绿 = board.js 的 BTN 表；辅助触点常开绿 / 常闭橙 = circuitE2.js 原来写在调用处的那两个值。
     放在这里是为了让 super.js 一个色值都不用写（两边传的都是这几个常量）。 */
  D.CAP_GREEN = '#22c55e';
  D.CAP_RED = '#ef4444';     // 停止按钮的红色帽：board.js 的 BTN 表里 SB1 全用这个值（红=停止）
  D.NO_COL = '#4ade80';
  D.NC_COL = '#fb923c';
  const S = (o, k, d) => (o && o[k] !== undefined ? o[k] : d);
  // 从练习页的 TP 表里挑几个端子交给元件（超级排位那边传自己算出来的实例端子，口径一样）
  D.take = function (TP, prefix, ids) {
    const o = {};
    ids.forEach(id => { if (TP[prefix + id]) o[id] = TP[prefix + id]; });
    return o;
  };

  // 拨杆开关（E2 的 SQ1、QF2 共用）
  D.lever = function (cx, cy, on, onTxt, offTxt, label) {
    g.save(); g.translate(cx, cy); g.rotate(on ? 0.5 : -0.5);
    rrect(-5, -30, 10, 30, 4, on ? '#2563eb' : '#64748b');
    g.beginPath(); g.arc(0, -30, 8, 0, 7); g.fillStyle = on ? '#3b82f6' : '#94a3b8'; g.fill(); g.restore();
    g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fillStyle = '#334155'; g.fill();
    text(on ? onTxt : offTxt, cx, cy + 26, 12, on ? '#2563eb' : '#475569', 'center', 'bold');
    if (label) text(label, cx, cy - 48, 11, '#475569', 'center');
  };

  // ── 时间继电器 2.5：通电延时，一排 6 个端子（148×166）← circuit25.js:274-289 ──
  D.kt6 = function (ox, oy, pins, st, label) {
    const delay = S(st, 'delay', 3), on = !!S(st, 'on', 0), done = !!S(st, 'done', 0);
    const k = done ? 1 : on ? Math.min(1, S(st, 'k', 0)) : 0;
    shadowBox(ox, oy, 148, 166, 12, lin(0, oy, 0, oy + 166, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    text(label || 'KT 时间继电器', ox + 74, oy + 18, 13, '#0f172a', 'center', 'bold');
    const cx = ox + 75, cy = oy + 62;
    g.save(); g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.fillStyle = '#0f172a'; g.fill();
    g.strokeStyle = 'rgba(148,163,184,.35)'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.stroke();
    if (k > 0) {
      g.strokeStyle = done ? '#22c55e' : '#f59e0b'; g.shadowColor = g.strokeStyle; g.shadowBlur = 10;
      g.beginPath(); g.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + k * 6.283); g.stroke();
    }
    g.restore();
    text(done ? '到时' : on ? Math.max(0, delay - S(st, 'e', 0)).toFixed(1) : delay + 's', cx, cy + 1,
      done ? 13 : 14, done ? '#4ade80' : on ? '#fbbf24' : '#e2e8f0', 'center', 'bold');
    ['minus', 'plus'].forEach((kk, i) => {
      const bx = ox + (i ? 116 : 34), by = oy + 96;
      g.save(); g.beginPath(); g.arc(bx, by, 13, 0, 7); g.fillStyle = '#e2e8f0'; g.fill();
      g.strokeStyle = '#64748b'; g.lineWidth = 1.2; g.stroke(); g.restore();
      text(i ? '+' : '−', bx, by + 1, 18, '#0f172a', 'center', 'bold');
    });
    text('延时 ' + delay + ' 秒', cx, oy + 108, 11, '#475569', 'center', 'bold');
    rrect(ox + 6, oy + 130, 136, 32, 6, '#4b5563');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    text('延时闭合', ox + 28, oy + 122, 10, '#059669', 'center', 'bold');
    text('延时断开', ox + 76, oy + 122, 10, '#d97706', 'center', 'bold');
    text('线圈', ox + 124, oy + 122, 10, '#334155', 'center', 'bold');
  };

  // ── 时间继电器 E1：只用到延时断开 + 线圈，4 个端子（150×158）← circuitE1.js:283-295 ──
  D.kt4 = function (ox, oy, pins, st, label) {
    const delay = S(st, 'delay', 3), on = !!S(st, 'on', 0), done = !!S(st, 'done', 0);
    const k = done ? 1 : on ? Math.min(1, S(st, 'k', 0)) : 0;
    shadowBox(ox, oy, 150, 158, 12, lin(0, oy, 0, oy + 158, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    text(label || 'KT 时间继电器', ox + 75, oy + 16, 13, '#0f172a', 'center', 'bold');
    const cx = ox + 75, cy = oy + 58;
    g.save(); g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.fillStyle = '#0f172a'; g.fill();
    if (k > 0) {
      g.strokeStyle = done ? '#22c55e' : '#f59e0b'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + k * 6.283); g.stroke();
    }
    g.restore();
    text(done ? '到时' : on ? Math.max(0, delay - S(st, 'e', 0)).toFixed(1) : delay + 's', cx, cy + 1, 13,
      done ? '#4ade80' : on ? '#fbbf24' : '#e2e8f0', 'center', 'bold');
    ['minus', 'plus'].forEach((kk, i) => {
      const bx = ox + (i ? 116 : 34), by = oy + 70;
      g.save(); g.beginPath(); g.arc(bx, by, 12, 0, 7); g.fillStyle = '#e2e8f0'; g.fill();
      g.strokeStyle = '#64748b'; g.lineWidth = 1.2; g.stroke(); g.restore();
      text(i ? '+' : '−', bx, by + 1, 17, '#0f172a', 'center', 'bold');
    });
    rrect(ox + 6, oy + 124, 138, 30, 6, '#4b5563');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    text('延时断开', ox + 39, oy + 114, 10, '#d97706', 'center', 'bold');
    text('线圈', ox + 107, oy + 114, 10, '#334155', 'center', 'bold');
  };

  // ── 时间继电器 E2：断电延时，上下两排 6 个端子（204×140）← circuitE2.js:351-361 ──
  D.kt2r = function (ox, oy, pins, st, label) {
    const delay = S(st, 'delay', 3), on = !!S(st, 'on', 0), done = !!S(st, 'done', 0);
    const k = S(st, 'k', 0);
    shadowBox(ox, oy, 204, 140, 10, lin(0, oy, 0, oy + 140, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    ['NC', 'NO', '线圈'].forEach((s, i) => {
      if (pins && pins['t' + i]) text(s, pins['t' + i][0], oy + 70, 11, ['#c2410c', '#15803d', '#334155'][i], 'center', 'bold');
    });
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    const cx = ox + 158, cy = oy + 56;
    g.save(); g.beginPath(); g.arc(cx, cy, 22, 0, 7); g.fillStyle = '#0f172a'; g.fill();
    if (k > 0) {
      g.strokeStyle = on ? '#22c55e' : '#f59e0b'; g.lineWidth = 5;
      g.beginPath(); g.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + k * 6.283); g.stroke();
    }
    g.restore();
    text(on ? '通电' : done ? Math.max(0, delay - S(st, 'e', 0)).toFixed(1) : delay + 's', cx, cy + 1, 12,
      on ? '#4ade80' : done ? '#fbbf24' : '#e2e8f0', 'center', 'bold');
    ['minus', 'plus'].forEach((kk, i) => {
      const bx = ox + (i ? 180 : 136), by = oy + 108;
      g.save(); g.beginPath(); g.arc(bx, by, 12, 0, 7); g.fillStyle = '#e2e8f0'; g.fill();
      g.strokeStyle = '#64748b'; g.lineWidth = 1.2; g.stroke(); g.restore();
      text(i ? '+' : '−', bx, by + 1, 17, '#0f172a', 'center', 'bold');
    });
    text(label || 'KT 断电延时', ox + 102, oy + 152, 13, C.ink, 'center', 'bold');
  };

  // ── 电动机接线盒 2.4 / 2.5：6 个出线端，已拆连接片（340×84）← circuit24.js:251-258 / circuit25.js:266-275 ──
  //   st.label：盒子下方那行状态字（星形/三角形/停止…），默认是「已拆连接片」那句
  D.m6 = function (ox, oy, pins, names, st) {
    shadowBox(ox, oy, 340, 84, 10, lin(0, oy, 0, oy + 84, [[0, '#334155'], [1, '#0f172a']]), '#0f172a');
    rrect(ox + 164, oy + 6, 2, 60, 1, '#64748b');
    (names || []).forEach((n, i) => {
      const p = pins && pins['t' + i]; if (!p) return;
      screw(p[0], p[1], 9); text(n, p[0], p[1] + 26, 14, i < 3 ? '#e2e8f0' : '#fbbf24', 'center', 'bold');
    });
    text('首端', ox + 80, oy + 70, 12, '#94a3b8', 'center', 'bold');
    text('末端', ox + 250, oy + 70, 12, '#94a3b8', 'center', 'bold');
    text(S(st, 'label', '电动机接线盒（6 个出线端，已拆连接片）'), ox + 170, oy + 100, 14,
      S(st, 'col', C.dim), 'center', 'bold');
  };

  // ── 电动机接线盒 2.6：双速，间距 38，端子名顺序 U1 V1 W1 U2 V2 W2（248×84）← circuit26.js:256-263 ──
  D.m6b = function (ox, oy, pins, names, st) {
    shadowBox(ox, oy, 248, 84, 10, lin(0, oy, 0, oy + 84, [[0, '#334155'], [1, '#0f172a']]), '#0f172a');
    rrect(ox + 123, oy + 6, 2, 60, 1, '#64748b');
    (names || []).forEach((n, i) => {
      const p = pins && pins['t' + i]; if (!p) return;
      screw(p[0], p[1], 9); text(n, p[0], p[1] + 26, 14, i < 3 ? '#e2e8f0' : '#fbbf24', 'center', 'bold');
    });
    text('首端', ox + 62, oy + 70, 12, '#94a3b8', 'center', 'bold');
    text('中点抽头', ox + 186, oy + 70, 12, '#94a3b8', 'center', 'bold');
    text(S(st, 'label', '双速电动机接线盒（6 个出线端）'), ox + 124, oy + 100, 14, S(st, 'col', C.dim), 'center', 'bold');
  };

  // ── 电动机接线盒 E2：三台各一个 3 端子盒（220×140）← circuitE2.js:269-283 motorBox ──
  D.m3 = function (ox, oy, pins, name, label, run, state, ang) {
    shadowBox(ox, oy, 220, 140, 12, lin(0, oy, 0, oy + 140, [[0, '#e2e8f0'], [1, '#94a3b8']]), run ? C.cur : '#64748b');
    rrect(ox + 40, oy + 8, 140, 46, 6, '#334155');
    ['U', 'V', 'W'].forEach((s, i) => {
      const p = pins && pins['t' + i];
      text(s, p ? p[0] : ox + 60 + 50 * i, oy + 46, 11, '#fff', 'center', 'bold');
    });
    text(name, ox + 22, oy + 30, 18, '#0f172a', 'center', 'bold');
    text(label || '', ox + 72, oy + 84, 14, '#0f172a', 'left', 'bold');
    const cx = ox + 40, cy = oy + 98, a = ang || 0;
    g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = run ? C.cur : '#475569';
    for (let k = 0; k < 3; k++) { g.rotate(Math.PI * 2 / 3); g.beginPath(); g.ellipse(0, -11, 5, 11, 0, 0, 7); g.fill(); }
    g.restore();
    g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.strokeStyle = '#475569'; g.lineWidth = 2; g.stroke();
    text(state || '停止', ox + 72, oy + 112, 14, run ? C.cur : '#334155', 'left', 'bold');
  };

  // ── 制动电阻 R（148×70）← circuitE1.js:275-277 ──
  D.r = function (ox, oy, pins, label) {
    shadowBox(ox, oy, 148, 70, 10, lin(0, oy, 0, oy + 70, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    rrect(ox + 44, oy + 12, 60, 18, 4, '#b45309');
    [56, 68, 80, 92].forEach(x => rrect(ox + x, oy + 12, 4, 18, 1, '#fde68a'));
    text(label || 'R 制动电阻', ox + 74, oy + 56, 12, '#0f172a', 'center', 'bold');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
  };

  // ── 整流二极管 E1：横放，左阳右阴（148×70）← circuitE1.js:278-281 ──
  D.vd = function (ox, oy, pins, label) {
    shadowBox(ox, oy, 148, 70, 10, lin(0, oy, 0, oy + 70, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    g.save(); g.fillStyle = '#0f172a'; g.beginPath();
    g.moveTo(ox + 60, oy + 12); g.lineTo(ox + 60, oy + 32); g.lineTo(ox + 88, oy + 22); g.closePath(); g.fill(); g.restore();
    rrect(ox + 88, oy + 11, 4, 22, 1, '#0f172a');
    poly([[ox + 44, oy + 22], [ox + 60, oy + 22]], '#0f172a', 2);
    poly([[ox + 92, oy + 22], [ox + 108, oy + 22]], '#0f172a', 2);
    text(label || 'VD4 二极管', ox + 74, oy + 56, 12, '#0f172a', 'center', 'bold');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
  };

  // ── 整流二极管 E2：竖放，上阳下阴（50×140）← circuitE2.js:362-367 ──
  D.vd2 = function (ox, oy, pins, label) {
    shadowBox(ox, oy, 50, 140, 8, lin(0, oy, 0, oy + 140, [[0, '#f8fafc'], [1, '#cbd5e1']]), '#64748b');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    g.save(); g.fillStyle = '#0f172a'; g.beginPath();
    g.moveTo(ox + 13, oy + 58); g.lineTo(ox + 37, oy + 58); g.lineTo(ox + 25, oy + 78); g.closePath(); g.fill(); g.restore();
    rrect(ox + 13, oy + 78, 24, 4, 1, '#0f172a');
    poly([[ox + 25, oy + 44], [ox + 25, oy + 58]], '#0f172a', 2);
    poly([[ox + 25, oy + 82], [ox + 25, oy + 96]], '#0f172a', 2);
    text(label || 'VD', ox + 25, oy + 152, 13, C.ink, 'center', 'bold');
  };

  // ── 位置开关 SQ（132×140，带拨杆）← circuitE2.js:346-350 ──
  D.sq = function (ox, oy, pins, on, label) {
    shadowBox(ox, oy, 132, 140, 10, lin(0, oy, 0, oy + 140, [[0, '#fef3c7'], [1, '#fcd34d']]), '#b45309');
    [0, 1].forEach(i => {
      const p = pins && pins['t' + i];
      if (p) text(i ? 'NO' : 'NC', p[0], oy + 70, 11, i ? '#15803d' : '#c2410c', 'center', 'bold');
    });
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    D.lever(ox + 106, oy + 70, !!on, '压下', '复位', null);
    text(label || 'SQ1', ox + 43, oy + 152, 13, C.ink, 'center', 'bold');
  };

  // ── 控制变压器 TC（146×140）← circuitE2.js:368-373 ──
  D.tc = function (ox, oy, pins, on, label) {
    shadowBox(ox, oy, 146, 140, 10, lin(0, oy, 0, oy + 140, [[0, '#e2e8f0'], [1, '#94a3b8']]), '#475569');
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    rrect(ox + 38, oy + 48, 70, 44, 6, on ? '#b45309' : '#78350f');
    text('380V', ox + 73, oy + 42, 10, '#334155', 'center', 'bold');
    text('127V', ox + 73, oy + 100, 10, '#334155', 'center', 'bold');
    text('0', ox + 30, oy + 100, 10, '#334155', 'center', 'bold');
    text('TC', ox + 73, oy + 71, 16, '#fef3c7', 'center', 'bold');
    text(label || 'TC 控制变压器', ox + 73, oy + 152, 13, C.ink, 'center', 'bold');
  };

  // ── 三极空开 QF2（192×140，带拨杆）← circuitE2.js:374-378 ──
  D.qf3 = function (ox, oy, pins, on, label) {
    shadowBox(ox, oy, 192, 140, 10, lin(0, oy, 0, oy + 140, [[0, '#f8fafc'], [1, '#e2e8f0']]), '#94a3b8');
    [0, 1, 2].forEach(i => {
      const p = pins && pins['t' + i];
      if (p) text('UVW'[i], p[0], oy + 70, 11, '#1f2937', 'center', 'bold');
    });
    Object.keys(pins || {}).forEach(n => screw(pins[n][0], pins[n][1], 8));
    D.lever(ox + 160, oy + 70, !!on, 'ON', 'OFF', null);
    text(label || 'QF2', ox + 96, oy + 152, 13, C.ink, 'center', 'bold');
  };

  // ── 接触器右侧辅助常闭 21/22（E1，接在接触器右边）← circuitE1.js:269-273 ──
  //   调用方式和 partKM 一致：先 partKM(ox-?, oy-?, …)，这里的 ox/oy 是那块小板自己的左上角
  D.kmaux = function (ox, oy, pins) {
    shadowBox(ox, oy, 36, 188, 8, lin(0, oy, 0, oy + 188, [[0, '#1e293b'], [1, '#0f172a']]), '#334155');
    if (pins && pins.t6) screw(pins.t6[0], pins.t6[1], 8);
    if (pins && pins.b6) screw(pins.b6[0], pins.b6[1], 8);
    text('21', ox + 18, oy + 40, 11, '#fb923c', 'center', 'bold');
    text('NC', ox + 18, oy + 94, 11, '#fb923c', 'center', 'bold');
    text('22', ox + 18, oy + 148, 11, '#fb923c', 'center', 'bold');
  };

  // ── 接触器下排辅助触头（E2 第三排：KM1 常开 43/44、KM4 常闭 31/32）← circuitE2.js:340-345 ──
  D.kmauxb = function (ox, oy, pins, kind, a, b, col, label) {
    col = col || (kind === 'NO' ? D.NO_COL : D.NC_COL);   // 调用处不传就按常开/常闭取色
    shadowBox(ox, oy, 50, 140, 8, lin(0, oy, 0, oy + 140, [[0, '#1e293b'], [1, '#0f172a']]), '#334155');
    if (pins && pins.t6) screw(pins.t6[0], pins.t6[1], 8);
    if (pins && pins.b6) screw(pins.b6[0], pins.b6[1], 8);
    text(a, ox + 25, oy + 44, 11, col, 'center', 'bold');
    text(kind, ox + 25, oy + 70, 11, col, 'center', 'bold');
    text(b, ox + 25, oy + 96, 11, col, 'center', 'bold');
    text(label, ox + 25, oy + 152, 11, C.dim, 'center', 'bold');
  };

  window.DEV = D;
})();
