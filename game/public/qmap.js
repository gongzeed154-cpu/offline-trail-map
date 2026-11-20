// แผนที่ที่ใช้ร่วมกันระหว่างหน้านักเรียนและหน้าจอครู: ป้ายสถานที่เปิด/ปิด, ภูมิประเทศ (สีตามความสูง+เงา),
// เส้นกริดพิกัด (ลิปดา) พร้อมป้าย, ล็อกกรอบพื้นที่, หมุด A/B
(function (root) {
  var STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  var DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var TH = [[97.2, 5.3], [105.8, 20.8]];
  var EMPTY = { type: 'FeatureCollection', features: [] };

  // ---------- พิกัด องศา ลิปดา ฟิลิปดา ----------
  function dms(v) {
    v = Math.abs(v);
    var d = Math.floor(v), mm = (v - d) * 60, m = Math.floor(mm), s = Math.round((mm - m) * 60);
    if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; d++; }
    return [d, m, s];
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDMS(v, isLat) { var a = dms(v); return a[0] + '°' + p2(a[1]) + '′' + p2(a[2]) + '″' + (isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')); }
  function fmtLL(lat, lng) { return fmtDMS(lat, true) + '  ' + fmtDMS(lng, false); }
  function fmtDec(lat, lng) { return Math.abs(lat).toFixed(4) + '°' + (lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(lng).toFixed(4) + '°' + (lng >= 0 ? 'E' : 'W'); }
  var POINTS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
  function pointName(ang) { return POINTS[Math.round((((ang % 360) + 360) % 360) / 45) % 8]; }

  function gridData(frame, stepMin) {
    var w = frame[0], s = frame[1], e = frame[2], n = frame[3], st = stepMin / 60, f = [];
    var padX = (e - w) * 0.6, padY = (n - s) * 0.6;
    function lab(v, isLat) { var a = dms(v); return a[0] + '°' + p2(a[1]) + '′' + (stepMin < 1 ? p2(a[2]) + '″' : '') + (isLat ? 'N' : 'E'); }
    for (var la = Math.floor((s - padY) / st) * st; la <= n + padY; la += st)
      f.push({ type: 'Feature', properties: { label: lab(la + 1e-9, true) }, geometry: { type: 'LineString', coordinates: [[w - padX, la], [e + padX, la]] } });
    for (var lo = Math.floor((w - padX) / st) * st; lo <= e + padX; lo += st)
      f.push({ type: 'Feature', properties: { label: lab(lo + 1e-9, false) }, geometry: { type: 'LineString', coordinates: [[lo, s - padY], [lo, n + padY]] } });
    return { type: 'FeatureCollection', features: f };
  }

  // เส้นกริด UTM แบบแผนที่กระดาษ (ทุก stepM เมตร) ป้ายเป็นเลข กม. 2 หลัก เช่น 62 = E 662 กม.  (ใช้โค้ดพิกัดเดียวกับแอปฝึกแผนที่)
  function utmGridData(frame, stepM) {
    var G = root.TrailGeo, Z = 47;
    var cs = [[frame[0], frame[1]], [frame[2], frame[1]], [frame[2], frame[3]], [frame[0], frame[3]]].map(function (p) { return G.toUTM(p[1], p[0], Z); });
    var es = cs.map(function (c) { return c.e; }), ns = cs.map(function (c) { return c.n; });
    var minE = Math.min.apply(null, es), maxE = Math.max.apply(null, es), minN = Math.min.apply(null, ns), maxN = Math.max.apply(null, ns);
    var padE = (maxE - minE) * 0.6, padN = (maxN - minN) * 0.6, f = [];
    function pt(e, n) { var p = G.fromUTM(Z, true, e, n); return [p.lng, p.lat]; }
    function lab(v) { return stepM < 1000 ? String(Math.floor(v / 100) % 1000).padStart(3, '0') : p2(Math.floor(v / 1000) % 100); }
    for (var e = Math.floor((minE - padE) / stepM) * stepM; e <= maxE + padE; e += stepM)
      f.push({ type: 'Feature', properties: { label: lab(e) }, geometry: { type: 'LineString', coordinates: [pt(e, minN - padN), pt(e, (minN + maxN) / 2), pt(e, maxN + padN)] } });
    for (var n = Math.floor((minN - padN) / stepM) * stepM; n <= maxN + padN; n += stepM)
      f.push({ type: 'Feature', properties: { label: lab(n) }, geometry: { type: 'LineString', coordinates: [pt(minE - padE, n), pt((minE + maxE) / 2, n), pt(maxE + padE, n)] } });
    return { type: 'FeatureCollection', features: f };
  }
  function mgrs6(lat, lng, digits) { var G = root.TrailGeo, u = G.toUTM(lat, lng, 47); return G.mgrsFromUTM(u, lat, digits || 3); } // เช่น 47PPR 623 213

  function pinEl(color, star) {
    var d = document.createElement('div'); d.className = 'pin';
    d.innerHTML = '<svg viewBox="0 0 30 40" width="30" height="40"><path d="M15 39C15 39 2 24 2 14a13 13 0 0 1 26 0c0 10-13 25-13 25z" fill="' + color + '" stroke="#fff" stroke-width="2"/>' +
      (star ? '<path d="M15 6l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z" fill="#fff"/>' : '<circle cx="15" cy="14" r="5" fill="#fff"/>') + '</svg>';
    return d;
  }
  function badgeEl(label, name, color) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:4px;transform:translateY(-4px)';
    d.innerHTML = '<div style="width:30px;height:30px;border-radius:15px;background:' + color + ';color:#fff;font:800 16px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)">' + label + '</div>' +
      (name ? '<div style="background:rgba(255,255,255,.92);border-radius:8px;padding:1px 7px;font:600 13px sans-serif;color:#222;white-space:nowrap">' + name + '</div>' : '');
    return d;
  }

  function create(opts) {
    var pad = opts.pad || { top: 20, bottom: 20, left: 20, right: 20 };
    var map;
    try {
      map = new maplibregl.Map({
        container: opts.container, style: STYLE, bounds: TH, fitBoundsOptions: { padding: pad },
        maxZoom: opts.maxZoom || 14, minZoom: 3.5, dragRotate: false, pitchWithRotate: false,
        attributionControl: { compact: true }
      });
    } catch (err) { // ส่วนมากคือเบราว์เซอร์ไม่รองรับ WebGL — แสดงข้อความ ไม่ให้ทั้งหน้าพัง
      var box0 = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
      if (box0) box0.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;background:#fff;color:#222;font:600 17px sans-serif;padding:20px">⚠️ แผนที่แสดงไม่ได้<br>เบราว์เซอร์นี้ไม่รองรับ WebGL<br><small style="font-weight:400">ใช้ Chrome/Edge ล่าสุด เปิดการเร่งด้วยฮาร์ดแวร์ แล้วเปิดหน้า /check เพื่อตรวจ</small></div>';
      var noop = function () { return noopMap; };
      var noopMap = new Proxy(function () {}, { get: function (t, k) { return k === 'then' ? undefined : noop; }, apply: function () { return noopMap; } });
      return { map: noopMap, ready: false, pad: pad, whenReady: function () {}, setLabels: function () {}, clearMarkers: function () {}, setAux: function () {}, unlock: function () {}, fitTH: function () {},
        fitPoints: function () {}, setQuestion: function () {}, reset: function () {}, pinEl: pinEl, markers: [] };
    }
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.on('error', function (e) { console.warn('map error:', e && e.error && e.error.message); });
    if (root.ResizeObserver) new ResizeObserver(function () { map.resize(); }).observe(map.getContainer());
    function clampPad(p) { // กันพื้นที่ว่างรอบแผนที่กว้างเกินจอเล็ก
      var c = map.getContainer(), w = c.clientWidth || 300, h = c.clientHeight || 300;
      var f = Math.min(1, (w * 0.6) / Math.max(1, p.left + p.right), (h * 0.7) / Math.max(1, p.top + p.bottom));
      return { top: p.top * f, bottom: p.bottom * f, left: p.left * f, right: p.right * f };
    }
    var m = { map: map, pad: pad, ready: false, symbolIds: [], wantLabels: true, cbs: [], markers: [], pinEl: pinEl };

    // กันพลาด: แผนที่บางเครื่อง/เบราว์เซอร์ไม่วาดเฟรมแรก -> สั่งวาดซ้ำ ถ้ายังไม่ขึ้นแสดงข้อความ + ปุ่มลองใหม่ (ไม่ปล่อยให้จอว่างเฉยๆ)
    var warnBox = null;
    // หน้าต่างที่เพิ่งถูกนำมาไว้ด้านหน้า (เช่น แท็บที่เปิดอยู่เบื้องหลัง) -> วาดทันที
    function wake() { if (!m.ready) { try { map.resize(); map.triggerRepaint(); } catch (e) {} } }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
    window.addEventListener('focus', wake);
    var kicker = setInterval(function () { if (m.ready) clearInterval(kicker); else { try { map.resize(); map.triggerRepaint(); } catch (e) {} } }, 3000); // บางเครื่องไม่วาดเฟรมแรก
    setTimeout(function () {
      if (m.ready || warnBox) return;
      warnBox = document.createElement('div');
      warnBox.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;background:rgba(0,0,0,.85);color:#fff;padding:14px 18px;border-radius:14px;font:600 16px sans-serif;text-align:center;max-width:80%';
      warnBox.innerHTML = '⚠️ แผนที่โหลดไม่ขึ้น<br><small style="font-weight:400">ตรวจอินเทอร์เน็ต (ต้องเข้า tiles.openfreemap.org ได้) · ใช้ Chrome/Edge · ไม่ย่อหน้าต่าง<br>ดูรายละเอียดที่หน้า <b>/check</b></small><br><button style="margin-top:10px;padding:6px 18px;border-radius:16px;border:0;font:700 15px sans-serif">ลองใหม่</button>';
      warnBox.querySelector('button').onclick = function () { location.reload(); };
      map.getContainer().appendChild(warnBox);
    }, 15000);
    map.on('load', function () {
      if (warnBox) { warnBox.remove(); warnBox = null; }
      try {
      m.symbolIds = map.getStyle().layers.filter(function (l) { return l.type === 'symbol'; }).map(function (l) { return l.id; });
      var firstSym = m.symbolIds[0];
      map.addSource('dem', { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
      map.addLayer({ id: 'relief', type: 'color-relief', source: 'dem', layout: { visibility: 'none' }, paint: {
        'color-relief-opacity': 0.85,
        'color-relief-color': ['interpolate', ['linear'], ['elevation'],
          0, '#9fd3a0', 150, '#bfe0a0', 400, '#e6eb9f', 800, '#e8cf86', 1200, '#d49f66', 1700, '#b0703f', 2200, '#8d5a3d', 2600, '#f4f0ea'] } }, firstSym);
      map.addLayer({ id: 'hill', type: 'hillshade', source: 'dem', layout: { visibility: 'none' }, paint: {
        'hillshade-exaggeration': 0.7, 'hillshade-shadow-color': '#2a2a20', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#4a4a38' } }, firstSym);
      if (root.mlcontour) {
        m.dem = new root.mlcontour.DemSource({ url: DEM, encoding: 'terrarium', maxzoom: 12, worker: true, cacheSize: 100, timeoutMs: 15000 });
        m.dem.setupMaplibre(root.maplibregl);
        map.addSource('contours', { type: 'vector', minzoom: 9, maxzoom: 15, tiles: [m.dem.contourProtocolUrl({
          thresholds: { 9: [200, 1000], 10: [100, 500], 11: [50, 250], 12: [20, 100], 13: [10, 50] }, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1 })] });
        map.addLayer({ id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', layout: { visibility: 'none', 'line-join': 'round' },
          paint: { 'line-color': '#8a4b1c', 'line-opacity': 0.9, 'line-width': ['match', ['get', 'level'], 1, 1.7, 0.7] } }, firstSym);
        map.addLayer({ id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0],
          layout: { visibility: 'none', 'symbol-placement': 'line', 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-field': ['number-format', ['get', 'ele'], {}], 'symbol-spacing': 300 },
          paint: { 'text-color': '#5b2e0c', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.5 } });
      }
      map.addSource('grid', { type: 'geojson', data: EMPTY });
      map.addSource('frame', { type: 'geojson', data: EMPTY });
      map.addSource('aux', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'grid-line', type: 'line', source: 'grid', paint: { 'line-color': '#1a1a1a', 'line-opacity': 0.6, 'line-width': 1 } });
      map.addLayer({ id: 'grid-lbl', type: 'symbol', source: 'grid', layout: {
        'symbol-placement': 'line', 'symbol-spacing': 200, 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-keep-upright': false, 'text-allow-overlap': true },
        paint: { 'text-color': '#111', 'text-halo-color': 'rgba(255,255,255,.95)', 'text-halo-width': 2 } });
      map.addLayer({ id: 'frame-line', type: 'line', source: 'frame', paint: { 'line-color': '#d93025', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'aux-line', type: 'line', source: 'aux', paint: { 'line-color': '#d93025', 'line-width': 3, 'line-dasharray': [2, 1.5] } });
      m.ready = true; root.__qm = m; m.setLabels(m.wantLabels);
      m.cbs.splice(0).forEach(function (f) { f(); });
      } catch (err) { console.error('QMap load error:', err && err.message); }
    });

    m.whenReady = function (f) { if (m.ready) f(); else m.cbs.push(f); };
    m.setLabels = function (on) {
      m.wantLabels = on;
      if (!m.ready) return;
      m.symbolIds.forEach(function (id) { map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); });
      map.setLayoutProperty('grid-lbl', 'visibility', 'visible'); // ป้ายกริดต้องเห็นเสมอ
    };
    m.clearMarkers = function () { m.markers.forEach(function (x) { x.remove(); }); m.markers = []; };
    m.setAux = function (coords) { m.whenReady(function () { map.getSource('aux').setData(coords ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } : EMPTY); }); };
    m.unlock = function () { map.setMaxBounds(null); map.setMinZoom(3.5); };
    m.fitTH = function (anim) { m.unlock(); map.fitBounds(TH, { padding: clampPad(m.pad), duration: anim ? 600 : 0 }); };
    m.fitPoints = function (pts, o) {
      o = o || {}; var b = new maplibregl.LngLatBounds(); pts.forEach(function (p) { b.extend(p); });
      map.fitBounds(b, { padding: clampPad(o.pad || m.pad), maxZoom: o.maxZoom || 9, duration: o.duration == null ? 800 : o.duration });
    };

    // ตั้งค่าแผนที่ตามโจทย์ (q = ข้อมูลโจทย์สาธารณะจากเซิร์ฟเวอร์)
    m.setQuestion = function (q) {
      m.whenReady(function () {
        m.clearMarkers(); m.setAux(null);
        m.setLabels(!!q.labels);
        map.setLayoutProperty('relief', 'visibility', q.terrain ? 'visible' : 'none');
        map.setLayoutProperty('hill', 'visibility', q.terrain ? 'visible' : 'none');
        ['contour-lines', 'contour-labels'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', (q.terrain || q.contours) ? 'visible' : 'none'); });
        var f = q.frame;
        map.getSource('grid').setData(f && q.grid ? (q.gridType === 'utm' ? utmGridData(f, q.grid) : gridData(f, q.grid)) : EMPTY);
        map.getSource('frame').setData(f ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]], [f[0], f[1]]] } } : EMPTY);
        (q.markers || []).forEach(function (mk) {
          var el = mk.label ? badgeEl(mk.label, mk.name, mk.label === 'A' ? '#1565c0' : '#c62828') : pinEl('#6a1b9a');
          m.markers.push(new maplibregl.Marker({ element: el, anchor: mk.label ? 'left' : 'bottom' }).setLngLat([mk.lng, mk.lat]).addTo(map));
        });
        if (f) { // ล็อกกรอบ: เลื่อนได้เล็กน้อยรอบกรอบ ซูมออกไม่ได้มาก
          m.unlock();
          var b = [[f[0], f[1]], [f[2], f[3]]];
          var cam = map.cameraForBounds(b, { padding: clampPad(m.pad) });
          map.jumpTo({ center: cam.center, zoom: cam.zoom });
          var dx = (f[2] - f[0]) * 0.35, dy = (f[3] - f[1]) * 0.35;
          map.setMaxBounds([[f[0] - dx, f[1] - dy], [f[2] + dx, f[3] + dy]]);
          map.setMinZoom(Math.max(3.5, cam.zoom - 0.8));
        } else if (q.markers && q.markers.length > 1) {
          m.unlock(); m.fitPoints(q.markers.map(function (x) { return [x.lng, x.lat]; }), { maxZoom: 12, duration: 0 });
        } else m.fitTH(true);
      });
    };
    m.reset = function () { m.whenReady(function () {
      m.clearMarkers(); m.setAux(null); m.setLabels(true);
      ['relief', 'hill', 'contour-lines', 'contour-labels'].forEach(function (l) { if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', 'none'); });
      map.getSource('grid').setData(EMPTY); map.getSource('frame').setData(EMPTY); m.fitTH(false);
    }); };
    return m;
  }

  root.QMap = { mgrs6: mgrs6, create: create, fmtDMS: fmtDMS, fmtLL: fmtLL, fmtDec: fmtDec, dms: dms, pointName: pointName, pinEl: pinEl, TH: TH };
})(window);
