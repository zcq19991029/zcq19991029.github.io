/* 小组加分/faces.js —— 学生头像 + 身份卡背景（2026-11-13）
   ------------------------------------------------------------------
   教师端分组看板（app.js）和学生端选座页（team.js）都要画「某个学生长什么样」，
   以前各写一套，结果规则跑偏：头像压在姓氏字下面、背景只铺在头像圈上而不是整张卡片。
   现在两边的规则只在这里定义一次。

   数据来源：RPC public.hx_class_faces(p_class)
     一次返回本班每个人的 {student_no, name, bg, pos, avatar}
     · bg     = hx_rank_bg.bg（'p:预设键' 或 data:image/...;base64）
     · avatar = auth.users.user_metadata->>'avatar_url'（Storage 桶 hx-avatars 的公开 URL）
     老师只能读自己的班，学生只能读自己所在的班（函数里判）。

   用法（两边一样）：
     HXFaces.load(clsId, rpc).then(...)      // rpc 用各自页面里的那个包装函数
     var f = HXFaces.of(clsId, studentNo);   // {} 或 {card:'…', av:'…', hasAv:true}
     '<div class="gb-chip' + (f.card ? ' has-face' : '') + '" style="' + f.card + '">'
     '<span class="gb-av' + (f.hasAv ? ' has-img' : '') + '" style="' + f.av + '">' + 首字 + '</span>'

   注意：返回的字符串是**已经可以直接塞进 style="…" 属性**的形式（内部双引号换成单引号），
   调用方不要再包引号、也不要再做转义。
   ------------------------------------------------------------------ */
(function (w) {
  'use strict';

  var cache = {};    // clsId -> { '学号': {bg, pos, avatar} }
  var pending = {};  // clsId -> Promise（同一班并发只发一次请求）

  function clampPos(v) {
    var n = Number(v);
    if (!isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /* 背景值 → 可直接赋给 background 的值；认不出就返回 ''（调用方保持默认底色） */
  function bgValue(bg, pos) {
    var t = String(bg || '');
    if (!t) return '';
    if (/^p:[a-z0-9_-]{1,24}$/i.test(t)) {
      var css = (w.rankBgCss && w.rankBgCss(t)) || '';
      if (!css) return '';
      /* 预设是按 3.2:1 身份卡设计的，铺小卡片时把「100% 100% 拉伸」改成 cover，别压扁 */
      return css.replace(/0 0\s*\/\s*100% 100%/g, '50% 50% / cover');
    }
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t))
      return "url('" + t + "') 50% " + clampPos(pos) + "% / cover no-repeat";
    return '';
  }

  /* 头像 URL → url(...) 值。只认 http(s) 和 data:image，其它一律当没有 */
  function avValue(url) {
    var t = String(url || '').trim();
    if (!t) return '';
    if (!/^https?:\/\//i.test(t) && !/^data:image\//i.test(t)) return '';
    return "url('" + t.replace(/['"\\]/g, '') + "') 50% 50% / cover no-repeat";
  }

  function safeAttr(s) { return String(s || '').replace(/"/g, "'"); }

  var HXFaces = {
    /** 拉本班头像/背景。rpc 传各自页面的包装函数（签名 (name, params) => Promise）。 */
    load: function (clsId, rpc) {
      var id = String(clsId || '');
      if (!id || typeof rpc !== 'function') return Promise.resolve({});
      if (cache[id]) return Promise.resolve(cache[id]);
      if (pending[id]) return pending[id];
      pending[id] = rpc('hx_class_faces', { p_class: Number(id) }).then(function (rows) {
        var map = {};
        (rows || []).forEach(function (r) {
          var k = String(r.student_no || '');
          if (!k) return;
          map[k] = { bg: r.bg || '', pos: r.pos, avatar: r.avatar || '' };
        });
        cache[id] = map;
        pending[id] = null;
        return map;
      }).catch(function (e) {
        pending[id] = null;
        throw e;
      });
      return pending[id];
    },

    /** 已经拉回来的原始表（没拉过返回 null） */
    raw: function (clsId) { return cache[String(clsId || '')] || null; },

    /** 丢掉某班的缓存（教师改完学生设置、或换了账号时用） */
    clear: function (clsId) {
      if (clsId == null) { cache = {}; pending = {}; return; }
      delete cache[String(clsId)]; delete pending[String(clsId)];
    },

    /** 取某个学号的样式：{card, av, hasAv}。card/av 是可直接塞进 style= 的声明串。 */
    of: function (clsId, studentNo) {
      var m = cache[String(clsId || '')];
      var rec = m && m[String(studentNo || '')];
      var card = '', av = '';
      if (rec) {
        var b = bgValue(rec.bg, rec.pos);
        if (b) card = '--hxface:' + safeAttr(b) + ';';
        var a = avValue(rec.avatar);
        if (a) av = '--hxav:' + safeAttr(a) + ';';
      }
      return { card: card, av: av, hasAv: !!av };
    },

    /** 头像圈里显示的首字：姓名首字，没有姓名就用 ? */
    initial: function (name) { return String(name || '?').slice(0, 1); }
  };

  w.HXFaces = HXFaces;
})(window);
