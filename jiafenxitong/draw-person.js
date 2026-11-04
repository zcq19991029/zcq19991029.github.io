/* 随机抽人 —— 从接线仿真 src/rank.js 搬过来的卡包抽人（2026-11-06 版）
 *
 * 只搬抽人，不搬排位/连线：卡包浮 → 蓄力抖动 → 开包强光 → 卡片飞出翻面 → 揭示，
 * 抽取逻辑（先算结果、动画只负责演、不与上一次重复、busy + 按钮双保险防连点）一行没改。
 *
 * 与接线仿真的差别（只有这两条）：
 *   ① 数据源换成小组加分自己的全班名单 —— 接线仿真读 RK.studs[班级id]，这边读 cls.roster；
 *   ② 底栏不要「设为当前选手」（小组加分没有排位选手这个概念），改成「再抽一次 / 关闭」，
 *      结果卡多显示「第 N 组」，抽到人之后老师立刻知道该给哪一组加分。
 *
 * 对外接口（app.js 只调这两个）：
 *   JFDrawPerson.open()  —— 打开抽人窗口（自己读当前班级和名单）
 *   JFDrawPerson.ready  —— 名单依赖 app.js 的状态，未就绪时 open() 只提示不动
 * 数据源由 app.js 通过 JFDrawPerson.bind({ classes, rosterOf, curClass }) 注入，
 * 这样本文件不碰 S 这个全局私有对象，两边耦合只在一个函数签名上。
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* app.js 注入的数据源。没注入就什么都不做（open() 会提示未就绪） */
  var SRC = null;

  /* 抽人状态机：idle → preparing → shaking → opening → revealing → result（异常时 error，按钮变「重试」）
     last 防着连抽同一个人；pool 是当前班的名单快照。
     gen 是一轮「打开窗口」的代数：每次 open() 都 +1，正在演的状态机发现代数变了就立刻停手。
     接线仿真那边窗口只是 display:none 藏起来、DOM 一直在，所以不需要这个；
     小组加分用的是 <dialog>，关掉再打开会整块重画，老状态机若还活着会把新舞台覆盖成上一轮的残留
     （实测：切班后一直停在 result、底栏卡在「抽取中…」），必须靠代数把它掐掉。 */
  var DRW = { cls: null, picked: null, busy: false, phase: 'idle', pool: [], box: null, last: null, gen: 0 };
  var DRW_CLS_KEY = 'jfdt-draw-cls'; // 记住选的班，下次打开不用重选（一次课一个班）

  function classes() { return (SRC && SRC.classes && SRC.classes()) || []; }
  function rosterOf(cls) { return (SRC && SRC.rosterOf && SRC.rosterOf(cls)) || []; }
  function curClassNow() { return (SRC && SRC.curClass && SRC.curClass()) || classes()[0] || null; }

  /* 选哪个班：localStorage 上次选过的（失效就回落）→ 当前正在看的班 → 第一个班 */
  function pickCls() {
    var list = classes();
    if (!list.length) return null;
    var ok = function (id) {
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i].id;
      return null;
    };
    var mem = null;
    try { mem = ok(localStorage.getItem(DRW_CLS_KEY)); } catch (e) { }
    var cur = curClassNow();
    return ok(mem) || ok(cur && cur.id) || list[0].id;
  }

  function drwCls() {
    var list = classes();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(DRW.cls)) return list[i];
    return list[0] || null;
  }

  /* 当前班的名单快照：小组加分的 roster 条目是 { name, sid, no }，
     统一映射成抽人模块认的 { id, name, seq, cls }（seq = 班内序号，没有就不显示学号） */
  function drwPool() {
    var c = drwCls(); if (!c) return [];
    return rosterOf(c).filter(function (r) {
      return r && r.name;
    }).map(function (r) {
      return {
        id: r.sid || r.id || r.name,
        name: r.name,
        seq: (r.no == null ? null : r.no),
        cls: c.name,
        group: groupLabel(c, r)
      };
    });
  }

  /* 这个人在当前班分到第几组（没分组就返回空串）。抽到人之后老师要立刻知道给哪一组加分，
     所以结果卡和底栏都带上组号。members 里按 sid 优先、名字兜底匹配。 */
  function groupLabel(cls, r) {
    var gs = (cls && cls.groups) || [];
    for (var i = 0; i < gs.length; i++) {
      var ms = gs[i].members || [];
      for (var j = 0; j < ms.length; j++) {
        var m = ms[j];
        if (!m || !m.name) continue;
        if (r.sid && m.sid && String(m.sid) === String(r.sid)) return '第 ' + gs[i].no + ' 组';
        if (!r.sid && m.name === r.name) return '第 ' + gs[i].no + ' 组';
      }
    }
    return '';
  }

  function subLine(p) {
    var bits = [];
    if (p.group) bits.push(p.group);
    if (p.seq != null && p.seq !== '') bits.push('班内序号 ' + p.seq);
    return bits.join(' · ');
  }

  function drwFootHTML() {
    var p = DRW.picked;
    if (!p) return '<span class="drw-hint">点上面「开始抽人」，卡包开启翻出本轮抽中的同学（一次抽一个）。</span>';
    var sub = subLine(p);
    return '<div class="drw-res"><b>抽中 <em>' + esc(p.name) + '</em></b><span>' + esc(sub || p.cls || '') + '</span></div>' +
      '<button class="btn primary" id="drwAgain">再抽一次</button>' +
      '<button class="btn ghost" id="drwClose">关闭</button>';
  }

  function drwRender(box) {
    DRW.box = box; DRW.pool = drwPool();
    var list = classes();
    var cur = drwCls();
    var cnt = function (c) { return rosterOf(c).filter(function (r) { return r && r.name; }).length; };
    /* 只有一个班就不摆 tabs（一次课就一个班），直接把班名和人数写在顶上；
       有多个班才摆 tab 供切换 —— 不管几个班都不会出现「全部班级」这种混抽选项。 */
    var bar = list.length > 1
      ? '<div class="drw-tabs">' + list.map(function (c) {
          return '<button type="button" data-c="' + esc(c.id) + '"' + (String(c.id) === String(DRW.cls) ? ' class="on"' : '') + '>' +
            esc(c.name) + '<em>' + cnt(c) + '</em></button>';
        }).join('') + '</div>'
      : '<div class="drw-clsname">' + esc(cur ? cur.name : '') + ' · ' + cnt(cur || {}) + ' 人</div>';

    box.innerHTML = '<div class="drw-bar">' + bar +
        '<button type="button" class="drw-go" id="drwGo">' + (DRW.picked ? '继续抽取' : '开始抽人') + '</button>' +
      '</div>' +
      '<div class="drw-stage" id="drwStage" data-phase="' + (DRW.phase === 'result' ? 'result' : 'idle') + '" role="region" aria-label="抽人舞台">' +
        '<div class="drw-scene">' +
          '<i class="drw-halo"></i>' +
          '<div class="drw-pack" id="drwPack" title="点卡包也能抽">' +
            '<i class="drw-lyr l1"></i><i class="drw-lyr l2"></i>' +
            '<div class="drw-half top"><div class="drw-skin"><span class="drw-pname">随机抽人</span><i class="drw-seal">抽</i></div></div>' +
            '<div class="drw-half bot"><div class="drw-skin"><span class="drw-pname">随机抽人</span><i class="drw-seal">抽</i></div></div>' +
            '<i class="drw-pt"></i><i class="drw-pt"></i><i class="drw-pt"></i><i class="drw-pt"></i><i class="drw-pt"></i><i class="drw-pt"></i>' +
          '</div>' +
          '<i class="drw-flash"></i>' +
          '<div class="drw-cards" id="drwCards"></div>' +
        '</div>' +
        '<p class="drw-live" id="drwLive" role="status" aria-live="polite"></p>' +
      '</div>' +
      '<div class="drw-foot" id="drwFoot">' + drwFootHTML() + '</div>';

    box.querySelectorAll('[data-c]').forEach(function (b) {
      b.onclick = function () {
        if (DRW.busy) return; // 抽着的时候不许换班：换班会重画卡包，动画会被打断
        drwSwitch(b.getAttribute('data-c'), box);
      };
    });
    var go = box.querySelector('#drwGo'); if (go) go.onclick = function () { drwRoll(box); };
    var pack = box.querySelector('#drwPack'); if (pack) pack.onclick = function () { drwRoll(box); }; // 点卡包也能抽
    drwBindFoot(box);
  }

  /* 切班：换班等于换这节课的班，名字和名单全部重来。
     注意也把 busy 归零：动画正演到一半时如果状态机已经把 busy 挂了，换班重画之后
     新的舞台是全新的，不该带着旧的锁（否则点「开始抽人」没反应） */
  function drwSwitch(id, box) {
    var list = classes(), hit = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) hit = list[i];
    if (!hit) return;
    DRW.cls = hit.id; DRW.picked = null; DRW.last = null; DRW.phase = 'idle';
    DRW.busy = false;
    try { localStorage.setItem(DRW_CLS_KEY, String(hit.id)); } catch (e) { }
    drwSub();
    drwRender(box);
  }

  /* 弹窗标题栏的副标题跟着当前班走 */
  function drwSub() {
    var c = drwCls(), d = document.getElementById('dlgDraw');
    var small = d && d.querySelector('.dlg-head small');
    if (small) small.textContent = c ? (c.name + ' · 一次抽一个') : '随机抽人 · 一次抽一个';
  }

  /* 状态机推进：改 DRW.phase + 舞台的 data-phase（CSS 动画全挂在 data-phase 上） */
  function drwPhase(box, p) {
    DRW.phase = p;
    var s = box.querySelector('#drwStage'); if (s) s.setAttribute('data-phase', p);
  }
  /* 按钮文案跟随状态机：开始抽人 → 抽取中…（禁用）→ 继续抽取 → 重试 */
  function drwGo(box, label, dis) {
    var g = box.querySelector('#drwGo'); if (g) { g.textContent = label; g.disabled = !!dis; }
  }
  /* 结果卡：姓名最大字号、组号次级、「本轮抽中」标签 */
  function drwCards(box, list) {
    var wrap = box.querySelector('#drwCards'); if (!wrap) return;
    wrap.innerHTML = list.map(function (p, i) {
      return '<div class="drw-card" style="animation-delay:' + (i * .22) + 's">' +
        '<div class="drw-cardin" style="transition-delay:' + (i * .18) + 's">' +
          '<div class="drw-cback"></div>' +
          '<div class="drw-cface"><em>本轮抽中</em><b>' + esc(p.name) + '</b><span>' + esc(subLine(p) || p.cls || '') + '</span></div>' +
        '</div></div>';
    }).join('');
  }
  function drwBindFoot(box) {
    var a = box.querySelector('#drwAgain'), c = box.querySelector('#drwClose');
    if (a) a.onclick = function () { drwRoll(box); };
    if (c) c.onclick = function () { closeDlg(); };
  }
  function closeDlg() {
    var d = document.getElementById('dlgDraw');
    if (d && typeof d.close === 'function') d.close();
  }

  var drwSleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  /* 关掉动画偏好 / 低端设备（hx-theme 的 is-lite）走 fast 路径，直接出结果 */
  function drwNoAnim() {
    var lite = document.documentElement.classList.contains('is-lite');
    var rm = false;
    try { rm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
    return lite || rm;
  }

  /* ── 一轮抽取：结果先算好，再按状态机把动画演完 ──
     时序：preparing 0.48s → shaking 0.88s → opening 0.7s → revealing 0.88s → result，全程约 3 秒 */
  function drwRoll(box) {
    if (DRW.busy) return; // 状态机没走完之前，按钮/卡包/连点全部进不来
    if (!box || !box.isConnected) return;
    var pool = DRW.pool.length ? DRW.pool : (DRW.pool = drwPool());
    var n = pool.length;
    if (!n) { toast('这个班还没有学生：先在「待分配名单」里导入全班名单'); return; }
    /* 一次只抽一个；连着点「再抽一次」不许还是刚才那个人（只有 1 个人的班除外） */
    var idx = Math.random() * n | 0;
    if (n > 1 && DRW.last != null && pool[idx].id === DRW.last) idx = (idx + 1 + (Math.random() * (n - 1) | 0)) % n;
    var win = pool[idx];
    var gen = DRW.gen;  // 记住本轮属于哪一代窗口：窗口被关掉重开（gen 变了）就立刻停手

    DRW.busy = true; DRW.picked = null;
    var wrap = box.querySelector('#drwCards'); if (wrap) wrap.innerHTML = ''; // 上一轮的卡收走，卡包在 preparing 里重新合体

    drwPhase(box, 'preparing'); drwGo(box, '抽取中…', true);
    var foot = box.querySelector('#drwFoot'); if (foot) foot.innerHTML = '<span class="drw-hint">抽取中…</span>';

    /* 还能继续演吗：窗口没关、也没被 open() 换代（关掉重开） */
    function alive() { return box.isConnected && DRW.gen === gen; }

    /* 降级（is-lite / 关动画偏好）：不演过程，卡片直接亮出结果。
       正常：卡包蓄势 → 蓄力抖动（幅度渐增）→ 上下分离+强光+卡片飞出 → 翻面揭示 */
    var play;
    if (drwNoAnim()) {
      drwPhase(box, 'opening'); drwCards(box, [win]);
      play = Promise.resolve();
    } else {
      play = drwSleep(480)
        .then(function () {
          if (!alive()) throw 0;         // 等待期间窗口被关了/换了：走 error 兜底，不继续演
          drwPhase(box, 'shaking'); return drwSleep(880);
        })
        .then(function () {
          if (!alive()) throw 0;
          drwPhase(box, 'opening'); drwCards(box, [win]); return drwSleep(700);
        })
        .then(function () {
          if (!alive()) throw 0;
          drwPhase(box, 'revealing'); return drwSleep(880);
        });
    }

    return play.then(function () {
        if (!alive()) throw 0;
        drwPhase(box, 'result');
        DRW.picked = win; DRW.last = win.id;
        var live = box.querySelector('#drwLive');
        if (live) live.textContent = '抽中：' + win.name + '（' + (subLine(win) || win.cls || '') + '）';
        drwGo(box, '继续抽取', false);
        if (foot) { foot.innerHTML = drwFootHTML(); drwBindFoot(box); }
      }).catch(function () {
        /* 被打断就走 error 兜底，让老师点「重试」。但如果整代窗口已经换了（关掉重开），
           新的那只卡包是全新的 idle 状态，不能把它的按钮改成「重试」 */
        DRW.phase = 'error';
        if (alive()) {
          drwGo(box, '重试', false);
          var f = box.querySelector('#drwFoot');
          if (f) f.innerHTML = '<span class="drw-hint">刚才被打断了，点「重试」再来一次。</span>';
        }
      }).then(function () {
        /* busy 只在同一代里解锁：换代之后新一轮 open() 已经把 busy 归零了，
           这里再动一下会把新窗口的抽取锁解掉（连点就会重复抽） */
        if (DRW.gen === gen) DRW.busy = false;
      });
  }

  /* 轻提示：小组加分顶栏的 #saveState 就是提示条，直接复用它，别另造一个 */
  function toast(msg) {
    if (SRC && SRC.toast) { SRC.toast(msg); return; }
    var el = document.getElementById('saveState');
    if (el) el.textContent = msg;
  }

  /* ── 打开抽人窗口 ── */
  function open() {
    if (!SRC) return toast('抽人还没准备好，请刷新页面重试');
    var list = classes();
    if (!list.length) return toast('还没有班级：先在「数据与备份」里导入班级和名单');

    DRW.cls = pickCls();
    /* 换代：上一次打开时还没演完的状态机（窗口被关掉、动画还在 setTimeout 里等）
       靠这个代数认出自己已经过期，不会再往新舞台上写东西 */
    DRW.gen += 1;
    DRW.picked = null; DRW.busy = false; DRW.last = null; DRW.phase = 'idle';

    var d = document.getElementById('dlgDraw');
    if (!d) return toast('抽人窗口没加载出来，请刷新页面');
    var c0 = drwCls();
    var small = d.querySelector('.dlg-head small');
    if (small) small.textContent = c0 ? (c0.name + ' · 一次抽一个') : '随机抽人 · 一次抽一个';

    var box = d.querySelector('#drw');
    if (box) drwRender(box);
    if (typeof d.showModal === 'function') {
      if (!d.open) d.showModal();
    } else {
      d.setAttribute('open', '');
    }
  }

  function bind(src) {
    SRC = src || null;
  }

  window.JFDrawPerson = { open: open, bind: bind, ready: function () { return !!SRC; } };

  /* ── 接线 ──
     app.js 在自身脚本末尾已经把数据源挂到 window.JFDT_DRAW_SRC（本文件在它后面加载），
     所以这里直接取；万一以后加载顺序变了，点按钮时会再取一次兜底。 */
  function autoBind() {
    if (!SRC && window.JFDT_DRAW_SRC) bind(window.JFDT_DRAW_SRC);
    return SRC;
  }
  autoBind();

  var entry = document.getElementById('btnDrawPerson');
  if (entry) entry.addEventListener('click', function () { autoBind(); open(); });

  var closeBtn = document.getElementById('btnDrawClose');
  if (closeBtn) closeBtn.addEventListener('click', function () { closeDlg(); });
})();
