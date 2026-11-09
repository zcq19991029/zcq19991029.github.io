/* 超级排位 · 摆放 + 连线（第十二批 T1～T4 / Q1～Q6；P4 连线阶段）
   ─────────────────────────────────────────────────────────────────────────────
   第一步「摆放」：点左缘竖条打开**悬浮元器件库**（fixed 抽屉，不占布局宽度），拖元件进画布 →
   点「我摆好了」按【种类 + 个数】判对（位置不算，放哪都行）→ 摆对了给一次「元件摆放完成，可以开始连线」，按钮变「开始连线」。
   第二步「连线」（交互与练习页 practice.js 同一套手感，2026-11-09 按用户要求对齐）：
   点一个端子选中（或直接按住拖过去，线缆跟手、松手磁吸附上）→ 再点另一个端子连一根线；
   点已画的线 = **选中**（出白色编辑手柄，拖横线段上下移、竖线段左右移、方块挪拐点），删除走工具栏「删除」；
   工具圆盘 + 展开工具栏常驻（提示 / 检查 / 答案三颗在排位里不建，查错只报红不报绿）；
   「检查」只说还差多少（Q2：不报网名、不报端子名、不指哪根线错）。

   题目清单（2026-11-08 改成「8 条都能玩 + P 只练摆放」）：
     · 元器件 / 电路构成 / 摆放判对 = src/super-data.js 的 SUPER_PARTS / SUPER_CIRCUITS / SUPER.check
     · 标准网表（判连线）= src/super-nets.js 的 SUPER_NETS；有网表的是 2.1~2.6、E1、E2 共 8 条，
       P（并联专项）没有单一标准答案 → 只练摆放，按钮标「暂不判连线」
     · 每道题要摆什么、各几个**一律取 SUPER_CIRCUITS[id].parts**，页面不再手写 need
     · 库里的卡片 = **按题过滤**（2026-11-09 起，见 §8）：只上架这道题 planOf() 真正要的外形，
       红色停止按钮（SBr / SBQr）随绿帽版一起上架；KINDS 仍是 12 种器件 23 种外形的全量定义。
       挑错形态（比如 2.3 把单触点按钮当复合按钮）由摆放校验说清楚，数错个数也拦得住。

   连线阶段用到的外部模块（都当「可能不存在」处理，缺了就退化成只摆放）：
     · window.SUPER_WIRE（src/super-wire.js）—— 连线模型 addWire/removeWire/termUse/netsOf + judge
     · window.SUPER_NETS[题号]（src/super-nets.js）—— 完整标准网表（judge 的 {nets}）
     · window.SUPER_ALIAS（src/super-alias.js，另一路同事维护）—— 同型号多实例的置换判对
       约定 API：SUPER_ALIAS.judgePlaced(wires, circuitId, insts, circuit)
     ★ 为什么要 ALIAS：学生摆了 4 只单极熔断器，实例名是 FU1～FU4；
       而标准网表里 FU1 是「三极那一只」（t0..t2），FU2 是「控制回路那只」（t/b）。
       名字天然对不上，要靠置换把实例映到教材代号上。没有 ALIAS 时只用 SUPER_WIRE.judge 兜底，
       能给出「还差几个点」，判不到「对」——这是预期行为，不是 bug。
     ★ 实例现在带 form 了（2026-11-08）：复合按钮 'QUAD'、KT '4'/'2ROW'、VD 'V2' …
       SUPER_ALIAS 按 inst.form 决定这只元件有哪些端子；不传 form 会按该类型所有形态的**并集**
       算端子（复合按钮会被当成同时有 i/o 和 ci/co/ai/ao），判对可能出怪结果。
       所以 judgeNow 里用 aliasInsts() 把 {type: KINDS.key, dev, form} 显式映射成
       {name, type: dev, form} 再交给它。

   ★ 坐标口径（和摆放阶段完全一致，没改语义）★
     - 元件实例 = { id, type, dev, form, x, y, label, name }：
         type = KINDS 的 key（画法 / 包围盒 / 端子按它查）
         dev  = 器件类型（'SB'）—— 摆放判对、实例代号（SB1/SB2）按它数
         form = 外形名（'QUAD' / 'V2' / …，默认外形为 null）
       x/y 是「元件原点」的画布坐标 = SUPER_PARTS 里那个外框的左上角；
     - 端子绝对坐标 = 实例原点 + 该种类 KINDS[type].pins() 里的相对偏移 × PS；
       pins() 全部由 SUPER_PARTS[dev].terms 生成，一个数字都不手抄；
     - 画布坐标 = CSS px（1:1），所以「屏幕上 10px」就等于「画布上 10px」，命中半径直接写数字。
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ═══════════════ 0. 主题：和练习页同一张表、同一个 localStorage 键 ═══════════════
     用户判罚第三条「背景不受主题控制，完全是单独跳出工具控制的行为」。根因是这一页原来自己
     维护了一套深色（super.html 的 :root 写死 #03050b / #121a2e …，super.js 里又写死十几处 hex），
     从来不读 theme.js。现在：
       · 启动时读 zfz-practice-theme（练习页写进去的那一个键），调同一个 applyTheme()；
       · 把 TH / C 的令牌写进 :root 变量，super.html 的 CSS 只认变量（:root 里那套只是兜底默认值）；
       · 别的标签页换了主题（练习页右上角那个开关），storage 事件里再同步一次，两页一起变。
     ───────────────────────────────────────────────────────────────────────── */
  function syncCss() {
    const r = document.documentElement.style;
    const set = (k, v) => { if (v) r.setProperty(k, v); };
    set('--bg', TH.bg); set('--card', TH.cardTop); set('--ink', C.ink); set('--dim', C.dim);
    set('--edge', TH.edge); set('--acc', TH.acc); set('--acc2', TH.acc2); set('--ok', C.ok); set('--bad', C.bad);
    set('--tbbg', TH.cardTop); set('--tbbg2', TH.cardBot); set('--tbhov', TH.btnHov); set('--tbsh', TH.shadow);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m && TH.bg) m.setAttribute('content', TH.bg);
  }
  function loadTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { }
    applyTheme(saved || 'dark');
    syncCss();
  }
  loadTheme();
  window.addEventListener('storage', e => {
    if (!e || e.key !== THEME_KEY) return;
    applyTheme(e.newValue || 'dark');
    syncCss();
    if (cv) { makeThumbs(); buildLib(); }   // 缩略图是画出来的，换主题要重画一遍
    need();
  });

  /* ═══════════════ 1. 数据：题目清单 ═══════════════ */
  /* ★ 为什么这些不是 const 一次读完：super-data.js 是 super.js **运行时**才注入的
       （见文件末尾的 loadData：动态 <script src="super-data.js">），
       所以 SUPER_PARTS / SUPER_CIRCUITS 只能在 boot() 里读，模块初始化时它们还不存在。 */
  let SP = null;                                  // 元件类型表（super-data.js）
  let CIRC = null;                                // 每题要哪些元件、各几个（super-data.js）
  let NETS_ALL = {};                              // 标准网表（super-nets.js），P 没有
  const TASK_ORDER = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', 'E1', 'E2', 'P'];
  // 下拉里用的短名（教材上的电路全名太长，手机上放不下；顶栏徽章仍然显示全名）
  const TASK_SHORT = {
    '2.1': '单向起动', '2.2': '电气互锁正反转', '2.3': '双重互锁正反转',
    '2.4': '按钮星-三角', '2.5': '时间继电器星-三角', '2.6': '按钮双速',
    'E1': '能耗制动', 'E2': 'C6140T 车床', 'P': '并联专项'
  };
  // super-data.js 没加载时的兜底：只留 2.2 一条（和旧版一样），页面会提示「数据没取到」
  const INLINE_TASKS = {
    '2.2': {
      id: '2.2', name: '电气互锁正反转',
      title: '2.2　电气互锁正反转', sch: '2.2 三相异步电动机 电气互锁正反转',
      parts: { QF: 1, FU: 4, FR: 1, KM: 2, SB: 3 }
    }
  };
  function buildTasks() {
    const src = (CIRC && Object.keys(CIRC).length) ? CIRC : INLINE_TASKS;
    const out = {};
    // TASK_ORDER 先排一遍（教材顺序），再补 SUPER_CIRCUITS 里以后新增的题
    TASK_ORDER.concat(Object.keys(src)).forEach(id => {
      if (out[id] || !src[id]) return;
      const c = src[id];
      const parts = c.parts || (INLINE_TASKS[id] && INLINE_TASKS[id].parts) || {};
      out[id] = {
        id: id,
        name: c.name || id,
        short: TASK_SHORT[id] || c.name || id,
        title: id + '　' + (c.name || ''),
        sch: id + '　' + (c.name || ''),
        parts: Object.assign({}, parts)
      };
    });
    return out;
  }
  const DATA = { task: '2.2', tasks: {} };
  let TASK = null;                                // 当前题（DATA.tasks[DATA.task]）
  let NETS = null;                                // 当前题的标准网表（切换题目时跟着换）
  const canJudge = () => !!NETS_ALL[DATA.task];   // 这道题能不能判连线（P 不能）
  function readData() {
    SP = window.SUPER_PARTS || null;
    CIRC = window.SUPER_CIRCUITS || null;
    NETS_ALL = window.SUPER_NETS || {};
    DATA.tasks = buildTasks();
    // 老版本允许外部挂 window.SUPER_DATA.tasks / .task 覆盖（现在没人挂，留着不碍事）
    if (window.SUPER_DATA && typeof window.SUPER_DATA === 'object') {
      if (window.SUPER_DATA.tasks && typeof window.SUPER_DATA.tasks === 'object') {
        Object.keys(window.SUPER_DATA.tasks).forEach(id => {
          const t = window.SUPER_DATA.tasks[id];
          if (!DATA.tasks[id]) DATA.tasks[id] = { id: id, name: id, title: id, sch: id, parts: {} };
          if (t && t.parts) DATA.tasks[id].parts = Object.assign({}, t.parts);
          if (t && t.title) DATA.tasks[id].title = t.title;
          if (t && t.sch) DATA.tasks[id].sch = t.sch;
        });
      }
      if (typeof window.SUPER_DATA.task === 'string' && DATA.tasks[window.SUPER_DATA.task]) DATA.task = window.SUPER_DATA.task;
    }
    if (!DATA.tasks[DATA.task]) DATA.task = Object.keys(DATA.tasks)[0] || '2.2';
    TASK = DATA.tasks[DATA.task];
    NETS = NETS_ALL[DATA.task] || null;
    // 端子偏移统一从 super-data.js 生成（见 §2 开头第 ★ 条）—— 必须等 super-data.js 到位
    Object.keys(KINDS).forEach(k => { KINDS[k].pins = pinsFrom(KINDS[k].dev, KINDS[k].form); });
  }

  /* ═══════════════ 2. 元件种类：画法 + 包围盒 + 端子相对偏移 ═══════════════
     ★ 2026-11-08 最重要的一条改动：**端子偏移不再手抄，一律从 SUPER_PARTS[dev].terms 生成**。
       端子字符串是判对的唯一钥匙（super-alias.js 也是从 SUPER_PARTS[type].terms 取端子名），
       画的位置和表里的 dx/dy 差 1 个像素，id 也许还对得上、但点不中 / 画错位，很难查。
       所以每种元件的 pins() 都是 pinsFrom(dev, form)，一个数字都不抄。
     ★ 坐标口径（和 SUPER_PARTS 完全一致）：元件原点 inst.x/inst.y = SUPER_PARTS 里那个外框的
       **左上角**，所以 pins() 里的偏移就是 terms 的 dx/dy 原值，不需要任何平移。
       parts.js 里那些「第一个参数是中心 x」的函数（partFuse / partButton）在 draw 里自己补半个宽度。
     ★ 同一器件的不同外形各占一个 KINDS 条目，用 dev / form 两个字段挂回同一个器件：
         inst.type = KINDS 的 key（画法 / 包围盒 / 端子都按它查）
         inst.dev  = 器件类型（'SB'、'KM'…）——摆放判对、实例代号（SB1/SB2）按它数
         inst.form = 外形名（'QUAD' / 'V2' / '2ROW' …）——SUPER_ALIAS 按它决定这只元件有哪些端子
       code = 原理图代号前缀（编实例名用，取 SUPER_PARTS[dev].code）
       unit = 提示里用的说法（「还差 1 个交流接触器」）
       box  = 画出来的范围（相对元件原点，含元件名那行字，别裁到） */

  // ── 拿 super-data.js 的端子表：给了 form 就用那一档，否则默认外形 ──
  function termsOf(dev, form) {
    const p = SP && SP[dev];
    if (!p) return [];
    if (form && p.forms && p.forms[form] && p.forms[form].terms) return p.forms[form].terms;
    return p.terms || [];
  }
  // 端子名 → [dx,dy]（相对外框左上角，和 SUPER_PARTS 逐字一致）
  function termXY(dev, form) {
    const m = {};
    termsOf(dev, form).forEach(t => { m[t.id] = [t.dx, t.dy]; });
    return m;
  }
  // 元件外框尺寸（super-data.js 的 size）：走线时判断端子长在哪条边上（上/下/左/右）
  function sizeOf(dev, form) {
    const p = SP && SP[dev]; if (!p) return null;
    if (form && p.forms && p.forms[form] && p.forms[form].size) return p.forms[form].size;
    return p.size || null;
  }
  const pinsFrom = (dev, form) => () => termXY(dev, form);

  /* ★ 元件外形一律调「原代码」，这里不再仿画一只。
       能用 parts.js 现成函数的（QF / 熔断器 / 热继电器 / 接触器 / 按钮 / 端子排）直接调；
       剩下的（KT 三种、接线盒三种、R / VD / SQ / TC / QF2、接触器的辅助触头）在 devices.js 里，
       那是从 circuit24 / 25 / 26 / E1 / E2 的 drawExtra 原样搬过去的一份代码 —— 练习页也调它。
       所以「超级排位里的元件」和「练习页上的元件」是同一段代码画出来的，不存在第二套形状和配色。 */
  const M6_NAMES = ['U1', 'V1', 'W1', 'W2', 'U2', 'V2'];      // 2.4/2.5 接线盒（TP 顺序）
  const M6B_NAMES = ['U1', 'V1', 'W1', 'U2', 'V2', 'W2'];     // 2.6 双速接线盒
  const KINDS = {
    /* ---- QF 低压断路器：三相四线 3P+N，partQF 的 x,y 就是外框左上角 ---- */
    QF: {
      dev: 'QF', form: '', code: 'QF', unit: '低压断路器',
      box: { x: -8, y: -34, w: 256, h: 190 },
      draw: () => partQF(0, 0, false, false)
    },
    /* ---- QF 三极空开（E2 的 QF2）---- */
    QF3P: {
      dev: 'QF', form: '3P', code: 'QF', unit: '低压断路器',
      box: { x: -6, y: -6, w: 204, h: 168 },
      draw: lab => DEV.qf3(0, 0, KINDS.QF3P.pins(), false, lab)
    },
    /* ---- FU 熔断器（单极，一进一出）：partFuse 的第一个参数是中心 x，外框宽 46 → +23 ---- */
    FU: {
      dev: 'FU', form: '', code: 'FU', unit: '熔断器',
      box: { x: -3, y: -4, w: 52, h: 176 },
      draw: lab => partFuse(23, 0, lab)
    },
    /* ---- FR 热继电器：partFR 的 x,y 是外框左上角 ---- */
    FR: {
      dev: 'FR', form: '', code: 'FR', unit: '热继电器',
      box: { x: -6, y: -4, w: 268, h: 140 },
      draw: () => partFR(0, 0, false, false)
    },
    /* ---- KM 交流接触器（上 6 下 6，共 12 端子）---- */
    KM: {
      dev: 'KM', form: '', code: 'KM', unit: '交流接触器',
      box: { x: -6, y: -4, w: 268, h: 194 },
      draw: lab => partKM(0, 0, 0, lab, false)
    },
    /* ---- KM + 右侧辅助常闭 21/22（E1 的 KM1、KM2）---- */
    KMAUX: {
      dev: 'KM', form: 'aux', code: 'KM', unit: '交流接触器',
      box: { x: -6, y: -6, w: 296, h: 198 },
      draw: lab => {
        partKM(0, 0, 0, lab, false);
        const p = KINDS.KMAUX.pins();
        DEV.kmaux(248, -2, { t6: p.t6, b6: p.b6 });
      }
    },
    /* ---- KM + 下方第三排辅助触头（E2 的 KM1 常开 43/44、KM4 常闭 31/32）---- */
    KMAUXB: {
      dev: 'KM', form: 'auxBelow', code: 'KM', unit: '交流接触器',
      box: { x: -6, y: -6, w: 268, h: 410 },
      draw: lab => {
        partKM(0, 0, 0, lab, false);
        const p = KINDS.KMAUXB.pins();
        // 触点号的颜色由 devices.js 给默认值（常开绿 / 常闭橙），和 E2 练习页那一只同一个色
        DEV.kmauxb(0, 262, { t6: p.t6, b6: p.b6 }, 'NO', '43', '44', null, '辅助');
      }
    },
    /* ---- SBr 停止按钮（红色帽、单触点 i/o、常闭）：端子和 SB 完全一样，只是帽色红 ----
       ★ 定义在 SB **前面**：KIND_BY[dev+'|'+form] 后写的会覆盖先写的，
         让 SB 留作 (SB, 默认外形) 的「正主」，SBr 只是同一器件换了个帽色；
         摆放判对按端子集签名（sigOf），红绿两卡签名相同、随便摆哪个都算对。 */
    SBr: {
      dev: 'SB', form: '', code: 'SB', unit: '按钮',
      box: { x: -10, y: -32, w: 116, h: 176 },
      draw: lab => partButton(48, 0, DEV.CAP_RED, false, lab)     // 帽色照 board.js 的 BTN（红=停止）
    },
    /* ---- SB 按钮（单触点 i/o）：partButton 的第一个参数是中心 x，外框宽 96 → +48 ---- */
    SB: {
      dev: 'SB', form: '', code: 'SB', unit: '按钮',
      box: { x: -10, y: -32, w: 116, h: 176 },
      draw: lab => partButton(48, 0, DEV.CAP_GREEN, false, lab)   // 帽色照 board.js 的 BTN（绿=起动）
    },
    /* ---- SBQr 停止用复合按钮（红色帽、QUAD 四端子）：E1 的 SB1 就是红帽复合 ----
       定义在 SBQ 前面，理由同 SBr（kindOf 的正主留 SBQ）。 */
    SBQr: {
      dev: 'SB', form: 'QUAD', code: 'SB', unit: '复合按钮',
      box: { x: -12, y: -32, w: 144, h: 190 },
      draw: lab => partButton(60, 0, DEV.CAP_RED, false, lab, null, false, true)
    },
    /* ---- SBQ 复合按钮（常闭 ci/co + 常开 ai/ao 机械联动）：quad=true，外框宽 120 → +60 ---- */
    SBQ: {
      dev: 'SB', form: 'QUAD', code: 'SB', unit: '复合按钮',
      box: { x: -12, y: -32, w: 144, h: 190 },
      draw: lab => partButton(60, 0, DEV.CAP_GREEN, false, lab, null, false, true)
    },
    /* ---- M 电动机接线盒（2.4 / 2.5：6 个出线端，拆了连接片）---- */
    M: {
      dev: 'M', form: '', code: 'M', unit: '电动机',
      box: { x: -6, y: -6, w: 352, h: 112 },
      draw: lab => DEV.m6(0, 0, KINDS.M.pins(), M6_NAMES, { label: '接线盒 6 端（已拆连接片）' })
    },
    /* ---- M 双速电动机接线盒（2.6，间距 38，端子名顺序 U1 V1 W1 U2 V2 W2）---- */
    MBOX6B: {
      dev: 'M', form: 'BOX6B', code: 'M', unit: '电动机',
      box: { x: -6, y: -6, w: 260, h: 112 },
      draw: lab => DEV.m6b(0, 0, KINDS.MBOX6B.pins(), M6B_NAMES, { label: '双速接线盒' })
    },
    /* ---- M 三端子接线盒（E2 的 M1/M2/M3）---- */
    MBOX3: {
      dev: 'M', form: 'BOX3', code: 'M', unit: '电动机',
      box: { x: -6, y: -6, w: 232, h: 152 },
      draw: lab => DEV.m3(0, 0, KINDS.MBOX3.pins(), lab, '电动机', false, '停止', 0)
    },
    /* ---- KT 时间继电器（2.5：通电延时，一排 6 个端子）---- */
    KT: {
      dev: 'KT', form: '', code: 'KT', unit: '时间继电器',
      box: { x: -6, y: -6, w: 160, h: 194 },
      draw: lab => DEV.kt6(0, 0, KINDS.KT.pins(), { delay: 3 }, lab)
    },
    /* ---- KT 通电延时（E1：只用到延时断开 + 线圈，4 个端子）---- */
    KT4: {
      dev: 'KT', form: '4', code: 'KT', unit: '时间继电器',
      box: { x: -6, y: -6, w: 162, h: 186 },
      draw: lab => DEV.kt4(0, 0, KINDS.KT4.pins(), { delay: 3 }, lab)
    },
    /* ---- KT 断电延时（E2：上下两排 6 个端子）---- */
    KT2R: {
      dev: 'KT', form: '2ROW', code: 'KT', unit: '时间继电器',
      box: { x: -6, y: -6, w: 216, h: 166 },
      draw: lab => DEV.kt2r(0, 0, KINDS.KT2R.pins(), { delay: 3 }, lab)
    },
    /* ---- SQ 位置开关（一对常闭 + 一对常开）---- */
    SQ: {
      dev: 'SQ', form: '', code: 'SQ', unit: '位置开关',
      box: { x: -6, y: -6, w: 144, h: 166 },
      draw: lab => DEV.sq(0, 0, KINDS.SQ.pins(), false, lab)
    },
    /* ---- TC 控制变压器（原边 380 V 两端、副边 127 V 两端）---- */
    TC: {
      dev: 'TC', form: '', code: 'TC', unit: '控制变压器',
      box: { x: -6, y: -6, w: 158, h: 164 },
      draw: lab => DEV.tc(0, 0, KINDS.TC.pins(), false, lab)
    },
    /* ---- R 制动电阻（E1：左右各一个端子）---- */
    R: {
      dev: 'R', form: '', code: 'R', unit: '制动电阻',
      box: { x: -6, y: -6, w: 160, h: 84 },
      draw: lab => DEV.r(0, 0, KINDS.R.pins(), lab)
    },
    /* ---- VD 整流二极管（E1 横放：左阳右阴）---- */
    VD: {
      dev: 'VD', form: '', code: 'VD', unit: '整流二极管',
      box: { x: -6, y: -6, w: 160, h: 84 },
      draw: lab => DEV.vd(0, 0, KINDS.VD.pins(), lab)
    },
    /* ---- VD 竖放（E2：上阳下阴）---- */
    VDV2: {
      dev: 'VD', form: 'V2', code: 'VD', unit: '整流二极管',
      box: { x: -6, y: -6, w: 62, h: 166 },
      draw: lab => DEV.vd2(0, 0, KINDS.VDV2.pins(), lab)
    },
    /* ---- XT 端子排（并联专项的 N 那一格，一格两螺丝）：parts.XT 只有 t/b 两个端子 ---- */
    XT: {
      dev: 'XT', form: '', code: 'XT', unit: '端子排',
      box: { x: -42, y: -6, w: 100, h: 102 },
      draw: () => partXT(0, 0, ['N'])
    }
  };
  // 画的时候把实例名（KM1 / FU3…）写在元件自己的铭牌上，所以 draw 收 lab
  // 端子偏移统一从 super-data.js 生成（readData() 里跑，因为 super-data.js 是运行时注入的）
  // 「器件 + 外形」→ KINDS key 的反查
  const KIND_BY = {};
  Object.keys(KINDS).forEach(k => { KIND_BY[KINDS[k].dev + '|' + (KINDS[k].form || '')] = k; });
  function kindOf(dev, form) { return KIND_BY[dev + '|' + (form || '')] || KIND_BY[dev + '|'] || null; }
  // 连线阶段的端子查询入口：PINS(inst) → { 'QF.t0': [x,y], 'KM1.t3': [...], ... }（绝对画布坐标）
  // 前缀用实例名（inst.name）：只有一只的写 QF / FR，两只的写 KM1、KM2 —— 和 board.js 的端子 ID 同一套叫法
  const PINS = inst => {
    const raw = KINDS[inst.type].pins(), out = {};
    for (const k in raw) out[inst.name + '.' + k] = [inst.x + raw[k][0] * PS, inst.y + raw[k][1] * PS];
    return out;
  };
  window.SUPER_PINS = PINS; // 下一版连线直接读它，不用再推坐标

  // 同一个东西的数组版（带实例引用、带端子 id），命中测试 / 画端子点都用它：
  //   PINLIST(inst) → [{ id:'KM1.t0', pin:'t0', inst, x, y }]（x/y = 画布坐标）
  const PINLIST = inst => {
    const raw = KINDS[inst.type].pins(), out = [];
    for (const k in raw) out.push({
      id: inst.name + '.' + k, pin: k, inst: inst,
      x: inst.x + raw[k][0] * PS, y: inst.y + raw[k][1] * PS
    });
    return out;
  };
  const PINLIST_ALL = () => { const out = []; insts.forEach(it => { PINLIST(it).forEach(p => out.push(p)); }); return out; };
  function pinMap() { const m = {}; PINLIST_ALL().forEach(p => { m[p.id] = p; }); return m; }
  function pinById(id) { return pinMap()[id] || null; }

  /* ═══════════════ 3. DOM ═══════════════ */
  const $ = id => document.getElementById(id);
  const body = document.body, stage = $('stage'), cv = document.getElementById('c');
  const ctx = g;   // core.js 里的画布上下文（parts.js 内部也用同一个 g，ctx 只是本地别名）
  const tb = $('tb'), lib = $('lib'), orb = $('tbOrb'), go = $('go'), toast = $('toast'), cnt = $('cnt');
  const step = $('step'), sub = $('sub'), stat = $('stat');

  /* ═══════════════ 4. 画布坐标 ═══════════════ */
  // 画布坐标系 = 像素（1:1）。BW/BH 就是画布的实际大小，不做整体缩放、不留黑边；
  // 元件大小只由 PS 决定（跟着画布一起缩，手机上是小一号的元件，但形状完全一样）。
  // 元件实例的 x/y 是「元件原点」的画布坐标 —— 连线阶段只要再乘 PS 加端子偏移就是绝对坐标。
  let BW = 1240, BH = 680, PS = 0.55;
  const TOP = 34;              // 顶部「待布置区」一行标题占掉的高度，元件不压到它
  const VIEW = { k: 1, ox: 0, oy: 0 };   // 1:1，没有留白偏移（保留这个对象是给测试/调试算坐标用）
  let DPR = 1;

  function box(it) { return KINDS[it.type].box; }
  function clampInst(it) {
    const b = box(it), k = PS;
    it.x = clamp(it.x, -b.x * k + 6, Math.max(-b.x * k + 6, BW - (b.x + b.w) * k - 6));
    it.y = clamp(it.y, -b.y * k + TOP, Math.max(-b.y * k + TOP, BH - (b.y + b.h) * k - 6));
  }
  function fit() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(r.width * DPR));
    cv.height = Math.max(1, Math.round(r.height * DPR));
    BW = r.width; BH = r.height;
    PS = clamp(Math.min(BW / 1240, BH / 680) * 0.82, 0.26, 0.62);
    insts.forEach(clampInst);
    updateStat();          // 窄屏/宽屏的状态条文案不一样，尺寸一变就要重算一次
    need();
  }
  function toLocal(cx, cy) {
    const r = cv.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  /* ═══════════════ 5. 实例 ═══════════════ */
  const insts = [];
  let uid = 0;

  /* 实例名 / 代号按**器件类型**（it.dev）数，不按 KINDS 的 key 数。
     为什么：加了复合按钮之后，SB 有「单触点」和「复合」两张卡（两个 KINDS key），
     但它们是同一个器件类型 SB —— 3 只按钮必须还是 SB1/SB2/SB3。
     如果按 key 数，就会出现「SB1 + SBQ1」两套名字，端子 ID 和教材对不上，判对永远失败。 */
  function syncLabels() {
    const n = {}, total = {};
    insts.forEach(it => { total[it.dev] = (total[it.dev] || 0) + 1; });
    insts.forEach(it => {
      n[it.dev] = (n[it.dev] || 0) + 1;
      it.label = n[it.dev];                                       // 同类第几只（连线阶段拼端子 ID 用）
      const code = (SP && SP[it.dev] && SP[it.dev].code) || KINDS[it.type].code || it.dev;
      it.name = code + (total[it.dev] > 1 ? n[it.dev] : '');
    });
    cnt.textContent = '已摆 ' + insts.length + ' 个元件';
    updateStat();
  }
  function addAt(type, lx, ly) {
    const K = KINDS[type];
    if (!K) return null;
    const b = K.box, k = PS;
    const it = {
      id: ++uid, type: type, dev: K.dev, form: K.form,
      x: lx - (b.x + b.w / 2) * k,
      y: ly - (b.y + b.h / 2) * k
    };
    clampInst(it);
    insts.push(it); syncLabels(); need();
    return it;
  }
  function hitTest(lx, ly) {
    for (let i = insts.length - 1; i >= 0; i--) {
      const it = insts[i], b = KINDS[it.type].box;
      const x0 = it.x + b.x * PS, y0 = it.y + b.y * PS;
      if (lx >= x0 && lx <= x0 + b.w * PS && ly >= y0 && ly <= y0 + b.h * PS) return it;
    }
    return null;
  }

  /* ═══════════════ 6. 绘制 ═══════════════ */
  let dirty = false;
  function need() { if (dirty) return; dirty = true; requestAnimationFrame(() => { dirty = false; draw(); }); }
  /* 连线阶段开一条常驻动画循环（和 practice.js 一样每帧重画）：
     折线上的呼吸圈、拉线光点、线缆落位、FX 都要逐帧推进；摆放阶段不跑，省电。
     startLoop() 可以重复调用，不会叠出第二条循环。 */
  let rafId = 0, looping = false;
  function frame() {
    draw();
    if (phase === 'place' && !FX.length) { looping = false; rafId = 0; return; }
    rafId = requestAnimationFrame(frame);
  }
  function startLoop() { if (looping || rafId) return; looping = true; rafId = requestAnimationFrame(frame); }

  /* 底板 = 练习页实物板那张玻璃卡片（theme.js 的 glass：主题的卡片渐变 + 细亮边 + 顶部高光 + 蓝色外发光）。
     ★ 原来这里是自己调的深蓝圆角块 + 网格 + 四个角括号，颜色还全写死（#101a2e / rgba(120,150,220,…)），
       练习页一处都没有这些 —— 用户说的「背景也被改了、不受主题控制」就是这一段。 */
  function board() {
    // 圆角 16 = .stage 的 border-radius，卡片边和画布边严丝合缝，不会出现「框里还有一个框」
    glass(0, 0, BW, BH, 16);
  }
  function draw() {
    if (!cv.width || !cv.height) return;
    const t = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    board();
    for (const it of insts) {
      ctx.save(); ctx.translate(it.x, it.y); ctx.scale(PS, PS);
      KINDS[it.type].draw(it.name);
      ctx.restore();
      // 正在拖的那一个加一圈光，让学生看得清抓到的是哪个
      if (dragIt === it) {
        const b = KINDS[it.type].box;
        rrect(it.x + b.x * PS - 4, it.y + b.y * PS - 4, b.w * PS + 8, b.h * PS + 8, 12,
          hxRgba(TH.acc, .10), hxRgba(TH.acc, .55), 2);
      }
    }
    /* 导线层画在最上面（压在元件上）：学生要能看见自己接的线，也方便点线选中调整。
       画序照 practice.js 的实物板：导线 → 拉线中的线缆 → 选中端子的光点 → 光效，越靠手越在上。 */
    if (phase !== 'place') { drawWireLayer(t); drawPins(t); drawFX(t); ftbSync(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ═══════════════ 7. 缩略图（库里的小图 = 用同一个 parts.js 函数画一次再缩下来） ═══════════════ */
  /* 小图的底 = 主题的卡片渐变（theme.js 里 glass() 用的那两枚令牌），
     所以深色主题下是深玻璃、明亮主题下是浅玻璃 —— 和元件在练习页实物板上所在的「台面」是同一种底。
     ★ 原来这里写死了一对浅蓝（#f6f8fd → #dde5f2），换主题不跟着走，是一块「主题外的颜色」。 */
  const THUMB = {};
  function makeThumbs() {
    // ★ 局部变量别叫 TH：theme.js 的主题令牌对象就叫 TH，同名会把渐变令牌遮住（addColorStop('undefined')）
    const TW = 200, THH = 132;
    if (cv.width < TW + 8 || cv.height < THH + 8) return;   // 画布太小就不做（窄屏极端情况）
    for (const key in KINDS) {
      const b = KINDS[key].box, pad = 18;
      const s = Math.min((TW - pad * 2) / b.w, (THH - pad * 2) / b.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, TW, THH);
      const bg = ctx.createLinearGradient(0, 0, 0, THH);
      bg.addColorStop(0, TH.cardTop); bg.addColorStop(1, TH.cardBot);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, TW, THH);
      ctx.setTransform(s, 0, 0, s, (TW - b.w * s) / 2 - b.x * s, (THH - b.h * s) / 2 - b.y * s);
      KINDS[key].draw(KINDS[key].code);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const c2 = document.createElement('canvas');
      c2.width = TW; c2.height = THH;
      c2.getContext('2d').drawImage(cv, 0, 0, TW, THH, 0, 0, TW, THH);
      THUMB[key] = c2.toDataURL('image/png');
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
  }

  /* ═══════════════ 8. 元器件库（按题过滤） ═══════════════
     ★ 2026-11-09 起库里只摆**当前题真正要的卡片**（libOf 按 planOf(id) 过滤，见下面那条 ★）；
       12 种器件、23 种外形仍是全量定义（KINDS 一张不删），只是不上架。
     ★ 为什么改（原来是全量 21 张一起上、2026-11-08 还专门写过「不按题过滤」的理由）：
       用户实际用下来的反馈是——2.2 的库里同时摆着「交流接触器 / 接触器+辅助常闭 /
       接触器+下排辅助」三张几乎一样的卡，外加红绿不分的一堆按钮，光认卡就把人认晕了，
       「挑种类」的难度变成了「认卡片」的负担。现在只上架本题要的外形（E1 仍会同时摆
       「带辅助常闭」和「普通」两张，那才是真要挑的）；卡片上也不写「要几个」，
       数错个数仍由摆放校验（§10）拦住，「数个数」这半边的难度一点没少。
     ★ 哪种题要哪些 (器件, 外形)、各几个，由 FORM_PLAN + planOf() 精确算（校验和过滤同一份口径）。
       P 没有网表 → 按 parts 的默认外形算（那题只练摆放）。 */

  /* 每道题「哪个教材代号用哪一档外形」——super-data.js 的 forms / formNotes 那几句话的机器可读版
     （原件没改也不能改，这里只做映射，出处逐条标在右边）：
       2.3  SB1 单触点，SB2/SB3 复合按钮        ← super-data.js:336
       2.4  SB1/SB2 单触点，SB3 复合按钮        ← super-data.js:345
       2.6  SB1 单触点，SB2/SB3 复合按钮；M 双速接线盒 BOX6B ← super-data.js:363 / :362
       E1   SB 三只全复合；KT 用 4 端子那档；KM1/KM2 带右侧辅助常闭 aux ← super-data.js:372-373
       E2   KT 两排 2ROW、VD 竖放 V2、M 三端 BOX3；QF2 三极 3P；KM1/KM4 下排辅助触头 auxBelow ← :382-386
     键写「教材代号」只管那一只，写「器件类型」管这一类的全部；没写的用默认外形。 */
  const FORM_PLAN = {
    '2.3': { SB2: 'QUAD', SB3: 'QUAD' },
    '2.4': { SB3: 'QUAD' },
    '2.6': { SB2: 'QUAD', SB3: 'QUAD', M: 'BOX6B' },
    'E1': { SB: 'QUAD', KT: '4', KM1: 'aux', KM2: 'aux' },
    'E2': { KT: '2ROW', VD: 'V2', M: 'BOX3', QF2: '3P', KM1: 'auxBelow', KM4: 'auxBelow' }
  };
  // 教材代号 → 器件类型：'SB2' → 'SB'、'FU2b' → 'FU'、'KM' → 'KM'
  const typeOfDev = d => String(d).replace(/^([A-Z]+)\d*[a-z]?$/, '$1');
  function formFor(id, devName) {
    const plan = FORM_PLAN[id] || {};
    if (Object.prototype.hasOwnProperty.call(plan, devName)) return plan[devName];
    const t = typeOfDev(devName);
    if (Object.prototype.hasOwnProperty.call(plan, t)) return plan[t];
    return null;
  }
  // 网表里出现过哪些教材代号（按器件类型分组）：{ SB: ['SB1','SB2','SB3'], ... }
  function devNamesOf(id) {
    const nets = NETS_ALL[id], out = {};
    if (!nets) return out;
    Object.keys(nets).forEach(n => (nets[n] || []).forEach(t => {
      const s = String(t), i = s.lastIndexOf('.');
      if (i <= 0) return;
      const dev = s.slice(0, i), type = typeOfDev(dev);
      if (!out[type]) out[type] = [];
      if (out[type].indexOf(dev) < 0) out[type].push(dev);
    }));
    return out;
  }
  /* 这道题每张库卡片要摆几个：{ QF:1, FU:4, ..., SB:1, SBQ:2 }
     · 一般情况：网表里一个教材代号 = 一件，外形按 FORM_PLAN；
     · 单极件（只有 FU）：一个代号在网表里被拆成几片（FU1 = 三只并排），代号的个数 ≠ 件数，
       这时这个类型一律退回默认外形、件数直接取 parts —— 和 SUPER.check 同一个口径，
       所以卡片上的数加起来一定等于 parts（测试里逐条核对过）。 */
  function planOf(id) {
    const t = DATA.tasks[id] || {};
    const parts = t.parts || {};
    const names = devNamesOf(id), out = {};
    Object.keys(parts).forEach(dev => {
      const list = names[dev] || [];
      const cnt = {};
      list.forEach(dn => { const k = kindOf(dev, formFor(id, dn)); if (k) cnt[k] = (cnt[k] || 0) + 1; });
      let sum = 0; Object.keys(cnt).forEach(k => { sum += cnt[k]; });
      if (!list.length || sum !== parts[dev]) {
        Object.keys(cnt).forEach(k => { delete cnt[k]; });
        const k = kindOf(dev, null);
        if (k) cnt[k] = parts[dev];
      }
      Object.keys(cnt).forEach(k => { out[k] = (out[k] || 0) + cnt[k]; });
    });
    return out;
  }
  /* 卡片上的名字（比 unit 细：要能分出「带不带辅助触头」「红帽绿帽」「几个端子」）。
     ★ 2026-11-09 改版：用户反馈「接触器+辅助常闭」「接触器+下排辅助」这种说法看不懂、
       两张几乎一样的接触器卡分不清 —— 名字一律带全称，差别写到 CARD_NOTE 那行小字里。 */
  const CARD_NAME = {
    QF: '低压断路器（3P+N）', QF3P: '三极断路器（3P）', FU: '熔断器', FR: '热继电器',
    KM: '交流接触器', KMAUX: '交流接触器·带辅助常闭', KMAUXB: '交流接触器·带下排辅助',
    SB: '起动按钮（绿）', SBr: '停止按钮（红）', SBQ: '复合按钮（绿）', SBQr: '复合停止按钮（红）',
    M: '电动机接线盒（6 孔）', MBOX6B: '双速电动机接线盒', MBOX3: '电动机接线盒（3 孔）',
    KT: '时间继电器（通电延时）', KT4: '时间继电器（4 端）', KT2R: '时间继电器（断电延时）',
    SQ: '位置开关', TC: '控制变压器', R: '制动电阻', VD: '整流二极管（横放）', VDV2: '整流二极管（竖放）',
    XT: '端子排（N 格）'
  };
  /* 卡片名字下面那行小字：只说「这张卡和长得像的那张差在哪」，不说题、不说个数 */
  const CARD_NOTE = {
    QF: '三相 + N 共 8 端', QF3P: '无 N 极，共 6 端',
    FU: '单极一进一出 2 端',
    FR: '3 对主触点 + 常闭 95/96',
    KM: '上 6 下 6；自带常开 13/14、常闭 21/22',
    KMAUX: '右侧多一块常闭 21/22', KMAUXB: '下方多一排辅助触头',
    SB: '常开，2 端子（i/o）', SBr: '常闭，2 端子（i/o）',
    SBQ: '常闭+常开联动，4 端子', SBQr: '常闭+常开联动，4 端子',
    M: '6 端，已拆连接片', MBOX6B: '6 端，间距密', MBOX3: '3 端',
    KT: '一排 6 端', KT4: '一排 4 端', KT2R: '上下两排 6 端',
    SQ: '常闭 + 常开各一对', TC: '380 V → 127 V',
    VD: '左阳右阴', VDV2: '上阳下阴', XT: '一格两螺丝'
  };
  const GRP_OF = {
    QF: '配电与保护', FU: '配电与保护', FR: '配电与保护',
    KM: '控制与操作', SB: '控制与操作', KT: '控制与操作', SQ: '控制与操作', TC: '控制与操作',
    R: '其他', VD: '其他', M: '负载与端子', XT: '负载与端子'
  };
  // 卡片顺序（同一组里按这个排；没列到的排最后）
  const CARD_ORDER = ['QF', 'QF3P', 'FU', 'FR', 'KM', 'KMAUX', 'KMAUXB', 'SB', 'SBr', 'SBQ', 'SBQr',
    'KT', 'KT4', 'KT2R', 'SQ', 'TC', 'R', 'VD', 'VDV2', 'M', 'MBOX6B', 'MBOX3', 'XT'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let LIB = [];   // 当前题的卡片（KINDS 的 key 数组）；切题时按 planOf(id) 重算一次

  function libOf(id) {
    /* ★ 2026-11-09 改成**按题过滤**（原来是全量 21 张一起上）：
       用户拿着 2.2 的原理图面对三张几乎一样的接触器卡（普通 / +辅助常闭 / +下排辅助），
       文案再怎么写也分不清 —— 库里只摆这道题 planOf() 真正要的外形（E1 才会同时摆
       「带辅助常闭」和「普通」两张，那正是它要考的）；器件种类这半边的难度还在：
       卡片上不写「要几个」，数错了摆放校验照样拦。
       红色停止按钮（SBr / SBQr）不是任何题的「必需外形」，但实训台上停止键就是红的
       （board.js 的 BTN：SB1 一律红帽）—— 只要这题要按钮（SB / SBQ），就随绿帽那版一起上架，
       判对按端子集签名，红绿随便摆哪个都算对。
       planOf 算不出东西（数据没到 / parts 空）时退回全量，别让学生没卡可拖。 */
    const plan = planOf(id);
    const keys = Object.keys(plan).filter(k => KINDS[k]);
    if (keys.indexOf('SB') >= 0 && keys.indexOf('SBr') < 0) keys.push('SBr');
    if (keys.indexOf('SBQ') >= 0 && keys.indexOf('SBQr') < 0) keys.push('SBQr');
    const src = keys.length ? keys : Object.keys(KINDS);
    return src.sort((a, b) => {
      const ia = CARD_ORDER.indexOf(a), ib = CARD_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  /* 卡片小字那行（CARD_NOTE）的样式：super.html 不在本次改动范围，样式从 JS 注入一次 */
  (function injectCardNoteCss() {
    const s = document.createElement('style');
    s.textContent = '.card .note{font-style:normal;font-size:9.5px;line-height:1.25;color:var(--dim);' +
      'text-align:center;opacity:.88;margin-top:-1px}';
    document.head.appendChild(s);
  })();

  function buildLib() {
    const groups = [];
    LIB.forEach(key => {
      const name = GRP_OF[KINDS[key].dev] || '其他';
      let g0 = groups.find(x => x.name === name);
      if (!g0) groups.push(g0 = { name, items: [] });
      g0.items.push(key);
    });
    lib.innerHTML = groups.map(g0 =>
      '<div class="grp">' + esc(g0.name) + '</div>' + g0.items.map(key =>
        '<button class="card" type="button" data-k="' + esc(key) + '" title="按住拖到画布上：' + esc(CARD_NAME[key] || KINDS[key].unit) + '">' +
        '<span class="thumb">' + (THUMB[key] ? '<img src="' + THUMB[key] + '" alt="">' : '') + '</span>' +
        '<b>' + esc(KINDS[key].code) + '</b><small>' + esc(CARD_NAME[key] || KINDS[key].unit) + '</small>' +
        (CARD_NOTE[key] ? '<em class="note">' + esc(CARD_NOTE[key]) + '</em>' : '') + '</button>'
      ).join('')
    ).join('');
    lib.scrollTop = 0;
  }

  /* ═══════════════ 8.5 连线阶段 ═══════════════
     模型：wires = [{ a:'KM1.t0', b:'FU1.t', color }]，两端都是「实例名 + '.' + pin id」。
     端子坐标永远现算（实例原点 + 偏移 × PS），所以元件一动、画布一缩，线就跟着端点走，
     不需要保存任何线坐标 —— 元件一动，端子和折线一起重算（2026-11-08：走线已照 practice.js
     改成正交折线 + 光效，见 §8.55；线对象上的 born/fromS/toS/pts 是纯显示字段）。
     ───────────────────────────────────────────────────────────────────────── */

  const W = window.SUPER_WIRE || null;                  // 连线模型 + 判对（src/super-wire.js）
  // 标准网表 NETS 在 §1 里按当前题目定义（切题时跟着换），这里不再取一次
  const wires = [];                                     // 学生接的线
  let phase = 'place';                                  // 'place' 摆放 / 'wire' 连线 / 'done' 连线判对通过
  /* ── 连线阶段的交互状态（口径全部对齐 practice.js 的 PS）──
     arm      已选中的端子 { id, x, y }（practice.js:381 的 PS.sel；点第一个端子后的状态，可再点第二个端子成线）
     armDrag  拉线中 { sx, sy, px, py, moved, snap, snapT, ex, ey }（practice.js:1208 的 PS.drag；拖出 10px 以后线缆跟手、磁吸）
     selWire  选中的导线（wkey）：出白色编辑手柄、可拖段 / 拐点调整走线（practice.js:1220 的 PS.selWire）
     edit     正在拖的走线调整（practice.js:1128 的 PS.edit）；EDIT_HIST 记调整前的走线供「撤销」恢复（practice.js:1112）
     errKeys  查错只报红：被标红的线的 wkey 集合；接线一变就失效（练习页是 PS.checked = null，同口径） */
  let arm = null;
  let armDrag = null;
  let hover = null;                                     // 手指/鼠标当前位置（画布坐标），画线缆用
  let hotPin = null;                                    // 光标最近的那个端子（拉线时它就是磁吸目标）
  let selWire = null;
  let edit = null;
  const EDIT_HIST = [];
  let errKeys = null;
  /* 线宽 / 线色：练习页工具栏那两块设置（practice.js:392 WIRE_SIZES / :201 PALETTE）。
     排位存自己的键 zfz-super-pen（不读写练习页的键），默认标准 3.5 / 自动配色。 */
  const PEN_KEY = 'zfz-super-pen';
  const WIRE_SIZES = [[2.5, '细'], [3.5, '标准'], [5, '粗'], [7, '特粗']];
  const PALETTE = [['auto', '自动'], ['U', '黄'], ['V', '绿'], ['W', '红'], ['1', '控制'], ['N', '零线']];
  let wireW = 3.5, penColor = 'auto';
  try { const v = JSON.parse(localStorage.getItem(PEN_KEY) || '{}'); if (v && v.w) wireW = v.w; if (v && v.c) penColor = v.c; } catch (e) { }
  function savePen() { try { localStorage.setItem(PEN_KEY, JSON.stringify({ w: wireW, c: penColor })); } catch (e) { } }
  let aliasSlow = false, aliasBroken = false;            // SUPER_ALIAS 的降级开关（见 judgeNow）
  let quiet = false;                                     // 批量灌线时暂停判对（只给测试钩子用）
  let statCache = '';
  /* 导线颜色：按「这根线的起点属于标准网表的哪个线号」取色，用的是练习页同一个 netColor()。
     ★ 原来这里自带 6 色轮盘（#8ab4ff/#7ee7c7/…），和练习页的相色（U 黄 / V 绿 / W 红 / N 蓝 / 控制线深红）两套，
       换主题也不跟着走。现在：线号查得到就用主题相色，查不到（元件名和标准网表对不上）就用控制线颜色。 */
  let NET_OF = null, NET_OF_TASK = null;
  function netOfTerm() {
    if (NET_OF && NET_OF_TASK === DATA.task) return NET_OF;
    const m = {};
    Object.keys(NETS || {}).forEach(n => (NETS[n] || []).forEach(t => { m[t] = n; }));
    NET_OF = m; NET_OF_TASK = DATA.task;
    return m;
  }
  function wireColor(term) {
    const n = netOfTerm()[term];
    return netColor(n || '1');
  }

  /* ── 命中半径（2026-11-09 对齐 practice.js 的 termAt 口径） ──
     练习页 termAt(p, e, 18)（practice.js:1186-1188）：18 是**板坐标**半径，画到屏幕上要乘版式缩放 BD.k；
     排位画布坐标就是屏幕像素、元件按 PS 缩放，所以等价换算 = 18 × PS（PS 就是排位的「板缩放」）。
     触屏在 practice.js 里再乘 max(HITK, 1.6 / VIEW.k)（排位 VIEW.k 恒 1）→ 1.6，手指才点得准。
     下限 11：PS 压到 0.26 的窄屏上端子间距约 10px，再小就永远点不中。 */
  const PIN_HIT = () => Math.max(11, 18 * PS);
  const PIN_R = e => { const r = PIN_HIT(); return e && e.pointerType && e.pointerType !== 'mouse' ? r * 1.6 : r; };
  const SNAP_R = e => { const r = Math.max(20, 34 * PS); return e && e.pointerType && e.pointerType !== 'mouse' ? r * 1.6 : r; };  // 拖线松手时的磁吸半径（practice.js:1231 termAt(p,e,34)）
  /* 可以接线的端子（对齐 practice.js:203 的 WIREABLE / :147 的 noWire 语义）：
     · 端子 id 出现在标准网表里 → 可接（和练习页「TP 里除 noWire 外全部可接」一样，网表就是这道题要接的全部）；
     · 实例的端子一枚都不在网表里 → 整只实例的端子都可接。这是**拆装类器件**：4 只单极熔断器的实例名
       FU1～FU4 和网表里「三极 FU1 + 控制 FU2」对不上，要靠 super-alias 的置换映射判对，
       端子名永远查不到，逐端子判会把熔断器全判成「不用接线」；
     · 实例有端子在网表里、但这枚不在（QF 进线 t0～t3、FR 出线 b0～b2）→ 不可接 ——
       练习页就是这两类被 noWire 排除（空开进线由实训台供电、FR 出线接电动机）。
     P 没有网表 → 全部可点（那一题进不了连线阶段，只是兜底）。 */
  function wireableSet() {
    const s = new Set();
    if (!NETS) { PINLIST_ALL().forEach(p => s.add(p.id)); return s; }
    const inNets = new Set();
    Object.keys(NETS).forEach(n => (NETS[n] || []).forEach(t => inNets.add(t)));
    for (const it of insts) {
      const pins = PINLIST(it);
      const mapped = pins.some(p => inNets.has(p.id));
      pins.forEach(p => { if (!mapped || inNets.has(p.id)) s.add(p.id); });
    }
    return s;
  }
  function pinHit(lx, ly, e, except, r) {
    const R = r != null ? r : PIN_R(e);
    const ok = wireableSet();
    let best = null, bd = R;
    for (const it of insts) {
      const raw = KINDS[it.type].pins();
      for (const k in raw) {
        const id = it.name + '.' + k;
        if (ok.size && !ok.has(id)) continue;             // 本电路不用接线的端子：不给点（练习页同口径）
        if (except && id === except) continue;
        const px = it.x + raw[k][0] * PS, py = it.y + raw[k][1] * PS;
        const d = Math.hypot(lx - px, ly - py);
        if (d <= bd) { bd = d; best = { id: id, pin: k, inst: it, x: px, y: py }; }
      }
    }
    return best;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (!L2) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // 点到折线的最近距离（命中测试按画出来的走线算，不按两头直线算）
  function polyDist(px, py, pts) {
    let best = 1e9;
    for (let i = 1; i < pts.length; i++) {
      const d = distSeg(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (d < best) best = d;
    }
    return best;
  }

  /* ═══════════════ 8.55 走线 + 光效（照 practice.js 搬过来） ═══════════════
     用户原话：「光效连线都变直线了 全部功能都没有了」。所以连线阶段的画面不再画两点直线，
     把原练习页那套原样搬过来：
       · 折线走线 —— practice.js:426 route()：端子先按出线方向探出一小段，走一条公共车道，
                     再折回另一端；同一片区域里已有横线占住的高度要错开 11px 以上（:443 freeY）
       · 线缆落位 —— practice.js:474 resample / :482 cablePts / :747：新线先是一条下垂的贝塞尔线缆，
                     用 backOut 弹性落成横平竖直的折线（0.45 秒）
       · 发光 —— shadowBlur 光晕（新线 16、拉线 18），参数和 practice.js 逐项一致
       · 高亮 —— 选中端子一圈光点绕着转（practice.js:195 halo）
       · 圈 —— 点阵呼吸圈（practice.js:841 ring）：悬停端子、待删线的两端
       · 动效 —— burst / sweep / scan / flash（practice.js:168 的 FX 层）
     ★ 判对链路一行没动：这里只决定「怎么画」。wires 里的线对象只多了 born / fromS / toS / pts
       四个纯显示字段，a / b / color 不变，SUPER_WIRE / SUPER_ALIAS 只读 a、b。
     ★ 为什么不像 practice.js 那样用 gapX 在接触器之间找竖车道：超级排位的元件位置是学生自己摆的，
       没有固定的「接触器之间」；这里改成通用的「避开已有横线/竖线」搜车道，视觉规则同源。 */
  /* 连线阶段的三个语义色 + 导线描边，全部现读主题令牌（theme.js 的 TH / C）：
       acc  = 主题主色（未接的端子、起线的涟漪）
       ok   = 主题「通」（接过线的端子）
       bad  = 主题「不通」（接满的端子、出错闪光、待删的高亮）
       edge = 主题的导线描边色（parts.js:179 画导线时用的同一个 C.wireEdge）
     ★ 原来这里是四个写死的 hex（#7c9cff / #34d399 / #fb7185 / rgba(4,8,18,.55)），
       换主题时连线阶段还是深色那一套 —— 必须写成函数，换主题后立刻取到新值。 */
  const ACC = () => TH.acc, OKC = () => C.ok, BADC = () => C.bad, WEDGE = () => C.wireEdge;
  const nowSec = () => performance.now() / 1000;
  const FX = [];
  const fx = (type, o) => { FX.push(Object.assign({ type: type, t0: nowSec(), seed: Math.random() * 6.28 }, o)); startLoop(); };

  /* 端子的出线方向：看它贴在元件外框的哪条边。上排向上、下排向下（practice.js 的 dirOf 同一口径），
     横放的电阻/二极管自然得到左右。上下边乘 0.42 的折扣：竖装的控制电器端子都在上下边，
     不折扣的话「离左右边也不远」的小元件会被判成侧向出线。 */
  function dirMap() {
    const m = {};
    for (const it of insts) {
      const raw = KINDS[it.type].pins(), s = sizeOf(it.dev, it.form) || { w: 1, h: 1 };
      const w = s.w || 1, h = s.h || 1;
      for (const k in raw) {
        const ox = raw[k][0], oy = raw[k][1];
        const cand = [
          [oy / h * 0.42, 0, -1],            // 上边
          [(h - oy) / h * 0.42, 0, 1],        // 下边
          [ox / w, -1, 0],                    // 左边
          [(w - ox) / w, 1, 0]                // 右边
        ].sort((a, b) => a[0] - b[0]);
        m[it.name + '.' + k] = [cand[0][1], cand[0][2]];
      }
    }
    return m;
  }

  let routeSig = '', routePts = [];
  /* 折线缓存：端子坐标是现算的（元件一动就变），所以用「所有端点坐标 + 线数 + 画布尺寸」当签名，
     签名不变就直接复用上一帧的折线，拖动元件时逐帧重算也扛得住。
     ★ 手动调过的走线（w.fixedPts，学生拖过手柄）优先保留：只要两端的端子没动，就一直用学生摆的走线，
       不被自动走线覆盖；两端动了（元件被挪）才重算 —— practice.js 的板子是固定的不存在这件事，
       排位元件可以搬，所以补了这条「端点签名」判据（endSigOf）。 */
  function endSigOf(p, q) {
    return (p ? Math.round(p.x) + ',' + Math.round(p.y) : '?') + '>' + (q ? Math.round(q.x) + ',' + Math.round(q.y) : '?');
  }
  function syncRoutes() {
    const m = pinMap(), dm = dirMap();
    let sig = Math.round(BW) + 'x' + Math.round(BH) + '|' + wires.length;
    for (const w of wires) {
      const p = m[w.a], q = m[w.b];
      sig += '|' + w.a + (p ? Math.round(p.x) + ',' + Math.round(p.y) : '?') + '>' +
        w.b + (q ? Math.round(q.x) + ',' + Math.round(q.y) : '?');
    }
    if (sig === routeSig && routePts.length === wires.length) {
      // 签名没变也可能有人正在拖手柄改走线（startEdit/moveEdit 直接改 w.pts，不改签名）：
      // 把缓存对齐到 w.pts，避让与绘制读到的都是当前这一帧的真实走线
      wires.forEach((w, i) => { if (w.pts) routePts[i] = w.pts; });
      return routePts;
    }
    routeSig = sig;
    routePts = [];
    wires.forEach((w, i) => {
      const p = m[w.a], q = m[w.b];
      if (!p || !q) { routePts.push(null); return; }
      if (w.fixedPts && w.fixedSig === endSigOf(p, q)) {
        w.pts = w.fixedPts;
        routePts.push(w.fixedPts);
        return;
      }
      const pts = routePins([p.x, p.y], [q.x, q.y], dm[w.a] || [0, 1], dm[w.b] || [0, -1], i, p.inst, q.inst);
      w.pts = pts;                     // 只给命中测试和测试钩子用，判对不读它
      w.fixedPts = null;
      routePts.push(pts);
    });
    return routePts;
  }
  // 第 i 根线画出来的折线（测试钩子 / 命中测试用；内部保证已经算过）
  function wirePointsOf(i) {
    const w = wires[i]; if (!w) return null;
    syncRoutes();
    return w.pts || null;
  }
  function bumpY(y, x1, x2) {
    const L = Math.min(x1, x2) - 8, R = Math.max(x1, x2) + 8;
    for (const pts of routePts) {
      if (!pts) continue;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        if (Math.abs(q[1] - p[1]) > 0.01) continue;                 // 只看横线
        if (Math.abs(q[1] - y) >= 11) continue;
        if (Math.max(Math.min(p[0], q[0]), L) < Math.min(Math.max(p[0], q[0]), R)) return true;
      }
    }
    return false;
  }
  /* 横车道从元件身上穿过去很难看（practice.js 用 gapX 让竖线绕开接触器，同一个意思）：
     这里把「这条横线会穿过哪个元件的外框」也算成被占用。端点自己那只元件不算 ——
     同一只元件上下排端子之间的线本来就要贴着它走。 */
  function bumpBoxY(obst, y, x1, x2) {
    const L = Math.min(x1, x2), R = Math.max(x1, x2);
    for (const b of obst) {
      if (y <= b.y0 + 3 || y >= b.y1 - 3) continue;
      if (Math.max(b.x0, L) + 4 < Math.min(b.x1, R)) return true;
    }
    return false;
  }
  function bumpBoxX(obst, x, y1, y2) {
    const T = Math.min(y1, y2), B = Math.max(y1, y2);
    for (const b of obst) {
      if (x <= b.x0 + 3 || x >= b.x1 - 3) continue;
      if (Math.max(b.y0, T) + 4 < Math.min(b.y1, B)) return true;
    }
    return false;
  }
  function bumpX(x, y1, y2) {
    const T = Math.min(y1, y2) - 8, B = Math.max(y1, y2) + 8;
    for (const pts of routePts) {
      if (!pts) continue;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i];
        if (Math.abs(q[0] - p[0]) > 0.01) continue;                 // 只看竖线
        if (Math.abs(q[0] - x) >= 11) continue;
        if (Math.max(Math.min(p[1], q[1]), T) < Math.min(Math.max(p[1], q[1]), B)) return true;
      }
    }
    return false;
  }
  function freeY(x1, x2, y0, lo, hi, step, obst) {
    for (let k = 0; k < 40; k++) {
      const y = Math.round(y0 + step(k));
      if (y >= lo && y <= hi && !bumpY(y, x1, x2) && !bumpBoxY(obst || [], y, x1, x2)) return y;
    }
    return Math.round(y0);
  }
  function freeX(y1, y2, x0, lo, hi, step, obst) {
    for (let k = 0; k < 40; k++) {
      const x = Math.round(x0 + step(k));
      if (x >= lo && x <= hi && !bumpX(x, y1, y2) && !bumpBoxX(obst || [], x, y1, y2)) return x;
    }
    return Math.round(x0);
  }
  // 去掉重复点（连续相同 / 挨得比一个像素还近），否则圆角接头会画出毛刺
  function cleanPts(pts) {
    const out = [];
    pts.forEach(p => {
      const q = out[out.length - 1];
      if (q && Math.abs(p[0] - q[0]) < 0.8 && Math.abs(p[1] - q[1]) < 0.8) return;
      out.push(p);
    });
    if (out.length === 1) out.push([out[0][0], out[0][1] + 0.01]);
    return out;
  }
  /* 六点折线（practice.js:426 的 route）：
       竖—竖：A → 出线 → 公共横车道 → 另一端出线 → B
       横—横：A → 出线 → 公共竖车道 → 另一端出线 → B
       一横一竖：两个出线段直接折成 L 形 */
  function routePins(A, B, da, db, ix, skip1, skip2) {
    const lane = ix % 5, gap = 12 + lane * 6;
    const A1 = [A[0] + da[0] * gap, A[1] + da[1] * gap];
    const B1 = [B[0] + db[0] * gap, B[1] + db[1] * gap];
    const va = da[0] === 0, vb = db[0] === 0;
    const obst = [];
    for (const it of insts) {
      if (it === skip1 || it === skip2) continue;
      const b = KINDS[it.type].box;
      obst.push({ x0: it.x + b.x * PS, x1: it.x + (b.x + b.w) * PS, y0: it.y + b.y * PS, y1: it.y + (b.y + b.h) * PS });
    }
    let pts;
    if (va && vb) {
      const y0 = da[1] === db[1] ? (da[1] < 0 ? Math.min(A1[1], B1[1]) : Math.max(A1[1], B1[1]))
        : (A1[1] + B1[1]) / 2;                                     // 同向往外错开；反向在两端之间错开
      const ym = freeY(A[0], B[0], y0, 8, Math.max(16, BH - 8), k => da[1] * 12 * k, obst);
      pts = [A, A1, [A[0], ym], [B[0], ym], B1, B];
    } else if (!va && !vb) {
      const x0 = da[0] === db[0] ? (da[0] < 0 ? Math.min(A1[0], B1[0]) : Math.max(A1[0], B1[0]))
        : (A1[0] + B1[0]) / 2;
      const xm = freeX(A[1], B[1], x0, 8, Math.max(16, BW - 8), k => da[0] * 12 * k, obst);
      pts = [A, A1, [xm, A[1]], [xm, B[1]], B1, B];
    } else {
      pts = [A, A1, [B1[0], A1[1]], B1, B];
    }
    return cleanPts(pts);
  }
  // 三次贝塞尔（线缆）：practice.js:482 cablePts 的通用版（控制点按出线方向取，横竖都成立）
  function cablePts(A, E, c1, c2) {
    const out = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      out.push([
        u * u * u * A[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * E[0],
        u * u * u * A[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * E[1]
      ]);
    }
    return out;
  }
  // 按长度均匀取 n 个点（线缆落位动画用，practice.js:474 原样）
  function resample(pts, n) {
    const seg = [], out = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    for (let j = 0; j < n; j++) {
      let need = L * j / (n - 1), i = 0;
      while (i < seg.length - 1 && need > seg[i]) { need -= seg[i]; i++; }
      const k = seg[i] ? Math.min(1, need / seg[i]) : 0;
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]);
    }
    return out;
  }
  const backOut = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

  // 新线落位：先把「下垂的线缆」和「最终折线」各采 48 个点，之后逐帧插值（practice.js:467/747）
  function bornWire(w) {
    if (!w || !w.pts) return;
    const m = pinMap(), dm = dirMap();
    const p = m[w.a], q = m[w.b]; if (!p || !q) return;
    const da = dm[w.a] || [0, 1], db = dm[w.b] || [0, 1];
    const dist = Math.hypot(q.x - p.x, q.y - p.y), sag = 26 + Math.min(40, dist * 0.18);
    const cab = cablePts([p.x, p.y], [q.x, q.y],
      [p.x + da[0] * sag, p.y + da[1] * sag],
      [q.x + db[0] * sag * 0.7, q.y + db[1] * sag * 0.7]);
    w.born = nowSec();
    w.fromS = resample(cab, 48);
    w.toS = resample(w.pts, 48);
  }

  /* 选中端子的一圈光点（practice.js:195 halo） */
  function halo(p, col, t, r = 22, n = 10) {
    g.save(); g.shadowColor = col; g.shadowBlur = 14;
    for (let j = 0; j < n; j++) {
      const a = t * 2.4 + j / n * 6.283;
      g.globalAlpha = 0.35 + 0.65 * (j / n);
      dot(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, j === n - 1 ? 3.6 : 2.2, col);
    }
    g.globalAlpha = 0.28; g.strokeStyle = col; g.lineWidth = 1;
    g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.stroke(); g.restore();
  }
  /* 点阵呼吸圈（practice.js:841 ring）：悬停端子 / 待删线的两端 */
  function ring(p, col, t, k = 1) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6), r = (13 + 4 * pulse) * k;
    g.save(); g.shadowColor = col; g.shadowBlur = 12; g.globalAlpha = 0.55 + 0.45 * pulse;
    for (let j = 0; j < 14; j++) { const a = j / 14 * 6.283 - t * 0.8; dot(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r, 2.0, col); }
    g.restore();
  }
  /* 动效层（practice.js:168 drawFX）：点击涟漪、接线粒子、沿线扫描、检查通过的光扫、出错红框 */
  function drawFX(t) {
    for (let i = FX.length - 1; i >= 0; i--) {
      const f = FX[i];
      const dur = f.type === 'scan' ? 1.3 : f.type === 'sweep' ? 0.75 : 0.65;
      const k = (t - f.t0) / dur;
      if (k > 1) { FX.splice(i, 1); continue; }
      const col = f.col || ACC();
      g.save(); g.shadowColor = col; g.shadowBlur = 16;
      if (f.type === 'ripple') {
        g.globalAlpha = 1 - k; g.strokeStyle = col; g.lineWidth = 2;
        g.beginPath(); g.arc(f.x, f.y, 8 + ease(k) * 46, 0, 7); g.stroke();
      }
      if (f.type === 'burst') for (let j = 0; j < 16; j++) {
        const a = f.seed + j / 16 * 6.283, r = 8 + ease(k) * (26 + (j % 3) * 8);
        g.globalAlpha = 1 - k;
        dot(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 2.6 * (1 - k) + 0.6, col);
      }
      if (f.type === 'sweep' && f.pts.length > 1) { // 一段亮光沿新线跑一遍
        const a = partial(f.pts, Math.max(0, k * 1.25 - 0.25)), b = partial(f.pts, Math.min(1, k * 1.25));
        const head = b[b.length - 1];
        g.globalAlpha = 1 - k * 0.6;
        if (b.length > 1) poly(b.slice(Math.max(0, a.length - 1)), TH.sweep, 3);   // 主题的「扫光」色（practice.js 同一枚令牌）
        dot(head[0], head[1], 5, TH.sweep);
      }
      if (f.type === 'scan') { // 检查通过：一道绿光从上往下扫过画布
        const y = ease(k) * BH;
        g.globalAlpha = 1 - k * 0.7;
        g.fillStyle = lin(0, y - 50, 0, y, [[0, hxRgba(C.ok, 0)], [1, hxRgba(C.ok, .35)]]);
        g.fillRect(0, Math.max(0, y - 50), BW, Math.min(50, y));
        poly([[0, y], [BW, y]], C.ok, 2);
      }
      if (f.type === 'flash') { // 出错：整块画布红色闪框
        g.globalAlpha = (1 - k) * 0.9;
        rrect(2, 2, BW - 4, BH - 4, 18, null, BADC(), 4);
      }
      g.restore();
    }
  }

  const WIRE_R = 10;                                    // 线的命中容错（手指在线旁边也算点到）
  function wireHit(lx, ly) {
    syncRoutes();
    let best = null, bd = WIRE_R;
    for (let i = wires.length - 1; i >= 0; i--) {
      const pts = wires[i].pts;
      if (!pts) continue;
      const d = polyDist(lx, ly, pts);
      if (d <= bd) { bd = d; best = wires[i]; }
    }
    return best;
  }
  const wkey = w => W ? W.key(w.a, w.b) : (w.a < w.b ? w.a + '|' + w.b : w.b + '|' + w.a);

  /* ── 调整走线（像 Proteus）——practice.js:1111-1176 原样口径 ──
     选中导线后：拖横线段上下移、拖竖线段左右移、拖拐点移动转角；两端始终连在端子上。
     「撤销」先撤走线调整、再撤最后一根线（practice.js:1159 undoLast 同一个口径）。 */
  const nearPt = (p, q, d) => Math.hypot(p.x - q[0], p.y - q[1]) <= d;
  const isH = (a, b) => a[1] === b[1];
  function editHit(w, p, tol) {
    const pts = w.pts;
    if (!pts || pts.length < 2) return null;
    for (let i = 1; i < pts.length - 1; i++) if (nearPt(p, pts[i], tol + 3)) return { mode: 'corner', i };
    for (let i = 1; i < pts.length; i++) if (distSeg(p.x, p.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < tol) return { mode: 'seg', i };
    return null;
  }
  function startEdit(w, h, p) {
    const pts = w.pts.map(q => q.slice()); let a, b, i = h.i;
    // 要动的点挨着端子时，先在端子处补一个点，端子本身不动，拉出来的那一小段自动和它垂直（practice.js:1123 lead）
    const lead = end => {
      const L = pts.length - 1, T = end ? pts[L] : pts[0], N = end ? pts[L - 1] : pts[1];
      if (T[0] !== N[0] || Math.abs(N[1] - T[1]) <= 18) { if (end) pts.push(T.slice()); else pts.unshift(T.slice()); return 1; }
      const S = [T[0], T[1] + Math.sign(N[1] - T[1]) * 14];
      if (end) pts.splice(L, 0, S.slice(), S.slice()); else pts.splice(1, 0, S.slice(), S.slice());
      return 2;
    };
    if (h.mode === 'seg') { a = i - 1; b = i; if (a === 0) { const k = lead(false); a += k; b += k; } if (b === pts.length - 1) lead(true); }
    else { if (i - 1 === 0) i += lead(false); if (i + 1 === pts.length - 1) lead(true); }
    edit = {
      key: wkey(w), mode: h.mode, a: a, b: b, i: i, p0: { x: p.x, y: p.y },
      before: w.pts.map(q => q.slice()), moved: false,
      horiz: h.mode === 'seg' ? isH(w.pts[h.i - 1], w.pts[h.i]) : null,
      prevH: h.mode === 'corner' ? isH(w.pts[h.i - 1], w.pts[h.i]) : null,
      nextH: h.mode === 'corner' ? isH(w.pts[h.i], w.pts[h.i + 1]) : null
    };
    w.pts = pts;
    need();
  }
  function moveEdit(p) {
    const w = wires.find(x => wkey(x) === edit.key); if (!w) { edit = null; return; }
    // 拖动范围 clamp 在画布内（practice.js:1135 是板坐标 812~1888 / 104~956，排位就是画布边界）
    const dx = Math.round(clamp(p.x, 6, BW - 6) - edit.p0.x), dy = Math.round(clamp(p.y, TOP, BH - 6) - edit.p0.y);
    if (!edit.moved && Math.hypot(dx, dy) < 4) return;
    edit.moved = true;
    const o = edit.orig || (edit.orig = w.pts.map(q => q.slice()));
    const q = o.map(v => v.slice());
    if (edit.mode === 'seg') { if (edit.horiz) q[edit.a][1] = q[edit.b][1] = o[edit.a][1] + dy; else q[edit.a][0] = q[edit.b][0] = o[edit.a][0] + dx; }
    else {
      const i = edit.i, nx = o[i][0] + dx, ny = o[i][1] + dy; q[i] = [nx, ny];
      if (edit.prevH) q[i - 1][1] = ny; else q[i - 1][0] = nx;
      if (edit.nextH) q[i + 1][1] = ny; else q[i + 1][0] = nx;
    }
    w.pts = q;
    need();
  }
  // 松手后整理：去掉重合的点和一条直线上多余的拐点（practice.js:1147 tidy）
  function tidyPts(pts) {
    let out = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
    out = out.filter((q, i) => i === 0 || i === out.length - 1 || !((q[0] === out[i - 1][0] && q[0] === out[i + 1][0]) || (q[1] === out[i - 1][1] && q[1] === out[i + 1][1])));
    return out;
  }
  function endEdit() {
    const e = edit; edit = null;
    const w = wires.find(x => wkey(x) === e.key); if (!w) return;
    if (!e.moved) { w.pts = e.before; need(); return; }
    w.pts = tidyPts(w.pts);
    EDIT_HIST.push({ key: e.key, pts: e.before, n: wires.length });
    w.fixedPts = w.pts;                                 // 学生调过的走线：端点不动就一直用它
    w.fixedSig = endSigOf(pinMap()[w.a], pinMap()[w.b]);
    say('走线已调整（撤销可恢复）', '');
    need();
  }
  /* 选中导线上的把手（practice.js:1165 drawEditHandles）：拐点是小方块，每段中间一道短杠 */
  function drawEditHandles() {
    if (!selWire) return;
    const w = wires.find(x => wkey(x) === selWire); if (!w || !w.pts) return;
    const col = ACC(), act = edit && edit.key === selWire;
    g.save(); g.shadowColor = col; g.shadowBlur = 10 * (TH.glow || 1);
    for (let i = 1; i < w.pts.length; i++) {
      const A = w.pts[i - 1], B = w.pts[i]; if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 22) continue;
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, h = isH(A, B);
      rrect(mx - (h ? 4 : 11), my - (h ? 11 : 4), h ? 8 : 22, h ? 22 : 8, 4, '#fff', col, 2);
    }
    for (let i = 1; i < w.pts.length - 1; i++) rrect(w.pts[i][0] - 6, w.pts[i][1] - 6, 12, 12, 3, act ? col : '#fff', col, 2);
    g.restore();
  }

  /* ── 判对：优先 SUPER_ALIAS（同型号置换），没有就 SUPER_WIRE.judge 兜底 ── */
  /* 传给判对组件的实例表：SUPER_ALIAS 读的是 it.type（器件类型）、it.form（外形）。
     页面里的实例是 {type: KINDS 的 key, dev, form}，所以这里必须映射一次：
       inst.type（'SBQ'）→ {type:'SB', form:'QUAD'}，否则它会按「SBQ 这个类型」去 SUPER_PARTS 里找，
       找不到；不传 form 又会按该类型所有形态的并集算端子（复合按钮会被当成同时有 i/o 和 ci/co/ai/ao）。 */
  function aliasInsts() {
    return insts.map(it => {
      const o = { name: it.name, type: it.dev };
      /* form 必须**原样**传，不能写 if (it.form)：'' 是假值，会被吃掉，
         普通按钮卡（form:''）于是又变回「未知形状」，pinsOfInst 走并集 → reason:'form' 永远不触发。
         语义：undefined/null = 还没定形状（按并集放过）；'' = 明确就是默认外形。 */
      o.form = it.form;
      return o;
    });
  }
  /* 降级提示：每道题只打第一条（切题后重新允许打一次），内容要能直接定位「是哪一环没到」 */
  const aliasWarned = {};
  function aliasWarn(why, e) {
    if (aliasWarned[DATA.task]) return;
    aliasWarned[DATA.task] = true;
    if (!(window.console && console.warn)) return;
    console.warn('[超级排位] 判对已降级到 SUPER_WIRE.judge：' + why,
      '| ALIAS', window.SUPER_ALIAS && window.SUPER_ALIAS.VERSION,
      '| SUPER_PARTS', !!window.SUPER_PARTS,
      '| SUPER_NETS', !!window.SUPER_NETS,
      '| SUPER_NETS[task]', !!(window.SUPER_NETS && window.SUPER_NETS[DATA.task]),
      '| task', DATA.task,
      '|', e && e.message);
  }
  function judgeNow() {
    const A = window.SUPER_ALIAS;
    if (A && typeof A.judgePlaced === 'function' && !aliasSlow && !aliasBroken) {
      /* 网表文件在、但这道题没有（P 除外，它本来就没有单一网表）：
         多半是新加了电路忘了跑 build-super-nets.cjs。这种不能静默，先把题号点出来。 */
      if (window.SUPER_NETS && !window.SUPER_NETS[DATA.task] && DATA.task !== 'P') {
        aliasWarn('这道题没有标准网表（重跑 build-super-nets.cjs？）', null);
      }
      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      try {
        const r = A.judgePlaced(wires, DATA.task, aliasInsts(), null);
        if (r && typeof r.ok === 'boolean') {
          // 每次改线都要算一遍进度；置换搜索一旦超过 60ms 就降级，别把界面卡住
          if (((window.performance && performance.now) ? performance.now() : Date.now()) - t0 > 60) aliasSlow = true;
          return Object.assign({ via: 'alias' }, r);
        }
      } catch (e) {
        // 降级一次就永久降级，所以这里留一条能看见的日志：分清是「文件没到」还是「数据没到」
        aliasBroken = true;
        aliasWarn('judgePlaced 抛错', e);
      }
    }
    if (!W) return null;
    return Object.assign({ via: 'wire' }, W.judge(wires, null, { nets: NETS || {} }));
  }
  const netTotal = () => (NETS ? Object.keys(NETS).length : 0);
  /* 这道题一共要接几根线（练习页「已接线 N/30」的分母，practice.js:670 的 BW.length）：
     每个点上 k 个端子串成一条链要 k−1 根，加起来 = BW.length（网表就是从 BW 生成的，口径一致）。 */
  const wireTotal = () => {
    if (!NETS) return 0;
    let n = 0;
    Object.keys(NETS).forEach(k => { n += Math.max(0, (NETS[k] || []).length - 1); });
    return n;
  };
  /* 进度口径（任务书 Q2 的延伸）：接通点数 = 标准网里「全部端子已经在同一个连通块」的个数。
     优先用判对结果反推（total − missing），这样 ALIAS 映射过的实例也能算对；
     判对组件不存在时才退回自己比 netsOf（那种情况下 FU 名字对不上，数字会偏低，见文件头）。 */
  function progress() {
    const total = netTotal();
    /* quiet = 批量灌线中（只有测试钩子会置位）：每接一根线都跑一遍置换搜索，
       E2 那种 20 万种排列的题会把端到端测试拖到几分钟，这里先只报 0。 */
    if (quiet) return { got: 0, total: total };
    const r = judgeNow();
    /* reason='count'/'form' 是 ALIAS 的「还没法判」（实例数量或触点形式对不上，它的 missing 是空数组）。
       这两条不能拿来反推进度（否则 0 根线也会显示全部接通），退回自己比 netsOf。 */
    const noJudge = r && (r.reason === 'count' || r.reason === 'form');
    if (r && Array.isArray(r.missing) && total && !noJudge) {
      return { got: Math.max(0, Math.min(total, total - r.missing.length)), total };
    }
    if (!W || !NETS) return { got: 0, total: total };
    const nets = W.netsOf(wires), where = {};
    nets.forEach((g, i) => g.forEach(t => { where[t] = i; }));
    let got = 0;
    Object.keys(NETS).forEach(n => {
      const want = NETS[n] || [];
      if (!want.length) return;
      const i = where[want[0]];
      if (i !== undefined && want.every(t => where[t] === i)) got++;
    });
    return { got: got, total: total };
  }
  function updateStat() {
    const p = progress();
    const tot = wireTotal();
    let t;
    if (window.innerWidth <= 520) {
      // 手机竖屏放不下全称，缩写成「30 线 · 接通 17/17 点」，口径完全一样
      t = wires.length + ' 线' + (tot ? '/' + tot : '') + ' · 接通 ' + (p.total ? p.got + '/' + p.total : '—') + ' 点';
    } else {
      // 「已接线 N/30」：和练习页 panelCount（practice.js:663）同一个分母口径；接通点数是排位自己的进度
      t = '已接线 ' + wires.length + (tot ? '/' + tot : ' 根') + ' · ' +
        (p.total ? ('接通 ' + p.got + '/' + p.total + ' 个点') : '无标准网表');
    }
    if (t !== statCache) { statCache = t; stat.textContent = t; }
  }

  /* ── 阶段切换 ── */
  function setPhase(next, msg) {
    phase = next;
    const on = next !== 'place';
    step.textContent = on ? '第二步：连线' : '第一步：摆放';
    step.classList.toggle('two', on);
    sub.textContent = on
      ? '点一个端子，再点另一个端子连一根线（也可以按住直接拖过去）；点已画的线选中，拖手柄调整走线'
      : '照着左边的电气原理图摆元器件：点左缘竖条开元器件库，拖到右边画布上';
    cv.classList.toggle('wire', on);
    arm = null; armDrag = null; hotPin = null; selWire = null; edit = null; errKeys = null;
    wireToolsShow(on);                 // 练习页那套工具圆盘 + 展开工具栏（提示/检查/答案三颗不建，见 §8.9）
    if (next === 'wire') { go.textContent = '检查'; go.classList.remove('done'); }
    if (next === 'place') { go.textContent = '我摆好了'; go.classList.remove('done'); }
    if (msg) say(msg, 'ok');
    updateStat();
    if (on) startLoop(); else need();     // 连线阶段逐帧重画（走线/光效/落位动画都要跑）
  }
  function enterWire() {
    if (phase !== 'place') return;
    /* P（并联专项）没有单一标准网表，SUPER_ALIAS.canJudge('P') === false，那一节只做摆放不做接线判分 */
    if (window.SUPER_ALIAS && typeof window.SUPER_ALIAS.canJudge === 'function' && !window.SUPER_ALIAS.canJudge(DATA.task)) {
      say('这道题只做摆放，不做接线判分', 'bad');
      return;
    }
    setPhase('wire');
    say('元件摆好了。按原理图把线接起来，接好点「检查」', 'ok');
  }

  /* ── 接 / 删 / 撤销 / 清空（交互口径 = practice.js）── */
  function touchWires() {
    if (phase === 'done') { phase = 'wire'; go.textContent = '检查'; go.classList.remove('done'); }
    errKeys = null;                        // 接线一变，查错的红标就失效（练习页是 PS.checked = null，同口径）
    if (selWire && !wires.some(w => wkey(w) === selWire)) selWire = null;
    updateStat();
    need();
  }
  /* 点第一个端子（practice.js:1207）：选中的端子一圈光点绕着转，同时进入「可拖 / 可再点」两种接法 */
  function startArm(pin) {
    arm = { id: pin.id, x: pin.x, y: pin.y };
    armDrag = { sx: pin.x, sy: pin.y, px: pin.x, py: pin.y, ex: pin.x, ey: pin.y, moved: false, snap: null, snapT: 0 };
    hotPin = null;
    say('已选 ' + pin.id + '，再点另一个端子连线（也可以直接拖过去）', '');
    fx('ripple', { x: pin.x, y: pin.y, col: ACC() });   // 起线的那一下：一圈涟漪（practice.js 的 ripple）
    startLoop();
    need();
  }
  function cancelArm(msg) {
    if (!arm && !armDrag) return;
    arm = null; armDrag = null; hotPin = null;
    if (msg) say(msg, '');
    need();
  }
  function penColOf(term) { return penColor === 'auto' ? wireColor(term) : netColor(penColor); }
  function connectTo(pin) {
    if (!arm) return;
    if (pin.id === arm.id) { cancelArm(null); return; }   // 再点自己 = 取消选中（practice.js:1206）
    if (!W) { cancelArm('连线组件没加载，先不能接线'); return; }
    const col = penColOf(arm.id);
    const r = W.addWire(wires, { a: arm.id, b: pin.id, color: col });
    if (r.ok) {
      arm = null; armDrag = null; hotPin = null; selWire = null; errKeys = null;
      syncRoutes();                       // 先把这根线的折线算出来（判对不看它，只用来画）
      const w = r.wire;
      if (w && w.pts) {
        bornWire(w);                      // 线缆落成折线的动画
        const m = pinMap(), p = m[w.a], q = m[w.b];
        if (p) fx('burst', { x: p.x, y: p.y, col: col });   // 两端粒子迸发
        if (q) fx('burst', { x: q.x, y: q.y, col: col });
        fx('sweep', { pts: w.pts, col: col });              // 亮光沿线跑一遍
      }
      say('已连线：' + r.wire.a + ' → ' + r.wire.b, 'ok');  // practice.js:463 的提示口径
      touchWires();
      return;
    }
    /* 失败时**不清掉起点**：学生点错了端子可以直接再点一个，不用从头开始（原行为保留）。
       文案照 practice.js:454-455。 */
    if (r.reason === 'dup') say('这两个端子之间已经有线了', 'bad');
    else if (r.reason === 'full') say(r.term + ' 已经接满两根线，换到同一个点的其他端子上接', 'bad');
    else if (r.reason === 'self') say('不能接自己', 'bad');
    else say('这两个端子接不了', 'bad');
    need();
  }
  /* 点已画的线 = **选中**（practice.js:1219-1221）：出白色编辑手柄可调整走线；删除走工具栏「删除」。
     —— 2026-11-09 用户原话「还变成再点一次就删除该线条」，已按练习页改回选中。 */
  function selectWire(w) {
    selWire = wkey(w);
    arm = null; armDrag = null; hotPin = null;
    say('已选中导线：拖横线段上下移、拖竖线段左右移、拖方块移动拐点；点「删除」可删除', '');
    need();
  }
  function delSelected() {
    if (!selWire) { say('先在板上点一下要删的线', 'bad'); return; }
    const w = wires.find(x => wkey(x) === selWire);
    if (!w) { selWire = null; return; }
    const p = pinById(w.a), q = pinById(w.b);
    if (p) fx('burst', { x: p.x, y: p.y, col: BADC() });
    if (q) fx('burst', { x: q.x, y: q.y, col: BADC() });
    if (W) W.removeWire(wires, { a: w.a, b: w.b });
    selWire = null;
    say('已删除选中的导线', '');
    touchWires();
  }
  /* 撤销（practice.js:1159 undoLast 同口径）：上一步是调整走线就恢复走线，否则撤掉最后一根线 */
  function undoWire() {
    const h = EDIT_HIST[EDIT_HIST.length - 1], w = h && wires.find(x => wkey(x) === h.key);
    if (h && w && h.n === wires.length) {
      EDIT_HIST.pop();
      w.pts = h.pts; w.fixedPts = h.pts;
      w.fixedSig = endSigOf(pinMap()[w.a], pinMap()[w.b]);
      say('已撤销走线调整', '');
      need();
      return;
    }
    EDIT_HIST.length = 0;
    if (!wires.length) return;            // practice.js:1162：没接过线时静默返回
    wires.pop();
    selWire = null;
    say('已撤销上一根线', '');
    touchWires();
  }
  /* 清空（practice-ui.js:317 长按确认的同一件事）：长按逻辑在工具栏按钮上，这里只做真清 */
  function clearWires() {
    if (!wires.length) return;
    wires.length = 0;
    selWire = null; errKeys = null; EDIT_HIST.length = 0;
    say('已清空全部导线，可以重新接线', '');
    touchWires();
  }
  /* 查错（排位口径：**只报红**，绝不给绿虚线 / 该连哪里的提示）。
     红线 = 判对结果里 wrong 的那几根（把两个不同电位连在一起的线）——和练习页 check.js
     「排位只报要删的线」同一个语义；练习页能给的「绿虚线该连哪」在排位里一律不给。 */
  function runErr() {
    if (!wires.length) { say('还没有接过线', 'bad'); return; }
    aliasSlow = false;
    const r = judgeNow();
    if (!r || r.reason === 'count' || r.reason === 'form') { say('还没法判：画布上的元件和这道题对不上', 'bad'); return; }
    const bad = (r.wrong || []);
    errKeys = new Set(bad);
    if (bad.length) {
      fx('flash', { col: BADC() });
      say('查错：有 ' + bad.length + ' 根线需要删除（红色高亮；其余的线都没接错）', 'bad');
    } else {
      errKeys = null;
      say('没有需要删除的线：已接的线都没有接错', 'ok');
    }
    need(); startLoop();
  }
  /* 元件被删 / 被重新摆过 → 端点已经不存在的线一起清掉（避免画出「半根线」） */
  function pruneWires() {
    if (!wires.length) return;
    const m = pinMap();
    for (let i = wires.length - 1; i >= 0; i--) {
      if (!m[wires[i].a] || !m[wires[i].b]) wires.splice(i, 1);
    }
    updateStat();
  }

  /* ── 端子层：练习页不画「额外的端子圆点」——端子就是元件上画出来的螺丝（partKM / partButton 自己画）。
     2026-11-09 用户原话「这触点全变了：每个端子都变成一个亮蓝色圆点」——那圈彩点是排位自己加的，
     已删掉。这里只剩选中端子的一圈光点（practice.js:775 halo(TP[PS.sel], TH.acc, t)）。 ── */
  function drawPins(t) {
    if (!arm) return;
    const p = pinById(arm.id);
    if (!p) return;
    halo([p.x, p.y], ACC(), t, 22, 10);
  }

  /* 段级连通微光（practice.js:725 wireLit）：这根线两端都接上了，就沿导线铺一圈静态底光，
     颜色跟这根线自己的线号走——接上就亮、删掉就灭，不判对错。 */
  function wireLit(pts, col) {
    g.save(); g.globalAlpha = 0.5; g.shadowColor = col; g.shadowBlur = 12 * Math.max(TH.glow || 1, 0.4);
    poly(pts, col, wireW + 5); g.restore();
  }
  /* 查错视图里的一根导线（practice.js:673 reviewWire 的「只报红」版）：
     错线红色高亮 + 白色流动虚线 + 两端红圈；其余的线压暗，绝不画绿虚线。 */
  function reviewWire(w, t) {
    const pts = w.pts, bad = errKeys && errKeys.has(wkey(w)), pz = 0.5 + 0.5 * Math.sin(t * 5);
    if (bad) {
      g.save(); g.shadowColor = BADC(); g.shadowBlur = (22 + 12 * pz) * Math.max(TH.glow || 1, 0.5);
      poly(pts, hxRgba(C.bad, 0.28 + 0.22 * pz), wireW + 12); poly(pts, C.bad, wireW + 2); g.restore();
      g.save(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([10, 14]); g.lineDashOffset = -t * 40;
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.restore();
      [pts[0], pts[pts.length - 1]].forEach(p => {
        g.save(); g.strokeStyle = BADC(); g.lineWidth = 3; g.shadowColor = BADC(); g.shadowBlur = 14;
        g.beginPath(); g.arc(p[0], p[1], 14 + 4 * pz, 0, 7); g.stroke(); g.restore();
      });
    } else {
      g.save(); g.globalAlpha = 0.16;
      poly(pts, WEDGE(), wireW + 2); poly(pts, w.color || wireColor(w.a), wireW); g.restore();
    }
  }

  /* 一根线：落位中按弧线画（发光大一点），落完是朴素折线 + 段级连通底光（practice.js:747-766 同一套） */
  function drawWireLayer(t) {
    syncRoutes();
    const rv = errKeys && errKeys.size;
    wires.forEach(w => {
      const pts = w.pts;
      if (!pts) return;
      const col = w.color || wireColor(w.a);
      if (w.born != null) {
        const k = (t - w.born) / 0.45;
        if (k < 1) {
          const e = backOut(clamp(k, 0, 1));
          const p2 = w.fromS.map((p, j) => [
            p[0] + (w.toS[j][0] - p[0]) * e,
            p[1] + (w.toS[j][1] - p[1]) * e
          ]);
          g.save(); g.shadowColor = col; g.shadowBlur = 16;
          poly(p2, WEDGE(), wireW + 2); poly(p2, col, wireW + 1); g.restore();
          return;
        }
        w.born = null;                       // 落完了，以后按普通折线画
      }
      if (rv) { reviewWire(w, t); return; }  // 查错只报红：错线红闪、其余压暗（不泄答案、不画绿）
      wireLit(pts, col);                     // 底光画在导线下面（practice.js:763 的画序）
      poly(pts, WEDGE(), wireW + 2);         // 导线描边：主题的 C.wireEdge（parts.js:179 同一枚令牌）
      poly(pts, col, wireW);
    });
    if (arm) drawCable(t);
    drawEditHandles();
  }

  /* 拉线中：从端子拉出一条下垂的弹性线缆，末端追着手指走、靠近端子磁吸（practice.js:796 drawCable）。
     只有真的拖起来（移动超 10px）才画——「点一下选中、再点一下连上」时不画线缆，和练习页一致。 */
  function drawCable(t) {
    const d = armDrag;
    if (!d || !d.moved) return;
    const p = pinById(arm.id);
    if (!p) { arm = null; armDrag = null; return; }
    const dm = dirMap(), da = dm[arm.id] || [0, 1];
    const tgt = d.snap ? [d.snap.x, d.snap.y] : [d.px, d.py];
    d.ex += (tgt[0] - d.ex) * 0.38;          // 末端追着目标走，吸附时有「被拉过去」的感觉（practice.js:799）
    d.ey += (tgt[1] - d.ey) * 0.38;
    const sag = 60 + Math.min(80, Math.hypot(d.ex - p.x, d.ey - p.y) * 0.18);   // practice.js:800 的下垂量
    const col = penColOf(arm.id);            // 拉的中途就按起点的线号取色，接上以后颜色不变
    const db = d.snap ? (dm[d.snap.id] || [0, 1]) : [0, 1];
    const pts = cablePts([p.x, p.y], [d.ex, d.ey],
      [p.x + da[0] * sag, p.y + da[1] * sag],
      d.snap ? [d.snap.x + db[0] * sag, d.snap.y + db[1] * sag] : [d.ex, d.ey + sag * 0.6]);
    g.save(); g.shadowColor = col; g.shadowBlur = 18 * Math.max(TH.glow || 1, 0.4);
    poly(pts, WEDGE(), wireW + 3); poly(pts, col, wireW + 1); g.restore();
    const hp = partial(pts, (t * 0.9) % 1), head = hp[hp.length - 1];
    g.save(); g.shadowColor = col; g.shadowBlur = 12; dot(head[0], head[1], 4, '#fff'); g.restore(); // 线缆上跑动的光点
    halo([p.x, p.y], col, t, 20, 8);
    if (d.snap) {
      // 磁吸目标：圆环收紧弹一下（practice.js:805-808）。排位提示是关着的，所以一律主题色、不出 √/×
      const k2 = clamp((t - d.snapT) / 0.3);
      g.save(); g.strokeStyle = ACC(); g.lineWidth = 3; g.shadowColor = ACC(); g.shadowBlur = 16 * Math.max(TH.glow || 1, 0.4);
      g.beginPath(); g.arc(d.snap.x, d.snap.y, 30 - 12 * backOut(k2), 0, 7); g.stroke(); g.restore();
    } else dot(d.ex, d.ey, 6, col);
  }

  /* ═══════════════ 9. 拖拽：库 → 画布（pointer 事件，鼠标 / 触摸同一套） ═══════════════ */
  let dragIt = null, ghost = null, ghostKey = null;
  /* 拖库卡片期间锁住抽屉：抽屉是「点画布空白自动收起」的，不锁的话卡片刚按住、
     手指一进画布空白就把抽屉收了 —— 用户就没法把元件拖出来了（2026-11-09 排版重做的关键约束）。
     锁到 pointerup（= HTML5 dragstart/dragend 的等价物）才解开。 */
  let libHold = false;

  function startGhost(key, ev) {
    ghostKey = key;
    ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.innerHTML = THUMB[key] ? '<img src="' + THUMB[key] + '" alt="">' : '';
    document.body.appendChild(ghost);
    moveGhost(ev.clientX, ev.clientY);
  }
  function moveGhost(x, y) { if (ghost) { ghost.style.left = (x - 48) + 'px'; ghost.style.top = (y - 34) + 'px'; } }
  function endGhost() { if (ghost) { ghost.remove(); ghost = null; } ghostKey = null; }

  const overStage = (x, y) => {
    const r = cv.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const overLib = (x, y) => {
    if (body.classList.contains('lib-min')) {
      /* 抽屉收着时整个被平移出屏幕，rect 永远不命中。之前直接 return false ——
         但抽屉在「点画布空白」时会顺手收起（下面 pointerdown 里的 setLib(false)），
         学生放多了想删的时候库往往已经收着，元件拖回去怎么都删不掉（2026-11-09 用户报）。
         收起时改认常驻竖条（orb，含老师把它拖到别处后的位置）：元件拖到竖条上 = 拖回库删除。 */
      const o = orb.getBoundingClientRect();
      return x >= o.left && x <= o.right && y >= o.top && y <= o.bottom;
    }
    const r = tb.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  lib.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    const key = card.dataset.k;
    card.classList.add('drag');
    libHold = true;                       // 拖卡片期间抽屉不自动收（见上面的说明）
    startGhost(key, e);
    let moved = false, last = { x: e.clientX, y: e.clientY };
    const move = ev => {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 3) moved = true;
      last = { x: ev.clientX, y: ev.clientY };
      moveGhost(ev.clientX, ev.clientY);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      card.classList.remove('drag');
      libHold = false;                    // 拖完了，允许自动收（不主动收：松手落元件的地方看得见）
      endGhost();
      const x = ev.clientX === undefined ? last.x : ev.clientX, y = ev.clientY === undefined ? last.y : ev.clientY;
      if (!moved || !overStage(x, y)) return;
      const p = toLocal(x, y);
      addAt(key, p.x, p.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  // 画布：摆放阶段按住元件拖动（松手在抽屉上 = 删掉）；连线阶段先点端子、长按才拖元件
  cv.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = toLocal(e.clientX, e.clientY);
    hover = p;

    /* 抽屉开着时点画布空白（没点在元件上）= 顺手把抽屉收了（拖卡片期间 libHold 锁住不收）。
       元件本体上不收 —— 学生可能正要搬它，收抽屉会闪一下。 */
    if (!body.classList.contains('lib-min') && !libHold && !hitTest(p.x, p.y)) setLib(false);

    if (phase !== 'place') {
      /* 连线阶段命中顺序（practice.js:1191-1221 同一套）：
         ① 选中的导线上按到手柄 → 开始拖走线（端子 12px 内仍归端子，practice.js:1197）
         ② 端子 → 选中 / 连线 / 再点自己取消（practice.js:1201-1209）
         ③ 手里还拉着线时点空白 → 取消（practice.js:1394 的点空白取消）
         ④ 已画的线 → **选中**（出编辑手柄），不是删除（practice.js:1219）
         ⑤ 点空白 → 取消选中 */
      if (selWire && edit) { e.preventDefault(); return; }   // 拖手柄的按下被 pointermove/up 接管
      const pin = pinHit(p.x, p.y, e);
      if (!pin && selWire) {
        const w = wires.find(x => wkey(x) === selWire);
        const h = w && editHit(w, p, e.pointerType === 'mouse' ? 8 : 16);
        if (h) { e.preventDefault(); startEdit(w, h, p); return; }
      }
      if (pin) {
        e.preventDefault();
        if (arm) connectTo(pin); else startArm(pin);
        return;
      }
      if (arm) { e.preventDefault(); cancelArm('取消这根线'); return; }
      const w = wireHit(p.x, p.y);
      if (w) { e.preventDefault(); selectWire(w); return; }
      if (selWire) { selWire = null; need(); }
    }

    const it = hitTest(p.x, p.y);
    if (!it) return;
    e.preventDefault();
    if (phase === 'place') beginDrag(it, p, e, false);
    else armLongPress(it, p, e);
  });

  /* 连线阶段为什么会拖动：学生这一步是「点端子」，手指落点常常压在元件本体上；
     按下即拖的话一滑就把摆好的布局弄乱。0.4 秒长按 = 学生明确表达了「我要搬它」，
     短点一下仍然走「点端子 / 点空白取消」。长按拖动松手后按 afterEdit 退回摆放阶段。 */
  function armLongPress(it, p, e) {
    let fired = false;
    const timer = setTimeout(() => { fired = true; beginDrag(it, p, e, true); }, 400);
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!fired && arm) cancelArm('取消这根线');
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function beginDrag(it, p, e, fromWire) {
    dragIt = it;
    const dx = it.x - p.x, dy = it.y - p.y;
    let moved = false, want = false;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    const move = ev => {
      const q = toLocal(ev.clientX, ev.clientY);
      if (!moved && (Math.abs(q.x - p.x) > 1 || Math.abs(q.y - p.y) > 1)) moved = true;
      /* 真正开始拖动的那一刻，如果库收着，给常驻竖条加个「回收」提示：
         竖条微放大泛红，学生才知道删元件是拖回这里（发现性问题，光有逻辑没用）。 */
      if (moved && !want) { want = true; if (body.classList.contains('lib-min')) orb.classList.add('want'); }
      it.x = q.x + dx; it.y = q.y + dy; clampInst(it);
      const del = overLib(ev.clientX, ev.clientY);
      tb.classList.toggle('del', del);
      orb.classList.toggle('del', del && body.classList.contains('lib-min'));
      need();
    };
    const up = ev => {
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { }
      dragIt = null; tb.classList.remove('del'); orb.classList.remove('del', 'want');
      if (overLib(ev.clientX, ev.clientY)) {
        const i = insts.indexOf(it);
        if (i >= 0) insts.splice(i, 1);
        /* 实例名是「同类第几只」现编的（FU1/FU2/…），删掉一只会让后面的全部改名，
           旧导线会静默接到另一只元件上 → 所以删元件时导线一起清空，宁可重接也别错接。 */
        const had = wires.length;
        if (had) wires.length = 0;
        syncLabels(); afterEdit(); pruneWires();
        say('已把 1 个' + KINDS[it.type].unit + '拖回元器件库（删除）' + (had ? '，导线也一起清空了' : ''), '');
      } else if (fromWire && moved) {
        afterEdit();
        say('元件位置动过了，退回摆放：摆好后重新点「我摆好了」', 'bad');
      }
      need();
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  /* 连线阶段跟随光标（practice.js:1223-1237 同一套）：
     · 拖手柄 → 改走线；· 拉线 → 线缆末端跟手、进磁吸圈就吸端子；
     · 鼠标的光标随手底下的东西换（端子 pointer、手柄 ns/ew-resize、拖动 grabbing）。 */
  cv.addEventListener('pointermove', e => {
    if (phase === 'place') return;
    const p = toLocal(e.clientX, e.clientY);
    hover = p;
    if (edit) { moveEdit(p); if (e.pointerType === 'mouse') cv.style.cursor = 'grabbing'; return; }
    const before = hotPin ? hotPin.id : null;
    hotPin = pinHit(p.x, p.y, e);
    if (arm && armDrag) {
      armDrag.px = p.x; armDrag.py = p.y;
      if (!armDrag.moved && Math.hypot(p.x - armDrag.sx, p.y - armDrag.sy) > 10) armDrag.moved = true;
      const sn = armDrag.moved ? pinHit(p.x, p.y, e, arm.id, SNAP_R(e)) : null;
      if (sn !== armDrag.snap) { armDrag.snap = sn; armDrag.snapT = nowSec(); }
    }
    if (arm && armDrag || before !== (hotPin ? hotPin.id : null)) need();
    if (e.pointerType === 'mouse') {
      const wsel = selWire && wires.find(x => wkey(x) === selWire);
      const h = wsel && !hotPin && editHit(wsel, p, 8);
      cv.style.cursor = armDrag && armDrag.moved ? 'grabbing'
        : h ? (h.mode === 'corner' ? 'move' : isH(wsel.pts[h.i - 1], wsel.pts[h.i]) ? 'ns-resize' : 'ew-resize')
        : hotPin ? 'pointer' : '';
    }
  });
  cv.addEventListener('pointerleave', () => {
    if (phase === 'place') return;
    hotPin = null;
    if (arm) need();
  });
  /* 松手（practice.js:1239-1250 endPress 同一套）：
     · 拖手柄松手 → 走线落定；· 拉线松手 → 吸在端子上就接上，没吸上就取消这半根线。 */
  function endPress(e) {
    if (phase === 'place') return;
    if (edit) { endEdit(); cv.style.cursor = ''; return; }
    const d = armDrag;
    if (!d) return;
    armDrag = null;
    if (d.moved) {
      if (d.snap && arm && e.type === 'pointerup') { connectTo(d.snap); return; }
      arm = null; hotPin = null;
      if (e.type === 'pointerup') say('没有接到端子上，已取消', '');
      need();
    }
  }
  cv.addEventListener('pointerup', endPress);
  cv.addEventListener('pointercancel', endPress);

  /* ═══════════════ 8.9 工具圆盘 + 展开工具栏 ═══════════════
     照 practice-ui.js 重排（用户原话「我的工具圆圈和展开后工具栏呢」）。差异只有一条：
     排位里「提示 / 检查 / 答案」三颗**一律不建**（practice-ui.js:309 的 __rankUI 在排位里也是藏这三颗），
     「查错」保留且只报红（见 runErr）。清空 = 长按 1 秒确认（practice-ui.js:317 同款），不再点两次。 */
  const FTB_KEY = 'zfz-super-ftb';
  let FTB = { x: null, y: null, collapsed: false, ox: null, oy: null };
  try { Object.assign(FTB, JSON.parse(localStorage.getItem(FTB_KEY) || '{}')); } catch (e) { }
  const ftbKeep = () => { try { localStorage.setItem(FTB_KEY, JSON.stringify(FTB)); } catch (e) { } };
  (function buildWireTools() {
    const css = `
  .ftb, .ftb-orb { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .ftb { position: fixed; z-index: 20; display: none; align-items: center; gap: 2px; padding: 4px; border-radius: 16px;
    background: linear-gradient(180deg, var(--tbbg), var(--tbbg2)); border: 1px solid var(--edge); color: var(--ink);
    box-shadow: 0 18px 40px -16px var(--tbsh), 0 0 0 1px rgba(255,255,255,.03) inset;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); max-width: calc(100vw - 24px); }
  .ftb.on { display: flex; }
  .ftb.dragging { transition: none; transform: scale(1.03); cursor: grabbing; }
  .ftb-grip { width: 16px; height: 34px; display: grid; place-items: center; cursor: grab; color: var(--dim); touch-action: none; border-radius: 10px; }
  .ftb-grip:hover { color: var(--ink); background: var(--tbhov); }
  .ftb-sep { width: 1px; height: 26px; background: var(--edge); margin: 0 2px; }
  .ftb-b { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    width: 42px; height: 42px; padding: 0; flex: 0 0 42px; min-width: 42px; border: 0; border-radius: 12px; background: transparent;
    color: var(--ink); font-weight: 600; font-size: 10px; line-height: 1; font-family: inherit; cursor: pointer;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    transition: background .16s, color .16s, transform .34s cubic-bezier(.34,1.56,.64,1), opacity .2s, box-shadow .2s; }
  .ftb-b svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  @media (hover: hover) { .ftb-b:hover:not(:disabled) { background: var(--tbhov); } }
  .ftb-b:active:not(:disabled) { transform: scale(.88); background: var(--tbhov); }
  .ftb-b:disabled { opacity: .38; filter: saturate(.2); cursor: not-allowed; }
  .ftb-b.holding { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); }
  .ftb-b .hold { position: absolute; inset: -3px; width: 48px; height: 48px; pointer-events: none; transform: rotate(-90deg); }
  .ftb-b .hold circle { fill: none; stroke: var(--bad); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 176; stroke-dashoffset: 176; transition: stroke-dashoffset .3s ease-out; }
  .ftb-b.holding .hold circle { stroke-dashoffset: 0; transition: stroke-dashoffset 1s linear; }
  .ftb-b .pdot { position: absolute; right: 9px; bottom: 19px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--tbbg); }
  /* 圆球（收起后）：22px 小点 + 44px 热区 + 4 秒「工具」小标签（practice-ui.js:148-162 同款） */
  .ftb-orb { position: fixed; z-index: 20; width: 22px; height: 22px; opacity: .82; border-radius: 50%; display: none; place-items: center;
    cursor: pointer; touch-action: none; background: radial-gradient(circle at 35% 30%, var(--tbbg), var(--tbbg2));
    border: 1px solid var(--edge); color: var(--ink);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--acc) 20%, transparent), 0 8px 18px -8px var(--tbsh), 0 0 14px -6px var(--acc);
    transition: transform .35s cubic-bezier(.34,1.56,.64,1), opacity .25s; animation: ftbPulse 2.6s ease-in-out infinite; }
  .ftb-orb.on { display: grid; }
  .ftb-orb.hide { opacity: 0; transform: scale(.3); pointer-events: none; }
  .ftb-orb.dragging { transition: none; animation: none; transform: scale(1.08); }
  .ftb-orb svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .ftb-orb::before { content: ''; position: absolute; inset: -11px; border-radius: 50%; }
  .ftb-orb::after { content: '工具'; position: absolute; left: 50%; top: calc(100% + 5px); transform: translateX(-50%);
    padding: 2px 7px; border-radius: 7px; font-size: 10px; font-weight: 800; letter-spacing: .5px; white-space: nowrap;
    color: var(--tbbg); background: var(--acc); opacity: 0; transition: opacity .3s; pointer-events: none; }
  .ftb-orb.hint::after { opacity: 1; }
  @keyframes ftbPulse { 50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 20%, transparent), 0 12px 30px -10px var(--tbsh), 0 0 34px -2px var(--acc); } }
  /* 弹出面板（线色 / 主题） */
  .ftb-pop { position: fixed; z-index: 30; padding: 14px; border-radius: 20px; min-width: 240px; color: var(--ink);
    background: linear-gradient(180deg, var(--tbbg), var(--tbbg2)); border: 1px solid var(--edge);
    box-shadow: 0 24px 50px -18px var(--tbsh); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif; animation: ftbPop .32s cubic-bezier(.34,1.56,.64,1); }
  @keyframes ftbPop { from { opacity: 0; transform: scale(.85); } }
  .ftb-pop h4 { margin: 4px 2px 10px; font-size: 13px; color: var(--dim); font-weight: 700; letter-spacing: .5px; }
  .ftb-pop .row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .ftb-pop .row:last-child { margin-bottom: 2px; }
  .fchip { display: flex; flex-direction: column; align-items: center; gap: 5px; width: 54px; padding: 8px 0 6px; border-radius: 14px;
    border: 1px solid transparent; background: transparent; color: var(--ink); font-weight: 600; font-size: 12px; font-family: inherit;
    cursor: pointer; transition: background .16s, transform .3s cubic-bezier(.34,1.56,.64,1), border-color .16s; touch-action: manipulation; }
  .fchip:hover { background: var(--tbhov); } .fchip:active { transform: scale(.9); }
  .fchip.sel { border-color: var(--acc); background: var(--tbhov); }
  .fchip .c { width: 26px; height: 26px; border-radius: 50%; box-shadow: 0 0 0 2px var(--tbbg), 0 0 0 3px var(--edge); }
  .fchip .ln { width: 40px; border-radius: 9px; }
  .fchip .th { width: 44px; height: 30px; border-radius: 9px; border: 1px solid var(--edge); }
  @media (max-width: 560px) {
    .ftb { gap: 2px; } .ftb-b { width: 40px; height: 40px; flex-basis: 40px; min-width: 40px; border-radius: 11px; font-size: 9.5px; }
    .ftb-b svg { width: 18px; height: 18px; }
  }
  @media (prefers-reduced-motion: reduce) { .ftb, .ftb-orb, .ftb-b, .ftb-pop, .fchip { transition: none !important; animation: none !important; } }
  `;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

    const I = {
      grip: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
      undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
      del: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
      clear: '<svg viewBox="0 0 24 24"><path d="M16 3l5 5-11 11H5v-5z"/><path d="M13.5 5.5l5 5"/><path d="M4 21h16"/></svg>',
      err: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.8-4.8"/><path d="M8 11h6"/></svg>',
      pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
      theme: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" style="fill:currentColor"/></svg>',
      full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      min: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
      tools: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><circle cx="9" cy="7" r="2.1" style="fill:currentColor;stroke:none"/><circle cx="15" cy="12" r="2.1" style="fill:currentColor;stroke:none"/><circle cx="9" cy="17" r="2.1" style="fill:currentColor;stroke:none"/></svg>'
    };
    const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls || '', innerHTML: html || '' });
    const tb = el('div', 'ftb'), orb = el('div', 'ftb-orb', I.tools);
    orb.title = '工具栏收起来了，点一下展开（按住可以拖到别处）';
    orb.setAttribute('role', 'button'); orb.setAttribute('aria-label', '展开工具栏');
    document.body.append(tb, orb);

    const grip = el('div', 'ftb-grip', I.grip); grip.title = '按住拖动，松手停在原地';
    const B = {};
    const btn = (k, icon, label, tip) => {
      const b = el('button', 'ftb-b', `<span class="ic">${icon}</span><span class="lb">${label}</span>`);
      b.type = 'button'; b.setAttribute('aria-label', tip || label); b.title = tip || label; B[k] = b; return b;
    };
    btn('undo', I.undo, '撤销', '撤销上一根线（或上一次走线调整）');
    btn('del', I.del, '删除', '删除选中的那根线（先在板上点一下线）');
    btn('clear', I.clear, '清空', '长按 1 秒清空全部导线');
    B.clear.insertAdjacentHTML('beforeend', '<svg class="hold" viewBox="0 0 62 62"><circle cx="31" cy="31" r="28"/></svg>');
    btn('err', I.err, '查错', '查错：只指出哪根线要删（红色高亮），不给该连哪里的提示');
    btn('pen', I.pen, '线色', '线色与线宽');
    btn('theme', I.theme, '主题', '切换主题（适应不同光线）');
    btn('full', I.full, '全屏', '全屏');
    btn('min', I.min, '收起', '收成一个圆球');
    const pdot = el('span', 'pdot'); B.pen.appendChild(pdot);
    tb.append(grip, B.undo, B.del, B.clear, B.err, el('div', 'ftb-sep'), B.pen, B.theme, B.full, el('div', 'ftb-sep'), B.min);

    B.undo.onclick = () => { closePop(); cancelArm(null); undoWire(); };
    B.del.onclick = () => { closePop(); cancelArm(null); delSelected(); };
    /* 清空：长按确认（practice-ui.js:317-328 同款），外圈走满 1 秒才真清 */
    let holdT = 0;
    const holdStart = e => {
      if (!wires.length) return; e.preventDefault();
      B.clear.classList.add('holding'); say('按住不放，外圈走满就清空；中途松手取消', 'bad');
      holdT = setTimeout(() => {
        B.clear.classList.remove('holding');
        cancelArm(null); clearWires();
        B.clear.style.transform = 'scale(.88)';
        setTimeout(() => B.clear.style.transform = '', 180);
      }, 1000);
    };
    const holdEnd = () => { if (holdT) clearTimeout(holdT); holdT = 0; B.clear.classList.remove('holding'); };
    B.clear.addEventListener('pointerdown', holdStart);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => B.clear.addEventListener(t, holdEnd));
    B.clear.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    B.clear.style.touchAction = 'none';
    B.err.onclick = () => { closePop(); cancelArm(null); runErr(); };
    B.full.onclick = () => {
      const req = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
      try {
        document.fullscreenElement || document.webkitFullscreenElement
          ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
          : req.call(document.documentElement);
      } catch (e) { }
    };
    /* 收起瞬间给圆钮挂 4 秒「工具」标签（practice-ui.js:368-375 同款） */
    let orbHintT = 0;
    const orbHint = () => { orb.classList.add('hint'); clearTimeout(orbHintT); orbHintT = setTimeout(() => orb.classList.remove('hint'), 4200); };
    B.min.onclick = () => { closePop(); FTB.collapsed = true; ftbKeep(); wireToolsShow(true); orbHint(); };

    /* 弹出面板：线色线宽 / 主题（practice-ui.js:407-428 的精简版，样式统一走主题令牌） */
    let pop = null;
    function closePop() { if (!pop) return; const p = pop; pop = null; p.remove(); B.pen.classList.remove('sel'); B.theme.classList.remove('sel'); }
    function openPop(anchor, build) {
      const was = pop && pop.anchor === anchor; closePop(); if (was) return;
      pop = el('div', 'ftb-pop'); pop.anchor = anchor; build(pop); document.body.appendChild(pop); anchor.classList.add('sel');
      const a = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect(), m = 12;
      let x = a.left + a.width / 2 - p.width / 2, y = a.bottom + m;
      x = Math.max(8, Math.min(innerWidth - p.width - 8, x));
      y = Math.max(8, Math.min(innerHeight - p.height - 8, y));
      Object.assign(pop.style, { left: x + 'px', top: y + 'px' });
    }
    addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !e.target.closest('.ftb-b')) closePop(); }, true);
    const chip = (cls, inner, label, sel, act) => {
      const c = el('button', 'fchip ' + cls + (sel ? ' sel' : ''), inner + `<span>${label}</span>`);
      c.type = 'button';
      c.onclick = () => { act(); c.parentNode.querySelectorAll('.fchip').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); };
      return c;
    };
    B.pen.onclick = () => openPop(B.pen, p => {
      p.append(el('h4', '', '线色（接下一根线用）'));
      const r1 = el('div', 'row');
      PALETTE.forEach(([k, name]) => r1.append(chip('', `<span class="c" style="background:${k === 'auto' ? 'conic-gradient(' + C.L1 + ' 0 25%,' + C.L2 + ' 0 50%,' + C.L3 + ' 0 75%,' + C.N + ' 0)' : netColor(k)}"></span>`, name, penColor === k, () => { penColor = k; savePen(); })));
      p.append(r1);
      p.append(el('h4', '', '线宽（坐得远看不清就调粗）'));
      const r3 = el('div', 'row');
      WIRE_SIZES.forEach(([v, name]) => r3.append(chip('', `<span class="ln" style="height:${v}px;background:var(--ink)"></span>`, name, wireW === v, () => { wireW = v; savePen(); })));
      p.append(r3);
    });
    B.theme.onclick = () => openPop(B.theme, p => {
      p.append(el('h4', '', '主题（按教室光线选）'));
      const r = el('div', 'row');
      Object.keys(THEMES).forEach(k => {
        const t = THEMES[k];
        r.append(chip('', `<span class="th" style="background:linear-gradient(135deg, ${t.TH.bg} 55%, ${t.TH.acc})"></span>`, t.name, themeName === k, () => {
          applyTheme(k); syncCss(); makeThumbs(); buildLib(); need();
          say('已切换到「' + t.name + '」主题', 'ok');
        }));
      });
      p.append(r);
    });

    /* 摆放 / 收起：位置自由（不吸边），存 localStorage（排位自己的键） */
    function placeTb() {
      const w = tb.offsetWidth, h = tb.offsetHeight;
      let x = FTB.x != null ? FTB.x : innerWidth - w - 16;
      let y = FTB.y != null ? FTB.y : 54;
      x = Math.max(6, Math.min(innerWidth - w - 6, x));
      y = Math.max(6, Math.min(innerHeight - h - 6, y));
      tb.style.left = x + 'px'; tb.style.top = y + 'px';
    }
    function placeOrb() {
      const w = orb.offsetWidth, h = orb.offsetHeight;
      let x = FTB.ox != null ? FTB.ox : innerWidth - w - 14;
      let y = FTB.oy != null ? FTB.oy : 60;
      x = Math.max(4, Math.min(innerWidth - w - 4, x));
      y = Math.max(4, Math.min(innerHeight - h - 4, y));
      orb.style.left = x + 'px'; orb.style.top = y + 'px';
    }
    function draggable(node, handle, onTap) {
      handle.addEventListener('pointerdown', e => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault(); closePop();
        try { handle.setPointerCapture(e.pointerId); } catch (err) { }
        const r = node.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top, sx = e.clientX, sy = e.clientY;
        let moved = false;
        const mv = ev => {
          if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          moved = true; node.classList.add('dragging');
          node.style.left = (ev.clientX - dx) + 'px'; node.style.top = (ev.clientY - dy) + 'px';
        };
        const up = () => {
          handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
          node.classList.remove('dragging');
          const b = node.getBoundingClientRect();
          if (!moved) { if (onTap) onTap(); return; }
          if (node === orb) { FTB.ox = Math.round(b.left); FTB.oy = Math.round(b.top); }
          else { FTB.x = Math.round(b.left); FTB.y = Math.round(b.top); }
          ftbKeep();
        };
        handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
      });
    }
    draggable(tb, grip);
    draggable(orb, orb, () => { FTB.collapsed = false; ftbKeep(); wireToolsShow(true); });
    addEventListener('resize', () => { placeTb(); placeOrb(); });

    /* 阶段开关：只有连线阶段出现（setPhase 调 wireToolsShow） */
    function show(on) {
      closePop();
      tb.classList.toggle('on', !!(on && !FTB.collapsed));
      orb.classList.toggle('on', !!(on && FTB.collapsed));
      if (on) { placeTb(); placeOrb(); }
    }
    /* 按钮可用态跟着接线走（practice-ui.js:559 sync 的精简版），连线阶段每帧刷一次 */
    function sync() {
      B.undo.disabled = !wires.length;
      B.del.disabled = !selWire;
      B.clear.disabled = !wires.length && !B.clear.classList.contains('holding');
      B.err.disabled = !wires.length;
      pdot.style.background = penColor === 'auto' ? C.ink : netColor(penColor);
    }
    window.__wireToolsShow = show;
    window.__ftbSync = sync;
    window.__wireTools = tb;                        // 调试 / 验收钩子
  })();
  const wireToolsShowRef = on => { try { window.__wireToolsShow(!!on); } catch (e) { } };
  function wireToolsShow(on) { wireToolsShowRef(on); }
  function ftbSync() { try { window.__ftbSync(); } catch (e) { } }

  /* ═══════════════ 10. 摆放校验（种类 + 个数；不说位置、不给正确答案） ═══════════════ */
  /* 两道关，顺序不能反：
     ① super-data.js 的 SUPER.check(list, id)：种类 = 器件类型、个数 = parts —— **唯一权威**。
        传进去的每一项是 {key: inst.dev}，所以复合按钮和单触点按钮都算「一只 SB」。
        ★ 这道闸不要动：FU 在网表里只有 FU1（三极并排）+ FU2（+E1 的 FU2b）三个代号，
          parts 里却是 4/5 件，planOf() 专门为它退回「默认外形 + 件数取 parts」；
          改成按代号数就会把八条电路全部误报「熔断器多放/少放」。
     ② 外形对不对：按「器件类型 + 端子集签名」比对（见 sigOf），不按 KINDS 名：
        aux / auxBelow 端子 id 完全相同、M 默认 / BOX6B 也完全相同，只是画法不同，
        学生选了另一种画法不该判错；而 SB 的 i,o vs ci,co,ai,ao、QF 四极 8 端 vs 三极 6 端、
        KT 三档这些**端子真的不一样**的，仍然严格相等。
        ①过了②没过 = 元件挑错型号，直接说清楚，别让学生进到连线阶段才发现。
     提示只用「还差 N 个X / X 多放了 N 个」，不说总共要几个、不说放哪。 */
  let solved = false;
  function say(msg, cls) {
    toast.textContent = msg;
    toast.className = 'toast on' + (cls ? ' ' + cls : '');
  }
  function hideSay() { toast.className = 'toast'; toast.textContent = ''; }
  // 器件类型 → 提示里的说法（只取第一张同名卡片的说法，比如 QF/QF3P 都是「低压断路器」）
  function unitOfDev(dev) {
    for (const k in KINDS) if (KINDS[k].dev === dev) return KINDS[k].unit;
    return (SP && SP[dev] && SP[dev].name) || dev;
  }
  /* 摆放提示里「差的是哪种外形」的说法（比 unit 细一档：单触点按钮 / 复合按钮、带辅助的接触器…）。
     只影响提示文案，不影响判对。 */
  const HINT_NAME = {
    QF: '低压断路器（四极）', QF3P: '三极断路器',
    KM: '交流接触器（不带辅助）', KMAUX: '交流接触器（带辅助常闭 21/22）', KMAUXB: '交流接触器（带下排辅助触头）',
    SB: '按钮（单触点）', SBr: '停止按钮（红色单触点）', SBQ: '复合按钮', SBQr: '复合停止按钮（红色）',
    KT: '时间继电器（6 端）', KT4: '时间继电器（4 端）', KT2R: '时间继电器（两排）',
    M: '电动机接线盒（6 孔）', MBOX6B: '双速电动机接线盒', MBOX3: '电动机接线盒（3 孔）',
    VD: '整流二极管', VDV2: '整流二极管（竖放）'
  };
  const hintOf = k => HINT_NAME[k] || CARD_NAME[k] || (KINDS[k] ? KINDS[k].unit : k);
  /* 端子集签名：**器件类型 + 排序后的端子 id**。
     · 带 dev 是因为 R / VD / XT 都是 t,b 两端，不带上类型会把它们当成同一种；
     · 不带 form 是因为 aux 与 auxBelow、M 默认与 BOX6B 的端子 id 完全一样，只是画法不同，
       学生选了另一张卡不该判错（点位上确实接得出来）。 */
  const sigOf = k => KINDS[k].dev + '|' + Object.keys(KINDS[k].pins()).sort().join(',');
  // {kind: 件数} → {签名: {n, kinds:[该签名下出现过的 kind]}}
  function sigCount(byKind) {
    const out = {};
    Object.keys(byKind).forEach(k => {
      if (!byKind[k] || !KINDS[k]) return;
      const s = sigOf(k);
      if (!out[s]) out[s] = { n: 0, kinds: [] };
      out[s].n += byKind[k];
      if (out[s].kinds.indexOf(k) < 0) out[s].kinds.push(k);
    });
    return out;
  }
  // 签名下可能有多种画法：只有一种就直说，多种就并列（「A」或「B」）
  const kindNames = ks => ks.length === 1 ? hintOf(ks[0]) :
    '「' + ks.map(hintOf).join('」或「') + '」';
  function afterEdit() {                       // 摆完（或连完）又动了元件：退回「我摆好了」
    if (phase !== 'place') {                   // 连线阶段被动过 → 整页退回第一步（线保留，端点已 prune）
      setPhase('place');
      pruneWires();
    }
    if (solved) {
      solved = false;
      go.textContent = '我摆好了';
      go.classList.remove('done');
      hideSay();
    }
  }
  function check() {
    if (!insts.length) { say('画布上还没有元件：点左缘竖条打开元器件库，把元件拖到待布置区', 'bad'); return; }
    const gotDev = {}, gotKind = {};
    insts.forEach(it => {
      gotDev[it.dev] = (gotDev[it.dev] || 0) + 1;
      gotKind[it.type] = (gotKind[it.type] || 0) + 1;
    });

    /* ── ① 种类 + 个数（super-data.js 的口径） ── */
    let dr = null;
    if (window.SUPER && typeof window.SUPER.check === 'function') {
      try { dr = window.SUPER.check(insts.map(it => ({ key: it.dev })), DATA.task); } catch (e) { dr = null; }
    }
    if (dr) {
      if (!dr.ok) {
        const miss = (dr.miss || []).map(x => '还差 ' + (x.need - x.have) + ' 个' + unitOfDev(x.key));
        const extra = (dr.extra || []).map(x => unitOfDev(x.key) + '多放了 ' + (x.have - x.need) + ' 个');
        say(miss.concat(extra).join('，'), 'bad');
        return;
      }
    } else {
      /* 数据文件没取到时的兜底：只比 TASK.parts（种类 + 个数），外形就不管了 */
      const need = TASK.parts || {}, miss = [], extra = [];
      Object.keys(need).forEach(dev => {
        const d = need[dev] - (gotDev[dev] || 0);
        if (d > 0) miss.push('还差 ' + d + ' 个' + unitOfDev(dev));
      });
      Object.keys(gotDev).forEach(dev => {
        const d = gotDev[dev] - (need[dev] || 0);
        if (d > 0) extra.push(unitOfDev(dev) + '多放了 ' + d + ' 个');
      });
      if (miss.length || extra.length) { say(miss.concat(extra).join('，'), 'bad'); return; }
    }

    /* ── ② 外形：按「器件类型 + 端子集签名」比对 ── */
    const need2 = sigCount(planOf(DATA.task)), got2 = sigCount(gotKind), miss2 = [], extra2 = [];
    Object.keys(need2).forEach(s => {
      const d = need2[s].n - ((got2[s] && got2[s].n) || 0);
      if (d > 0) miss2.push('还差 ' + d + ' 个' + kindNames(need2[s].kinds));
    });
    Object.keys(got2).forEach(s => {
      const d = got2[s].n - ((need2[s] && need2[s].n) || 0);
      if (d > 0) extra2.push(kindNames(got2[s].kinds) + '多放了 ' + d + ' 个');
    });
    if (miss2.length || extra2.length) { say(miss2.concat(extra2).join('，'), 'bad'); return; }

    solved = true;
    if (canJudge()) {
      say('元件摆放完成，可以开始连线', 'ok');
      go.textContent = '开始连线';
    } else {
      // P（并联专项）没有单一标准网表：摆对就够了，不判连线
      say('元件摆放完成。这道题只练摆放，暂不判连线', 'ok');
      go.textContent = '暂不判连线';
    }
    go.classList.add('done');
  }
  go.addEventListener('click', () => {
    if (phase === 'place') {
      if (!solved) { check(); return; }
      if (!canJudge()) { say('这道题只练摆放：元件摆对了就行，暂不判连线', 'ok'); return; }
      enterWire();
      return;
    }
    if (phase === 'wire') { checkWires(); return; }
    say('接线完成，正确', 'ok');
  });

  /* ═══════════════ 10.5 连线校验（Q2：只报进度，不报答案） ═══════════════ */
  function checkWires() {
    /* 「检查」是学生的一次明确动作，必须给准话：先把 judgeNow 里那个「搜索太慢就降级」的开关清掉。
       否则在 E2 那种大搜索的题上，接线过程中只要有**一次**超过 60ms，就会永久降级到
       SUPER_WIRE.judge（它只认教材端子名），学生接得再对也判不过。 */
    aliasSlow = false;
    const r = judgeNow();
    if (!r) { say('判对组件没加载（super-wire.js 没取到），先不能检查', 'bad'); return; }
    if (r.reason === 'count' || r.reason === 'form') {
      // 元件数量 / 触点形式和这道题对不上（正常流程走不到：摆放已经判过了）
      say('还没法判：画布上的元件和这道题要的型号对不上', 'bad');
      updateStat();
      return;
    }
    if (r.ok) {
      phase = 'done';
      go.textContent = '完成';
      go.classList.add('done');
      fx('scan', { col: C.ok });               // 检查通过：一道绿光从上往下扫过画布（practice.js:185）
      say('接线完成，正确', 'ok');
      updateStat(); need();
      return;
    }
    /* 只给「还差多少」，网名 / 端子名 / 哪一根错了一个字都不说。
       数字都是数出来的：missing = 没接通的点，wrong = 跨点接错的线，open = 一根线都没接的端子。
       画面也照这条口径来：只让整块画布红闪一下（不给哪根线、哪个端子打红圈，那等于泄题）。 */
    fx('flash', { col: BADC() });
    const m = (r.missing || []).length, w = (r.wrong || []).length, o = (r.open || []).length;
    const seg = [];
    if (m) seg.push('还有 ' + m + ' 个点没接通');
    if (w) seg.push('有 ' + w + ' 根线把两个不同电位连在了一起');
    if (o) seg.push('还有 ' + o + ' 个端子没接线');
    if (!seg.length) seg.push('还没接通，继续接');
    say(seg.join('，') + '。', 'bad');
    updateStat();
  }

  /* ═══════════════ 11. 元器件库抽屉的开关（左缘常驻竖条；位置记 localStorage，照 .tb-orb 的交互） ═══════════════ */
  const ORB_KEY = 'zfz-super-tb-orb';
  /* 开/收抽屉的唯一入口：body.lib-min = 收起（CSS 把抽屉平移出屏幕 + pointer-events:none）。
     页面默认收起（boot 里 setLib(false)），点竖条 / 点抽屉标题的关闭钮开。 */
  function setLib(open) {
    body.classList.toggle('lib-min', !open);
    orb.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function placeOrb(x, y) {
    x = clamp(x, 0, Math.max(0, window.innerWidth - 52));
    y = clamp(y, 4, Math.max(4, window.innerHeight - 146));
    orb.style.left = x + 'px'; orb.style.top = y + 'px';
  }
  function loadOrb() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(ORB_KEY) || 'null'); } catch (e) { p = null; }
    if (p && isFinite(p.x) && isFinite(p.y)) placeOrb(p.x, p.y);
    else placeOrb(0, Math.round(window.innerHeight * 0.34) - 70);   // 默认贴左缘、偏上一点
  }
  function saveOrb() {
    try {
      localStorage.setItem(ORB_KEY, JSON.stringify({
        x: Math.round(parseFloat(orb.style.left) || 0), y: Math.round(parseFloat(orb.style.top) || 0)
      }));
    } catch (e) { }
  }
  $('tbMin').addEventListener('click', () => { setLib(false); need(); });
  // Esc 收抽屉（连线阶段 Esc 不抢「取消拉线」：这里只收抽屉，拉线的取消仍靠点空白）
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !body.classList.contains('lib-min')) setLib(false);
  });
  (function orbDrag() {
    let st = null;
    orb.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const r = orb.getBoundingClientRect();
      st = { x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
      try { orb.setPointerCapture(e.pointerId); } catch (err) { }
      orb.classList.add('dragging');
    });
    orb.addEventListener('pointermove', e => {
      if (!st) return;
      if (!st.moved && Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 5) st.moved = true;
      if (st.moved) placeOrb(e.clientX - st.dx, e.clientY - st.dy);
    });
    const up = e => {
      if (!st) return;
      const s = st; st = null;
      orb.classList.remove('dragging');
      try { orb.releasePointerCapture(e.pointerId); } catch (err) { }
      if (!s.moved) {
        setLib(body.classList.contains('lib-min'));   // 点一下 = 开关抽屉（原来是只能展开）
        need();
        return;
      }
      saveOrb();
    };
    orb.addEventListener('pointerup', up);
    orb.addEventListener('pointercancel', up);
  })();
  /* 原理图左列的折叠：点卡片标题整列缩成一条横杆（body.sch-min）。
     手机（≤900px）默认折叠 —— 竖屏要先把高度全给画布；桌面默认展开。 */
  (function schFold() {
    const hd = $('schHd');
    if (!hd) return;
    hd.addEventListener('click', () => {
      body.classList.toggle('sch-min');
      fit();          // 手机上原理图条高度变了 → 画布 flex:1 高度跟着变，要重算画布尺寸
    });
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) body.classList.add('sch-min');
  })();

  /* ═══════════════ 12. 电气原理图：直接调用各题练习页的原画法 ═══════════════
     ★ 用户判罚第一条「电路图完全不能变」。所以这里**不画**原理图，只负责把原函数请进来：
       schview.html 按 ?id= 动态加载该题的 circuitXX.js，然后调它自己的 drawSchematic —— 同一套
       符号、同一套字号、同一套线号位置、同一套缩放规则（practice.js layoutAll 的 min((宽-16)/dw,(高-16)/dh)），
       连卡片都是 theme.js 的 glass()。所以超级排位右上角那块 = 练习页左栏那张图，一个像素都不差。
     ★ 原来这里有一个 1000×340 的自绘 SVG（只画 2.2，颜色还写死 #111827 / #475569 / #9f1239），
       那是「另起一套」，和练习页对不上，整段删掉。
     ★ 只有 P（并联专项）没有对应电路脚本，那一题保留一句说明。 */
  function schBody() {
    const id = DATA.task;
    if (id === 'P') {
      return '<div class="sch-ph">' +
        '<b>并联专项练习</b>' +
        '<em>这道题练的是「同一电位的多根线并联」，没有单一原理图；元件摆对就算过，暂不判连线。</em>' +
        '</div>';
    }
    const c = (CIRC && CIRC[id]) || {};
    // title 给读屏 / 长按提示用；画（canvas）在 iframe 里，主题同样读 zfz-practice-theme
    return '<iframe class="sch-f" src="schview.html?id=' + encodeURIComponent(id) + '" title="' +
      esc((c.name || id) + ' 电气原理图') + '" scrolling="no"></iframe>';
  }

  /* ═══════════════ 12.8 切题 ═══════════════ */
  /* 切题必须清空画布和导线：实例名是「同类第几只」现编的（FU1/FU2…），换一道题之后
     旧实例的代号和新题的标准网表毫无关系，留着只会判出一堆莫名其妙的错。 */
  function setTask(id) {
    if (!DATA.tasks[id] || id === DATA.task) return false;
    DATA.task = id;
    TASK = DATA.tasks[id];
    NETS = NETS_ALL[id] || null;
    LIB = libOf(id);
    insts.length = 0; wires.length = 0; uid = 0;
    solved = false; aliasSlow = false; aliasBroken = false; quiet = false;
    arm = null; armDrag = null; hover = null; hotPin = null; selWire = null; edit = null; errKeys = null; statCache = '';
    EDIT_HIST.length = 0;
    $('tsk').textContent = TASK.title || id;
    $('schT').textContent = TASK.sch || TASK.title;
    $('sch').innerHTML = schBody();
    buildLib();
    setPhase('place');
    syncLabels();          // 「已摆 0 个元件」
    if (tPick) tPick.value = id;
    need();
    say('已切到「' + (TASK.short || TASK.name || id) + '」：画布和导线都清空了', '');
    return true;
  }
  let tPick = null;

  /* ═══════════════ 13. 启动 ═══════════════ */
  function boot() {
    readData();          // ← 先读 super-data.js / super-nets.js（它们是运行时才到的）
    tPick = $('tPick');
    const ids = Object.keys(DATA.tasks);
    if (tPick) {
      tPick.innerHTML = ids.map(id => {
        const t = DATA.tasks[id];
        return '<option value="' + esc(id) + '">' + esc(id + ' ' + (t.short || t.name || '')) +
          (NETS_ALL[id] ? '' : '（只练摆放）') + '</option>';
      }).join('');
      tPick.value = DATA.task;
      tPick.addEventListener('change', () => setTask(tPick.value));
      const step = d => {
        const i = ids.indexOf(DATA.task);
        setTask(ids[(i + d + ids.length) % ids.length]);
      };
      const prev = $('tPrev'), next = $('tNext');
      if (prev) prev.addEventListener('click', () => step(-1));
      if (next) next.addEventListener('click', () => step(1));
    }
    $('tsk').textContent = TASK.title || DATA.task;
    $('schT').textContent = TASK.sch || TASK.title;
    $('sch').innerHTML = schBody();
    if (!SP || !CIRC) say('元件数据（super-data.js）没取到：这一页只能看，判不了对', 'bad');
    LIB = libOf(DATA.task);
    fit();
    makeThumbs();
    buildLib();
    syncLabels();
    setLib(false);        // 抽屉默认收起：左缘竖条常驻，点一下滑出（2026-11-09 排版重做）
    loadOrb();
    window.addEventListener('resize', () => { fit(); loadOrbIfDefault(); });
    // 窄屏旋转 / 缩放后竖条可能跑到屏幕外，收回来（竖条 46×138，右/下各留它的宽度）
    function loadOrbIfDefault() {
      const x = parseFloat(orb.style.left) || 0, y = parseFloat(orb.style.top) || 0;
      if (x > window.innerWidth - 24 || y > window.innerHeight - 160) placeOrb(Math.min(x, window.innerWidth - 52), Math.min(y, window.innerHeight - 146));
    }
    // 调试用只读入口（不含答案）。用 Object.assign 合并，别把 super-data.js 挂的 check/termPos 冲掉
    window.SUPER = Object.assign(window.SUPER || {}, {
      insts, KINDS, PINS, view: VIEW,
      tasks: DATA.tasks, lib: () => LIB.slice(), setTask: id => setTask(id),
      plan: () => planOf(DATA.task),
      state: () => ({ solved, n: insts.length, task: DATA.task, ps: PS, bw: BW, bh: BH,
        phase: phase, wires: wires.length, judgeable: canJudge() })
    });

    /* 只给测试用的钩子（页面自己从不读它）。连线的断言要「用真实端子坐标点两下」、
       端到端要把标准网表整份灌进来，这些在页面里既没有 UI 入口、也不该有 UI 入口。 */
    window.__superTest = {
      insts, wires, KINDS,
      phase: () => phase,
      solved: () => solved,
      task: () => DATA.task,
      setTask: id => setTask(id),
      tasks: () => Object.keys(DATA.tasks),
      lib: () => LIB.map(k => ({ k: k, code: KINDS[k].code, name: CARD_NAME[k] || KINDS[k].unit, dev: KINDS[k].dev, form: KINDS[k].form })),
      kinds: () => Object.keys(KINDS).map(k => ({ key: k, dev: KINDS[k].dev, form: KINDS[k].form, pins: KINDS[k].pins(), count: termsOf(KINDS[k].dev, KINDS[k].form).length })),
      plan: () => planOf(DATA.task),
      go: () => go.textContent,
      add: (k, x, y) => {
        const it = addAt(k, x, y);
        return it ? { id: it.id, type: it.type, dev: it.dev, form: it.form, name: it.name } : null;
      },
      arm: () => (arm ? arm.id : null),
      selWire: () => selWire,
      pinR: () => PIN_HIT(),
      wireTotal: () => wireTotal(),
      err: () => runErr(),
      del: () => delSelected(),
      wireable: () => [...wireableSet()],
      pins: () => PINLIST_ALL().map(p => ({ id: p.id, x: p.x, y: p.y })),
      pinXY: id => {
        const p = pinById(id); if (!p) return null;
        const r = cv.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      wireMid: i => {
        /* 走线改成折线以后，「两端的直线中点」可能根本不在画出来的线上（正交走线会绕开）。
           这里沿折线按弧长采样，挑**离所有端子最远**的那个点（其次离别的线也远一点）：
           点两下删线时才不会先命中端子、把「删线」变成「起一根新线」。
           采样规则和 practice.js 的 sleeve()「取最长一段」同一个意思，只是多了净空判断。 */
        const pts = wirePointsOf(i);
        if (!pts || pts.length < 2) return null;
        const seg = []; let L = 0;
        for (let j = 1; j < pts.length; j++) { const d = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]); seg.push(d); L += d; }
        if (L < 1) return null;
        const at = s => {
          let need = s;
          for (let j = 1; j < pts.length; j++) {
            if (need <= seg[j - 1] || j === pts.length - 1) {
              const k = seg[j - 1] ? Math.min(1, need / seg[j - 1]) : 0;
              return [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * k, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * k];
            }
            need -= seg[j - 1];
          }
          return pts[pts.length - 1];
        };
        const pins = PINLIST_ALL();
        let best = null, bs = -1;
        for (let f = 0.08; f <= 0.9201; f += 0.02) {
          const p = at(L * f);
          let d = 1e9;
          for (const q of pins) { const dd = Math.hypot(p[0] - q.x, p[1] - q.y); if (dd < d) d = dd; }
          if (d > bs) { bs = d; best = p; }
        }
        if (!best) return null;
        const r = cv.getBoundingClientRect();
        return { x: r.left + best[0], y: r.top + best[1] };
      },
      // 画出来的折线（画布坐标）。测试用它算「点在哪两根线的交叉处」这类几何，别再用两端直线
      wirePts: i => {
        const pts = wirePointsOf(i);
        return pts ? pts.map(p => [p[0], p[1]]) : null;
      },
      addWire: (a, b) => {
        if (!W) return { ok: false, reason: 'noapi' };
        const r = W.addWire(wires, { a: a, b: b, color: wireColor(a) });
        // 走线是现算的：钩子灌完线要立刻能读到 wirePts（测试会在同一次 evaluate 里读）
        if (r.ok) { syncRoutes(); touchWires(); }
        return r;
      },
      removeWire: (a, b) => { const n = W ? W.removeWire(wires, { a: a, b: b }) : 0; if (n) touchWires(); return n; },
      clearWires: () => { wires.length = 0; touchWires(); },
      cancelArm: () => cancelArm(null),
      undoWire: undoWire,
      enterWire: enterWire,
      checkWires: checkWires,
      /* 批量灌线开关：接一根线就判一次对（E2 是 20 万种排列），逐根灌会慢到不可用。
         打开后 progress() 只报 0，关掉时重算一次。 */
      batch: on => { quiet = !!on; if (!quiet) { aliasSlow = false; updateStat(); } },
      judge: () => { aliasSlow = false; return judgeNow(); },
      stat: () => stat.textContent,
      hasAlias: () => !!(window.SUPER_ALIAS && typeof window.SUPER_ALIAS.judgePlaced === 'function'),
      nets: () => (window.SUPER_NETS && window.SUPER_NETS[DATA.task]) || null
    };

    // super-alias.js 已经在 super.html 里静态引入（super-wire.js 之后）；万一没取到，judgeNow 会退回兜底
    updateStat();
    need();
  }

  /* 可选数据文件：拿不到就用 INLINE（404 不影响页面，也不进「JS 报错」统计） */
  (function loadData() {
    const s = document.createElement('script');
    s.src = 'super-data.js';
    s.onload = boot;
    s.onerror = boot;
    document.head.appendChild(s);
  })();
})();
