/**
 * techteacher — بوابة المعلم: أدوات الواجهة المشتركة
 * توست الرسائل + ترميز النصوص + عرض الأخطاء الموحّد.
 */
(function (global) {
  'use strict';

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** رسالة توست عائمة (نجاح/خطأ/تنبيه) */
  function toast(message, kind, ms) {
    var host = document.getElementById('toastHost');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'ok');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, ms || 3200);
  }

  /** عرض خطأ مرفوض من TT_AUTH */
  function showError(err, fallback) {
    var msg = (err && (err.error || err.message)) || fallback || 'حدث خطأ غير متوقع';
    toast(msg, 'err', 4200);
    return msg;
  }

  /** تفعيل/تعطيل زر أثناء العملية */
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.oldText = btn.textContent;
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.dataset.oldText) btn.textContent = btn.dataset.oldText;
    }
  }

  global.TT_UI = {
    escapeHtml: escapeHtml,
    toast: toast,
    showError: showError,
    busy: busy
  };
})(window);
