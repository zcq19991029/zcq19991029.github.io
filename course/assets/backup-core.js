/* Pure backup preview: supplement missing data, preserve current lessons and history. */
(()=>{const I=CourseImport,copy=x=>structuredClone(x),object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 const parse=(value,fallback)=>value===undefined?copy(fallback):typeof value==='string'?JSON.parse(value):copy(value);
 function prepare(currentValues,backup){
  if(!object(backup)||![1,2,3].includes(backup.version))throw Error('不支持的备份版本');
  if(backup.storageKey&&backup.storageKey!=='mcu_course_actual_v2')throw Error('备份来源不匹配');
  const source=backup.values||{},incoming=parse(source.mcu_multi_courses_v1,backup.courses||{}),courses=parse(currentValues.mcu_multi_courses_v1,{});
  if(!object(incoming)||!object(courses))throw Error('课程结构无效');
  const report={courses:0,classes:0,added:0,existing:0,records:0,preserved:0,orphan:0};
  const recordPairs=[];
  for(const [id,raw]of Object.entries(incoming)){
   if(!object(raw)||!raw.name||!object(raw.classes))throw Error('备份课程配置无效');
   let c=Object.values(courses).find(c=>c.name===raw.name);
   if(!c){if(courses[id])throw Error('课程标识冲突，请人工核对');c=courses[id]={...copy(raw),id,classes:{}};report.courses++;}
   for(const [cls,d]of Object.entries(raw.classes)){
    if(!object(d)||!Array.isArray(d.schedule)||!object(d.records||{}))throw Error('备份班级结构无效');
    I.validateDraft({groups:[{course:raw.name,className:cls,schedule:d.schedule,progress:d.progress||raw.progress||[]}]});
    let target=c.classes[cls];if(!target){target=c.classes[cls]={...copy(d),schedule:[],records:{}};report.classes++;}
    for(const s of d.schedule){const before=target.schedule.find(x=>(x.originalDate||x.date)===(s.originalDate||s.date)&&(x.originalPeriod||x.period)===(s.originalPeriod||s.period));if(before){report.existing++;}else{target.schedule.push(copy(s));report.added++;}}
    recordPairs.push({c,cls,records:d.records||{}});
   }
   c.scheduleSource='unified-import';
  }
  let result=I.stabilize(courses);
  const checkedRecord=r=>{if(!object(r)||['actual','plan','note','notes'].some(k=>r[k]!=null&&typeof r[k]!=='string'))throw Error('备份记录格式无效');return copy(r);};
  function attach(c,cls,key,r){const d=result[c.id].classes[cls];r=checkedRecord(r);const matches=d.schedule.filter(s=>s.lessonId===key||s.recordAliases.includes(key));if(matches.length>1)throw Error('备份记录关联有歧义，请人工核对');const identity=matches[0]?.lessonId||key;if(!matches.length)report.orphan++;if(d.records[identity]||matches[0]&&I.recordFor(d.records,matches[0],cls)){report.preserved++;return;}d.records[identity]=r;report.records++;}
  for(const pair of recordPairs)for(const [key,r]of Object.entries(pair.records))attach(pair.c,pair.cls,key,r);
  const flat=parse(source.mcu_course_actual_v2,backup.records||{});if(!object(flat))throw Error('旧记录结构无效');
  const mcu=Object.values(result).find(c=>c.name==='单片机技术及应用');
  for(const [key,r]of Object.entries(flat)){checkedRecord(r);const matches=mcu?Object.keys(mcu.classes).filter(cls=>mcu.classes[cls].schedule.some(s=>s.lessonId===key||s.recordAliases.includes(key))):[];if(matches.length>1)throw Error('旧记录班级归属有歧义');if(matches.length)attach(mcu,matches[0],key,r);else report.orphan++;}
  result=I.stabilize(result);if(I.conflicts(result).length)throw Error('合并备份产生时间冲突，请先核对课表');
  const values={...currentValues,mcu_multi_courses_v1:JSON.stringify(result)};
  values.mcu_course_actual_v2=JSON.stringify({...flat,...parse(currentValues.mcu_course_actual_v2,{})});
  for(const [key,fallback]of [['mcu_course_term_config',backup.termConfig],['mcu_course_schedule_overrides_v1',backup.scheduleOverrides]])if(!values[key]&&(source[key]!==undefined||fallback!==undefined))values[key]=JSON.stringify(parse(source[key],fallback));
  return {values,report};
 }
 globalThis.CourseBackup={prepare};
})();
