/* 把仓库里已有的 qrcode（npm 包 1.5.4，MIT，node_modules/.qrcode-2VT6tcPC/lib/core）
 * 的核心编码器打成一个**单文件浏览器脚本** 总入口/fx/hx-qr.js，暴露 window.HXQR = { create }。
 *
 * 为什么不引 CDN：课堂码大屏二维码要在教室网络（经常不稳）里离线可用；
 * 为什么不用整个 qrcode 包：它的浏览器入口还要 canvas 渲染器和 dijkstrajs/encode-utf8
 * 两个 npm 依赖，多文件外链。我们只要 create()（返回模块矩阵），
 * 渲染（canvas 画点）由 index.html 里十几行代码自己做。
 *
 * dijkstrajs 不在仓库里 —— 它只被 segments.js 用来挑最优编码模式（最短路），
 * 这里内联一个等价的 Dijkstra 实现（算法是标准的，~40 行），
 * 行为与 dijkstrajs 的 find_path(map, start, end) 一致：返回含首尾的路径数组。
 *
 * 运行：node 总入口/fx/build-qr.mjs   （生成 + 自检：用 jsqr 解码验证）
 * 来源与许可见同目录 NOTICE-qr.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));           // 总入口/fx
const ROOT = path.resolve(HERE, '..', '..');                          // 仓库根
const CORE = path.join(ROOT, 'node_modules', '.qrcode-2VT6tcPC', 'lib', 'core');

// core 目录里全部模块（同目录相互 require('./x')，无循环依赖）
const FILES = [
  'utils', 'error-correction-level', 'bit-buffer', 'bit-matrix', 'alignment-pattern',
  'finder-pattern', 'mask-pattern', 'error-correction-code', 'reed-solomon-encoder',
  'galois-field', 'polynomial', 'version', 'version-check', 'format-info',
  'mode', 'numeric-data', 'alphanumeric-data', 'byte-data', 'kanji-data',
  'regex', 'segments', 'qrcode'
].map((n) => n + '.js');

// 内联 dijkstrajs（等价实现）：segments.js 用它做「最优模式切分」的最短路搜索
const DIJKSTRA = `
var find_path = function (map, start, end) {
  var open = {}, came = {}, closed = {};
  open[start] = 0;
  while (true) {
    var best = null;
    for (var k in open) if (best === null || open[k] < open[best]) best = k;
    if (best === null) throw new Error('no path');
    if (best === end) break;
    var cost = open[best]; delete open[best]; closed[best] = 1;
    var nb = map[best] || {};
    for (var n in nb) {
      if (closed[n]) continue;
      var nc = cost + nb[n];
      if (!(n in open) || nc < open[n]) { open[n] = nc; came[n] = best; }
    }
  }
  var path = [end];
  while (path[0] !== start) path.unshift(came[path[0]]);
  return path;
};
var dijkstrajs = { find_path: find_path };
module.exports = dijkstrajs;
`;

const HEADER = `/* hx-qr.js —— 课堂码大屏二维码的离线 QR 编码器（单文件，无外部依赖/CDN）。
 * 由 qrcode npm 包 1.5.4 的 lib/core 打包而成（MIT，作者 Ryan Day 等），
 * dijkstrajs 依赖以内联等价实现替代。构建脚本：fx/build-qr.mjs，勿手改本文件。
 * 用法：HXQR.create(text, { errorCorrectionLevel: 'M' }) → { modules: { size, data: Uint8Array, get(r,c) } }
 */
`;

function strip(src) { // 去掉块注释（/*/）省体积；不去行注释，改动最小
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function bundle() {
  let out = HEADER + '(function () {\nvar __m = {};\nfunction __d(id, src) { __m[id] = { ex: null, src: src }; }\nfunction __req(id) {\n  var m = __m[id]; if (!m) throw new Error("hx-qr 缺模块 " + id);\n  if (!m.ex) { var module = { exports: {} }; m.ex = module.exports; Function("module", "exports", "require", m.src)(module, module.exports, __req); m.ex = module.exports; }\n  return m.ex;\n}\n';
  out += '__d("dijkstrajs", ' + JSON.stringify(strip(DIJKSTRA).replace(/^\n/, '')) + ');\n';
  for (const f of FILES) {
    let src = strip(fs.readFileSync(path.join(CORE, f), 'utf8'));
    // 同目录相对引用 → 模块名；裸包名 dijkstrajs → 内联桩
    src = src.replace(/require\('\.\/([a-z-]+)'\)/g, "require('$1')");
    out += `__d('${f.replace(/\.js$/, '')}', ${JSON.stringify(src)});\n`;
  }
  out += 'window.HXQR = { create: __req("qrcode").create };\n})();\n';
  return out;
}

fs.writeFileSync(path.join(HERE, 'hx-qr.js'), bundle());
const kb = (fs.statSync(path.join(HERE, 'hx-qr.js')).size / 1024).toFixed(1);
console.log('生成 总入口/fx/hx-qr.js（' + kb + ' KB）');

/* ── 自检：node 里跑一遍 create，再渲染成 PNG 用 jsqr（仓库里已有）解码回原文 ── */
const { createRequire } = await import('node:module');
const require2 = createRequire(import.meta.url);
const mod = { exports: {} };
globalThis.window = {};
Function('module', 'window', fs.readFileSync(path.join(HERE, 'hx-qr.js'), 'utf8'))(mod, globalThis.window);
const HXQR = globalThis.window.HXQR;
const TEXT = 'https://zcq19991029.github.io/#signup=ABCD12';
const qr = HXQR.create(TEXT, { errorCorrectionLevel: 'M' });
if (!qr || !qr.modules || qr.modules.size < 21) { console.error('FAIL create 结果异常'); process.exit(1); }
console.log('自检：矩阵 ' + qr.modules.size + '×' + qr.modules.size + '（version ' + (qr.modules.size - 17) / 4 + '）');

const { PNG } = require2(path.join(ROOT, 'node_modules', 'pngjs'));
const render = (txt) => {
  const m = HXQR.create(txt, { errorCorrectionLevel: 'M' }).modules, N = m.size;
  const SCALE = 8, QUIET = 4, W = (N + QUIET * 2) * SCALE;
  const png = new PNG({ width: W, height: W });
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const r = Math.floor(y / SCALE) - QUIET, c = Math.floor(x / SCALE) - QUIET;
    const on = r >= 0 && c >= 0 && r < N && c < N && m.get(r, c);
    const v = on ? 0 : 255, i = (W * y + x) << 2;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  return { png, W };
};
let fail = 0;
for (const t of [TEXT, '1234567890', 'HELLO-WORLD 2026', 'https://zcq19991029.github.io/#signup=ZZZZ99',
  'https://zcq19991029.github.io/#signup=AB12' + 'X'.repeat(0) + '34']) {
  const { png, W } = render(t);
  const jsQR = require2(path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js'));
  const res = jsQR(new Uint8ClampedArray(png.data), W, W);
  if (!res || res.data !== t) { console.error('FAIL jsqr 解码不符：' + (res && res.data)); fail = 1; }
  else console.log('自检：jsqr 解码回原文一致 → ' + t);
}
process.exit(fail);
