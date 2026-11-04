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
      if (fwd.length >= 4) lines.push({ pts: fwd, closed: closed });
    }
    return lines;
  }

  function sampleH(world, gx, gy) {
    var nx = world.nx, ny = world.ny, x = clamp(gx - 0.5, 0, nx - 1.001), y = clamp(gy - 0.5, 0, ny - 1.001), i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, h = world.h;
    return (h[j * nx + i] * (1 - fx) + h[j * nx + i + 1] * fx) * (1 - fy) + (h[(j + 1) * nx + i] * (1 - fx) + h[(j + 1) * nx + i + 1] * fx) * fy;
  }

  /* ---------- สัญลักษณ์จุด (วาดที่ x,y ขนาด s พิกเซล) ---------- */
  var SYM = {
    peak: function (c, x, y, s) { c.beginPath(); c.moveTo(x, y - s * 0.62); c.lineTo(x + s * 0.55, y + s * 0.4); c.lineTo(x - s * 0.55, y + s * 0.4); c.closePath(); c.fillStyle = '#111'; c.fill(); },
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
      for (var q = 0; q < cand.length; q++) {
        var bx = cand[q][0], by = cand[q][1], box = [bx - 2, by - hgt, bx + w + 2, by + hgt * 0.3];
        if (box[0] < fx || box[2] > fx + fw || box[1] < fy || box[3] > fy + fh) continue;
        if (overlap(box)) continue;
        placed.push(box);
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        c.lineJoin = 'round'; c.lineWidth = mm(0.9); c.strokeStyle = 'rgba(255,255,255,.88)'; c.strokeText(text, bx, by);
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
    c.fillStyle = '#ffffff'; c.fillRect(fx, fy, fw, fh);

    /* 1) พืชคลุมดิน */
    var anyCover = L.forest || L.field || L.paddy || L.orchard || L.grass;
    var COL = { grass: [244, 247, 224], forest: [208, 230, 184], field: [252, 243, 205], paddy: [236, 246, 196], orchard: [220, 235, 178], none: [255, 255, 255] };
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
        if (++cnt > 70000) return;
        drawFn(jx, jy);
      }
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (L.forest) { c.strokeStyle = '#4d8a45'; c.lineWidth = mm(0.18); scatter('forest', 4.2, function (x, y) { c.beginPath(); c.arc(x, y, mm(0.85), 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, mm(0.12), 0, 7); c.fillStyle = '#4d8a45'; c.fill(); }); }
    if (L.orchard) { c.fillStyle = '#6a8a2a'; scatter('orchard', 2.9, function (x, y) { c.beginPath(); c.arc(x, y, mm(0.32), 0, 7); c.fill(); }, 0); }
    if (L.field) { c.strokeStyle = '#c3a23a'; c.lineWidth = mm(0.16); scatter('field', 3.0, function (x, y) { c.beginPath(); c.moveTo(x - mm(0.9), y + mm(0.9)); c.lineTo(x + mm(0.9), y - mm(0.9)); c.stroke(); }, 0.2); }
    if (L.paddy) { c.strokeStyle = '#6aa36a'; c.lineWidth = mm(0.15); scatter('paddy', 3.6, function (x, y) { c.beginPath(); c.moveTo(x - mm(1.1), y); c.lineTo(x + mm(1.1), y); c.moveTo(x - mm(0.5), y - mm(0.7)); c.lineTo(x - mm(0.5), y - mm(0.1)); c.moveTo(x + mm(0.5), y - mm(0.7)); c.lineTo(x + mm(0.5), y - mm(0.1)); c.stroke(); }, 0.2); }
    if (L.grass) { c.strokeStyle = '#a9c98a'; c.lineWidth = mm(0.14); scatter('grass', 7.5, function (x, y) { c.beginPath(); c.moveTo(x - mm(0.5), y); c.lineTo(x, y - mm(0.8)); c.lineTo(x + mm(0.5), y); c.stroke(); }); }

    /* 2) เงาภูเขา */
    if (L.shade) {
      var sh = c.createImageData(nx, ny), sd = sh.data, h = world.h, p, i, j;
      for (j = 1; j < ny - 1; j++) for (i = 1; i < nx - 1; i++) {
        p = j * nx + i;
        var dzdx = (h[p + 1] - h[p - 1]) / (2 * world.cellM), dzdy = (h[p + nx] - h[p - nx]) / (2 * world.cellM);
        var lam = 0.7 * (-dzdx * 0.7071 - dzdy * 0.7071) / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy) + 0.7071 * (1 / Math.sqrt(1 + dzdx * dzdx + dzdy * dzdy));
        var al = clamp((0.62 - lam) * 0.9, 0, 0.55);
        sd[p * 4] = 40; sd[p * 4 + 1] = 40; sd[p * 4 + 2] = 30; sd[p * 4 + 3] = Math.round(al * 255);
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
    function strokeContour(ln, level, style) {
      var pts = ln.pts;
      if (L.cApprox && style.solidOK !== false) {
        // แบ่งเส้นเป็นช่วงในและนอกบริเวณโดยประมาณ ช่วงในวาดเป็นเส้นประ
        var run = [pts[0]], inZ = inApprox(pts[0][0], pts[0][1]);
        function flush() { if (run.length > 1) { path(run); dash(inZ ? [1.5, 0.9] : null); c.stroke(); } }
        for (var k = 1; k < pts.length; k++) { var z = inApprox(pts[k][0], pts[k][1]); if (z !== inZ) { run.push(pts[k]); flush(); run = [pts[k]]; inZ = z; } else run.push(pts[k]); }
        flush(); dash(null);
      } else { path(pts, ln.closed); dash(style.dash); c.stroke(); dash(null); }
    }
    function drawLevels(offset, style, filter) {
      var k0 = Math.ceil((hmin - offset * iv) / iv), k1 = Math.floor((hmax - offset * iv) / iv), k;
      for (k = k0; k <= k1; k++) {
        var level = (k + offset) * iv, isIdx = ((k % 5) + 5) % 5 === 0;
        if (!filter(isIdx)) continue;
        var lines = contourLines(world, level);
        c.strokeStyle = isIdx && style.idx ? style.idx.color : style.color; c.lineWidth = mm(isIdx && style.idx ? style.idx.w : style.w);
        lines.forEach(function (ln) {
          var ptsPx = ln.pts;
          strokeContour(ln, level, style);
          // วงปิดที่ด้านในต่ำกว่า = แอ่ง (คุ้งกระทะ)
          if (ln.closed && offset === 0) {
            var cx = 0, cy = 0; ln.pts.forEach(function (q) { cx += q[0]; cy += q[1]; }); cx /= ln.pts.length; cy /= ln.pts.length;
            if (sampleH(world, cx, cy) < level - 0.2 * iv) depressionTicks.push({ ln: ln, level: level, idx: isIdx });
          }
          if (isIdx && offset === 0 && style.label) labelSpots.push({ ln: ln, level: level });
        });
      }
    }
    var showIdx = L.cIndex, showInter = L.cInter;
    if (L.cSupp) drawLevels(0.5, { color: '#b8844a', w: 0.1, dash: [1.4, 0.8] }, function () { return true; });
    if (showIdx || showInter) {
      drawLevels(0, { color: '#b0793d', w: 0.15, idx: { color: '#7d4a1c', w: 0.3 }, label: L.cLabel }, function (isIdx) { return isIdx ? showIdx : showInter; });
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
            c.lineWidth = mm(0.9); c.strokeStyle = 'rgba(255,255,255,.92)'; c.lineJoin = 'round'; c.strokeText(txt, 0, 0); c.fillStyle = '#6b3a12'; c.fillText(txt, 0, 0); c.restore();
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
        c.strokeStyle = '#111'; c.lineWidth = mm(0.35); dash(null);
        c.beginPath();
        var seg = [], segs = [];
        for (k = 0; k < pts.length; k++) {
          var nxp = pts[Math.min(pts.length - 1, k + 1)], pvp = pts[Math.max(0, k - 1)], tx = nxp[0] - pvp[0], ty = nxp[1] - pvp[1], tl = Math.hypot(tx, ty) || 1, nxv = -ty / tl, nyv = tx / tl;
          var hA = sampleH(world, pts[k][0] + nxv * 3.2, pts[k][1] + nyv * 3.2), hB = sampleH(world, pts[k][0] - nxv * 3.2, pts[k][1] - nyv * 3.2), drop = Math.abs(hA - hB);
          if (drop > Math.max(cl.step * 0.55, iv * 1.2)) seg.push({ p: pts[k], dir: hA < hB ? 1 : -1, nx: nxv, ny: nyv }); else if (seg.length) { segs.push(seg); seg = []; }
        }
        if (seg.length) segs.push(seg);
        segs.forEach(function (sg) {
          if (sg.length < 3) return;
          c.beginPath(); sg.forEach(function (q, k2) { if (k2) c.lineTo(X(q.p[0]), Y(q.p[1])); else c.moveTo(X(q.p[0]), Y(q.p[1])); }); c.stroke();
          c.lineWidth = mm(0.2); c.beginPath();
          var acc = 0, step = mm(1.5), nextAt = step;
          for (var k3 = 1; k3 < sg.length; k3++) {
            var ax = X(sg[k3 - 1].p[0]), ay = Y(sg[k3 - 1].p[1]), bx3 = X(sg[k3].p[0]), by3 = Y(sg[k3].p[1]), sl = Math.hypot(bx3 - ax, by3 - ay);
            while (acc + sl >= nextAt && sl > 0) { var tt = (nextAt - acc) / sl, px2 = ax + (bx3 - ax) * tt, py2 = ay + (by3 - ay) * tt; c.moveTo(px2, py2); c.lineTo(px2 + sg[k3].dir * sg[k3].nx * mm(1.3), py2 + sg[k3].dir * sg[k3].ny * mm(1.3)); nextAt += step; }
            acc += sl;
          }
          c.stroke(); c.lineWidth = mm(0.35);
          var mid = sg[Math.floor(sg.length / 2)];
          keyItems.push({ type: 'cliff', name: 'หน้าผา', gx: mid.p[0], gy: mid.p[1], elev: sampleH(world, mid.p[0], mid.p[1]) });
          if (L.names) label('หน้าผา', X(mid.p[0]) - mm(6), Y(mid.p[1]) - mm(3), 2.3, { italic: true, center: true, color: '#333' });
        });
      });
    }

    /* 5) สันเขา หุบเขา */
    if (L.ridge) {
      c.strokeStyle = '#a0522d'; c.lineWidth = mm(0.5); dash([3, 1.4]);
      world.ridges.forEach(function (rg) { path(I.chaikin(rg.pts, 1)); c.stroke(); });
      dash(null);
      world.ridges.forEach(function (rg, idx) { if (L.names && rg.name) { var m = rg.pts[Math.floor(rg.pts.length / 2)]; label(rg.name, X(m[0]), Y(m[1]), 2.3, { italic: true, color: '#7a3b13' }); } var m2 = rg.pts[Math.floor(rg.pts.length / 2)]; keyItems.push({ type: 'สันเขา', name: rg.name || 'สันเขา', gx: m2[0], gy: m2[1], elev: sampleH(world, m2[0], m2[1]) }); });
    }
    if (L.valley) {
      c.strokeStyle = '#3b6fa5'; c.lineWidth = mm(0.45); dash([0.3, 1.1]);
      world.valleys.forEach(function (vl) { path(vl.pts); c.stroke(); });
      dash(null);
      world.valleys.forEach(function (vl) { var m = vl.pts[Math.floor(vl.pts.length / 2)]; if (L.names) label(vl.vname, X(m[0]), Y(m[1]), 2.3, { italic: true, color: '#1d4f86' }); keyItems.push({ type: 'หุบเขา', name: vl.vname, gx: m[0], gy: m[1], elev: sampleH(world, m[0], m[1]) }); });
    }

    /* 6) น้ำ */
    function wiggle(pts, amp) { // ทำให้ลำน้ำคดเคี้ยวตามธรรมชาติ (เบี่ยงตามเส้นตั้งฉากด้วยคลื่นสองความถี่)
      var ph = (pts[0][0] * 7.1 + pts[0][1] * 3.3) % 6.28;
      var out = pts.map(function (q, k) {
        var pv = pts[Math.max(0, k - 1)], nt = pts[Math.min(pts.length - 1, k + 1)], tx = nt[0] - pv[0], ty = nt[1] - pv[1], tl = Math.hypot(tx, ty) || 1;
        var off = amp * (Math.sin(k * 0.55 + ph) + 0.5 * Math.sin(k * 1.3 + ph * 2));
        return [q[0] - ty / tl * off, q[1] + tx / tl * off];
      });
      return I.chaikin(out, 2);
    }
    var segsOrder = world.streamSegs.slice().sort(function (a, b) { return a.accEnd - b.accEnd; });
    segsOrder.forEach(function (sg) {
      var big = sg.kind === 'river' || sg.accEnd >= world.T_STREAM * 2.4;
      if (big && !L.river) return;
      if (!big && !L.stream) return;
      var wmm = sg.kind === 'river' ? clamp(0.45 + Math.log(sg.accEnd / world.T_RIVER + 1) * 0.5, 0.5, 1.2) : (big ? 0.32 : 0.22);
      c.strokeStyle = big ? '#3f8fe0' : '#5aa0e0'; c.lineWidth = mm(wmm);
      dash(big ? null : [1.4, 0.9]);
      path(wiggle(sg.pts, 0.9)); c.stroke(); dash(null);
    });
    if (L.pond) {
      world.ponds.forEach(function (pd) { path(pd.poly, true); c.fillStyle = '#a9d5f5'; c.fill(); c.strokeStyle = '#3f8fe0'; c.lineWidth = mm(0.35); c.stroke(); });
    }
    if (L.river && L.names) {
      world.streamSegs.forEach(function (sg) { if (!sg.name) return; var m = sg.pts[Math.floor(sg.pts.length / 2)]; label(sg.name, X(m[0]), Y(m[1]), 2.4, { italic: true, color: '#1a5fb4' }); });
    }
    if (L.pond && L.names) world.ponds.forEach(function (pd) { label(pd.name, X(pd.gx), Y(pd.gy), 2.3, { italic: true, color: '#1a5fb4', center: true, gap: 0 }); });
    if (L.pond) world.ponds.forEach(function (pd) { keyItems.push({ type: 'หนอง/อ่างเก็บน้ำ', name: pd.name, gx: pd.gx, gy: pd.gy, elev: sampleH(world, pd.gx, pd.gy) }); });

    /* 7) ถนนและทางเดิน */
    function roadPath(rd) { return rd.pts; }
    if (L.roadSec) world.roads.filter(function (r) { return r.cls === 'sec'; }).forEach(function (rd) { c.strokeStyle = '#7b5b3a'; c.lineWidth = mm(0.6); dash(null); path(roadPath(rd)); c.stroke(); });
    if (L.cart) world.roads.filter(function (r) { return r.cls === 'cart'; }).forEach(function (rd) { c.strokeStyle = '#5a3f26'; c.lineWidth = mm(0.32); dash([2, 1]); path(roadPath(rd)); c.stroke(); dash(null); });
    if (L.foot) world.roads.filter(function (r) { return r.cls === 'foot'; }).forEach(function (rd) { c.strokeStyle = '#222'; c.lineWidth = mm(0.3); dash([0.5, 0.9]); path(roadPath(rd)); c.stroke(); dash(null); });
    if (L.roadMain) {
      world.roads.filter(function (r) { return r.cls === 'main'; }).forEach(function (rd) { c.strokeStyle = '#7a3b00'; c.lineWidth = mm(1.55); path(roadPath(rd)); c.stroke(); });
      world.roads.filter(function (r) { return r.cls === 'main'; }).forEach(function (rd) { c.strokeStyle = '#f4b350'; c.lineWidth = mm(0.95); path(roadPath(rd)); c.stroke(); });
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
        v.houses.forEach(function (hh) { var s = mm(v.size === 'large' ? 1.15 : 1.0); c.fillStyle = '#111'; c.fillRect(X(hh[0]) - s / 2, Y(hh[1]) - s / 2, s, s); });
      });
    }
    // ยอดเขา
    if (L.peak) world.peaks.forEach(function (pk) {
      var x = X(pk.gx), y = Y(pk.gy); SYM.peak(c, x, y, mm(2.7));
      var t = String(Math.round(pk.elev)); reserve(x, y, mm(1.4));
      label(t + (L.names ? ' ' + pk.name : ''), x, y - mm(0.5), 2.5, { bold: true });
      note('ยอดเขา', pk.name, pk.gx, pk.gy, x, y, true);
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
      if (L.names) label(v.name + (v.size === 'large' ? ' (ศูนย์กลางตำบล)' : ''), x, y - mm(3.2), 2.7, { bold: true, center: true });
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
    if (L.cIndex) line('เส้นชั้นความสูงหลัก' + (world ? ' (ทุก ' + world.index + ' ม.)' : ''), { color: '#7d4a1c', w: 0.14 });
    if (L.cInter) line('เส้นชั้นความสูงรอง' + (world ? ' (ทุก ' + iv + ' ม.)' : ''), { color: '#b0793d', w: 0.07 });
    if (L.cSupp) line('เส้นแทรก' + (world ? ' (ทุก ' + (iv / 2) + ' ม.)' : ''), { color: '#b8844a', w: 0.05, dash: [3, 2] });
    if (L.cApprox) line('เส้นชั้นความสูงโดยประมาณ', { color: '#b0793d', w: 0.07, dash: [3, 2] });
    if (L.cDepr) out.push({ label: 'เส้นคุ้งกระทะ (แอ่ง ขีดชี้ลงที่ต่ำ)', draw: function (c, x, y, s) { c.save(); c.strokeStyle = '#7d4a1c'; c.lineWidth = s * 0.09; c.beginPath(); c.arc(x, y, s * 0.4, 0, 7); c.stroke(); for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4; c.beginPath(); c.moveTo(x + Math.cos(a) * s * 0.4, y + Math.sin(a) * s * 0.4); c.lineTo(x + Math.cos(a) * s * 0.18, y + Math.sin(a) * s * 0.18); c.stroke(); } c.restore(); } });
    if (L.peak) sym('ยอดเขา (เลขคือความสูงเหนือระดับน้ำทะเล เมตร)', 'peak');
    if (L.ridge) line('สันเขา', { color: '#a0522d', w: 0.12, dash: [4, 2] });
    if (L.saddle) sym('คอเขา', 'saddle');
    if (L.valley) line('หุบเขา (แกนหุบเขา)', { color: '#3b6fa5', w: 0.1, dash: [0.5, 2] });
    if (L.cliff) out.push({ label: 'หน้าผา', draw: function (c, x, y, s) { c.save(); c.strokeStyle = '#111'; c.lineWidth = s * 0.1; c.beginPath(); c.moveTo(x - s * 0.9, y - s * 0.2); c.lineTo(x + s * 0.9, y - s * 0.2); c.stroke(); c.lineWidth = s * 0.06; for (var k = -3; k <= 3; k++) { c.beginPath(); c.moveTo(x + k * s * 0.27, y - s * 0.2); c.lineTo(x + k * s * 0.27, y + s * 0.3); c.stroke(); } c.restore(); } });
    if (L.depr) out.push({ label: 'ที่ต่ำบนภูเขา (เลขคือความสูงก้นแอ่ง)', draw: function (c, x, y, s) { c.fillStyle = '#7d4a1c'; c.beginPath(); c.arc(x, y, s * 0.14, 0, 7); c.fill(); } });
    if (L.river) line('แม่น้ำ/ลำห้วย', { color: '#3f8fe0', w: 0.14 });
    if (L.stream) line('ร่องน้ำ', { color: '#5aa0e0', w: 0.08, dash: [3, 2] });
    if (L.pond) swatch('หนอง/อ่างเก็บน้ำ', [169, 213, 245]);
    if (L.waterfall) sym('น้ำตก', 'waterfall');
    if (L.forest) swatch('ป่า', [208, 230, 184], function (c, x, y, s) { c.strokeStyle = '#4d8a45'; c.lineWidth = s * 0.06; c.beginPath(); c.arc(x, y, s * 0.2, 0, 7); c.stroke(); });
    if (L.field) swatch('ไร่', [252, 243, 205], function (c, x, y, s) { c.strokeStyle = '#c3a23a'; c.lineWidth = s * 0.06; for (var k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x + k * s * 0.4 - s * 0.15, y + s * 0.2); c.lineTo(x + k * s * 0.4 + s * 0.15, y - s * 0.2); c.stroke(); } });
    if (L.paddy) swatch('นา', [236, 246, 196], function (c, x, y, s) { c.strokeStyle = '#6aa36a'; c.lineWidth = s * 0.06; c.beginPath(); c.moveTo(x - s * 0.5, y); c.lineTo(x + s * 0.5, y); c.stroke(); });
    if (L.orchard) swatch('สวน/ไม้ยืนต้น', [220, 235, 178], function (c, x, y, s) { c.fillStyle = '#6a8a2a'; for (var k = -1; k <= 1; k++) { c.beginPath(); c.arc(x + k * s * 0.45, y, s * 0.08, 0, 7); c.fill(); } });
    if (L.grass) swatch('ทุ่งหญ้า/พืชต่ำ', [244, 247, 224]);
    if (L.village) sym('หมู่บ้าน', 'house');
    ['school:โรงเรียน', 'temple:วัด', 'hospital:สถานพยาบาล', 'office:ที่ทำการ (อบต.)', 'market:ตลาด', 'graveyard:ป่าช้า', 'gas:ปั๊มน้ำมัน', 'camp:ลานกางเต็นท์', 'viewpoint:จุดชมวิว', 'cave:ถ้ำ'].forEach(function (t) { var kv = t.split(':'); if (L[kv[0]]) sym(kv[1], kv[0]); });
    if (L.roadMain) out.push({ label: 'ถนนลาดยาง', draw: function (c, x, y, s) { c.save(); c.lineCap = 'butt'; c.strokeStyle = '#7a3b00'; c.lineWidth = s * 0.34; c.beginPath(); c.moveTo(x - s * 0.9, y); c.lineTo(x + s * 0.9, y); c.stroke(); c.strokeStyle = '#f4b350'; c.lineWidth = s * 0.2; c.stroke(); c.restore(); } });
    if (L.roadSec) line('ถนนลูกรัง', { color: '#7b5b3a', w: 0.14 });
    if (L.cart) line('ทางเกวียน', { color: '#5a3f26', w: 0.09, dash: [4, 2] });
    if (L.foot) line('ทางเดินเท้า', { color: '#222', w: 0.08, dash: [1, 2] });
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

  root.TrailSynDraw = { GROUPS: GROUPS, PRESET_SETS: PRESET_SETS, defaultLayers: defaultLayers, allLayers: allLayers, draw: draw, legend: legend, answerRows: answerRows, SYM: SYM, contourLines: contourLines };
})(typeof self !== 'undefined' ? self : this);
