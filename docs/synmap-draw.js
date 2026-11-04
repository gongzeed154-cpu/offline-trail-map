// ตัววาดแผนที่สมมุติ (ใช้ร่วมกับ synmap.js): เส้นชั้นความสูง พืชคลุมดิน น้ำ เส้นทาง สัญลักษณ์ ชื่อ คำอธิบายสัญลักษณ์ และรายการเฉลย
(function (root) {
  var S = TrailSynMap;
  var I = S._internal;
  var clamp = I.clamp, smooth = I.smooth, FONT = I.FONT;

  /* ---------- รายการสิ่งที่เลือกใส่ได้ ---------- */
  var GROUPS = [
    { id: 'contour', title: 'เส้นชั้นความสูง', items: [
      ['cIndex', 'เส้นชั้นความสูงหลัก (เส้นหนา ทุก 5 เส้น)', 1], ['cInter', 'เส้นชั้นความสูงรอง', 1], ['cSupp', 'เส้นแทรก (ครึ่งหนึ่งของระยะเส้นรอง เส้นประบาง)', 0],
      ['cApprox', 'เส้นโดยประมาณ (เส้นประในบริเวณที่ไม่แน่ใจ)', 0], ['cDepr', 'เส้นคุ้งกระทะ (แอ่งปิด มีขีดชี้ลง)', 1], ['cLabel', 'ตัวเลขความสูงบนเส้นหลัก', 1]
    ] },
    { id: 'relief', title: 'ลักษณะภูมิประเทศ', items: [
      ['peak', 'ยอดเขา (สามเหลี่ยม + ความสูง)', 1], ['ridge', 'สันเขา', 0], ['saddle', 'คอเขา', 0], ['valley', 'หุบเขา', 0], ['cliff', 'หน้าผา', 1], ['depr', 'ที่ต่ำบนภูเขา (แอ่ง)', 0], ['shade', 'เงาภูเขา (แรเงา)', 0]
    ] },
    { id: 'water', title: 'น้ำ', items: [['river', 'แม่น้ำ/ลำห้วย', 1], ['stream', 'ร่องน้ำ (เส้นประ)', 0], ['pond', 'หนอง/อ่างเก็บน้ำ', 1], ['waterfall', 'น้ำตก', 1]] },
    { id: 'cover', title: 'พืชและการใช้ที่ดิน', items: [['forest', 'ป่า', 1], ['field', 'ไร่', 1], ['paddy', 'นา', 1], ['orchard', 'สวน/ไม้ยืนต้น', 1], ['grass', 'ทุ่งหญ้า/พืชต่ำ', 1]] },
    { id: 'places', title: 'ชุมชนและสถานที่', items: [
      ['village', 'หมู่บ้าน', 1], ['school', 'โรงเรียน', 1], ['temple', 'วัด', 1], ['hospital', 'สถานพยาบาล', 1], ['office', 'ที่ทำการ (อบต.)', 1], ['market', 'ตลาด', 0],
      ['graveyard', 'ป่าช้า/สุสาน', 0], ['gas', 'ปั๊มน้ำมัน', 0], ['camp', 'ลานกางเต็นท์', 0], ['viewpoint', 'จุดชมวิว', 0], ['cave', 'ถ้ำ', 0]
    ] },
    { id: 'roads', title: 'เส้นทาง', items: [['roadMain', 'ถนนลาดยาง', 1], ['roadSec', 'ถนนลูกรัง', 1], ['cart', 'ทางเกวียน', 1], ['foot', 'ทางเดินเท้า', 0], ['bridge', 'สะพาน', 1], ['power', 'สายไฟฟ้าแรงสูง', 0]] },
    { id: 'labels', title: 'ชื่อและหมายเลข', items: [['names', 'ชื่อสถานที่ (ปิดไว้เมื่อให้นักเรียนตั้งชื่อเอง)', 1], ['numbers', 'หมายเลขกำกับจุดสำคัญ (ใช้คู่กับหน้าเฉลย)', 0]] }
  ];
  function defaultLayers() { var d = {}; GROUPS.forEach(function (g) { g.items.forEach(function (it) { d[it[0]] = !!it[2]; }); }); return d; }
  function allLayers(on) { var d = {}; GROUPS.forEach(function (g) { g.items.forEach(function (it) { d[it[0]] = on; }); }); return d; }
  // ชุดสำเร็จรูปสำหรับหลักสูตรต่างๆ
  var PRESET_SETS = {
    all: { name: 'ครบทุกอย่าง', f: function (d) { var x = allLayers(true); x.numbers = false; x.cSupp = false; x.cApprox = false; return x; } },
    contour: { name: 'เส้นชั้นความสูงล้วน', f: function () { var x = allLayers(false); x.cIndex = x.cInter = x.cLabel = true; return x; } },
    relief: { name: 'ลักษณะภูมิประเทศ', f: function () { var x = allLayers(false); ['cIndex', 'cInter', 'cLabel', 'cDepr', 'peak', 'ridge', 'saddle', 'valley', 'cliff', 'depr', 'river', 'stream', 'names'].forEach(function (k) { x[k] = true; }); return x; } },
    plain: { name: 'แผนที่ทั่วไป (ไม่มีเส้นชั้น)', f: function () { var x = allLayers(true); ['cIndex', 'cInter', 'cSupp', 'cApprox', 'cDepr', 'cLabel', 'ridge', 'saddle', 'valley', 'depr', 'shade', 'numbers'].forEach(function (k) { x[k] = false; }); return x; } },
    none: { name: 'ล้างทั้งหมด', f: function () { return allLayers(false); } }
  };

  /* ---------- เส้นชั้นความสูง (marching squares) ---------- */
  // ทำเส้นชั้นให้เรียบแบบแผนที่ที่ช่างเขียน (ค่าเฉลี่ยเคลื่อนที่ 3 จุด หลายรอบ ปลายเส้นเปิดไม่ขยับ)
  function smoothLine(pts, closed) {
    var n = pts.length, a = pts.map(function (q) { return [q.x !== undefined ? q.x : q[0], q.y !== undefined ? q.y : q[1]]; }), b, r, k;
    for (r = 0; r < 3; r++) {
      b = new Array(n);
      for (k = 0; k < n; k++) {
        if (!closed && (k === 0 || k === n - 1)) { b[k] = a[k]; continue; }
        var p = a[(k - 1 + n) % n], q = a[(k + 1) % n];
        b[k] = [(p[0] + 2 * a[k][0] + q[0]) / 4, (p[1] + 2 * a[k][1] + q[1]) / 4];
      }
      a = b;
    }
    return a;
  }
  function contourLines(world, level) {
    var nx = world.nx, ny = world.ny, h = world.h, A = [], B = [], pa = [], pb = [], i, j;
    function edgeH(ii, jj) { return (jj * nx + ii) * 2; }
    function edgeV(ii, jj) { return (jj * nx + ii) * 2 + 1; }
    for (j = 0; j < ny - 1; j++) {
      for (i = 0; i < nx - 1; i++) {
        var a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i + 1], d = h[(j + 1) * nx + i];
        var idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        var T = null, R = null, Bt = null, L = null;
        function mk(which) {
          if (which === 'T') return { id: edgeH(i, j), x: i + 0.5 + (level - a) / (b - a), y: j + 0.5 };
          if (which === 'R') return { id: edgeV(i + 1, j), x: i + 1.5, y: j + 0.5 + (level - b) / (c - b) };
          if (which === 'B') return { id: edgeH(i, j + 1), x: i + 0.5 + (level - d) / (c - d), y: j + 1.5 };
          return { id: edgeV(i, j), x: i + 0.5, y: j + 0.5 + (level - a) / (d - a) };
        }
        var pairs;
        switch (idx) {
          case 1: case 14: pairs = [['L', 'T']]; break;
          case 2: case 13: pairs = [['T', 'R']]; break;
          case 3: case 12: pairs = [['L', 'R']]; break;
          case 4: case 11: pairs = [['R', 'B']]; break;
          case 6: case 9: pairs = [['T', 'B']]; break;
          case 7: case 8: pairs = [['L', 'B']]; break;
          case 5: pairs = ((a + b + c + d) / 4 >= level) ? [['T', 'R'], ['L', 'B']] : [['L', 'T'], ['R', 'B']]; break;
          default: pairs = ((a + b + c + d) / 4 >= level) ? [['L', 'T'], ['R', 'B']] : [['T', 'R'], ['L', 'B']]; break; // 10
        }
        for (var q = 0; q < pairs.length; q++) {
          var p1 = mk(pairs[q][0]), p2 = mk(pairs[q][1]);
          A.push(p1.id); B.push(p2.id); pa.push([p1.x, p1.y]); pb.push([p2.x, p2.y]);
        }
      }
    }
    // เชื่อมเส้นสั้นเป็นเส้นยาว
    var adj = {}, k, n = A.length;
    for (k = 0; k < n; k++) { (adj[A[k]] = adj[A[k]] || []).push(k); (adj[B[k]] = adj[B[k]] || []).push(k); }
    var used = new Uint8Array(n), lines = [];
    function next(edge, from) { var l = adj[edge]; if (!l) return -1; for (var z = 0; z < l.length; z++) if (l[z] !== from && !used[l[z]]) return l[z]; return -1; }
    for (k = 0; k < n; k++) {
      if (used[k]) continue;
      used[k] = 1;
      var fwd = [pa[k], pb[k]], edgeF = B[k], edgeStart = A[k], cur = k, nk, closed = false;
      for (;;) {
        nk = next(edgeF, cur);
        if (nk < 0) break;
        used[nk] = 1;
        if (A[nk] === edgeF) { fwd.push(pb[nk]); edgeF = B[nk]; } else { fwd.push(pa[nk]); edgeF = A[nk]; }
        cur = nk;
        if (edgeF === edgeStart) { closed = true; break; }
      }
      if (!closed) {
        var back = [], edgeB = edgeStart; cur = k;
        for (;;) {
          nk = next(edgeB, cur);
          if (nk < 0) break;
          used[nk] = 1;
          if (A[nk] === edgeB) { back.push(pb[nk]); edgeB = B[nk]; } else { back.push(pa[nk]); edgeB = A[nk]; }
          cur = nk;
        }
        fwd = back.reverse().concat(fwd);
      }
      if (closed && fwd.length < 9) continue; // วงเล็กจิ๋วจากความขรุขระ แผนที่จริงตัดทิ้ง (generalization)
      if (fwd.length >= 4) lines.push({ pts: smoothLine(fwd, closed), closed: closed });
    }
    return lines;
  }

  function sampleH(world, gx, gy) {
    var nx = world.nx, ny = world.ny, x = clamp(gx - 0.5, 0, nx - 1.001), y = clamp(gy - 0.5, 0, ny - 1.001), i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, h = world.h;
    return (h[j * nx + i] * (1 - fx) + h[j * nx + i + 1] * fx) * (1 - fy) + (h[(j + 1) * nx + i] * (1 - fx) + h[(j + 1) * nx + i + 1] * fx) * fy;
  }

  /* ---------- สัญลักษณ์จุด (วาดที่ x,y ขนาด s พิกเซล) ---------- */
  var SYM = {
    peak: function (c, x, y, s) { var r = s * 0.32; c.strokeStyle = '#1a1a1a'; c.lineWidth = s * 0.13; c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke(); },
    saddle: function (c, x, y, s) { c.lineWidth = s * 0.14; c.strokeStyle = '#6a2c91'; c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x - s * 0.6, y - s * 0.4); c.lineTo(x, y); c.lineTo(x - s * 0.6, y + s * 0.4); c.closePath(); c.moveTo(x + s * 0.6, y - s * 0.4); c.lineTo(x, y); c.lineTo(x + s * 0.6, y + s * 0.4); c.closePath(); c.fill(); c.stroke(); },
    school: function (c, x, y, s) { c.fillStyle = '#111'; c.fillRect(x - s * 0.5, y - s * 0.15, s, s * 0.6); c.beginPath(); c.moveTo(x - s * 0.5, y - s * 0.15); c.lineTo(x - s * 0.5, y - s * 0.75); c.strokeStyle = '#111'; c.lineWidth = s * 0.1; c.stroke(); c.fillStyle = '#d6261c'; c.fillRect(x - s * 0.45, y - s * 0.75, s * 0.5, s * 0.32); },
    temple: function (c, x, y, s) { c.fillStyle = '#111'; c.fillRect(x - s * 0.45, y - s * 0.05, s * 0.9, s * 0.45); c.beginPath(); c.moveTo(x - s * 0.55, y - s * 0.05); c.lineTo(x, y - s * 0.55); c.lineTo(x + s * 0.55, y - s * 0.05); c.closePath(); c.fill(); c.lineWidth = s * 0.1; c.strokeStyle = '#111'; c.beginPath(); c.moveTo(x, y - s * 0.55); c.lineTo(x, y - s * 0.9); c.stroke(); },
    hospital: function (c, x, y, s) { c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = s * 0.09; c.fillRect(x - s * 0.5, y - s * 0.5, s, s); c.strokeRect(x - s * 0.5, y - s * 0.5, s, s); c.fillStyle = '#d6261c'; c.fillRect(x - s * 0.34, y - s * 0.11, s * 0.68, s * 0.22); c.fillRect(x - s * 0.11, y - s * 0.34, s * 0.22, s * 0.68); },
    office: function (c, x, y, s) { c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = s * 0.1; c.fillRect(x - s * 0.5, y - s * 0.3, s, s * 0.7); c.strokeRect(x - s * 0.5, y - s * 0.3, s, s * 0.7); c.beginPath(); c.moveTo(x - s * 0.5, y - s * 0.3); c.lineTo(x - s * 0.5, y - s * 0.85); c.stroke(); c.fillStyle = '#1a5fd0'; c.fillRect(x - s * 0.45, y - s * 0.85, s * 0.55, s * 0.32); },
    market: function (c, x, y, s) { c.strokeStyle = '#111'; c.lineWidth = s * 0.1; c.fillStyle = '#ffd7a0'; c.fillRect(x - s * 0.5, y - s * 0.4, s, s * 0.35); c.strokeRect(x - s * 0.5, y - s * 0.4, s, s * 0.35); c.beginPath(); c.moveTo(x - s * 0.4, y - s * 0.05); c.lineTo(x - s * 0.4, y + s * 0.45); c.moveTo(x + s * 0.4, y - s * 0.05); c.lineTo(x + s * 0.4, y + s * 0.45); c.stroke(); },
    graveyard: function (c, x, y, s) { c.strokeStyle = '#444'; c.lineWidth = s * 0.16; c.beginPath(); c.moveTo(x, y - s * 0.5); c.lineTo(x, y + s * 0.5); c.moveTo(x - s * 0.3, y - s * 0.2); c.lineTo(x + s * 0.3, y - s * 0.2); c.stroke(); },
    gas: function (c, x, y, s) { c.beginPath(); c.arc(x, y, s * 0.5, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = s * 0.1; c.strokeStyle = '#111'; c.stroke(); c.fillStyle = '#d6261c'; c.beginPath(); c.moveTo(x, y - s * 0.32); c.quadraticCurveTo(x + s * 0.32, y + s * 0.05, x, y + s * 0.3); c.quadraticCurveTo(x - s * 0.32, y + s * 0.05, x, y - s * 0.32); c.fill(); },
    camp: function (c, x, y, s) { c.beginPath(); c.moveTo(x, y - s * 0.55); c.lineTo(x + s * 0.6, y + s * 0.4); c.lineTo(x - s * 0.6, y + s * 0.4); c.closePath(); c.fillStyle = '#2e7d32'; c.fill(); c.strokeStyle = '#111'; c.lineWidth = s * 0.09; c.stroke(); c.beginPath(); c.moveTo(x, y - s * 0.1); c.lineTo(x, y + s * 0.4); c.stroke(); },
    viewpoint: function (c, x, y, s) { c.beginPath(); for (var k = 0; k < 10; k++) { var r = k % 2 ? s * 0.25 : s * 0.55, a = -Math.PI / 2 + k * Math.PI / 5; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); c.fillStyle = '#f5a300'; c.fill(); c.strokeStyle = '#111'; c.lineWidth = s * 0.07; c.stroke(); },
    cave: function (c, x, y, s) { c.beginPath(); c.arc(x, y + s * 0.2, s * 0.5, Math.PI, 0); c.closePath(); c.fillStyle = '#111'; c.fill(); },
    waterfall: function (c, x, y, s) { c.strokeStyle = '#1a73c8'; c.lineWidth = s * 0.14; c.beginPath(); c.moveTo(x - s * 0.5, y - s * 0.4); c.lineTo(x + s * 0.5, y - s * 0.4); c.stroke(); for (var k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x + k * s * 0.3, y - s * 0.4); c.lineTo(x + k * s * 0.3, y + s * 0.5); c.stroke(); } },
    house: function (c, x, y, s) { c.fillStyle = '#111'; c.fillRect(x - s * 0.5, y - s * 0.5, s, s); }
  };

  /* ---------- วาด ---------- */
  // o: ตัวเลือกการพิมพ์ (o.syn = ตัวเลือกแผนที่สมมุติ) · g: กรอบแผนที่ {fx,fy,fw,fh} · world จาก generate+populate
  function draw(c, o, g, world, onStatus) {
    onStatus = onStatus || function () {};
    var L = o.syn.layers, pxmm = o.dpi / 25.4, nx = world.nx, ny = world.ny, fx = g.fx, fy = g.fy, fw = g.fw, fh = g.fh;
    var kx = fw / nx, ky = fh / ny;
    function mm(v) { return v * pxmm; }
    function X(gx) { return fx + gx * kx; }
    function Y(gy) { return fy + gy * ky; }
    var PAPER = '#e2ede8';
    var rnd = I.mulberry32((world.seed | 0) * 97 + 13);
    var placed = []; // กล่องป้ายชื่อที่วางแล้ว กันทับกัน
    function fontOf(sizeMM, bold, italic) { return (italic ? 'italic ' : '') + (bold ? '700 ' : '400 ') + mm(sizeMM).toFixed(1) + 'px ' + FONT; }
    function overlap(b) { for (var q = 0; q < placed.length; q++) { var a = placed[q]; if (b[0] < a[2] && b[2] > a[0] && b[1] < a[3] && b[3] > a[1]) return true; } return false; }
    // วางข้อความที่ (x,y) ถ้าไม่ทับป้ายอื่น ลองหลายตำแหน่งรอบจุด คืน true ถ้าวางได้
    function label(text, x, y, sizeMM, opt) {
      opt = opt || {};
      c.font = fontOf(sizeMM, opt.bold, opt.italic);
      var w = c.measureText(text).width, hgt = mm(sizeMM) * 1.05, gap = opt.gap === undefined ? mm(2.3) : opt.gap;
      var cand = opt.center ? [[x - w / 2, y + hgt * 0.35]] : [[x + gap, y + hgt * 0.35], [x - gap - w, y + hgt * 0.35], [x - w / 2, y - gap - hgt * 0.2], [x - w / 2, y + gap + hgt * 0.9]];
      for (var q = 0; q < cand.length + (opt.force ? 1 : 0); q++) {
        var forced = q === cand.length, cq = forced ? (x + gap + w < fx + fw ? cand[0] : cand[Math.min(1, cand.length - 1)]) : cand[q];
        var bx = cq[0], by = cq[1], box = [bx - 2, by - hgt, bx + w + 2, by + hgt * 0.3];
        if (!forced && (box[0] < fx || box[2] > fx + fw || box[1] < fy || box[3] > fy + fh)) continue;
        if (!forced && overlap(box)) continue;
        placed.push(box);
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        c.lineJoin = 'round'; c.lineWidth = mm(0.9); c.strokeStyle = 'rgba(226,237,232,.85)'; c.strokeText(text, bx, by);
        c.fillStyle = opt.color || '#111'; c.fillText(text, bx, by);
        return true;
      }
      return false;
    }
    function reserve(x, y, r) { placed.push([x - r, y - r, x + r, y + r]); }
    function path(pts, close) { c.beginPath(); pts.forEach(function (q, k) { if (k) c.lineTo(X(q[0]), Y(q[1])); else c.moveTo(X(q[0]), Y(q[1])); }); if (close) c.closePath(); }
    function dash(a) { c.setLineDash(a ? a.map(mm) : []); }

    c.save();
    c.beginPath(); c.rect(fx, fy, fw, fh); c.clip();
    c.fillStyle = PAPER; c.fillRect(fx, fy, fw, fh);

    /* 1) พืชคลุมดิน */
    var anyCover = L.forest || L.field || L.paddy || L.orchard || L.grass;
    var COL = { grass: [226, 237, 232], forest: [204, 226, 206], field: [226, 237, 232], paddy: [226, 237, 232], orchard: [218, 233, 220], none: [226, 237, 232] };
    var cov = world.cover;
    function bil(a, gx, gy) { var x = clamp(gx - 0.5, 0, nx - 1.001), y = clamp(gy - 0.5, 0, ny - 1.001), i = Math.floor(x), j = Math.floor(y), fx2 = x - i, fy2 = y - j; return (a[j * nx + i] * (1 - fx2) + a[j * nx + i + 1] * fx2) * (1 - fy2) + (a[(j + 1) * nx + i] * (1 - fx2) + a[(j + 1) * nx + i + 1] * fx2) * fy2; }
    function classAt(gx, gy) {
      var xi = clamp(Math.floor(gx), 0, nx - 1), yi = clamp(Math.floor(gy), 0, ny - 1);
      if (world.pondMask[yi * nx + xi]) return 'pond';
      var f = bil(cov.forest, gx, gy), a = bil(cov.field, gx, gy), p = bil(cov.paddy, gx, gy), orc = bil(cov.orchard, gx, gy), best = 'grass', bv = 0.46;
      if (p > 0.58 && p > bv) { best = 'paddy'; bv = p; }
      if (a > 0.62 && a > bv) { best = 'field'; bv = a; }
      if (orc > 0.72 && orc > bv) { best = 'orchard'; bv = orc; }
      if (f > 0.55 && f > bv - 0.05) { best = 'forest'; bv = f; }
      return best;
    }
    function shownClass(cl) { return L[cl === 'pond' ? 'grass' : cl] ? (cl === 'pond' ? 'grass' : cl) : (L.grass ? 'grass' : 'none'); }
    if (anyCover || true) {
      var st = Math.max(1, Math.round(pxmm * 0.28)), bw = Math.ceil(fw / st), bh = Math.ceil(fh / st), img = c.createImageData(bw, bh), dd = img.data, bx, by;
      for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
        var gx0 = (bx + 0.5) * st / kx, gy0 = (by + 0.5) * st / ky, cl0 = shownClass(classAt(gx0, gy0)), col = COL[cl0] || COL.none, o4 = (by * bw + bx) * 4;
        dd[o4] = col[0]; dd[o4 + 1] = col[1]; dd[o4 + 2] = col[2]; dd[o4 + 3] = 255;
      }
      var tmp = document.createElement('canvas'); tmp.width = bw; tmp.height = bh; tmp.getContext('2d').putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true; c.drawImage(tmp, fx, fy, bw * st, bh * st);
    }
    // สัญลักษณ์พืช
    function scatter(cls, spacingMM, drawFn, jitter) {
      var sp = mm(spacingMM), x, y, cnt = 0;
      for (y = fy + sp / 2; y < fy + fh; y += sp) for (x = fx + sp / 2; x < fx + fw; x += sp) {
        var jx = x + (rnd() - 0.5) * sp * (jitter === undefined ? 0.7 : jitter), jy = y + (rnd() - 0.5) * sp * (jitter === undefined ? 0.7 : jitter);
        if (shownClass(classAt((jx - fx) / kx, (jy - fy) / ky)) !== cls) continue;
        if (++cnt > 160000) return;
        drawFn(jx, jy);
      }
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (L.forest) { c.strokeStyle = '#3f7a4a'; c.lineWidth = mm(0.16); scatter('forest', 5.5, function (x, y) { c.beginPath(); c.arc(x, y, mm(0.7), 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, mm(0.1), 0, 7); c.fillStyle = '#3f7a4a'; c.fill(); }); }
    if (L.orchard) { c.fillStyle = '#4a7a3a'; scatter('orchard', 2.4, function (x, y) { c.beginPath(); c.arc(x, y, mm(0.3), 0, 7); c.fill(); }, 0); }
    // ไร่/นา แบบแผนที่ทหาร: จุดดำเล็กๆ กระจายหนาแน่น
    function stipple(cls, sp, rad, col) { c.fillStyle = col; scatter(cls, sp, function (x, y) { c.beginPath(); c.arc(x, y, mm(rad), 0, 7); c.fill(); }, 1); }
    if (L.field) stipple('field', 0.95, 0.11, '#2a2f2a');
    if (L.paddy) stipple('paddy', 1.25, 0.1, '#35403a');
    if (L.grass) { c.strokeStyle = '#8fb59a'; c.lineWidth = mm(0.12); scatter('grass', 9, function (x, y) { c.beginPath(); c.moveTo(x - mm(0.4), y); c.lineTo(x, y - mm(0.7)); c.lineTo(x + mm(0.4), y); c.stroke(); }); }

    /* 2) เงาภูเขา */
    if (L.shade) {
      var hs0 = 1e9, hs1 = -1e9; for (var qq = 0; qq < world.N; qq++) { if (world.h[qq] < hs0) hs0 = world.h[qq]; if (world.h[qq] > hs1) hs1 = world.h[qq]; } world.hmin0 = hs0; world.hspan0 = Math.max(1, hs1 - hs0);
      var sh = c.createImageData(nx, ny), sd = sh.data, h = world.h, p, i, j;
      for (j = 1; j < ny - 1; j++) for (i = 1; i < nx - 1; i++) {
        p = j * nx + i;
        var dzdx = (h[p + 1] - h[p - 1]) / (2 * world.cellM), dzdy = (h[p + nx] - h[p - nx]) / (2 * world.cellM);
        var lam = 0.7 * (-dzdx * 0.7071 - dzdy * 0.7071) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy) + 0.7071 * (1 / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy));
        var al = clamp((0.62 - lam) * 0.9, 0, 0.55);
        var he = clamp((h[p] - world.hmin0) / world.hspan0, 0, 1); sd[p * 4] = 150 - he * 20; sd[p * 4 + 1] = 108 - he * 14; sd[p * 4 + 2] = 62; sd[p * 4 + 3] = Math.round(clamp(al * 0.85 + (he > 0.15 ? he * 0.16 : 0), 0, 0.62) * 255);
      }
      var t2 = document.createElement('canvas'); t2.width = nx; t2.height = ny; t2.getContext('2d').putImageData(sh, 0, 0);
      c.drawImage(t2, fx, fy, fw, fh);
    }

    /* 3) เส้นชั้นความสูง */
    onStatus('วาดเส้นชั้นความสูง…');
    var iv = world.interval, hmin = 1e9, hmax = -1e9, q0;
    for (q0 = 0; q0 < world.N; q0++) { if (world.h[q0] < hmin) hmin = world.h[q0]; if (world.h[q0] > hmax) hmax = world.h[q0]; }
    var nzA = I.makeNoise((world.seed | 0) * 41 + 7);
    function inApprox(gx, gy) { return L.cApprox && I.fbm(nzA, gx * 0.018, gy * 0.018, 2, 0.5) > 0.2; }
    var depressionTicks = [], labelSpots = [];
    // ระยะห่างเส้นชั้นบนกระดาษ (มม.) ณ จุดนั้น: ใช้ตัดสินว่าเป็นที่ราบ (เส้นห่างมาก) ไหม
    var mmPerCell = world.cellM / o.scale * 1000;
    function spacingMM(gx, gy) {
      var gxv = (sampleH(world, gx + 1.5, gy) - sampleH(world, gx - 1.5, gy)) / 3, gyv = (sampleH(world, gx, gy + 1.5) - sampleH(world, gx, gy - 1.5)) / 3, g = Math.hypot(gxv, gyv);
      return g > 1e-6 ? iv / g * mmPerCell : 1e9;
    }
    var DASH_APPROX = [2.6, 1.0], DASH_SUPP = [0.9, 0.7];
    // แบ่งเส้นเป็นช่วงตามสถานะ (ซ่อน/เส้นทึบ/เส้นประ) แล้ววาดทีละช่วง
    var cLines = {};
    function linesAt(level) { return cLines[level] || (cLines[level] = contourLines(world, level)); }
    function strokeContour(ln, level, style) {
      var pts = ln.pts;
      function state(q) {
        if (style.flatOnly && spacingMM(q[0], q[1]) < 3.2) return 0; // เส้นแทรก: ใส่เฉพาะที่ราบซึ่งเส้นหลัก/รองห่างกันมาก
        if (style.dash) return 2;
        return inApprox(q[0], q[1]) ? 3 : 1;
      }
      var run = [pts[0]], st = state(pts[0]);
      function flush() {
        if (run.length > 1 && st) { path(run, ln.closed && run.length === pts.length); dash(st === 2 ? style.dash : st === 3 ? DASH_APPROX : null); c.stroke(); if (style.onRun) style.onRun(run, level); }
      }
      for (var k = 1; k < pts.length; k++) { var z = state(pts[k]); if (z !== st) { run.push(pts[k]); flush(); run = [pts[k]]; st = z; } else run.push(pts[k]); }
      flush(); dash(null);
    }
    function drawLevels(offset, style, filter) {
      var k0 = Math.ceil((hmin - offset * iv) / iv), k1 = Math.floor((hmax - offset * iv) / iv), k;
      for (k = k0; k <= k1; k++) {
        var level = (k + offset) * iv, isIdx = ((k % 5) + 5) % 5 === 0;
        if (!filter(isIdx)) continue;
        var lines = linesAt(level);
        c.strokeStyle = isIdx && style.idx ? style.idx.color : style.color; c.lineWidth = mm(isIdx && style.idx ? style.idx.w : style.w);
        lines.forEach(function (ln) {
          var ptsPx = ln.pts;
          strokeContour(ln, level, style);
          // วงปิดที่ด้านในต่ำกว่า = แอ่ง (คุ้งกระทะ)
          if (ln.closed && offset === 0) {
            // ตรวจด้านในวงจริง (ไม่ใช้จุดศูนย์กลาง ซึ่งอาจตกนอกวงรูปเกือกม้า): ดูความสูงที่ขยับเข้าด้านในวงเล็กน้อยหลายจุด
            var pp = ln.pts, area = 0, qk; for (qk = 0; qk < pp.length; qk++) { var na = pp[(qk + 1) % pp.length]; area += pp[qk][0] * na[1] - na[0] * pp[qk][1]; }
            var sgn = area > 0 ? 1 : -1, below = 0, tot = 0, stp = Math.max(1, Math.floor(pp.length / 24));
            for (qk = 0; qk < pp.length; qk += stp) {
              var a1 = pp[(qk - 1 + pp.length) % pp.length], b1 = pp[(qk + 1) % pp.length], tx = b1[0] - a1[0], ty = b1[1] - a1[1], tl = Math.hypot(tx, ty) || 1;
              var ix = pp[qk][0] - sgn * ty / tl * 0.8, iy = pp[qk][1] + sgn * tx / tl * 0.8;
              tot++; if (sampleH(world, ix, iy) < level) below++;
            }
            if (tot >= 4 && below / tot > 0.8) depressionTicks.push({ ln: ln, level: level, idx: isIdx });
          }
          if (isIdx && offset === 0 && style.label) labelSpots.push({ ln: ln, level: level });
        });
      }
    }
    var showIdx = L.cIndex, showInter = L.cInter;
    var suppLabels = [];
    if (L.cSupp) drawLevels(0.5, { color: '#a06a38', w: 0.08, dash: DASH_SUPP, flatOnly: true, onRun: function (run, level) { if (run.length > 70) suppLabels.push({ pts: run, level: level }); } }, function () { return true; });
    if (showIdx || showInter) {
      drawLevels(0, { color: '#a06a38', w: 0.09, idx: { color: '#7d4a1c', w: 0.19 }, label: L.cLabel }, function (isIdx) { return isIdx ? showIdx : showInter; });
    }
    dash(null);
    // ขีดคุ้งกระทะ
    if (L.cDepr) {
      c.strokeStyle = '#7d4a1c'; c.lineWidth = mm(0.16);
      depressionTicks.forEach(function (d) {
        var pts = d.ln.pts, acc = 0, step = mm(1.7), nextAt = step;
        c.beginPath();
        for (var k = 1; k < pts.length; k++) {
          var ax = X(pts[k - 1][0]), ay = Y(pts[k - 1][1]), bx2 = X(pts[k][0]), by2 = Y(pts[k][1]), seg = Math.hypot(bx2 - ax, by2 - ay);
          while (acc + seg >= nextAt) {
            var t = (nextAt - acc) / seg, px = ax + (bx2 - ax) * t, py = ay + (by2 - ay) * t, nxv = -(by2 - ay) / seg, nyv = (bx2 - ax) / seg;
            // เลือกทิศเข้าด้านในวง (ด้านที่ต่ำกว่า)
            var inA = sampleH(world, (px + nxv * mm(0.9) - fx) / kx, (py + nyv * mm(0.9) - fy) / ky), inB = sampleH(world, (px - nxv * mm(0.9) - fx) / kx, (py - nyv * mm(0.9) - fy) / ky), sg = inA < inB ? 1 : -1;
            c.moveTo(px, py); c.lineTo(px + sg * nxv * mm(0.95), py + sg * nyv * mm(0.95));
            nextAt += step;
          }
          acc += seg;
        }
        c.stroke();
      });
    }
    // ยอดเขาทุกลูก: หาวงปิดในสุดที่ด้านในสูงกว่า (ยอดเนิน) แล้วใส่ X + ความสูงที่จุดสูงสุดในวง
    function inPoly(px, py, pts) { var ins = false; for (var a = 0, b = pts.length - 1; a < pts.length; b = a++) { if ((pts[a][1] > py) !== (pts[b][1] > py) && px < (pts[b][0] - pts[a][0]) * (py - pts[a][1]) / (pts[b][1] - pts[a][1]) + pts[a][0]) ins = !ins; } return ins; }
    function ringUp(pp, level) { // ด้านในวงสูงกว่าระดับเส้น
      var area = 0, qk; for (qk = 0; qk < pp.length; qk++) { var na = pp[(qk + 1) % pp.length]; area += pp[qk][0] * na[1] - na[0] * pp[qk][1]; }
      var sgn = area > 0 ? 1 : -1, up = 0, tot = 0, stp = Math.max(1, Math.floor(pp.length / 24));
      for (qk = 0; qk < pp.length; qk += stp) { var a1 = pp[(qk - 1 + pp.length) % pp.length], b1 = pp[(qk + 1) % pp.length], tx = b1[0] - a1[0], ty = b1[1] - a1[1], tl = Math.hypot(tx, ty) || 1; tot++; if (sampleH(world, pp[qk][0] - sgn * ty / tl * 0.8, pp[qk][1] + sgn * tx / tl * 0.8) > level) up++; }
      return tot >= 4 && up / tot > 0.8;
    }
    var summits = [];
    if (L.peak) {
      var rings = [], lv;
      for (var kq = Math.ceil(hmin / iv); kq * iv <= hmax; kq++) { lv = kq * iv; linesAt(lv).forEach(function (ln) { if (ln.closed && ringUp(ln.pts, lv)) rings.push({ pts: ln.pts, level: lv }); }); }
      rings.forEach(function (rg) {
        // ในสุด = ไม่มีวงยอดเนินระดับสูงกว่าอยู่ข้างใน
        if (rings.some(function (o2) { return o2.level > rg.level && inPoly(o2.pts[0][0], o2.pts[0][1], rg.pts); })) return;
        var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rg.pts.forEach(function (q) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; });
        var best = null, bz = -1e9;
        for (var yy = Math.max(0, Math.floor(y0)); yy <= Math.min(ny - 1, Math.ceil(y1)); yy++) for (var xx = Math.max(0, Math.floor(x0)); xx <= Math.min(nx - 1, Math.ceil(x1)); xx++) {
          var z = world.h[yy * nx + xx]; if (z > bz && inPoly(xx + 0.5, yy + 0.5, rg.pts)) { bz = z; best = [xx + 0.5, yy + 0.5]; }
        }
        if (!best) return;
        var named = world.peaks.filter(function (pk) { return inPoly(pk.gx, pk.gy, rg.pts) || Math.hypot(pk.gx - best[0], pk.gy - best[1]) < 3; })[0];
        if (named) { named.gx = best[0]; named.gy = best[1]; named.elev = bz; named.inRing = true; return; }
        summits.push({ gx: best[0], gy: best[1], elev: bz });
      });
    }
    // จองพื้นที่ป้ายความสูงยอดเขาไว้ก่อน ไม่ให้เลขเส้นชั้นมาทับ (ปล่อยคืนก่อนวาดป้ายยอดเขาจริง)
    var softBoxes = [];
    function softReserve(gx, gy, txt) { var x = X(gx), y = Y(gy); c.font = fontOf(2.3); var w = c.measureText(txt).width; var b = [x - mm(1.6), y - mm(3.2), x + mm(2.6) + w, y + mm(1.6)]; b.soft = true; placed.push(b); }
    if (L.peak) { world.peaks.forEach(function (pk) { softReserve(pk.gx, pk.gy, Math.round(pk.elev) + (L.names ? ' ' + pk.name : '')); }); summits.forEach(function (sm) { softReserve(sm.gx, sm.gy, String(Math.round(sm.elev))); }); }
    // เลขกำกับเส้นแทรก (เช่น 205) ช่วงละหนึ่งตัว เพื่อให้รู้ว่าเป็นครึ่งช่วงห่าง
    if (L.cLabel) suppLabels.forEach(function (sl) {
      var m = sl.pts[Math.floor(sl.pts.length / 2)], m2 = sl.pts[Math.min(sl.pts.length - 1, Math.floor(sl.pts.length / 2) + 2)], px = X(m[0]), py = Y(m[1]);
      var ang = Math.atan2(Y(m2[1]) - py, X(m2[0]) - px); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      var txt = String(Math.round(sl.level * 10) / 10), tw = mm(2.4) * txt.length * 0.62, box = [px - tw, py - mm(1.8), px + tw, py + mm(1.8)];
      if (px < fx + tw || px > fx + fw - tw || overlap(box)) return;
      c.save(); c.translate(px, py); c.rotate(ang); c.font = fontOf(2.1, false, true); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = mm(0.9); c.strokeStyle = 'rgba(226,237,232,.95)'; c.lineJoin = 'round'; c.strokeText(txt, 0, 0); c.fillStyle = '#7d4a1c'; c.fillText(txt, 0, 0); c.restore();
      placed.push(box);
    });
    // ตัวเลขความสูงบนเส้นหลัก
    labelSpots.forEach(function (ls) {
      var pts = ls.ln.pts, total = 0, k, segLen = [];
      for (k = 1; k < pts.length; k++) { var l = Math.hypot((pts[k][0] - pts[k - 1][0]) * kx, (pts[k][1] - pts[k - 1][1]) * ky); segLen.push(l); total += l; }
      if (total < mm(30)) return;
      var every = mm(95), at = mm(18) + ((ls.level * 7919) % 1000) / 1000 * mm(30), acc2 = 0;
      for (k = 1; k < pts.length && at < total; k++) {
        if (acc2 + segLen[k - 1] >= at) {
          var t = (at - acc2) / segLen[k - 1], px = X(pts[k - 1][0]) + (X(pts[k][0]) - X(pts[k - 1][0])) * t, py = Y(pts[k - 1][1]) + (Y(pts[k][1]) - Y(pts[k - 1][1])) * t;
          var ang = Math.atan2(Y(pts[Math.min(pts.length - 1, k + 1)][1]) - Y(pts[Math.max(0, k - 2)][1]), X(pts[Math.min(pts.length - 1, k + 1)][0]) - X(pts[Math.max(0, k - 2)][0]));
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          var txt = String(Math.round(ls.level)), tw = mm(3.1) * txt.length * 0.62;
          if (px > fx + tw && px < fx + fw - tw && py > fy + mm(2) && py < fy + fh - mm(2) && !overlap([px - tw, py - mm(2), px + tw, py + mm(2)])) {
            c.save(); c.translate(px, py); c.rotate(ang); c.font = fontOf(2.5, true); c.textAlign = 'center'; c.textBaseline = 'middle';
            c.lineWidth = mm(0.9); c.strokeStyle = 'rgba(226,237,232,.9)'; c.lineJoin = 'round'; c.strokeText(txt, 0, 0); c.fillStyle = '#6b3a12'; c.fillText(txt, 0, 0); c.restore();
            placed.push([px - tw, py - mm(2), px + tw, py + mm(2)]);
          }
          at += every;
        }
        acc2 += segLen[k - 1];
      }
    });

    /* 4) หน้าผา */
    var keyItems = [];
    if (L.cliff) {
      world.cliffs.forEach(function (cl, ci) {
        var pts = I.chaikin(cl.path, 2), k;
        var seg = [], segs = [];
        for (k = 0; k < pts.length; k++) {
          var nxp = pts[Math.min(pts.length - 1, k + 1)], pvp = pts[Math.max(0, k - 1)], tx = nxp[0] - pvp[0], ty = nxp[1] - pvp[1], tl = Math.hypot(tx, ty) || 1, nxv = -ty / tl, nyv = tx / tl;
          var hA = sampleH(world, pts[k][0] + nxv * 3.2, pts[k][1] + nyv * 3.2), hB = sampleH(world, pts[k][0] - nxv * 3.2, pts[k][1] - nyv * 3.2), drop = Math.abs(hA - hB);
          if (drop > Math.max(cl.step * 0.55, iv * 1.2)) seg.push({ p: pts[k], dir: hA < hB ? 1 : -1, nx: nxv, ny: nyv }); else if (seg.length) { segs.push(seg); seg = []; }
        }
        if (seg.length) segs.push(seg);
        segs.forEach(function (sg) {
          if (sg.length < 3) return;
          // แผนที่จริงแสดงหน้าผาด้วยเส้นชั้นความสูงหลายเส้นที่บีบชิดกันจนเกือบรวมเป็นเส้นเดียว (ภูมิประเทศสร้างให้แล้ว) จึงไม่วาดสัญลักษณ์เพิ่ม
          var mid = sg[Math.floor(sg.length / 2)];
          keyItems.push({ type: 'cliff', name: 'หน้าผา', gx: mid.p[0], gy: mid.p[1], elev: sampleH(world, mid.p[0], mid.p[1]) });
          if (L.names) label('หน้าผา', X(mid.p[0]), Y(mid.p[1]), 2.3, { italic: true, color: '#5b3510' });
        });
      });
    }

    /* 5) สันเขา หุบเขา */
    if (L.ridge) {
      c.strokeStyle = 'rgba(150,70,30,.75)'; c.lineWidth = mm(0.3); dash([3, 1.4]);
      world.ridges.forEach(function (rg) { path(I.chaikin(rg.pts, 1)); c.stroke(); });
      dash(null);
      world.ridges.forEach(function (rg, idx) { if (L.names && rg.name) { var m = rg.pts[Math.floor(rg.pts.length / 2)]; label(rg.name, X(m[0]), Y(m[1]), 2.3, { italic: true, color: '#7a3b13' }); } var m2 = rg.pts[Math.floor(rg.pts.length / 2)]; keyItems.push({ type: 'สันเขา', name: rg.name || 'สันเขา', gx: m2[0], gy: m2[1], elev: sampleH(world, m2[0], m2[1]) }); });
    }
    if (L.valley) {
      c.strokeStyle = 'rgba(40,100,170,.8)'; c.lineWidth = mm(0.3); dash([0.3, 1.1]);
      world.valleys.forEach(function (vl) { // ไม่วาดทับช่วงที่มีลำน้ำอยู่แล้ว
        var run = [];
        function fl() { if (run.length > 2) { path(run); c.stroke(); } run = []; }
        vl.pts.forEach(function (q) { var xi = clamp(Math.floor(q[0]), 0, nx - 1), yi = clamp(Math.floor(q[1]), 0, ny - 1), w = (L.river && world.riverMask[yi * nx + xi]) || (L.stream && world.streamMask[yi * nx + xi]); if (w) fl(); else run.push(q); });
        fl();
      });
      dash(null);
      world.valleys.forEach(function (vl) { var m = vl.pts[Math.floor(vl.pts.length / 2)]; if (L.names) label(vl.vname, X(m[0]), Y(m[1]), 2.3, { italic: true, color: '#1d4f86' }); keyItems.push({ type: 'หุบเขา', name: vl.vname, gx: m[0], gy: m[1], elev: sampleH(world, m[0], m[1]) }); });
    }

    /* 6) น้ำ */
    function wiggle(pts, amp) { // ทำให้ลำน้ำคดเคี้ยวตามธรรมชาติ (เบี่ยงตามเส้นตั้งฉากด้วยคลื่นสองความถี่)
      // ตัดจุดให้ห่างราว 2 ช่องแล้วทำให้โค้งเรียบ (ลบรอยหยักขั้นบันไดของทิศน้ำไหล 8 ทิศ)
      var out = [pts[0]], last = pts[0];
      for (var k = 1; k < pts.length - 1; k++) if (Math.hypot(pts[k][0] - last[0], pts[k][1] - last[1]) >= 2.2) { out.push(pts[k]); last = pts[k]; }
      out.push(pts[pts.length - 1]);
      // คดเคี้ยวเล็กน้อยตามระยะทาง (ปลายทั้งสองไม่ขยับ ยังต่อกับลำน้ำอื่นได้)
      var tot = 0, sArr = [0]; for (k = 1; k < out.length; k++) { tot += Math.hypot(out[k][0] - out[k - 1][0], out[k][1] - out[k - 1][1]); sArr.push(tot); }
      var ph = (pts[0][0] * 7.1 + pts[0][1] * 3.3) % 6.28, lam = 9 + amp * 6;
      out = out.map(function (q, k2) {
        if (k2 === 0 || k2 === out.length - 1) return q;
        var pv = out[k2 - 1], nt = out[k2 + 1], tx = nt[0] - pv[0], ty = nt[1] - pv[1], tl = Math.hypot(tx, ty) || 1, sk = sArr[k2];
        var taper = Math.min(1, sk / 4, (tot - sk) / 4), off = amp * taper * (Math.sin(sk / lam * 6.283 + ph) + 0.4 * Math.sin(sk / lam * 15.1 + ph * 1.7));
        return [q[0] - ty / tl * off, q[1] + tx / tl * off];
      });
      return I.chaikin(out, 3);
    }
    var segsOrder = world.streamSegs.slice().sort(function (a, b) { return a.accEnd - b.accEnd; });
    segsOrder.forEach(function (sg) {
      var big = sg.kind === 'river' || sg.accEnd >= world.T_STREAM * 2.4;
      if (big && !L.river) return;
      if (!big && !L.stream) return;
      var wmm = sg.kind === 'river' ? clamp(0.3 + Math.log(sg.accEnd / world.T_RIVER + 1) * 0.35, 0.35, 0.9) : (big ? 0.2 : 0.13);
      c.strokeStyle = big ? '#2a6fc9' : '#3b7fd0'; c.lineWidth = mm(wmm);
      dash(big ? null : [2.2, 0.9]);
      path(wiggle(sg.pts, sg.kind === 'river' ? 1.3 : 0.7)); c.stroke(); dash(null);
    });
    if (L.pond) {
      world.ponds.forEach(function (pd) { path(pd.poly, true); c.fillStyle = '#3f7fe6'; c.fill(); c.strokeStyle = '#2a5fc0'; c.lineWidth = mm(0.15); c.stroke(); });
    }
    if (L.river && L.names) {
      world.streamSegs.forEach(function (sg) { if (!sg.name) return; var m = sg.pts[Math.floor(sg.pts.length / 2)]; label(sg.name, X(m[0]), Y(m[1]), 2.4, { italic: true, color: '#1f58b0' }); });
    }
    if (L.pond && L.names) world.ponds.forEach(function (pd) { label(pd.name, X(pd.gx), Y(pd.gy), 2.3, { italic: true, color: '#1f58b0', center: true, gap: 0 }); });
    if (L.pond) world.ponds.forEach(function (pd) { keyItems.push({ type: 'หนอง/อ่างเก็บน้ำ', name: pd.name, gx: pd.gx, gy: pd.gy, elev: sampleH(world, pd.gx, pd.gy) }); });

    /* 7) ถนนและทางเดิน */
    function roadPath(rd) { return rd.pts; }
    if (L.roadSec) world.roads.filter(function (r) { return r.cls === 'sec'; }).forEach(function (rd) { c.strokeStyle = '#7a1f2b'; c.lineWidth = mm(0.4); dash(null); path(roadPath(rd)); c.stroke(); });
    if (L.cart) world.roads.filter(function (r) { return r.cls === 'cart'; }).forEach(function (rd) { c.strokeStyle = '#1a1a1a'; c.lineWidth = mm(0.22); dash([2.4, 0.9]); path(roadPath(rd)); c.stroke(); dash(null); });
    if (L.foot) world.roads.filter(function (r) { return r.cls === 'foot'; }).forEach(function (rd) { c.strokeStyle = '#1a1a1a'; c.lineWidth = mm(0.16); dash([1.2, 0.8]); path(roadPath(rd)); c.stroke(); dash(null); });
    if (L.roadMain) {
      world.roads.filter(function (r) { return r.cls === 'main'; }).forEach(function (rd) { c.strokeStyle = '#7a1f2b'; c.lineWidth = mm(0.95); path(roadPath(rd)); c.stroke(); });
      world.roads.filter(function (r) { return r.cls === 'main'; }).forEach(function (rd) { c.strokeStyle = '#e8b9b0'; c.lineWidth = mm(0.45); path(roadPath(rd)); c.stroke(); });
    }
    if (L.bridge) {
      world.bridges.forEach(function (b) {
        var bx = X(b.gx), by = Y(b.gy);
        c.save(); c.translate(bx, by); c.rotate(b.ang);
        c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = mm(0.22);
        c.fillRect(-mm(1.6), -mm(1.1), mm(3.2), mm(2.2)); c.strokeRect(-mm(1.6), -mm(1.1), mm(3.2), mm(2.2));
        c.beginPath(); c.moveTo(-mm(1.6), -mm(0.5)); c.lineTo(mm(1.6), -mm(0.5)); c.moveTo(-mm(1.6), mm(0.5)); c.lineTo(mm(1.6), mm(0.5)); c.stroke(); c.restore();
      });
    }
    if (L.power && world.power) {
      var a = world.power.a, b = world.power.b;
      c.strokeStyle = '#333'; c.lineWidth = mm(0.22); dash([4, 1.2]);
      c.beginPath(); c.moveTo(X(a[0]), Y(a[1])); c.lineTo(X(b[0]), Y(b[1])); c.stroke(); dash(null);
      var len = Math.hypot(X(b[0]) - X(a[0]), Y(b[1]) - Y(a[1])), n = Math.max(2, Math.round(len / mm(26)));
      for (var q = 0; q <= n; q++) { var px3 = X(a[0]) + (X(b[0]) - X(a[0])) * q / n, py3 = Y(a[1]) + (Y(b[1]) - Y(a[1])) * q / n; c.beginPath(); c.moveTo(px3 - mm(0.8), py3 - mm(0.8)); c.lineTo(px3 + mm(0.8), py3 + mm(0.8)); c.moveTo(px3 + mm(0.8), py3 - mm(0.8)); c.lineTo(px3 - mm(0.8), py3 + mm(0.8)); c.stroke(); }
    }

    /* 8) บ้านเรือนและสถานที่ */
    var counter = 0;
    function num(x, y) { if (!L.numbers) return; counter++; c.beginPath(); c.arc(x + mm(2.1), y - mm(2.1), mm(1.6), 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = mm(0.25); c.strokeStyle = '#d6261c'; c.stroke(); c.font = fontOf(2.1, true); c.fillStyle = '#d6261c'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(counter), x + mm(2.1), y - mm(2.1)); return counter; }
    var numbered = []; // [{n, type, name, gx, gy, elev}]
    function note(type, name, gx, gy, x, y, withElev) { var n = num(x, y); numbered.push({ n: n || null, type: type, name: name, gx: gx, gy: gy, elev: withElev ? sampleH(world, gx, gy) : null }); }
    if (L.village) {
      world.villages.forEach(function (v) {
        v.houses.forEach(function (hh) { var s = mm(v.size === 'large' ? 0.85 : 0.75); c.fillStyle = '#111'; c.fillRect(X(hh[0]) - s / 2, Y(hh[1]) - s / 2, s, s); });
      });
    }
    placed = placed.filter(function (b) { return !b.soft; });
    // ยอดเขา
    if (L.peak) world.peaks.forEach(function (pk) {
      var x = X(pk.gx), y = Y(pk.gy); SYM.peak(c, x, y, mm(2.7));
      var t = String(Math.round(pk.elev)); reserve(x, y, mm(1.4));
      if (!label(t + (L.names ? ' ' + pk.name : ''), x, y - mm(0.5), 2.3, { color: '#3a2410' })) label(t, x, y - mm(0.5), 2.3, { color: '#3a2410', force: true }); // ความสูงต้องมีเสมอ
      note('ยอดเขา', pk.name, pk.gx, pk.gy, x, y, true);
    });
    // ยอดเนินที่ไม่มีชื่อ: X + ความสูง (ไม่ใส่เลขกำกับ)
    summits.forEach(function (sm) {
      var x = X(sm.gx), y = Y(sm.gy); SYM.peak(c, x, y, mm(2.3)); reserve(x, y, mm(1.2));
      label(String(Math.round(sm.elev)), x, y - mm(0.4), 2.1, { color: '#3a2410', gap: mm(1.6), force: true });
    });
    if (L.saddle) world.saddles.forEach(function (sd, idx) {
      var x = X(sd.gx), y = Y(sd.gy); SYM.saddle(c, x, y, mm(2.6)); reserve(x, y, mm(1.4));
      label(Math.round(sd.elev) + (L.names ? ' คอเขา' : ''), x, y, 2.3, { italic: true, color: '#4a1f6b' });
      note('คอเขา', 'คอเขา ' + (idx + 1), sd.gx, sd.gy, x, y, true);
    });
    if (L.depr) world.sinks.forEach(function (sk, idx) {
      var x = X(sk.gx), y = Y(sk.gy);
      c.beginPath(); c.arc(x, y, mm(0.5), 0, 7); c.fillStyle = '#7d4a1c'; c.fill(); reserve(x, y, mm(1.2));
      label(Math.round(sampleH(world, sk.gx, sk.gy)) + (L.names ? ' ที่ต่ำ' : ''), x, y, 2.3, { italic: true, color: '#5b3510' });
      note('ที่ต่ำบนภูเขา (แอ่ง)', 'แอ่ง ' + (idx + 1), sk.gx, sk.gy, x, y, true);
    });
    // สถานที่
    var enabledType = { school: L.school, temple: L.temple, hospital: L.hospital, office: L.office, market: L.market, graveyard: L.graveyard, gas: L.gas, camp: L.camp, viewpoint: L.viewpoint, cave: L.cave, waterfall: L.waterfall };
    var TYPE_TH = { school: 'โรงเรียน', temple: 'วัด', hospital: 'สถานพยาบาล', office: 'ที่ทำการ', market: 'ตลาด', graveyard: 'ป่าช้า', gas: 'ปั๊มน้ำมัน', camp: 'ลานกางเต็นท์', viewpoint: 'จุดชมวิว', cave: 'ถ้ำ', waterfall: 'น้ำตก' };
    world.pois.forEach(function (pp) {
      if (!enabledType[pp.type]) return;
      var x = X(pp.gx), y = Y(pp.gy), fnSym = SYM[pp.type]; if (!fnSym) return;
      fnSym(c, x, y, mm(3.1)); reserve(x, y, mm(1.6));
      if (L.names && pp.type !== 'gas' && pp.type !== 'graveyard') label(pp.name, x, y, 2.2, {});
      note(TYPE_TH[pp.type], pp.name, pp.gx, pp.gy, x, y, pp.type === 'viewpoint' || pp.type === 'camp');
    });
    if (L.village) world.villages.forEach(function (v, idx) {
      var x = X(v.gx), y = Y(v.gy);
      if (L.names) label(v.name + (v.size === 'large' ? ' (ศูนย์กลางตำบล)' : ''), x, y - mm(3.2), 2.7, { bold: true, center: true, color: '#8a1a24' });
      note('หมู่บ้าน', v.name, v.gx, v.gy, x, y, false);
    });
    // สะพานในรายการเฉลย
    if (L.waterfall) { /* น้ำตกอยู่ใน pois แล้ว */ }

    c.restore();
    world.numbered = numbered; world.keyItems = keyItems;
    return { numbered: numbered, keyItems: keyItems };
  }

  /* ---------- คำอธิบายสัญลักษณ์ ---------- */
  // คืนรายการ { label, draw(c, x, y, s) } ตามชั้นที่เลือก s = ขนาดสัญลักษณ์ (พิกเซล) วาดแบบเล็กให้พอดีแถว
  function legend(o, world) {
    var L = o.syn.layers, out = [];
    function line(label, st) { out.push({ label: label, draw: function (c, x, y, s) { c.save(); c.strokeStyle = st.color; c.lineWidth = s * st.w; c.setLineDash((st.dash || []).map(function (d) { return d * s * 0.4; })); c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x + s * 0.9, y); c.stroke(); c.restore(); } }); }
    function sym(label, key) { out.push({ label: label, draw: function (c, x, y, s) { SYM[key](c, x, y, s * 0.95); } }); }
    function swatch(label, rgb, extra) { out.push({ label: label, draw: function (c, x, y, s) { c.fillStyle = 'rgb(' + rgb.join(',') + ')'; c.fillRect(x - s * 0.8, y - s * 0.45, s * 1.6, s * 0.9); c.strokeStyle = '#999'; c.lineWidth = s * 0.05; c.strokeRect(x - s * 0.8, y - s * 0.45, s * 1.6, s * 0.9); if (extra) extra(c, x, y, s); } }); }
    var iv = world ? world.interval : 20;
    if (L.cIndex) line('เส้นชั้นความสูงหลัก' + (world ? ' (ทุก ' + world.index + ' ม.)' : ''), { color: '#7d4a1c', w: 0.11 });
    if (L.cInter) line('เส้นชั้นความสูงรอง' + (world ? ' (ทุก ' + iv + ' ม.)' : ''), { color: '#a06a38', w: 0.05 });
    if (L.cSupp) line('เส้นชั้นความสูงแทรก (ครึ่งช่วง ' + (iv / 2) + ' ม. เฉพาะที่ราบ)', { color: '#a06a38', w: 0.045, dash: [2, 1.6] });
    if (L.cApprox) line('เส้นชั้นความสูงโดยประมาณ (ประยาว)', { color: '#a06a38', w: 0.05, dash: [5.5, 2] });
    if (L.cDepr) out.push({ label: 'เส้นคุ้งกระทะ (แอ่ง ขีดชี้ลงที่ต่ำ)', draw: function (c, x, y, s) { c.save(); c.strokeStyle = '#7d4a1c'; c.lineWidth = s * 0.09; c.beginPath(); c.arc(x, y, s * 0.4, 0, 7); c.stroke(); for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4; c.beginPath(); c.moveTo(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4); c.lineTo(x + Math.cos(a) * s * 0.18, y + Math.sin(a) * s * 0.18); c.stroke(); } c.restore(); } });
    if (L.peak) sym('ยอดเขา (เลขคือความสูงเหนือระดับน้ำทะเล เมตร)', 'peak');
    if (L.ridge) line('สันเขา', { color: 'rgba(150,70,30,.75)', w: 0.1, dash: [4, 2] });
    if (L.saddle) sym('คอเขา', 'saddle');
    if (L.valley) line('หุบเขา (แกนหุบเขา)', { color: 'rgba(40,100,170,.8)', w: 0.08, dash: [0.5, 2] });
    if (L.cliff) out.push({ label: 'หน้าผา (เส้นชั้นความสูงบีบชิดกันมาก)', draw: function (c, x, y, s) { c.save(); for (var k = 0; k < 5; k++) { c.strokeStyle = k === 2 ? '#7d4a1c' : '#a06a38'; c.lineWidth = s * (k === 2 ? 0.09 : 0.05); c.beginPath(); var yo = (k - 2) * s * 0.22; c.moveTo(x - s * 0.9, y + yo * 1.6); c.quadraticCurveTo(x, y + yo * 0.12, x + s * 0.9, y + yo * 1.6); c.stroke(); } c.restore(); } });
    if (L.depr) out.push({ label: 'ที่ต่ำบนภูเขา (เลขคือความสูงก้นแอ่ง)', draw: function (c, x, y, s) { c.fillStyle = '#7d4a1c'; c.beginPath(); c.arc(x, y, s * 0.14, 0, 7); c.fill(); } });
    if (L.river) line('แม่น้ำ/ลำห้วย', { color: '#2a6fc9', w: 0.12 });
    if (L.stream) line('ร่องน้ำ/ห้วยมีน้ำบางฤดู', { color: '#3b7fd0', w: 0.06, dash: [4, 1.6] });
    if (L.pond) swatch('หนอง/อ่างเก็บน้ำ', [63, 127, 230]);
    if (L.waterfall) sym('น้ำตก', 'waterfall');
    if (L.forest) swatch('ป่า', [204, 226, 206], function (c, x, y, s) { c.strokeStyle = '#3f7a4a'; c.lineWidth = s * 0.06; c.beginPath(); c.arc(x, y, s * 0.2, 0, 7); c.stroke(); });
    if (L.field) swatch('ไร่ (จุดถี่)', [226, 237, 232], function (c, x, y, s) { c.fillStyle = '#2a2f2a'; for (var k = 0; k < 14; k++) { c.beginPath(); c.arc(x - s * 0.7 + ((k * 37) % 14) / 14 * s * 1.4, y - s * 0.35 + ((k * 23) % 7) / 7 * s * 0.7, s * 0.05, 0, 7); c.fill(); } });
    if (L.paddy) swatch('นา (จุดห่าง)', [226, 237, 232], function (c, x, y, s) { c.fillStyle = '#2a2f2a'; for (var k = 0; k < 7; k++) { c.beginPath(); c.arc(x - s * 0.7 + ((k * 37) % 14) / 14 * s * 1.4, y - s * 0.35 + ((k * 23) % 7) / 7 * s * 0.7, s * 0.05, 0, 7); c.fill(); } });
    if (L.orchard) swatch('สวน/ไม้ยืนต้น', [218, 233, 220], function (c, x, y, s) { c.fillStyle = '#4a7a3a'; for (var k = -1; k <= 1; k++) { c.beginPath(); c.arc(x + k * s * 0.45, y, s * 0.08, 0, 7); c.fill(); } });
    if (L.grass) swatch('ทุ่งหญ้า/พืชต่ำ', [226, 237, 232], function (c, x, y, s) { c.strokeStyle = '#8fb59a'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(x - s * 0.15, y + s * 0.15); c.lineTo(x, y - s * 0.15); c.lineTo(x + s * 0.15, y + s * 0.15); c.stroke(); });
    if (L.village) sym('หมู่บ้าน', 'house');
    ['school:โรงเรียน', 'temple:วัด', 'hospital:สถานพยาบาล', 'office:ที่ทำการ (อบต.)', 'market:ตลาด', 'graveyard:ป่าช้า', 'gas:ปั๊มน้ำมัน', 'camp:ลานกางเต็นท์', 'viewpoint:จุดชมวิว', 'cave:ถ้ำ'].forEach(function (t) { var kv = t.split(':'); if (L[kv[0]]) sym(kv[1], kv[0]); });
    if (L.roadMain) out.push({ label: 'ถนนลาดยาง', draw: function (c, x, y, s) { c.save(); c.lineCap = 'butt'; c.strokeStyle = '#7a1f2b'; c.lineWidth = s * 0.3; c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x + s * 0.9, y); c.stroke(); c.strokeStyle = '#e8b9b0'; c.lineWidth = s * 0.14; c.stroke(); c.restore(); } });
    if (L.roadSec) line('ถนนลูกรัง', { color: '#7a1f2b', w: 0.12 });
    if (L.cart) line('ทางเกวียน', { color: '#1a1a1a', w: 0.07, dash: [5, 2] });
    if (L.foot) line('ทางเดินเท้า', { color: '#1a1a1a', w: 0.05, dash: [2.4, 1.6] });
    if (L.bridge) out.push({ label: 'สะพาน', draw: function (c, x, y, s) { c.save(); c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = s * 0.07; c.fillRect(x - s * 0.5, y - s * 0.35, s, s * 0.7); c.strokeRect(x - s * 0.5, y - s * 0.35, s, s * 0.7); c.restore(); } });
    if (L.power) line('สายไฟฟ้าแรงสูง', { color: '#333', w: 0.07, dash: [4, 1.2] });
    return out;
  }

  // รายการเฉลย (พิกัดแปลงที่ฝั่งพิมพ์)
  function answerRows(world) {
    var rows = [], seen = {};
    (world.numbered || []).forEach(function (n) { rows.push({ n: n.n, type: n.type, name: n.name, gx: n.gx, gy: n.gy, elev: n.elev }); seen[n.type + '|' + n.name] = 1; });
    (world.keyItems || []).forEach(function (k) { if (!seen[k.type + '|' + k.name]) rows.push({ n: null, type: k.type, name: k.name, gx: k.gx, gy: k.gy, elev: k.elev }); });
    return rows;
  }

  root.TrailSynDraw = { GROUPS: GROUPS, PRESET_SETS: PRESET_SETS, defaultLayers: defaultLayers, allLayers: allLayers, draw: draw, legend: legend, answerRows: answerRows, SYM: SYM, contourLines: contourLines, FONT: FONT };
})(typeof self !== 'undefined' ? self : this);
