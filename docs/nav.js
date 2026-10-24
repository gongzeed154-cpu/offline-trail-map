// เส้นทางเดิน: ปักจุดพิกัด สร้างเส้นทาง (เส้นตรง / วาดเอง / อัตโนมัติ) และระบบนำทาง
(function (root) {
  var G = TrailGeo;
  var R = TrailRoute;
  var KEY = 'trail_routes_v1';
  var PKEY = 'trail_nav_prefs_v1';

  var ctx = null; // { map, toast, closeSheet, geolocate, vectorTpl, prefs, fmtPoint }
  var routes = [];
  var np = { pace: 4, tol: 30, voice: false }; // ความเร็วเดินตามแผน กม./ชม., ระยะที่ถือว่าออกนอกเส้น ม., เสียงเตือน
  var edit = null;
  var nav = null;
  var compassHeading = null; // องศาเหนือจริง
  var wakeLock = null;

  function $(id) { return document.getElementById(id); }
  function loadStore() {
    try { routes = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { routes = []; }
    try { var p = JSON.parse(localStorage.getItem(PKEY) || '{}'); for (var k in np) if (p[k] !== undefined) np[k] = p[k]; } catch (e2) { /* ค่าเริ่มต้น */ }
  }
  function saveRoutes() { try { localStorage.setItem(KEY, JSON.stringify(routes)); } catch (e) { ctx.toast('บันทึกเส้นทางไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); } }
  function savePrefs() { try { localStorage.setItem(PKEY, JSON.stringify(np)); } catch (e) { /* ไม่เป็นไร */ } }

  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' กม.' : Math.round(m) + ' ม.'; }
  function fmtDur(sec) {
    if (!isFinite(sec)) return '–';
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' นาที';
    return Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' น.';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ts) { var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function norm180(a) { a = G.norm360(a); return a > 180 ? a - 360 : a; }
  function mil(az) { return Math.round((az * 6400) / 360); }
  function legTime(leg) { return leg.time || leg.dist / (np.pace / 3.6); }

  /* ---------- ชั้นแผนที่ ---------- */
  var EMPTY = { type: 'FeatureCollection', features: [] };

  function init(c) {
    ctx = c;
    loadStore();
    var map = ctx.map();
    map.addSource('routes', { type: 'geojson', data: EMPTY });
    map.addSource('route-wp', { type: 'geojson', data: EMPTY });
    map.addSource('route-edit', { type: 'geojson', data: EMPTY });
    map.addSource('nav-link', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } }, 'grid-lines');
    map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'active'], '#d6261c', '#7b2cbf'], 'line-width': 4 } }, 'grid-lines');
    map.addLayer({ id: 'route-edit-line', type: 'line', source: 'route-edit', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a84ff', 'line-width': 4, 'line-dasharray': [1.5, 1] } }, 'grid-lines');
    map.addLayer({ id: 'nav-link-line', type: 'line', source: 'nav-link', paint: { 'line-color': '#d6261c', 'line-width': 3, 'line-dasharray': [1, 1.5] } }, 'grid-lines');
    map.addLayer({ id: 'route-wp-dot', type: 'circle', source: 'route-wp', paint: { 'circle-radius': 10, 'circle-color': ['case', ['get', 'saddle'], '#e08a00', '#7b2cbf'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } }, 'grid-lines');
    map.addLayer({ id: 'route-wp-num', type: 'symbol', source: 'route-wp', layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } }, 'grid-lines');
    TrailProj.onChange(drawRoutes);
    drawRoutes();
    bindDraw();
    ctx.geolocate.on('geolocate', function (e) {
      if (nav && !nav.sim && e.coords) {
        onFix({ lat: e.coords.latitude, lng: e.coords.longitude, acc: e.coords.accuracy, speed: e.coords.speed, heading: e.coords.heading, t: e.timestamp || Date.now() });
      }
    });
  }

  function routePts(r) {
    var pts = [];
    r.legs.forEach(function (l, i) { l.pts.forEach(function (p, j) { if (i === 0 || j > 0) pts.push(p); }); });
    return pts;
  }

  function drawRoutes() {
    var map = ctx.map();
    if (!map.getSource('routes')) return;
    var lines = [], wps = [];
    routes.forEach(function (r) {
      if (!TrailProj.isVisible(r)) return;
      lines.push({ type: 'Feature', properties: { active: !!(nav && nav.routeId === r.id) }, geometry: { type: 'LineString', coordinates: routePts(r) } });
      r.wps.forEach(function (w, i) { wps.push({ type: 'Feature', properties: { t: String(i + 1), saddle: false }, geometry: { type: 'Point', coordinates: [w.lng, w.lat] } }); });
      r.legs.forEach(function (l) {
        (l.saddles || []).forEach(function (s) { wps.push({ type: 'Feature', properties: { t: '▲', saddle: true }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } }); });
      });
    });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: lines });
    map.getSource('route-wp').setData({ type: 'FeatureCollection', features: wps });
  }

  /* ---------- ตัวแก้ไขเส้นทาง ---------- */
  function startEdit() {
    if (nav) stopNav();
    ctx.closeSheet();
    edit = { name: '', wps: [], legs: [], markers: [], mode: 'line', busy: false, stroke: null, justDrew: 0 };
    renderEditCard();
    syncDrag();
    ctx.toast('แตะแผนที่เพื่อปักจุดเริ่มต้น');
  }

  function renderEditCard() {
    var card = $('routecard');
    if (!edit) { card.hidden = true; return; }
    card.hidden = false;
    var hint = edit.mode === 'free'
      ? (edit.wps.length ? 'ลากนิ้วบนแผนที่เพื่อวาดเส้นทางต่อจากจุดล่าสุด' : 'แตะแผนที่เพื่อปักจุดเริ่มต้น')
      : 'แตะแผนที่เพื่อเพิ่มจุดถัดไป' + (edit.mode === 'auto' ? ' (ระบบหาทางเดินเท้า/คอเขาให้)' : '');
    card.innerHTML =
      '<div><b>สร้างเส้นทาง</b> <span id="rinfo"></span></div>' +
      '<div class="seg">' +
      ['line:เส้นตรง', 'free:วาดเอง', 'auto:อัตโนมัติ'].map(function (s) {
        var p = s.split(':');
        return '<button data-mode="' + p[0] + '" aria-pressed="' + (edit.mode === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="lbl" id="rhint"></div>' +
      '<div class="field"><input type="text" id="rcoord" placeholder="ใส่พิกัด MGRS / UTM / lat,lng เพื่อปักจุด"><button class="btn alt" id="radd" style="flex:none;padding:8px 12px">ปัก</button></div>' +
      '<div class="btnrow"><button class="btn alt" id="rundo">ย้อนจุด</button><button class="btn" id="rdone">เสร็จสิ้น</button><button class="btn alt" id="rcancel">ยกเลิก</button></div>';
    card.querySelector('#rhint').textContent = hint;
    Array.prototype.forEach.call(card.querySelectorAll('.seg button'), function (b) {
      b.onclick = function () { edit.mode = b.getAttribute('data-mode'); renderEditCard(); syncDrag(); };
    });
    card.querySelector('#radd').onclick = function () {
      var p = G.parsePoint(card.querySelector('#rcoord').value);
      if (!p) { ctx.toast('อ่านพิกัดไม่ออก ลองรูปแบบ 47P QA 12345 67890'); return; }
      card.querySelector('#rcoord').value = '';
      ctx.map().easeTo({ center: [p.lng, p.lat], duration: 500 });
      addWaypoint(p, true);
    };
    card.querySelector('#rundo').onclick = undoPoint;
    card.querySelector('#rdone').onclick = finishEdit;
    card.querySelector('#rcancel').onclick = cancelEdit;
    updateEditInfo();
  }

  function updateEditInfo() {
    var el = $('rinfo');
    if (!el || !edit) return;
    var d = 0, t = 0;
    edit.legs.forEach(function (l) { d += l.dist; t += legTime(l); });
    el.textContent = edit.wps.length ? '· ' + edit.wps.length + ' จุด · ' + fmtDist(d) + ' · ~' + fmtDur(t) : '';
  }

  function syncDrag() {
    var map = ctx.map();
    if (edit && edit.mode === 'free' && edit.wps.length > 0) map.dragPan.disable();
    else map.dragPan.enable();
  }

  function drawEditLine(extra) {
    var map = ctx.map();
    var feats = [];
    if (edit) {
      var pts = [];
      edit.legs.forEach(function (l, i) { l.pts.forEach(function (p, j) { if (i === 0 || j > 0) pts.push(p); }); });
      if (extra) pts = pts.concat(extra);
      if (pts.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
    }
    map.getSource('route-edit').setData({ type: 'FeatureCollection', features: feats });
  }

  function makeLeg(mode, a, b) {
    var line = [[a.lng, a.lat], [b.lng, b.lat]];
    var dist = G.haversine(a, b);
    return { mode: 'line', pts: line, dist: dist, time: 0 };
  }

  async function buildLeg(mode, a, b) {
    if (mode === 'auto') {
      try {
        var r = await R.autoRoute(a, b, ctx.vectorTpl(), function (s) { var el = $('rinfo'); if (el) el.textContent = '· ' + s; });
        if (!r.hasTrails) ctx.toast('ไม่พบทางเดินเท้าในข้อมูลแผนที่ ใช้ความสูงภูมิประเทศหาทางที่เดินง่ายแทน');
        return { mode: 'auto', pts: r.pts, dist: r.dist, time: r.time, trailPct: r.trailPct, ascent: r.ascent, descent: r.descent, saddles: r.saddles.map(function (s) { return { lat: s.lat, lng: s.lng, ele: s.ele }; }) };
      } catch (err) {
        ctx.toast(err && err.message === 'far' ? 'ช่วงนี้ไกลเกินไปสำหรับโหมดอัตโนมัติ ใช้เส้นตรงแทน'
          : err && err.message === 'nodem' ? 'ไม่มีข้อมูลความสูงของพื้นที่นี้ (ยังไม่ได้ดาวน์โหลด/ไม่มีเน็ต) ใช้เส้นตรงแทน'
          : 'หาเส้นทางอัตโนมัติไม่ได้ ใช้เส้นตรงแทน');
        return makeLeg('line', a, b);
      }
    }
    return makeLeg('line', a, b);
  }

  function addMarker(i) {
    var el = document.createElement('div');
    el.className = 'wpmark';
    el.textContent = i + 1;
    var m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([edit.wps[i].lng, edit.wps[i].lat]).addTo(ctx.map());
    m.on('dragend', function () { moveWaypoint(i, m.getLngLat()); });
    edit.markers[i] = m;
  }

  async function addWaypoint(p, fromCoord) {
    if (!edit || edit.busy) return;
    if (edit.wps.length && edit.mode === 'free' && !fromCoord) return; // โหมดวาดเอง: ใช้การลากนิ้ว
    var mode = edit.mode === 'free' ? 'line' : edit.mode;
    var leg = null;
    if (edit.wps.length) {
      edit.busy = true;
      leg = await buildLeg(mode, edit.wps[edit.wps.length - 1], p);
      edit.busy = false;
      if (!edit) return;
    }
    edit.wps.push({ lat: p.lat, lng: p.lng });
    if (leg) edit.legs.push(leg);
    addMarker(edit.wps.length - 1);
    drawEditLine();
    renderEditCard();
    syncDrag();
  }

  async function moveWaypoint(i, ll) {
    if (!edit || edit.busy) return;
    edit.wps[i] = { lat: ll.lat, lng: ll.lng };
    edit.busy = true;
    for (var k = i - 1; k <= i; k++) {
      if (k < 0 || k >= edit.legs.length) continue;
      var old = edit.legs[k];
      var a = edit.wps[k], b = edit.wps[k + 1];
      if (old.mode === 'auto') edit.legs[k] = await buildLeg('auto', a, b);
      else if (old.mode === 'free') {
        var pts = old.pts.slice();
        pts[0] = [a.lng, a.lat]; pts[pts.length - 1] = [b.lng, b.lat];
        edit.legs[k] = { mode: 'free', pts: pts, dist: R.polyLength(pts), time: 0 };
      } else edit.legs[k] = makeLeg('line', a, b);
      if (!edit) return;
    }
    edit.busy = false;
    drawEditLine();
    updateEditInfo();
  }

  function undoPoint() {
    if (!edit || edit.busy || !edit.wps.length) return;
    edit.wps.pop();
    if (edit.legs.length) edit.legs.pop();
    var m = edit.markers.pop();
    if (m) m.remove();
    drawEditLine();
    renderEditCard();
    syncDrag();
  }

  function clearEditUI() {
    if (edit) edit.markers.forEach(function (m) { if (m) m.remove(); });
    edit = null;
    ctx.map().getSource('route-edit').setData(EMPTY);
    ctx.map().dragPan.enable();
    renderEditCard();
  }
  function cancelEdit() { clearEditUI(); }

  function finishEdit() {
    if (!edit || edit.busy) return;
    if (edit.wps.length < 2) { ctx.toast('ต้องมีอย่างน้อย 2 จุด'); return; }
    var name = prompt('ตั้งชื่อเส้นทาง', 'เส้นทาง ' + (routes.length + 1));
    if (name === null) return;
    var d = 0, t = 0;
    edit.legs.forEach(function (l) { d += l.dist; t += legTime(l); });
    var r = { id: String(Date.now()), name: name.trim() || 'เส้นทาง', wps: edit.wps, legs: edit.legs, dist: d, time: t, show: true, proj: TrailProj.active() };
    routes.push(r);
    saveRoutes();
    clearEditUI();
    drawRoutes();
    ctx.toast('บันทึกแล้ว: ' + r.name + ' · ' + fmtDist(d) + ' · ~' + fmtDur(t));
  }

  // วาดเส้นทางเองด้วยนิ้ว
  function bindDraw() {
    var cv = ctx.map().getCanvasContainer();
    function ll(e) {
      var rc = cv.getBoundingClientRect();
      return ctx.map().unproject([e.clientX - rc.left, e.clientY - rc.top]);
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!edit || edit.mode !== 'free' || !edit.wps.length || edit.busy) return;
      if (e.pointerType === 'touch' && !e.isPrimary) { edit.stroke = null; return; }
      var p = ll(e);
      edit.stroke = [[p.lng, p.lat]];
      edit.lastXY = [e.clientX, e.clientY];
    });
    cv.addEventListener('pointermove', function (e) {
      if (!edit || !edit.stroke) return;
      if (Math.hypot(e.clientX - edit.lastXY[0], e.clientY - edit.lastXY[1]) < 6) return;
      edit.lastXY = [e.clientX, e.clientY];
      var p = ll(e);
      edit.stroke.push([p.lng, p.lat]);
      drawEditLine(edit.stroke);
    });
    function up() {
      if (!edit || !edit.stroke) return;
      var s = edit.stroke;
      edit.stroke = null;
      if (s.length < 3) { drawEditLine(); return; }
      edit.justDrew = Date.now();
      var last = edit.wps[edit.wps.length - 1];
      var map = ctx.map();
      var mpp = (40075016 * Math.cos(last.lat * Math.PI / 180)) / (512 * Math.pow(2, map.getZoom()));
      var pts = R.dpSimplify([[last.lng, last.lat]].concat(s.slice(1)), mpp * 3);
      var end = pts[pts.length - 1];
      edit.legs.push({ mode: 'free', pts: pts, dist: R.polyLength(pts), time: 0 });
      edit.wps.push({ lat: end[1], lng: end[0] });
      addMarker(edit.wps.length - 1);
      drawEditLine();
      renderEditCard();
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', function () { if (edit) { edit.stroke = null; drawEditLine(); } });
  }

  function handleClick(e) {
    if (!edit) return false;
    if (Date.now() - edit.justDrew < 400) return true;
    addWaypoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    return true;
  }

  /* ---------- นำทาง ---------- */
  async function startNav(id, sim) {
    var r = routes.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    ctx.closeSheet();
    if (edit) cancelEdit();
    if (nav) stopNav();
    var pts = routePts(r);
    var cum = R.cumulative(pts);
    // ระยะตามแนวเส้นของแต่ละจุดปัก
    var wpAlong = [0], acc = 0;
    r.legs.forEach(function (l) { acc += R.polyLength(l.pts); wpAlong.push(acc); });
    nav = {
      routeId: id, route: r, pts: pts, cum: cum, total: cum[cum.length - 1], wpAlong: wpAlong, progress: 0,
      follow: true, sim: !!sim, simAlong: 0, simOff: 0, simTimer: null, speed: null, movedTime: 0, movedDist: 0,
      lastFix: null, start: Date.now(), announced: {}, lastWarn: 0, last: null
    };
    r.show = true;
    drawRoutes();
    ctx.map().fitBounds(boundsOf(pts), { padding: 60, duration: 600 });

    // ขอสิทธิ์เข็มทิศ (iOS ต้องเรียกจากการแตะ)
    try {
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
    } catch (e) { /* ผู้ใช้ปฏิเสธ ใช้ทิศจากการเคลื่อนที่แทน */ }
    window.addEventListener('deviceorientation', onOrient, true);
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e2) { wakeLock = null; }

    if (nav.sim) {
      nav.simMarker = new maplibregl.Marker({ element: simEl() }).setLngLat([pts[0][0], pts[0][1]]).addTo(ctx.map());
      nav.simTimer = setInterval(simStep, 1000);
      ctx.toast('โหมดจำลองการเดิน (เร็วขึ้น 5 เท่า) ปุ่ม ◀ ▶ ใช้เบี่ยงออกนอกเส้นทาง');
    } else {
      ctx.geolocate.trigger();
      ctx.toast('กำลังรอสัญญาณ GPS… ควรอยู่กลางแจ้ง');
      nav.fixTimer = setTimeout(function () { if (nav && !nav.last) ctx.toast('ยังไม่ได้ตำแหน่ง GPS เปิด "บริการตำแหน่ง" ให้ Safari/แอพนี้ แล้วออกไปที่โล่ง'); }, 25000);
    }
    renderNav();
  }

  function simEl() {
    var el = document.createElement('div');
    el.className = 'pin';
    el.style.background = '#0a84ff';
    return el;
  }

  function boundsOf(pts) {
    var w = 180, s = 90, e = -180, n = -90;
    pts.forEach(function (p) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); });
    return [[w, s], [e, n]];
  }

  function stopNav() {
    if (!nav) return;
    clearInterval(nav.simTimer);
    clearTimeout(nav.fixTimer);
    if (nav.simMarker) nav.simMarker.remove();
    window.removeEventListener('deviceorientation', onOrient, true);
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ไม่เป็นไร */ }
    wakeLock = null;
    nav = null;
    ctx.map().getSource('nav-link').setData(EMPTY);
    drawRoutes();
    $('navcard').hidden = true;
  }

  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading + (ctx.prefs.decl || 0);
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha + (ctx.prefs.decl || 0);
    if (h !== null) compassHeading = G.norm360(h);
  }

  function simStep() {
    if (!nav) return;
    var v = (np.pace / 3.6) * 5;
    nav.simAlong = Math.min(nav.total, nav.simAlong + v);
    var p = R.pointAt(nav.pts, nav.cum, nav.simAlong);
    var q = R.pointAt(nav.pts, nav.cum, Math.min(nav.total, nav.simAlong + 5));
    var az = G.gridAzimuth(p, q).az;
    var pos = p;
    if (nav.simOff) pos = G.pointFromGrid(p, az + (nav.simOff > 0 ? 90 : -90), Math.abs(nav.simOff));
    nav.simMarker.setLngLat([pos.lng, pos.lat]);
    onFix({ lat: pos.lat, lng: pos.lng, acc: 5, speed: v, heading: G.trueAzimuth(p, q), t: Date.now() });
  }

  function speak(text) {
    if (!np.voice || !window.speechSynthesis || (ctx.prefs && (ctx.prefs.mute || ctx.prefs.display === 'stealth'))) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'th-TH';
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* ไม่เป็นไร */ }
  }

  function onFix(f) {
    if (!nav) return;
    clearTimeout(nav.fixTimer);
    var prev = nav.lastFix;
    var spd = typeof f.speed === 'number' && f.speed >= 0 ? f.speed : null;
    if (spd === null && prev) {
      var dt = (f.t - prev.t) / 1000;
      if (dt > 0.5) spd = G.haversine(prev, f) / dt;
    }
    if (spd !== null) {
      nav.speed = nav.speed === null ? spd : nav.speed * 0.7 + spd * 0.3;
      if (prev && spd > 0.5) { nav.movedTime += Math.min(10, (f.t - prev.t) / 1000); nav.movedDist += spd * Math.min(10, (f.t - prev.t) / 1000); }
    }
    nav.lastFix = f;
    nav.last = f;

    var pr = R.project(nav.pts, nav.cum, f, nav.progress);
    nav.progress = pr.along;
    var remaining = Math.max(0, nav.total - pr.along);
    var tol = Math.max(np.tol, f.acc && f.acc < 200 ? f.acc : 0);
    var off = pr.dist;
    var offRoute = off > tol;

    // เป้าหมายที่จะเดินไปหา: จุดบนเส้นทางข้างหน้า
    var look = Math.max(40, off * 1.5);
    var target = R.pointAt(nav.pts, nav.cum, Math.min(nav.total, pr.along + look));
    var distT = G.haversine(f, target);
    var azG = G.gridAzimuth(f, target).az;
    var brgTrue = G.trueAzimuth(f, target);

    var heading = null;
    if (spd !== null && spd > 0.8 && typeof f.heading === 'number' && !isNaN(f.heading)) heading = f.heading;
    else if (compassHeading !== null) heading = compassHeading;

    // จุดปักถัดไป
    var nextI = 1;
    while (nextI < nav.wpAlong.length - 1 && nav.wpAlong[nextI] < pr.along + 15) nextI++;
    var toNext = Math.max(0, nav.wpAlong[nextI] - pr.along);
    for (var i = 1; i < nav.wpAlong.length; i++) {
      if (!nav.announced[i] && nav.wpAlong[i] - pr.along < 25 && nav.wpAlong[i] - pr.along > -60) {
        nav.announced[i] = true;
        var msg = i === nav.wpAlong.length - 1 ? 'ถึงที่หมายแล้ว' : 'ถึงจุดที่ ' + (i + 1);
        ctx.toast(msg);
        speak(msg);
      }
    }

    // เวลาที่เหลือ
    var planSpeed = np.pace / 3.6;
    var avg = nav.movedTime > 60 ? nav.movedDist / nav.movedTime : null;
    var cur = nav.speed !== null && nav.speed > 0.3 ? nav.speed : null;
    var useSpeed = avg && cur ? 0.5 * avg + 0.5 * cur : (avg || cur || planSpeed);
    var etaSec = remaining / Math.max(useSpeed, 0.2);

    // คำแนะนำ
    var turnTxt = '';
    if (heading !== null) {
      var turn = norm180(brgTrue - heading);
      turnTxt = Math.abs(turn) < 10 ? 'เดินตรงไป' : 'เลี้ยว' + (turn > 0 ? 'ขวา ' : 'ซ้าย ') + Math.round(Math.abs(turn)) + '°';
    }
    var status, instr, bad = false;
    if (remaining < 25) {
      status = 'ถึงที่หมายแล้ว';
      instr = 'อยู่ห่างจุดสุดท้าย ' + Math.round(remaining) + ' ม.';
    } else if (offRoute) {
      bad = true;
      status = 'ออกนอกเส้นทาง ' + Math.round(off) + ' ม. (อยู่ทาง' + (pr.side === 'left' ? 'ซ้าย' : 'ขวา') + 'ของเส้นทาง)';
      instr = 'เดินแก้: ' + (turnTxt ? turnTxt + ' แล้วเดิน' : 'เดิน') + 'มุมกริด ' + Math.round(azG) + '° (' + mil(azG) + ' มิล) ระยะ ' + Math.round(distT) + ' ม. เพื่อกลับเข้าเส้นทาง' +
        (off > tol * 4 ? '\n⚠ ออกห่างมาก ควรหยุดตรวจตำแหน่ง หรือเดินย้อนกลับไปจุดที่ออกจากเส้น' : '');
      if (Date.now() - nav.lastWarn > 20000) {
        nav.lastWarn = Date.now();
        speak('ออกนอกเส้นทาง ' + Math.round(off) + ' เมตร ' + (turnTxt || ''));
      }
    } else {
      status = 'อยู่บนเส้นทาง (ห่าง ' + Math.round(off) + ' ม.)';
      instr = 'เดินต่อมุมกริด ' + Math.round(azG) + '° (' + mil(azG) + ' มิล) ไปจุดที่ ' + (nextI + 1) + ' อีก ' + fmtDist(toNext);
    }

    nav.view = {
      bad: bad, status: status, instr: instr, remaining: remaining, eta: Date.now() + etaSec * 1000, etaSec: etaSec,
      speed: nav.speed, avg: avg, acc: f.acc, done: pr.along, total: nav.total, planSec: nav.route.time, fixText: ctx.fmtPoint(f.lat, f.lng)
    };
    var link = offRoute ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[f.lng, f.lat], [target.lng, target.lat]] } }] } : EMPTY;
    ctx.map().getSource('nav-link').setData(link);
    if (nav.follow) ctx.map().easeTo({ center: [f.lng, f.lat], duration: 600 });
    renderNav();
  }

  function renderNav() {
    var card = $('navcard');
    if (!nav) { card.hidden = true; return; }
    $('azcard').hidden = true;
    card.hidden = false;
    var v = nav.view;
    if (!v) {
      card.innerHTML = '<div><b></b></div><div class="btnrow"><button class="btn alt" id="nstop">หยุดนำทาง</button></div>';
      card.querySelector('b').textContent = 'นำทาง: ' + nav.route.name + ' · รอตำแหน่ง…';
      card.querySelector('#nstop').onclick = stopNav;
      return;
    }
    card.className = v.bad ? 'bad' : '';
    var kmh = function (ms) { return ms === null || ms === undefined ? '–' : (ms * 3.6).toFixed(1) + ' กม./ชม.'; };
    card.innerHTML =
      '<div class="big" id="nst"></div><div id="nin" style="white-space:pre-line"></div>' +
      '<div class="grid2">' +
      '<div><span class="lbl">เหลืออีก</span><br><span id="nrem"></span></div>' +
      '<div><span class="lbl">ถึงประมาณ</span><br><span id="neta"></span></div>' +
      '<div><span class="lbl">ความเร็วตอนนี้</span><br><span id="nspd"></span></div>' +
      '<div><span class="lbl">ความเร็วเฉลี่ย</span><br><span id="navg"></span></div>' +
      '</div><div class="lbl" id="nfix"></div>' +
      '<div class="btnrow"><button class="btn alt" id="nfol"></button>' + (nav.sim ? '<button class="btn alt" id="nl">◀</button><button class="btn alt" id="nr">▶</button>' : '') + '<button class="btn alt" id="nstop">หยุด</button></div>';
    card.querySelector('#nst').textContent = v.status;
    card.querySelector('#nin').textContent = v.instr;
    card.querySelector('#nrem').textContent = fmtDist(v.remaining) + ' (' + Math.round((v.done / v.total) * 100) + '% แล้ว)';
    card.querySelector('#neta').textContent = clock(v.eta) + ' · อีก ' + fmtDur(v.etaSec);
    card.querySelector('#nspd').textContent = kmh(v.speed);
    card.querySelector('#navg').textContent = kmh(v.avg);
    card.querySelector('#nfix').textContent = (nav.sim ? '[จำลอง] ' : '') + v.fixText + (v.acc ? '  ±' + Math.round(v.acc) + ' ม.' : '') + '  · แผน ' + fmtDur(v.planSec);
    var fol = card.querySelector('#nfol');
    fol.textContent = nav.follow ? 'ตามตัว: เปิด' : 'ตามตัว: ปิด';
    fol.onclick = function () { nav.follow = !nav.follow; renderNav(); };
    card.querySelector('#nstop').onclick = stopNav;
    if (nav.sim) {
      card.querySelector('#nl').onclick = function () { nav.simOff -= 20; };
      card.querySelector('#nr').onclick = function () { nav.simOff += 20; };
    }
  }

  /* ---------- ส่งออก/นำเข้า ---------- */
  function exportModels(ids) {
    return routes.filter(function (r) { return ids.indexOf(r.id) >= 0; }).map(function (r) {
      var asc = 0, desc = 0, sad = 0;
      r.legs.forEach(function (l) { asc += l.ascent || 0; desc += l.descent || 0; sad += (l.saddles || []).length; });
      return {
        name: r.name, wps: r.wps, pts: routePts(r), dist: r.dist, time: r.time,
        legDist: r.legs.map(function (l) { return l.dist; }), legTime: r.legs.map(legTime),
        ascent: asc, descent: desc, saddles: sad
      };
    });
  }

  // เพิ่มเส้นทางจากรายการ [{name, pts:[[lng,lat],...]}] คืนจำนวนที่เพิ่ม
  function addRoutes(list) {
    var n = 0;
    list.forEach(function (it, idx) {
      if (!it.pts || it.pts.length < 2) return;
      var tol = 8, s = R.dpSimplify(it.pts, tol);
      while (s.length > 150) { tol *= 1.6; s = R.dpSimplify(it.pts, tol); }
      var wps = s.map(function (p) { return { lat: p[1], lng: p[0] }; });
      var legs = [], d = 0, t = 0;
      for (var i = 0; i < s.length - 1; i++) {
        var seg = [s[i], s[i + 1]];
        var l = { mode: 'free', pts: seg, dist: R.polyLength(seg), time: 0 };
        legs.push(l); d += l.dist; t += legTime(l);
      }
      routes.push({ id: String(Date.now()) + '-' + idx, name: it.name || 'นำเข้า', wps: wps, legs: legs, dist: d, time: t, show: true, proj: TrailProj.active() });
      n++;
    });
    if (n) { saveRoutes(); drawRoutes(); }
    return n;
  }

  /* ---------- แผงรายการเส้นทาง ---------- */
  function renderSheet(body) {
    var h = '<div class="btnrow"><button class="btn" id="rnew">สร้างเส้นทางใหม่</button></div>';
    if (!routes.length) h += '<p class="note">ยังไม่มีเส้นทาง กด "สร้างเส้นทางใหม่" แล้วแตะแผนที่เพื่อปักจุด หรือพิมพ์พิกัดเข้าไป</p>';
    routes.forEach(function (r) {
      var saddles = 0, trail = 0, trailN = 0;
      r.legs.forEach(function (l) { saddles += (l.saddles || []).length; if (l.mode === 'auto') { trail += l.trailPct * l.dist; trailN += l.dist; } });
      h += '<div class="prow" data-id="' + r.id + '"><label class="opt"><input type="checkbox" class="rsel"><span class="rname"></span></label>' +
        '<div class="note rsub"></div>' +
        '<div class="btnrow"><button class="btn rgo">นำทาง</button><button class="btn alt rsim">จำลอง</button><button class="btn alt rzoom">ดู</button><button class="btn alt rshow"></button><button class="btn alt rren">ชื่อ</button><button class="btn alt rdel">ลบ</button></div></div>';
    });
    if (routes.length) {
      h += '<h4>ส่งออกเส้นทางที่ติ๊กเลือก</h4>' +
        '<div class="btnrow"><button class="btn alt" id="xall">เลือกทั้งหมด</button><button class="btn alt" id="xnone">ไม่เลือก</button></div>';
      Object.keys(TrailExport.FORMATS).forEach(function (k, i) {
        h += '<label class="opt"><input type="radio" name="xfmt" value="' + k + '"' + (i === 0 ? ' checked' : '') + '><span>' + TrailExport.FORMATS[k].label + '</span></label>';
      });
      h += '<div class="btnrow"><button class="btn" id="xbuild">สร้างไฟล์</button></div><div id="xres" class="note"></div>';
    }
    h += '<h4>นำเข้าเส้นทาง</h4><div class="btnrow"><button class="btn alt" id="ximp">นำเข้าไฟล์ GPX / KML / KMZ / GeoJSON</button></div>' +
      '<input type="file" id="ximpf" accept=".gpx,.kml,.kmz,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/zip,application/json" multiple hidden>' +
      '<div id="ximsg" class="note"></div>';
    h += '<h4>ตั้งค่า</h4>' +
      '<div class="field"><label>ความเร็วเดินตามแผน (กม./ชม.)</label><input type="number" id="npace" step="0.5" value="' + np.pace + '"></div>' +
      '<div class="field"><label>ออกนอกเส้นเกิน (ม.)</label><input type="number" id="ntol" step="5" value="' + np.tol + '"></div>' +
      '<label class="opt"><input type="checkbox" id="nvoice"' + (np.voice ? ' checked' : '') + '><span>เสียงเตือนภาษาไทย<small>เมื่อออกนอกเส้นทางหรือถึงจุดปัก (ใช้เสียงของเครื่อง)</small></span></label>' +
      '<p class="note">โหมดอัตโนมัติหาทางจากทางเดินเท้า/ถนนในแผนที่ และใช้ข้อมูลความสูงเลือกทางที่ชันน้อย (ข้ามผ่านคอเขา เลียบร่องเขา) ทำงานออฟไลน์ได้เมื่อดาวน์โหลดพื้นที่นั้นไว้แล้ว ' +
      'แต่ไม่รู้เรื่องแม่น้ำลึก รั้ว หรือป่ารก ให้ใช้เป็นแนวทางและตรวจกับสภาพจริงเสมอ</p>';
    body.innerHTML = h;
    $('rnew').onclick = startEdit;
    Array.prototype.forEach.call(body.querySelectorAll('.prow'), function (row) {
      var id = row.getAttribute('data-id');
      var r = routes.filter(function (x) { return x.id === id; })[0];
      row.querySelector('.rname').textContent = r.name;
      var sub = fmtDist(r.dist) + ' · ~' + fmtDur(r.time) + ' · ' + r.wps.length + ' จุด' + ' · งาน: ' + TrailProj.nameOf(r.proj);
      var auto = r.legs.filter(function (l) { return l.mode === 'auto'; });
      if (auto.length) {
        var tl = 0, td = 0, asc = 0, sad = 0;
        auto.forEach(function (l) { tl += l.trailPct * l.dist; td += l.dist; asc += l.ascent; sad += (l.saddles || []).length; });
        sub += ' · อัตโนมัติ ใช้ทางเท้า/ถนน ' + Math.round(tl / td) + '% · ขึ้น ' + asc + ' ม.' + (sad ? ' · ข้ามคอเขา ' + sad + ' จุด (▲)' : '');
      }
      row.querySelector('.rsub').textContent = sub;
      var sh = row.querySelector('.rshow');
      sh.textContent = r.show ? 'ซ่อน' : 'แสดง';
      sh.onclick = function () { r.show = !r.show; saveRoutes(); drawRoutes(); sh.textContent = r.show ? 'ซ่อน' : 'แสดง'; };
      row.querySelector('.rzoom').onclick = function () { r.show = true; TrailProj.reveal(r.proj); saveRoutes(); drawRoutes(); ctx.closeSheet(); ctx.map().fitBounds(boundsOf(routePts(r)), { padding: 60, duration: 700 }); };
      row.querySelector('.rgo').onclick = function () { startNav(id, false); };
      row.querySelector('.rsim').onclick = function () { startNav(id, true); };
      row.querySelector('.rren').onclick = function () {
        var nn = prompt('ชื่อเส้นทาง', r.name);
        if (nn === null || !nn.trim()) return;
        r.name = nn.trim();
        saveRoutes(); renderSheet(body);
      };
      row.querySelector('.rdel').onclick = function () {
        if (!confirm('ลบเส้นทางนี้?\n' + r.name)) return;
        routes = routes.filter(function (x) { return x.id !== id; });
        saveRoutes(); drawRoutes(); renderSheet(body);
      };
    });
    if (routes.length) {
      var setAll = function (v) { Array.prototype.forEach.call(body.querySelectorAll('.rsel'), function (c) { c.checked = v; }); };
      $('xall').onclick = function () { setAll(true); };
      $('xnone').onclick = function () { setAll(false); };
      $('xbuild').onclick = function () {
        var ids = [];
        Array.prototype.forEach.call(body.querySelectorAll('.prow'), function (row) { if (row.querySelector('.rsel').checked) ids.push(row.getAttribute('data-id')); });
        if (!ids.length) { ctx.toast('ติ๊กเลือกเส้นทางที่จะส่งออกก่อน'); return; }
        var fmt = body.querySelector('input[name=xfmt]:checked').value;
        var res = $('xres'), btn = $('xbuild');
        btn.disabled = true;
        res.textContent = 'กำลังสร้างไฟล์…';
        TrailExport.build(exportModels(ids), fmt, { fmtPoint: ctx.fmtPoint }, function (t) { res.textContent = t; }).then(function (file) {
          btn.disabled = false;
          res.innerHTML = '<b></b> · ' + Math.round(file.text.length / 1024 * 10) / 10 + ' KB' +
            '<div class="btnrow"><button class="btn" id="xshare">แชร์ / ส่งไปแอพอื่น</button><button class="btn alt" id="xdl">ดาวน์โหลดไฟล์</button></div>';
          res.querySelector('b').textContent = file.name;
          $('xshare').onclick = function () {
            TrailExport.share(file).then(function (ok) { if (!ok) { TrailExport.download(file); ctx.toast('เครื่องนี้แชร์ไฟล์ตรงไม่ได้ ดาวน์โหลดแทน (ดูในแอพไฟล์)'); } });
          };
          $('xdl').onclick = function () { TrailExport.download(file); };
        }).catch(function (e) {
          btn.disabled = false;
          res.textContent = 'สร้างไฟล์ไม่สำเร็จ: ' + (e && e.message ? e.message : e);
        });
      };
    }
    $('ximp').onclick = function () { $('ximpf').click(); };
    $('ximpf').onchange = function () {
      var files = Array.prototype.slice.call(this.files || []);
      var inp = this;
      var msg = $('ximsg');
      var added = 0, pinsAdded = 0, errs = [];
      Promise.all(files.map(function (f) {
        return TrailExport.readFile(f).then(function (t) {
          added += addRoutes(TrailExport.parseFile(t, f.name));
          // จุดสถานที่ (Placemark) จาก KML/KMZ นำเข้าเป็นหมุด (สูงสุด 300 จุดต่อไฟล์)
          TrailExport.parsePoints(t).slice(0, 300).forEach(function (pt) { TrailProj.addPin(pt.name, pt.lat, pt.lng); pinsAdded++; });
        }).catch(function (e) { errs.push(f.name + ': ' + (e && e.message ? e.message : 'อ่านไม่ได้')); });
      })).then(function () {
        inp.value = '';
        renderSheet(body);
        $('ximsg').textContent = 'นำเข้า ' + added + ' เส้นทาง' + (pinsAdded ? ' · ' + pinsAdded + ' หมุด' : '') + (!added && !pinsAdded && !errs.length ? ' (ไม่พบเส้นทางหรือจุดในไฟล์นี้)' : '') + (errs.length ? ' · ผิดพลาด ' + errs.join('; ') : '');
      });
    };
    $('npace').onchange = function () { var v = parseFloat(this.value); np.pace = v > 0 ? v : 4; savePrefs(); };
    $('ntol').onchange = function () { var v = parseFloat(this.value); np.tol = v > 0 ? v : 30; savePrefs(); };
    $('nvoice').onchange = function () { np.voice = this.checked; savePrefs(); if (np.voice) speak('เปิดเสียงเตือนแล้ว'); };
  }

  root.TrailNav = {
    init: init,
    handleClick: handleClick,
    renderSheet: renderSheet,
    isBusy: function () { return !!edit; },
    items: function () { return routes; },
    points: routePts,
    commit: function () { saveRoutes(); drawRoutes(); },
    removeRoute: function (id) { routes = routes.filter(function (x) { return x.id !== id; }); saveRoutes(); drawRoutes(); },
    zoomRoute: function (r) { ctx.closeSheet(); ctx.map().fitBounds(boundsOf(routePts(r)), { padding: 60, duration: 700 }); },
    addRaw: function (list) { list.forEach(function (r) { routes.push(r); }); saveRoutes(); drawRoutes(); },
    visibleRoutes: function () { return routes.filter(function (r) { return TrailProj.isVisible(r); }).map(function (r) { return { name: r.name, pts: routePts(r) }; }); }
  };
})(typeof self !== 'undefined' ? self : this);
