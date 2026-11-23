/**
 * techteacher — إعدادات التطبيق
 * ------------------------------------------------------------------
 * التطبيق يقرأ ويكتب على نفس جدول Google Sheets الذي يستخدمه
 * تطبيق MIT App Inventor الأصلي (techteacher.aia).
 *
 * كل الطلبات إلى Apps Script تتم عبر GET بنفس بروتوكول إضافة GSAI2:
 *   {ScriptUrl}?FN=<function>&ID=<sheetId>&SH=<sheetName>[&ROW=<n>]&DATA=<json>
 *
 * الأسماء الحساسة هنا منشورة علناً بالفعل داخل ملف .aia الأصلي،
 * ولذلك لا مشكلة من نشرها ضمن مستودع عام.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /* --- مصدر البيانات ------------------------------------------------ */
    SHEET_ID: '1r3QcCM_g4nccN_-s9dMhpmxtwKAIxbq0oYrDJVgRUsQ',
    SHEET_NAME: 'Sheet1',
    SCRIPT_URL:
      'https://script.google.com/macros/s/AKfycbwlNoJ4j71IEBaomMm0U6S8egoFtOTAlRyUzNsILGKEtIGknouUWgK-vn5Y-0NBouKbPg/exec',
    CSV_URL:
      'https://docs.google.com/spreadsheets/d/1r3QcCM_g4nccN_-s9dMhpmxtwKAIxbq0oYrDJVgRUsQ/export?format=csv',

    /* --- بوابة المعلم (خادم مستقل للدخول والصلاحيات) ------------------
     * يُملأ بعد نشر سكربت بوابة المعلم (apps-script/Code.gs) كتطبيق
     * ويب. وحين يكون فارغاً → تعرض صفحات البوابة رسالة «الخدمة غير مفعلة». */
    AUTH_SCRIPT_URL: '',

    /* --- خيارات الجلب ------------------------------------------------ */
    FETCH_TIMEOUT_MS: 25000,
    /** مهلة الانتظار قبل إعادة المحاولة تلقائياً */
    RETRY_DELAY_MS: 1200,
    /** مدة صلاحية النسخة المخزّنة محلياً (12 ساعة) */
    CACHE_TTL_MS: 12 * 60 * 60 * 1000,
    /** مهلة البحث أثناء الكتابة (مللي ثانية) */
    SEARCH_DEBOUNCE_MS: 110,

    /* --- الواجهة ------------------------------------------------------ */
    APP_NAME: 'تطبيق معلمي التكنولوجيا',
    APP_SHORT: 'معلمو التكنولوجيا',
    ORGANISATION: 'مديرية التربية والتعليم – يطا',
    HEADER_LINE: 'تطبيق خاص بمعلمي التكنولوجيا / مديرية التربية والتعليم - يطا',

    /* --- الحقول المطلوبة (对标 علامة * في النموذج الأصلي) -------------- */
    REQUIRED_FIELDS: [
      'name',
      'id',
      'location',
      'school',
      'degree',
      'specialty',
      'classes',
      'appointDate',
      'pedagogy',
      'courses'
    ],

    /* --- قوائم الاختيار ----------------------------------------------- */
    DEGREE_OPTIONS: ['دبلوم', 'بكالوريوس', 'ماجستير', 'دكتوراه'],
    PEDAGOGY_OPTIONS: [
      'لا يوجد',
      'يوجد تاهيل تربوي من الوزارة',
      'يوجد تاهيل تربوي شهادة منفصلة من الجامعة'
    ],

    /* --- جدول البرنامج الأسبوعي -------------------------------------- */
    /** أيام الأسبوع بالترتيب كما تظهر في الجدول */
    DAYS: ['الأحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'],
    /** عدد الحصص في اليوم الواحد */
    PERIODS: 7,
    /** العمود (1-based) الذي تبدأ عنده حصص اليوم الأول */
    SCHEDULE_START_COL: 13
  };

  /**
   * أسماء الأعمدة بالترتيب (1-based) — تطابق صف العناوين في الجدول.
   * أي فهرس هنا = رقم العمود في Google Sheets = item[n] في النسخة الأصلية.
   */
  CONFIG.COLUMNS = {
    name: 1,          // الاسم الرباعي
    id: 2,            // رقم الهوية
    location: 3,      // السكن
    school: 4,        // اسم المدرسة
    otherSchool: 5,   // المركز الاخر
    degree: 6,        // المؤهل العلمي
    specialty: 7,     // التخصص الجامعي
    classes: 8,       // الصفوف التي يدرسها
    appointDate: 9,   // تاريخ التعيين
    pedagogy: 10,     // المؤهل التربوي
    rowNo: 11,        // الرقم  (صيغة =row())
    updatedAt: 12,    // تاريخ التحديث
    // 13 .. 47 → 35 خانة للبرنامج الأسبوعي
    courses: 48,      // على مستوى المديرية
    workDays: 49      // ايام الدوام / نصف المركز
  };

  /** عدد الأعمدة الكلي في الجدول */
  CONFIG.TOTAL_COLUMNS = 49;

  /**
   * إرجاع عمود البرنامج الأسبوعي لليوم والحصة (كلاهما يبدأ من صفر).
   * اليوم 0 = الأحد والحصة 1 = العمود 13
   */
  CONFIG.scheduleCol = function (dayIndex, periodIndex) {
    return CONFIG.SCHEDULE_START_COL + dayIndex * CONFIG.PERIODS + periodIndex;
  };

  global.TT_CONFIG = CONFIG;
})(window);
