// เครื่องมือวาดสิ่งปลูกสร้างเอง: บ้าน ตึก โบสถ์/วิหาร เจดีย์ ปราสาทโบราณ หอคอย กำแพง ศาลา ซากโบราณสถาน
// แตะแผนที่วางมุมอาคาร (หลายเหลี่ยม / สี่เหลี่ยม 3 แตะ / เส้นกำแพง) ตั้งชื่อ ชั้น ความสูง สี แล้วยกเป็น 3 มิติ (fill-extrusion)
// รูปทรงเฉพาะ (เจดีย์ ปราสาท วิหาร ศาลา ซาก) ประกอบจากหลายชั้นที่ย่อลงตามรอยพื้นที่วาด · เก็บในเครื่อง รวมอยู่ใน "งาน" ส่งออก/นำเข้าได้
(function (root) {
  var KEY = 'trail_structs_v1';
  var ctx = null, items = [], listeners = [];
  var draw = null; // { type, mode, pts, ghost } ระหว่างวาด
  var editId = null, tmpType = 'house', tmpMode = 'poly';
  var FLOOR_H = 3.2;

  // ชนิดสิ่งปลูกสร้าง: h ความสูงเริ่มต้น (ม.) mode วิธีวาดที่แนะนำ
  var TYPES = {
    house: { name: '🏠 บ้าน', h: 6, mode: 'rect', color: '#e8dcc5', floors: true },
    building: { name: '🏢 ตึก/อาคาร', h: 12.8, mode: 'rect', color: '#cfd3d9', floors: true },
    row: { name: '🏬 ตึกแถว/ร้านค้า', h: 10, mode: 'rect', color: '#e2c9a8', floors: true },
    temple: { name: '🛕 โบสถ์/วิหาร (หลังคาซ้อน)', h: 9, mode: 'rect', color: '#f3ead2' },
    stupa: { name: '🗼 เจดีย์/สถูป', h: 24, mode: 'rect', color: '#f4efe0' },
    prasat: { name: '🏯 ปราสาท/ปรางค์โบราณ', h: 22, mode: 'rect', color: '#b89a7a' },
    tower: { name: '🗼 หอคอย/หอสังเกตการณ์', h: 30, mode: 'rect', color: '#c9c9c9' },
    pavilion: { name: '⛩ ศาลา', h: 5, mode: 'rect', color: '#d9c7a1' },
    ruins: { name: '🧱 ซากโบราณสถาน', h: 3, mode: 'poly', color: '#a89b88' },
    wall: { name: '🧱 กำแพง/คูเมือง (วาดเป็นเส้น)', h: 4, mode: 'line', color: '#b5a38a' }
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

  // แตกสิ่งปลูกสร้างเป็นชั้นสำหรับวาด: [{ poly, base, h, c }]
  function tiers(it) {
    var T = TYPES[it.type] || TYPES.house, H = heightOf(it), col = it.color || T.color, p = it.pts;
    if (it.type === 'wall' || it.mode === 'line') return bufferLine(p, +it.w || 1.8).map(function (q) { return { poly: q, base: 0, h: H, c: col }; });
    var c = centroid(p), out = [];
    function add(s, b, h, cc) { out.push({ poly: s === 1 ? p : scaleTo(p, c, s), base: b, h: h, c: cc || col }); }
    switch (it.type) {
      case 'temple': { // ผนัง + หลังคาซ้อน 3 ชั้น
        var wall = H * 0.55; add(1, 0, wall); add(1.08, wall, wall + H * 0.14, '#c0502b'); add(0.86, wall + H * 0.14, wall + H * 0.26, '#a63c1f'); add(0.55, wall + H * 0.26, H, '#c0502b'); break;
      }
      case 'stupa': { // ฐานซ้อน ระฆัง คอ ยอดทอง
        var u = H / 100; add(1, 0, 8 * u); add(0.86, 8 * u, 15 * u); add(0.72, 15 * u, 24 * u); add(0.56, 24 * u, 60 * u); add(0.4, 60 * u, 72 * u); add(0.26, 72 * u, 84 * u); add(0.14, 84 * u, 94 * u, '#d4af37'); add(0.05, 94 * u, 100 * u, '#d4af37'); break;
      }
      case 'prasat': { // ปรางค์ขั้นบันได
        add(1, 0, H * 0.22); add(0.82, H * 0.22, H * 0.42); add(0.64, H * 0.42, H * 0.6); add(0.46, H * 0.6, H * 0.78); add(0.3, H * 0.78, H * 0.92); add(0.12, H * 0.92, H, '#9c7f60'); break;
      }
      case 'tower': { add(1, 0, H * 0.85); add(1.25, H * 0.85, H * 0.92, '#9a9a9a'); add(0.7, H * 0.92, H, '#7d7d7d'); break; }
      case 'pavilion': { // เสา 4 ต้น + หลังคา
        p.forEach(function (v) { out.push({ poly: scaleTo([v, [v[0] + (c[0] - v[0]) * 0.1, v[1]], [v[0] + (c[0] - v[0]) * 0.1, v[1] + (c[1] - v[1]) * 0.1], [v[0], v[1] + (c[1] - v[1]) * 0.1]], v, 1), base: 0, h: H - 0.9, c: '#8c6d4a' }); });
        add(1.15, H - 0.9, H, '#b7452f'); break;
      }
      case 'ruins': { // ฐาน + ท่อนผนังพังไม่เท่ากัน
        add(1, 0, 0.8, '#968a78');
        p.forEach(function (v, i) { var a = [v, [v[0] + (c[0] - v[0]) * 0.28, v[1] + (c[1] - v[1]) * 0.05], [v[0] + (c[0] - v[0]) * 0.3, v[1] + (c[1] - v[1]) * 0.3], [v[0] + (c[0] - v[0]) * 0.05, v[1] + (c[1] - v[1]) * 0.28]]; out.push({ poly: a, base: 0.8, h: 0.8 + H * (0.35 + 0.65 * seeded(it.id, i)), c: col }); });
        add(0.45, 0.8, 0.8 + H * 0.3 * seeded(it.id, 99), '#b3a794'); break;
      }
      default: add(1, 0, H); // บ้าน ตึก ตึกแถว
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
      if (!it.pts || it.pts.length < 2) return;
      tiers(it).forEach(function (t) { f.push({ type: 'Feature', properties: { k: 'b', id: it.id, c: t.c, b: t.base, h: t.h }, geometry: { type: 'Polygon', coordinates: [closeRing(t.poly)] } }); });
      var base = tiers(it)[0];
      if (base) f.push({ type: 'Feature', properties: { k: 'o', id: it.id }, geometry: { type: 'LineString', coordinates: closeRing(base.poly) } });
      var c = it.type === 'wall' ? it.pts[Math.floor(it.pts.length / 2)] : centroid(it.pts);
      if (it.name) f.push({ type: 'Feature', properties: { k: 'l', id: it.id, n: it.name }, geometry: { type: 'Point', coordinates: c } });
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
    var n = draw.pts.length, need = draw.mode === 'rect' ? 3 : draw.mode === 'line' ? 2 : 3;
    var hint = draw.mode === 'rect' ? (n === 0 ? 'แตะมุมแรก' : n === 1 ? 'แตะมุมที่สองของด้านเดียวกัน' : 'แตะด้านตรงข้ามเพื่อกำหนดความลึก') : (n < need ? 'แตะวางจุด (' + n + ') ต้องมีอย่างน้อย ' + need + ' จุด' : 'แตะวางจุดต่อ หรือกด ✓ เสร็จ');
    b.innerHTML = '';
    b.appendChild(el('div', 'font-weight:700', (TYPES[draw.type] || {}).name + ' · ' + hint));
    var row = el('div', 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap');
    function btn(t, fn, pri) { var x = el('button', 'flex:none;border:0;border-radius:9px;padding:6px 12px;font-size:14px;' + (pri ? 'background:#2e6b3f;color:#fff' : 'background:#e8efe9;color:#2e6b3f'), t); x.onclick = fn; row.appendChild(x); }
    btn('↶ ย้อน', function () { draw.pts.pop(); draw.ghost = null; drawDraft(); bar(); });
    if (draw.mode !== 'rect') btn('✓ เสร็จ', finishDraw, true);
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
    var need = draw.mode === 'line' ? 2 : 3;
    if (draw.mode === 'rect' && draw.pts.length >= 3) { draw.pts = rectFrom(draw.pts); }
    if (draw.pts.length < need) { ctx.toast('ยังวางจุดไม่พอ'); return; }
    var T = TYPES[draw.type];
    var it = { id: uid(), name: T.name.replace(/^\S+\s/, '').replace(/ \(.*\)/, ''), type: draw.type, mode: draw.mode, pts: draw.pts, h: T.h, floors: T.floors ? Math.round(T.h / FLOOR_H) : 0, proj: root.TrailProj ? TrailProj.active() : 'default', show: true };
    if (it.type === 'wall') it.w = 1.8;
    items.push(it);
    if (root.TrailProj) TrailProj.reveal(it.proj);
    if (draw.mv) ctx.map().off('mousemove', draw.mv);
    draw = null; drawDraft(); bar(); changed();
    var m = ctx.map(); if (m.getPitch() < 30) m.easeTo({ pitch: 55, duration: 700 });
    editId = it.id; ctx.openSheet('struct'); // เปิดหน้าแก้ไขทันที
  }
  function handleClick(e) {
    if (movingHook) { movingHook(e); return true; }
    if (draw) {
      var p = [e.lngLat.lng, e.lngLat.lat];
      draw.pts.push(p); draw.ghost = null;
      if (draw.mode === 'rect' && draw.pts.length === 3) { finishDraw(); return true; }
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
    opts.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; if (String(o[0]) === String(cur)) op.selected = true; s.appendChild(op); });
    s.onchange = function () { fn(s.value); }; return s;
  }
  function field(label, node) { var r = el('div', 'display:flex;align-items:center;gap:8px;margin:6px 0'); r.appendChild(el('label', 'flex:0 0 92px;font-size:14px', label)); r.appendChild(node); return r; }
  function numInput(v, step, fn) { var i = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px'); i.type = 'number'; i.step = step; i.value = v; i.inputMode = 'decimal'; i.onchange = function () { fn(parseFloat(i.value)); }; return i; }
  function button(t, fn, pri) { var x = el('button', 'border:0;border-radius:10px;padding:9px 14px;font-size:15px;' + (pri ? 'background:#2e6b3f;color:#fff' : 'background:#e8efe9;color:#2e6b3f'), t); x.onclick = fn; return x; }

  function renderSheet(body) {
    body.innerHTML = '';
    var it = editId && byId(editId);
    if (it) return renderEdit(body, it);
    body.appendChild(el('p', 'font-size:13px;color:#555;margin:6px 0', 'วาดบ้าน ตึก เจดีย์ ปราสาท กำแพง ฯลฯ ลงบนแผนที่ แล้วยกเป็น 3 มิติ · เก็บในเครื่อง รวมอยู่ใน "งาน" ที่ใช้อยู่'));
    body.appendChild(field('ชนิด', selectBox(Object.keys(TYPES).map(function (k) { return [k, TYPES[k].name]; }), tmpType, function (v) { tmpType = v; tmpMode = TYPES[v].mode; renderSheet(body); })));
    body.appendChild(field('วิธีวาด', selectBox([['rect', 'สี่เหลี่ยม (แตะ 3 จุด)'], ['poly', 'หลายเหลี่ยม (แตะทีละมุม แล้วกดเสร็จ)'], ['line', 'เส้น (เหมาะกับกำแพง)']], tmpMode, function (v) { tmpMode = v; })));
    var row = el('div', 'display:flex;gap:8px;margin:10px 0'); row.appendChild(button('✏ เริ่มวาด', function () { startDraw(tmpType, tmpType === 'wall' ? 'line' : tmpMode); }, true)); body.appendChild(row);
    var mine = items.filter(function (x) { return !root.TrailProj || TrailProj.active() === (x.proj || 'default'); });
    body.appendChild(el('h4', 'margin:12px 0 4px', 'สิ่งปลูกสร้างในงานนี้ (' + mine.length + ')'));
    if (!mine.length) body.appendChild(el('div', 'font-size:13px;color:#777', 'ยังไม่มี · แตะอาคารบนแผนที่ (ตอนเปิดโหมดนี้) เพื่อแก้ไข'));
    mine.forEach(function (x) {
      var r = el('div', 'display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px solid #f0f0f0');
      var cb = el('input', 'width:22px;height:22px;flex:none;accent-color:#2e6b3f'); cb.type = 'checkbox'; cb.checked = x.show !== false; cb.onchange = function () { x.show = cb.checked; changed(); }; r.appendChild(cb);
      r.appendChild(el('div', 'flex:1;min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', (TYPES[x.type] || {}).name.split(' ')[0] + ' ' + (x.name || '(ไม่มีชื่อ)') + ' · ' + Math.round(heightOf(x)) + ' ม.'));
      r.appendChild(button('ดู', function () { var c = x.type === 'wall' ? x.pts[0] : centroid(x.pts), m = ctx.map(); ctx.closeSheet(); m.easeTo({ center: c, zoom: Math.max(m.getZoom(), 17), pitch: 55, duration: 800 }); }));
      r.appendChild(button('แก้', function () { editId = x.id; renderSheet(body); }));
      body.appendChild(r);
    });
  }
  function renderEdit(body, it) {
    var T = TYPES[it.type] || TYPES.house;
    body.appendChild(field('ชื่อ', (function () { var i = el('input', 'flex:1;min-width:0;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:8px'); i.value = it.name || ''; i.placeholder = 'เช่น วัดพระธาตุ, บ้านผู้ใหญ่'; i.onchange = function () { it.name = i.value.trim(); changed(); }; return i; })()));
    body.appendChild(field('ชนิด', selectBox(Object.keys(TYPES).map(function (k) { return [k, TYPES[k].name]; }), it.type, function (v) { it.type = v; if (v === 'wall') { it.mode = 'line'; it.w = it.w || 1.8; } it.h = TYPES[v].h; it.floors = TYPES[v].floors ? Math.round(TYPES[v].h / FLOOR_H) : 0; it.color = ''; changed(); body.innerHTML = ''; renderEdit(body, it); })));
    var hIn;
    if (T.floors) body.appendChild(field('จำนวนชั้น', numInput(it.floors || 1, '1', function (v) { if (v >= 1) { it.floors = Math.round(v); it.h = Math.round(it.floors * FLOOR_H * 10) / 10; if (hIn) hIn.value = it.h; changed(); } })));
    hIn = numInput(Math.round(heightOf(it) * 10) / 10, '0.5', function (v) { if (v > 0) { it.h = v; if (T.floors) it.floors = Math.max(1, Math.round(v / FLOOR_H)); changed(); } });
    body.appendChild(field('สูง (เมตร)', hIn));
    if (it.type === 'wall') body.appendChild(field('หนา (เมตร)', numInput(it.w || 1.8, '0.1', function (v) { if (v > 0) { it.w = v; changed(); } })));
    var col = el('input', 'flex:1;height:40px;border:1px solid #ccc;border-radius:8px;padding:2px'); col.type = 'color'; col.value = it.color || T.color; col.onchange = function () { it.color = col.value; changed(); };
    body.appendChild(field('สีหลัก', col));
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
