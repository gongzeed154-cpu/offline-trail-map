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
  var START_ZOOM = 13; // ซูมตอนเปิดแอพที่ตำแหน่ง GPS ล่าสุด
  var LASTFIX_KEY = 'trail_lastfix_v1';
  var lastFixSaved = null;
  var firstFixDone = false;

  var BASE_NAMES = { trail: 'เดินป่า', sat: 'ดาวเทียม', topo: 'ภูมิประเทศ', paper: 'แผนที่กระดาษ' };
  var NON_TRAIL = { background: 1, sat: 1, topo: 1, traffic: 1, 'building-3d': 1 };

  var map = null;
  var geolocate = null;
  var vectorTpl = null;
  var downloading = false;
  var trailLayerIds = [];

  var prefs = {
    base: 'trail', // trail | sat | topo | paper
    bld3d: false, // อาคาร 3 มิติ (จากข้อมูล OpenStreetMap)
    contour: false, // เส้นชั้นความสูง 20 ม. (สร้างบนเครื่อง)
    weather: 'off', // off | radar
    traffic: false,
    grid: false,
    llStep: 'auto',
    coordDigits: 5, // จำนวนหลักพิกัด MGRS กลางจอ/หมุด
    utmStep: 'auto', // ระยะตาราง UTM/MGRS (เมตร) 10000=1 หลัก 1000=2 หลัก 100=3 หลัก 10=4 หลัก
    fmt: 'dms', // mgrs | utm | dms | dm | dd
    anchor: 'center', // จุดของแผ่นวัดมุมที่ตรงกับหมุด A: center | romer | sixty
    camOffset: 0, // ค่าปรับแก้ทิศของกล้องเล็ง (องศา)
    orient: 'north', // north = ล็อกทิศเหนือ, free = หมุนตามทิศที่เดิน
    display: 'day', // โหมดหน้าจอ: day / night / nv / mono / stealth
    bright: 100, // ความสว่างหน้าจอ (%)
    mute: false, // ปิดเสียงพูดแจ้งเตือน
    decl: 0 // มุมเบี่ยงเบนแม่เหล็ก (องศา, ตะวันออกเป็นบวก)
  };

  function $(id) { return document.getElementById(id); }

  // ตำแหน่ง GPS ล่าสุด (เก็บเมื่อขยับเกิน 30 ม. หรือผ่านไป 1 นาที)
  function loadLastFix() {
    try {
      var f = JSON.parse(localStorage.getItem(LASTFIX_KEY) || 'null');
      if (f && isFinite(f.lat) && isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180) return f;
    } catch (e) { /* ไม่มี */ }
    return null;
  }
  function saveLastFix(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return;
    var now = Date.now();
    if (lastFixSaved && now - lastFixSaved.t < 60000 && G.haversine(lastFixSaved, { lat: lat, lng: lng }) < 30) return;
    lastFixSaved = { lat: lat, lng: lng, t: now };
    try { localStorage.setItem(LASTFIX_KEY, JSON.stringify(lastFixSaved)); } catch (e) { /* ไม่เป็นไร */ }
  }

  function thaiDate(iso) {
    var m = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'], p = iso.split('-');
    return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1] + ' ' + (parseInt(p[0], 10) + 543);
  }

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

    // เปิดแอพ: ไปที่พิกัด GPS ล่าสุดที่เคยได้ ซูม 13 (ถ้ายังไม่เคยมี เริ่มที่ประเทศไทย)
    var lastFix = loadLastFix();
    map = new maplibregl.Map({
      container: 'map',
      style: style,
      center: lastFix ? [lastFix.lng, lastFix.lat] : [100.9925, 15.87],
      zoom: lastFix ? START_ZOOM : 5,
      minZoom: 3,
      maxZoom: MAX_ZOOM,
      attributionControl: { compact: true }
    });

    geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 20000 },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true,
      fitBoundsOptions: { maxZoom: START_ZOOM } // ครั้งแรกที่ได้ตำแหน่งจริงให้ซูมไม่เกิน 13 แล้วคืนค่าปกติ
    });
    map.addControl(geolocate, 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: false }), 'bottom-right');
    map.addControl(new OrientControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    geolocate.on('geolocate', function (e) {
      var c = e.coords || {};
      geolocate.options.fitBoundsOptions = { maxZoom: 15 };
      saveLastFix(c.latitude, c.longitude);
      // ได้ตำแหน่งจริงครั้งแรกหลังเปิดแอพ: ไปที่ตำแหน่งนั้นที่ซูม 13 พอดี (ไม่ปล่อยให้ซูมตามความแม่นยำของ GPS)
      if (!firstFixDone && isFinite(c.latitude) && isFinite(c.longitude)) {
        firstFixDone = true;
        map.easeTo({ center: [c.longitude, c.latitude], zoom: START_ZOOM, duration: 500 });
      }
      TrailSensors.setFix({
        lat: c.latitude, lng: c.longitude, alt: c.altitude, altAcc: c.altitudeAccuracy, acc: c.accuracy,
        speed: c.speed, heading: c.heading, t: e.timestamp || Date.now()
      });
    });
    geolocate.on('error', function (e) {
      sbMsg = 'GPS ใช้ไม่ได้: ' + (e && e.code === 1 ? 'ยังไม่ได้อนุญาตตำแหน่ง' : 'ไม่ได้สัญญาณ (ออกที่โล่ง)');
      updateStatus();
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
    try { // เข็มทิศเลนเซติก: จานหน้าปัด (ชี้เหนือ) อยู่ใต้ตัวเข็มทิศ (มีช่องกระจกโปร่ง)
      var LS = 12, lc = TrailLens.drawCard(LS), lb = TrailLens.drawBody(LS), z4 = [[0, 1], [1, 1], [1, 0], [0, 0]];
      map.addSource('lens-card', { type: 'image', url: lc.canvas.toDataURL('image/png'), coordinates: z4 });
      map.addSource('lens-body', { type: 'image', url: lb.canvas.toDataURL('image/png'), coordinates: z4 });
      map.addLayer({ id: 'lens-card', type: 'raster', source: 'lens-card', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'az-line');
      map.addLayer({ id: 'lens-body', type: 'raster', source: 'lens-body', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'az-line');
    } catch (e) { /* ไม่มีเข็มทิศ */ }
    TrailPaper.init({ map: function () { return map; }, toast: toast, closeSheet: closeSheet });
    TrailPaper.loadAll();
    TrailProj.init({
      map: function () { return map; }, toast: toast, prefs: prefs,
      getPin: function () { return pinPos; },
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailProj.renderSheet($('sheetBody')); }
    });
    TrailStruct.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet,
      openSheet: function (k) { if (sheetKind) closeSheet(); openSheet(k); }
    });
    TrailNav.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet, geolocate: geolocate,
      vectorTpl: function () { return vectorTpl; }, prefs: prefs,
      fmtPoint: function (lat, lng) { return G.formatPoint(lat, lng, prefs.fmt); }
    });
    TrailCam.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet, prefs: prefs, savePrefs: savePrefs,
      vectorTpl: function () { return vectorTpl; },
      fmtPoint: function (lat, lng) { return G.formatPoint(lat, lng, prefs.fmt); }
    });
    TrailSym.init({
      map: function () { return map; }, toast: toast, prefs: prefs,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailSym.renderSheet($('sheetBody')); }
    });
    TrailPrint.init({
      map: function () { return map; }, toast: toast, prefs: prefs, vectorTpl: function () { return vectorTpl; },
      visibleRoutes: function () { return TrailNav.visibleRoutes(); }
    });
    TrailSound.init({ map: function () { return map; }, toast: toast });
    TrailJump.init({
      map: function () { return map; }, toast: toast, prefs: prefs, closeSheet: closeSheet,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailJump.renderSheet($('sheetBody')); }
    });
    TrailWind.init({
      map: function () { return map; }, toast: toast,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailWind.renderSheet($('sheetBody')); }
    });
    TrailContour.init({
      map: function () { return map; }, toast: toast,
      enable: function () { if (!prefs.contour) { prefs.contour = true; savePrefs(); } if (window.TrailSpots) TrailSpots.setEnabled(true); }
    });
    TrailTerrain.init({ map: function () { return map; }, toast: toast });
    TrailSpots.init({ map: function () { return map; } });
    TrailSearch.init({ map: function () { return map; }, toast: toast, closeSheet: closeSheet });
    TrailSight.init({ toast: toast, getDecl: function () { return prefs.decl || 0; } });
    TrailView3D.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailView3D.renderSheet($('sheetBody')); },
      getFix: function () { var f = TrailSensors.state.fix; return f && isFinite(f.lat) ? { lat: f.lat, lng: f.lng } : null; },
      getDecl: function () { return prefs.decl || 0; },
      getBase: function () { return prefs.base; },
      setBase: function (b) { prefs.base = b; savePrefs(); applyBase(); setDownloadLabel(); },
      restoreOrient: function () { applyOrient(); }
    });
    TrailRec.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet, geolocate: geolocate,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailRec.renderSheet($('sheetBody')); }
    });
    TrailTeam.init({
      map: function () { return map; }, toast: toast, closeSheet: closeSheet, geolocate: geolocate,
      showSheet: function (k) { if (sheetKind !== k) openSheet(k); else TrailTeam.renderSheet($('sheetBody')); }
    });
    TrailSky.init({
      map: function () { return map; }, toast: toast, prefs: prefs, savePrefs: savePrefs,
      fmtPoint: function (lat, lng) { return G.formatPoint(lat, lng, prefs.fmt); }
    });
    applyOrient();
    updateStatus();
    try {
      navigator.permissions.query({ name: 'geolocation' }).then(function (p) { if (p.state === 'granted') geolocate.trigger(); });
    } catch (e) { /* ไม่รองรับ */ }

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
    TrailPaper.setSolo(prefs.base === 'paper');
    TrailContour.apply(!!prefs.contour);
    applyBld3d();
    TrailSpots.setEnabled(!!prefs.contour);
    if (window.TrailView3D) TrailView3D.refreshBase();
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

  var centerEle = null, pinEle = null, eleTimer = null;
  function scheduleElev() {
    clearTimeout(eleTimer);
    eleTimer = setTimeout(function () {
      var c = map.getCenter();
      TrailRoute.elevAsync(c.lat, c.lng).then(function (v) { centerEle = v; updateCoord(); }).catch(function () {});
    }, 400);
  }

  function updateCoord() {
    if (!map) return;
    var c = map.getCenter();
    var el = $('coord');
    var html = '<small></small><span></span>';
    el.innerHTML = html;
    el.querySelector('small').textContent = 'กลางจอ · ' + G.FORMAT_NAMES[prefs.fmt] + ' · ซูม ' + map.getZoom().toFixed(1);
    var txt = fmtCoord(c.lat, c.lng) + (centerEle !== null ? '  ·  สูง ~' + Math.round(centerEle) + ' ม.' : '');
    if (pinPos) {
      txt += '\n📍 ' + fmtCoord(pinPos.lat, pinPos.lng) + (pinEle !== null ? '  ·  สูง ~' + Math.round(pinEle) + ' ม.' : '');
      el.querySelector('span').style.whiteSpace = 'pre-line';
    }
    el.querySelector('span').textContent = txt;
  }

  function onMove() {
    updateCoord();
    scheduleElev();
    scheduleGrid();
    refreshProt();
  }

  function onMapClick(e) {
    var tg = e.originalEvent && e.originalEvent.target;
    if (tg && tg.closest && tg.closest('.symmark')) return;
    if (TrailNav.handleClick(e)) return;
    if (TrailStruct.handleClick(e)) return;
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
      pinEle = null;
      TrailRoute.elevAsync(pinPos.lat, pinPos.lng).then(function (v) { pinEle = v; updateCoord(); }).catch(function () {});
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

  var lastGridNote = '';
  // พิกัดกลางจอ/หมุด: ถ้าเลือกจำนวนหลัก MGRS ไว้ แสดงตามนั้น (เช่น 3 หลัก = 47P QA 123 678 ความละเอียด 100 ม.)
  function fmtCoord(lat, lng) {
    // จำนวนหลักของพิกัดกลางจอแยกจากเส้นกริด (ค่าเริ่มต้น 5 หลัก = ละเอียด 1 ม. เหมือนเดิม)
    var d = +prefs.coordDigits || 5;
    if (prefs.fmt === 'mgrs' && d < 5 && lat >= -80 && lat < 84) return G.mgrsFromUTM(G.toUTM(lat, lng), lat, d);
    return G.formatPoint(lat, lng, prefs.fmt);
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
    if (gridNote && gridNote !== lastGridNote) toast(gridNote);
    lastGridNote = gridNote;
  }

  // ตารางละติจูด/ลองจิจูด (องศา-ลิปดา-ฟิลิปดา / องศา-ลิปดาทศนิยม / องศาทศนิยม)
  function buildLLGrid(w, s, e, n, lines, labels) {
    var fmt = prefs.fmt;
    var spanArc = Math.max(e - w, n - s) * 3600;
    var step = G.pickStep(G.LL_STEPS[fmt], spanArc, 8);
    var fixed = +prefs.llStep > 0;
    if (fixed) { // ระยะที่ผู้ใช้เลือก: ถ้าเส้นถี่เกินไปเพราะซูมออกมาก แสดงทุก ๆ k เส้น (ยังตรงกับเส้นที่เลือกเสมอ)
      step = +prefs.llStep;
      var mult = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], mi = 0;
      while (spanArc / (step * mult[mi]) > 30 && mi < mult.length - 1) mi++;
      step *= mult[mi];
      gridNote = mult[mi] > 1 ? 'ซูมออกมาก แสดงทุก ' + mult[mi] + ' เส้น (ซูมเข้าเพื่อดูทุก ' + llStepName(+prefs.llStep) + ')' : '';
    } else gridNote = '';
    // ป้ายวางให้พ้นแถบ/การ์ดด้านล่างจอ และพ้นช่องค้นหามุมซ้ายบน
    var band = labelBand();
    var labLat = band ? band.lat : s + 0.17 * (n - s);
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
  var gridNote = '';
  function fmtStepM(m) { return m >= 1000 ? (m / 1000) + ' กม.' : m + ' ม.'; }
  function llStepName(a) { return a >= 3600 ? (a / 3600) + '°' : a >= 60 ? (a / 60) + ' ลิปดา' : a + ' ฟิลิปดา'; }
  // หาตำแหน่งแนวนอนบนจอที่ว่างสำหรับป้ายลองจิจูด: เหนือการ์ด/แถบด้านล่างที่สูงที่สุดที่เปิดอยู่
  function labelBand() {
    try {
      var mr = map.getContainer().getBoundingClientRect(), top = mr.bottom;
      ['azcard', 'routecard', 'navcard', 'bottom', 'statusbar'].forEach(function (id) {
        var el = $(id); if (!el || el.hidden || !el.getClientRects().length) return; // (fixed elements have no offsetParent)
        var r = el.getBoundingClientRect(); if (r.height > 0 && r.top < top && r.top > mr.top + mr.height * 0.35) top = r.top;
      });
      var y = Math.min(mr.height * 0.85, top - mr.top - 18);
      var ll = map.unproject([mr.width / 2, y]);
      return { lat: ll.lat };
    } catch (e) { return null; }
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
    if (+prefs.utmStep > 0) { // ระยะที่ผู้ใช้เลือก (ซูมออกมากแสดงทุก k เส้น)
      var base = +prefs.utmStep, mult = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], mi = 0;
      while (spanM / (base * mult[mi]) > 30 && mi < mult.length - 1) mi++;
      step = base * mult[mi];
      gridNote = mult[mi] > 1 ? 'ซูมออกมาก แสดงทุก ' + mult[mi] + ' เส้น (ซูมเข้าเพื่อดูทุก ' + fmtStepM(base) + ')' : '';
    } else gridNote = '';
    var digits = Math.round(5 - Math.log(+prefs.utmStep > 0 ? Math.min(step, +prefs.utmStep) : step) / Math.LN10); // MGRS: จำนวนหลักบนป้าย
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
  // placed = วางแผ่นแล้ว, follow = แผ่นตามจุด A, platePos = ตำแหน่งจุดอ้างอิงของแผ่นเมื่อย้ายเอง, locked = ล็อคไม่ให้ย้ายแผ่น
  var prot = { n: 2, ex: {}, exm: {}, lines: [], sights: [], under: false, cardTop: false, on: false, a: null, b: null, markA: null, markB: null, hide: false, revealed: false, placed: false, follow: true, platePos: null, locked: false, handle: null };

  // วางแผ่นวัดมุมสี่เหลี่ยม 1:50,000 บนแผนที่ โดยให้จุดอ้างอิงที่เลือกตรงกับหมุด A และหันเหนือกริด
  function updatePlate() {
    var src = map.getSource("plate");
    if (!src) return;
    var pos = prot.follow ? prot.a : prot.platePos;
    var show = !!(prot.on && prot.placed && pos);
    map.setLayoutProperty("plate", "visibility", show ? "visible" : "none");
    syncHandle(show ? pos : null);
    if (!show) { syncRotHandle(null); return; }
    var zone = G.zoneOf(pos.lng);
    var u = G.toUTM(pos.lat, pos.lng, zone);
    var off = TrailPlate.ANCHORS[prefs.anchor] || TrailPlate.ANCHORS.center;
    var rot = (prot.rot || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
    function R2(dx, dy) { return [dx * cr + dy * sr, -dx * sr + dy * cr]; } // หมุนตามเข็มนาฬิกา (กรอบแผ่น → ตะวันออก/เหนือ)
    var o2 = R2(off.x, off.y), cE = u.e - o2[0], cN = u.n - o2[1], h = TrailPlate.SIDE / 2;
    function pt(dx, dy) {
      var r = R2(dx, dy), p = G.fromUTM(zone, u.north, cE + r[0], cN + r[1]);
      return [p.lng, p.lat];
    }
    src.setCoordinates([pt(-h, h), pt(h, h), pt(h, -h), pt(-h, -h)]);
    // ที่จับหมุนแผ่น: มุมขวาบน
    var rp = pt(h * 0.94, h * 0.94);
    prot.plateCenter = { zone: zone, north: u.north, e: cE, n: cN };
    syncRotHandle(prot.on && prot.placed && !prot.locked ? { lng: rp[0], lat: rp[1] } : null);
  }
  function syncRotHandle(pos) {
    if (!pos) { if (prot.rotHandle) { prot.rotHandle.remove(); prot.rotHandle = null; } return; }
    if (!prot.rotHandle) {
      prot.rotHandle = makeHandle('⟳', 'ลากเพื่อหมุนแผ่นวัดมุม', function (l) {
        var pc = prot.plateCenter; if (!pc) return;
        var u2 = G.toUTM(l.lat, l.lng, pc.zone), a = Math.atan2(u2.e - pc.e, u2.n - pc.n) * 180 / Math.PI;
        prot.rot = Math.round(G.norm360(a - 45) * 10) / 10; if (prot.rot > 180) prot.rot -= 360;
        updatePlate(); refreshProt(true);
      });
    } else if (!prot.rotHandle._dragging) prot.rotHandle.setLngLat([pos.lng, pos.lat]);
  }
  // ที่จับแบบลากได้ (วงกลมเส้นประ) ใช้กับแผ่นวัดมุมและเข็มทิศ
  function makeHandle(sym, title, onDrag, onEnd) {
    var el = document.createElement('div');
    el.style.cssText = 'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.6);border:2px dashed #c4501b;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:700;color:#c4501b;touch-action:none;cursor:grab';
    el.textContent = sym; el.title = title;
    var m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(map.getCenter()).addTo(map);
    m.on('dragstart', function () { m._dragging = true; });
    m.on('drag', function () { onDrag(m.getLngLat()); });
    m.on('dragend', function () { m._dragging = false; if (onEnd) onEnd(); refreshProt(); });
    return m;
  }

  /* ---------- เข็มทิศเลนเซติก ---------- */
  var lens = { placed: false, c: null, th: 0, locked: false, hMove: null, hRot: null };
  function lensFrame() {
    var zone = G.zoneOf(lens.c.lng), u = G.toUTM(lens.c.lat, lens.c.lng, zone);
    return { zone: zone, north: u.north, e: u.e, n: u.n };
  }
  // จุดในกรอบเข็มทิศ (มม.) → พิกัด · th = ทิศของแกน +x (องศาภาคกริด)
  function lensPt(f, th, x, y) {
    var t = th * Math.PI / 180, k = TrailLens.M_PER_MM, st = Math.sin(t), ct = Math.cos(t);
    var p = G.fromUTM(f.zone, f.north, f.e + (x * st + y * ct) * k, f.n + (x * ct - y * st) * k);
    return [p.lng, p.lat];
  }
  function updateLens() {
    var show = !!(prot.on && lens.placed && lens.c);
    ['lens-card', 'lens-body'].forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none'); });
    if (!show || !map.getSource('lens-body')) { lensHandles(false); return; }
    var f = lensFrame(), B = TrailLens.BODY, R = TrailLens.CARD_R, nb = prefs.decl || 0;
    map.getSource('lens-body').setCoordinates([lensPt(f, lens.th, B.xmin, B.ymin), lensPt(f, lens.th, B.xmax, B.ymin), lensPt(f, lens.th, B.xmax, B.ymax), lensPt(f, lens.th, B.xmin, B.ymax)]);
    // จานหน้าปัด: ด้านบนของภาพ = ทิศเหนือแม่เหล็ก (เหนือกริด + มุมเบี่ยงเบนที่ตั้งไว้)
    var tc = nb + 90;
    map.getSource('lens-card').setCoordinates([lensPt(f, tc, -R, -R), lensPt(f, tc, R, -R), lensPt(f, tc, R, R), lensPt(f, tc, -R, R)]);
    lensHandles(!lens.locked);
  }
  function lensHandles(on) {
    if (!on) { if (lens.hMove) { lens.hMove.remove(); lens.hMove = null; } if (lens.hRot) { lens.hRot.remove(); lens.hRot = null; } return; }
    var f = lensFrame(), mv = TrailLens.MOVE_AT, ro = TrailLens.ROT_AT;
    if (!lens.hMove) lens.hMove = makeHandle('✥', 'ลากเพื่อเลื่อนเข็มทิศ', function (l) {
      // ให้ที่จับอยู่ตำแหน่งเดิมบนตัวเข็มทิศ: ศูนย์หน้าปัด = ที่จับ − ระยะ (หมุนตามทิศ)
      var t = lens.th * Math.PI / 180, k = TrailLens.M_PER_MM, z = G.zoneOf(l.lng), u = G.toUTM(l.lat, l.lng, z);
      var p = G.fromUTM(z, u.north, u.e - (mv.x * Math.sin(t) + mv.y * Math.cos(t)) * k, u.n - (mv.x * Math.cos(t) - mv.y * Math.sin(t)) * k);
      lens.c = { lat: p.lat, lng: p.lng }; updateLens(); refreshProt(true);
    });
    if (!lens.hRot) lens.hRot = makeHandle('⟳', 'ลากเพื่อหมุนเข็มทิศ', function (l) {
      var f2 = lensFrame(), u = G.toUTM(l.lat, l.lng, f2.zone), a = Math.atan2(u.e - f2.e, u.n - f2.n) * 180 / Math.PI;
      lens.th = Math.round(G.norm360(a - Math.atan2(ro.y, ro.x) * 180 / Math.PI) * 10) / 10; updateLens(); refreshProt(true);
    });
    var pm = lensPt(f, lens.th, mv.x, mv.y), pr = lensPt(f, lens.th, ro.x, ro.y);
    if (!lens.hMove._dragging) lens.hMove.setLngLat(pm);
    if (!lens.hRot._dragging) lens.hRot.setLngLat(pr);
  }
  function placeLens() {
    lens.placed = true; lens.locked = false;
    var c0 = prot.a || map.getCenter();
    lens.c = { lat: c0.lat, lng: c0.lng };
    lens.th = prot.a && prot.b ? Math.round(G.gridAzimuth(prot.a, prot.b).az * 10) / 10 : 0;
    updateLens(); refreshProt();
  }

  // ที่จับสำหรับลากแผ่นวัดมุม (อยู่ที่จุดอ้างอิงของแผ่น) ซ่อนเมื่อล็อค
  function syncHandle(pos) {
    if (!pos || prot.locked) { if (prot.handle) { prot.handle.remove(); prot.handle = null; } return; }
    if (prot.handle && prot.handle._dragging) return;
    if (!prot.handle) {
      var el = document.createElement('div');
      el.style.cssText = 'width:44px;height:44px;margin-top:0;border-radius:50%;background:rgba(255,255,255,.55);border:2px dashed #c4501b;display:flex;align-items:center;justify-content:center;font-size:22px;color:#c4501b;touch-action:none;cursor:move';
      el.textContent = '✥'; el.title = 'ลากเพื่อเลื่อนแผ่นวัดมุม';
      prot.handle = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pos.lng, pos.lat]).addTo(map);
      prot.handle.on('dragstart', function () { prot.handle._dragging = true; });
      prot.handle.on('drag', function () { var l = prot.handle.getLngLat(); prot.follow = false; prot.platePos = { lat: l.lat, lng: l.lng }; updatePlate(); });
      prot.handle.on('dragend', function () { prot.handle._dragging = false; refreshProt(); });
    } else prot.handle.setLngLat([pos.lng, pos.lat]);
  }

  function protTap(ll) {
    var p = { lat: ll.lat, lng: ll.lng };
    if (!prot.a) { setProtPoint('a', p); toast('แตะแผนที่อีกครั้งเพื่อวางจุด B (ลากหมุดเพื่อปรับได้)'); }
    else if (prot.b && nextLetter()) { var L = nextLetter(); setProtPoint(L.toLowerCase(), p); if (nextLetter()) toast('แตะวางจุด ' + nextLetter() + ' ต่อได้'); }
    else if (prot.b && ((prot.placed && !prot.locked) || (lens.placed && !lens.locked))) return; // วางแผ่นแล้ว: แตะแผนที่ไม่ย้ายจุด B (กันพลาดระหว่างลากแผ่น) ลากหมุดแทน
    else setProtPoint('b', p);
  }

  var LETTERS = 'ABCDEFGH', PCOL = { c: '#2e7d32', d: '#6a1b9a', e: '#00838f', f: '#ad1457', g: '#5d4037', h: '#37474f' };
  function ptOf(L) { L = L.toLowerCase(); return L === 'a' ? prot.a : L === 'b' ? prot.b : prot.ex[L] || null; }
  function nextLetter() { for (var i = 2; i < prot.n; i++) if (!prot.ex[LETTERS[i].toLowerCase()]) return LETTERS[i]; return null; }
  function placedLetters() { return LETTERS.split('').filter(function (L) { return !!ptOf(L); }); }
  function setProtPoint(which, p) {
    if (which !== 'a' && which !== 'b') {
      prot.ex[which] = { lat: p.lat, lng: p.lng };
      if (!prot.exm[which]) {
        var el = document.createElement('div'); el.className = 'pmark'; el.style.background = PCOL[which] || '#444'; el.textContent = which.toUpperCase();
        var m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
        m.on('drag', function () { var l = m.getLngLat(); prot.ex[which] = { lat: l.lat, lng: l.lng }; refreshProt(); });
        prot.exm[which] = m;
      }
      prot.exm[which].setLngLat([p.lng, p.lat]); applyProtLayerOrder(); refreshProt(); return;
    }
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

  // เส้นระหว่างจุด / เส้นยืดยาว: { a:'A', b:'C', km:0 } = A→C · { a:'A', b:'C', km:10 } = จาก A ผ่าน C ยาว 10 กม. · { p0, az, km } = เส้นเล็งจากมุมมอง 3D
  function lineEnds(l) {
    var s0 = l.p0 || ptOf(l.a); if (!s0) return null;
    if (!l.km) { var e = ptOf(l.b); return e ? [s0, e] : null; }
    var az = l.p0 ? l.az : (ptOf(l.b) ? G.gridAzimuth(s0, ptOf(l.b)).az : null);
    if (az === null) return null;
    return [s0, G.pointFromGrid(s0, az, l.km * 1000)];
  }
  function lineInfo(l) {
    var e = lineEnds(l); if (!e) return null;
    var az = G.gridAzimuth(e[0], e[1]).az;
    return { az: az, dist: G.haversine(e[0], e[1]), ends: e };
  }
  function drawProtLines() {
    if (!map.getSource('plines')) {
      map.addSource('plines', { type: 'geojson', data: emptyFC() });
      map.addLayer({ id: 'plines', type: 'line', source: 'plines', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': 2.6, 'line-dasharray': ['case', ['get', 'ext'], ['literal', [4, 2]], ['literal', [1, 0]]] } });
      map.addLayer({ id: 'plines-lbl', type: 'symbol', source: 'plines', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -0.8], 'text-allow-overlap': false }, paint: { 'text-color': ['get', 'c'], 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      applyProtLayerOrder();
    }
    var fc = emptyFC(), hidden = prot.hide && !prot.revealed;
    function add(l, col, label) {
      var inf = lineInfo(l); if (!inf) return;
      fc.features.push({ type: 'Feature', properties: { c: col, ext: !!l.km, t: label + ' ' + (hidden ? '???' : inf.az.toFixed(1) + '°') + ' · ' + (inf.dist >= 1000 ? (inf.dist / 1000).toFixed(2) + ' กม.' : Math.round(inf.dist) + ' ม.') }, geometry: { type: 'LineString', coordinates: inf.ends.map(function (q) { return [q.lng, q.lat]; }) } });
    }
    if (prot.on) prot.lines.forEach(function (l) { add(l, PCOL[(l.b || 'c').toLowerCase()] || '#1a6ad6', l.a + '→' + l.b + (l.km ? ' (' + l.km + ' กม.)' : '')); });
    prot.sights.forEach(function (l) { add(l, '#c8102e', '🧭 ' + l.label); });
    map.getSource('plines').setData(fc);
  }
  // ลำดับชั้น: จุด/เส้นอยู่บนสุด หรืออยู่ใต้แผ่นวัดมุม/เข็มทิศ
  function applyProtLayerOrder() {
    if (!map) return;
    var below = prot.under ? (map.getLayer('plate') ? 'plate' : map.getLayer('lens-card') ? 'lens-card' : null) : null;
    ['az-line', 'plines', 'plines-lbl'].forEach(function (id) { if (!map.getLayer(id)) return; if (below) map.moveLayer(id, below); else map.moveLayer(id); });
    var all = [prot.markA, prot.markB].concat(Object.keys(prot.exm).map(function (k) { return prot.exm[k]; }));
    all.forEach(function (m) { if (m) { var el = m.getElement(); el.style.opacity = prot.under && (prot.placed || lens.placed) ? '0.35' : ''; el.style.zIndex = prot.under ? '0' : '3'; } });
  }
  function applyCardPos() {
    var c = $('azcard'); if (!c) return;
    if (prot.cardTop) { c.style.top = 'calc(env(safe-area-inset-top) + 10px)'; c.style.bottom = 'auto'; c.style.zIndex = '11'; }
    else { c.style.top = ''; c.style.bottom = ''; c.style.zIndex = ''; }
  }
  // เส้นเล็งจากมุมมอง 3D (มุมจริง) → แปลงเป็นมุมกริดแล้ววาดบนแผนที่
  window.TrailProtAddSight = function (lat, lng, trueAz, km, label) {
    var p0 = { lat: lat, lng: lng }, gN = G.gridAzimuth(p0, { lat: lat + 0.01, lng: lng }).az;
    if (gN > 180) gN -= 360;
    prot.sights.push({ p0: p0, az: G.norm360(trueAz + gN), km: km || 5, label: label || '' });
    refreshProt(); return prot.sights.length;
  };
  window.TrailProtClearSights = function () { prot.sights = []; refreshProt(); };

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
    drawProtLines();

    var r = protReadout();
    updatePlate();
    updateLens();

    var card = $('azcard'), wasHidden = card.hidden;
    setTimeout(function () { if (card.hidden !== wasHidden && prefs.grid) updateGrid(); }, 0);
    if (!$('navcard').hidden || !$('routecard').hidden) { card.hidden = true; return; }
    if (!prot.on) { card.hidden = true; return; }
    card.hidden = false;
    applyCardPos();
    if (!r) {
      card.innerHTML = '<div>' + (prot.a ? 'แตะแผนที่เพื่อวางจุด B' : 'แตะแผนที่เพื่อวางจุด A') + '</div>' + lensLine() + plateButtons();
      bindPlateButtons();
      return;
    }
    var hidden = prot.hide && !prot.revealed;
    var q = function (v) { return hidden ? '???' : v; };
    // การ์ดแบบกะทัดรัด: แถวแรกค่าหลัก + ปุ่มย่อ/ขยาย · รายละเอียดและปุ่มซ่อนได้
    card.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span class="lbl">A→B</span><span class="big" style="font-size:18px"></span>' +
      '<span id="azDist" style="color:#333"></span><button id="azMini" class="btn alt" style="margin-left:auto;flex:none;padding:2px 10px;font-size:13px">' + (prot.mini ? '▴ ขยาย' : '▾ ย่อ') + '</button></div>' +
      (prot.mini ? lensLine() : '<div style="font-size:12.5px;color:#444"><span id="azBack"></span> · <span id="azTrue"></span> · <span id="azMag"></span></div>' + linesBlock() + lensLine() +
        (prot.hide ? '<div class="btnrow" style="margin-top:4px"><button class="btn alt" id="azReveal" style="flex:none;padding:4px 10px;font-size:13px">' + (prot.revealed ? 'ซ่อนค่า' : 'เฉลย') + '</button></div>' : '') +
        plateButtons());
    bindPlateButtons();
    card.querySelector('.big').textContent = q(r.az.toFixed(1) + '° (' + Math.round(r.mil) + ' มิล)');
    $('azDist').textContent = '· ' + fmtDist(r.dist);
    if ($('azBack')) {
      $('azBack').textContent = 'กลับ ' + q(r.back.toFixed(1) + '° (' + Math.round((r.back * 6400) / 360) + ' มิล)');
      $('azTrue').textContent = 'เหนือจริง ' + q(r.trueAz.toFixed(1) + '°');
      $('azMag').textContent = 'แม่เหล็ก ' + q(r.mag.toFixed(1) + '°') + (prefs.decl ? ' (เบี่ยง ' + prefs.decl + '°)' : '');
    }
    $('azMini').onclick = function () { prot.mini = !prot.mini; refreshProt(); };
    var rev = $('azReveal');
    if (rev) rev.onclick = function () { prot.revealed = !prot.revealed; refreshProt(); };
  }
  function linesBlock() {
    if (!prot.lines.length) return '';
    var hidden = prot.hide && !prot.revealed;
    return '<div style="font-size:12.5px;color:#333;margin-top:2px">' + prot.lines.map(function (l) { var i = lineInfo(l); return i ? '<span style="color:' + (PCOL[(l.b || 'c').toLowerCase()] || '#1a6ad6') + ';font-weight:700">' + l.a + '→' + l.b + (l.km ? '⟶' : '') + '</span> ' + (hidden ? '???' : i.az.toFixed(1) + '°') + ' ' + (i.dist / 1000).toFixed(2) + ' กม.' : ''; }).join(' · ') + '</div>';
  }
  function lensLine() {
    if (!lens.placed) return '';
    var hidden = prot.hide && !prot.revealed, mag = G.norm360(lens.th - (prefs.decl || 0));
    return '<div style="font-size:13px">🧭 เข็มทิศ <b style="color:#c8102e;font-size:16px">' + (hidden ? '???' : mag.toFixed(1) + '°') + '</b> ' + (hidden ? '' : Math.round(mag * 6400 / 360) + ' มิล') + '</div>';
  }

  function plateButtons() {
    var st = 'flex:none;padding:4px 9px;font-size:12.5px';
    return '<div class="btnrow" style="margin-top:4px;flex-wrap:wrap;gap:5px">' + lensSection(st) + (prot.a ? plateSection(st) : '') + '</div>';
  }
  function lensSection(st) {
    if (!lens.placed) return '<button class="btn alt" id="lnPlace" style="' + st + '">🧭 วางเข็มทิศ</button>';
    return '<button class="btn' + (lens.locked ? '' : ' alt') + '" id="lnLock" style="' + st + '">' + (lens.locked ? '🔒 ปลดล็อค🧭' : '🔓 ล็อค🧭') + '</button>' +
      (prot.a && prot.b ? '<button class="btn alt" id="lnAim" style="' + st + '">🧭→B</button>' : '') +
      (prot.a ? '<button class="btn alt" id="lnToA" style="' + st + '">🧭→A</button>' : '') +
      '<button class="btn alt" id="lnRemove" style="' + st + '">เก็บ🧭</button>';
  }
  function plateSection(st) {
    if (!prot.placed) return '<button class="btn alt" id="plPlace" style="' + st + '">📐 วางแผ่น</button>';
    return '<button class="btn' + (prot.locked ? '' : ' alt') + '" id="plLock" style="' + st + '">' + (prot.locked ? '🔒 ปลดล็อค📐' : '🔓 ล็อค📐') + '</button>' +
      (prot.rot ? '<button class="btn alt" id="plNorth" style="' + st + '">📐↑เหนือ</button>' : '') +
      (prot.follow ? '' : '<button class="btn alt" id="plBack" style="' + st + '">📐→A</button>') +
      '<button class="btn alt" id="plRemove" style="' + st + '">เก็บ📐</button>';
  }
  function bindPlateButtons() {
    var b;
    if ((b = $('plPlace'))) b.onclick = function () { prot.placed = true; prot.follow = true; prot.locked = false; refreshProt(); toast('ลาก ✥ เลื่อนแผ่น · ลาก ⟳ (มุมขวาบน) หมุน · 📐🔒 ล็อค'); };
    if ((b = $('plLock'))) b.onclick = function () { prot.locked = !prot.locked; if (prot.locked && prot.follow && prot.a) { prot.follow = false; prot.platePos = { lat: prot.a.lat, lng: prot.a.lng }; } refreshProt(); toast(prot.locked ? 'ล็อคแผ่นวัดมุมแล้ว เลื่อนไม่ได้จนกว่าจะปลดล็อค' : 'ปลดล็อคแล้ว ลาก ✥ เพื่อเลื่อนแผ่น'); };
    if ((b = $('plBack'))) b.onclick = function () { prot.follow = true; refreshProt(); };
    if ((b = $('plRemove'))) b.onclick = function () { prot.placed = false; refreshProt(); };
    if ((b = $('plNorth'))) b.onclick = function () { prot.rot = 0; refreshProt(); };
    if ((b = $('lnPlace'))) b.onclick = function () { placeLens(); toast('ลาก ✥ (ห่วงด้านหลัง) เลื่อน · ลาก ⟳ (ปลายฝา) หมุน · 🔒 ล็อค'); };
    if ((b = $('lnLock'))) b.onclick = function () { lens.locked = !lens.locked; refreshProt(); toast(lens.locked ? 'ล็อคเข็มทิศแล้ว' : 'ปลดล็อคแล้ว ลาก ✥ เลื่อน · ลาก ⟳ หมุน'); };
    if ((b = $('lnAim'))) b.onclick = function () { lens.th = Math.round(G.gridAzimuth(lens.c || prot.a, prot.b).az * 10) / 10; refreshProt(); };
    if ((b = $('lnToA'))) b.onclick = function () { lens.c = { lat: prot.a.lat, lng: prot.a.lng }; refreshProt(); };
    if ((b = $('lnRemove'))) b.onclick = function () { lens.placed = false; refreshProt(); };
  }

  function setProtOn(on) {
    prot.on = on;
    $('toolProt').classList.toggle('on', on);
    if (prot.markA) prot.markA.getElement().style.display = on ? '' : 'none';
    if (prot.markB) prot.markB.getElement().style.display = on ? '' : 'none';
    Object.keys(prot.exm).forEach(function (k) { prot.exm[k].getElement().style.display = on ? '' : 'none'; });
    if (!on && prot.handle) { prot.handle.remove(); prot.handle = null; }
    if (!on) { syncRotHandle(null); lensHandles(false); }
    if (on && pinMarker) { pinMarker.remove(); pinMarker = null; pinPos = null; updateCoord(); }
    refreshProt();
  }

  function clearProt() {
    if (prot.markA) prot.markA.remove();
    if (prot.markB) prot.markB.remove();
    prot.a = prot.b = prot.markA = prot.markB = null;
    Object.keys(prot.exm).forEach(function (k) { prot.exm[k].remove(); }); prot.exm = {}; prot.ex = {}; prot.lines = [];
    prot.placed = false; prot.follow = true; prot.platePos = null; prot.locked = false; prot.rot = 0;
    prot.revealed = false;
    refreshProt();
  }

  /* ---------- โหมดหน้าจอ ---------- */
  var NV = 'grayscale(1) sepia(1) hue-rotate(-35deg) saturate(6) ';
  var DISPLAYS = {
    day: { icon: '☀', name: 'กลางวัน', sub: 'สีปกติ', f: function (b) { return b < 1 ? 'brightness(' + b + ')' : 'none'; } },
    night: { icon: '☾', name: 'กลางคืน', sub: 'หรี่แสงและโทนอุ่น ถนอมสายตา', f: function (b) { return 'brightness(' + (b * 0.65).toFixed(2) + ') sepia(0.35) saturate(0.75)'; } },
    nv: { icon: '◉', name: 'ไนท์วิชชั่น', sub: 'แสงแดงล้วน ไม่ทำให้ตาปรับความมืดเสีย', f: function (b) { return NV + 'brightness(' + (b * 0.8).toFixed(2) + ')'; } },
    mono: { icon: '◐', name: 'ขาวดำ', sub: 'ดูความต่างระดับ/รูปร่างชัด ประหยัดแบตจอ OLED', f: function (b) { return 'grayscale(1) contrast(1.2) brightness(' + b + ')'; } },
    stealth: { icon: '☗', name: 'พรางตัว', sub: 'แดงมืดสุด แสงลอดน้อย และปิดเสียงทั้งหมด', f: function (b) { return NV + 'brightness(' + (b * 0.3).toFixed(2) + ')'; } }
  };
  function applyDisplay() {
    var d = DISPLAYS[prefs.display] || DISPLAYS.day;
    var b = Math.max(0.2, Math.min(1, (prefs.bright || 100) / 100));
    document.documentElement.style.filter = d.f(b);
    var muted = prefs.mute || prefs.display === 'stealth';
    if ($('dispBtn')) $('dispBtn').textContent = d.icon;
    if ($('muteBtn')) $('muteBtn').textContent = muted ? '🔇' : '🔊';
    if (muted) { try { speechSynthesis.cancel(); } catch (e) { /* ไม่เป็นไร */ } }
  }
  function cycleDisplay() {
    var keys = Object.keys(DISPLAYS);
    prefs.display = keys[(keys.indexOf(prefs.display) + 1) % keys.length];
    savePrefs(); applyDisplay();
    toast('โหมดหน้าจอ: ' + DISPLAYS[prefs.display].name);
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
    var title = kind === 'layers' ? 'ชั้นแผนที่และหน้าจอ' : kind === 'grid' ? 'พิกัดและตารางกริด' : kind === 'special' ? 'หมวดพิเศษ' : kind === 'route' ? 'เส้นทางและนำทาง' : kind === 'sky' ? 'ดวงดาวนำทาง' : kind === 'mil' ? 'สัญลักษณ์ทหารและพิมพ์แผนที่ฝึก' : kind === 'struct' ? 'สร้างตึก/สถานโบราณ 3 มิติ' : kind === 'proj' ? 'งาน (เส้นทาง · สัญลักษณ์ · หมุด · สิ่งปลูกสร้าง)' : kind === 'snd' ? 'ฟังเสียง (วิเคราะห์ชนิดและระยะ)' : kind === 'wind' ? 'ทิศทางและความเร็วลม' : kind === 'jump' ? 'โหมดโดดร่ม (วางแผน/ฝึก)' : kind === 'search' ? 'ค้นหา' : kind === 'v3d' ? 'มุมมอง 3D' : kind === 'rec' ? 'บันทึกการเดินทาง' : kind === 'team' ? 'ทีมเดินป่า' : 'วัดมุมด้วยแผ่นวัดมุม';
    sh.innerHTML = '<div class="shead"><h3></h3><button id="sheetClose">ปิด</button></div><div id="sheetBody"></div>';
    sh.querySelector('h3').textContent = title;
    $('sheetClose').onclick = closeSheet;
    $('toolLayers').classList.toggle('on', kind === 'layers');
    if (kind === 'layers') renderLayersSheet();
    else if (kind === 'grid') renderGridSheet();
    else if (kind === 'special') TrailPaper.renderSheet($('sheetBody'));
    else if (kind === 'route') TrailNav.renderSheet($('sheetBody'));
    else if (kind === 'sky') TrailSky.renderSheet($('sheetBody'));
    else if (kind === 'mil') TrailSym.renderSheet($('sheetBody'));
    else if (kind === 'proj') TrailProj.renderSheet($('sheetBody'));
    else if (kind === 'struct') TrailStruct.renderSheet($('sheetBody'));
    else if (kind === 'snd') TrailSound.renderSheet($('sheetBody'));
    else if (kind === 'wind') TrailWind.renderSheet($('sheetBody'));
    else if (kind === 'jump') TrailJump.renderSheet($('sheetBody'));
    else if (kind === 'search') TrailSearch.renderSheet($('sheetBody'));
    else if (kind === 'v3d') TrailView3D.renderSheet($('sheetBody'));
    else if (kind === 'rec') TrailRec.renderSheet($('sheetBody'));
    else if (kind === 'team') TrailTeam.renderSheet($('sheetBody'));
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

  // อาคาร 3 มิติ: เปิดแล้วเอียงแผนที่ให้เห็นทรง (ถ้ายังมองตรงจากด้านบน)
  function applyBld3d(tilt) {
    if (!map || !map.getLayer('building-3d')) return;
    map.setLayoutProperty('building-3d', 'visibility', prefs.bld3d ? 'visible' : 'none');
    if (prefs.bld3d && tilt && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 700 });
  }
  function renderLayersSheet() {
    var h = '<h4>โหมดหน้าจอ</h4>' +
      Object.keys(DISPLAYS).map(function (k) { return radio('disp', k, DISPLAYS[k].icon + ' ' + DISPLAYS[k].name, DISPLAYS[k].sub, prefs.display === k); }).join('') +
      '<div class="field"><label>ความสว่าง</label><input type="range" id="dispBright" min="20" max="100" step="5" value="' + prefs.bright + '" style="flex:1"></div>' +
      check('dispMute', 'ปิดเสียง', 'ไม่พูดแจ้งเตือนนำทาง (โหมดพรางตัวปิดเสียงให้อัตโนมัติ)', prefs.mute) +
      '<div class="btnrow"><button class="btn alt" id="fullBtn">' + (document.fullscreenElement || document.webkitFullscreenElement ? 'ออกจากเต็มจอ' : '⛶ เต็มจอ (ซ่อนแถบที่อยู่เว็บ)') + '</button></div>' +
      '<p class="note" style="margin-top:2px">คอมพิวเตอร์: กด F11 ก็ได้ หรือติดตั้งเป็นแอพ (Edge/Chrome เมนู ⋯ → แอพ → ติดตั้งไซต์นี้เป็นแอพ) จะเปิดเป็นหน้าต่างแยกไม่มีแถบที่อยู่ · iPhone: Safari ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดจากไอคอน</p>' +
      '<h4>แผนที่พื้นหลัง</h4>' +
      radio('base', 'trail', 'แผนที่เดินป่า', 'ทางเดินเท้า ป่า น้ำ เงาภูเขา ยอดเขา ซูมเห็นอาคาร/ชื่อถนน', prefs.base === 'trail') +
      radio('base', 'sat', 'ภาพถ่ายดาวเทียม', 'ซูมได้ละเอียดสุด · ดาวน์โหลดเก็บไว้ใช้ออฟไลน์ได้', prefs.base === 'sat') +
      radio('base', 'topo', 'ภูมิประเทศ (เส้นชั้นความสูง)', 'แผนที่ตามแบบ topo · ดาวน์โหลดเก็บไว้ใช้ออฟไลน์ได้', prefs.base === 'topo') +
      radio('base', 'paper', 'แผนที่กระดาษ (ที่นำเข้า)', 'แสดงเฉพาะแผนที่กระดาษที่นำเข้าไว้ ใช้ออฟไลน์ได้ · นำเข้าที่ปุ่ม ★ พิเศษ', prefs.base === 'paper') +
      '<h4>เส้นชั้นความสูง</h4>' +
      check('ovBld3d', 'อาคาร 3 มิติ', 'ยกตึก/บ้านขึ้นเป็นทรง 3 มิติ ซูม 14 ขึ้นไป (ใช้ได้ทับภาพดาวเทียม) · ความสูงมาจากข้อมูลที่คนเพิ่มใน OpenStreetMap ถ้าไม่มีจะสมมุติ 6 ม. · บริเวณที่ไม่มีข้อมูลอาคารจะไม่มีตึก', prefs.bld3d) +
      check('ovContour', 'เส้นชั้นความสูง 20 ม.', 'ซูม 13 ขึ้นไปเป็นเส้นละ 20 ม. เส้นหนาทุก 100 ม. มีตัวเลข · ซูมออกระยะห่างเพิ่มเองให้อ่านออก · ใช้ข้อมูลความสูงละเอียดราว 30-40 ม. ที่ราบจะไม่เนียน', prefs.contour) +
      '<h4>ซ้อนทับ (ต้องมีอินเทอร์เน็ต)</h4>' +
      check('ovWeather', 'สภาพอากาศ: เรดาร์ฝน', 'ข้อมูลล่าสุดจาก RainViewer', prefs.weather === 'radar') +
      check('ovTraffic', 'การจราจร', 'สีแสดงความหนาแน่นของรถบนถนน', prefs.traffic) +
      '<p class="note">เมื่อกด "ดาวน์โหลดพื้นที่ที่เห็นบนจอ" แอพจะเก็บแผนที่พื้นหลังที่เลือกอยู่ไว้ด้วย ซูมเกินที่เก็บไว้จะขยายภาพจากระดับที่มี</p>';
    $('sheetBody').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=base]'), function (el) {
      el.onchange = function () { prefs.base = el.value; savePrefs(); applyBase(); setDownloadLabel(); };
    });
    $('ovBld3d').onchange = function () { prefs.bld3d = this.checked; savePrefs(); applyBld3d(true); };
    $('ovContour').onchange = function () { prefs.contour = this.checked; savePrefs(); TrailContour.apply(prefs.contour); TrailSpots.setEnabled(prefs.contour); };
    $('ovWeather').onchange = function () { prefs.weather = this.checked ? 'radar' : 'off'; savePrefs(); applyWeather(); };
    $('ovTraffic').onchange = function () { prefs.traffic = this.checked; savePrefs(); applyTraffic(); };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=disp]'), function (el) {
      el.onchange = function () { prefs.display = el.value; savePrefs(); applyDisplay(); };
    });
    $('dispBright').oninput = function () { prefs.bright = parseInt(this.value, 10) || 100; savePrefs(); applyDisplay(); };
    $('dispMute').onchange = function () { prefs.mute = this.checked; savePrefs(); applyDisplay(); };
    $('fullBtn').onclick = function () {
      var d = document, el = d.documentElement, isFull = d.fullscreenElement || d.webkitFullscreenElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen, ex = d.exitFullscreen || d.webkitExitFullscreen;
      if (isFull) { if (ex) ex.call(d); }
      else if (req) { try { var r = req.call(el); if (r && r.catch) r.catch(function () { toast('เบราว์เซอร์นี้ไม่ให้เต็มจอ ลองกด F11 หรือเพิ่มไปยังหน้าจอโฮม'); }); } catch (e) { toast('เบราว์เซอร์นี้ไม่ให้เต็มจอ'); } }
      else toast('iPhone ไม่รองรับปุ่มเต็มจอ: Safari ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม แล้วเปิดจากไอคอน จะไม่มีแถบที่อยู่');
      setTimeout(function () { var b = $('fullBtn'); if (b) b.textContent = d.fullscreenElement || d.webkitFullscreenElement ? 'ออกจากเต็มจอ' : '⛶ เต็มจอ (ซ่อนแถบที่อยู่เว็บ)'; }, 400);
    };
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
    var isUTM = prefs.fmt === 'mgrs' || prefs.fmt === 'utm';
    var utmOpts = [['auto', 'อัตโนมัติตามซูม'], [10000, '10 กม. · 1 หลัก (เช่น QA 1 6)'], [1000, '1 กม. · 2 หลัก (เช่น QA 12 67)'], [500, '500 ม.'], [100, '100 ม. · 3 หลัก (เช่น QA 123 678)'], [50, '50 ม.'], [10, '10 ม. · 4 หลัก (เช่น QA 1234 6789)']];
    h += '<div id="utmBox"' + (isUTM ? '' : ' hidden') + '><h4>ระยะห่างเส้นกริด UTM/MGRS (จำนวนหลัก)</h4><div class="field"><select id="utmStep" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      utmOpts.map(function (o) { return '<option value="' + o[0] + '"' + (String(prefs.utmStep || 'auto') === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div><p class="note" style="margin-top:2px">จำนวนหลักต่อค่า (ตะวันออก/เหนือ): 1 หลัก = 10 กม. · 2 หลัก = 1 กม. · 3 หลัก = 100 ม. · 4 หลัก = 10 ม. ใช้กับเส้นกริดและตัวเลขบนเส้นเท่านั้น · ซูมออกมากจะแสดงทุก ๆ 2, 5, 10 เส้น</p>' +
      '<h4>จำนวนหลักพิกัด MGRS ที่มุมซ้ายบน (แยกจากเส้นกริด)</h4><div class="field"><select id="coordDigits" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      [[5, '5 หลัก · 1 ม. (เหมือนเดิม)'], [4, '4 หลัก · 10 ม.'], [3, '3 หลัก · 100 ม.'], [2, '2 หลัก · 1 กม.'], [1, '1 หลัก · 10 กม.']].map(function (o) { return '<option value="' + o[0] + '"' + ((+prefs.coordDigits || 5) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>';
    var stepOpts = [['auto', 'อัตโนมัติตามซูม'], [1, '1 ฟิลิปดา'], [5, '5 ฟิลิปดา'], [10, '10 ฟิลิปดา'], [30, '30 ฟิลิปดา'], [60, '1 ลิปดา'], [120, '2 ลิปดา'], [300, '5 ลิปดา'], [600, '10 ลิปดา'], [900, '15 ลิปดา'], [1800, '30 ลิปดา'], [3600, '1 องศา']];
    h += '<div id="llBox"' + (isUTM ? ' hidden' : '') + '><h4>ระยะห่างเส้นละติจูด/ลองจิจูด</h4><div class="field"><select id="llStep" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' +
      stepOpts.map(function (o) { return '<option value="' + o[0] + '"' + (String(prefs.llStep || 'auto') === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div><p class="note" style="margin-top:2px">ใช้กับรูปแบบ องศา-ลิปดา-ฟิลิปดา / องศา-ลิปดา / องศาทศนิยม (UTM/MGRS ใช้ระยะเป็นเมตรอัตโนมัติ) · ถ้าซูมออกจนเส้นถี่เกินไป จะแสดงทุก ๆ 2, 5, 10 เส้นของระยะที่เลือก</p></div>';
    h += '<p class="note">แตะแผนที่เพื่อปักหมุดดูพิกัดของจุดนั้น แตะที่เดิมอีกครั้งเพื่อลบ · จุดกึ่งกลางจอ (กากบาทแดง) แสดงพิกัดที่มุมซ้ายบนตลอดเวลา · UTM/MGRS ใช้ datum WGS84</p>';
    $('sheetBody').innerHTML = h;
    $('gridOn').onchange = function () {
      prefs.grid = this.checked; savePrefs(); updateGrid();
    };
    $('llStep').onchange = function () {
      prefs.llStep = this.value === 'auto' ? 'auto' : +this.value; savePrefs();
      if (!prefs.grid) { prefs.grid = true; $('gridOn').checked = true; $('toolGrid').classList.toggle('on', true); }
      updateGrid();
    };
    $('coordDigits').onchange = function () { prefs.coordDigits = +this.value; savePrefs(); updateCoord(); };
    $('utmStep').onchange = function () {
      prefs.utmStep = this.value === 'auto' ? 'auto' : +this.value; savePrefs();
      if (!prefs.grid) { prefs.grid = true; $('gridOn').checked = true; $('toolGrid').classList.toggle('on', true); }
      updateGrid(); updateCoord();
    };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=fmt]'), function (el) {
      el.onchange = function () { prefs.fmt = el.value; savePrefs(); updateGrid(); updateCoord(); var u2 = el.value === 'mgrs' || el.value === 'utm'; $('utmBox').hidden = !u2; $('llBox').hidden = u2; };
    });
  }

  function renderProtSheet() {
    var h = '<div class="btnrow"><button class="btn" id="protToggle">' + (prot.on ? 'ปิดแผ่นวัดมุม' : 'เปิดแผ่นวัดมุม') + '</button>' +
      '<button class="btn alt" id="protClear">ล้างจุด</button></div>' +
      '<p class="note">วิธีใช้: แตะแผนที่วางจุด A แล้วแตะวางจุด B ลากหมุดเพื่อปรับ จากนั้นกด "📐 วางแผ่นวัดมุม" ในการ์ดด้านล่าง (ลาก ✥ เพื่อเลื่อนแผ่น กดล็อคเพื่อไม่ให้เลื่อน) แผ่นวัดมุมสี่เหลี่ยม 1:50,000 (5 กม. × 5 กม.) จะวางทับตามขนาดจริงของมาตราส่วน หันเหนือกริดเสมอ ซูมเข้าให้เห็นสเกลแล้วอ่านมุมที่เส้นประส้มตัดขอบแผ่น เทียบกับค่าที่แอพคำนวณ</p>' +
      '<h4>จำนวนจุด และการแสดง</h4>' +
      '<div class="field"><label for="protN">จำนวนจุด</label><select id="protN" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' + [2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '"' + (prot.n === n ? ' selected' : '') + '>' + n + ' จุด (A–' + LETTERS[n - 1] + ')</option>'; }).join('') + '</select></div>' +
      radio('player', 'top', 'จุดและเส้น อยู่บนสุด', 'เห็นชัด ทับแผ่นวัดมุม/เข็มทิศ', !prot.under) +
      radio('player', 'under', 'จุดและเส้น อยู่ใต้แผ่นวัดมุม/เข็มทิศ', 'อ่านสเกลบนแผ่นได้ไม่ถูกบัง (หมุดจางลงขณะวางแผ่น)', prot.under) +
      radio('pcard', 'bottom', 'การ์ดค่ามุม อยู่ด้านล่างจอ', '', !prot.cardTop) +
      radio('pcard', 'top', 'การ์ดค่ามุม อยู่ด้านบนจอ', 'เมื่อแผ่นหรือเข็มทิศอยู่ครึ่งล่างของจอ', prot.cardTop) +
      '<h4>ลากเส้นระหว่างจุด</h4>' +
      '<div class="field" style="gap:6px"><select id="plA" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' + LETTERS.slice(0, prot.n).split('').map(function (L) { return '<option>' + L + '</option>'; }).join('') + '</select><span>→</span><select id="plB" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff">' + LETTERS.slice(0, prot.n).split('').map(function (L, i) { return '<option' + (i === 1 ? ' selected' : '') + '>' + L + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="plKm">แบบเส้น</label><select id="plKm" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff"><option value="0">จากจุดถึงจุด</option><option value="5">ลากเลยจุด ยาว 5 กม.</option><option value="10">ลากเลยจุด ยาว 10 กม.</option><option value="15">ลากเลยจุด ยาว 15 กม.</option><option value="20">ลากเลยจุด ยาว 20 กม.</option></select></div>' +
      '<div class="btnrow"><button class="btn" id="plAdd">＋ เพิ่มเส้น</button><button class="btn alt" id="plClr">ลบเส้นทั้งหมด</button>' + (prot.sights.length ? '<button class="btn alt" id="plSClr">ลบเส้นเล็ง 3D (' + prot.sights.length + ')</button>' : '') + '</div>' +
      '<div id="plList"></div>' +
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
    $('protN').onchange = function () {
      prot.n = +this.value;
      LETTERS.slice(prot.n).toLowerCase().split('').forEach(function (k) { if (prot.exm[k]) { prot.exm[k].remove(); delete prot.exm[k]; delete prot.ex[k]; } });
      prot.lines = prot.lines.filter(function (l) { return LETTERS.indexOf(l.a) < prot.n && LETTERS.indexOf(l.b) < prot.n; });
      refreshProt(); renderProtSheet();
      if (nextLetter() && prot.b) toast('แตะแผนที่วางจุด ' + nextLetter());
    };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=player]'), function (el) { el.onchange = function () { prot.under = el.value === 'under'; applyProtLayerOrder(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('input[name=pcard]'), function (el) { el.onchange = function () { prot.cardTop = el.value === 'top'; applyCardPos(); }; });
    function renderLineList() {
      var box = $('plList'); if (!box) return;
      box.innerHTML = '';
      prot.lines.forEach(function (l, i) {
        var inf = lineInfo(l), row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #eee;font-size:14px';
        row.innerHTML = '<span style="flex:1"><b style="color:' + (PCOL[l.b.toLowerCase()] || '#1a6ad6') + '">' + l.a + '→' + l.b + '</b> ' + (l.km ? 'ยืด ' + l.km + ' กม.' : '') + (inf ? ' · ' + (prot.hide && !prot.revealed ? '???' : inf.az.toFixed(1) + '° (' + Math.round(inf.az * 6400 / 360) + ' มิล)') + ' · ' + fmtDist(inf.dist) : ' · (ยังไม่ได้วางจุด)') + '</span>';
        var del = document.createElement('button'); del.className = 'btn alt'; del.style.cssText = 'flex:none;padding:4px 10px;font-size:13px'; del.textContent = 'ลบ';
        del.onclick = function () { prot.lines.splice(i, 1); refreshProt(); renderLineList(); };
        row.appendChild(del); box.appendChild(row);
      });
    }
    renderLineList();
    $('plAdd').onclick = function () {
      var a = $('plA').value, b = $('plB').value, km = +$('plKm').value;
      if (a === b) { toast('เลือกจุดปลายคนละจุด'); return; }
      prot.lines.push({ a: a, b: b, km: km });
      if (!prot.on) setProtOn(true);
      refreshProt(); renderLineList();
      if (!ptOf(a) || !ptOf(b)) toast('เส้นจะขึ้นเมื่อวางจุด ' + a + ' และ ' + b + ' แล้ว');
    };
    $('plClr').onclick = function () { prot.lines = []; refreshProt(); renderLineList(); };
    if ($('plSClr')) $('plSClr').onclick = function () { prot.sights = []; refreshProt(); renderProtSheet(); };
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
    btn.textContent = '⬇ ออฟไลน์' + (prefs.base === 'trail' || prefs.base === 'paper' ? '' : ' +' + BASE_NAMES[prefs.base]);
  }

  async function downloadArea() {
    if (downloading || !map || !vectorTpl) return;
    var base = prefs.base === 'paper' ? 'trail' : prefs.base; // แผนที่กระดาษอยู่ในเครื่องอยู่แล้ว ดาวน์โหลดเฉพาะแผนที่เดินป่า + ความสูง
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
    var nm = prompt('ตั้งชื่อแผนที่ที่ดาวน์โหลดนี้', defaultName());
    var area = { id: id, name: (nm && nm.trim()) || defaultName(), bounds: bounds, tiles: keys.length, failed: failed, base: base };
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
    btn.textContent = '⬇ ' + Math.round((done / total) * 100) + '%';
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
      var ren = document.createElement('button');
      ren.className = 'del';
      ren.style.color = '#2e6b3f';
      ren.textContent = 'ชื่อ';
      ren.onclick = function () {
        var n = prompt('ชื่อแผนที่', a.name);
        if (n === null || !n.trim()) return;
        var all = loadAreas();
        all.forEach(function (x) { if (x.id === a.id) x.name = n.trim(); });
        saveAreas(all);
        renderAreas();
      };
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = 'ลบ';
      del.onclick = function () { removeArea(a); };
      row.appendChild(info);
      row.appendChild(ren);
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

  /* ---------- แถบสถานะ GPS ---------- */
  var sbMsg = null, sbEle = null, sbEleAt = null;
  function signalBars(acc) {
    if (acc === null || acc === undefined) return ['', '#999'];
    if (acc <= 5) return ['▂▄▆█', '#1f9d4a'];
    if (acc <= 15) return ['▂▄▆', '#1f9d4a'];
    if (acc <= 40) return ['▂▄', '#e08a00'];
    if (acc <= 100) return ['▂', '#d6261c'];
    return ['·', '#d6261c'];
  }
  function updateStatus() {
    var l1 = $('sb1'), l2 = $('sb2');
    if (!l1) return;
    var f = TrailSensors.state.fix;
    if (!f) { l1.textContent = sbMsg || 'GPS: แตะปุ่มตำแหน่ง (◎) เพื่อเริ่ม'; l2.textContent = ''; return; }
    sbMsg = null;
    if (!sbEleAt || G.haversine(sbEleAt, f) > 30) {
      sbEleAt = { lat: f.lat, lng: f.lng };
      TrailRoute.elevAsync(f.lat, f.lng).then(function (v) { sbEle = v; updateStatus(); }).catch(function () {});
    }
    var sb = signalBars(f.acc);
    var age = Math.round((Date.now() - f.t) / 1000);
    var alt = [];
    if (f.alt !== null && f.alt !== undefined) alt.push('GPS ' + Math.round(f.alt) + (f.altAcc ? '±' + Math.round(f.altAcc) : ''));
    if (sbEle !== null) alt.push('แผนที่ ' + Math.round(sbEle));
    var h = TrailSensors.moveHeading();
    l1.innerHTML = '<span style="color:' + sb[1] + '">●</span> ±' + (f.acc ? Math.round(f.acc) : '–') + ' ม. <span class="bars" style="color:' + sb[1] + '">' + sb[0] + '</span>' +
      (alt.length ? ' · สูง ' + alt.join(' / ') + ' ม.' : '') +
      ' · ' + (typeof f.speed === 'number' && f.speed >= 0 ? (f.speed * 3.6).toFixed(1) : '–') + ' กม./ชม.' +
      (h !== null ? ' · ทิศ ' + Math.round(h) + '°' : '') +
      (age > 10 ? ' · <b style="color:#d6261c">ไม่อัปเดต ' + age + ' วิ</b>' : '');
    l2.textContent = G.formatPoint(f.lat, f.lng, prefs.fmt);
  }

  /* ---------- ปุ่มล็อกทิศเหนือ / หมุนตามทิศที่เดิน ---------- */
  function OrientControl() {}
  OrientControl.prototype.onAdd = function () {
    var d = document.createElement('div');
    d.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'orientBtn';
    b.style.fontWeight = '700';
    b.style.fontSize = '14px';
    b.onclick = toggleOrient;
    d.appendChild(b);
    this._c = d;
    return d;
  };
  OrientControl.prototype.onRemove = function () { this._c.remove(); };
  function applyOrient() {
    if (!map) return;
    if (prefs.orient === 'north') {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.rotateTo(0, { duration: 300 });
    } else {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
    }
    var b = $('orientBtn');
    if (b) {
      b.textContent = prefs.orient === 'north' ? 'N' : '↑';
      b.style.color = prefs.orient === 'north' ? '#d00' : '#1a6ad6';
      b.title = prefs.orient === 'north' ? 'ล็อกทิศเหนือ' : 'หมุนตามทิศที่เดิน';
    }
  }
  function toggleOrient() {
    prefs.orient = prefs.orient === 'north' ? 'free' : 'north';
    savePrefs();
    if (prefs.orient === 'free') {
      TrailSensors.start().then(function (ok) { if (!ok) toast('ใช้ทิศจากการเดินเท่านั้น (ไม่ได้สิทธิ์เข็มทิศ)'); });
    }
    applyOrient();
    toast(prefs.orient === 'north' ? 'ล็อกทิศเหนือ' : 'แผนที่หมุนตามทิศที่เดิน (ใช้เข็มทิศเมื่อหยุดเดิน)');
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

  // ตรวจเวอร์ชันใหม่บนเว็บ (iPhone ที่เพิ่มลงหน้าจอโฮมมักไม่ตรวจเอง): อ่าน common.js ตรงจากเน็ต เทียบเลขเวอร์ชัน
  var lastCheck = 0;
  function verNum(v) { return parseInt(String(v).replace(/[^0-9]/g, ''), 10) || 0; }
  function checkUpdate() {
    if (!navigator.onLine || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    navigator.serviceWorker && navigator.serviceWorker.getRegistration && navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); }).catch(function () {});
    fetch('./common.js?__v=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      var m = /APP_VERSION = '([^']+)'/.exec(t || '');
      if (m && verNum(m[1]) > verNum(C.APP_VERSION)) showUpdateBar(m[1]);
    }).catch(function () {});
  }
  function showUpdateBar(v) {
    if (document.getElementById('updBar')) return;
    var b = document.createElement('div'); b.id = 'updBar';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:9999;background:#1b5e20;color:#fff;border-radius:12px;padding:12px 14px;font-size:15px;display:flex;gap:10px;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    b.innerHTML = '<span style="flex:1">มีเวอร์ชันใหม่ ' + v + ' (ตอนนี้ ' + C.APP_VERSION + ')</span><button id="updGo" style="background:#fff;color:#1b5e20;border:0;border-radius:8px;padding:8px 12px;font-size:15px;font-weight:700">อัปเดต</button><button id="updNo" style="background:none;color:#fff;border:0;font-size:18px;padding:4px 6px">✕</button>';
    document.body.appendChild(b);
    document.getElementById('updNo').onclick = function () { b.remove(); };
    document.getElementById('updGo').onclick = function () {
      if (downloading) { toast('รอดาวน์โหลดแผนที่เสร็จก่อนแล้วค่อยอัปเดต'); return; }
      b.firstChild.textContent = 'กำลังอัปเดต…';
      // ล้างที่เก็บไฟล์แอพ (ไม่แตะแผนที่ที่ดาวน์โหลดไว้) แล้วโหลดใหม่จากเน็ต
      var done = function () { location.reload(); };
      Promise.resolve(window.caches ? caches.keys() : []).then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('shell-') === 0; }).map(function (k) { return caches.delete(k); }));
      }).then(function () { return navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : null; })
        .then(function (r) { return r ? r.update() : null; }).catch(function () {}).then(function () { setTimeout(done, 300); });
    };
  }

  async function main() {
    loadPrefs();
    if ($('sbVer')) $('sbVer').textContent = 'เวอร์ชัน ' + C.APP_VERSION + ' · อัปเดต ' + thaiDate(C.APP_DATE);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded || !navigator.serviceWorker.controller) return;
        reloaded = true;
        if (!downloading) location.reload();
      });
    }
    checkUpdate();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdate(); });
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
    $('toolStruct').onclick = function () { TrailStruct.resetEdit(); openSheet('struct'); };
    $('toolSpecial').onclick = function () { openSheet('special'); };
    $('toolRoute').onclick = function () { openSheet('route'); };
    $('searchBtn').onclick = function () { openSheet('search'); };
    $('toolV3d').onclick = function () { openSheet('v3d'); };
    $('toolCam').onclick = function () { TrailCam.open(); };
    $('toolSky').onclick = function () { openSheet('sky'); };
    $('toolMil').onclick = function () { openSheet('mil'); };
    $('toolProj').onclick = function () { openSheet('proj'); };
    $('toolSnd').onclick = function () { openSheet('snd'); };
    $('toolJump').onclick = function () { openSheet('jump'); };
    $('toolRec').onclick = function () { openSheet('rec'); };
    $('toolTeam').onclick = function () { openSheet('team'); };
    function applyLockBtn() {
      var l = TrailLock.locked(), b = $('lockBtn');
      b.textContent = l ? '🔒' : '🔓';
      b.classList.toggle('on', l);
      b.setAttribute('aria-pressed', l ? 'true' : 'false');
      b.title = l ? 'ล็อคอยู่: หมุดและสัญลักษณ์ลากไม่ได้' : 'ปลดล็อค: ลากหมุดและสัญลักษณ์ได้';
    }
    $('lockBtn').onclick = function () {
      TrailLock.set(!TrailLock.locked());
      applyLockBtn();
      toast(TrailLock.locked() ? 'ล็อคแล้ว: หมุดและสัญลักษณ์ขยับไม่ได้' : 'ปลดล็อคแล้ว: ลากหมุดและสัญลักษณ์ได้ (อย่าลืมล็อคกลับ)');
    };
    applyLockBtn();
    $('dispBtn').onclick = cycleDisplay;
    $('muteBtn').onclick = function () {
      if (prefs.display === 'stealth') { toast('โหมดพรางตัวปิดเสียงอยู่ เปลี่ยนโหมดก่อนจึงเปิดเสียงได้'); return; }
      prefs.mute = !prefs.mute; savePrefs(); applyDisplay();
      toast(prefs.mute ? 'ปิดเสียงแล้ว' : 'เปิดเสียงแล้ว');
    };
    applyDisplay();
    $('sb2').onclick = $('sb1').onclick = function () {
      var i = G.FORMATS.indexOf(prefs.fmt);
      prefs.fmt = G.FORMATS[(i + 1) % G.FORMATS.length];
      savePrefs(); updateCoord(); updateGrid(); updateStatus();
    };
    TrailSensors.onFix(updateStatus);
    setInterval(updateStatus, 1000);
    setInterval(function () {
      if (!map || prefs.orient !== 'free') return;
      var h = TrailSensors.moveHeading();
      if (h === null) return;
      var diff = Math.abs(((h - map.getBearing() + 540) % 360) - 180);
      if (diff > 4) map.rotateTo(h, { duration: 400 });
    }, 600);
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
