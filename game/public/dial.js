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
    var svg = el('svg', { viewBox: '-135 -135 270 270', width: '100%', height: '100%', style: 'touch-action:none;display:block' });
    host.innerHTML = ''; host.appendChild(svg);
    el('circle', { r: 112, fill: opts.dark ? '#14301c' : '#fffdf5', stroke: opts.dark ? '#5fd07a' : '#2e6b3f', 'stroke-width': 4 }, svg);
    el('circle', { r: 76, fill: 'none', stroke: opts.dark ? '#2b4b34' : '#e4dfcc', 'stroke-width': 1 }, svg);
    var fg = opts.dark ? '#e9f5ec' : '#222';
    var hist = el('g', {}, svg);
    for (var a = 0; a < 360; a += 5) {
      var big = a % 30 === 0, mid = a % 10 === 0;
      var p1 = pol(a, 112), p2 = pol(a, big ? 98 : mid ? 104 : 107);
      el('line', { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: fg, 'stroke-width': big ? 2 : 1, opacity: big ? 1 : 0.6 }, svg);
      if (big && a % 90 !== 0) { var pl = pol(a, 86); var t = el('text', { x: pl[0], y: pl[1] + 4, 'text-anchor': 'middle', 'font-size': 11, fill: fg, opacity: 0.8 }, svg); t.textContent = a; }
    }
    [['N', 0, '#d93025'], ['E', 90, fg], ['S', 180, fg], ['W', 270, fg]].forEach(function (c) {
      var p = pol(c[1], 82); var t = el('text', { x: p[0], y: p[1] + 7, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 800, fill: c[2] }, svg); t.textContent = c[0];
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
