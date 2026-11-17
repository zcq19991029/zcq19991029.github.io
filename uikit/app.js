/* UI 设计 · 页面逻辑
   ─────────────────────────────────────────────────────────────────────────
   路由：#/            组件目录
         #/c/<id>     组件详情
   copyright.html 是独立静态页（使用说明与来源），不进路由。
   所有代码块都用 textContent 塞进去，不做字符串拼 HTML —— 代码里有尖括号，
   拼 innerHTML 轻则样式乱、重则整块被吃掉。
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  var DATA = window.UIKIT || { version: '0', updated: '', items: [] };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  /* 深浅归全站管（2026-11-17）。取当前值的优先级：
       1. hx-theme.js 写进 <html> 的 data-hx-mode（真来源）；
       2. 本页内联脚本先落下的 data-mode（hx-theme 还没跑完时的兜底）；
       3. 默认深色（全站默认就是深色）。
     老存档里的 uikit:mode 只用于第 2 步，不再由这里写。 */
  function curMode() {
    var h = document.documentElement, m = h.getAttribute('data-hx-mode');
    if (m !== 'light' && m !== 'dark') m = h.getAttribute('data-mode');
    return m === 'light' ? 'light' : 'dark';
  }
  var mode = curMode();
  var q = '';                       // 搜索词

  /* ── 小工具 ─────────────────────────────────────────────────────────── */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg) {
    var t = $('.toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); },
        function () { fallback(text); });
    } else fallback(text);
  }
  function fallback(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }
    ta.remove();
  }
  /* 只同步按钮提示，**不动 <html> 上的属性**。
     属性（data-hx-mode）是 hx-theme 的地盘：这里也去写的话，切一次深浅会出现「我先写 light、
     hx-theme 还是 dark」的一瞬，属性观察者读到旧值就把 mode 掰回去，表现为点了没反应 / 闪一下。 */
  function applyModeUI(m) {
    var b = $('.theme-btn');
    if (b) {
      b.title = m === 'dark' ? '切到浅色' : '切到深色';
      b.setAttribute('aria-label', b.title);
    }
  }
  /* 点右上角那个月亮/太阳：改的是**全站那一把键**（hx-theme），不是本站私有键 ——
     全站只要一个外观控制，在这里切完，总入口和别的工具也该跟着变。
     没引到 hx-theme.js 时（离线单文件 / 404）退回旧的 uikit:mode + 自己写 data-mode，页面至少自己能用。 */
  function setMode(m) {
    applyModeUI(m);
    try {
      if (window.HXTheme && HXTheme.set) { HXTheme.set({ mode: m }); return; }
    } catch (e) { }
    try { localStorage.setItem('uikit:mode', m); } catch (e) { }
    document.documentElement.setAttribute('data-mode', m);
  }
  /* 别人在总入口改了深浅（storage / 外壳 apply）→ 本页跟着变。
     hx-theme 是往 <html data-hx-mode> 写的，光听 storage 收不到（那只是另一个标签页里发生的事），
     所以盯属性。自己点按钮时也会触发一次，靠 mode 值比对挡掉重复渲染。 */
  (function () {
    if (!window.MutationObserver) return;
    new MutationObserver(function () {
      var m = curMode();
      if (m === mode) return;
      mode = m;
      applyModeUI(m);
      route();                       // 预览 iframe 要跟着换深浅
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-hx-mode', 'data-mode'] });
  })();
  function match(it) {
    if (!q) return true;
    var hay = (it.name + ' ' + it.sub + ' ' + (it.tags || []).join(' ') + ' ' +
      (it.intro || []).join(' ')).toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  /* 简介里只用两种行内标记：**加粗** 和 `代码`。
     先转义再把标记换成标签 —— 顺序反了会把正文里的 <select> 当成标签吃掉。 */
  function inline(text) {
    var s = String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  /* ── 代码块 ─────────────────────────────────────────────────────────── */
  function codeBox(opts) {
    // opts: { tabs:[{label, code}], note }
    var box = el('div', 'codebox');
    var head = el('div', 'code-head');
    var pre = el('pre');
    var code = el('code');
    pre.appendChild(code);

    var tabs = opts.tabs || [];
    tabs.forEach(function (t, i) {
      var b = el('button', 'tab' + (i === 0 ? ' on' : ''), t.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        [].forEach.call(head.querySelectorAll('.tab'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        code.textContent = t.code;
        pre.scrollTop = 0;
      });
      head.appendChild(b);
    });
    var sp = el('div', 'sp');
    var cp = el('button', 'copy', '复制代码');
    cp.type = 'button';
    cp.addEventListener('click', function () {
      var on = head.querySelector('.tab.on');
      var i = tabs.indexOf(tabs.filter(function (t) { return t.label === on.textContent; })[0]);
      copy(tabs[i >= 0 ? i : 0].code);
    });
    sp.appendChild(cp);
    head.appendChild(sp);

    code.textContent = tabs.length ? tabs[0].code : '';
    box.appendChild(head);
    box.appendChild(pre);
    return box;
  }

  /* ── 预览 ───────────────────────────────────────────────────────────── */
  function stage(it) {
    var wrap = el('div', 'stage');
    var bar = el('div', 'stage-bar');
    bar.appendChild(el('span', null, '实时预览 · 跑的就是真组件'));
    var sp = el('div', 'sp');

    var dark = mode === 'dark';
    // 带上版本号：组件改了、图没变，浏览器会一直吃旧的 iframe 缓存（本地调试踩过）
    function src() { return 'demo/' + it.demo + '?mode=' + (dark ? 'dark' : 'light') + '&v=' + DATA.version; }
    var frame = el('iframe');
    frame.title = it.name + ' 预览';
    frame.loading = 'lazy';
    frame.style.height = (it.demoH || 340) + 'px';
    frame.src = src();

    var tone = el('button', 'btn ghost', dark ? '深色' : '浅色');
    tone.type = 'button';
    tone.addEventListener('click', function () {
      dark = !dark;
      tone.textContent = dark ? '深色' : '浅色';
      frame.src = src();
    });
    var reload = el('button', 'btn ghost', '重跑');
    reload.type = 'button';
    reload.addEventListener('click', function () { frame.src = src(); });

    sp.appendChild(tone);
    sp.appendChild(reload);
    bar.appendChild(sp);

    wrap.appendChild(bar);
    wrap.appendChild(frame);
    if (it.demoNote !== false) {
      var n = el('div', 'stage-note',
        '预览是 iframe 里真实渲染的（demo/' + it.demo + '），不是截图 —— 点开药板、拖一下滑杆都能用。');
      wrap.appendChild(n);
    }
    return wrap;
  }

  /* ── 表格 ───────────────────────────────────────────────────────────── */
  function table(head, rows, isApi) {
    var t = el('table', 'tbl');
    var thead = el('thead'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr');
      var c0 = el('td');
      var c = el('code', null, r.k);
      c0.appendChild(c);
      row.appendChild(c0);
      if (isApi) {
        row.appendChild(el('td', 'ty', r.t || '—'));
        row.appendChild(el('td', 'ty', r.def || '—'));
      } else {
        row.appendChild(el('td', 'ty', r.def || '—'));
      }
      row.appendChild(el('td', null, r.d || ''));
      tb.appendChild(row);
    });
    t.appendChild(tb);
    return t;
  }

  /* ── 侧栏 ───────────────────────────────────────────────────────────── */
  function renderNav(activeId) {
    var nav = $('.nav');
    nav.innerHTML = '';
    nav.appendChild(el('h6', null, '组件 ' + DATA.items.length));
    var any = false;
    DATA.items.forEach(function (it) {
      if (!match(it)) return;
      any = true;
      var a = el('a', it.id === activeId ? 'on' : '');
      a.href = '#/c/' + it.id;
      a.appendChild(document.createTextNode(it.name));
      a.appendChild(el('small', null, it.sub));
      nav.appendChild(a);
    });
    if (!any) nav.appendChild(el('div', 'empty', q ? '没有匹配的组件' : '还没有组件'));
    nav.appendChild(el('div', 'sep'));
    var c = el('a', null, '使用说明与来源');
    c.href = 'copyright.html';
    nav.appendChild(c);
  }

  /* ── 首页 ───────────────────────────────────────────────────────────── */
  function renderHome() {
    var m = $('.main');
    m.innerHTML = '';
    var hero = el('div', 'hero');
    hero.appendChild(el('h1', null, 'UI 设计'));
    hero.appendChild(el('p', null,
      '把站内做过的界面零件存档：源码、复刻提示词、实时预览、使用示例、API 参考。'
      + '目的是「下次要同样的东西，直接套用或让 AI 照着复刻」，不用翻旧项目找那段 CSS。'));
    var row = el('div', 'row');
    var b1 = el('a', 'btn pri', '从药丸下拉开始');
    b1.href = '#/c/' + (DATA.items[0] ? DATA.items[0].id : '');
    var b2 = el('a', 'btn', '使用说明与来源');
    b2.href = 'copyright.html';
    row.appendChild(b1); row.appendChild(b2);
    hero.appendChild(row);
    m.appendChild(hero);

    var grid = el('div', 'grid');
    var hit = 0;
    DATA.items.forEach(function (it) {
      if (!match(it)) return;
      hit++;
      var a = el('a', 'tile');
      a.href = '#/c/' + it.id;
      a.appendChild(el('h3', null, it.name));
      a.appendChild(el('p', null, it.sub));
      var tg = el('div', 'tags');
      (it.tags || []).slice(0, 4).forEach(function (x) { tg.appendChild(el('span', 'tag', x)); });
      a.appendChild(tg);
      grid.appendChild(a);
    });
    if (hit) m.appendChild(grid);
    else m.appendChild(el('div', 'none', '没有匹配的组件，换个词试试。'));
  }

  /* ── 详情 ───────────────────────────────────────────────────────────── */
  function renderDetail(id) {
    var it = null;
    for (var i = 0; i < DATA.items.length; i++) if (DATA.items[i].id === id) it = DATA.items[i];
    var m = $('.main');
    m.innerHTML = '';
    if (!it) {
      var nf = el('div', 'detail');
      var nfh = el('div', 'dhead');
      nfh.appendChild(el('h1', null, '没找到这个组件'));
      var back = el('a', 'btn', '回组件目录');
      back.href = '#/';
      nfh.appendChild(back);
      nf.appendChild(nfh);
      m.appendChild(nf);
      return;
    }
    /* 详情页分块（2026-11-17）：头部（标题/副标题/元信息）一张卡，下面每个区块各一张卡。
       原来这些全裸排、区块之间只隔一条细横线，在壁纸页上看着「一坨、没分块」—— 用户原话。 */
    var root = el('div', 'detail');
    var head = el('div', 'dhead');
    head.appendChild(el('h1', null, it.name));
    head.appendChild(el('p', 'sub', it.sub));

    var meta = el('div', 'meta');
    if (it.date) meta.appendChild(el('span', null, it.date));
    meta.appendChild(el('span', 'dot'));
    meta.appendChild(el('span', null, '仅学习使用'));
    if (it.tags && it.tags.length) {
      meta.appendChild(el('span', 'dot'));
      meta.appendChild(el('span', null, it.tags.slice(0, 3).join(' · ')));
    }
    head.appendChild(meta);
    root.appendChild(head);

    /* 简介 */
    var s1 = el('section', 'sec');
    s1.appendChild(el('h2', null, '简介'));
    var prose = el('div', 'prose');
    (it.intro || []).forEach(function (p) {
      var n = el('p');
      n.innerHTML = inline(p);
      prose.appendChild(n);
    });
    s1.appendChild(prose);
    root.appendChild(s1);

    /* 来源 */
    if (it.source) {
      var s2 = el('section', 'sec');
      s2.appendChild(el('h2', null, '来源'));
      var src = el('div', 'src');
      var ic = el('div');
      ic.style.cssText = 'width:34px;height:34px;border-radius:10px;flex:none;background:linear-gradient(150deg,#6f8dff,#1a56ff)';
      src.appendChild(ic);
      var tx = el('div');
      tx.appendChild(el('b', null, it.source.name));
      tx.appendChild(el('span', null, it.source.note || ''));
      src.appendChild(tx);
      s2.appendChild(src);
      root.appendChild(s2);
    }

    /* 预览 */
    var s3 = el('section', 'sec');
    s3.appendChild(el('h2', null, '预览'));
    s3.appendChild(stage(it));
    root.appendChild(s3);

    /* 参数 */
    if (it.params && it.params.length) {
      var s4 = el('section', 'sec');
      s4.appendChild(el('h2', null, '参数'));
      s4.appendChild(table(['参数', '默认', '说明'], it.params));
      root.appendChild(s4);
    }

    /* 依赖 */
    if (it.deps) {
      var s5 = el('section', 'sec');
      s5.appendChild(el('h2', null, '依赖'));
      s5.appendChild(codeBox({ tabs: [{ label: '前置条件', code: it.deps.code }] }));
      if (it.deps.note) s5.appendChild(el('p', 'hintline', it.deps.note));
      root.appendChild(s5);
    }

    /* 源码 */
    if (it.code && it.code.length) {
      var s6 = el('section', 'sec');
      s6.appendChild(el('h2', null, '源码'));
      s6.appendChild(codeBox({ tabs: it.code.map(function (c) { return { label: c.label, code: c.code }; }) }));
      s6.appendChild(el('p', 'hintline',
        '这份代码可以直接复制到别的项目里跑；本站各工具用的是 hx-theme.js 里的同一套实现。'));
      root.appendChild(s6);
    }

    /* 使用示例 */
    if (it.usage) {
      var s7 = el('section', 'sec');
      s7.appendChild(el('h2', null, '使用示例'));
      s7.appendChild(codeBox({ tabs: [{ label: '示例', code: it.usage.code }] }));
      if (it.usage.note) s7.appendChild(el('p', 'hintline', it.usage.note));
      root.appendChild(s7);
    }

    /* 复刻提示词 */
    if (it.prompt) {
      var s8 = el('section', 'sec');
      s8.appendChild(el('h2', null, '复刻提示词'));
      var box = el('div', 'prompt');
      var ph = el('div', 'prompt-h');
      ph.appendChild(el('b', null, '把这段整段粘给 AI，让它重做一遍'));
      var sp = el('div', 'sp');
      var cp = el('button', 'btn pri', '复制提示词');
      cp.type = 'button';
      cp.addEventListener('click', function () { copy(it.prompt); });
      sp.appendChild(cp);
      ph.appendChild(sp);
      box.appendChild(ph);
      var pre = el('pre');
      pre.textContent = it.prompt;
      box.appendChild(pre);
      s8.appendChild(box);
      root.appendChild(s8);
    }

    /* API 参考 */
    if (it.api && it.api.length) {
      var s9 = el('section', 'sec');
      s9.appendChild(el('h2', null, 'API 参考'));
      s9.appendChild(table(['接口', '类型', '默认', '说明'], it.api, true));
      root.appendChild(s9);
    }

    m.appendChild(root);
  }

  /* ── 路由 ───────────────────────────────────────────────────────────── */
  function route() {
    var h = location.hash || '#/';
    var m = /^#\/c\/([\w-]+)$/.exec(h);
    if (m) {
      renderNav(m[1]);
      renderDetail(m[1]);
      window.scrollTo(0, 0);
    } else if (h === '#/' || h === '#') {
      renderNav('');
      renderHome();
      window.scrollTo(0, 0);
    } else {
      renderNav('');
      renderHome();
    }
    document.title = (m ? (function () {
      for (var i = 0; i < DATA.items.length; i++) if (DATA.items[i].id === m[1]) return DATA.items[i].name + ' · UI 设计';
      return 'UI 设计';
    })() : 'UI 设计 · 华夏工具');
  }

  /* ── 启动 ───────────────────────────────────────────────────────────── */
  applyModeUI(mode);      // 只摆按钮图标/提示，不改存储也不改 html 属性（属性归 hx-theme）
  $('.ver').textContent = 'v' + DATA.version + ' · ' + DATA.updated;
  $('.theme-btn').addEventListener('click', function () {
    mode = mode === 'dark' ? 'light' : 'dark';
    setMode(mode);
    route();   // 预览 iframe 要跟着换深浅
  });
  var si = $('.search input');
  si.addEventListener('input', function () {
    q = si.value.trim().toLowerCase();
    var h = location.hash || '#/';
    var m = /^#\/c\/([\w-]+)$/.exec(h);
    renderNav(m ? m[1] : '');
    if (!m) renderHome();
  });
  addEventListener('hashchange', route);
  route();
})();
