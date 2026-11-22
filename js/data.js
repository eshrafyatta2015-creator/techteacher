/**
 * techteacher — جلب البيانات من جدول Google Sheets
 * ===================================================================
 * ثلاثة مصادر بالترتيب، ويعود على المصدر التالي عند الفشل:
 *   1. Apps Script  (FN=readSheet)  ← JSON + CORS مفتوح
 *   2. تصدير CSV من Google Sheets
 *   3. آخر نسخة مخزّنة محلياً (يعمل التطبيق دون اتصال)
 */
(function (global) {
  'use strict';

  var C = global.TT_CONFIG;

  /* ==================================================================
   * تحليل CSV (يتعامل مع علامات الاقتباس والأسطر المضمنة)
   * ================================================================== */

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;

    // إزالة علامة BOM
    if (text.charCodeAt(0) === 0xFEFF) i = 1;

    while (i < n) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }

      if (ch === '"') { inQuotes = true; i++; continue; }

      if (ch === ',') { row.push(field); field = ''; i++; continue; }

      if (ch === '\r') { i++; continue; }
      if (ch === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
        i++; continue;
      }

      field += ch; i++;
    }

    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /**
   * قراءة خانة بأمان (خارج حدود المصفوفة → نص فارغ).
   *
   * ملاحظة مهمة: Apps Script يُعيد الخانات التي كُتبت كتواريخ على
   * هيئة ISO-8601 (مثل 2017-08-22T21:00:00.000Z) بينما تصدير CSV
   * يُعيدها بصيغة الجدول dd/MM/yyyy. نوحّد الشكل هنا حتى لا يختلف
   * المظهر بحسب المصدر.
   */
  var ISO_DT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

  function isoToDayFirst(m) {
    var y = m[1], mo = m[2], d = m[3];
    var hh = m[4] != null ? parseInt(m[4], 10) : 0;
    // منتصف الليل في منطقة UTC+2/+3 يظهر كـ 20:00–22:00 من اليوم السابق
    // في UTC — نُصحّح بإضافة يوم واحد لنصل إلى التاريخ الحقيقي.
    var shift = (m[4] != null && hh >= 20) ? 1 : 0;
    if (shift) {
      var tmp = new Date(Date.UTC(+y, +mo - 1, +d + 1));
      y = String(tmp.getUTCFullYear());
      mo = String(tmp.getUTCMonth() + 1).padStart(2, '0');
      d = String(tmp.getUTCDate()).padStart(2, '0');
    }
    return d + '/' + mo + '/' + y;
  }

  function cell(row, col1) {
    if (!row) return '';
    var v = row[col1 - 1];
    if (v == null) return '';
    v = String(v).trim();
    if (!v) return '';
    var m = ISO_DT.exec(v);
    if (m) return isoToDayFirst(m);
    return v;
  }

  /* ==================================================================
   * تحويل صف الجدول ← كائن سجل
   * ================================================================== */

  function rowToRecord(row) {
    var cols = C.COLUMNS;
    var rec = {
      name: cell(row, cols.name),
      id: cell(row, cols.id),
      location: cell(row, cols.location),
      school: cell(row, cols.school),
      otherSchool: cell(row, cols.otherSchool),
      degree: cell(row, cols.degree),
      specialty: cell(row, cols.specialty),
      classes: cell(row, cols.classes),
      appointDate: cell(row, cols.appointDate),
      pedagogy: cell(row, cols.pedagogy),
      rowNo: cell(row, cols.rowNo),
      updatedAt: cell(row, cols.updatedAt),
      courses: cell(row, cols.courses),
      workDays: cell(row, cols.workDays),
      schedule: []
    };

    for (var d = 0; d < C.DAYS.length; d++) {
      for (var p = 0; p < C.PERIODS; p++) {
        rec.schedule[d * C.PERIODS + p] = cell(row, C.scheduleCol(d, p));
      }
    }
    return rec;
  }

  /* ==================================================================
   * تحويل كائن سجل ← صف الجدول (49 خانة)
   * ================================================================== */

  function recordToRow(rec) {
    var cols = C.COLUMNS;
    var row = new Array(C.TOTAL_COLUMNS);

    function put(col1, v) { row[col1 - 1] = v == null ? '' : String(v); }

    put(cols.name, rec.name);
    put(cols.id, rec.id);
    put(cols.location, rec.location);
    put(cols.school, rec.school);
    put(cols.otherSchool, rec.otherSchool);
    put(cols.degree, rec.degree);
    put(cols.specialty, rec.specialty);
    put(cols.classes, rec.classes);
    put(cols.appointDate, rec.appointDate);
    put(cols.pedagogy, rec.pedagogy);

    // العمود 11 = صيغة =row() داخل الجدول (يولّدها Sheets تلقائياً عند الإضافة)
    put(cols.rowNo, '=row()');

    // تاريخ التحديث
    put(cols.updatedAt, formatDate(new Date()));

    for (var d = 0; d < C.DAYS.length; d++) {
      for (var p = 0; p < C.PERIODS; p++) {
        var idx = d * C.PERIODS + p;
        put(C.scheduleCol(d, p), rec.schedule ? rec.schedule[idx] : '');
      }
    }

    put(cols.courses, rec.courses);
    put(cols.workDays, rec.workDays);

    return row;
  }

  /** yyyy/MM/dd — لتفادي مشاكل الشهر في Date */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatDate(d) {
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* ==================================================================
   * الجلب
   * ================================================================== */

  function withTimeout(url, ms) {
    var ctl = (global.AbortController) ? new AbortController() : null;
    var timer = null;
    if (ctl && ms) {
      timer = setTimeout(function () { ctl.abort(); }, ms);
    }
    var opts = { redirect: 'follow' };
    if (ctl) opts.signal = ctl.signal;
    return global.fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /** المصدر 1: Apps Script — يُرجع JSON من نوع مصفوفة مصفوفات */
  function fromAppsScript() {
    var url = C.SCRIPT_URL +
      '?FN=readSheet' +
      '&ID=' + encodeURIComponent(C.SHEET_ID) +
      '&SH=' + encodeURIComponent(C.SHEET_NAME);
    return withTimeout(url, C.FETCH_TIMEOUT_MS).then(function (res) {
      return res.text();
    }).then(function (txt) {
      var data = JSON.parse(txt);
      if (!Array.isArray(data)) throw new Error('استجابة غير متوقعة');
      return data;
    });
  }

  /** المصدر 2: تصدير CSV */
  function fromCsv() {
    return withTimeout(C.CSV_URL, C.FETCH_TIMEOUT_MS).then(function (res) {
      return res.text();
    }).then(parseCsv);
  }

  /**
   * جلب كل السجلات.
   * @param {object} [opts]
   * @param {boolean} [opts.force] تجاهل النسخة المخزّنة والاتصال مباشرة
   * @returns {Promise<{records:Array, meta:object, source:string, stale:boolean}>}
   */
  function fetchRecords(opts) {
    opts = opts || {};
    var store = global.TT_STORE;
    var snap = store ? store.getDataSnapshot() : null;

    // نسخة محلية حديثة وليست إجبارية → نُعيدها فوراً ثم نُحدّث في الخلفية
    if (!opts.force && snap && snap.records && snap.records.length &&
        (Date.now() - snap.at) < C.CACHE_TTL_MS) {
      refreshInBackground();
      return Promise.resolve({
        records: snap.records,
        meta: snap.meta || {},
        source: 'cache',
        stale: false
      });
    }

    return loadFresh().then(function (out) {
      if (store) store.saveDataSnapshot(out.records, out.meta);
      return out;
    }).catch(function (err) {
      // فشل كل المصادر → نرجع على آخر نسخة مهما كانت قديمة
      if (snap && snap.records && snap.records.length) {
        return {
          records: snap.records,
          meta: snap.meta || {},
          source: 'offline-cache',
          stale: true,
          error: err.message
        };
      }
      throw err;
    });
  }

  /**
   * تجربة المصادر بالترتيب.
   *
   * نبدأ بـ CSV لأن التطبيق الأصلي (App Inventor) يقرأ منه، وله ميزة
   * مهمة: التواريخ تظهر بصيغة الجدول dd/MM/yyyy. Apps Script بديل عند
   * فشل التصدير (ونوحّد شكل التواريخ في قراءة الخانة).
   */
  function loadFresh() {
    return fromCsv().catch(function (e1) {
      return fromAppsScript().catch(function (e2) {
        throw new Error('تعذّر الاتصال بجدول البيانات (' + e1.message + ' / ' + e2.message + ')');
      });
    }).then(function (matrix) {
      if (!matrix || matrix.length < 2) throw new Error('الجدول فارغ');
      var header = matrix[0];
      var records = [];
      for (var i = 1; i < matrix.length; i++) {
        var r = rowToRecord(matrix[i]);
        // نتجاهل الأسطر الفارغة أو صف العناوين المتكرر
        if (!r.name) continue;
        if (i === 1 && r.name === header[0]) continue;
        r.__row = i + 1; // رقم الصف داخل الجدول (للتحديث)
        records.push(r);
      }
      if (!records.length) throw new Error('لا توجد سجلات');
      return {
        records: records,
        meta: { count: records.length, header: header, fetchedAt: Date.now() },
        source: 'live'
      };
    });
  }

  /** تحديث صامت في الخلفية (لا يعطّل الواجهة) */
  function refreshInBackground() {
    loadFresh().then(function (out) {
      var store = global.TT_STORE;
      if (store) store.saveDataSnapshot(out.records, out.meta);
      global.dispatchEvent(new CustomEvent('tt:data-updated', { detail: out }));
    }).catch(function () { /* نتجاهل — نحتفظ بالنسخة الحالية */ });
  }

  /* ==================================================================
   * القيم الحصرية للفلاتر (تُشتق من البيانات نفسها)
   * ================================================================== */

  function distinctValues(records, key) {
    var seen = {};
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var v = (records[i][key] || '').trim();
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    out.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
    return out;
  }

  global.TT_DATA = {
    parseCsv: parseCsv,
    rowToRecord: rowToRecord,
    recordToRow: recordToRow,
    fetchRecords: fetchRecords,
    distinctValues: distinctValues,
    formatDate: formatDate
  };
})(window);
