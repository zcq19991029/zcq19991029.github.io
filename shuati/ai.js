/* 刷题的 AI 调用：2026-11-08（Z5）起**全部走首页「AI 设置」**（网站根目录 hx-ai.js 挂的 window.HXAI）。
   以前这里自己存 Key / 接口地址 / 模型、自己拼 fetch，设置页还有一整张「AI 解析」卡；
   同一个 Key 要在首页和刷题各填一遍，模型名、超时、报错也两套。现在：
     · 不再自存任何 Key（旧的 zcq-ai 那族本地键已不读不写）；
     · 文本问答 → HXAI.chat（cap:'text'）；要多想的 → cap:'reason'（没配推理默认时 HXAI 自己回落 text）；
     · 读图 → HXAI.vision（cap:'vision'，不回落 —— 把图塞给文字模型只会换来看不懂的报错）；
     · 调用都带 tool:'quiz'，首页「按工具指定」给刷题单独选的那套优先。
   没配（HXAI 不在 / 该能力没有可用模型 / 没填 Key）时统一抛 NO_AI 这句中文，界面在原位给去 /ai/ 的链接。
   离线单文件（离线打包.cjs）彻底不带 AI（用户 2026-11-08：「我们彻底放弃离线版即可」）。 */
export const NO_AI = '还没配置 AI，去首页 AI 设置';
export const AI_PAGE = '/ai/';
const OFFLINE_MSG = '离线版没有 AI 功能，请用网页版';

const hxai = () => {
  const H = globalThis.HXAI;
  return H && typeof H.chat === 'function' ? H : null;
};
const isOffline = () => !!globalThis.__OFFLINE;

// 首页的 hx-ai.js 按需加载（和 hx-theme.js 同一层：../hx-ai.js）。离线版不加载。
let loading = null;
export function ensureHxAi() {
  if (hxai()) return Promise.resolve(hxai());
  if (isOffline() || typeof document === 'undefined') return Promise.resolve(null);
  if (!loading) {
    loading = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = '../hx-ai.js';
      s.onload = () => resolve(hxai());
      s.onerror = () => { loading = null; resolve(null); }; // 失败允许下次再试
      document.head.appendChild(s);
    });
  }
  return loading;
}

/* 按 hx-ai.js 的 pick() 同样的顺序猜「这次会用哪一套」，只用来判断配没配、给提示；
   真正调用时仍由 HXAI 自己挑（两边规则一致：工具指定且能干这件事 → 按能力默认 → 推理退文本 → 文本退第一套）。 */
function guessProfile(H, cap) {
  const can = (p, c) => !!p && (c === 'text' || (p.caps || []).includes(c));
  if (typeof H.settings === 'function') {
    const s = H.settings() || {}, ps = s.profiles || [], act = s.active || {}, tools = s.tools || {};
    const by = id => ps.find(p => p.id === id) || null;
    const byTool = by(tools.quiz);
    if (byTool && can(byTool, cap)) return byTool;
    const byCap = by(act[cap]);
    if (byCap) return byCap;
    if (cap === 'reason' && by(act.text)) return by(act.text);
    if (byTool) return byTool;
    return cap === 'text' || cap === 'reason' ? ps[0] || null : null;
  }
  // 精简版 HXAI（只有 forTool / activeFor 的桩）
  if (cap === 'vision' && typeof H.activeFor === 'function') return H.activeFor('vision') || null;
  return typeof H.forTool === 'function' ? H.forTool('quiz') || null : null;
}

/* 配没配：{ ok, msg, profile }。cap = text / reason / vision。 */
export function aiState(cap = 'text') {
  if (isOffline()) return { ok: false, offline: true, msg: OFFLINE_MSG };
  const H = hxai();
  if (!H) return { ok: false, msg: NO_AI };
  let p = null;
  try { p = guessProfile(H, cap); } catch { p = null; }
  if (!p) return { ok: false, msg: cap === 'vision' ? '还没配置能看图片的 AI（要勾「图片识别」），去首页 AI 设置' : NO_AI };
  if (p === true) return { ok: true, profile: null };
  let has = true;
  if (typeof H.hasKey === 'function' && p.id) has = H.hasKey(p.id);
  else if ('key' in p || 'apiKey' in p) has = !!String(p.key || p.apiKey || '').trim();
  if (!has) return { ok: false, profile: p, msg: `首页 AI 设置里「${p.name || p.model || '这套'}」还没填 Key，去首页 AI 设置补上` };
  return { ok: true, profile: p };
}
export const aiReady = (cap = 'text') => aiState(cap).ok;

function noAi(state) {
  const e = new Error(state.msg || NO_AI);
  e.noAi = true;
  return e;
}

// 首页配好的全部模型（问 AI 的模型下拉用）。没配就是空数组。
export function aiProfiles() {
  const H = hxai();
  try { return H && typeof H.list === 'function' ? H.list() : []; } catch { return []; }
}
export function aiThinkLevels() {
  const H = hxai();
  return (H && Array.isArray(H.thinkLevels) && H.thinkLevels.length) ? H.thinkLevels
    : [{ id: 'quick', name: '快速' }, { id: 'balanced', name: '均衡' }, { id: 'deep', name: '深度' }];
}

/* 一次性拿全文（出题、识题、整理要求）。json:true 时 HXAI 已剥掉 ```json 围栏。 */
export async function chat(messages, { json = false, cap = 'text' } = {}) {
  const st = aiState(cap);
  if (!st.ok) throw noAi(st);
  return hxai().chat({ messages, json, cap, tool: 'quiz' });
}

/* 问 AI、逐项解析用。HXAI 目前不流式，拿到全文后回调一次 onProgress（调用方的写法不用改）。
   opts：profile（问 AI 下拉里换的那一套，不传 = 首页给刷题配的）、thinkLevel（quick/balanced/deep，
   不传 = 那套配置自己的思考程度）、cap（'reason' 时没配推理就回落 text）、maxTokens、temperature。 */
export async function streamChat(messages, onProgress, opts = {}) {
  const cap = opts.cap || 'text';
  const st = aiState(cap);
  if (!st.ok) throw noAi(st);
  const req = { messages, cap, tool: 'quiz' };
  if (opts.profile) req.profile = opts.profile;
  if (opts.thinkLevel) req.thinkLevel = opts.thinkLevel;
  if (opts.maxTokens) req.maxTokens = opts.maxTokens;
  if (opts.temperature != null) req.temperature = opts.temperature;
  const text = String(await hxai().chat(req) || '').trim();
  if (!text) throw new Error('模型未返回解析文字，请重试或更换模型。');
  onProgress?.(text);
  return text;
}

/* 读图：images 是 dataURL 数组。只找勾了「图片识别」的那套。 */
export async function vision(opts = {}) {
  const st = aiState('vision');
  if (!st.ok) throw noAi(st);
  return hxai().vision({ ...opts, tool: 'quiz' });
}

/* ---------- 解析规范（skill 式，2026-11-08） ----------
   用户原话：「口诀是相当于给 skills 给 ai 解析回答内容的规范约束 也就是点了 ai 解析他会有指定模块
             各自解析 而不是我们写进去 不同 api 回复还不固定呢」
   所以下面不是「我们写死的卡片内容」，而是**给 AI 的写作规范**：点一次「✦ AI 逐项解析」，
   模型就按这几个模块各自生成，前端只负责收和摆。
   ── 改这里等于改所有题的解析形态 ──
   内置题库、导入题、老师发布的题，走的是同一个 explainQuestion；模块加在这里，全站一起变。
   ── 为什么只约束「有什么块、每块写什么、不许写什么」 ──
   不同服务商（DeepSeek / 硅基流动 / 自定义）回复长短、句式都不固定，规范写太死反而崩；
   解析端（explainQuestion 里 JSON + 逐行两条路）仍然尽量宽容。 */
const PARSE_SPEC = {
  /* 模块 1 · 逐项解析：每个选项都要交代为什么对 / 为什么错 */
  options: `每项解释它为何符合或不符合题意，联系具体知识点；不能只重复答案。否定式题干要说明判别标准；没有依据时如实说明。涉及理论的发展水平、阶段或概念归属时，必须给出准确归属，不能笼统猜测。每项 25-60 字。严格按选项顺序逐行输出，格式为“A: 解析”。`,
  /* 模块 2 · 学习卡：考点 / 步骤 / 记住 / 易错（缺哪块就不写，不许凑） */
  card: `所有选项结束后，再给出这张「学习卡」的内容（写给零基础学生看）。能写就写，确实没有就整行省略 —— 不要凑字、不要复述题干、不要写 Markdown：
考点: 这道题真正在考什么，一句话，不超过 30 字。
步骤1: 从零开始的做题顺序，2～5 条，每条一句话、不超过 40 字（先判断什么、再套什么、最后检查什么）。按步骤1、步骤2 依次编号。
记住1: 这类题必须背下来的对应关系，最多 4 条，写成「条件｜结果」（中间用全角竖线，例如“x 趋于 0｜sinx/x 趋于 1”）；没有就省略。
易错: 最容易错在哪、怎么自检，不超过 60 字。`,
  /* 模块 3 · 速记技巧：口诀必须标明来源，AI 自己编的必须写「AI 联想」 */
  tip: `再按规则决定是否输出速记技巧：
1. 仅在你确信存在广泛通用且准确的备考口诀时，输出“速记技巧: 常见口诀｜……”。不得声称或暗示来自粉笔等机构，除非题目资料明确给出了出处。
2. 若没有现成口诀，但可以从本题核心概念做出简短、不改变知识事实的谐音或联想，可输出“速记技巧: AI 联想｜……”。它必须明确是 AI 联想，不能伪装成现成口诀。
3. 两者都不合适时，输出“速记技巧: 无”。不要复述题干、硬押韵或编造口诀。`,
  /* 模块 4 · 题库复核：题库答案只是待核对材料 */
  review: `最后必须另起一行输出“题库复核: 一致｜简短理由”或“题库复核: 建议复核｜独立判断与理由”。如果你能明确判断更可信的选项，再另起一行输出“AI结论: B｜理由”（把 B 换成实际选项）；无法确定时输出“AI结论: 无法确定｜理由”。题库标注答案和资料校对说明都只是待核对材料，不能据此强行解释；发现冲突、题干不完整或存在不同口径时，必须写“建议复核”。`,
  /* 硬约束：进 system，压在所有模块之上；老师给的额外要求也得服从这条底线 */
  hard: `逐项解析必须准确，不要把题库答案当作权威结论；发现疑点应明确建议复核。速记技巧只在有可靠常见口诀，或有明确标注的 AI 联想时给出；不合适就写无。学习卡（考点/步骤/记住/易错）只写你有把握的，宁可少写一行，也不要编。用户可能会给这道题的额外要求（这道题该怎么讲、别讲什么），必须遵守；但额外要求不能推翻准确性，也不能成为编造知识的理由。`
};

/* ---------- 把模型的话变成结构化数据 ----------
   逐项解析（explainQuestion）和「给这道题提要求」（parseStudySpec）用的是同一套：
   模型可能老老实实回 JSON，也可能图省事回一行一行的中文，两条路都得认。 */
const txt = v => String(v == null ? '' : v).trim();
const strOr = (a, b) => (typeof a === 'string' && a.trim() ? a : typeof b === 'string' ? b : '');
const toList = v => (Array.isArray(v) ? v : v ? [v] : []).map(txt).filter(Boolean);
/* 「记住N」要拆成「条件 / 结果」两列。模型写起来有两种习惯：
   · 条件｜结果（提示词里推荐的，最明确）
   · 条件→结果
   箭头这条要小心：极限本身就带箭头（“x→0 时 sinx/x→1” 有两个箭头），
   拆开就成了「x」和「0 时 sinx/x → 1」，读起来是错的。所以**只有恰好一个箭头时才拆**，
   两三个箭头的整条留在一格里（渲染时 colspan 拉满），宁可少两列也不要切错。 */
const toRows = v => (Array.isArray(v) ? v : []).map(r => {
  if (Array.isArray(r)) return [txt(r[0]), txt(r[1])];
  const s = txt(r);
  let m = s.split(/\s*[｜|]\s*/);
  if (m.length < 2 && (s.match(/→|->|⇒|=>/g) || []).length === 1) m = s.split(/\s*(?:→|->|⇒|=>)\s*/);
  return m.length > 1 ? [m[0], m.slice(1).join(' → ')] : ['', s];
}).filter(r => r[0] || r[1]);
const normTip = value => {
  const tip = String(value || '').trim();
  return /^(?:无|暂无|没有|不适用)[。！!]?$/u.test(tip) ? '' : tip;
};

/* spec（第 5 个参数，2026-11-08 加）：老师对**这道题**的要求（该怎么讲、强调什么、别讲什么）。
   以前这里没有这个口子，老师想让某道题多讲一句，只能自己写一段固定文案塞进题库 ——
   用户否掉了那个方向（「不是我们写进去」），改成：要求进提示词，内容仍由模型按规范现场生成。 */
export async function explainQuestion(question, selection, onProgress, subjectName = '', spec = '') {
  const options = question.options.map(item => `${item.key}. ${item.text}`).join('\n');
  const keys = question.options.map(item => item.key);
  const ask = String(spec || '').trim();
  const prompt = `请针对这道${subjectName ? `“${subjectName}”课程的` : ''}考试题逐项解析。
${ask ? `
【这道题老师特别要求】（必须照做）
${ask}
要求与准确性冲突时，先保证准确，再在最后一行写“与老师要求不一致：原因”。不得为了迎合要求把错的说成对的，也不得因此编造知识。
` : ''}
${PARSE_SPEC.options}

${PARSE_SPEC.card}

${PARSE_SPEC.tip}

${PARSE_SPEC.review}

不要 Markdown、不要开头结尾。
题型：${question.type}
题干：${question.stem}
选项：
${options}
题库标注答案（可能有误，仅供交叉核对）：${question.answer.join(',')}
${question.explanation ? `资料校对材料（可能有误，需独立判断）：${question.explanation}` : ''}
学生选择：${selection.join(',')}`;
  const raw = await streamChat([{ role: 'system', content: `你是审慎、独立的${subjectName ? `“${subjectName}”课程` : ''}辅导老师。${PARSE_SPEC.hard}` }, { role: 'user', content: prompt }], onProgress);
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\x60\x60\x60\s*$/, '')); } catch { /* try line parsing below */ }
  const source = parsed?.options || parsed;
  /* 学习卡四块（2026-11-07）。模型可能给 JSON，也可能给逐行文本，两条路都要认 ——
     先把 JSON 那边取出来，逐行解析时再覆盖，谁的拿得到算谁的。
     （txt / toList / toRows 已提到模块级，parseStudyCard 共用同一套。） */
  let card = {
    lead: txt(strOr(parsed?.lead, parsed?.['考点'])),
    steps: toList(parsed?.steps || parsed?.['步骤']),
    table: toRows(parsed?.table || parsed?.['记住']),
    warn: txt(strOr(parsed?.warn, parsed?.['易错']))
  };
  const parsedTip = normTip(typeof parsed?.tip === 'string' ? parsed.tip : typeof parsed?.['速记技巧'] === 'string' ? parsed['速记技巧'] : '');
  const normalizeReviewAnswer = value => { const match = String(value || '').match(/\b([A-Z])\b/g); return match?.length ? [...new Set(match.filter(key => keys.includes(key)))] : []; };
  const parsedReview = String(typeof parsed?.review === 'string' ? parsed.review : typeof parsed?.['题库复核'] === 'string' ? parsed['题库复核'] : '').trim();
  const explicitReviewAnswer = normalizeReviewAnswer(parsed?.reviewAnswer || parsed?.['AI结论']);
  const inferredReviewAnswer = parsedReview.match(/(?:以|选|答案为|应为)\s*([A-Z])/u)?.[1];
  const parsedReviewAnswer = explicitReviewAnswer.length ? explicitReviewAnswer : (inferredReviewAnswer ? [inferredReviewAnswer] : []);
  const cardOut = () => ({ _lead: card.lead, _steps: card.steps, _table: card.table, _warn: card.warn });
  if (source && keys.every(key => typeof source[key] === 'string' && source[key].trim())) {
    return { ...Object.fromEntries(keys.map(key => [key, source[key].trim()])), _tip: parsedTip, _review: parsedReview, _reviewAnswer: parsedReviewAnswer, ...cardOut() };
  }
  const lines = {};
  let tip = '', review = '', reviewAnswer = [];
  const stepList = [], tableRows = [];
  for (const line of raw.split('\n')) {
    const tipMatch = line.match(/^\s*(?:速记技巧|记忆技巧|口诀)\s*[：:]\s*(.+)$/);
    if (tipMatch) { tip = tipMatch[1].trim(); continue; }
    const reviewMatch = line.match(/^\s*题库复核\s*[：:]\s*(.+)$/);
    if (reviewMatch) { review = reviewMatch[1].trim(); continue; }
    const conclusionMatch = line.match(/^\s*AI结论\s*[：:]\s*([A-Z])\s*[|｜:]\s*(.+)$/);
    if (conclusionMatch && keys.includes(conclusionMatch[1])) { reviewAnswer = [conclusionMatch[1]]; continue; }
    /* 学习卡：考点 / 步骤N / 记住N / 易错。编号可省（“步骤:”也算一条），冒号全角半角、点号都认；
       这几条必须排在下面的「A: 解析」之前判断 —— 虽然 A-Z 不会跟中文撞，但顺序写死以后好读。 */
    const leadMatch = line.match(/^\s*考点\s*[：:.、．]\s*(.+)$/);
    if (leadMatch) { card.lead = leadMatch[1].trim(); continue; }
    const stepMatch = line.match(/^\s*步骤\s*\d*\s*[：:.、．]\s*(.+)$/);
    if (stepMatch) { stepList.push(stepMatch[1].trim()); continue; }
    const memoMatch = line.match(/^\s*记住\s*\d*\s*[：:.、．]\s*(.+)$/);
    if (memoMatch) { tableRows.push(memoMatch[1].trim()); continue; }
    const warnMatch = line.match(/^\s*易错(?:提醒|点|提示)?\s*[：:.、．]\s*(.+)$/);
    if (warnMatch) { card.warn = warnMatch[1].trim(); continue; }
    const match = line.match(/^\s*([A-ZTF])\s*[.、:：]\s*(.+)$/);
    if (match) lines[match[1]] = match[2].trim();
  }
  /* 逐行格式下模型常把好几步挤在一行（“步骤1: 甲；乙；丙”），只有一条又带分号的拆开；
     多条各自成段的不动，免得把“先求导；再代值”这种一句话拆成两半。 */
  if (stepList.length === 1 && /[；;]/.test(stepList[0])) card.steps = stepList[0].split(/[；;]/).map(txt).filter(Boolean);
  else if (stepList.length) card.steps = stepList;
  if (tableRows.length) card.table = toRows(tableRows);
  if (keys.every(key => lines[key])) return { ...Object.fromEntries(keys.map(key => [key, lines[key]])), _tip: normTip(tip), _review: review, _reviewAnswer: reviewAnswer, ...cardOut() };
  throw new Error('模型未返回完整的逐项解析，请重试或更换模型。');
}

/* ---------- 说人话，让 AI 整理成「给 AI 的要求」（2026-11-08 改方向） ----------
   用户先说：「手写 json 谁会写？我只会写人话，需要 ai 理解和询问确认」。
   紧接着纠正了方向：「口诀是相当于给 skills 给 ai 解析回答内容的规范约束
   也就是点了 ai 解析他会有指定模块各自解析 而不是我们写进去 不同 api 回复还不固定呢」。
   所以这个函数**不产出学生会看到的文字**，只产出三样东西：
     ① read —— 复述一遍老师的意思，让老师核对（只给老师看，不入库）
     ② items —— 整理成 1～5 条祈使句要求（「必须……」「不要……」「重点讲……」），入库
     ③ ask —— 没听准的地方反问老师（只给老师看，不入库）
   入库的只有 items。点「✦ AI 逐项解析」时，items 拼成一段塞进提示词，内容仍由模型现场生成。
   ── 为什么不许它补知识 ──
   在这里补了，就等于替老师写下了解析，又回到「我们写进去」那条老路；
   真觉得该补的，写进 ask 问老师，让老师自己决定要不要说。
   ── 为什么不用流式 ──
   这里要的是一整个对象，不是边出边看的长文；chat({json:true}) 一次给全。 */
export async function parseStudySpec(question, words) {
  const q = question || {};
  const stem = String(q.stem || '').replace(/\s+/g, ' ').trim();
  const options = (q.options || []).map(o => `${o.key}. ${o.text}`).join('\n');
  const prompt = `下面是老师对「这道题该怎么讲」说的一段大白话。你的任务**不是替他写解析**，而是把这段话整理成**给 AI 的写作要求**：以后每次点「AI 逐项解析」，AI 就照这几条要求讲这道题。

规则：
1. 只整理老师明确表达过的意思。他没说的知识点不要补进来 —— 这里补一句，AI 以后每次都会照着讲，等于替他改了题。
2. 老师说的和题库标注答案冲突时，不要替他选边，把这个矛盾写进 ask 问他。
3. 大白话原样保留（「关管子」「拉低」「写 1」这类说法别换成术语），AI 要看的就是老师本人的说法。
4. items 一律写成**祈使句**，直接对 AI 下命令：
   · 必须…… / 不要…… / 重点讲…… / 先说……再说…… / 用……的说法解释
   · 每条只说一件事，不超过 40 字，最多 5 条
   · 不要写成「老师认为 xxx」这种转述，更不能写成解析内容本身
5. 老师只说「这题简单讲讲」这类没有具体要求的话，items 就给空数组，并在 ask 里问他到底想强调什么。

只输出一个 JSON 对象，不要 Markdown、不要额外解释：
{"read":"用一句话复述老师的意思，让老师核对（不超过 60 字）",
 "items":["给 AI 的祈使句要求 1","要求 2"],
 "ask":["需要老师确认或补充的问题，最多 3 条，问得具体；没有就空数组"]}

题目题型：${q.type || ''}
题干：${stem}
${options ? `选项：\n${options}\n` : ''}标准答案：${(q.answer || []).join('、')}
${q.explanation ? `题库原解析（可能不全，只作参考）：${q.explanation}\n` : ''}老师原话：
${String(words || '').trim()}`;
  const raw = await chat([
    { role: 'system', content: '你是帮老师把大白话整理成「讲解要求」的中文助手。你只做整理和追问，不替老师解题、不替他补知识；整理出来的每一条都是给另一个 AI 的祈使句命令，不是解析内容本身。' },
    { role: 'user', content: prompt }
  ], { json: true });
  let parsed = null;
  try { parsed = JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\x60\x60\x60\s*$/, '')); } catch { /* 逐行兜底，见下 */ }
  /* read 前面常带「你说的是：」「老师说：」—— 界面上已经写了一遍「我理解你的意思是：」，
     不剥掉就会变成「我理解你的意思是：你说的是：……」。模型爱怎么开头都行，这里统一削掉。 */
  const stripLead = s => String(s || '').replace(/^(?:你说的是|你说的意思(?:是)?|你的意思(?:是)?|老师说的意思(?:是)?|老师说|意思(?:是)?|大意(?:是)?|要求(?:是)?)\s*[：:，,、]\s*/, '');
  /* items 里的编号（“1. ”“① ”“- ”）全部削掉：前端自己会排号，带着编号会出现「1. 1. 必须…」。 */
  const cleanItem = s => txt(s).replace(/^\s*(?:[-—*·•]|\(?\d{1,2}[).、．]|[①-⑩])\s*/, '').replace(/^(?:要求|强调)\s*\d*\s*[：:.、．]\s*/, '');
  const spec = {
    read: stripLead(txt(strOr(parsed?.read, parsed?.['理解']))),
    items: toList(parsed?.items || parsed?.['要求'] || parsed?.spec).map(cleanItem).filter(Boolean).slice(0, 5),
    ask: toList(parsed?.ask || parsed?.['要确认']).slice(0, 3)
  };
  if (spec.items.length || spec.read) return spec;
  /* 模型没给 JSON、给了一行行中文也得能用 —— 老师本来也是这么写的。 */
  for (const line of raw.split('\n')) {
    const pick = re => { const m = line.match(re); return m ? m[1].trim() : ''; };
    let v;
    if ((v = pick(/^\s*(?:理解|复述)\s*[：:.、．]\s*(.+)$/))) { spec.read = spec.read || stripLead(v); continue; }
    if ((v = pick(/^\s*(?:要确认|需确认|要问|确认)\s*\d*\s*[：:.、．]\s*(.+)$/))) { spec.ask.push(v); continue; }
    if ((v = pick(/^\s*(?:要求|强调|别讲|不要|必须|重点讲|重点)\s*\d*\s*[：:.、．]?\s*(.+)$/))) { const c = cleanItem(v); if (c) spec.items.push(c); continue; }
  }
  spec.items = spec.items.slice(0, 5);
  spec.ask = spec.ask.slice(0, 3);
  /* 只剩几个问题也算有结果：老师看到问题就知道该补哪句，比一句「失败了」有用。前端会把「保存」禁掉。 */
  if (spec.items.length || spec.read || spec.ask.length) return spec;
  throw new Error('AI 没从这段话里整理出要求，换个说法再试试');
}