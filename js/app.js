/**
 * techteacher — منطق التطبيق الرئيسي
 * ===================================================================
 * يربط: جلب البيانات ← فهرسة البحث ← الواجهة ← الحفظ ← التثبيت (PWA)
 */
(function () {
  'use strict';

  var C = window.TT_CONFIG;
  var S = window.TT_SEARCH;
  var D = window.TT_DATA;
  var STORE = window.TT_STORE;
  var SHEETS = window.TT_SHEETS;

  /* ==================================================================
   * الحالة
   * ================================================================== */

  var state = {
    records: [],
    index: [],
    mode: 'all',
    filters: {},
    results: [],
    selectedIdx: -1,
    current: null,      // السجل المفتوح في النموذج
    ready: false,
    saving: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  /* ==================================================================
   * تعريف حقول النموذج
   * ================================================================== */

  var FORM_FIELDS = [
    { key: 'name',        label: 'الاسم الرباعي',   required: true,  placeholder: 'الاسم الرباعي كاملاً' },
    { key: 'degree',      label: 'المؤهل العلمي',   required: true,  type: 'select', options: C.DEGREE_OPTIONS },
    { key: 'id',          label: 'رقم الهوية',      required: true,  inputmode: 'numeric', placeholder: '9 أرقام' },
    { key: 'specialty',   label: 'التخصص الجامعي',  required: true,  placeholder: 'مثال: تكنولوجيا المعلومات' },
    { key: 'location',    label: 'السكن',           required: true,  placeholder: 'القرية / الحي' },
    { key: 'classes',     label: 'الصفوف التي يدرسها', required: true, wide: true, placeholder: 'مثال: الصف العاشر — الحاسوب' },
    { key: 'school',      label: 'اسم المدرسة',     required: true,  placeholder: 'اسم المدرسة الرسمي' },
    { key: 'appointDate', label: 'تاريخ التعيين',   required: true,  inputmode: 'numeric', placeholder: 'يوم/شهر/سنة — مثل 23/08/2017' },
    { key: 'pedagogy',    label: 'المؤهل التربوي',  required: true,  type: 'select', options: C.PEDAGOGY_OPTIONS },
    { key: 'otherSchool', label: 'اسم المدرسة الأخرى / نصف المركز', required: false, placeholder: 'اختياري' },
    { key: 'workDays',    label: 'أيام الدوام في المدارس / نصف المركز', required: false, placeholder: 'اختياري' },
    { key: 'courses',     label: 'الدورات التي حصلت/ي عليها (على مستوى المديرية)', required: true, wide: true, placeholder: 'مثال: دورة تكنولوجيا المعلومات 2023' }
  ];

  /* ==================================================================
   * أدوات صغيرة
   * ================================================================== */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function toast(message, kind, ms) {
    var host = els.toastHost;
    var t = el('div', { class: 'toast ' + (kind || ''), role: 'status' }, [
      document.createTextNode(message)
    ]);
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, ms || 3200);
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    if (!parts[0]) return '؟';
    var a = parts[0][0];
    var b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).trim();
  }

  /* ==================================================================
   * بناء النموذج
   * ================================================================== */

  function buildForm() {
    var grid = els.formGrid;
    grid.textContent = '';

    FORM_FIELDS.forEach(function (f) {
      var inputId = 'f_' + f.key;
      var input;

      if (f.type === 'select') {
        input = el('select', { id: inputId, name: f.key });
        input.appendChild(el('option', { value: '', text: '— اختر —' }));
        (f.options || []).forEach(function (o) {
          input.appendChild(el('option', { value: o, text: o }));
        });
      } else {
        input = el('input', {
          id: inputId, name: f.key, type: 'text',
          inputmode: f.inputmode || 'text',
          autocomplete: 'off',
          placeholder: f.placeholder || ''
        });
      }

      var label = el('label', { for: inputId });
      label.appendChild(document.createTextNode(f.label + ' '));
      if (f.required) {
        label.appendChild(el('span', { class: 'req', text: '*', title: 'حقل مطلوب' }));
      }

      var err = el('span', { class: 'field-error', id: 'e_' + f.key });

      var wrap = el('div', { class: 'field' + (f.wide ? ' wide' : ''), 'data-key': f.key },
                    [label, input, err]);
      grid.appendChild(wrap);

      input.addEventListener('input', onFormChanged);
      input.addEventListener('change', onFormChanged);
      input.addEventListener('blur', function () {
        if (state.current) validateField(f, input);
      });
    });
  }

  /** بناء جدول البرنامج الأسبوعي (5 أيام × 7 حصص) */
  function buildSchedule() {
    var table = els.scheduleTable;
    table.textContent = '';

    var thead = el('thead');
    var headRow = el('tr');
    headRow.appendChild(el('th', { scope: 'col', class: 'period', text: 'الحصة' }));
    C.DAYS.forEach(function (d) {
      headRow.appendChild(el('th', { scope: 'col', text: d }));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el('tbody');
    for (var p = 0; p < C.PERIODS; p++) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row', class: 'period', text: 'الحصة ' + (p + 1) }));
      for (var d = 0; d < C.DAYS.length; d++) {
        var td = el('td');
        var input = el('input', {
          type: 'text',
          id: 'sch_' + d + '_' + p,
          'data-day': d, 'data-period': p,
          autocomplete: 'off',
          'aria-label': C.DAYS[d] + ' — الحصة ' + (p + 1),
          placeholder: 'الصف'
        });
        input.addEventListener('input', onFormChanged);
        td.appendChild(input);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  /* ==================================================================
   * التعبئة / القراءة
   * ================================================================== */

  function setFormValues(rec) {
    FORM_FIELDS.forEach(function (f) {
      var input = $('f_' + f.key);
      if (input) input.value = rec ? (rec[f.key] || '') : '';
      var field = document.querySelector('.field[data-key="' + f.key + '"]');
      if (field) { field.classList.remove('invalid'); }
      var err = $('e_' + f.key);
      if (err) err.textContent = '';
    });

    for (var d = 0; d < C.DAYS.length; d++) {
      for (var p = 0; p < C.PERIODS; p++) {
        var i = $('sch_' + d + '_' + p);
        if (i) i.value = rec && rec.schedule ? (rec.schedule[d * C.PERIODS + p] || '') : '';
      }
    }
  }

  function getFormValues() {
    var rec = {};
    FORM_FIELDS.forEach(function (f) {
      var input = $('f_' + f.key);
      rec[f.key] = input ? String(input.value || '').trim() : '';
    });

    rec.schedule = [];
    for (var d = 0; d < C.DAYS.length; d++) {
      for (var p = 0; p < C.PERIODS; p++) {
        var i = $('sch_' + d + '_' + p);
        rec.schedule[d * C.PERIODS + p] = i ? String(i.value || '').trim() : '';
      }
    }

    // نُبقي أرقام الصف والتحديث من السجل الأصلي حتى تتم الكتابة في مكانها
    if (state.current) {
      rec.rowNo = state.current.rowNo || '';
      rec.updatedAt = state.current.updatedAt || '';
      rec.__row = state.current.__row;
    } else {
      rec.rowNo = '';
      rec.updatedAt = '';
    }
    return rec;
  }

  function openRecord(rec, opts) {
    opts = opts || {};
    state.current = rec || null;
    setFormValues(rec);
    els.recordPanel.hidden = false;

    if (rec) {
      els.recordKicker.textContent = rec.rowNo
        ? 'صف ' + rec.rowNo + ' في الجدول'
        : 'سجل غير محفوظ بعد';
      els.recordTitle.textContent = rec.name || 'بيانات المعلم/ة';
      STORE.saveLastRecord(rec);
    } else {
      els.recordKicker.textContent = 'سجل جديد';
      els.recordTitle.textContent = 'بيانات المعلم/ة';
    }

    els.draftNote.hidden = true;
    setSaveStatus('', '');

    if (opts.scroll !== false) {
      els.recordPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (opts.focus) {
      var first = $('f_name');
      if (first) setTimeout(function () { first.focus(); }, 260);
    }
  }

  /* ==================================================================
   * التحقق من الصحة
   * ================================================================== */

  function validateField(f, input) {
    var field = input.closest('.field');
    var err = $('e_' + f.key);
    var ok = true;

    if (f.required && !String(input.value || '').trim()) {
      ok = false;
      if (err) err.textContent = 'هذا الحقل مطلوب';
    } else if (f.key === 'id' && input.value.trim()) {
      var digits = input.value.replace(/\D/g, '');
      if (digits.length < 6) {
        ok = false;
        if (err) err.textContent = 'رقم الهوية غير مكتمل';
      } else if (err) err.textContent = '';
    } else if (err) {
      err.textContent = '';
    }

    if (field) field.classList.toggle('invalid', !ok);
    return ok;
  }

  function validateAll() {
    var firstBad = null;
    var badCount = 0;

    FORM_FIELDS.forEach(function (f) {
      var input = $('f_' + f.key);
      if (!input) return;
      if (!validateField(f, input)) {
        badCount++;
        if (!firstBad) firstBad = input;
      }
    });

    if (firstBad) {
      firstBad.focus({ preventScroll: true });
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return { ok: badCount === 0, count: badCount };
  }

  /* ==================================================================
   * البحث
   * ================================================================== */

  function readFilters() {
    return {
      degree: els.filterDegree.value,
      school: els.filterSchool.value,
      specialty: els.filterSpecialty.value
    };
  }

  function hasActiveFilters() {
    var f = state.filters;
    return !!(f.degree || f.school || f.specialty);
  }

  function runSearch(opts) {
    opts = opts || {};
    if (!state.ready) return;

    var query = els.searchInput.value;
    var out = S.search({
      query: query,
      mode: state.mode,
      filters: state.filters,
      index: state.index,
      limit: 60
    });

    state.results = out.results;
    state.selectedIdx = -1;

    renderResults(out, query);

    if (opts.remember && String(query).trim().length >= 2) {
      STORE.addRecent(query);
      renderRecents();
    }
  }

  var debouncedSearch = debounce(function () { runSearch(); }, C.SEARCH_DEBOUNCE_MS);

  function renderResults(out, query) {
    var list = els.resultsList;
    list.textContent = '';
    els.clearSearchBtn.hidden = !query;

    var q = String(query || '').trim();
    var browsing = !q && !hasActiveFilters();

    /* --- عدّاد النتائج --- */
    if (!state.ready) return;
    if (browsing) {
      els.resultCount.textContent =
        out.total > 60
          ? 'عرض 60 من ' + out.total + ' سجلاً — اكتب في مربع البحث للتصفية'
          : 'عدد السجلات: ' + out.total;
    } else if (out.total === 0) {
      els.resultCount.textContent = 'لا توجد نتائج مطابقة';
    } else {
      els.resultCount.textContent = 'عدد النتائج: ' + out.total +
        (out.truncated ? ' (معروض 60)' : '');
    }
    els.searchTime.textContent = out.took != null ? out.took + ' ms' : '';

    /* --- القائمة الفارغة --- */
    var isEmpty = out.results.length === 0;
    els.emptyState.hidden = !isEmpty;
    if (isEmpty) list.hidden = true;
    else list.hidden = false;
    if (isEmpty) return;

    /* --- عرض النتائج --- */
    var frag = document.createDocumentFragment();
    out.results.forEach(function (r, i) {
      frag.appendChild(renderResultItem(r, i));
    });
    list.appendChild(frag);
  }

  function renderResultItem(r, i) {
    var rec = r.rec;

    var li = el('li', {
      class: 'result-item', role: 'option', 'aria-selected': 'false',
      'data-idx': i, tabindex: '-1'
    });

    li.appendChild(el('span', { class: 'result-avatar', text: initials(rec.name), 'aria-hidden': 'true' }));

    var body = el('span', { class: 'result-body' });

    var nameLine = el('span', { class: 'result-name' });
    paint(nameLine, rec.name, r.matches, 'name');
    body.appendChild(nameLine);

    var sub = el('span', { class: 'result-sub' });
    if (rec.school) {
      var s1 = el('span');
      paint(s1, rec.school, r.matches, 'school');
      sub.appendChild(s1);
    }
    if (rec.specialty) {
      var s2 = el('span');
      paint(s2, rec.specialty, r.matches, 'specialty');
      sub.appendChild(s2);
    }
    if (!rec.school && !rec.specialty && rec.location) {
      var s3 = el('span', { text: rec.location });
      sub.appendChild(s3);
    }
    body.appendChild(sub);
    li.appendChild(body);

    if (rec.id) {
      var badge = el('span', { class: 'result-score' });
      paint(badge, rec.id, r.matches, 'id');
      li.appendChild(badge);
    }

    li.addEventListener('click', function () { chooseResult(i); });
    return li;
  }

  /** رسم نص مع تظليل الأجزاء المطابقة — بدون أي حقن HTML */
  function paint(container, original, matches, fieldKey) {
    var ranges = S.rangesFor(matches, fieldKey);
    var parts = S.highlight(original, ranges);
    parts.forEach(function (p) {
      if (p.hit) {
        container.appendChild(el('mark', { text: p.text }));
      } else {
        container.appendChild(document.createTextNode(p.text));
      }
    });
  }

  function chooseResult(i) {
    var r = state.results[i];
    if (!r) return;
    state.selectedIdx = i;
    Array.prototype.forEach.call(els.resultsList.children, function (node, n) {
      node.setAttribute('aria-selected', n === i ? 'true' : 'false');
    });
    openRecord(Object.assign({}, r.rec), { scroll: true });
  }

  /* --- التنقّل بلوحة المفاتيح --- */
  function moveSelection(delta) {
    var n = state.results.length;
    if (!n) return;
    var next = state.selectedIdx + delta;
    if (next < 0) next = n - 1;
    if (next >= n) next = 0;
    state.selectedIdx = next;

    Array.prototype.forEach.call(els.resultsList.children, function (node, i) {
      node.setAttribute('aria-selected', i === next ? 'true' : 'false');
    });
    var active = els.resultsList.children[next];
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
      els.searchInput.setAttribute('aria-activedescendant', 'res-' + next);
    }
  }

  /* --- عمليات البحث السابقة --- */
  function renderRecents() {
    var list = STORE.getRecents();
    els.recentsRow.hidden = list.length === 0;
    els.recentsChips.textContent = '';
    list.forEach(function (q) {
      var chip = el('button', { type: 'button', class: 'chip', text: q });
      chip.addEventListener('click', function () {
        els.searchInput.value = q;
        runSearch({ remember: true });
        els.searchInput.focus();
      });
      els.recentsChips.appendChild(chip);
    });
  }

  /* ==================================================================
   * الفلاتر
   * ================================================================== */

  function populateFilters() {
    fillSelect(els.filterDegree, D.distinctValues(state.records, 'degree'), 'الكل');
    fillSelect(els.filterSchool, D.distinctValues(state.records, 'school'), 'الكل');
    fillSelect(els.filterSpecialty, D.distinctValues(state.records, 'specialty'), 'الكل');
  }

  function fillSelect(select, values, allLabel) {
    var prev = select.value;
    select.textContent = '';
    select.appendChild(el('option', { value: '', text: allLabel }));
    values.forEach(function (v) {
      select.appendChild(el('option', { value: v, text: v }));
    });
    // نُبقي الاختيار السابق إن كان لا يزال موجوداً
    if (prev && values.indexOf(prev) !== -1) select.value = prev;
  }

  /* ==================================================================
   * الحفظ
   * ================================================================== */

  function setSaveStatus(text, kind) {
    els.saveStatus.textContent = text || '';
    els.saveStatus.className = 'save-status ' + (kind || '');
  }

  function save() {
    if (state.saving) return;
    if (!state.ready) { toast('البيانات لم تُحمَّل بعد', 'warn'); return; }

    var check = validateAll();
    if (!check.ok) {
      setSaveStatus('أكمل ' + check.count + ' حقلاً مطلوباً', 'err');
      toast('يرجى إكمال الحقول المطلوبة', 'err');
      return;
    }

    var rec = getFormValues();
    state.saving = true;
    els.saveBtn.disabled = true;
    setSaveStatus('جارٍ الحفظ…', '');

    SHEETS.saveRecord(rec).then(function (res) {
      state.current = Object.assign({}, rec, { rowNo: rec.rowNo });
      STORE.clearDraft();

      if (res.action === 'added') {
        setSaveStatus('تمت الإضافة بنجاح ✓', 'ok');
        toast('تمت إضافة السجل إلى الجدول', 'ok');
        els.recordKicker.textContent = 'سجل جديد — تمت الإضافة';
        // نحتاج رقم الصف الجديد → نُحدّث البيانات في الخلفية
        refreshData(true);
      } else {
        setSaveStatus('تم تحديث الصف ' + res.rowNo + ' ✓', 'ok');
        toast('تم تحديث البيانات بنجاح', 'ok');
        els.recordKicker.textContent = 'صف ' + res.rowNo + ' في الجدول';
      }
    }).catch(function (err) {
      setSaveStatus('فشل الحفظ', 'err');
      toast(err.message || 'تعذّر الحفظ', 'err', 5000);
    }).then(function () {
      state.saving = false;
      els.saveBtn.disabled = false;
    });
  }

  /* ==================================================================
   * مسودة النموذج
   * ================================================================== */

  var saveDraftSoon = debounce(function () {
    if (!state.current && !els.searchInput) return;
    var rec = getFormValues();
    var empty = FORM_FIELDS.every(function (f) { return !rec[f.key]; }) &&
                rec.schedule.every(function (v) { return !v; });
    if (empty) { STORE.clearDraft(); return; }
    STORE.saveDraft(rec);
  }, 900);

  function onFormChanged() {
    setSaveStatus('', '');
    saveDraftSoon();
  }

  /* ==================================================================
   * البيانات
   * ================================================================== */

  function applyData(records, meta, source, stale) {
    state.records = records;
    state.index = S.buildIndex(records);
    state.ready = true;

    populateFilters();
    renderRecents();
    runSearch();

    els.loadingCard.hidden = true;
    els.errorCard.hidden = true;

    var stamp = meta && meta.fetchedAt ? new Date(meta.fetchedAt) : new Date();
    var srcLabel = source === 'live' ? 'مباشر'
                 : source === 'cache' ? 'محفوظة مؤقتاً'
                 : 'نسخة محفوظة (دون اتصال)';
    els.dataStatus.textContent = records.length + ' سجلًا · ' + srcLabel +
      ' · ' + stamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    if (stale) {
      els.offlineBanner.hidden = false;
      els.offlineText.textContent = 'تعذّر التحديث — يُعرض آخر نسخة محفوظة.';
    } else {
      // نجاح التحديث → نُخفي شريط التنبيه إن كان ظاهراً
      els.offlineBanner.hidden = true;
    }

    // استعادة آخر سجل مفتوح أو مسودة محفوظة
    restoreSession();
  }

  function showError(message) {
    els.loadingCard.hidden = true;
    els.errorCard.hidden = false;
    els.errorMessage.textContent = message;
    var snap = STORE.getDataSnapshot();
    els.offlineDataBtn.hidden = !(snap && snap.records && snap.records.length);
  }

  function loadData(force) {
    els.loadingCard.hidden = false;
    els.errorCard.hidden = true;

    return D.fetchRecords({ force: !!force }).then(function (out) {
      applyData(out.records, out.meta, out.source, out.stale);
    }).catch(function (err) {
      showError(err.message || 'تعذّر الاتصال بجدول البيانات.');
    });
  }

  function refreshData(force) {
    return loadData(force).then(function () {
      if (force) toast('تم تحديث البيانات', 'ok', 2000);
    });
  }

  function restoreSession() {
    // 1) مسودة محفوظة
    var draft = STORE.getDraft();
    if (draft && !state.current) {
      openRecord(draft, { scroll: false });
      els.draftNote.hidden = false;
      return;
    }
    // 2) آخر سجل مفتوح
    var last = STORE.getLastRecord();
    if (last && last.name && !state.current) {
      openRecord(last, { scroll: false });
    }
  }

  /* ==================================================================
   * التثبيت (PWA)
   * ================================================================== */

  var deferredPrompt = null;

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      els.installBtn.hidden = false;
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      els.installBtn.hidden = true;
      toast('تم تثبيت التطبيق ✓', 'ok');
    });

    els.installBtn.addEventListener('click', triggerInstall);
    $('dialogInstallBtn').addEventListener('click', function () {
      if (deferredPrompt) {
        els.installDialog.close();
        triggerInstall();
      } else {
        toast('استخدم زر «مشاركة» في المتصفح ثم «إضافة إلى الشاشة الرئيسية»', 'warn', 5200);
      }
    });

    els.installHelpBtn.addEventListener('click', function () {
      if (typeof els.installDialog.showModal === 'function') els.installDialog.showModal();
      else els.installDialog.setAttribute('open', '');
    });

    // آيفون/آيباد: لا يوجد حدث beforeinstallprompt → نُظهر الزر دائماً كتلميح
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
    if (isIOS && !isStandalone) els.installBtn.hidden = false;
  }

  function triggerInstall() {
    if (!deferredPrompt) {
      els.installHelpBtn.click();
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') toast('جارٍ التثبيت…', 'ok', 2000);
      deferredPrompt = null;
      els.installBtn.hidden = true;
    });
  }

  /* ==================================================================
   * الشبكة
   * ================================================================== */

  function setupNetwork() {
    function update() {
      var online = navigator.onLine !== false;
      els.netBadge.dataset.state = online ? 'online' : 'offline';
      els.netBadge.querySelector('.net-text').textContent = online ? 'متصل' : 'دون اتصال';
      if (online) {
        // عاد الاتصال → نُخفي الشريط؛ إن فشل التحديث سيعيده applyData بحالة stale
        els.offlineBanner.hidden = true;
      } else {
        els.offlineBanner.hidden = false;
        els.offlineText.textContent = 'أنت غير متصل بالإنترنت — يتم عرض آخر نسخة محفوظة.';
      }
    }
    window.addEventListener('online', function () {
      update();
      toast('عاد الاتصال — جارٍ التحديث…', 'ok', 2400);
      refreshData(false);
    });
    window.addEventListener('offline', function () {
      update();
      toast('انقطع الاتصال — تُعرض البيانات المحفوظة', 'warn', 3000);
    });
    update();
  }

  /* ==================================================================
   * الخدمة (Service Worker)
   * ================================================================== */

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return; // لا يعمل من file://

    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function (err) {
      // فشل التسجيل لا يمنع العمل — نتجاهله بصمت
      if (window.console) console.warn('SW registration failed:', err);
    });
  }

  /* ==================================================================
   * ربط الأحداث
   * ================================================================== */

  function bindEvents() {
    /* --- البحث --- */
    els.searchInput.addEventListener('input', function () {
      els.clearSearchBtn.hidden = !els.searchInput.value;
      debouncedSearch();
    });

    els.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (state.selectedIdx >= 0) chooseResult(state.selectedIdx);
        else if (state.results.length) chooseResult(0);
        runSearch({ remember: true });
      } else if (e.key === 'Escape') {
        els.searchInput.value = '';
        els.clearSearchBtn.hidden = true;
        runSearch();
      }
    });

    els.clearSearchBtn.addEventListener('click', function () {
      els.searchInput.value = '';
      els.clearSearchBtn.hidden = true;
      els.searchInput.focus();
      runSearch();
    });

    els.searchMode.addEventListener('change', function () {
      state.mode = els.searchMode.value;
      STORE.saveSettings({ mode: state.mode });
      runSearch();
    });

    /* --- الفلاتر --- */
    ['filterDegree', 'filterSchool', 'filterSpecialty'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        state.filters = readFilters();
        STORE.saveSettings({ filters: state.filters });
        runSearch();
      });
    });

    els.resetFiltersBtn.addEventListener('click', function () {
      els.filterDegree.value = '';
      els.filterSchool.value = '';
      els.filterSpecialty.value = '';
      state.filters = readFilters();
      STORE.saveSettings({ filters: state.filters });
      runSearch();
      toast('تمت إعادة ضبط الفلاتر', '', 1800);
    });

    /* --- النموذج --- */
    els.saveBtn.addEventListener('click', save);

    els.clearFormBtn.addEventListener('click', function () {
      openRecord(null, { scroll: false });
      STORE.clearDraft();
      els.draftNote.hidden = true;
      setFormValues(null);
      toast('تم مسح النموذج', '', 1800);
    });

    els.newRecordBtn.addEventListener('click', function () {
      openRecord(null, { scroll: true, focus: true });
      STORE.clearDraft();
      els.draftNote.hidden = true;
    });

    els.discardDraftBtn.addEventListener('click', function () {
      STORE.clearDraft();
      els.draftNote.hidden = true;
      openRecord(null, { scroll: false });
      setFormValues(null);
      toast('تم تجاهل المسودة', '', 1800);
    });

    /* --- البيانات --- */
    els.refreshBtn.addEventListener('click', function () { refreshData(true); });
    els.retryBtn.addEventListener('click', function () { loadData(true); });
    els.offlineDataBtn.addEventListener('click', function () {
      var snap = STORE.getDataSnapshot();
      if (snap && snap.records) {
        applyData(snap.records, snap.meta, 'offline-cache', true);
        toast('تم عرض النسخة المحفوظة', 'ok', 2200);
      }
    });

    /* --- تحديث البيانات في الخلفية --- */
    window.addEventListener('tt:data-updated', function (e) {
      var out = e.detail;
      if (!out || !out.records) return;
      state.records = out.records;
      state.index = S.buildIndex(out.records);
      state.ready = true;
      populateFilters();
      runSearch();
      // التحديث الخلفي نجح → نُخفي شريط التنبيه ونُحدّح الحالة
      els.offlineBanner.hidden = true;
      els.loadingCard.hidden = true;
      els.errorCard.hidden = true;
      var stamp = out.meta && out.meta.fetchedAt ? new Date(out.meta.fetchedAt) : new Date();
      els.dataStatus.textContent = out.records.length + ' سجلًا · مباشر · ' +
        stamp.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    });

    /* --- اختصار: / للبحث --- */
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== els.searchInput &&
          !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
      }
    });
  }

  /* ==================================================================
   * الإقلاع
   * ================================================================== */

  function init() {
    els = {
      searchInput: $('searchInput'),
      clearSearchBtn: $('clearSearchBtn'),
      searchMode: $('searchMode'),
      filterDegree: $('filterDegree'),
      filterSchool: $('filterSchool'),
      filterSpecialty: $('filterSpecialty'),
      resetFiltersBtn: $('resetFiltersBtn'),
      resultCount: $('resultCount'),
      searchTime: $('searchTime'),
      resultsList: $('resultsList'),
      emptyState: $('emptyState'),
      recentsRow: $('recentsRow'),
      recentsChips: $('recentsChips'),
      recordPanel: $('recordPanel'),
      recordKicker: $('recordKicker'),
      recordTitle: $('recordTitle'),
      formGrid: $('formGrid'),
      scheduleTable: $('scheduleTable'),
      saveBtn: $('saveBtn'),
      saveStatus: $('saveStatus'),
      newRecordBtn: $('newRecordBtn'),
      clearFormBtn: $('clearFormBtn'),
      draftNote: $('draftNote'),
      discardDraftBtn: $('discardDraftBtn'),
      loadingCard: $('loadingCard'),
      errorCard: $('errorCard'),
      errorMessage: $('errorMessage'),
      retryBtn: $('retryBtn'),
      offlineDataBtn: $('offlineDataBtn'),
      refreshBtn: $('refreshBtn'),
      netBadge: $('netBadge'),
      offlineBanner: $('offlineBanner'),
      offlineText: $('offlineText'),
      dataStatus: $('dataStatus'),
      installBtn: $('installBtn'),
      installHelpBtn: $('installHelpBtn'),
      installDialog: $('installDialog'),
      toastHost: $('toastHost')
    };

    /* أوضاع البحث في القائمة المنسدلة */
    S.MODES.forEach(function (m) {
      els.searchMode.appendChild(el('option', { value: m.id, text: m.label }));
    });

    /* استعادة الإعدادات */
    var settings = STORE.getSettings();
    state.mode = settings.mode || 'all';
    state.filters = settings.filters || {};
    els.searchMode.value = state.mode;

    buildForm();
    buildSchedule();
    bindEvents();
    setupInstall();
    setupNetwork();
    setupServiceWorker();

    /* اختصارات PWA (?action=search / ?action=new) */
    handleShortcut();

    loadData(false);
  }

  /** دعم اختصارات التطبيق المثبّت من قائمة المهام */
  function handleShortcut() {
    var action = null;
    try { action = new URLSearchParams(location.search).get('action'); } catch (e) { /* تجاهل */ }
    if (!action) return;

    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) { /* file:// */ }

    setTimeout(function () {
      if (action === 'search') {
        els.searchInput.focus();
        els.searchInput.select();
        els.searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (action === 'new') {
        openRecord(null, { scroll: true, focus: true });
      }
    }, 450);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
