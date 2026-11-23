/**
 * techteacher — بوابة المعلم: منطق صفحة المعلم
 * ===================================================================
 * - جلب البيانات عبر رمز الجلسة فقط (الخادم يحدّد المالك).
 * - أقسام: بياناتي / زياراتي / تقاريري / أدائي / تحديث / كلمة المرور.
 * - التعديل على الحقول المسموحة فقط، ثم إعادة تحميل البيانات بعد الحفظ.
 */
(function () {
  'use strict';

  var A = window.TT_AUTH;
  var UI = window.TT_UI;
  var C = window.TT_CONFIG;

  var esc = UI.escapeHtml;

  var state = {
    session: null,
    record: null
  };

  var el = {
    welcome: document.getElementById('welcomeText'),
    logoutBtn: document.getElementById('logoutBtn'),
    forceChange: document.getElementById('forceChange'),
    tabs: Array.prototype.slice.call(document.querySelectorAll('.gw-tab')),
    panels: Array.prototype.slice.call(document.querySelectorAll('.gw-panel')),
    profileLoading: document.getElementById('profileLoading'),
    profileGrid: document.getElementById('profileGrid'),
    reloadProfile: document.getElementById('reloadProfileBtn'),
    editGrid: document.getElementById('editGrid'),
    scheduleTable: document.getElementById('scheduleTable'),
    editForm: document.getElementById('editForm'),
    saveBtn: document.getElementById('saveBtn'),
    saveStatus: document.getElementById('saveStatus'),
    passwordForm: document.getElementById('passwordForm'),
    savePassBtn: document.getElementById('savePassBtn'),
    passStatus: document.getElementById('passStatus'),
    netBadge: document.getElementById('netBadge'),
    curPass: document.getElementById('curPass'),
    newPass: document.getElementById('newPass'),
    confPass: document.getElementById('confPass')
  };

  /* ==================================================================
   * بيانات الحقول المسموح بها بالتعديل
   * ================================================================== */

  var FIELDS = [
    { key: 'location',    label: 'السكن',                 type: 'text' },
    { key: 'school',      label: 'المدرسة',               type: 'text', required: true },
    { key: 'otherSchool', label: 'المركز الآخر',          type: 'text' },
    { key: 'degree',      label: 'المؤهل العلمي',         type: 'select', options: C.DEGREE_OPTIONS, required: true },
    { key: 'specialty',   label: 'التخصص الجامعي',        type: 'text', required: true },
    { key: 'classes',     label: 'الصفوف التي يدرسها',    type: 'text', required: true },
    { key: 'appointDate', label: 'تاريخ التعيين',         type: 'date', required: true,
      placeholder: 'مثال: 23/08/2017' },
    { key: 'pedagogy',    label: 'المؤهل التربوي',        type: 'select', options: C.PEDAGOGY_OPTIONS },
    { key: 'courses',     label: 'الدورات (على مستوى المديرية)', type: 'text' },
    { key: 'workDays',    label: 'أيام الدوام / نصف المركز',    type: 'text' }
  ];

  /** الحقول المعروضة في «بياناتي» (للعرض فقط) */
  var VIEW_FIELDS = FIELDS.concat([
    { key: 'name',      label: 'اسم المعلم' },
    { key: 'id',        label: 'رقم الهوية' },
    { key: 'updatedAt', label: 'آخر تحديث' }
  ]);

  /* ==================================================================
   * التبويبات
   * ================================================================== */

  function showPanel(panelId) {
    // أثناء إجبار تغيير كلمة المرور: التبويبات معطّلة إلا كلمة المرور
    if (state.session && state.session.mustChange && panelId !== 'panelPassword') return;

    el.tabs.forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.panel === panelId ? 'true' : 'false');
    });
    el.panels.forEach(function (p) {
      p.hidden = (p.id !== panelId);
    });
    if (panelId === 'panelEdit') {
      if (state.record) renderEditForm();
      else loadProfile().then(function () { if (state.record) renderEditForm(); });
    }
    if (panelId === 'panelPassword') el.curPass.focus();
  }

  el.tabs.forEach(function (t) {
    t.addEventListener('click', function () { showPanel(t.dataset.panel); });
  });

  /* ==================================================================
   * عرض البيانات
   * ================================================================== */

  function renderProfile() {
    var rec = state.record;
    if (!rec) return;

    var html = '';
    VIEW_FIELDS.forEach(function (f) {
      var v = rec[f.key] || '';
      html += '<div class="profile-item">' +
                '<span class="k">' + esc(f.label) + '</span>' +
                '<span class="v">' + (v ? esc(v) : '') + '</span>' +
              '</div>';
    });

    // البرنامج الأسبوعي (عرض مختصر)
    var sch = rec.schedule || [];
    var filled = sch.filter(function (s) { return s && String(s).trim(); }).length;
    html += '<div class="profile-item">' +
              '<span class="k">البرنامج الأسبوعي</span>' +
              '<span class="v">' + (filled ? 'مكتمل (' + filled + ' خانة)' : 'غير معبّأ') + '</span>' +
            '</div>';

    el.profileGrid.innerHTML = html;
    el.profileGrid.hidden = false;
    el.profileLoading.hidden = true;
  }

  function loadProfile() {
    el.profileLoading.hidden = false;
    el.profileGrid.hidden = true;

    return A.getMyData().then(function (out) {
      state.record = out.record;
      renderProfile();
    }, function (err) {
      el.profileLoading.hidden = true;
      el.profileGrid.hidden = false;
      el.profileGrid.innerHTML =
        '<div class="soon-card" style="grid-column:1/-1">' +
        '<h3>تعذّر تحميل بياناتك</h3><p>' + esc((err && err.error) || '') + '</p>' +
        '</div>';
      UI.showError(err);
    });
  }

  /* ==================================================================
   * نموذج التعديل
   * ================================================================== */

  function fieldHtml(f, value) {
    var id = 'f_' + f.key;
    var req = f.required ? ' <span class="req">*</span>' : '';
    var v = value == null ? '' : value;
    var control;

    if (f.type === 'select') {
      control = '<select class="select input" id="' + id + '" name="' + f.key + '">';
      control += '<option value="">— اختر —</option>';
      (f.options || []).forEach(function (o) {
        control += '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>';
      });
      control += '</select>';
    } else {
      var ph = f.placeholder || '';
      var mode = f.key === 'appointDate' ? ' inputmode="numeric"' : '';
      control = '<input class="input" type="text" id="' + id + '" name="' + f.key + '"' +
                ' value="' + esc(v) + '" placeholder="' + esc(ph) + '"' + mode +
                ' autocomplete="off">';
    }

    return '<div class="field">' +
             '<label for="' + id + '">' + esc(f.label) + req + '</label>' +
             control +
           '</div>';
  }

  function renderEditForm() {
    if (!state.record) return; // تُملأ بعد نجاح loadProfile()

    var html = '';
    FIELDS.forEach(function (f) {
      html += fieldHtml(f, state.record[f.key]);
    });
    el.editGrid.innerHTML = html;
    renderSchedule(state.record.schedule || []);
  }

  function renderSchedule(sch) {
    var html = '<thead><tr><th class="t-right">اليوم</th>';
    for (var p = 1; p <= C.PERIODS; p++) html += '<th>الحصة ' + p + '</th>';
    html += '</tr></thead><tbody>';

    C.DAYS.forEach(function (day, d) {
      html += '<tr><th class="t-right">' + esc(day) + '</th>';
      for (var p2 = 0; p2 < C.PERIODS; p2++) {
        var idx = d * C.PERIODS + p2;
        var v = sch[idx] || '';
        html += '<td><input class="sch-input" type="text" data-idx="' + idx + '"' +
                ' value="' + esc(v) + '" placeholder="—" maxlength="30" autocomplete="off"></td>';
      }
      html += '</tr>';
    });
    html += '</tbody>';
    el.scheduleTable.innerHTML = html;
  }

  function collectEditData() {
    var data = {};
    var form = el.editForm;

    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var input = form.elements[f.key];
      if (!input) continue;
      var v = String(input.value || '').trim();

      if (f.required && !v) {
        throw { field: f, message: 'الحقل مطلوب: ' + f.label };
      }
      if (f.key === 'appointDate' && v && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        throw { field: f, message: 'تاريخ التعيين غير صحيح (مثال: 23/08/2017)' };
      }
      data[f.key] = v;
    }

    var schedule = [];
    var cells = el.scheduleTable.querySelectorAll('.sch-input');
    if (cells.length !== C.DAYS.length * C.PERIODS) {
      throw { message: 'جدول البرنامج غير مكتمل' };
    }
    Array.prototype.forEach.call(cells, function (c) {
      schedule[Number(c.dataset.idx)] = String(c.value || '').trim();
    });
    for (var s = 0; s < C.DAYS.length * C.PERIODS; s++) {
      if (schedule[s] == null) schedule[s] = '';
      if (schedule[s].length > 40) {
        throw { message: 'خانة في البرنامج الأسبوعي طويلة جداً' };
      }
    }
    data.schedule = schedule;
    return data;
  }

  function setStatus(node, msg, kind) {
    node.textContent = msg || '';
    node.className = 'save-status' + (kind ? ' ' + kind : '');
  }

  el.editForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setStatus(el.saveStatus, '');

    var data;
    try { data = collectEditData(); }
    catch (e) {
      setStatus(el.saveStatus, e.message || 'تحقق من البيانات', 'err');
      UI.toast(e.message || 'تحقق من البيانات', 'err');
      if (e.field) {
        var input = el.editForm.elements[e.field.key];
        if (input) input.focus();
      }
      return;
    }

    UI.busy(el.saveBtn, true, 'جارٍ الحفظ…');
    A.updateMyData(data).then(function (out) {
      UI.busy(el.saveBtn, false);
      setStatus(el.saveStatus, out.message || 'تم الحفظ', 'ok');
      UI.toast(out.message || 'تم حفظ البيانات بنجاح', 'ok');
      // إعادة تحميل البيانات من الجدول للتأكد من نجاح العملية
      return loadProfile().then(function () {
        renderEditForm();
        setStatus(el.saveStatus, 'تم الحفظ — تم تحديث البيانات', 'ok');
      });
    }, function (err) {
      UI.busy(el.saveBtn, false);
      var msg = (err && err.error) || 'تعذّر الحفظ';
      setStatus(el.saveStatus, msg, 'err');
      UI.showError(err);
      // انتهاء الجلسة → العودة لشاشة الدخول
      if (msg.indexOf('الجلسة') !== -1) {
        setTimeout(function () { window.location.replace('./login.html'); }, 1400);
      }
    });
  });

  /* ==================================================================
   * تغيير كلمة المرور
   * ================================================================== */

  el.passwordForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    setStatus(el.passStatus, '');

    var cur = el.curPass.value;
    var next = el.newPass.value;
    var conf = el.confPass.value;

    if (!cur || !next || !conf) {
      setStatus(el.passStatus, 'أكمل جميع الحقول', 'err');
      return;
    }
    if (next !== conf) {
      setStatus(el.passStatus, 'كلمتا المرور الجديدتان غير متطابقتين', 'err');
      el.confPass.focus();
      return;
    }
    if (next.length < 6) {
      setStatus(el.passStatus, 'كلمة المرور الجديدة 6 خانات على الأقل', 'err');
      el.newPass.focus();
      return;
    }

    UI.busy(el.savePassBtn, true, 'جارٍ الحفظ…');
    A.changePassword(cur, next, conf).then(function (out) {
      UI.busy(el.savePassBtn, false);
      setStatus(el.passStatus, out.message || 'تم التغيير', 'ok');
      UI.toast(out.message || 'تم تغيير كلمة المرور بنجاح', 'ok');
      el.passwordForm.reset();

      state.session.mustChange = false;
      A.setSession(state.session);
      applyMustChange();

      setTimeout(function () { showPanel('panelProfile'); }, 900);
    }, function (err) {
      UI.busy(el.savePassBtn, false);
      var msg = (err && err.error) || 'تعذّر تغيير كلمة المرور';
      setStatus(el.passStatus, msg, 'err');
      UI.showError(err);
      el.curPass.select();
    });
  });

  /* ==================================================================
   * تطبيق حالة إجبار التغيير
   * ================================================================== */

  function applyMustChange() {
    var forced = !!(state.session && state.session.mustChange);
    el.forceChange.hidden = !forced;

    el.tabs.forEach(function (t) {
      t.disabled = forced && t.dataset.panel !== 'panelPassword';
    });

    if (forced) showPanel('panelPassword');
  }

  /* ==================================================================
   * الخروج وحالة الشبكة
   * ================================================================== */

  el.logoutBtn.addEventListener('click', function () {
    UI.busy(el.logoutBtn, true, '…');
    A.logout().then(function () {
      window.location.replace('./login.html');
    });
  });

  el.reloadProfile.addEventListener('click', function () { loadProfile(); });

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

  A.requireAuth(['teacher']).then(function (sess) {
    state.session = sess;
    el.welcome.innerHTML = 'مرحباً بك، <strong>' + esc(sess.name) + '</strong>' +
                           '<small>الصفحة الشخصية للمعلم</small>';
    applyMustChange();
    loadProfile();
  }).catch(function () { /* التوجيه يتم داخل requireAuth */ });
})();
