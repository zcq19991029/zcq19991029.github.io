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
     localStorage['hx-ai-key:plat:<platId>'] —— 2026-11-19 起 Key 一律持久化这里（全云端，不再有「记住」勾选）
     sessionStorage 兜底读取 —— 老存档 / 别处临时填的 Key 仍能读到，只是不再往里写新的

   ────────── 2026-11-15 改版：加「平台」这一层（v1 → v2） ──────────
   为什么改：v1 里「一套配置 = 一家服务商 + 一个模型」，于是
     ① 一个 Key 想多用两个模型（便宜的跑批量、带视觉的专门读照片）就得配两套、把同一把 Key 填两遍；
     ② 更糟的是模型下拉里什么模型都能混进去：给 DeepSeek 勾个「视频生成」，报错要等到真调用的那一刻，
        用户看到的是「接口 400」，根本猜不到是当初选错了。
   所以 v2 把「Key + 地址」和「模型 + 能力」拆成两层，一个平台（一个 Key）下面挂任意多个模型：
     localStorage['hx-ai-v1'] = {
       v: 2,
       plats:    [{ id, name, provider, baseUrl, models, at }],        // 平台：别名（如「111」）+ 服务商 + 地址 + 读取到的模型
       profiles: [{ id, platId, model, name, caps, thinkLevel, at }],  // 模型：挂在平台下，不再各存 baseUrl
       active: {...}, tools: {...}   // 完全不变，仍然指向 profile.id —— 工具页只认这个，不许动
     }
   · 存储键名仍然是 hx-ai-v1（不是笔误）：改了键等于让所有人升级瞬间「配置消失」，宁可版本号放数据里。
   · v1 存档读进来会自动迁移（见 read()）：按 provider+baseUrl 归组成平台、补 platId、把 Key 搬到平台名下，
     不丢配置、不丢 Key、不动 active/tools 的指向。
   · Key 也改挂平台：hx-ai-key:plat:<platId>（存哪个 storage 仍看用户勾没勾「记住」）；
     老的 hx-ai-key:<profileId> 保留兜底读取 —— 迁移没跑成、用户手改过 localStorage 都不至于突然「没填 Key」。
   · 对外（pick / forTool / list / get / settings）拿到的仍然是「拍平」的对象，
     自带 baseUrl / provider / model / caps / thinkLevel，工具页不需要知道有平台这回事。

   用法（经典脚本，不是 ES module）：工具页在 head 里引上一层的 hx-ai.js（和 hx-theme.js 同一层），然后
     const txt = await HXAI.chat({ prompt:'你好', tool:'quiz' });
     const out = await HXAI.vision({ prompt:'读出图里的题目', images:[dataUrl], tool:'quiz' }); */
(function (g) {
  'use strict';

  // 2026-11-15：存储结构升到 v2（加平台层）。VERSION 同时是 settings() 对外报的版本号。
  var VERSION = 2;
  // 为什么存储键还叫 v1：全站 7 个工具 + 用户已有的存档都认这个键。升结构不升键名，
  // 老页面读进来也能认（它们只读 profiles，读到的仍是拍平后的形状）。真正区分版本的是数据里的 v。
  var STORE = 'hx-ai-v1';
  var KEY_PREFIX = 'hx-ai-key:';
  var PLAT_PREFIX = 'hx-ai-key:plat:';  // 2026-11-15：Key 挂平台，一个 Key 下所有模型共用
  var TIMEOUT = 60000; // 60 秒。识别整页扫描件时慢，但超过一分钟基本是卡住了
  var NO_AI = '还没有配置 AI 模型，请到首页「AI 设置」里加一套';

  /* ── 账号云端：配置和 Key 跟账号走（2026-11-19 用户要求）──────────────────────
     用户原话：「永远不存在本机换电脑就看不到的东西，包括 api key 和网页背景，
               跟账号云端走，不留在本机」。
     存在哪：Supabase public.hx_pref 那一行 data（和外观共用一行），读写统一走 window.HXC
     （根目录 hx-cloud.js）。为什么那边是「读-合并-写」而不是整行覆盖，见 hx-cloud.js 顶部。

     这一层的三件事，缺一不可：
       ① 本机没有配置（换电脑 / 清缓存）→ 从云端拉一次并落地，异步、不阻塞首屏；
       ② 本机存了配置 / 勾了「记住」的 Key → 尽力传一份上云（**先本机成功再上云**，上云失败不影响本机）；
       ③ 取消「记住」/ 清空 Key → 云端那份也要删，否则下次换台电脑它又冒出来。

     安全底线：**Key 一律持久化本机 + 尽力同步账号云端**（2026-11-19 用户要求「都算云端，不存本地没这东西了」）。
     所以不再有「勾了记住才持久化」的分支 —— writeKey 的唯一写入口里，有值就写 localStorage 并上云，
     清空就删云端那份。sessionStorage 只留作「老存档 / 临时 Key」的兜底读取。 */
  var CLOUDKEY = 'hx-ai-key:';   // = KEY_PREFIX / PLAT_PREFIX 的共同前缀
  /* hx-cloud.js 是异步拉的。hx-theme.js 通常已经先拉过一次（同一个 window.__HXC_P），
     直接用它的 promise，避免同一个脚本 inject 两遍；只引了 hx-ai.js、没有 hx-theme.js 的页面
     （/ai/ 之外的旧页、离线单文件）才自己拉一次。
     路径只用「本脚本自己的 src」推导，拿不到 src 就**直接不加载**（内联 / data: 没有同目录可拼），
     绝不拿 location 猜。失败会清掉 __HXC_P 允许下次重试，但每页最多 2 次（__hxcTry）。
     所有云端调用静默跳过 —— 本机功能一样不少。 */
  var CLOUD_SRC = '';
  try { CLOUD_SRC = (document.currentScript && document.currentScript.src) || ''; } catch (e) { CLOUD_SRC = ''; }
  function cloudLoad() {
    if (g.HXC) return Promise.resolve(true);
    if (g.__HXC_P) return g.__HXC_P;                            // 正在注入：共用同一个 promise
    if (!CLOUD_SRC) return Promise.resolve(false);              // 拿不到 src（内联 / 离线单文件）：不加载
    var base = String(CLOUD_SRC).replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    if (!/^https?:/i.test(base)) return Promise.resolve(false);  // file:// / data: 离线单文件不拉
    g.__hxcTry = (g.__hxcTry || 0) + 1;
    if (g.__hxcTry > 2) return Promise.resolve(false);           // 每页最多试 2 次
    var el = document.createElement('script'), done = false;
    g.__hxcLoad = 'loading';
    var p = new Promise(function (ok) {
      function fin(v) { if (done) return; done = true; ok(v); }
      el.onload = function () { g.__hxcLoad = !!g.HXC; g.__HXC_P = null; fin(!!g.HXC); };
      el.onerror = function () { g.__hxcLoad = false; g.__HXC_P = null; fin(false); };
      setTimeout(function () { fin(false); }, 4000);              // 超时只 resolve，不解除占用（同 hx-theme.js）
    });
    el.src = base + 'hx-cloud.js';
    g.__HXC_P = p;
    (document.head || document.documentElement).appendChild(el);
    return p;
  }
  // 每次要上云时都过一遍：HXC 还没到 → cloudLoad() 自己决定「拉 / 复用 / 放弃重试」
  function cloudWhen() { return g.HXC ? Promise.resolve(true) : cloudLoad(); }
  var cloudP = cloudLoad();   // 首屏先拉一次（hx-theme.js 通常也在拉，共用 __HXC_P）
  // 「尽力上云」：不 await、不抛错、不影响本机（本机那步在调用处已经成功了）。
  // 守卫式写法：加载时序不确定、或 HXC 只加载了一半，都只是这次没备份，绝不抛错。
  function cloudPut(k, v) {
    try {
      cloudWhen().then(function (ok) {
        if (!ok || !g.HXC || !g.HXC.prefPut) return null;
        return g.HXC.prefPut(k, v);
      }).catch(function () { });
    } catch (e) { /* 连 Promise 都出问题也不能影响本机保存 */ }
  }
  function cloudDel(k) {
    try {
      cloudWhen().then(function (ok) {
        if (!ok || !g.HXC || !g.HXC.prefDel) return null;
        return g.HXC.prefDel(k);
      }).catch(function () { });
    } catch (e) { }
  }

  // 供应商预设。baseUrl 照各家「OpenAI 兼容」入口填，末尾不写 /chat/completions（下面统一拼）。
  // models 只是候选（下拉里的建议），真实可用性以「读取模型」和「测试连接」为准。
  // group 决定下拉框里的分组（照 cc-switch 的 90+ 预设挑了对上课有用的：国内官方 / 国内聚合 / 海外官方 / 海外聚合）。
  // 一律只收「认 /chat/completions」的 —— Anthropic 原生 /v1/messages 不走这套，别往里加。
  // 文生图 / 文生视频 / TTS 的模型 ID 各平台改得快，这里只填有把握的主流 ID，
  // 拿不准的一律留空、靠「读取模型」拉 /models 补全（别瞎编一个不存在的 ID 糊弄用户）。
  // rec（2026-11-19）：这家「最适合本工具集」的那一款，必须真实出现在它自己的 models 里 ——
  //   优先能读图的便宜款（刷题 / 考试 / 资料库 / 接线仿真都要读扫描件）；没有视觉的就选最稳的文本款；
  //   custom 留空。它只活在这份预设里，不写进用户存档，所以改推荐款不会动任何人已有的配置。
  var providers = {
    // ---------- 国内 · 官方 ----------
    deepseek: {
      label: 'DeepSeek', group: '国内 · 官方', baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      caps: ['text', 'reason', 'vision'],
      rec: 'deepseek-v4-flash',
      note: '最便宜，写题改题够用。deepseek-chat / deepseek-reasoner 已于 2026-07 弃用，现在用 deepseek-v4-flash（快）和 deepseek-v4-pro（强）。flash 带视觉能读图。'
    },
    qwen: {
      label: '通义千问（阿里云百炼）', group: '国内 · 官方', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-max', 'qwen-vl-plus'],
      caps: ['text', 'vision'],
      rec: 'qwen-vl-plus',
      note: 'qwen-vl- 开头的是视觉模型，读扫描件用它。阿里云后台要先开通「百炼」。'
    },
    moonshot: {
      label: 'Kimi / 月之暗面', group: '国内 · 官方', baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'moonshot-v1-8k-vision-preview'],
      caps: ['text', 'vision'],
      rec: 'moonshot-v1-8k-vision-preview',
      note: '长文强，整本教材丢进去也行。vision 结尾的才能读图。'
    },
    zhipu: {
      label: '智谱 GLM', group: '国内 · 官方', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus', 'glm-4v'],
      caps: ['text', 'vision'],
      rec: 'glm-4v',
      note: 'glm-4v 系列能读图；glm-4-flash 有免费额度。'
    },
    volc: {
      label: '火山方舟（豆包）', group: '国内 · 官方', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      models: ['doubao-pro-32k', 'doubao-pro-128k', 'doubao-lite-32k', 'doubao-vision-pro-32k'],
      caps: ['text', 'vision'],
      rec: 'doubao-vision-pro-32k',
      note: '模型名要填「接入点 ID」（ep-xxxx）或模型名，看你后台怎么开的。'
    },
    hunyuan: {
      label: '腾讯混元', group: '国内 · 官方', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
      models: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard', 'hunyuan-vision'],
      caps: ['text', 'vision'],
      rec: 'hunyuan-vision',
      note: 'hunyuan-vision 能读图。腾讯云后台拿 Key。'
    },
    qianfan: {
      label: '百度千帆（文心）', group: '国内 · 官方', baseUrl: 'https://qianfan.baidubce.com/v2',
      models: ['ernie-4.5-turbo-128k', 'ernie-4.0-8k', 'ernie-speed-128k'],
      caps: ['text'],
      rec: 'ernie-4.5-turbo-128k',
      note: '走 v2 的 OpenAI 兼容入口。老版本用的是 access_token，地址会不一样。'
    },
    minimax: {
      label: 'MiniMax', group: '国内 · 官方', baseUrl: 'https://api.minimax.chat/v1',
      models: ['MiniMax-Text-01', 'abab6.5s-chat', 'MiniMax-VL-01'],
      caps: ['text', 'vision'],
      rec: 'MiniMax-VL-01',
      note: '部分账号的地址是 api.minimaxi.com，报 404 就换一下。'
    },
    stepfun: {
      label: '阶跃星辰 StepFun', group: '国内 · 官方', baseUrl: 'https://api.stepfun.com/v1',
      models: ['step-2-16k', 'step-1-8k', 'step-1v-8k'],
      caps: ['text', 'vision'],
      rec: 'step-1v-8k',
      note: 'step-1v 能读图。'
    },
    modelscope: {
      label: '魔搭 ModelScope', group: '国内 · 官方', baseUrl: 'https://api-inference.modelscope.cn/v1',
      models: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
      caps: ['text', 'vision'],
      rec: 'Qwen/Qwen2.5-VL-72B-Instruct',
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
      rec: 'Qwen/Qwen3-VL-8B-Instruct',
      note: '一个 Key 用几十家模型，带 VL 的能读图；文生图（FLUX/Kolors/Qwen-Image）、TTS（CosyVoice）、文生视频（Wan2.2）也有，点「读取模型」拉全列表。实名送额度。'
    },
    ppio: {
      label: '派欧云 PPIO', group: '国内 · 聚合', baseUrl: 'https://api.ppinfra.com/v3/openai',
      models: ['deepseek/deepseek-v3', 'qwen/qwen2.5-72b-instruct', 'deepseek/deepseek-r1'],
      caps: ['text', 'reason'],
      rec: 'deepseek/deepseek-v3',
      note: '模型名带「厂/型号」前缀。'
    },
    qiniu: {
      label: '七牛云 AI', group: '国内 · 聚合', baseUrl: 'https://openai.qiniu.com/v1',
      models: ['deepseek-v3', 'deepseek-r1', 'gpt-4o-mini'],
      caps: ['text', 'reason'],
      rec: 'gpt-4o-mini',
      note: '企业用户有免费 token 额度。'
    },
    ai302: {
      label: '302.AI', group: '国内 · 聚合', baseUrl: 'https://api.302.ai/v1',
      models: ['gpt-4o-mini', 'deepseek-chat', 'claude-3-5-sonnet-20241022'],
      caps: ['text', 'vision'],
      rec: 'gpt-4o-mini',
      note: '按量付费，海内外模型都有。'
    },
    aihubmix: {
      label: 'AiHubMix', group: '国内 · 聚合', baseUrl: 'https://aihubmix.com/v1',
      models: ['gpt-4o-mini', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro', 'deepseek-chat'],
      caps: ['text', 'vision'],
      rec: 'gpt-4o-mini',
      note: '一个 Key 打通各家，国内可直连；价格比官方便宜。'
    },

    // ---------- 海外 · 官方 ----------
    openai: {
      label: 'OpenAI', group: '海外 · 官方', baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-image-1', 'dall-e-3', 'tts-1', 'whisper-1'],
      caps: ['text', 'vision', 'reason', 'image', 'audio'],
      rec: 'gpt-4o-mini',
      note: '国内直连多半不通，要么自备代理地址，要么用上面的聚合。文生图用 gpt-image-1/dall-e-3，语音用 tts-1/whisper-1。'
    },
    gemini: {
      label: 'Google Gemini', group: '海外 · 官方', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      caps: ['text', 'vision'],
      rec: 'gemini-2.0-flash',
      note: '走 Google 的 OpenAI 兼容入口，地址结尾必须带 /openai。'
    },
    xai: {
      label: 'xAI Grok', group: '海外 · 官方', baseUrl: 'https://api.x.ai/v1',
      models: ['grok-2-latest', 'grok-beta', 'grok-vision-beta'],
      caps: ['text', 'vision'],
      rec: 'grok-vision-beta',
      note: 'vision 结尾的能读图。国内需代理。'
    },
    mistral: {
      label: 'Mistral', group: '海外 · 官方', baseUrl: 'https://api.mistral.ai/v1',
      models: ['mistral-large-latest', 'mistral-small-latest', 'pixtral-large-latest'],
      caps: ['text', 'vision'],
      rec: 'pixtral-large-latest',
      note: 'pixtral 系列能读图，欧洲服务，国内需代理。'
    },

    // ---------- 海外 · 聚合中转 ----------
    openrouter: {
      label: 'OpenRouter', group: '海外 · 聚合', baseUrl: 'https://openrouter.ai/api/v1',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat', 'google/gemini-1.5-pro'],
      caps: ['text', 'vision'],
      rec: 'openai/gpt-4o-mini',
      note: '一个 Key 用所有模型，模型名是「厂/型号」；有免费模型（名字带 :free）。'
    },
    together: {
      label: 'Together AI', group: '海外 · 聚合', baseUrl: 'https://api.together.xyz/v1',
      models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'black-forest-labs/FLUX.1-schnell'],
      caps: ['text', 'image'],
      rec: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      note: '开源模型为主，价格低；也有 FLUX 这类文生图，点「读取模型」拉全列表。'
    },
    groq: {
      label: 'Groq', group: '海外 · 聚合', baseUrl: 'https://api.groq.com/openai/v1',
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      caps: ['text'],
      rec: 'llama-3.3-70b-versatile',
      note: '速度极快（推理芯片），适合要秒回的场景。'
    },
    novita: {
      label: 'Novita AI', group: '海外 · 聚合', baseUrl: 'https://api.novita.ai/v3/openai',
      models: ['meta-llama/llama-3.1-70b-instruct', 'deepseek/deepseek-v3'],
      caps: ['text'],
      rec: 'deepseek/deepseek-v3',
      note: '开源模型托管，按量计费。'
    },
    nvidia: {
      label: 'NVIDIA NIM', group: '海外 · 聚合', baseUrl: 'https://integrate.api.nvidia.com/v1',
      models: ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'],
      caps: ['text'],
      rec: 'meta/llama-3.1-70b-instruct',
      note: '注册送额度，模型名带「厂/型号」。'
    },

    // ---------- 自定义 ----------
    custom: {
      label: '自定义（任意 OpenAI 兼容）', group: '自定义', baseUrl: '', models: [], caps: ['text'], rec: '',
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

  /* 能单独指定模型的工具（和首页 TOOLS 的 id 对齐，改了要两边一起改）
     2026-11-19：每项多两样东西 ——
       need   ：这个工具最少要模型具备哪几项能力（判定「推荐 / 缺能力」的唯一口径）；
       needWhy：给用户看的一句话，说明为什么非要这几项。
     这两样只活在内存里，不写进存档 —— 老配置没有它们也照常跑。 */
  var NEED_WHY_IMG = '扫描件、照片、接线图要读图，没图片识别只能处理纯文字';
  var NEED_WHY_TXT = '只处理文字，普通文本模型就够';
  var toolList = [
    { id: 'quiz', name: '刷题', need: ['text', 'vision'], needWhy: NEED_WHY_IMG },
    { id: 'mcu', name: '单片机', need: ['text'], needWhy: NEED_WHY_TXT },
    { id: 'exam', name: '考试', need: ['text', 'vision'], needWhy: NEED_WHY_IMG },
    { id: 'ziliao', name: '资料库', need: ['text', 'vision'], needWhy: NEED_WHY_IMG },
    { id: 'wiring', name: '接线仿真', need: ['text', 'vision'], needWhy: NEED_WHY_IMG },
    { id: 'paike', name: '排课', need: ['text'], needWhy: NEED_WHY_TXT },
    { id: 'course', name: '课程进度', need: ['text'], needWhy: NEED_WHY_TXT }
  ];

  var capIds = caps.map(function (c) { return c.id; });

  /* 按模型名猜「它能干什么」（2026-11-19 新增）。
     为什么要有：以前设置页给新模型预勾能力时，直接套用平台的整包 caps ——
     给 DeepSeek 加个纯文本模型也带着「图片识别」，真去读扫描件才报「The model is not a VLM」。
     模型名里其实写着答案（vl / vision / r1 / tts …），按名字猜一次，勾错的概率比整包套用低得多。
     永远带 text：任何一套都能当文本模型用（和 supports() 的口径一致）。
     只认 capIds 里的六项；每条正则后面写着判定依据，改规则就改这里。 */
  function guessCaps(name) {
    var m = str(name);
    var out = ['text'];
    if (!m) return out;
    var rules = [
      // 图片识别：各家对多模态的命名 —— vl / vision / omni，以及本来就带视觉的几款主力型号。
      // deepseek-v4-flash 名字里没有 vl，但它是 DeepSeek 现在的多模态款（上面预设的 rec 就是它），
      // 不认出来会出现「推荐的模型自己被判成不能读图」，所以单独列一条。
      ['vision', /vl\b|vl-|vision|(^|[-_])4v|glm-4\.5v|omni|llava|pixtral|gemini|gpt-4o|gpt-4\.1|claude-3|claude-4|step-1v|minimax-vl|qwen2\.5-vl|qwen3-vl|internvl|molmo|deepseek-v4-flash/i],
      // 擅长推理：名字里带 reason / thinking / r1 / o1 / o3 / qwq 的都是「愿意多想一步」的型号。
      // DeepSeek 的 V3.x / R1 本身是带推理的对话模型（reasoner 定位），名字里常不写 r1/thinking，
      // 但 deepseek-ai/DeepSeek-V3.x 就是推理款，单独列一条避免被当成纯文本漏掉。
      ['reason', /reason|thinking|(^|[-_])r1([-_]|$)|o1([-_]|$)|o3([-_]|$)|qwq|deepseek-v4-pro|deepseek-ai\/deepseek-(v3|r1)/i],
      // 图像生成：dall-e / gpt-image / flux / sd 系 / 各家文生图（qwen-image、seedream、wanx、cogview、kolors）
      ['image', /dall-e|gpt-image|flux|stable-diffusion|seedream|wanx|cogview|sd3|qwen[-\/]?image|kolors/i],
      // 视频生成：sora / veo / kling / wan / seedance 等
      ['video', /sora|veo|kling|wan\b|wan2|seedance|cogvideo|hunyuan-video|hailuo/i],
      // 音频：tts / whisper / asr / cosyvoice / audio / speech 这类合成与识别模型
      ['audio', /tts|whisper|audio|speech|asr|cosyvoice|moss-tts|voice/i]
    ];
    rules.forEach(function (r) { if (r[1].test(m) && out.indexOf(r[0]) < 0) out.push(r[0]); });
    return out;
  }

  /* ── 能力来源三级：官方标注 → AI 判断 → 按名字猜（2026-11-19）──────────────────
     为什么要有这一层：guessCaps 是按模型名正则猜，vl / vision 这种名字里的线索会漏、
     也会误判（比如「gpt-4o」没写 vl 但其实是多模态）。用户在设置页的诉求是
     「别让我手勾，能力自动标、而且要标得准」。于是定成三级，越靠前越可信：
       ① 官方标注：读 /models 时把各家返回的能力字段（capabilities / modalities /
          type / object / owned_by）摘出来，存进下面的缓存（src = official）；
       ② AI 判断：用户点「让 AI 识别能力」时，调一个已有的文本模型，喂「模型名 + 平台」
          清单让它判，结果也进缓存（src = ai）；
       ③ 按名字猜：上面都没有时退回 guessCaps（src = guess），并明说「可能不准」。
     缓存按「模型名」存（同名模型能力基本一致，跨平台也能复用），优先级 official > ai > guess，
     低优先级的写不覆盖高优先级的。 */
  var CAPS_CACHE = 'hx-ai-caps-cache-v1';
  var CAPS_SRC_LABEL = { official: '官方标注', ai: 'AI 识别', guess: '按名字猜' };
  var CAPS_SRC_RANK = { official: 3, ai: 2, guess: 1 };

  function capsCacheRead() {
    var raw = null;
    try { raw = JSON.parse(g.localStorage.getItem(CAPS_CACHE) || 'null'); } catch (e) { raw = null; }
    return raw && typeof raw === 'object' ? raw : {};
  }
  function capsCacheWrite(map) {
    try { g.localStorage.setItem(CAPS_CACHE, JSON.stringify(map)); } catch (e) { /* 隐私模式写不进不碍事 */ }
  }
  // 读缓存里某个模型的能力（带来源），没有返回 null
  function capsCacheGet(model) {
    var m = str(model);
    if (!m) return null;
    var e = capsCacheRead()[m];
    if (!e || !Array.isArray(e.caps)) return null;
    return { caps: withText(e.caps), src: CAPS_SRC_LABEL[e.src] ? e.src : 'guess', at: Number(e.at) || 0 };
  }
  function capsCacheSet(model, capsArr, src) {
    var m = str(model);
    if (!m || !Array.isArray(capsArr)) return;
    var map = capsCacheRead();
    var prev = map[m];
    var nr = CAPS_SRC_RANK[src] || 1;
    var pr = prev && prev.src ? (CAPS_SRC_RANK[prev.src] || 0) : 0;
    if (prev && pr > nr) return;   // 低优先级不覆盖高优先级
    map[m] = { caps: withText(capsArr), src: src, at: Date.now() };
    capsCacheWrite(map);
  }
  // 能力列表统一兜底带 text（supports() 里 text 永远为真，这里保持一致，别存出一份没有 text 的）
  function withText(cs) {
    var a = normCaps(cs);
    if (a.indexOf('text') < 0) a.unshift('text');
    return a;
  }

  /* 从 /models 返回的单条 model 对象里摘「官方标注」的能力。只认官方字段值里的明确词，
     绝不看模型名字（名字猜是 guessCaps 的事）。认不出任何能力 → 返回 null（表示「官方没标」），
     交给上层走 AI 判断 / 按名字猜，绝不假装拿到。 */
  function officialCaps(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var out = ['text'];
    var add = function (c) { if (c && out.indexOf(c) < 0) out.push(c); };
    var capsVal = entry.capabilities;
    if (Array.isArray(capsVal)) capsVal.forEach(function (v) { add(capFromOfficialWord(String(v), false)); });
    else if (capsVal && typeof capsVal === 'object') Object.keys(capsVal).forEach(function (k) { if (capsVal[k]) add(capFromOfficialWord(k, false)); });
    ['modalities', 'supported_modalities', 'modes'].forEach(function (k) {
      var v = entry[k];
      if (!Array.isArray(v)) return;
      v.forEach(function (x) { add(capFromOfficialWord(String(x), true)); });
    });
    ['type', 'object', 'owned_by'].forEach(function (k) {
      var v = entry[k];
      if (typeof v === 'string' && v) add(capFromOfficialWord(v, false));
    });
    return out.length > 1 ? out : null;
  }
  // 官方字段值 → cap。asMode 为真时是「输入输出模态」语境，bare image 指「能读图」= vision。
  function capFromOfficialWord(w, asMode) {
    var s = String(w == null ? '' : w).toLowerCase();
    if (!s) return null;
    if (/embedding|embed|rerank|reranker|moderation|search/.test(s)) return null;
    if (/text.?to.?image|image.?generation|image.?gen|image.?edit/.test(s)) return 'image';
    if (/text.?to.?video|video.?generation|video.?gen/.test(s)) return 'video';
    if (/tts|whisper|asr|speech.?to.?text|speech|audio|voice|sound/.test(s)) return 'audio';
    if (/vision|vlm|multimodal|image.?input|image.?understanding|image_url|image.?to.?text/.test(s)) return 'vision';
    if (asMode && /image/.test(s)) return 'vision';
    if (/image/.test(s)) return 'image';
    if (/video|veo|sora|kling|wan/.test(s)) return 'video';
    if (/reason|thinking/.test(s)) return 'reason';
    if (/text|chat|language|completion/.test(s)) return 'text';
    return null;
  }

  /* 三级能力来源的最终落点：缓存里已有（official / ai / guess）就用缓存的，否则按名字猜。
     guess 也会写回缓存（按名字是确定的，缓存省得下次再猜；以后读到官方标注或 AI 判断会升级覆盖）。 */
  function resolveCaps(model) {
    var m = str(model);
    var c = m ? capsCacheGet(m) : null;
    if (c) return { caps: c.caps, src: c.src };
    var g = guessCaps(m);
    if (m) capsCacheSet(m, g, 'guess');
    return { caps: g, src: 'guess' };
  }
  function capsOf(model) { return resolveCaps(model).caps; }
  function capsSource(model) {
    var c = capsCacheGet(str(model));
    return c ? c.src : 'guess';
  }
  function capsSrcLabel(src) { return CAPS_SRC_LABEL[src] || CAPS_SRC_LABEL.guess; }

  // 一个工具需要哪几项能力（不认识的工具当「纯文本」处理，别让它变成「什么都不能干」）
  function toolNeed(tool) {
    var t = str(tool);
    for (var i = 0; i < toolList.length; i++) if (toolList[i].id === t) return toolList[i].need || ['text'];
    return ['text'];
  }

  function coversAll(p, need) {
    if (!p) return false;
    for (var i = 0; i < need.length; i++) if (!supports(p, need[i])) return false;
    return true;
  }

  // 这套模型是不是「它所在平台推荐的那一款」（推荐款 = 平台预设里 rec 指的那个模型名）
  function isRecModel(s, p) {
    if (!p) return false;
    var plat = findPlat(s, p.platId);
    var preset = plat ? providers[plat.provider] : null;
    return !!(preset && preset.rec && preset.rec === p.model);
  }

  /* 能覆盖这几项能力的最佳模型：先看服务商推荐款，同档再按「先加进来的」。
     为什么不挑最便宜的：平台 rec 那一款就是为了这套工具选的（能读图、够便宜），
     让用户第一次打开就落在对的模型上，而不是落在一个读不了扫描件的纯文本模型上。 */
  function bestForList(s, need) {
    var hit = null;
    s.profiles.forEach(function (p) {
      if (!coversAll(p, need)) return;
      if (!hit) { hit = p; return; }
      var pr = isRecModel(s, p), hr = isRecModel(s, hit);
      if (pr && !hr) hit = p;
      else if (pr === hr && Number(p.at) < Number(hit.at)) hit = p;
    });
    return hit;
  }

  /* 「这个工具推荐用哪套」（2026-11-19）。顺序刻意按「越少打扰用户越靠前」：
     ① 已经单独指定、而且能力够用 → 就是它，不给任何提示（用户自己选的要尊重）；
     ② 没指定 / 指定了但能力不够 → 在所有模型里挑一套 need 全覆盖的，优先平台推荐款、其次先加的；
     ③ 一套都不够 → 退文本默认 → 第一套（和 forTool / pick 的兜底一致，别让界面空着）。 */
  function recFor(tool) {
    var s = read();
    var t = str(tool);
    var need = toolNeed(t);
    var own = find(s, s.tools[t]);
    if (own && coversAll(own, need)) return view(own, s);
    var best = bestForList(s, need);
    if (best) return view(best, s);
    var fb = find(s, s.active.text) || s.profiles[0];
    return fb ? view(fb, s) : null;
  }

  /* 这个模型干这个工具缺哪几项能力 —— 返回中文名数组（如 ['图片识别']），可以直接拼进提示语。
     不缺返回 []。id 认不出（模型已删）也按「全缺」算，界面才能提醒用户重选。 */
  function missingCaps(profileId, tool) {
    var s = read();
    var p = find(s, str(profileId));
    var need = toolNeed(tool);
    var out = [];
    need.forEach(function (c) { if (!supports(p, c)) out.push(capLabel(c)); });
    return out;
  }

  // 「某一项能力该用哪套」：给设置页的「全部按推荐」用，和 recFor 第 ② 步同一套挑法
  function bestFor(cap) {
    var s = read();
    var p = bestForList(s, [str(cap) || 'text']);
    return p ? view(p, s) : null;
  }

  // 生成 id：前缀区分种类（u = 平台，p = 模型），同一份存档里一眼能看出哪个是哪个。
  // 2026-11-15：原来只有模型，一律 p 开头；平台新加，用 u 开头，避免和已有 id 撞车。
  function uid(pre) {
    return (pre || 'p') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function str(v) { return v == null ? '' : String(v).trim(); }

  function cleanId(v) { return str(v).replace(/[^\w-]/g, '').slice(0, 32); }

  // 只留认识的 provider，其余落到 custom（用户手填的地址一样能用，只是没有预设）
  function normProvider(v) { return providers[str(v)] ? str(v) : 'custom'; }

  function normCaps(v) {
    var cs = Array.isArray(v) ? v.map(str).filter(function (c) { return capIds.indexOf(c) >= 0; }) : [];
    cs = cs.filter(function (c, i) { return cs.indexOf(c) === i; });  // 去重
    if (!cs.length) cs = ['text']; // 没勾就当文本模型，不能让一个模型「什么都不能干」
    return cs;
  }

  /* 新增 / 导入时模型的 caps 从哪来：有显式勾选（老数据 / 手动传的）就用勾选的，
     没勾就按三级来源自动判 —— 有标注用标注，没标注走兜底（不再要求用户手动勾）。 */
  function capsFor(o) {
    if (o && Array.isArray(o.caps) && o.caps.length) return normCaps(o.caps);
    return resolveCaps(o && o.model).caps;
  }

  function normThink(v) {
    // 思考程度：只认三档，老存档没这个字段 = 均衡（默认），不报错。
    var tl = str(v);
    if (thinkLevels.map(function (x) { return x.id; }).indexOf(tl) < 0) tl = 'balanced';
    return tl;
  }

  /* 平台（2026-11-15 新增）：「一家服务商 + 一个接口地址 + 一把 Key」，用户还可以起个别名。
     models 是「读取模型」拉回来的候选列表，存在平台这一层 —— 读一次，下面加十个模型都够用，
     不用每个模型各自记一份候选。 */
  function normPlat(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var provider = normProvider(o.provider);
    var preset = providers[provider];
    // 空的 baseUrl 用供应商预设兜（用户只填别名和 Key 时也能直接读模型）
    var baseUrl = str(o.baseUrl) || preset.baseUrl || '';
    var list = Array.isArray(o.models) ? o.models.map(str).filter(Boolean) : [];
    list = list.filter(function (m, i) { return list.indexOf(m) === i; });
    return {
      id: cleanId(o.id),
      name: str(o.name).slice(0, 40) || preset.label,   // 别名空着就用服务商名，卡片上不至于一片空白
      provider: provider,
      baseUrl: baseUrl,
      models: list,
      at: Number(o.at) || Date.now()
    };
  }

  /* 模型（挂在平台下）。v2 的模型自己不存 baseUrl / provider / Key：
     这些都归平台，模型的职责只有「叫什么、能干什么、想多想久」。 */
  function normProfile(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    return {
      id: cleanId(o.id),
      platId: cleanId(o.platId || o.platformId),
      model: str(o.model),
      name: str(o.name).slice(0, 40),
      caps: capsFor(o),
      thinkLevel: normThink(o.thinkLevel),
      at: Number(o.at) || Date.now()
    };
  }

  /* 老形状（v1 的一份配置，或者调用方临时拼的 {provider,baseUrl,model,...}）→ 拍平对象。
     保留这个名字是因为 pick({profile}) / test() / 工具页都可能直接塞一份手拼的配置进来，
     它们不知道平台是什么，也不该被迫知道。 */
  function norm(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var provider = normProvider(o.provider);
    var preset = providers[provider];
    var baseUrl = str(o.baseUrl) || preset.baseUrl || '';
    var list = Array.isArray(o.models) ? o.models.map(str).filter(Boolean) : [];
    return {
      id: cleanId(o.id),
      platId: cleanId(o.platId),
      platName: str(o.platName),
      name: str(o.name),
      provider: provider,
      baseUrl: baseUrl,
      model: str(o.model),
      models: list,
      caps: capsFor(o),
      thinkLevel: normThink(o.thinkLevel),
      at: Number(o.at) || Date.now()
    };
  }

  // 存档里的一条模型 + 它所属的平台 → 拍平对象（也就是全站一直在用的那个形状）。
  // 平台找不到（数据被手改坏了）就退回 custom + 空地址，至少不会整页崩掉。
  function view(p, s) {
    s = s || read();
    var plat = findPlat(s, p.platId) || { id: p.platId, name: '', provider: 'custom', baseUrl: '', models: [] };
    return {
      id: p.id,
      platId: plat.id,
      platName: plat.name,
      provider: plat.provider,
      baseUrl: plat.baseUrl,
      model: p.model,
      name: p.name || p.model,
      models: (plat.models || []).slice(),  // 兼容老字段：候选模型现在挂在平台上
      caps: (p.caps || []).slice(),
      thinkLevel: p.thinkLevel,
      at: p.at
    };
  }

  function parse() {
    var raw = null;
    try { raw = JSON.parse(g.localStorage.getItem(STORE) || 'null'); } catch (e) { raw = null; }
    return raw && typeof raw === 'object' ? raw : null;
  }

  function findPlat(s, id) {
    var k = str(id);
    if (!k) return null;
    var hit = null;
    s.plats.forEach(function (x) { if (x.id === k) hit = x; });
    return hit;
  }

  /* 按「服务商 + 接口地址」找平台，没有就建一个。两个用处：
     ① v1 迁移时把同一家（同一地址）的几套配置归到一个平台下；
     ② save() 还接受老的 {provider,baseUrl,model} 写法，老调用方不至于报错。
     注意只在「没给 platId」时用 —— 用户可能故意用同一个地址挂两把不同账号的 Key。 */
  function ensurePlat(s, o) {
    o = o || {};
    var provider = normProvider(o.provider);
    var baseUrl = str(o.baseUrl) || providers[provider].baseUrl || '';
    var hit = null;
    s.plats.forEach(function (x) { if (!hit && x.provider === provider && x.baseUrl === baseUrl) hit = x; });
    if (hit) return hit;
    var label = providers[provider].label;
    // 重名加序号：两个都是「DeepSeek」（一个官方、一个中转）时，卡片上还分得清
    var name = label, n = 1;
    while (s.plats.some(function (x) { return x.name === name; })) { n++; name = label + ' ' + n; }
    var plat = { id: uid('u'), name: name, provider: provider, baseUrl: baseUrl, models: [], at: Date.now() };
    s.plats.push(plat);
    return plat;
  }

  /* 读存档，顺手把 v1 迁移成 v2。整份数据的唯一入口，所有 set* 都是「read → 改 → write」。
     迁移规则（2026-11-15）：
       · 有 raw.plats 就照读；没有就空着手等下面的 profile 来建。
       · 每条 profile：有 platId 且平台还在就挂上去；否则按 provider+baseUrl 找/建平台 ——
         这一步同时覆盖了「v1 存档」「v2 存档里有条手改坏了的数据」两种情况。
       · active / tools 只保留指向真实存在的模型的 id（原来就有这条，配置删了不留死引用）。
       · 有任何改动（版本不对、补了 platId、建了平台）就写回，并把老键里的 Key 搬到平台名下。 */
  function read() {
    var raw = parse();
    var s = { v: VERSION, plats: [], profiles: [], active: {}, tools: {} };
    if (!raw) return s;
    var dirty = Number(raw.v) !== VERSION;
    var moveKeys = [];   // { platId, from: [profileId…] }：迁移完成后把老键搬过去

    if (Array.isArray(raw.plats)) {
      raw.plats.forEach(function (x) {
        var n = normPlat(x);
        if (!n.id) { dirty = true; return; }
        if (s.plats.some(function (y) { return y.id === n.id; })) return;
        s.plats.push(n);
      });
    }

    if (Array.isArray(raw.profiles)) {
      (raw).profiles.forEach(function (p) {
        var n = normProfile(p);
        if (!n.id || !n.model) return; // 没 id 或没模型名的残缺项直接丢，读出来也用不了
        if (s.profiles.some(function (x) { return x.id === n.id; })) return;
        var plat = findPlat(s, n.platId);
        if (!plat) {
          // v1 的配置带着 provider / baseUrl / models，正好用来归组
          plat = ensurePlat(s, {
            provider: p.provider,
            baseUrl: p.baseUrl,
            // 别名：迁移时不拿模型名当平台名（「DeepSeek 文本」不是平台），统一用服务商 label + 序号
          });
          n.platId = plat.id;
          dirty = true;
        }
        if (!n.name) n.name = n.model;  // 老存档有的没名字，列表里总不能显示空白
        // 2026-11-19：老存档没勾能力（caps 空 / 缺）→ 已经按三级来源自动补上，标脏写回，
        // 下次打开/换电脑也能带出去，不用每次现猜。
        if (!Array.isArray(p.caps) || !p.caps.length) dirty = true;
        s.profiles.push(n);
        if (Array.isArray(p.models) && p.models.length) {
          // v1 里每条配置各自记的候选模型，并进平台（去重），省得迁移后候选凭空少一半
          p.models.map(str).filter(Boolean).forEach(function (m) {
            if (plat.models.indexOf(m) < 0) plat.models.push(m);
          });
        }
      });
      // 迁移 Key：没平台的模型（= 刚从 v1 上来的）都要看一眼老键
      if (dirty) {
        moveKeys.push.apply(moveKeys, s.profiles.map(function (p) { return { platId: p.platId, from: p.id }; }));
      }
    }

    if (raw.active && typeof raw.active === 'object') {
      capIds.forEach(function (c) {
        var id = str(raw.active[c]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.active[c] = id;
      });
    }
    // 识别用模型（2026-11-19 新增）：只有指向真实存在的模型才保留，删了模型不留死引用
    if (raw.judge && raw.judge.modelId && s.profiles.some(function (p) { return p.id === raw.judge.modelId; })) {
      s.judge = { platId: str(raw.judge.platId), modelId: str(raw.judge.modelId) };
    } else {
      s.judge = {};
    }
    if (raw.tools && typeof raw.tools === 'object') {
      Object.keys(raw.tools).forEach(function (t) {
        var id = str(raw.tools[t]);
        if (id && s.profiles.some(function (p) { return p.id === id; })) s.tools[t] = id;
      });
    }

    if (dirty) {
      try {
        write(s);
        // 只有写成功了才「搬」—— 写不进去（隐私模式/配额满）时留着老键，别把用户唯一的 Key 弄丢
        moveKeys.forEach(function (x) { migrateKey(x.platId, x.from); });
      } catch (e) { /* 写不进去就算了，读出来的数据照样能用，Key 走老键兜底 */ }
    }
    return s;
  }

  function write(s) {
    var json;
    try { json = JSON.stringify(s); g.localStorage.setItem(STORE, json); }
    catch (e) { throw new Error('浏览器不让保存（可能是隐私模式或存储满了）。'); }
    // 顺序是刻意的：本机先落盘，成功了才「尽力」上云。云端挂了 / 没登录 → 只是这次没备份，不影响本机。
    // 放在 write() 里而不是 save() 里：read() 的 v1→v2 迁移也走这里，老用户第一次打开就把迁移结果同步上云。
    if (json) cloudPut(STORE, json);
  }

  function find(s, id) {
    if (!id) return null;
    var hit = null;
    s.profiles.forEach(function (p) { if (p.id === id) hit = p; });
    return hit;
  }

  // 对外的三个只读入口一律给「拍平」的对象（带 baseUrl/provider），
  // 工具页从 v1 起就读这几个字段，改成平台结构以后它们一行都不用改。
  // （原来这里有个 clone()，v2 起所有出口都走 view() 现造新对象，克隆就没用了，删掉免得两份逻辑。）
  function list() { var s = read(); return s.profiles.map(function (p) { return view(p, s); }); }
  function get(id) {
    var s = read(), p = find(s, str(id));
    return p ? view(p, s) : null;
  }

  /* 只读一份完整设置（给设置页画下拉用；同样是副本，改它不会写回存储）。
     2026-11-15：多返回一个 plats（平台列表，带 count/caps/tools/hasKey 派生信息），
     老的 profiles / active / tools 一字未动 —— 别的地方继续按老写法取值就行。 */
  function settings() {
    var s = read();
    return {
      v: VERSION,
      plats: s.plats.map(function (x) { return derive(s, x); }),
      profiles: s.profiles.map(function (p) { return view(p, s); }),
      active: JSON.parse(JSON.stringify(s.active)),
      tools: JSON.parse(JSON.stringify(s.tools)),
      judge: s.judge ? JSON.parse(JSON.stringify(s.judge)) : {}
    };
  }

  // ---------- Key 存取（2026-11-15 改挂平台） ----------
  // 统一从一个地方读：session 优先（当前标签页现填的更新），其次 local（勾了「记住」的）
  function readKey(name) {
    try { return g.sessionStorage.getItem(name) || g.localStorage.getItem(name) || ''; }
    catch (e) { return ''; }
  }
  function keyRemembered(name) {
    try { return !!g.localStorage.getItem(name); } catch (e) { return false; }
  }
  /* 只动这一个名字的 Key：先两个存储都清掉，再落到 localStorage。
     2026-11-19 改「全云端」：不再有「记住 / 不记住」这一说 —— 用户的 Key 一律持久化到本机，
     并尽力同步上账号云端（换台电脑登录同一账号能读到）。remember 参数保留但已无意义
     （老调用方还在传），写口兼容，行为统一为「持久化 + 上云」。 */
  function writeKey(name, value, remember) {
    var k = str(value);
    try {
      g.localStorage.removeItem(name);
      g.sessionStorage.removeItem(name);
      if (k) g.localStorage.setItem(name, k);
    } catch (e) { /* 隐私模式下可能写不进去，不影响其它功能 */ }
    /* 跟账号走：Key 的写入口就这一个（setPlatKey / setKey / clearKey / migrateKey 兜底全走到这里），
       所以同步也只需要挂在这里。有值就传一份到账号，清空就删掉云端那份 —— 否则用户以为删干净了，
       换台电脑又自己冒出来。 */
    if (k) cloudPut(name, k); else cloudDel(name);
  }

  function platKey(platId) { return str(platId) ? readKey(PLAT_PREFIX + str(platId)) : ''; }
  function platRemembered(platId) { return str(platId) ? keyRemembered(PLAT_PREFIX + str(platId)) : false; }
  function setPlatKey(platId, value, remember) {
    if (!str(platId)) return;
    writeKey(PLAT_PREFIX + str(platId), value, !!remember);
  }
  function clearPlatKey(platId) { setPlatKey(platId, '', false); }

  /* 一个模型这个「平台」的 Key：先找平台键，再兜底老键。
     兜底为什么必须有：迁移写回失败（隐私模式 / 配额满）、或者用户手改过 localStorage 时，
     平台键是不存在的。这时候如果只认平台键，全站会一起报「没填 Key」—— 那是升级事故，不是用户操作。 */
  function keyOfProfile(p, s) {
    if (!p) return '';
    s = s || read();
    var plat = findPlat(s, p.platId);
    var v = plat ? platKey(plat.id) : '';
    return v || readKey(KEY_PREFIX + p.id);
  }

  function has(id) { return !!key(str(id)); }

  /* 老签名（按 id 取 Key）保留：传模型 id 就解析到它所属的平台，传平台 id 也可以。
     设置页从 v1 起就是这么调的，不改成「必须传平台」的话，别处的调用一行都不用动。 */
  function key(id) {
    var k = str(id);
    if (!k) return '';
    var s = read();
    var p = find(s, k);
    if (p) return keyOfProfile(p, s);
    if (findPlat(s, k)) return platKey(k);
    return readKey(KEY_PREFIX + k);  // 认不出的 id：照老规矩直读，别把调用方弄懵
  }

  /* 老签名（按 id 存 Key）：语义变成「改这个模型所属平台的 Key」——
     同一平台下的其它模型自然一起生效，这正是用户要的「填一次就够」。 */
  function setKey(id, value, remember) {
    var k = str(id);
    if (!k) return;
    var s = read();
    var p = find(s, k);
    if (p) return setPlatKey(p.platId, value, remember);
    if (findPlat(s, k)) return setPlatKey(k, value, remember);
    writeKey(KEY_PREFIX + k, value, !!remember);
  }

  function clearKey(id) { setKey(id, '', false); }

  /* v1 → v2 的 Key 搬家：老键 hx-ai-key:<profileId> 复制到 hx-ai-key:plat:<platId>，
     目标处已经有 Key 就不覆盖（用户可能已经在新界面上重填过了，别把新的盖掉），
     然后删掉老键 —— 一把 Key 只留一份，免得出现「改了平台 Key 但老键还在、读到的却是旧的」。 */
  function migrateKey(platId, profileId) {
    if (!str(platId) || !str(profileId)) return;
    var from = KEY_PREFIX + str(profileId);
    var to = PLAT_PREFIX + str(platId);
    try {
      [g.localStorage, g.sessionStorage].forEach(function (box) {
        var v = null;
        try { v = box.getItem(from); } catch (e) { v = null; }
        if (!v) return;
        var exist = null;
        try { exist = box.getItem(to); } catch (e) { exist = null; }
        if (!exist) { try { box.setItem(to, v); } catch (e) { return; } }
        try { box.removeItem(from); } catch (e) { /* 删不掉也无害，读的时候平台键优先 */ }
        // 搬完把账号上那份也对齐：新键上去、老键删掉（只在 localStorage 这份上做 —— session 的 Key 不上云）
        if (box === g.localStorage) { cloudPut(to, v); cloudDel(from); }
      });
    } catch (e) { /* 存储不可用就留着老键，keyOfProfile 会兜底读到 */ }
  }

  function supports(p, cap) {
    if (!p) return false;
    if (cap === 'text') return true; // 任何一套都能当文本模型用
    return (p.caps || []).indexOf(cap) >= 0;
  }

  // ---------- 平台（2026-11-15 新增） ----------
  /* 一个平台「现在有多少模型、被哪些能力 / 工具用着、有没有 Key」。
     删除确认要把这些数字说给用户听（「还有 3 个模型、被 2 个工具用着」），
     卡片上的徽标也要用，所以统一在这里算一遍，别让设置页自己再数一遍（数错了就删错东西）。 */
  function derive(s, plat) {
    var ids = {}, names = [];
    s.profiles.forEach(function (p) {
      if (p.platId !== plat.id) return;
      ids[p.id] = 1; names.push(p.model);
    });
    var cs = [], ts = [];
    capIds.forEach(function (c) { if (ids[s.active[c]]) cs.push(c); });
    toolList.forEach(function (t) { if (ids[s.tools[t.id]]) ts.push(t.id); });
    return {
      id: plat.id, name: plat.name, provider: plat.provider, baseUrl: plat.baseUrl,
      models: (plat.models || []).slice(), at: plat.at,
      count: names.length, modelNames: names, caps: cs, tools: ts,
      hasKey: !!platKey(plat.id)
    };
  }

  function plats() {
    var s = read();
    return s.plats.map(function (x) { return derive(s, x); });
  }

  function getPlat(id) {
    var s = read(), p = findPlat(s, str(id));
    return p ? derive(s, p) : null;
  }

  /* 新增 / 修改平台。带 id = 改（别名、地址、Key），不带 = 新建。
     Key 只有传了 key / apiKey 才动，没传就保持原样（编辑时 Key 框留空 = 不改）。
     models 传了就当「读取模型」的结果存下来（下次加模型直接有候选），没传就保留原来的。 */
  function savePlat(input) {
    var s = read(), o = input && typeof input === 'object' ? input : {};
    var pl = normPlat(o);
    var i = -1;
    s.plats.forEach(function (x, n) { if (pl.id && x.id === pl.id) i = n; });
    if (!pl.id) { pl.id = uid('u'); i = -1; }
    if (i >= 0) {
      if (!Array.isArray(o.models)) pl.models = s.plats[i].models || [];  // 没传就保留已读到的候选
      pl.at = s.plats[i].at || pl.at;   // 创建时间不动，卡片排序才稳
      s.plats[i] = pl;
    } else {
      s.plats.push(pl);
    }
    if (o.key !== undefined || o.apiKey !== undefined) {
      setPlatKey(pl.id, o.key !== undefined ? o.key : o.apiKey, !!o.remember);
    }
    write(s);
    return derive(s, pl);
  }

  /* 删平台：连带它下面的所有模型、active/tools 里的死引用、平台 Key。
     调用之前设置页会用 platInfo() 把「还有几个模型、被谁用着」摊给用户确认。 */
  function removePlat(id) {
    var s = read(), k = str(id);
    var gone = {};
    s.profiles.forEach(function (p) { if (p.platId === k) gone[p.id] = 1; });
    s.plats = s.plats.filter(function (x) { return x.id !== k; });
    s.profiles = s.profiles.filter(function (p) { return p.platId !== k; });
    capIds.forEach(function (c) { if (gone[s.active[c]]) delete s.active[c]; });
    Object.keys(s.tools).forEach(function (t) { if (gone[s.tools[t]]) delete s.tools[t]; });
    write(s);
    clearPlatKey(k);
    Object.keys(gone).forEach(function (pid) { writeKey(KEY_PREFIX + pid, '', false); }); // 老键也清掉
    return Object.keys(gone).length;
  }

  // 同一平台下同名的模型别存两份：存了也是两份一模一样的配置，用户以后自己都分不清
  function existsModel(platId, model, exceptId) {
    var s = read(), pid = str(platId), m = str(model);
    return s.profiles.some(function (p) {
      return p.platId === pid && p.model === m && p.id !== str(exceptId);
    });
  }

  /* 把一批模型批量挂到平台下（2026-11-19 用户要求「平台模型默认全加入，不二次挑选」）。
     加平台时读到几个模型，就全建 profile，不用用户一个个加。
     幂等：已存在的同名模型跳过（不重复建、也不覆盖用户可能手改过的能力），
     返回 { added, skipped } 供界面提示「自动加了 N 个、已有 M 个」。 */
  function savePlatModels(platId, models) {
    var s = read(), pid = str(platId);
    if (!pid || !findPlat(s, pid)) throw new Error('平台不存在。');
    var list = (Array.isArray(models) ? models : []).map(str).filter(Boolean);
    var added = 0, skipped = 0;
    list.forEach(function (m) {
      if (existsModel(pid, m)) { skipped++; return; }
      var p = {
        id: uid('p'),
        platId: pid,
        model: m,
        name: '',
        caps: resolveCaps(m).caps,   // 自动按三级来源标能力（官方标注 > AI > 按名字猜）
        thinkLevel: 'balanced',
        at: Date.now()
      };
      s.profiles.push(p);
      // 顺手补空着的默认位（和 save() 同一口径）
      p.caps.forEach(function (c) { if (!s.active[c]) s.active[c] = p.id; });
      added++;
    });
    if (added) write(s);
    return { added: added, skipped: skipped };
  }

  /* 新增或更新一个模型。
     2026-11-15：主要走 { platId, model, caps, thinkLevel, name } 这种写法；
     老的 { provider, baseUrl, model } 也还认 —— 找不到 platId 就按「服务商+地址」找/建平台。
     带 id = 更新，不带 = 新增；Key 只有在传了 key（或 apiKey）字段时才改，
     没传就是「保持原样」——设置页编辑时 Key 输入框留空就是这个意思。 */
  function save(input) {
    var s = read(), o = input && typeof input === 'object' ? input : {};
    var p = normProfile(o);
    if (!p.id) p.id = uid('p');
    p.at = Date.now();
    if (!p.name) p.name = p.model;
    if (!p.platId || !findPlat(s, p.platId)) {
      p.platId = ensurePlat(s, { provider: o.provider, baseUrl: o.baseUrl }).id;
    }
    var i = -1;
    s.profiles.forEach(function (x, n) { if (x.id === p.id) i = n; });
    if (i >= 0) s.profiles[i] = p; else s.profiles.push(p);
    if (o.key !== undefined || o.apiKey !== undefined) {
      setPlatKey(p.platId, o.key !== undefined ? o.key : o.apiKey, !!o.remember);
    }
    // 新加的第一套顺手补上空着的默认位，省得用户还要再去下面选三次
    p.caps.forEach(function (c) { if (!s.active[c]) s.active[c] = p.id; });
    write(s);
    return view(p, s);
  }

  /* 删一个模型（平台留着）。注意不再顺手清 Key —— 现在 Key 是平台共用的，
     删掉平台下的某一个模型，不该把其它模型一起弄成「没填 Key」。 */
  function remove(id) {
    var s = read(), k = str(id), p = find(s, k);
    s.profiles = s.profiles.filter(function (x) { return x.id !== k; });
    capIds.forEach(function (c) { if (s.active[c] === k) delete s.active[c]; });
    Object.keys(s.tools).forEach(function (t) { if (s.tools[t] === k) delete s.tools[t]; });
    write(s);
    // 只有在「这个平台已经没有别的模型」时才清它的 Key，回收掉没人用的密码
    if (p && !s.profiles.some(function (x) { return x.platId === p.platId; })) clearPlatKey(p.platId);
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

  // 下面四个对外入口都改成经 view() 拍平（2026-11-15）：
  // 调用方要的仍然是 baseUrl / provider / model / caps / thinkLevel，平台是内部实现细节。
  function activeFor(cap) {
    var s = read();
    var p = find(s, s.active[cap]);
    return p ? view(p, s) : null;
  }

  function explicitFor(tool) {
    var s = read();
    var p = tool ? find(s, s.tools[str(tool)]) : null;
    return p ? view(p, s) : null;
  }

  function forTool(tool) {
    var s = read();
    /* 2026-11-17：补上最后那层兜底 —— 和 pick() 的「文本退第一套」保持一致。
       以前少了这一层，会出现「设置页说这个工具没有可用模型，但真点下去 AI 又能用」
       （因为 pick() 会退到 profiles[0]）。两边口径不一致，老师只会更糊涂。 */
    var p = find(s, s.tools[str(tool)]) || find(s, s.active.text) || s.profiles[0] || null;
    return p ? view(p, s) : null;
  }

  /* 真正要用哪一套：
     ① 调用方直接给了 profile（设置页「测试连接」还没保存的配置）就用它；
     ② 指定了工具且这套工具确实能干这件事（比如要读图，工具指定的模型也勾了 vision）→ 用它；
     ③ 否则按能力找默认；
     ④ 推理没单独设就退到文本默认；读图不退——把图塞给文本模型只会换来一句看不懂的报错。
     2026-11-15 改了一处：按能力找默认时，如果那个默认模型根本没勾这项能力（老存档 / 导入的
     数据里常有：给 DeepSeek 设成「视频生成」默认），就当它没设，继续往下找，最后返回 null，
     让 missMsg 说「缺哪种能力的模型」。为什么不再像 v1 那样闭眼返回：返回错模型的后果是
     请求发出去才报 400，用户在设置页看不出任何问题，正是当初要修的那个坑。 */
  function pick(opts) {
    opts = opts || {};
    if (opts.profile) return norm(opts.profile);
    var cap = opts.cap || 'text';
    var s = read();
    var byToolP = explicitFor(opts.tool);
    if (byToolP && supports(byToolP, cap)) return byToolP;
    var byCap = find(s, s.active[cap]);
    if (byCap && (cap === 'text' || supports(byCap, cap))) return view(byCap, s);
    if (cap === 'reason') { var t = find(s, s.active.text); if (t) return view(t, s); }
    return cap === 'text' ? (s.profiles[0] ? view(s.profiles[0], s) : null) : null;
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

  /* 把「平台 id / 模型 id / 表单里还没保存的一坨」统一解析成「一次请求需要的四件套」：
     { provider, baseUrl, platId, key, name }。2026-11-15 加，因为「读模型 / 测试连接」
     现在既可能在平台卡片上点（还没保存、也没模型），也可能在模型行上点（有模型、Key 归平台）。 */
  function resolveConn(x) {
    x = x && typeof x === 'object' ? x : {};
    var s = read();
    var explicitKey = str(x.key || x.apiKey);
    var plat = null, prof = null;
    if (x.platId) plat = findPlat(s, x.platId);
    if (!plat && x.id && findPlat(s, x.id)) plat = findPlat(s, x.id);   // 直接传了平台 id
    if (!plat && x.id) { prof = find(s, x.id); if (prof) plat = findPlat(s, prof.platId); }
    var provider = normProvider(x.provider || (plat ? plat.provider : ''));
    if (!plat) {
      // 没有平台：只能靠表单里手填的 provider / baseUrl（平台还没保存时就是这条路）
      var baseUrl = str(x.baseUrl) || providers[provider].baseUrl || '';
      if (!baseUrl) return null;
      return { provider: provider, baseUrl: baseUrl, platId: '', key: explicitKey, name: str(x.name) || providers[provider].label, id: '' };
    }
    return {
      provider: plat.provider,
      baseUrl: str(x.baseUrl) || plat.baseUrl,   // 表单里刚改还没保存的地址优先
      platId: plat.id,
      key: explicitKey || platKey(plat.id),
      name: str(x.name) || plat.name,
      id: prof ? prof.id : plat.id
    };
  }

  /* 设置页的「测试连接」：拿当前（可能还没保存的）配置发一句最短的话。
     成功返回 { ms, text }，失败把服务商原话抛出来——原话比「测试失败」有用得多。 */
  async function test(profileLike) {
    var p = norm(profileLike);
    var conn = resolveConn(profileLike);
    // 平台上的地址 / 服务商优先（模型自己不存这两样了，norm() 只能按 provider 预设兜一个）
    if (conn) { p.provider = conn.provider; p.baseUrl = conn.baseUrl; p.platId = conn.platId || p.platId; }
    var k = str(profileLike && (profileLike.key || profileLike.apiKey)) || (conn && conn.key) || key(p.id);
    if (!k) throw new Error(NO_AI + '（这套还没填 API Key）');
    var t0 = Date.now();
    var text = await request(p, k, [{ role: 'user', content: '只回复两个字：收到' }], { maxTokens: 32, temperature: 0 });
    return { ms: Date.now() - t0, text: str(text).slice(0, 40) };
  }

  /* 拉模型列表：GET {baseUrl}/models。失败不再默默返回空数组 —— 抛出「缺什么」说清楚的错，
     让设置页把「读不到模型」的原因（Key 无效 / 没权限 / 地址不对 / 服务商不开放这接口）直接告诉用户。
     2026-11-15：改成「按平台读」，读到结果顺手存进平台（plat.models），
     所以在平台卡片上读一次，下面加模型时下拉里就一直有候选了。 */
  async function models(target) {
    var conn = target ? resolveConn(target) : null;
    if (!conn) {
      // 老用法：不传参数 = 读「文本默认那套」的平台
      var def = pick({ cap: 'text' });
      if (def) conn = { provider: def.provider, baseUrl: def.baseUrl, platId: def.platId, key: keyOf(def), name: def.platName || def.name, id: def.id };
    }
    if (!conn || !conn.baseUrl) throw new Error('还没有可用的平台，先加一个平台再读模型列表。');
    var k = conn.key;
    if (!k) throw new Error('「' + (conn.name || '这个平台') + '」还没填 API Key，读不了模型列表。');
    // 给「读模型列表」单独设一个 12 秒超时：这个接口轻量、秒回，12 秒还没响应基本是被拦了/网络不通。
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 12000);
    var res;
    try {
      res = await fetch(endpoint(conn.baseUrl, '/models'), { headers: { Authorization: 'Bearer ' + k }, signal: ctl.signal });
    } catch (e) {
      // 主动 abort 触发的是 AbortError → 判定为「连接超时」；其它异常是 fetch 在拿到响应前就抛了 → 网络不通/被拦截。
      if (e && e.name === 'AbortError') {
        throw new Error('读模型列表连接超时（12 秒没响应）。可能原因：① 本地代理/防火墙拦了这个域名（试试关代理、换网络，或用手机热点）；② 学校网络屏蔽；③ 服务商临时故障。接口地址是对的，Key 问题会单独提示。');
      }
      throw new Error('连不上「' + (conn.name || conn.provider) + '」的模型列表接口。可能原因：① 本地代理/防火墙拦了这个域名（试试关代理、换网络，或用手机热点）；② 学校网络屏蔽；③ 服务商临时故障。接口地址是对的，Key 问题会单独提示。');
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
    var out = data.data.map(function (x) { return str(x.id); }).filter(Boolean).sort();
    // 2026-11-19：顺手摘官方能力标注 —— 有就写进能力缓存（src=official），没有就跳过。
    // 大多数 /models 接口其实只回 id 不带能力，这里能摘多少摘多少，绝不假装拿到。
    data.data.forEach(function (x) {
      var id = str(x.id);
      if (!id) return;
      var oc = officialCaps(x);
      if (oc) capsCacheSet(id, oc, 'official');
    });
    // 存回平台：下次打开设置页、加新模型时，候选里直接就有（不用再点一次「读取模型」）
    if (conn.platId) {
      try {
        var s = read();
        var pl = findPlat(s, conn.platId);
        if (pl) { pl.models = out.slice(); write(s); }
      } catch (e) { /* 存不下也无所谓，列表已经返回了 */ }
    }
    return out;
  }

  /* 「让 AI 识别能力」（2026-11-19）：当官方标注缺失时，调一个已有的文本模型，
     喂一份「模型名 + 平台」清单，让它判断每个模型的能力，返回 JSON。
     这一步是用户手动触发的（会烧 token、也慢），绝不在后台自动跑。
     失败 / 超时 / 没配文本模型 → 退回 guessCaps，并带一句「可能不准」的提示。 */
  function collectJudgeList(opts) {
    var s = read();
    var list = [];
    if (Array.isArray(opts.models)) {
      list = opts.models.map(function (x) {
        return typeof x === 'string' ? { model: str(x), provider: '' } : { model: str(x && x.model), provider: str(x && x.provider) };
      }).filter(function (x) { return x.model; });
    } else if (opts.platId) {
      var pl = findPlat(s, opts.platId);
      s.profiles.forEach(function (p) { if (p.platId === opts.platId) list.push({ model: p.model, provider: pl ? pl.provider : '' }); });
    }
    var seen = {};
    return list.filter(function (x) {
      if (seen[x.model]) return false;
      seen[x.model] = 1;
      var c = capsCacheGet(x.model);
      if (c && c.src === 'official') return false;   // 官方已标注，不用再让 AI 判
      return true;
    });
  }
  function buildJudgePrompt(list) {
    var names = list.map(function (x, i) {
      var lab = x.provider && providers[x.provider] ? providers[x.provider].label : (x.provider || '未知');
      return (i + 1) + '. ' + x.model + '（平台：' + lab + '）';
    }).join('\n');
    return '请你判断下面每个模型各自具备哪些能力，用于在工具里自动标注。\n' +
      '能力只有六种，用英文 id：text（文本问答）、vision（图片识别）、reason（擅长推理）、image（图像生成）、video（视频生成）、audio（音频 / 语音）。\n' +
      '规则：所有模型都有 text；其余能力按这个模型是否真的能做来判断（视觉模型才有 vision，文生图模型才有 image，依此类推）。\n' +
      '只输出一个 JSON 对象，键是模型名，值是该模型的能力 id 数组，例如 {"gpt-4o": ["text","vision"]}。不要输出任何解释、注释或代码块标记。\n\n模型清单：\n' + names;
  }
  function parseJudgeResult(text, list) {
    var data = null;
    try { data = JSON.parse(stripFence(text)); } catch (e) { return null; }
    var out = {};
    var grab = function (name, cs) {
      var n = str(name);
      if (n && Array.isArray(cs)) out[n] = withText(cs);
    };
    if (Array.isArray(data)) {
      data.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        grab(it.model || it.name || it.id, it.caps || it.abilities || it.capabilities);
      });
    } else if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        var v = data[k];
        if (Array.isArray(v)) grab(k, v);
        else if (v && typeof v === 'object') grab(k, v.caps || v.abilities || v.capabilities);
      });
    }
    var result = {};
    list.forEach(function (x) { if (out[x.model]) result[x.model] = out[x.model]; });
    return Object.keys(result).length ? result : null;
  }
  // 把判断结果写进缓存，并把范围内 profile 的 caps 一并更新（工具立刻按新能力挑模型）。
  // 已有更高优先级的来源（official > ai > guess）时，只跳过 profile 的降级更新，缓存也不降级。
  function commitJudge(opts, list, map, src) {
    var s = read();
    var nr = CAPS_SRC_RANK[src] || 1;
    list.forEach(function (x) {
      var cs = withText(map[x.model]);
      var prev = capsCacheGet(x.model);
      var pr = prev ? (CAPS_SRC_RANK[prev.src] || 0) : 0;
      capsCacheSet(x.model, cs, src);
      if (pr > nr) return;
      s.profiles.forEach(function (p) {
        if (p.model !== x.model) return;
        if (opts.platId && p.platId !== opts.platId) return;
        p.caps = cs;
      });
    });
    write(s);
    return list.map(function (x) { return { model: x.model, caps: withText(map[x.model]) }; });
  }
  /* 「识别用模型」：用户专门指定「哪个平台哪个模型」负责帮其它平台的模型判能力
     （2026-11-19 用户原话：想用硅基流动的 DeepSeek V3.2 去给 DeepSeek 平台识别能力，因为有免费额度）。
     存哪：存档里新增 judge = { platId, modelId }（v2 存档缺这字段时自动为空，兼容老数据）。
     设了它，judgeCaps 就用它来判；没设，退回「文本默认模型」。 */
  function judgeModel(s) {
    s = s || read();
    var j = s.judge;
    if (j && j.modelId) {
      var p = find(s, j.modelId);
      if (p) return p;
    }
    return null;
  }
  function setJudge(platId, modelId) {
    var s = read();
    var k = str(modelId);
    if (k && !find(s, k)) throw new Error('这套识别模型不存在（可能已被删除）。');
    if (k) s.judge = { platId: str(platId), modelId: k };
    else s.judge = {};
    write(s);
  }

  async function judgeCaps(opts) {
    opts = opts || {};
    var list = collectJudgeList(opts);
    if (!list.length) throw new Error('没有需要识别的模型（这个平台下还没有模型，或都已经有官方标注）。');

    // 识别用模型：优先用户专门指定的「识别用模型」，否则退文本默认。
    var judge = null, jk = '';
    try {
      var s = read();
      judge = judgeModel(s) || find(s, s.active.text);
      jk = judge ? keyOf(judge) : '';
    } catch (e) { judge = null; }

    var parsed = null, aiErr = '';
    if (judge && jk) {
      try {
        var raw = await request(judge, jk, [{ role: 'user', content: buildJudgePrompt(list) }], { json: true, maxTokens: 2000, temperature: 0 });
        parsed = parseJudgeResult(raw, list);
        if (!parsed) aiErr = '模型没返回能解析的 JSON';
      } catch (e) { aiErr = (e && e.message) || '调用失败'; }
    } else {
      aiErr = '没有可用的文本模型或没填 Key';
    }

    if (parsed) {
      var items = commitJudge(opts, list, parsed, 'ai');
      return { src: 'ai', judged: list.length, items: items, warn: '' };
    }
    var guessed = {};
    list.forEach(function (x) { guessed[x.model] = guessCaps(x.model); });
    var items2 = commitJudge(opts, list, guessed, 'guess');
    return { src: 'guess', judged: list.length, items: items2, warn: (aiErr ? aiErr + '。' : '') + '这次是按名字猜的，可能不准' };
  }

  // 导出：只导「平台、模型和地址」，Key 永远不进来。顺便再兜一层 replacer，防止以后有人往平台/模型里塞了 key 字段。
  function exportJson() {
    var s = read();
    var data = { v: VERSION, plats: s.plats, profiles: s.profiles, active: s.active, tools: s.tools, judge: s.judge || {} };
    return JSON.stringify(data, function (k2, v) {
      return /^(key|apiKey|remember)$/i.test(k2) ? undefined : v;
    }, 2);
  }

  /* 导入：同 id 覆盖、新 id 追加（换电脑时目标机是空的，效果等于整体恢复）。
     导入的配置没有 Key，界面会提示补填。
     2026-11-15：同时认 v2（plats + profiles）和 v1（只有 profiles）两种格式 ——
     同事给你一份从老版本导出的 JSON，也得能导进来：平台按 provider+baseUrl 自动归组。 */
  function importJson(text) {
    var raw = str(text);
    if (!raw) throw new Error('先把配置 JSON 粘进来。');
    var data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('这不是有效的 JSON，检查一下有没有复制不全。'); }
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.profiles) ? data.profiles : null);
    if (!arr) throw new Error('JSON 里没有 profiles 数组。');
    var s = read(), added = 0, updated = 0, platAdded = 0;
    // 先把平台导进来（这样 profiles 里的 platId 才有地方落）
    if (!Array.isArray(data) && Array.isArray(data.plats)) {
      data.plats.forEach(function (item) {
        var pl = normPlat(item);
        if (!pl.id) pl.id = uid('u');
        var i = -1;
        s.plats.forEach(function (x, n) { if (x.id === pl.id) i = n; });
        if (i >= 0) s.plats[i] = pl; else { s.plats.push(pl); platAdded++; }
      });
    }
    arr.forEach(function (item) {
      var p = normProfile(item);
      if (!p.model) return; // 连模型名都没有的条目没法用
      if (!p.id) p.id = uid('p');
      if (!p.name) p.name = p.model;
      // 导入的是 v1 格式（没有 platId）→ 按服务商+地址找/建平台
      if (!p.platId || !findPlat(s, p.platId)) {
        p.platId = ensurePlat(s, { provider: item.provider, baseUrl: item.baseUrl }).id;
      }
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
    // 识别用模型：导入的 judge 指向的模型得在（同 id 覆盖 / 新 id 追加之后），才接受
    if (data && data.judge && data.judge.modelId && s.profiles.some(function (p) { return p.id === data.judge.modelId; })) {
      s.judge = { platId: str(data.judge.platId), modelId: str(data.judge.modelId) };
    }
    if (!added && !updated) throw new Error('这份 JSON 里没有能用的模型配置。');
    write(s);
    return { added: added, updated: updated, plats: platAdded };
  }

  /* ── 换电脑 / 清了缓存：本机没有就向账号要一份（异步，不阻塞首屏）──────────────────
     只补「本机确实没有」的东西：
       · 配置：本机没有 hx-ai-v1 才拉；拉回来之前用户自己存过一次就放弃（别拿云端旧值盖新的）；
       · Key：本机 localStorage / sessionStorage 都没有这个名字才补 —— 标签页里现填的优先。
     云端那份只有「勾了记住」的 Key 才会有，所以补回来的也都是本该记住的。
     落地后派一个 hx-ai-cloud 事件：/ai/ 设置页若正在显示，可以自己重画（没有监听也不影响什么）。
     整个流程 .catch 吞掉：没登录 / 断网 / 401 都只是「这台机器上用回本机那份」。 */
  (function pull() {
    var hasLocal = true;
    try { hasLocal = !!g.localStorage.getItem(STORE); } catch (e) { hasLocal = true; }
    cloudP.then(function (ok) {
      if (!ok || !g.HXC || !g.HXC.prefGet) return null;   // 守卫式：HXC 没到 / 只到了半截都不算事
      return g.HXC.prefGet();
    }).then(function (d) {
      if (!d || typeof d !== 'object') return;
      var changed = false;
      try {
        if (!hasLocal && !g.localStorage.getItem(STORE) && typeof d[STORE] === 'string' && d[STORE]) {
          g.localStorage.setItem(STORE, d[STORE]); changed = true;
        }
        for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k) && k.indexOf(CLOUDKEY) === 0) {
          if (!g.localStorage.getItem(k) && !g.sessionStorage.getItem(k)) { g.localStorage.setItem(k, d[k]); changed = true; }
        }
      } catch (e) { /* 隐私模式写不进去：读的时候照样有兜底，不影响调用 */ }
      if (changed) { try { g.dispatchEvent(new g.CustomEvent('hx-ai-cloud')); } catch (e) { } }
    }).catch(function () { });
  })();

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
    has: has,          // 老 API 名，全站工具都按这个调（别改名，会崩）
    hasKey: has,       // 2026-11-15 别名：设置页/新代码读起来更直白，两个名都指向同一个函数
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
    models: models,
    // ---------- 2026-11-15 新增：平台层（设置页用，工具页不用管） ----------
    plats: plats,             // 所有平台 + 派生信息（几个模型、被谁用着、有没有 Key）
    getPlat: getPlat,
    savePlat: savePlat,       // 新增/修改平台（别名、服务商、地址、Key）
    removePlat: removePlat,   // 删平台：连带模型 / 默认 / 工具指定 / Key 一起清，返回删掉的模型数
    platKey: platKey,         // 平台的 Key（设置页判断「记住」落在哪个 storage）
    platRemembered: platRemembered,
    setPlatKey: setPlatKey,
    clearPlatKey: clearPlatKey,
    existsModel: existsModel, // 同一平台下同名模型查重
    savePlatModels: savePlatModels, // 批量把模型挂到平台（自动全量加入，2026-11-19）
    explicitFor: explicitFor, // 之前只有 forTool，设置页要区分「单独指定」和「跟随默认」
    // ---------- 2026-11-19 新增：按模型名猜能力 / 按工具推荐 ----------
    guessCaps: guessCaps,     // 猜模型能力（三级来源里的最后兜底），永远含 text
    recFor: recFor,           // 这个工具推荐用哪套（尊重已指定且能力够的）
    missingCaps: missingCaps, // 这个模型相对这个工具缺哪几项能力（中文名数组）
    bestFor: bestFor,         // 某项能力该用哪套（「全部按推荐」用，和 recFor 同一套挑法）
    // ---------- 2026-11-19 能力三级来源：官方标注 / AI 判断 / 按名字猜 ----------
    capsOf: capsOf,           // 这个模型现在会被标成哪几项能力（含缓存回退）
    capsSource: capsSource,   // 能力来源：official / ai / guess
    capsSrcLabel: capsSrcLabel, // 来源的中文名（官方标注 / AI 识别 / 按名字猜）
    judgeCaps: judgeCaps,     // 让 AI 识别一批模型的能力（手动触发，会耗一次调用）
    judgeModel: judgeModel,   // 当前「识别用模型」（谁负责帮别的平台判能力），没设返回 null
    setJudge: setJudge,       // 指定 / 清空「识别用模型」：setJudge(platId, modelId) / setJudge('', '')
    officialCaps: officialCaps, // 从 /models 单条对象摘官方能力（供自验 / 单测）
    // pick 一直是内部函数（chat / vision / image 用），2026-11-15 顺手放出来：
    // 设置页要按能力预演「现在会落到哪个模型」，自验脚本也要能直接断言过滤口径。
    pick: pick,
    // 2026-11-19：云端那一层的就绪 promise（resolve true/false，永不 reject）。
    // 页面若想在「云端配置刚补下来」之后重画一次，`await HXAI.cloud` 即可；工具页不用管它。
    cloud: cloudP
  };
})(typeof window !== 'undefined' ? window : this);
