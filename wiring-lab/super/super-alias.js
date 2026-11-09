// ============================================================================
// 超级排位 · 元件实例 ↔ 教材代号的「对名表」+ 带剪枝的判对（纯函数）
//
// 一、这个文件解决什么问题
//   超级排位第二步：学生先按题把元器件摆到板上（摆放判对只看种类+个数，见 super-data.js 的
//   SUPER.check），摆对之后**在自己摆的位置上**连线。连线判对的核在 super-wire.js 的 judge()，
//   它吃的是「端子字符串」：`FU1.t0` / `KM1.b2` / `SB2.ci`。
//
//   但学生那头是**元件实例**，实例的代号由 super.js 的 syncLabels() 给：
//     同类型多只就编 FU1/FU2/FU3/FU4，每只的端子是「它自己那种元件」的端子。
//   而标准网表（src/super-nets.js）里的端子名是**教材的电气代号**。两者对不上，有两类情况：
//
//   ① 单极件被教材当成多极器件用
//      熔断器（super-data.js:95 P.FU）是单极件，只有 t / b 两个端子；
//      教材里 FU1 是主电路**三只并排**（L1/L2/L3 各一只），网表里写成
//      FU1.t0/FU1.b0/FU1.t1/FU1.b1/FU1.t2/FU1.b2；另外 FU2（E1 还有 FU2b）是控制电路一只，
//      写成 FU2.t/FU2.b。所以 4~5 只单极熔断器要分别对上「3 个 FU1 极 + 1~2 个控制熔断器」。
//      → 用 SPLIT 常量把 FU 的「一个代号」拆成多片单极件（每片一个 slot）。
//
//   ② 同型号多只，谁是哪只由学生自己定
//      学生把哪只熔断器当 L1、哪只当 L2 都算对（用户 2026-11-08 明确选「同型号实例任意调换」）。
//      接触器 KM1/KM2、按钮 SB1/SB2/SB3 同理。
//      → 于是判对变成「找一个实例 → 位置的排列，使重写后的线拓扑和标准网表一致」。
//
//   置换数（朴素穷举会炸）：
//     2.1 48 | 2.2 288 | 2.3 288 | 2.4 864 | 2.5 288 | 2.6 864 | E1 4,320 | E2 207,360
//   E2 是 2 个 QF × 5 个 FU × 4 个 KM × 3 个 SB × 3 台 M 的阶乘叠起来，所以必须剪枝。
//
// 二、剪枝为什么强（这段是本文件的核心，改之前先读懂）
//   学生的线用 netsOf() 算成一个个连通块（一块 = 一串学生端子）。判对的口径是「按点判」：
//     a. 标准网里同一个点的端子，学生必须连进同一个块；
//     b. 学生任何一个块里，不许出现两个不同标准点的端子。
//   把 a、b 合成一句话，就是**块 ↔ 网 的一一对应**：
//     同一个块里的端子，重写后必须落进同一个网；同一个网里的端子，也必须落进同一个块。
//   所以回溯时每定一只元件、每绑一个端子，就做一次「块↔网」配平：
//     · 块已经绑过网 n1，这个端子又指向网 n2 ≠ n1 → 立刻回退（这是一根错线）；
//     · 网 n 已经绑过块 c1，这个端子却来自块 c2 ≠ c1 → 立刻回退（这是漏接/跨接）。
//   这条约束是**逐步收紧**的（不用等一整块端子都定完类型），所以大部分排列在第一个端子上就死掉。
//   ★ 由此还能得到一条结论：**任何一个从头到尾都配平成功的完整排列，必然就是正确答案**
//     （a、b 同时满足 → 没有 missing、没有 wrong）。所以叶子节点不需要再算一遍判对，
//     找到第一个完整排列就够了；judge() 只在最后调一次，用来拿 hit/hits/nets 给界面。
//
// 三、失败时怎么给提示
//   全试完都不行 → 拿「定得最深的那一次」补全成一个排列，再交给 judge()，
//   用它的 missing / wrong / open 告诉界面「还差哪几根线」。见 judgePlaced() 第 5 步。
//
// 四、「不用接线的端子」接了线 = 错（2026-11-08 补，口径照 practice.js:595-596）
//   练习页是这么判的：
//     const ns = new Set(ks.map(k => refNet(k) || '×'));   // :595
//     if (ns.size > 1 || ns.has('×')) { ……错接…… }        // :596
//   也就是：**一个连通块里只要出现了「不在标准网表里的端子」，就算错接**（'×'）。
//   但 super-wire.js 的 judge() 对这种线是 `return` 掉、当没看见的（它的 wrong 判定里
//   `if (na === undefined || nb === undefined) return;`），于是「2.1 把 FR 的 b0 接到 KM1.t0」
//   会被判对。这里补一层，全部包在 judgePlaced 里做，**不动 judge()**：
//     · 空端子 = 某个排列里没有被映射到的学生端子（= 本电路不用接线，例如 2.1 的 FR.b0/b1/b2、
//       2.2 的 QF 进线 t0~t3）；
//     · 只要接到它就算错，这些线记进 spareWired 并**并进 wrong**（界面按 wrong.length 报根数即可）；
//     · spareOnly 是其中「整块全都是空端子」的那些（把两个不该接的端子接在一起）；
//     · 搜索阶段就把这种配对直接禁掉（forbid），所以真判对的时候 spareWired 一定是空的。
//
// 五、形态不对先说形态（reason:'form'）
//   摆放判对只看「种类 + 个数」，不管形状：2.3 的 SB2/SB3 要复合按钮（ci/co/ai/ao），
//   学生摆 3 只单触点按钮（只有 i/o）也会被判「摆对了」，但那些端子在元件上根本不存在，
//   怎么排都连不出来。所以判对前先比一次「这个类型要几个 p 端子 / 学生这批元件里有几个带 p 端子」，
//   缺了就直接返回 {ok:false, reason:'form', form:{ SB:['ai','ao','ci','co'] }}，不再往下跑。
//   ★ 这一项排在 reason:'unwired' 前面：形状不对，缺线是必然结果，要先说根因。
//   ★ insts[i].form 没给（老版本 super.js 不记形态）时，按该类型**所有形态的并集**算，
//     宁可放过不误判，不然 E1 的 KM 辅助触头（t6/b6）会被当成「这只元件没这个端子」。
//
// 六、边界
//   · 纯函数：不碰 DOM、不碰 canvas、不拼文案（只给数据，文案界面自己写）。
//   · 不改 super-wire.js / super-nets.js / super-data.js，只读它们。
//   · 摆放没摆对（某类型实例数和 slots 数对不上）→ 返回 {ok:false, reason:'count'}，不抛错。
//   · 一条电路能不能判，先问 canJudge(id)（P 没网表，别调）。
// ============================================================================
(function (W) {
  'use strict';

  // ==========================================================================
  // 0. 常量与小工具
  // ==========================================================================

  /* 哪些类型是「单极件，教材却当多极用」→ 一个代号要拆成几片。
     只有 FU：super-data.js:97 的 note 写着「单极熔断器座（一只两个螺丝）。FU1 是主电路三只并排」。
     KM 的多极不是多片器件，是同一只器件内部联动的触点，**不能拆**（拆了 slots 数就对不上 parts）。
     以后要是把 FU 换成三极熔断器座（super-data.js:20 那条注释说了改法），把这里改成 {} 即可。 */
  const SPLIT = { FU: true };

  /* 文件版本。界面是「动态注入 + try/catch 降级到 SUPER_WIRE」的，跑错版本只会静默变差，
     所以这里留个标记：SUPER_ALIAS.VERSION 对不上就是拿到旧文件了（浏览器缓存 / 打包没更新）。
     改了这个文件就顺手改一下版本号。 */
  const VERSION = '2026-11-08b';

  // 代号（教材电气代号）：字母 + 可选数字 + 可选小写后缀，例如 KM1 / FU2 / FU2b / QF2 / M1 / R / VD4
  const DEV_RE = /^([A-Z]+)(\d*)([a-z]?)$/;
  // 端子名：t / b / i / o / ci / co / ai / ao / ni / no / t0~t9 / b0~b9 / a1 / a2 / 95 / 96
  const PIN_RE = /^(?:[a-z]{1,2}\d?|\d{2})$/;

  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // 字符串比较（不依赖 locale，保证同样输入永远同样输出；和 super-wire.js 的口径一致）
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* 端子字符串切成「代号 + 端子」。
     切分依据：教材端子串永远写成 `<代号>.<端子>`，代号和端子内部都不含 '.'，
     所以**最后一个 '.' 左边是代号、右边是端子**，这一点是精确的，不靠猜。
     之所以要再拿两个正则校验一遍，是因为「代号末尾的数字」和「端子里的数字」长得一样
     （FU1 的 1 是代号的部分，t0 的 0 是端子的部分），一旦哪天有人把端点写成 `FU1t0`
     或者把代号写成 `FU.1`，靠正则能当场报出来，不然后面会静默算出一张错的表。
       举例：'KM1.t0' → {dev:'KM1', pin:'t0'}   ← 末尾的 1 归代号，t0 整个是端子
             'FU2b.b' → {dev:'FU2b', pin:'b'}    ← 小写 b 是代号后缀，不是端子
             'FR.95'  → {dev:'FR',  pin:'95'}    ← 95 是热继电器的常闭端子号，归端子 */
  function splitTerm(t) {
    const s = String(t == null ? '' : t);
    const i = s.lastIndexOf('.');
    if (i <= 0 || i === s.length - 1) {
      throw new Error('SUPER_ALIAS：端子名「' + s + '」不是「<代号>.<端子>」的形式，切不开');
    }
    const dev = s.slice(0, i), pin = s.slice(i + 1);
    if (!DEV_RE.test(dev)) throw new Error('SUPER_ALIAS：端子名「' + s + '」里的代号「' + dev + '」不认识');
    if (!PIN_RE.test(pin)) throw new Error('SUPER_ALIAS：端子名「' + s + '」里的端子「' + pin + '」不认识');
    return { dev: dev, pin: pin };
  }

  // 代号 → 元件类型（FU2b → FU、KM1 → KM、QF2 → QF、M1 → M、R → R）
  function typeOfDev(dev) {
    const m = DEV_RE.exec(String(dev));
    if (!m) throw new Error('SUPER_ALIAS：代号「' + dev + '」不认识');
    return m[1];
  }

  // 代号的排序键：先按类型，再按数字，最后按小写后缀（FU1 < FU2 < FU2b < FU5）
  function devParts(dev) {
    const m = DEV_RE.exec(String(dev)) || ['', String(dev), '', ''];
    return { t: m[1], n: m[2] === '' ? -1 : Number(m[2]), s: m[3] };
  }
  function cmpDev(a, b) {
    const p = devParts(a), q = devParts(b);
    if (p.t !== q.t) return p.t < q.t ? -1 : 1;
    if (p.n !== q.n) return p.n - q.n;
    if (p.s !== q.s) return p.s < q.s ? -1 : 1;
    return 0;
  }

  // 去重 + 稳定排序（不依赖 locale）；judge 的 wrong / spareWired 都用它，保证同样输入同样输出
  function sortUniq(arr) {
    const m = {};
    (arr || []).forEach(x => { if (x !== undefined && x !== null) m[String(x)] = 1; });
    return Object.keys(m).sort(cmp);
  }

  // 端子名的排序键（t0 < t1 < b0 < ci ...），只为让 slots() 输出稳定
  function cmpPin(a, b) {
    const ma = /^([a-z]*)(\d*)$/.exec(a) || ['', a, ''];
    const mb = /^([a-z]*)(\d*)$/.exec(b) || ['', b, ''];
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    const na = ma[2] === '' ? -1 : Number(ma[2]);
    const nb = mb[2] === '' ? -1 : Number(mb[2]);
    return na - nb;
  }

  // ==========================================================================
  // 1. slots(circuitId) → { FU: [slot...], KM: [...], ... }
  //    「位置表」：把该电路标准网表里出现的每个元件代号拆成「物理上的一件」。
  //    slot = { dev: 教材代号, pins: { 实例端子名: 教材端子名 }, pole?: '0'|'1'|... }
  //      FU1 的第 0 极 → { dev:'FU1', pole:'0', pins:{ t:'t0', b:'b0' } }
  //      FU2（控制电路一只）→ { dev:'FU2', pins:{ t:'t', b:'b' } }
  //      KM1 → { dev:'KM1', pins:{ t0:'t0', b0:'b0', t1:'t1', ... } }（整只，端子原样）
  // ==========================================================================

  const slotCache = {};   // circuitId → slots 结果
  const prepCache = {};   // circuitId → 判对用的预编译结构（见 prep）

  function buildSlots(cid) {
    const netsTable = W.SUPER_NETS && W.SUPER_NETS[cid];
    if (!netsTable) {
      const skip = W.SUPER_NETS_SKIP && W.SUPER_NETS_SKIP[cid];
      throw new Error('SUPER_ALIAS.slots：没有电路「' + cid + '」的标准网表'
        + (skip ? '（' + skip + '）' : '，请确认 super-nets.js 里有这条，或先跑 node build-super-nets.cjs'));
    }
    if (!W.SUPER_PARTS) throw new Error('SUPER_ALIAS.slots：super-data.js 没加载（window.SUPER_PARTS 不存在）');
    if (!W.SUPER_CIRCUITS) throw new Error('SUPER_ALIAS.slots：super-data.js 没加载（window.SUPER_CIRCUITS 不存在）');

    // ---- 1) 扫网表：代号 → { type, pins:Set } ----
    const devs = new Map();
    Object.keys(netsTable).forEach(netName => {
      (netsTable[netName] || []).forEach(t => {
        const p = splitTerm(t);
        const type = typeOfDev(p.dev);
        if (!W.SUPER_PARTS[type]) {
          throw new Error('SUPER_ALIAS.slots：电路「' + cid + '」的网表里有元件「' + p.dev
            + '」（类型 ' + type + '），但 super-data.js 的 SUPER_PARTS 没有这个类型');
        }
        let d = devs.get(p.dev);
        if (!d) { d = { dev: p.dev, type: type, pins: new Set() }; devs.set(p.dev, d); }
        d.pins.add(p.pin);
      });
    });

    // ---- 2) 拆成 slot ----
    const out = {};
    const pushSlot = (type, slot) => { (out[type] = out[type] || []).push(slot); };

    [...devs.keys()].sort(cmpDev).forEach(dev => {
      const d = devs.get(dev);
      const pins = [...d.pins].sort(cmpPin);

      if (!SPLIT[d.type]) {
        // 一般元件：一个代号 = 一件，端子名原样对上
        const map = {};
        pins.forEach(p => { map[p] = p; });
        pushSlot(d.type, { dev: dev, pins: map });
        return;
      }

      /* 单极件（目前只有 FU）：同一个代号下出现多个「极序号」就说明物理上是多片。
         分组键 = 端子名里的那个数字：t0/b0 一组、t1/b1 一组、t2/b2 一组；
         控制电路那种 t/b（没有数字）单独一组，键记作 ''。
         为什么按数字分组而不是按 t/b 分组：极序号是「哪一片」的唯一凭据，
         t0 和 b0 是同一片的两头（一进一出），必须落在同一个 slot 里。 */
      const groups = new Map();   // '' 或 '0'/'1'/'2' → { instPin: specPin }
      pins.forEach(p => {
        const m = /^([a-z]+)(\d*)$/.exec(p);
        const k = m ? m[2] : '';
        let g = groups.get(k);
        if (!g) { g = {}; groups.set(k, g); }
        g[p] = p;   // 单极件的实例端子名恰好就是 t / b，和教材的 t0 / b0 不是一回事，见下面 mapOf
      });
      // 极序号的顺序：有编号的按 0、1、2… 在前，'' （控制电路那种不分极的）放最后。
      // 这样 2.2 的 FU 依次是 FU1 极0、FU1 极1、FU1 极2、FU2，和学生 FU1~FU4 的直觉顺序一致。
      const keys = [...groups.keys()].sort((a, b) => {
        if (a === '' && b === '') return 0;
        if (a === '') return 1;
        if (b === '') return -1;
        return Number(a) - Number(b);
      });
      keys.forEach(k => {
        const g = groups.get(k);
        const pinsOut = {};
        // 实例那边单极件的端子只有 t / b；教材那边是 t0 / b0（或 t / b）
        Object.keys(g).sort(cmpPin).forEach(instPin => {
          const key = instPin.replace(/^([a-z]+)\d*$/, '$1');   // 去掉极序号：t0 → t
          if (pinsOut[key] !== undefined) {
            throw new Error('SUPER_ALIAS.slots：电路「' + cid + '」的 ' + dev
              + ' 在同一个极里出现了两个都叫「' + key + '」的实例端子（' + pinsOut[key] + ' / ' + g[instPin] + '），'
              + '单极件的实例端子只有 t/b，请先修网表');
          }
          pinsOut[key] = g[instPin];                            // 教材端子名原样（t0 / b0 / t / b）
        });
        pushSlot(d.type, { dev: dev, pole: k === '' ? null : k, pins: pinsOut });
      });
    });

    // ---- 3) 自检：每个类型的 slot 数必须等于 super-data.js 里的摆放口径 ----
    /* 这一步是整个文件最容易错的地方。摆放判对（SUPER.check）只数「种类 + 个数」，
       如果这里算出来的件数和 parts 对不上，说明「一个代号拆几片」的规则和教材对不上，
       学生摆对了也会被判成错的，所以宁可直接抛错，不要静默放过。 */
    const c = W.SUPER_CIRCUITS[cid];
    if (!c || !c.parts) throw new Error('SUPER_ALIAS.slots：super-data.js 里没有电路「' + cid + '」的 parts');
    const parts = c.parts;
    const bad = [];
    Object.keys(out).forEach(type => {
      const want = parts[type] || 0;
      if (out[type].length !== want) {
        bad.push('类型 ' + type + '：网表算出 ' + out[type].length + ' 件，parts 写 ' + want + ' 件');
      }
    });
    Object.keys(parts).forEach(type => {
      if (!out[type] && parts[type] > 0) {
        bad.push('类型 ' + type + '：网表里一个都没有，parts 写 ' + parts[type] + ' 件');
      }
    });
    if (bad.length) {
      throw new Error('SUPER_ALIAS.slots：电路「' + cid + '」的 slot 数和 super-data.js 的 parts 对不上 —— '
        + bad.join('；') + '。先修 SUPER_NETS 或 parts，别在判对里兜');
    }

    return out;
  }

  function slots(cid) {
    if (!slotCache[cid]) slotCache[cid] = buildSlots(cid);
    return slotCache[cid];
  }

  // ==========================================================================
  // 2. mapOf(assign, circuitId) → { 'FU3.t': 'FU1.t0', ... }
  //    assign = { FU: ['FU3','FU1','FU4','FU2'], KM: ['KM2','KM1'], ... }
  //    第 i 个实例 → 第 i 个 slot；返回「学生的端子名 → 教材的端子名」的映射表。
  //    judge 之前拿它把 wires 重写一遍就行。
  //    circuitId 可以省：judgePlaced 返回的 assign 上挂了 __cid（不可枚举），会自动取到。
  // ==========================================================================
  let lastCid = null;

  function mapOf(assign, circuitId) {
    const cid = circuitId || (assign && assign.__cid) || lastCid;
    if (!cid) {
      throw new Error('SUPER_ALIAS.mapOf：不知道是哪个电路。传第二个参数 mapOf(assign, "2.2")，'
        + '或者用 judgePlaced 返回的 assign（它自带电路 id）');
    }
    const S = slots(cid);
    const out = {};
    Object.keys(assign || {}).forEach(type => {
      const sl = S[type];
      const names = assign[type];
      if (!sl) throw new Error('SUPER_ALIAS.mapOf：电路「' + cid + '」没有类型 ' + type + ' 的位置');
      if (!names || names.length !== sl.length) {
        throw new Error('SUPER_ALIAS.mapOf：类型 ' + type + ' 的实例数（'
          + (names ? names.length : 0) + '）和位置数（' + sl.length + '）对不上');
      }
      for (let i = 0; i < sl.length; i++) {
        const slot = sl[i], name = String(names[i]);
        Object.keys(slot.pins).forEach(instPin => {
          out[name + '.' + instPin] = slot.dev + '.' + slot.pins[instPin];
        });
      }
    });
    return out;
  }

  // ==========================================================================
  // 3. prep(circuitId)：判对用的预编译结构（同一电路缓存一份，和实例名单无关）
  // ==========================================================================
  function prep(cid) {
    if (prepCache[cid]) return prepCache[cid];
    const S = slots(cid);
    const netsTable = W.SUPER_NETS[cid];

    // 网名 → 下标；端子 → 网下标
    const netNames = Object.keys(netsTable);
    const termNet = {};              // 'FU1.t0' → 3
    const netTerms = [];             // [ [端子, ...], ... ]
    netNames.forEach((n, ni) => {
      const arr = (netsTable[n] || []).slice().sort();
      netTerms.push(arr);
      arr.forEach(t => {
        if (termNet[t] !== undefined && termNet[t] !== ni) {
          throw new Error('SUPER_ALIAS.prep：端子 ' + t + ' 同时落在网「'
            + netNames[termNet[t]] + '」和「' + n + '」，网表本身有冲突');
        }
        termNet[t] = ni;
      });
    });

    const types = Object.keys(S).map(type => {
      const sl = S[type];
      return {
        type: type,
        slots: sl,
        count: sl.length,
        // 每个 slot 需要哪些「实例端子名」
        slotPins: sl.map(s => Object.keys(s.pins)),
      };
    });

    const P = {
      cid: cid,
      slots: S,
      types: types,
      byType: {},        // type → 上面那一条
      netNames: netNames,
      netTerms: netTerms,
      termNet: termNet,
      netCount: netNames.length,
    };
    types.forEach(t => { P.byType[t.type] = t; });
    prepCache[cid] = P;
    return P;
  }

  // ==========================================================================
  // 3b. pinsOfInst(inst)：这只元件身上**实际有哪些端子**
  //     形态（inst.form）知道就只算这一档；不知道就把该类型所有形态的端子并起来。
  //     并集是「宁可放过、不要误判」的选择：老版本 super.js 的实例上不记 form，
  //     如果一律按默认外形算，E1 的 KM 辅助触头（t6/b6）、E2 的 QF2 三极（t0~t2）都会被当成
  //     「这只元件没这个端子」，学生照教材接对了也判错。
  // ==========================================================================
  function pinsOfInst(it) {
    const type = it.type, form = it.form;
    const out = {};
    const S = W.SUPER;
    if (form !== undefined && form !== null && S && typeof S.termsOf === 'function') {
      const terms = S.termsOf(type, form);
      if (terms) { terms.forEach(t => { out[t.id] = 1; }); return out; }
    }
    const part = W.SUPER_PARTS && W.SUPER_PARTS[type];
    if (part) {
      (part.terms || []).forEach(t => { out[t.id] = 1; });
      if (part.forms) Object.keys(part.forms).forEach(k => {
        const f = part.forms[k];
        ((f && f.terms) || []).forEach(t => { out[t.id] = 1; });
      });
    }
    return out;
  }

  // ==========================================================================
  // 4. judgePlaced(wires, circuitId, insts, circuit) → 判对结果
  //    wires  : [{a:'FU3.t', b:'QF.b2'}, ...]  端子名是**学生实例**的（insts[i].name + '.' + 端子 id）
  //    insts  : [{name:'FU1', type:'FU'}, ...]（super.js 的实例数组；有 form 更好，没有就按并集算）
  //    circuit: 可选，传 null 也行；有 nets 时 judge 只拿它算 hit/hits
  //
  //    返回：judge() 的字段原样铺开（ok / hit / hits / nets / missing / wrong / open / unjudged）
  //          + assign（命中的排列：类型 → 按位置排的实例名）
  //          + tries（走到底的完整排列数）/ nodes（试过的「实例×位置」绑定数）/ ms
  //          + spareWired（接到「本电路不用接线」的端子上的线）/ spareOnly（其中整块都是空端子的）
  //          + reason（只有不能判时才出现）：
  //              'count'    摆放数量不对（附 type / want / have）
  //              'form'     元件形状不对（附 form: { SB:['ai','ao','ci','co'] }）
  //              'unwired'  有要求接通的端子一根线都没有 → 必然不对
  //              'no-solution' 试遍所有同型号调换都不行（给的是最接近答案的那一次）
  // ==========================================================================
  function judgePlaced(wires, circuitId, insts, circuit) {
    const t0 = nowMs();
    const SW = W.SUPER_WIRE;
    if (!SW || typeof SW.judge !== 'function') {
      throw new Error('SUPER_ALIAS.judgePlaced：super-wire.js 没加载（window.SUPER_WIRE 不存在）');
    }
    lastCid = circuitId;
    const P = prep(circuitId);
    const S = P.slots;

    // ---- 4.1 实例按类型分组；数量和 slots 对不上就直说（学生还没摆对就硬连线）----
    const byType = {};    // type → [名字...]
    const instOf = {};    // type → [{ name, terms: { 端子id: 1 } }]，terms = 这只元件身上**实际有哪些端子**
    (insts || []).forEach(it => {
      if (!it || !it.name || !it.type) return;
      const name = String(it.name);
      (byType[it.type] = byType[it.type] || []).push(name);
      (instOf[it.type] = instOf[it.type] || []).push({ name: name, terms: pinsOfInst(it) });
    });
    const typeNames = Object.keys(S);
    for (let i = 0; i < typeNames.length; i++) {
      const type = typeNames[i];
      const have = (byType[type] || []).length;
      if (have !== S[type].length) {
        return {
          ok: false, reason: 'count', type: type,
          want: S[type].length, have: have,
          assign: null, tries: 0, nodes: 0, ms: Math.round((nowMs() - t0) * 100) / 100,
          hit: null, hits: [], nets: [], missing: [], wrong: [], open: [], spareWired: [], spareOnly: [],
        };
      }
    }
    const haveKeys = Object.keys(byType);
    for (let i = 0; i < haveKeys.length; i++) {
      if (!S[haveKeys[i]]) {
        return {
          ok: false, reason: 'count', type: haveKeys[i],
          want: 0, have: byType[haveKeys[i]].length,
          assign: null, tries: 0, nodes: 0, ms: Math.round((nowMs() - t0) * 100) / 100,
          hit: null, hits: [], nets: [], missing: [], wrong: [], open: [], spareWired: [], spareOnly: [],
        };
      }
    }

    // ---- 4.1b 形态预检：标准网表要的端子，学生摆的元件身上根本没有 → 先说清「形状不对」----
    /* 摆放判对（SUPER.check）只数「种类 + 个数」，**不看形状**：2.3 的 SB2/SB3 要复合按钮
       （ci/co/ai/ao），学生完全可以摆 3 只单触点按钮（只有 i/o）而被判「摆对了」。
       这时标准网表里那些端子在这只元件上根本不存在，怎么排列都连不出来 ——
       以前是兜到 reason:'no-solution'，界面没法解释；这里按「这个类型要几个 p 端子 /
       学生这个类型的元件里有几个带 p 端子」比一遍，缺了就直接 reason:'form'。
       顺序排在 reason:'unwired' 前面：形状不对的话「缺线」是必然结果，要说先说根因。 */
    const formBad = {};
    P.types.forEach(T => {
      const need = {};
      T.slotPins.forEach(pins => pins.forEach(p => { need[p] = (need[p] || 0) + 1; }));
      const have = instOf[T.type] || [];
      Object.keys(need).sort().forEach(p => {
        let n = 0;
        have.forEach(x => { if (x.terms[p]) n++; });
        if (n < need[p]) (formBad[T.type] = formBad[T.type] || []).push(p);
      });
    });
    if (Object.keys(formBad).length) {
      return {
        ok: false, reason: 'form', form: formBad,
        assign: null, tries: 0, nodes: 0, ms: Math.round((nowMs() - t0) * 100) / 100,
        hit: null, hits: [], nets: [], missing: [], wrong: [], open: [], spareWired: [], spareOnly: [],
      };
    }

    // ---- 4.2 学生的线 → 连通块；端子 → 块号 ----
    const list = (wires || []).filter(w => w && w.a && w.b);
    const comps = SW.netsOf(list);
    const compOf = new Map();           // 'FU3.t' → 块号
    comps.forEach((arr, ci) => arr.forEach(t => compOf.set(t, ci)));
    const nComp = comps.length;

    // 每只实例「真的接了线」的端子 id：'FU3' → { t:1, b:1 }
    // 用来判断「这根线接在了本电路不用接线的端子上」（空端子）
    const wiredOf = {};
    list.forEach(w => {
      [w.a, w.b].forEach(t => {
        const s = String(t), i = s.lastIndexOf('.');
        if (i <= 0) return;
        const nm = s.slice(0, i);
        (wiredOf[nm] = wiredOf[nm] || {})[s.slice(i + 1)] = 1;
      });
    });

    // ---- 4.3 先做一个和排列无关的可行性判断：某个端子「接线位置」不够就直接判 impossible ----
    /* 教材每个端子在标准网表里都要求被接通（judge 的 missing 里，一根线都没接的端子永远算缺）。
       所以对每个「实例端子名」（t/b/ci/…）数一下：要求几片（need）vs 学生接了几片（have），
       have < need 就一定无解 —— 这一步和怎么排列无关，能省掉大量无意义的搜索。 */
    const needPin = {}, havePin = {};
    P.types.forEach(T => {
      // 这个类型一共需要几个名为 p 的端子（每个位置各算一次）
      const pinSet = {};
      T.slotPins.forEach(pins => pins.forEach(p => {
        needPin[T.type + '.' + p] = (needPin[T.type + '.' + p] || 0) + 1;
        pinSet[p] = 1;
      }));
      // 学生的这个类型里，有几个实例的 p 端子真的接了线
      Object.keys(pinSet).forEach(p => {
        byType[T.type].forEach(name => {
          if (compOf.has(name + '.' + p)) havePin[T.type + '.' + p] = (havePin[T.type + '.' + p] || 0) + 1;
        });
      });
    });
    let short = null;
    Object.keys(needPin).forEach(k => {
      if (!short && (havePin[k] || 0) < needPin[k]) short = { pin: k, need: needPin[k], have: havePin[k] || 0 };
    });

    const identityAssign = () => {
      const a = {};
      P.types.forEach(T => { a[T.type] = byType[T.type].slice(); });
      return a;
    };
    const finish = (assign, tries, nodes, reason) => {
      const map = mapOf(assign, circuitId);
      const rw = list.map(w => ({ a: map[w.a] !== undefined ? map[w.a] : w.a, b: map[w.b] !== undefined ? map[w.b] : w.b }));
      const j = SW.judge(rw, circuit || null, { nets: W.SUPER_NETS[circuitId] });
      const out = Object.assign({}, j);
      out.assign = assign;
      out.tries = tries;
      out.nodes = nodes;
      out.ms = Math.round((nowMs() - t0) * 100) / 100;
      Object.defineProperty(out, '__cid', { value: circuitId, enumerable: false });
      Object.defineProperty(out.assign, '__cid', { value: circuitId, enumerable: false });
      if (reason) out.reason = reason;

      /* ---- 空端子：本电路不用接线、学生却接了线 ----
         practice.js:595-596 的口径是 `ns.has('×')` 算错接（'×' = 这个端子不在标准网表里），
         但 super-wire.js 的 judge() 对「网表里没有的端子」是 `return` 掉了（见它的 wrong 判定），
         所以这里补上：这个排列里没有被映射到的学生端子（= 本电路不用接线）只要接了线，就算错。
           · spareWired：所有碰到空端子的线（按 SW.key 排好去重），也并进 wrong，
             界面按 wrong.length 报「有 N 根线接错」就自然带上了；
           · spareOnly ：其中「整块全是空端子」的那些（= 把两个不该接的端子接在一起），
             和 practice.js:598 的另一种说法对应。 */
      const spare = [], spareOnly = [];
      list.forEach(w => {
        const ua = map[w.a] === undefined, ub = map[w.b] === undefined;
        if (!ua && !ub) return;
        const k = SW.key(w.a, w.b);
        spare.push(k);
        const ca = compOf.get(w.a), cb = compOf.get(w.b);
        const allSpare = c => c !== undefined && comps[c].every(t => map[t] === undefined);
        if (allSpare(ca) && allSpare(cb)) spareOnly.push(k);
      });
      out.spareWired = sortUniq(spare);
      out.spareOnly = sortUniq(spareOnly);
      if (out.spareWired.length) {
        out.wrong = sortUniq((out.wrong || []).concat(out.spareWired));
        out.ok = false;      // judge() 看不见这些线，这里替它把结论定死
      }
      return out;
    };

    if (short) return finish(identityAssign(), 0, 0, 'unwired');   // 有端子根本没接线 → 必然不对

    // ---- 4.4 预编译每个 (实例, 位置) 的约束：这个端子落在哪个块、该映射到哪个网 ----
    const prepTypes = P.types.map(T => {
      const slots = T.slots, names = byType[T.type];
      const n = names.length;
      // pairs[i][s] = [块号, 网号, 块号, 网号, ...]（只收「两个都查得到」的）
      // forbid[i][s] = 1 表示这个 (实例, 位置) 直接不可能，两种来由：
      //   a. 教材要求这个端子必须接通（在标准网表里），可学生这只元件这个端子一根线都没有
      //      → 重写后必然是 open/missing；
      //   b. 这只元件某个端子接了线，但这个位置里没有它 —— 也就是接到了「本电路不用接线」的端子上
      //      → 按 practice.js 的 '×' 口径算错接（super-wire.js 的 judge 看不见这种线，这里挡掉）。
      const pairs = [], forbid = [];
      for (let i = 0; i < n; i++) {
        const row = [], fb = new Uint8Array(slots.length);
        const wd = wiredOf[names[i]] || {};
        for (let s = 0; s < slots.length; s++) {
          const a = [];
          const pins = slots[s].pins;
          Object.keys(pins).forEach(instPin => {
            const netIdx = P.termNet[slots[s].dev + '.' + pins[instPin]];
            if (netIdx === undefined) return;            // 端子不在标准网表里（例如 QF 进线不用接）→ 不要求
            const c = compOf.get(names[i] + '.' + instPin);
            if (c === undefined) { fb[s] = 1; return; }  // 有要求却没接线 → 这一对不可能
            a.push(c, netIdx);
          });
          if (!fb[s]) {
            const ids = Object.keys(wd);
            for (let q = 0; q < ids.length; q++) {
              if (pins[ids[q]] === undefined) { fb[s] = 1; break; }   // b 条：接到空端子上
            }
          }
          row.push(a);
        }
        pairs.push(row);
        forbid.push(fb);
      }
      // 每个位置上的候选实例顺序：约束多的先试（最可能先命中），名字兜底保证确定性
      const cand = slots.map((_s, si) => {
        const idx = names.map((nm, i) => i);
        idx.sort((x, y) => (pairs[y][si].length - pairs[x][si].length)
          || (names[x] < names[y] ? -1 : names[x] > names[y] ? 1 : 0));
        return idx;
      });
      // 位置的处理顺序：约束多的位置先定（最强的约束最先发力）
      const slotOrder = slots.map((s, si) => si);
      slotOrder.sort((x, y) => {
        let cx = 0, cy = 0;
        for (let i = 0; i < n; i++) { cx += pairs[i][x].length; cy += pairs[i][y].length; }
        return (cy - cx) || (x - y);
      });
      return { type: T.type, slots: slots, names: names, pairs: pairs, forbid: forbid, cand: cand, slotOrder: slotOrder, count: n };
    });

    // 类型按「实例数从大到小」—— FU 5! 先试，约束最强，先把大盘定死
    prepTypes.sort((a, b) => (b.count - a.count)
      || (b.slots.length - a.slots.length)
      || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

    // 拉平成一串 step：每步 = 定一个位置
    const steps = [];
    prepTypes.forEach(T => T.slotOrder.forEach(si => steps.push({ T: T, si: si })));
    const total = steps.length;

    // ---- 4.5 回溯 + 剪枝 ----
    const compNet = new Int32Array(nComp).fill(-1);   // 块 → 网
    const netComp = new Int32Array(P.netCount).fill(-1); // 网 → 块
    const trail = [];
    const assignOf = {};      // type → [名字...]，下标 = 原始 slot 下标
    const usedOf = {};        // type → Uint8Array
    prepTypes.forEach(T => {
      assignOf[T.type] = new Array(T.slots.length).fill(null);
      usedOf[T.type] = new Uint8Array(T.names.length);
    });

    let tries = 0, nodes = 0, bestDepth = -1, bestSnap = null;

    const snap = () => {
      const o = {};
      prepTypes.forEach(T => { o[T.type] = assignOf[T.type].slice(); });
      return o;
    };
    const undoTo = mark => {
      for (let q = trail.length - 2; q >= mark; q -= 2) { compNet[trail[q]] = -1; netComp[trail[q + 1]] = -1; }
      trail.length = mark;
    };

    const go = k => {
      if (k === total) { tries++; return true; }
      // 进来就先记一笔「这次定到了第几层」：全试完都不行时，拿定得最深的那次给界面提示
      if (k > bestDepth) { bestDepth = k; bestSnap = snap(); }
      const st = steps[k], T = st.T, si = st.si;
      const cand = T.cand[si], used = usedOf[T.type], mark = trail.length;
      for (let ci = 0; ci < cand.length; ci++) {
        const i = cand[ci];
        if (used[i] || T.forbid[i][si]) continue;
        nodes++;
        const pr = T.pairs[i][si];
        let bad = false;
        for (let p = 0; p < pr.length; p += 2) {
          const c = pr[p], n = pr[p + 1];
          const cn = compNet[c];
          if (cn === -1) {
            if (netComp[n] !== -1) { bad = true; break; }   // 这个网已经在别的块里了 → 漏接/跨接
            compNet[c] = n; netComp[n] = c; trail.push(c, n);
          } else if (cn !== n) { bad = true; break; }        // 这个块已经属于别的网 → 错线
        }
        if (bad) { undoTo(mark); continue; }
        used[i] = 1;
        assignOf[T.type][si] = T.names[i];
        if (go(k + 1)) return true;
        assignOf[T.type][si] = null;
        used[i] = 0;
        undoTo(mark);
      }
      return false;
    };

    const ok = go(0);

    // ---- 4.6 出结果 ----
    if (ok) return finish(assignOf, tries, nodes, null);

    /* 全试完都不行：拿「定得最深」的那一次补全成完整排列（剩下的按名字顺序填），
       再交给 judge() 拿 missing / wrong / open —— 让界面能说「还差 3 号线没接通」。
       补全后的排列**可能**会含错线（wrong），那正是要告诉学生的东西。 */
    let best = bestSnap || identityAssign();
    prepTypes.forEach(T => {
      const arr = best[T.type];
      if (!arr) { best[T.type] = byType[T.type].slice(); return; }
      const used = {};
      arr.forEach(nm => { if (nm) used[nm] = 1; });
      const rest = T.names.filter(nm => !used[nm]);
      let r = 0;
      for (let s = 0; s < arr.length; s++) if (!arr[s]) arr[s] = rest[r++];
    });
    return finish(best, tries, nodes, 'no-solution');
  }

  // ==========================================================================
  // 5. 小工具：某个电路的理论置换数（产品式 = 各类型阶乘相乘），测试和界面进度都用得上
  // ==========================================================================
  function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
  function permutations(cid) {
    const S = slots(cid);
    return Object.keys(S).reduce((r, type) => r * factorial(S[type].length), 1);
  }

  /* 这条电路能不能做接线判分（有没有标准网表）。
     P（并联专项）没网表（SUPER_NETS_SKIP 写了原因），界面对它**别调** slots / judgePlaced，
     先问一句 canJudge('P') 再决定要不要进连线环节 —— 这样不用在界面里 try/catch 兜。 */
  function canJudge(cid) { return !!(W.SUPER_NETS && W.SUPER_NETS[cid]); }

  // ---------- 导出 ----------
  W.SUPER_ALIAS = {
    SPLIT: SPLIT,
    splitTerm: splitTerm,
    typeOfDev: typeOfDev,
    slots: slots,
    mapOf: mapOf,
    judgePlaced: judgePlaced,
    permutations: permutations,
    canJudge: canJudge,
    VERSION: VERSION,
    // 给界面/调试用的只读入口
    prep: prep,
  };
})(typeof window !== 'undefined' ? window : globalThis);
