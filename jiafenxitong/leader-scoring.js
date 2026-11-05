/* 组长评分表：每课、每组十个自定义项目，个人每项0–5分，独立于课堂小组分。 */
(function () {
  'use strict';
  var selectedGroup = 1, printing = false;
  /* 开关 / 确认操作后的提示句：重绘一次表格还要把它显示出来，所以放在渲染函数外面 */
  var peerMsg = '';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g,function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function key(member) { return member.sid ? 'sid:'+member.sid : 'id:'+member.id; }
  function csvCell(value) { var s=String(value == null ? '' : value); if (/^[=+\-@]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; }
  window.addEventListener('afterprint',function () { if(printing) { document.body.classList.remove('print-rank','print-leader'); printing=false; } });
  function printableGroup(cls,lesson,g){var r=lesson.leaderScores&&lesson.leaderScores[String(g.no)]||{projects:Array(4).fill(''),members:{},signedBy:'',note:''};var projects=window.JFDT_ASSESSMENT.projectNames(lesson),members=(g.members||[]).filter(function(m){return m.name;}),leadKey=g.leaderKey&&members.some(function(m){return key(m)===g.leaderKey;})?g.leaderKey:(members[0]?key(members[0]):'');if(leadKey){var li=members.findIndex(function(m){return key(m)===leadKey;});if(li>0)members=[members[li]].concat(members.slice(0,li),members.slice(li+1));}return '<section class="leader-slip"><h2>组长课堂评分表</h2><p class="slip-meta">'+esc(cls.name)+' · 第'+g.no+'组 · 第'+lesson.seq+'次课 · '+esc(lesson.date||'')+'</p><p class="slip-rule">每项0–5分；空白项目由组长手写，教师复核。</p><table class="leader-table"><colgroup><col style="width:6%"><col style="width:22%">'+projects.map(function(){return '<col style="width:'+(72/projects.length)+'%">';}).join('')+'</colgroup><thead><tr><th>序号</th><th>成员 / 学号</th>'+projects.map(function(v){return '<th>'+esc(v)+'</th>';}).join('')+'</tr></thead><tbody>'+members.map(function(m,i){var scores=r.members[key(m)]||Array(projects.length).fill(null),lead=key(m)===leadKey;return '<tr><td>'+(i+1)+'</td><td class="slip-member">'+(lead?'👑 ':'')+esc(m.name)+'<small>'+esc(m.sid||'')+'</small></td>'+projects.map(function(_,j){return '<td>'+(scores[j]==null||scores[j]===0?'':scores[j])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table><p class="slip-sign">组长：'+esc(r.signedBy||'________________')+'</p><p class="slip-note">备注：'+esc(r.note||'')+'</p></section>';}
  function printSheets(cls,lesson,groups,perPage){var pages=[],offset=0,counts=Array.isArray(perPage)?perPage:[];if(!counts.length){var limit=Number(perPage)||4,pageCount=Math.ceil(groups.length/limit),base=Math.floor(groups.length/pageCount),extra=groups.length%pageCount;counts=Array.from({length:pageCount},function(_,i){return base+(i<extra?1:0);});}counts.forEach(function(count){var selected=Array.isArray(count)?count:groups.slice(offset,offset+count);offset+=Array.isArray(count)?count.length:count;count=selected.length;if(!selected.length)return;pages.push('<div class="leader-paper slips-'+count+' '+(count>=3?'compact-slips ':'')+(count>=6?'dense-slips ':'')+'" style="grid-template-rows:repeat('+count+',minmax(0,1fr))">'+selected.map(function(g){return printableGroup(cls,lesson,g);}).join('')+'</div>');});return '<div class="leader-print-batch">'+pages.join('')+'</div>';}
  function printIsolated(html){var old=document.getElementById('leaderPrintFrame');if(old)old.remove();var frame=document.createElement('iframe');frame.id='leaderPrintFrame';frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0';var styles=Array.from(document.querySelectorAll('link[rel="stylesheet"],style')).map(function(el){return el.outerHTML;}).join('');frame.srcdoc='<!doctype html><html><head><meta charset="utf-8">'+styles+'<style>@media print{html,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important}body::before,body::after{display:none!important}.leader-paper{height:272mm!important;break-after:auto!important;page-break-after:auto!important}.leader-paper+.leader-paper{break-before:page;page-break-before:always}.leader-print-batch{margin:0!important;padding:0!important}}</style></head><body class="print-leader"><div id="printArea">'+html+'</div></body></html>';frame.onload=function(){frame.contentWindow.focus();frame.contentWindow.print();};document.body.appendChild(frame);}
  window.JFDT_LEADER_PRINT_HTML=printSheets;
  var printDialog=document.createElement('dialog');printDialog.id='dlgLeaderPrint';printDialog.innerHTML='<form method="dialog"><h2>打印组长评分表</h2><label class="field col">范围<select id="leaderPrintScope"><option value="all">本课全部小组</option><option value="current">当前小组</option></select></label><label class="field col">打印页数<select id="leaderPrintPageCount"></select></label><div id="leaderPrintRanges"></div><p id="leaderPrintError" role="alert" class="note"></p><p class="note">每页填写组号范围，例如1-6、7-13；也可填1,3,5。每页最多8组，每组只出现一次。未命名项目留空供手写。A4竖向，建议关闭页眉页脚并按100%打印。</p><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">开始打印</button></div></form>';document.body.appendChild(printDialog);var printSelection=null,exportMode=false;
  function selectedPrintGroups(){return document.querySelector('#leaderPrintScope').value==='all'?printSelection.cls.groups:[printSelection.group];}
  function fillPageRanges(reset){if(!printSelection)return;var groups=selectedPrintGroups(),select=document.querySelector('#leaderPrintPageCount'),n=Number(select.value)||Math.ceil(groups.length/4);if(reset){select.innerHTML=groups.map(function(_,i){return '<option value="'+(i+1)+'">'+(i+1)+'页</option>';}).join('');n=Math.ceil(groups.length/4);}n=Math.max(1,Math.min(n,groups.length));select.value=String(n);var offset=0;document.querySelector('#leaderPrintRanges').innerHTML=Array.from({length:n},function(_,i){var count=Math.floor(groups.length/n)+(i<groups.length%n?1:0),part=groups.slice(offset,offset+count);offset+=count;var numbers=part.map(function(g){return g.no;}),contiguous=numbers.every(function(no,j){return !j||no===numbers[j-1]+1;}),value=contiguous&&numbers.length>1?numbers[0]+'-'+numbers[numbers.length-1]:numbers.join(',');return '<label class="field col">第'+(i+1)+'页组别<input data-print-page="'+i+'" aria-label="第'+(i+1)+'页组别" value="'+esc(value)+'" placeholder="例如1-6"></label>';}).join('');document.querySelector('#leaderPrintError').textContent='';}
  function parsePageRanges(groups,texts){var seen=new Set(),pages=texts.map(function(text,i){var numbers=[];String(text).trim().split(/[,，、\s]+/).forEach(function(token){var m=/^(\d+)(?:[-—–~～至](\d+))?$/.exec(token);if(!m)throw Error('第'+(i+1)+'页请输入组号或范围，如1-6。');var start=Number(m[1]),end=m[2]?Number(m[2]):start;if(start>end||end-start>1000)throw Error('第'+(i+1)+'页组号范围无效。');for(var no=start;no<=end;no++)numbers.push(no);});if(numbers.length>8)throw Error('第'+(i+1)+'页超过8组，请增加页数。');return numbers.map(function(no){var g=groups.find(function(g){return g.no===no;});if(!g)throw Error('第'+no+'组不在本次打印范围内。');if(seen.has(no))throw Error('第'+no+'组重复，请只安排一次。');seen.add(no);return g;});});var missing=groups.filter(function(g){return !seen.has(g.no);});if(missing.length)throw Error('尚未安排：第'+missing.map(function(g){return g.no;}).join('、')+'组。');return pages;}
  window.JFDT_LEADER_PAGE_RANGES=parsePageRanges;
  document.querySelector('#leaderPrintScope').onchange=function(){fillPageRanges(true);};document.querySelector('#leaderPrintPageCount').onchange=function(){fillPageRanges(false);};
  printDialog.addEventListener('close',function(){if(printDialog.returnValue!=='ok'||!printSelection)return;var c=printSelection,groups=selectedPrintGroups(),pages;try{pages=parsePageRanges(groups,Array.from(document.querySelectorAll('[data-print-page]')).map(function(el){return el.value;}));}catch(e){document.querySelector('#leaderPrintError').textContent=e.message;printDialog.showModal();return;}var html=printSheets(c.cls,c.lesson,groups,pages);document.querySelector('#printArea').innerHTML=html;if(exportMode){var bytes=window.JFDT_GROUP_EXCEL(html),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=c.cls.name+'_组内评分打印版.xlsx';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}else printIsolated(html);});
  window.JFDT_LEADER_RENDER = function (context) {
    var root=context.root, state=context.state;
    /* 班级只能来 app.js 传进来的「可见班级」（首页点亮了小组加分的班）。
       以前这里用 state.classes = 本机所有班，历史遗留的旧班（甚至别的学期）会全部出现在下拉里，
       用户 2026-11-04 报「出现不属于我的班」。context.classes 缺失时才退回旧行为，免得老页面炸。 */
    var pool=(context.classes&&context.classes.length)?context.classes:(state.classes||[]);
    var cls=pool.find(function (c) { return c.id===state.ui.classId; }) || pool[0];
    var lessons=state.lessons.filter(function (l) { return cls && l.classId===cls.id; }).sort(function (a,b) { return b.seq-a.seq; });
    window.JFDT_LEADER_LESSONS=lessons;
    var lesson=lessons.find(function (l) { return l.id===state.ui.lessonId; }) || lessons[0];
    root.innerHTML='<h2 class="sec-title">组内个人评分</h2><p class="note">每项 5 分，点 1–5 直接记分，其他按钮收起、分数占住这一格；双击分数撤销。项目名称全班共用，默认 4 列、最多 30 列；双击成员姓名可设为或退出组长（👑 置顶）。「组长打分」开关只管本节课：开了组长才能给自己组员打分，其他课次对组长一律只读；组员给组长打分取平均；每一列都要教师确认才计分。</p>'+
      '<div class="card lesson-bar"><label class="field"><span>班级</span><select id="leaderClassSel">'+pool.map(function(c){return '<option value="'+esc(c.id)+'"'+(cls&&c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'+
      '<label class="field"><span>课次</span><select id="leaderLessonSel"'+(!lessons.length?' disabled':'')+'>'+lessons.map(function(l){return '<option value="'+esc(l.id)+'"'+(lesson&&l.id===lesson.id?' selected':'')+'>第'+l.seq+'次 · '+esc(l.date)+'</option>';}).join('')+'</select></label></div><div id="leaderSheet"></div>';
    root.querySelector('#leaderClassSel').onchange=function(){context.select(this.value,null);};
    var manage=document.createElement('button');manage.className='btn';manage.id='leaderManageGroups';manage.textContent='名单与分组';manage.onclick=function(){context.openGroups();};root.querySelector('.lesson-bar').appendChild(manage);
    root.querySelector('#leaderLessonSel').onchange=function(){context.select(cls.id,this.value);};
    var sheet=root.querySelector('#leaderSheet');
    if(!cls||!lesson) { sheet.innerHTML='<div class="card empty-hint">请先在“上课记分”新开一课，再填写个人评分。<p><button class="btn" id="leaderGoScore">前往上课记分</button></p></div>';sheet.querySelector('button').onclick=context.openScore;return; }
    var group=cls.groups.find(function(g){return g.no===selectedGroup;}) || cls.groups[0];
    if(!group) { sheet.textContent='该班还没有小组，请先导入或安排分组。';return; }
    selectedGroup=group.no;
    var record=lesson.leaderScores&&lesson.leaderScores[String(group.no)];
    if(!record) record={projects:[],members:{},signedBy:'',note:''};
    var sharedProjects=window.JFDT_ASSESSMENT.projectNames(lesson);
    record.projects=sharedProjects.slice();
    function persist() { if(!lesson.leaderScores) lesson.leaderScores={};lesson.leaderScores[String(group.no)]=record;context.save(); }
    function log(detail) { if(context.log) context.log(cls.name+' · 第'+lesson.seq+'次课 · 第'+group.no+'组 · '+detail); }
    var members=context.memberEntries?context.memberEntries(group):group.members.map(function(m,i){return {m:m,i:i};}).filter(function(x){return x.m.name;});

    /* ---------- 组内互评：开关 / 提交看板 / 逐列确认 ---------- */
    var peer=context.peer||null;
    var peerReady=!!(peer&&peer.ready&&peer.ready(cls));
    var peerReason=peer&&peer.reason?peer.reason(cls):'';
    function projectCols(){return record.projects.map(function(n,i){return {name:String(n||'').trim(),col:i};}).filter(function(p){return !!p.name;});}
    function numText(v){var n=Math.round((Number(v)+Number.EPSILON)*10)/10;return n%1===0?String(n):n.toFixed(1);}
    /* 4.5 这种平均分按最近的整数取色调，别掉回默认灰色 */
    function toneOf(v){return Math.max(1,Math.min(5,Math.round(Number(v)||0)));}
    function cellValue(m,col){var v=(record.members[key(m)]||[])[col];return v==null||v===''?null:Number(v);}
    function cellMeta(m,col){return (lesson.peerMeta&&lesson.peerMeta[group.no+'|'+key(m)+'|'+col])||'';}
    function picksHtml(m,col){
      var label=esc(m.name)+' · '+esc(record.projects[col]||('项目'+(col+1)));
      return [1,2,3,4,5].map(function(s){
        return '<button type="button" class="peer-pick p'+s+'" data-score="'+s+'" title="给 '+s+' 分" aria-label="'+label+' 给 '+s+' 分">'+s+'</button>';
      }).join('');
    }
    function cellHtml(m,col){
      var v=cellValue(m,col), meta=cellMeta(m,col);
      var open=v==null;
      return '<div class="peer-cell'+(open?'':' is-set score-'+toneOf(v))+'" data-peer-cell="'+col+'" data-member="'+esc(key(m))+'"'+
        (open?'':' data-score="'+v+'" title="双击撤销这一格的加分" role="button" tabindex="0"')+
        ' role="group" aria-label="'+esc(m.name)+' '+esc(record.projects[col]||('项目'+(col+1)))+'">'+
        (open?picksHtml(m,col):'<span class="peer-score">'+numText(v)+'</span>'+(meta?'<span class="peer-src peer-src-'+meta+'">'+(meta==='avg'?'平均':'互评')+'</span>':''))+
        '</div>';
    }
    function paintCell(el,m,col){
      var v=cellValue(m,col), meta=cellMeta(m,col);
      el.classList.toggle('is-set',v!=null);
      for(var i=1;i<=5;i++)el.classList.toggle('score-'+i,v!=null&&toneOf(v)===i);
      if(v==null){el.removeAttribute('data-score');el.removeAttribute('title');el.removeAttribute('role');el.removeAttribute('tabindex');}
      else {el.setAttribute('data-score',v);el.setAttribute('title','双击撤销这一格的加分');el.setAttribute('role','button');el.setAttribute('tabindex','0');}
      el.innerHTML=v==null?picksHtml(m,col):'<span class="peer-score">'+numText(v)+'</span>'+(meta?'<span class="peer-src peer-src-'+meta+'">'+(meta==='avg'?'平均':'互评')+'</span>':'');
    }
    function setCell(m,col,value){
      var mk=key(m);
      if(!record.members[mk])record.members[mk]=[];
      var old=record.members[mk][col];old=(old==null||old==='')?null:Number(old);
      if(old===value)return;
      record.members[mk][col]=value;
      if(lesson.peerMeta)delete lesson.peerMeta[group.no+'|'+mk+'|'+col];
      log(m.name+' · '+(record.projects[col]||('项目'+(col+1)))+'：'+(old==null?'未填':numText(old))+' → '+(value==null?'未填':numText(value)));
      persist();
      var fb=sheet.querySelector('#leaderFeedback');
      if(fb)fb.textContent=value==null?'已撤销这一格的加分。':'已记 '+value+' 分，正在随账号同步。';
    }

    var head='<tr><th>序号</th><th>成员 / 完整学号</th>'+record.projects.map(function(p,i){return '<th><input class="leader-project" data-project="'+i+'" aria-label="评分项目'+(i+1)+'" maxlength="80" placeholder="项目'+(i+1)+'" value="'+esc(p)+'"><button type="button" class="project-remove" data-remove-project="'+i+'" aria-label="删除项目'+(i+1)+'" title="删除本课全班此项目列">×</button></th>';}).join('')+'</tr>';
    var body=members.map(function(entry,row){var m=entry.m,lead=context.isLeader&&context.isLeader(group,m);return '<tr><td>'+(row+1)+'</td><td class="leader-member'+(lead?' group-leader-name':'')+'" data-leader-member="'+esc(key(m))+'" title="双击设置或退出组长">'+(lead?'<span class="leader-crown" aria-label="组长">👑</span> ':'')+esc(m.name)+'<small>'+esc(m.sid||'未填写学号')+'</small></td>'+record.projects.map(function(_,col){return '<td class="peer-td">'+cellHtml(m,col)+'</td>';}).join('')+'</tr>';}).join('');

    var gateOpen=!!lesson.peerGate;
    var gateText=!peerReady?'组长打分 · 需要登录教师账号':(gateOpen?'组长打分：本节课已开放':'组长打分：未开放');
    sheet.innerHTML='<div class="card"><div class="btnrow"><label class="field"><span>小组</span><select id="leaderGroupSel">'+cls.groups.map(function(g){return '<option value="'+g.no+'"'+(g.no===group.no?' selected':'')+'>第'+g.no+'组（'+g.members.filter(function(m){return m.name;}).length+'人）</option>';}).join('')+'</select></label><button class="btn" id="leaderAddProject">新增项目列</button><button class="btn" id="leaderPrint">打印评分表</button><button class="btn" id="leaderExport">下载打印版Excel</button></div><p class="note">课次：第'+lesson.seq+'次 · '+esc(lesson.date)+'　任务：'+esc(lesson.topic)+'</p>'+
      '<div class="peer-gate'+(gateOpen?' is-open':'')+'" id="leaderPeerBar"><span class="peer-gate-ico" aria-hidden="true">'+(gateOpen?'●':'○')+'</span><button type="button" class="btn peer-gate-btn" id="leaderPeerToggle" aria-pressed="'+(gateOpen?'true':'false')+'"'+(peerReady?'':' title="'+esc(peerReason)+'"')+'>'+esc(gateText)+'</button><button type="button" class="btn tiny" id="leaderPeerRefresh"'+(!peerReady?' disabled':'')+'>刷新提交</button><span class="peer-gate-note" id="leaderPeerNote">'+
        (peerReady?'开放后组长只能打本节课；组员给组长打分取平均；每一列教师确认后才计入成绩。':'互评需要：'+esc(peerReason))+
      '</span></div><div class="peer-panel" id="leaderPeerPanel" hidden></div>'+
      /* --peer-cols 给 styles.css 算列宽用：列多时表更宽、横向滚动，别把 1~5 按钮压成一条缝 */
      '<div class="tablewrap peer-tablewrap" style="--peer-cols:'+record.projects.length+'"><table class="leader-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+(!members.length?'<p class="note">本组暂无成员。已确定名单和分组后，成员会出现在这里。</p>':'')+'<label class="field"><span>组长 / 复核人</span><input id="leaderSignedBy" maxlength="100" value="'+esc(record.signedBy)+'"></label><label class="field col"><span>备注</span><textarea id="leaderNote" maxlength="500">'+esc(record.note)+'</textarea></label><p id="leaderFeedback" class="note" role="status">'+(peerMsg||'填分后自动保存，随教师账号同步。')+'</p></div>';
    if(peerMsg)peerMsg='';
    sheet.querySelectorAll('[data-leader-member]').forEach(function(cell){cell.ondblclick=function(e){e.preventDefault();var member=members.find(function(entry){return key(entry.m)===cell.dataset.leaderMember;});if(member&&context.toggleLeader)context.toggleLeader(cls,group,member.m);};});

    /* 点分数子按钮 = 记这一格；双击已有分数 = 撤销 */
    function memberByKey(mk){return members.find(function(entry){return key(entry.m)===mk;});}
    sheet.addEventListener('click',function(e){
      var pick=e.target.closest&&e.target.closest('.peer-pick');
      if(!pick)return;
      var cell=pick.closest('.peer-cell'),entry=cell&&memberByKey(cell.dataset.member);
      if(!cell||!entry)return;
      var value=Number(pick.dataset.score);
      setCell(entry.m,+cell.dataset.peerCell,value);
      paintCell(cell,entry.m,+cell.dataset.peerCell);
    });
    sheet.addEventListener('dblclick',function(e){
      var cell=e.target.closest&&e.target.closest('.peer-cell.is-set');
      if(!cell)return;
      var entry=memberByKey(cell.dataset.member);
      if(!entry)return;
      e.preventDefault();
      var col=+cell.dataset.peerCell;
      setCell(entry.m,col,null);
      paintCell(cell,entry.m,col);
    });
    sheet.addEventListener('keydown',function(e){
      if(e.key!=='Enter'&&e.key!=='Delete'&&e.key!=='Backspace')return;
      var cell=e.target.closest&&e.target.closest('.peer-cell.is-set');
      if(!cell)return;
      var entry=memberByKey(cell.dataset.member);
      if(!entry)return;
      e.preventDefault();
      var col=+cell.dataset.peerCell;
      setCell(entry.m,col,null);
      paintCell(cell,entry.m,col);
    });

    var fullButton=document.createElement('button');fullButton.type='button';fullButton.className='btn';fullButton.id='leaderFullMarks';fullButton.textContent='一键全员满分';sheet.querySelector('.btnrow').insertBefore(fullButton,sheet.querySelector('#leaderPrint'));
    fullButton.onclick=function(){var named=sharedProjects.map(function(p,i){return String(p).trim()?i:-1;}).filter(function(i){return i>=0;});if(!named.length){sheet.querySelector('#leaderFeedback').textContent='请先填写项目名称；每个项目满分5分。';return;}var dlg=document.createElement('dialog');dlg.id='dlgLeaderFullMarks';dlg.innerHTML='<form method="dialog"><h2>一键全员满分</h2><p>每人每个已命名项目填为5分，共'+named.length+'项；空白预留列不变。已有较低分会被改为5分，可在操作日志按组撤销。</p><label class="field col">范围<select id="leaderFullScope"><option value="current">当前第'+group.no+'组</option><option value="all">本课全部小组</option></select></label><div class="btnrow"><button class="btn" value="cancel">取消</button><button class="btn primary" value="ok">确认填满5分</button></div></form>';document.body.appendChild(dlg);dlg.addEventListener('close',function(){if(dlg.returnValue==='ok'){var groups=dlg.querySelector('select').value==='all'?cls.groups:[group];context.fullMarks(lesson,groups,named,sharedProjects);window.JFDT_LEADER_RENDER(context);}dlg.remove();});dlg.showModal();};
    sheet.querySelectorAll('[data-remove-project]').forEach(function(button){button.onclick=function(){if(sharedProjects.length<=1){sheet.querySelector('#leaderFeedback').textContent='至少保留1列。';return;}var index=Number(button.dataset.removeProject),records=lesson.leaderScores||{},hasData=String(sharedProjects[index]||'').trim()||Object.values(records).some(function(r){return Object.values(r.members||{}).some(function(v){return v[index]!==null&&v[index]!==undefined;});});if(hasData&&!window.confirm('删除此项目会同步删除本课所有组这一列的名称和分数，并重新计算完成率。确定删除？'))return;sharedProjects.splice(index,1);lesson.leaderProjectNames=sharedProjects.slice();lesson.leaderProjectCount=sharedProjects.length;Object.values(records).forEach(function(r){r.projects=sharedProjects.slice();Object.keys(r.members||{}).forEach(function(k){r.members[k].splice(index,1);});});log('删除全班项目列'+(index+1));context.save();window.JFDT_LEADER_RENDER(context);};});
    sheet.querySelector('#leaderAddProject').onclick=function(){if(sharedProjects.length>=30){sheet.querySelector('#leaderFeedback').textContent='最多30个项目列。';return;}lesson.leaderProjectNames=sharedProjects.concat('');lesson.leaderProjectCount=lesson.leaderProjectNames.length;if(!lesson.leaderScores)lesson.leaderScores={};cls.groups.forEach(function(g){var r=lesson.leaderScores[String(g.no)];if(r)r.projects=lesson.leaderProjectNames.slice();});context.save();window.JFDT_LEADER_RENDER(context);};
    sheet.querySelector('#leaderGroupSel').onchange=function(){selectedGroup=+this.value;window.JFDT_LEADER_RENDER(context);};
    sheet.querySelectorAll('[data-project]').forEach(function(input){input.onchange=function(){var index=+input.dataset.project,old=sharedProjects[index],next=input.value.trim(); if(old===next)return;sharedProjects[index]=next;lesson.leaderProjectNames=sharedProjects.slice();cls.groups.forEach(function(g){if(!lesson.leaderScores)lesson.leaderScores={};var target=lesson.leaderScores[String(g.no)];if(!target)target=lesson.leaderScores[String(g.no)]={projects:sharedProjects.slice(),members:{},signedBy:'',note:''};if(!Array.isArray(target.projects))target.projects=sharedProjects.slice();target.projects=sharedProjects.slice();});record=lesson.leaderScores[String(group.no)];log('全班统一项目'+(index+1)+'名称：'+(old||'空')+' → '+(next||'空')+'（所有小组同步）');context.save();};});
    sheet.querySelector('#leaderSignedBy').onchange=function(){record.signedBy=this.value.trim();persist();};
    sheet.querySelector('#leaderNote').onchange=function(){record.note=this.value;persist();};
    sheet.querySelector('#leaderExport').textContent='下载打印版Excel';sheet.querySelector('#leaderExport').onclick=function(){exportMode=true;printSelection={cls:cls,lesson:lesson,group:group};printDialog.returnValue='';fillPageRanges(true);printDialog.querySelector('h2').textContent='下载打印版Excel';printDialog.querySelector('button[value="ok"]').textContent='下载Excel';printDialog.showModal();};
    sheet.querySelector('#leaderPrint').textContent='打印评分表';
    sheet.querySelector('#leaderPrint').onclick=function(){exportMode=false;printDialog.querySelector('h2').textContent='打印组长评分表';printDialog.querySelector('button[value="ok"]').textContent='开始打印';printSelection={cls:cls,lesson:lesson,group:group};printDialog.returnValue='';fillPageRanges(true);if(printDialog.showModal)printDialog.showModal();else printDialog.setAttribute('open','');};

    /* ---------- 教师端：开关 + 逐列确认面版 ---------- */
    var bar=sheet.querySelector('#leaderPeerBar'),toggle=sheet.querySelector('#leaderPeerToggle'),refresh=sheet.querySelector('#leaderPeerRefresh'),panel=sheet.querySelector('#leaderPeerPanel');
    function feedback(text){var fb=sheet.querySelector('#leaderFeedback');if(fb)fb.textContent=text;}
    function setGateUI(open){
      lesson.peerGate=!!open;
      bar.classList.toggle('is-open',!!open);
      bar.querySelector('.peer-gate-ico').textContent=open?'●':'○';
      toggle.setAttribute('aria-pressed',open?'true':'false');
      toggle.textContent=open?'组长打分：本节课已开放':'组长打分：未开放';
    }
    toggle.onclick=function(){
      if(!peerReady){feedback(peerReason||'互评功能不可用。');return;}
      var going=!lesson.peerGate;
      toggle.disabled=true;
      toggle.textContent=going?'正在开放…':'正在关闭…';
      peer.setGate(cls,lesson,going).then(function(){
        peerMsg=going?'已开放本节课的组长打分（组长只能打这一节，其他课次只读）。':'已关闭：组长现在只能看，不能改分。';
        window.JFDT_LEADER_RENDER(context);
      },function(err){toggle.disabled=false;setGateUI(lesson.peerGate);feedback((err&&err.message)||'操作失败，检查网络后重试。');});
    };
    function panelHtml(board){
      var cols=projectCols();
      if(!cols.length)return '<p class="note">先把项目名称填上，再开放组长打分。</p>';
      var confirms={},counts={},people={};
      ((board&&board.confirms)||[]).forEach(function(c){confirms[c.project]=c.status;});
      ((board&&board.cells)||[]).forEach(function(c){
        counts[c.project]=(counts[c.project]||0)+1;
        if(!people[c.project])people[c.project]={};
        people[c.project][c.target]=1;
      });
      var rows=cols.map(function(p){
        var status=confirms[p.name]||'pending',n=counts[p.name]||0,who=people[p.name]?Object.keys(people[p.name]).length:0;
        var label=status==='confirmed'?'已确认计分':status==='rejected'?'已否决 · 本轮作废':'待确认';
        return '<div class="peer-row" data-peer-project="'+esc(p.name)+'">'+
          '<span class="peer-row-name">'+esc(p.name)+'</span>'+
          '<span class="peer-row-count">'+(n?who+' 人 · '+n+' 条提交':'还没有提交')+'</span>'+
          '<span class="peer-status is-'+status+'">'+label+'</span>'+
          '<button type="button" class="btn tiny peer-ok" data-peer-ok="'+esc(p.name)+'"'+(!n?' disabled':'')+'>确认加分</button>'+
          '<button type="button" class="btn tiny peer-no" data-peer-no="'+esc(p.name)+'"'+(!n&&status==='pending'?' disabled':'')+'>否决 / 清除</button>'+
        '</div>';
      }).join('');
      return '<div class="peer-panel-head"><b>组长提交 · 逐列确认</b><span>教师确认后这一列才计入成绩；否决会清掉本轮提交，组长可重打。</span></div>'+rows;
    }
    function paintPanel(board){
      if(!panel)return;
      if(!peerReady){panel.hidden=true;return;}
      panel.hidden=false;
      panel.innerHTML=panelHtml(board);
      panel.querySelectorAll('[data-peer-ok],[data-peer-no]').forEach(function(btn){
        btn.onclick=function(){
          var yes=!!btn.dataset.peerOk,name=yes?btn.dataset.peerOk:btn.dataset.peerNo;
          if(!yes&&!window.confirm('否决「'+name+'」会清除这一列本轮所有提交，确定？'))return;
          btn.disabled=true;
          peer.confirm(cls,lesson,name,yes).then(function(res){
            peerMsg='「'+name+'」'+(yes?'已确认加分':'已否决并清除')+(res&&res.changed?'（'+res.changed+' 格）':'');
            window.JFDT_LEADER_RENDER(context);
          },function(err){btn.disabled=false;feedback((err&&err.message)||'确认失败，检查网络后重试。');});
        };
      });
    }
    if(peerReady){
      var cached=peer.cached(lesson);
      if(cached)paintPanel(cached);else paintPanel(null);
      refresh.onclick=function(){
        refresh.disabled=true;
        peer.fetchBoard(cls,lesson).then(function(board){
          if(!document.body.contains(sheet))return;
          setGateUI(!!board.open);paintPanel(board);refresh.disabled=false;feedback('已刷新：'+((board.cells||[]).length)+' 条提交。');
        },function(err){refresh.disabled=false;feedback((err&&err.message)||'刷新失败。');});
      };
      /* 打开本节课后每 8 秒自动刷新提交数，老师不用一直点；只重画面版，不动表格里正在填的格子 */
      (function poll(){
        clearTimeout(window.__leaderPeerTimer);
        if(!lesson.peerGate||!document.body.contains(sheet)||root.hidden)return;
        window.__leaderPeerTimer=setTimeout(function(){
          if(!document.body.contains(sheet)||root.hidden)return;
          peer.fetchBoard(cls,lesson).then(function(board){
            if(!document.body.contains(sheet)||root.hidden)return;
            setGateUI(!!board.open);paintPanel(board);poll();
          },function(){poll();});
        },8000);
      })();
      peer.fetchBoard(cls,lesson).then(function(board){
        if(!document.body.contains(sheet))return;
        setGateUI(!!board.open);paintPanel(board);
      },function(){});
    }else{
      refresh.disabled=true;
      toggle.title=peerReason;
      toggle.classList.add('is-blocked');
    }
  };
})();
