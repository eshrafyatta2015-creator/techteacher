/**
 * techteacher — بوابة المعلم: منطق شاشة الدخول
 * ===================================================================
 * - قائمة منسدلة قابلة للبحث بأسماء المعلمين الفعلية من قاعدة البيانات.
 * - الدخول (اسم + رقم الهوية) يُتحقق منه في خادم Apps Script.
 * - توجيه تلقائي إذا كانت جلسة صالحة قائمة.
 */
(function () {
  'use strict';

  var A = window.TT_AUTH;
  var UI = window.TT_UI;

  var el = {
    error: document.getElementById('authError'),
    teacherForm: document.getElementById('teacherForm'),
    adminForm: document.getElementById('adminForm'),
    tabTeacher: document.getElementById('tabTeacher'),
    tabAdmin: document.getElementById('tabAdmin'),
    nameInput: document.getElementById('teacherName'),
    list: document.getElementById('teacherList'),
    picked: document.getElementById('pickedName'),
    pickedText: document.getElementById('pickedNameText'),
    pass: document.getElementById('teacherPass'),
    loginBtn: document.getElementById('loginBtn'),
    adminName: document.getElementById('adminName'),
    adminPass: document.getElementById('adminPass'),
    adminBtn: document.getElementById('adminLoginBtn')
  };

  /** أسماء المعلمين بعد الجلب */
  var teachers = [];
  /** الاسم المختار فعلياً (null يعني عدم الاختيار) */
  var selectedName = null;
  /** فهرس العنصر النشط في القائمة للأسهم */
  var activeIndex = -1;

  /* ==================================================================
   * أدوات العرض
   * ================================================================== */

  function showError(msg) {
    if (!msg) { el.error.hidden = true; return; }
    el.error.textContent = msg;
    el.error.hidden = false;
  }

  /** تطبيع بسيط للمطابقة أثناء الكتابة */
  function norm(s) {
    return String(s || '')
      .replace(/[ً-ْٰ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ==================================================================
   * القائمة المنسدلة القابلة للبحث
   * ================================================================== */

  function closeList() {
    el.list.hidden = true;
    el.nameInput.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function openList(items) {
    el.list.innerHTML = '';
    activeIndex = -1;

    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'combo-empty';
      empty.textContent = 'لا يوجد معلم مطابق';
      el.list.appendChild(empty);
    } else {
      items.slice(0, 60).forEach(function (name, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.textContent = name;
        li.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); // حتى لا يُغلق القائمة قبل الاختيار
          pick(name);
        });
        li.dataset.index = String(i);
        el.list.appendChild(li);
      });
    }

    el.list.hidden = false;
    el.nameInput.setAttribute('aria-expanded', 'true');
  }

  function visibleItems() {
    var q = norm(el.nameInput.value);
    if (!q) return teachers.slice(0, 60);
    return teachers.filter(function (n) {
      return norm(n).indexOf(q) !== -1;
    });
  }

  function pick(name) {
    selectedName = name;
    el.nameInput.value = name;
    el.pickedText.textContent = name;
    el.picked.hidden = false;
    closeList();
    showError('');
    el.pass.focus();
  }

  function clearPick() {
    selectedName = null;
    el.picked.hidden = true;
    el.pickedText.textContent = '';
  }

  function highlight(index) {
    var items = el.list.querySelectorAll('li[role="option"]');
    if (!items.length) return;
    if (index < 0) index = items.length - 1;
    if (index >= items.length) index = 0;
    activeIndex = index;
    for (var i = 0; i < items.length; i++) {
      var on = i === index;
      items[i].classList.toggle('active', on);
      items[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) items[i].scrollIntoView({ block: 'nearest' });
    }
  }

  el.nameInput.addEventListener('input', function () {
    clearPick();
    openList(visibleItems());
  });

  el.nameInput.addEventListener('focus', function () {
    if (teachers.length) openList(visibleItems());
  });

  el.nameInput.addEventListener('blur', function () {
    // تأخير الإغلاق حتى يعمل mousedown على العنصر
    setTimeout(closeList, 150);
  });

  el.nameInput.addEventListener('keydown', function (ev) {
    if (el.list.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
      openList(visibleItems());
      ev.preventDefault();
      return;
    }
    if (el.list.hidden) return;

    if (ev.key === 'ArrowDown') { highlight(activeIndex + 1); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { highlight(activeIndex - 1); ev.preventDefault(); }
    else if (ev.key === 'Enter' && activeIndex >= 0) {
      var item = el.list.querySelectorAll('li[role="option"]')[activeIndex];
      if (item) { pick(item.textContent); ev.preventDefault(); }
    }
    else if (ev.key === 'Escape') { closeList(); }
  });

  /* ==================================================================
   * تبويب الدور
   * ================================================================== */

  function showTab(which) {
    var isTeacher = which === 'teacher';
    el.tabTeacher.setAttribute('aria-selected', isTeacher ? 'true' : 'false');
    el.tabAdmin.setAttribute('aria-selected', isTeacher ? 'false' : 'true');
    el.teacherForm.hidden = !isTeacher;
    el.adminForm.hidden = isTeacher;
    showError('');
  }

  el.tabTeacher.addEventListener('click', function () { showTab('teacher'); });
  el.tabAdmin.addEventListener('click', function () { showTab('admin'); });

  /* ==================================================================
   * الإرسال
   * ================================================================== */

  function routeAfterLogin(sess) {
    if (sess.role === 'admin') {
      window.location.replace('./admin.html');
    } else {
      window.location.replace('./teacher.html');
    }
  }

  el.teacherForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showError('');

    var name = selectedName || el.nameInput.value.trim();
    var pass = el.pass.value.trim();

    if (!name) { showError('ابحث عن اسم المعلم واختره من القائمة.'); el.nameInput.focus(); return; }
    if (!pass) { showError('أدخل رقم الهوية / كلمة المرور.'); el.pass.focus(); return; }

    UI.busy(el.loginBtn, true, 'جارٍ التحقق…');
    A.login(name, pass).then(function (sess) {
      UI.busy(el.loginBtn, false);
      routeAfterLogin(sess);
    }, function (err) {
      UI.busy(el.loginBtn, false);
      showError(UI.showError(err, 'تعذّر تسجيل الدخول.'));
      el.pass.select();
    });
  });

  el.adminForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showError('');

    var name = el.adminName.value.trim();
    var pass = el.adminPass.value;
    if (!name || !pass) { showError('أدخل اسم المسؤول وكلمة المرور.'); return; }

    UI.busy(el.adminBtn, true, 'جارٍ التحقق…');
    A.login(name, pass).then(function (sess) {
      UI.busy(el.adminBtn, false);
      routeAfterLogin(sess);
    }, function (err) {
      UI.busy(el.adminBtn, false);
      showError(UI.showError(err, 'تعذّر تسجيل الدخول.'));
      el.adminPass.select();
    });
  });

  /* ==================================================================
   * البدء
   * ================================================================== */

  // رسالة خطأ مُمرَّرة من صفحة أخرى (انتهاء جلسة / صلاحية)
  var params = new URLSearchParams(window.location.search);
  if (params.get('e')) showError(decodeURIComponent(params.get('e')));

  // جلسة صالحة قائمة → توجيه مباشرة
  A.validate().then(function (sess) {
    routeAfterLogin(sess);
  }, function () { /* لا جلسة → نبقى في شاشة الدخول */ });

  // جلب أسماء المعلمين
  A.listTeachers().then(function (out) {
    teachers = (out && out.teachers) || [];
    if (!teachers.length) {
      el.nameInput.placeholder = 'لا توجد أسماء — تحقق من الاتصال';
    }
  }, function (err) {
    var msg = (err && err.error) || '';
    if (msg.indexOf('غير مفعلة') === -1) {
      showError('تعذّر جلب قائمة المعلمين — تحقق من الاتصال بالإنترنت.');
    } else {
      showError(msg);
    }
  });
})();
