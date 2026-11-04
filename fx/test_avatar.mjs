// 像素动效头像库自测：node 总入口/fx/test_avatar.mjs
//
// 为什么要写成脚本而不是靠人点一遍：这个库有 208 个特效、一个单例 rAF、一套省电模式分支，
// 其中任何一环改坏（漏打包、id 撞车、渲染器打错字）在页面上只表现为「某个格子空了」，
// 肉眼很难发现。脚本把四件事钉死：
//   1) 语法：两个 js 都能被 node 解析（node --check）；
//   2) 清单：≥200 个、id 不重复、id 是「分类/名字」；
//   3) 画面：208 个特效在取样相位上真的画出了像素（不是空框）；
//   4) 渲染器：用一套假 DOM 把 panel / mount / frame 跑一遍，断言回调、销毁、单 rAF 都正常。
// 最后打印文件体积，顺便校验 NOTICE-avatars.md 里的 MIT 与作者署名没被删。

import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(DIR, 'pixelfx-avatars.js');
const RND = path.join(DIR, 'hx-avatar.js');
const NOTICE = path.join(DIR, 'NOTICE-avatars.md');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')); }
}
function head(t) { console.log('\n' + t); }
const kb = (p) => (statSync(p).size / 1024).toFixed(1) + ' KB';

// ───────────────────────── 1. 语法 ─────────────────────────
head('[1] 语法检查（node --check）');
for (const f of [LIB, RND]) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    ok(true, path.basename(f) + ' 解析通过');
  } catch (e) {
    ok(false, path.basename(f) + ' 解析失败', String(e.stderr || e.message).slice(0, 300));
  }
}

// ───────────────────────── 2. 加载特效库（node 里跑，不需要浏览器） ─────────────────────────
head('[2] 特效清单');
const libCode = readFileSync(LIB, 'utf8');
const lib = { window: {}, console };
lib.window = lib;
vm.createContext(lib);
vm.runInContext(libCode, lib, { filename: 'pixelfx-avatars.js' });
const P = lib.PixelFXAvatar;

ok(!!P, 'window.PixelFXAvatar 已暴露');
ok(!!P && typeof P.list === 'function', 'PixelFXAvatar.list() 可用');
const list = P ? P.list() : [];
ok(list.length >= 200, 'list().length >= 200', '实际 ' + list.length);

const ids = list.map((x) => x.id);
ok(new Set(ids).size === ids.length, 'id 无重复', '重复 ' + (ids.length - new Set(ids).size) + ' 个');
const bad = ids.filter((id) => !/^[a-z]+\/[a-z0-9-]+$/.test(id));
ok(bad.length === 0, 'id 全部是「分类/名字」格式', bad.slice(0, 5).join(', '));
const noMeta = ids.filter((id) => !P.meta[id] || !P.meta[id].size);
ok(noMeta.length === 0, '每个 id 都有 meta.size', noMeta.slice(0, 5).join(', '));

// 分类分布：报告里要用，也顺便确认没有哪个分类整类漏打包
const byCat = {};
for (const id of ids) byCat[id.split('/')[0]] = (byCat[id.split('/')[0]] || 0) + 1;
console.log('    分类分布：' + Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => c + ' ' + n).join('、'));

// ───────────────────────── 3. 每个特效都画得出东西 ─────────────────────────
head('[3] 逐帧非空检查（t=35% 相位）');
let empty = [], thin = [], loose = 0;
for (const id of ids) {
  const m = P.meta[id], [W, H] = m.size;
  const frame = P.createFrame(W, H);
  const img = { data: new Uint8ClampedArray(W * H * 4) };
  const fx = P.createFx(P.effects[id], { x: m.origin[0], y: m.origin[1], seed: 7 });
  const target = Math.min(m.duration * 0.35, 2.5);
  let t = 0;
  while (t < target) { const dt = Math.min(1 / 60, target - t); fx.update(dt); t += dt; }
  P.clearFrame(frame); fx.draw(frame, 'back'); fx.draw(frame, 'front');
  P.composite(frame, img.data, null);
  let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (img.data[(y * W + x) * 4 + 3] > 8) {
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (n < 40) empty.push(id);
  else if (n / (W * H) < 0.01) thin.push(id);
  // 实体只占画布一小块的要靠自动裁边放大，统计一下有多少个（报告里用）
  if (m.cat !== 'weather' && m.cat !== 'transitions' && x1 >= x0 && (x1 - x0 + 1) * (y1 - y0 + 1) < W * H * 0.6) loose++;
}
ok(empty.length === 0, '208 个特效取样相位都不是空框', empty.join(', '));
console.log('    偏淡（<1% 像素，仍可用）：' + (thin.length ? thin.join(', ') : '无'));
console.log('    需要自动裁边才够大的（实体范围 < 画布 60%）：' + loose + ' 个');

// ───────────────────────── 4. 假 DOM 冒烟测渲染器 ─────────────────────────
head('[4] 渲染器冒烟测试（假 DOM）');

function el(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), children: [], parentNode: null, dataset: {},
    style: { setProperty() { }, removeProperty() { } },
    _attr: {}, _h: {}, textContent: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    },
    appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
    removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); c.parentNode = null; return c; },
    contains(c) { for (let p = c; p; p = p.parentNode) if (p === n) return true; return false; },
    setAttribute(k, v) { n._attr[k] = String(v); },
    getAttribute(k) { return n._attr[k]; },
    addEventListener(t, f) { n._h[t] = f; },
    removeEventListener(t) { delete n._h[t]; },
    getContext() { return ctx2d(n); },
    toDataURL() { return 'data:image/png;base64,AAAA'; },
    getBoundingClientRect() { return { width: 64, height: 64, top: 0, left: 0 }; },
    get isConnected() { let p = n; while (p.parentNode) p = p.parentNode; return p === doc || p === doc.body; }
  };
  Object.defineProperty(n, 'textContent', {
    get() { return n._txt || ''; },
    set(v) { n._txt = v; if (v === '') { n.children.forEach((c) => (c.parentNode = null)); n.children = []; } }
  });
  return n;
}
function ctx2d(owner) {
  return {
    imageSmoothingEnabled: true,
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { puts++; },
    clearRect() { }, drawImage() { owner._draws = (owner._draws || 0) + 1; },
    fillRect() { }, save() { }, restore() { },
    createLinearGradient() { return { addColorStop() { } }; }, createRadialGradient() { return { addColorStop() { } }; }
  };
}

let rafQueue = [], rafId = 1, puts = 0;
// 渲染器用 setTimeout 把静图排队摊开（一次算一张，别把主线程钉死）。
// 沙箱里没有真计时器，这里收进数组，测试里手动 flush 掉。
let timers = [];
const doc = {
  hidden: false,
  documentElement: el('html'),
  head: el('head'),
  body: el('body'),
  createElement: el,
  getElementById: (id) => doc.head.children.find((c) => c._attr.id === id) || null,
  addEventListener() { }
};
doc.head.parentNode = doc.body;
doc.body.parentNode = doc;

const win = {
  document: doc,
  devicePixelRatio: 2,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => { },
  matchMedia: (q) => ({ matches: false, media: q, addEventListener() { }, addListener() { } }),
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafId++; },
  cancelAnimationFrame: (id) => { },
  Image: class { set src(v) { this._src = v; if (this.onload) this.onload(); } get src() { return this._src; } },
  performance: { now: () => Date.now() },
  console
};
win.window = win;
win.globalThis = win;
for (const k of Object.keys(win)) if (!(k in globalThis)) { /* 只放进 sandbox */ }

vm.createContext(win);
vm.runInContext(libCode, win, { filename: 'pixelfx-avatars.js' });
vm.runInContext(readFileSync(RND, 'utf8'), win, { filename: 'hx-avatar.js' });

// 把排队的静图全部跑完（模拟浏览器里那些 setTimeout 逐个触发）
let timerErr = '';
function flushTimers(limit = 4000) {
  let n = 0;
  while (timers.length && n++ < limit) {
    const q = timers; timers = [];
    q.forEach((f) => { try { f(); } catch (e) { if (!timerErr) timerErr = e.stack || e.message; } });
  }
  if (timerErr) throw new Error(timerErr);
}

const H = win.HXAvatar;
ok(!!H, 'window.HXAvatar 已暴露');
if (H) {
  ok(typeof H.list === 'function' && typeof H.panel === 'function' && typeof H.mount === 'function' && typeof H.frame === 'function',
    'API 齐全：list / panel / mount / frame');
  ok(H.list().length === list.length, 'HXAvatar.list() 与库内清单一致');

  // frame()
  let url = '';
  try { url = H.frame('critters/ghost', 64); } catch (e) { url = 'THREW ' + e.message; }
  ok(typeof url === 'string' && url.indexOf('data:image/png') === 0, 'frame("critters/ghost",64) 返回 dataURL', url.slice(0, 40));
  ok(H.frame('nope/nothing', 64) === '', 'frame() 遇到不存在的 id 返回空字符串而不是抛错');

  // mount()
  const host = el('div');
  doc.body.appendChild(host);
  let m = null, stopErr = '';
  try { m = H.mount(host, 'weather/aurora', 72); } catch (e) { stopErr = e.message; }
  ok(!stopErr && m && typeof m.stop === 'function', 'mount() 返回 { stop }', stopErr);
  ok(host.children.length === 1 && host.children[0].tagName === 'CANVAS', 'mount() 往容器里放了 <canvas>');
  ok(host.children.length === 1 && host.children[0].width === 144, 'mount() 按 2 倍 dpr 渲染（72 → 144）');
  const pump = () => { const q = rafQueue; rafQueue = []; q.forEach((fn) => fn(performance.now() + 40)); };
  try { pump(); } catch (e) { stopErr = e.message; }
  ok(!stopErr, 'rAF 循环跑了一帧不报错', stopErr);
  ok(rafQueue.length <= 1, '挂载点只占用 1 个 rAF', '实际 ' + rafQueue.length);
  if (m) m.stop();
  ok(host.children.length === 0, 'stop() 移除了 canvas');

  // panel()
  const box = el('div');
  doc.body.appendChild(box);
  let picked = null, pnl = null;
  try {
    pnl = H.panel(box, { size: 48, value: 'critters/ghost', onPick: (id) => { picked = id; } });
  } catch (e) { stopErr = e.message; }
  ok(!stopErr && pnl && typeof pnl.destroy === 'function', 'panel() 返回 { destroy }', stopErr);
  const grid = box.children[0] && box.children[0].children[1];
  const cellsNow = grid ? grid.children.filter((c) => c.className === 'hxa-cell') : [];
  ok(cellsNow.length === list.length, 'panel 默认列出全部特效（' + list.length + ' 个）', '实际 ' + cellsNow.length);
  try { flushTimers(); } catch (e) { stopErr = e.message; }
  ok(!stopErr, '静图队列跑完不报错', stopErr);
  const c0 = cellsNow[0] && cellsNow[0].children.filter((c) => c.tagName === 'CANVAS')[0];
  ok(!!c0, '格子进场后生成了 canvas');
  ok(!!c0 && c0._draws > 0 && puts > 0, '格子画上了静图（putImageData + drawImage）', 'draws=' + (c0 && c0._draws) + ' puts=' + puts);
  ok(cellsNow.some((c) => c.getAttribute('aria-pressed') === 'true'), 'opts.value 对应的格子被标成选中');

  // 点一个格子：应该回调 onPick，并且只留 1 个 rAF
  rafQueue = [];
  try {
    const target = cellsNow[3];
    target._h.pointerenter && target._h.pointerenter.call(target);
    target._h.click && target._h.click.call(target, { preventDefault() { } });
  } catch (e) { stopErr = e.message; }
  ok(!stopErr, 'pointerenter + click 不报错', stopErr);
  ok(picked === cellsNow[3].dataset.id, 'onPick 收到了被点的 id', String(picked));
  ok(rafQueue.length <= 1, 'panel 与 mount 共用同一条 rAF', '实际 ' + rafQueue.length);
  try { pump(); } catch (e) { stopErr = e.message; }
  ok(!stopErr, '悬停态跑一帧不报错', stopErr);

  // 切分类：格子数应该变少，且不留死记录
  try {
    const chip = box.children[0].children[0].children.find((c) => c.textContent === '暗影');
    chip && chip._h.click ? null : null;
    chip && chip.onclick && chip.onclick();
  } catch (e) { stopErr = e.message; }
  const shadowN = byCat.shadow || 0;
  ok(!stopErr && grid.children.filter((c) => c.className === 'hxa-cell').length === shadowN,
    '点「暗影」后只剩该分类的 ' + shadowN + ' 个', stopErr);
  // 分类条的高亮状态要跟着走，否则「全部」一直亮着、下面却是暗影，看着像坏了
  const barKids = box.children[0].children[0].children;
  const chipOf = (t) => barKids.find((c) => c.textContent === t);
  ok(chipOf('暗影') && chipOf('暗影').getAttribute('aria-pressed') === 'true', '「暗影」按钮变选中态');
  ok(chipOf('全部') && chipOf('全部').getAttribute('aria-pressed') === 'false', '「全部」按钮取消选中态');

  try { pnl.destroy(); } catch (e) { stopErr = e.message; }
  ok(!stopErr && box.children.length === 0, 'destroy() 清掉了整个面板', stopErr);
  const dbg = H._debug ? H._debug() : null;
  ok(!dbg || dbg.views === 0, 'destroy() 后没有残留视图', dbg ? '残留 ' + dbg.views : '');
}

// ───────────────────────── 5. NOTICE 与体积 ─────────────────────────
head('[5] 许可与体积');
const hasNotice = existsSync(NOTICE);
ok(hasNotice, 'NOTICE-avatars.md 存在');
if (hasNotice) {
  const t = readFileSync(NOTICE, 'utf8');
  ok(/MIT/.test(t), 'NOTICE 含 MIT');
  ok(/patch/i.test(t), 'NOTICE 含 patch（作者署名）');
  ok(/a841596/.test(t), 'NOTICE 记了取用的 commit');
  ok(t.includes('Permission is hereby granted, free of charge'), 'NOTICE 含 MIT 许可全文');
}
const szLib = statSync(LIB).size, szRnd = statSync(RND).size;
console.log('    pixelfx-avatars.js  ' + kb(LIB));
console.log('    hx-avatar.js        ' + kb(RND));
console.log('    合计                ' + ((szLib + szRnd) / 1024).toFixed(1) + ' KB');

// ───────────────────────── 汇总 ─────────────────────────
console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
