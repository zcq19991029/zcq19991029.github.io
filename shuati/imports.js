// 资料读取和 AI 识题／出题（从“高校资格证刷题”沿用；云端同步改由 store.js 负责）
import { chat } from './ai.js';

export async function readMaterial(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return { json: JSON.parse(await file.text()), text: '' };
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
    if (text.trim().length < 50) throw new Error('这份 PDF 没有可提取的文字（扫描件）。请先用扫描全能王等软件转成文字，或改用可复制文字的 Word／PDF。');
    return { text };
  }
  throw new Error('支持 PDF、DOCX、TXT、MD 和题库 JSON；旧版 .doc 请另存为 .docx。');
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(cleaned); } catch {
    const first = cleaned.indexOf('{'); const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('AI 返回的内容不是有效 JSON，请重试或换一个模型。');
  }
}

export function normalizeQuestions(raw, subject) {
  const input = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(input)) throw new Error('题库需要是数组，或包含 questions 数组的 JSON 对象。');
  const questions = []; const rejected = [];
  input.forEach((item, index) => {
    const stem = String(item.stem || item.question || '').trim();
    let type = String(item.type || '').toLowerCase();
    if (['单选', '单选题'].includes(type)) type = 'single';
    if (['多选', '多选题'].includes(type)) type = 'multiple';
    if (['判断', '判断题'].includes(type)) type = 'judgment';
    const rawOptions = item.options || [];
    let options = Array.isArray(rawOptions) ? rawOptions.map((option, i) => typeof option === 'string' ? { key: String.fromCharCode(65 + i), text: option } : { key: String(option.key || '').toUpperCase(), text: String(option.text || '') }) : Object.entries(rawOptions).map(([key, text]) => ({ key: key.toUpperCase(), text: String(text) }));
    if (type === 'judgment' && !options.length) options = [{ key: 'T', text: '正确' }, { key: 'F', text: '错误' }];
    let answer = Array.isArray(item.answer) ? item.answer : String(item.answer || '').replace(/正确|对|√/g, 'T').replace(/错误|错|×/g, 'F').match(/[A-Z]/gi) || [];
    answer = [...new Set(answer.map(a => String(a).toUpperCase()))];
    if (!type) type = options.some(o => o.key === 'T') ? 'judgment' : answer.length > 1 ? 'multiple' : 'single';
    const keys = new Set(options.map(o => o.key));
    if (!stem || !['single', 'multiple', 'judgment'].includes(type) || options.length < 2 || !answer.length || answer.some(a => !keys.has(a)) || (type !== 'multiple' && answer.length !== 1)) {
      rejected.push(index + 1); return;
    }
    questions.push({ id: `${subject}-import-${crypto.randomUUID()}`, number: item.number || questions.length + 1, stem, type, options, answer, explanation: String(item.explanation || '').trim(), source: item.source || '导入' });
  });
  return { questions, rejected };
}

function chunks(text, size = 4200, overlap = 450) {
  const clean = text.replace(/\r/g, '');
  const result = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    result.push(clean.slice(start, start + size));
    if (start + size >= clean.length) break;
  }
  return result;
}

export async function aiImport(text, subject, onProgress) {
  if (!text.trim()) throw new Error('请先选择文件或粘贴资料。');
  const pieces = chunks(text);
  const collected = [];
  for (let i = 0; i < pieces.length; i++) {
    onProgress?.(`正在识别第 ${i + 1} / ${pieces.length} 段，已提取 ${collected.length} 题…`, collected);
    try {
      const prompt = `从下面的原始学习资料中提取所有完整的客观题，分类为 single、multiple、judgment。只输出 JSON 对象 {"questions":[{"type":"single","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":["A"],"explanation":"原文解析或空字符串"}]}。判断题选项使用 T=正确、F=错误。只提取原文能够确定答案的题，不要编造题干、选项或答案；跨段不完整的题跳过。保留原文表述。资料：\n${pieces[i]}`;
      const response = await chat([{ role: 'system', content: '你是严谨的试题结构化助手。只返回合法 JSON。' }, { role: 'user', content: prompt }]);
      const { questions } = normalizeQuestions(parseJson(response), subject);
      collected.push(...questions);
    } catch (error) {
      error.partialQuestions = collected;
      throw error;
    }
  }
  return collected;
}

// 根据资料出题：教材、讲义等没有现成题目的资料，让 AI 按资料内容出单选、多选、判断题（每段出若干题，答案和解析必须能在原文找到依据）
export async function aiGenerate(text, subject, subjectName, perChunk, onProgress) {
  if (!text.trim()) throw new Error('请先选择文件或粘贴资料。');
  const pieces = chunks(text, 6000, 300);
  const collected = [];
  for (let i = 0; i < pieces.length; i++) {
    onProgress?.(`正在根据第 ${i + 1} / ${pieces.length} 段出题，已出 ${collected.length} 题…`, collected);
    try {
      const prompt = `你是“${subjectName}”课程的出题老师。根据下面的教材原文出期末理论考试客观题：单选约占 55%、多选约 15%、判断约 30%，共 ${perChunk} 题左右。要求：1. 只考原文明确写到的知识点（概念、结构组成、型号含义、参数、选用原则、检测方法、故障原因），答案必须能在原文找到依据，不编造数据；2. 单选 4 个选项且只有 1 个正确，干扰项要合理；多选 4 个选项、至少 2 个正确；判断题选项用 T=正确、F=错误，错误的判断题要改动原文一个关键点；3. explanation 写一句依据（引用原文要点）。只输出 JSON 对象 {"questions":[{"type":"single","stem":"题干","options":[{"key":"A","text":"选项"}],"answer":["A"],"explanation":"依据"}]}。原文：
${pieces[i]}`;
      const response = await chat([{ role: 'system', content: '你是严谨的职业院校出题老师。只返回合法 JSON。' }, { role: 'user', content: prompt }], { json: true });
      const { questions } = normalizeQuestions(parseJson(response), subject);
      collected.push(...questions.map(q => ({ ...q, source: 'AI 根据资料出题' })));
    } catch (error) {
      error.partialQuestions = collected;
      throw error;
    }
  }
  return collected;
}
