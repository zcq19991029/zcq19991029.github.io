/* 加载动效「真的在动」验收脚本（2026-11-05）。
 *
 * 背景：用户 iPhone Safari 反馈「点击接线仿真永远是一个像素动效的加载画面且不会动」。
 * 修复点：①每次打开重新随机（避开上一次）；②最短停留 900ms；③首帧预跑 0.35 秒。
 * 本脚本用 CDP 把 Chrome 伪装成 iPhone（390×844、mobile、touch、pointer:coarse/hover:none、
 * iPhone Safari UA），验证：
 *   A. 模拟环境生效（视口 / 触屏 / 粗指针 / UA）；
 *   B. 首帧不是空画布（像素实心占比）；
 *   C. 每 120ms 抓一次 canvas 像素 hash，14 次里不同 hash ≥ 5（证明在动）；
 *   D. 同一标签页连开两次，抽到的 data-fx 不同（证明每次随机）；
 *   E. 特效包里每个特效「预跑 0.35s 后」的实心占比（证明预跑对所有特效都有主体）；
 *   F. 同一套断言再跑一遍**接线仿真**的真实特效包（PixelFXRank + 它的 3 个白名单 id），
 *      这是用户实际反馈的那一页。
 *
 * 运行：node 总入口/fx/test-splash-alive.mjs
 * 依赖：本机 Chrome + puppeteer-core（默认读 codex项目/视频 下的安装，可用 PUPPETEER_CORE 覆盖）。
 * 不写仓库文件、不联网：临时页由内存里的 http 服务提供。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));      // 总入口/fx
const SITE = path.resolve(HERE, '..');                          // 总入口（发布根）
const REPO = path.resolve(SITE, '..');                          // 仓库根
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RANKFX = path.join(REPO, '接线仿真', 'vendor', 'pixelfx-rank.js');
const PUPPETEER_CORE = process.env.PUPPETEER_CORE
  || 'C:/Users/25466/Desktop/codex项目/视频/node_modules/puppeteer-core';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SAMPLE_TIMES = 14;
const SAMPLE_EVERY = 120;
const WANT_DISTINCT = 5;

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}

// 最小测试页：真实页面的 #hxBoot 结构 + 两个阻塞脚本，解析到闪屏就 boot()
const BOOT_HTML = `<div class="hx-boot" id="hxBoot"><div class="hx-boot-card">
<canvas></canvas>
<div class="hx-loadpill sm"><span class="hx-px" aria-hidden="true"><i style="--i:0"></i><i style="--i:1"></i><i style="--i:2"></i><i style="--i:3"></i><i style="--i:4"></i><i style="--i:5"></i><i style="--i:6"></i></span><b>正在载入…</b></div>
</div></div>`;

const page1 = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>splash-alive-probe</title>
<script src="/fx/pixelfx-loader.js"></script>
<script src="/fx/hx-loadfx.js"></script>
</head><body>
${BOOT_HTML}
<script>window.__boot = window.HXLoadFx.boot('probe');</script>
</body></html>`;

// 接线仿真实际构建方式：PixelFXRank 借名给胶水，ids 收敛成 3 个白名单（见 接线仿真/build-practice.cjs）
const page2 = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>splash-alive-probe-rank</title>
<script src="/__rankfx.js"></script>
<script>window.PixelFX = Object.assign({}, window.PixelFXRank, { ids: ["countdown", "collect-burst", "hit-spark"] });</script>
<script src="/fx/hx-loadfx.js"></script>
</head><body>
${BOOT_HTML}
<script>window.__boot = window.HXLoadFx.boot('probe2');</script>
</body></html>`;

const PAGES = { '/__splash_probe.html': page1, '/__splash_probe_rank.html': page2 };

// 单特效页：只留接线仿真里最短的 one-shot（hit-spark，0.5s），验证「到期重播」不会停在空画布
const page3 = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>splash-alive-probe-hit</title>
<script src="/__rankfx.js"></script>
<script>window.PixelFX = Object.assign({}, window.PixelFXRank, { ids: ["hit-spark"] });</script>
<script src="/fx/hx-loadfx.js"></script>
</head><body>
${BOOT_HTML}
<script>window.__boot = window.HXLoadFx.boot('probe3');</script>
</body></html>`;
PAGES['/__splash_probe_hit.html'] = page3;
const MIME = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (PAGES[url]) {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        res.end(PAGES[url]);
        return;
      }
      if (url === '/__rankfx.js') {
        if (!fs.existsSync(RANKFX)) { res.writeHead(404); res.end('no rankfx'); return; }
        res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
        fs.createReadStream(RANKFX).pipe(res);
        return;
      }
      const file = path.resolve(SITE, '.' + url);
      if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 抓当前 canvas 的一帧：FNV-1a hash + 实心（alpha>8）像素占比
const sampleFn = () => {
  const cv = document.querySelector('#hxBoot canvas');
  if (!cv || !cv.width || !cv.height) return { err: 'no canvas' };
  const ctx = cv.getContext('2d');
  if (!ctx) return { err: 'no ctx' };
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let h = 2166136261 >>> 0, solid = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 8) solid++;
    h ^= (d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return {
    hash: h.toString(16).padStart(8, '0'),
    ratio: solid / (d.length / 4),
    w: cv.width, h: cv.height,
    fx: cv.getAttribute('data-fx') || '',
    hidden: getComputedStyle(cv).display === 'none',
  };
};

// 按修复后的首帧策略算每个特效的实心占比：
// loop 特效预跑 0.35s 后取帧；one-shot（meta.loop === false）不预跑，取 t=0 峰值帧
const coverageFn = () => {
  const P = window.PixelFX;
  if (!P || !P.ids) return [];
  const out = [];
  for (const id of P.ids) {
    const mod = P.effects[id];
    if (!mod || !mod.meta) continue;
    const [W, H] = mod.meta.size;
    const O = mod.meta.origin || [W / 2, H / 2];
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const fr = P.createFrame(W, H);
    const fx = P.createFx(mod, { x: O[0], y: O[1], seed: 7 });
    const oneShot = mod.meta.loop === false;
    if (!oneShot) for (let t = 0; t < 0.35; t += 1 / 60) fx.update(1 / 60);
    P.clearFrame(fr); fx.draw(fr, 'back'); fx.draw(fr, 'front');
    P.composite(fr, img.data, null);
    let solid = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) solid++;
    out.push({ id, oneShot, ratio: +(solid / (W * H)).toFixed(4) });
  }
  return out;
};

async function emulate(page) {
  await page.setUserAgent(IPHONE_UA);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    screenWidth: 390, screenHeight: 844,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // prefers-reduced-motion 明确设成 no-preference（模拟器继承宿主设置会把 canvas 藏掉）；
  // pointer/hover 是加分项：不支持时靠 touch 模拟（Chrome 会自动让 matchMedia 报 coarse/none）。
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-reduced-motion', value: 'no-preference' },
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
  } catch (e) {
    console.log('NOTE  Emulation.setEmulatedMedia 部分特性不支持（' + e.message + '），靠 touch 模拟兜底');
  }
  return cdp;
}

async function sampleSeries(page, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i) await sleep(SAMPLE_EVERY);
    const s = await page.evaluate(sampleFn);
    if (s.err) { console.log('  采样 #' + i + ' 失败：' + s.err); continue; }
    out.push(s);
  }
  return out;
}

async function main() {
  if (!fs.existsSync(CHROME)) throw new Error('找不到 Chrome: ' + CHROME);

  const { srv, port: PORT } = await startServer();
  const base = `http://127.0.0.1:${PORT}`;
  const puppeteer = require(PUPPETEER_CORE);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
  });

  try {
    // ══ 场景 1：共享特效包（6 个 loop 特效）══════════════════════════════
    const page = await browser.newPage();
    await emulate(page);
    await page.goto(base + '/__splash_probe.html', { waitUntil: 'load', timeout: 30000 });

    const env = await page.evaluate(() => ({
      ua: navigator.userAgent,
      w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio,
      coarse: matchMedia('(pointer: coarse)').matches,
      noHover: matchMedia('(hover: none)').matches,
      touchPts: navigator.maxTouchPoints,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      fx: document.querySelector('#hxBoot canvas')?.getAttribute('data-fx') || '',
      hasPx: !!window.PixelFX,
    }));
    check('伪 iPhone 环境生效', env.w === 390 && env.h === 844 && /iPhone/.test(env.ua),
      `innerWidth=${env.w} innerHeight=${env.h} dpr=${env.dpr}`);
    check('触屏 / 粗指针 / 无 hover', env.coarse && env.noHover && env.touchPts > 0,
      `pointer:coarse=${env.coarse} hover:none=${env.noHover} maxTouchPoints=${env.touchPts}`);
    check('未触发 reduced-motion 降级', !env.reduced, `reduce=${env.reduced}`);
    check('特效包 + 胶水脚本都加载', env.hasPx && !!env.fx, `PixelFX=${env.hasPx} data-fx=${env.fx}`);

    const first = await page.evaluate(sampleFn);
    check('首帧有实心像素（预跑生效）', !first.err && first.ratio > 0.002,
      `fx=${first.fx} 尺寸=${first.w}×${first.h} 实心占比=${(first.ratio * 100).toFixed(2)}%`);

    const samples = await sampleSeries(page, SAMPLE_TIMES);
    const hashes = [...new Set(samples.map((s) => s.hash))];
    const ratios = samples.map((s) => s.ratio);
    console.log('  采样帧数=' + samples.length
      + '  不同 hash=' + hashes.length
      + '  实心占比 min/max=' + (Math.min(...ratios) * 100).toFixed(2) + '%/'
      + (Math.max(...ratios) * 100).toFixed(2) + '%');
    console.log('  hash 序列：' + samples.map((s) => s.hash).join(' '));
    check(`画面持续变化（不同 hash ≥ ${WANT_DISTINCT}）`, hashes.length >= WANT_DISTINCT,
      `${hashes.length} 个不同 / ${samples.length} 次采样`);
    check('全程 canvas 未被隐藏', samples.length > 0 && samples.every((s) => !s.hidden),
      samples.every((s) => !s.hidden) ? 'visible' : 'hidden');

    const fx1 = first.fx;
    await page.goto(base + '/__splash_probe.html', { waitUntil: 'load', timeout: 30000 });
    const env2 = await page.evaluate(() => ({
      fx: document.querySelector('#hxBoot canvas')?.getAttribute('data-fx') || '',
    }));
    console.log(`  第一次 data-fx=${fx1}  第二次 data-fx=${env2.fx}`);
    check('连开两次抽到不同特效', !!fx1 && !!env2.fx && fx1 !== env2.fx, `${fx1} → ${env2.fx}`);

    const s2 = await sampleSeries(page, 6);
    check('第二次打开画面也在动', new Set(s2.map((s) => s.hash)).size >= 3,
      `${new Set(s2.map((s) => s.hash)).size} 个不同 hash / ${s2.length} 次采样`);

    const coverage = await page.evaluate(coverageFn);
    const empty = coverage.filter((c) => c.ratio <= 0.002);
    console.log('  全特效预跑后实心占比：'
      + coverage.map((c) => `${c.id}=${(c.ratio * 100).toFixed(2)}%`).join('  '));
    check('共享包所有特效预跑后都有主体', coverage.length > 0 && empty.length === 0,
      `${coverage.length} 个特效，空帧 ${empty.length} 个` + (empty.length ? '：' + empty.map((c) => c.id).join(',') : ''));

    // ══ 场景 2：接线仿真真实特效包（3 个白名单 id，用户反馈的那一页）════════
    const rank = await browser.newPage();
    await emulate(rank);
    await rank.goto(base + '/__splash_probe_rank.html', { waitUntil: 'load', timeout: 30000 });
    const rInfo = await rank.evaluate(() => ({
      ids: (window.PixelFX && window.PixelFX.ids) || [],
      fx: document.querySelector('#hxBoot canvas')?.getAttribute('data-fx') || '',
      hasRank: !!window.PixelFXRank,
    }));
    check('接线仿真特效包加载并借用 PixelFX', rInfo.hasRank && rInfo.ids.length === 3,
      `ids=[${rInfo.ids.join(',')}] data-fx=${rInfo.fx}`);
    check('抽到的 id 在接线仿真白名单内', rInfo.ids.includes(rInfo.fx), rInfo.fx);

    const rFirst = await rank.evaluate(sampleFn);
    check('接线仿真首帧有实心像素', !rFirst.err && rFirst.ratio > 0.002,
      `fx=${rFirst.fx} 尺寸=${rFirst.w}×${rFirst.h} 实心占比=${(rFirst.ratio * 100).toFixed(2)}%`);

    const rSamples = await sampleSeries(rank, SAMPLE_TIMES);
    const rHashes = [...new Set(rSamples.map((s) => s.hash))];
    console.log('  接线仿真采样帧数=' + rSamples.length + '  不同 hash=' + rHashes.length
      + '  实心占比 min/max=' + (Math.min(...rSamples.map((s) => s.ratio)) * 100).toFixed(2) + '%/'
      + (Math.max(...rSamples.map((s) => s.ratio)) * 100).toFixed(2) + '%');
    console.log('  接线仿真 hash 序列：' + rSamples.map((s) => s.hash).join(' '));
    check(`接线仿真画面持续变化（不同 hash ≥ ${WANT_DISTINCT}）`, rHashes.length >= WANT_DISTINCT,
      `${rHashes.length} 个不同 / ${rSamples.length} 次采样`);

    await rank.goto(base + '/__splash_probe_rank.html', { waitUntil: 'load', timeout: 30000 });
    const rFx2 = await rank.evaluate(() => document.querySelector('#hxBoot canvas')?.getAttribute('data-fx') || '');
    console.log(`  接线仿真第一次=${rFirst.fx}  第二次=${rFx2}`);
    check('接线仿真连开两次抽到不同特效', !!rFx2 && rFx2 !== rFirst.fx, `${rFirst.fx} → ${rFx2}`);

    const rCoverage = await rank.evaluate(coverageFn);
    const rEmpty = rCoverage.filter((c) => c.ratio <= 0.002);
    console.log('  接线仿真特效首帧实心占比：'
      + rCoverage.map((c) => `${c.id}=${(c.ratio * 100).toFixed(2)}%${c.oneShot ? '(one-shot)' : ''}`).join('  '));
    check('接线仿真 3 个特效首帧都有主体', rCoverage.length === 3 && rEmpty.length === 0,
      `${rCoverage.length} 个特效，空帧 ${rEmpty.length} 个`);

    // ── 最短 one-shot（hit-spark 0.5s）必须重播，不能播完就空 ═══════════
    const hit = await browser.newPage();
    await emulate(hit);
    await hit.goto(base + '/__splash_probe_hit.html', { waitUntil: 'load', timeout: 30000 });
    const hitSamples = await sampleSeries(hit, SAMPLE_TIMES);
    const hitHashes = [...new Set(hitSamples.map((s) => s.hash))];
    const tail = hitSamples.slice(6);   // 约 0.72s 之后（已超过 hit-spark 的 0.5s 生命周期）
    console.log('  hit-spark 采样：不同 hash=' + hitHashes.length
      + '  后半段实心占比=' + tail.map((s) => (s.ratio * 100).toFixed(2) + '%').join(' '));
    check('one-shot 播完会重播（0.5s 后仍有画面）', tail.some((s) => s.ratio > 0.005),
      `后半段最大实心占比=${(Math.max(...tail.map((s) => s.ratio)) * 100).toFixed(2)}%`);
    check('one-shot 重播期间画面持续变化', hitHashes.length >= WANT_DISTINCT,
      `${hitHashes.length} 个不同 hash / ${hitSamples.length} 次采样`);
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }

  const pass = checks.filter((c) => c.ok).length;
  console.log(`\n通过 ${pass}/${checks.length}`);
  if (pass !== checks.length) {
    console.log('FAILED: ' + checks.filter((c) => !c.ok).map((c) => c.name).join(' | '));
    process.exitCode = 1;
  } else {
    console.log('ALL PASS');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
