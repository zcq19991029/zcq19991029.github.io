/* One teacher-wide homepage; course detail pages retain their existing handlers. */
(function () {
  'use strict';
  const M=WeekTimetable,esc=escapeText;
  const query=new URLSearchParams(location.search),saved=sessionStorage.getItem('course_week_home');
  let selected=/^\d{4}-\d{2}-\d{2}$/.test(query.get('week')||'')?query.get('week'):(saved||isoToday());
  let events=[],search='',view='week',calendarMonth='';
  const board=document.createElement('div');board.id='teacherWeekHome';board.className='week-board';
  board.innerHTML='<div class="week-heading"><div><div class="week-eyebrow">MY TEACHING WEEK · 每周小计划</div><h2>🌷 本周课程表</h2><p class="week-sub" id="weekRange"></p></div><div class="week-controls"><button id="weekPrev" aria-label="上一周">← 上一周</button><button id="weekCurrent" class="week-today">回到本周</button><button id="weekNext" aria-label="下一周">下一周 →</button></div></div><div id="weekMetrics" class="week-metrics"></div><div id="weekLegend" class="week-key" aria-label="课程班级配色"></div><div id="weekAlerts" aria-live="polite"></div><div class="week-scroll" tabindex="0" aria-label="本周全部课程，窄窗口可横向滚动"><div class="week-grid" id="weekGrid"></div></div><div class="week-foot"><span>✦ 全部课程 · 点击课程卡片查看内容与实际记录</span><span>当前为本地教师视图，数据来自此浏览器；账号隔离将在 D1 阶段接入</span></div>';
  document.querySelector('.wrap').insertBefore(board,document.querySelector('body > .wrap > section.card'));
  const rail=document.createElement('aside');rail.className='teacher-rail';rail.hidden=true;board.after(rail);
  const toolbar=document.createElement('div');toolbar.innerHTML='<div class="teacher-mode"><button data-mode="week" class="active">▦ 周视图</button><button data-mode="list">☷ 列表视图</button></div><div class="teacher-day-strip">'+['周一','周二','周三','周四','周五','周六','周日'].map((d,i)=>'<button data-day="'+i+'">'+d+'</button>').join('')+'</div>';board.querySelector('.week-scroll').before(toolbar);
  const searchWrap=document.createElement('div');searchWrap.className='teacher-search-wrap';searchWrap.innerHTML='<input class="teacher-search" aria-label="搜索本周课程" placeholder="⌕ 搜索课程、班级或教室…"><span class="teacher-greeting">以教书育人 · 点亮更多可能 ✧</span>';document.querySelector('header.top').append(searchWrap);
  searchWrap.insertAdjacentHTML('beforeend','<span class="teacher-profile"><span><b>'+esc(window.CourseCloud?.teacher.name||'赵成乾')+'</b><small>'+ (window.CourseCloud?'教师 · 华夏云端':'教师 · 本地视图')+'</small></span></span>');
  searchWrap.querySelector('input').oninput=e=>{search=e.target.value.trim();paint();};
  toolbar.onclick=e=>{if(e.target.dataset.mode){view=e.target.dataset.mode;paint();}if(e.target.dataset.day){const i=Number(e.target.dataset.day),cell=$('weekGrid').querySelectorAll('.week-day')[i+1];cell?.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});toolbar.querySelectorAll('[data-day]').forEach(b=>b.classList.toggle('active',b===e.target));}};
  const dialog=document.createElement('dialog');dialog.id='weekLessonDialog';dialog.className='week-dialog';dialog.setAttribute('aria-label','课程详情');document.body.append(dialog);
  function allLessons(){return M.collect(MULTI_COURSES,TIMELINE,progressOf,getRec);}
  function updateUrl(){const url=new URL(location.href);url.searchParams.set('week',M.monday(selected));history.replaceState(null,'',url);sessionStorage.setItem('course_week_home',M.monday(selected));}
  function paint(){
    const all=allLessons(),w=M.week(all,selected),today=isoToday();renderRail(all,w,today);w.events=w.events.filter(s=>!search||[s.courseName,s.className,s.room,s.progress].join(' ').includes(search));events=w.events;
    const termWeek=weekOf(w.start),label=termWeek>0?'第 '+termWeek+' 周 · '+(termWeek%2?'单周':'双周'):'学期开始前';
    $('weekRange').textContent=w.start+' — '+w.end+' · '+label+' · 全部课程与班级';
    $('weekMetrics').innerHTML=[['lessons','次课'],['hours','课时'],['courses','门课程'],['classes','个课程班级']].map(([key,name])=>'<span><b>'+w.stats[key]+'</b>'+name+'</span>').join('');
    const groups=new Map(w.events.map(s=>[s.courseId+'|'+s.className,s]));
    $('weekLegend').innerHTML=[...groups.values()].map(s=>'<span style="background:'+s.color+'">'+esc(s.courseName)+' · '+esc(s.className)+'</span>').join('');
    $('weekAlerts').innerHTML=(w.pending.length?'<div class="week-alert">⏳ 本周原定课次中有 '+w.pending.length+' 次待定调课：'+w.pending.map(s=>esc(s.courseName+' '+s.className+' '+s.period)).join('、')+'。实际日期未确定，不计入有效课时。</div>':'')+(!w.stats.lessons?'<div class="week-alert">☁️ 这一周没有有效授课安排。可以切换其他周，或在课程设置中导入课表。</div>':'');
    const days=Array.from({length:7},(_,i)=>({date:M.add(w.start,i),...M.lanes(w.events.filter(s=>s.date===M.add(w.start,i)))}));
    let column=2;days.forEach(d=>{d.column=column;column+=d.count;});
    const maxPeriod=Math.max(10,...all.map(s=>s.end)),grid=$('weekGrid');
    grid.style.gridTemplateColumns='74px '+days.map(d=>'repeat('+d.count+',minmax(90px,1fr))').join(' ');
    grid.style.gridTemplateRows='60px repeat('+maxPeriod+',54px)';
    let html='<div class="week-cell week-day week-corner" style="grid-column:1;grid-row:1">节次</div>';
    const wd=['一','二','三','四','五','六','日'];
    days.forEach((d,i)=>{html+='<div class="week-cell week-day '+(d.date===today?'is-today':'')+'" style="grid-column:'+d.column+' / span '+d.count+';grid-row:1">星期'+wd[i]+'<small>'+d.date.slice(5)+(d.date===today?' · 今天':'')+'</small></div>';});
    for(let p=1;p<=maxPeriod;p++){
      if(p%2===1)html+='<div class="week-cell week-slot '+(p===5?'after-lunch':'')+'" style="grid-column:1;grid-row:'+(p+1)+' / span '+Math.min(2,maxPeriod-p+1)+'">第'+p+'–'+Math.min(p+1,maxPeriod)+'节</div>';
      days.forEach(d=>{html+='<div class="week-cell '+(d.date===today?'is-today ':'')+(p===5?'after-lunch':'')+'" style="grid-column:'+d.column+' / span '+d.count+';grid-row:'+(p+1)+'"></div>';});
    }
    days.forEach(d=>d.events.forEach(s=>{
      const i=events.findIndex(e=>e.id===s.id&&e.date===s.date&&e.ghost===s.ghost);
      html+='<button type="button" class="week-lesson '+(s.ghost?'is-ghost':'')+'" data-week-event="'+i+'" style="--lesson-color:'+s.color+';grid-column:'+(d.column+s.lane)+';grid-row:'+(s.start+1)+' / span '+(s.end-s.start+1)+'" aria-label="'+esc(s.courseName+' '+s.className+' '+s.date+' '+s.period+' '+s.status)+'"><strong>'+esc(s.courseName)+'</strong><span class="week-class">'+esc(s.className)+'</span><small>'+esc(s.period+' · '+(s.room||'教室待补充'))+'</small>'+(s.status!=='正常'?'<span class="week-status">'+esc(s.status)+(s.ghost&&s.actualDate!==s.originalDate?' → '+esc(s.actualDate||'日期待定'):'')+'</span>':'')+(s.conflict?'<span class="week-conflict">⚑ 授课时间冲突</span>':'')+(!s.ghost?'<span class="week-progress">'+esc(s.progress)+'</span>':'')+'</button>';
    }));
    if(view==='list'){grid.style.gridTemplateColumns='1fr';grid.style.gridTemplateRows='auto';html='<div class="teacher-list">'+events.map((s,i)=>'<button data-week-event="'+i+'" style="--lesson-color:'+s.color+'">'+esc(s.date+' · '+s.period+' · '+s.status)+'<b>'+esc(s.courseName+' · '+s.className)+'</b>'+esc(s.room+' · '+(s.ghost?'不计入有效课时':s.progress))+'</button>').join('')+(events.length?'':'<p>这一周没有匹配的课程。</p>')+'</div>';}
    toolbar.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===view));
    grid.innerHTML=html;grid.classList.remove('week-enter');void grid.offsetWidth;grid.classList.add('week-enter');
  }
  function renderRail(all,w,today){
    const current=M.week(all,today).events.filter(s=>s.date===today&&!s.ghost),active=w.events.filter(s=>!s.ghost),next=all.filter(s=>!s.canceled&&!s.pending&&s.actualDate>=today).sort((a,b)=>a.actualDate.localeCompare(b.actualDate)||a.start-b.start)[0];
    const courses=new Map();active.forEach(s=>courses.set(s.courseName,(courses.get(s.courseName)||0)+1));
    if(!calendarMonth)calendarMonth=w.start.slice(0,7);
    const first=M.date(calendarMonth+'-01'),offset=(first.getDay()+6)%7,last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
    let calendar=['一','二','三','四','五','六','日'].map(d=>'<span>'+d+'</span>').join('')+'<i></i>'.repeat(offset);
    for(let d=1;d<=last;d++){const date=calendarMonth+'-'+String(d).padStart(2,'0');calendar+='<button data-calendar-date="'+date+'" class="'+(date>=w.start&&date<=w.end?'in-week ':'')+(date===today?'is-today':'')+'">'+d+'</button>';}
    const conflicts=active.filter(s=>s.conflict).length,unrecorded=active.filter(s=>s.date<=today&&!s.actual).length;
    rail.innerHTML='<section class="teacher-panel today-panel"><h3>☀️ 今日概览 <small>'+today.slice(5)+'</small></h3><div class="teacher-mini-stats"><div class="teacher-mini-stat"><span class="stat-icon">📋</span><div><b>'+current.length+'</b><small>今日课程</small></div></div><div class="teacher-mini-stat"><span class="stat-icon">☕</span><div><b style="font-size:15px">'+(next?next.actualDate.slice(5):'暂无')+'</b><small>下一次授课</small></div></div></div><div class="teacher-today-list">'+current.map((s,i)=>'<button class="teacher-today-course" data-today="'+i+'"><b>● '+esc(s.courseName)+'</b><span>'+esc(s.className+' · '+s.period+' · '+(s.room||'教室待补充'))+'</span></button>').join('')+(current.length?'':'<div class="teacher-note">今天没有有效授课安排，享受一点留白 🌱</div>')+'</div></section><section class="teacher-panel"><h3>📊 本周统计 <small>'+w.start.slice(5)+' — '+w.end.slice(5)+'</small></h3><div class="teacher-stats-grid">'+[['📖',w.stats.lessons,'本周课程数'],['▦',w.stats.courses,'课程类型'],['👥',w.stats.classes,'课程班级'],['🔥',w.stats.hours,'本周课时']].map(([icon,n,label])=>'<div><span class="stat-icon">'+icon+'</span><div><b>'+n+'</b><small>'+label+'</small></div></div>').join('')+'</div></section><section class="teacher-panel teacher-course-panel"><h3>🎨 课程类型</h3>'+[...courses].map(([name,n])=>'<div class="teacher-course-row"><span class="teacher-dot" style="background:'+M.color(name)+'"></span>'+esc(name)+'<b>'+n+'</b></div>').join('')+(courses.size?'':'<div class="teacher-note">本周暂无课程</div>')+'</section><div class="teacher-bottom-panels"><section class="teacher-panel"><div class="teacher-calendar-head"><b>'+first.getFullYear()+'年'+(first.getMonth()+1)+'月</b><span><button data-month="-1" aria-label="上个月">‹</button><button data-month="1" aria-label="下个月">›</button></span></div><div class="teacher-calendar-grid">'+calendar+'</div><p class="calendar-legend">浅紫：查看周 · 深紫：今天</p></section><section class="teacher-panel teacher-reminders"><h3>🔔 教学提醒</h3><p><a href="#records">✎ '+unrecorded+' 次课可补充实际记录（选填）</a></p><p><a href="#schedule">◷ '+w.pending.length+' 次待定调课</a></p><p><a href="#schedule">⚑ '+conflicts+' 次课有时间冲突</a></p><p><a href="#settings">＋ 管理课程与课表</a></p></section></div>';
    rail.querySelectorAll('[data-today]').forEach(b=>b.onclick=()=>{const s=current[Number(b.dataset.today)];selected=today;search='';searchWrap.querySelector('input').value='';paint();detail(events.findIndex(e=>e.id===s.id&&!e.ghost));});
    rail.querySelectorAll('[data-calendar-date]').forEach(b=>b.onclick=()=>{selected=b.dataset.calendarDate;updateUrl();paint();});
    rail.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>{first.setMonth(first.getMonth()+Number(b.dataset.month));calendarMonth=M.iso(first).slice(0,7);paint();});
  }
  function detail(index){
    const s=events[index];if(!s)return;
    dialog.innerHTML='<h3>'+esc(s.courseName)+' · '+esc(s.className)+'</h3><p>'+esc(s.date+' '+s.period)+'<br>'+esc(s.room||'教室待补充')+'<br>状态：'+esc(s.status)+(s.conflict?' · 与其他授课时间冲突':'')+'</p>'+(s.originalDate!==s.actualDate?'<p>原日期：'+esc(s.originalDate)+'<br>实际日期：'+esc(s.actualDate||'待定')+'</p>':'')+'<p><b>教学进度</b><br>'+esc(s.ghost?'本状态卡不计入教学进度':s.progress)+'</p><p><b>实际记录</b><br>'+esc(s.actual||'尚未记录')+'</p><p>'+esc(s.notes)+'</p><div class="week-dialog-actions"><button id="weekClose">关闭</button><button id="weekEdit" '+(s.ghost?'disabled':'')+'>记录 / 编辑实际内容</button></div>';
    $('weekClose').onclick=()=>dialog.close();$('weekEdit').onclick=()=>{
      dialog.close();
      // MCU uses the established record modal without rebuilding its bound DOM.
      if(s.courseId==='mcu'&&$('activeCourseSelect').value==='mcu'&&['25机电2班','25机电3班'].includes(s.className)){
        location.hash='#class';applyPage('class');setDate(s.actualDate,true);openEditor(s.actualDate+'|'+s.className+'|'+s.period);return;
      }
      sessionStorage.setItem('week_detail_target',JSON.stringify({courseId:s.courseId,className:s.className,date:s.actualDate,period:s.period}));
      localStorage.setItem(ACTIVE_COURSE_KEY,s.courseId);location.hash='#class';location.reload();
    };dialog.showModal();
  }
  $('weekGrid').addEventListener('click',e=>{const b=e.target.closest('[data-week-event]');if(b)detail(Number(b.dataset.weekEvent));});
  $('weekPrev').onclick=()=>{selected=M.add(M.monday(selected),-7);calendarMonth='';updateUrl();paint();};
  $('weekNext').onclick=()=>{selected=M.add(M.monday(selected),7);calendarMonth='';updateUrl();paint();};
  $('weekCurrent').onclick=()=>{selected=isoToday();calendarMonth='';updateUrl();paint();};
  const previousApply=applyPage,heading=document.querySelector('header.top h1'),originalHeading=heading.textContent;
  applyPage=function(page){
    const home=page==='home';board.hidden=!home;rail.hidden=!home;searchWrap.hidden=!home;document.body.classList.add('teacher-ui');document.body.classList.toggle('week-home',home);document.body.dataset.teacherPage=page;heading.textContent=(window.CourseCloud?.teacher.name||'赵成乾')+'老师课表';
    if(home){$('activeCourseHint').textContent='本周课表汇总全部课程；此选择用于详情栏目';document.querySelectorAll('body > .wrap > section.card').forEach(s=>{s.style.display='none';s.classList.add('page-hidden');});document.querySelectorAll('#pageNav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page==='home'));document.title='本周课程表 · 课程进度工具';paint();}
    else {
      renderCourseSelector();previousApply(page);
      const input=$('genericDateInput');
      if(input){
        const dates=[...new Set(allLessons().filter(s=>s.courseId===$('activeCourseSelect').value&&!s.canceled&&!s.pending).map(s=>s.actualDate))].sort();
        if($('genericPrev'))$('genericPrev').onclick=()=>{const v=dates.filter(d=>d<input.value).at(-1);if(v)setDate(v,true);};
        if($('genericNext'))$('genericNext').onclick=()=>{const v=dates.find(d=>d>input.value);if(v)setDate(v,true);};
      }
    }
  };
  const navHome=document.querySelector('#pageNav [data-page="home"]');if(navHome)navHome.textContent='本周课程表';
  // A local-only view adapter; future D1 adapter will expose the same lesson list.
  window.TeacherScheduleData={getLessons:allLessons};
  applyPage(currentPage());
  const raw=sessionStorage.getItem('week_detail_target');
  if(raw){sessionStorage.removeItem('week_detail_target');try{const t=JSON.parse(raw);if(t.courseId===$('activeCourseSelect').value){if($('genericDateInput')){$('genericDateInput').value=t.date;$('genericDateInput').dispatchEvent(new Event('change'));const field=[...document.querySelectorAll('[data-grec]')].find(i=>i.dataset.grec===t.date+'|'+t.className+'|'+t.period);if(field){field.focus();field.scrollIntoView({block:'center'});}}else setDate(t.date,true);}}catch(_){} }
  window.addEventListener('storage',()=>{if(currentPage()==='home')location.reload();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentPage()==='home')paint();});
})();
