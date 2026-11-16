// หน้าปัดเข็มทิศ SVG: ลากเข็มเพื่อตอบ (นักเรียน) / แสดงเฉลยและกราฟคำตอบทั้งห้อง (หน้าจอครู)
// มุมวัดจากทิศเหนือ (0°) ตามเข็มนาฬิกา
(function (root) {
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function pol(a, r) { var t = (a - 90) * Math.PI / 180; return [Math.cos(t) * r, Math.sin(t) * r]; }

  function create(host, opts) {
    opts = opts || {};
    var night = !!opts.night; // โหมดกลางคืน: พื้นมืด ขีดและตัวเลขเรืองแสง
    var svg = el('svg', { viewBox: '-135 -135 270 270', width: '100%', height: '100%', style: 'touch-action:none;display:block' });
    host.innerHTML = ''; host.appendChild(svg);
    // หน้าปัดแบบเข็มทิศเลนเซติกจริง: วงนอก (ดำ) = มิลเลียม ตัวเลขหน่วยร้อย · วงใน (แดง) = องศา · แผ่น N E S W เรืองแสง
    var fg = night ? '#b6ffb6' : (opts.dark ? '#e9f5ec' : '#1a1a1a');
    var degCol = night ? '#ffd27a' : (opts.dark ? '#ff8a80' : '#c62828');
    el('circle', { r: 112, fill: night ? '#070d08' : (opts.dark ? '#14301c' : '#f4f1e1'), stroke: night ? '#59d86a' : (opts.dark ? '#7fbf6a' : '#3f5a2a'), 'stroke-width': 6 }, svg);
    el('circle', { r: 80, fill: 'none', stroke: degCol, 'stroke-width': 0.8, opacity: 0.7 }, svg);
    var hist = el('g', {}, svg);
    for (var m = 0; m < 6400; m += 100) { // วงนอก: มิลเลียม ขีดทุก 100 ยาวทุก 400 เลขทุก 200 (÷100)
      var am = m * 360 / 6400, bigm = m % 400 === 0, o1 = pol(am, 111), o2 = pol(am, bigm ? 100 : 104);
      el('line', { x1: o1[0], y1: o1[1], x2: o2[0], y2: o2[1], stroke: fg, 'stroke-width': bigm ? 1.6 : 0.9, opacity: bigm ? 1 : 0.75 }, svg);
      if (m % 200 === 0) { var ol = pol(am, 92); var tm = el('text', { x: ol[0], y: ol[1] + 3, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: fg }, svg); tm.textContent = m / 100; }
    }
    for (var a = 0; a < 360; a += 5) { // วงใน: องศา ขีดทุก 5° ยาวทุก 20° เลขทุก 20°
      var big = a % 20 === 0, i1 = pol(a, 80), i2 = pol(a, big ? 73 : 76.5);
      el('line', { x1: i1[0], y1: i1[1], x2: i2[0], y2: i2[1], stroke: degCol, 'stroke-width': big ? 1.5 : 0.8 }, svg);
      if (big) { var il = pol(a, 65); var td = el('text', { x: il[0], y: il[1] + 3, 'text-anchor': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: degCol }, svg); td.textContent = a; }
    }
    [['N', 0, '#d93025'], ['E', 90, '#111'], ['S', 180, '#111'], ['W', 270, '#111']].forEach(function (c) {
      var p = pol(c[1], 38);
      el('rect', { x: p[0] - 11, y: p[1] - 11, width: 22, height: 22, rx: 4, fill: night ? '#8dff8d' : '#e3f4c3', stroke: night ? '#2c8a2c' : '#8a9a6a', 'stroke-width': 1 }, svg);
      var t = el('text', { x: p[0], y: p[1] + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: night && c[0] !== 'N' ? '#06310a' : c[2] }, svg); t.textContent = c[0];
    });
    var tgt = el('g', { visibility: 'hidden' }, svg);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -104, stroke: '#2e9d4f', 'stroke-width': 7, 'stroke-linecap': 'round' }, tgt);
    el('polygon', { points: '0,-112 -9,-92 9,-92', fill: '#2e9d4f' }, tgt);
    var user = el('g', { visibility: 'hidden' }, svg);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 50, stroke: '#888', 'stroke-width': 6, 'stroke-linecap': 'round' }, user);
    el('polygon', { points: '0,-108 -10,0 10,0', fill: '#d93025', stroke: '#fff', 'stroke-width': 1.5 }, user);
    el('circle', { r: 8, fill: '#222', stroke: '#fff', 'stroke-width': 2 }, svg);

    var angle = null, api = {};
    function showUser(a) { user.setAttribute('transform', 'rotate(' + a + ')'); user.setAttribute('visibility', 'visible'); }
    api.setAngle = function (a) { angle = a; if (a == null) user.setAttribute('visibility', 'hidden'); else showUser(a); };
    api.getAngle = function () { return angle; };
    api.setTarget = function (a) { if (a == null) tgt.setAttribute('visibility', 'hidden'); else { tgt.setAttribute('transform', 'rotate(' + a + ')'); tgt.setAttribute('visibility', 'visible'); } };
    // กราฟแท่งรอบวง: pins = [{ang, pct}] นับเป็นช่วงละ 5°
    api.setHist = function (pins) {
      hist.innerHTML = '';
      if (!pins || !pins.length) return;
      var b = new Array(72).fill(0), max = 1;
      pins.forEach(function (p) { var i = Math.floor((((p.ang % 360) + 360) % 360) / 5) % 72; b[i]++; if (b[i] > max) max = b[i]; });
      b.forEach(function (c, i) {
        if (!c) return;
        var a0 = i * 5 - 2, a1 = i * 5 + 2, r0 = 114, r1 = 114 + 20 * c / max;
        var P = [pol(a0, r0), pol(a1, r0), pol(a1, r1), pol(a0, r1)];
        el('polygon', { points: P.map(function (q) { return q[0] + ',' + q[1]; }).join(' '), fill: '#f5b301', opacity: 0.9 }, hist);
      });
    };
    api.setInteractive = function (on) { api.interactive = on; svg.style.cursor = on ? 'grab' : 'default'; };
    api.onChange = opts.onChange || function () {};
    api.interactive = !!opts.interactive;

    function fromEvent(e) {
      var r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var a = Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI;
      return Math.round((a + 360) % 360);
    }
    var dragging = false;
    svg.addEventListener('pointerdown', function (e) { if (!api.interactive) return; dragging = true; try { svg.setPointerCapture(e.pointerId); } catch (x) {} var a = fromEvent(e); api.setAngle(a); api.onChange(a); e.preventDefault(); });
    svg.addEventListener('pointermove', function (e) { if (!dragging || !api.interactive) return; var a = fromEvent(e); api.setAngle(a); api.onChange(a); });
    svg.addEventListener('pointerup', function () { dragging = false; });
    svg.addEventListener('pointercancel', function () { dragging = false; });
    return api;
  }
  root.Dial = { create: create };
})(window);
