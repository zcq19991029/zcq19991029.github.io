/* Criterion-based regular grades; raw points and attendance history remain unchanged. */
(function (root) {
  'use strict';
  var defaults = {totalLessons:24, late:1, truant:3, leave:0, early:1, lateEarlyConversion:3, truantFailure:3, attendanceFailureEnabled:true, passScore:60, taskTarget:0, customRules:[]};
  var labels = {present:'正常出勤',late:'迟到',truant:'旷课',leave:'请假',early:'早退'};
  function esc(v) { return String(v == null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function round(n) { return Math.round((n+Number.EPSILON)*10)/10; }
  function key(m) { return m.sid?'sid:'+m.sid:m.id?'id:'+m.id:m.no!=null?'no:'+m.no:'name:'+m.name; }
  /* 判人身份：只认跨名单稳定、两条记录都带的字段。
     m.id 是分组里的内部 uid，全班名单那条没有，拿它当身份会让“没学号的人”在分组和名单里各算一个。 */
  function ident(m) { return m.sid?'sid:'+m.sid:m.no!=null?'no:'+m.no:'name:'+m.name; }
  function settings(cls) {
    var cfg=Object.assign({},defaults,cls.assessmentSettings||{});
    ['totalLessons','late','truant','leave','early','passScore'].forEach(function(k){var max=k==='totalLessons'?1000:100,min=k==='totalLessons'?1:0;if(!Number.isInteger(cfg[k])||cfg[k]<min||cfg[k]>max)cfg[k]=defaults[k];});
    if(!Number.isFinite(cfg.taskTarget)||cfg.taskTarget<0||cfg.taskTarget>100000)cfg.taskTarget=0;
    cfg.customRules=Array.isArray(cfg.customRules)?cfg.customRules.filter(function(r){return r&&typeof r.id==='string'&&typeof r.name==='string'&&Number.isInteger(r.loss)&&r.loss>=0&&r.loss<=100;}).slice(0,20):[];
    ['lateEarlyConversion','truantFailure'].forEach(function(k){if(!Number.isInteger(cfg[k])||cfg[k]<1||cfg[k]>100)cfg[k]=3;});if(typeof cfg.attendanceFailureEnabled!=='boolean')cfg.attendanceFailureEnabled=true;
    return cfg;
  }
  function roster(cls,raw) {
    var map=new Map(),seen=new Set();
    /* 分组里的先放（有组号、能算分），全班名单只补没出现过的人；同一人两条记录只留一条 */
    cls.groups.forEach(function(g){g.members.forEach(function(m){if(!m.name)return;var who=ident(m);if(seen.has(who))return;seen.add(who);map.set(key(m),Object.assign({},m,{gno:g.no,memberIndex:g.members.indexOf(m)}));});});
    (cls.roster||[]).forEach(function(m){if(!m.name)return;var who=ident(m);if(seen.has(who))return;seen.add(who);map.set(key(m),Object.assign({},m,{gno:0}));});
    return Array.from(map.values()).map(function(m){var r=(raw||[]).find(function(r){return r.gno===m.gno && r.name===m.name && r.sid===m.sid;});return Object.assign({},m,{key:key(m),groupScore:r?r.groupScore:0,project:r?r.project:0,personal:r?r.personal:0,total:r?r.total:0});});
  }
  function deduction(status,cfg) {
    if(status==='present')return 0;
    if(Object.prototype.hasOwnProperty.call(labels,status))return Number(cfg[status])||0;
    var rule=(cfg.customRules||[]).find(function(r){return r.id===status;});return rule?rule.loss:0;
  }
  function statusName(status,cfg) { var r=(cfg.customRules||[]).find(function(r){return r.id===status;});return labels[status]||(r&&r.name)||status; }
  function projectNames(lesson) {
    var records=lesson.leaderScores||{},shared=Array.isArray(lesson.leaderProjectNames)?lesson.leaderProjectNames:null;
    var length=Math.max(1,Number(lesson.leaderProjectCount)||4);
    function include(values){(values||[]).forEach(function(v,i){if(v!==null&&v!==undefined&&String(v).trim()!=='')length=Math.max(length,i+1);});}
    if(shared)include(shared);Object.values(records).forEach(function(r){include(r.projects);Object.values(r.members||{}).forEach(include);});
    return Array.from({length:Math.min(30,length)},function(_,i){if(shared)return shared[i]||'';for(var g of Object.keys(records).sort(function(a,b){return Number(a)-Number(b);})){var name=records[g].projects&&records[g].projects[i];if(String(name||'').trim())return name;}return '';});
  }
  /* ---------- 2026-11-12 R1：值日缺勤 = 整学期一次 5 分项目 ----------
     旧口径（本版作废）：每节课都送 5 分（叫「干净又卫生」），13 节课白送 65 分，
     项目越加越多、项目分的比重被稀释。用户要求「清理之前每节课都送的 5 分，改为仅第一个加一次整学期存在」。
     新口径：
       · 值日缺勤（原「干净又卫生」）：整学期一个 5 分项目，一次都没缺勤就是 5/5 = 100%，
         每节课都显示这个学期值，不再逐课累加；
       · 值日缺勤按 20% 一档扣（= 1 分），按组累计、全组每人同扣（团队绑定），
         第二次轮到值日再缺勤还能再扣一次（扣分叠加），最终落到个人分数上；
       · 每节课的满分只剩「5 × 已命名项目数」；手机未入袋 / 个人扣分从本节项目分里扣，
         扣完为止、不跨课（旧口径是从每课那 5 分送分里扣）。 */
  function namedCount(lesson) {
    return projectNames(lesson).filter(function (n) { return String(n || '').trim(); }).length;
  }
  /** 每节课的项目满分（不含整学期那 5 分值日缺勤） */
  function lessonMax(lesson) { return 5 * namedCount(lesson); }
  /** 整学期值日缺勤扣了几档（1 档 = 20% = 1 分）；按组累计，封顶 5 档 */
  function dutyLoss(lessons, gno) {
    var n = 0, key = String(gno);
    (lessons || []).forEach(function (l) {
      var s = (l.scores || {})[key] || {};
      n += Number(s.dutyAbsent) || 0;
    });
    return Math.max(0, Math.min(5, n));
  }
  /** 值日缺勤得分（0–5）：一学期没缺勤就是 5（100%） */
  function dutyScore(lessons, gno) { return Math.max(0, 5 - dutyLoss(lessons, gno)); }
  /** 某成员某节课的项目净得分：Σ项目得分 − 手机未入袋 − 本人扣分，最多扣完本课项目分 */
  function lessonNet(lesson, gno, memberIndex, key) {
    var n = 0, raw = 0;
    var rec = (lesson.leaderScores || {})[String(gno)] || {};
    var values = (rec.members || {})[key];
    projectNames(lesson).forEach(function (name, i) {
      if (!String(name || '').trim()) return;
      n++;
      var v = values ? values[i] : null;
      if (v === null || v === undefined) return;
      raw += Math.max(0, Math.min(5, Number(v) || 0));
    });
    if (!n) return { earned: 0, max: 0, raw: 0, ded: 0 };
    var sc = (lesson.scores || {})[String(gno)] || {};
    var phone = Math.max(0, Number(sc.phone) || 0);
    var mine = Math.max(0, Number((sc.personal || {})[String(memberIndex)]) || 0);
    var ded = Math.min(5 * n, phone + mine);
    return { earned: Math.max(0, raw - ded), max: 5 * n, raw: raw, ded: ded };
  }
  /** 本组本节的项目完成（0–5）：按已记分的成员平均，兼容老调用（组级没有成员下标，个人扣分不计） */
  function groupNet(lesson, gno, lessons) {
    var n = namedCount(lesson);
    if (!n) return 0;
    var rec = (lesson.leaderScores || {})[String(gno)] || {}, meter = (lesson.scores || {})[String(gno)] || {};
    var keys = Object.keys(rec.members || {});
    if (!keys.length) return 0;
    var phone = Math.max(0, Number(meter.phone) || 0), sum = 0;
    keys.forEach(function (k) {
      var values = rec.members[k] || [], raw = 0;
      projectNames(lesson).forEach(function (name, i) {
        if (!String(name || '').trim()) return;
        var v = values[i];
        if (v === null || v === undefined) return;
        raw += Math.max(0, Math.min(5, Number(v) || 0));
      });
      sum += Math.max(0, raw - phone);
    });
    return Math.round(sum / keys.length / n * 100) / 100;
  }
  function taskEvidence(lessons,m,cfg) {
    var earned=0,maximum=0,pending=0;
    /* 值日缺勤：整学期一次，5 分；没缺勤就是满分，缺勤按 20% 一档从这 5 分里扣 */
    var duty=lessons.length?dutyScore(lessons,m.gno):0;
    earned+=duty;maximum+=lessons.length?5:0;
    lessons.forEach(function(l){
      var projects=projectNames(l),values=((l.leaderScores||{})[String(m.gno)]||{}).members;
      var mine=values&&values[m.key];
      if(!namedCount(l))return;
      maximum+=5*namedCount(l);
      earned+=lessonNet(l,m.gno,Number.isInteger(m.memberIndex)?m.memberIndex:-1,m.key).earned;
      projects.forEach(function(name,index){if(!String(name||'').trim())return;
        var n=mine&&mine[index];if(n===null||n===undefined)pending++;
      });
    });
    // 扣分只在本节项目分里抵扣（旧口径是从每课 5 分送分里扣），不跨课留债。
    return {earned:Math.round(earned*100)/100,maximum:maximum,pending:pending,planned:maximum,duty:duty,rate:maximum>0?Math.max(0,Math.min(1,earned/maximum)):0};
  }
  function rows(cls,lessons,raw) {
    var cfg=settings(cls),students=roster(cls,raw),sorted=students.slice().sort(function(a,b){return b.total-a.total||String(a.sid||a.no||a.name).localeCompare(String(b.sid||b.no||b.name),undefined,{numeric:true});});
    var previous=null,rank=0;
    sorted.forEach(function(m,i){
      if(i===0||m.total!==previous)rank=i+1;previous=m.total;
      m.rawRank=rank;m.task=taskEvidence(lessons,m,cfg);
      m.bonus=m.groupScore;
      m.confirmation=(cls.foundationChecks||{})[m.key]||'pending';
      var loss=0,recorded=lessons.length,late=0,early=0,truant=0;
      lessons.forEach(function(l){var a=l.attendance&&l.attendance[m.key];if(a){loss+=Number(a.loss)||0;if(a.status==='late')late++;if(a.status==='early')early++;if(a.status==='truant')truant++;}});
      m.loss=loss;m.recorded=recorded;
      m.lateCount=late;m.earlyCount=early;m.truantCount=truant;
      m.convertedTruants=Math.floor((late+early)/cfg.lateEarlyConversion);m.effectiveTruants=truant+m.convertedTruants;
      m.attendanceFailed=cfg.attendanceFailureEnabled&&(m.effectiveTruants>=cfg.truantFailure||loss>=9);
      m.attendance=round(Math.max(0,Math.min(9,9-loss)));
      m.attendanceMaximum=lessons.length?9:0;
      m.attendanceRate=m.attendanceMaximum?Math.max(0,Math.min(1,m.attendance/m.attendanceMaximum)):0;
      m.totalEarned=round(m.task.earned+(m.attendanceMaximum?m.attendance:0));
      m.totalMaximum=m.task.maximum+m.attendanceMaximum;
      m.performanceRate=m.totalMaximum>0?Math.max(0,Math.min(1,m.totalEarned/m.totalMaximum)):0;
      // Keep the legacy field for consumers that still read it, but expose the
      // unified semester completion score as the actual regular grade.
      m.learning=round(100*m.task.rate);
      m.ready=m.task.pending===0&&m.task.maximum>0&&m.recorded===lessons.length&&lessons.length>0;
      /* 2026-11-10 完全移除考勤分（用户拍板）：考勤已由独立「考勤工具」接管、自动同步扣分，
         小组加分这里不再把考勤分计入平时分。平时分 = 100 × 项目完成率（纯项目，不再合并考勤）。
         考勤字段（loss/attendance/attendanceFailed 等）仍保留计算但不再参与 regular，
         供历史数据与后续可能恢复用；挂科也不再影响「期末需考」。 */
      m.regular=round(100*m.task.rate);m.contribution=round(m.regular*.4);
      m.needed=Math.max(0,Math.ceil(((cfg.passScore-m.regular*.4)/.6-1e-9)*10)/10);
      var exam=cls.examScores&&cls.examScores[m.key];m.exam=exam==null?'':exam;m.final=m.exam===''?null:round(m.regular*.4+m.exam*.6);
    });
    sorted.sort(function(a,b){return b.regular-a.regular||a.rawRank-b.rawRank||String(a.sid||a.name).localeCompare(String(b.sid||b.name));});
    previous=null;rank=0;sorted.forEach(function(m,i){if(i===0||m.regular!==previous)rank=i+1;previous=m.regular;m.rank=rank;});return sorted;
  }
  function options(cfg,value) { value=value||'present';
    var statuses=Object.keys(labels).concat((cfg.customRules||[]).map(function(r){return r.id;}));
    return statuses.map(function(status){var loss=deduction(status,cfg);return '<option value="'+esc(status)+'"'+(status===value?' selected':'')+'>'+esc(statusName(status,cfg))+' · '+(loss?'扣'+loss+'分':'不扣')+'</option>';}).join('')+(value&&!statuses.includes(value)?'<option selected value="'+esc(value)+'">历史原因（保留）</option>':'');
  }
  function confirmationText(m) {return m.ready?'记录已齐':'项目或考勤记录未齐';}
  function attendanceText(m){return '迟到'+m.lateCount+'次 · 早退'+m.earlyCount+'次 · 实际旷课'+m.truantCount+'次 · 折算'+m.convertedTruants+'次 · 合计'+m.effectiveTruants+'次旷课（含折算）'+(m.attendanceFailed?'；考勤挂科':'');}
  function neededText(m){return m.needed>100?'超过100，无法达到':String(m.needed);}
  function renderRank(ctx) {
    var cls=ctx.cls,cfg=settings(cls),ms=rows(cls,ctx.lessons,ctx.raw);
    /* 显示层（2026-11-09 完成率改革）：当前累计与考勤按百分比显示；存储与公式不动 */
    var semesterMax=ctx.lessons.reduce(function(a,l){return a+5*namedCount(l);},0)+(ctx.lessons.length?5:0);
    function memberRate(m){return semesterMax?round(Math.max(0,m.total)/semesterMax*100):0;}
    function attPct(v){return round(Math.max(0,Math.min(9,Number(v)||0))/9*100);}
    ctx.root.innerHTML='<details class="rank-note"><summary>平时分说明：项目与考勤合并完成率，无基础赠分</summary><p>项目与考勤统一按完成率计算。「值日缺勤」是整学期一次 5 分项目：一学期没缺勤就是 100%，每节课都显示同一个学期值；值日组缺勤时老师点一次「值日缺勤」，全组每人 −20%（团队绑定，要扣都扣），第二次轮到值日再缺勤还能再扣，按组累计、最低 0%。每节课的满分只有「5 × 已命名项目数」（任一组新增命名个人项目，全班分母同步增加一档满分）；手机未入袋和个人扣分从本节项目分里扣，每次 −20%，扣完为止、不跨课。</p><p>项目完成率＝max(0,min(1,项目净得分÷项目满分))。整学期分母＝5（值日缺勤，只算一次）＋Σ每课 5×已命名项目数；所以项目越多分母越大，但不会再因为每节课白送 5 分把项目分的比重稀释掉。全组扣分从每位成员身上扣，个人扣分只扣本人。</p><p>考勤是学期固定项目，满分折 100%（9 分制扣分，如扣 1 分 ≈ 88.9%）：考勤分＝max(0,9−个人累计考勤扣分)，扣完后标记考勤挂科。迟到、早退、旷课和自定义原因按本班设置直接扣考勤分；请假默认不扣。折算的旷课次数只用于挂科标记，不再次扣分。迟到＋早退按设置次数折算旷课；实际旷课＋折算旷课达到设置门槛，姓名标红并标记考勤挂科。</p><p>平时分＝100×合并完成率；总评贡献＝平时分×40%，满分40。期末至少需考＝max(0,(及格线−平时分×0.4)÷0.6)，向上取0.1分。例如项目净得50%且考勤满分时，合并完成率=(50%×10+9)÷(10+9)≈73.7%，平时分73.7；项目和考勤均满分时平时分100。考勤挂科时目标不适用。</p><p>未编辑考勤默认到课。考勤归零或实际加折算旷课达到门槛，开启判定时姓名标红。</p></details><div class="assessment-actions"><button class="btn" id="assessmentGoAttendance">考勤与规则</button><button class="btn" id="assessmentExport">导出综合成绩CSV</button></div><p class="note">窄屏可左右滑动表格查看实际期末与综合成绩。</p><div class="assessment-scroll" tabindex="0" role="region" aria-label="成绩表，可左右滚动"><table class="data assessment-table"><thead><tr><th>展示名次</th><th>姓名 / 学号</th><th>小组</th><th>当前累计</th><th>项目完成率</th><th>考勤完成率</th><th class="grade-regular">平时分（合并完成率）</th><th class="grade-contribution">计入总评 /40</th><th class="grade-needed">期末至少需考 /100</th><th>实际期末</th><th>综合/100</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td><b class="'+(m.attendanceFailed?'attendance-failed':'')+'">'+esc(m.name)+'</b><small>'+esc(m.sid||m.no||'')+'</small></td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><b>'+(semesterMax?memberRate(m)+'%':'—')+'</b><small>全组 '+(semesterMax?round(Math.max(0,m.groupScore)/semesterMax*100)+'%':'—')+' · 个人项目 '+(semesterMax?round(Math.max(0,m.project)/semesterMax*100)+'%':'—')+' · 扣 '+(semesterMax?round(Math.max(0,m.personal)/semesterMax*100)+'%':'—')+'</small></td><td>'+round(m.task.rate*100)+'%<small>项目 '+m.task.earned+'/'+m.task.maximum+'<br>考勤完成率 '+attPct(m.attendance)+'%<br>合并完成率 '+round(m.performanceRate*100)+'%'+(m.task.pending?' · '+m.task.pending+'项待批改':'')+(!m.task.maximum?' · 未设置有效任务':'')+'</small></td><td>'+attPct(m.attendance)+'%<small>'+m.recorded+'/'+ctx.lessons.length+'课已登记 · 扣'+m.loss+'分（9分制）<br>'+esc(attendanceText(m))+'</small></td><td class="grade-regular"><strong class="grade-value">'+m.regular+' <span class="completion-rate">（'+(m.totalMaximum?Math.round(m.performanceRate*1000)/10+'%':'—')+'）</span></strong><small>达到及格线所需</small>'+(!m.ready?'<small>预估</small>':'')+'</td><td class="grade-contribution">'+m.contribution+'</td><td class="grade-needed">'+neededText(m)+'</td><td><input class="assessment-exam" aria-label="'+esc(m.name)+' 实际期末成绩" data-exam-key="'+esc(m.key)+'" type="number" min="0" max="100" step="0.1" value="'+m.exam+'" placeholder="待考"></td><td>'+(m.attendanceFailed?'考勤挂科'+(m.final==null?'':'<small>数值参考 '+m.final+'</small>'):m.final==null?'—':m.final)+(!m.ready&&m.final!==null?'<small>待复核</small>':'')+'</td></tr>';}).join('')+'</tbody></table></div><p class="rank-note">项目与考勤合并为0–100分，无60分保底。按本班设置的实际＋折算旷课门槛判定考勤挂科，不以数值总分代替资格判定。排名仅展示，不改变他人分数。及格线'+cfg.passScore+'，期末需考向上取到0.1分。共'+ms.length+'人（含待分配），计划'+cfg.totalLessons+'课。</p>';
    // Keep the three student-facing outcomes beside the name; evidence follows.
    ctx.root.querySelectorAll('.assessment-table tr').forEach(function(row){var cells=Array.from(row.children);[0,1,6,7,8,2,3,4,5,9,10].forEach(function(i){row.appendChild(cells[i]);});});
    ctx.root.querySelector('#assessmentGoAttendance').onclick=ctx.openAttendance;
    ctx.root.querySelectorAll('[data-exam-key]').forEach(function(input){input.onchange=function(){var v=input.value===''?null:Number(input.value);if(v!==null&&(!Number.isFinite(v)||v<0||v>100)){ctx.message('期末成绩须为0–100分。');return;}var old=cls.examScores&&cls.examScores[input.dataset.examKey];if((old==null?null:old)===v)return;var member=ms.find(function(m){return m.key===input.dataset.examKey;});if(!cls.examScores)cls.examScores={};if(v===null)delete cls.examScores[input.dataset.examKey];else cls.examScores[input.dataset.examKey]=v;ctx.log('期末成绩',cls.name+' · '+member.name+'：'+(old==null?'未填':old)+' → '+(v===null?'未填':v));member.exam=v===null?'':v;member.final=v===null?null:round(member.regular*.4+v*.6);var cell=input.closest('td').nextElementSibling;cell.innerHTML=(member.attendanceFailed?'考勤挂科'+(member.final==null?'':'<small>数值参考 '+member.final+'</small>'):member.final==null?'—':member.final)+(!member.ready&&member.final!==null?'<small>待复核</small>':'');ctx.save();};});
    ctx.root.querySelector('#assessmentExport').onclick=function(){ctx.export(cls.name+'_综合成绩.csv',[['展示名次','姓名','学号','小组','当前累计完成率','项目净得分','项目满分','待批改数','项目完成率','考勤得分','考勤满分','考勤完成率','合并完成率','小组项目净分（%）','平时分/100','折合/40','期末需考','实际期末','综合/100','资料齐全','考勤判定','迟到次数','早退次数','实际旷课次数','折算旷课次数','合计旷课次数']].concat(ms.map(function(m){return [m.rank,m.name,m.sid||m.no||'',m.gno||'待分配',semesterMax?memberRate(m)+'%':'—',m.task.earned,m.task.maximum,m.task.pending,round(m.task.rate*100)+'%',m.attendance,m.attendanceMaximum,round(m.attendanceRate*100)+'%',m.totalMaximum?round(m.performanceRate*100)+'%':'—',semesterMax?round(Math.max(0,m.bonus)/semesterMax*100)+'%':'—',m.regular,m.contribution,neededText(m),m.exam,m.attendanceFailed?'考勤挂科（数值参考：'+(m.final==null?'待考':m.final)+'）':m.final==null?'':m.final,m.ready?'是':'否，预估待复核',m.attendanceFailed?'考勤挂科':'未触发',m.lateCount,m.earlyCount,m.truantCount,m.convertedTruants,m.effectiveTruants];})));};
  }

  /* 个人详细分 · 平铺版（2026-11-10 #14）：
     把原来横向滚动的成绩表改成「每个学生一张卡片」纵向平铺，网页整体下滑，不用内部翻页。
     每张卡：名次 + 姓名/学号 + 组号（含组员名单）→ 平时分/折合/期末需考/综合 四个大数字 →
     每节课的项目完成率小标签 → 实际期末输入 + 记录状态。
     保留期末成绩输入（data-exam-key）和 CSV 导出，和 renderRank 同一套数据口径。 */
  function renderDetail(ctx) {
    var cls=ctx.cls,cfg=settings(cls),ms=rows(cls,ctx.lessons,ctx.raw);
    /* 排序（2026-11-10 #14）：rows() 内部已按平时分降序排好（rank 即平时分名次）。
       ctx.sort==='group' 时改为按组号升序、组内按平时分降序；'regular' 保持平时分降序不变。 */
    var dispRank;  // 每张卡左上角展示的「名次」：按组 = 组内名次；按平时分 = 全班名次
    if(ctx.sort==='group'){
      ms=ms.slice().sort(function(a,b){
        var ga=a.gno?Number(a.gno):Infinity,gb=b.gno?Number(b.gno):Infinity;
        return ga-gb || b.regular-a.regular || a.rawRank-b.rawRank;
      });
      /* 组内名次：同一组内按平时分降序编号（并列同名次），待分配组放在最末、按平时分编号 */
      var lastGno=null, lastRank=0, lastReg=null;
      ms.forEach(function(m){
        var g=m.gno?Number(m.gno):Infinity;
        if(g!==lastGno){ lastGno=g; lastRank=0; lastReg=null; }
        if(m.regular===lastReg){ m.dispRank=lastRank; }
        else { lastRank++; m.dispRank=lastRank; lastReg=m.regular; }
      });
      dispRank=function(m){ return m.dispRank; };
    } else {
      ms=ms.slice().sort(function(a,b){return b.regular-a.regular||a.rawRank-b.rawRank;});
      dispRank=function(m){ return m.rank; };
    }
    var semesterMax=ctx.lessons.reduce(function(a,l){return a+5*namedCount(l);},0)+(ctx.lessons.length?5:0);
    function memberRate(m){return semesterMax?round(Math.max(0,m.total)/semesterMax*100):0;}
    /* 每课的项目完成率：本节项目净得分 ÷（5 × 已命名项目数）；没记分或没命名项目返回 null */
    function lessonRate(m,l){
      var recorded=Object.keys(l.scores||{}).length||Object.keys(l.leaderScores||{}).length;
      if(!recorded||!namedCount(l))return null;
      var rec=lessonNet(l,m.gno,Number.isInteger(m.memberIndex)?m.memberIndex:-1,m.key);
      return round(Math.max(0,Math.min(100,rec.earned/rec.max*100)));
    }
    /* 组员名单（只名字），组内按顺序 */
    function groupMates(gno){
      var g=(cls.groups||[]).filter(function(x){return x.no===gno;})[0];
      if(!g)return '';
      return (g.members||[]).filter(function(x){return x.name;}).map(function(x){return x.name;}).join('、');
    }

    var cards = ms.map(function(m){
      var lessonTags = ctx.lessons.map(function(l){
        var r = lessonRate(m,l);
        return '<span class="dt-lesson'+(r==null?' none':'')+'" title="第 '+l.seq+' 课'+(l.date?' · '+l.date:'')+(r==null?'：还没记分':('：完成率 '+r+'%'))+'">第'+l.seq+'课'+(r==null?'<em>—</em>':'<em>'+r+'%</em>')+'</span>';
      }).join('');
      var mates = groupMates(m.gno);
      var rk = dispRank(m);
      var rkTitle = (ctx.sort==='group' ? '组内第 ' : '全班第 ') + rk + ' 名（平时分 ' + numGrade(m.regular) + '）';
      /* 名次徽章（2026-11-11 #15）：原来是光秃秃一个绿色方块数字，老师看不出它是排位序号。
         改成「第 N 名」胶囊；前三名金银铜，其余中性灰。按组排序时写「组内第 N 名」，免得和全班名次混。 */
      var rkText = (ctx.sort==='group' ? '组内第' : '第') + rk + '名';
      var rkClass = 'dt-rank' + (rk<=3 ? ' rk-'+rk : '');
      return '<div class="dt-card">' +
        '<div class="dt-head">' +
          '<span class="'+rkClass+'" title="'+esc(rkTitle)+'">'+esc(rkText)+'</span>' +
          '<span class="dt-name'+(m.attendanceFailed?' attendance-failed':'')+'">'+esc(m.name)+'<small>'+esc(m.sid||m.no||'')+'</small></span>' +
          '<span class="dt-group">'+(m.gno?'第 '+m.gno+' 组':'待分配')+(mates?'<small title="'+esc(mates)+'">'+esc(mates)+'</small>':'')+'</span>' +
        '</div>' +
        '<div class="dt-grades">' +
          '<div class="dt-grade g-regular"><em>'+numGrade(m.regular)+'</em><span>平时分 /100</span></div>' +
          '<div class="dt-grade g-contribution"><em>'+numGrade(m.contribution)+'</em><span>计入总评 /40</span></div>' +
          '<div class="dt-grade g-needed"><em>'+(m.attendanceFailed?'挂科':(m.needed==null?'—':(m.needed>100?'&gt;100':numGrade(m.needed))))+'</em><span>期末至少需考</span></div>' +
          '<div class="dt-grade g-final'+(m.final!=null&&m.final>=cfg.passScore?' good':(m.final!=null?' bad':''))+'"><em>'+(m.attendanceFailed?'挂科':(m.final==null?'—':numGrade(m.final)))+'</em><span>综合 /100</span></div>' +
        '</div>' +
        '<div class="dt-lessons">'+lessonTags+'</div>' +
        '<div class="dt-foot">' +
          '<span class="dt-exam">实际期末 <input data-exam-key="'+esc(m.key)+'" inputmode="decimal" placeholder="未录" value="'+(m.exam===''?'':esc(m.exam))+'"></span>' +
          '<span class="dt-status">'+esc(confirmationText(m))+(m.ready?' · 已齐':' · 预估')+'</span>' +
        '</div>' +
      '</div>';
    }).join('');

    /* 结构（2026-11-11 #15）：单列从上往下，.dt-list 一行一张卡，顺序就是上面的 ms 顺序（第 1 名→最后一名）。
       顶部两个操作按钮（考勤与规则 / 导出 CSV）已挪到 index.html 的 .rank-primary-head 里和排序按钮同一行，
       这里只负责找到它们绑事件；万一页面结构不同（预览/测试）拿不到就跳过，不报错。 */
    ctx.root.innerHTML =
      '<p class="note">个人详细分：从上往下就是名次，第 1 名在最上面。每一课的小标签是该课的项目完成率（没记分显示 —）。' +
      '平时分＝100×合并完成率，期末至少需考＝(及格线−平时分×0.4)÷0.6，综合＝平时折合＋期末折合。</p>' +
      '<div class="dt-list">'+cards+'</div>' +
      (ms.length?'':'<p class="note">还没有分好组的学生。</p>');

    var actionHost = (ctx.root.closest && ctx.root.closest('.rank-primary')) || ctx.root;
    var goBtn = actionHost.querySelector('#assessmentGoAttendance');
    if (goBtn) goBtn.onclick = ctx.openAttendance;
    /* 期末成绩输入：和 renderRank 同一套逻辑，改完即存、即算综合 */
    ctx.root.querySelectorAll('[data-exam-key]').forEach(function(input){input.onchange=function(){
      var v=input.value===''?null:Number(input.value);
      if(v!==null&&(!Number.isFinite(v)||v<0||v>100)){ctx.message('期末成绩须为0–100分。');input.value=memoExam(cls,input.dataset.examKey);return;}
      var old=cls.examScores&&cls.examScores[input.dataset.examKey];
      if((old==null?null:old)===v)return;
      var member=ms.find(function(m){return m.key===input.dataset.examKey;});
      if(!cls.examScores)cls.examScores={};
      if(v===null)delete cls.examScores[input.dataset.examKey];else cls.examScores[input.dataset.examKey]=v;
      ctx.log('期末成绩',cls.name+' · '+member.name+'：'+(old==null?'未填':old)+' → '+(v===null?'未填':v));
      member.exam=v===null?'':v;member.final=v===null?null:round(member.regular*.4+v*.6);
      var card=input.closest('.dt-card'),finalEl=card&&card.querySelector('.g-final em');
      if(finalEl)finalEl.textContent=member.attendanceFailed?'挂科':(member.final==null?'—':numGrade(member.final));
      ctx.save();
    };});
    var exportBtn = actionHost.querySelector('#assessmentExport');
    if (exportBtn) exportBtn.onclick=function(){ctx.export(cls.name+'_综合成绩.csv',[['展示名次','姓名','学号','小组','当前累计完成率','项目净得分','项目满分','待批改数','项目完成率','考勤得分','考勤满分','考勤完成率','合并完成率','小组项目净分（%）','平时分/100','折合/40','期末需考','实际期末','综合/100','资料齐全','考勤判定','迟到次数','早退次数','实际旷课次数','折算旷课次数','合计旷课次数']].concat(ms.map(function(m){return [m.rank,m.name,m.sid||m.no||'',m.gno||'待分配',semesterMax?memberRate(m)+'%':'—',m.task.earned,m.task.maximum,m.task.pending,round(m.task.rate*100)+'%',m.attendance,m.attendanceMaximum,round(m.attendanceRate*100)+'%',m.totalMaximum?round(m.performanceRate*100)+'%':'—',semesterMax?round(Math.max(0,m.bonus)/semesterMax*100)+'%':'—',m.regular,m.contribution,neededText(m),m.exam,m.attendanceFailed?'考勤挂科（数值参考：'+(m.final==null?'待考':m.final)+'）':m.final==null?'':m.final,m.ready?'是':'否，预估待复核',m.attendanceFailed?'考勤挂科':'未触发',m.lateCount,m.earlyCount,m.truantCount,m.convertedTruants,m.effectiveTruants];})));};
  }
  /* 数字显示：整数不带小数点，其余留一位；NaN/空显示 — */
  function numGrade(n){ if(n==null||n===''||!isFinite(n))return '—'; var v=round(n); return v%1===0?String(v):v.toFixed(1); }
  function memoExam(cls,key){ var v=cls.examScores&&cls.examScores[key]; return v==null?'':String(v); }
  /* 从考勤工具导入本课（K9）：只往页面下拉里填，标成未保存，老师点「保存本课考勤」才写入 */
  var attMap={present:'present',late:'late',early:'early',absent:'truant',personal:'leave',sick:'leave'};
  function importBlock(ctx){if(!ctx.cloud)return '登录教师账号后才能从考勤工具导入';if(!Number(ctx.cls&&ctx.cls.hxClassId))return '本班没有对应首页班级，不能从考勤工具导入';return '';}
  function importStatus(status,cfg){if(status==='sick'){var r=(cfg.customRules||[]).find(function(r){return r.name==='病假';});if(r)return r.id;}return attMap[status]||null;}
  /* 课程里带本班的（含合班带上的），逐门取考勤表，找 day 与课次日期同一天的签到 */
  function importFind(rpc,hxId,date){
    return rpc('hx_att_course_list',{}).then(function(courses){
      var mine=(courses||[]).filter(function(c){return (c.classes||[]).some(function(x){return Number(x.id)===hxId;})||(c.class_ids||[]).some(function(x){return Number(x)===hxId;});});
      return Promise.all(mine.map(function(c){return rpc('hx_att_sheet',{p_course:c.id}).then(function(sheet){return (sheet&&sheet.sessions||[]).filter(function(x){return String(x.day||'').slice(0,10)===String(date||'');}).map(function(x){return {course:c,sheet:sheet,session:x};});});}));
    }).then(function(lists){return [].concat.apply([],lists).sort(function(a,b){return String(a.session.started_at||'').localeCompare(String(b.session.started_at||''));});});
  }
  /* 学生对应：先认首页学生 id（hxStudentId），再认学号；只在本班的考勤学生里找 */
  function importPlan(students,sheet,session,hxId,cfg){
    var mine=(sheet.students||[]).filter(function(s){return Number(s.class_id)===hxId;}),byId={},byNo={},marks=(sheet.marks||{})[String(session.id)]||{},out={fill:[],unmatched:[],pending:0};
    mine.forEach(function(s){byId[String(s.id)]=s;var no=String(s.no==null?'':s.no).trim();if(no)byNo[no]=s;});
    students.forEach(function(m){
      var st=(m.hxStudentId!=null&&byId[String(m.hxStudentId)])||(m.sid&&byNo[String(m.sid).trim()])||null;
      if(!st){out.unmatched.push(m.name);return;}
      var raw=marks[String(st.id)];if(raw==null){out.pending++;return;}
      var status=importStatus(raw,cfg);if(status)out.fill.push({key:m.key,status:status,from:raw});
    });
    return out;
  }
  function importTime(iso){var d=new Date(iso);if(isNaN(d))return '';var p=function(n){return (n<10?'0':'')+n;};return p(d.getHours())+':'+p(d.getMinutes());}
  function importPick(found,done){
    var dlg=document.createElement('dialog');dlg.id='attendanceImportDlg';
    dlg.innerHTML='<div class="dlg"><div class="dlg-head"><h3>这一天有多次签到，导入哪一次？</h3><button type="button" class="dlg-x" aria-label="关闭" data-att-pick-x>×</button></div><div class="dlg-body">'+found.map(function(h,i){return '<button type="button" class="btn" data-att-pick="'+i+'">'+esc(h.course.name)+' · 第'+esc(h.session.seq)+'次 · '+esc(importTime(h.session.started_at))+' 开始</button>';}).join('')+'</div></div>';
    document.body.appendChild(dlg);
    var close=function(){try{dlg.close();}catch(e){}dlg.remove();};
    dlg.querySelector('[data-att-pick-x]').onclick=close;dlg.addEventListener('cancel',function(){setTimeout(close,0);});
    dlg.querySelectorAll('[data-att-pick]').forEach(function(b){b.onclick=function(){close();done(found[Number(b.dataset.attPick)]);};});
    if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','');
  }
  function renderAttendance(ctx) {
    var cls=ctx.cls,cfg=settings(cls),students=roster(cls,ctx.raw),lesson=ctx.lesson;
    ctx.root.innerHTML='<h2 class="sec-title">考勤与扣分设置</h2><div class="card lesson-bar"><label class="field">班级<select id="attendanceClassSel">'+ctx.classes.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===cls.id?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label><label class="field">课次<select id="attendanceLessonSel"'+(!ctx.lessons.length?' disabled':'')+'>'+(!ctx.lessons.length?'<option>暂无课次</option>':ctx.lessons.map(function(l){return '<option value="'+esc(l.id)+'"'+(lesson&&l.id===lesson.id?' selected':'')+'>第'+l.seq+'次 · '+esc(l.date)+'</option>';}).join(''))+'</select></label></div><details class="card assessment-settings"><summary>本班赋分与考勤规则</summary><form id="assessmentSettingsForm"><div class="assessment-settings-grid">'+[['totalLessons','计划大节课数（每节80分钟）',1,1000],['late','迟到扣分（9分中）',0,100],['truant','旷课扣分（9分中）',0,100],['leave','请假扣分（9分中）',0,100],['early','早退扣分（9分中）',0,100],['passScore','综合及格线',0,100],['lateEarlyConversion','迟到早退几次折1次旷课（仅用于挂科）',1,100],['truantFailure','合计旷课几次标记挂科',1,100]].map(function(f){return '<label class="field col">'+f[1]+'<input name="'+f[0]+'" type="number" step="1" min="'+f[2]+'" max="'+f[3]+'" value="'+cfg[f[0]]+'" required></label>';}).join('')+'</div><p class="note">考勤按 9 分制单独记录（如扣 1 分 ≈ 88.9%），2026-11-10 起不再计入平时分，只用于挂科标记。当前折算门槛'+cfg.lateEarlyConversion+'次、挂科门槛'+cfg.truantFailure+'次，标记'+(cfg.attendanceFailureEnabled?'开启':'关闭')+'。默认24大节＝48课时；迟到、早退、旷课和自定义原因按设置直接扣考勤分，请假默认不扣。迟到＋早退按设置次数折旷课，只用于挂科门槛，不重复扣分；实际＋折算旷课达到设置门槛时标红。分母为每节「5×已命名项目数」＋整学期值日缺勤 5 分（只算一次）；分子为扣分后的项目净得分。值日缺勤已合并原「干净又卫生」：整学期一个 5 分项目，一学期没缺勤就是 100%；值日组缺勤由老师点「每人 −20%」，全组每人同扣（20% 一档、按次叠加、封顶 5 档），只扣这整学期的 5 分，不摊回单节课。全组扣分与个人扣分从本节项目分里扣，扣完为止、不跨课。平时分=100×项目完成率，折合分=平时分×40%，期末目标=(及格线−折合分)÷60%，向上取0.1。考勤单独记录（2026-11-10 起不再计入平时分），只用于挂科标记。新命名项目立即计入全组每名学生当前完成率；尚未录入的项目分按 0% 显示预测，后续录入即重算。</p><label><input type="checkbox" id="attendanceFailureEnabled"'+(cfg.attendanceFailureEnabled?' checked':'')+'>启用考勤挂科标记</label><button type="submit" class="btn primary">保存本班规则</button></form><h4>自定义原因</h4><div id="attendanceCustomRules">'+(cfg.customRules||[]).map(function(r){return '<span class="attendance-rule">'+esc(r.name)+' · 扣'+r.loss+'分 <button class="btn tiny" data-remove-rule="'+esc(r.id)+'" title="停用规则，历史记录保留">停用</button></span>';}).join('')+'</div><form id="attendanceCustomForm" class="btnrow"><input id="attendanceCustomName" aria-label="自定义考勤原因" maxlength="40" placeholder="例如：未到原因" required><input id="attendanceCustomLoss" aria-label="自定义扣分" type="number" min="0" max="100" step="1" value="1" required><button class="btn" type="submit">添加原因</button></form></details><p class="note">按课次保存，包含未分组人员。默认到课不伪造出勤记录；修改此表只影响考勤模块，不重复扣课堂积分。</p>'+(lesson?'<div class="card"><div class="assessment-actions"><input id="attendanceSearch" aria-label="搜索考勤学生" placeholder="姓名 / 学号"><label><input id="attendanceSelectAll" type="checkbox">全选可见</label><select id="attendanceBatchStatus" aria-label="批量考勤状态">'+options(cfg,'')+'</select><button id="attendanceApplyBatch" class="btn">应用到所选</button><button id="attendanceImport" class="btn" type="button"'+(importBlock(ctx)?' disabled title="'+esc(importBlock(ctx))+'"':'')+'>从考勤工具导入本课</button><button id="attendanceSave" class="btn primary">保存本课考勤</button></div><p id="attendanceDirty" class="note" role="status">没有未保存的考勤改动。</p><p id="attendanceImportNote" class="note" role="status"'+(importBlock(ctx)?'>'+esc(importBlock(ctx)):' hidden>')+'</p><div class="assessment-scroll"><table class="data attendance-table"><thead><tr><th>选择</th><th>姓名</th><th>学号</th><th>小组</th><th>本课状态</th><th>已保存扣分</th></tr></thead><tbody>'+students.map(function(m){var a=lesson.attendance&&lesson.attendance[m.key];return '<tr data-att-row><td><input type="checkbox" data-att-check="'+esc(m.key)+'" aria-label="选择'+esc(m.name)+'"></td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+(m.gno?'第'+m.gno+'组':'待分配')+'</td><td><select data-att-key="'+esc(m.key)+'" aria-label="'+esc(m.name)+' 考勤">'+options(cfg,a&&a.status)+'</select>'+(a&&!labels[a.status]&&!(cfg.customRules||[]).some(function(r){return r.id===a.status;})?'<small>历史原因：'+esc(a.label)+'（保留）</small>':'')+'</td><td>'+(a?a.loss:0)+'</td></tr>';}).join('')+'</tbody></table></div></div>':'<p class="card">请先在上课记分中新开一课，再登记考勤。</p>');
    var dirty=false,changed=new Set();
    function mark(){dirty=true;var el=ctx.root.querySelector('#attendanceDirty');if(el)el.textContent='有未保存的考勤改动，请点击保存本课考勤。';}
    function guard(){if(dirty){ctx.message('请先保存本课考勤，再切换班级或课次。');return false;}return true;}
    ctx.root.querySelector('#attendanceClassSel').onchange=function(){if(!guard()){this.value=cls.id;return;}ctx.select(this.value,null);};
    ctx.root.querySelector('#attendanceLessonSel').onchange=function(){if(!guard()){this.value=lesson.id;return;}ctx.select(cls.id,this.value);};
    ctx.root.querySelector('#assessmentSettingsForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var next=Object.assign({},cfg);for(var name of ['totalLessons','late','truant','leave','early','passScore','lateEarlyConversion','truantFailure']){var input=this.elements.namedItem(name),v=Number(input.value);if(!Number.isInteger(v)||v<Number(input.min)||v>Number(input.max)){ctx.message('请填写范围内的整数。');return;}next[name]=v;}next.attendanceFailureEnabled=ctx.root.querySelector('#attendanceFailureEnabled').checked;cls.assessmentSettings=next;cfg=next;ctx.log('考勤规则',cls.name+' · 计划'+next.totalLessons+'课；迟到'+next.late+'，旷课'+next.truant+'，请假'+next.leave+'，早退'+next.early+'分；及格线'+next.passScore);ctx.save();ctx.message('本班规则已保存。');};
    ctx.root.querySelector('#attendanceCustomForm').onsubmit=function(e){e.preventDefault();if(!guard())return;var name=ctx.root.querySelector('#attendanceCustomName').value.trim(),loss=Number(ctx.root.querySelector('#attendanceCustomLoss').value);if(!name||name.length>40||!Number.isInteger(loss)||loss<0||loss>100||Object.keys(labels).some(function(s){return labels[s]===name;})||(cfg.customRules||[]).some(function(r){return r.name===name;})||(cfg.customRules||[]).length>=20){ctx.message('原因须唯一，最多20项，扣分为0–100整数。');return;}var next=Object.assign({},cfg,{customRules:(cfg.customRules||[]).concat([{id:'custom_'+Date.now().toString(36),name:name,loss:loss}])});cls.assessmentSettings=next;ctx.log('考勤规则',cls.name+' · 新增'+name+'：扣'+loss+'分');ctx.save();renderAttendance(ctx);};
    ctx.root.querySelectorAll('[data-remove-rule]').forEach(function(b){b.onclick=function(){if(!guard())return;cls.assessmentSettings=Object.assign({},cfg,{customRules:(cfg.customRules||[]).filter(function(r){return r.id!==b.dataset.removeRule;})});ctx.log('考勤规则',cls.name+' · 停用自定义原因，历史保留');ctx.save();renderAttendance(ctx);};});
    if(!lesson)return;
    ctx.root.querySelector('#attendanceSearch').oninput=function(){var q=this.value.trim().toLowerCase();ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){tr.hidden=!tr.textContent.toLowerCase().includes(q);});};
    ctx.root.querySelector('#attendanceSelectAll').onchange=function(){var checked=this.checked;ctx.root.querySelectorAll('[data-att-row]').forEach(function(tr){if(!tr.hidden)tr.querySelector('[data-att-check]').checked=checked;});};
    ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){input.onchange=function(){changed.add(input.dataset.attKey);mark();};});
    ctx.root.querySelector('#attendanceApplyBatch').onclick=function(){var value=ctx.root.querySelector('#attendanceBatchStatus').value,count=0;ctx.root.querySelectorAll('[data-att-check]:checked').forEach(function(check){var tr=check.closest('tr');if(!tr.hidden){tr.querySelector('[data-att-key]').value=value;changed.add(check.dataset.attCheck);count++;}});if(count)mark();else ctx.message('请先选择学生。');};
    ctx.root.querySelector('#attendanceSave').onclick=function(){if(!dirty){ctx.message('没有考勤改动需要保存。');return;}if(!lesson.attendance)lesson.attendance={};var current=settings(cls),details=[];ctx.root.querySelectorAll('[data-att-key]').forEach(function(input){var k=input.dataset.attKey;if(!changed.has(k))return;var old=lesson.attendance[k],status=input.value,m=students.find(function(m){return m.key===k;});if(status){lesson.attendance[k]={status:status,label:statusName(status,current),loss:deduction(status,current),updatedAt:new Date().toISOString()};}else delete lesson.attendance[k];details.push(m.name+'：'+(old?old.label:'未记录')+' → '+(status?statusName(status,current)+'（扣'+deduction(status,current)+'分）':'未记录'));});ctx.log('考勤',cls.name+' · 第'+lesson.seq+'次 · '+lesson.date+' · '+details.join('；'));ctx.save();dirty=false;ctx.message('本课考勤已保存，平时分已实时重算。');renderAttendance(ctx);};
    ctx.root.querySelector('#attendanceImport').onclick=function(){
      var btn=this,note=ctx.root.querySelector('#attendanceImportNote');if(importBlock(ctx))return;
      btn.disabled=true;note.hidden=false;note.textContent='正在读取考勤工具…';
      importFind(ctx.cloud,Number(cls.hxClassId),lesson.date).then(function(found){
        btn.disabled=false;
        if(!found.length){note.textContent='考勤工具里没有 '+lesson.date+' 这个班的签到。';return;}
        if(found.length===1){fill(found[0]);return;}
        note.textContent='这一天有 '+found.length+' 次签到，请选择要导入哪一次。';
        importPick(found,fill);
      },function(e){btn.disabled=false;note.textContent='读取考勤工具失败：'+((e&&e.message)||'网络错误');});
      function fill(hit){
        var plan=importPlan(students,hit.sheet,hit.session,Number(cls.hxClassId),settings(cls)),n=0;
        plan.fill.forEach(function(x){var sel=ctx.root.querySelector('[data-att-key="'+(window.CSS&&CSS.escape?CSS.escape(x.key):x.key)+'"]');if(!sel)return;sel.value=x.status;changed.add(x.key);n++;});
        if(n)mark();
        note.hidden=false;note.textContent='已从考勤工具填入 '+n+' 人（'+hit.course.name+' · 第'+hit.session.seq+'次），核对后点保存本课考勤。'+(plan.pending?' 进行中还没签的 '+plan.pending+' 人没动。':'')+(plan.unmatched.length?' 未匹配：'+plan.unmatched.join('、')+'。':'');
      }
    };
    ctx.isDirty=function(){return dirty;};
  }
  function printHtml(cls,lessons,raw) {
    var ms=rows(cls,lessons,raw);
    /* 显示层（2026-11-09 完成率改革）：当前累计与考勤按百分比显示，存储与公式不动 */
    var semesterMax=lessons.reduce(function(a,l){return a+5*namedCount(l);},0)+(lessons.length?5:0);
    function memberRate(m){return semesterMax?round(Math.max(0,m.total)/semesterMax*100)+'%':'—';}
    function attPct(v){return round(Math.max(0,Math.min(9,Number(v)||0))/9*100)+'%';}
    return '<h2>平时赋分与期末测算</h2><p>项目与考勤合并为0–100完成率；考勤是学期固定项目，满分折 100%（9 分制扣分）。迟到/早退合计3次折旷课1次，实际旷课＋折算旷课合计3次考勤挂科，折算不重复扣分；平时40%＋期末60%。名次只展示，未批改/考勤未齐为预估。</p><table><thead><tr><th>名次</th><th>姓名</th><th>学号</th><th>当前累计</th><th>项目完成率</th><th>考勤完成率</th><th>平时/100</th><th>折合/40</th><th>期末需考</th><th>实际期末</th><th>综合</th><th>记录状态</th></tr></thead><tbody>'+ms.map(function(m){return '<tr><td>'+m.rank+'</td><td>'+esc(m.name)+'</td><td>'+esc(m.sid||m.no||'')+'</td><td>'+memberRate(m)+'</td><td>'+round(m.task.rate*100)+'%<small>'+m.task.earned+'/'+m.task.maximum+'</small></td><td>'+attPct(m.attendance)+'<small>'+round(m.attendanceRate*100)+'%</small></td><td>'+m.regular+'<small>'+round(m.performanceRate*100)+'%</small></td><td>'+m.contribution+'</td><td>'+(neededText(m))+'</td><td>'+m.exam+'</td><td>'+(m.attendanceFailed?'考勤挂科'+(m.final==null?'':'<small>数值参考 '+m.final+'</small>'):m.final==null?'—':m.final)+'</td><td>'+esc(confirmationText(m))+(m.ready?' · 已齐':' · 预估')+'<br>'+esc(attendanceText(m))+'</td></tr>';}).join('')+'</tbody></table>';
  }
  root.JFDT_ASSESSMENT={groupNet:groupNet,namedCount:namedCount,lessonMax:lessonMax,dutyLoss:dutyLoss,dutyScore:dutyScore,lessonNet:lessonNet,projectNames:projectNames,printHtml:printHtml,taskEvidence:taskEvidence,key:key,ident:ident,settings:settings,roster:roster,rows:rows,deduction:deduction,renderRank:renderRank,renderDetail:renderDetail,renderAttendance:renderAttendance,importPlan:importPlan,importFind:importFind,importStatus:importStatus};
})(typeof window==='undefined'?globalThis:window);
