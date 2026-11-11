/*!
 * 华夏工具 · 统一网页弹窗组件（ui-dialog.js）
 * 零依赖、可直接被 <script src> 引用，全局暴露三个函数（都返回 Promise）：
 *   hxAlert(msg, opts?)        → 确定后 resolve（单一「确定」按钮）
 *   hxConfirm(msg, opts?)      → Promise<boolean>：确定 true；取消 / Esc / 点遮罩 false
 *   hxPrompt(msg, def?, opts?) → Promise<string|null>：输入值 / 取消、Esc、点遮罩为 null
 *
 * opts 可选字段：{ title: 标题, okText: 确定按钮文字, cancelText: 取消按钮文字 }
 *
 * 特性：标题栏拖拽、右下角缩放、双击标题栏最大化/还原、Esc/点遮罩取消、焦点圈定、
 *       同屏只一个弹窗（后开的排队）。深浅色跟随站点 hx-theme.js 的 data-hx-mode 与 --acc。
 * 兼容性：纯 var/function 写法，无 import/export、无 ES 模块，用普通 <script src> 加载即可。
 */
(function (win, doc) {
  'use strict';

  var chain = Promise.resolve(); // 弹窗队列：同一时刻只显示一个，后开的排队
  var focusBack = null;          // 关闭后要还给焦点的元素

  /* 样式只注入一次。浅色用内置值，深色跟 data-hx-mode；主色按钮跟 --acc（hx-theme.js 行内设置）。 */
  function ensureStyle() {
    if (doc.getElementById('hx-dlg-style')) return;
    var css = [
      '.hx-dlg-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(7,10,18,.52);display:flex;align-items:center;justify-content:center;padding:16px;animation:hxdlg-fade .16s ease}',
      '@keyframes hxdlg-fade{from{opacity:0}to{opacity:1}}',
      '.hx-dlg{position:relative;display:flex;flex-direction:column;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 48px);background:#fff;color:#1d1d1f;border:1px solid rgba(0,0,0,.1);border-radius:16px;box-shadow:0 24px 64px -14px rgba(0,0,0,.5);overflow:hidden;animation:hxdlg-pop .2s cubic-bezier(.16,1,.3,1)}',
      '@keyframes hxdlg-pop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}',
      '.hx-dlg-title{display:flex;align-items:center;gap:8px;padding:13px 16px;cursor:move;user-select:none;-webkit-user-select:none;border-bottom:1px solid rgba(0,0,0,.08);font-size:15px;font-weight:600;touch-action:none}',
      '.hx-dlg-body{padding:18px 16px;overflow:auto;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word;color:inherit}',
      '.hx-dlg-input{display:block;width:100%;box-sizing:border-box;margin-top:12px;padding:9px 12px;border:1px solid rgba(0,0,0,.16);border-radius:9px;font:inherit;font-size:14px;color:inherit;background:#f5f5f7}',
      '.hx-dlg-input:focus{outline:none;border-color:var(--acc,#2f845a)}',
      '.hx-dlg-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid rgba(0,0,0,.08)}',
      '.hx-dlg-btn{flex:0 0 auto;border:none;cursor:pointer;padding:8px 16px;border-radius:9px;font:inherit;font-size:14px;background:rgba(0,0,0,.06);color:inherit}',
      '.hx-dlg-btn:hover{background:rgba(0,0,0,.1)}',
      '.hx-dlg-btn:focus-visible{outline:2px solid var(--acc,#2f845a);outline-offset:2px}',
      '.hx-dlg-btn.pri{background:var(--acc,#2f845a);color:var(--on-acc,#fff);font-weight:600}',
      '.hx-dlg-btn.pri:hover{filter:brightness(1.06)}',
      '.hx-dlg-resize{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 52%,rgba(127,127,127,.5) 52%)}',
      ':root[data-hx-mode="dark"] .hx-dlg{background:#1c1c1e;color:#f5f5f7;border-color:rgba(255,255,255,.12)}',
      ':root[data-hx-mode="dark"] .hx-dlg-title{border-bottom-color:rgba(255,255,255,.1)}',
      ':root[data-hx-mode="dark"] .hx-dlg-foot{border-top-color:rgba(255,255,255,.1)}',
      ':root[data-hx-mode="dark"] .hx-dlg-btn{background:rgba(255,255,255,.1)}',
      ':root[data-hx-mode="dark"] .hx-dlg-btn:hover{background:rgba(255,255,255,.16)}',
      ':root[data-hx-mode="dark"] .hx-dlg-btn.pri{background:var(--acc,#3ec383);color:var(--on-acc,#fff)}',
      ':root[data-hx-mode="dark"] .hx-dlg-btn.pri:hover{filter:brightness(1.08)}',
      ':root[data-hx-mode="dark"] .hx-dlg-input{background:#000;border-color:rgba(255,255,255,.2)}'
    ].join('\n');
    var st = doc.createElement('style');
    st.id = 'hx-dlg-style';
    st.textContent = css;
    doc.head.appendChild(st);
  }

  function enqueue(task) {
    var run = chain.then(task);
    chain = run.catch(function () {});
    return run;
  }

  function dialog(kind, msg, def, opts) {
    return new Promise(function (resolve) {
      opts = opts || {};
      ensureStyle();

      var mask = doc.createElement('div');
      mask.className = 'hx-dlg-mask';
      var dlg = doc.createElement('div');
      dlg.className = 'hx-dlg';
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');

      var title = doc.createElement('div');
      title.className = 'hx-dlg-title';
      var tspan = doc.createElement('span');
      tspan.textContent = opts.title || (kind === 'alert' ? '提示' : kind === 'confirm' ? '确认' : '请输入');
      title.appendChild(tspan);

      var body = doc.createElement('div');
      body.className = 'hx-dlg-body';
      body.textContent = (msg == null ? '' : String(msg));

      var input = null;
      if (kind === 'prompt') {
        input = doc.createElement('input');
        input.className = 'hx-dlg-input';
        input.type = 'text';
        input.value = (def == null ? '' : String(def));
        body.appendChild(input);
      }

      var foot = doc.createElement('div');
      foot.className = 'hx-dlg-foot';
      var okBtn = doc.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'hx-dlg-btn pri';
      okBtn.textContent = opts.okText || '确定';
      foot.appendChild(okBtn);
      var cancelBtn = null;
      if (kind !== 'alert') {
        cancelBtn = doc.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'hx-dlg-btn';
        cancelBtn.textContent = opts.cancelText || '取消';
        foot.appendChild(cancelBtn);
      }

      var rz = doc.createElement('div');
      rz.className = 'hx-dlg-resize';

      dlg.appendChild(title);
      dlg.appendChild(body);
      dlg.appendChild(foot);
      dlg.appendChild(rz);
      mask.appendChild(dlg);
      doc.body.appendChild(mask);

      focusBack = doc.activeElement;

      var settled = false;
      function close(value) {
        if (settled) return;
        settled = true;
        doc.removeEventListener('keydown', onKey, true);
        mask.remove();
        if (focusBack && focusBack.focus) { try { focusBack.focus(); } catch (e) {} }
        resolve(value);
      }

      okBtn.onclick = function () {
        if (kind === 'prompt') close(input.value);
        else if (kind === 'confirm') close(true);
        else close(undefined);
      };
      if (cancelBtn) cancelBtn.onclick = function () {
        close(kind === 'confirm' ? false : null);
      };

      function onKey(e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          e.preventDefault();
          e.stopPropagation();
          if (kind === 'alert') close(undefined);
          else close(kind === 'confirm' ? false : null);
        } else if (e.key === 'Tab') {
          cycleFocus(e, dlg);
        }
      }
      doc.addEventListener('keydown', onKey, true);

      /* 点遮罩取消（alert 也一并关闭）。用 mousedown 判断，避免“标题栏拖拽松开落在遮罩上”误关。 */
      mask.addEventListener('mousedown', function (e) {
        if (e.target !== mask) return;
        if (kind === 'alert') close(undefined);
        else close(kind === 'confirm' ? false : null);
      });

      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); }
        });
        input.focus();
        try { input.select(); } catch (e) {}
      } else {
        okBtn.focus();
      }

      enableDrag(title, dlg);
      enableResize(rz, dlg);
      title.addEventListener('dblclick', function () { toggleMax(dlg); });
    });
  }

  /* Tab 在弹窗内循环，焦点不逃出去 */
  function cycleFocus(e, root) {
    var els = [];
    var all = root.querySelectorAll('button,input,textarea,select,a[href],[tabindex]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.disabled) continue;
      if (el.tabIndex < 0) continue;
      els.push(el);
    }
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (doc.activeElement === first) { e.preventDefault(); last.focus(); }
    } else if (doc.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function enableDrag(handle, dlg) {
    function down(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      var p = e.touches && e.touches[0] ? e.touches[0] : e;
      e.preventDefault();
      var r = dlg.getBoundingClientRect();
      var sx = p.clientX, sy = p.clientY;
      var ol = r.left, ot = r.top;
      dlg.style.position = 'fixed';
      dlg.style.left = ol + 'px';
      dlg.style.top = ot + 'px';
      dlg.style.margin = '0';
      function move(ev) {
        var q = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        if (ev.cancelable) ev.preventDefault();
        var nx = ol + (q.clientX - sx), ny = ot + (q.clientY - sy);
        nx = Math.max(-r.width + 40, Math.min(nx, win.innerWidth - 40));
        ny = Math.max(0, Math.min(ny, win.innerHeight - 40));
        dlg.style.left = nx + 'px';
        dlg.style.top = ny + 'px';
      }
      function up() {
        doc.removeEventListener('mousemove', move);
        doc.removeEventListener('mouseup', up);
        doc.removeEventListener('touchmove', move);
        doc.removeEventListener('touchend', up);
      }
      doc.addEventListener('mousemove', move);
      doc.addEventListener('mouseup', up);
      doc.addEventListener('touchmove', move, { passive: false });
      doc.addEventListener('touchend', up);
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
  }

  function enableResize(handle, dlg) {
    function down(e) {
      if (e.type === 'mousedown' && e.button !== 0) return;
      var p = e.touches && e.touches[0] ? e.touches[0] : e;
      e.preventDefault();
      e.stopPropagation();
      var r = dlg.getBoundingClientRect();
      var sx = p.clientX, sy = p.clientY;
      var w0 = r.width, h0 = r.height;
      function move(ev) {
        var q = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        if (ev.cancelable) ev.preventDefault();
        var w = Math.max(240, Math.min(w0 + (q.clientX - sx), win.innerWidth - 16));
        var h = Math.max(140, Math.min(h0 + (q.clientY - sy), win.innerHeight - 16));
        dlg.style.width = w + 'px';
        dlg.style.height = h + 'px';
      }
      function up() {
        doc.removeEventListener('mousemove', move);
        doc.removeEventListener('mouseup', up);
        doc.removeEventListener('touchmove', move);
        doc.removeEventListener('touchend', up);
      }
      doc.addEventListener('mousemove', move);
      doc.addEventListener('mouseup', up);
      doc.addEventListener('touchmove', move, { passive: false });
      doc.addEventListener('touchend', up);
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
  }

  function toggleMax(dlg) {
    if (dlg.getAttribute('data-max')) {
      dlg.removeAttribute('data-max');
      dlg.style.position = dlg.getAttribute('data-pos') || '';
      dlg.style.left = dlg.getAttribute('data-left') || '';
      dlg.style.top = dlg.getAttribute('data-top') || '';
      dlg.style.width = dlg.getAttribute('data-w') || '';
      dlg.style.height = dlg.getAttribute('data-h') || '';
      dlg.style.margin = dlg.getAttribute('data-margin') || '';
    } else {
      dlg.setAttribute('data-pos', dlg.style.position);
      dlg.setAttribute('data-left', dlg.style.left);
      dlg.setAttribute('data-top', dlg.style.top);
      dlg.setAttribute('data-w', dlg.style.width);
      dlg.setAttribute('data-h', dlg.style.height);
      dlg.setAttribute('data-margin', dlg.style.margin);
      dlg.setAttribute('data-max', '1');
      dlg.style.position = 'fixed';
      dlg.style.left = '16px';
      dlg.style.top = '16px';
      dlg.style.width = 'calc(100vw - 32px)';
      dlg.style.height = 'calc(100vh - 32px)';
      dlg.style.margin = '0';
    }
  }

  win.hxAlert = function (msg, opts) { return enqueue(function () { return dialog('alert', msg, null, opts); }); };
  win.hxConfirm = function (msg, opts) { return enqueue(function () { return dialog('confirm', msg, null, opts); }); };
  win.hxPrompt = function (msg, def, opts) { return enqueue(function () { return dialog('prompt', msg, def, opts); }); };
})(window, document);
