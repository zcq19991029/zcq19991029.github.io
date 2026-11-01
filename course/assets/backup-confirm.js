/* Download is explicit, cancellable, and does not invoke a blocking browser dialog. */
(()=>{
 const button=document.getElementById('quickBackup');if(!button)return;
 window.openCourseBackup=button.onclick=()=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','备份全部课程数据');
  dialog.style.cssText='border:1px solid #ddd6fe;border-radius:20px;padding:24px;max-width:440px;width:calc(100% - 48px);color:#253052;background:#fff;box-shadow:0 20px 80px #6455a433';
  dialog.innerHTML='<h2 style="margin-top:0">备份全部课程数据</h2><p>将下载一个 JSON 文件，包含当前账号的全部课程、班级、课次、进度和实际记录。备份不包含密码或 AI 密钥。</p><div style="display:flex;gap:12px;justify-content:flex-end"><button type="button">取消</button><a download style="padding:10px 16px;border-radius:12px;background:#7c5ce7;color:white;text-decoration:none">确认下载备份</a></div>';
  let url;const cleanup=()=>{if(url)URL.revokeObjectURL(url);dialog.remove();};
  dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',cleanup,{once:true});
  const link=dialog.querySelector('a');link.download='课程进度完整备份-'+isoToday()+'.json';
  const backup={version:3,storageKey:STORE_KEY,records:STORE,termConfig:TERM_CONFIG,scheduleOverrides:SCHEDULE_OVERRIDES,courses:MULTI_COURSES,exportedAt:new Date().toISOString()};
  url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));link.href=url;
  link.onclick=()=>{link.textContent='备份已下载';link.style.pointerEvents='none';setTimeout(()=>dialog.close(),1200);};
  document.body.append(dialog);dialog.showModal();
 };
})();
