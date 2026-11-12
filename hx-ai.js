/* 华夏工具 · 全站共用的 AI 设置与调用（网站根目录 /hx-ai.js）
   为什么要有这一份：刷题、单片机、考试、接线仿真、排课、课程进度都要调 AI，
   以前各自写一份 provider 表 + Key 存取 + fetch 封装，同一个 Key 要填好几遍，
   模型名、超时、报错文案还各不相同。这里把「配了哪几套模型、哪个工具用哪套」
   收在一处，各工具只调 HXAI.chat / HXAI.vision，不再自己造轮子。

   配置存放（严格按这个契约，别的工具要读同一份）：
     localStorage['hx-ai-v1'] = { v:1, profiles:[{id,name,provider,baseUrl,model,models,caps,thinkLevel,at}],
                                  active:{text,vision,reason,image,video,audio}, tools:{quiz,mcu,exam,wiring,paike,course} }
   caps 六项：text 文本 / vision 图片识别 / reason 推理 / image 图像生成 / video 视频生成 / audio 音频（TTS+ASR）。
   thinkLevel 三档：quick 快速 / balanced 均衡 / deep 深度（老存档没有 = 均衡，读的时候自动补上）。
   Key 不进上面那份（导出配置时就不会带出去）：
     localStorage['hx-ai-key:<id>'] —— 用户勾了「记住」
     sessionStorage['hx-ai-key:<id>'] —— 没勾，只活在这个标签页

   用法（经典脚本，不是 ES module）：工具页在 head 里引上一层的 hx-ai.js（和 hx-theme.js 同一层），然后
     const txt = await HXAI.chat({ prompt:'你好', tool:'quiz' });
     const out = await HXAI.vision({ prompt:'读出图里的题目', images:[dataUrl], tool:'quiz' }); */
(function (g) {
  'use strict';

  var VERSION = 1;
  var STORE = 'hx-ai-v1';
  var KEY_PREFIX = 'hx-ai-key:';
  var TIMEOUT = 60000; // 60 秒。识别整页扫描件时慢，但超过一分钟基本是卡住了
  var NO_AI = '还没有配置 AI 模型，请到首页「AI 设置」里加一套';

  // 供应商预设。baseUrl 照各家「OpenAI 兼容」入口填，末尾不写 /chat/completions（下面统一拼）。
  // models 只是候选（下拉里的建议），真实可用性以「读取模型」和「测试连接」为准。
  // group 决定下拉框里的分组（照 cc-switch 的 90+ 预设挑了对上课有用的：国内官方 / 国内聚合 / 海外官方 / 海外聚合）。
  // 一律只收「认 /chat/completions」的 —— Anthropic 原生 /v1/messages 不走这套，别往里加。
  // 文生图 / 文生视频 / TTS 的模型 ID 各平台改得快，这里只填有把握的主流 ID，
  // 拿不准的一律留空、靠「读取模型」拉 /models 补全（别瞎编一个不存在的 ID 糊弄用户）。
  var providers = {
    // ---------- 国内 · 官方 ----------
    deepseek: {
      label: 'DeepSeek', group: '国内 · 官方', baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      caps: ['text', 'reason', 'vision'],
      note: '最便宜，写题改题够用。deepseek-chat / deepseek-reasoner 已于 2026-07 弃用，现在用 deepseek-v4-flash（快）和 deepseek-v4-pro（强）。flash 带视觉能读图。'
    },
    qwen: {
      label: '通义千问（阿里云百炼）', group: '国内 · 官方', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-max', 'qwen-vl-plus'],
      caps: ['text', 'vision'],
      note: 'qwen-vl- 开头的是视觉模型，读扫描件用它。阿里云后台要先开通「百炼」。'
    },
    moonshot: {
      label: 'Kimi / 月之暗面', group: '国内 · 官方', baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'moonshot-v1-8k-vision-preview'],
      caps: ['text', 'vision'],
      note: '长文强，整本教材丢进去也行。vision 结尾的才能读图。'
    },
    zhipu: {
      label: '智谱 GLM', group: '国内 · 官方', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus', 'glm-4v'],
      caps: ['text', 'vision'],
      note: 'glm-4v 系列能读图；glm-4-flash 有免费额度。'
    },
    volc: {
      label: '火山方舟（豆包）', group: '国内 · 官方', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k', 'doubao-vision-pro-32k'],
      caps: ['text', 'vision'],
      note: '模型名要填「接入点 ID」（ep-xxxx）或模型名，看你后台怎么开的。'
    },
    hunyuan: {
      label: '腾讯混元', group: '国内 · 官方', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      models: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-vision'],
      caps: ['text', 'vision'],
      note: 'hunyuan-vision 能读图。腾讯云后台拿 Key。'
    },
    qianfan: {
      label: '百度千帆（文心）', group: '国内 · 官方', baseUrl: 'https://qianfan.baidubce.com/v2',
      models: ['ernie-4.5-turbo-128k', 'ernie-4.0-8k', 'ernie-speed-128k'],
      caps: ['text'],
      note: '走 v2 的 OpenAI 兼容入口。老版本用的是 access_token，地址会不一样。'
    },
    minimax: {
      label: 'MiniMax', group: '国内 · 官方', baseUrl: 'https://api.minimax.chat/v1',
      models: ['MiniMax-Text-01', 'abab6.5s-chat', 'MiniMax-VL-01'],
      caps: ['text', 'vision'],
      note: '部分账号的地址是 api.minimaxi.com，报 404 就换一下。'
    },
    stepfun: {
      label: '阶跃星辰 StepFun', group: '国内 · 官方', baseUrl: 'https://api.stepfun.com/v1',
      models: ['step-2-16k', 'step-1-8k', 'step-1v-8k'],
      caps: ['text', 'vision'],
      note: 'step-1v 能读图。'
    },
    modelscope: {
      label: '魔搭 ModelScope', group: '国内 · 官方', baseUrl: 'https://api-inference.modelscope.cn/v1',
      models: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
      caps: ['text', 'vision'],
      note: '阿里社区，模型名带斜杠，常送免费额度。'
    },

    // ---------- 国内 · 聚合中转 ----------
    siliconflow: {
      label: '硅基流动 SiliconFlow', group: '国内 · 聚合', baseUrl: 'https://api.siliconflow.cn/v1',
      models: [
        // 文本 / 对话（免费额度主力）
        'deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-V3.1-Terminus', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1',
        'Qwen/Qwen3.5-35B-A3B', 'Qwen/Qwen3.5-27B', 'Qwen/Qwen3.5-9B',
        'Qwen/Qwen3-32B', 'Qwen/Qwen3-14B', 'Qwen/Qwen3-30B-A3B-Instruct-2507', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-32B-Instruct', 'Qwen/Qwen2.5-7B-Instruct',
        'inclusionAI/Ling-flash-2.0', 'inclusionAI/Ling-mini-2.0',
        'zai-org/GLM-4.5-Air', 'THUDM/GLM-4-32B-0414', 'tencent/Hunyuan-A13B-Instruct', 'ByteDance-Seed/Seed-OSS-36B-Instruct',
        // 视觉 / 多模态（读扫描件 PDF、识图）
        'Qwen/Qwen3-VL-32B-Instruct', 'Qwen/Qwen3-VL-32B-Thinking', 'Qwen/Qwen3-VL-8B-Instruct', 'Qwen/Qwen3-VL-8B-Thinking', 'Qwen/Qwen3-VL-30B-A3B-Instruct', 'Qwen/Qwen3-VL-30B-A3B-Thinking',
        'Qwen/Qwen2.5-VL-72B-Instruct', 'zai-org/GLM-4.5V',
        // 全模态 / Omni
        'Qwen/Qwen3-Omni-30B-A3B-Instruct', 'Qwen/Qwen3-Omni-30B-A3B-Thinking', 'Qwen/Qwen3-Omni-30B-A3B-Captioner',
        // 图像生成 / 视频
        'Qwen/Qwen-Image', 'Qwen/Qwen-Image-Edit', 'black-forest-labs/FLUX.1-schnell', 'Kwai-Kolors/Kolors',
        'Wan-AI/Wan2.2-T2V-A14B', 'Wan-AI/Wan2.2-I2V-A14B',
        // 语音 / 音频
        'FunAudioLLM/CosyVoice2-0.5B', 'fnlp/MOSS-TTSD-v0.5',
        // 代码
        'Qwen/Qwen3-Coder-30B-A3B-Instruct',
        // 全模态 / Omni
        'Qwen/Qwen3-Omni-30B-A3B-Instruct',
        // 检索 / 嵌入（不建议给出题用，放最后）
        'Qwen/Qwen3-Reranker-8B', 'Qwen/Qwen3-Embedding-8B', 'BAAI/bge-m3'
      ],
      caps: ['text', 'vision', 'image', 'audio'],
      note: '一个 Key 用几十家模型，带 VL 的能读图；文生图（FLUX/Kolors/Qwen-Image）、TTS（CosyVoice）、文生视频（Wan2.2）也有，点「读取模型」拉全列表。实名送额度。'
    },
    ppio: {
      label: '派欧云 PPIO', group: '国内 · 聚合', baseUrl: 'https://api.ppinfra.com/v3/openai',
      models: ['deepseek/deepseek-v3', 'qwen/qwen2.5-72b-instruct', 'deepseek/deepseek-r1'],
      caps: ['text', 'reason'],
      note: '模型名带「厂/型号」前缀。'
    },
    qiniu: {
      label: '七牛云 AI', group: '国内 · 聚合', baseUrl: 'https://openai.qiniu.com/v1',
      models: ['deepseek-v3', 'deepseek-r1', 'gpt-4o-mini'],
      caps: ['text', 'reason'],
      note: '企业用户有免费 token 额度。'
    },
    ai302: {
      label: '302.AI', group: '国内 · 聚合', baseUrl: 'https://api.302.ai/v1',
      models: ['gpt-4o-mini', 'deepseek-chat', 'claude-3-5-sonnet-20241022'],
      caps: ['text', 'vision'],
      note: '按量付费，海内外模型都有。'
    },
    aihubmix: {
      label: 'AiHubMix', group: '国内 · 聚合', baseUrl: 'https://aihubmix.com/v1',
      models: ['gpt-4o-mini', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro', 'deepseek-chat'],
      caps: ['text', 'vision'],
      note: '一个 Key 打通各家，国内可直连；价格比官方便宜。'
    },

    // ---------- 海外 · 官方 ----------
    openai: {
      label: 'OpenAI', group: '海外 · 官方', baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-image-1', 'dall-e-3', 'tts-1', 'whisper-1'],
      caps: ['text', 'vision', 'reason', 'image', 'audio'],
      note: '国内直连多半不通，要么自备代理地址，要么用上面的聚合。文生图用 gpt-image-1/dall-e-3，语音用 tts-1/whisper-1。'
    },
    gemini: {
      label: 'Google Gemini', group: '海外 · 官方', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      caps: ['text', 'vision'],
      note: '走 Google 的 OpenAI 兼容入口，地址结尾必须带 /openai。'
    },
    xai: {
      label: 'xAI Grok', group: '海外 · 官方', baseUrl: 'https://api.x.ai/v1',
      models: ['grok-2-latest', 'grok-beta', 'grok-vision-beta'],
      caps: ['text', 'vision'],
      note: 'vision 结尾的能读图。国内需代理。'
    },
    mistral: {
      label: 'Mistral', group: '海外 · 官方', baseUrl: 'https://api.mistral.ai/v1',
      models: ['mistral-large-latest', 'mistral-small-latest', 'pixtral-large-latest'],
      caps: ['text', 'vision'],
      note: 'pixtral 系列能读图，欧洲服务，国内需代理。'
    },

    // ---------- 海外 · 聚合中转 ----------
    openrouter: {
      label: 'OpenRouter', group: '海外 · 聚合', baseUrl: 'https://openrouter.ai/api/v1',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'google/gemini-1.5-pro'],
      caps: ['text', 'vision'],
      note: '一个 Key 用所有模型，模型名是「厂/型号」；有免费模型（名字带 :free）。'
    },
    together: {
      label: 'Together AI', group: '海外 · 聚合', baseUrl: 'https://api.together.xyz/v1',
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'black-forest-labs/FLUX.1-schnell'],
      caps: ['text', 'image'],
      note: '开源模型为主，价格低；也有 FLUX 这类文生图，点「读取模型」拉全列表。'
    },
    groq: {
      label: 'Groq', group: '海外 · 聚合', baseUrl: 'https://api.groq.com/openai/v1',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      caps: ['text'],
      note: '速度极快（推理芯片），适合要秒回的场景。'
    },
    novita: {
      label: 'Novita AI', group: '海外 · 聚合', baseUrl: 'https://api.novita.ai/v3/openai',
      models: ['meta-llama/llama-3.1-70b-instruct', 'deepseek/deepseek-v3'],
      caps: ['text'],
      note: '开源模型托管，按量计费。'
    },
    nvidia: {
      label: 'NVIDIA NIM', group: '海外 · 聚合', baseUrl: 'https://integrate.api.nvidia.com/v1',
      models: ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'],
      caps: ['text'],
      note: '注册送额度，模型名带「厂/型号」。'
    },

    // ---------- 自定义 ----------
    custom: {
      label: '自定义（任意 OpenAI 兼容）', group: '自定义', baseUrl: '', models: [], caps: ['text'],
      note: '学校自建的中转、或上面没列的服务，只要认 /chat/completions 都能填。'
    }
  };

  // 能力标签：模型能干什么。chat 默认按 text 找人，vision 只找勾了 vision 的。
  // 2026-11-08 扩展：在 text/vision/reason 之外新增 image（图像生成）、video（视频生成）、
  // audio（音频：文字转语音 TTS + 语音识别 ASR，合并成一个能力，勾选即代表这套能同时做语音合成与识别）。
  // 每项 hint 写清楚「它干嘛、哪些功能用到」，报错和设置页都从这里取，别让用户猜。
  var caps = [
    { id: 'text', name: '文本问答', hint: '出题、解析、纠错这类纯文字' },
    { id: 'vision', name: '图片识别', hint: '读照片、扫描件、截图（读题、识别试卷）' },
    { id: 'reason', name: '擅长推理', hint: '长文、难题，愿意等久一点' },
    { id: 'image', name: '图像生成', hint: '按文字画图 / 示意图（文生图）' },
    { id: 'video', name: '视频生成', hint: '文生视频（讲解 / 演示短片）' },
    { id: 'audio', name: '音频（语音）', hint: '文字转语音（TTS）+ 语音识别（ASR）' }
  ];

  // 思考程度三档：存在每套配置（profile.thinkLevel）里，调用时落到各家兼容字段（见 request()）。
  var thinkLevels = [
    { id: 'quick', name: '快速', hint: '少思考、回得快，适合出题 / 批改' },
    { id: 'balanced', name: '均衡', hint: '默认档，速度与质量取中' },
    { id: 'deep', name: '深度', hint: '多思考、更准，难题 / 长文用它' }
  ];

  // 能单独指定模型的工具（和首页 TOOLS 的 id 对齐，改了要两边一起改）
  var toolList = [
    { id: 'quiz', name: '刷题' },
    { id: 'mcu', name: '单片机' },
    { id: 'exam', name: '考试' },
    { id: 'ziliao', name: '资料库' },
    { id: 'wiring', name: '接线仿真' },
    { id: 'paike', name: '排课' },
    { id: 'course', name: '课程进度' }
  ];

  var capIds = caps.map(function (c) { return c.id; });

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function str(v) { return v == null ? '' : String(v).trim(); }

  // 把任意来源的对象收敛成一份合法 profile：不认识的 provider 落到 custom，
  // 空的 baseUrl 用供应商预设兜（用户只改模型名时也能用），caps 只留认识的、去重。
  function norm(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var provider = providers[o.provider] ? o.provider : 'custom';
    var preset = providers[provider];
    var baseUrl = str(o.baseUrl) || preset.baseUrl || '';
    var list = Array.isArray(o.models) ? o.models.map(str).filter(Boolean) : [];
    var cs = Array.isArray(o.caps) ? o.caps.map(str).filter(function (c) { return capIds.indexOf(c) >= 0; }) : [];
    cs = cs.filter(function (c, i) { return cs.indexOf(c) === i; });
    if (!cs.length) cs = ['text']; // 没勾就当文本模型，不能让一套配置「什么都不能干」
    // 思考程度：只认三档，老存档没这个字段 = 均衡（默认），不报错。
    var tl = str(o.thinkLevel);
    if (thinkLevels.map(function (x) { return x.id; }).indexOf(tl) < 0) tl = 'balanced';
    return {
      id: str(o.id).replace(/[^\w-]/g, '').slice(0, 32),
      name: str(o.name),
      provider: provider,
      baseUrl: baseUrl,
      model: str(o.model),
      models: list,
      caps: cs,
      thinkLevel: tl,
      at: Number(o.at) || Date.now()
    };
  }

  function read() {
    var raw = null;
    try { raw = JSON.parse(g.localStorage.getItem(STORE) || 'null'); } catch (e) { raw = null; }
    var s = { v: VERSION, profiles: [], active: {}, tools: {} };
    if (!raw || typeof raw !== 'object') return s;
    if (Array.isArray(raw.profiles)) {
      raw.profiles.forEach(function (p) {
        var n = norm(p);
        if (!n.id || !n.model) return; // 没 id 或没模型名的残缺项直接丢，读出来也用不了
        if (!s.profiles.some(function (x) { return x.id === n.id; })) s.profiles.push(n);
      });
    }
    // active / tools 只保留指向真实存在的配置的 id，配置删了以后这里不会留死引用
    if (raw.active && typeof raw.active === 'object') {
      capIds.forEach(function (c) {
        var id = str(raw.active[c]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.active[c] = id;
      });
    }
    if (raw.tools && typeof raw.tools === 'object') {
      Object.keys(raw.tools).forEach(function (t) {
        var id = str(raw.tools[t]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.tools[t] = id;
      });
    }
    return s;
  }

  function write(s) {
    try { g.localStorage.setItem(STORE, JSON.stringify(s)); }
    catch (e) { throw new Error('浏览器不让保存（可能是隐私模式或存储满了）。'); }
  }

  function find(s, id) {
    if (!id) return null;
    var hit = null;
    s.profiles.forEach(function (p) { if (p.id === id) hit = p; });
    return hit;
  }

  function clone(p) { return JSON.parse(JSON.stringify(p)); }

  function list() { return read().profiles.map(clone); }
  function get(id) { var p = find(read(), str(id)); return p ? clone(p) : null; }

  // 只读一份完整设置（给设置页画下拉用；同样是副本，改它不会写回存储）
  function settings() {
    var s = read();
    return { v: VERSION, profiles: s.profiles.map(clone), active: JSON.parse(JSON.stringify(s.active)), tools: JSON.parse(JSON.stringify(s.tools)) };
  }

  function has(id) { return !!key(str(id)); }
  function key(id) {
    var name = KEY_PREFIX + str(id);
    try { return g.sessionStorage.getItem(name) || g.localStorage.getItem(name) || ''; }
    catch (e) { return ''; }
  }

  // 只动这一套的 Key：先两个存储都清掉再按「记住」放回一处，避免同一把 Key 残留两份
  function setKey(id, value, remember) {
    var name = KEY_PREFIX + str(id), k = str(value);
    try {
      g.localStorage.removeItem(name);
      g.sessionStorage.removeItem(name);
      if (k) (remember ? g.localStorage : g.sessionStorage).setItem(name, k);
    } catch (e) { /* 隐私模式下可能写不进去，不影响其它功能 */ }
  }

  function clearKey(id) { setKey(id, '', false); }

  function supports(p, cap) {
    if (!p) return false;
    if (cap === 'text') return true; // 任何一套都能当文本模型用
    return (p.caps || []).indexOf(cap) >= 0;
  }

  /* 新增或更新一套。
     带 id = 更新，不带 = 新增；Key 只有在传了 key（或 apiKey）字段时才改，
     没传就是「保持原样」——设置页编辑时 Key 输入框留空就是这个意思。 */
  function save(input) {
    var s = read();
    var p = norm(input);
    if (!p.id) p.id = uid();
    p.at = Date.now();
    if (!p.name) p.name = p.model || providers[p.provider].label;
    var i = -1;
    s.profiles.forEach(function (x, n) { if (x.id === p.id) i = n; });
    if (i >= 0) s.profiles[i] = p; else s.profiles.push(p);
    if (input && (input.key !== undefined || input.apiKey !== undefined)) {
      setKey(p.id, input.key !== undefined ? input.key : input.apiKey, !!input.remember);
    }
    // 新加的第一套顺手补上空着的默认位，省得用户还要再去下面选三次
    p.caps.forEach(function (c) { if (!s.active[c]) s.active[c] = p.id; });
    write(s);
    return clone(p);
  }

  function remove(id) {
    var s = read(), k = str(id);
    s.profiles = s.profiles.filter(function (p) { return p.id !== k; });
    capIds.forEach(function (c) { if (s.active[c] === k) delete s.active[c]; });
    Object.keys(s.tools).forEach(function (t) { if (s.tools[t] === k) delete s.tools[t]; });
    write(s);
    clearKey(k);
  }

  function setActive(cap, id) {
    if (capIds.indexOf(cap) < 0) throw new Error('不认识的能力：' + cap);
    var s = read(), k = str(id);
    if (k && !find(s, k)) throw new Error('这套配置不存在（可能已被删除）。');
    if (k) s.active[cap] = k; else delete s.active[cap];
    write(s);
  }

  function setTool(tool, id) {
    var t = str(tool);
    if (!t) return;
    var s = read(), k = str(id);
    if (k && !find(s, k)) throw new Error('这套配置不存在（可能已被删除）。');
    if (k) s.tools[t] = k; else delete s.tools[t];
    write(s);
  }

  function activeFor(cap) {
    var s = read();
    var p = find(s, s.active[cap]);
    return p ? clone(p) : null;
  }

  function explicitFor(tool) {
    var s = read();
    return tool ? find(s, s.tools[str(tool)]) : null;
  }

  function forTool(tool) {
    var s = read();
    var p = find(s, s.tools[str(tool)]) || find(s, s.active.text) || null;
    return p ? clone(p) : null;
  }

  /* 真正要用哪一套：
     ① 调用方直接给了 profile（设置页「测试连接」还没保存的配置）就用它；
     ② 指定了工具且这套工具确实能干这件事（比如要读图，工具指定的模型也勾了 vision）→ 用它；
     ③ 否则按能力找默认；
     ④ 推理没单独设就退到文本默认；读图不退——把图塞给文本模型只会换来一句看不懂的报错。 */
  function pick(opts) {
    opts = opts || {};
    if (opts.profile) return norm(opts.profile);
    var cap = opts.cap || 'text';
    var s = read();
    var byTool = explicitFor(opts.tool);
    if (byTool && supports(byTool, cap)) return clone(byTool);
    var byCap = find(s, s.active[cap]);
    if (byCap) return clone(byCap);
    if (cap === 'reason') { var t = find(s, s.active.text); if (t) return clone(t); }
    if (byTool) return clone(byTool);
    return cap === 'text' ? (s.profiles[0] ? clone(s.profiles[0]) : null) : null;
  }

  // 统一友好报错：落到「缺什么能力 / 缺什么模型 / 缺什么 Key」三个维度，别让用户猜。
  function capLabel(cap) {
    for (var i = 0; i < caps.length; i++) if (caps[i].id === cap) return caps[i].name;
    return cap || '文本';
  }
  function missMsg(profile, cap) {
    cap = cap || 'text';
    if (!profile) {
      // 这套能力（图片识别 / 图像生成 / 视频生成 / 音频）没配默认模型：说清「缺什么能力、怎么补」。
      if (cap !== 'text' && cap !== 'reason') {
        return '这个功能需要「' + capLabel(cap) + '」能力的模型，但你还没配。请到「AI 设置」里加一套勾了「' + capLabel(cap) + '」的模型，再在「按能力设默认」里把它选为默认。';
      }
      if (cap === 'reason') return '还没有可用的推理模型，请到「AI 设置」里加一套勾了「擅长推理」的（不设的话会退回文本默认）。';
      return NO_AI;
    }
    return '这套「' + (profile.name || profile.model) + '」还没填 API Key，调不起来。请到「AI 设置」里把它的 Key 补上。';
  }

  // 地址校验照刷题/ai.js 的规矩：只允许 HTTPS，本机调试放行 http://127.0.0.1 和 localhost
  function endpoint(baseUrl, suffix) {
    var url = str(baseUrl).replace(/\/+$/, '');
    if (!url) throw new Error('这套配置没有填接口地址。');
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(url)) {
      throw new Error('接口地址要用 https:// 开头（本机调试可以用 http://127.0.0.1）。');
    }
    url = url.replace(/\/chat\/completions$/i, ''); // 有人会把整条地址粘进来，先还原成根地址
    return url + suffix;
  }

  function keyOf(p, opts) {
    if (opts && (opts.key || opts.apiKey)) return str(opts.key || opts.apiKey);
    if (p && (p.key || p.apiKey)) return str(p.key || p.apiKey);
    if (opts && opts.profile && (opts.profile.key || opts.profile.apiKey)) return str(opts.profile.key || opts.profile.apiKey);
    return p ? key(p.id) : '';
  }

  function hideKey(msg, k) {
    var m = String(msg == null ? '' : msg);
    return k ? m.split(k).join('[已隐藏 Key]') : m;
  }

  function stripFence(text) {
    var t = String(text == null ? '' : text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return t.slice(a, b + 1);
    var c = t.indexOf('['), d = t.lastIndexOf(']');
    if (c >= 0 && d > c) return t.slice(c, d + 1);
    return t;
  }

  /* 发请求。中途可取消：外部 signal 和 60 秒超时任一触发都会 abort，
     但要分清是「用户取消」还是「超时」——前者不该报成网络问题。 */
  async function post(profile, k, body, opts) {
    opts = opts || {};
    var url = endpoint(profile.baseUrl, '/chat/completions');
    if (!str(profile.model)) throw new Error('这套配置没有填模型名。');
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    var outer = opts.signal;
    var onAbort = function () { try { ctl.abort(); } catch (e) { } };
    if (outer) {
      if (outer.aborted) onAbort();
      else if (outer.addEventListener) outer.addEventListener('abort', onAbort);
    }
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      var raw = await res.text();
      var data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
      if (!res.ok) {
        var msg = data && ((data.error && data.error.message) || data.message);
        if (!msg) msg = '接口请求失败（HTTP ' + res.status + '）' + (raw ? '：' + raw.slice(0, 200) : '');
        var err = new Error(hideKey(msg, k));
        err.status = res.status;
        throw err;
      }
      if (!data) throw new Error('接口返回了非 JSON 内容（HTTP ' + res.status + '）。');
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (Array.isArray(content)) { // 少数服务商把多段内容放进数组
        content = content.map(function (x) { return typeof x === 'string' ? x : (x && x.text) || ''; }).join('');
      }
      if (!str(content)) throw new Error('模型没返回内容，换一个模型试试。');
      return String(content);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (outer && outer.aborted) {
          var ae = new Error('请求已取消');
          ae.name = 'AbortError';
          throw ae;
        }
        throw new Error('请求超时（' + Math.round(TIMEOUT / 1000) + ' 秒）。检查网络、余额，或换一个模型。');
      }
      // fetch 在拿到 HTTP 响应前就抛异常（浏览器里是 TypeError: Failed to fetch），属于「网络不通/被拦截」，
      // 不是「Key 错」也不是「接口地址错」。把它转成可操作的排查提示，别让用户对着浏览器原生报错发懵。
      // 注意：非 2xx 的 HTTP 错误上面已经带了 .status 属性，这里用 !e.status 排除，别把那些准确分支盖掉。
      if (e && !e.status && (e.name === 'TypeError' || /failed to fetch|network/i.test(String(e && e.message)))) {
        throw new Error('连不上「' + (providers[profile.provider] ? providers[profile.provider].label : profile.provider) + '」的接口。可能原因：① 本地代理/防火墙拦了这个域名（试试关代理、换网络，或用手机热点）；② 学校网络屏蔽；③ 服务商临时故障。接口地址是对的，Key 问题会单独提示。');
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (outer && outer.removeEventListener) outer.removeEventListener('abort', onAbort);
    }
  }

  async function request(profile, k, messages, opts) {
    opts = opts || {};
    var body = {
      model: str(profile.model),
      messages: messages,
      temperature: opts.temperature == null ? 0.2 : opts.temperature
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    // 思考开关（老字段 think）默认关：各工具要的是「快」。DeepSeek / 硅基流动的开关名不一样，照刷题/ai.js 的写法分开传。
    var think = !!opts.think;
    if (profile.provider === 'deepseek') body.thinking = { type: think ? 'enabled' : 'disabled' };
    if (profile.provider === 'siliconflow') body.enable_thinking = think;
    // 思考程度三档（新字段 thinkLevel）：quick 显式压低、deep 显式拉高、balanced 跟随模型默认（不塞字段）。
    // reasoning_effort 只给认这套的服务（OpenAI o 系列 + 主流聚合），其余退回 temperature 近似，
    // 且只在调用方没显式给 temperature 时才覆盖（别盖掉 test() 这类明确要 0 的场景）。
    var lvl = opts.thinkLevel || profile.thinkLevel;
    if (lvl && lvl !== 'balanced') {
      if (profile.provider === 'deepseek') body.thinking = { type: lvl === 'quick' ? 'disabled' : 'enabled' };
      else if (profile.provider === 'siliconflow') body.enable_thinking = lvl !== 'quick';
      else if (['openai', 'openrouter', 'ai302', 'aihubmix', 'gemini'].indexOf(profile.provider) >= 0)
        body.reasoning_effort = lvl === 'quick' ? 'low' : 'high';
      else if (opts.temperature == null)
        body.temperature = lvl === 'quick' ? 0.2 : 0.8;
    }
    var text = await post(profile, k, body, opts);
    return opts.json ? stripFence(text) : text;
  }

  function toMessages(opts) {
    if (Array.isArray(opts.messages) && opts.messages.length) return opts.messages;
    return [{ role: 'user', content: String(opts.prompt == null ? '' : opts.prompt) }];
  }

  /* 纯文字问答。opts：{ messages | prompt, cap='text', json, signal, tool, think, maxTokens, temperature, profile }
     返回模型原文（json:true 时已经剥掉 ```json 围栏，交给调用方 JSON.parse）。 */
  async function chat(opts) {
    opts = opts || {};
    var cap = opts.cap || 'text';
    var profile = pick(opts);
    if (!profile) throw new Error(missMsg(null, cap));
    var k = keyOf(profile, opts);
    if (!k) throw new Error(missMsg(profile, cap));
    return request(profile, k, toMessages(opts), opts);
  }

  /* 读图。images 是 dataURL（或 http 图片地址）数组，一次可以传多张。
     内容按 OpenAI 多模态格式拼：content:[{type:'text'},{type:'image_url',image_url:{url}}]，
     不这么发的话模型根本收不到图。 */
  async function vision(opts) {
    opts = opts || {};
    var cap = opts.cap || 'vision';
    var images = [].concat(opts.images || []).map(str).filter(Boolean);
    if (!images.length) throw new Error('没有传图片。');
    var profile = pick({ cap: cap, tool: opts.tool, profile: opts.profile });
    if (!profile) throw new Error(missMsg(null, cap));
    var k = keyOf(profile, opts);
    if (!k) throw new Error(missMsg(profile, cap));
    var content = [{ type: 'text', text: String(opts.prompt == null ? '请仔细看这张图片，把里面的内容读出来。' : opts.prompt) }];
    images.forEach(function (src) { content.push({ type: 'image_url', image_url: { url: src } }); });
    var messages = Array.isArray(opts.messages) && opts.messages.length ? opts.messages : [{ role: 'user', content: content }];
    return request(profile, k, messages, opts);
  }

  /* 按「能力」挑一套配置 + 校验 Key，是 image / video / audio 三个入口的公共前置。
     挑不到就把「缺什么能力 / 缺什么 Key」说清楚，供调用方直接抛给用户。 */
  function capProfile(opts, cap) {
    var profile = pick({ cap: cap, tool: opts.tool, profile: opts.profile });
    if (!profile) throw new Error(missMsg(null, cap));
    var k = keyOf(profile, opts);
    if (!k) throw new Error(missMsg(profile, cap));
    return { profile: profile, key: k };
  }

  /* 图像生成（文生图）。走 OpenAI 兼容的 /images/generations（OpenAI / SiliconFlow 等都认），
     opts：{ prompt, n, size, tool, profile }。返回图片 URL（或 base64）数组。 */
  async function image(opts) {
    opts = opts || {};
    var prompt = str(opts.prompt);
    if (!prompt) throw new Error('图像生成要一段文字描述（prompt），比如「画一张三相异步电动机的接线示意图」。');
    var cp = capProfile(opts, 'image');
    var body = {
      model: str(cp.profile.model),
      prompt: prompt,
      n: opts.n || 1,
      size: opts.size || '1024x1024',
      response_format: opts.response_format || 'url'
    };
    var url = endpoint(cp.profile.baseUrl, '/images/generations');
    var res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cp.key },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error('图像生成请求失败：连不上「' + (providers[cp.profile.provider] ? providers[cp.profile.provider].label : cp.profile.provider) + '」的图片接口。');
    }
    var raw = await res.text();
    var data = null; try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
    if (!res.ok) {
      var m = data && ((data.error && data.error.message) || data.message);
      if (!m) m = 'HTTP ' + res.status;
      throw new Error('图像生成失败：' + hideKey(m, cp.key) + '（模型「' + (cp.profile.model) + '」可能不支持文生图，换个勾了「图像生成」的模型试试）。');
    }
    if (!data || !Array.isArray(data.data) || !data.data.length) throw new Error('图像生成没有返回图片，换一个支持文生图的模型试试。');
    return data.data.map(function (x) { return str(x.url) || str(x.b64_json); }).filter(Boolean);
  }

  /* 视频生成 / 音频（TTS + ASR）：调用入口先预留。挑得到模型就说清当前状态，
     挑不到就把「缺什么能力 / 缺什么模型」讲清楚，等后端接口接上后在这里补实现。 */
  function reservedGen(cap, what) {
    return async function (opts) {
      opts = opts || {};
      var cp = capProfile(opts, cap);
      throw new Error(what + '的调用入口已经预留，但生成接口还没接上。当前已选好「' + (cp.profile.name || cp.profile.model) + '」这套（勾了「' + capLabel(cap) + '」），接入后即可直接调用。');
    };
  }
  var video = reservedGen('video', '视频生成');
  var audio = reservedGen('audio', '音频（语音合成 / 识别）');
  var tts = audio;    // 语音合成走 audio 能力（和 ASR 合并），入口名方便调用方语义化
  var asr = audio;    // 语音识别同 audio 能力

  /* 设置页的「测试连接」：拿当前（可能还没保存的）配置发一句最短的话。
     成功返回 { ms, text }，失败把服务商原话抛出来——原话比「测试失败」有用得多。 */
  async function test(profileLike) {
    var p = norm(profileLike);
    var k = str(profileLike && (profileLike.key || profileLike.apiKey)) || key(p.id);
    if (!k) throw new Error(NO_AI + '（这套还没填 API Key）');
    var t0 = Date.now();
    var text = await request(p, k, [{ role: 'user', content: '只回复两个字：收到' }], { maxTokens: 32, temperature: 0 });
    return { ms: Date.now() - t0, text: str(text).slice(0, 40) };
  }

  // 拉模型列表：GET {baseUrl}/models。失败不再默默返回空数组 —— 抛出「缺什么」说清楚的错，
  // 让设置页把「读不到模型」的原因（Key 无效 / 没权限 / 地址不对 / 服务商不开放这接口）直接告诉用户。
  async function models(profileLike) {
    var p = profileLike ? norm(profileLike) : pick({ cap: 'text' });
    if (!p) throw new Error('还没有可用的模型配置，先加一套再读。');
    var k = str(profileLike && (profileLike.key || profileLike.apiKey)) || key(p.id);
    if (!k) throw new Error('这套「' + (p.name || p.model) + '」还没填 API Key，读不了模型列表。');
    // 给「读模型列表」单独设一个 12 秒超时：这个接口轻量、秒回，12 秒还没响应基本是被拦了/网络不通。
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 12000);
    var res;
    try {
      res = await fetch(endpoint(p.baseUrl, '/models'), { headers: { Authorization: 'Bearer ' + k }, signal: ctl.signal });
    } catch (e) {
      // 主动 abort 触发的是 AbortError → 判定为「连接超时」；其它异常是 fetch 在拿到响应前就抛了 → 网络不通/被拦截。
      if (e && e.name === 'AbortError') {
        throw new Error('读模型列表连接超时（12 秒没响应）。可能原因：① 本地代理/防火墙拦了这个域名（试试关代理、换网络，或用手机热点）；② 学校网络屏蔽；③ 服务商临时故障。接口地址是对的，Key 问题会单独提示。');
      }
      throw new Error('连不上「' + (providers[p.provider] ? providers[p.provider].label : p.provider) + '」的模型列表接口。可能原因：① 本地代理/防火墙拦了这个域名（试试关代理、换网络，或用手机热点）；② 学校网络屏蔽；③ 服务商临时故障。接口地址是对的，Key 问题会单独提示。');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new Error('读模型列表失败：接口返回 401，说明 API Key 无效或已过期，请检查 Key 是否正确。');
    if (res.status === 403) throw new Error('读模型列表失败：接口返回 403，这个 Key 没有权限（可能没开通、或额度用完了）。');
    if (res.status === 404) throw new Error('读模型列表失败：接口返回 404，这个服务商不开放 /models 接口，直接手填模型名即可。');
    if (!res.ok) throw new Error('读模型列表失败：接口返回 HTTP ' + res.status + '，请检查接口地址和 Key。');
    var data;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.data)) throw new Error('读模型列表失败：接口返回的内容不是模型列表（可能地址填成了别的接口）。');
    return data.data.map(function (x) { return str(x.id); }).filter(Boolean).sort();
  }

  // 导出：只导「模型和地址」，Key 永远不进来。顺便再兜一层 replacer，防止以后有人往 profile 里塞了 key 字段。
  function exportJson() {
    var s = read();
    var data = { v: VERSION, profiles: s.profiles, active: s.active, tools: s.tools };
    return JSON.stringify(data, function (k2, v) {
      return /^(key|apiKey|remember)$/i.test(k2) ? undefined : v;
    }, 2);
  }

  /* 导入：同 id 覆盖、新 id 追加（换电脑时目标机是空的，效果等于整体恢复）。
     导入的配置没有 Key，界面会提示补填。 */
  function importJson(text) {
    var raw = str(text);
    if (!raw) throw new Error('先把配置 JSON 粘进来。');
    var data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('这不是有效的 JSON，检查一下有没有复制不全。'); }
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.profiles) ? data.profiles : null);
    if (!arr) throw new Error('JSON 里没有 profiles 数组。');
    var s = read(), added = 0, updated = 0;
    arr.forEach(function (item) {
      var p = norm(item);
      if (!p.model) return; // 连模型名都没有的条目没法用
      if (!p.id) p.id = uid();
      if (!p.name) p.name = p.model;
      var i = -1;
      s.profiles.forEach(function (x, n) { if (x.id === p.id) i = n; });
      if (i >= 0) { p.at = Date.now(); s.profiles[i] = p; updated++; } else { s.profiles.push(p); added++; }
    });
    if (data && data.active && typeof data.active === 'object') {
      capIds.forEach(function (c) {
        var id = str(data.active[c]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.active[c] = id;
      });
    }
    if (data && data.tools && typeof data.tools === 'object') {
      Object.keys(data.tools).forEach(function (t) {
        var id = str(data.tools[t]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.tools[t] = id;
      });
    }
    if (!added && !updated) throw new Error('这份 JSON 里没有能用的模型配置。');
    write(s);
    return { added: added, updated: updated };
  }

  g.HXAI = {
    VERSION: VERSION,
    providers: providers,
    caps: caps,
    thinkLevels: thinkLevels,
    toolList: toolList,
    NO_AI: NO_AI,
    list: list,
    get: get,
    settings: settings,
    activeFor: activeFor,
    forTool: forTool,
    hasKey: has,
    key: key,
    save: save,
    remove: remove,
    setActive: setActive,
    setTool: setTool,
    exportJson: exportJson,
    importJson: importJson,
    chat: chat,
    vision: vision,
    image: image,
    video: video,
    audio: audio,
    tts: tts,
    asr: asr,
    test: test,
    models: models
  };
})(typeof window !== 'undefined' ? window : this);
