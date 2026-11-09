/* 组长评分表：每课、每组十个自定义项目，个人每项0–5分，独立于课堂小组分。 */
(function () {
  'use strict';
  var printing = false;
  /* 自己触发的重画（加列/改项目名/一键满分/开关）要不要保住滚动位置：2026-11-08 全组展开后一屏很长，
     重画回顶部等于把老师滑到的位置弄丢，所以这些动作自己把 preserveScroll 置 true 再调渲染。 */
  var preserveScroll = false;
  /* 开关 / 确认操作后的提示句：重绘一次表格还要把它显示出来，所以放在渲染函数外面 */
  var peerMsg = '';
  /* 上次画的是哪个班哪节课：换课次时把上节课的提示句清掉（2026-11-08 全组展开后提示条更显眼了） */
  var lastLessonTag = '';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function key(member) { return member.sid ? 'sid:'+member.sid : 'id:'+member.id; }
  function csvCell(value) { var s=String(value == null ? '' : value); if (/^[=+\-@]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  window.addEventListener('afterprint',function () { if(printing) { document.body.classList.remove('print-rank','print-leader'); printing=false; } });
  function printableGroup(cls,lesson,g){var r=lesson.leaderScores&&lesson.leaderScores[String(g.no)]||{projects:Array(4).fill(''),members:{},signedBy:'',note:''};var projects=window.JFDT_ASSESSMENT.projectNames(lesson),members=(g.members||[]).filter(function(m){return m.name;}),leadKey=g.leaderKey&&members.some(function(m){return key(m)===g.leaderKey;})?g.leaderKey:(members[0]?key(members[0]):'');if(leadKey){var li=members.findIndex(function(m){return key(m)===leadKey;});if(li>0)members=[members[li]].concat(members.slice(0,li),members.slice(li+1));}return '<section class="leader-slip"><h2>组长课堂评分表</h2><p class="slip-meta">'+esc(cls.name)+' · 第'+g.no+'组 · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><p class="slip-rule">每项0–5分；空白项目由组长手写，教师复核。</p><table class="leader-table"><colgroup><col style="width:6%"><col style="width:22%">'+projects.map(function(){return '<col style="width:'+(72/projects.length)+'%">';}).join('')+'</colgroup><thead><tr><th>序号</th><th>成员 / 学号</th>'+projects.map(function(v){return '<th>'+esc(v)+'</th>';}).join('')+'</tr></thead><tbody>'+members.map(function(m,i){var scores=r.members[key(m)]||Array(projects.length).fill(null),lead=key(m)===leadKey;return '<tr><td>'+(i+1)+'</td><td class="slip-member">'+(lead?'👑 ':'')+esc(m.name)+'<small>'+esc(m.sid||'')+'</small></td>'+projects.map(function(_,j){return '<td>'+(scores[j]==null||scores[j]===0?'':scores[j])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table><p class="slip-sign">组长：'+esc(r.signedBy||'________________')+'</p><p class="slip-note">备注：'+esc(r.note||'')+'</p></section>';}
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
  /* ==================== 组内个人评分 · 全组展开版（2026-11-08） ====================
     用户原话：「成员给组长打分 组长给成员打分 这个还不够清晰 尤其教师给学生打分（最高权限，
     就是防止有的学生懒得打分）确认打分环节不清晰 上面写了有人待确认 也没说哪个组 要不就全组
     展开 不要选卡了 我直接下滑全看清然后点击确认 确认按钮和否按钮都在该表格项目列上面或者下面」

     按这 6 条重写这一屏（不再有「选一个组」的下拉）：
     ① 所有组的表格从上到下连续铺开，一屏一屏往下滑，一次看全；
     ② 每组独立一块，块头固定写「第 N 组 · 组长 某某 · 共 M 人」，不用再猜是哪一组；
     ③ 待确认说清到「组 + 项目 + 条数」：页顶汇总条逐条列「第 2 组·「协作」3 条」，
        点组号直接滚到那一组；每组块头也写本组待确认，具体格子加黄圈；
     ④ 确认 / 否决不挤在角落：做成一条按项目列排开的「逐列确认」条，一列一格，
        两颗按钮就贴在该项目列正下方（表格项目列上面），滑到哪都粘在页顶；
     ⑤ 教师可以直接点任意格子的 1~5 分，这种分带金色描边 +「师」角标，
        与「学生提交后教师确认」的互评 / 平均分分开（教师即确认人，直接计分）；
     ⑥ 不弹窗、不分页、不选项卡，一页滑到底逐列点确认。

     为什么「确认」只做一条全班共用的：服务端 jf_peer_confirm 是按【项目列】确认的，
     一次确认 / 否决会影响本班所有组的同一列（见 supabase/2026-11-04-组内互评打分.sql）。
     所以按钮放在「全页唯一一条逐列确认条」里，并写明「对本班所有组生效」，
     不在每个组里重复摆一遍，免得老师以为只作用在某一个组。 */
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
      '<p class="note">所有小组都在这一页往下连续排开，不用再选组。学生（组员给组长 / 组长给组员）提交后，页顶「教师逐列确认」会写明是哪一组、哪个项目、几条待确认——确认后才计分，否决会清掉这一列本轮提交。老师也可以直接点任意格子的 1–5 分（带「师」角标），这种分不用等学生提交、也不用再确认。</p>' +
      '<div class="card lesson-bar"><label class="field"><span>班级</span><select id="leaderClassSel">' + pool.map(function (c) { return '<option value="' + esc(c.id) + '"' + (cls && c.id === cls.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>课次</span><select id="leaderLessonSel"' + (!lessons.length ? ' disabled' : '') + '>' + lessons.map(function (l) { return '<option value="' + esc(l.id) + '"' + (lesson && l.id === lesson.id ? ' selected' : '') + '>第' + l.seq + '次 · ' + esc(l.date) + '</option>'; }).join('') + '</select></label></div><div id="leaderSheet"></div>';
    root.querySelector('#leaderClassSel').onchange = function () { context.select(this.value, null); };
    var manage = document.createElement('button');
    manage.className = 'btn'; manage.id = 'leaderManageGroups'; manage.textContent = '名单与分组';
    manage.onclick = function () { context.openGroups(); };
    root.querySelector('.lesson-bar').appendChild(manage);
    root.querySelector('#leaderLessonSel').onchange = function () { context.select(cls.id, this.value); };

    var sheet = root.querySelector('#leaderSheet');
    if (!cls || !lesson) {
      sheet.innerHTML = '<div class="card empty-hint">请先在“上课记分”新开一课，再填写个人评分。<p><button class="btn" id="leaderGoScore">前往上课记分</button></p></div>';
      sheet.querySelector('button').onclick = context.openScore;
      return;
    }
    /* 用户要「全组展开」：有组号的组一个不漏地铺出来（没排人的组也会留一块，写着「本组暂无成员」，
       这样组长一看就知道哪一组还没排人；以前是下拉里选到才发现） */
    var groups = (cls.groups || []).filter(function (g) { return !!g; });
    if (!groups.length) {
      sheet.innerHTML = '<div class="card empty-hint">该班还没有小组，请先导入名单或安排分组。<p><button class="btn" id="leaderGoGroups">去名单与分组</button></p></div>';
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
      /* 空组不给它落一条空记录到 leaderScores 里（会白占存储、登分册里也多出空组） */
      return {
        group: g,
        rec: members.length ? recordOf(g) : { projects: sharedProjects.slice(), members: {}, signedBy: '', note: '' },
        members: members
      };
    });
    var byGno = {};
    states.forEach(function (st) { byGno[String(st.group.no)] = st; });
    var blockFb = {};

    var peer = context.peer || null;
    var peerReady = !!(peer && peer.ready && peer.ready(cls));
    var peerReason = peer && peer.reason ? String(peer.reason(cls) || '') : '';
    var board = null;
    var pendingCell = Object.create(null);      // 「组号|项目|成员key」 → 学生的提交条数（还没确认的）
    var pendingByProject = Object.create(null); // 项目 → { total, groups:{组号:条数} }（只算还没确认的）
    var submittedByProject = Object.create(null); // 项目 → 全部提交条数（含已确认），确认条上要如实写「共几条」
    var statusOfProject = Object.create(null);  // 项目 → confirmed / rejected / pending

    function indexBoard(b) {
      board = b || null;
      statusOfProject = Object.create(null);
      ((b && b.confirms) || []).forEach(function (c) { if (c && c.project) statusOfProject[c.project] = c.status; });
      reindexPending();
    }
    /* 只统计「还没确认」的提交：确认 / 否决之后这一列不再算待确认，避免老师看到清不掉的黄圈 */
    function reindexPending() {
      pendingCell = Object.create(null);
      pendingByProject = Object.create(null);
      submittedByProject = Object.create(null);
      ((board && board.cells) || []).forEach(function (c) {
        if (!c || !c.project || !c.target) return;
        var all = submittedByProject[c.project] || (submittedByProject[c.project] = { total: 0, groups: {} });
        all.total++;
        all.groups[c.gno] = (all.groups[c.gno] || 0) + 1;
        if ((statusOfProject[c.project] || 'pending') !== 'pending') return;
        var cellKey = c.gno + '|' + c.project + '|' + c.target;
        pendingCell[cellKey] = (pendingCell[cellKey] || 0) + 1;
        var info = pendingByProject[c.project] || (pendingByProject[c.project] = { total: 0, groups: {} });
        info.total++;
        info.groups[c.gno] = (info.groups[c.gno] || 0) + 1;
      });
    }
    if (peerReady) indexBoard(peer.cached ? peer.cached(lesson) : null);

    /* ---------- 小工具 ---------- */
    function numText(v) { var n = Math.round((Number(v) + Number.EPSILON) * 10) / 10; return n % 1 === 0 ? String(n) : n.toFixed(1); }
    /* 4.5 这种平均分按最近的整数取色调，别掉回默认灰色 */
    function toneOf(v) { return Math.max(1, Math.min(5, Math.round(Number(v) || 0))); }
    function memberOf(st, mk) { var hit = st.members.find(function (e) { return key(e.m) === mk; }); return hit ? hit.m : null; }
    function cellValue(st, mk, col) { var v = (st.rec.members[mk] || [])[col]; return v == null || v === '' ? null : Number(v); }
    function cellMeta(st, mk, col) { return (lesson.peerMeta && lesson.peerMeta[st.group.no + '|' + mk + '|' + col]) || ''; }
    function pendCount(st, mk, col) {
      var name = String(sharedProjects[col] || '').trim();
      return name ? (pendingCell[st.group.no + '|' + name + '|' + mk] || 0) : 0;
    }
    function persist(st) { if (!lesson.leaderScores) lesson.leaderScores = {}; lesson.leaderScores[String(st.group.no)] = st.rec; context.save(); }
    function logFor(st, detail) { if (context.log) context.log(cls.name + ' · 第' + lesson.seq + '次课 · 第' + st.group.no + '组 · ' + detail); }
    function logClass(detail) { if (context.log) context.log(cls.name + ' · 第' + lesson.seq + '次课 · ' + detail); }
    function setMsg(text) { peerMsg = text || ''; var el = sheet.querySelector('#leaderPeerMsg'); if (el) el.textContent = peerMsg; }
    function setBlockFb(gno, text) { blockFb[gno] = text; var el = sheet.querySelector('[data-fb="' + gno + '"]'); if (el) el.textContent = text; }

    /* 「互评」「平均」「师」三种来源角标：师 = 教师直接填，不经学生提交 */
    function srcHtml(meta) {
      if (!meta) return '';
      var text = meta === 'avg' ? '平均' : (meta === 'teacher' ? '师' : (meta === 'wire' ? '接' : '互评'));
      return '<span class="peer-src peer-src-' + meta + '">' + text + '</span>';
    }
    function picksHtml(st, mk, col) {
      var m = memberOf(st, mk);
      var label = esc(m ? m.name : '') + ' · ' + esc(sharedProjects[col] || ('项目' + (col + 1)));
      return [1, 2, 3, 4, 5].map(function (s) {
        return '<button type="button" class="peer-pick p' + s + '" data-score="' + s + '" title="给 ' + s + ' 分" aria-label="' + label + ' 给 ' + s + ' 分">' + s + '</button>';
      }).join('');
    }
    function cellInner(st, mk, col) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col), pend = pendCount(st, mk, col);
      return (v == null ? picksHtml(st, mk, col) : '<span class="peer-score">' + numText(v) + '</span>' + srcHtml(meta)) +
        /* 空着的格子不点小黄点（会压在第 5 颗按钮上，看着像按钮状态）；空格的待确认靠黄框 + 列表头「待确认 N」 */
        (pend && v != null ? '<span class="peer-pend-dot" aria-hidden="true"></span>' : '');
    }
    function cellTitle(st, mk, col) {
      var v = cellValue(st, mk, col), pend = pendCount(st, mk, col);
      if (pend) return '学生已提交 ' + pend + ' 条，等你到页顶「教师逐列确认」点确认';
      return v != null ? '双击撤销这一格的加分' : '教师可直接给 1–5 分（不用等学生提交）';
    }
    function cellHtml(st, mk, col) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col), pend = pendCount(st, mk, col);
      var m = memberOf(st, mk);
      var cls = 'peer-cell' + (v != null ? ' is-set score-' + toneOf(v) : '') + (meta === 'teacher' ? ' is-teacher' : '') + (pend ? ' is-pending' : '');
      return '<div class="' + cls + '" data-gno="' + st.group.no + '" data-peer-cell="' + col + '" data-member="' + esc(mk) + '"' +
        (v != null ? ' data-score="' + v + '" role="button" tabindex="0"' : ' role="group"') +
        ' title="' + esc(cellTitle(st, mk, col)) + '" aria-label="' + esc(m ? m.name : '') + ' ' + esc(String(sharedProjects[col] || '').trim() || ('项目' + (col + 1))) + '">' +
        cellInner(st, mk, col) + '</div>';
    }
    function paintCell(el, st, mk, col) {
      var v = cellValue(st, mk, col), meta = cellMeta(st, mk, col), pend = pendCount(st, mk, col);
      el.classList.toggle('is-set', v != null);
      el.classList.toggle('is-teacher', meta === 'teacher');
      el.classList.toggle('is-pending', pend > 0);
      for (var i = 1; i <= 5; i++) el.classList.toggle('score-' + i, v != null && toneOf(v) === i);
      if (v == null) { el.removeAttribute('data-score'); el.setAttribute('role', 'group'); el.removeAttribute('tabindex'); }
      else { el.setAttribute('data-score', v); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); }
      el.title = cellTitle(st, mk, col);
      el.innerHTML = cellInner(st, mk, col);
    }
    /* 老师点 1–5 / 双击撤销：都算「教师直接填」，打上「师」标记 —— 教师即确认人，不用再走学生确认 */
    function setCell(st, mk, col, value) {
      var m = memberOf(st, mk);
      if (!m) return;
      if (!st.rec.members[mk]) st.rec.members[mk] = [];
      var old = st.rec.members[mk][col];
      old = (old == null || old === '') ? null : Number(old);
      if (old === value) return;
      st.rec.members[mk][col] = value;
      if (!lesson.peerMeta) lesson.peerMeta = {};
      var metaKey = st.group.no + '|' + mk + '|' + col;
      if (value == null) delete lesson.peerMeta[metaKey];
      else lesson.peerMeta[metaKey] = 'teacher';
      logFor(st, m.name + ' · ' + (sharedProjects[col] || ('项目' + (col + 1))) + '：' + (old == null ? '未填' : numText(old)) + ' → ' + (value == null ? '未填' : numText(value)) + '（教师直接填）');
      persist(st);
      setBlockFb(st.group.no, value == null ? '已撤销这一格的加分。' : '教师直接记 ' + value + ' 分（不用学生提交，已计入）。');
    }

    /* ---------- 顶部：待确认汇总 ---------- */
    function summaryHtml() {
      if (!peerReady) return '<span class="peer-sum-off">互评确认不可用：' + esc(peerReason || '需要登录教师账号并绑定班级') + '</span>';
      /* 按组号排：老师是从上往下看组的，汇总也按组号从上往下写，别一会儿第 2 组一会儿第 5 组来回跳 */
      var rows = [];
      Object.keys(pendingByProject).forEach(function (p) {
        var info = pendingByProject[p];
        Object.keys(info.groups).forEach(function (no) {
          rows.push({ gno: Number(no), project: p, n: info.groups[no] });
        });
      });
      rows.sort(function (a, b) { return a.gno - b.gno || String(a.project).localeCompare(String(b.project), 'zh'); });
      if (!rows.length) return '<span class="peer-sum-ok">这一节没有待确认的提交。</span>';
      var total = 0;
      var items = rows.map(function (r) {
        total += r.n;
        return '<button type="button" class="peer-jump" data-jump-gno="' + r.gno + '" title="跳到第 ' + r.gno + ' 组">第 ' + r.gno + ' 组</button>·「' + esc(r.project) + '」' + r.n + ' 条';
      });
      return '<b class="peer-sum-title">待确认 ' + total + ' 条：</b><span class="peer-sum-items">' +
        items.join('<span class="peer-sum-sep">；</span>') + '</span><span class="peer-sum-hint">点组号跳到那一组</span>';
    }

    /* ---------- 顶部：项目列（全班共用，只在这里改名字，各组表格共用一份） ---------- */
    function projectInputTh(i) {
      return '<th class="peer-col-th"><input class="leader-project" data-project="' + i + '" aria-label="评分项目' + (i + 1) + '" maxlength="80" placeholder="项目' + (i + 1) + '" value="' + esc(sharedProjects[i]) + '"><button type="button" class="project-remove" data-remove-project="' + i + '" aria-label="删除项目' + (i + 1) + '" title="删除本课全班此项目列">×</button></th>';
    }
    function colCardHtml() {
      return '<div class="card peer-colcard" id="leaderColCard"><div class="peer-colcard-head"><b>项目列（全班共用）</b>' +
        '<span class="peer-colcard-hint">改这里所有组一起改；空白列只占位，不进确认条。</span>' +
        '<button type="button" class="btn tiny" id="leaderAddProject">新增项目列</button></div>' +
        '<div class="tablewrap peer-tablewrap peer-colwrap" style="--peer-cols:' + sharedProjects.length + '"><table class="leader-table peer-col-table"><thead>' +
        /* 前两格必须分开写（不能用 colspan=2）：colspan 会让浏览器把「序号」那一列的 55px 宽算给合并格，
           下面逐列确认条的按钮就和组表格的项目列错位 —— 2026-11-08 首次自测截图里就是这个毛病。 */
        '<tr><th class="peer-dock-corner" aria-hidden="true"></th><th class="peer-dock-lead">项目列</th>' + sharedProjects.map(function (_, i) { return projectInputTh(i); }).join('') + '</tr>' +
        '</thead></table></div></div>';
    }

    /* ---------- 顶部：逐列确认条（一列一格，两颗按钮贴在该项目列正下方） ---------- */
    function dockCellHtml(i) {
      var name = String(sharedProjects[i] || '').trim();
      if (!name) return '<span class="peer-cmd-none">先填项目名</span>';
      var stt = statusOfProject[name] || 'pending';
      var pend = pendingByProject[name] || { total: 0, groups: {} };
      var all = submittedByProject[name] || { total: 0, groups: {} };
      var who = Object.keys(pend.groups).sort(function (a, b) { return a - b; }).map(function (no) { return '第' + no + '组 ' + pend.groups[no] + ' 条'; }).join('、');
      var label = stt === 'confirmed' ? '已确认计分' : stt === 'rejected' ? '已否决 · 本轮作废' : '待确认';
      /* 确认后 board.cells 还在（服务端保留原始提交），所以条数要照实写「共几条」，
         不然老师会以为刚才那 4 条提交被吞了 */
      var countText = stt === 'confirmed'
        ? (all.total ? '已计入 · 共 ' + all.total + ' 条提交' : '已确认计分')
        : stt === 'rejected'
          ? '本轮提交已清空，等组长重新提交'
          : (pend.total ? who + '（共 ' + pend.total + ' 条）' : '还没有学生提交');
      return '<div class="peer-cmd is-' + stt + '">' +
        '<span class="peer-status is-' + stt + '">' + label + '</span>' +
        '<span class="peer-cmd-count">' + countText + '</span>' +
        '<span class="peer-cmd-btns"><button type="button" class="btn tiny peer-ok" data-peer-ok="' + esc(name) + '"' + ((!all.total || stt === 'rejected') ? ' disabled' : '') + '>确认加分</button>' +
        '<button type="button" class="btn tiny peer-no" data-peer-no="' + esc(name) + '"' + ((!all.total && stt !== 'confirmed') ? ' disabled' : '') + '>否决清除</button></span></div>';
    }
    function dockHtml() {
      return '<div class="peer-dock' + (peerReady && hasAnySubmission() ? '' : ' peer-dock-off') + '" id="leaderPeerDock">' + dockInnerHtml() + '</div>';
    }
    function hasAnySubmission() {
      return Object.keys(submittedByProject).some(function (p) { return submittedByProject[p].total > 0; });
    }
    function dockInnerHtml() {
      /* 没登录教师账号时没有「学生提交」可确认，别摆一条空表占半屏：只留一句原因 + 教师直接给分的说明 */
      if (!peerReady) {
        return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
          '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '下面每一格都可以直接点 1–5 给分（带「师」角标），不用等学生提交。') + '</p>';
      }
      /* 这一节一条学生提交都还没有时，确认条上没有可点的东西（按钮全灰），收起来别白占 80px */
      if (!hasAnySubmission()) {
        return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
          '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '还没有学生提交。学生提交后，这里会出现每个项目列的「确认加分 / 否决清除」；老师也可以直接点格子给分。') + '</p>';
      }
      var cmdRow = '<tr class="peer-cmd-row"><th class="peer-dock-corner" aria-hidden="true"></th><th class="peer-dock-lead"><b>教师逐列确认</b><small>对本班所有组生效</small></th>' +
        sharedProjects.map(function (_, i) { return '<td class="peer-cmd-cell" data-dock-col="' + i + '">' + dockCellHtml(i) + '</td>'; }).join('') + '</tr>';
      return '<div class="peer-summary" id="leaderPeerSummary">' + summaryHtml() + '</div>' +
        '<div class="tablewrap peer-tablewrap peer-dock-wrap" style="--peer-cols:' + sharedProjects.length + '"><table class="leader-table peer-dock-table"><thead>' + cmdRow + '</thead></table></div>' +
        '<p class="peer-dock-msg" id="leaderPeerMsg" role="status">' + esc(peerMsg || '黄圈＝学生已提交、等你确认；「师」＝你直接填的分，已经计入；否决要连点两次才生效。') + '</p>';
    }

    /* ---------- 每一组一块 ---------- */
    function blockPendHtml(st) {
      if (!peerReady) return '<span class="peer-block-pend-none">互评未启用</span>';
      var items = [];
      Object.keys(pendingByProject).forEach(function (p) {
        var n = pendingByProject[p].groups[st.group.no];
        if (n) items.push('「' + p + '」' + n + ' 条');
      });
      if (!items.length) return '<span class="peer-block-pend-none">本组没有待确认</span>';
      return '<span class="peer-block-pend-on">待确认：' + esc(items.join('、')) + '</span>';
    }
    /* 组表格的项目列表头：本项目本组有几条待确认就写在这里，滑到哪一组都知道该看哪一列 */
    function colThHtml(st, i) {
      var name = String(sharedProjects[i] || '').trim();
      var n = 0;
      if (name && peerReady && (statusOfProject[name] || 'pending') === 'pending') {
        var info = pendingByProject[name];
        n = (info && info.groups[st.group.no]) || 0;
      }
      return '<th class="peer-col-name' + (n ? ' is-pending' : '') + '" data-th-col="' + i + '" data-gno="' + st.group.no + '">' +
        esc(name || ('项目' + (i + 1))) + (n ? '<small class="peer-th-pend">待确认 ' + n + '</small>' : '') + '</th>';
    }
    function blockHtml(st) {
      var g = st.group, no = g.no;
      var leadEntry = null;
      st.members.forEach(function (e) { if (!leadEntry && context.isLeader && context.isLeader(g, e.m)) leadEntry = e; });
      var leadName = leadEntry ? leadEntry.m.name : '未设置';
      var rows = st.members.map(function (entry, row) {
        var m = entry.m, lead = context.isLeader && context.isLeader(g, m), mk = key(m);
        return '<tr><td>' + (row + 1) + '</td>' +
          '<td class="leader-member' + (lead ? ' group-leader-name' : '') + '" data-leader-member="' + esc(mk) + '" data-gno="' + no + '" title="双击设置或退出组长">' +
          (lead ? '<span class="leader-crown" aria-label="组长">👑</span> ' : '') + esc(m.name) +
          '<small>' + esc(m.sid || '未填写学号') + '</small></td>' +
          sharedProjects.map(function (_, col) { return '<td class="peer-td">' + cellHtml(st, mk, col) + '</td>'; }).join('') + '</tr>';
      }).join('');
      var table = st.members.length
        ? '<div class="tablewrap peer-tablewrap" style="--peer-cols:' + sharedProjects.length + '"><table class="leader-table"><thead><tr><th>序号</th><th>成员 / 完整学号</th>' +
          sharedProjects.map(function (_, i) { return colThHtml(st, i); }).join('') +
          '</tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="note">本组暂无成员。已确定名单和分组后，成员会出现在这里。</p>';
      return '<section class="card peer-block" id="leaderGroup-' + no + '" data-gno="' + no + '">' +
        '<div class="peer-block-head">' +
        '<div class="peer-block-title"><span class="peer-block-no">第 ' + no + ' 组</span><span class="peer-block-meta">组长 ' + esc(leadName) + ' · 共 ' + st.members.length + ' 人</span></div>' +
        '<div class="peer-block-pend" data-block-pend="' + no + '">' + blockPendHtml(st) + '</div>' +
        '<div class="peer-block-acts">' +
        '<button type="button" class="btn tiny" data-print-gno="' + no + '">打印本组</button>' +
        '<button type="button" class="btn tiny" data-excel-gno="' + no + '">下载 Excel</button>' +
        '<button type="button" class="btn tiny" data-full-gno="' + no + '">一键满分</button>' +
        '</div></div>' + table +
        '<div class="peer-block-foot">' +
        '<label class="field col"><span>组长 / 复核人</span><input data-signed="' + no + '" maxlength="100" value="' + esc(st.rec.signedBy || '') + '"></label>' +
        '<label class="field col"><span>备注</span><textarea data-note="' + no + '" maxlength="500" rows="2">' + esc(st.rec.note || '') + '</textarea></label>' +
        '<p class="peer-block-fb" data-fb="' + no + '">' + esc(blockFb[no] || '点 1–5 直接记分（教师直接填，不用等学生、也不用再确认）；双击分数撤销。') + '</p>' +
        '</div></section>';
    }

    var gateOpen = !!lesson.peerGate;
    var gateText = !peerReady ? '组长打分 · 需要登录教师账号' : (gateOpen ? '组长打分：本节课已开放' : '组长打分：未开放');
    sheet.innerHTML = '<div class="peer-gate' + (gateOpen ? ' is-open' : '') + '" id="leaderPeerBar"><span class="peer-gate-ico" aria-hidden="true">' + (gateOpen ? '●' : '○') + '</span>' +
      '<button type="button" class="btn peer-gate-btn" id="leaderPeerToggle" aria-pressed="' + (gateOpen ? 'true' : 'false') + '"' + (peerReady ? '' : ' title="' + esc(peerReason) + '"') + '>' + esc(gateText) + '</button>' +
      '<button type="button" class="btn tiny" id="leaderPeerRefresh"' + (!peerReady ? ' disabled' : '') + '>刷新提交</button>' +
      '<span class="peer-gate-note" id="leaderPeerNote">' + (peerReady ? '开放后组长只能打本节课；组员给组长打分取平均；每一列教师确认后才计入成绩。' : '互评需要：' + esc(peerReason)) + '</span></div>' +
      colCardHtml() + dockHtml() +
      '<div class="peer-blocks" id="leaderBlocks">' + states.map(blockHtml).join('') + '</div>';

    /* 初次进来就把缓存里的看板铺上，别等异步回来才有黄圈 */
    if (peerReady && board) repaintPeer();

    /* ---------- 重画（不重建 DOM，保持滚动位置和输入焦点） ---------- */
    function repaintPeer() {
      /* 确认条的按钮 / 状态 / 是否要整条收起来，都可能变，所以整块重画（里面没有输入框，不会抢焦点） */
      var dock = sheet.querySelector('#leaderPeerDock');
      if (dock) {
        dock.className = 'peer-dock' + (peerReady && hasAnySubmission() ? '' : ' peer-dock-off');
        dock.innerHTML = dockInnerHtml();
      }
      states.forEach(function (st) {
        var el = sheet.querySelector('[data-block-pend="' + st.group.no + '"]');
        if (el) el.innerHTML = blockPendHtml(st);
      });
      /* 表头的「待确认 N」也要跟着变，否则确认完还挂着旧数字 */
      sheet.querySelectorAll('th[data-th-col]').forEach(function (th) {
        var st = byGno[String(th.dataset.gno)];
        if (st) th.outerHTML = colThHtml(st, +th.dataset.thCol);
      });
      sheet.querySelectorAll('.peer-cell').forEach(function (el) {
        var st = byGno[String(el.dataset.gno)];
        if (st) paintCell(el, st, el.dataset.member, +el.dataset.peerCell);
      });
    }

    /* ---------- 确认 / 否决 ---------- */
    function runConfirm(name, ok, btn) {
      /* 用户原话「不要开弹窗，我直接下滑全看清然后点击确认」：
         否决这种会清数据的动作不用 window.confirm 拦，改成按钮自己变「确定否决？」——
         第一次点只是上膛，3 秒内再点一次才真的执行，全程不离开页面。 */
      if (!ok) {
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.textContent = '确定否决？';
          btn.classList.add('is-armed');
          setMsg('再点一次「确定否决？」就会清掉「' + name + '」这一列本轮所有提交（本班所有组）。');
          setTimeout(function () {
            if (btn.isConnected && btn.dataset.armed) {
              delete btn.dataset.armed;
              btn.classList.remove('is-armed');
              btn.textContent = '否决清除';
            }
          }, 3000);
          return;
        }
        delete btn.dataset.armed;
        btn.classList.remove('is-armed');
      }
      if (btn) btn.disabled = true;
      setMsg((ok ? '正在确认「' : '正在否决「') + name + '」…');
      peer.confirm(cls, lesson, name, ok).then(function (res) {
        /* 本地先改状态再只重画相关区块：不整页重绘，老师滑到第几组就停在第几组 */
        statusOfProject[name] = ok ? 'confirmed' : 'rejected';
        reindexPending();
        repaintPeer();
        var changed = res && res.changed ? '（' + res.changed + ' 格）' : '';
        setMsg('「' + name + '」' + (ok ? '已确认加分' : '已否决并清除') + changed);
      }, function (err) {
        if (btn) btn.disabled = false;
        setMsg((err && err.message) || '确认失败，检查网络后重试。');
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
      if (!named.length) { setBlockFb(gno, '请先在页顶填项目名称；每个项目满分 5 分。'); return; }
      var dlg = document.createElement('dialog');
      dlg.id = 'dlgLeaderFullMarks';
      dlg.innerHTML = '<form method="dialog"><h2>一键全员满分</h2><p>每人每个已命名项目填为 5 分，共 ' + named.length + ' 项；空白预留列不变。已有较低分会被改为 5 分，可在操作日志按组撤销。</p>' +
        '<label class="field col">范围<select id="leaderFullScope"><option value="current">只填第 ' + st.group.no + ' 组</option><option value="all">本课全部小组</option></select></label>' +
        '<div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">确认填满 5 分</button></div></form>';
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
      var ok = t.closest('[data-peer-ok]'), no = t.closest('[data-peer-no]');
      if (ok || no) { runConfirm(ok ? ok.dataset.peerOk : no.dataset.peerNo, !!ok, ok || no); return; }
      var jump = t.closest('[data-jump-gno]');
      if (jump) {
        var block = sheet.querySelector('#leaderGroup-' + jump.dataset.jumpGno);
        if (block) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    /* ---------- 本节课「组长打分」开关 + 刷新提交 ---------- */
    var bar = sheet.querySelector('#leaderPeerBar'), toggle = sheet.querySelector('#leaderPeerToggle'), refresh = sheet.querySelector('#leaderPeerRefresh');
    function setGateUI(open) {
      lesson.peerGate = !!open;
      bar.classList.toggle('is-open', !!open);
      bar.querySelector('.peer-gate-ico').textContent = open ? '●' : '○';
      toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      toggle.textContent = open ? '组长打分：本节课已开放' : '组长打分：未开放';
    }
    if (peerReady) {
      toggle.onclick = function () {
        var going = !lesson.peerGate;
        toggle.disabled = true;
        toggle.textContent = going ? '正在开放…' : '正在关闭…';
        peer.setGate(cls, lesson, going).then(function () {
          peerMsg = going ? '已开放本节课的组长打分（组长只能打这一节，其他课次只读）。' : '已关闭：组长现在只能看，不能改分。';
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
          setMsg('已刷新：' + (((b && b.cells) || []).length) + ' 条提交。');
        }, function (err) { refresh.disabled = false; setMsg((err && err.message) || '刷新失败。'); });
      };
      /* 打开本节课后每 8 秒自动刷新待确认数，老师不用一直点；只重画黄圈和确认条，不动正在填的格子 */
      (function poll() {
        clearTimeout(window.__leaderPeerTimer);
        if (!lesson.peerGate || !document.body.contains(sheet) || root.hidden) return;
        window.__leaderPeerTimer = setTimeout(function () {
          if (!document.body.contains(sheet) || root.hidden) return;
          peer.fetchBoard(cls, lesson).then(function (b) {
            if (!document.body.contains(sheet) || root.hidden) return;
            indexBoard(b); setGateUI(!!b.open); repaintPeer(); poll();
          }, function () { poll(); });
        }, 8000);
      })();
      peer.fetchBoard(cls, lesson).then(function (b) {
        if (!document.body.contains(sheet)) return;
        indexBoard(b); setGateUI(!!b.open); repaintPeer();
      }, function () {});
    } else {
      refresh.disabled = true;
      toggle.title = peerReason;
      toggle.classList.add('is-blocked');
    }

    /* 重画之后把滚动位置放回去（只有自己触发的重画才带 keepY） */
    if (keepY != null) requestAnimationFrame(function () { window.scrollTo(0, keepY); });
  };
})();
