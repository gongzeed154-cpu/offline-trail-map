/* service worker: เก็บไฟล์แอพและไทล์แผนที่ไว้ใช้ตอนไม่มีสัญญาณ */
importScripts('./common.js');

var SHELL_CACHE = 'shell-v15';
var TILE_CACHE = 'tiles-v1';
var SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './common.js',
  './geo.js',
  './plate.js',
  './paper.js',
  './route.js',
  './export.js',
  './nav.js',
  './sensors.js',
  './cam.js',
  './stars.js',
  './sound.js',
  './wind.js',
  './jump.js',
  './projects.js',
  './symbols.js',
  './rec.js',
  './team.js',
  './print.js',
  './manifest.webmanifest',
  './lib/maplibre-gl.js',
  './lib/maplibre-gl.css',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k.indexOf('shell-') === 0 && k !== SHELL_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = req.url;

  // ไทล์แผนที่ / ตัวอักษร: ใช้ที่เก็บไว้ก่อน ถ้าไม่มีค่อยโหลดจากเน็ตแล้วเก็บเพิ่ม
  if (TrailCommon.isCacheable(url)) {
    var key = TrailCommon.cacheKey(url);
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(key).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(key, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // ไฟล์ของแอพเอง: ลองโหลดจากเน็ตก่อน (รอไม่เกิน 3 วินาที) ถ้าไม่ได้ค่อยใช้ที่เก็บไว้ เพื่อให้เวอร์ชันใหม่มาถึงทันที
  if (url.indexOf(self.location.origin) === 0) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(function (cache) {
        return cache.match(req, { ignoreSearch: true }).then(function (hit) {
          var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
          if (!hit) return net;
          var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, 3000); });
          return Promise.race([net.catch(function () { return hit; }), timeout]);
        });
      })
    );
  }
});
