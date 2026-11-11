// เครื่องมือวาดสิ่งปลูกสร้างเอง: บ้าน ตึก โบสถ์/วิหาร เจดีย์ ปราสาทโบราณ หอคอย กำแพง ศาลา ซากโบราณสถาน
// แตะแผนที่วางมุมอาคาร (หลายเหลี่ยม / สี่เหลี่ยม 3 แตะ / เส้นกำแพง) ตั้งชื่อ ชั้น ความสูง สี แล้วยกเป็น 3 มิติ (fill-extrusion)
// รูปทรงเฉพาะ (เจดีย์ ปราสาท วิหาร ศาลา ซาก) ประกอบจากหลายชั้นที่ย่อลงตามรอยพื้นที่วาด · เก็บในเครื่อง รวมอยู่ใน "งาน" ส่งออก/นำเข้าได้
(function (root) {
  var KEY = 'trail_structs_v1';
  var ctx = null, items = [], listeners = [];
  var draw = null; // { type, mode, pts, ghost } ระหว่างวาด
  var editId = null, tmpType = 'house', tmpMode = 'rect';
  var FLOOR_H = 3.2, LKEY = 'trail_structs_labels';
  function labelsOn() { try { return localStorage.getItem(LKEY) !== '0'; } catch (e) { return true; } }
  function setLabels(v) { try { localStorage.setItem(LKEY, v ? '1' : '0'); } catch (e) { /* ข้าม */ } refresh(); }

  // ชนิดสิ่งปลูกสร้าง: h ความสูงเริ่มต้น (ม.) mode วิธีวาดที่แนะนำ
  // g กลุ่ม · h ความสูงเริ่มต้น (ม.) · mode วิธีวาด: rect/poly/line/point (แตะจุดเดียว วางรูปจำลองหันตามทิศ)
  var TYPES = {
    house: { g: 'ทั่วไป', name: '🏠 บ้าน', h: 6, mode: 'rect', color: '#e8dcc5', floors: true },
    building: { g: 'ทั่วไป', name: '🏢 ตึก/อาคาร', h: 12.8, mode: 'rect', color: '#cfd3d9', floors: true },
    row: { g: 'ทั่วไป', name: '🏬 ตึกแถว/ร้านค้า', h: 10, mode: 'rect', color: '#e2c9a8', floors: true },
    toilet: { g: 'ทั่วไป', name: '🚻 ห้องน้ำ', h: 2.8, mode: 'rect', color: '#9cc3d9' },
    hallclosed: { g: 'ทั่วไป', name: '🏛 หอประชุม แบบปิด', h: 9, mode: 'rect', color: '#d8d2c4' },
    hallopen: { g: 'ทั่วไป', name: '🎪 หอประชุม แบบเปิด (เสา+หลังคา)', h: 7, mode: 'rect', color: '#d9c7a1' },
    carport: { g: 'ทั่วไป', name: '🅿 โรงจอดรถ', h: 3.2, mode: 'rect', color: '#b9b9b9' },
    temple: { g: 'โบราณสถาน', name: '🛕 โบสถ์/วิหาร (หลังคาซ้อน)', h: 9, mode: 'rect', color: '#f3ead2' },
    stupa: { g: 'โบราณสถาน', name: '🗼 เจดีย์/สถูป', h: 24, mode: 'rect', color: '#f4efe0' },
    prasat: { g: 'โบราณสถาน', name: '🏯 ปราสาท/ปรางค์โบราณ', h: 22, mode: 'rect', color: '#b89a7a' },
    pavilion: { g: 'โบราณสถาน', name: '⛩ ศาลา', h: 5, mode: 'rect', color: '#d9c7a1' },
    ruins: { g: 'โบราณสถาน', name: '🧱 ซากโบราณสถาน', h: 3, mode: 'poly', color: '#a89b88' },
    wall: { g: 'โบราณสถาน', name: '🧱 กำแพง/คูเมือง (เส้น)', h: 4, mode: 'line', color: '#b5a38a' },
    tower: { g: 'ทหาร/ความปลอดภัย', name: '🗼 หอคอย/หอสังเกตการณ์', h: 30, mode: 'rect', color: '#c9c9c9' },
    camp: { g: 'ทหาร/ความปลอดภัย', name: '🏕 ค่าย/อาคารกองบังคับการ', h: 8, mode: 'rect', color: '#8a9370', floors: true },
    guard: { g: 'ทหาร/ความปลอดภัย', name: '💂 ป้อมรักษาการณ์', h: 3.4, mode: 'rect', color: '#8a9370' },
    gate: { g: 'ทหาร/ความปลอดภัย', name: '🚧 ประตู (แตะ 2 จุดปลายประตู)', h: 4.5, mode: 'line', color: '#c9b38a' },
    restricted: { g: 'ทหาร/ความปลอดภัย', name: '⛔ พื้นที่ต้องห้าม', h: 0.6, mode: 'poly', color: '#d32f2f' },
    mast: { g: 'ทหาร/ความปลอดภัย', name: '📡 เสาวิทยุ/เสาอากาศ (แตะ 1 จุด)', h: 40, mode: 'point', color: '#c62828' },
    cable: { g: 'ทหาร/ความปลอดภัย', name: '〰 เส้นสลิง/สายเคเบิล (เส้น)', h: 12, mode: 'line', color: '#424242' },
    hangar: { g: 'เครื่องบิน', name: '🛩 โรงเก็บเครื่องบิน', h: 14, mode: 'rect', color: '#aeb7bd' },
    runway: { g: 'เครื่องบิน', name: '🛫 รันเวย์/ลานจอด (เส้น)', h: 0.2, mode: 'line', color: '#6b6b6b' },
    plane: { g: 'เครื่องบิน', name: '✈ เครื่องบินลำเล็ก (แตะ 1 จุด)', h: 4, mode: 'point', color: '#e0e0e0' },
    jet: { g: 'เครื่องบิน', name: '✈ เครื่องบินขนส่ง/โดยสาร (แตะ 1 จุด)', h: 12, mode: 'point', color: '#d7dde2' },
    heli: { g: 'เครื่องบิน', name: '🚁 เฮลิคอปเตอร์ (แตะ 1 จุด)', h: 4, mode: 'point', color: '#6f7a5a' },
    car: { g: 'ยานพาหนะ', name: '🚗 รถยนต์ (แตะ 1 จุด)', h: 1.5, mode: 'point', color: '#3f6fb5' },
    truck: { g: 'ยานพาหนะ', name: '🚚 รถบรรทุก/รถทหาร (แตะ 1 จุด)', h: 3, mode: 'point', color: '#6f7a5a' },
    tank: { g: 'ยานพาหนะ', name: '🪖 รถถัง/รถเกราะ (แตะ 1 จุด)', h: 2.4, mode: 'point', color: '#5f6a4a' }
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; }
  function uid() { return 's' + Date.now() + Math.floor(Math.random() * 1000); }
  function load() { try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { items = []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { ctx && ctx.toast('บันทึกไม่ได้ (พื้นที่เก็บข้อมูลเต็ม?)'); } }
  function changed() { save(); refresh(); listeners.forEach(function (f) { try { f(); } catch (e) { /* ข้าม */ } }); }
  function visible(it) { return it.show !== false && (!root.TrailProj || TrailProj.isVisible(it)); }
  function byId(id) { return items.filter(function (x) { return x.id === id; })[0] || null; }
  function heightOf(it) { return +it.h > 0 ? +it.h : (TYPES[it.type] || TYPES.house).h; }

  /* ---------- เรขาคณิต ---------- */
  function mk(lat) { return [111320 * Math.cos(lat * Math.PI / 180), 110540]; } // เมตรต่อองศา [lng, lat]
  function centroid(p) { var x = 0, y = 0; p.forEach(function (q) { x += q[0]; y += q[1]; }); return [x / p.length, y / p.length]; }
  function scaleTo(p, c, s) { return p.map(function (q) { return [c[0] + (q[0] - c[0]) * s, c[1] + (q[1] - c[1]) * s]; }); }
  function closeRing(p) { return p.concat([p[0]]); }
  function seeded(id, k) { var h = 2166136261; for (var i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } h = Math.imul(h ^ (k * 2654435761), 2246822519); return ((h >>> 0) % 10000) / 10000; }

  // เส้น → รูปหลายเหลี่ยมหนา w เมตร (ทีละช่วง)
  function bufferLine(pts, w) {
    var out = [], lat0 = pts[0][1], k = mk(lat0), hw = w / 2;
    for (var i = 0; i + 1 < pts.length; i++) {
      var ax = pts[i][0] * k[0], ay = pts[i][1] * k[1], bx = pts[i + 1][0] * k[0], by = pts[i + 1][1] * k[1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * hw, ny = dx / L * hw, ex = dx / L * hw, ey = dy / L * hw;
      var q = [[ax - ex - nx, ay - ey - ny], [bx + ex - nx, by + ey - ny], [bx + ex + nx, by + ey + ny], [ax - ex + nx, ay - ey + ny]];
      out.push(q.map(function (p) { return [p[0] / k[0], p[1] / k[1]]; }));
    }
    return out;
  }

  // กล่องในกรอบท้องถิ่น: จุดศูนย์กลาง c [lng,lat], ทิศหัน hd (องศาตามเข็ม จากทิศเหนือ), เลื่อนไปข้างหน้า a / ไปทางขวา b (เมตร), ยาว L กว้าง W
  function box(c, hd, a, b, L, W) {
    var k = mk(c[1]), t = hd * Math.PI / 180, fx = Math.sin(t), fy = Math.cos(t), rx = Math.cos(t), ry = -Math.sin(t), out = [];
    [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].forEach(function (q) {
      var al = a + q[0], ac = b + q[1];
      out.push([c[0] + (fx * al + rx * ac) / k[0], c[1] + (fy * al + ry * ac) / k[1]]);
    });
    return out;
  }

  // แตกสิ่งปลูกสร้างเป็นชั้นสำหรับวาด: [{ poly, base, h, c }]
  function tiers(it) {
    var T = TYPES[it.type] || TYPES.house, H = heightOf(it), col = it.color || T.color, p = it.pts, out = [];
    function line(w, b, h, cc) { bufferLine(p, w).forEach(function (q) { out.push({ poly: q, base: b, h: h, c: cc || col }); }); }
    if (T.mode === 'point') { // รูปจำลองวางที่จุดเดียว หันตามทิศ it.rot ขนาด it.sz เท่า
      var c = p[0], hd = +it.rot || 0, z = +it.sz > 0 ? +it.sz : 1;
      function bx(a, b, L, W, b0, h1, cc) { out.push({ poly: box(c, hd, a * z, b * z, L * z, W * z), base: b0 * z, h: h1 * z, c: cc || col }); }
      switch (it.type) {
        case 'mast': { var u = H / 40; out.length = 0; out.push({ poly: box(c, 0, 0, 0, 2.2, 2.2), base: 0, h: 2 * u, c: '#9e9e9e' }, { poly: box(c, 0, 0, 0, 0.9, 0.9), base: 2 * u, h: H * 0.92, c: col }, { poly: box(c, 0, 0, 0, 1.6, 0.35), base: H * 0.55, h: H * 0.55 + 0.4, c: '#eee' }, { poly: box(c, 0, 0, 0, 0.35, 1.6), base: H * 0.78, h: H * 0.78 + 0.4, c: '#eee' }, { poly: box(c, 0, 0, 0, 0.3, 0.3), base: H * 0.92, h: H, c: '#fff' }); break; }
        case 'plane': bx(0, 0, 8.4, 1.3, 0.6, 1.9); bx(0.4, 0, 1.4, 11, 1.2, 1.5); bx(-3.6, 0, 1, 3.6, 1.6, 1.4); bx(-3.7, 0, 1.4, 0.2, 1.9, 3.1, '#c62828'); bx(3.9, 0, 0.5, 0.2, 0.6, 2.4, '#555'); break;
        case 'jet': bx(0, 0, 38, 3.8, 1.5, 4.2); bx(2.5, 0, 6, 34, 1.8, 2.6, '#c8ced4'); bx(-15, 0, 3.4, 12, 3, 3.6, '#c8ced4'); bx(-15, 0, 5, 0.5, 4, 11, '#1565c0'); bx(2.5, 8, 4, 1.8, 0.2, 1.7, '#888'); bx(2.5, -8, 4, 1.8, 0.2, 1.7, '#888'); break;
        case 'heli': bx(0, 0, 6.5, 2, 0.4, 2.5); bx(-4.5, 0, 4, 0.5, 1.4, 1.9); bx(-6.5, 0, 0.5, 1.8, 1.2, 3); bx(0.5, 0, 0.5, 11, 3.1, 3.3, '#333'); bx(0.5, 0, 11, 0.5, 3.1, 3.3, '#333'); break;
        case 'car': bx(0, 0, 4.5, 1.9, 0.25, 0.85); bx(-0.2, 0, 2.6, 1.8, 0.85, 1.5, '#b8d4e8'); break;
        case 'truck': bx(2.1, 0, 2, 2.4, 0.5, 2.6); bx(-1.8, 0, 5.2, 2.5, 0.9, 3, '#7d8a63'); bx(2, 0, 1.2, 2.2, 1.5, 2.1, '#b8d4e8'); break;
        case 'tank': bx(0, 0, 7, 3.3, 0.4, 2, col); bx(-0.3, 0, 3.4, 3, 2, 2.9, '#56603f'); bx(3.8, 0, 5, 0.28, 2.3, 2.6, '#333'); break;
        default: bx(0, 0, 4, 2, 0, H);
      }
      return out;
    }
    if (T.mode === 'line') {
      if (it.type === 'wall') { line(+it.w || 1.8, 0, H); return out; }
      if (it.type === 'runway') { line(+it.w || 45, 0, H); bufferLine(p, 1).forEach(function (q) { out.push({ poly: q, base: H, h: H + 0.15, c: '#ffffff' }); }); return out; }
      if (it.type === 'cable') { var b0 = +it.base > 0 ? +it.base : H; line(+it.w || 0.3, b0, b0 + 0.3, '#424242'); return out; }
      if (it.type === 'gate') { // เสา 2 ต้นปลายเส้น + คานบน + ไม้กั้น
        var a = p[0], b = p[p.length - 1], k = mk(a[1]), dx = (b[0] - a[0]) * k[0], dy = (b[1] - a[1]) * k[1], L = Math.hypot(dx, dy) || 1, hd = Math.atan2(dx, dy) * 180 / Math.PI, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        out.push({ poly: box(a, hd, 0, 0, 1.2, 1.2), base: 0, h: H, c: col }, { poly: box(b, hd, 0, 0, 1.2, 1.2), base: 0, h: H, c: col });
        out.push({ poly: box(mid, hd + 90, 0, 0, L, 0.9), base: H - 0.9, h: H, c: '#8c6d4a' });
        out.push({ poly: box(mid, hd + 90, 0, 0, L * 0.9, 0.18), base: 1.1, h: 1.35, c: '#d32f2f' });
        return out;
      }
      line(+it.w || 1.8, 0, H); return out;
    }
    var c2 = centroid(p);
    function add(s, b, h, cc) { out.push({ poly: s === 1 ? p : scaleTo(p, c2, s), base: b, h: h, c: cc || col }); }
    function pillars(h, pts, sz) { pts.forEach(function (v) { out.push({ poly: [v, [v[0] + (c2[0] - v[0]) * sz, v[1]], [v[0] + (c2[0] - v[0]) * sz, v[1] + (c2[1] - v[1]) * sz], [v[0], v[1] + (c2[1] - v[1]) * sz]], base: 0, h: h, c: '#8c6d4a' }); }); }
    switch (it.type) {
      case 'temple': { var wall = H * 0.55; add(1, 0, wall); add(1.08, wall, wall + H * 0.14, '#c0502b'); add(0.86, wall + H * 0.14, wall + H * 0.26, '#a63c1f'); add(0.55, wall + H * 0.26, H, '#c0502b'); break; }
      case 'stupa': { var u2 = H / 100; add(1, 0, 8 * u2); add(0.86, 8 * u2, 15 * u2); add(0.72, 15 * u2, 24 * u2); add(0.56, 24 * u2, 60 * u2); add(0.4, 60 * u2, 72 * u2); add(0.26, 72 * u2, 84 * u2); add(0.14, 84 * u2, 94 * u2, '#d4af37'); add(0.05, 94 * u2, 100 * u2, '#d4af37'); break; }
      case 'prasat': { add(1, 0, H * 0.22); add(0.82, H * 0.22, H * 0.42); add(0.64, H * 0.42, H * 0.6); add(0.46, H * 0.6, H * 0.78); add(0.3, H * 0.78, H * 0.92); add(0.12, H * 0.92, H, '#9c7f60'); break; }
      case 'tower': { add(1, 0, H * 0.85); add(1.25, H * 0.85, H * 0.92, '#9a9a9a'); add(0.7, H * 0.92, H, '#7d7d7d'); break; }
      case 'pavilion': { pillars(H - 0.9, p, 0.1); add(1.15, H - 0.9, H, '#b7452f'); break; }
      case 'hallopen': { // เสารอบ + เสากลางด้านยาว + หลังคาใหญ่
        var mids = p.map(function (v, i) { var n = p[(i + 1) % p.length]; return [(v[0] + n[0]) / 2, (v[1] + n[1]) / 2]; });
        pillars(H - 1, p.concat(mids), 0.04); add(1.1, H - 1, H, '#9aa8b3'); add(0.9, H, H + 0.8, '#b0bec5'); break;
      }
      case 'carport': { pillars(H - 0.4, p, 0.05); add(1.06, H - 0.4, H, '#8f9aa3'); break; }
      case 'hallclosed': { add(1, 0, H * 0.82); add(1.06, H * 0.82, H * 0.92, '#8d6e63'); add(0.7, H * 0.92, H, '#a1887f'); break; }
      case 'toilet': { add(1, 0, H - 0.3); add(1.1, H - 0.3, H, '#607d8b'); break; }
      case 'guard': { add(1, 0, H - 0.45); add(1.25, H - 0.45, H, '#556b2f'); break; }
      case 'camp': { add(1, 0, H); add(1.04, H, H + 0.5, '#6b7352'); break; }
      case 'hangar': { add(1, 0, H * 0.7); add(0.9, H * 0.7, H * 0.88, col); add(0.6, H * 0.88, H, '#8d969c'); break; }
      case 'restricted': add(1, 0, H, '#d32f2f'); add(0.86, H, H + 0.1, '#ffcdd2'); break;
      case 'ruins': { add(1, 0, 0.8, '#968a78'); p.forEach(function (v, i) { var a2 = [v, [v[0] + (c2[0] - v[0]) * 0.28, v[1] + (c2[1] - v[1]) * 0.05], [v[0] + (c2[0] - v[0]) * 0.3, v[1] + (c2[1] - v[1]) * 0.3], [v[0] + (c2[0] - v[0]) * 0.05, v[1] + (c2[1] - v[1]) * 0.28]]; out.push({ poly: a2, base: 0.8, h: 0.8 + H * (0.35 + 0.65 * seeded(it.id, i)), c: col }); }); add(0.45, 0.8, 0.8 + H * 0.3 * seeded(it.id, 99), '#b3a794'); break; }
      default: add(1, 0, H);
    }
    return out;
  }

  /* ---------- วาดบนแผนที่ ---------- */
  function ensureLayers() {
    var m = ctx.map();
    if (m.getSource('structs')) return;
    var empty = { type: 'FeatureCollection', features: [] };
    m.addSource('structs', { type: 'geojson', data: empty });
    m.addSource('struct-draft', { type: 'geojson', data: empty });
    m.addLayer({
      id: 'struct-3d', type: 'fill-extrusion', source: 'structs', filter: ['==', ['get', 'k'], 'b'],
      paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true }
    });
    m.addLayer({ id: 'struct-line', type: 'line', source: 'structs', filter: ['==', ['get', 'k'], 'o'], paint: { 'line-color': '#7a1f2b', 'line-width': 1.6 } });
    m.addLayer({ id: 'struct-draft-fill', type: 'fill', source: 'struct-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#c4501b', 'fill-opacity': 0.25 } });
    m.addLayer({ id: 'struct-draft-line', type: 'line', source: 'struct-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#c4501b', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    m.addLayer({ id: 'struct-draft-pt', type: 'circle', source: 'struct-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#c4501b', 'circle-stroke-width': 3 } });
    m.addLayer({
      id: 'struct-label', type: 'symbol', source: 'structs', filter: ['==', ['get', 'k'], 'l'], minzoom: 14,
      layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'bottom', 'text-offset': [0, -0.4], 'text-allow-overlap': false },
      paint: { 'text-color': '#2b1a0a', 'text-halo-color': '#fff', 'text-halo-width': 1.6 }
    });
  }
  function refresh() {
    var m = ctx && ctx.map();
    if (!m || !m.getSource('structs')) return;
    var f = [];
    items.filter(visible).forEach(function (it) {
      if (!it.pts || it.pts.length < 1) return;
      tiers(it).forEach(function (t) { f.push({ type: 'Feature', properties: { k: 'b', id: it.id, c: t.c, b: t.base, h: t.h }, geometry: { type: 'Polygon', coordinates: [closeRing(t.poly)] } }); });
      var base = tiers(it)[0];
      if (base) f.push({ type: 'Feature', properties: { k: 'o', id: it.id }, geometry: { type: 'LineString', coordinates: closeRing(base.poly) } });
      var c = (TYPES[it.type] || {}).mode === 'line' ? it.pts[Math.floor(it.pts.length / 2)] : centroid(it.pts);
      if (it.name && labelsOn() && it.hideName !== true) f.push({ type: 'Feature', properties: { k: 'l', id: it.id, n: it.name }, geometry: { type: 'Point', coordinates: c } });
    });
    m.getSource('structs').setData({ type: 'FeatureCollection', features: f });
  }
  function drawDraft() {
    var m = ctx.map(); if (!m.getSource('struct-draft')) return;
    var f = [];
    if (draw) {
      var p = draw.pts.slice(), g = draw.ghost;
      if (draw.mode === 'rect') { var r = rectFrom(draw.pts, g); if (r) { f.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeRing(r)] } }); p = []; } }
      var show = p.concat(g && draw.mode !== 'rect' ? [g] : (g && draw.pts.length < 2 ? [g] : []));
      if (show.length >= 2) f.push({ type: 'Feature', properties: {}, geometry: draw.mode === 'line' || show.length < 3 ? { type: 'LineString', coordinates: show } : { type: 'Polygon', coordinates: [closeRing(show)] } });
      draw.pts.forEach(function (q) { f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: q } }); });
    }
    m.getSource('struct-draft').setData({ type: 'FeatureCollection', features: f });
  }
  // สี่เหลี่ยมจาก 2 แตะ (ด้านหนึ่ง) + แตะที่ 3 (ความลึก)
  function rectFrom(pts, third) {
    if (pts.length < 2) return null;
    var c = pts.length >= 3 ? pts[2] : third; if (!c) return null;
    var a = pts[0], b = pts[1], k = mk(a[1]), ax = a[0] * k[0], ay = a[1] * k[1], bx = b[0] * k[0], by = b[1] * k[1], cx = c[0] * k[0], cy = c[1] * k[1];
    var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, d = (cx - ax) * nx + (cy - ay) * ny;
    var q = [[ax, ay], [bx, by], [bx + nx * d, by + ny * d], [ax + nx * d, ay + ny * d]];
    return q.map(function (p) { return [p[0] / k[0], p[1] / k[1]]; });
  }

  function bar() {
    var b = $('structbar');
    if (!draw) { if (b) b.remove(); return; }
    if (!b) { b = el('div', 'position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom) + 150px);max-width:460px;background:rgba(255,255,255,.97);border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.35);padding:8px 12px;z-index:8;font-size:14px'); b.id = 'structbar'; document.body.appendChild(b); }
    var n = draw.pts.length, need = draw.mode === 'point' ? 1 : draw.mode === 'rect' ? 3 : draw.mode === 'line' ? 2 : 3;
    var hint = draw.mode === 'point' ? 'แตะตำแหน่งที่จะวาง (ปรับทิศหันและขนาดภายหลังได้)' : draw.type === 'gate' ? (n === 0 ? 'แตะปลายประตูด้านหนึ่ง' : 'แตะปลายอีกด้านหนึ่ง') : draw.mode === 'rect' ? (n === 0 ? 'แตะมุมแรก' : n === 1 ? 'แตะมุมที่สองของด้านเดียวกัน' : 'แตะด้านตรงข้ามเพื่อกำหนดความลึก') : (n < need ? 'แตะวางจุด (' + n + ') ต้องมีอย่างน้อย ' + need + ' จุด' : 'แตะวางจุดต่อ หรือกด ✓ เสร็จ');
    b.innerHTML = '';
    b.appendChild(el('div', 'font-weight:700', (TYPES[draw.type] || {}).name + ' · ' + hint));
    var row = el('div', 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap');
    function btn(t, fn, pri) { var x = el('button', 'flex:none;border:0;border-radius:9px;padding:6px 12px;font-size:14px;' + (pri ? 'background:#2e6b3f;color:#fff' : 'background:#e8efe9;color:#2e6b3f'), t); x.onclick = fn; row.appendChild(x); }
    btn('↶ ย้อน', function () { draw.pts.pop(); draw.ghost = null; drawDraft(); bar(); });
    if (draw.mode !== 'rect' && draw.mode !== 'point' && draw.type !== 'gate') btn('✓ เสร็จ', finishDraw, true);
    btn('✕ ยกเลิก', cancelDraw);
    b.appendChild(row);
  }
  function startDraw(type, mode) {
    draw = { type: type, mode: mode, pts: [], ghost: null };
    ctx.closeSheet(); ensureLayers(); drawDraft(); bar();
    var m = ctx.map();
    if (!draw.mv) { draw.mv = function (e) { if (draw) { draw.ghost = [e.lngLat.lng, e.lngLat.lat]; drawDraft(); } }; m.on('mousemove', draw.mv); }
    ctx.toast('แตะแผนที่เพื่อวาด · ซูมเข้าให้เห็นมุมอาคารชัดก่อนวาด');
  }
  function cancelDraw() { if (draw && draw.mv) ctx.map().off('mousemove', draw.mv); draw = null; drawDraft(); bar(); }
  function finishDraw() {
    if (!draw) return;
    var need = draw.mode === 'point' ? 1 : draw.mode === 'line' ? 2 : 3;
    if (draw.mode === 'rect' && draw.pts.length >= 3) { draw.pts = rectFrom(draw.pts); }
    if (draw.pts.length < need) { ctx.toast('ยังวางจุดไม่พอ'); return; }
    var T = TYPES[draw.type];
    var it = { id: uid(), name: T.name.replace(/^\S+\s/, '').replace(/ \(.*\)/, ''), type: draw.type, mode: draw.mode, pts: draw.pts, h: T.h, floors: T.floors ? Math.round(T.h / FLOOR_H) : 0, proj: root.TrailProj ? TrailProj.active() : 'default', show: true };
    if (it.type === 'wall') it.w = 1.8;
    if (it.type === 'runway') it.w = 45;
    if (it.type === 'cable') { it.w = 0.3; it.base = T.h; }
    if (T.mode === 'point') { it.rot = 0; it.sz = 1; }
    items.push(it);
    if (root.TrailProj) TrailProj.reveal(it.proj);
    if (draw.mv) ctx.map().off('mousemove', draw.mv);
    draw = null; drawDraft(); bar(); changed();
    editId = it.id; ctx.openSheet('struct'); // เปิดหน้าแก้ไขทันที
  }
  function handleClick(e) {
    if (movingHook) { movingHook(e); return true; }
    if (draw) {
      var p = [e.lngLat.lng, e.lngLat.lat];
      draw.pts.push(p); draw.ghost = null;
      if ((draw.mode === 'rect' && draw.pts.length === 3) || draw.mode === 'point' || (draw.type === 'gate' && draw.pts.length === 2)) { finishDraw(); return true; }
      drawDraft(); bar(); return true;
    }
    var m = ctx.map();
    if (!m.getLayer('struct-3d')) return false;
    var hit = m.queryRenderedFeatures(e.point, { layers: ['struct-3d'] })[0];
    if (hit && hit.properties && byId(hit.properties.id)) { editId = hit.properties.id; ctx.openSheet('struct', true); return true; }
    return false;
  }

  /* ---------- หน้าจอ ---------- */
  function selectBox(opts, cur, fn) {
    var s = el('select', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px;background:#fff');
    var grp = {};
    opts.forEach(function (o) {
      var op = el('option', '', o[1]); op.value = o[0]; if (String(o[0]) === String(cur)) op.selected = true;
      if (o[2]) { if (!grp[o[2]]) { grp[o[2]] = document.createElement('optgroup'); grp[o[2]].label = o[2]; s.appendChild(grp[o[2]]); } grp[o[2]].appendChild(op); } else s.appendChild(op);
    });
    s.onchange = function () { fn(s.value); }; return s;
  }
  function typeOpts(mode) {
    var cls = function (m) { return m === 'point' ? 'point' : m === 'line' ? 'line' : 'area'; };
    return Object.keys(TYPES).filter(function (k) { return !mode || cls(TYPES[k].mode) === cls(mode); }).map(function (k) { return [k, TYPES[k].name, TYPES[k].g]; });
  }
  function field(label, node) { var r = el('div', 'display:flex;align-items:center;gap:8px;margin:6px 0'); r.appendChild(el('label', 'flex:0 0 92px;font-size:14px', label)); r.appendChild(node); return r; }
  function numInput(v, step, fn) { var i = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px'); i.type = 'number'; i.step = step; i.value = v; i.inputMode = 'decimal'; i.onchange = function () { fn(parseFloat(i.value)); }; return i; }
  function button(t, fn, pri) { var x = el('button', 'border:0;border-radius:10px;padding:9px 14px;font-size:15px;' + (pri ? 'background:#2e6b3f;color:#fff' : 'background:#e8efe9;color:#2e6b3f'), t); x.onclick = fn; return x; }

  function renderSheet(body) {
    body.innerHTML = '';
    var it = editId && byId(editId);
    if (it) return renderEdit(body, it);
    body.appendChild(el('p', 'font-size:13px;color:#555;margin:6px 0', 'วาดบ้าน ตึก เจดีย์ ปราสาท กำแพง ฯลฯ ลงบนแผนที่ แล้วยกเป็น 3 มิติ · เก็บในเครื่อง รวมอยู่ใน "งาน" ที่ใช้อยู่'));
    var lb = el('label', 'display:flex;align-items:center;gap:8px;margin:6px 0;font-size:15px'); var lc = el('input', 'width:22px;height:22px;accent-color:#2e6b3f'); lc.type = 'checkbox'; lc.checked = labelsOn(); lc.onchange = function () { setLabels(lc.checked); };
    lb.appendChild(lc); lb.appendChild(el('span', '', 'แสดงชื่อสิ่งก่อสร้างบนแผนที่ (ซูม 14 ขึ้นไป)')); body.appendChild(lb);
    body.appendChild(field('ชนิด', selectBox(typeOpts(), tmpType, function (v) { tmpType = v; tmpMode = TYPES[v].mode; renderSheet(body); })));
    body.appendChild(field('วิธีวาด', selectBox([['rect', 'สี่เหลี่ยม (แตะ 3 จุด)'], ['poly', 'หลายเหลี่ยม (แตะทีละมุม แล้วกดเสร็จ)'], ['line', 'เส้น (เหมาะกับกำแพง)']], tmpMode, function (v) { tmpMode = v; })));
    var row = el('div', 'display:flex;gap:8px;margin:10px 0'); row.appendChild(button('✏ เริ่มวาด', function () { var m = TYPES[tmpType].mode; startDraw(tmpType, m === 'point' || m === 'line' ? m : tmpMode); }, true)); body.appendChild(row);
    var mine = items.filter(function (x) { return !root.TrailProj || TrailProj.active() === (x.proj || 'default'); });
    body.appendChild(el('h4', 'margin:12px 0 4px', 'สิ่งปลูกสร้างในงานนี้ (' + mine.length + ')'));
    if (!mine.length) body.appendChild(el('div', 'font-size:13px;color:#777', 'ยังไม่มี · แตะอาคารบนแผนที่ (ตอนเปิดโหมดนี้) เพื่อแก้ไข'));
    mine.forEach(function (x) {
      var r = el('div', 'display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid #f0f0f0');
      var cb = el('input', 'width:22px;height:22px;flex:none;accent-color:#2e6b3f'); cb.type = 'checkbox'; cb.checked = x.show !== false; cb.onchange = function () { x.show = cb.checked; changed(); }; r.appendChild(cb);
      r.appendChild(el('div', 'flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', (TYPES[x.type] || {}).name.split(' ')[0] + ' ' + (x.name || '(ไม่มีชื่อ)') + ' · ' + Math.round(heightOf(x)) + ' ม.'));
      r.appendChild(button('ดู', function () { var c = x.type === 'wall' ? x.pts[0] : centroid(x.pts), m = ctx.map(); ctx.closeSheet(); m.easeTo({ center: c, zoom: Math.max(m.getZoom(), 17), duration: 800 }); }));
      r.appendChild(button('แก้', function () { editId = x.id; renderSheet(body); }));
      body.appendChild(r);
    });
  }
  function renderEdit(body, it) {
    var T = TYPES[it.type] || TYPES.house;
    body.appendChild(field('ชื่อ', (function () { var i = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px'); i.value = it.name || ''; i.placeholder = 'เช่น วัดพระธาตุ, บ้านผู้ใหญ่'; i.onchange = function () { it.name = i.value.trim(); changed(); }; return i; })()));
    body.appendChild(field('ชนิด', selectBox(typeOpts(T.mode), it.type, function (v) { it.type = v; it.mode = TYPES[v].mode === 'point' || TYPES[v].mode === 'line' ? TYPES[v].mode : (it.mode === 'poly' ? 'poly' : 'rect'); it.h = TYPES[v].h; it.floors = TYPES[v].floors ? Math.round(TYPES[v].h / FLOOR_H) : 0; it.color = ''; if (v === 'wall') it.w = it.w || 1.8; if (v === 'runway') it.w = 45; if (v === 'cable') { it.w = 0.3; it.base = TYPES[v].h; } changed(); body.innerHTML = ''; renderEdit(body, it); })));
    var nb = el('label', 'display:flex;align-items:center;gap:8px;margin:4px 0;font-size:14px'); var nc = el('input', 'width:20px;height:20px;accent-color:#2e6b3f'); nc.type = 'checkbox'; nc.checked = it.hideName !== true; nc.onchange = function () { it.hideName = !nc.checked; changed(); };
    nb.appendChild(nc); nb.appendChild(el('span', '', 'แสดงชื่อนี้บนแผนที่' + (labelsOn() ? '' : ' (ปิดชื่อรวมอยู่ในหน้าหลัก)'))); body.appendChild(nb);
    var hIn;
    if (T.floors) body.appendChild(field('จำนวนชั้น', numInput(it.floors || 1, '1', function (v) { if (v >= 1) { it.floors = Math.round(v); it.h = Math.round(it.floors * FLOOR_H * 10) / 10; if (hIn) hIn.value = it.h; changed(); } })));
    hIn = numInput(Math.round(heightOf(it) * 10) / 10, '0.5', function (v) { if (v > 0) { it.h = v; if (T.floors) it.floors = Math.max(1, Math.round(v / FLOOR_H)); changed(); } });
    body.appendChild(field('สูง (เมตร)', hIn));
    if (T.mode === 'point') {
      body.appendChild(field('ทิศหัน (°)', numInput(it.rot || 0, '5', function (v) { if (!isNaN(v)) { it.rot = ((v % 360) + 360) % 360; changed(); } })));
      body.appendChild(field('ขนาด (เท่า)', numInput(it.sz || 1, '0.1', function (v) { if (v > 0) { it.sz = v; changed(); } })));
    }
    if (it.type === 'cable') body.appendChild(field('สูงจากพื้น (ม.)', numInput(it.base || heightOf(it), '0.5', function (v) { if (v >= 0) { it.base = v; changed(); } })));
    if (it.type === 'runway') body.appendChild(field('กว้าง (เมตร)', numInput(it.w || 45, '1', function (v) { if (v > 0) { it.w = v; changed(); } })));
    if (it.type === 'wall') body.appendChild(field('หนา (เมตร)', numInput(it.w || 1.8, '0.1', function (v) { if (v > 0) { it.w = v; changed(); } })));
    var col = el('input', 'flex:1;height:40px;border:1px solid #ccc;border-radius:8px;padding:2px'); col.type = 'color'; col.value = it.color || T.color; col.onchange = function () { it.color = col.value; changed(); };
    body.appendChild(field('สีหลัก', col));
    var v = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0');
    v.appendChild(button('⬆ ดูจากด้านบน', function () { ctx.map().easeTo({ pitch: 0, bearing: 0, duration: 500 }); }));
    v.appendChild(button('⛰ ดูแบบ 3 มิติ', function () { var m = ctx.map(); ctx.closeSheet(); m.easeTo({ center: it.type === 'wall' ? it.pts[0] : centroid(it.pts), pitch: 55, duration: 700 }); }));
    body.appendChild(v);
    var r = el('div', 'display:flex;gap:8px;flex-wrap:wrap;margin:12px 0');
    r.appendChild(button('✓ เสร็จ', function () { editId = null; ctx.closeSheet(); }, true));
    r.appendChild(button('ย้ายตำแหน่ง', function () { moveMode(it); }));
    r.appendChild(button('ลบ', function () { if (!confirm('ลบ "' + (it.name || 'สิ่งปลูกสร้าง') + '" ?')) return; items = items.filter(function (x) { return x !== it; }); editId = null; changed(); ctx.closeSheet(); }));
    body.appendChild(r);
    body.appendChild(el('div', 'font-size:12px;color:#777', 'ต้องการแก้รูปร่างมุมอาคาร: ลบแล้ววาดใหม่ · ชื่อแสดงบนแผนที่ที่ซูม 14 ขึ้นไป'));
  }
  // ย้ายทั้งหลัง: แตะตำแหน่งใหม่ของจุดกึ่งกลาง
  function moveMode(it) {
    ctx.closeSheet();
    ctx.toast('แตะตำแหน่งใหม่ของ "' + (it.name || 'สิ่งปลูกสร้าง') + '" (จุดกึ่งกลางจะย้ายไปที่นั่น)');
    function once(e) {
      movingHook = null;
      var c = centroid(it.pts), dx = e.lngLat.lng - c[0], dy = e.lngLat.lat - c[1];
      it.pts = it.pts.map(function (q) { return [q[0] + dx, q[1] + dy]; }); changed();
    }
    movingHook = once;
  }
  var movingHook = null;

  /* ---------- เชื่อมกับ "งาน" ---------- */
  function onChange(f) { listeners.push(f); }
  function remove(id) { items = items.filter(function (x) { return x.id !== id; }); }
  function addRaw(arr) { arr.forEach(function (x) { items.push(x); }); changed(); }
  function init(c) { ctx = c; load(); ensureLayers(); refresh(); if (root.TrailProj) TrailProj.onChange(refresh); }
  function active() { return !!draw || !!movingHook; }

  root.TrailStruct = { init: init, handleClick: handleClick, renderSheet: renderSheet, items: function () { return items; }, commit: function () { changed(); }, removeStruct: function (id) { remove(id); }, addRaw: addRaw, refresh: refresh, active: active, TYPES: TYPES, tiers: tiers, resetEdit: function () { editId = null; }, onChange: onChange };
})(typeof self !== 'undefined' ? self : this);
