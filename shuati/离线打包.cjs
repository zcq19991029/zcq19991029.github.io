// 把「刷题」打包成一个自包含 HTML（离线用：教室没网、U 盘拷走、双击就能刷）
// 做法：ES 模块按 import 图拼接成一个普通脚本（每个模块包在函数里，导出挂到一个表上），
//       题库 JSON 内联进 window.__BANK，logo / 主题 CSS 内联，图片转 data URI。
// 用法：node 离线打包.cjs
// 产物：成品/华夏工具-刷题-离线版.html（约 1.5 MB，双击就开，不联网也能刷；AI 问问题需要网和 Key）
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const OUT = path.join(ROOT, '成品', '华夏工具-刷题-离线版.html');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

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

// ---------- 3. 主题 CSS + 图片 ----------
let themeCss = fs.readFileSync(path.join(ROOT, '..', '总入口', 'hx-theme.css'), 'utf8');
const logo = fs.readFileSync(path.join(ROOT, '..', '总入口', 'logo.jpg')).toString('base64');
const styleCss = read('style.css');

// ---------- 4. 组装 HTML ----------
let html = read('index.html');
html = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/jpeg;base64,${logo}">`);
html = html.replace(/<link rel="stylesheet" href="\.\.\/hx-theme\.css">/, `<style>\n${themeCss}\n</style>`);
// 主题脚本：离线版也要（导航滑块、外观变量都在里面）。只把「算站点根目录」那一句换掉——
// file:// 下 new URL('.', 没有 src 的 script) 会抛 Invalid base URL，离线用不到 root。
let themeJs = fs.readFileSync(path.join(ROOT, '..', '总入口', 'hx-theme.js'), 'utf8');
themeJs = themeJs.replace(/var me = document\.currentScript, root = me \? new URL\('\.', me\.src\)\.href : location\.origin \+ '\/';/,
  "var me = document.currentScript, root = '';");
// 离线不该跳回总入口：把「单独打开就跳首页」那段去掉
themeJs = themeJs.replace(/if \(tool && window\.top === window && \/\^https\?:\$\/\.test\(location\.protocol\)[\s\S]*?return; \}/, '');
// 离线没有 bg/ 目录（图片、视频都不跟着文件走）。2026-11-04 起全站默认背景是「极光动态」视频，
// 不处理的话离线打开会去要一个不存在的 bg/aurora.mp4（620KB 的 404），背景层还会是空的。
// 这里就地降级成海报帧（base64 内联），离线也有极光画面，只是不动。
const auroraJpg = fs.readFileSync(path.join(ROOT, '..', '总入口', 'bg', 'aurora.jpg')).toString('base64');
themeJs = themeJs.replace(/aurora: \{[^}]*\}/,
  `aurora: { name: '极光 · 静帧', img: 'data:image/jpeg;base64,${auroraJpg}' }`);
html = html.replace(/<script src="\.\.\/hx-theme\.js"[^>]*><\/script>/, `<script>\n${themeJs}\n</script>`);
html = html.replace(/<link rel="stylesheet" href="style\.css">/, `<style>\n${styleCss}\n</style>`);
html = html.replace(/<a class="brand" id="brand" href="\.\.\/" target="_top">/, '<a class="brand" id="brand" href="#" onclick="return false">');
html = html.replace(/<img src="\.\.\/logo\.jpg"/, `<img src="data:image/jpeg;base64,${logo}"`);

// 离线：题库从内联表取，不走 fetch
const offlineHook = `
<script>
// 离线版：题库已经内联在这份文件里，替换 fetch 读本地 json 的那一句
window.__BANK = ${JSON.stringify(bank)};
window.__OFFLINE = true;
</script>`;
html = html.replace('</head>', offlineHook + '\n</head>');

// 统一像素加载动效（2026-11-04）：线上刷题引用 vendor/pixelfx-loader.js + loadfx.js 两个外部脚本，
// 离线单文件里没有目录，必须内联，否则 404 后 loadfx 不存在 → 永远走药丸回落（能用但没有动效）。
// 内联顺序和 index.html 一致：先特效包（挂 window.PixelFX）再胶水（挂 window.HXLoadFx）。
const fxBundle = read('vendor/pixelfx-loader.js');
const fxGlue = read('loadfx.js');
if (/<\/script/i.test(fxBundle + fxGlue)) throw new Error('加载动效脚本里不能出现 </script');
html = html.replace('<script src="vendor/pixelfx-loader.js"></script>\n<script src="loadfx.js"></script>',
  `<script>\n${fxBundle}\n</script>\n<script>\n${fxGlue}\n</script>`);

// 所有模块拼成一个普通 script（非 module，避免 file:// 下的 CORS）
const bundle = `<script>
(function(){
'use strict';
const __M = {};
${order.map(wrapModule).join('\n')}
})();
</script>`;
html = html.replace(/<script type="module" src="app\.js"><\/script>/, bundle);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成 ' + OUT + '（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB）');
