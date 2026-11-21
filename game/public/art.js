// รูปประกอบข้อสอบ: วาดจากคำอธิบายรูป (art) ที่ bank.js ใส่มาให้ทุกข้อ
// - แผนที่ย่อ: ชิ้นแผนที่ ESRI Topo + เส้นกริด (° ′ ″ หรือ UTM) + หมุด/เส้น
// - แผนภาพ SVG: หน้าปัดเข็มทิศ เส้นชั้นความสูง มาตราส่วน ฯลฯ
(function (root) {
  var W = 360, H = 200;
  var INK = '#222', BROWN = '#8a4b1c', GREEN = '#2e7d32', RED = '#c62828', BLUE = '#1565c0', PAPER = '#fbf8ee', GOLD = '#f5b301';
  var TOPIC_ICON = ['❓', '⛰️', '🌐', '🔢', '📐', '🧭', '🗺️', '📏'];
  var TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/';

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f1(n) { return Math.round(n * 10) / 10; }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function svg(inner, w, h) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (w || W) + ' ' + (h || H) + '" width="100%" height="100%" font-family="Sarabun,Noto Sans Thai,sans-serif">' + inner + '</svg>'; }
  function T(x, y, s, o) { o = o || {}; return '<text x="' + x + '" y="' + y + '" font-size="' + (o.s || 12) + '" fill="' + (o.c || INK) + '" text-anchor="' + (o.a || 'middle') + '"' + (o.w ? ' font-weight="' + o.w + '"' : '') + '>' + esc(s) + '</text>'; }
  function L(x1, y1, x2, y2, c, w, d) { return '<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="' + (c || INK) + '" stroke-width="' + (w || 1) + '"' + (d ? ' stroke-dasharray="' + d + '"' : '') + ' stroke-linecap="round"/>'; }
  function P(d, c, w, fill, dash) { return '<path d="' + d + '" stroke="' + (c || INK) + '" stroke-width="' + (w || 1) + '" fill="' + (fill || 'none') + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="round" stroke-linejoin="round"/>'; }
  function R(x, y, w, h, fill, stroke, sw, rx) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 0) + '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"' : '') + '/>'; }
  function C(x, y, r, fill, stroke, sw) { return '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + r + '" fill="' + (fill || 'none') + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"' : '') + '/>'; }
  function polar(cx, cy, r, ang) { var a = (ang - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arrow(x1, y1, x2, y2, c, w) {
    var a = Math.atan2(y2 - y1, x2 - x1), s = 7;
    return L(x1, y1, x2, y2, c, w || 2) + P('M' + f1(x2) + ' ' + f1(y2) + ' L' + f1(x2 - s * Math.cos(a - 0.45)) + ' ' + f1(y2 - s * Math.sin(a - 0.45)) + ' L' + f1(x2 - s * Math.cos(a + 0.45)) + ' ' + f1(y2 - s * Math.sin(a + 0.45)) + ' Z', c, 1, c);
  }
  function arc(cx, cy, r, a0, a1, c, w) { // เส้นโค้งจากมุม a0 ถึง a1 (องศาจากทิศเหนือ ตามเข็มนาฬิกา)
    var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1), large = ((a1 - a0 + 360) % 360) > 180 ? 1 : 0;
    return P('M' + f1(p0[0]) + ' ' + f1(p0[1]) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + f1(p1[0]) + ' ' + f1(p1[1]), c, w || 2);
  }
  function box(html, w, h, bg) { var d = document.createElement('div'); d.style.cssText = 'width:' + (w || W) + 'px;height:' + (h || H) + 'px;background:' + (bg || PAPER) + ';border-radius:12px;overflow:hidden;position:relative;flex:none'; d.innerHTML = html; return d; }

  // ---------- แผนที่ย่อ ----------
  function wx(lng, z) { return (lng + 180) / 360 * 256 * Math.pow(2, z); }
  function wy(lat, z) { var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z); }
  function dmsLabel(v, isLat, stepMin) {
    v = Math.abs(v); var d = Math.floor(v), mm = (v - d) * 60, m = Math.floor(mm + 1e-9), s = Math.round((mm - m) * 60);
    if (s === 60) { s = 0; m++; }
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d + '°' + pad(m) + '′' + (stepMin < 1 ? pad(s) + '″' : '') + (isLat ? 'N' : 'E');
  }
  function mapThumb(a, w, h) {
    var f = a.frame, z = 15, cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
    for (; z > 4; z--) { var fw = (wx(f[2], z) - wx(f[0], z)) * 1.2, fh = (wy(f[1], z) - wy(f[3], z)) * 1.2; if (fw <= w && fh <= h) break; }
    var ox = wx(cx, z) - w / 2, oy = wy(cy, z) - h / 2;
    var px = function (lng, lat) { return [wx(lng, z) - ox, wy(lat, z) - oy]; };
    var tiles = '', x0 = Math.floor(ox / 256), x1 = Math.floor((ox + w) / 256), y0 = Math.floor(oy / 256), y1 = Math.floor((oy + h) / 256), n = Math.pow(2, z);
    for (var tx = x0; tx <= x1; tx++) for (var ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      tiles += '<img loading="lazy" referrerpolicy="no-referrer" src="' + TILE + z + '/' + ty + '/' + (((tx % n) + n) % n) + '" style="position:absolute;left:' + Math.round(tx * 256 - ox) + 'px;top:' + Math.round(ty * 256 - oy) + 'px;width:256px;height:256px">';
    }
    var o = '', a0 = px(f[0], f[3]), a1 = px(f[2], f[1]);
    var g = a.grid; // เส้นกริด
    if (g && g.t === 'll') {
      var st = g.step / 60, e = (f[2] - f[0]) * 0.4;
      for (var la = Math.floor((f[1] - e) / st) * st; la <= f[3] + e; la += st) { var pl = px(cx, la)[1]; o += L(0, pl, w, pl, 'rgba(20,20,20,.6)', 1) + T(4, pl - 2, dmsLabel(la + 1e-9, true, g.step), { s: 9, a: 'start', c: '#000' }); }
      for (var lo = Math.floor((f[0] - e) / st) * st; lo <= f[2] + e; lo += st) { var pm = px(lo, cy)[0]; o += L(pm, 0, pm, h, 'rgba(20,20,20,.6)', 1) + T(pm + 2, 11, dmsLabel(lo + 1e-9, false, g.step), { s: 9, a: 'start', c: '#000' }); }
    } else if (g && g.t === 'utm' && root.TrailGeo) {
      var G = root.TrailGeo, cs = [[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]].map(function (p) { return G.toUTM(p[1], p[0], 47); });
      var es = cs.map(function (c) { return c.e; }), ns = cs.map(function (c) { return c.n; }), minE = Math.min.apply(null, es), maxE = Math.max.apply(null, es), minN = Math.min.apply(null, ns), maxN = Math.max.apply(null, ns), step = g.step;
      var lab = function (v) { return step < 1000 ? String(Math.floor(v / 100) % 1000).padStart(3, '0') : String(Math.floor(v / 1000) % 100).padStart(2, '0'); };
      var q = function (e2, n2) { var ll = G.fromUTM(47, true, e2, n2), p = px(ll.lng, ll.lat); return p[0] + ',' + p[1]; };
      var ex = (maxE - minE) * 0.4, ny = (maxN - minN) * 0.4, cnt = 0;
      for (var ee = Math.floor((minE - ex) / step) * step; ee <= maxE + ex && cnt < 60; ee += step, cnt++) { var pa = q(ee, minN - ny).split(','), pb = q(ee, maxN + ny).split(','); o += L(pa[0], pa[1], pb[0], pb[1], 'rgba(20,20,20,.6)', 1) + T(+pa[0] + (+pb[0] - +pa[0]) * 0.5 + 2, 11, lab(ee), { s: 9, a: 'start', c: '#000' }); }
      cnt = 0;
      for (var nn = Math.floor((minN - ny) / step) * step; nn <= maxN + ny && cnt < 60; nn += step, cnt++) { var pc = q(minE - ex, nn).split(','), pd = q(maxE + ex, nn).split(','); o += L(pc[0], pc[1], pd[0], pd[1], 'rgba(20,20,20,.6)', 1) + T(4, +pc[1] - 2, lab(nn), { s: 9, a: 'start', c: '#000' }); }
    }
    o += R(Math.min(a0[0], a1[0]), Math.min(a0[1], a1[1]), Math.abs(a1[0] - a0[0]), Math.abs(a1[1] - a0[1]), 'none', RED, 1.5).replace('/>', ' stroke-dasharray="5 3"/>');
    (a.lines || []).forEach(function (ln) { var p1 = px(ln[0][1], ln[0][0]), p2 = px(ln[1][1], ln[1][0]); o += L(p1[0], p1[1], p2[0], p2[1], RED, 2.2, '6 4'); });
    (a.markers || []).forEach(function (m) { var p = px(m.lng, m.lat), col = m.label === 'A' ? BLUE : m.label === 'B' ? RED : '#6a1b9a'; o += C(p[0], p[1], 10, col, '#fff', 2) + T(p[0], p[1] + 4, m.label || '', { s: 12, c: '#fff', w: 700 }); });
    if (a.target) { var pt = px(a.target.lng, a.target.lat); o += C(pt[0], pt[1], 9, GREEN, '#fff', 2.5) + T(pt[0], pt[1] + 4, '✓', { s: 12, c: '#fff', w: 700 }); }
    if (a.north) o += arrow(w - 22, 38, w - 22, 12, '#000', 2.5) + T(w - 22, 52, 'N', { s: 13, w: 700, c: '#000' });
    if (a.terrain) o += R(6, h - 22, 150, 16, 'rgba(255,255,255,.85)', null, 0, 4) + T(10, h - 10, 'พื้นที่ภูมิประเทศ (กรอบแดง)', { s: 10, a: 'start' });
    var d = box('', w, h, '#dfe8ee'); d.innerHTML = tiles + '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" style="position:absolute;left:0;top:0" font-family="Sarabun,Noto Sans Thai,sans-serif">' + o + '</svg>';
    return d;
  }

  // ---------- เส้นชั้นความสูง ----------
  function wavy(y, amp, c, w, dash) { return P('M20 ' + y + ' C 90 ' + (y - amp) + ' 130 ' + (y + amp) + ' 190 ' + y + ' S 290 ' + (y - amp) + ' 340 ' + y, c || BROWN, w || 1.8, 'none', dash); }
  function contourArt(c) {
    var o = '';
    if (c === 'steep') { for (var i = 0; i < 8; i++) o += wavy(45 + i * 9, 4, BROWN, i % 4 === 0 ? 2.2 : 1.2) + (i % 2 === 0 ? T(344, 48 + i * 9, String(440 - i * 20), { s: 8, a: 'end', c: BROWN }) : ''); o += T(180, 150, 'เส้นชิดกันมาก = ลาดชัน', { s: 16, w: 700 }) + arrow(40, 130, 40, 190, GREEN, 3) + T(60, 188, 'ลาดชัน', { s: 11, a: 'start', c: GREEN }); }
    else if (c === 'gentle') { for (var j = 0; j < 4; j++) o += wavy(40 + j * 42, 6, BROWN, 1.6) + T(344, 43 + j * 42, String(180 - j * 20), { s: 10, a: 'end', c: BROWN }); o += T(180, 196, 'เส้นห่างกัน = ลาดเอียงน้อย', { s: 15, w: 700 }); }
    else if (c === 'hill') { var rs = [150, 122, 96, 72, 50, 28]; rs.forEach(function (r, k) { o += '<ellipse cx="180" cy="100" rx="' + r + '" ry="' + r * 0.62 + '" fill="none" stroke="' + BROWN + '" stroke-width="' + (k % 2 ? 1.2 : 2) + '"/>' + T(180, 100 - r * 0.62 + 11, String(100 + k * 20), { s: 8, c: BROWN }); }); o += P('M180 88 l-8 14 h16 Z', INK, 1, INK) + T(180, 118, 'ยอดเขา', { s: 11, w: 700 }) + T(180, 196, 'วงปิดซ้อนกัน วงในสุดสูงที่สุด', { s: 14, w: 700 }); }
    else if (c === 'vup' || c === 'vdown') {
      var up = c === 'vup';
      for (var k = 0; k < 5; k++) { var ty = up ? 130 - k * 24 : 60 + k * 24; o += up ? P('M105 ' + (ty + 46) + ' L180 ' + ty + ' L255 ' + (ty + 46), BROWN, 1.8) : P('M105 ' + (ty - 46) + ' L180 ' + ty + ' L255 ' + (ty - 46), BROWN, 1.8); o += T(268, up ? ty + 40 : ty - 40, String(up ? 100 + k * 20 : 180 - k * 20), { s: 9, a: 'start', c: BROWN }); }
      o += up ? L(180, 30, 180, 185, BLUE, 1.5, '4 3') + T(300, 190, 'ร่องน้ำ/หุบเขา', { s: 13, w: 700, c: BLUE }) + arrow(60, 160, 60, 40, GREEN, 3) + T(60, 30, 'สูงขึ้น', { s: 11, c: GREEN }) : L(180, 20, 180, 170, GOLD, 1.5, '4 3') + T(300, 190, 'สันเขา', { s: 13, w: 700, c: '#a06a00' }) + arrow(60, 40, 60, 160, GREEN, 3) + T(60, 178, 'ต่ำลง', { s: 11, c: GREEN });
      o += T(180, 14, up ? 'V ชี้ขึ้นไปทางที่สูง' : 'V ชี้ลงไปทางที่ต่ำ', { s: 13, w: 700 });
    }
    else if (c === 'equal') { o += wavy(70, 18, BROWN, 2.4) + wavy(140, 14, BROWN, 2.4, '10 5'); [60, 190, 300].forEach(function (x) { o += T(x, 64, '300 ม.', { s: 11, c: BROWN, w: 700 }); }); o += P('M60 70 l0 0', BROWN, 1) + T(180, 112, 'ทุกจุดบนเส้นเดียวกัน สูงเท่ากัน', { s: 14, w: 700 }) + T(180, 190, 'จุดบนเส้นนี้ทุกจุด = 300 เมตร จากระดับน้ำทะเล', { s: 11 }); }
    else if (c === 'interval') { o += wavy(60, 10, BROWN, 2.2) + wavy(140, 10, BROWN, 2.2) + T(30, 55, '120 ม.', { s: 11, a: 'start', c: BROWN, w: 700 }) + T(30, 135, '100 ม.', { s: 11, a: 'start', c: BROWN, w: 700 }) + arrow(180, 68, 180, 132, RED, 2.4) + arrow(180, 132, 180, 68, RED, 2.4) + T(215, 104, 'ช่วงห่าง = 20 ม.', { s: 14, a: 'start', c: RED, w: 700 }) + T(180, 190, 'ความสูงที่ต่างกันของเส้นที่ติดกัน', { s: 11 }); }
    else { // saddle
      [[100, 70], [260, 70]].forEach(function (p) { [60, 38, 18].forEach(function (r, k) { o += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="' + r + '" ry="' + r * 0.7 + '" fill="none" stroke="' + BROWN + '" stroke-width="' + (k % 2 ? 1.2 : 2) + '"/>'; }); });
      o += P('M150 20 Q180 70 150 120', BROWN, 1.6) + P('M210 20 Q180 70 210 120', BROWN, 1.6) + P('M100 150 Q180 98 260 150', BROWN, 1.6) + P('M100 175 Q180 120 260 175', BROWN, 1.6) + T(180, 76, '✕', { s: 16, c: RED, w: 700 }) + T(180, 192, 'ช่องเขา (saddle): อยู่ระหว่างยอดเขา 2 ยอด', { s: 12, w: 700 });
    }
    return box(svg(o));
  }
  function ctypesArt(hl) {
    var names = ['หลัก (Index)', 'รอง (Intermediate)', 'แทรก (Supplement)', 'คุ้งกระทะ (Depression)', 'โดยประมาณ (Approximate)'], o = '';
    for (var i = 0; i < 5; i++) {
      var y = 22 + i * 38, on = i === hl;
      if (on) o += R(6, y - 17, 348, 34, 'rgba(245,179,1,.35)', GOLD, 2, 6);
      var path = 'M20 ' + y + ' Q 60 ' + (y - 8) + ' 100 ' + y + ' T 180 ' + y;
      if (i === 0) o += P(path, BROWN, 3.4) + T(100, y - 5, '300', { s: 9, c: BROWN, w: 700 });
      else if (i === 1) o += P(path, BROWN, 1.3);
      else if (i === 2) o += P(path, BROWN, 1.4, 'none', '7 4');
      else if (i === 3) { o += P(path, BROWN, 1.6); for (var k = 0; k < 5; k++) o += L(35 + k * 30, y - 1, 35 + k * 30, y + 8, BROWN, 1.5); }
      else o += P(path, BROWN, 1.8, 'none', '16 6');
      o += T(196, y + 4, names[i], { s: 13, a: 'start', w: on ? 700 : 400 });
    }
    return box(svg(o));
  }
  function hillShape(f) { return P('M20 180 Q 100 150 150 80 Q 180 40 210 80 Q 260 150 340 180 Z', 'none', 0, '#d8c9a6'); }
  function profileArt(a, two) {
    var o = hillShape(), n = two ? Math.min(12, Math.max(1, Math.round((a.h2 - a.h1) / a.interval))) : Math.min(12, a.count), I = a.interval, base = two ? a.h1 : a.first, step = Math.min(24, 120 / n), lines = two ? n + 1 : n;
    for (var j = 0; j < lines; j++) {
      var y = 176 - j * step, half = 150 - (176 - y) * 0.95 + 5, last = j === lines - 1;
      o += L(180 - half, y, 180 + half, y, last ? RED : BROWN, last ? 2.4 : 1.4) + T(180 + half + 4, y + 3, (base + j * I) + ' ม.', { s: 9, a: 'start', c: last ? RED : BROWN, w: last ? 700 : 400 });
    }
    if (two) { var yb = 176 - n * step; o += C(180 - (150 - (176 - yb) * 0.95 + 5), yb, 6, RED, '#fff', 2) + T(180 - (150 - (176 - yb) * 0.95 + 5) - 12, yb + 4, 'B', { s: 12, a: 'end', w: 700, c: RED }) + C(180 + 148, 176, 6, BLUE, '#fff', 2) + T(340, 168, 'A', { s: 12, w: 700, c: BLUE }); o += T(180, 16, 'ต่างกัน ' + (a.h2 - a.h1) + ' ม. ÷ ' + I + ' ม. = ' + n + ' เส้น', { s: 13, w: 700 }); }
    else o += T(180, 16, 'เส้นแรก ' + a.first + ' ม. ช่วงห่าง ' + I + ' ม. → เส้นที่ ' + a.count + ' = ' + (a.first + (a.count - 1) * I) + ' ม.', { s: 12, w: 700 });
    return box(svg(o));
  }

  // ---------- พิกัด ----------
  function graticuleArt(hl) {
    var o = R(30, 20, 300, 160, '#e9f1f7', '#456', 1.5);
    for (var i = 1; i < 6; i++) o += L(30 + i * 50, 20, 30 + i * 50, 180, '#9ab', 1);
    for (var j = 1; j < 4; j++) o += L(30, 20 + j * 40, 330, 20 + j * 40, '#9ab', 1);
    var eq = hl === 'lat', pm = hl === 'lng';
    o += L(30, 100, 330, 100, eq ? RED : '#456', eq ? 3.4 : 2, eq ? '' : '') + T(334, 96, 'เส้นศูนย์สูตร 0°', { s: 10, a: 'end', c: eq ? RED : '#456', w: 700 });
    o += L(180, 20, 180, 180, pm ? RED : '#456', pm ? 3.4 : 2) + T(184, 34, 'เมอริเดียนเริ่มแรก 0°', { s: 10, a: 'start', c: pm ? RED : '#456', w: 700 });
    o += C(255, 60, 6, GREEN, '#fff', 2) + T(262, 56, 'จุด P', { s: 11, a: 'start', c: GREEN, w: 700 });
    if (eq) o += arrow(255, 98, 255, 66, RED, 2.4) + T(285, 84, 'ละติจูด', { s: 11, a: 'start', c: RED, w: 700 });
    if (pm) o += arrow(182, 60, 249, 60, RED, 2.4) + T(215, 52, 'ลองจิจูด', { s: 11, c: RED, w: 700 });
    if (hl === 'dms') o += T(180, 196, '14°15′35″ N · 99°30′25″ E', { s: 13, w: 700 });
    return box(svg(o));
  }
  function dmsbarArt(hl) {
    var o = R(30, 28, 300, 34, '#e9f1f7', '#456', 1.5) + T(180, 50, '1 องศา (°)', { s: 15, w: 700 });
    for (var i = 0; i <= 60; i += 5) o += L(30 + i * 5, 74, 30 + i * 5, i % 10 === 0 ? 92 : 84, '#456', 1);
    o += T(30, 106, '0′', { s: 10 }) + T(330, 106, '60′ = 1°', { s: 10, a: 'end' }) + R(30 + 20 * 5, 74, 5, 22, hl === 'min' ? 'rgba(245,179,1,.7)' : 'none', null) + T(180, 126, '1 องศา = 60 ลิปดา (′) · 1 ลิปดา = 60 ฟิลิปดา (″)', { s: 12 });
    o += R(30, 140, 300, 24, hl === 'min' ? 'rgba(245,179,1,.35)' : '#f3f3f3', hl === 'min' ? GOLD : '#ccc', 1.5, 5) + T(180, 157, '1 ลิปดา ≈ 1,800 ม. (≈ 1 ไมล์ทะเล = 1,852 ม.)', { s: 12, w: hl === 'min' ? 700 : 400 });
    o += R(30, 168, 300, 24, hl === 'sec' ? 'rgba(245,179,1,.35)' : '#f3f3f3', hl === 'sec' ? GOLD : '#ccc', 1.5, 5) + T(180, 185, '1 ฟิลิปดา ≈ 30 ม.', { s: 12, w: hl === 'sec' ? 700 : 400 });
    return box(svg(o));
  }
  function coordgridArt(a) {
    var maxD = Math.max(a.dE, a.dN, 1), sc = 120 / maxD, x0 = 70, y0 = 160, x1 = x0 + a.dE * sc, y1 = y0 - a.dN * sc, o = '';
    for (var i = 0; i <= 6; i++) o += L(30 + i * 50, 20, 30 + i * 50, 180, '#e3e3e3', 1) + L(30, 20 + i * 27, 330, 20 + i * 27, '#e3e3e3', 1);
    o += L(x0, y0, x1, y0, BLUE, 2, '5 3') + L(x1, y0, x1, y1, BLUE, 2, '5 3') + arrow(x0, y0, x1, y1, RED, 2.6) + C(x0, y0, 7, BLUE, '#fff', 2) + C(x1, y1, 7, RED, '#fff', 2) + T(x0 - 12, y0 + 4, 'A', { s: 13, w: 700, a: 'end' }) + T(x1 + 14, y1 + 4, 'B', { s: 13, w: 700, a: 'start' });
    o += T((x0 + x1) / 2, y0 + 15, 'ΔE = ' + fmt(a.dE) + ' ม.', { s: 11, c: BLUE }) + T(x1 + 8, (y0 + y1) / 2, 'ΔN = ' + fmt(a.dN) + ' ม.', { s: 11, c: BLUE, a: 'start' }) + T(180, 14, 'ระยะ = √(ΔE² + ΔN²) ≈ ' + fmt(a.dist) + ' ม.', { s: 12, w: 700 });
    return box(svg(o));
  }
  function paceArt(a) {
    var o = T(180, 20, 'ก้าวมาตรฐาน: 100 ม. = ' + a.std + ' ก้าว', { s: 14, w: 700 }), x;
    for (var i = 0; i < 14; i++) { x = 24 + i * 23; o += '<ellipse cx="' + x + '" cy="' + (i % 2 ? 74 : 62) + '" rx="6" ry="10" fill="#8d6e63"/>' + '<ellipse cx="' + x + '" cy="' + (i % 2 ? 90 : 78) + '" rx="5" ry="6" fill="#8d6e63"/>'; }
    o += T(180, 112, '… นับก้าวได้ ' + fmt(a.steps) + ' ก้าว', { s: 13 }) + L(30, 140, 330, 140, '#555', 2);
    var mx = Math.max(a.dist, 100), px = function (m) { return 30 + m / mx * 300; };
    for (var k = 0; k <= mx; k += 100) o += L(px(k), 134, px(k), 146, '#555', 1.5) + T(px(k), 160, k + ' ม.', { s: 9 });
    o += C(px(a.dist), 140, 7, RED, '#fff', 2) + T(px(a.dist), 126, fmt(a.dist) + ' ม.', { s: 12, c: RED, w: 700 }) + T(180, 188, 'ระยะ = (ก้าวที่นับ ÷ ก้าวมาตรฐาน) × 100 ม.', { s: 12 });
    return box(svg(o));
  }

  // ---------- เข็มทิศ ----------
  function dialArt(a, size) {
    var d = box('', size || 200, size || 200, a.night ? '#0a120b' : PAPER); d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.justifyContent = 'center';
    var inner = document.createElement('div'); inner.style.cssText = 'width:' + ((size || 200) - 6) + 'px;height:' + ((size || 200) - 6) + 'px'; d.appendChild(inner);
    if (root.Dial) { var dl = root.Dial.create(inner, { night: !!a.night }); dl.setTarget(a.angle); }
    var cap = document.createElement('div'); cap.style.cssText = 'position:absolute;left:0;right:0;bottom:2px;text-align:center;font:700 13px Sarabun,sans-serif;color:' + (a.night ? '#b6ffb6' : '#1b5e20'); cap.textContent = 'เฉลย ' + Math.round(a.angle) + '° · ' + fmt(Math.round(a.angle * 6400 / 360)) + ' มิลเลียม'; d.appendChild(cap);
    return d;
  }
  function circleArt(a) {
    var deg = a.deg != null ? a.deg : a.mil * 360 / 6400, mil = a.mil != null ? a.mil : a.deg * 6400 / 360, cx = 110, cy = 100, o = C(cx, cy, 80, '#fff', INK, 2);
    for (var i = 0; i < 36; i++) { var p1 = polar(cx, cy, 80, i * 10), p2 = polar(cx, cy, i % 9 === 0 ? 66 : 73, i * 10); o += L(p1[0], p1[1], p2[0], p2[1], INK, i % 9 === 0 ? 2 : 1); }
    o += T(cx, cy - 86, '0° N', { s: 11, w: 700 }) + T(cx + 98, cy + 4, '90°', { s: 11 }) + T(cx, cy + 100, '180°', { s: 11 }) + T(cx - 98, cy + 4, '270°', { s: 11 });
    o += arc(cx, cy, 52, 0, deg, RED, 5) + arrow(cx, cy, polar(cx, cy, 68, deg)[0], polar(cx, cy, 68, deg)[1], BLUE, 2.6);
    o += T(250, 50, '360° = 6,400', { s: 13, a: 'middle', w: 700 }) + T(250, 66, 'มิลเลียม', { s: 13, w: 700 }) + T(250, 100, f1(deg) + '°', { s: 20, c: RED, w: 700 }) + T(250, 122, '=', { s: 14 }) + T(250, 146, fmt(Math.round(mil)) + ' มิล', { s: 18, c: BLUE, w: 700 }) + T(250, 172, '1° ≈ 17.78 มิล', { s: 11 });
    return box(svg(o));
  }
  function bezelArt(a) {
    var cx = 180, cy = 104, r = 80, o = C(cx, cy, r, '#fff', INK, 2) + C(cx, cy, r - 16, 'none', '#999', 1), clicks = Math.round(a.az / 3);
    for (var i = 0; i < 120; i++) { var p1 = polar(cx, cy, r, i * 3), p2 = polar(cx, cy, r - (i % 10 === 0 ? 14 : 7), i * 3); o += L(p1[0], p1[1], p2[0], p2[1], (!a.one && i < clicks) || (a.one && i < 1) ? RED : INK, i % 10 === 0 ? 2 : 1); }
    o += T(cx, cy - r - 6, 'N', { s: 12, w: 700, c: RED });
    if (a.one) o += T(cx, cy, '1 คลิก = 3°', { s: 18, w: 700, c: RED }) + T(cx, cy + 22, '120 คลิก = 360°', { s: 12 });
    else o += arc(cx, cy, r - 24, 0, a.az, RED, 5) + T(cx, cy - 4, a.az + '° ÷ 3° = ' + clicks, { s: 16, w: 700, c: RED }) + T(cx, cy + 18, 'คลิก', { s: 13 });
    return box(svg(o));
  }
  function turnArt(a) {
    var cx = 180, cy = 104, r = 74, end = (a.a + (a.right ? a.t : -a.t) + 360) % 360, o = C(cx, cy, r, '#fff', INK, 2);
    for (var i = 0; i < 36; i++) { var p1 = polar(cx, cy, r, i * 10), p2 = polar(cx, cy, r - (i % 9 === 0 ? 10 : 5), i * 10); o += L(p1[0], p1[1], p2[0], p2[1], INK, 1); }
    var s = polar(cx, cy, r - 8, a.a), e2 = polar(cx, cy, r - 8, end);
    o += T(cx, cy - r - 6, 'N', { s: 12, w: 700, c: RED }) + (a.right ? arc(cx, cy, 42, a.a, end, RED, 4) : arc(cx, cy, 42, end, a.a, RED, 4));
    o += arrow(cx, cy, s[0], s[1], BLUE, 2.8) + arrow(cx, cy, e2[0], e2[1], GREEN, 2.8) + T(polar(cx, cy, r + 14, a.a)[0], polar(cx, cy, r + 14, a.a)[1] + 4, a.a + '°', { s: 12, c: BLUE, w: 700 }) + T(polar(cx, cy, r + 14, end)[0], polar(cx, cy, r + 14, end)[1] + 4, end + '° ?', { s: 12, c: GREEN, w: 700 });
    o += T(300, 100, a.right ? 'เลี้ยวขวา +' + a.t + '°' : 'เลี้ยวซ้าย −' + a.t + '°', { s: 12, c: RED, w: 700 }) + T(180, 196, 'ขวา = บวก · ซ้าย = ลบ (ตามเข็มนาฬิกา)', { s: 11 });
    return box(svg(o));
  }
  function declArt(a) {
    var o = '', ox = 180, oy = 175, len = 135, gn = [ox, oy - len], mn = polar(ox, oy, len, -a.gm * 3.2);
    o += arrow(ox, oy, gn[0], gn[1], BLUE, 3) + T(gn[0] + 4, gn[1] + 4, 'GN เหนือกริด', { s: 11, a: 'start', c: BLUE, w: 700 }) + arrow(ox, oy, mn[0], mn[1], RED, 3) + T(mn[0] - 4, mn[1] + 2, 'MN เหนือแม่เหล็ก', { s: 11, a: 'end', c: RED, w: 700 });
    o += arc(ox, oy, 80, -a.gm * 3.2, 0, '#555', 2) + T(ox - 22, oy - 90, 'G–M ' + a.gm + '° W', { s: 12, w: 700 }) + T(180, 14, 'มุมกริด ' + a.grid + '° → มุมแม่เหล็ก = ' + a.grid + ' + ' + a.gm + ' = ' + (a.grid + a.gm) + '°', { s: 12, w: 700 }) + T(290, 150, '(มุมในภาพขยายให้เห็น)', { s: 9, c: '#777' });
    return box(svg(o));
  }
  function obstacleArt(a) {
    var o = R(150, 90, 60, 22, '#b0b0b0', '#555', 1.5) + T(180, 106, 'สิ่งกีดขวาง', { s: 10 }) + L(180, 190, 180, 120, BLUE, 2.4, '5 3') + L(180, 82, 180, 28, BLUE, 2.4, '5 3'), s = a.right ? 1 : -1, ex = 180 + s * 70;
    o += arrow(180, 190, 180, 124, BLUE, 2.6) + arrow(180, 124, ex, 124, RED, 2.6) + arrow(ex, 124, ex, 76, GREEN, 2.6) + arrow(ex, 76, 180, 76, RED, 2.6) + arrow(180, 76, 180, 30, BLUE, 2.6);
    o += T(200 + s * -0, 170, 'Azimuth ' + a.a + '°', { s: 12, a: 'start', c: BLUE, w: 700 }) + T(180 + s * 35, 117, a.right ? 'ขวา +90°' : 'ซ้าย −90°', { s: 12, c: RED, w: 700 }) + T(ex + (s > 0 ? 6 : -6), 100, 'เดิน ' + a.a + '° ต่อ', { s: 10, a: s > 0 ? 'start' : 'end', c: GREEN }) + T(180 + s * 35, 70, a.right ? 'กลับ −90°' : 'กลับ +90°', { s: 11, c: RED });
    return box(svg(o));
  }
  var PART_NAMES = { cover: 'ฝาตลับ + เส้นเล็ง', body: 'ตัวเรือน', bezel: 'วงแหวนคลิก', dial: 'หน้าปัด (มิลเลียม/องศา)', arrow: 'ลูกศรเรืองแสง', sight: 'ก้านเล็ง (ช่องเล็งหลัง)', loop: 'ห่วงจับถือ', ruler: 'ไม้บรรทัดมาตราส่วน' };
  function partsArt(hl) {
    var on = function (k) { return hl === k || (hl === 'all' && (k === 'cover' || k === 'body' || k === 'sight')); }, col = function (k, base) { return on(k) ? GOLD : base; };
    var o = R(14, 36, 112, 140, on('cover') ? 'rgba(245,179,1,.45)' : '#dde4d2', col('cover', '#556'), on('cover') ? 3 : 1.5, 6) + L(70, 44, 70, 168, INK, 1.5) + C(70, 52, 3, '#9f9') +
      R(126, 36, 150, 140, on('body') ? 'rgba(245,179,1,.35)' : '#e6eddc', col('body', '#556'), on('body') ? 3 : 1.5, 8) + C(200, 106, 56, on('bezel') ? 'rgba(245,179,1,.5)' : '#fff', col('bezel', '#333'), on('bezel') ? 4 : 2) + C(200, 106, 46, on('dial') ? 'rgba(245,179,1,.35)' : '#f7f7ef', col('dial', '#888'), on('dial') ? 3 : 1);
    for (var i = 0; i < 36; i++) { var p1 = polar(200, 106, 46, i * 10), p2 = polar(200, 106, 40, i * 10); o += L(p1[0], p1[1], p2[0], p2[1], '#777', 1); }
    o += P('M200 70 L193 106 L207 106 Z', on('arrow') ? GOLD : '#3a3', 1, on('arrow') ? GOLD : '#9f9') + P('M200 142 L193 106 L207 106 Z', '#888', 1, '#bbb');
    o += R(276, 84, 52, 46, on('sight') ? 'rgba(245,179,1,.5)' : '#cfd6c4', col('sight', '#556'), on('sight') ? 3 : 1.5, 4) + C(302, 107, 11, '#fff', '#556', 1.5) + '<ellipse cx="338" cy="107" rx="11" ry="24" fill="none" stroke="' + col('loop', '#556') + '" stroke-width="' + (on('loop') ? 4 : 2) + '"/>';
    for (var j = 0; j < 12; j++) o += L(136 + j * 11, 176, 136 + j * 11, 170 - (j % 5 === 0 ? 4 : 0), on('ruler') ? RED : '#556', on('ruler') ? 2 : 1);
    var lbl = function (k, x, y, tx, ty, anchor) { return L(x, y, tx, ty, on(k) ? RED : '#999', 1) + T(tx, ty + (ty < y ? -3 : 11), PART_NAMES[k], { s: 10, a: anchor || 'middle', c: on(k) ? RED : '#333', w: on(k) ? 700 : 400 }); };
    o += lbl('cover', 70, 40, 62, 24) + lbl('body', 140, 40, 172, 24) + lbl('sight', 302, 84, 304, 24) + lbl('arrow', 200, 78, 240, 56, 'start') +
      lbl('bezel', 152, 96, 10, 184, 'start') + lbl('dial', 190, 140, 152, 184) + lbl('ruler', 232, 172, 258, 184) + lbl('loop', 346, 130, 354, 184, 'end');
    return box(svg(o));
  }
  var ORIENT_CAP = ['ทาบขอบเข็มทิศกับเส้นกริดตั้ง หมุน "แผนที่" จนลูกศรอยู่ใต้ดัชนีดำ', 'ก่อนเริ่มเดินทุกครั้ง: วางแผนที่ให้ถูกทิศ (Orienting the Map)', 'ถ้ามีมุม G–M ให้หมุนแผนที่เพิ่มตามมุมนั้น', 'กางบนพื้นราบ ห่างจากโลหะ (รถ เสาไฟ อาวุธ)'];
  function orientArt(i) {
    var o = '<g transform="rotate(-14 180 100)">' + R(80, 30, 200, 130, '#f3ecd4', '#9a8', 1.5);
    for (var k = 1; k < 5; k++) o += L(80 + k * 40, 30, 80 + k * 40, 160, '#8ab', 1) + L(80, 30 + k * 26, 280, 30 + k * 26, '#8ab', 1);
    o += L(160, 30, 160, 160, BLUE, 2.2) + '</g>' + R(150, 74, 22, 54, '#556', '#223', 1, 3) + C(161, 118, 14, '#fff', '#223', 1.5) + P('M161 104 L156 118 L166 118 Z', RED, 1, '#9f9') + arrow(250, 60, 250, 22, RED, 2.4) + T(250, 72, 'N', { s: 12, c: RED, w: 700 });
    if (i === 3) o += T(70, 60, '🚗', { s: 24, c: INK }) + T(70, 80, '✕', { s: 16, c: RED, w: 700 }) + T(300, 160, '⚡', { s: 24, c: INK }) + T(300, 180, '✕', { s: 16, c: RED, w: 700 });
    o += '<rect x="6" y="176" width="348" height="22" rx="6" fill="rgba(255,255,255,.85)"/>' + T(180, 191, ORIENT_CAP[i] || '', { s: 10.5, w: 700 });
    return box(svg(o));
  }

  // ---------- มาตราส่วน ----------
  function scalebarArt(a) {
    var S = a.S, cm = a.cm, mx = Math.max(10, Math.ceil(cm) + 1), pc = 300 / mx, o = R(30, 70, 300, 26, '#fff', INK, 1.5);
    for (var i = 0; i <= mx; i++) { var x = 30 + i * pc; o += L(x, 70, x, i % 5 === 0 ? 106 : 100, INK, 1.2) + (i % 2 === 0 || mx <= 10 ? T(x, 118, fmt(i * S / 100), { s: mx > 10 ? 8 : 9 }) : ''); }
    o += T(30, 62, '0', { s: 10 }) + T(180, 158, '(ตัวเลขใต้ไม้บรรทัด = ระยะจริงเป็นเมตร)', { s: 10, c: '#555' }) + T(180, 140, '1 ซม. = ' + fmt(S / 100) + ' ม.', { s: 16, w: 700, c: BLUE });
    if (cm) { o += P('M30 66 v-8 H' + f1(30 + cm * pc) + ' v8', RED, 2.2) + T(30 + cm * pc / 2, 50, cm + ' ซม. = ' + fmt(cm * S / 100) + ' ม.', { s: 12, c: RED, w: 700 }); }
    o += T(180, 18, 'มาตราส่วน 1 : ' + fmt(S), { s: 15, w: 700 }) + T(180, 180, 'ระยะจริง = ระยะบนแผนที่ × (S ÷ 100) เมตร', { s: 12 });
    return box(svg(o));
  }
  function gridsqArt(a) {
    var cm = a.cm, side = Math.min(120, Math.max(30, cm * 10)), x = 180 - side / 2, y = 60, o = R(x, y, side, side, '#fff', RED, 2.4);
    o += L(x, y - 12, x + side, y - 12, '#555', 1.5) + L(x, y - 16, x, y - 8, '#555', 1.5) + L(x + side, y - 16, x + side, y - 8, '#555', 1.5) + T(180, y - 18, cm + ' ซม.', { s: 13, c: RED, w: 700 });
    o += T(180, y + side / 2 + 4, 'ช่องกริด', { s: 13, w: 700 }) + T(180, 20, 'มาตราส่วน 1 : ' + fmt(a.S), { s: 14, w: 700 }) + T(180, 196, 'ซม. บนแผนที่ = ระยะจริง (ม.) × 100 ÷ S', { s: 12 });
    return box(svg(o));
  }
  function scalecmpArt() {
    var o = '', ds = [['1:5,000', 9], ['1:25,000', 5], ['1:50,000', 3], ['1:250,000', 1]];
    ds.forEach(function (d, i) {
      var x = 12 + i * 87; o += R(x, 34, 78, 120, '#fff', '#556', 1.2);
      for (var k = 0; k < d[1] * 2; k++) o += R(x + 8 + (k * 23) % 56, 42 + Math.floor(k * 23 / 56) * 14 % 100, 9, 7, '#bbb', '#888', .6);
      for (var r = 0; r < d[1]; r++) o += L(x, 44 + r * (110 / d[1]), x + 78, 40 + r * (110 / d[1]) + 12, BROWN, 1);
      o += T(x + 39, 172, d[0], { s: 11, w: 700 }) + T(x + 39, 188, i === 0 ? 'ละเอียดที่สุด' : i === 3 ? 'กว้างสุด/ละเอียดน้อย' : '', { s: 9, c: '#555' });
    });
    return box(svg(o + T(180, 20, 'พื้นที่เดียวกัน คนละมาตราส่วน', { s: 13, w: 700 })));
  }
  function scaleformsArt(hl, S) {
    S = S || 50000; var o = '', bx = function (x, k, title, inner) { var on = hl === k; return R(x, 36, 108, 130, on ? 'rgba(245,179,1,.4)' : '#fff', on ? GOLD : '#aaa', on ? 3 : 1.2, 8) + T(x + 54, 56, title, { s: 11, w: 700 }) + inner; };
    o += bx(8, 'rf', 'อัตราส่วน', T(62, 108, '1 : ' + fmt(S), { s: 15, w: 700 }) + T(62, 130, 'RF', { s: 10, c: '#666' }));
    o += bx(126, 'verbal', 'มาตราส่วนคำพูด', T(180, 100, '“1 เซนติเมตร', { s: 11 }) + T(180, 116, 'เท่ากับ ' + fmt(S / 100) + ' เมตร”', { s: 11 }));
    var bar = ''; for (var i = 0; i < 4; i++) bar += R(250 + i * 21, 100, 21, 10, i % 2 ? '#fff' : INK, INK, 1);
    o += bx(244, 'bar', 'แถบมาตราส่วน', bar + T(250, 128, '0', { s: 9 }) + T(334, 128, fmt(4 * S / 100) + ' ม.', { s: 9, a: 'end' }));
    return box(svg(o + T(180, 20, 'มาตราส่วน 3 แบบ', { s: 14, w: 700 }) + T(180, 190, 'อัตราส่วน · คำพูด · แถบ', { s: 11 })));
  }
  function topicArt(t) { return box('<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:90px">' + (TOPIC_ICON[t] || '❓') + '</div>'); }

  // โหมดโจทย์ (quiz): ไม่เผยเฉลย — เอาตัวอักษรคำอธิบายออกทั้งหมด และไม่ไฮไลต์ส่วนที่ถูก
  function render(a, opts) {
    opts = opts || {};
    if (opts.quiz) {
      var qa = {}; Object.keys(a).forEach(function (k) { qa[k] = a[k]; }); qa.hl = null;
      var el = render(qa, {}); [].forEach.call(el.querySelectorAll('text'), function (t) { t.parentNode.removeChild(t); }); return el;
    }
    try {
      switch (a.k) {
        case 'map': return mapThumb(a, W, H);
        case 'mapdial': { var wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;gap:6px;width:' + W + 'px;height:' + H + 'px'; wrap.appendChild(mapThumb(a.map, 222, H)); wrap.appendChild(dialArt({ angle: a.angle, night: false }, 132)); wrap.lastChild.style.height = H + 'px'; return wrap; }
        case 'dial': { var d = dialArt(a, H); d.style.width = W + 'px'; return d; }
        case 'contour': return contourArt(a.c);
        case 'ctypes': return ctypesArt(a.hl);
        case 'profile': return profileArt(a, false);
        case 'profile2': return profileArt(a, true);
        case 'graticule': return graticuleArt(a.hl);
        case 'dmsbar': return dmsbarArt(a.hl);
        case 'coordgrid': return coordgridArt(a);
        case 'pace': return paceArt(a);
        case 'circle': return circleArt(a);
        case 'bezel': return bezelArt(a);
        case 'turn': return turnArt(a);
        case 'decl': return declArt(a);
        case 'obstacle': return obstacleArt(a);
        case 'parts': return partsArt(a.hl);
        case 'orient': return orientArt(a.i);
        case 'scalebar': return scalebarArt(a);
        case 'gridsq': return gridsqArt(a);
        case 'scalecmp': return scalecmpArt();
        case 'scaleforms': return scaleformsArt(a.hl, a.S);
        default: return topicArt(a.t);
      }
    } catch (e) { console.warn('art error', a && a.k, e); return topicArt(0); }
  }
  root.Art = { render: render, W: W, H: H };
})(window);
