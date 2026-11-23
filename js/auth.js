/**
 * techteacher — بوابة المعلم: الاتصال بالخادم والجلسات
 * ===================================================================
 * كل العمليات الحساسة (دخول، جلب بيانات، تعديل، صلاحيات) تمر عبر
 * خادم Apps Script (Code.gs) — الواجهة لا تتخزّن أي كلمة مرور ولا
 * تُصدّر بيانات غير مالك الجلسة.
 *
 * رمز الجلسة يُخزَّن محلياً لاستعادة الدخول بعد فتح الصفحة من جديد،
 * والخادم يتحقق منه في كل نداء (وهو مصدر الحقيقة الوحيد).
 */
(function (global) {
  'use strict';

  var C = global.TT_CONFIG;
  var STORE_KEY = 'tt_gateway_session';

  /* ==================================================================
   * نداءات الخادم
   * ================================================================== */

  /**
   * تنفيذ نداء GET على خادم البوابة.
   * @param {string} fn اسم الدالة في الخادم
   * @param {object} [params] معاملات إضافية
   * @returns {Promise<object>} استجابة الخادم JSON
   * @reject {object} {ok:false, error:'رسالة عربية'}
   */
  function call(fn, params) {
    if (!C.AUTH_SCRIPT_URL) {
      return Promise.reject({
        ok: false,
        error: 'خدمة بوابة المعلم غير مفعلة بعد — يرجى مراجعة مسؤول النظام.'
      });
    }

    var qs = 'FN=' + encodeURIComponent(fn);
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
          qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }
      }
    }

    var ctl = (global.AbortController) ? new AbortController() : null;
    var timer = null;
    if (ctl) timer = setTimeout(function () { ctl.abort(); }, C.FETCH_TIMEOUT_MS);

    var opts = { redirect: 'follow' };
    if (ctl) opts.signal = ctl.signal;

    return global.fetch(C.AUTH_SCRIPT_URL + '?' + qs, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw { ok: false, error: 'HTTP ' + res.status };
      return res.text();
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.ok === false) throw err;
      throw { ok: false, error: 'تعذّر الاتصال بخادم البوابة — تحقق من الاتصال.' };
    }).then(function (txt) {
      var out;
      try { out = JSON.parse(txt); } catch (e) {
        throw { ok: false, error: 'استجابة غير متوقعة من الخادم.' };
      }
      if (!out || out.ok !== true) {
        throw { ok: false, error: (out && out.error) || 'فشلت العملية.' };
      }
      return out;
    });
  }

  /* ==================================================================
   * الجلسة المحلية (للاستعادة فقط — الخادم هو المرجع)
   * ================================================================== */

  function getSession() {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setSession(sess) {
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(sess)); } catch (e) {}
    return sess;
  }

  function clearSession() {
    try { global.localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  function token() {
    var s = getSession();
    return s ? s.token : null;
  }

  /* ==================================================================
   * عمليات البوابة
   * ================================================================== */

  /** أسماء المعلمين لقائمة الدخول (لا تُعيد أي بيانات أخرى) */
  function listTeachers() {
    return call('listTeachers');
  }

  /** تسجيل الدخول وحفظ الجلسة محلياً */
  function login(name, password) {
    return call('login', { NAME: name, PASS: password }).then(function (out) {
      return setSession({
        token: out.token,
        name: out.name,
        role: out.role,
        teacherId: out.teacherId,
        mustChange: !!out.mustChange,
        at: Date.now()
      });
    });
  }

  /** التحقق من الجلسة على الخادم (يُحدّث الجلسة المحلية) */
  function validate() {
    var t = token();
    if (!t) return Promise.reject({ ok: false, error: 'no-session' });
    return call('validate', { TOKEN: t }).then(function (out) {
      var s = getSession() || {};
      s.name = out.name; s.role = out.role;
      s.teacherId = out.teacherId; s.mustChange = !!out.mustChange;
      return setSession(s);
    }, function (err) {
      clearSession();
      throw err;
    });
  }

  function logout() {
    var t = token();
    clearSession();
    if (!t) return Promise.resolve({ ok: true });
    return call('logout', { TOKEN: t }).catch(function () { /* نُكمل الخروج محلياً */ });
  }

  /** جلب بيانات المعلم صاحب الجلسة فقط */
  function getMyData() {
    return call('getMyData', { TOKEN: token() });
  }

  /** تعديل بياناتي (الخادم يتحقق من الحقول المسموحة) */
  function updateMyData(data) {
    return call('updateMyData', { TOKEN: token(), DATA: JSON.stringify(data) });
  }

  function changePassword(current, next, confirm) {
    return call('changePassword', {
      TOKEN: token(), CUR: current, NEW: next, CONF: confirm
    }).then(function (out) {
      var s = getSession();
      if (s) { s.mustChange = false; setSession(s); }
      return out;
    });
  }

  /* --- مسؤول النظام --- */

  function adminAccounts() { return call('adminAccounts', { TOKEN: token() }); }
  function adminReset(teacherId) { return call('adminReset', { TOKEN: token(), TEACHER_ID: teacherId }); }
  function adminStatus(teacherId, status) {
    return call('adminStatus', { TOKEN: token(), TEACHER_ID: teacherId, STATUS: status });
  }
  function adminAudit() { return call('adminAudit', { TOKEN: token() }); }

  /* ==================================================================
   * حماية الصفحات (تحقق من الخادم، وليس إخفاء عناصر فقط)
   * ================================================================== */

  /**
   * التأكد من جلسة صالحة قبل عرض الصفحة.
   * @param {string[]} [roles] أدوار مسموحة (فارغة = أي دور)
   * @returns {Promise<object>} الجلسة
   */
  function requireAuth(roles) {
    return validate().then(function (sess) {
      if (roles && roles.length && roles.indexOf(sess.role) === -1) {
        clearSession();
        global.location.replace('./login.html');
        return Promise.reject({ ok: false, error: 'لا تملك صلاحية الدخول إلى هذه الصفحة' });
      }
      return sess;
    }, function (err) {
      if (err && err.error === 'no-session') {
        global.location.replace('./login.html');
      } else {
        global.location.replace('./login.html?e=' +
          encodeURIComponent((err && err.error) || 'انتهت الجلسة'));
      }
      return Promise.reject(err);
    });
  }

  global.TT_AUTH = {
    call: call,
    listTeachers: listTeachers,
    login: login,
    validate: validate,
    logout: logout,
    getMyData: getMyData,
    updateMyData: updateMyData,
    changePassword: changePassword,
    adminAccounts: adminAccounts,
    adminReset: adminReset,
    adminStatus: adminStatus,
    adminAudit: adminAudit,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    requireAuth: requireAuth
  };
})(window);
