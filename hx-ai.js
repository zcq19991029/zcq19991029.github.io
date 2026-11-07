/* 华夏工具 · 全站共用的 AI 设置与调用（网站根目录 /hx-ai.js）
   为什么要有这一份：刷题、单片机、考试、接线仿真、排课、课程进度都要调 AI，
   以前各自写一份 provider 表 + Key 存取 + fetch 封装，同一个 Key 要填好几遍，
   模型名、超时、报错文案还各不相同。这里把「配了哪几套模型、哪个工具用哪套」
   收在一处，各工具只调 HXAI.chat / HXAI.vision，不再自己造轮子。

   配置存放（严格按这个契约，别的工具要读同一份）：
     localStorage['hx-ai-v1'] = { v:1, profiles:[{id,name,provider,baseUrl,model,models,caps,at}],
                                  active:{text,vision,reason}, tools:{quiz,mcu,exam,wiring,paike,course} }
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
  // models 只是候选（datalsit / 下拉里的建议），真实可用性以「读取模型」和「测试连接」为准。
  var providers = {
    deepseek: {
      label: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-pro'],
      caps: ['text', 'reason'],
      note: 'DeepSeek 目前没有能读图的模型，别勾「图片识别」。'
    },
    siliconflow: {
      label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen/Qwen3.6-27B', 'deepseek-ai/DeepSeek-V4-Flash', 'Pro/deepseek-ai/DeepSeek-V4'],
      caps: ['text', 'vision'],
      note: '带 VL / V 的多是视觉模型（能读图），价格按图张数算。'
    },
    openai: {
      label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o'],
      caps: ['text', 'vision', 'reason'],
      note: '国内直连多半不通，需要自备代理地址。'
    },
    qwen: {
      label: '通义千问（DashScope）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-vl-max', 'qwen-vl-plus'],
      caps: ['text', 'vision'],
      note: 'qwen-vl- 开头的是视觉模型。'
    },
    moonshot: {
      label: '月之暗面 Moonshot', baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-8k-vision-preview'],
      caps: ['text', 'vision'],
      note: 'vision 结尾的才能读图。'
    },
    custom: {
      label: '自定义（任意 OpenAI 兼容）', baseUrl: '', models: [], caps: ['text'],
      note: '任何认 /chat/completions 的服务都行，比如学校自建的中转。'
    }
  };

  // 能力标签：模型能干什么。chat 默认按 text 找人，vision 只找勾了 vision 的。
  var caps = [
    { id: 'text', name: '文本问答', hint: '出题、解析、纠错这类纯文字' },
    { id: 'vision', name: '图片识别', hint: '读照片、扫描件、截图' },
    { id: 'reason', name: '擅长推理', hint: '长文、难题，愿意等久一点' }
  ];

  // 能单独指定模型的工具（和首页 TOOLS 的 id 对齐，改了要两边一起改）
  var toolList = [
    { id: 'quiz', name: '刷题' },
    { id: 'mcu', name: '单片机' },
    { id: 'exam', name: '考试' },
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
    return {
      id: str(o.id).replace(/[^\w-]/g, '').slice(0, 32),
      name: str(o.name),
      provider: provider,
      baseUrl: baseUrl,
      model: str(o.model),
      models: list,
      caps: cs,
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

  function missMsg(profile, cap) {
    if (!profile) {
      if (cap === 'vision') return '没有设置「图片识别」的默认模型，请到首页「AI 设置」里选一套勾了「图片识别」的';
      if (cap === 'reason') return '没有可用的 AI 模型，请到首页「AI 设置」里加一套';
      return NO_AI;
    }
    return NO_AI + '（「' + (profile.name || profile.model) + '」还缺 API Key）';
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
    // 思考模式默认关：各工具要的是「快」。DeepSeek / 硅基流动的开关名不一样，照刷题/ai.js 的写法分开传。
    var think = !!opts.think;
    if (profile.provider === 'deepseek') body.thinking = { type: think ? 'enabled' : 'disabled' };
    if (profile.provider === 'siliconflow') body.enable_thinking = think;
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

  // 拉模型列表：GET {baseUrl}/models。失败一律返回 []（设置页允许手填模型名）
  async function models(profileLike) {
    var p = profileLike ? norm(profileLike) : pick({ cap: 'text' });
    if (!p) return [];
    var k = str(profileLike && (profileLike.key || profileLike.apiKey)) || key(p.id);
    if (!k) return [];
    try {
      var res = await fetch(endpoint(p.baseUrl, '/models'), { headers: { Authorization: 'Bearer ' + k } });
      if (!res.ok) return [];
      var data = await res.json();
      return (data.data || []).map(function (x) { return str(x.id); }).filter(Boolean).sort();
    } catch (e) { return []; }
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
    test: test,
    models: models
  };
})(typeof window !== 'undefined' ? window : this);
