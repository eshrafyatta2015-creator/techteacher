/**
 * techteacher — الحفظ في جدول Google Sheets
 * ===================================================================
 * نعيد إنتاج بروتوكول إضافة GSAI2 المستخدم في تطبيق App Inventor
 * الأصلي، وهو بسيط جداً — طلب GET واحد بالمعاملات التالية:
 *
 *   {ScriptUrl}?FN=<function>&ID=<sheetId>&SH=<sheetName>
 *               [&ROW=<rowNumber>] &DATA=<json>
 *
 *   FN=appendRow  → إضافة صف جديد في نهاية الجدول
 *   FN=writeRow   → استبدال صف موجود بالكامل
 *
 * كل السجل يتكوّن من 49 خانة بالترتيب نفسه الذي يكتبه التطبيق الأصلي.
 */
(function (global) {
  'use strict';

  var C = global.TT_CONFIG;
  var D = global.TT_DATA;

  /** بناء رابط النداء */
  function buildUrl(fn, data, rowNo) {
    var url = C.SCRIPT_URL +
      '?FN=' + encodeURIComponent(fn) +
      '&ID=' + encodeURIComponent(C.SHEET_ID) +
      '&SH=' + encodeURIComponent(C.SHEET_NAME);

    if (rowNo != null && rowNo !== '') {
      url += '&ROW=' + encodeURIComponent(String(rowNo));
    }
    // encodeURIComponent إجباري: البيانات تحتوي على علامات تقتطع
    // سلسلة الاستعلام مثل  " ، [ ] و =row()
    url += '&DATA=' + encodeURIComponent(data);
    return url;
  }

  /** تنفيذ نداء الكتابة مع مهلة زمنية */
  function call(fn, data, rowNo) {
    var url = buildUrl(fn, data, rowNo);
    var ctl = (global.AbortController) ? new AbortController() : null;
    var timer = null;
    if (ctl) timer = setTimeout(function () { ctl.abort(); }, C.FETCH_TIMEOUT_MS);

    var opts = { redirect: 'follow' };
    if (ctl) opts.signal = ctl.signal;

    return global.fetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('انتهت مهلة الاتصال');
      throw new Error('تعذّر الاتصال بخادم Google');
    }).then(function (body) {
      var b = (body || '').trim();
      // خادم Apps Script يعيد نصاً يحتوي على كلمة خطأ عند الفشل
      if (/error|exception|fail/i.test(b) && b.length < 400 && !/^\[/.test(b)) {
        throw new Error(b.slice(0, 200));
      }
      return b;
    });
  }

  /**
   * حفظ سجل واحد.
   *
   * إن كان الرقم (العمود 11) معروفاً → تحديث الصف الموجود.
   * وإلا → إضافة صف جديد (يولّدها Sheets بصيغة =row()).
   *
   * @param {object} rec كائن السجل
   * @returns {Promise<{action:'updated'|'added', rowNo:number|string}>}
   */
  function saveRecord(rec) {
    var row = D.recordToRow(rec);
    var json = JSON.stringify(row);
    var rowNo = parseInt(rec.rowNo, 10);

    if (rowNo > 1) {
      return call('writeRow', json, rowNo).then(function () {
        return { action: 'updated', rowNo: rowNo };
      });
    }
    return call('appendRow', json, null).then(function () {
      return { action: 'added', rowNo: null };
    });
  }

  /**
   * تجربة الاتصال بخادم الكتابة دون المساس بالبيانات الحالية.
   * يستدعي دالة غير موجودة عمداً: نجاح الاتصال = استجابة نصية.
   */
  function ping() {
    var url = C.SCRIPT_URL + '?FN=__ping__' +
      '&ID=' + encodeURIComponent(C.SHEET_ID) +
      '&SH=' + encodeURIComponent(C.SHEET_NAME);
    return fetch(url, { redirect: 'follow' }).then(function (r) {
      return r.text();
    });
  }

  global.TT_SHEETS = {
    saveRecord: saveRecord,
    buildUrl: buildUrl,
    ping: ping
  };
})(window);
