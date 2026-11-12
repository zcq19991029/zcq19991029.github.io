// 把「刷题」打包成一个自包含 HTML（离线用：教室没网、U 盘拷走、双击就能刷）
// 做法：ES 模块按 import 图拼接成一个普通脚本（每个模块包在函数里，导出挂到一个表上），
//       题库 JSON 内联进 window.__BANK，logo / 主题 CSS 内联，图片转 data URI。
// 用法：node 离线打包.cjs
// 产物：成品/华夏工具-刷题-离线版.html（约 1.5 MB，双击就开，不联网也能刷；2026-11-08 起离线版不带 AI，AI 只在网页版走首页「AI 设置」）
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const HOME = path.join(ROOT, '..'); // 仓库根：全站共用件都在这一层
const OUT = path.join(ROOT, '成品', '华夏工具-刷题-离线版.html');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ── 共享件定位（2026-11-12 N4）──
   和 publish.cjs 的规则保持一致：全站共用件只可能在这两处，按顺序找 ——
     · 仓库根：hx-theme.css / hx-theme.js 的**唯一源**（publish.cjs 发布时无条件用它覆盖 总入口/ 的副本）；
     · 总入口/：发布时原样发到站点根的那一份（logo.jpg、bg/、fx/ 都只在这里）。
   以前这里裸写 path.join(ROOT,'..','总入口','hx-theme.css')：只改了根目录那份、忘了手工 cp 到 总入口/，
   离线版就还是旧样式 —— 页面照开、不报错，属于最难查的一类。现在根目录优先，两处都没有就明确抛错。 */
const sharedTry = f => [path.join(HOME, f), path.join(HOME, '总入口', f)];
function sharedRaw(f) {
  for (const p of sharedTry(f)) if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error('找不到共享文件 ' + f + '（找过：' + sharedTry(f).join('、') + '）——离线版少了它不报错、只会悄悄缺功能，先补文件再打包');
}
const shared = f => sharedRaw(f).toString('utf8');
const sharedB64 = f => sharedRaw(f).toString('base64');

/* 内联必须命中（2026-11-12 N4）：String.replace 找不到目标时**不报错、原样返回**，
   这正是「少内联一段、页面还能开」的来源。所以每处内联都过一遍 hit()，没命中就抛错并指出是哪个标签。 */
function hit(html, re, make, what) {
  const out = html.replace(re, make);
  if (out === html) throw new Error('内联失败：index.html 里找不到 ' + what + '，产物会缺这一块，停止打包');
  return out;
}

// ---------- 1. 模块收集（按依赖顺序） ----------
const MODULES = ['hx.js', 'store.js', 'ai.js', 'imports.js', 'symbols.js', 'app.js'];
const deps = { 'store.js': ['hx.js'], 'imports.js': ['ai.js'] }; // app/hx/ai/symbols 的依赖在下面统一处理
const order = [];
const seen = new Set();
function visit(m) {
  if (seen.has(m)) return;
  seen.add(m);
  const src = read(m);
  // 本模块 import 了谁，先放谁
  const re = /^\s*import\s+(?:\*\s+as\s+(\w+)|\{([^}]+)\}|(\w+))\s+from\s+['"]\.\/([\w.-]+)['"];?/gm;
  let mm;
  while ((mm = re.exec(src))) {
    const target = mm[4];
    if (MODULES.includes(target)) visit(target);
  }
  order.push(m);
}
visit('app.js');
console.log('模块顺序：' + order.join(' → '));

// 每个模块转成：__M['x.js'] = (function(){ ... ; return {导出名}; })()
function wrapModule(file) {
  let src = read(file);
  const exportsList = [];
  // export async function foo / export function foo / export const foo
  src = src.replace(/^\s*export\s+(async\s+)?function\s+(\w+)/gm, (m, a, n) => { exportsList.push(n); return (a || '') + 'function ' + n; });
  src = src.replace(/^\s*export\s+const\s+(\w+)/gm, (m, n) => { exportsList.push(n); return 'const ' + n; });
  src = src.replace(/^\s*export\s+let\s+(\w+)/gm, (m, n) => { exportsList.push(n); return 'let ' + n; });
  src = src.replace(/^\s*export\s*\{([^}]+)\};?/gm, (m, names) => { names.split(',').forEach(x => exportsList.push(x.trim().split(/\s+as\s+/).pop())); return ''; });
  src = src.replace(/^\s*export\s+default\s+/gm, '');
  // import 全部换成从 __M 里取
  src = src.replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\/([\w.-]+)['"];?/gm,
    (m, alias, f) => `const ${alias} = __M['${f}'];`);
  src = src.replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]\.\/([\w.-]+)['"];?/gm,
    (m, names, f) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = __M['${f}'];`);
  src = src.replace(/^\s*import\s+(\w+)\s+from\s+['"]\.\/([\w.-]+)['"];?/gm,
    (m, alias, f) => `const ${alias} = __M['${f}'].default ?? __M['${f}'];`);
  // 动态 import 的 vendor（PDF/DOCX 解析）离线包里没有，改成给一句明确提示
  src = src.replace(/await import\(['"]\.\/vendor\/[\w.-]+['"]\)/g,
    `Promise.reject(new Error('离线版不能解析 PDF／Word，请用 .txt、.md 或题库 JSON 导入'))`);
  src = src.replace(/new URL\(['"]\.\/vendor\/[\w.-]+['"],\s*import\.meta\.url\)\.href/g, `''`);
  const ret = exportsList.length ? `\nreturn { ${[...new Set(exportsList)].join(', ')} };\n` : '\nreturn {};\n';
  return `__M['${file}'] = (function(){\n${src}\n${ret}})();\n`;
}

// ---------- 2. 题库内联 ----------
const BUILTIN_FILES = { 'data/wiring.json': 1, 'data/mcu.json': 1, 'data/questions.json': 1, 'data/education.json': 1 };
const bank = {};
for (const f of Object.keys(BUILTIN_FILES)) bank[f] = JSON.parse(read(f));
console.log('内联题库：' + Object.entries(bank).map(([k, v]) => k.replace('data/', '') + ' ' + (v.length || 0) + ' 题').join('，'));

// ---------- 3. 主题 CSS + 图片（全站共用件，走 shared：读不到直接抛错，不再裸读路径） ----------
let themeCss = shared('hx-theme.css');
const logo = sharedB64('logo.jpg');
const styleCss = read('style.css');

// ---------- 4. 组装 HTML ----------
let html = read('index.html');
html = hit(html, /<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/jpeg;base64,${logo}">`, 'rel="icon" 那条 <link>');
html = hit(html, /<link rel="stylesheet" href="\.\.\/hx-theme\.css">/, () => `<style>\n${themeCss}\n</style>`, '../hx-theme.css 那条 <link>');
// 主题脚本：离线版也要（导航滑块、外观变量都在里面）。只把「算站点根目录」那一句换掉——
// file:// 下 new URL('.', 没有 src 的 script) 会抛 Invalid base URL，离线用不到 root。
let themeJs = shared('hx-theme.js');
// 下面两处是「就地打补丁」，也必须命中：hx-theme.js 换了写法而这里没跟上，离线版会跳回首页或报 Invalid base URL。
// 同样是 replace 静默不生效的老坑，所以补丁打完对比一次，没变就抛错。
const patchTheme = (src, re, to, what) => {
  const out = src.replace(re, to);
  if (out === src) throw new Error('hx-theme.js 里找不到「' + what + '」那段，离线补丁已失效，停止打包');
  return out;
};
themeJs = patchTheme(themeJs, /var me = document\.currentScript, root = me \? new URL\('\.', me\.src\)\.href : location\.origin \+ '\/';/,
  "var me = document.currentScript, root = '';", 'root = new URL(...)');
// 离线不该跳回总入口：把「单独打开就跳首页」那段去掉
themeJs = patchTheme(themeJs, /if \(tool && window\.top === window && \/\^https\?:\$\/\.test\(location\.protocol\)[\s\S]*?return; \}/, '', '单独打开就跳首页');
// 离线没有 bg/ 目录（图片、视频都不跟着文件走）。2026-11-04 起全站默认背景是「极光动态」视频，
// 不处理的话离线打开会去要一个不存在的 bg/aurora.mp4（620KB 的 404），背景层还会是空的。
// 这里就地降级成海报帧（base64 内联），离线也有极光画面，只是不动。
const auroraJpg = sharedB64('bg/aurora.jpg');
themeJs = patchTheme(themeJs, /aurora: \{[^}]*\}/,
  `aurora: { name: '极光 · 静帧', img: 'data:image/jpeg;base64,${auroraJpg}' }`, 'aurora 背景那段');
html = hit(html, /<script src="\.\.\/hx-theme\.js"[^>]*><\/script>/, () => `<script>\n${themeJs}\n</script>`, '../hx-theme.js 那条 <script>');
/* 题库分享码的二维码生成器（2026-11-08）：分享码要用它画二维码。
   离线版是单个 HTML 文件，../fx/hx-qr.js 在 file:// 下根本取不到，所以直接内联。
   2026-11-12 N4：以前文件不在就整段删掉标签（静默退成「只显示 6 位码」），代价是功能悄悄没了没人发现 ——
   fx/ 是发布到站点根的共用件，缺了就是仓库不完整，直接抛错。 */
const qrJs = shared('fx/hx-qr.js');
if (/<\/script/i.test(qrJs)) throw new Error('二维码脚本里不能出现 </script');
// 用函数做替换值：二维码库源码里有 `$'` 这类字符序列，直接当替换字符串会被 String.replace 当成特殊模式展开，
// 拼出来的脚本就是坏的（离线版打开报 Invalid or unexpected token，2026-11-08 Z5 验收时发现）。
html = hit(html, /<script src="\.\.\/fx\/hx-qr\.js"><\/script>/, () => `<script>\n${qrJs}\n</script>`, '../fx/hx-qr.js 那条 <script>');
// 统一弹窗 ui-dialog.js（仓库根）：离线打开时 hxAlert / hxConfirm 全依赖它，不内联就是 file:// 下的 404。
// 2026-11-12 N4 补：这是「离线版不离线」最后一条外链。
const dialogJs = shared('ui-dialog.js');
if (/<\/script/i.test(dialogJs)) throw new Error('弹窗脚本里不能出现 </script');
html = hit(html, /<script src="\.\.\/ui-dialog\.js"><\/script>/, () => `<script>\n${dialogJs}\n</script>`, '../ui-dialog.js 那条 <script>');
html = hit(html, /<link rel="stylesheet" href="style\.css">/, () => `<style>\n${styleCss}\n</style>`, 'style.css 那条 <link>');
html = hit(html, /<a class="brand" id="brand" href="\.\.\/" target="_top">/, '<a class="brand" id="brand" href="#" onclick="return false">', '页头 brand 那条 <a>');
html = hit(html, /<img src="\.\.\/logo\.jpg"/, () => `<img src="data:image/jpeg;base64,${logo}"`, '../logo.jpg 那个 <img>');

// 离线：题库从内联表取，不走 fetch
const offlineHook = `
<script>
// 离线版：题库已经内联在这份文件里，替换 fetch 读本地 json 的那一句
window.__BANK = ${JSON.stringify(bank)};
window.__OFFLINE = true;
</script>`;
html = hit(html, '</head>', offlineHook + '\n</head>', '</head>');

// 统一像素加载动效（2026-11-04）：线上刷题引用 vendor/pixelfx-loader.js + loadfx.js 两个外部脚本，
// 离线单文件里没有目录，必须内联，否则 404 后 loadfx 不存在 → 永远走药丸回落（能用但没有动效）。
// 内联顺序和 index.html 一致：先特效包（挂 window.PixelFX）再胶水（挂 window.HXLoadFx）。
const fxBundle = read('vendor/pixelfx-loader.js');
const fxGlue = read('loadfx.js');
if (/<\/script/i.test(fxBundle + fxGlue)) throw new Error('加载动效脚本里不能出现 </script');
html = hit(html, '<script src="vendor/pixelfx-loader.js"></script>\n<script src="loadfx.js"></script>',
  () => `<script>\n${fxBundle}\n</script>\n<script>\n${fxGlue}\n</script>`, 'vendor/pixelfx-loader.js + loadfx.js 那两行 <script>');

// 所有模块拼成一个普通 script（非 module，避免 file:// 下的 CORS）
const bundle = `<script>
(function(){
'use strict';
const __M = {};
${order.map(wrapModule).join('\n')}
})();
</script>`;
html = hit(html, /<script type="module" src="app\.js"><\/script>/, () => bundle, 'app.js 那条 <script type="module">');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成 ' + OUT + '（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB）');
