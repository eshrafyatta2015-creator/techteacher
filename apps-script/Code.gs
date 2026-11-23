/* ===================================================================
 * بوابة المعلم — خادم Apps Script
 * -------------------------------------------------------------------
 * ملف جديد مستقل عن سكربت التطبيق الأصلي (GSAI2) — لا يُمسّ السكربت
 * القديم ولا أعمدة الجدول الأصلية.
 *
 * ما يفعله هذا الخادم:
 *   1. تسجيل دخول المعلم (اسم + رقم الهوية) مع تحقق على الخادم.
 *   2. تجزئة كلمة المرور PBKDF2-SHA256 بملف ملح خاص لكل حساب
 *      (120,000 تكرار) — لا تُخزَّن أي كلمة مرور كنص مكشوف.
 *   3. جلسات مؤمّنة برمز عشوائي مخزَّن في ScriptProperties.
 *   4. جلب/تعديل بيانات المعلم حسب رمز الجلسة فقط (وليس الاسم
 *      القادم من الواجهة) — أي محاولة الوصول لبيانات معلم آخر تُرفض
 *      هنا في الخادم حتى لو عدّل المستخدم الواجهة.
 *   5. سجل تدقيق (AuditLog) لكل عملية.
 *
 * ورقتان جديدان في نفس ملف الجدول (إضافة فقط، بدون المساس بـ Sheet1):
 *   - Accounts : حسابات المعلمين والمسؤولين (مشفرات + صلاحيات)
 *   - AuditLog : سجل العمليات
 *
 * التشغيل:
 *   1) شغّل setup() مرة واحدة من محرر Apps Script (ينشئ الورقتين).
 *   2) شغّل createAdminFromEditor(الاسم, الهوية, كلمة المرور) مرة
 *      واحدة لإنشاء حساب المسؤول — أو استخدم createAdmin عبر الواجهة
 *      (تعمل مرة واحدة فقط ما لم يوجد مسؤول).
 *   3) Deploy ← New deployment ← Web app ← Anyone.
 * =================================================================== */

var CFG = {
  SHEET_ID: '1r3QcCM_g4nccN_-s9dMhpmxtwKAIxbq0oYrDJVgRUsQ',
  SHEET_NAME: 'Sheet1',
  ACCOUNTS_SHEET: 'Accounts',
  AUDIT_SHEET: 'AuditLog',

  ITERATIONS: 120000,       // PBKDF2 — أقل من 100 ألف غير مقبول حسب المواصفة
  SESSION_HOURS: 12,        // مدة صلاحية الجلسة
  MAX_TRIES: 5,             // محاولات دخول خاطئة قبل التعليق المؤقت
  LOCK_MINUTES: 15,         // مدة التعليق المؤقت

  /* أعمدة Sheet1 (1-based) — مطابقة لأعمدة النظام الحالي */
  COL: {
    name: 1, id: 2, location: 3, school: 4, otherSchool: 5,
    degree: 6, specialty: 7, classes: 8, appointDate: 9, pedagogy: 10,
    rowNo: 11, updatedAt: 12, scheduleStart: 13, courses: 48, workDays: 49
  },
  TOTAL_COLUMNS: 49,
  SCHEDULE_CELLS: 35        // 5 أيام × 7 حصص
};

/* أعمدة الحقول التي يسمح للمعلم بتعديلها فقط (الباقي محظور) */
var EDITABLE = {
  location: 3, school: 4, otherSchool: 5, degree: 6, specialty: 7,
  classes: 8, appointDate: 9, pedagogy: 10, courses: 48, workDays: 49
};

/* =================================================================== */
/* نقطة الدخول — كل النداءات GET بنفس بروتوكول النظام الحالي          */
/*   {URL}?FN=<dالة>&<معاملات>                                         */
/* =================================================================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var fn = String(p.FN || '');
  var out;

  try {
    switch (fn) {
      /* --- عام (بدون جلسة) --- */
      case 'listTeachers': out = listTeachers(); break;
      case 'login':        out = login(p.NAME, p.PASS); break;
      case 'validate':     out = validate(p.TOKEN); break;
      case 'logout':       out = logout(p.TOKEN); break;
      case 'hasAdmin':     out = { ok: true, hasAdmin: hasAdmin_() }; break;

      /* --- المعلم (جلسة مطلوبة) --- */
      case 'getMyData':      out = getMyData(p.TOKEN); break;
      case 'updateMyData':   out = updateMyData(p.TOKEN, p.DATA); break;
      case 'changePassword': out = changePassword(p.TOKEN, p.CUR, p.NEW, p.CONF); break;

      /* --- المسؤول (صلاحية admin مطلوبة) --- */
      case 'adminAccounts': out = adminAccounts(p.TOKEN); break;
      case 'adminReset':    out = adminReset(p.TOKEN, p.TEACHER_ID); break;
      case 'adminStatus':   out = adminStatus(p.TOKEN, p.TEACHER_ID, p.STATUS); break;
      case 'adminAudit':    out = adminAudit(p.TOKEN); break;

      /* --- إنشاء أول مسؤول (مرة واحدة فقط) --- */
      case 'createAdmin': out = createAdmin(p.NAME, p.ID, p.PASS); break;

      default:
        out = { ok: false, error: 'دالة غير معروفة' };
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }

  return json_(out);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =================================================================== */
/* أدوات عامة                                                          */
/* =================================================================== */

/** تطبيع الاسم العربي للمطابقة (همزات، تشكيل، مسافات، أرقام) */
function normName_(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ْٰ]/g, '')   // تشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** تطبيع رقم الهوية (أرقام هندية → لاتينية، إزالة المسافات) */
function normId_(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); })
    .replace(/\s+/g, '')
    .trim();
}

function props_() { return PropertiesService.getScriptProperties(); }

function nowStamp_() {
  var d = new Date();
  function p2(n) { return n < 10 ? '0' + n : String(n); }
  return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/* ------------------------- التجزئة ------------------------- */

function newSalt_() {
  // ملح عشوائي 64 بايت معروض كـ Base64
  return Utilities.base64Encode(
    Utilities.newBlob(Utilities.getUuid() + Utilities.getUuid()).getBytes()
  );
}

/** PBKDF2-SHA256 → نص Base64 (الملف مخزَّن Base64 ويُفك كـ byte[]) */
function hashPassword_(password, salt, iterations) {
  var spec = new java.security.spec.PBEKeySpec(
    String(password).toCharArray(),
    Utilities.base64Decode(salt),
    iterations,
    256
  );
  var factory = javax.crypto.SecretKeyFactory.getInstance('PBKDF2WithHmacSHA256');
  var key = factory.generateSecret(spec);
  spec.clearPassword();
  return Utilities.base64Encode(key.getEncoded());
}

function verifyPassword_(password, salt, iterations, expected) {
  var actual = hashPassword_(password, salt, iterations);
  // مقارنة بطول ثابت لتفادي هجمات التوقيت
  if (actual.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/* =================================================================== */
/* الوصول إلى الجداول                                                   */
/* =================================================================== */

function spreadsheet_() { return SpreadsheetApp.openById(CFG.SHEET_ID); }

function teacherSheet_() {
  var s = spreadsheet_().getSheetByName(CFG.SHEET_NAME);
  if (!s) throw new Error('ورقة البيانات الأصلية غير موجودة');
  return s;
}

function ensureSheet_(name, headers) {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

var ACCOUNT_HEADERS = [
  'TeacherID', 'Name', 'NationalID', 'PasswordHash', 'Salt', 'Iterations',
  'MustChangePassword', 'LastLogin', 'AccountStatus', 'Role',
  'CreatedAt', 'UpdatedAt'
];
var AUDIT_HEADERS = ['At', 'TeacherID', 'Name', 'Action', 'Details'];

function accountsSheet_() {
  return ensureSheet_(CFG.ACCOUNTS_SHEET, ACCOUNT_HEADERS);
}

function auditSheet_() {
  return ensureSheet_(CFG.AUDIT_SHEET, AUDIT_HEADERS);
}

/** إنشاء الورقتين يدوياً (شغّله من المحرر مرة واحدة) */
function setup() {
  accountsSheet_();
  auditSheet_();
  return 'تم إنشاء الورقتين Accounts و AuditLog';
}

/* ------------------------- سجل التدقيق ------------------------- */

function audit_(teacherId, name, action, details) {
  try {
    auditSheet_().appendRow([nowStamp_(), teacherId || '', name || '', action, details || '']);
  } catch (e) { /* لا نُفشل العملية بسبب السجل */ }
}

/* =================================================================== */
/* الحسابات                                                            */
/* =================================================================== */

function readAccounts_() {
  var sh = accountsSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      row: i + 1,
      teacherId: String(r[0]),
      name: String(r[1]),
      nationalId: String(r[2]),
      hash: String(r[3]),
      salt: String(r[4]),
      iterations: Number(r[5]) || CFG.ITERATIONS,
      mustChange: String(r[6]) === 'TRUE' || String(r[6]) === 'true',
      lastLogin: String(r[7]),
      status: String(r[8] || 'active'),
      role: String(r[9] || 'teacher'),
      createdAt: String(r[10]),
      updatedAt: String(r[11])
    });
  }
  return out;
}

function findAccount_(teacherId) {
  var all = readAccounts_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].teacherId === teacherId) return all[i];
  }
  return null;
}

function writeAccount_(acc) {
  var sh = accountsSheet_();
  var row = [
    acc.teacherId, acc.name, acc.nationalId, acc.hash, acc.salt,
    acc.iterations, acc.mustChange ? 'TRUE' : 'FALSE', acc.lastLogin || '',
    acc.status || 'active', acc.role || 'teacher',
    acc.createdAt || nowStamp_(), nowStamp_()
  ];
  if (acc.row) {
    sh.getRange(acc.row, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
    acc.row = sh.getLastRow();
  }
  return acc;
}

function createAccount_(teacherId, name, nationalId, password, role, mustChange) {
  var salt = newSalt_();
  var acc = {
    teacherId: teacherId,
    name: name,
    nationalId: nationalId,
    hash: hashPassword_(password, salt, CFG.ITERATIONS),
    salt: salt,
    iterations: CFG.ITERATIONS,
    mustChange: !!mustChange,
    lastLogin: '',
    status: 'active',
    role: role || 'teacher',
    createdAt: nowStamp_()
  };
  return writeAccount_(acc);
}

function hasAdmin_() {
  var all = readAccounts_();
  for (var i = 0; i < all.length; i++) {
    if (all[i].role === 'admin') return true;
  }
  return false;
}

/* =================================================================== */
/* الجلسات                                                            */
/* =================================================================== */

function newSession_(acc) {
  var token = Utilities.getUuid().replace(/-/g, '') +
              Utilities.getUuid().replace(/-/g, '');
  var sess = {
    teacherId: acc.teacherId,
    name: acc.name,
    role: acc.role,
    mustChange: acc.mustChange,
    exp: Date.now() + CFG.SESSION_HOURS * 3600 * 1000
  };
  props_.setProperty('sess:' + token, JSON.stringify(sess));
  return { token: token, session: sess };
}

function readSession_(token) {
  if (!token) return null;
  var raw = props_.getProperty('sess:' + token);
  if (!raw) return null;
  var sess;
  try { sess = JSON.parse(raw); } catch (e) { return null; }
  if (!sess || !sess.exp || Date.now() > sess.exp) {
    props_.deleteProperty('sess:' + token);
    return null;
  }
  return sess;
}

/** جلسة صالحة أو رمي خطأ */
function requireSession_(token) {
  var sess = readSession_(token);
  if (!sess) throw new Error('انتهت الجلسة — يرجى تسجيل الدخول من جديد');
  return sess;
}

function requireAdmin_(token) {
  var sess = requireSession_(token);
  if (sess.role !== 'admin') throw new Error('هذه العملية لمسؤول النظام فقط');
  return sess;
}

/* =================================================================== */
/* الدخول والخروج                                                      */
/* =================================================================== */

function bumpTries_(key) {
  var p = props_();
  var n = Number(p.getProperty(key) || 0) + 1;
  p.setProperty(key, String(n));
  p.setProperty(key + ':at', String(Date.now()));
  return n;
}

function checkLock_(key) {
  var p = props_();
  var n = Number(p.getProperty(key) || 0);
  if (n < CFG.MAX_TRIES) return;
  var at = Number(p.getProperty(key + ':at') || 0);
  if (Date.now() - at < CFG.LOCK_MINUTES * 60 * 1000) {
    throw new Error('تم تعليق الدخول مؤقتاً بعد محاولات خاطئة — حاول لاحقاً');
  }
  p.deleteProperty(key);
  p.deleteProperty(key + ':at');
}

function clearTries_(key) {
  var p = props_();
  p.deleteProperty(key);
  p.deleteProperty(key + ':at');
}

/**
 * محاولة دخول واحدة لسجل معلم مطابق.
 * تُرمي استثناء عند الفشل وتُرجع نتيجة الجلسة عند النجاح.
 */
function tryTeacherLogin_(hit, accounts, pass) {
  var rowNoRaw = hit.row[CFG.COL.rowNo - 1];
  var rowNo = Number(rowNoRaw) || (hit.index + 1);
  var teacherId = 'T' + rowNo;
  var nationalId = normId_(hit.row[CFG.COL.id - 1]);
  var teacherName = String(hit.row[CFG.COL.name - 1]).trim();

  var triesKey = 'tries:' + teacherId;
  checkLock_(triesKey);

  var acc = null;
  for (var a = 0; a < accounts.length; a++) {
    if (accounts[a].teacherId === teacherId) { acc = accounts[a]; break; }
  }

  if (!acc) {
    // أول استخدام → الحساب يُنشأ بالكلمة الافتراضية (رقم الهوية)
    if (normId_(pass) !== nationalId) {
      bumpTries_(triesKey);
      audit_(teacherId, teacherName, 'login_failed', 'رقم هوية غير صحيح');
      throw new Error('رقم الهوية غير صحيح');
    }
    acc = createAccount_(teacherId, teacherName, nationalId, nationalId, 'teacher', true);
    audit_(teacherId, teacherName, 'account_created', 'إنشاء حساب أول دخول');
  }

  if (acc.status !== 'active') {
    audit_(teacherId, teacherName, 'login_blocked', 'حساب معلّق');
    throw new Error('الحساب معلّق — يرجى مراجعة مسؤول النظام');
  }

  // التحقق من كلمة المرور الحالية (الهوية افتراضياً، أو ما غيّره المعلم)
  if (!verifyPassword_(pass, acc.salt, acc.iterations, acc.hash)) {
    bumpTries_(triesKey);
    audit_(teacherId, teacherName, 'login_failed', 'كلمة مرور خاطئة');
    throw new Error('رقم الهوية غير صحيح');
  }

  clearTries_(triesKey);
  acc.lastLogin = nowStamp_();
  writeAccount_(acc);

  var created = newSession_(acc);
  audit_(teacherId, teacherName, 'login', 'نجاح تسجيل الدخول');

  return {
    ok: true,
    token: created.token,
    role: acc.role,
    name: acc.name,
    teacherId: acc.teacherId,
    mustChange: acc.mustChange
  };
}

/**
 * تسجيل الدخول.
 * المعلم: مطابقة (الاسم + رقم الهوية) مع Sheet1 — وإنشاء الحساب تلقائياً
 * عند أول استخدام بكلمة المرور الافتراضية = رقم الهوية.
 * المسؤول: مطابقة الاسم مع Accounts حيث Role=admin.
 */
function login(name, pass) {
  name = normName_(name);
  pass = String(pass || '').trim();
  if (!name || !pass) throw new Error('أدخل اسم المعلم ورقم الهوية');

  var accounts = readAccounts_();

  /* --- 1) البحث في سجلات المعلمين --- */
  var values = teacherSheet_().getDataRange().getValues();
  var matches = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (normName_(row[CFG.COL.name - 1]) !== name) continue;
    matches.push({ index: i, row: row });
  }

  var lastTeacherError = null;

  /* --- محاولة الدخول لكل تطابق ممكن (يدعم أسماء مكررة) --- */
  for (var c = 0; c < matches.length; c++) {
    try {
      return tryTeacherLogin_(matches[c], accounts, pass);
    } catch (err) {
      lastTeacherError = err;
    }
  }

  /* --- 2) البحث في حسابات المسؤولين --- */
  for (var j = 0; j < accounts.length; j++) {
    var adm = accounts[j];
    if (adm.role !== 'admin') continue;
    if (normName_(adm.name) !== name) continue;

    var akey = 'tries:' + adm.teacherId;
    checkLock_(akey);

    if (!verifyPassword_(pass, adm.salt, adm.iterations, adm.hash)) {
      bumpTries_(akey);
      audit_(adm.teacherId, adm.name, 'login_failed', 'كلمة مرور خاطئة (مسؤول)');
      throw new Error('بيانات الدخول غير صحيحة');
    }
    clearTries_(akey);
    adm.lastLogin = nowStamp_();
    writeAccount_(adm);
    var sc = newSession_(adm);
    audit_(adm.teacherId, adm.name, 'login', 'دخول مسؤول');
    return {
      ok: true, token: sc.token, role: adm.role, name: adm.name,
      teacherId: adm.teacherId, mustChange: false
    };
  }

  if (lastTeacherError) throw lastTeacherError;
  throw new Error('لا يوجد معلم بهذا الاسم في قاعدة البيانات');
}

function validate(token) {
  var sess = readSession_(token);
  if (!sess) return { ok: false, error: 'انتهت الجلسة' };
  return {
    ok: true,
    name: sess.name,
    role: sess.role,
    teacherId: sess.teacherId,
    mustChange: sess.mustChange
  };
}

function logout(token) {
  if (token) props_.deleteProperty('sess:' + token);
  return { ok: true };
}

/* =================================================================== */
/* بيانات المعلم — مقيّدة بالجلسة فقط                                   */
/* =================================================================== */

function recordFromRow_(row) {
  var c = CFG.COL;
  var rec = {
    name: str_(row[c.name - 1]),
    id: str_(row[c.id - 1]),
    location: str_(row[c.location - 1]),
    school: str_(row[c.school - 1]),
    otherSchool: str_(row[c.otherSchool - 1]),
    degree: str_(row[c.degree - 1]),
    specialty: str_(row[c.specialty - 1]),
    classes: str_(row[c.classes - 1]),
    appointDate: str_(row[c.appointDate - 1]),
    pedagogy: str_(row[c.pedagogy - 1]),
    rowNo: str_(row[c.rowNo - 1]),
    updatedAt: str_(row[c.updatedAt - 1]),
    courses: str_(row[c.courses - 1]),
    workDays: str_(row[c.workDays - 1]),
    schedule: []
  };
  for (var k = 0; k < CFG.SCHEDULE_CELLS; k++) {
    rec.schedule.push(str_(row[c.scheduleStart - 1 + k]));
  }
  return rec;
}

function str_(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    var d = v;
    function p2(n) { return n < 10 ? '0' + n : String(n); }
    return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  return String(v).trim();
}

/** إيجاد صف المعلم في Sheet1 اعتماداً على معرّفه (من الجلسة) */
function findTeacherRow_(teacherId) {
  var values = teacherSheet_().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var rowNo = Number(values[i][CFG.COL.rowNo - 1]) || (i + 1);
    if ('T' + rowNo === teacherId) rows.push({ index: i, row: values[i], rowNo: rowNo });
  }
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new Error('توجد أكثر من سجل لهذا المعلم — راجع الجدول');
  return rows[0];
}

/** جلب بيانات المعلم المسجّل دخوله فقط */
function getMyData(token) {
  var sess = requireSession_(token);
  if (sess.role === 'admin') return { ok: true, record: null, role: 'admin' };

  var hit = findTeacherRow_(sess.teacherId);
  if (!hit) throw new Error('لم يتم العثور على سجل المعلم');
  return { ok: true, record: recordFromRow_(hit.row), teacherId: sess.teacherId };
}

/* ------------------------- التعديل ------------------------- */

function validDate_(s) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return false;
  var d = +m[1], mo = +m[2], y = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  var dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/**
 * تعديل بيانات المعلم — حسب رمز الجلسة، وبحقول مسموحة فقط.
 * يرفض: تغيير الاسم/الهوية، أي حقل خارج القائمة، أو بيانات غير صالحة.
 */
function updateMyData(token, dataJson) {
  var sess = requireSession_(token);
  if (sess.role === 'admin') throw new Error('استخدم حساب المعلم لتعديل البيانات');
  if (sess.mustChange) throw new Error('غيّر كلمة المرور أولاً قبل تعديل البيانات');

  var data;
  try { data = JSON.parse(dataJson); } catch (e) { throw new Error('بيانات غير صالحة'); }
  if (!data || typeof data !== 'object') throw new Error('بيانات غير صالحة');

  // منع التعديل غير المصرّح به: أي حقل خارج القائمة يُتجاهَل أو يُرفض
  var forbidden = ['name', 'id', 'rowNo', 'updatedAt'];
  for (var f = 0; f < forbidden.length; f++) {
    if (Object.prototype.hasOwnProperty.call(data, forbidden[f])) {
      throw new Error('لا يسمح بتغيير الاسم أو رقم الهوية');
    }
  }

  var hit = findTeacherRow_(sess.teacherId);
  if (!hit) throw new Error('لم يتم العثور على سجل المعلم');

  var row = hit.row.slice();
  var changed = [];

  /* --- الحقول المسموحة --- */
  for (var key in EDITABLE) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    var val = String(data[key] == null ? '' : data[key]).trim();
    if (val.length > 200) throw new Error('القيمة طويلة جداً في الحقل: ' + key);
    if (val !== str_(row[EDITABLE[key] - 1])) {
      row[EDITABLE[key] - 1] = val;
      changed.push(key);
    }
  }

  /* --- التحقق من المدخلات --- */
  var required = ['school', 'degree', 'specialty', 'classes', 'appointDate'];
  for (var r = 0; r < required.length; r++) {
    if (!str_(row[CFG.COL[required[r]] - 1])) {
      throw new Error('الحقل مطلوب: ' + required[r]);
    }
  }
  var ad = str_(row[CFG.COL.appointDate - 1]);
  if (ad && !validDate_(ad)) {
    throw new Error('تاريخ التعيين غير صحيح (مثال: 23/08/2017)');
  }

  /* --- البرنامج الأسبوعي --- */
  if (Object.prototype.hasOwnProperty.call(data, 'schedule')) {
    var sch = data.schedule;
    if (!Array.isArray(sch) || sch.length !== CFG.SCHEDULE_CELLS) {
      throw new Error('البرنامج الأسبوعي غير مكتمل');
    }
    for (var s = 0; s < sch.length; s++) {
      var v = String(sch[s] == null ? '' : sch[s]).trim();
      if (v.length > 40) throw new Error('خانة البرنامج طويلة جداً');
      var colIdx = CFG.COL.scheduleStart - 1 + s;
      if (v !== str_(row[colIdx])) {
        row[colIdx] = v;
        changed.push('schedule[' + s + ']');
      }
    }
  }

  if (!changed.length) {
    return { ok: true, changed: false, message: 'لا توجد تغييرات للحفظ', record: recordFromRow_(row) };
  }

  /* --- منع التكرار: التأكد من صف واحد فقط لهذا المعلم --- */
  var all = teacherSheet_().getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < all.length; i++) {
    var rn = Number(all[i][CFG.COL.rowNo - 1]) || (i + 1);
    if ('T' + rn === sess.teacherId) count++;
  }
  if (count !== 1) throw new Error('تعذّر التحقق من السجل (عدد السجلات: ' + count + ')');

  row[CFG.COL.updatedAt - 1] = nowStamp_();
  var range = teacherSheet_().getRange(hit.index + 1, 1, 1, CFG.TOTAL_COLUMNS);
  range.setValues([row]);

  audit_(sess.teacherId, sess.name, 'update_profile', changed.join(', '));

  return {
    ok: true,
    changed: true,
    message: 'تم حفظ البيانات بنجاح',
    record: recordFromRow_(row)
  };
}

/* =================================================================== */
/* تغيير كلمة المرور                                                   */
/* =================================================================== */

function changePassword(token, current, next, confirm) {
  var sess = requireSession_(token);

  current = String(current || '').trim();
  next = String(next || '').trim();
  confirm = String(confirm || '').trim();

  if (!current || !next || !confirm) throw new Error('أكمل جميع حقول كلمة المرور');
  if (next !== confirm) throw new Error('كلمتا المرور الجديدتان غير متطابقتين');
  if (next.length < 6) throw new Error('كلمة المرور الجديدة يجب ألا تقل عن 6 خانات');
  if (next === current) throw new Error('كلمة المرور الجديدة يجب أن تختلف عن الحالية');

  var acc = findAccount_(sess.teacherId);
  if (!acc) throw new Error('الحساب غير موجود');

  // المعلم الحالي: عليه إثبات كلمة المرور الحالية (حتى بعد إعادة التعيين)
  if (!verifyPassword_(current, acc.salt, acc.iterations, acc.hash)) {
    audit_(acc.teacherId, acc.name, 'password_failed', 'كلمة مرور حالية خاطئة');
    throw new Error('كلمة المرور الحالية غير صحيحة');
  }

  var salt = newSalt_();
  acc.hash = hashPassword_(next, salt, CFG.ITERATIONS);
  acc.salt = salt;
  acc.iterations = CFG.ITERATIONS;
  acc.mustChange = false;
  writeAccount_(acc);

  // تحديث الجلسة الحالية (mustChange)
  var p = props_();
  var raw = p.getProperty('sess:' + token);
  if (raw) {
    try {
      var s = JSON.parse(raw);
      s.mustChange = false;
      p.setProperty('sess:' + token, JSON.stringify(s));
    } catch (e) {}
  }

  audit_(acc.teacherId, acc.name, 'password_changed', 'تغيير كلمة المرور');
  return { ok: true, message: 'تم تغيير كلمة المرور بنجاح' };
}

/* =================================================================== */
/* مسؤول النظام                                                        */
/* =================================================================== */

/** إنشاء حساب مسؤول — يعمل مرة واحدة فقط ما لم يوجد مسؤول */
function createAdmin(name, id, password) {
  name = String(name || '').trim();
  id = normId_(id);
  password = String(password || '').trim();
  if (!name || !id || password.length < 6) {
    throw new Error('الاسم والهوية وكلمة مرور (6 خانات على الأقل) مطلوبة');
  }
  if (hasAdmin_()) throw new Error('يوجد مسؤول مسجّل بالفعل — سجّل الدخول');

  var acc = createAccount_('ADM1', name, id, password, 'admin', false);
  audit_(acc.teacherId, name, 'admin_created', 'إنشاء حساب مسؤول');
  return { ok: true, message: 'تم إنشاء حساب المسؤول — يمكنك تسجيل الدخول الآن' };
}

/** إنشاء حساب مسؤول من محرر Apps Script (أكثر أماناً) */
function createAdminFromEditor(name, id, password) {
  return JSON.stringify(createAdmin(name, id, password));
}

/** قائمة الحسابات + المعلمون بلا حساب (للمسؤول فقط) */
function adminAccounts(token) {
  requireAdmin_(token);

  var accounts = readAccounts_();
  var byId = {};
  for (var i = 0; i < accounts.length; i++) byId[accounts[i].teacherId] = accounts[i];

  var out = [];
  var values = teacherSheet_().getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = str_(row[CFG.COL.name - 1]);
    if (!name) continue;
    var rowNo = Number(row[CFG.COL.rowNo - 1]) || (r + 1);
    var tid = 'T' + rowNo;
    var acc = byId[tid];
    out.push({
      teacherId: tid,
      name: name,
      nationalId: str_(row[CFG.COL.id - 1]),
      hasAccount: !!acc,
      mustChange: acc ? acc.mustChange : null,
      lastLogin: acc ? acc.lastLogin : '',
      status: acc ? acc.status : 'غير مُنشأ',
      role: acc ? acc.role : 'teacher'
    });
    if (acc) delete byId[tid];
  }

  // حسابات إضافية (مسؤولون) لم تُربط بسجل معلم
  for (var left in byId) {
    if (!Object.prototype.hasOwnProperty.call(byId, left)) continue;
    var a = byId[left];
    out.push({
      teacherId: a.teacherId, name: a.name, nationalId: a.nationalId,
      hasAccount: true, mustChange: a.mustChange, lastLogin: a.lastLogin,
      status: a.status, role: a.role
    });
  }

  return { ok: true, accounts: out };
}

/** إعادة تعيين كلمة مرور معلم إلى رقم هويته (للمسؤول فقط) */
function adminReset(token, teacherId) {
  var sess = requireAdmin_(token);
  var acc = findAccount_(String(teacherId || ''));
  if (!acc) throw new Error('الحساب غير موجود — أدخل كلمة المرور بعد أول دخول للمعلم');
  if (acc.role === 'admin' && acc.teacherId !== sess.teacherId) {
    throw new Error('لا يمكن إعادة تعيين كلمة مرور مسؤول آخر');
  }

  var salt = newSalt_();
  acc.hash = hashPassword_(acc.nationalId, salt, CFG.ITERATIONS);
  acc.salt = salt;
  acc.iterations = CFG.ITERATIONS;
  acc.mustChange = true;
  acc.status = 'active';
  writeAccount_(acc);
  clearTries_('tries:' + acc.teacherId);

  audit_(sess.teacherId, sess.name, 'admin_reset', 'إعادة تعيين كلمة مرور: ' + acc.name);
  return { ok: true, message: 'أُعيدت كلمة المرور إلى رقم الهوية — ويُطلب تغييرها عند أول دخول' };
}

/** تعليق/تفعيل حساب (للمسؤول فقط) */
function adminStatus(token, teacherId, status) {
  var sess = requireAdmin_(token);
  status = String(status || '');
  if (status !== 'active' && status !== 'suspended') throw new Error('حالة غير صالحة');

  var acc = findAccount_(String(teacherId || ''));
  if (!acc) throw new Error('الحساب غير موجود');
  if (acc.role === 'admin') throw new Error('لا يمكن تعليق حساب مسؤول');

  acc.status = status;
  writeAccount_(acc);

  // إنهاء كل جلسات هذا المعلم فوراً
  var p = props_();
  var keys = p.getKeys();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf('sess:') !== 0) continue;
    var raw = p.getProperty(keys[i]);
    try {
      var s = JSON.parse(raw);
      if (s && s.teacherId === acc.teacherId) p.deleteProperty(keys[i]);
    } catch (e) {}
  }

  audit_(sess.teacherId, sess.name, 'admin_status',
         (status === 'active' ? 'تفعيل: ' : 'تعليق: ') + acc.name);
  return { ok: true, message: status === 'active' ? 'تم تفعيل الحساب' : 'تم تعليق الحساب' };
}

/** آخر 100 عملية في سجل التدقيق (للمسؤول فقط) */
function adminAudit(token) {
  requireAdmin_(token);
  var sh = auditSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = values.length - 1; i >= 1 && out.length < 100; i--) {
    var r = values[i];
    out.push({
      at: str_(r[0]), teacherId: str_(r[1]), name: str_(r[2]),
      action: str_(r[3]), details: str_(r[4])
    });
  }
  return { ok: true, entries: out };
}
