/**
 * techteacher — بوابة المعلم: منطق صفحة مسؤول النظام
 * ===================================================================
 * - عرض كل الحسابات (بما فيهم من لم يُنشئ حسابه بعد).
 * - إعادة تعيين كلمة المرور إلى رقم الهوية / تعليق وتفعيل الحساب.
 * - سجل العمليات. كل العمليات تُدقَّق في الخادم بصلاحية admin.
 */
(function () {
  'use strict';

  var A = window.TT_AUTH;
  var UI = window.TT_UI;
  var esc = UI.escapeHtml;

  var el = {
    welcome: document.getElementById('welcomeText'),
    logoutBtn: document.getElementById('logoutBtn'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.gw-tab')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.gw-panel')),
    accountsLoading: document.getElementById('accountsLoading'),
    accountsScroll: document.getElementById('accountsScroll'),
    accountsBody: document.getElementById('accountsBody'),
    reloadAccounts: document.getElementById('reloadAccountsBtn'),
    auditLoading: document.getElementById('auditLoading'),
    auditList: document.getElementById('auditList'),
    reloadAudit: document.getElementById('reloadAuditBtn'),
    netBadge: document.getElementById('netBadge')
  };

  var ACTION_LABELS = {
    login: 'تسجيل دخول',
    login_failed: 'محاولة دخول خاطئة',
    login_blocked: 'دخول مرفوض (حساب معلّق)',
    account_created: 'إنشاء حساب',
    logout: 'تسجيل خروج',
    password_changed: 'تغيير كلمة مرور',
    password_failed: 'محاولة تغيير بكلمة خاطئة',
    update_profile: 'تعديل بيانات',
    admin_reset: 'إعادة تعيين كلمة مرور',
    admin_status: 'تغيير حالة حساب',
    admin_created: 'إنشاء مسؤول'
  };

  /* ==================================================================
   * التبويبات
   * ================================================================== */

  function showPanel(panelId) {
    el.tabs.forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.panel === panelId ? 'true' : 'false');
    });
    el.panels.forEach(function (p) { p.hidden = (p.id !== panelId); });
    if (panelId === 'panelAudit' && !el.auditList.dataset.loaded) loadAudit();
  }

  el.tabs.forEach(function (t) {
    t.addEventListener('click', function () { showPanel(t.dataset.panel); });
  });

  /* ==================================================================
   * الحسابات
   * ================================================================== */

  function statusPill(acc) {
    if (!acc.hasAccount) return '<span class="pill mute">لم يُنشأ بعد</span>';
    if (acc.status === 'suspended') return '<span class="pill off">معلّق</span>';
    if (acc.mustChange) return '<span class="pill warn">يجب تغيير كلمة المرور</span>';
    return '<span class="pill ok">نشط</span>';
  }

  function renderAccounts(list) {
    var html = '';
    list.forEach(function (acc) {
      if (acc.role === 'admin') return; // لا نعرض حساب المسؤول هنا

      html += '<tr>' +
        '<td class="t-right"><strong>' + esc(acc.name) + '</strong></td>' +
        '<td>' + esc(acc.nationalId) + '</td>' +
        '<td>' + (acc.hasAccount ? 'مُنشأ' : '<span class="pill mute">عند أول دخول</span>') + '</td>' +
        '<td>' + statusPill(acc) + '</td>' +
        '<td>' + esc(acc.lastLogin || '—') + '</td>' +
        '<td><div class="acct-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="reset" data-id="' +
            esc(acc.teacherId) + '" data-name="' + esc(acc.name) + '">إعادة تعيين</button>' +
          (acc.hasAccount
            ? '<button type="button" class="btn btn-ghost btn-sm" data-act="status" data-id="' +
              esc(acc.teacherId) + '" data-name="' + esc(acc.name) + '" data-status="' +
              esc(acc.status) + '">' +
              (acc.status === 'suspended' ? 'تفعيل' : 'تعليق') + '</button>'
            : '') +
        '</div></td>' +
      '</tr>';
    });

    el.accountsBody.innerHTML = html ||
      '<tr><td colspan="6">لا توجد سجلات.</td></tr>';
    el.accountsScroll.hidden = false;
    el.accountsLoading.hidden = true;
  }

  function loadAccounts() {
    el.accountsLoading.hidden = false;
    el.accountsScroll.hidden = true;

    return A.adminAccounts().then(function (out) {
      renderAccounts(out.accounts || []);
    }, function (err) {
      el.accountsLoading.hidden = true;
      el.accountsScroll.hidden = false;
      el.accountsBody.innerHTML =
        '<tr><td colspan="6">تعذّر التحميل: ' + esc((err && err.error) || '') + '</td></tr>';
      UI.showError(err);
      if ((err && err.error || '').indexOf('الجلسة') !== -1 ||
          (err && err.error || '').indexOf('مسؤول') !== -1) {
        setTimeout(function () { window.location.replace('./login.html'); }, 1600);
      }
    });
  }

  el.reloadAccounts.addEventListener('click', loadAccounts);

  /* --- إجراءات الصف --- */
  el.accountsBody.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;

    var id = btn.dataset.id;
    var name = btn.dataset.name || '';

    if (btn.dataset.act === 'reset') {
      if (!window.confirm('إعادة تعيين كلمة مرور «' + name + '» إلى رقم الهويتها؟')) return;
      UI.busy(btn, true, '…');
      A.adminReset(id).then(function (out) {
        UI.toast(out.message || 'تمت إعادة التعيين', 'ok');
        loadAccounts();
      }, function (err) {
        UI.busy(btn, false);
        UI.showError(err);
      });
      return;
    }

    if (btn.dataset.act === 'status') {
      var next = btn.dataset.status === 'suspended' ? 'active' : 'suspended';
      var msg = next === 'suspended'
        ? 'تعليق حساب «' + name + '»؟ لن يستطيع تسجيل الدخول.'
        : 'تفعيل حساب «' + name + '»؟';
      if (!window.confirm(msg)) return;
      UI.busy(btn, true, '…');
      A.adminStatus(id, next).then(function (out) {
        UI.toast(out.message || 'تم', 'ok');
        loadAccounts();
      }, function (err) {
        UI.busy(btn, false);
        UI.showError(err);
      });
    }
  });

  /* ==================================================================
   * سجل العمليات
   * ================================================================== */

  function loadAudit() {
    el.auditLoading.hidden = false;
    el.auditList.hidden = true;

    return A.adminAudit().then(function (out) {
      var entries = out.entries || [];
      var html = '';
      entries.forEach(function (e) {
        html += '<div class="audit-item">' +
          '<span class="when">' + esc(e.at) + '</span>' +
          '<span class="who">' + esc(e.name || '—') + '</span>' +
          '<span class="act">' + esc(ACTION_LABELS[e.action] || e.action) + '</span>' +
          (e.details ? '<span>' + esc(e.details) + '</span>' : '') +
        '</div>';
      });
      el.auditList.innerHTML = html ||
        '<p class="section-note">لا توجد عمليات مسجّلة بعد.</p>';
      el.auditList.dataset.loaded = '1';
      el.auditList.hidden = false;
      el.auditLoading.hidden = true;
    }, function (err) {
      el.auditLoading.hidden = true;
      el.auditList.hidden = false;
      el.auditList.innerHTML =
        '<p class="section-note">تعذّر تحميل السجل: ' + esc((err && err.error) || '') + '</p>';
      UI.showError(err);
    });
  }

  el.reloadAudit.addEventListener('click', function () {
    el.auditList.dataset.loaded = '';
    loadAudit();
  });

  /* ==================================================================
   * الخروج والشبكة
   * ================================================================== */

  el.logoutBtn.addEventListener('click', function () {
    UI.busy(el.logoutBtn, true, '…');
    A.logout().then(function () {
      window.location.replace('./login.html');
    });
  });

  function updateNet() {
    if (!el.netBadge) return;
    var online = navigator.onLine;
    el.netBadge.dataset.state = online ? 'online' : 'offline';
    el.netBadge.querySelector('.net-text').textContent = online ? 'متصل' : 'غير متصل';
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  /* ==================================================================
   * البدء
   * ================================================================== */

  A.requireAuth(['admin']).then(function (sess) {
    el.welcome.innerHTML = '<strong>' + esc(sess.name) + '</strong><small>مسؤول النظام</small>';
    loadAccounts();
  }).catch(function () { /* التوجيه داخل requireAuth */ });
})();
