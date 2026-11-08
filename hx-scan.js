/* 华夏工具 · 全站「扫一扫」（2026-11-08 K5）
   用法：<script src="../hx-scan.js"></script>（站点根目录；总入口用 hx-scan.js）
     HXScan.supported()          → 这个浏览器能不能在网页里开摄像头（https + getUserMedia）
     HXScan.open(opts)           → Promise<string|null>：扫到内容 resolve 文本，取消 resolve null
       opts.title  弹层标题（默认「扫一扫」）
       opts.jsqr   jsQR 地址（默认和本脚本同目录的 vendor/jsQR.js）
   识别：优先浏览器自带 BarcodeDetector（qr_code），没有或不支持就按需加载本地 jsQR（不走 CDN）。
   开不了摄像头（被拒、没摄像头、非 https、微信/钉钉内置浏览器拦截）→ 弹层里给退路：用微信扫一扫或手机相机扫。
   HXScan.engine：最近一次识别用的引擎（'native' / 'jsqr'），给测试看。 */
(function () {
  if (window.HXScan) return;
  var me = document.currentScript && document.currentScript.src;
  var JSQR = me ? new URL('vendor/jsQR.js', me).href : 'vendor/jsQR.js';
  var FALLBACK = '请用微信「扫一扫」或手机相机扫大屏二维码，会直接打开签到页';
  var jsqrP = null, cur = null;

  function css() {
    if (document.getElementById('hxscan-css')) return;
    var s = document.createElement('style'); s.id = 'hxscan-css';
    s.textContent =
      '.hxscan{position:fixed;inset:0;z-index:2147483000;background:#000;color:#fff;display:flex;flex-direction:column;font:15px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.hxscan header{display:flex;align-items:center;gap:8px;padding:max(12px,env(safe-area-inset-top)) 16px 12px}' +
      '.hxscan header b{flex:1;font-size:17px}' +
      '.hxscan button{font:inherit;color:#fff;background:rgba(255,255,255,.16);border:0;border-radius:999px;padding:8px 18px;cursor:pointer}' +
      '.hxscan .hxs-v{position:relative;flex:1;min-height:0;overflow:hidden}' +
      '.hxscan video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
      '.hxscan .hxs-f{position:absolute;left:50%;top:50%;width:min(70vw,70vh,320px);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:18px;box-shadow:0 0 0 200vmax rgba(0,0,0,.45);outline:2px solid rgba(255,255,255,.85)}' +
      '.hxscan .hxs-f::after{content:"";position:absolute;left:8%;right:8%;top:10%;height:2px;background:#5ac8fa;box-shadow:0 0 12px #5ac8fa;animation:hxs-l 2s ease-in-out infinite alternate}' +
      '@keyframes hxs-l{to{top:88%}}' +
      '@media (prefers-reduced-motion:reduce){.hxscan .hxs-f::after{animation:none;top:50%}}' +
      '.hxscan .hxs-m{display:none;position:absolute;inset:0;padding:24px 16px;overflow:auto;place-content:center;text-align:center;gap:10px}' +
      '.hxscan.err .hxs-m{display:grid}.hxscan.err video,.hxscan.err .hxs-f{display:none}' +
      '.hxscan .hxs-m p{margin:0;max-width:30em;justify-self:center;overflow-wrap:anywhere}' +
      '.hxscan .hxs-m .hxs-r{opacity:.7;font-size:13px}';
    document.head.appendChild(s);
  }

  function inApp() { return /MicroMessenger|DingTalk|AliApp\(DingTalk/i.test(navigator.userAgent || ''); }
  function supported() { return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  // 开不了摄像头的原因 → 中文
  function why(e) {
    if (!window.isSecureContext) return '当前网址不是 https，浏览器不让网页用摄像头';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return inApp() ? '当前 App 内置浏览器不让网页用摄像头' : '当前浏览器不支持网页里开摄像头';
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return inApp() ? '当前 App 内置浏览器拦截了摄像头' : '摄像头权限被拒绝了';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return '没找到可用的摄像头';
    if (n === 'NotReadableError' || n === 'TrackStartError') return '摄像头被别的程序占用了';
    return '摄像头打不开';
  }
  function loadJsQR(src) {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    return jsqrP || (jsqrP = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = src || JSQR; s.async = true;
      s.onload = function () { window.jsQR ? ok(window.jsQR) : (jsqrP = null, no(new Error('识别组件加载失败'))); };
      s.onerror = function () { jsqrP = null; no(new Error('识别组件加载失败')); };
      document.head.appendChild(s);
    }));
  }
  function nativeDetector() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    var BD = window.BarcodeDetector;
    var fmts = BD.getSupportedFormats ? BD.getSupportedFormats() : Promise.resolve(['qr_code']);
    return Promise.resolve(fmts).then(function (f) {
      if (f && f.indexOf('qr_code') < 0) return null;
      try { return new BD({ formats: ['qr_code'] }); } catch (e) { return null; }
    }, function () { return null; });
  }

  function open(opts) {
    opts = opts || {};
    if (cur) cur.close(null); // 同时只开一个
    css();
    var el = document.createElement('div'); el.className = 'hxscan'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', opts.title || '扫一扫');
    el.innerHTML = '<header><b></b><button type="button" class="hxs-x">取消</button></header>' +
      '<div class="hxs-v"><video playsinline muted autoplay></video><div class="hxs-f"></div>' +
      '<div class="hxs-m"><p class="hxs-r"></p><p class="hxs-t"></p><button type="button" class="hxs-x2">知道了</button></div></div>';
    el.querySelector('b').textContent = opts.title || '扫一扫';
    document.body.appendChild(el);
    var video = el.querySelector('video'), stream = null, done = false, timer = 0, raf = 0, canvas = null, ctx = null, det = null, jq = null, busy = false;
    return new Promise(function (resolve) {
      function stop() {
        clearTimeout(timer); if (raf) cancelAnimationFrame(raf);
        if (stream) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
        stream = null; try { video.pause(); video.srcObject = null; } catch (e) { }
      }
      function close(v) {
        if (done) return; done = true; stop();
        document.removeEventListener('keydown', onKey, true);
        if (el.parentNode) el.parentNode.removeChild(el);
        if (cur && cur.el === el) cur = null;
        resolve(v == null ? null : String(v));
      }
      function fail(e) {
        stop(); if (done) return;
        el.classList.add('err');
        el.querySelector('.hxs-r').textContent = why(e);
        el.querySelector('.hxs-t').textContent = FALLBACK;
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(null); } }
      cur = { el: el, close: close };
      el.querySelector('.hxs-x').onclick = function () { close(null); };
      el.querySelector('.hxs-x2').onclick = function () { close(null); };
      document.addEventListener('keydown', onKey, true);

      function tick() {
        if (done || busy) return;
        if (video.readyState < 2 || !video.videoWidth) { timer = setTimeout(tick, 120); return; }
        busy = true;
        var p;
        if (det) p = det.detect(video).then(function (r) { return r && r[0] && r[0].rawValue; }, function () { det = null; return null; }); // 自带的识别出错就退回 jsQR
        else {
          var w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 800 / Math.max(w, h));
          w = Math.round(w * k); h = Math.round(h * k);
          if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d', { willReadFrequently: true }); }
          canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
          p = (jq ? Promise.resolve(jq) : loadJsQR(opts.jsqr).then(function (f) { return (jq = f); })).then(function (f) {
            var r = f(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
            return r && r.data;
          });
          HXScan.engine = 'jsqr';
        }
        if (det) HXScan.engine = 'native';
        p.then(function (txt) {
          busy = false; if (done) return;
          if (txt) close(txt); else timer = setTimeout(tick, 150);
        }, function (e) { busy = false; if (!done) { el.classList.add('err'); el.querySelector('.hxs-r').textContent = (e && e.message) || '识别组件加载失败'; el.querySelector('.hxs-t').textContent = FALLBACK; stop(); } });
      }

      if (!supported()) { fail(null); return; }
      nativeDetector().then(function (d) {
        det = d; if (done) return;
        if (!det) loadJsQR(opts.jsqr).catch(function () { }); // 先在后台把 jsQR 拉下来，开完摄像头基本就到了
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
          if (done) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s; video.srcObject = s;
          var pl = video.play(); if (pl && pl.catch) pl.catch(function () { });
          tick();
        });
      }).catch(fail);
    });
  }

  window.HXScan = { open: open, supported: supported, engine: null, FALLBACK: FALLBACK };
})();
