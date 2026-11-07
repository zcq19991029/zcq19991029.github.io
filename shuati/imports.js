// 资料读取、AI 识题／出题、图片转数据（从“高校资格证刷题”沿用；云端同步改由 store.js 负责）
//
// 2026-11-06 导入流程重做（用户：「我随便导入个试卷他怎么知道怎么出题的呢」「根据资料里现成的题你又没给模板 怎么能保证成功」）：
//   1. 识题（pick）和出题（gen）是两件事，提示词必须分开写死，不能靠一句“提取所有题”蒙；
//   2. 识题结果要能核对：每条被拒的题都要带“第几条 + 题干前几个字 + 为什么不行”，用户才知道该改哪里；
//   3. 出题要能下指令：范围、题型、每种几道、难度、额外要求都要真的塞进提示词；
//   4. 拍照/截图（扫描件）交给支持看图的模型，图片先压到 1600px，避免一次发 5 页就超限。
import { chat } from './ai.js';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
export const isImageFile = name => IMAGE_RE.test(String(name || '').toLowerCase());

// 图片转 dataURL。手机拍一页教材动辄 4MB，原样发 5 张多数模型会直接拒；
// 最长边压到 1600px、JPEG 0.8，题干文字仍然清楚，体积通常剩下十分之一。
export function fileToDataUrl(file, max = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        // 透明 PNG 铺白底：直接转 JPEG 会把透明区域压成黑块，文字就看不清了
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(new Error('图片处理失败：' + e.message));
      } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图片读不出来（可能不是常见的 jpg/png）。换一张，或先用扫描软件导出成 PDF／文字。')); };
    img.src = url;
  });
}

// 一次拍了好几页：逐张压，坏的跳过（不能因为第 3 张坏掉就整批失败）
export async function readImages(files) {
  const list = []; const bad = [];
  for (const f of files) {
    try { list.push(await fileToDataUrl(f)); } catch (e) { bad.push(`${f.name}：${e.message}`); }
  }
  if (!list.length) throw new Error(bad[0] || '没有读到图片。');
  return list;
}

export async function readMaterial(file) {
  const name = file.name.toLowerCase();
  if (isImageFile(name)) return { image: await fileToDataUrl(file), text: '' }; // 图片不在这里转文字，交给视觉模型
  if (name.endsWith('.json')) {
    try { return { json: JSON.parse(await file.text()), text: '' }; }
    catch { throw new Error('这个 .json 文件不是合法的 JSON，检查一下括号、逗号是否齐全（可以对照导入区的「题库格式说明 · 下载模板」）。'); }
  }
  if (/\.(txt|md)$/i.test(name)) return { text: await file.text() };
  if (name.endsWith('.docx')) {
    await import('./vendor/mammoth.browser.min.js');
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: result.value };
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('./vendor/pdf.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.js', import.meta.url).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    const text = pages.join('\n');
    if (text.trim().length < 50) throw new Error('这份 PDF 没有可提取的文字（扫描件）。可以先把每页截图存成图片，在导入区选图片让 AI 看着读；或先用扫描全能王转成文字。');
    return { text };
  }
  throw new Error('支持 PDF、DOCX、TXT、MD、题库 JSON，以及 jpg／png 图片（拍照、截图）；旧版 .doc 请另存为 .docx。');
}

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(cleaned); } catch {
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('AI 返回的内容不是有效 JSON，请重试或换一个模型。');
  }
}

// 题型名称（AI 常写中文，也常写英文，两种都认）
const TYPE_ALIAS = {
  single: 'single', 单选: 'single', 单选题: 'single', 单项选择题: 'single', 单项选择: 'single',
  multiple: 'multiple', 多选: 'multiple', 多选题: 'multiple', 多项选择: 'multiple', 多项选择题: 'multiple',
  judgment: 'judgment', judge: 'judgment', 判断: 'judgment', 判断题: 'judgment',
  fill: 'fill', blank: 'fill', 填空: 'fill', 填空题: 'fill',
  short: 'short', 简答: 'short', 简答题: 'short', 问答: 'short', 问答题: 'short', 论述: 'short', 论述题: 'short',
  /* 程序分析题（2026-11-08 加）：单片机、C 语言这类资料里的「阅读程序回答问题」。
     刷题页早就支持 prog（内置单片机题库里有 11 道），只是导入和出题这条路一直没开。 */
  prog: 'prog', 程序: 'prog', 程序题: 'prog', 程序分析: 'prog', 程序分析题: 'prog',
  程序设计: 'prog', 程序设计题: 'prog', 编程: 'prog', 编程题: 'prog', 代码分析: 'prog', 读程序: 'prog'
};
const SUPPORTED = ['single', 'multiple', 'judgment', 'fill', 'short', 'prog'];
const TYPE_LABEL = { single: '单选题', multiple: '多选题', judgment: '判断题', fill: '填空题', short: '简答题', prog: '程序分析题' };

// 把 answer 里的各种写法拆成一个个 token：['A']、'A,C'、'AB'、['正确'] 都认
function answerTokens(raw) {
  const out = [];
  for (const v of (Array.isArray(raw) ? raw : [raw])) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    if (/^[A-Fa-f]{2,}$/.test(s)) out.push(...s.toUpperCase().split('')); // "AB" 当成 A、B
    else out.push(...s.split(/[,，、/;；\s]+/).filter(Boolean));
  }
  return out;
}
const judgeKey = t => /^(正确|对|是|√|T|TRUE|Y|YES)$/i.test(t) ? 'T' : /^(错误|错|否|×|X|F|FALSE|N|NO)$/i.test(t) ? 'F' : '';

// 题库校验。rejected 从「序号数组」改成带原因的明细 —— 用户看不到原因就不知道该怎么改。
export function normalizeQuestions(raw, subject) {
  const input = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(input)) throw new Error('题库需要是数组，或包含 questions 数组的 JSON 对象。');
  const questions = []; const rejected = [];
  input.forEach((item, index) => {
    const stem0 = String(item?.stem || item?.question || item?.title || '').trim();
    let stem = stem0;
    const rawType = String(item?.type || item?.题型 || '').trim();
    let type = TYPE_ALIAS[rawType.toLowerCase()] || TYPE_ALIAS[rawType] || '';
    const reject = reason => { rejected.push({ index: index + 1, stem: stem0.slice(0, 20), reason }); };
    if (!stem0) return reject('题干是空的');
    if (!type) {
      // 没写题型时按选项形状猜：有 T/F 选项就是判断题，选项都没有又只有一两个字答案就当填空
      const opt = item?.options;
      const list = Array.isArray(opt) ? opt : (opt && typeof opt === 'object' ? Object.keys(opt) : []);
      if (list.length && (String(list[0]).toUpperCase() === 'T' || /正确/.test(String(opt[0]?.text ?? opt[0] ?? '')))) type = 'judgment';
      else if (list.length >= 2) type = answerTokens(item?.answer).length > 1 ? 'multiple' : 'single';
      else type = 'fill';
    }
    if (!SUPPORTED.includes(type)) return reject(`题型「${rawType || '未知'}」暂时不支持（只支持单选、多选、判断、填空、简答）`);

    // 选项：兼容 ["文本"]、[{key,text}]、{A:"文本"} 三种写法；"A. 文本" 这种带前缀的去掉前缀
    const rawOptions = item?.options || item?.选项 || [];
    let options = Array.isArray(rawOptions)
      ? rawOptions.map((option, i) => typeof option === 'string'
        ? { key: String.fromCharCode(65 + i), text: option.replace(/^[A-Fa-f][.、:：)）]\s*/, '') }
        : { key: String(option?.key || String.fromCharCode(65 + i)).toUpperCase(), text: String(option?.text ?? option?.value ?? '') })
      : Object.entries(rawOptions).map(([key, text]) => ({ key: key.toUpperCase(), text: String(text) }));
    // 填空、简答、程序分析都不需要选项：答案本身就是文字
    if (type === 'fill' || type === 'short' || type === 'prog') options = [];
    if (type === 'judgment' && !options.length) options = [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }];

    // 答案
    let answer;
    if (type === 'fill' || type === 'short' || type === 'prog') {
      // 填空/简答/程序分析的答案本身就是文字：不能像选择题那样按空格拆（英文答案里带空格会被拆成好几空）
      const vals = (Array.isArray(item?.answer ?? item?.答案) ? (item.answer ?? item.答案) : [item?.answer ?? item?.答案])
        .map(v => String(v ?? '').trim()).filter(Boolean);
      answer = type === 'fill'
        ? vals.flatMap(v => v.split(/[、，,；;]+/).map(s => s.trim()).filter(Boolean))
        : [vals.join(' ')].filter(Boolean);
    } else {
      answer = answerTokens(item?.answer ?? item?.答案).map(token => {
        const t = token.replace(/[.。、:：)）]$/, '');
        if (type === 'judgment') return judgeKey(t) || t.toUpperCase();
        if (/^[A-Fa-f]$/.test(t)) return t.toUpperCase();
        const hit = options.find(o => String(o.text).trim() === t); // AI 有时直接回选项原文
        return hit ? hit.key : t.toUpperCase();
      });
    }
    answer = [...new Set(answer)];

    // 填空题的题干必须有空位，否则刷题页画不出输入框
    if (type === 'fill') {
      if (!/_{2,}/.test(stem)) stem = stem.replace(/[（(]\s*[)）]/, '____').replace(/\s*[（(]\s*[)）]\s*/g, ' ____ ');
      if (!/_{2,}/.test(stem)) return reject('填空题的题干里没有 ____ 表示空格位置，学生没地方填');
    }
    const keys = new Set(options.map(o => o.key));
    if (!answer.length) return reject(type === 'prog' ? '程序分析题没有参考答案' : type === 'short' ? '简答题没有参考答案' : '没有答案');
    if (type === 'fill' || type === 'short' || type === 'prog') {
      // 这几类不需要选项，答案本身就是文字，长度太离谱的多半是 AI 把整段原文搬过来了
      if (type === 'short' && answer[0].length > 1200) return reject('简答题的参考答案太长（超过 1200 字），像是把原文整段搬过来了');
      // 程序分析常有好几问，参考答案比简答长是正常的，但超过 2000 字基本就是抄原文了
      if (type === 'prog' && answer[0].length > 2000) return reject('程序分析题的参考答案太长（超过 2000 字），像是把原文整段搬过来了');
    } else {
      if (options.length < 2) return reject('选项少于 2 个');
      if (answer.some(a => !keys.has(a))) return reject(`答案 ${answer.filter(a => !keys.has(a)).join('、')} 不在选项里`);
      if (type !== 'multiple' && answer.length !== 1) return reject(`${TYPE_LABEL[type]}只能有 1 个答案，这份给了 ${answer.length} 个`);
    }
    const arr = v => (Array.isArray(v) ? v : v ? [v] : []).map(x => String(x ?? '').trim()).filter(Boolean);
    /* 程序分析题的两个附加字段：`code` 是题目下面那段代码，`sub` 是几个小问。
       内置单片机题库里就有（`mcu-prog-*`），导入这条路以前没接，现在一起留住。 */
    const code = String(item?.code ?? item?.代码 ?? item?.程序 ?? '').trim();
    const sub = arr(item?.sub ?? item?.小问 ?? item?.问题);
    /* study（可选）：题库页「说人话写学习卡」整理出来的四块（app.js 的 studyCard 画）。
       导出的 JSON 再导回来时要原样保留，否则卡一导出就没了。形状不对就当没有。 */
    const rawStudy = item?.study || item?.学习卡;
    const study = (() => {
      if (!rawStudy || typeof rawStudy !== 'object') return null;
      const table = (Array.isArray(rawStudy.table) ? rawStudy.table : []).map(r => (Array.isArray(r) ? [String(r[0] ?? '').trim(), String(r[1] ?? '').trim()] : null)).filter(r => r && (r[0] || r[1]));
      const card = {
        lead: String(rawStudy.lead ?? '').trim(),
        steps: arr(rawStudy.steps), table,
        tip: String(rawStudy.tip ?? '').trim(),
        warn: String(rawStudy.warn ?? '').trim()
      };
      return (card.lead || card.steps.length || table.length || card.tip || card.warn) ? card : null;
    })();
    questions.push({
      id: `${subject}-import-${crypto.randomUUID()}`,
      number: item?.number || questions.length + 1,
      stem, type, options, answer,
      explanation: String(item?.explanation ?? item?.解析 ?? '').trim(),
      /* tip（可选）：老师自己写的一句口诀／小技巧。刷题页会用它画「学习卡」的黄色那块
         （见 app.js 的 studyCard）。不写就是空串，不影响别的字段。 */
      tip: String(item?.tip ?? item?.小技巧 ?? item?.口诀 ?? '').trim(),
      ...(code ? { code } : {}),
      ...(sub.length ? { sub } : {}),
      ...(study ? { study } : {}),
      source: item?.source || item?.出处 || '导入'
    });
  });
  return { questions, rejected };
}

function chunks(text, size = 4200, overlap = 450) {
  const clean = String(text || '').replace(/\r/g, '');
  const result = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    result.push(clean.slice(start, start + size));
    if (start + size >= clean.length) break;
  }
  return result;
}

// ---------- 提示词 ----------
// 每种题型的写题规则：只把用户勾选的题型放进去。这样提示词里不会出现“没让你出的题型”，
// 也避免模型顺手出几道多选（用户勾掉多选就是为了不要）。
const TYPE_RULE = {
  single: '单选题给 4 个选项、只有 1 个正确，干扰项要像真的（错在关键点上，不是一眼假）；',
  multiple: '多选题给 4 个选项、至少 2 个正确；',
  judgment: '判断题选项固定用 T（正确）、F（错误）；错的判断题要把原文一个关键点改掉，不能靠“好像不对”；',
  fill: '填空题把要考的地方写成 ____（连续 4 个下划线），answer 按空格顺序给每一空的答案；',
  short: '简答题给一段能直接对照的参考答案（30～120 字），answer 里就放这一段；',
  /* 程序分析题（2026-11-08）：单片机、C 语言资料里最常见的题型。
     代码单独放 code 字段（带换行和缩进），小问单独放 sub，答案按小问顺序写。 */
  prog: '程序分析题：stem 写清背景和要求（哪个口接了什么、要读哪段程序），code 里放这段完整可读的程序（保留换行和缩进，不要用 Markdown 代码块、不要加 ```），sub 里放 2～4 个具体小问，answer 里按小问顺序（1）（2）（3）写参考答案；'
};
const TYPE_SAMPLE = {
  single: '{"type":"single","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":["A"],"explanation":"原文依据"}',
  multiple: '{"type":"multiple","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":["A","C"],"explanation":"原文依据"}',
  judgment: '{"type":"judgment","stem":"题干","options":[{"key":"T","text":"正确"},{"key":"F","text":"错误"}],"answer":["T"],"explanation":"原文依据"}',
  fill: '{"type":"fill","stem":"并行口方向寄存器决定端口是输入还是 ____","answer":["输出"],"explanation":"原文依据"}',
  short: '{"type":"short","stem":"简述……的步骤","answer":["参考答案那一段话"],"explanation":"原文依据"}',
  prog: '{"type":"prog","stem":"阅读下面的程序，P1 口接 8 个 LED（低电平点亮），回答问题。","code":"#include <reg51.h>\\nvoid main()\\n{\\n    P1 = 0xFE;\\n    while(1);\\n}","sub":["哪个灯先亮？","程序会不会停下来？"],"answer":["（1）D1 先亮（0xFE 最低位为 0）。（2）不会，while(1) 是死循环。"],"explanation":"原文依据"}'
};

function genPrompt({ subjectName, piece, scope, level, counts, extra, note }) {
  const list = Object.entries(counts).filter(([, n]) => n > 0);
  const parts = list.map(([t, n]) => `${TYPE_LABEL[t]} ${n} 道`).join('、');
  const rules = list.map(([t]) => TYPE_RULE[t]).join('\n   ');
  const samples = list.map(([t]) => '  ' + TYPE_SAMPLE[t]).join(',\n');
  return `你是「${subjectName}」课程的出题老师。请根据下面的资料出题。
范围：${scope || '整份资料'}（只出这个范围里写到的内容）
难度：${level || '中等'}
这一轮要出：${parts}
${extra ? `额外要求：${extra}\n` : ''}硬要求：
1. 每道题都必须能在原文找到依据；原文没写的不出，不编型号、参数、页码。
2. ${rules}
3. 答案唯一、没有歧义；explanation 写一句依据（引用原文要点）。
4. 只输出 JSON 对象，不要任何解释文字：
{"questions":[
  ${samples}
]}${note ? '\n' + note : ''}
资料原文：
${piece}`;
}

function pickPrompt({ piece, note }) {
  return `从下面的资料里把已有的题原样抠出来：不要自己编题，不要改题干和选项的表述。
题型可以是 single（单选）、multiple（多选）、judgment（判断）、fill（填空）、short（简答）、prog（程序分析）：判断题选项固定 T=正确、F=错误；填空题题干用 ____ 表示空，answer 按空的顺序给答案；简答题 answer 放参考答案；程序分析题把代码放进 code 字段、小问放进 sub、参考答案放进 answer。
只提取原文写得清清楚楚的题：题干、选项、答案都能从原文确定的才要；缺答案或缺选项的跳过，不要猜。
只输出 JSON 对象：{"questions":[{"type":"single","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":["A"],"explanation":"原文解析或空字符串","source":"原文位置"}]}${note ? '\n' + note : ''}
资料：
${piece}`;
}

// 识题：把资料里现成的题抠出来（不编题）。返回带 rejected 的报告，界面上要能逐条核对。
export async function aiImport(text, subject, onProgress) {
  if (!String(text || '').trim()) throw new Error('请先选择文件或粘贴资料。');
  const pieces = chunks(text);
  const collected = []; const rejected = [];
  for (let i = 0; i < pieces.length; i++) {
    onProgress?.(`正在识别第 ${i + 1} / ${pieces.length} 段，已提取 ${collected.length} 题…`, collected);
    try {
      const response = await chat([{ role: 'system', content: '你是严谨的试题结构化助手。只返回合法 JSON。' }, { role: 'user', content: pickPrompt({ piece: pieces[i] }) }]);
      const result = normalizeQuestions(parseJson(response), subject);
      collected.push(...result.questions);
      rejected.push(...result.rejected);
    } catch (error) {
      error.partialQuestions = collected;
      error.partialRejected = rejected;
      throw error;
    }
  }
  return { questions: collected, rejected };
}

// 出题：教材、讲义等没有现成题目的资料，按用户圈的范围/题型/数量/难度/额外要求让 AI 出题。
// 数量按段分摊：用户说的是“整份资料一共要几道”，不是“每 6000 字几道”。
export async function aiGenerate(text, subject, subjectName, opts = {}, onProgress) {
  if (!String(text || '').trim()) throw new Error('请先选择文件或粘贴资料。');
  const wanted = {};
  for (const t of SUPPORTED) {
    const n = Math.max(0, Math.min(50, Math.round(+((opts.types || {})[t]) || 0)));
    if (n) wanted[t] = n;
  }
  if (!Object.keys(wanted).length) throw new Error('请在“出题要求”里至少勾选一种题型，并填一个大于 0 的数量。');
  const pieces = chunks(text, 6000, 300);
  const plan = pieces.map(() => ({})); // plan[i] = 第 i 段要出哪些题型各几道
  for (const [t, n] of Object.entries(wanted)) {
    const base = Math.floor(n / pieces.length), rem = n % pieces.length;
    pieces.forEach((_, i) => { const c = base + (i < rem ? 1 : 0); if (c) plan[i][t] = c; });
  }
  const collected = []; const rejected = [];
  let done = 0;
  for (let i = 0; i < pieces.length; i++) {
    const counts = plan[i];
    if (!Object.keys(counts).length) continue; // 这一段没分到题，别白花 token
    done++;
    onProgress?.(`正在根据第 ${i + 1} / ${pieces.length} 段出题，已出 ${collected.length} 题…`, collected);
    try {
      const prompt = genPrompt({ subjectName, piece: pieces[i], scope: opts.scope, level: opts.level, counts, extra: opts.extra });
      const response = await chat([{ role: 'system', content: '你是严谨的职业院校出题老师。只返回合法 JSON。' }, { role: 'user', content: prompt }], { json: true });
      const result = normalizeQuestions(parseJson(response), subject);
      collected.push(...result.questions.map(q => ({ ...q, source: 'AI 根据资料出题' })));
      rejected.push(...result.rejected);
    } catch (error) {
      error.partialQuestions = collected;
      error.partialRejected = rejected;
      throw error;
    }
  }
  if (!done) throw new Error('资料太短，没凑够一段。多贴一些文字再试。');
  return { questions: collected, rejected };
}

// 图片/扫描件：交给支持看图的模型（首页 hx-ai.js 暴露的 window.HXAI.vision）。
// 离线版、或只配了纯文字模型时，HXAI 不存在或没有 vision —— 那时候不要假装能读，直接说清楚怎么配。
export async function aiVision(images, { subject, subjectName = '', mode = 'pick', opts = {}, onProgress } = {}) {
  if (!images || !images.length) throw new Error('没有读到图片。');
  const H = globalThis.HXAI;
  const vision = H && typeof H.vision === 'function' ? H.vision.bind(H) : null;
  if (!vision) throw new Error('要读图片／扫描件，得先在首页「AI 设置」里配一套支持图片的模型（如 Qwen-VL 这类看图模型）。只配纯文字模型时，图片里的字是读不出来的。');
  const note = `这是 ${images.length} 张图片（拍下来或截图的资料），可能歪、可能不清楚：只依据看得清的内容出题，看不清的地方跳过，不要猜。`;
  onProgress?.(`正在把 ${images.length} 张图片交给 AI 看…`);
  let prompt;
  if (mode === 'gen') {
    const counts = {};
    for (const t of SUPPORTED) { const n = Math.max(0, Math.min(50, Math.round(+((opts.types || {})[t]) || 0))); if (n) counts[t] = n; }
    if (!Object.keys(counts).length) throw new Error('请在“出题要求”里至少勾选一种题型，并填一个大于 0 的数量。');
    prompt = genPrompt({ subjectName, piece: '（资料就在这次一起发来的图片里）', scope: opts.scope, level: opts.level, counts, extra: opts.extra, note });
  } else {
    prompt = pickPrompt({ piece: '（资料就在这次一起发来的图片里）', note });
  }
  const raw = await vision({ prompt, images, json: true, tool: 'quiz' });
  const data = typeof raw === 'string' ? parseJson(raw) : raw;
  const result = normalizeQuestions(data, subject);
  if (mode === 'gen') result.questions = result.questions.map(q => ({ ...q, source: 'AI 根据图片出题' }));
  return result;
}
