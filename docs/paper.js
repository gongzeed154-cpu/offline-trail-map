// หมวดพิเศษ: นำเข้าแผนที่กระดาษ (รูปถ่าย/สแกน) มาวางทับแผนที่ตามพิกัด
// รูปเก็บไว้ในเครื่อง (IndexedDB) เท่านั้น ไม่อัปโหลดไปที่ไหน ใช้ออฟไลน์ได้
// ปรับตำแหน่งโดยแตะ 4 มุมกรอบแผนที่บนรูป + กรอกพิกัดภูมิศาสตร์ของกรอบ (เหนือ/ใต้/ตะวันตก/ตะวันออก)
(function (root) {
  var DB = 'trail-papers';
  var STORE = 'maps';
  var MAX_SIDE = 4096; // iOS รับ texture ได้สูงสุดราว 4096
  var ctx = null; // { map: () => map, toast, esc }
  var urls = {}; // id -> object URL ของรูปที่กำลังแสดง

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function run(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode);
        var req = fn(t.objectStore(STORE));
        t.oncomplete = function () { res(req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }
  function getAll() { return run('readonly', function (s) { return s.getAll(); }); }
  function put(rec) { return run('readwrite', function (s) { return s.put(rec); }); }
  function del(id) { return run('readwrite', function (s) { return s['delete'](id); }); }

  /* ---------- คณิตศาสตร์: homography 4 จุด ---------- */
  // หา H ที่แปลงพิกเซล (x,y) -> (u,v) ด้วย 4 คู่จุด
  function solveHomography(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {
      var p = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp;
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (j = i + 1; j < 8; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var h = new Array(8);
    for (i = 7; i >= 0; i--) {
      var s = A[i][8];
      for (j = i + 1; j < 8; j++) s -= A[i][j] * h[j];
      h[i] = s / A[i][i];
    }
    return h;
  }
  function applyH(h, x, y) {
    var w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }

  // pts = พิกเซลของมุม NW,NE,SE,SW บนรูป; box = {n,s,w,e} องศา
  // คืนพิกัดมุมทั้ง 4 ของ "ทั้งรูป" (TL,TR,BR,BL) เป็น [lng,lat] เพื่อใช้กับ image source
  function imageCoords(pts, box, W, H) {
    var geo = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
    var m0 = maplibregl.MercatorCoordinate.fromLngLat({ lng: geo[0][0], lat: geo[0][1] });
    var SC = 1e4;
    var dst = geo.map(function (g) {
      var m = maplibregl.MercatorCoordinate.fromLngLat({ lng: g[0], lat: g[1] });
      return [(m.x - m0.x) * SC, (m.y - m0.y) * SC];
    });
    var h = solveHomography(pts, dst);
    if (!h) return null;
    return [[0, 0], [W, 0], [W, H], [0, H]].map(function (c) {
      var uv = applyH(h, c[0], c[1]);
      var ll = new maplibregl.MercatorCoordinate(m0.x + uv[0] / SC, m0.y + uv[1] / SC, 0).toLngLat();
      return [ll.lng, ll.lat];
    });
  }

  // อ่านค่ามุมจากข้อความ เช่น 14°30′00″N, "14 30", 14.5, -102.25
  function parseAngle(str) {
    var s = String(str).trim().toUpperCase().replace(/,/g, '.');
    var neg = /[SW]/.test(s) || /^-/.test(s);
    var nums = s.match(/\d+(\.\d+)?/g);
    if (!nums) return NaN;
    var v = 0, div = 1;
    for (var i = 0; i < 3 && i < nums.length; i++) { v += parseFloat(nums[i]) / div; div *= 60; }
    return neg ? -v : v;
  }

  /* ---------- แสดง/ซ่อนบนแผนที่ ---------- */
  function layerId(id) { return 'paper-' + id; }

  function show(rec) {
    var map = ctx.map();
    if (!map || !map.getLayer('traffic') || map.getSource(layerId(rec.id))) return;
    urls[rec.id] = urls[rec.id] || URL.createObjectURL(rec.blob);
    map.addSource(layerId(rec.id), { type: 'image', url: urls[rec.id], coordinates: rec.coords });
    map.addLayer({
      id: layerId(rec.id), type: 'raster', source: layerId(rec.id),
      paint: { 'raster-opacity': rec.opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
    }, 'traffic');
  }
  function hide(rec) {
    var map = ctx.map();
    if (!map) return;
    if (map.getLayer(layerId(rec.id))) map.removeLayer(layerId(rec.id));
    if (map.getSource(layerId(rec.id))) map.removeSource(layerId(rec.id));
    if (urls[rec.id]) { URL.revokeObjectURL(urls[rec.id]); delete urls[rec.id]; }
  }

  function loadAll() {
    return getAll().then(function (list) { list.forEach(function (r) { if (r.on) show(r); }); }).catch(function () {});
  }

  /* ---------- นำเข้ารูป ---------- */
  function readImage(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.naturalWidth * k);
        cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(u);
        cv.toBlob(function (b) { b ? res({ blob: b, w: cv.width, h: cv.height }) : rej(new Error('encode')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('decode')); };
      img.src = u;
    });
  }

  var CORNER_NAMES = ['มุมซ้ายบน (NW)', 'มุมขวาบน (NE)', 'มุมขวาล่าง (SE)', 'มุมซ้ายล่าง (SW)'];

  // หน้าจอปรับพิกัด: แตะ 4 มุมกรอบแผนที่บนรูป
  function calibrate(img, name, onDone) {
    var W = img.w, H = img.h;
    var imgUrl = URL.createObjectURL(img.blob);
    var pts = [];
    var view = { x: 0, y: 0, k: 1 };

    var el = document.createElement('div');
    el.id = 'calib';
    el.innerHTML =
      '<div class="chead"><b id="cmsg"></b><button id="ccancel">ยกเลิก</button></div>' +
      '<div id="cstage"><div id="cinner"><img alt=""></div></div>' +
      '<div id="cform"></div>';
    document.body.appendChild(el);
    var stage = el.querySelector('#cstage');
    var inner = el.querySelector('#cinner');
    var im = inner.querySelector('img');
    im.src = imgUrl;
    inner.style.width = W + 'px';
    inner.style.height = H + 'px';
    im.style.width = W + 'px';
    im.style.height = H + 'px';

    function close() {
      URL.revokeObjectURL(imgUrl);
      el.remove();
    }
    el.querySelector('#ccancel').onclick = close;

    function fit() {
      var sw = stage.clientWidth, sh = stage.clientHeight;
      view.k = Math.min(sw / W, sh / H);
      view.x = (sw - W * view.k) / 2;
      view.y = (sh - H * view.k) / 2;
      apply();
    }
    function apply() {
      inner.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')';
      Array.prototype.forEach.call(inner.querySelectorAll('.cpt'), function (p) {
        p.style.transform = 'translate(-50%,-50%) scale(' + (1 / view.k) + ')';
      });
    }

    function renderPts() {
      Array.prototype.forEach.call(inner.querySelectorAll('.cpt'), function (p) { p.remove(); });
      pts.forEach(function (p, i) {
        var d = document.createElement('div');
        d.className = 'cpt';
        d.textContent = i + 1;
        d.style.left = p[0] + 'px';
        d.style.top = p[1] + 'px';
        inner.appendChild(d);
      });
      apply();
      var msg = el.querySelector('#cmsg');
      var f = el.querySelector('#cform');
      if (pts.length < 4) {
        msg.textContent = 'แตะ ' + CORNER_NAMES[pts.length] + ' ของกรอบแผนที่ (ซูมด้วยสองนิ้ว)';
        f.innerHTML = '<div class="btnrow"><button class="btn alt" id="cundo"' + (pts.length ? '' : ' disabled') + '>ย้อนกลับ</button></div>';
        f.querySelector('#cundo').onclick = function () { pts.pop(); renderPts(); };
      } else {
        msg.textContent = 'กรอกพิกัดของกรอบแผนที่';
        f.innerHTML =
          '<div class="field"><label>ชื่อ</label><input type="text" id="cname"></div>' +
          '<div class="field"><label>ละติจูดขอบเหนือ</label><input type="text" id="cn" placeholder="เช่น 14°30′00″"></div>' +
          '<div class="field"><label>ละติจูดขอบใต้</label><input type="text" id="cs" placeholder="เช่น 14°15′00″"></div>' +
          '<div class="field"><label>ลองจิจูดขอบตะวันตก</label><input type="text" id="cw" placeholder="เช่น 101°45′00″"></div>' +
          '<div class="field"><label>ลองจิจูดขอบตะวันออก</label><input type="text" id="ce" placeholder="เช่น 102°00′00″"></div>' +
          '<div class="btnrow"><button class="btn alt" id="cundo">ย้อนกลับ</button><button class="btn" id="csave">บันทึก</button></div>';
        f.querySelector('#cname').value = name;
        f.querySelector('#cundo').onclick = function () { pts.pop(); renderPts(); };
        f.querySelector('#csave').onclick = function () {
          var box = {
            n: parseAngle(f.querySelector('#cn').value),
            s: parseAngle(f.querySelector('#cs').value),
            w: parseAngle(f.querySelector('#cw').value),
            e: parseAngle(f.querySelector('#ce').value)
          };
          if ([box.n, box.s, box.w, box.e].some(isNaN)) { ctx.toast('กรอกพิกัดให้ครบทั้ง 4 ช่อง'); return; }
          if (box.n <= box.s || box.e <= box.w || box.n > 85 || box.s < -85 || box.e > 180 || box.w < -180) { ctx.toast('ค่าพิกัดไม่สมเหตุสมผล (เหนือ > ใต้, ตะวันออก > ตะวันตก)'); return; }
          if (box.n - box.s > 3 || box.e - box.w > 3) { ctx.toast('กรอบกว้างเกิน 3° ตรวจสอบค่าอีกครั้ง'); return; }
          var coords = imageCoords(pts, box, W, H);
          if (!coords) { ctx.toast('คำนวณไม่ได้ ตรวจว่าแตะ 4 มุมไม่อยู่บนเส้นตรงเดียวกัน'); return; }
          var rec = {
            id: String(Date.now()),
            name: f.querySelector('#cname').value.trim() || name,
            blob: img.blob, w: W, h: H, pts: pts, box: box, coords: coords, opacity: 0.85, on: true
          };
          put(rec).then(function () { close(); onDone(rec); }).catch(function () { ctx.toast('บันทึกไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); });
        };
      }
    }

    // แพนด้วยนิ้วเดียว ซูมด้วยสองนิ้ว แตะเพื่อวางจุด
    var ptrs = {};
    var gesture = null;
    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1) gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, t: Date.now() };
      else if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, moved: true };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId] || !gesture) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      var r = stage.getBoundingClientRect();
      if (gesture.type === 'pan' && ids.length === 1) {
        var dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
        if (Math.hypot(dx, dy) > 6) gesture.moved = true;
        if (gesture.moved) { view.x = gesture.vx + dx; view.y = gesture.vy + dy; apply(); }
      } else if (gesture.type === 'pinch' && ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        var nk = Math.max(0.05, Math.min(8, gesture.k * (d / gesture.d)));
        // ซูมรอบจุดกึ่งกลางสองนิ้ว
        view.x = mx - ((mx - view.x) / view.k) * nk;
        view.y = my - ((my - view.y) / view.k) * nk;
        view.k = nk;
        gesture.d = d; gesture.k = nk;
        apply();
      }
    });
    function up(e) {
      var g = gesture;
      var had = !!ptrs[e.pointerId];
      delete ptrs[e.pointerId];
      if (!had) return;
      if (Object.keys(ptrs).length === 0) {
        if (g && g.type === 'pan' && !g.moved && Date.now() - g.t < 600 && pts.length < 4) {
          var r = stage.getBoundingClientRect();
          var ix = (e.clientX - r.left - view.x) / view.k;
          var iy = (e.clientY - r.top - view.y) / view.k;
          if (ix >= 0 && iy >= 0 && ix <= W && iy <= H) { pts.push([ix, iy]); renderPts(); }
        }
        gesture = null;
      } else {
        // เหลือนิ้วเดียวหลังซูม: เริ่มแพนใหม่โดยไม่นับเป็นการแตะ
        var id = Object.keys(ptrs)[0];
        gesture = { type: 'pan', sx: ptrs[id].x, sy: ptrs[id].y, vx: view.x, vy: view.y, moved: true, t: 0 };
      }
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    fit();
    renderPts();
  }

  /* ---------- แผงหมวดพิเศษ ---------- */
  function renderSheet(body) {
    getAll().then(function (list) {
      var h = '<h4>แผนที่กระดาษ (นำเข้าจากรูป)</h4>';
      if (!list.length) h += '<p class="note">ยังไม่มีแผนที่ที่นำเข้า ถ่ายรูปหรือสแกนแผนที่กระดาษ 1:50,000 แล้วกด "นำเข้า" รูปจะถูกเก็บไว้ในเครื่องนี้เท่านั้น</p>';
      list.forEach(function (r) {
        h += '<div class="prow" data-id="' + r.id + '">' +
          '<label class="opt"><input type="checkbox" class="pon"' + (r.on ? ' checked' : '') + '><span class="pname"></span></label>' +
          '<div class="field"><label>ความโปร่งใส</label><input type="range" class="pop" min="10" max="100" value="' + Math.round(r.opacity * 100) + '"></div>' +
          '<div class="btnrow"><button class="btn alt pgo">ไปที่แผนที่</button><button class="btn alt pdel">ลบ</button></div></div>';
      });
      h += '<div class="btnrow"><button class="btn" id="pimport">นำเข้าแผนที่กระดาษ</button></div>' +
        '<input type="file" id="pfile" accept="image/*" hidden>' +
        '<p class="note">เลือกรูป → แตะ 4 มุมของกรอบแผนที่ (NW, NE, SE, SW) → กรอกพิกัดภูมิศาสตร์ของกรอบ (พิมพ์อยู่ที่มุมแผ่น) ' +
        'รูปจะถูกดัดให้ตรงตามพิกัดและวางทับแผนที่ได้ ใช้ร่วมกับตารางกริดและแผ่นวัดมุมได้ ความแม่นยำขึ้นกับการแตะมุมให้ตรง</p>';
      body.innerHTML = h;
      Array.prototype.forEach.call(body.querySelectorAll('.prow'), function (row) {
        var id = row.getAttribute('data-id');
        var rec = list.filter(function (r) { return r.id === id; })[0];
        row.querySelector('.pname').textContent = rec.name;
        row.querySelector('.pon').onchange = function () {
          rec.on = this.checked;
          put(rec);
          if (rec.on) show(rec); else hide(rec);
        };
        row.querySelector('.pop').oninput = function () {
          rec.opacity = this.value / 100;
          var map = ctx.map();
          if (map && map.getLayer(layerId(id))) map.setPaintProperty(layerId(id), 'raster-opacity', rec.opacity);
        };
        row.querySelector('.pop').onchange = function () { put(rec); };
        row.querySelector('.pgo').onclick = function () {
          var map = ctx.map();
          if (!rec.on) { rec.on = true; put(rec); show(rec); row.querySelector('.pon').checked = true; }
          map.fitBounds([[rec.box.w, rec.box.s], [rec.box.e, rec.box.n]], { padding: 20, duration: 800 });
        };
        row.querySelector('.pdel').onclick = function () {
          if (!confirm('ลบแผนที่นี้?\n' + rec.name)) return;
          hide(rec);
          del(id).then(function () { renderSheet(body); });
        };
      });
      var file = body.querySelector('#pfile');
      body.querySelector('#pimport').onclick = function () { file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f) return;
        ctx.toast('กำลังเตรียมรูป…');
        readImage(f).then(function (img) {
          ctx.closeSheet();
          calibrate(img, f.name.replace(/\.[^.]+$/, ''), function (rec) {
            show(rec);
            ctx.map().fitBounds([[rec.box.w, rec.box.s], [rec.box.e, rec.box.n]], { padding: 20, duration: 800 });
            ctx.toast('นำเข้าแล้ว: ' + rec.name);
          });
        }).catch(function () { ctx.toast('เปิดรูปนี้ไม่ได้'); });
      };
    }).catch(function () {
      body.innerHTML = '<p class="note">เครื่องนี้ไม่รองรับการเก็บรูปในแอพ</p>';
    });
  }

  root.TrailPaper = {
    init: function (c) { ctx = c; },
    loadAll: loadAll,
    renderSheet: renderSheet,
    parseAngle: parseAngle,
    imageCoords: imageCoords
  };
})(typeof self !== 'undefined' ? self : this);
