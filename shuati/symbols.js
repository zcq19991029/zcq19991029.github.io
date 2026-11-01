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
const cup = x => P(`M${x - 3} 26 A3 3 0 0 0 ${x + 3} 26`);
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

export const hasFig = name => Object.hasOwn(SYM, name);
export const figName = name => hasFig(name) ? SYM[name][2] : '';
// big：题干里的大图；否则是选项里的小图
export function figSvg(name, big) {
  if (!hasFig(name)) return '';
  const [vb, body] = SYM[name], [, , w, h] = vb.split(' ').map(Number), H = big ? Math.min(150, h * 1.6) : 64;
  return `<svg viewBox="${vb}" width="${Math.round(H * w / h)}" height="${H}" role="img" aria-label="图形符号" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:block;max-width:100%;height:auto">${body}</svg>`;
}
