// มุมมอง 3D: ภูมิประเทศยกระดับตามข้อมูลความสูง + ท้องฟ้า
//  - มุมมองพื้นดิน: ยืนที่จุดหนึ่ง (ความสูงสายตาปรับได้) มองรอบตัว ลากนิ้วเพื่อหันหน้า/ก้มเงย บีบนิ้วเพื่อซูม
//  - มุมมองเอียง 3D: มองจากด้านบนเอียง หมุนด้วยสองนิ้วได้
// ข้อมูลความสูงละเอียดราว 30-40 ม. จึงเห็นรูปทรงเขาและหุบเขาได้ดี แต่ไม่เห็นต้นไม้ อาคาร หรือหินก้อนเล็ก
// ภาพพื้นผิวสมจริงขึ้นเมื่อใช้ภาพดาวเทียมเป็นพื้นหลัง (ต้องดาวน์โหลดไว้ใช้ออฟไลน์)
(function (root) {
  var ctx = null; // { map, toast, getFix: () => {lat,lng}|null, getBase: () => 'trail'|'sat'|..., setBase(b) }
  var st = { mode: null, ex: 1.4, eye: 2, fov: 60, lat: 0, lng: 0, bearing: 0, look: -4, saved: null };
  var gestures = null;
  var hud = null;
  var MIN_FOV = 25, MAX_FOV = 90;
  var LOOK_MIN = -80, LOOK_MAX = -2; // มุมก้มเงยของสายตา (องศา เทียบแนวนอน ลบ = ก้ม) MapLibre เงยเหนือแนวนอนไม่ได้

  var SKY = {
    'sky-color': '#6fa8e6', 'horizon-color': '#d6e7f7', 'fog-color': '#e8eef5',
    'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0.7
  };

  function $(id) { return document.getElementById(id); }
  function init(c) { ctx = c; }
  function active() { return !!st.mode; }

  /* ---------- ภูมิประเทศ ---------- */
  function ensureHillshade3d() {
    var map = ctx.map();
    if (!map.getLayer('hill3d')) {
      map.addLayer({
        id: 'hill3d', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#2b2b22', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#4a4a38' }
      }, map.getLayer('traffic') ? 'traffic' : undefined);
    }
    // ภาพดาวเทียม/ภูมิประเทศไม่มีแสงเงา เติมเงาเขาบางๆ ให้เห็นรูปทรงชัดขึ้น (แผนที่เดินป่ามีเงาเขาอยู่แล้ว)
    map.setLayoutProperty('hill3d', 'visibility', st.mode && ctx.getBase() !== 'trail' ? 'visible' : 'none');
  }

  function terrainOn() {
    var map = ctx.map();
    map.setMaxPitch(90);
    map.setTerrain({ source: 'dem', exaggeration: st.ex });
    try { map.setSky(SKY); } catch (e) { /* ไม่รองรับท้องฟ้า */ }
    // พื้นสีเข้มขึ้นและเงาเขาชัดขึ้นในมุมมอง 3D (พื้นขาวทำให้ไม่เห็นรูปทรง) คืนค่าเดิมเมื่อออก
    if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#cdc7a8');
    if (map.getLayer('hillshade')) map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.9);
    ensureHillshade3d();
  }
  function terrainOff() {
    var map = ctx.map();
    map.setTerrain(null);
    try { map.setSky(null); } catch (e) { /* ไม่เป็นไร */ }
    if (map.getLayer('hill3d')) map.setLayoutProperty('hill3d', 'visibility', 'none');
    if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', '#f1efe6');
    if (map.getLayer('hillshade')) map.setPaintProperty('hillshade', 'hillshade-exaggeration', 0.6);
    map.setMaxPitch(60);
    map.setVerticalFieldOfView(36.87);
  }

  /* ---------- มุมมองพื้นดิน ---------- */
  // ความสูงภูมิประเทศ (หน่วยเมตรที่คูณความเกินจริงแล้ว) ที่จุดหนึ่ง คืน null ถ้าข้อมูลความสูงยังโหลดไม่ถึง
  function elevAt(lng, lat) {
    var e = ctx.map().queryTerrainElevation([lng, lat]);
    return typeof e === 'number' ? e : null;
  }
  function groundElevation() { var e = elevAt(st.lng, st.lat); return e === null ? 0 : e; }
  function offsetLL(lat, lng, brgRad, m) {
    return { lat: lat + m * Math.cos(brgRad) / 111320, lng: lng + m * Math.sin(brgRad) / (111320 * Math.cos(lat * Math.PI / 180)) };
  }

  // วางกล้องที่ตำแหน่งยืน (พื้น + ความสูงสายตา) มองไปตามทิศ st.bearing ก้มเงย st.look
  // MapLibre กำหนดกล้องจาก "จุดกลางจอบนพื้น" เราจึงหาจุดนั้นบนภูมิประเทศจริง (วนซ้ำให้ตรงกับแนวสายตา) แล้วคำนวณมุมและซูมจากระยะกล้องถึงจุดนั้น
  function applyGround() {
    var map = ctx.map();
    if (st.mode !== 'ground') return;
    map.setVerticalFieldOfView(st.fov);
    var ground = elevAt(st.lng, st.lat);
    if (ground === null) return; // ข้อมูลความสูงยังไม่มา รอรอบถัดไป
    var altCam = ground + st.eye, lookRad = -st.look * Math.PI / 180, brg = st.bearing * Math.PI / 180;
    var h = Math.max(3, st.eye / Math.tan(lookRad)), C, Ec = ground, dz, it;
    for (it = 0; it < 5; it++) {
      C = offsetLL(st.lat, st.lng, brg, h);
      var e = elevAt(C.lng, C.lat);
      Ec = e === null ? ground : e;
      dz = Math.max(0.3, altCam - Ec);
      h = Math.min(30000, Math.max(3, dz / Math.tan(lookRad)));
    }
    C = offsetLL(st.lat, st.lng, brg, h);
    var e2 = elevAt(C.lng, C.lat);
    Ec = e2 === null ? ground : e2;
    dz = Math.max(0.3, altCam - Ec);
    var distM = Math.sqrt(h * h + dz * dz), pitch = Math.min(89.5, Math.atan2(h, dz) * 180 / Math.PI);
    var cd = map.transform.cameraToCenterDistance; // พิกเซล
    var zoom = Math.log(cd * 40075016.686 * Math.cos(C.lat * Math.PI / 180) / (distM * 512)) / Math.LN2;
    map.jumpTo({ center: [C.lng, C.lat], zoom: Math.max(0, Math.min(24, zoom)), bearing: st.bearing, pitch: pitch, elevation: Ec });
    updateHud();
  }
  var lastElev = null;
  function onIdle() {
    if (st.mode !== 'ground') return;
    var e = elevAt(st.lng, st.lat);
    if (e !== null && (lastElev === null || Math.abs(e - lastElev) > 0.5)) { lastElev = e; applyGround(); }
  }
  // รอให้ข้อมูลความสูงที่จุดยืนโหลดเสร็จก่อนวางกล้อง
  function whenReady(cb, tries) {
    if (st.mode !== 'ground') return;
    if (elevAt(st.lng, st.lat) !== null || (tries || 0) > 60) { cb(); return; }
    setTimeout(function () { whenReady(cb, (tries || 0) + 1); }, 200);
  }

  function setGestures(on) {
    var map = ctx.map();
    ['dragPan', 'dragRotate', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard', 'touchPitch'].forEach(function (h) {
      if (map[h]) { if (on) map[h].enable(); else map[h].disable(); }
    });
  }

  function bindLook() {
    if (gestures) return;
    var map = ctx.map(), cv = map.getCanvasContainer(), pts = {}, startFov = 0, startDist = 0;
    function count() { return Object.keys(pts).length; }
    function dist() { var k = Object.keys(pts); if (k.length < 2) return 0; var a = pts[k[0]], b = pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
    function down(e) {
      if (st.mode !== 'ground') return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ไม่เป็นไร */ }
      if (count() === 2) { startFov = st.fov; startDist = dist() || 1; }
    }
    function move(e) {
      if (st.mode !== 'ground' || !pts[e.pointerId]) return;
      var p = pts[e.pointerId], dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (count() === 1) {
        var k = st.fov / 60; // ซูมมากหมุนช้าลง
        st.bearing = (st.bearing - dx * 0.25 * k + 360) % 360;
        st.look = Math.max(LOOK_MIN, Math.min(LOOK_MAX, st.look + dy * 0.2 * k));
        applyGround();
      } else if (count() === 2) {
        st.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, startFov * startDist / (dist() || 1)));
        applyGround();
        if ($('v3fov')) $('v3fov').value = Math.round(st.fov);
      }
    }
    function up(e) { delete pts[e.pointerId]; if (count() < 2) { startFov = st.fov; } }
    cv.addEventListener('pointerdown', down, true);
    cv.addEventListener('pointermove', move, true);
    cv.addEventListener('pointerup', up, true);
    cv.addEventListener('pointercancel', up, true);
    // ป้องกันแผนที่ได้รับอีเวนต์ลากในโหมดพื้นดิน
    ['touchstart', 'touchmove'].forEach(function (n) { cv.addEventListener(n, function (e) { if (st.mode === 'ground') e.preventDefault(); }, { passive: false, capture: true }); });
    gestures = { cv: cv };
  }

  /* ---------- แถบควบคุมบนจอ ---------- */
  function makeHud() {
    if (hud) return;
    hud = document.createElement('div');
    hud.id = 'v3dHud';
    hud.style.cssText = 'position:fixed;left:10px;top:calc(env(safe-area-inset-top) + 10px);z-index:9;display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none;max-width:calc(100vw - 80px)';
    hud.innerHTML = '<div id="v3dInfo" style="background:rgba(0,0,0,.6);color:#fff;border-radius:16px;padding:6px 12px;font-size:13px"></div>' +
      '<div style="display:flex;gap:6px;pointer-events:auto"><button class="v3b" id="v3Back">◀ ถอย</button><button class="v3b" id="v3Fwd">ก้าว ▶</button><button class="v3b" id="v3Set">⚙ ตั้งค่า</button><button class="v3b" id="v3Exit">✕ ออก</button></div>';
    document.body.appendChild(hud);
    var css = document.createElement('style');
    css.textContent = '.v3b{border:0;background:rgba(255,255,255,.92);border-radius:16px;padding:7px 11px;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.35);color:#222}';
    document.head.appendChild(css);
    $('v3Back').onclick = function () { stepMove(-100); };
    $('v3Fwd').onclick = function () { stepMove(100); };
    $('v3Set').onclick = function () { ctx.showSheet('v3d'); };
    $('v3Exit').onclick = exit;
  }
  function updateHud() {
    var i = $('v3dInfo');
    if (!i) return;
    var dirs = ['เหนือ', 'ตอ.เฉียงเหนือ', 'ตะวันออก', 'ตอ.เฉียงใต้', 'ใต้', 'ตต.เฉียงใต้', 'ตะวันตก', 'ตต.เฉียงเหนือ'];
    i.textContent = 'มุมมองพื้นดิน · หัน' + dirs[Math.round(st.bearing / 45) % 8] + ' ' + Math.round(st.bearing) + '° · พื้นสูง ' + Math.round(groundElevation() / st.ex) + ' ม. + สายตา ' + st.eye + ' ม. · ก้มเงย ' + Math.round(st.look) + '°';
  }
  // ซ่อน/แสดงแถบข้อมูลมุมบนซ้าย (ค้นหา พิกัด ลม) ขณะอยู่ในมุมมอง 3D เพื่อไม่ให้ซ้อนกับปุ่มควบคุม
  function setTop(show) { var t = $('top'); if (t) t.style.display = show ? '' : 'none'; }
  function stepMove(m) {
    var r = st.bearing * Math.PI / 180, dLat = m * Math.cos(r) / 111320, dLng = m * Math.sin(r) / (111320 * Math.cos(st.lat * Math.PI / 180));
    st.lat += dLat; st.lng += dLng; lastElev = null; applyGround();
  }

  /* ---------- เข้า/ออก ---------- */
  function saveView() {
    var map = ctx.map();
    st.saved = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }
  function restoreView() {
    var map = ctx.map(), s = st.saved;
    if (s) map.jumpTo({ center: s.center, zoom: s.zoom, bearing: s.bearing, pitch: Math.min(s.pitch, 60) });
    st.saved = null;
  }

  function enterGround(pos) {
    var map = ctx.map();
    if (!st.mode) saveView();
    var from = pos || { lat: map.getCenter().lat, lng: map.getCenter().lng };
    st.lat = from.lat; st.lng = from.lng;
    if (!st.mode) { st.bearing = map.getBearing(); st.look = -4; }
    st.mode = 'ground';
    terrainOn();
    setGestures(false);
    bindLook();
    makeHud();
    hud.hidden = false;
    $('v3Back').hidden = false; $('v3Fwd').hidden = false;
    var cross = $('cross'); if (cross) cross.style.display = 'none';
    setTop(false);
    lastElev = null;
    map.off('idle', onIdle); map.on('idle', onIdle);
    ctx.closeSheet();
    // วางแผนที่กลางที่จุดยืนก่อน เพื่อให้โหลดข้อมูลความสูงของจุดนั้น แล้วค่อยวางกล้องระดับสายตา
    map.jumpTo({ center: [st.lng, st.lat], zoom: 15, pitch: 0, bearing: st.bearing });
    whenReady(function () { lastElev = elevAt(st.lng, st.lat); applyGround(); });
    ctx.toast('มุมมองพื้นดิน: ลากนิ้วเพื่อหันหน้าและก้มเงย บีบนิ้วเพื่อซูม');
  }

  function enterTilt() {
    var map = ctx.map();
    if (!st.mode) saveView();
    if (st.mode === 'ground') { setGestures(true); map.setVerticalFieldOfView(36.87); }
    st.mode = 'tilt';
    map.dragRotate.enable(); map.touchZoomRotate.enableRotation(); // มุมมองเอียงต้องหมุนได้ แม้ตั้งล็อกทิศเหนือไว้
    terrainOn();
    ctx.closeSheet();
    if (hud) hud.hidden = false;
    makeHud();
    var cross = $('cross'); if (cross) cross.style.display = '';
    setTop(false);
    $('v3dInfo').textContent = 'มุมมองเอียง 3D · ลากนิ้วเดียวเลื่อน สองนิ้วหมุน/เอียง';
    $('v3Back').hidden = true; $('v3Fwd').hidden = true;
    map.easeTo({ pitch: 68, duration: 800 });
  }

  function exit() {
    if (!st.mode) return;
    var map = ctx.map();
    var wasGround = st.mode === 'ground';
    st.mode = null;
    map.off('idle', onIdle);
    if (wasGround) setGestures(true);
    terrainOff();
    if (ctx.restoreOrient) ctx.restoreOrient();
    restoreView();
    if (hud) hud.hidden = true;
    setTop(true);
    var cross = $('cross'); if (cross) cross.style.display = '';
    if ($('v3Back')) { $('v3Back').hidden = false; $('v3Fwd').hidden = false; }
    ctx.toast('ออกจากมุมมอง 3D แล้ว');
  }

  /* ---------- แผ่นตั้งค่า ---------- */
  function renderSheet(body) {
    var on = !!st.mode;
    var h = '<div class="btnrow"><button class="btn" id="v3Ground">👁 มุมมองพื้นดิน</button><button class="btn alt" id="v3Tilt">⛰ มุมมองเอียง 3D</button></div>' +
      '<div class="field" style="margin-top:10px"><label>จุดที่ยืน</label><select id="v3At" style="flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff"><option value="center">กลางจอ</option><option value="gps">ตำแหน่งของฉัน (GPS)</option></select></div>' +
      '<div class="field"><label>ความสูงสายตา</label><input type="range" id="v3eye" min="1" max="400" step="1" value="' + st.eye + '" style="flex:1"><span id="v3eyeV" style="flex:0 0 52px;text-align:right">' + st.eye + ' ม.</span></div>' +
      '<div class="field"><label>มุมมองกล้อง</label><input type="range" id="v3fov" min="' + MIN_FOV + '" max="' + MAX_FOV + '" step="1" value="' + Math.round(st.fov) + '" style="flex:1"><span id="v3fovV" style="flex:0 0 52px;text-align:right">' + Math.round(st.fov) + '°</span></div>' +
      '<div class="field"><label>เน้นความสูง</label><input type="range" id="v3ex" min="1" max="3" step="0.1" value="' + st.ex + '" style="flex:1"><span id="v3exV" style="flex:0 0 52px;text-align:right">×' + st.ex.toFixed(1) + '</span></div>' +
      '<div class="btnrow"><button class="btn alt" id="v3Sat">ใช้ภาพดาวเทียมเป็นพื้นหลัง (สมจริงขึ้น)</button></div>' +
      (on ? '<div class="btnrow"><button class="btn alt" id="v3Off">ปิดมุมมอง 3D</button></div>' : '') +
      '<p class="note">ภูมิประเทศยกจากข้อมูลความสูงละเอียดราว 30-40 ม. เห็นรูปทรงเขา สันเขา หุบเขาได้ดี แต่ไม่มีต้นไม้ อาคาร หรือหินก้อนเล็ก ภาพดาวเทียมต้องดาวน์โหลดพื้นที่นั้นไว้จึงใช้ออฟไลน์ได้ ซูมไกลมากภาพไกลอาจไม่ครบ ใช้เพื่อประกอบการพิจารณาพื้นที่ ไม่ใช่แทนการสำรวจจริง</p>';
    body.innerHTML = h;
    function pos() {
      var sel = $('v3At').value;
      if (sel === 'gps') {
        var f = ctx.getFix();
        if (!f) { ctx.toast('ยังไม่มีตำแหน่ง GPS แตะปุ่มตำแหน่ง (◎) ก่อน ใช้กลางจอแทน'); return null; }
        return { lat: f.lat, lng: f.lng };
      }
      return null;
    }
    $('v3Ground').onclick = function () { enterGround(pos()); };
    $('v3Tilt').onclick = enterTilt;
    $('v3eye').oninput = function () { st.eye = +this.value; $('v3eyeV').textContent = st.eye + ' ม.'; applyGround(); };
    $('v3fov').oninput = function () { st.fov = +this.value; $('v3fovV').textContent = st.fov + '°'; applyGround(); };
    $('v3ex').oninput = function () { st.ex = +this.value; $('v3exV').textContent = '×' + st.ex.toFixed(1); if (st.mode) { ctx.map().setTerrain({ source: 'dem', exaggeration: st.ex }); applyGround(); } };
    $('v3Sat').onclick = function () { ctx.setBase('sat'); ensureHillshade3d(); ctx.toast('ใช้ภาพดาวเทียมแล้ว'); };
    if ($('v3Off')) $('v3Off').onclick = exit;
  }

  root.TrailView3D = { init: init, renderSheet: renderSheet, enterGround: enterGround, enterTilt: enterTilt, exit: exit, active: active, refreshBase: function () { if (st.mode) ensureHillshade3d(); }, _state: st };
})(typeof self !== 'undefined' ? self : this);
