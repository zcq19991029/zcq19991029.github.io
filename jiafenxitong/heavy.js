/* heavy.js —— 让 1.3 MB 的导出库不再挡住页面启动（2026-11-09）
 *
 * 背景（用户报「现在基本上打不开了 / 登录都登录不了」）：
 *   index.html 里 vendor/xlsx.full.min.js（930 KB）和 vendor/jspdf.umd.min.js（409 KB）
 *   原来是两个普通 <script>，排在 app.js **前面**。普通脚本是按文档顺序执行且阻塞解析的，
 *   所以浏览器必须先把这 1.3 MB 下完、执行完，才轮到 app.js —— 而 app.js 才是绑登录、
 *   画界面、读本机数据的那个文件。网一慢（教室几十台机器抢一条线），页面就是白屏 +
 *   按钮全无反应，看起来就像「崩了」。
 *
 * 改法（只改加载时机，一个字都不动导出逻辑）：
 *   1) 那两个标签加 defer：不再阻塞解析，app.js 立刻跑，页面马上能用；
 *      它们自己仍然会在解析结束后下载并执行，所以「过一会儿再点导出」本来就没问题。
 *   2) 本文件补上唯一的空档：万一用户手快，在库还没下完就点了导出/打印，
 *      先把这次点击拦下来、等库到齐再替他重新发一次（不用他再点）。
 *      拦不到就原样放行 —— 这个文件永远不该成为新的故障点。
 *
 * 依赖的全局：window.XLSX（xlsx.full.min.js）、window.jspdf.jsPDF（jspdf.umd.min.js）。
 * 需要等的按钮用 id 列在这里；新增导出入口记得补进 NEED 表，否则手快时会报 XLSX 未定义。
 */
(function () {
  var NEED = {
    btnExportRoster: ['xlsx'],   // 导出全部名单（app.js:4598 → exportLesson）
    btnPrintRank: ['xlsx'],      // 打印 / 导出 PDF（app.js:4811 → printRank）
    gbExport: ['xlsx'],          // 成绩登分册 · 导出所选 Excel
    gbPdf: ['jspdf'],            // 成绩登分册 · 导出所选 PDF
    btnPrintLesson: ['xlsx', 'jspdf'], // 打印本课（app.js:1569 → openLessonPrint / downloadLessonPdf）
    specialExport: ['xlsx']      // 特殊表现 · 导出参考 Excel
  };
  function ready(k) {
    return k === 'xlsx' ? !!window.XLSX : !!(window.jspdf && window.jspdf.jsPDF);
  }
  function waitFor(k) {
    // 库是自己下载执行的（defer），这里只等它就绪，不重新插标签，避免下两份。
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      (function tick() {
        if (ready(k)) return res(true);
        if (Date.now() - t0 > 20000) return rej(new Error(k + ' 还没下载完'));
        setTimeout(tick, 120);
      })();
    });
  }
  function say(msg) {
    try {
      if (window.toast) return window.toast(msg);
      if (window.flash) return window.flash(msg);
    } catch (e) { }
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[id]') : null;
    if (!t || !NEED[t.id]) return;
    var miss = NEED[t.id].filter(function (k) { return !ready(k); });
    if (!miss.length) return;               // 库已就绪：原样放行，零影响
    e.preventDefault();
    e.stopImmediatePropagation();
    say('导出组件正在下载，稍等一下…');
    Promise.all(miss.map(waitFor)).then(function () {
      say('组件就绪，正在导出…');
      t.click();                            // 替他重新点一次（这次库里都有了）
    }).catch(function () {
      say('导出组件下载失败，请刷新页面后再试');
    });
  }, true);   // 捕获阶段：必须赶在 app.js 自己的监听器前面
})();
