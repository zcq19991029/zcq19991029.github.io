// 公共部分：画布、配色、画笔、电路求解器、时间轴与仿真
const W = 1920, FPS_SIM = 60;
let H = 1080; // 视频固定 1080；练习页按屏幕比例调整（见 practice.js 的 fitCanvas）
const cv = document.getElementById('c'), g = cv.getContext('2d');
const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
const C = {
  ink: '#1f2937', dim: '#64748b', faint: '#cbd5e1',
  L1: '#eab308', L2: '#16a34a', L3: '#ef4444', ctrl: '#9f1239', N: '#2563eb',
  cur: '#f97316', trace: '#0ea5e9', bad: '#e11d48', ok: '#16a34a', gold: '#f59e0b',
};
const PH = ['L1', 'L2', 'L3'];
// 导线颜色：U 相黄、V 相绿、W 相红，控制线深红，零线蓝
const netColor = n => n === 'N' ? C.N : n === 'Y' ? (C.star || '#94a3b8') : /^(L1|U)/.test(n) ? C.L1 : /^(L2|V)/.test(n) ? C.L2 : /^(L3|W)/.test(n) ? C.L3 : C.ctrl;
// 原理图样式：练习页画原理图时 on=true；line 是发光线、接好的彩色线、电流线的粗细倍数；weight 文字 0 细 / 1 标准 / 2 粗
const SCHK = { on: false, line: 1, weight: 1 };
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// ---------- 画笔 ----------
function text(s, x, y, size = 24, color = C.ink, align = 'center', weight = 'normal', stroke = null) {
  let thick = 0; if (SCHK.on && SCHK.weight !== 1) { const b = weight === 'bold'; if (SCHK.weight === 0) weight = b ? 'normal' : '300'; else { weight = 'bold'; thick = size * (b ? 0.07 : 0.03); } }
  g.save(); g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
  if (thick) { g.lineJoin = 'round'; g.lineWidth = thick; g.strokeStyle = color; g.strokeText(s, x, y); }
  if (stroke) { g.lineJoin = 'round'; g.lineWidth = stroke[1]; g.strokeStyle = stroke[0]; g.strokeText(s, x, y); }
  g.fillStyle = color; g.fillText(s, x, y); g.restore();
}
function poly(pts, color = C.ink, w = 3, dash = null) {
  if (pts.length < 2) return;
  if (SCHK.on && color !== C.ink && color !== C.cur && w >= 2.5) w *= SCHK.line; // 原理图上接好的彩色线
  g.save(); g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  if (dash) g.setLineDash(dash);
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke(); g.restore();
}
// 电流：橙色光带 + 流动的亮点
// 电流动效（练习页）：沿导线一条三角波电弧，峰高每 0.4 秒换一组随机值，新旧两组之间每帧平滑过渡；再加一道带渐隐尾巴的流光和发光。
// 随机数按时间段和位置算（同一时刻画出来一样）；只在练习页打开（视频不变）
const CFX = { on: false };
const hash01 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function alongPath(pts) { const seg = []; let L = 0; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; } return { seg, L }; }
function pointOn(pts, seg, s) { // 路径上距起点 s 处的点和法线
  for (let i = 1; i < pts.length; i++) { const d = seg[i - 1]; if (s <= d || i === pts.length - 1) { const k = d ? Math.min(1, s / d) : 0, dx = (pts[i][0] - pts[i - 1][0]) / (d || 1), dy = (pts[i][1] - pts[i - 1][1]) / (d || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k, -dy, dx]; } s -= d; }
  return [pts[0][0], pts[0][1], 0, 1];
}
const PATHS_FX = new WeakMap(); // 每根线的分段长度只算一次
function currentFX(pts, t, color, amp, w) {
  if (!CFX.on || pts.length < 2) return;
  let P0 = PATHS_FX.get(pts); if (!P0) { P0 = alongPath(pts); P0.seed = hash01(pts[0][0] * 0.13 + pts[0][1] * 0.71 + P0.L * 0.017) * 1000; PATHS_FX.set(pts, P0); }
  const { seg, L, seed } = P0; if (L < 8) return;
  const P = 0.4, k = Math.floor(t / P + seed), f0 = t / P + seed - k, f = f0 * f0 * (3 - 2 * f0);
  const n = Math.max(2, Math.round(L / 11)), wave = [];
  for (let q = 0; q <= n; q++) {
    const [x, y, nx, ny] = pointOn(pts, seg, q * L / n), edge = Math.min(1, Math.min(q, n - q) / 2), a0 = hash01(seed + q * 7.31 + k * 13.17), a1 = hash01(seed + q * 7.31 + (k + 1) * 13.17);
    const a = (0.35 + 0.65 * (a0 + (a1 - a0) * f)) * amp * (q % 2 ? 1 : -1) * edge; wave.push([x + nx * a, y + ny * a]);
  }
  g.save(); g.globalAlpha = 0.22; poly(wave, color, 4 * w); g.globalAlpha = 0.75; poly(wave, color, 1.2 * w); g.restore(); // 三角波：宽的淡色当光晕，细的亮线在上面
  // 流光：沿路径取尾巴到亮头的一段，用线性渐变从透明到亮白，下面垫一道宽的淡色当发光
  const tail = Math.min(90, L * 0.6), head = (t * 240 + seed * 3) % (L + tail), s1 = Math.max(0, head - tail), s2 = Math.min(L, head);
  if (s2 - s1 < 2) return;
  const strip = [pointOn(pts, seg, s1)]; let acc = 0;
  for (let q = 1; q < pts.length; q++) { const a = acc, b = acc + seg[q - 1]; if (b > s1 && b < s2) strip.push(pts[q]); acc = b; }
  strip.push(pointOn(pts, seg, s2));
  const A = strip[0], B = strip[strip.length - 1], gr = g.createLinearGradient(A[0], A[1], B[0], B[1]);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, color); gr.addColorStop(1, '#fffbe6');
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalAlpha = 0.25; poly(strip.map(p => [p[0], p[1]]), color, 9 * w);
  g.globalAlpha = 1; g.strokeStyle = gr; g.lineWidth = 3.5 * w; g.beginPath(); g.moveTo(A[0], A[1]); for (const p of strip.slice(1)) g.lineTo(p[0], p[1]); g.stroke();
  g.restore();
}
function flow(pts, w, t, color = C.cur) {
  if (SCHK.on) w *= SCHK.line;
  g.save(); g.shadowColor = color; g.shadowBlur = 12; poly(pts, color, w + 3); g.restore();
  g.save(); g.strokeStyle = '#fff7c2'; g.lineWidth = Math.max(2, w - 1); g.lineCap = 'round';
  g.setLineDash([5, 18]); g.lineDashOffset = -t * 110;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke(); g.restore();
  if (SCHK.on) currentFX(pts, t, '#fde68a', 4.5, w / 3);
}
// 实物板上的电流：细的流动亮点，不盖住导线颜色
function flowLight(pts, t) {
  g.save(); g.strokeStyle = '#fb923c'; g.lineWidth = 3; g.lineCap = 'round'; g.shadowColor = '#f97316'; g.shadowBlur = 6;
  g.setLineDash([4, 14]); g.lineDashOffset = -t * 90;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke(); g.restore();
}
function glowPoly(pts, color, w) { if (SCHK.on) w *= SCHK.line; g.save(); g.shadowColor = color; g.shadowBlur = 16; poly(pts, color, w); g.restore(); }
// 截取折线的前 f 部分（画线动画）
function partial(pts, f) {
  if (f >= 1) return pts; if (f <= 0) return [pts[0]];
  const seg = []; let L = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  let need = L * f; const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (need >= seg[i - 1]) { out.push(pts[i]); need -= seg[i - 1]; continue; }
    const k = need / seg[i - 1]; out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]); break;
  }
  return out;
}
function rrect(x, y, w, h, r, fill, stroke, lw = 2) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function dot(x, y, r, color) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = color; g.fill(); }
// 标签气泡
function tag(s, x, y, color, size = 22) {
  g.save(); g.font = `bold ${size}px ${FONT}`; const w = g.measureText(s).width + 18;
  rrect(x - w / 2, y - size * 0.75, w, size * 1.5, 8, color); g.restore();
  text(s, x, y + 1, size, '#fff', 'center', 'bold');
}

// ---------- 电路求解 ----------
// edges: {id, a, b, on(s) 是否导通（默认导通）, load 是否负载}
// 返回 cur：有电流流过的边；pot：带电（与电源相连、未经负载）的节点
const _solveCache = new Map();
function solve(name, edges, s, srcs, sinks, key) {
  const ck = name + '|' + key; if (_solveCache.has(ck)) return _solveCache.get(ck);
  const act = edges.filter(e => !e.on || e.on(s));
  const adj = new Map(); const add = (n, e) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(e); };
  act.forEach(e => { add(e.a, e); add(e.b, e); });
  const S = new Set(srcs), T = new Set(sinks);
  const bfs = (starts, skip, stop, noLoad) => {
    const seen = new Set(starts), q = [...starts];
    while (q.length) {
      const n = q.pop(); if (stop.has(n) && !starts.includes(n)) continue;
      for (const e of adj.get(n) || []) {
        if (e === skip || (noLoad && e.load)) continue;
        const m = e.a === n ? e.b : e.a; if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    return seen;
  };
  // 找电流路径时可以穿过负载（线圈、绕组），但穿过负载进入“另一侧”（从电源找时进入零线侧、从零线找时进入电源侧）以后只能沿导线走，
  // 不能再穿过第二个负载——否则会出现“电源→线圈A→零线→线圈B→…”这种实际不存在的回绕电流（2.5 时间继电器支路会误判 KT 有电）
  const walk = (starts, skip, stop, region) => {
    const seen = new Map(starts.map(n => [n, false])), q = [...starts];
    while (q.length) {
      const n = q.pop(); if (stop.has(n) && !starts.includes(n)) continue; const lim = seen.get(n);
      for (const e of adj.get(n) || []) {
        if (e === skip || (lim && e.load)) continue;
        const m = e.a === n ? e.b : e.a, ml = lim || (!!e.load && region.has(m));
        if (!seen.has(m) || (seen.get(m) && !ml)) { seen.set(m, ml); q.push(m); }
      }
    }
    return seen;
  };
  const pot = bfs(srcs, null, T, true), zero = bfs(sinks, null, S, true), cur = new Set();
  for (const e of act) {
    const fs = walk(srcs, e, T, zero), ft = walk(sinks, e, S, pot);
    // 负载本身：电源一侧和零线一侧都要“正向”到达（没有先绕过别的负载），否则是零线→线圈→零线的假回路
    const hit = (m, n) => m.has(n) && (!e.load || m.get(n) === false);
    if ((hit(fs, e.a) && hit(ft, e.b)) || (hit(fs, e.b) && hit(ft, e.a))) cur.add(e.id);
  }
  const r = { cur, pot, act: new Set(act.map(e => e.id)) }; _solveCache.set(ck, r); return r;
}

// ---------- 时间轴 ----------
const DURS = window.DURS || SCRIPT.map(s => 0.6 + s.text.length * 0.22); // 没有配音时按字数估算
const TL = []; { let t = 0; SCRIPT.forEach((s, i) => { TL.push({ ...s, i, t0: t, d: DURS[i] }); t += DURS[i]; }); }
const TOTAL = TL[TL.length - 1].t0 + TL[TL.length - 1].d;
const stepAt = t => { for (let i = TL.length - 1; i >= 0; i--) if (t >= TL[i].t0) return TL[i]; return TL[0]; };

// 接线时刻：每一步里的线依次画出
const WIRE_T = {};
TL.forEach(st => (st.wires || []).forEach((id, k, arr) => {
  const a = st.t0 + st.d * (0.06 + 0.84 * k / arr.length), b = st.t0 + st.d * (0.06 + 0.84 * (k + 1) / arr.length);
  WIRE_T[id] = [a, b - (b - a) * 0.15];
}));
const wireProg = (id, t) => { const w = WIRE_T[id]; return w ? clamp((t - w[0]) / (w[1] - w[0])) : 0; };

// 按钮按下时刻（给渲染脚本配音效）
const EVENTS = [];
TL.forEach(st => (st.ev || []).forEach(([f, set]) => EVENTS.push({ t: st.t0 + f * st.d, set })));
EVENTS.sort((a, b) => a.t - b.t);
window.CLICKS = EVENTS.filter(e => ['QF', 'SB1', 'SB2', 'SB3'].some(k => e.set[k] === 1)).map(e => +e.t.toFixed(3));
window.TOTAL = TOTAL;
