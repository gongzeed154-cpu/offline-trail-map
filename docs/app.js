/* แผนที่เดินป่าออฟไลน์ (เว็บแอพ) */
(function () {
  var C = TrailCommon;
  var AREAS_KEY = 'trail_areas_v1';
  var TPL_KEY = 'trail_ofm_tpl';
  var TILE_CACHE = 'tiles-v1';
  var AREA_CACHE = 'areas-v1';
  var MAX_TILES = 9000; // จำกัดขนาดพื้นที่ต่อครั้ง
  var CONCURRENCY = 8;

  var map = null;
  var geolocate = null;
  var vectorTpl = null;
  var downloading = false;

  function $(id) { return document.getElementById(id); }

  /* ---------- ข้อมูลพื้นที่ที่ดาวน์โหลด ---------- */
  function loadAreas() {
    try { return JSON.parse(localStorage.getItem(AREAS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveAreas(list) {
    localStorage.setItem(AREAS_KEY, JSON.stringify(list));
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function defaultName() {
    var d = new Date();
    return 'พื้นที่ ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(0) + ' MB'; }

  /* ---------- แม่แบบ URL ของไทล์เวกเตอร์ ---------- */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  async function getVectorTemplate() {
    try {
      var res = await withTimeout(fetch(C.OFM_TILEJSON, { cache: 'no-store' }), 6000);
      var json = await res.json();
      if (json && json.tiles && json.tiles[0]) {
        localStorage.setItem(TPL_KEY, json.tiles[0]);
        return json.tiles[0];
      }
    } catch (e) { /* ออฟไลน์ ใช้ค่าที่เก็บไว้ */ }
    return localStorage.getItem(TPL_KEY);
  }

  /* ---------- แผนที่ ---------- */
  function startMap(tpl) {
    map = new maplibregl.Map({
      container: 'map',
      style: C.buildStyle(tpl),
      center: [100.9925, 15.87],
      zoom: 5,
      minZoom: 3,
      maxZoom: 17,
      attributionControl: { compact: true }
    });

    geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 20000 },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true
    });
    map.addControl(geolocate, 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    geolocate.on('geolocate', function (e) {
      var alt = e.coords && e.coords.altitude;
      var chip = $('alt');
      if (alt !== null && alt !== undefined && !isNaN(alt)) {
        chip.textContent = 'ความสูง (GPS) ' + Math.round(alt) + ' ม.';
        chip.hidden = false;
      }
    });
    geolocate.on('error', function (e) {
      toast('ใช้ตำแหน่งไม่ได้: ' + (e && e.message ? e.message : 'กรุณาอนุญาตการเข้าถึงตำแหน่ง'));
    });
  }

  /* ---------- ดาวน์โหลดพื้นที่ ---------- */
  async function downloadArea() {
    if (downloading || !map || !vectorTpl) return;
    var b = map.getBounds();
    var bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    var n = C.countTiles(bounds);
    if (n > MAX_TILES) {
      alert('พื้นที่ใหญ่เกินไป (ประมาณ ' + n.toLocaleString() + ' ไทล์ สูงสุด ' + MAX_TILES.toLocaleString() + ')\nกรุณาซูมเข้าให้เห็นพื้นที่เล็กลงแล้วลองใหม่');
      return;
    }
    var estMB = Math.max(1, Math.round((n * 25) / 1024));
    if (!confirm('ดาวน์โหลดพื้นที่ที่เห็นบนจอ\nประมาณ ' + n.toLocaleString() + ' ไทล์ (ราว ' + estMB + ' MB)\nควรต่อ Wi-Fi ดำเนินการต่อไหม?')) return;

    // รวบรวมรายการ URL
    var urls = [];
    C.tilesForBounds(bounds, C.MIN_ZOOM, C.VECTOR_MAXZOOM).forEach(function (t) {
      urls.push(C.fillTemplate(vectorTpl, t));
    });
    C.tilesForBounds(bounds, C.MIN_ZOOM, C.DEM_MAXZOOM).forEach(function (t) {
      urls.push(C.fillTemplate(C.DEM_TEMPLATE, t));
    });
    C.glyphUrls().forEach(function (u) { urls.push(u); });

    downloading = true;
    setProgress(0, urls.length);
    var cache = await caches.open(TILE_CACHE);
    var keys = [];
    var done = 0;
    var failed = 0;
    var idx = 0;

    async function worker() {
      while (idx < urls.length) {
        var i = idx++;
        var url = urls[i];
        var key = C.cacheKey(url);
        try {
          var hit = await cache.match(key);
          if (!hit) {
            var res = await fetch(url);
            if (res.ok) await cache.put(key, res);
            else if (res.status !== 404 && res.status !== 204) failed++;
          }
          keys.push(key);
        } catch (e) {
          failed++;
        }
        done++;
        if (done % 10 === 0 || done === urls.length) setProgress(done, urls.length);
      }
    }

    var pool = [];
    for (var w = 0; w < CONCURRENCY; w++) pool.push(worker());
    await Promise.all(pool);
    downloading = false;
    setProgress(null);

    if (failed > urls.length * 0.2) {
      alert('ดาวน์โหลดไม่ครบ (ล้มเหลว ' + failed + ' จาก ' + urls.length + ' ไฟล์)\nตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      return;
    }

    var id = String(Date.now());
    var area = { id: id, name: defaultName(), bounds: bounds, tiles: keys.length, failed: failed };
    var areaCache = await caches.open(AREA_CACHE);
    await areaCache.put('/__area/' + id, new Response(JSON.stringify(keys), { headers: { 'Content-Type': 'application/json' } }));
    var list = loadAreas();
    list.push(area);
    saveAreas(list);
    renderAreas();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    toast('ดาวน์โหลดเสร็จแล้ว: ' + area.name);
  }

  function setProgress(done, total) {
    var btn = $('download');
    if (done === null) {
      btn.disabled = false;
      btn.textContent = 'ดาวน์โหลดพื้นที่ที่เห็นบนจอ';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'กำลังดาวน์โหลด ' + Math.round((done / total) * 100) + '%';
  }

  /* ---------- รายการพื้นที่ ---------- */
  async function renderAreas() {
    var list = loadAreas();
    $('areaCount').textContent = list.length;
    var box = $('areaList');
    box.innerHTML = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'ยังไม่มีแผนที่ออฟไลน์ เลื่อนแผนที่ไปยังพื้นที่ที่จะเดินป่า แล้วกด "ดาวน์โหลดพื้นที่ที่เห็นบนจอ"';
      box.appendChild(p);
    }
    list.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'row';
      var info = document.createElement('button');
      info.className = 'info';
      info.innerHTML = '<b></b><span></span>';
      info.querySelector('b').textContent = a.name;
      info.querySelector('span').textContent = a.tiles.toLocaleString() + ' ไฟล์' + (a.failed ? ' (ขาด ' + a.failed + ')' : '');
      info.onclick = function () {
        $('panel').hidden = true;
        map.fitBounds([[a.bounds[0], a.bounds[1]], [a.bounds[2], a.bounds[3]]], { duration: 800 });
      };
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'ลบ';
      del.onclick = function () { removeArea(a); };
      row.appendChild(info);
      row.appendChild(del);
      box.appendChild(row);
    });

    var usage = $('usage');
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var est = await navigator.storage.estimate();
        usage.textContent = 'พื้นที่ที่แอพใช้อยู่: ' + mb(est.usage || 0);
      } catch (e) { usage.textContent = ''; }
    }
  }

  async function removeArea(area) {
    if (!confirm('ลบแผนที่นี้?\n' + area.name)) return;
    var areaCache = await caches.open(AREA_CACHE);
    var tileCache = await caches.open(TILE_CACHE);
    var list = loadAreas().filter(function (a) { return a.id !== area.id; });

    // เก็บคีย์ที่พื้นที่อื่นยังใช้อยู่ไว้
    var keep = {};
    for (var i = 0; i < list.length; i++) {
      var r = await areaCache.match('/__area/' + list[i].id);
      if (r) (await r.json()).forEach(function (k) { keep[k] = true; });
    }
    var mine = await areaCache.match('/__area/' + area.id);
    if (mine) {
      var keys = await mine.json();
      for (var j = 0; j < keys.length; j++) {
        if (!keep[keys[j]]) await tileCache.delete(keys[j]);
      }
    }
    await areaCache.delete('/__area/' + area.id);
    saveAreas(list);
    renderAreas();
  }

  /* ---------- ส่วนประกอบหน้าจอ ---------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  function updateOnline() {
    $('offline').hidden = navigator.onLine;
  }

  function maybeShowInstallHint() {
    var ua = navigator.userAgent || '';
    var isIOS = /iPad|iPhone|iPod/.test(ua);
    var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (isIOS && !standalone && !localStorage.getItem('trail_hint_done')) {
      $('hint').hidden = false;
    }
    $('hintClose').onclick = function () {
      $('hint').hidden = true;
      localStorage.setItem('trail_hint_done', '1');
    };
  }

  async function main() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();
    maybeShowInstallHint();

    $('download').onclick = downloadArea;
    $('openPanel').onclick = function () { renderAreas(); $('panel').hidden = false; };
    $('closePanel').onclick = function () { $('panel').hidden = true; };
    renderAreas();

    vectorTpl = await getVectorTemplate();
    if (!vectorTpl) {
      $('map').innerHTML = '';
      $('fatal').hidden = false;
      return;
    }
    startMap(vectorTpl);
  }

  main();
})();
