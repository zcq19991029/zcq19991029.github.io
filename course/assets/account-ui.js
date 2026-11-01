/* 华夏工具 · 课程进度右上角「个人设置」
 *
 * 并入华夏工具后的改动：
 *   - 登录、注册、邀请码、退出/切换账号全部去掉。身份和会话由总入口管（localStorage['paike-session'] + 数据库 hx_me()），
 *     这里只从 CourseCloud.teacher 拿当前老师的名字、邮箱和管理员标记；
 *   - 原来「退出」后跳 /login.html，那个页面属于旧的自建账号体系，已废弃；
 *   - 只保留显示姓名、头像文字、工号三项个人资料，存在本人工作区（mcu_teacher_profile_v1），换电脑登录同一账号跟着走。
 */
(function () {
  'use strict';
  var cloud = window.CourseCloud;
  if (!cloud || !cloud.teacher || !cloud.teacher.id) return;   // 没登录时整页被门禁盖住了，这里不用再管

  var key = 'mcu_teacher_profile_v1';
  var esc = function (value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var profile;
  try { profile = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { profile = {}; }

  /* 头像按钮：week-home.js 先放了一个 .teacher-profile 占位，这里替换成可点的按钮 */
  var entry = document.createElement('button');
  entry.id = 'teacherProfile';
  entry.className = 'teacher-account-entry';
  entry.setAttribute('aria-haspopup', 'dialog');
  var oldEntry = document.querySelector('header.top .teacher-profile');
  if (oldEntry) oldEntry.replaceWith(entry);
  else document.querySelector('header.top').append(entry);

  var modal = document.createElement('dialog');
  modal.className = 'import-dialog profile-settings';
  modal.setAttribute('aria-label', '个人设置');
  modal.innerHTML = '<div class="import-head"><h2>个人设置</h2><button id="profileClose" aria-label="关闭个人设置">×</button></div>'
    + '<div class="import-body"><p id="profileIdentity"></p>'
    + '<div class="profile-fields"><label>显示姓名<input id="profileName" maxlength="80"></label>'
    + '<label>头像文字<input id="profileAvatar" maxlength="2" placeholder="例如：赵"></label>'
    + '<label>工号<input id="profileEmployee" maxlength="24" autocomplete="off"></label></div>'
    + '<p class="import-hint">显示资料随本人课程工作区保存，换电脑登录同一账号还在；账号、密码和身份在华夏工具总入口管理。</p>'
    + '<div id="profileTools"></div></div>'
    + '<div class="import-footer"><span id="profileStatus" role="status"></span><button id="profileSave" class="primary">保存资料</button></div>';
  document.body.append(modal);

  var $ = function (id) { return document.getElementById(id); };

  function render() {
    var name = profile.name || cloud.teacher.name || '老师';
    var avatar = profile.avatar || Array.from(name)[0] || '师';
    entry.setAttribute('aria-label', name + ' · 个人设置' + (cloud.teacher.admin ? ' · 管理员' : ''));
    entry.innerHTML = '<span class="profile-avatar" aria-hidden="true">' + esc(avatar) + '</span>'
      + '<span class="profile-caption"><b>' + esc(name) + '</b><small>' + (cloud.teacher.admin ? '管理员' : '教师') + ' · 个人设置</small></span>'
      + (cloud.teacher.admin ? '<span class="profile-crown" title="管理员" aria-hidden="true">👑</span>' : '');
    var h1 = document.querySelector('header.top h1');
    var sub = document.querySelector('header.top .sub');
    if (h1) h1.textContent = name + '老师课表';
    if (sub) sub.textContent = '教师个人课程工作区 · 主讲：' + name + (profile.employee ? ' · 工号：' + profile.employee : '');
  }

  $('profileClose').onclick = function () { modal.close(); };
  entry.onclick = function () {
    $('profileIdentity').textContent = (cloud.teacher.email || '华夏工具账号') + ' · ' + (cloud.teacher.admin ? '👑 管理员' : '教师');
    $('profileName').value = profile.name || cloud.teacher.name || '';
    $('profileAvatar').value = profile.avatar || '';
    $('profileEmployee').value = profile.employee || '';
    $('profileStatus').textContent = '';
    modal.showModal();
  };

  $('profileSave').onclick = async function () {
    var name = $('profileName').value.trim();
    if (!name) { $('profileStatus').textContent = '请填写显示姓名'; return; }
    var next = { name: name, avatar: $('profileAvatar').value.trim(), employee: $('profileEmployee').value.trim() };
    var button = $('profileSave');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      localStorage.setItem(key, JSON.stringify(next));
      await cloud.flush();
      profile = next;
      render();
      button.textContent = '✓ 已保存';
      $('profileStatus').textContent = '资料已同步';
      setTimeout(function () { button.textContent = '保存资料'; $('profileStatus').textContent = ''; }, 2200);
    } catch (e) {
      $('profileStatus').textContent = e.message;
      button.textContent = '重试保存';
    } finally {
      button.disabled = false;
    }
  };

  render();
})();
