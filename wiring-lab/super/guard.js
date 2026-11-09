// 版权保护（域名锁）：只在正版网址（任何电脑、任何教室都行）、本机离线文件（U 盘拷到希沃，file://）和本机测试服务器上运行；
// 被复制到别的网站上，就只显示版权声明。外壳和每张练习页都带这段（练习页在 iframe 里，按外壳的网址判断）。发布时和其他代码一起混淆
(function guard() {
  let L = location;
  // 练习页在 iframe 里（很多是 srcdoc 加载的）：要按外壳的网址判断，而不是 iframe 自己那个空地址。
  // srcdoc 的 iframe 读 parent.location 有时会抛异常（跨域策略、about:srcdoc 等），
  // 这时如果只认 location 就会把自己的地址当成「未授权」，把整页换成版权声明——这正是离线文件被误拦的原因。
  // 所以：读不到 parent 时，只要自己是 file: 或 about:srcdoc 就放行。
  try {
    if (window.parent !== window) {
      let ok = false;
      try { if (parent.location.href) { L = parent.location; ok = true; } } catch (e) { }
      if (!ok) return; // 嵌在框里但读不到外壳网址（srcdoc / 本机文件）：当作离线，放行
    }
  } catch (e) { }
  const h = L.hostname, ok = L.protocol === 'file:' || h === 'zcq19991029.github.io' || h === 'localhost' || h === '127.0.0.1';
  if (ok) return;
  // 还没解析出可用地址（about:srcdoc、about:blank）也不拦：这种页面只可能是本机文件的内部页
  if (!h && !/^https?:$/.test(L.protocol)) return;
  const show = () => { document.documentElement.innerHTML = '<head><meta charset="utf-8"><title>项目二接线仿真 · 版权所有</title></head><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b1020;color:#e2e8f0;font:20px/1.9 \'Microsoft YaHei\',sans-serif;text-align:center"><div><b style="font-size:28px">项目二接线仿真</b><br>© 2026 zcq 版权所有，未经许可禁止复制、修改、转载<br><a style="color:#93c5fd" href="https://zcq19991029.github.io/wiring-lab/">前往正版网址</a></div></body>'; };
  show(); addEventListener('DOMContentLoaded', show);
  throw new Error('未授权的网址');
})();
