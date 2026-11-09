// ============================================================================
// 超级排位模式 · 元件数据 + 判对函数（纯数据 + 纯函数：不碰 DOM、不画东西、不拼文案）
//
// 一、这个文件干什么
//   新模式：学生先按题目把元器件摆到板上，摆对了才进入连线。
//   这里只回答三件事：
//     1) 本学期用到哪些元件、每种长什么样、每个端子相对「元件左上角原点」在哪 → window.SUPER_PARTS
//     2) 每个电路的元件构成 → window.SUPER_CIRCUITS
//     3) 学生摆的这堆元件对不对（window.SUPER.check）、某端子现在在板上哪 → termPos
//
// 二、口径（用户确认，2026-11-07）
//   **摆放判对只看「种类 + 个数」，不看位置。** 摆哪、摆多歪都算对。
//   所以 check() 只数 key，不返回任何「该放哪」的信息，提示文案也不在这个文件里拼。
//
//   FU 怎么数（这条最容易数错，先写清楚）：
//     一只「单极熔断器座」算一件（parts.js:37 partFuse 画的就是单极，一进一出两个螺丝）。
//     FU1 在板上是每相一只、并排三只（board.js:7 x 间距 70），所以 FU1 = 3 件；
//     2.1～2.6 还有 FU2 = 1 件 → 这六节的 FU 都是 4 件。
//     这和 circuitE2.js:292 已有的清单口径一致（那里写「FU1×3、FU2、FU5」共 5 件）。
//     若以后改成「三极熔断器座算一件」：把 2.1～2.6 的 FU 4→2、E1/E2 的 FU 5→3，
//     再把 SUPER_PARTS.FU 换成三极外形（terms 里补 t0~t2 / b0~b2，dx 间距 70），其它不用动。
//
// 三、数据从哪来（逐个数的，每条电路上都写了 src，指到具体文件/行）
//   · 元件位置与端子坐标：board.js:4-17 的 TP（2.2 的基准），其余电路各自文件开头的 TP；
//     元件本体的绘制原点看 practice.js:731-738（partQF(840,150) / partFuse(1170+70i,150) /
//     partButton(cx,150) / partKM(kx,490) / partFR(860,800)），所以「TP − 绘制原点」就是 dx/dy。
//   · 外形与端子几何：parts.js（partQF / partFuse / partFR / partKM / partButton / partXT）。
//   · 没有 TP 或没有 parts.js 函数的元件（KT、SQ、TC、R、VD），按各电路 drawExtra 里的
//     接线端子螺丝位置 + 外框反推，draw 一栏写 null 并注明现有画法在哪个文件。
//   · 个数的依据写在每条 SUPER_CIRCUITS 的 src 字段里。
//
// 四、以后加元件 / 加电路要改哪里
//   1) 加元件 → SUPER_PARTS 里加一条：key 唯一、terms 的 dx/dy 相对「元件外框左上角」，
//      形状不一样的同类元件（例如四极空开 vs 三极空开）写进 forms，别开新 key。
//   2) 加电路 → SUPER_CIRCUITS 里加一条，src 写清楚个数是从哪个文件哪几行数出来的。
//   3) 只调外形 → 改对应的 forms 那一档，不要动 check()。
//   4) 不要在这里加 UI 文案、颜色、摆放建议；页面要什么自己拼。
// ============================================================================
(function (W) {
  'use strict';

  // ---------- 小工具 ----------
  const T = (id, name, dx, dy) => ({ id: id, name: name, dx: dx, dy: dy });
  const cols = (n, x0, step, fn) => { const a = []; for (let i = 0; i < n; i++) a.push(fn(i, x0 + step * i)); return a; };

  // 复合按钮的端子外套（常闭 + 常开，机械联动）——各电路共用同一套叫法
  const SB_QUAD_TERMS = [
    T('ci', '常闭入口', 15, 120), T('co', '常闭出口', 45, 120),
    T('ai', '常开入口', 75, 120), T('ao', '常开出口', 105, 120),
  ];

  // 交流接触器 6 个主/辅触点的端子名（parts.js:65 KM_TOP / KM_BOT）
  const KM_TOP_NAME = ['主触点进线 1/L1', '主触点进线 3/L2', '主触点进线 5/L3', '常开 13', '常闭 21', '线圈 A1'];
  const KM_BOT_NAME = ['主触点出线 2/T1', '主触点出线 4/T2', '主触点出线 6/T3', '常开 14', '常闭 22', '线圈 A2'];
  const KM_TERMS = [].concat(
    cols(6, 25, 40, (i, dx) => T('t' + i, KM_TOP_NAME[i], dx, 12)),
    cols(6, 25, 40, (i, dx) => T('b' + i, KM_BOT_NAME[i], dx, 172))
  );

  // ==========================================================================
  // 1. 元件类型表
  //    key  内部代号；name 中文名（和原理图标的一致）；code 原理图代号前缀
  //    size 元件外框宽高（板单位）；terms 端子表（dx/dy 相对外框左上角）
  //    forms 同 key 的不同外形（默认外形写在顶层）；draw 用 parts.js 哪个函数画
  // ==========================================================================
  const P = {};

  // ---- QF 断路器：实训台三相四线空开 3P+N，四极联动 ----
  P.QF = {
    key: 'QF', name: '断路器', code: 'QF',
    note: '三相四线空开（3P+N）：L1 L2 L3 N 四个极联动。实训台供电，进线不用接。',
    size: { w: 240, h: 150 },
    terms: [].concat(
      cols(4, 30, 60, (i, dx) => T('t' + i, '进线 ' + ['L1', 'L2', 'L3', 'N'][i], dx, 12)),
      cols(4, 30, 60, (i, dx) => T('b' + i, '出线 ' + ['L1', 'L2', 'L3', 'N'][i], dx, 138))
    ),
    // parts.js:20 partQF(x, y, on, hi, pos)：x,y 就是外框左上角
    draw(inst) { partQF(inst.x, inst.y, !!inst.on, !!inst.hi, inst.pos); },
    forms: {
      // E2 的 QF2 是冷却泵专用的三极空开，外框比 QF1 小，端子间距 40
      '3P': {
        name: '三极空开（E2 的 QF2 冷却泵开关）',
        size: { w: 192, h: 140 },
        terms: [].concat(
          cols(3, 28, 40, (i, dx) => T('t' + i, '进线 ' + 'UVW'[i], dx, 20)),
          cols(3, 28, 40, (i, dx) => T('b' + i, '出线 ' + 'UVW'[i], dx, 120))
        ),
        draw: null,
        drawSrc: 'circuitE2.js:374-378（drawExtra 里的 QF2 画法）',
      },
    },
  };

  // ---- FU 熔断器：单极熔断器座，一进一出 ----
  P.FU = {
    key: 'FU', name: '熔断器', code: 'FU',
    note: '单极熔断器座（一只两个螺丝）。FU1 是主电路三只并排，FU2/FU5 是控制电路一只。',
    size: { w: 46, h: 150 },
    terms: [T('t', '进线', 23, 12), T('b', '出线', 23, 138)],
    // parts.js:37 partFuse(cx, y, name)：第一个参数是「中心 x」，不是左上角
    draw(inst) { partFuse(inst.x + 23, inst.y, inst.label || ''); },
  };

  // ---- FR 热继电器：三相主触点 1/3/5 进、2/4/6 出，另有一对常闭 95/96 ----
  P.FR = {
    key: 'FR', name: '热继电器', code: 'FR',
    note: '主电路三极 + 一对常闭 95/96（控制电路用）。板上不接电动机，主电路到 FR 进线端为止。',
    size: { w: 260, h: 130 },
    terms: [
      T('t0', '进线 1/L1', 25, 12), T('t1', '进线 3/L2', 65, 12), T('t2', '进线 5/L3', 105, 12),
      T('t4', '常闭 95', 185, 12),
      T('b0', '出线 2/T1', 25, 118), T('b1', '出线 4/T2', 65, 118), T('b2', '出线 6/T3', 105, 118),
      T('b4', '常闭 96', 185, 118),
    ],
    // parts.js:83 partFR(x, y, trip, hi)
    draw(inst) { partFR(inst.x, inst.y, !!inst.trip, !!inst.hi); },
  };

  // ---- KM 交流接触器：上排 6 个端子、下排 6 个端子 ----
  P.KM = {
    key: 'KM', name: '交流接触器', code: 'KM',
    note: '上 3 个主触点进线 + 常开 13 + 常闭 21 + 线圈 A1；下排一一对应。E1/E2 另加辅助触头。',
    size: { w: 260, h: 184 },
    terms: KM_TERMS,
    // parts.js:66 partKM(x, y, arm, name, hi)
    draw(inst) { partKM(inst.x, inst.y, inst.arm || 0, inst.label || 'KM', !!inst.hi); },
    forms: {
      // E1：KM1、KM2 各加一个辅助常闭（21/22），画在右侧，外框加宽 46
      'aux': {
        name: '带右侧辅助触头（E1 的 KM1、KM2）',
        size: { w: 306, h: 184 },
        terms: KM_TERMS.concat([T('t6', '辅助触点上端', 266, 12), T('b6', '辅助触点下端', 266, 172)]),
        draw: null,
        drawSrc: 'circuitE1.js:269-273（drawExtra 里辅助触头的小方块）+ parts.js:66 partKM',
      },
      // E2：辅助触头画在第三排（外框向下加长），KM1 辅助常开、KM4 辅助常闭
      'auxBelow': {
        name: '下方第三排辅助触头（E2 的 KM1、KM4）',
        size: { w: 260, h: 392 },
        terms: KM_TERMS.concat([T('t6', '辅助触点上端', 25, 282), T('b6', '辅助触点下端', 25, 382)]),
        draw: null,
        drawSrc: 'circuitE2.js:340-345（drawExtra 里 43/44、31/32 的小方块）+ parts.js:66 partKM',
      },
    },
  };

  // ---- SB 按钮：单个按钮（入口/出口）或复合按钮（常闭一对 + 常开一对） ----
  P.SB = {
    key: 'SB', name: '按钮', code: 'SB',
    note: '单个按钮两个螺丝一样（入口/出口）；复合按钮是常闭 + 常开机械联动，四个端子。',
    size: { w: 96, h: 136 },
    terms: [T('i', '入口', 22, 120), T('o', '出口', 74, 120)],
    // parts.js:47 partButton(cx, y, color, pressed, name, desc, hi, quad)：cx 是中心 x
    draw(inst) {
      partButton(inst.x + 48, inst.y, inst.color || '#22c55e', !!inst.pressed,
        inst.label || 'SB', inst.desc || null, !!inst.hi, false);
    },
    forms: {
      'QUAD': {
        name: '复合按钮（常闭 + 常开）',
        size: { w: 120, h: 136 },
        terms: SB_QUAD_TERMS,
        draw(inst) {
          partButton(inst.x + 60, inst.y, inst.color || '#22c55e', !!inst.pressed,
            inst.label || 'SB', inst.desc || null, !!inst.hi, true);
        },
      },
    },
  };

  // ---- KT 时间继电器：三种接法（2.5 / E1 / E2 各一种），都是「接线端子一排 + 表盘」 ----
  P.KT = {
    key: 'KT', name: '时间继电器', code: 'KT',
    note: '2.5 是通电延时型（延时闭合、延时断开各一对 + 线圈）；E1 只用到延时断开 + 线圈；E2 是断电延时型，端子排成上下两排。',
    size: { w: 148, h: 166 },
    terms: [
      T('ni', '延时闭合入口', 16, 148), T('no', '延时闭合出口', 40, 148),
      T('ci', '延时断开入口', 64, 148), T('co', '延时断开出口', 88, 148),
      T('a1', '线圈 A1', 112, 148), T('a2', '线圈 A2', 136, 148),
    ],
    draw: null,
    drawSrc: 'circuit25.js:274-289（drawExtra 里的表盘 + 一排 6 个端子）',
    forms: {
      '4': {
        name: '只用到延时断开 + 线圈（E1）',
        size: { w: 150, h: 158 },
        terms: [
          T('ci', '延时断开入口', 22, 142), T('co', '延时断开出口', 56, 142),
          T('a1', '线圈 A1', 90, 142), T('a2', '线圈 A2', 124, 142),
        ],
        draw: null,
        drawSrc: 'circuitE1.js:283-295（drawExtra 里的小表盘 + 4 个端子）',
      },
      '2ROW': {
        name: '上下两排（E2 断电延时）',
        size: { w: 204, h: 140 },
        terms: [
          T('t0', '常闭（延时闭合）上端', 24, 20), T('t1', '常开（延时断开）上端', 64, 20), T('t2', '线圈 A1', 104, 20),
          T('b0', '常闭（延时闭合）下端', 24, 120), T('b1', '常开（延时断开）下端', 64, 120), T('b2', '线圈 A2', 104, 120),
        ],
        draw: null,
        drawSrc: 'circuitE2.js:351-361（drawExtra 里的 KT 方块 + 6 个端子）',
      },
    },
  };

  // ---- M 电动机：板上画的是接线盒（不是整机），拆开连接片后 6 个（E2 是三台 3 个）出线端 ----
  P.M = {
    key: 'M', name: '三相异步电动机', code: 'M',
    note: '板上只画接线盒（拆开连接片）。2.1～2.3 不接电动机，板上没有这个元件。',
    size: { w: 340, h: 84 },
    terms: [
      T('t0', 'U1 首端', 30, 16), T('t1', 'V1 首端', 80, 16), T('t2', 'W1 首端', 130, 16),
      T('t3', 'W2 末端', 200, 16), T('t4', 'U2 末端', 250, 16), T('t5', 'V2 末端', 300, 16),
    ],
    // 接线盒：深色底板 + 每个端子一个螺丝 + 端子名（同 circuit24.js:251-258 的画法）
    draw(inst) {
      const f = formOf('M', inst.form), s = f.size;
      shadowBox(inst.x, inst.y, s.w, s.h, 10, lin(0, inst.y, 0, inst.y + s.h, [[0, '#334155'], [1, '#0f172a']]), '#0f172a');
      f.terms.forEach(t => {
        screw(inst.x + t.dx, inst.y + t.dy, 8);
        text(t.name, inst.x + t.dx, inst.y + t.dy + 26, 12, '#e2e8f0', 'center', 'bold');
      });
    },
    forms: {
      // 2.6 双速电动机：端子排更密，端子名顺序也不同（U1 V1 W1 U2 V2 W2）
      'BOX6B': {
        name: '双速电动机接线盒（2.6，间距 38）',
        size: { w: 248, h: 84 },
        terms: [
          T('t0', 'U1 首端', 24, 16), T('t1', 'V1 首端', 62, 16), T('t2', 'W1 首端', 100, 16),
          T('t3', 'U2 中点', 148, 16), T('t4', 'V2 中点', 186, 16), T('t5', 'W2 中点', 224, 16),
        ],
      },
      // E2 车床：三台电动机各一个 3 端子接线盒
      'BOX3': {
        name: '三端子接线盒（E2 的 M1/M2/M3）',
        size: { w: 220, h: 140 },
        terms: [T('t0', 'U', 60, 27), T('t1', 'V', 110, 27), T('t2', 'W', 160, 27)],
      },
    },
  };

  // ---- SQ 位置开关（行程开关）：一对常闭 + 一对常开 ----
  P.SQ = {
    key: 'SQ', name: '位置开关', code: 'SQ',
    note: 'E2 的 SQ1：压下时常闭断开、常开闭合（停车制动用）。',
    size: { w: 132, h: 140 },
    terms: [
      T('t0', '常闭上端', 23, 20), T('t1', '常开上端', 63, 20),
      T('b0', '常闭下端', 23, 120), T('b1', '常开下端', 63, 120),
    ],
    draw: null,
    drawSrc: 'circuitE2.js:346-350（drawExtra 里的 SQ1 方块 + 拨杆）',
  };

  // ---- TC 控制变压器：380 V 原边两个端子、127 V 副边两个端子 ----
  P.TC = {
    key: 'TC', name: '控制变压器', code: 'TC',
    note: 'E2：原边接 U21/W21 取 380 V，副边出 127 V（001）和 0（000）。端子名按 circuitE2.js:46 的 termName。',
    size: { w: 146, h: 140 },
    terms: [
      T('t0', '原边 0', 30, 20), T('t1', '原边 380V', 116, 20),
      T('b0', '副边 127V（001）', 30, 120), T('b1', '副边 0（000）', 116, 120),
    ],
    draw: null,
    drawSrc: 'circuitE2.js:368-373（drawExtra 里的 TC 方块；注意 :371 印的 0/127V 位置和 termName 不一致，端子以本表为准）',
  };

  // ---- R 制动电阻：E1 能耗制动用，左右各一个端子 ----
  P.R = {
    key: 'R', name: '制动电阻', code: 'R',
    note: 'E1：N → R → U15 → VD4 → U14，串在制动回路里。',
    size: { w: 148, h: 70 },
    terms: [T('t', '左端', 24, 42), T('b', '右端', 124, 42)],
    draw: null,
    drawSrc: 'circuitE1.js:275-277（drawExtra 里的电阻方块 + 四个色环）',
  };

  // ---- VD 整流二极管：E1 是横放（左右端子），E2 是竖放（上下端子） ----
  P.VD = {
    key: 'VD', name: '整流二极管', code: 'VD',
    note: 'E1 的 VD4 做半波整流（U15 → U14）；E2 的 VD 做能耗制动整流（201 → 202）。',
    size: { w: 148, h: 70 },
    terms: [T('t', 'U15 端', 24, 42), T('b', 'U14 端', 124, 42)],
    draw: null,
    drawSrc: 'circuitE1.js:278-281（drawExtra 里的二极管符号）',
    forms: {
      'V2': {
        name: '竖放（E2，上阳下阴）',
        size: { w: 50, h: 140 },
        terms: [T('t0', '阳极', 25, 20), T('b0', '阴极', 25, 120)],
        draw: null,
        drawSrc: 'circuitE2.js:362-367（drawExtra 里的二极管符号）',
      },
    },
  };

  // ---- XT 端子排：并联专项的 N 端子（一格） ----
  P.XT = {
    key: 'XT', name: '端子排', code: 'XT',
    note: '并联专项练习里代表接 QF 的 N 那一格（parallel.js:493）。',
    size: { w: 58, h: 90 },
    terms: [T('t', 'N 上端', 29, 15), T('b', 'N 下端', 29, 75)],
    // parts.js:94 partXT(x, y, cells)：一格 58 宽
    draw(inst) { partXT(inst.x, inst.y, inst.slots || ['N']); },
  };

  // ==========================================================================
  // 2. 每个电路的元件构成（个数都是从源码里数出来的，src 写在旁边）
  //    forms：整节同一种外形时写这里；formNotes：同一节里有的元件是特殊外形时写这里
  // ==========================================================================
  const CIRCUITS = {

    '2.1': {
      id: '2.1', name: '三相异步电动机单向起动',
      title: '三相异步电动机 单向起动 · 接线练习（circuit21.js:152 CIRCUIT.title）',
      src: 'circuit21.js:7-16（TP：QF、FU1×3、FU2、FR、KM1、SB1、SB2），:36-52（BW 导线两端出现的端子）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 1, SB: 2 },
      note: 'FU1 三只 + FU2 一只 = 4；只有 KM1 一个接触器；没有 SB3，没有电动机。',
    },

    '2.2': {
      id: '2.2', name: '电气互锁正反转',
      title: '三相异步电动机 电气互锁正反转 · 接线练习（circuit22.js:5）',
      src: 'board.js:5-17（TP：QF、FU1×3、FU2、FR、KM1、KM2、SB1、SB2、SB3），:71-86（BE 内部通断）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 2, SB: 3 },
      note: '两个接触器、三个按钮（SB1 停止、SB2 正转、SB3 反转），全是单触点按钮；不接电动机。',
    },

    '2.3': {
      id: '2.3', name: '双重互锁正反转',
      title: '三相异步电动机 双重互锁正反转 · 接线练习（circuit23.js:224）',
      src: 'circuit23.js:10-27（TP：QF、FU1×3、FU2、FR、KM1、KM2、SB1、SB2、SB3 复合），:96-97（BE）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 2, SB: 3 },
      formNotes: { SB: 'SB1 是单触点（i/o）；SB2、SB3 是复合按钮（form: QUAD，ci/co/ai/ao 四个端子）' },
      note: '个数和 2.2 一样，区别在按钮：SB2、SB3 必须是复合按钮。',
    },

    '2.4': {
      id: '2.4', name: '按钮切换星-三角减压起动',
      title: '按钮切换的星-三角减压起动 · 接线练习（circuit24.js:246）',
      src: 'circuit24.js:12-29（TP：QF、FU1×3、FU2、FR、KM1/KM2/KM3、M 接线盒 6 端、SB1、SB2、SB3 复合），:94-110（BE）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 3, SB: 3, M: 1 },
      formNotes: { SB: 'SB3 是复合按钮（form: QUAD）；SB1、SB2 是单触点' },
      note: '这节必须接电动机（接线盒 6 个出线端，拆连接片）。',
    },

    '2.5': {
      id: '2.5', name: '时间继电器控制的星-三角减压起动',
      title: '时间继电器控制的星-三角减压起动 · 接线练习（circuit25.js:250）',
      src: 'circuit25.js:11-26（TP：QF、FU1×3、FU2、FR、KM1/KM2/KM3、M 6 端、SB1、SB2、KT 一排 6 端），:94-110（BE）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 3, SB: 2, KT: 1, M: 1 },
      note: '比 2.4 少一个按钮、多一个时间继电器（通电延时型，6 个端子）。',
    },

    '2.6': {
      id: '2.6', name: '按钮切换的双速电动机',
      title: '按钮切换的双速电动机 · 接线练习（circuit26.js:252）',
      src: 'circuit26.js:11-28（TP：QF、FU1×3、FU2、FR、KM1/KM2/KM3、M 6 端、SB1、SB2/SB3 复合），:94-107（BE）',
      parts: { QF: 1, FU: 4, FR: 1, KM: 3, SB: 3, M: 1 },
      forms: { M: 'BOX6B' },
      formNotes: { SB: 'SB2、SB3 是复合按钮（form: QUAD）；SB1 是单触点' },
      note: '双速电动机接线盒端子排更密（间距 38），端子名顺序 U1 V1 W1 U2 V2 W2。',
    },

    'E1': {
      id: 'E1', name: '双重联锁正反转 + 能耗制动（电工中级题一）',
      title: '电工中级 · 双重联锁正反转能耗制动 · 接线练习（circuitE1.js:248）',
      src: 'circuitE1.js:11-26（TP：QF、FU1×3、FU2、FU2b、FR、KM1/KM2/KM3（KM1/KM2 加辅助常闭）、SB1/SB2/SB3 复合、R、VD、KT 4 端），:72-85（BE）',
      parts: { QF: 1, FU: 5, FR: 1, KM: 3, SB: 3, KT: 1, R: 1, VD: 1 },
      forms: { SB: 'QUAD', KT: '4' },
      formNotes: { KM: 'KM1、KM2 带右侧辅助常闭（form: aux，t6/b6）；KM3 是普通 6 端子' },
      note: '控制电路接在 U、V 两相之间（380 V），没有零线；FU2 和 FU2b 是两只单独的熔断器。',
    },

    'E2': {
      id: 'E2', name: 'C6140T 卧式车床（电工中级题二）',
      title: '电工中级 · C6140T 卧式车床 · 接线练习（circuitE2.js:284）',
      src: 'circuitE2.js:14-34（TP：QF、FU1×3、FU2、FU5、KM1~KM4、SB1/SB2/SB3、SQ1、KT、VD、TC、QF2、M1/M2/M3），:88-102（BE）；个数与 :292 已有的 parts 清单完全一致',
      parts: { QF: 2, FU: 5, KM: 4, SB: 3, SQ: 1, KT: 1, TC: 1, VD: 1, M: 3 },
      forms: { KT: '2ROW', VD: 'V2', M: 'BOX3' },
      formNotes: {
        QF: 'QF1 是四极空开（默认外形）；QF2 是三极空开（form: 3P）',
        KM: 'KM1（辅助常开）、KM4（辅助常闭）带下排辅助触头（form: auxBelow）；KM2、KM3 是普通 6 端子',
      },
      note: '这节没有热继电器 FR（board 上 noFR: true），主电路靠 QF1 + KM1 保护。',
    },

    'P': {
      id: 'P', name: '并联专项练习',
      title: '并联专项练习（parallel.js:880 lessonInfo）',
      src: 'parallel.js:883（本节工具清单）；每道小题自己的 parts 在 parallel.js:41-95（按钮 2～5 个不等）',
      parts: { FU: 1, SB: 3, KM: 2, XT: 1 },
      note: '这是并联专项的工具清单（按钮 3 个、接触器 2 个），不是某一道小题的清单；按单题判对要用 QUESTIONS[i].parts。',
    },
  };

  // ==========================================================================
  // 3. 查表与校验（纯函数）
  // ==========================================================================

  // 取某个元件的某一档外形；不给 form 或 form 不存在时返回默认外形（顶层那条）
  function formOf(key, form) {
    const p = P[key];
    if (!p) return null;
    if (form && p.forms && p.forms[form]) return p.forms[form];
    return p;
  }

  // 端子表：termsOf('KM') → 默认外形；termsOf('SB', 'QUAD') → 复合按钮
  function termsOf(key, form) {
    const f = formOf(key, form);
    return f && f.terms ? f.terms : null;
  }

  // 端子绝对坐标：termPos({key:'KM', x:860, y:490}, 't0') → [885, 502]
  function termPos(inst, termId) {
    if (!inst || typeof inst.x !== 'number' || typeof inst.y !== 'number') return null;
    const terms = termsOf(inst.key, inst.form);
    if (!terms) return null;
    for (let i = 0; i < terms.length; i++) if (terms[i].id === termId) {
      return [inst.x + terms[i].dx, inst.y + terms[i].dy];
    }
    return null;
  }

  // 绘制：拿到该元件（该外形）该用的画法；没有现成函数时返回 null，看 drawSrc 指的位置
  function drawOf(inst) {
    if (!inst) return null;
    const f = formOf(inst.key, inst.form);
    return f && typeof f.draw === 'function' ? f.draw : null;
  }

  // 摆放判对：只比「种类 + 个数」，不看位置，也不返回摆放建议
  function check(list, id) {
    const c = CIRCUITS[id];
    if (!c) throw new Error('SUPER.check：未知电路 id = ' + id);
    const need = c.parts, have = {};
    (list || []).forEach(x => { const k = x && x.key; if (k) have[k] = (have[k] || 0) + 1; });
    const miss = [], extra = [];
    Object.keys(need).forEach(k => {
      const h = have[k] || 0;
      if (h < need[k]) miss.push({ key: k, need: need[k], have: h });
    });
    Object.keys(have).forEach(k => {
      const n = need[k] || 0;
      if (have[k] > n) extra.push({ key: k, have: have[k], need: n });
    });
    return (miss.length || extra.length) ? { ok: false, miss: miss, extra: extra } : { ok: true };
  }

  // ---------- 导出 ----------
  W.SUPER_PARTS = P;
  W.SUPER_CIRCUITS = CIRCUITS;
  W.SUPER = {
    PARTS: P,
    CIRCUITS: CIRCUITS,
    formOf: formOf,
    termsOf: termsOf,
    termPos: termPos,
    drawOf: drawOf,
    partsOf: id => (CIRCUITS[id] ? CIRCUITS[id].parts : null),
    check: check,
  };
})(typeof window !== 'undefined' ? window : globalThis);
