// กล้องเล็งทิศ: ใช้กล้องหลังเป็นเข็มทิศ คำนวณระยะ/ความสูงจุดที่เล็งจากภูมิประเทศ
// สกัดกลับจากยอดเขาที่รู้พิกัด และถ่ายภาพปักลงแผนที่พร้อมพิกัดและความสูง
(function (root) {
  var G = TrailGeo;
  var R = TrailRoute;
  var S = TrailSensors;
  var D2R = Math.PI / 180;

  var RANGE = 20000; // ระยะเล็งไกลสุด (เมตร)
  var EYE = 1.6; // ความสูงสายตาเหนือพื้น (เมตร)
  var FOV_LONG = 69; // มุมมองด้านยาวของกล้องหลัง (องศา โดยประมาณ)
  var CURV = 0.87 / (2 * 6371000); // ความโค้งโลกหักลบการหักเหของอากาศ
  var PDB = 'trail-photos';
  var PSTORE = 'photos';

  var ctx = null;
  var cam = null;
  var photos = [];
  var photoMarkers = {};
  var obs = []; // ผลการเล็งสำหรับสกัดกลับ
  var resMarker = null;

  function $(id) { return document.getElementById(id); }
  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function mil(az) { return Math.round((az * 6400) / 360); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- ที่เก็บรูป ---------- */
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(PDB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(PSTORE, { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function run(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(PSTORE, mode);
        var req = fn(t.objectStore(PSTORE));
        t.oncomplete = function () { res(req ? req.result : undefined); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
      });
    });
  }

  function init(c) {
    ctx = c;
    S.state.decl = function () { return ctx.prefs.decl || 0; };
    S.state.offset = function () { return ctx.prefs.camOffset || 0; };
    var map = ctx.map();
    map.addSource('resect', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'resect-line', type: 'line', source: 'resect', paint: { 'line-color': '#0a84ff', 'line-width': 2.5, 'line-dasharray': [3, 2] } }, 'grid-lines');
    run('readonly', function (s) { return s.getAll(); }).then(function (list) {
      photos = list;
      photos.forEach(addPhotoMarker);
    }).catch(function () { /* ไม่มีที่เก็บรูป */ });
  }

  /* ---------- ผู้สังเกต (ตำแหน่งเรา) ---------- */
  function observer() {
    var f = S.state.fix;
    if (f && Date.now() - f.t < 180000) return { lat: f.lat, lng: f.lng, acc: f.acc, alt: f.alt, altAcc: f.altAcc, gps: true };
    var c = ctx.map().getCenter();
    return { lat: c.lat, lng: c.lng, acc: null, alt: null, gps: false };
  }

  /* ---------- ยิงลำแสงไปตามภูมิประเทศ ---------- */
  function castRay(o, h0, az, tilt) {
    var tn = Math.tan(tilt * D2R);
    var best = null, prevD = 0, prevC = h0 - h0; // ที่ระยะ 0 ลำแสงอยู่เหนือพื้น EYE
    prevC = EYE;
    for (var d = 40; d <= RANGE; d += Math.max(30, d * 0.01)) {
      var pos = G.destination(o, az, d);
      var e = R.elevSync(pos.lat, pos.lng);
      if (e === null) break;
      var ray = h0 + d * tn - CURV * d * d;
      var clear = ray - e;
      if (clear <= 0) {
        var t = prevC / (prevC - clear);
        var dh = prevD + t * (d - prevD);
        var ph = G.destination(o, az, dh);
        var eh = R.elevSync(ph.lat, ph.lng);
        return { lat: ph.lat, lng: ph.lng, ele: eh === null ? e : eh, dist: dh, approx: false };
      }
      var ang = Math.atan(clear / d) * G.R2D;
      if (!best || ang < best.ang) best = { ang: ang, d: d, lat: pos.lat, lng: pos.lng, ele: e };
      prevD = d; prevC = clear;
    }
    if (best && best.ang <= 1.0) return { lat: best.lat, lng: best.lng, ele: best.ele, dist: best.d, approx: true };
    return null;
  }

  /* ---------- เปิด/ปิดกล้อง ---------- */
  async function open() {
    if (cam) return;
    var ok = await S.start();
    var el = document.createElement('div');
    el.id = 'cam';
    el.innerHTML =
      '<video playsinline muted autoplay></video><canvas id="camov"></canvas>' +
      '<div class="camtop"><span id="camhead">รอเซนเซอร์…</span><button id="camclose">✕</button></div>' +
      '<div class="cambot"><div id="caminfo"></div><div id="camres" hidden></div>' +
      '<div class="camrow"><button class="cambtn" id="camadj">ปรับแก้ทิศ</button><button id="camshot" class="shutter" aria-label="ถ่ายภาพ"></button>' +
      '<button class="cambtn" id="camlock">ล็อกจุดเล็ง</button><button class="cambtn" id="camresbtn">สกัดกลับ</button></div></div>';
    document.body.appendChild(el);
    cam = { el: el, video: el.querySelector('video'), cv: el.querySelector('#camov'), stream: null, peaks: [], peakView: [], target: null, o: observer(), prefetchAt: null, raf: 0, last: 0, showRes: false };
    if (!ok) ctx.toast('ไม่ได้สิทธิ์เข็มทิศ ทิศจะไม่ทำงาน (ตั้งค่า > Safari > การเคลื่อนไหวและการวางแนว)');

    $('camclose').onclick = close;
    $('camshot').onclick = shoot;
    $('camlock').onclick = lockTarget;
    $('camresbtn').onclick = function () { cam.showRes = !cam.showRes; renderRes(); };
    $('camadj').onclick = function () {
      var v = prompt('ปรับแก้ทิศ (องศา, + ไปทางขวา) ใช้เมื่อเทียบกับเข็มทิศจริงแล้วทิศเพี้ยน', String(ctx.prefs.camOffset || 0));
      if (v === null) return;
      var n = parseFloat(v);
      ctx.prefs.camOffset = isNaN(n) ? 0 : n;
      ctx.savePrefs();
    };

    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      cam.video.srcObject = cam.stream;
      await cam.video.play();
    } catch (e) {
      ctx.toast('เปิดกล้องไม่ได้ ตรวจสิทธิ์กล้องของ Safari/แอพนี้');
      close();
      return;
    }
    loadTerrain();
    cam.raf = requestAnimationFrame(frame);
  }

  function loadTerrain() {
    if (!cam) return;
    var o = cam.o;
    cam.prefetchAt = { lat: o.lat, lng: o.lng };
    cam.loading = true;
    R.demPrefetch(o.lat, o.lng, RANGE).then(function () { if (cam) cam.loading = false; });
    R.peaksNear(o.lat, o.lng, 18000, ctx.vectorTpl()).then(function (p) { if (cam) cam.peaks = p; }).catch(function () {});
  }

  function close() {
    if (!cam) return;
    cancelAnimationFrame(cam.raf);
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.el.remove();
    cam = null;
  }

  /* ---------- วนอัพเดตภาพ ---------- */
  function frame(ts) {
    if (!cam) return;
    cam.raf = requestAnimationFrame(frame);
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cam.cv.width !== Math.round(W * dpr) || cam.cv.height !== Math.round(H * dpr)) {
      cam.cv.width = Math.round(W * dpr); cam.cv.height = Math.round(H * dpr);
    }
    if (ts - cam.last > 120) { cam.last = ts; compute(); }
    draw(W, H, dpr);
  }

  function compute() {
    var o = observer();
    cam.o = o;
    if (cam.prefetchAt && G.haversine(o, cam.prefetchAt) > 4000) loadTerrain();
    var az = S.headingTrue(), tilt = S.state.pitch;
    cam.az = az; cam.tilt = tilt;
    var ground = R.elevSync(o.lat, o.lng);
    cam.ground = ground;
    var base = ground !== null ? ground : (o.alt !== null && o.alt !== undefined ? o.alt : null);
    cam.h0 = base === null ? null : base + EYE;

    // ยอดเขาที่อยู่ในมุมมอง
    cam.peakView = [];
    if (cam.h0 !== null) {
      cam.peaks.forEach(function (p) {
        var pe = p.ele !== null ? p.ele : R.elevSync(p.lat, p.lng);
        if (pe === null) return;
        var d = G.haversine(o, p);
        cam.peakView.push({ p: p, ele: pe, dist: d, az: G.trueAzimuth(o, p), el: Math.atan2(pe - cam.h0 + CURV * d * d, d) * G.R2D });
      });
    }

    cam.target = null;
    if (az === null || tilt === null || cam.h0 === null) { renderInfo(); return; }

    var snap = null, snapAng = 1e9, near = null, nearAng = 1e9;
    cam.peakView.forEach(function (pv) {
      var daz = Math.abs(norm180(pv.az - az)), del = Math.abs(pv.el - tilt);
      var ang = Math.hypot(daz * Math.cos(tilt * D2R), del);
      if (daz <= 2.5 && del <= 2.5 && ang < snapAng) { snap = pv; snapAng = ang; }
      if (daz <= 6 && del <= 6 && ang < nearAng) { near = pv; nearAng = ang; }
    });
    cam.near = near;
    if (snap) {
      cam.target = { kind: 'peak', name: snap.p.name, lat: snap.p.lat, lng: snap.p.lng, ele: snap.ele, dist: snap.dist, bearing: snap.az };
    } else {
      var hit = castRay(o, cam.h0, az, tilt);
      if (hit) cam.target = { kind: 'terrain', approx: hit.approx, lat: hit.lat, lng: hit.lng, ele: hit.ele, dist: hit.dist, bearing: az };
    }
    renderInfo();
  }

  function renderInfo() {
    var o = cam.o, az = cam.az, tilt = cam.tilt;
    var head = $('camhead'), info = $('caminfo');
    if (!head || !info) return;
    if (az === null || az === undefined) head.textContent = 'ไม่มีข้อมูลเข็มทิศ (อนุญาตเซนเซอร์การเคลื่อนไหวและวางแนว)';
    else {
      var conv = G.convergence(o.lat, o.lng);
      var grid = G.norm360(az - conv);
      head.textContent = 'ทิศเหนือจริง ' + az.toFixed(1) + '° · มุมกริด ' + grid.toFixed(1) + '° (' + mil(grid) + ' มิล)' + (tilt !== null ? ' · เงย ' + (tilt >= 0 ? '+' : '') + tilt.toFixed(1) + '°' : '');
    }
    var lines = [];
    var t = cam.target;
    if (t) {
      var convT = G.convergence(o.lat, o.lng);
      var back = G.norm360(t.bearing + 180 - convT);
      var diff = cam.ground !== null && cam.ground !== undefined ? Math.round(t.ele - cam.ground) : null;
      lines.push((t.kind === 'peak' ? '▲ ' + (t.name || 'ยอดเขา') + ' ' + Math.round(t.ele) + ' ม.' : 'จุดที่เล็ง (ภูมิประเทศ' + (t.approx ? ' ประมาณ' : '') + ') สูง ' + Math.round(t.ele) + ' ม.') +
        ' · ระยะ ' + fmtDist(t.dist) + (diff !== null ? ' · ' + (diff >= 0 ? 'สูงกว่าเรา +' : 'ต่ำกว่าเรา ') + diff + ' ม.' : ''));
      lines.push('มุมตรง (เรา→จุด) ' + G.norm360(t.bearing - convT).toFixed(1) + '° · มุมสกัดกลับ (จุด→เรา) ' + back.toFixed(1) + '° (' + mil(back) + ' มิล)');
      lines.push('พิกัดจุดนั้น ' + ctx.fmtPoint(t.lat, t.lng));
    } else if (cam.loading) lines.push('กำลังโหลดข้อมูลภูมิประเทศ…');
    else if (cam.h0 === null) lines.push('ไม่มีข้อมูลความสูงของพื้นที่นี้ (ต้องดาวน์โหลดแผนที่ไว้ หรือมีเน็ต)');
    else lines.push('ไม่ชนภูมิประเทศภายใน ' + (RANGE / 1000) + ' กม. (เล็งฟ้าหรือไกลเกิน)');
    if (cam.near && !(t && t.kind === 'peak')) lines.push('ใกล้: ▲ ' + (cam.near.p.name || 'ยอดเขา') + ' ' + Math.round(cam.near.ele) + ' ม. ห่าง ' + fmtDist(cam.near.dist));
    lines.push('เรา: ' + ctx.fmtPoint(o.lat, o.lng) + (o.gps ? '  ±' + Math.round(o.acc || 0) + ' ม.' : '  (กลางจอแผนที่ ไม่ใช่ GPS)') +
      (cam.ground !== null && cam.ground !== undefined ? ' · สูง ~' + Math.round(cam.ground) + ' ม.' : ''));
    info.textContent = lines.join('\n');
    info.style.whiteSpace = 'pre-line';
  }

  function draw(W, H, dpr) {
    var c = cam.cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    var f = Math.max(W, H) / 2 / Math.tan((FOV_LONG / 2) * D2R);
    var az = cam.az, tilt = cam.tilt;
    c.strokeStyle = 'rgba(255,255,255,.9)';
    c.fillStyle = '#fff';
    c.lineWidth = 1.5;
    c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 3;
    // เป้าเล็ง
    c.beginPath(); c.arc(cx, cy, 22, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(cx - 40, cy); c.lineTo(cx - 8, cy); c.moveTo(cx + 8, cy); c.lineTo(cx + 40, cy);
    c.moveTo(cx, cy - 40); c.lineTo(cx, cy - 8); c.moveTo(cx, cy + 8); c.lineTo(cx, cy + 40); c.stroke();
    if (az === null || az === undefined || tilt === null || tilt === undefined) return;
    // เส้นขอบฟ้า
    var yh = cy + f * Math.tan(tilt * D2R);
    if (yh > 0 && yh < H) { c.setLineDash([8, 6]); c.beginPath(); c.moveTo(0, yh); c.lineTo(W, yh); c.stroke(); c.setLineDash([]); }
    // สเกลทิศด้านบน
    c.font = '12px sans-serif'; c.textAlign = 'center';
    var top = 70;
    var a0 = Math.floor((az - 40) / 5) * 5;
    for (var a = a0; a <= az + 40; a += 5) {
      var x = cx + f * Math.tan(norm180(a - az) * D2R);
      if (x < 0 || x > W) continue;
      var major = G.norm360(a) % 10 === 0;
      c.beginPath(); c.moveTo(x, top); c.lineTo(x, top + (major ? 14 : 8)); c.stroke();
      if (major) c.fillText(String(Math.round(G.norm360(a))), x, top + 28);
    }
    // ยอดเขาในมุมมอง
    c.textAlign = 'left';
    cam.peakView.forEach(function (pv) {
      var daz = norm180(pv.az - az);
      if (Math.abs(daz) > 45) return;
      var x = cx + f * Math.tan(daz * D2R), y = cy - f * Math.tan((pv.el - tilt) * D2R);
      if (x < -20 || x > W + 20 || y < 90 || y > H - 40) return;
      c.fillStyle = '#ffd24a';
      c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x - 7, y + 4); c.lineTo(x + 7, y + 4); c.closePath(); c.fill();
      c.fillStyle = '#fff';
      c.font = '13px sans-serif';
      c.fillText((pv.p.name || 'ยอดเขา') + ' ' + Math.round(pv.ele) + ' ม.', x + 10, y);
      c.font = '11px sans-serif';
      c.fillText(fmtDist(pv.dist), x + 10, y + 13);
    });
  }

  /* ---------- ล็อกจุดเล็ง + สกัดกลับ ---------- */
  function lockTarget() {
    var t = cam.target && cam.target.kind === 'peak' ? cam.target : (cam.near ? { name: cam.near.p.name, lat: cam.near.p.lat, lng: cam.near.p.lng, ele: cam.near.ele } : null);
    if (!t || cam.az === null || cam.az === undefined) { ctx.toast('เล็งให้ตรงยอดเขาที่รู้พิกัด (มีสามเหลี่ยมเหลืองในภาพ) ก่อนล็อก'); return; }
    obs.push({ name: t.name || 'ยอดเขา', lat: t.lat, lng: t.lng, ele: t.ele, az: cam.az, t: Date.now() });
    cam.showRes = true;
    ctx.toast('ล็อกแล้ว: ' + (t.name || 'ยอดเขา') + ' ทิศ ' + cam.az.toFixed(1) + '°');
    renderRes();
  }

  // หาตำแหน่งที่ใกล้เส้นสกัดกลับทุกเส้นที่สุด (กำลังสองน้อยที่สุด)
  function resect() {
    if (obs.length < 2) return null;
    var o0 = { lat: obs[0].lat, lng: obs[0].lng };
    var k = Math.cos(o0.lat * D2R);
    var a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    var P = obs.map(function (ob) { return [(ob.lng - o0.lng) * k * 111320, (ob.lat - o0.lat) * 110540]; });
    obs.forEach(function (ob, i) {
      var br = (ob.az + 180) * D2R;
      var nx = Math.cos(br), ny = -Math.sin(br); // ตั้งฉากกับทิศสกัดกลับ
      a11 += nx * nx; a12 += nx * ny; a22 += ny * ny;
      var dot = nx * P[i][0] + ny * P[i][1];
      b1 += nx * dot; b2 += ny * dot;
    });
    var det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 0.05) return { bad: true };
    var x = (a22 * b1 - a12 * b2) / det, y = (a11 * b2 - a12 * b1) / det;
    var worst = 0;
    obs.forEach(function (ob, i) {
      var br = (ob.az + 180) * D2R;
      var d = Math.abs(Math.cos(br) * (x - P[i][0]) + -Math.sin(br) * (y - P[i][1]));
      if (d > worst) worst = d;
    });
    var spread = 0;
    for (var i = 0; i < obs.length; i++) for (var j = i + 1; j < obs.length; j++) {
      var d2 = Math.abs(norm180(obs[i].az - obs[j].az));
      if (d2 > 90) d2 = 180 - d2;
      spread = Math.max(spread, d2);
    }
    return { lat: o0.lat + y / 110540, lng: o0.lng + x / (111320 * k), worst: worst, spread: spread };
  }

  function drawResect() {
    var feats = obs.map(function (ob) {
      var far = G.destination(ob, ob.az + 180, 30000);
      return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[ob.lng, ob.lat], [far.lng, far.lat]] } };
    });
    ctx.map().getSource('resect').setData({ type: 'FeatureCollection', features: feats });
  }

  function renderRes() {
    var box = $('camres');
    if (!box) return;
    box.hidden = !cam.showRes;
    $('camresbtn').textContent = 'สกัดกลับ (' + obs.length + ')';
    if (!cam.showRes) return;
    drawResect();
    var r = resect();
    var h = '<b>สกัดกลับจากยอดเขา</b> เล็งยอดเขาที่รู้พิกัดอย่างน้อย 2 ยอด (ห่างกัน 30–150°) แล้วกด "ล็อกจุดเล็ง"<br>';
    obs.forEach(function (ob, i) {
      h += '<div class="obs">' + (i + 1) + '. ' + ob.name + ' ' + Math.round(ob.ele || 0) + ' ม. · ทิศที่เล็ง ' + ob.az.toFixed(1) + '° (มุมสกัดกลับ ' + G.norm360(ob.az + 180).toFixed(1) + '°) <a data-i="' + i + '">ลบ</a></div>';
    });
    if (r && r.bad) h += '<div>เส้นสกัดกลับขนานกันเกินไป ลองเล็งยอดเขาที่อยู่คนละทิศ</div>';
    else if (r) {
      var f = S.state.fix;
      h += '<div class="resok">ตำแหน่งที่คำนวณได้: ' + ctx.fmtPoint(r.lat, r.lng) + '<br>มุมตัดมากสุด ' + Math.round(r.spread) + '° · คลาดเคลื่อนระหว่างเส้นสูงสุด ~' + Math.round(r.worst) + ' ม.' +
        (f ? '<br>ต่างจาก GPS ' + fmtDist(G.haversine(f, r)) : '') + '</div>' +
        '<button class="cambtn" id="resshow">ปักหมุดบนแผนที่</button> ';
    }
    h += '<button class="cambtn" id="resclear">ล้างทั้งหมด</button>';
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll('a[data-i]'), function (a) {
      a.onclick = function () { obs.splice(parseInt(a.getAttribute('data-i'), 10), 1); renderRes(); };
    });
    $('resclear').onclick = function () {
      obs = []; ctx.map().getSource('resect').setData({ type: 'FeatureCollection', features: [] });
      if (resMarker) { resMarker.remove(); resMarker = null; }
      renderRes();
    };
    var sb = $('resshow');
    if (sb) sb.onclick = function () {
      if (resMarker) resMarker.remove();
      var el = document.createElement('div');
      el.className = 'pin';
      el.style.background = '#1f9d4a';
      resMarker = new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(ctx.map());
      ctx.map().jumpTo({ center: [r.lng, r.lat] });
      close();
      ctx.toast('ตำแหน่งสกัดกลับ ' + ctx.fmtPoint(r.lat, r.lng));
    };
  }

  /* ---------- ถ่ายภาพ ---------- */
  function shoot() {
    var v = cam.video;
    if (!v.videoWidth) return;
    var o = cam.o, t = cam.target;
    var cv = document.createElement('canvas');
    cv.width = v.videoWidth; cv.height = v.videoHeight;
    var c = cv.getContext('2d');
    c.drawImage(v, 0, 0);
    var now = new Date();
    var conv = G.convergence(o.lat, o.lng);
    var lines = [
      pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()),
      ctx.fmtPoint(o.lat, o.lng) + (o.gps ? '  ±' + Math.round(o.acc || 0) + ' ม.' : '  (ตำแหน่งไม่ใช่ GPS)'),
      'สูง ' + [o.alt !== null && o.alt !== undefined ? 'GPS ' + Math.round(o.alt) : null, cam.ground !== null && cam.ground !== undefined ? 'แผนที่ ' + Math.round(cam.ground) : null].filter(Boolean).join(' / ') + ' ม.',
      cam.az !== null && cam.az !== undefined ? 'ทิศ ' + cam.az.toFixed(1) + '° (กริด ' + G.norm360(cam.az - conv).toFixed(1) + '° ' + mil(G.norm360(cam.az - conv)) + ' มิล)' : 'ทิศ –'
    ];
    if (t) lines.push((t.kind === 'peak' ? (t.name || 'ยอดเขา') + ' ' : 'จุดเล็ง ') + 'ห่าง ' + fmtDist(t.dist) + ' สูง ' + Math.round(t.ele) + ' ม.');
    var fs = Math.round(cv.width * 0.032);
    c.font = '600 ' + fs + 'px sans-serif';
    var bh = fs * 1.35 * lines.length + fs * 0.6;
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.fillRect(0, cv.height - bh, cv.width, bh);
    c.fillStyle = '#fff';
    c.textBaseline = 'top';
    lines.forEach(function (l, i) { c.fillText(l, fs * 0.5, cv.height - bh + fs * 0.3 + i * fs * 1.35); });
    cv.toBlob(function (blob) {
      if (!blob) { ctx.toast('บันทึกภาพไม่ได้'); return; }
      var rec = {
        id: String(Date.now()), lat: o.lat, lng: o.lng, gps: o.gps, acc: o.acc, alt: o.alt, ground: cam.ground,
        az: cam.az, tilt: cam.tilt, t: Date.now(), blob: blob,
        target: t ? { kind: t.kind, name: t.name || '', lat: t.lat, lng: t.lng, ele: t.ele, dist: t.dist } : null, lines: lines
      };
      run('readwrite', function (s) { return s.put(rec); }).then(function () {
        photos.push(rec);
        addPhotoMarker(rec);
        ctx.toast('บันทึกภาพลงแผนที่แล้ว');
      }).catch(function () { ctx.toast('บันทึกภาพไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); });
    }, 'image/jpeg', 0.9);
  }

  function addPhotoMarker(rec) {
    var el = document.createElement('div');
    el.className = 'cammark';
    el.textContent = '📷';
    el.onclick = function (e) { e.stopPropagation(); viewPhoto(rec); };
    photoMarkers[rec.id] = new maplibregl.Marker({ element: el }).setLngLat([rec.lng, rec.lat]).addTo(ctx.map());
  }

  function viewPhoto(rec) {
    var url = URL.createObjectURL(rec.blob);
    var el = document.createElement('div');
    el.id = 'photoview';
    el.innerHTML = '<img alt=""><div class="pvinfo"></div><div class="btnrow"><button class="btn alt" id="pvshare">แชร์/บันทึกลงรูป</button><button class="btn alt" id="pvdel">ลบ</button><button class="btn" id="pvclose">ปิด</button></div>';
    el.querySelector('img').src = url;
    el.querySelector('.pvinfo').textContent = rec.lines.join('\n');
    document.body.appendChild(el);
    function done() { URL.revokeObjectURL(url); el.remove(); }
    el.querySelector('#pvclose').onclick = done;
    el.querySelector('#pvshare').onclick = function () {
      var file = new File([rec.blob], 'photo-' + rec.id + '.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(function () {});
      else ctx.toast('เครื่องนี้ไม่รองรับการแชร์รูปจากแอพ');
    };
    el.querySelector('#pvdel').onclick = function () {
      if (!confirm('ลบภาพนี้?')) return;
      run('readwrite', function (s) { return s['delete'](rec.id); }).then(function () {
        photos = photos.filter(function (p) { return p.id !== rec.id; });
        if (photoMarkers[rec.id]) { photoMarkers[rec.id].remove(); delete photoMarkers[rec.id]; }
        done();
      });
    };
  }

  root.TrailCam = { init: init, open: open, isOpen: function () { return !!cam; } };
})(typeof self !== 'undefined' ? self : this);
