/* Pure timetable model. No storage writes; usable by local and future cloud adapters. */
(function (root) {
  'use strict';
  const date = value => { const [y,m,d]=value.split('-').map(Number); return new Date(y,m-1,d,12); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const add = (value,n) => { const d=date(value); d.setDate(d.getDate()+n); return iso(d); };
  const monday = value => { const d=date(value); return add(value,-((d.getDay()+6)%7)); };
  const period = text => { const nums=String(text||'').match(/\d+/g)||[]; return {start:Number(nums[0])||1,end:Number(nums[1]||nums[0])||1}; };
  function color(key) { let hash=0; for(const c of key) hash=(Math.imul(hash,31)+c.charCodeAt(0))|0; return 'hsl('+((hash>>>0)%360)+' 78% 92%)'; }
  function collect(courses, legacy, getProgress, getRecord) {
    const lessons=[],seen=new Set();
    Object.entries(courses||{}).forEach(([courseId,c])=>Object.entries(c.classes||{}).forEach(([className,d])=>{
      const native=courseId==='mcu'&&c.scheduleSource!=='unified-import'&&['25机电2班','25机电3班'].includes(className);
      const rows=native?legacy.filter(s=>s.cls===className):(d.schedule||[]);
      rows.forEach(s=>{
        const actualDate=s.dateISO||s.date||'',originalDate=s.movedFrom||s.originalDateISO||s.originalDate||actualDate;
        const p=period(s.period), key=[courseId,className,originalDate,s.period,actualDate].join('|');
        if(seen.has(key))return; seen.add(key);
        const override=(d.overrides||[]).find(o=>o.originalDate===originalDate&&(o.cls||className)===className&&o.period===s.period);
        const status=override?.status||s.overrideStatus||s.status||(s.canceled?(s.nationalHoliday?'假期':'冲课'):originalDate!==actualDate?'调课':s.isMakeup?'补课':'正常');
        const canceled=!!s.canceled||['冲课','假期','停课'].some(x=>status.includes(x));
        const effectiveDate=override?.newDate||actualDate;
        const progress=native?getProgress(s)?.main:(d.progress||c.progress||[]).find(x=>Number(x.no)===Number(s.progressNo));
        const record=native?getRecord(s):(root.CourseImport?.recordFor(d.records,s,className)||(d.records||{})[[actualDate,className,s.period].join('|')]);
        lessons.push({id:s.lessonId||key,courseId,courseName:c.name,className,originalDate,actualDate:effectiveDate,period:s.period,start:p.start,end:Math.max(p.start,p.end),hours:Number(s.hours)||Math.max(1,p.end-p.start+1),room:s.room||d.room||'',students:s.students||'',status,canceled,pending:!canceled&&!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate),progress:(!native&&s.progressText)||progress?.name||progress?.text||'待填写教学进度',project:progress?.proj||'',task:progress?.task||'',actual:record?.actual||'',notes:record?.notes||record?.note||'',color:color(courseId+'|'+className)});
      });
    }));
    const groups=new Map();for(const s of lessons){const key=s.courseId+'|'+s.className;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}for(const list of groups.values()){let hours=0;for(const s of list.sort((a,b)=>a.actualDate.localeCompare(b.actualDate)||a.start-b.start)){if(s.canceled||s.pending)continue;const start=Math.floor(hours/2)+1;hours+=s.hours;const end=Math.ceil(hours/2);s.lessonLabel='第'+start+(end>start?'—'+end:'')+'节课';if(!/^第\d+(?:—\d+)?节课/.test(s.progress))s.progress=s.lessonLabel+' · '+s.progress;}}return lessons;
  }
  function week(lessons,selected) {
    const start=monday(selected),end=add(start,6),within=d=>d>=start&&d<=end,events=[];
    lessons.forEach(s=>{
      if(s.canceled){if(within(s.originalDate))events.push({...s,date:s.originalDate,ghost:true});return;}
      if(within(s.actualDate)&&!s.pending)events.push({...s,date:s.actualDate,ghost:false});
      if(s.originalDate!==s.actualDate&&within(s.originalDate))events.push({...s,date:s.originalDate,ghost:true,status:s.pending?'待定调课':'已调走'});
    });
    events.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||Number(a.ghost)-Number(b.ghost)||a.className.localeCompare(b.className));
    const active=events.filter(s=>!s.ghost);
    for(const s of active)s.conflict=active.some(t=>t.id!==s.id&&t.date===s.date&&t.start<=s.end&&s.start<=t.end);
    return {start,end,events,pending:lessons.filter(s=>s.pending&&within(s.originalDate)),stats:{lessons:active.length,hours:active.reduce((n,s)=>n+s.hours,0),courses:new Set(active.map(s=>s.courseId)).size,classes:new Set(active.map(s=>s.courseId+'|'+s.className)).size}};
  }
  function lanes(events) {
    const ends=[],result=[];
    events.slice().sort((a,b)=>a.start-b.start||a.end-b.end).forEach(s=>{let lane=ends.findIndex(end=>end<s.start);if(lane<0)lane=ends.length;ends[lane]=s.end;result.push({...s,lane});});
    return {count:Math.max(1,ends.length),events:result};
  }
  const api={date,iso,add,monday,period,color,collect,week,lanes};
  if(typeof module!=='undefined'&&module.exports)module.exports=api; else root.WeekTimetable=api;
})(typeof window==='undefined'?globalThis:window);
