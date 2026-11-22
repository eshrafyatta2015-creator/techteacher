/**
 * techteacher — محرك البحث المطوّر
 * ===================================================================
 * يحلّ محلّ البحث الأصلي في تطبيق App Inventor الذي كان يشترط
 * تطابق "رقم الهوية" و "الاسم" معاً وبطريقة تطابق تام فقط.
 *
 * ما يوفّره هذا المحرك:
 *   1. تطبيع النص العربي (الهمزات، التاء المربوطة، الألف المقصورة،
 *      التشكيل، التطويل، الأرقام الهندية…).
 *   2. ثلاث مراحل للبحث — تزداد صرامةً ثم ليناً:
 *        المرحلة 1: مطابقة مباشرة داخل الحقل
 *                  (تام / بادئة / بداية كلمة / جزئي / كل الكلمات)
 *        المرحلة 2: كلمات موزّعة على حقول السجل المختلفة
 *        المرحلة 3: مطابقة تقريبية (Fuzzy) لمعالجة الأخطاء الإملائية
 *   3. أوزان مختلفة للحقوق (الاسم والهوية أهم من تاريخ التعيين).
 *   4. ترتيب النتائج حسب قوة المطابقة مع إبراز النص المطابق.
 *   5. أوضاع بحث منفصلة + فلاتر + اقتراحات أثناء الكتابة.
 *
 * الأداء: يُبنى فهرس بحث واحد عند تحميل البيانات (O(n)) وتُسبَّك فيه
 * الكلمات مسبقاً، ثم كل ضغطة مفتاح تمرّ بمرحلتين فقط في الحالة
 * الشائعة (بدون دخول إلى المرحلة التقريبية).
 */
(function (global) {
  'use strict';

  /* ==================================================================
   * 1) التطبيع (Normalization)
   * ================================================================== */

  /** الأرقام الهندية/الفارسية → أرقام إنجليزية */
  function foldDigit(code) {
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660); // ٠-٩
    if (code >= 0x06F0 && code <= 0x06F9) return String(code - 0x06F0); // ۰-۹
    return null;
  }

  /** التشكيل والحركات + علامات الجمع + التطويل → تُسقط */
  function isDiacritic(code) {
    return (
      (code >= 0x0610 && code <= 0x061A) || // علامات تشكيل مختلفة
      (code >= 0x064B && code <= 0x065F) || // فتحة/ضمّة/كسرة/شدة/تنوين…
      (code >= 0x06D6 && code <= 0x06ED) || // علامات قرآنية
      code === 0x0670 ||                     // ألف خنجرية صغيرة
      code === 0x0640                        // تطويل (ـ)
    );
  }

  /** توحيد شكل الحروف العربية إلى صيغة واحدة للمقارنة */
  var FOLD_MAP = {
    0x0623: 'ا', 0x0625: 'ا', 0x0622: 'ا', // أ إ آ
    0x0671: 'ا', 0x0672: 'ا', 0x0673: 'ا', // ٱ ٲ ٳ
    0x0629: 'ه',                           // ة → ه
    0x0649: 'ي',                           // ى → ي
    0x0624: 'و',                           // ؤ → و
    0x0626: 'ي',                           // ئ → ي
    0x0643: 'ك',                           // ك → ك
    0x06CC: 'ي',                           // ي (فارسية) → ي
    0x06AF: 'ك'                            // گ → ك
  };

  var WORD_CHAR = /[\p{L}\p{N}]/u;

  /**
   * تطبيع نص وإرجاع مصفوفة ربط بين كل حرف في الناتج
   * وموقعه الأصلي في النص المُدخَل (لإظهار التظليل بشكل صحيح).
   *
   * @param {string} input
   * @returns {{norm:string, map:number[]}}
   */
  function normalizeWithMap(input) {
    var s = input == null ? '' : String(input);
    var out = '';
    var map = [];
    var pendingSpace = false;

    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      var code = s.charCodeAt(i);

      var asDigit = foldDigit(code);
      if (asDigit !== null) {
        if (pendingSpace && out) { out += ' '; map.push(i); }
        pendingSpace = false;
        out += asDigit;
        map.push(i);
        continue;
      }

      if (isDiacritic(code)) continue;      // نُسقط التشكيل/التطويل

      var folded = FOLD_MAP[code];
      if (folded !== undefined) ch = folded;

      if (!WORD_CHAR.test(ch)) {
        // أي رمز غير حرف/رقم → فاصل بين الكلمات (مع ضغط الفواصل المتتالية)
        if (!pendingSpace && out) { pendingSpace = true; }
        continue;
      }

      if (pendingSpace) { out += ' '; map.push(i); pendingSpace = false; }
      out += ch;
      map.push(i);
    }

    return { norm: out, map: map };
  }

  /** تطبيع بسيط بدون خريطة ربط (للفهرسة والمقارنة) */
  function normalize(input) {
    return normalizeWithMap(input).norm;
  }

  /** تقسيم إلى كلمات بعد التطبيع */
  function tokenize(input) {
    var n = normalize(input);
    return n ? n.split(' ') : [];
  }

  /* ==================================================================
   * 2) المسافة التقريبية (Damerau–Levenshtein مُقتطعة)
   * ================================================================== */

  /**
   * مسافة ليفنشتاين مع سقف لمنع الانفجار الحسابي.
   * @returns {number} القيمة الحقيقية أو max+1 إذا تجاوزت السقف
   */
  function boundedLevenshtein(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;

    var prev = new Array(lb + 1);
    var cur = new Array(lb + 1);
    var prev2 = null;

    for (var j = 0; j <= lb; j++) prev[j] = j;

    for (var i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      var ca = a.charCodeAt(i - 1);
      for (var k = 1; k <= lb; k++) {
        var cost = ca === b.charCodeAt(k - 1) ? 0 : 1;
        var v = prev[k] + 1;
        var d1 = cur[k - 1] + 1;
        if (d1 < v) v = d1;
        var d2 = prev[k - 1] + cost;
        if (d2 < v) v = d2;
        // استبدال متبادل (transposition) — مفيد للهجات العربية المكتوبة
        if (i > 1 && k > 1 && ca === b.charCodeAt(k - 2) &&
            a.charCodeAt(i - 2) === b.charCodeAt(k - 1)) {
          var d3 = prev2[k - 2] + 1;
          if (d3 < v) v = d3;
        }
        cur[k] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[lb];
  }

  /** المسافة المسموحة حسب طول الاستعلام */
  function allowedDistance(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    return 3;
  }

  /* ==================================================================
   * 3) الحقول والأوضاع
   * ================================================================== */

  /**
   * كل حقل من حقول السجل: المفتاح، الوزن، وهل هو حقل "مطابقة دقيقة"
   * (مثل رقم الهوية حيث التطابق الجزئي قد يُعطي نتائج مضللة).
   */
  var FIELDS = [
    { key: 'name',        label: 'الاسم الرباعي',      weight: 3.0 },
    { key: 'id',          label: 'رقم الهوية',          weight: 3.6, numeric: true },
    { key: 'school',      label: 'اسم المدرسة',         weight: 1.7 },
    { key: 'specialty',   label: 'التخصص الجامعي',      weight: 1.5 },
    { key: 'classes',     label: 'الصفوف التي يدرسها',  weight: 1.4 },
    { key: 'location',    label: 'السكن',               weight: 1.3 },
    { key: 'degree',      label: 'المؤهل العلمي',       weight: 1.1 },
    { key: 'pedagogy',    label: 'المؤهل التربوي',      weight: 1.0 },
    { key: 'otherSchool', label: 'المركز الآخر',        weight: 1.0 },
    { key: 'courses',     label: 'على مستوى المديرية',  weight: 0.9 },
    { key: 'workDays',    label: 'أيام الدوام',         weight: 0.8 },
    { key: 'appointDate', label: 'تاريخ التعيين',       weight: 0.7 }
  ];

  var FIELD_BY_KEY = {};
  for (var fi = 0; fi < FIELDS.length; fi++) FIELD_BY_KEY[FIELDS[fi].key] = FIELDS[fi];

  /** وضع البحث: الحقول المتاحة للمستخدم */
  var MODES = [
    { id: 'all',       label: 'كل الحقول',   fields: null },
    { id: 'name',      label: 'الاسم',        fields: ['name'] },
    { id: 'id',        label: 'رقم الهوية',   fields: ['id'], numeric: true },
    { id: 'school',    label: 'المدرسة',      fields: ['school', 'otherSchool'] },
    { id: 'specialty', label: 'التخصص',       fields: ['specialty'] }
  ];

  var MODE_BY_ID = {};
  for (var mi = 0; mi < MODES.length; mi++) MODE_BY_ID[MODES[mi].id] = MODES[mi];

  /* ==================================================================
   * 4) بناء الفهرس
   * ================================================================== */

  /**
   * بناء فهرس بحث لقائمة السجلات.
   * @param {object[]} records مصفوفة كائنات {name, id, ...}
   * @returns {object[]} نسخ الفهرس الجاهزة للبحث
   */
  function buildIndex(records) {
    var indexed = [];
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var entry = { rec: rec, fields: {}, flat: '', words: [], _modeWords: {} };
      var flatParts = [];
      for (var f = 0; f < FIELDS.length; f++) {
        var key = FIELDS[f].key;
        var n = normalize(rec[key]);
        entry.fields[key] = n;
        if (!n) continue;
        flatParts.push(n);
        // تسبُّك الكلمات مرة واحدة فقط (يوفّر كثيراً أثناء الكتابة)
        var pos = 0;
        var words = n.split(' ');
        for (var w = 0; w < words.length; w++) {
          if (words[w]) entry.words.push({ w: words[w], key: key, off: pos });
          pos += words[w].length + 1;
        }
      }
      entry.flat = flatParts.join(' ');
      indexed.push(entry);
    }
    return indexed;
  }

  /** كلمات السجل ضمن أوضاع البحث المسموحة (تُخزَّن عند أول استخدام) */
  function wordsForMode(entry, modeDef) {
    if (!modeDef.fields) return entry.words;
    var cached = entry._modeWords[modeDef.id];
    if (cached) return cached;
    cached = [];
    for (var i = 0; i < entry.words.length; i++) {
      if (modeDef.fields.indexOf(entry.words[i].key) !== -1) cached.push(entry.words[i]);
    }
    entry._modeWords[modeDef.id] = cached;
    return cached;
  }

  /**
   * تجميع كلمات السجل حسب طولها — يتيح للمطابقة التقريبية تجاوز الكلمات
   * غير المحتملة بمجرد فحص الطول (بدون أي حساب مسافة).
   */
  function bucketsForMode(entry, modeDef, words) {
    if (!modeDef.fields) {
      if (entry._allBuckets) return entry._allBuckets;
    } else {
      var key = '_buckets_' + modeDef.id;
      if (entry[key]) return entry[key];
    }
    var buckets = {};
    for (var i = 0; i < words.length; i++) {
      var len = words[i].w.length;
      (buckets[len] || (buckets[len] = [])).push(words[i]);
    }
    if (!modeDef.fields) entry._allBuckets = buckets;
    else entry['_buckets_' + modeDef.id] = buckets;
    return buckets;
  }

  /** حقول وضع البحث المحدّد */
  function fieldsForMode(modeDef) {
    if (!modeDef.fields) return FIELDS;
    var out = [];
    for (var i = 0; i < FIELDS.length; i++) {
      if (modeDef.fields.indexOf(FIELDS[i].key) !== -1) out.push(FIELDS[i]);
    }
    return out;
  }

  /* ==================================================================
   * 5) المرحلة 1 — مطابقة مباشرة داخل الحقل
   * ================================================================== */

  /**
   * مطابقة بدون أي ذكاء اصطناعي — سريعة وحاسمة.
   * @returns {{score:number, start:number, end:number}|null}
   * start/end = مواضع المطابقة داخل النص المُطبَّع (للتظليل)
   */
  function directMatch(normField, qNorm, qTokens, fieldDef) {
    if (!normField || !qNorm) return null;

    var lenQ = qNorm.length;
    var idx = normField.indexOf(qNorm);

    /* تطابق تام */
    if (normField === qNorm) return { score: 100, start: 0, end: normField.length };

    /* الاستعلام يطابق بداية الحقل */
    if (idx === 0) return { score: 88, start: 0, end: lenQ };

    /* الاستعلام يطابق بداية كلمة */
    if (idx > 0 && normField[idx - 1] === ' ') {
      return { score: 76, start: idx, end: idx + lenQ };
    }

    /* تطابق جزئي في أي مكان */
    if (idx > 0) return { score: 62, start: idx, end: idx + lenQ };

    /* كل كلمات الاستعلام موجودة داخل هذا الحقل (بترتيب أو بدون) */
    if (qTokens.length > 1) {
      var allFound = true;
      var firstStart = -1, lastEnd = -1;
      for (var t = 0; t < qTokens.length; t++) {
        var p = normField.indexOf(qTokens[t]);
        if (p === -1) { allFound = false; break; }
        if (firstStart === -1) firstStart = p;
        if (p + qTokens[t].length > lastEnd) lastEnd = p + qTokens[t].length;
      }
      if (allFound) {
        return { score: 52 + Math.min(12, qTokens.length * 3),
                 start: firstStart, end: lastEnd };
      }
    }

    /* رقم الهوية: يقبل التقطيع والمسافات والأخطاء */
    if (fieldDef && fieldDef.numeric) {
      var digitsQ = qNorm.replace(/\D/g, '');
      var digitsF = normField.replace(/\D/g, '');
      if (digitsQ && digitsF) {
        var pd = digitsF.indexOf(digitsQ);
        if (pd === 0 && digitsF.length === digitsQ.length) {
          return { score: 100, start: 0, end: normField.length };
        }
        if (pd >= 0) {
          return { score: Math.max(30, 74 - (digitsF.length - digitsQ.length)),
                   start: 0, end: normField.length };
        }
      }
    }

    return null;
  }

  /* ==================================================================
   * 6) المرحلة 2 — كلمات موزّعة على حقول السجل
   * ================================================================== */

  /**
   * الاستعلام مكوّن من كلمات وكل كلمة في حقل مختلف من نفس السجل
   * مثال: "اسامه اعزيز" ← الاسم في حقل الاسم والمدرسة في حقل المدرسة.
   */
  function crossFieldMatch(entry, qTokens, modeDef) {
    var matches = {};
    var total = 0;
    var covered = 0;

    // نحترم وضع البحث: نسمح فقط بحقول هذا الوضع
    var allowed = modeDef && modeDef.fields ? modeDef.fields : null;

    for (var t = 0; t < qTokens.length; t++) {
      var tok = qTokens[t];
      var best = null;
      var keys = Object.keys(entry.fields);
      for (var k = 0; k < keys.length; k++) {
        if (allowed && allowed.indexOf(keys[k]) === -1) continue;
        var nf = entry.fields[keys[k]];
        if (!nf) continue;
        var p = nf.indexOf(tok);
        if (p === -1) continue;
        var isPrefix = (p === 0) || nf[p - 1] === ' ';
        var sc = isPrefix ? 70 : 55;
        var def = FIELD_BY_KEY[keys[k]];
        sc *= def ? def.weight : 1;
        if (!best || sc > best.weighted) {
          best = { weighted: sc, key: keys[k], start: p, end: p + tok.length };
        }
      }
      if (best) {
        covered++;
        total += best.weighted;
        if (!matches[best.key]) matches[best.key] = { score: best.weighted, start: best.start, end: best.end };
        else {
          var m = matches[best.key];
          if (best.start < m.start) m.start = best.start;
          if (best.end > m.end) m.end = best.end;
        }
      }
    }

    if (covered < qTokens.length || covered === 0) return null;
    // مكافأة صغيرة لأن الكلمات اجتمعت في السجل نفسه
    return { score: total + covered * 4, matches: matches };
  }

  /* ==================================================================
   * 7) المرحلة 3 — المطابقة التقريبية (Fuzzy)
   * ================================================================== */

  /**
   * محاولة مطابقة كل كلمة من الاستعلام مع أي كلمة في السجل.
   * تُستدعى فقط إذا فشلت المرحلتان 1 و2 (لذلك تكلفة محدودة).
   *
   * @param {object} distCache مخزن مؤقت للمسافات داخل البحث الواحد —
   *   لأن نفس الكلمة تتكرر بين مئات السجلات (أسماء المدارس مثلاً).
   */
  function fuzzyMatch(entry, modeDef, qNorm, qTokens, distCache) {
    var tokens = qTokens.length ? qTokens : [qNorm];
    var words = wordsForMode(entry, modeDef);
    if (!words.length) return null;

    var buckets = bucketsForMode(entry, modeDef, words);
    var matches = {};
    var total = 0;

    for (var t = 0; t < tokens.length; t++) {
      var tok = tokens[t];
      var tokLen = tok.length;
      var maxD = allowedDistance(tokLen);
      var best = null;

      /* المرشحون المحتملون فقط: الكلمات التي يختلف طولها عن الاستعلام ≤ maxD */
      var lo = tokLen - maxD, hi = tokLen + maxD;
      for (var L = lo; L <= hi; L++) {
        var bucket = buckets[L];
        if (!bucket) continue;
        for (var w = 0; w < bucket.length; w++) {
          var cand = bucket[w].w;
          var dist;
          if (maxD > 0) {
            var cacheKey = tok + ' ' + cand;
            dist = distCache[cacheKey];
            if (dist === undefined) {
              dist = boundedLevenshtein(cand, tok, maxD);
              distCache[cacheKey] = dist;
            }
            if (dist > maxD) continue;
          } else {
            // كلمة قصيرة جداً: نكتفي بتطابق تام للكلمة
            if (cand !== tok) continue;
            dist = 0;
          }
          var def = FIELD_BY_KEY[bucket[w].key];
          var sc = (34 - dist * 9) * (def ? def.weight : 1);
          if (!best || sc > best.weighted) {
            best = { weighted: sc, key: bucket[w].key, start: bucket[w].off,
                     end: bucket[w].off + cand.length, dist: dist };
          }
        }
      }
      if (!best) return null;   // كلمة واحدة غير قابلة للمطابقة → السجل مرفوض
      total += best.weighted;
      if (!matches[best.key]) {
        matches[best.key] = { score: best.weighted, start: best.start, end: best.end };
      }
    }

    if (total <= 0) return null;
    return { score: total, matches: matches };
  }

  /* ==================================================================
   * 8) الفلاتر
   * ================================================================== */

  function passesFilters(rec, filters) {
    if (!filters) return true;
    var keys = Object.keys(filters);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var want = filters[k];
      if (want == null || want === '') continue;
      var have = normalize(rec[k]);
      if (!have) return false;
      if (have.indexOf(normalize(want)) === -1) return false;
    }
    return true;
  }

  /* ==================================================================
   * 9) البحث الرئيسي
   * ================================================================== */

  /**
   * تنفيذ بحث.
   *
   * @param {object}  options
   * @param {string}  options.query      النص المُدخل
   * @param {string}  [options.mode]     مفتاح وضع البحث
   * @param {object}  [options.filters]  فلاتر {degree, school, ...}
   * @param {object[]} options.index     الفهرس من buildIndex()
   * @param {number}  [options.limit]    أقصى عدد نتائج
   * @returns {{results:Array, total:number, took:number, query:string, mode:string}}
   */
  function search(options) {
    var t0 = (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();

    var query = options.query == null ? '' : String(options.query);
    var modeDef = MODE_BY_ID[options.mode] || MODES[0];
    var index = options.index || [];
    var filters = options.filters || {};
    var limit = options.limit || 60;
    var allowFuzzy = options.fuzzy !== false;

    var qNorm = normalize(query);
    var qTokens = qNorm ? qNorm.split(' ') : [];
    var hasQuery = qNorm.length > 0;
    var modeFields = fieldsForMode(modeDef);
    var qHasDigits = /\d/.test(qNorm);
    var distCache = Object.create(null);   // مسافات مشتركة بين كل السجلات

    var results = [];

    for (var i = 0; i < index.length; i++) {
      var entry = index[i];

      /* --- الفلاتر (لا علاقة لها بنص البحث) --- */
      if (!passesFilters(entry.rec, filters)) continue;

      /* --- لا استعلام → كل السجلات مؤهّلة --- */
      if (!hasQuery) {
        results.push({ rec: entry.rec, score: 0, matches: {}, snippet: null });
        continue;
      }

      /* --- فحص رخيص مسبق على النص المسطّح: يتجنّب دخول المرحلتين
             1 و2 على الإطلاق للسجلات المستحيلة ---------------------- */
      var flat = entry.flat;
      var qInFlat = flat.indexOf(qNorm) !== -1;
      var allTokensInFlat = true;
      if (!qInFlat && qTokens.length > 1) {
        for (var tt = 0; tt < qTokens.length; tt++) {
          if (flat.indexOf(qTokens[tt]) === -1) { allTokensInFlat = false; break; }
        }
      } else if (!qInFlat) {
        allTokensInFlat = false;
      }
      var numericPossible = qHasDigits && /\d/.test(flat);

      var total = 0;
      var matches = {};
      var anyDirect = false;
      var snippet = null;

      /* ---------- المرحلة 1 ---------- */
      if (qInFlat || allTokensInFlat || numericPossible) {
        for (var f = 0; f < modeFields.length; f++) {
          var def = modeFields[f];
          var normVal = entry.fields[def.key];
          if (!normVal) continue;

          var hit = directMatch(normVal, qNorm, qTokens, def);
          if (!hit) continue;

          var weighted = hit.score * def.weight;
          total += weighted;
          anyDirect = true;
          matches[def.key] = hit;
          if (!snippet || hit.score > snippet.score) {
            snippet = { score: hit.score, key: def.key, start: hit.start, end: hit.end };
          }
        }
      }

      /* ---------- المرحلة 2 ---------- */
      if (!anyDirect && qTokens.length > 1 && allTokensInFlat) {
        var cross = crossFieldMatch(entry, qTokens, modeDef);
        if (cross) {
          total += cross.score;
          anyDirect = true;
          var ck = Object.keys(cross.matches);
          for (var c = 0; c < ck.length; c++) {
            var cm = cross.matches[ck[c]];
            matches[ck[c]] = cm;
            if (!snippet || cm.score > snippet.score) {
              snippet = { score: cm.score, key: ck[c], start: cm.start, end: cm.end };
            }
          }
        }
      }

      /* ---------- المرحلة 3 ---------- */
      if (!anyDirect && allowFuzzy) {
        var fz = fuzzyMatch(entry, modeDef, qNorm, qTokens, distCache);
        if (fz) {
          total += fz.score;
          anyDirect = true;
          var fk = Object.keys(fz.matches);
          for (var g = 0; g < fk.length; g++) {
            var fm = fz.matches[fk[g]];
            matches[fk[g]] = fm;
            if (!snippet || fm.score > snippet.score) {
              snippet = { score: fm.score, key: fk[g], start: fm.start, end: fm.end };
            }
          }
        }
      }

      /* في وضع "رقم الهوية" لا نقبل إلا مطابقة لهوية صحيحة */
      if (modeDef.numeric && !matches.id) continue;
      if (modeDef.fields && !anyDirect) continue;
      if (total <= 0) continue;

      /* مكافأة قوية لمن تطابق اسمه أو هويته تطابقاً تاماً */
      if (matches.name && matches.name.score === 100) total += 45;
      if (matches.id && matches.id.score === 100) total += 65;

      results.push({
        rec: entry.rec,
        score: Math.round(total * 100) / 100,
        matches: matches,
        snippet: snippet
      });
    }

    /* --- الترتيب: قوة المطابقة ثم الاسم --- */
    if (hasQuery) {
      results.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.rec.name || '').localeCompare(String(b.rec.name || ''), 'ar');
      });
    }

    var totalFound = results.length;
    if (results.length > limit) results = results.slice(0, limit);

    var t1 = (global.performance && global.performance.now)
      ? global.performance.now() : Date.now();

    return {
      results: results,
      total: totalFound,
      truncated: totalFound > results.length,
      query: query,
      mode: modeDef.id,
      took: Math.round((t1 - t0) * 100) / 100
    };
  }

  /* ==================================================================
   * 10) إبراز النص المطابق
   * ================================================================== */

  /**
   * إرجاع النص الأصلي مقسماً إلى مقاطع، المقاطع المطابقة مُعلَّمة.
   * @param {string} original النص الأصلي كما في الجدول
   * @param {Array<[number,number]>} ranges نطاقات داخل النص المُطبَّع
   * @returns {Array<{text:string, hit:boolean}>}
   */
  function highlight(original, ranges) {
    var s = String(original == null ? '' : original);
    if (!ranges || !ranges.length || !s) return [{ text: s, hit: false }];

    var nm = normalizeWithMap(s);
    var origRanges = [];
    for (var i = 0; i < ranges.length; i++) {
      var a = ranges[i][0], b = ranges[i][1];
      if (!(b > a) || a < 0 || a >= nm.map.length) continue;
      var startIdx = nm.map[a];
      var endIdx = nm.map[Math.min(b - 1, nm.map.length - 1)];
      if (startIdx == null || endIdx == null) continue;
      origRanges.push([Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1]);
    }
    if (!origRanges.length) return [{ text: s, hit: false }];

    origRanges.sort(function (x, y) { return x[0] - y[0]; });

    var out = [];
    var cursor = 0;
    for (var r = 0; r < origRanges.length; r++) {
      var st = origRanges[r][0], en = origRanges[r][1];
      if (st < cursor) { if (en > cursor) cursor = en; continue; }
      if (st > cursor) out.push({ text: s.slice(cursor, st), hit: false });
      out.push({ text: s.slice(st, en), hit: true });
      cursor = en;
    }
    if (cursor < s.length) out.push({ text: s.slice(cursor), hit: false });
    return out;
  }

  /** بناء نطاقات تظليل من كائن المطابقات لحقل معين */
  function rangesFor(matches, fieldKey) {
    var m = matches && matches[fieldKey];
    return m ? [[m.start, m.end]] : null;
  }

  /* ==================================================================
   * 11) اقتراحات سريعة
   * ================================================================== */

  /** إرجاع قائمة مقترحات قصيرة لعرضها أسفل مربع البحث */
  function suggest(options) {
    var opts = {};
    for (var k in options) if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k];
    opts.limit = options.limit || 6;
    return search(opts).results;
  }

  global.TT_SEARCH = {
    normalize: normalize,
    normalizeWithMap: normalizeWithMap,
    tokenize: tokenize,
    buildIndex: buildIndex,
    search: search,
    suggest: suggest,
    highlight: highlight,
    rangesFor: rangesFor,
    FIELDS: FIELDS,
    MODES: MODES,
    boundedLevenshtein: boundedLevenshtein
  };
})(window);
