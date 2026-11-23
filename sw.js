/* ===================================================================
 * techteacher — Service Worker
 * -------------------------------------------------------------------
 * يمنح التطبيق ثلاث قدرات:
 *   1. العمل دون اتصال (Offline): نسخة مخزّنة من الواجهة والبيانات.
 *   2. فتح سريع: الأصول ثابتة تُقرأ من الذاكرة (cache-first).
 *   3. تحديث سليم: الواجهة تُحدَّث في الخلفية دون إعادة تحميل فورية.
 *
 * ملاحظة: جميع المسارات نسبية (./) لأن التطبيق يُنشر على
 * GitHub Pages تحت مسار فرعي مثل  /techteacher/
 * =================================================================== */

'use strict';

var VERSION = 'techteacher-v1.2.0';
var SHELL_CACHE = VERSION + '-shell';
var DATA_CACHE = VERSION + '-data';
var ASSET_CACHE = VERSION + '-assets';

/** ملفات الواجهة التي يجب أن تعمل دون اتصال */
var SHELL_FILES = [
  './',
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/store.js',
  './js/search.js',
  './js/data.js',
  './js/sheets.js',
  './js/app.js',
  './login.html',
  './teacher.html',
  './admin.html',
  './css/gateway.css',
  './js/gateway.js',
  './js/auth.js',
  './js/login.js',
  './js/teacher.js',
  './js/admin.js',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/favicon-48.png'
];

/* ------------------------------------------------------------------ */
/* التثبيت: نخزّن الواجهة مسبقاً                                       */
/* ------------------------------------------------------------------ */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // نتجاهل فشل أي ملف منفرد حتى لا يفشل التثبيت كاملاً
      return Promise.all(SHELL_FILES.map(function (url) {
        var req = new Request(url, { cache: 'reload' });
        return cache.add(req).catch(function () { /* تجاهل */ });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ------------------------------------------------------------------ */
/* التفعيل: نحذف النسخ القديمة                                        */
/* ------------------------------------------------------------------ */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(VERSION) !== 0) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ------------------------------------------------------------------ */
/* استراتيجيات الجلب                                                   */
/* ------------------------------------------------------------------ */

/** الشبكة أولاً مع رجوع إلى الذاكرة عند الفشل — للتنقل والبيانات */
function networkFirst(request, cacheName, fallbackUrl) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(function () {});
      }
      return response;
    }).catch(function () {
      return cache.match(request, { ignoreSearch: false }).then(function (hit) {
        if (hit) return hit;
        if (fallbackUrl) return cache.match(fallbackUrl);
        return undefined;
      }).then(function (hit) {
        if (hit) return hit;
        return offlineFallback();
      });
    });
  });
}

/** الذاكرة أولاً مع تحديث خلفي — للملفات الثابتة */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && response.ok) {
          cache.put(request, response.clone()).catch(function () {});
        }
        return response;
      }).catch(function () { return undefined; });

      if (cached) {
        // نُحدّث في الخلفية دون تأخير الرد للمستخدم
        network.catch(function () {});
        return cached;
      }
      return network.then(function (res) {
        if (res) return res;
        return offlineFallback();
      });
    });
  });
}

/** صفحة بديلة عند غياب الاتصال والذاكرة معاً */
function offlineFallback() {
  return new Response(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>غير متصل</title></head><body style="font-family:Tahoma,sans-serif;' +
    'display:grid;place-items:center;min-height:100vh;margin:0;background:#F4F6F8;color:#14181D">' +
    '<div style="text-align:center;padding:24px">' +
    '<h1 style="font-size:20px">لا يوجد اتصال بالإنترنت</h1>' +
    '<p style="color:#66717E">افتح التطبيق مرة أخرى عند عودة الاتصال.</p>' +
    '<button onclick="location.reload()" style="margin-top:14px;padding:10px 22px;' +
    'border:0;border-radius:9px;background:#146C4F;color:#fff;font-size:15px;cursor:pointer">' +
    'إعادة المحاولة</button></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/** مضيفات بيانات الجدول */
function isDataUrl(url) {
  return url.hostname === 'script.google.com' ||
         url.hostname === 'script.apps.googleusercontent.com' ||
         url.hostname === 'docs.google.com' ||
         url.hostname === 'sheets.google.com' ||
         url.hostname === 'drive.google.com';
}

/* ------------------------------------------------------------------ */
/* معالجة الطلبات                                                      */
/* ------------------------------------------------------------------ */

self.addEventListener('fetch', function (event) {
  var request = event.request;

  // لا نتعامل إلا مع GET — عمليات الحفظ لا تُخزَّن أبداً
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // مصادر البيانات: الشبكة أولاً حتى تبقى الأحدث، والذاكرة عند الانقطاع
  if (isDataUrl(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // التنقل بين الصفحات: الشبكة أولاً مع صفحة محفوظة كبديل
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }

  // أصول التطبيق (نفس النطاق): الذاكرة أولاً
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }
});
