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
    function lab(v, isLat) { var a = dms(v); return a[0] + '°' + p2(a[1]) + '′' + (isLat ? 'N' : 'E'); }
    for (var la = Math.floor((s - padY) / st) * st; la <= n + padY; la += st)
      f.push({ type: 'Feature', properties: { label: lab(la + 1e-9, true) }, geometry: { type: 'LineString', coordinates: [[w - padX, la], [e + padX, la]] } });
    for (var lo = Math.floor((w - padX) / st) * st; lo <= e + padX; lo += st)
      f.push({ type: 'Feature', properties: { label: lab(lo + 1e-9, false) }, geometry: { type: 'LineString', coordinates: [[lo, s - padY], [lo, n + padY]] } });
    return { type: 'FeatureCollection', features: f };
  }

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
    var map = new maplibregl.Map({
      container: opts.container, style: STYLE, bounds: TH, fitBoundsOptions: { padding: pad },
      maxZoom: opts.maxZoom || 14, minZoom: 3.5, dragRotate: false, pitchWithRotate: false,
      attributionControl: { compact: true }
    });
    if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
    map.on('error', function (e) { console.warn('map error:', e && e.error && e.error.message); });
    if (root.ResizeObserver) new ResizeObserver(function () { map.resize(); }).observe(map.getContainer());
    function clampPad(p) { // กันพื้นที่ว่างรอบแผนที่กว้างเกินจอเล็ก
      var c = map.getContainer(), w = c.clientWidth || 300, h = c.clientHeight || 300;
      var f = Math.min(1, (w * 0.6) / Math.max(1, p.left + p.right), (h * 0.7) / Math.max(1, p.top + p.bottom));
      return { top: p.top * f, bottom: p.bottom * f, left: p.left * f, right: p.right * f };
    }
    var m = { map: map, pad: pad, ready: false, symbolIds: [], wantLabels: true, cbs: [], markers: [], pinEl: pinEl };

    map.on('load', function () {
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
        var f = q.frame;
        map.getSource('grid').setData(f && q.grid ? gridData(f, q.grid) : EMPTY);
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
      ['relief', 'hill'].forEach(function (l) { map.setLayoutProperty(l, 'visibility', 'none'); });
      map.getSource('grid').setData(EMPTY); map.getSource('frame').setData(EMPTY); m.fitTH(false);
    }); };
    return m;
  }

  root.QMap = { create: create, fmtDMS: fmtDMS, fmtLL: fmtLL, fmtDec: fmtDec, dms: dms, pointName: pointName, pinEl: pinEl, TH: TH };
})(window);
