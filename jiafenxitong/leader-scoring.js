/* 组长评分表：每课、每组十个自定义项目，个人每项存储 1–5 分（界面按 20%–100% 显示），独立于课堂小组分。 */
(function () {
  'use strict';
  var printing = false;
  /* 自己触发的重画（加列/改项目名/一键满分/开关）要不要保住滚动位置：2026-11-08 全组展开后一屏很长，
     重画回顶部等于把老师滑到的位置弄丢，所以这些动作自己把 preserveScroll 置 true 再调渲染。 */
  var preserveScroll = false;
  /* 开关 / 清空本列等操作后的提示句：重绘一次表格还要把它显示出来，所以放在渲染函数外面 */
  var peerMsg = '';
  /* 上次画的是哪个班哪节课：换课次时把上节课的提示句清掉（2026-11-08 全组展开后提示条更显眼了） */
  var lastLessonTag = '';
  /* 自动刷新（2026-11-10）：本节开着「组长打分」时每 10 秒拉一次看板；只在页面可见时跑，
     切走/离开评分页就停。定时器只留一个，重画时先清旧的，别泄漏。 */
  var PEER_POLL_MS = 10000;
  var poll = { timer: 0, alive: null, run: null };
  function pollStop() { if (poll.timer) { clearTimeout(poll.timer); poll.timer = 0; } }
  function pollSchedule() {
    pollStop();
    try { if (!poll.alive || !poll.alive()) return; } catch (e) { return; }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    poll.timer = setTimeout(function () {
      poll.timer = 0;
      try { if (!poll.alive || !poll.alive()) return; } catch (e) { return; }
      /* 页面切走这一次就跳过，别在后台空转；切回来由 visibilitychange 重新起 */
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      var p;
      /* 清空本列那一下会让定时器有机会跑到一半：把 run 的异常全部吞掉，绝不影响老师手改 */
      try { p = poll.run(); } catch (e) { p = null; }
      Promise.resolve(p).then(pollSchedule, pollSchedule);
    }, PEER_POLL_MS);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('visibilitychange', function () {
      try {
        if (!poll.alive || !poll.alive()) { pollStop(); return; }
        if (document.visibilityState === 'visible') pollSchedule(); else pollStop();
      } catch (e) { pollStop(); }
    });
  }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function key(member) { return member.sid ? 'sid:'+member.sid : 'id:'+member.id; }
  function csvCell(value) { var s=String(value == null ? '' : value); if (/^[=+\-@]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  window.addEventListener('afterprint',function () { if(printing) { document.body.classList.remove('print-rank','print-leader'); printing=false; } });
  function printableGroup(cls,lesson,g){var r=lesson.leaderScores&&lesson.leaderScores[String(g.no)]||{projects:Array(4).fill(''),members:{},signedBy:'',note:''};var projects=window.JFDT_ASSESSMENT.projectNames(lesson),members=(g.members||[]).filter(function(m){return m.name;}),leadKey=g.leaderKey&&members.some(function(m){return key(m)===g.leaderKey;})?g.leaderKey:(members[0]?key(members[0]):'');if(leadKey){var li=members.findIndex(function(m){return key(m)===leadKey;});if(li>0)members=[members[li]].concat(members.slice(0,li),members.slice(li+1));}return '<section class="leader-slip"><h2>组长课堂评分表</h2><p class="slip-meta">'+esc(cls.name)+' · 第'+g.no+'组 · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><p class="slip-rule">每项满分 100%（20%、40%、60%、80%、100% 五档）；空白项目由组长手写，教师复核。</p><table class="leader-table"><colgroup><col style="width:6%"><col style="width:22%">'+projects.map(function(){return '<col style="width:'+(72/projects.length)+'%">';}).join('')+'</colgroup><thead><tr><th>序号</th><th>成员 / 学号</th>'+projects.map(function(v){return '<th>'+esc(v)+'</th>';}).join('')+'</tr></thead><tbody>'+members.map(function(m,i){var scores=r.members[key(m)]||Array(projects.length).fill(null),lead=key(m)===leadKey;return '<tr><td>'+(i+1)+'</td><td class="slip-member">'+(lead?'👑 ':'')+esc(m.name)+'<small>'+esc(m.sid||'')+'</small></td>'+projects.map(function(_,j){return '<td>'+(scores[j]==null||scores[j]===0?'':numPctText(scores[j]))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table><p class="slip-sign">组长：'+esc(r.signedBy||'________________')+'</p><p class="slip-note">备注：'+esc(r.note||'')+'</p></section>';}
  function printSheets(cls,lesson,groups,perPage){var pages=[],offset=0,counts=Array.isArray(perPage)?perPage:[];if(!counts.length){var limit=Number(perPage)||4,pageCount=Math.ceil(groups.length/limit),base=Math.floor(groups.length/pageCount),extra=groups.length%pageCount;counts=Array.from({length:pageCount},function(_,i){return base+(i<extra?1:0);});}counts.forEach(function(count){var selected=Array.isArray(count)?count:groups.slice(offset,offset+count);offset+=Array.isArray(count)?count.length:count;count=selected.length;if(!selected.length)return;pages.push('<div class="leader-paper slips-'+count+' '+(count>=3?'compact-slips ':'')+(count>=6?'dense-slips ':'')+'" style="grid-template-rows:repeat('+count+',minmax(0,1fr))">'+selected.map(function(g){return printableGroup(cls,lesson,g);}).join('')+'</div>');});return '<div class="leader-print-batch">'+pages.join('')+'</div>';}
  function printIsolated(html){var old=document.getElementById('leaderPrintFrame');if(old)old.remove();var frame=document.createElement('iframe');frame.id='leaderPrintFrame';frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0';var styles=Array.from(document.querySelectorAll('link[rel="stylesheet"],style')).map(function(el){return el.outerHTML;}).join('');frame.srcdoc='<!doctype html><html><head><meta charset="utf-8">'+styles+'<style>@media print{html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important}body::before,body::after{display:none!important}.leader-paper{height:272mm!important;break-after:auto!important;page-break-after:auto!important}.leader-paper+.leader-paper{break-before:page;page-break-before:always}.leader-print-batch{margin:0!important;padding:0!important}}</style></head><body class="print-leader"><div id="printArea">'+html+'</div></body></html>';frame.onload=function(){frame.contentWindow.focus();frame.contentWindow.print();};document.body.appendChild(frame);}
  window.JFDT_LEADER_PRINT_HTML=printSheets;
  var printDialog=document.createElement('dialog');printDialog.id='dlgLeaderPrint';printDialog.innerHTML='<form method="dialog"><h2>打印组长评分表</h2><label class="field col">范围<select id="leaderPrintScope"><option value="all">本课全部小组</option><option value="current">只打印点按钮的那一组</option></select></label><label class="field col">打印页数<select id="leaderPrintPageCount"></select></label><div id="leaderPrintRanges"></div><p id="leaderPrintError" role="alert" class="note"></p><p class="note">每页填写组号范围，例如1-6、7-13；也可填1,3,5。每页最多8组，每组只出现一次。未命名项目留空供手写。A4竖向，建议关闭页眉页脚并按100%打印。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(printDialog);var printSelection=null,exportMode=false;
  function selectedPrintGroups(){return document.querySelector('#leaderPrintScope').value==='all'?printSelection.cls.groups:[printSelection.group];}
  function fillPageRanges(reset){if(!printSelection)return;var groups=selectedPrintGroups(),select=document.querySelector('#leaderPrintPageCount'),n=Number(select.value)||Math.ceil(groups.length/4);if(reset){select.innerHTML=groups.map(function(_,i){return '<option value="'+(i+1)+'">'+(i+1)+'页</option>';}).join('');n=Math.ceil(groups.length/4);}n=Math.max(1,Math.min(n,groups.length));select.value=String(n);var offset=0;document.querySelector('#leaderPrintRanges').innerHTML=Array.from({length:n},function(_,i){var count=Math.floor(groups.length/n)+(i<groups.length%n?1:0),part=groups.slice(offset,offset+count);offset+=count;var numbers=part.map(function(g){return g.no;}),contiguous=numbers.every(function(no,j){return !j||no===numbers[j-1]+1;}),value=contiguous&&numbers.length>1?numbers[0]+'-'+numbers[numbers.length-1]:numbers.join(',');return '<label class="field col">第'+(i+1)+'页组别<input data-print-page="'+i+'" aria-label="第'+(i+1)+'页组别" value="'+esc(value)+'" placeholder="例如1-6"></label>';}).join('');document.querySelector('#leaderPrintError').textContent='';}
  function parsePageRanges(groups,texts){var seen=new Set(),pages=texts.map(function(text,i){var numbers=[];String(text).trim().split(/[,，、\s]+/).forEach(function(token){var m=/^(\d+)(?:[-—–~～至](\d+))?$/.exec(token);if(!m)throw Error('第'+(i+1)+'页请输入组号或范围，如1-6。');var start=Number(m[1]),end=m[2]?Number(m[2]):start;if(start>end||end-start>1000)throw Error('第'+(i+1)+'页组号范围无效。');for(var no=start;no<=end;no++)numbers.push(no);});if(numbers.length>8)throw Error('第'+(i+1)+'页超过8组，请增加页数。');return numbers.map(function(no){var g=groups.find(function(g){return g.no===no;});if(!g)throw Error('第'+no+'组不在本次打印范围内。');if(seen.has(no))throw Error('第'+no+'组重复，请只安排一次。');seen.add(no);return g;});});var missing=groups.filter(function(g){return !seen.has(g.no);});if(missing.length)throw Error('尚未安排：第'+missing.map(function(g){return g.no;}).join('、')+'组。');return pages;}
  window.JFDT_LEADER_PAGE_RANGES=parsePageRanges;
  document.querySelector('#leaderPrintScope').onchange=function(){fillPageRanges(true);};document.querySelector('#leaderPrintPageCount').onchange=function(){fillPageRanges(false);};
  printDialog.addEventListener('close',function(){if(printDialog.returnValue!=='ok'||!printSelection)return;var c=printSelection,groups=selectedPrintGroups(),pages;try{pages=parsePageRanges(groups,Array.from(document.querySelectorAll('[data-print-page]')).map(function(el){return el.value;}));}catch(e){document.querySelector('#leaderPrintError').textContent=e.message;printDialog.showModal();return;}var html=printSheets(c.cls,c.lesson,groups,pages);document.querySelector('#printArea').innerHTML=html;if(exportMode){var bytes=window.JFDT_GROUP_EXCEL(html),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=c.cls.name+'_组内评分打印版.xlsx';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}else printIsolated(html);});
  /* ==================== 组内个人评分 · 全组展开版（2026-11-08，2026-11-10 改直连计分） ====================
     用户原话（2026-11-08）：「成员给组长打分 组长给成员打分 这个还不够清晰 尤其教师给学生打分（最高权限，
     就是防止有的学生懒得打分）确认打分环节不清晰 上面写了有人待确认 也没说哪个组 要不就全组
     展开 不要选卡了 我直接下滑全看清然后点击确认 确认按钮和否按钮都在该表格项目列上面或者下面」

     用户原话（2026-11-10）：「取消教师确认环节 反正教师可以关闭开放加分按钮再去修改更方便」

     所以这一屏的规矩是：
     ① 所有组的表格从上到下连续铺开，一屏一屏往下滑，一次看全；
     ② 每组独立一块，块头固定写「第 N 组 · 组长 某某 · 共 M 人」；
     ③ **学生提交直接计分**，没有「待确认 / 逐列确认」这一整套了：看板一拉回来，
        peer-apply.js 就把原始提交写进 leaderScores（组员给组长的分取平均，组长换人后旧组长的平均行作废）；
     ④ 老师要改分：直接点格子 1~5（带金色描边 +「师」角标），或关掉「组长打分」开关再改；
        每一列仍留一颗「清空本列」= 这一列本轮作废（服务器删掉原始提交，学生要重新打）；
     ⑤ 本节开着「组长打分」且页面可见时，每 10 秒自动拉一次看板（学生一交就有分）；
        页面切走/关掉开关就停，不留后台上定时器。 */
  window.JFDT_LEADER_RENDER = function (context) {
    var root = context.root, state = context.state;
    /* 班级只能来 app.js 传进来的「可见班级」（首页点亮了小组加分的班）。
       以前这里用 state.classes = 本机所有班，历史遗留的旧班（甚至别的学期）会全部出现在下拉里，
       用户 2026-11-04 报「出现不属于我的班」。context.classes 缺失时才退回旧行为，免得老页面炸。 */
    var pool = (context.classes && context.classes.length) ? context.classes : (state.classes || []);
    var cls = pool.find(function (c) { return c.id === state.ui.classId; }) || pool[0];
    var lessons = state.lessons.filter(function (l) { return cls && l.classId === cls.id; }).sort(function (a, b) { return b.seq - a.seq; });
    window.JFDT_LEADER_LESSONS = lessons;
    var lesson = lessons.find(function (l) { return l.id === state.ui.lessonId; }) || lessons[0];
    /* 加列 / 删列 / 改项目名 / 一键满分之后要自己重画一次，
       把滚动位置带回来 —— 否则老师滑到第 6 组点一下又得从头再滑（用户原话「我直接下滑全看清」）。 */
    var keepY = preserveScroll ? (window.pageYOffset || document.documentElement.scrollTop || 0) : null;
    preserveScroll = false;
    /* 换班级 / 换课次就别再挂着上一节课的「已确认加分（7 格）」提示了 */
    var lessonTag = (cls ? cls.id : '') + '#' + (lesson ? lesson.id : '');
    if (lessonTag !== lastLessonTag) { lastLessonTag = lessonTag; peerMsg = ''; }

    root.innerHTML = '<h2 class="sec-title">组内个人评分</h2>' +
      '<p class="note">所有小组都在这一页往下连续排开，不用再选组。学生一提交就<b>直接计分</b>，不用老师再逐列确认。角标一眼看来源：<b>「组员平均」</b>＝组员们给组长打的平均完成率（至少 2 人打才计入，标在组长那一行；组长换过人的，前任组长行上留下的「曾任组长」是他当组长时组员打的平均分）；<b>「互评」</b>＝组长给这一位组员打的完成率；<b>「师」</b>＝老师直接填的分。<b>要改分直接点格子</b>的 20%–100%（带「师」角标），或者关掉上面的「互评」开关再慢慢改。</p>' +
      '<div class="card lesson-bar"><label class="field"><span>班级</span><select id="leaderClassSel">' + pool.map(function (c) { return '<option value="' + esc(c.id) + '"' + (cls && c.id === cls.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>课次</span><select id="leaderLessonSel"' + (!lessons.length ? ' disabled' : '') + '>' + lessons.map(function (l) { return '<option value="' + esc(l.id) + '"' + (lesson && l.id === lesson.id ? ' selected' : '') + '>第' + l.seq + '次 · ' + esc(l.date) + '</option>'; }).join('') + '</select></label></div><div id="leaderSheet"></div>';
    root.querySelector('#leaderClassSel').onchange = function () { context.select(this.value, null); };
    root.querySelector('#leaderLessonSel').onchange = function () { context.select(cls.id, this.value); };

    var sheet = root.querySelector('#leaderSheet');
    if (!cls || !lesson) {
      sheet.innerHTML = '<div class="card empty-hint">请先在“上课记分”新开一课，再填写个人评分。<p><button class="btn" id="leaderGoScore">前往上课记分</button></p></div>';
      sheet.querySelector('button').onclick = context.openScore;
      return;
    }
    /* 用户要「全组展开」（2026-11-08），但 2026-11-09 又报「这里就不需要显示空组 除非有人在第八组等等」：
       0 人的空组不再铺出来白占一屏。口径跟「上课记分」首页的 visibleGroups 一致——组里
       「有名字的人」一个都没有就不画（app.js 的 visibleGroups 没有导出，这里按同一条规则实现）；
       唯一例外是用户点名的「除非有人在第八组」：这一课的 leaderScores 里还留着个人分
       （人转走了、分还在）的空组照常画出来，并写明原因——不然历史分就凭空看不见了。 */
    var allGroups = (cls.groups || []).filter(function (g) { return !!g; });
    if (!allGroups.length) {
      sheet.innerHTML = '<div class="card empty-hint">该班还没有小组，请先导入名单或安排分组。<p><button class="btn" id="leaderGoGroups">去名单与分组</button></p></div>';
      sheet.querySelector('button').onclick = context.openGroups;
      return;
    }
    /* 这一组在当前这课的 leaderScores 里有没有真的分数（null/空串不算，0 分算） */
    function scoreCountOf(gno) {
      try {
        var rec = lesson.leaderScores && lesson.leaderScores[String(gno)];
        if (!rec || !rec.members) return 0;
        var n = 0;
        Object.keys(rec.members).forEach(function (mk) {
          var vals = rec.members[mk];
          if (!Array.isArray(vals)) return;
          vals.forEach(function (v) { if (v != null && v !== '') n++; });
        });
        return n;
      } catch (e) { return 0; }
    }
    var groups = allGroups.filter(function (g) {
      var members = context.memberEntries ? context.memberEntries(g) : (g.members || []).filter(function (m) { return m && m.name; });
      return members.length > 0 || scoreCountOf(g.no) > 0;
    });
    if (!groups.length) {
      sheet.innerHTML = '<div class="card empty-hint">这个班的小组现在都是 0 人，也没留过个人评分，就先不铺出来了。到「名单与分组」安排好人，这里会自动出现。<p><button class="btn" id="leaderGoGroups">去名单与分组</button></p></div>';
      sheet.querySelector('button').onclick = context.openGroups;
      return;
    }

    var sharedProjects = window.JFDT_ASSESSMENT.projectNames(lesson);

    /* ---------- 每组一份记录与成员（互评写回的就是这份 leaderScores） ---------- */
    function recordOf(g) {
      if (!lesson.leaderScores) lesson.leaderScores = {};
      var r = lesson.leaderScores[String(g.no)];
      if (!r) r = lesson.leaderScores[String(g.no)] = { projects: sharedProjects.slice(), members: {}, signedBy: '', note: '' };
      if (!Array.isArray(r.projects) || r.projects.length !== sharedProjects.length) r.projects = sharedProjects.slice();
      if (!r.members) r.members = {};
      return r;
    }
    var states = groups.map(function (g) {
      var members = (context.memberEntries ? context.memberEntries(g) : g.members.map(function (m, i) { return { m: m, i: i }; }).filter(function (x) { return !!x.m.name; }));
      /* 空组不给它落一条空记录到 leaderScores 里（会白占存储、登分册里也多出空组）；
         但「有历史分而保留显示」的空组要用回真实记录——它已经在 leaderScores 里了，
         recordOf 只是取出来，不会新建。 */
      return {
        group: g,
        rec: (members.length || scoreCountOf(g.no)) ? recordOf(g) : { projects: sharedProjects.slice(), members: {}, signedBy: '', note: '' },
        members: members
      };
    });
    var byGno = {};
    states.forEach(function (st) { byGno[String(st.group.no)] = st; });
    var blockFb = {};
    /* 老师最后一次动格子的时间：自动刷新拉到新数据时，如果刚点过格子就先别重画，
       免得把老师正要点的按钮抽掉（2026-11-10 改成自动计分后每 10 秒会拉一次） */
    var lastEditAt = 0;

    var peer = context.peer || null;
    var peerReady = !!(peer && peer.ready && peer.ready(cls));
    var peerReason = peer && peer.reason ? String(peer.reason(cls) || '') : '';
    var board = null;
    var submittedByProject = Object.create(null); // 项目 → 全部提交条数（学生提交直接计分，这里只用于如实显示收了多少条）
    var statusOfProject = Object.create(null);  // 项目 → confirmed / rejected（历史状态，只用于提示）

    function indexBoard(b) {
      board = b || null;
      statusOfProject = Object.create(null);
      ((b && b.confirms) || []).forEach(function (c) { if (c && c.project) statusOfProject[c.project] = c.status; });
      reindexSubmitted();
    }
    /* 当前每组组长：组员给组长的行只在「这个人还是组长」时才算数（和 peer-apply.js 的口径一致） */
    function currentLeaderKeys() {
      var map = Object.create(null);
      ((board && board.payload && board.payload.groups) || []).forEach(function (g) {
        if (!g) return;
        var no = Number(g.no), lead = g.leader == null ? '' : String(g.leader);
        if (no && lead) map[String(no)] = lead;
      });
      return map;
    }
    /* 只统计「这一列现在真的会落格」的提交：组长换人后旧组长名下的 avg 行不计 */
    function reindexSubmitted() {
      submittedByProject = Object.create(null);
      var leads = currentLeaderKeys();
      ((board && board.cells) || []).forEach(function (c) {
        if (!c || !c.project || !c.target) return;
        if (c.role === 'member' && leads[String(c.gno)] !== String(c.target)) return;
        var all = submittedByProject[c.project] || (submittedByProject[c.project] = { total: 0, groups: {} });
        all.total++;
        all.groups[c.gno] = (all.groups[c.gno] || 0) + 1;
      });
    }
    if (peerReady) indexBoard(peer.cached ? peer.cached(lesson) : null);

    /* ---------- 小工具 ---------- */
    function numText(v) { var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10; return n % 1 === 0 ? String(n) : n.toFixed(1); }
    /* 显示层（2026-11-09）：项目分按完成率百分比显示，data-score 与存储仍是 1–5 */
    function numPctText(v) { var n = Math.round((Math.max(0, Math.min(5, Number(v) || 0)) / 5) * 1000) / 10; return (n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1)) + '%'; }
    /* 4.5 这种平均分按最近的整数取色调，别掉回默认灰色 */
    function toneOf(v) { return Math.max(1, Math.min(5, Math.round(Number(v) || 0))); }
    function memberOf(st, mk) { var hit = st.members.find(function (e) { return key(e.m) === mk; }); return hit ? hit.m : null; }
    function cellValue(st, mk, col) { var v = (st.rec.members[mk] || [])[col]; return v == null || v === '' ? null : Number(v); }
    function cellMeta(st, mk, col) { return (lesson.peerMeta && lesson.peerMeta[st.group.no + '|' + mk + '|' + col]) || ''; }
    function persist(st) { if (!lesson.leaderScores) lesson.leaderScores = {}; lesson.leaderScores[String(st.group.no)] = st.rec; context.save(); }
    function logFor(st, detail) { if (context.log) context.log(cls.name + ' · 第' + lesson.seq + '次课 · 第' + st.group.no + '组 · ' + detail); }
    function logClass(detail) { if (context.log) context.log(cls.name + ' · 第' + lesson.seq + '次课 · ' + detail); }
    function setMsg(text) { peerMsg = text || ''; var el = sheet.querySelector('#leaderPeerMsg'); if (el) el.textContent = peerMsg; }
    function setBlockFb(gno, text) { blockFb[gno] = text; var el = sheet.querySelector('[data-fb="' + gno + '"]'); if (el) el.textContent = text; }

    /* 「组员平均」「互评」「师」「接」四种来源角标（2026-11-09 用户问「互评和平均啥意思 为什么组员也有平均」）：
       师 = 教师直接填，接 = 接线任务自动入账；
       「组员平均」只该出现在组长行（组员给组长的分取平均）——组员行上如果还留着平均分，
       说明这个人当过组长、后来被换掉了：分数是他任组长时组员打的，照样计入，
       角标写成「曾任组长」（格子的悬浮提示里有完整解释），别让人误以为组员之间也在互相取平均。 */
    function isLeadKey(st, mk) {
      var m = memberOf(st, mk);
      return !!(m && context.isLeader && context.isLeader(st.group, m));
    }
    function srcHtml(meta, isLead) {
      if (!meta) return '';
      var text = meta === 'avg' ? (isLead ? '组员平均' : '曾任组长') : (meta === 'teacher' ? '师' : (meta === 'wire' ? '接' : '互评'));
      /* 白色空格不折行：格子窄的时候角标宁可挤出一条直线，也别一个字一行地叠起来 */
      return '<span class="peer-src peer-src-' + meta + '" style="white-space:nowrap">' + text + '</span>';
    }
    function picksHtml(st, mk, col) {
      var m = memberOf(st, mk);
      var label = esc(m ? m.name : '') + ' · ' + esc(sharedProjects[col] || ('项目' + (col + 1)));
      /* 2026-11-09 显示层改革：按钮显示 20%~100%；data-score 仍是 1–5，一格满分=100% */
      return [1, 2, 3, 4, 5].map(function (s) {
        return '<button type="button" class="peer-pick p' + s + '" data-score="' + s + '" title="给 ' + numPctText(s) + '" aria-label="' + label + ' 给 ' + numPctText(s) + '">' + numPctText(s) + '</button>';
      }).join('');
    }
    function cellInner(st, mk, col, gone) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col);
      /* 已转走/移出名单的历史分行：空格不摆打分按钮（点了也不会有反应），只放个占位 */
      if (v == null) return gone ? '<span class="peer-score" style="opacity:.3">—</span>' : picksHtml(st, mk, col);
      return '<span class="peer-score">' + numPctText(v) + '</span>' + srcHtml(meta, isLeadKey(st, mk));
    }
    function cellTitle(st, mk, col) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col);
      /* 接线任务列（2026-11-09 用户定：「这一列的分不能人为控制」）：
         分数 = 任务完成率 × 5，由任务成绩自动写入，老师不能在这里手改、也不能撤销。
         想改这格 → 去接线那边重跑/重开任务，下一轮同步会自动更新。 */
      if (meta === 'wire') return '接线任务自动入账的完成率（任务完成率 × 100%），不能手改；任务重跑后下一轮同步会自动更新这一格';
      if (v == null) return '教师可直接给 20%–100%（不用等学生提交）';
      if (meta === 'teacher') return '教师直接填的完成率，已计入；双击撤销这一格的加分';
      if (meta === 'avg') return isLeadKey(st, mk)
        ? '组员们给组长打的平均完成率（至少 2 人打才计入）；双击撤销这一格的加分'
        : '此人当时是组长：这是他任组长时组员们打的平均完成率，组长换人后新的组员打分只计入现任组长；双击撤销这一格的加分';
      return '学生提交后直接计分（组长给组员的完成率）；双击撤销这一格的加分';
    }
    function cellHtml(st, mk, col, gone) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col);
      var m = memberOf(st, mk);
      var lock = meta === 'wire';
      var cls = 'peer-cell' + (v != null ? ' is-set score-' + toneOf(v) : '') +
        (meta === 'teacher' ? ' is-teacher' : '') + (lock ? ' is-wire' : '') + (gone ? ' is-gone' : '');
      return '<div class="' + cls + '" data-gno="' + st.group.no + '" data-peer-cell="' + col + '" data-member="' + esc(mk) + '"' + (gone ? ' data-gone="1"' : '') +
        (lock || gone ? '' : (v != null ? ' data-score="' + v + '" role="button" tabindex="0"' : ' role="group"')) +
        ' title="' + esc(cellTitle(st, mk, col)) + '" aria-label="' + esc(m ? m.name : '') + ' ' + esc(String(sharedProjects[col] || '').trim() || ('项目' + (col + 1))) + '">' +
        cellInner(st, mk, col, gone) + '</div>';
    }
    function paintCell(el, st, mk, col) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col);
      var lock = meta === 'wire';
      var gone = !!(el.dataset && el.dataset.gone === '1');
      el.classList.toggle('is-set', v != null);
      el.classList.toggle('is-teacher', meta === 'teacher');
      el.classList.toggle('is-wire', lock);
      el.classList.remove('is-pending');
      for (var i = 1; i <= 5; i++) el.classList.toggle('score-' + i, v != null && toneOf(v) === i);
      // 接线任务列锁死：不给 data-score / role=button / tabindex，键盘和双击都进不来
      if (lock || gone) { el.removeAttribute('data-score'); el.removeAttribute('role'); el.removeAttribute('tabindex'); }
      else if (v == null) { el.removeAttribute('data-score'); el.setAttribute('role', 'group'); el.removeAttribute('tabindex'); }
      else { el.setAttribute('data-score', v); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); }
      el.title = cellTitle(st, mk, col);
      el.innerHTML = cellInner(st, mk, col, gone);
    }
    /* 老师点 1–5 / 双击撤销：都算「教师直接填」，打上「师」标记。
       同时把这一格的 peerSync 顶到现在 —— 比这次手改更旧的学生提交（自动刷新拉回来的）
       就不会把老师改的分冲掉；学生之后重新提交（更新的时间）照样能计分。 */
    function setCell(st, mk, col, value) {
      var m = memberOf(st, mk);
      if (!m) return;
      /* 接线任务列锁死（2026-11-09 用户：「这一列的分不能人为控制」）：
         分数是任务完成率 × 5，来源是任务成绩，不是老师手上的 1–5 颗星。
         老师想改 → 去接线那边重跑/重开任务，同步会自己更新这一格。
         这里必须挡在写入之前，否则一次误点就把任务分改掉，下一轮同步又会把它改回去（老师会以为见鬼）。 */
      if (cellMeta(st, mk, col) === 'wire') {
        setBlockFb(st.group.no, '这一列是接线课堂任务自动入账的完成率（任务完成率 × 100%），不能手改；要改请重跑任务。');
        return;
      }
      if (!st.rec.members[mk]) st.rec.members[mk] = [];
      var old = st.rec.members[mk][col];
      old = (old == null || old === '') ? null : Number(old);
      if (old === value) return;
      st.rec.members[mk][col] = value;
      if (!lesson.peerMeta) lesson.peerMeta = {};
      var metaKey = st.group.no + '|' + mk + '|' + col;
      if (value == null) delete lesson.peerMeta[metaKey];
      else lesson.peerMeta[metaKey] = 'teacher';
      lastEditAt = Date.now();
      try {
        if (!lesson.peerSync) lesson.peerSync = {};
        lesson.peerSync[metaKey] = new Date().toISOString();
      } catch (e) { /* 记不上时间也不影响这次手改，只是旧的自动刷新可能盖回来，下一轮手改再顶 */ }
      logFor(st, m.name + ' · ' + (sharedProjects[col] || ('项目' + (col + 1))) + '：' + (old == null ? '未填' : numPctText(old)) + ' → ' + (value == null ? '未填' : numPctText(value)) + '（教师直接填）');
      persist(st);
      setBlockFb(st.group.no, value == null ? '已撤销这一格的加分。' : '教师直接记 ' + numPctText(value) + '（学生再提交更新的分才会覆盖它）。');
    }

    /* ---------- 顶部：本节提交汇总（只报收了多少条，不再有待确认） ---------- */
    function summaryHtml() {
      if (!peerReady) return '<span class="peer-sum-off">互评不可用：' + esc(peerReason || '需要登录教师账号并绑定班级') + '</span>';
      var total = 0;
      Object.keys(submittedByProject).forEach(function (p) { total += submittedByProject[p].total; });
      if (!total) return '<span class="peer-sum-ok">这一节还没有学生提交；学生一提交就直接计分。</span>';
      return '<b class="peer-sum-title">本节已收 ' + total + ' 条学生提交</b>' +
        '<span class="peer-sum-hint">已直接计入下面的表格；要改就直接点格子（带「师」），或关掉上面的开关再改。</span>';
    }

    /* ---------- 顶部：项目列（全班共用，只在这里改名字，各组表格共用一份） ---------- */
    function projectInputTh(i) {
      return '<th class="peer-col-th"><input class="leader-project" data-project="' + i + '" aria-label="评分项目' + (i + 1) + '" maxlength="80" placeholder="项目' + (i + 1) + '" value="' + esc(sharedProjects[i]) + '"><button type="button" class="project-remove" data-remove-project="' + i + '" aria-label="删除项目' + (i + 1) + '" title="删除本课全班此项目列">×</button></th>';
    }
    function colCardHtml() {
      return '<div class="card peer-colcard" id="leaderColCard"><div class="peer-colcard-head"><b>项目列（全班共用）</b>' +
        '<span class="peer-colcard-hint">改这里所有组一起改；空白列只占位，不发布给学生打分。</span>' +
        '<button type="button" class="btn tiny" id="leaderAddProject">新增项目列</button></div>' +
        '<div class="tablewrap peer-tablewrap peer-colwrap" style="--peer-cols:' + sharedProjects.length + '"><table class="leader-table peer-col-table"><thead>' +
        /* 前两格必须分开写（不能用 colspan=2）：colspan 会让浏览器把「序号」那一列的 55px 宽算给合并格，
           下面逐列操作条的按钮就和组表格的项目列错位 —— 2026-11-08 首次自测截图里就是这个毛病。 */
        '<tr><th class="peer-dock-corner" aria-hidden="true"></th><th class="peer-dock-lead">项目列</th>' + sharedProjects.map(function (_, i) { return projectInputTh(i); }).join('') + '</tr>' +
        '</thead></table></div></div>';
    }

    /* ---------- 顶部：提交汇总条（2026-11-10 删掉「清空本列」，只保留提交计数和说明） ---------- */
    function dockHtml() {
      return '<div class="peer-dock' + (peerReady && hasAnyActivity() ? '' : ' peer-dock-off') + '" id="leaderPeerDock">' + dockInnerHtml() + '</div>';
    }
    function hasAnyActivity() {
      return Object.keys(submittedByProject).some(function (p) { return submittedByProject[p].total > 0; });
    }
    function dockInnerHtml() {
      /* 没登录教师账号时没有「学生提交」可处理，别摆一条空表占半屏：只留一句原因 + 教师直接给分的说明 */
      if (!peerReady) {
        return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
          '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '下面每一格都可以直接点 20%–100% 给分（带「师」角标），不用等学生提交。') + '</p>';
      }
      /* 这一节还没有学生提交时，收起来别白占空间 */
      if (!hasAnyActivity()) {
        return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
          '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '点任意格子 20%–100% 可以直接给分（带「师」角标）；学生一提交也会直接计入。') + '</p>';
      }
      return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
        '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '学生提交的分已经直接计入：「组员平均」＝组员们给组长打的平均分（只在组长那行；前任组长行上的「曾任组长」是他当组长时打的），「互评」＝组长给组员的分，「师」＝你直接填的分。要改分直接点格子。') + '</p>';
    }

    /* ---------- 每一组一块 ---------- */
    /* 组表格的项目列表头：只写项目名（2026-11-10 取消逐列确认后不再挂「待确认 N」） */
    function colThHtml(st, i) {
      var name = String(sharedProjects[i] || '').trim();
      return '<th class="peer-col-name" data-th-col="' + i + '" data-gno="' + st.group.no + '">' +
        esc(name || ('项目' + (i + 1))) + '</th>';
    }
    /* 0 人的组如果因为「这一课留有历史分」而保留显示：把已经转走/移出名单的成员
       也排成分数行（不然只画一个组头，历史分还是看不见）。这些行只读——
       人已经不在组里，1–5 按钮和双击撤销都进不来（setCell 找不到人自然不动）。 */
    function goneLabel(mk) {
      var hit = null, gno = 0;
      (cls.groups || []).forEach(function (g) {
        (g.members || []).forEach(function (m) {
          if (m && m.name && key(m) === mk) { hit = m; gno = g.no; }
        });
      });
      if (hit) return esc(hit.name) + '<small>已转第 ' + gno + ' 组</small>';
      var mm = /^sid:(.+)$/.exec(mk);
      return esc(mm ? '学号 ' + mm[1] : '已移出名单');
    }
    function blockHtml(st) {
      var g = st.group, no = g.no;
      var leadEntry = null;
      st.members.forEach(function (e) { if (!leadEntry && context.isLeader && context.isLeader(g, e.m)) leadEntry = e; });
      var leadName = leadEntry ? leadEntry.m.name : '未设置';
      var gone = [];
      if (!st.members.length) {
        Object.keys(st.rec.members || {}).forEach(function (mk) {
          var vals = st.rec.members[mk];
          if (!Array.isArray(vals)) return;
          if (!vals.some(function (v) { return v != null && v !== ''; })) return;
          gone.push(mk);
        });
      }
      var rows = st.members.map(function (entry, row) {
        var m = entry.m, lead = context.isLeader && context.isLeader(g, m), mk = key(m);
        return '<tr><td>' + (row + 1) + '</td>' +
          '<td class="leader-member' + (lead ? ' group-leader-name' : '') + '" data-leader-member="' + esc(mk) + '" data-gno="' + no + '" title="双击设置或退出组长">' +
          (lead ? '<span class="leader-crown" aria-label="组长">👑</span> ' : '') + esc(m.name) +
          '<small>' + esc(m.sid || '未填写学号') + '</small></td>' +
          sharedProjects.map(function (_, col) { return '<td class="peer-td">' + cellHtml(st, mk, col) + '</td>'; }).join('') + '</tr>';
      }).join('') + gone.map(function (mk, gi) {
        return '<tr><td>' + (st.members.length + gi + 1) + '</td>' +
          '<td class="leader-member" style="color:var(--muted)" title="此人已不在这组，这一课留有他的历史评分，所以本组照常显示">' + goneLabel(mk) + '</td>' +
          sharedProjects.map(function (_, col) { return '<td class="peer-td">' + cellHtml(st, mk, col, true) + '</td>'; }).join('') + '</tr>';
      }).join('');
      var table = (st.members.length || gone.length)
        ? '<div class="tablewrap peer-tablewrap" style="--peer-cols:' + sharedProjects.length + '"><table class="leader-table"><thead><tr><th>序号</th><th>成员 / 完整学号</th>' +
          sharedProjects.map(function (_, i) { return colThHtml(st, i); }).join('') +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="note">本组暂无成员。已确定名单和分组后，成员会出现在这里。</p>';
      var fbDefault = gone.length
        ? '本组现在 0 人，但这一课留有 ' + gone.length + ' 人的历史评分（人员已转组或移出名单），所以照常显示；这些分照常计入成绩。'
        : '点 20%–100% 直接记分（带「师」角标，改完就是最终分）；双击分数撤销。学生提交的分已经直接计入。';
      return '<section class="card peer-block" id="leaderGroup-' + no + '" data-gno="' + no + '">' +
        '<div class="peer-block-head">' +
        '<div class="peer-block-title"><span class="peer-block-no">第 ' + no + ' 组</span><span class="peer-block-meta">组长 ' + esc(leadName) + ' · 共 ' + st.members.length + ' 人' + (gone.length ? ' · 留有历史评分' : '') + '</span></div>' +
        '<div class="peer-block-acts">' +
        '<button type="button" class="btn tiny" data-print-gno="' + no + '">打印本组</button>' +
        '<button type="button" class="btn tiny" data-excel-gno="' + no + '">下载 Excel</button>' +
        '<button type="button" class="btn tiny" data-full-gno="' + no + '">一键满分</button>' +
        '</div></div>' + table +
        '<div class="peer-block-foot">' +
        '<label class="field col"><span>组长 / 复核人</span><input data-signed="' + no + '" maxlength="100" value="' + esc(st.rec.signedBy || '') + '"></label>' +
        '<label class="field col"><span>备注</span><textarea data-note="' + no + '" maxlength="500" rows="2">' + esc(st.rec.note || '') + '</textarea></label>' +
        '<p class="peer-block-fb" data-fb="' + no + '">' + esc(blockFb[no] || fbDefault) + '</p>' +
        '</div></section>';
    }

    var gateOpen = !!lesson.peerGate;
    var gateText = !peerReady ? '互评 · 需要登录教师账号' : (gateOpen ? '互评：本节课已开放' : '互评：未开放');
    sheet.innerHTML = '<div class="peer-gate' + (gateOpen ? ' is-open' : '') + '" id="leaderPeerBar"><span class="peer-gate-ico" aria-hidden="true">' + (gateOpen ? '●' : '○') + '</span>' +
      '<button type="button" class="btn peer-gate-btn" id="leaderPeerToggle" aria-pressed="' + (gateOpen ? 'true' : 'false') + '"' + (peerReady ? '' : ' title="' + esc(peerReason) + '"') + '>' + esc(gateText) + '</button>' +
      '<button type="button" class="btn tiny" id="leaderPeerRefresh"' + (!peerReady ? ' disabled' : '') + '>刷新提交</button>' +
      '<span class="peer-gate-note" id="leaderPeerNote">' + (peerReady ? '开放后本组互相打分：组长给组员打分、组员给组长打分取平均；学生提交直接计分，要改直接点格子或关掉开关。' : '互评需要：' + esc(peerReason)) + '</span></div>' +
      colCardHtml() + dockHtml() +
      '<div class="peer-blocks" id="leaderBlocks">' + states.map(blockHtml).join('') + '</div>';

    /* 初次进来就把缓存里的看板铺上，别等异步回来才有分（缓存里的看板在 app.js 拉取时已计分） */
    if (peerReady && board) repaintPeer();

    /* ---------- 重画（不重建 DOM，保持滚动位置和输入焦点） ---------- */
    function repaintPeer() {
      /* 清空条的按钮 / 状态 / 是否要整条收起来，都可能变，所以整块重画（里面没有输入框，不会抢焦点） */
      var dock = sheet.querySelector('#leaderPeerDock');
      if (dock) {
        dock.className = 'peer-dock' + (peerReady && hasAnyActivity() ? '' : ' peer-dock-off');
        dock.innerHTML = dockInnerHtml();
      }
      sheet.querySelectorAll('th[data-th-col]').forEach(function (th) {
        var st = byGno[String(th.dataset.gno)];
        if (st) th.outerHTML = colThHtml(st, +th.dataset.thCol);
      });
      sheet.querySelectorAll('.peer-cell').forEach(function (el) {
        var st = byGno[String(el.dataset.gno)];
        if (st) paintCell(el, st, el.dataset.member, +el.dataset.peerCell);
      });
    }

    /* ---------- 项目列增删改（全班共用一份） ---------- */
    function rerenderKeepScroll() { preserveScroll = true; window.JFDT_LEADER_RENDER(context); }
    function addProject() {
      if (sharedProjects.length >= 30) { setMsg('最多 30 个项目列。'); return; }
      lesson.leaderProjectNames = sharedProjects.concat('');
      lesson.leaderProjectCount = lesson.leaderProjectNames.length;
      if (!lesson.leaderScores) lesson.leaderScores = {};
      cls.groups.forEach(function (g) { var r = lesson.leaderScores[String(g.no)]; if (r) r.projects = lesson.leaderProjectNames.slice(); });
      context.save(); rerenderKeepScroll();
    }
    function renameProject(index, next) {
      next = String(next == null ? '' : next).trim();
      var old = String(sharedProjects[index] || '');
      if (old === next) return;
      sharedProjects[index] = next;
      lesson.leaderProjectNames = sharedProjects.slice();
      lesson.leaderProjectCount = sharedProjects.length;
      if (!lesson.leaderScores) lesson.leaderScores = {};
      cls.groups.forEach(function (g) {
        var r = lesson.leaderScores[String(g.no)];
        if (!r) r = lesson.leaderScores[String(g.no)] = { projects: sharedProjects.slice(), members: {}, signedBy: '', note: '' };
        r.projects = sharedProjects.slice();
      });
      logClass('全班统一项目' + (index + 1) + '名称：' + (old || '空') + ' → ' + (next || '空') + '（所有小组同步）');
      context.save(); rerenderKeepScroll();
      /* 2026-11-10 用户报：「填了项目名称但学生说教室没发布任务」。
         根因：填项目名只存本地，必须再点「组长打分」开关才会发布到云端（jf_peer_gate），
         老师往往填完名就以为发出去了。改成「项目名确定即发布」：某个项目名从空变非空
         （第一次命名）且本节课还没开放组长打分时，自动把它开起来（即发布），
         学生端立刻能看到这一节要打什么。改已有名字不重复触发。 */
      if (next && !old && context.peer && typeof context.peer.setGate === 'function' &&
          context.peer.ready && context.peer.ready(cls) && !lesson.peerGate) {
        context.peer.setGate(cls, lesson, true).then(function () {
          peerMsg = '已自动开放本节课的互评（刚填了项目名「' + next + '」，学生现在就能打了）。';
          rerenderKeepScroll();
        }, function (err) {
          /* 自动发布失败不打断老师填名，只提示一句，让他手动点开关 */
          peerMsg = '项目名已存，但自动发布没成功：' + ((err && err.message) || '网络问题') + '。请点上面的「互评」开关手动发布。';
        });
      }
    }
    function removeProject(index) {
      if (sharedProjects.length <= 1) { setMsg('至少保留 1 列。'); return; }
      var records = lesson.leaderScores || {};
      var hasData = String(sharedProjects[index] || '').trim() || Object.keys(records).some(function (k) {
        return Object.keys(records[k].members || {}).some(function (mk) { var v = records[k].members[mk]; return v && v[index] !== null && v[index] !== undefined; });
      });
      if (hasData && !window.confirm('删除此项目会同步删除本课所有组这一列的名称和分数，并重新计算完成率。确定删除？')) return;
      sharedProjects.splice(index, 1);
      lesson.leaderProjectNames = sharedProjects.slice();
      lesson.leaderProjectCount = sharedProjects.length;
      Object.keys(records).forEach(function (k) {
        var r = records[k];
        r.projects = sharedProjects.slice();
        Object.keys(r.members || {}).forEach(function (mk) { r.members[mk].splice(index, 1); });
      });
      /* peerMeta 的键是「组号|成员|列号」，删掉一列后后面的列号要跟着前移，否则「互评 / 平均 / 师」角标会错位 */
      if (lesson.peerMeta) {
        var nextMeta = {};
        Object.keys(lesson.peerMeta).forEach(function (k) {
          var parts = k.split('|');
          if (parts.length !== 3) return;
          var c = Number(parts[2]);
          if (!isFinite(c) || c === index) return;
          nextMeta[parts[0] + '|' + parts[1] + '|' + (c > index ? c - 1 : c)] = lesson.peerMeta[k];
        });
        lesson.peerMeta = nextMeta;
      }
      logClass('删除全班项目列' + (index + 1));
      context.save(); rerenderKeepScroll();
    }

    /* ---------- 打印 / 导出 / 一键满分（按组） ---------- */
    function openPrint(exportExcel, gno) {
      var st = byGno[String(gno)];
      exportMode = !!exportExcel;
      printSelection = { cls: cls, lesson: lesson, group: st ? st.group : groups[0] };
      printDialog.returnValue = '';
      fillPageRanges(true);
      printDialog.querySelector('h2').textContent = exportExcel ? '下载打印版Excel' : '打印组长评分表';
      printDialog.querySelector('button[value="ok"]').textContent = exportExcel ? '下载Excel' : '开始打印';
      if (printDialog.showModal) printDialog.showModal(); else printDialog.setAttribute('open', '');
    }
    function openFullMarks(gno) {
      var st = byGno[String(gno)];
      var named = sharedProjects.map(function (p, i) { return String(p).trim() ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!named.length) { setBlockFb(gno, '请先在页顶填项目名称；每个项目满分 100%。'); return; }
      var dlg = document.createElement('dialog');
      dlg.id = 'dlgLeaderFullMarks';
      dlg.innerHTML = '<form method="dialog"><h2>一键全员满分</h2><p>每人每个已命名项目填为 100%，共 ' + named.length + ' 项；空白预留列不变。已有较低分会被改为 100%，可在操作日志按组撤销。</p>' +
        '<label class="field col">范围<select id="leaderFullScope"><option value="current">只填第 ' + st.group.no + ' 组</option><option value="all">本课全部小组</option></select></label>' +
        '<div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">确认填满 100%</button></div></form>';
      document.body.appendChild(dlg);
      dlg.addEventListener('close', function () {
        if (dlg.returnValue === 'ok') {
          var target = dlg.querySelector('select').value === 'all' ? cls.groups : [st.group];
          context.fullMarks(lesson, target, named, sharedProjects);
          rerenderKeepScroll();
        }
        dlg.remove();
      });
      dlg.showModal();
    }

    /* ---------- 交互：全部用事件委托，块再多也不用逐个绑定 ---------- */
    sheet.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var pick = t.closest('.peer-pick');
      if (pick) {
        var cell = pick.closest('.peer-cell');
        var st = cell && byGno[String(cell.dataset.gno)];
        if (st && cell) {
          var col = +cell.dataset.peerCell, mk = cell.dataset.member;
          setCell(st, mk, col, Number(pick.dataset.score));
          paintCell(cell, st, mk, col);
        }
        return;
      }
      var add = t.closest('#leaderAddProject');
      if (add) { addProject(); return; }
      var del = t.closest('[data-remove-project]');
      if (del) { removeProject(+del.dataset.removeProject); return; }
      var pr = t.closest('[data-print-gno]');
      if (pr) { openPrint(false, +pr.dataset.printGno); return; }
      var ex = t.closest('[data-excel-gno]');
      if (ex) { openPrint(true, +ex.dataset.excelGno); return; }
      var full = t.closest('[data-full-gno]');
      if (full) { openFullMarks(+full.dataset.fullGno); return; }
    });
    sheet.addEventListener('dblclick', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var member = t.closest('[data-leader-member]');
      if (member) {
        var st = byGno[String(member.dataset.gno)];
        var hit = st && st.members.find(function (entry) { return key(entry.m) === member.dataset.leaderMember; });
        if (hit && context.toggleLeader) { e.preventDefault(); context.toggleLeader(cls, st.group, hit.m); }
        return;
      }
      var cell = t.closest('.peer-cell.is-set');
      if (!cell) return;
      var s2 = byGno[String(cell.dataset.gno)];
      if (!s2) return;
      e.preventDefault();
      var col2 = +cell.dataset.peerCell, mk2 = cell.dataset.member;
      setCell(s2, mk2, col2, null);
      paintCell(cell, s2, mk2, col2);
    });
    sheet.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== 'Delete' && e.key !== 'Backspace') return;
      var cell = e.target.closest && e.target.closest('.peer-cell.is-set');
      if (!cell) return;
      var st = byGno[String(cell.dataset.gno)];
      if (!st) return;
      e.preventDefault();
      var col = +cell.dataset.peerCell, mk = cell.dataset.member;
      setCell(st, mk, col, null);
      paintCell(cell, st, mk, col);
    });
    sheet.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.matches) return;
      if (t.matches('[data-project]')) { renameProject(+t.dataset.project, t.value); return; }
      if (t.matches('[data-signed]')) { var st1 = byGno[String(t.dataset.signed)]; if (st1) { st1.rec.signedBy = t.value.trim(); persist(st1); } return; }
      if (t.matches('[data-note]')) { var st2 = byGno[String(t.dataset.note)]; if (st2) { st2.rec.note = t.value; persist(st2); } }
    });

    /* ---------- 本节课「互评」开关 + 刷新提交 ---------- */
    var bar = sheet.querySelector('#leaderPeerBar'), toggle = sheet.querySelector('#leaderPeerToggle'), refresh = sheet.querySelector('#leaderPeerRefresh');
    function setGateUI(open) {
      lesson.peerGate = !!open;
      bar.classList.toggle('is-open', !!open);
      bar.querySelector('.peer-gate-ico').textContent = open ? '●' : '○';
      toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      toggle.textContent = open ? '互评：本节课已开放' : '互评：未开放';
    }
    if (peerReady) {
      toggle.onclick = function () {
        var going = !lesson.peerGate;
        toggle.disabled = true;
        toggle.textContent = going ? '正在开放…' : '正在关闭…';
        peer.setGate(cls, lesson, going).then(function () {
          peerMsg = going ? '已开放本节课互评（组长给组员、组员给组长打分取平均，只能打这一节）。' : '已关闭：学生现在只能看，不能改分。';
          rerenderKeepScroll();
        }, function (err) {
          toggle.disabled = false; setGateUI(lesson.peerGate);
          setMsg((err && err.message) || '操作失败，检查网络后重试。');
        });
      };
      refresh.onclick = function () {
        refresh.disabled = true;
        peer.fetchBoard(cls, lesson).then(function (b) {
          if (!document.body.contains(sheet)) return;
          indexBoard(b); setGateUI(!!b.open); repaintPeer(); refresh.disabled = false;
          setMsg('已刷新：' + (((b && b.cells) || []).length) + ' 条提交（已直接计分）。');
        }, function (err) { refresh.disabled = false; setMsg((err && err.message) || '刷新失败。'); });
      };
      /* 自动刷新（2026-11-10）：本节课开着「组长打分」时每 10 秒拉一次看板。
         学生提交直接计分，所以这一拉就是「分自己出现」；只在页面可见时跑，切走就停。
         刚点过格子（3 秒内）先不重画，免得把老师正要点的按钮抽掉（数据已经落盘，下一轮再画）。 */
      poll.alive = function () {
        return peerReady && !!lesson.peerGate && document.body.contains(sheet) && !root.hidden;
      };
      poll.run = function () {
        return peer.fetchBoard(cls, lesson).then(function (b) {
          if (!poll.alive()) return;
          if (Date.now() - lastEditAt < 3000) return;
          /* 老师正在填「组长 / 复核人」或「备注」时别重画：值虽然每次输入都存过（不会丢），
             但重画会把输入框抽走，光标和正在打的字一下就没了。这一轮跳过，下一轮再画。 */
          var act = document.activeElement;
          if (act && sheet.contains(act) && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName)) return;
          indexBoard(b); setGateUI(!!b.open); repaintPeer();
        }, function () { /* 网络抖一下，下一轮再来 */ });
      };
      pollSchedule();
      peer.fetchBoard(cls, lesson).then(function (b) {
        if (!document.body.contains(sheet)) return;
        indexBoard(b); setGateUI(!!b.open); repaintPeer();
      }, function () {});
    } else {
      refresh.disabled = true;
      toggle.title = peerReason;
      toggle.classList.add('is-blocked');
      pollStop();
    }

    /* 重画之后把滚动位置放回去（只有自己触发的重画才带 keepY） */
    if (keepY != null) requestAnimationFrame(function () { window.scrollTo(0, keepY); });
  };
})();
