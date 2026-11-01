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
const roller = x => `<polygon points="${x - 5},41 ${x - 7},35 ${x - 13},40" fill="currentColor"/>`; // 位置开关标记，压在刀片上
const breaker = x => L(x - 3, 23, x + 3, 29) + L(x - 3, 29, x + 3, 23);
const cup = x => P(`M${x} 20 A3 3 0 0 0 ${x} 26`); // 接触器功能：静触点下端靠刀片一侧的半圆（同教材图 1-19b）
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
  sqnc: ['0 0 40 80', nc(14) + `<polygon points="${21},37 ${27},39 ${23},44" fill="currentColor"/>`, '行程开关动断（常闭）触点'],
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
for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'h']) SYM['c23' + k][2] = `控制电路（教材图 2-3${k}）`;
SYM.c23ok[2] = '控制电路：KM 常开触点与 SB2 并联';

export const hasFig = name => Object.hasOwn(SYM, name);
export const figName = name => hasFig(name) ? SYM[name][2] : '';
// big：题干里的大图；否则是选项里的小图
export function figSvg(name, big) {
  if (!hasFig(name)) return '';
  const [vb, body, , size] = SYM[name], [, , w, h] = vb.split(' ').map(Number), H = size ? size[big ? 0 : 1] : big ? Math.min(150, h * 1.6) : 64;
  return `<svg viewBox="${vb}" width="${Math.round(H * w / h)}" height="${H}" role="img" aria-label="图" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:block;max-width:100%;height:auto">${body}</svg>`;
}
