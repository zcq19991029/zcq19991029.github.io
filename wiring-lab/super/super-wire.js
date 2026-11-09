// ============================================================================
// 超级排位模式 · 连线模型 + 判对（纯函数：不碰 DOM、不碰 canvas、不拼任何界面文案）
//
// 一、这个文件干什么
//   超级排位第二步：学生先按题把元器件摆到板上（摆放判对在 super-data.js 的 SUPER.check），
//   摆对之后**在自己摆的位置上**连线。位置各不相同，但「端子名字」是稳定的：
//     实例 id + '.' + 端子 id  ==  原练习页写死的端子字符串，例如 KM1.t0 / SB2.i / QF.b2。
//   所以判对**和位置完全无关**，只看「哪些端子被连成了一片」。
//   这里只提供四件事（全部纯函数）：
//     1) 连线模型：norm / key / addWire / removeWire / termUse
//     2) 等电位点：netsOf / netOf（并查集）
//     3) 判对：judge / groupProgress（+ 取标准答案的 specOf）
//     4) 摆放校验的转调：placementOK（→ SUPER.check，不在这里重数）
//
// 二、口径（**以 practice.js:582 的 check() 为准**，2026-11-07 已逐行核对）
//   check() 不是按线的根数判，而是**按「点」判**，两条同时满足才算对：
//     a. 标准答案里每一个点（等电位点）上的端子，学生必须已经连进同一个连通块
//        （practice.js:588-591：逐点看 roots.size > 1 就记 gap「没连通」）；
//     b. 学生连出来的任何一个连通块，不许同时含有两个不同点的端子
//        （practice.js:593-601：每个连通块 ns.size > 1 就记「错接」，ns.has('×') 记「不用接线的端子」）。
//      实现上等价地按「每根线的两端分别属于标准答案的哪个点」判：只要有一根线两端分属两个点就算错，
//      而且能直接指出是哪一根（一条跨点的通路里必然有某根线跨点），比按连通块判好定位。
//   ★ 所以「多接的线不算错」只在一个点**内部**成立（同一个点里串成链、绕成三角都对）；
//     跨点乱连一根就是错线。任务书里「多接的线不算错」这句按 check() 要收窄，本文件按 check() 实现。
//
//   一个端子最多 2 根线：MAX_PER_TERM = 2
//   （practice.js:459 `const countAt = k => PS.wires.filter(w => w.a === k || w.b === k).length;`
//     + practice.js:463 `if (countAt(k) >= 2) return say('…已经接满两根线…')`）。
//
//   判对只看端子集合：不看线的根数、不看走线路径、不看串接顺序（一根线 = 两端导通）。
//
// 三、标准答案从哪来（2026-11-08 已补齐，现在能判全了）
//   circuit 就是 circuit22.js / circuitE1.js 里的 CIRCUIT 对象：
//     answers[].chains = { 网名: [端子, ...] } → 这个点上允许任意串接的端子集合
//     groups[].nets    = ['W11', ...]        → 分组进度用（只有网名，没有端子）
//   **chains 是「覆盖写」**：practice.js:323 answerWires() 里，chains 里没写的点直接沿用
//   board.js 的教材导线 BW（BW.filter(x => !ans.chains[x.net])）。所以只拿 chains 判对时，
//   只能覆盖 chains 里出现过的点，会「漏接也判对」（2.2 的 U11/V11、E1 除 7/21 之外的 15 个网号）。
//
//   现在两条路都通了：
//     · specOfEx(circuit) 会自动找 BW —— opt.bw → circuit.BW → 全局 BW，
//       找到就用 buildNets(BW, chains) 得**完整网表**（partial = false）；
//     · 页面侧更省事：直接用生成好的 src/super-nets.js
//       judge(wires, circuit, { nets: SUPER_NETS['2.2'] })，
//       那张表由 build-super-nets.cjs 离线算好（8 条电路，P 除外，原因见那个脚本的 SKIP）。
//   两者结果必须一致，test/_super-wire.cjs 第 18 项会逐条比对，改了电路忘重生成会被抓出来。
//
//   另一个已解决的坑：circuit22.js:19「教材图 2-5 接法」和 circuitE1.js:317「教材接法」的 chains 是 {}，
//   意思是「全按 BW 走线」。以前拿不到 BW 所以判不了、只能进 unjudged；
//   现在有了完整网表，这条接法**能判**（它的网表就等于 BW 分组），所以不再进 unjudged。
//   只有退回「只并 chains」时（既没 BW 也没 nets）才仍然列 unjudged。
//
//   还有：2.2 / 2.3 / 2.4 / 2.5 / 2.6 / E2 的几种接法**网表内容完全相同**，只是同一电位点内部
//   串接顺序不同。判对只看集合，所以它们永远同时命中；judge().hit 给第一条，judge().hits 给全部。
//   build-super-nets.cjs 会逐条核这件事，一旦真的不同就报错，不会糊过去。
//
// 四、以后改哪里
//   1) 判对口径要改 → 只动 judge()，别在界面里再写一套。
//   2) 一个端子能接几根 → 只改 MAX_PER_TERM。
//   3) 想按「串接顺序」判（现在不判）→ 在 judge() 里加，不要动 netsOf。
//   4) 不要在这里加文案、颜色、坐标、canvas；界面要什么自己拼（nets / missing / wrong / open 够用）。
// ============================================================================
(function (W) {
  'use strict';

  // 一个端子最多接几根线（practice.js:459 countAt + :463 拦「接满两根」）
  const MAX_PER_TERM = 2;

  // ---------- 小工具：稳定排序（不依赖 locale，保证同样输入永远同样输出） ----------
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const uniqSorted = arr => {
    const s = new Set();
    (arr || []).forEach(x => s.add(x));
    return [...s].sort(cmp);
  };

  // ==========================================================================
  // A. 连线模型
  //    一根线 = { a:'KM1.t0', b:'FU1.b1', color?, cable? }
  //    线是无向的，a/b 只表示两端；去重靠排序后的 key，不靠「谁连的谁」
  // ==========================================================================

  // 无向化：norm({a:'B.x', b:'A.y'}) → ['A.y','B.x']
  function norm(w) {
    const a = String(w.a), b = String(w.b);
    return cmp(a, b) <= 0 ? [a, b] : [b, a];
  }

  // 去重用的键：key('KM1.t0','FU1.b1') → 'FU1.b1|KM1.t0'
  function key(a, b) {
    const n = norm({ a: a, b: b });
    return n[0] + '|' + n[1];
  }

  // 每个端子已经接了几根线：termUse(wires) → { 'KM1.t0': 2, ... }
  function termUse(wires) {
    const use = {};
    (wires || []).forEach(w => {
      [w.a, w.b].forEach(t => { if (t) use[t] = (use[t] || 0) + 1; });
    });
    return use;
  }

  // 加一根线：重复（含反向）→ dup；某端已接满 → full；加到 list 里（原地）并返回 {ok:true, wire}
  function addWire(list, w) {
    const lst = list || [];
    if (!w || !w.a || !w.b) return { ok: false, reason: 'bad', term: null };
    if (String(w.a) === String(w.b)) return { ok: false, reason: 'self', term: w.a };
    const k = key(w.a, w.b);
    for (let i = 0; i < lst.length; i++) {
      if (key(lst[i].a, lst[i].b) === k) return { ok: false, reason: 'dup', term: null };
    }
    const use = termUse(lst);
    for (const t of [w.a, w.b]) {
      if ((use[t] || 0) >= MAX_PER_TERM) return { ok: false, reason: 'full', term: t };
    }
    const nw = Object.assign({}, w); // 保留 color / cable / id 等界面字段
    lst.push(nw);
    return { ok: true, wire: nw };
  }

  // 删一根线（按无向 key 匹配，原地删）：返回删掉的根数
  function removeWire(list, w) {
    const lst = list || [];
    if (!w || !w.a || !w.b) return 0;
    const k = key(w.a, w.b);
    let n = 0;
    for (let i = lst.length - 1; i >= 0; i--) {
      if (key(lst[i].a, lst[i].b) === k) { lst.splice(i, 1); n++; }
    }
    return n;
  }

  // ==========================================================================
  // B. 等电位点（net）：并查集把每根线两端合并
  //    netsOf(wires) → [['FR.t0','KM1.b0','KM2.b2'], ['FU1.b0', ...], ...]
  //    每个子数组内部排序，整体按首元素排序 → 同样输入永远同样输出
  // ==========================================================================
  function netsOf(wires) {
    const parent = new Map();
    const find = x => {
      if (!parent.has(x)) { parent.set(x, x); return x; }
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; }
      return r;
    };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

    (wires || []).forEach(w => {
      if (!w || !w.a || !w.b) return;
      if (String(w.a) === String(w.b)) return;
      uni(String(w.a), String(w.b));
    });

    const bucket = new Map(); // root → 端子数组
    [...parent.keys()].forEach(t => {
      const r = find(t);
      if (!bucket.has(r)) bucket.set(r, []);
      bucket.get(r).push(t);
    });
    const out = [...bucket.values()].map(a => a.sort(cmp));
    out.sort((p, q) => cmp(p[0], q[0]) || cmp(p.join(','), q.join(',')));
    return out;
  }

  // 某个端子现在落在哪个 net 里；没接过线就返回 [term]
  function netOf(nets, term) {
    const t = String(term);
    for (let i = 0; i < (nets || []).length; i++) {
      if (nets[i].indexOf(t) >= 0) return nets[i];
    }
    return [t];
  }

  // ==========================================================================
  // C. 标准答案的网表：specOf(circuit, opt) → { 网名: [端子, ...] }
  //    合并全部 answers[].chains（同一点的不同接法只差串接顺序，集合相同 → 合并成一份）；
  //    opt.nets / circuit.nets 给了整网表就以它为准（网表压过 chains）
  // ==========================================================================
  /* buildNets(bw, chains) → { 网名: [端子...] }
     口径严格照 practice.js:323 answerWires()（`BW.filter(x => !ans.chains[x.net])` + 补 chains）：
       · chains 里**出现过的网**整网替换成 chains 那一份；
       · chains 里**没出现的网**沿用 BW 的导线（把每根线的两端并进同一个网）。
     这样得到的才是「完整网表」。只并 chains（老写法）只能覆盖 chains 里那几个点，
     学生会「漏接也判对」——2.2 的 U11/V11、E1 除 7/21 之外的 15 个网号就是漏的。
     bw 可以为 null（这时等于只有 chains）。同一端子被分到两个网时**抛错**，不静默取一个。 */
  function buildNets(bw, chains) {
    const out = {};
    const ch = chains || {};
    (bw || []).forEach(w => {
      if (!w || !w.net) return;
      if (ch[w.net]) return;                       // 这网被 chains 覆盖，整网跳过（先不收）
      const arr = out[w.net] || (out[w.net] = []);
      [w.a, w.b].forEach(t => { if (t && arr.indexOf(t) < 0) arr.push(t); });
    });
    Object.keys(ch).forEach(n => {
      const terms = ch[n];
      if (!terms || !terms.length) return;
      const arr = out[n] || (out[n] = []);
      terms.forEach(t => { if (arr.indexOf(t) < 0) arr.push(t); });
    });
    Object.keys(out).forEach(n => { out[n] = uniqSorted(out[n]); });

    const owner = {};                              // 端子 → 它已经在哪个网里
    Object.keys(out).forEach(n => out[n].forEach(t => {
      if (owner[t] !== undefined && owner[t] !== n) {
        throw new Error('buildNets：端子 ' + t + ' 同时落在网「' + owner[t] + '」和「' + n +
          '」，数据有冲突（BW 与 chains 对不上），请先修电路数据');
      }
      owner[t] = n;
    }));
    return out;
  }

  /* specOfEx(circuit, opt) → {table, partial, src}
     table   = 标准答案网表（judge / groupProgress 都用它）
     partial = true 表示这张表**不全**（既没有 BW 也没有 opt.nets，只能靠 chains）
     src     = 'bw' | 'nets' | 'chains'，说明表是哪来的，出问题时好定位
     opt 可传：{ ans: 第几种接法(默认 0), chains: 直接给, bw: BW 数组, nets: 现成网表 }
     传了 opt.nets 就完全以它为准（压过 bw / chains）。 */
  function specOfEx(circuit, opt) {
    const o = opt || {};
    const answers = (circuit && circuit.answers) || [];
    const ai = o.ans != null ? o.ans : 0;
    const a0 = answers[ai] || answers[0] || null;

    const pre = o.nets || (circuit && circuit.nets);
    if (pre) {
      const t = {};
      Object.keys(pre).forEach(n => { t[n] = uniqSorted((pre[n] || []).slice()); });
      return { table: t, partial: false, src: 'nets' };
    }

    const bw = o.bw || (circuit && circuit.BW) ||
      (typeof BW !== 'undefined' ? BW : null);       // 练习页/成品里 BW 是全局的
    const chains = o.chains != null ? o.chains : (a0 && a0.chains) || null;

    if (bw && bw.length) {
      return { table: buildNets(bw, chains), partial: false, src: 'bw' };
    }

    /* 没有 BW 的退路：把**所有接法**的 chains 并起来（老行为，保留）。
       这条只是「判不全但能判一部分」，partial = true，界面不该拿它当最终判据。 */
    const out = {};
    answers.forEach(a => {
      const ch = a && a.chains;
      if (!ch) return;
      Object.keys(ch).forEach(n => {
        const terms = ch[n];
        if (!terms || !terms.length) return;
        const arr = out[n] || (out[n] = []);
        terms.forEach(t => { if (arr.indexOf(t) < 0) arr.push(t); });
      });
    });
    Object.keys(out).forEach(n => { out[n] = uniqSorted(out[n]); });
    return { table: out, partial: true, src: 'chains' };
  }

  function specOf(circuit, opt) { return specOfEx(circuit, opt).table; }

  // ==========================================================================
  // D. 判对：judge(wires, circuit, opt)
  //    返回 {
  //      ok, hit:{name,desc}|null, hits:[接法名...],
  //      nets,           // netsOf 的结果，界面拿去画「哪些点已经接通了」
  //      missing:[{net, want, got}],   // 还没接全的点；got = 已接在一起的最大那一截
  //      wrong:['KM1.t0|KM2.t0'],      // 跨点连错的线（按 key 排好、去重）
  //      open:['KM1.b3'],              // 该接但一根线都没接的端子
  //      unjudged:['教材图 2-5 接法']   // chains 是空的、判不了的接法（只有名字）
  //    }
  // ==========================================================================
  function judge(wires, circuit, opt) {
    const list = wires || [];
    const nets = netsOf(list);
    const where = {}; // 端子 → net 下标
    nets.forEach((nt, i) => nt.forEach(t => { where[t] = i; }));

    const sp = specOfEx(circuit, opt);
    const spec = sp.table;
    const names = Object.keys(spec);
    // 这一组端子是否已经全在同一个 net 里
    const inOne = want => {
      if (!want.length) return true;
      const i = where[want[0]];
      if (i === undefined) return false;
      return want.every(t => where[t] === i);
    };

    // ---- 没接全的点 ----
    const missing = [];
    names.forEach(n => {
      const want = spec[n];
      if (inOne(want)) return;
      const byNet = {}; // net 下标（或 'none'）→ 端子
      want.forEach(t => {
        const i = where[t];
        const k = i === undefined ? 'none' : i;
        (byNet[k] = byNet[k] || []).push(t);
      });
      let got = [];
      Object.keys(byNet).forEach(k => { if (byNet[k].length > got.length) got = byNet[k]; });
      missing.push({ net: n, want: want.slice(), got: uniqSorted(got) });
    });

    // ---- 跨点连错的线（check() 的 b 条：一根线的两端不许分属两个不同点）----
    //   注意比的是**标准答案里的点**（specNet），不是学生接出来的连通块：
    //   一旦跨点连了，两端会并进同一个连通块，拿连通块比是查不出来的。
    const specNet = {};
    names.forEach(n => spec[n].forEach(t => { specNet[t] = n; }));
    const wrong = [];
    list.forEach(w => {
      if (!w || !w.a || !w.b) return;
      const na = specNet[w.a], nb = specNet[w.b];
      if (na === undefined || nb === undefined) return; // 不在标准答案网表里 → 判不了，不算错
      if (na !== nb) wrong.push(key(w.a, w.b));
    });

    // ---- 该接但一根线都没接的端子 ----
    const use = termUse(list);
    const allSpecTerms = [];
    names.forEach(n => spec[n].forEach(t => allSpecTerms.push(t)));
    const open = uniqSorted(allSpecTerms).filter(t => !use[t]);

    /* ---- 命中哪种接法 ----
       有了完整网表（sp.partial === false），chains 是 {} 的那一条（「教材图 xx 接法」＝全按 BW 走线）
       也是能判的，所以它要参与命中，不能塞进 unjudged。
       只有退回「只并 chains」时才判不了，那才列 unjudged。 */
    const answers = (circuit && circuit.answers) || [];
    const judgeable = a => a && (sp.partial ? !!(a.chains && Object.keys(a.chains).length) : true);
    const usable = answers.filter(judgeable);
    const unjudged = answers.filter(a => !judgeable(a)).map(a => a.name);
    const okv = names.length > 0 && missing.length === 0 && wrong.length === 0;
    const hits = okv ? usable.map(a => a.name) : [];
    const hit = okv && usable.length ? { name: usable[0].name, desc: usable[0].desc } : null;

    return {
      ok: okv,
      hit: hit,
      hits: hits,
      nets: nets,
      missing: missing,
      wrong: uniqSorted(wrong),
      open: open,
      unjudged: unjudged,
    };
  }

  // ==========================================================================
  // E. 分组进度：groupProgress(wires, circuit, opt) → [{name, why, done, total, ok, unknown}]
  //    groups[].nets 只有网名，端子要从网表里查；查不到（chains 没覆盖）的网号进 unknown，
  //    该组 total 只数查得到的；一个都查不到时 ok = null（没法判，不算错也不算对）
  // ==========================================================================
  function groupProgress(wires, circuit, opt) {
    const list = wires || [];
    const nets = netsOf(list);
    const where = {};
    nets.forEach((nt, i) => nt.forEach(t => { where[t] = i; }));
    const spec = specOf(circuit, opt);
    const inOne = want => {
      if (!want || !want.length) return false;
      const i = where[want[0]];
      if (i === undefined) return false;
      return want.every(t => where[t] === i);
    };

    return ((circuit && circuit.groups) || []).map(g => {
      const ns = g.nets || [];
      const unknown = [];
      let done = 0, total = 0;
      ns.forEach(n => {
        const want = spec[n];
        if (!want) { unknown.push(n); return; }
        total++;
        if (inOne(want)) done++;
      });
      return {
        name: g.name,
        why: g.why,
        done: done,
        total: total,
        ok: total ? done === total : null,
        unknown: unknown,
      };
    });
  }

  // ==========================================================================
  // F. 摆放校验：转调 super-data.js 的 SUPER.check（super-data.js:436），不在这里重数
  //    placementOK(list, '2.2') → {ok:true} 或 {ok:false, miss:[...], extra:[...]}
  // ==========================================================================
  function placementOK(list, id) {
    if (!W.SUPER || typeof W.SUPER.check !== 'function') {
      throw new Error('SUPER_WIRE.placementOK：super-data.js 没加载（window.SUPER.check 不存在）');
    }
    if (!id) throw new Error('SUPER_WIRE.placementOK：要传电路 id，例如 placementOK(list, "2.2")');
    return W.SUPER.check(list, id);
  }

  // ---------- 导出 ----------
  W.SUPER_WIRE = {
    MAX_PER_TERM: MAX_PER_TERM,
    norm: norm,
    key: key,
    addWire: addWire,
    removeWire: removeWire,
    termUse: termUse,
    netsOf: netsOf,
    netOf: netOf,
    specOf: specOf,
    specOfEx: specOfEx,
    buildNets: buildNets,
    judge: judge,
    groupProgress: groupProgress,
    placementOK: placementOK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
