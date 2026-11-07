const SETTINGS_KEY = 'zcq-ai-settings-v1';
const SESSION_KEY = 'zcq-ai-key-session';
const LOCAL_KEY = 'zcq-ai-key-local';
let activeProfile = 'default';
export function setAiProfile(id) { activeProfile = id; }
const keyFor = key => `${key}:${activeProfile}`;

export const providers = {
  deepseek: {
    label: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro']
  },
  siliconflow: {
    label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V4-Flash', 'Pro/deepseek-ai/DeepSeek-V4', 'Qwen/Qwen3.6-27B']
  },
  custom: { label: '自定义 OpenAI 兼容接口', baseUrl: '', models: [] }
};

export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(keyFor(SETTINGS_KEY)) || '{}'); } catch { /* ignore */ }
  const provider = providers[saved.provider] ? saved.provider : 'deepseek';
  return {
    provider,
    baseUrl: saved.baseUrl || providers[provider].baseUrl,
    model: saved.model || providers[provider].models[0] || '',
    models: Array.isArray(saved.models) ? saved.models.filter(m => typeof m === 'string') : [], // 读取模型读到的列表
    remember: !!saved.remember,
    apiKey: sessionStorage.getItem(keyFor(SESSION_KEY)) || localStorage.getItem(keyFor(LOCAL_KEY)) || ''
  };
}

export function saveSettings(settings) {
  const { apiKey, remember, ...publicSettings } = settings;
  localStorage.setItem(keyFor(SETTINGS_KEY), JSON.stringify({ ...publicSettings, remember }));
  sessionStorage.removeItem(keyFor(SESSION_KEY));
  localStorage.removeItem(keyFor(LOCAL_KEY));
  if (apiKey) (remember ? localStorage : sessionStorage).setItem(keyFor(remember ? LOCAL_KEY : SESSION_KEY), apiKey.trim());
}

function endpoint(baseUrl, suffix) {
  const url = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url) && !/^http:\/\/localhost(?::\d+)?(?:\/|$)/i.test(url) && !/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(url)) {
    throw new Error('接口地址需使用 HTTPS。');
  }
  return `${url}${suffix}`;
}

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）。请检查模型可用性、余额或网络后重试。`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(messages, { json = false } = {}) {
  const settings = getSettings();
  if (!settings.apiKey) throw new Error('请先在 AI 设置中填写 API Key。');
  if (!settings.model.trim()) throw new Error('请先选择或填写模型名称。');
  const response = await fetchWithTimeout(endpoint(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model.trim(), messages, temperature: 0.2,
      ...(settings.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      ...(settings.provider === 'siliconflow' ? { enable_thinking: false } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}) })
  }, 25000);
  let data;
  try { data = await response.json(); } catch { throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const message = String(data.error?.message || data.message || `接口请求失败（HTTP ${response.status}）。`);
    throw new Error(message.replaceAll(settings.apiKey, '[已隐藏 Key]'));
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型未返回内容，请更换模型后重试。');
  return content;
}

export async function listModels() {
  const { baseUrl, apiKey } = getSettings();
  if (!apiKey) throw new Error('请先填写 API Key。');
  const response = await fetchWithTimeout(endpoint(baseUrl, '/models'), { headers: { Authorization: `Bearer ${apiKey}` } }, 15000);
  if (!response.ok) throw new Error(`读取模型列表失败（HTTP ${response.status}）。可手动填写模型 ID。`);
  const data = await response.json();
  return (data.data || []).map(item => item.id).filter(Boolean).sort();
}

// opts：问 AI 的「模型 / 思考程度」用。不传就按设置里的默认跑（行为和以前一样）
//   model        换一个模型（默认用设置里选的那个）
//   think        true 打开服务商的思考模式（DeepSeek 的 thinking、硅基流动的 enable_thinking）
//   temperature / maxTokens  思考越久给越多预算
export async function streamChat(messages, onProgress, opts = {}) {
  const settings = getSettings();
  if (!settings.apiKey) throw new Error('请先在 AI 设置中填写 API Key。');
  const model = String(opts.model || settings.model).trim();
  if (!model) throw new Error('请先选择或填写模型名称。');
  const think = !!opts.think;
  const response = await fetchWithTimeout(endpoint(settings.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model, messages, temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 800, stream: true,
      ...(settings.provider === 'deepseek' ? { thinking: { type: think ? 'enabled' : 'disabled' } } : {}),
      ...(settings.provider === 'siliconflow' ? { enable_thinking: think } : {}) })
  }, think ? 90000 : 45000);
  if (!response.ok) {
    let message = `接口请求失败（HTTP ${response.status}）。`;
    try { const data = await response.json(); message = data.error?.message || data.message || message; } catch { /* use status */ }
    throw new Error(String(message).replaceAll(settings.apiKey, '[已隐藏 Key]'));
  }
  if (!response.body) throw new Error('接口没有返回可读取的流式响应。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', result = '', finished = false;
  const consume = event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { finished = true; return; }
    let packet;
    try { packet = JSON.parse(data); } catch { return; }
    if (packet.error) throw new Error(String(packet.error.message || '模型返回流式错误').replaceAll(settings.apiKey, '[已隐藏 Key]'));
    const part = packet.choices?.[0]?.delta?.content;
    if (typeof part === 'string' && part) { result += part; onProgress?.(result); }
  };
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(pending))) {
      consume(pending.slice(0, boundary.index));
      pending = pending.slice(boundary.index + boundary[0].length);
      if (finished) break;
    }
  }
  if (pending.trim() && !finished) consume(pending);
  if (!result.trim()) throw new Error('模型未返回解析文字，请重试或更换模型。');
  return result.trim();
}

export async function explainQuestion(question, selection, onProgress, subjectName = '') {
  const options = question.options.map(item => `${item.key}. ${item.text}`).join('\n');
  const keys = question.options.map(item => item.key);
  const prompt = `请针对这道${subjectName ? `“${subjectName}”课程的` : ''}考试题逐项解析。每项解释它为何符合或不符合题意，联系具体知识点；不能只重复答案。否定式题干要说明判别标准；没有依据时如实说明。涉及理论的发展水平、阶段或概念归属时，必须给出准确归属，不能笼统猜测。每项 25-60 字。严格按选项顺序逐行输出，格式为“A: 解析”。

所有选项结束后，再给出这张「学习卡」的内容（写给零基础学生看）。能写就写，确实没有就整行省略 —— 不要凑字、不要复述题干、不要写 Markdown：
考点: 这道题真正在考什么，一句话，不超过 30 字。
步骤1: 从零开始的做题顺序，2～5 条，每条一句话、不超过 40 字（先判断什么、再套什么、最后检查什么）。按步骤1、步骤2 依次编号。
记住1: 这类题必须背下来的对应关系，最多 4 条，写成「条件｜结果」（中间用全角竖线，例如“x 趋于 0｜sinx/x 趋于 1”）；没有就省略。
易错: 最容易错在哪、怎么自检，不超过 60 字。

再按规则决定是否输出速记技巧：
1. 仅在你确信存在广泛通用且准确的备考口诀时，输出“速记技巧: 常见口诀｜……”。不得声称或暗示来自粉笔等机构，除非题目资料明确给出了出处。
2. 若没有现成口诀，但可以从本题核心概念做出简短、不改变知识事实的谐音或联想，可输出“速记技巧: AI 联想｜……”。它必须明确是 AI 联想，不能伪装成现成口诀。
3. 两者都不合适时，输出“速记技巧: 无”。不要复述题干、硬押韵或编造口诀。
4. 最后必须另起一行输出“题库复核: 一致｜简短理由”或“题库复核: 建议复核｜独立判断与理由”。如果你能明确判断更可信的选项，再另起一行输出“AI结论: B｜理由”（把 B 换成实际选项）；无法确定时输出“AI结论: 无法确定｜理由”。题库标注答案和资料校对说明都只是待核对材料，不能据此强行解释；发现冲突、题干不完整或存在不同口径时，必须写“建议复核”。

不要 Markdown、不要开头结尾。
题型：${question.type}
题干：${question.stem}
选项：
${options}
题库标注答案（可能有误，仅供交叉核对）：${question.answer.join(',')}
${question.explanation ? `资料校对材料（可能有误，需独立判断）：${question.explanation}` : ''}
学生选择：${selection.join(',')}`;
  const raw = await streamChat([{ role: 'system', content: `你是审慎、独立的${subjectName ? `“${subjectName}”课程` : ''}辅导老师。逐项解析必须准确，不要把题库答案当作权威结论；发现疑点应明确建议复核。速记技巧只在有可靠常见口诀，或有明确标注的 AI 联想时给出；不合适就写无。学习卡（考点/步骤/记住/易错）只写你有把握的，宁可少写一行，也不要编。` }, { role: 'user', content: prompt }], onProgress);
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\x60\x60\x60\s*$/, '')); } catch { /* try line parsing below */ }
  const source = parsed?.options || parsed;
  const txt = v => String(v == null ? '' : v).trim();
  const strOr = (a, b) => (typeof a === 'string' && a.trim() ? a : typeof b === 'string' ? b : '');
  /* 学习卡四块（2026-11-07）。模型可能给 JSON，也可能给逐行文本，两条路都要认 ——
     先把 JSON 那边取出来，逐行解析时再覆盖，谁的拿得到算谁的。 */
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
  let card = {
    lead: txt(strOr(parsed?.lead, parsed?.['考点'])),
    steps: toList(parsed?.steps || parsed?.['步骤']),
    table: toRows(parsed?.table || parsed?.['记住']),
    warn: txt(strOr(parsed?.warn, parsed?.['易错']))
  };
  const normalizeTip = value => {
    const tip = String(value || '').trim();
    return /^(?:无|暂无|没有|不适用)[。！!]?$/u.test(tip) ? '' : tip;
  };
  const parsedTip = normalizeTip(typeof parsed?.tip === 'string' ? parsed.tip : typeof parsed?.['速记技巧'] === 'string' ? parsed['速记技巧'] : '');
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
  if (keys.every(key => lines[key])) return { ...Object.fromEntries(keys.map(key => [key, lines[key]])), _tip: normalizeTip(tip), _review: review, _reviewAnswer: reviewAnswer, ...cardOut() };
  throw new Error('模型未返回完整的逐项解析，请重试或更换模型。');
}
