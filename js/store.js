/**
 * techteacher — التخزين المحلي
 * ===================================================================
 * يحتفظ بآخر عمليات البحث، ومسودة النموذج، وإعدادات الواجهة،
 * وآخر نسخة من بيانات الجدول حتى يستمر التطبيق في العمل دون اتصال.
 */
(function (global) {
  'use strict';

  var NS = 'techteacher.v1.';
  var storage = null;

  /** localStorage قد يُرفض (وضع التصفح الخاص) — نستخدم مخزناً بديلاً */
  function backend() {
    if (storage !== null) return storage;
    try {
      var probe = '__tt_probe__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      storage = global.localStorage;
    } catch (e) {
      var mem = {};
      storage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
    return storage;
  }

  function get(key, fallback) {
    try {
      var raw = backend().getItem(NS + key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      backend().setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // مساحة ممتلئة أو وضع خاص
    }
  }

  function remove(key) {
    try { backend().removeItem(NS + key); } catch (e) { /* تجاهل */ }
  }

  /* ---------------------------------------------------------------
   * آخر عمليات البحث
   * ------------------------------------------------------------- */

  var RECENTS_MAX = 12;

  function getRecents() {
    var list = get('recents', []);
    return Array.isArray(list) ? list : [];
  }

  /** تسجيل استعلام سابق (يُحذف التكرار ويُحدَّث ترتيبه) */
  function addRecent(query) {
    var q = String(query || '').trim();
    if (q.length < 2) return;
    var list = getRecents().filter(function (x) { return x !== q; });
    list.unshift(q);
    if (list.length > RECENTS_MAX) list = list.slice(0, RECENTS_MAX);
    set('recents', list);
  }

  function clearRecents() {
    remove('recents');
  }

  /* ---------------------------------------------------------------
   * مسودة النموذج (يُستعاد عند إغلاق الصفحة بالخطأ)
   * ------------------------------------------------------------- */

  function saveDraft(data) {
    data.__savedAt = Date.now();
    return set('draft', data);
  }

  function getDraft() {
    var d = get('draft', null);
    if (!d) return null;
    // الصلاحية: 7 أيام
    if (Date.now() - (d.__savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      remove('draft');
      return null;
    }
    return d;
  }

  function clearDraft() {
    remove('draft');
  }

  /* ---------------------------------------------------------------
   * إعدادات الواجهة
   * ------------------------------------------------------------- */

  function getSettings() {
    return get('settings', { mode: 'all', filters: {} }) || { mode: 'all', filters: {} };
  }

  function saveSettings(patch) {
    var cur = getSettings();
    var keys = Object.keys(patch || {});
    for (var i = 0; i < keys.length; i++) cur[keys[i]] = patch[keys[i]];
    set('settings', cur);
    return cur;
  }

  /* ---------------------------------------------------------------
   * نسخة البيانات المخزّنة (للعمل دون اتصال)
   * ------------------------------------------------------------- */

  function saveDataSnapshot(records, meta) {
    return set('data', { records: records, meta: meta || {}, at: Date.now() });
  }

  function getDataSnapshot() {
    return get('data', null);
  }

  /* ---------------------------------------------------------------
   * آخر سجل تم فتحه
   * ------------------------------------------------------------- */

  function saveLastRecord(rec) {
    set('lastRecord', rec);
  }

  function getLastRecord() {
    return get('lastRecord', null);
  }

  global.TT_STORE = {
    get: get,
    set: set,
    remove: remove,
    getRecents: getRecents,
    addRecent: addRecent,
    clearRecents: clearRecents,
    saveDraft: saveDraft,
    getDraft: getDraft,
    clearDraft: clearDraft,
    getSettings: getSettings,
    saveSettings: saveSettings,
    saveDataSnapshot: saveDataSnapshot,
    getDataSnapshot: getDataSnapshot,
    saveLastRecord: saveLastRecord,
    getLastRecord: getLastRecord
  };
})(window);
