/* แผนที่เดินป่าออฟไลน์ (เว็บแอพ) */
(function () {
  var C = TrailCommon;
  var G = TrailGeo;
  var AREAS_KEY = 'trail_areas_v1';
  var TPL_KEY = 'trail_ofm_tpl';
  var PREFS_KEY = 'trail_prefs_v2';
  var TILE_CACHE = 'tiles-v1';
  var AREA_CACHE = 'areas-v1';
  var MAX_TILES = 9000; // จำกัดขนาดพื้นที่ต่อครั้ง
  var CONCURRENCY = 8;
  var MAX_ZOOM = 20;

  var BASE_NAMES = { trail: 'เดินป่า', sat: 'ดาวเทียม', topo: 'ภูมิประเทศ' };
  var NON_TRAIL = { background: 1, sat: 1, topo: 1, traffic: 1 };

  var map = null;
  var geolocate = null;
  var vectorTpl = null;
  var downloading = false;
  var trailLayerIds = [];

  var prefs = {
    base: 'trail', // trail | sat | topo
    weather: 'off', // off | radar
    traffic: false,
    grid: false,
    fmt: 'dms', // mgrs | utm | dms | dm | dd
    anchor: 'center', // จุดของแผ่นวัดมุมที่ตรงกับหมุด A: center | romer | sixty
    decl: 0 // มุมเบี่ยงเบนแม่เหล็ก (องศา, ตะวันออกเป็นบวก)
  };

  function $(id) { return document.getElementById(id); }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      for (var k in prefs) if (p[k] !== undefined) prefs[k] = p[k];
    } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ไม่เป็นไร */ }
  }

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
    var style = C.buildStyle(tpl);
    trailLayerIds = style.layers.map(function (l) { return l.id; }).filter(function (id) { return !NON_TRAIL[id]; });

    map = new maplibregl.Map({
      container: 'map',
      style: style,
      center: [100.9925, 15.87],
      zoom: 5,
      minZoom: 3,
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true }
    });

    geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 20000 },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true
    });
    map.addControl(geolocate, 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: false }), 'bottom-right');
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

    map.on('load', onMapLoad);
    map.on('move', onMove);
    map.on('click', onMapClick);
  }

  function onMapLoad() {
    var empty = { type: 'FeatureCollection', features: [] };
    map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } });

    map.addSource('grid', { type: 'geojson', data: empty });
    map.addSource('grid-labels', { type: 'geojson', data: empty });
    map.addSource('az', { type: 'geojson', data: empty });
    map.addLayer({
      id: 'grid-lines', type: 'line', source: 'grid',
      paint: {
        'line-color': '#d62020',
        'line-opacity': 0.8,
        'line-width': ['case', ['get', 'major'], 1.6, 0.8]
      }
    });
    map.addLayer({
      id: 'grid-squares', type: 'symbol', source: 'grid-labels',
      filter: ['==', ['get', 'k'], 'sq'],
      layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 34, 'text-allow-overlap': true },
      paint: { 'text-color': 'rgba(170,0,0,0.35)' }
    });
    map.addLayer({
      id: 'grid-labels', type: 'symbol', source: 'grid-labels',
      filter: ['==', ['get', 'k'], 'l'],
      layout: {
        'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 11,
        'text-anchor': ['get', 'a'], 'text-padding': 2
      },
      paint: { 'text-color': '#a00000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 }
    });
    map.addLayer({
      id: 'az-line', type: 'line', source: 'az',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#c4501b', 'line-width': 3, 'line-dasharray': [2, 1.5] }
    });
    try {
      map.addSource('plate', { type: 'image', url: TrailPlate.draw(2400).toDataURL('image/png'), coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]] });
      map.addLayer({
        id: 'plate', type: 'raster', source: 'plate', layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' }
      }, 'az-line');
    } catch (e) { /* ไม่มีแผ่นวัดมุม */ }
    TrailPaper.init({ map: function () { return map; }, toast: toast, closeSheet: closeSheet });
    TrailPaper.loadAll();

    applyBase();
    applyTraffic();
    applyWeather();
    updateGrid();
    updateCoord();
    refreshProt();
  }

  /* ---------- ชั้นแผนที่ ---------- */
  function applyBase() {
    if (!map || !map.getLayer('sat')) return;
    var trail = prefs.base === 'trail';
    trailLayerIds.forEach(function (id) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', trail ? 'visible' : 'none');
    });
    map.setLayoutProperty('sat', 'visibility', prefs.base === 'sat' ? 'visible' : 'none');
    map.setLayoutProperty('topo', 'visibility', prefs.base === 'topo' ? 'visible' : 'none');
  }

  function applyTraffic() {
    if (!map || !map.getLayer('traffic')) return;
    map.setLayoutProperty('traffic', 'visibility', prefs.traffic ? 'visible' : 'none');
  }

  var weatherTimer = null;
  async function applyWeather() {
    if (!map) return;
    clearTimeout(weatherTimer);
    if (map.getLayer('weather')) map.removeLayer('weather');
    if (map.getSource('weather')) map.removeSource('weather');
    if (prefs.weather === 'off') return;
    try {
      var res = await withTimeout(fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' }), 8000);
      var json = await res.json();
      var past = json.radar && json.radar.past;
      if (!past || !past.length) throw new Error('no data');
      var latest = past[past.length - 1];
      if (prefs.weather === 'off' || map.getSource('weather')) return; // ผู้ใช้เปลี่ยนใจระหว่างรอ
      map.addSource('weather', {
        type: 'raster',
        tiles: [json.host + latest.path + '/256/{z}/{x}/{y}/2/1_1.png'],
        tileSize: 256,
        maxzoom: 7,
        attribution: 'เรดาร์ฝน <a href="https://www.rainviewer.com" target="_blank">RainViewer</a>'
      });
      map.addLayer({ id: 'weather', type: 'raster', source: 'weather', paint: { 'raster-opacity': 0.7 } }, 'grid-lines');
      var when = new Date(latest.time * 1000);
      toast('เรดาร์ฝนล่าสุด ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) + ' น.');
      weatherTimer = setTimeout(applyWeather, 5 * 60 * 1000);
    } catch (e) {
      toast('โหลดข้อมูลสภาพอากาศไม่ได้ (ต้องมีอินเทอร์เน็ต)');
    }
  }

  /* ---------- พิกัดกลางจอ / หมุดที่แตะ ---------- */
  var pinMarker = null;
  var pinPos = null;

  function updateCoord() {
    if (!map) return;
    var c = map.getCenter();
    var el = $('coord');
    var html = '<small></small><span></span>';
    el.innerHTML = html;
    el.querySelector('small').textContent = 'กลางจอ · ' + G.FORMAT_NAMES[prefs.fmt] + ' · ซูม ' + map.getZoom().toFixed(1);
    var txt = G.formatPoint(c.lat, c.lng, prefs.fmt);
    if (pinPos) {
      txt += '\n📍 ' + G.formatPoint(pinPos.lat, pinPos.lng, prefs.fmt);
      el.querySelector('span').style.whiteSpace = 'pre-line';
    }
    el.querySelector('span').textContent = txt;
  }

  function onMove() {
    updateCoord();
    scheduleGrid();
    refreshProt();
  }

  function onMapClick(e) {
    if (prot.on) { protTap(e.lngLat); return; }
    if (pinMarker) {
      pinMarker.remove();
      pinMarker = null;
      pinPos = null;
    } else {
      var el = document.createElement('div');
      el.className = 'pin';
      pinMarker = new maplibregl.Marker({ element: el }).setLngLat(e.lngLat).addTo(map);
      pinPos = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    }
    updateCoord();
  }

  /* ---------- ตารางกริด ---------- */
  var gridTimer = null;
  function scheduleGrid() {
    if (!prefs.grid || gridTimer) return;
    gridTimer = setTimeout(function () { gridTimer = null; updateGrid(); }, 90);
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function lineFeature(coords, major) {
    return { type: 'Feature', properties: { major: !!major }, geometry: { type: 'LineString', coordinates: coords } };
  }
  function labelFeature(lng, lat, text, anchor, kind) {
    return { type: 'Feature', properties: { t: text, a: anchor, k: kind || 'l' }, geometry: { type: 'Point', coordinates: [lng, lat] } };
  }

  function updateGrid() {
    if (!map || !map.getSource('grid')) return;
    var lines = emptyFC();
    var labels = emptyFC();
    if (prefs.grid) {
      var b = map.getBounds();
      var w = b.getWest(), s = Math.max(-84, b.getSouth()), e = b.getEast(), n = Math.min(84, b.getNorth());
      if (prefs.fmt === 'mgrs' || prefs.fmt === 'utm') buildUTMGrid(w, s, e, n, lines, labels);
      else buildLLGrid(w, s, e, n, lines, labels);
    }
    map.getSource('grid').setData(lines);
    map.getSource('grid-labels').setData(labels);
  }

  // ตารางละติจูด/ลองจิจูด (องศา-ลิปดา-ฟิลิปดา / องศา-ลิปดาทศนิยม / องศาทศนิยม)
  function buildLLGrid(w, s, e, n, lines, labels) {
    var fmt = prefs.fmt;
    var spanArc = Math.max(e - w, n - s) * 3600;
    var step = G.pickStep(G.LL_STEPS[fmt], spanArc, 8);
    var labLat = s + 0.17 * (n - s);
    var labLng = w + 0.02 * (e - w);
    var k0 = Math.ceil((w * 3600) / step - 1e-9), k1 = Math.floor((e * 3600) / step + 1e-9);
    var k;
    for (k = k0; k <= k1 && k - k0 < 40; k++) {
      var lng = (k * step) / 3600;
      lines.features.push(lineFeature([[lng, s], [lng, n]], isWholeDeg(k * step)));
      labels.features.push(labelFeature(lng, labLat, G.labelLL(lng, false, fmt, step), 'center'));
    }
    var j0 = Math.ceil((s * 3600) / step - 1e-9), j1 = Math.floor((n * 3600) / step + 1e-9);
    for (k = j0; k <= j1 && k - j0 < 40; k++) {
      var lat = (k * step) / 3600;
      lines.features.push(lineFeature([[w, lat], [e, lat]], isWholeDeg(k * step)));
      labels.features.push(labelFeature(labLng, lat, G.labelLL(lat, true, fmt, step), 'bottom-left'));
    }
  }
  function isWholeDeg(arc) {
    var d = arc / 3600;
    return Math.abs(d - Math.round(d)) < 1e-9;
  }

  // ตาราง UTM / MGRS
  function buildUTMGrid(w, s, e, n, lines, labels) {
    var mgrs = prefs.fmt === 'mgrs';
    var cLat = (s + n) / 2, cLng = (w + e) / 2;
    var spanM = Math.max(G.haversine({ lat: cLat, lng: w }, { lat: cLat, lng: e }), G.haversine({ lat: s, lng: cLng }, { lat: n, lng: cLng }));
    var step = G.pickStep(mgrs ? G.MGRS_STEPS : G.UTM_STEPS, spanM, mgrs ? 10 : 8);
    var digits = Math.round(5 - Math.log(step) / Math.LN10); // MGRS: จำนวนหลักบนป้าย
    var north = cLat >= 0;
    var z0 = G.zoneOf(w), z1 = G.zoneOf(e);
    if (z1 - z0 > 3) return; // กว้างเกินไป

    function nrm(u) { return u.north === north ? u.n : (north ? u.n - 1e7 : u.n + 1e7); }
    function toLL(zone, E, N) {
      var p = G.fromUTM(zone, north, E, N);
      return [p.lng, p.lat];
    }

    for (var z = z0; z <= z1; z++) {
      var zMin = G.zoneMeridian(z) - 3, zMax = G.zoneMeridian(z) + 3;
      var lo = Math.max(w, zMin), hi = Math.min(e, zMax);
      if (hi <= lo) continue;
      // หาช่วง E/N ที่ครอบคลุมส่วนของจอที่อยู่ในโซนนี้
      var minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
      for (var i = 0; i <= 6; i++) {
        for (var j = 0; j <= 6; j++) {
          var u = G.toUTM(s + ((n - s) * j) / 6, lo + ((hi - lo) * i) / 6, z);
          var nn = nrm(u);
          if (u.e < minE) minE = u.e;
          if (u.e > maxE) maxE = u.e;
          if (nn < minN) minN = nn;
          if (nn > maxN) maxN = nn;
        }
      }
      var padM = step * 0.2;
      minE -= padM; maxE += padM; minN -= padM; maxN += padM;
      var labLat = s + 0.17 * (n - s);
      var labLng = w + 0.02 * (e - w);
      var count = 0;
      var v, seg;

      // เส้นแนวตั้ง (ค่า E คงที่)
      for (v = Math.ceil(minE / step) * step; v <= maxE && count < 40; v += step, count++) {
        var major = Math.round(v / step) % 10 === 0;
        seg = clipRuns(function (t) { return toLL(z, v, minN + (maxN - minN) * t); }, zMin, zMax);
        pushRuns(seg, major, lines);
        var pt = nearestOnRuns(seg, 1, labLat);
        if (pt) {
          var txt = mgrs ? (digits > 0 ? padN(Math.floor((v % 100000) / step), digits) : '') : Math.round(v) + 'E';
          if (txt) labels.features.push(labelFeature(pt[0], pt[1], txt, 'center'));
        }
      }
      // เส้นแนวนอน (ค่า N คงที่)
      count = 0;
      for (v = Math.ceil(minN / step) * step; v <= maxN && count < 40; v += step, count++) {
        var majorH = Math.round(v / step) % 10 === 0;
        seg = clipRuns(function (t) { return toLL(z, minE + (maxE - minE) * t, v); }, zMin, zMax);
        pushRuns(seg, majorH, lines);
        var ptH = nearestOnRuns(seg, 0, labLng);
        if (ptH) {
          var nv = ((v % 1e7) + 1e7) % 1e7;
          var txtH = mgrs ? (digits > 0 ? padN(Math.floor((nv % 100000) / step), digits) : '') : Math.round(v) + 'N';
          if (txtH) labels.features.push(labelFeature(ptH[0], ptH[1], txtH, 'bottom-left'));
        }
      }

      // ป้ายสี่เหลี่ยม 100 กม. ของ MGRS
      if (mgrs && step <= 10000) {
        for (var E = Math.floor(minE / 100000) * 100000; E <= maxE; E += 100000) {
          for (var N = Math.floor(minN / 100000) * 100000; N <= maxN; N += 100000) {
            if (E + 50000 < 100000) continue;
            var c = toLL(z, E + 50000, N + 50000);
            if (c[0] < Math.max(w, zMin) || c[0] > Math.min(e, zMax) || c[1] < s || c[1] > n) continue;
            var nMod = ((N % 1e7) + 1e7) % 1e7;
            labels.features.push(labelFeature(c[0], c[1], G.squareId(z, E + 50000, nMod + 50000), 'center', 'sq'));
          }
        }
      }
    }
  }

  function padN(v, len) {
    var s = String(v);
    while (s.length < len) s = '0' + s;
    return s;
  }

  // ลากเส้นแบ่ง 16 ช่วง ตัดส่วนที่ออกนอกโซน UTM ให้เหลือเป็นช่วง ๆ
  function clipRuns(fn, zMin, zMax) {
    var runs = [], cur = [];
    for (var i = 0; i <= 16; i++) {
      var p = fn(i / 16);
      if (p[0] >= zMin && p[0] <= zMax) cur.push(p);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs;
  }
  function pushRuns(runs, major, fc) {
    runs.forEach(function (r) { if (r.length > 1) fc.features.push(lineFeature(r, major)); });
  }
  // จุดบนเส้นที่ใกล้ค่า target มากที่สุด (axis 0 = lng, 1 = lat)
  function nearestOnRuns(runs, axis, target) {
    var best = null, bd = Infinity;
    runs.forEach(function (r) {
      r.forEach(function (p) {
        var d = Math.abs(p[axis] - target);
        if (d < bd) { bd = d; best = p; }
      });
    });
    return best;
  }

  /* ---------- แผ่นวัดมุม (ฝึกใช้แผนที่) ---------- */
  var prot = { on: false, a: null, b: null, markA: null, markB: null, hide: false, revealed: false };

  // วางแผ่นวัดมุมสี่เหลี่ยม 1:50,000 บนแผนที่ โดยให้จุดอ้างอิงที่เลือกตรงกับหมุด A และหันเหนือกริด
  function updatePlate() {
    var src = map.getSource("plate");
    if (!src) return;
    var show = prot.on && prot.a;
    map.setLayoutProperty("plate", "visibility", show ? "visible" : "none");
    if (!show) return;
    var zone = G.zoneOf(prot.a.lng);
    var u = G.toUTM(prot.a.lat, prot.a.lng, zone);
    var off = TrailPlate.ANCHORS[prefs.anchor] || TrailPlate.ANCHORS.center;
    var cE = u.e - off.x, cN = u.n - off.y, h = TrailPlate.SIDE / 2;
    function pt(dx, dy) {
      var p = G.fromUTM(zone, u.north, cE + dx, cN + dy);
      return [p.lng, p.lat];
    }
    src.setCoordinates([pt(-h, h), pt(h, h), pt(h, -h), pt(-h, -h)]);
  }

  function protTap(ll) {
    var p = { lat: ll.lat, lng: ll.lng };
    if (!prot.a) { setProtPoint('a', p); toast('แตะแผนที่อีกครั้งเพื่อวางจุด B (ลากหมุดเพื่อปรับได้)'); }
    else setProtPoint('b', p);
  }

  function setProtPoint(which, p) {
    prot[which] = { lat: p.lat, lng: p.lng };
    var key = which === 'a' ? 'markA' : 'markB';
    if (!prot[key]) makeProtMarker(which);
    prot[key].setLngLat([p.lng, p.lat]);
    refreshProt();
  }

  function makeProtMarker(which) {
    var el = document.createElement('div');
    el.className = 'pmark ' + which;
    el.textContent = which.toUpperCase();
    var m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([0, 0]).addTo(map);
    m.on('drag', function () {
      var l = m.getLngLat();
      prot[which] = { lat: l.lat, lng: l.lng };
      refreshProt();
    });
    prot[which === 'a' ? 'markA' : 'markB'] = m;
  }


  function protReadout() {
    if (!prot.a || !prot.b) return null;
    var ga = G.gridAzimuth(prot.a, prot.b);
    var trueAz = G.trueAzimuth(prot.a, prot.b);
    return {
      az: ga.az,
      mil: (ga.az * 6400) / 360,
      back: G.norm360(ga.az + 180),
      trueAz: trueAz,
      mag: G.norm360(trueAz - prefs.decl),
      dist: G.haversine(prot.a, prot.b)
    };
  }

  function fmtDist(m) {
    return m >= 1000 ? (m / 1000).toFixed(2) + ' กม. (' + Math.round(m).toLocaleString() + ' ม.)' : Math.round(m) + ' ม.';
  }

  function refreshProt() {
    if (!map || !map.getSource('az')) return;
    var fc = emptyFC();
    if (prot.on && prot.a && prot.b) {
      fc.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[prot.a.lng, prot.a.lat], [prot.b.lng, prot.b.lat]] } });
    }
    map.getSource('az').setData(fc);

    var r = protReadout();
    updatePlate();

    var card = $('azcard');
    if (!prot.on) { card.hidden = true; return; }
    card.hidden = false;
    if (!r) {
      card.textContent = prot.a ? 'แตะแผนที่เพื่อวางจุด B' : 'แตะแผนที่เพื่อวางจุด A (จุดศูนย์กลางแผ่นวัดมุม)';
      return;
    }
    var hidden = prot.hide && !prot.revealed;
    var q = function (s) { return hidden ? '???' : s; };
    card.innerHTML =
      '<div><span class="lbl">มุมภาคกริด A→B</span><br><span class="big"></span></div>' +
      '<div class="grid2">' +
      '<div><span class="lbl">มุมกลับ B→A</span><br><span id="azBack"></span></div>' +
      '<div><span class="lbl">ระยะ</span><br><span id="azDist"></span></div>' +
      '<div><span class="lbl">มุมเหนือจริง</span><br><span id="azTrue"></span></div>' +
      '<div><span class="lbl">มุมแม่เหล็ก (เบี่ยง ' + prefs.decl + '°)</span><br><span id="azMag"></span></div>' +
      '</div>' +
      (prot.hide ? '<div class="btnrow"><button class="btn alt" id="azReveal">' + (prot.revealed ? 'ซ่อนค่า' : 'เฉลย') + '</button></div>' : '');
    card.querySelector('.big').textContent = q(r.az.toFixed(1) + '°  (' + Math.round(r.mil) + ' มิล)');
    $('azBack').textContent = q(r.back.toFixed(1) + '° (' + Math.round((r.back * 6400) / 360) + ' มิล)');
    $('azDist').textContent = fmtDist(r.dist);
    $('azTrue').textContent = q(r.trueAz.toFixed(1) + '°');
    $('azMag').textContent = q(r.mag.toFixed(1) + '°');
    var rev = $('azReveal');
    if (rev) rev.onclick = function () { prot.revealed = !prot.revealed; refreshProt(); };
  }

  function setProtOn(on) {
    prot.on = on;
    $('toolProt').classList.toggle('on', on);
    if (prot.markA) prot.markA.getElement().style.display = on ? '' : 'none';
    if (prot.markB) prot.markB.getElement().style.display = on ? '' : 'none';
    if (on && pinMarker) { pinMarker.remove(); pinMarker = null; pinPos = null; updateCoord(); }
    refreshProt();
  }

  function clearProt() {
    if (prot.markA) prot.markA.remove();
    if (prot.markB) prot.markB.remove();
    prot.a = prot.b = prot.markA = prot.markB = null;
    prot.revealed = false;
    refreshProt();
  }

  /* ---------- แผงตั้งค่าด้านล่าง ---------- */
  var sheetKind = null;

  function closeSheet() {
    $('sheet').hidden = true;
    sheetKind = null;
    $('toolLayers').classList.remove('on');
    $('toolGrid').classList.toggle('on', prefs.grid);
  }

  function openSheet(kind) {
    if (sheetKind === kind) { closeSheet(); return; }
    sheetKind = kind;
    var sh = $('sheet');
    sh.hidden = false;
    var title = kind === 'layers' ? 'ชั้นแผนที่' : kind === 'grid' ? 'พิกัดและตารางกริด' : kind === 'special' ? 'หมวดพิเศษ' : 'วัดมุมด้วยแผ่นวัดมุม';
    sh.innerHTML = '<div class="shead"><h3></h3><button id="sheetClose">ปิด</button></div><div id="sheetBody"></div>';
    sh.querySelector('h3').textContent = title;
    $('sheetClose').onclick = closeSheet;
    $('toolLayers').classList.toggle('on', kind === 'layers');
    if (kind === 'layers') renderLayersSheet();
    else if (kind === 'grid') renderGridSheet();
    else if (kind === 'special') TrailPaper.renderSheet($('sheetBody'));
    else renderProtSheet();
  }

  function radio(name, value, label, sub, checked) {
    return '<label class="opt"><input type="radio" name="' + name + '" value="' + value + '"' + (checked ? ' checked' : '') + '><span>' + label +
      (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
  }
  function check(id, label, sub, checked) {
    return '<label class="opt"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span>' + label +
      (sub ? '<small>' + sub + '</small>' : '') + '</span></label>';
  }

  function renderLayersSheet() {
    var h = '<h4>แผนที่พื้นหลัง</h4>' +
      radio('base', 'trail', 'แผนที่เดินป่า', 'ทางเดินเท้า ป่า น้ำ เงาภูเขา ยอดเขา ซูมเห็นอาคาร/ชื่อถนน', prefs.base === 'trail') +
      radio('base', 'sat', 'ภาพถ่ายดาวเทียม', 'ซูมได้ละเอียดสุด · ดาวน์โหลดเก็บไว้ใช้ออฟไลน์ได้', prefs.base === 'sat') +
      radio('base', 'topo', 'ภูมิประเทศ (เส้นชั้นความสูง)', 'แผนที่ตามแบบ topo · ดาวน์โหลดเก็บไว้ใช้ออฟไลน์ได้', prefs.base === 'topo') +
      '<h4>ซ้อนทับ (ต้องมีอินเทอร์เน็ต)</h4>' +
      check('ovWeather', 'สภาพอากาศ: เรดาร์ฝน', 'ข้อมูลล่าสุดจาก RainViewer', prefs.weather === 'radar') +
      check('ovTraffic', 'การจราจร', 'สีแสดงความหนาแน่นของรถบนถนน', prefs.traffic) +
      '<p class="note">เมื่อกด "ดาวน์โหลดพื้นที่ที่เห็นบนจอ" แอพจะเก็บแผนที่พื้นหลังที่เลือกอยู่ไว้ด้วย ซูมเกินที่เก็บไว้จะขยายภาพจากระดับที่มี</p>';
    $('sheetBody').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=base]'), function (el) {
      el.onchange = function () { prefs.base = el.value; savePrefs(); applyBase(); setDownloadLabel(); };
    });
    $('ovWeather').onchange = function () { prefs.weather = this.checked ? 'radar' : 'off'; savePrefs(); applyWeather(); };
    $('ovTraffic').onchange = function () { prefs.traffic = this.checked; savePrefs(); applyTraffic(); };
  }

  function renderGridSheet() {
    var h = check('gridOn', 'แสดงเส้นตาราง', 'เส้นและตัวเลขปรับตามระดับซูมอัตโนมัติ', prefs.grid) +
      '<h4>รูปแบบพิกัด (ใช้กับตารางและพิกัดกลางจอ)</h4>';
    G.FORMATS.forEach(function (f) {
      var sub = f === 'mgrs' ? 'ตัวอย่าง 47P QA 12345 67890' :
        f === 'utm' ? 'ตัวอย่าง 47P  E 712345  N 1767890' :
        f === 'dms' ? 'ตัวอย่าง 15°52′12.3″N' :
        f === 'dm' ? 'ตัวอย่าง 15°52.205′N' : 'ตัวอย่าง 15.87000°N';
      h += radio('fmt', f, G.FORMAT_NAMES[f], sub, prefs.fmt === f);
    });
    h += '<p class="note">แตะแผนที่เพื่อปักหมุดดูพิกัดของจุดนั้น แตะที่เดิมอีกครั้งเพื่อลบ · จุดกึ่งกลางจอ (กากบาทแดง) แสดงพิกัดที่มุมซ้ายบนตลอดเวลา · UTM/MGRS ใช้ datum WGS84</p>';
    $('sheetBody').innerHTML = h;
    $('gridOn').onchange = function () {
      prefs.grid = this.checked; savePrefs(); updateGrid();
    };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=fmt]'), function (el) {
      el.onchange = function () { prefs.fmt = el.value; savePrefs(); updateGrid(); updateCoord(); };
    });
  }

  function renderProtSheet() {
    var h = '<div class="btnrow"><button class="btn" id="protToggle">' + (prot.on ? 'ปิดแผ่นวัดมุม' : 'เปิดแผ่นวัดมุม') + '</button>' +
      '<button class="btn alt" id="protClear">ล้างจุด</button></div>' +
      '<p class="note">วิธีใช้: แตะแผนที่วางจุด A แล้วแตะวางจุด B ลากหมุดเพื่อปรับ แผ่นวัดมุมสี่เหลี่ยม 1:50,000 (5 กม. × 5 กม.) จะวางทับตามขนาดจริงของมาตราส่วน หันเหนือกริดเสมอ ซูมเข้าให้เห็นสเกลแล้วอ่านมุมที่เส้นประส้มตัดขอบแผ่น เทียบกับค่าที่แอพคำนวณ</p>' +
      '<h4>จุดของแผ่นที่ตรงกับหมุด A</h4>' +
      radio('anchor', 'center', 'ศูนย์กลางแผ่น', 'วัดมุม A→B ด้วยสเกลองศา', prefs.anchor === 'center') +
      radio('anchor', 'romer', 'มุมสเกล 1000 ม. (จุดแดง)', 'อ่านพิกัดกริดด้วยสเกลโรเมอร์', prefs.anchor === 'romer') +
      radio('anchor', 'sixty', 'มุมสเกล 60 ฟิลิปดา (จุดน้ำเงิน)', 'อ่านพิกัดภูมิศาสตร์ (ลิปดา/ฟิลิปดา)', prefs.anchor === 'sixty') +
      '<h4>ฝึกอ่านมุม</h4>' +
      check('protHide', 'ซ่อนคำตอบ', 'อ่านมุมจากแผ่นวัดมุมเองก่อน แล้วกด "เฉลย"', prot.hide) +
      '<h4>มุมเบี่ยงเบนแม่เหล็ก</h4>' +
      '<div class="field"><label for="declIn">องศา (ตะวันออก +, ตะวันตก −)</label><input type="number" id="declIn" step="0.1" value="' + prefs.decl + '"></div>' +
      '<h4>วางจุด B จากมุมและระยะ</h4>' +
      '<div class="field"><label for="plotAz">มุมกริด (°)</label><input type="number" id="plotAz" step="0.1" inputmode="decimal"></div>' +
      '<div class="field"><label for="plotDist">ระยะ (เมตร)</label><input type="number" id="plotDist" step="1" inputmode="decimal"></div>' +
      '<div class="btnrow"><button class="btn" id="plotGo">วางจุด B</button></div>';
    $('sheetBody').innerHTML = h;
    $('protToggle').onclick = function () {
      setProtOn(!prot.on);
      if (prot.on) toast('แตะแผนที่เพื่อวางจุด A');
      closeSheet();
    };
    $('protClear').onclick = function () { clearProt(); };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=anchor]'), function (el) {
      el.onchange = function () { prefs.anchor = el.value; savePrefs(); updatePlate(); };
    });
    $('protHide').onchange = function () { prot.hide = this.checked; prot.revealed = false; refreshProt(); };
    $('declIn').onchange = function () {
      var v = parseFloat(this.value);
      prefs.decl = isNaN(v) ? 0 : v;
      savePrefs(); refreshProt();
    };
    $('plotGo').onclick = function () {
      if (!prot.a) { toast('วางจุด A ก่อน'); return; }
      var az = parseFloat($('plotAz').value), dist = parseFloat($('plotDist').value);
      if (isNaN(az) || isNaN(dist) || dist <= 0) { toast('กรอกมุมและระยะให้ครบ'); return; }
      if (!prot.on) setProtOn(true);
      setProtPoint('b', G.pointFromGrid(prot.a, az, dist));
      closeSheet();
    };
  }

  /* ---------- ดาวน์โหลดพื้นที่ ---------- */
  function setDownloadLabel() {
    if (downloading) return;
    var btn = $('download');
    btn.textContent = 'ดาวน์โหลดพื้นที่ที่เห็นบนจอ' + (prefs.base === 'trail' ? '' : ' (+' + BASE_NAMES[prefs.base] + ')');
  }

  async function downloadArea() {
    if (downloading || !map || !vectorTpl) return;
    var base = prefs.base;
    var b = map.getBounds();
    var bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    var n = C.countTiles(bounds, base);
    if (n > MAX_TILES) {
      alert('พื้นที่ใหญ่เกินไป (ประมาณ ' + n.toLocaleString() + ' ไทล์ สูงสุด ' + MAX_TILES.toLocaleString() + ')\nกรุณาซูมเข้าให้เห็นพื้นที่เล็กลงแล้วลองใหม่');
      return;
    }
    var estMB = Math.max(1, Math.round((n * (base === 'trail' ? 25 : 35)) / 1024));
    if (!confirm('ดาวน์โหลดพื้นที่ที่เห็นบนจอ' + (base === 'trail' ? '' : ' พร้อมแผนที่' + BASE_NAMES[base]) +
      '\nประมาณ ' + n.toLocaleString() + ' ไทล์ (ราว ' + estMB + ' MB)\nควรต่อ Wi-Fi ดำเนินการต่อไหม?')) return;

    // รวบรวมรายการ URL
    var urls = [];
    C.tilesForBounds(bounds, C.MIN_ZOOM, C.VECTOR_MAXZOOM).forEach(function (t) {
      urls.push(C.fillTemplate(vectorTpl, t));
    });
    C.tilesForBounds(bounds, C.MIN_ZOOM, C.DEM_MAXZOOM).forEach(function (t) {
      urls.push(C.fillTemplate(C.DEM_TEMPLATE, t));
    });
    if (C.rasterMax(base)) {
      var tpl = base === 'sat' ? C.SAT_TEMPLATE : C.TOPO_TEMPLATE;
      C.tilesForBounds(bounds, C.MIN_ZOOM, C.rasterMax(base)).forEach(function (t) {
        urls.push(C.fillTemplate(tpl, t));
      });
    }
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
    var area = { id: id, name: defaultName(), bounds: bounds, tiles: keys.length, failed: failed, base: base };
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
      setDownloadLabel();
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
      info.querySelector('span').textContent = a.tiles.toLocaleString() + ' ไฟล์' +
        (a.base && a.base !== 'trail' ? ' · + ' + BASE_NAMES[a.base] : '') +
        (a.failed ? ' (ขาด ' + a.failed + ')' : '');
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
    loadPrefs();
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
    $('toolLayers').onclick = function () { openSheet('layers'); };
    $('toolGrid').onclick = function () { openSheet('grid'); };
    $('toolProt').onclick = function () { openSheet('prot'); };
    $('toolSpecial').onclick = function () { openSheet('special'); };
    $('coord').onclick = function () {
      var i = G.FORMATS.indexOf(prefs.fmt);
      prefs.fmt = G.FORMATS[(i + 1) % G.FORMATS.length];
      savePrefs(); updateCoord(); updateGrid();
      if (sheetKind === 'grid') renderGridSheet();
    };
    $('toolGrid').classList.toggle('on', prefs.grid);
    setDownloadLabel();
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
